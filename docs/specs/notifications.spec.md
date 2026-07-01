# Notifications Module Specification

## 1. Module Overview

The Notifications module owns the `Notification` entity and the `NotificationsGateway` (WebSocket). It handles in-app notification creation (bulk insert from BullMQ processors), patient notification reads, mark-as-read, and real-time push via WebSocket after DB insert. It is a consumer-facing module — it receives work from the queue, not from patient HTTP requests.

---

## 2. Entities Involved

**Owns:**
- `notifications`

---

## 3. DTOs

```typescript
// Internal DTO — used by processors to create notifications in bulk
interface CreateNotificationDto {
  userId: string;                // ULID — FK → users.id
  type: NotificationType;
  payload: Record<string, unknown>;  // type-specific — see payload shapes below
}
```

**Payload shapes by `NotificationType`:**

```typescript
// PROGRAM_MATCH
{ programId: string; programTitle: string; orgName: string }

// ENROLLMENT_UPDATE
{ enrollmentId: string; programTitle: string; newStatus: EnrollmentStatus }

// CONSENT_REVOKED
{ consentGrantId: string; purpose: ConsentPurpose; affectedEnrollmentCount: number }

// NEW_MESSAGE
{ messageId: string; senderId: string; enrollmentId?: string; studyEnrollmentId?: string; preview: string }
// preview = first 80 chars of message body

// STUDY_MATCH
{ studyId: string; studyTitle: string; researcherInstitution: string }

// ORG_VERIFIED
{ orgId: string; orgName: string; verifiedAt: string }
```

### Response Shapes

```typescript
interface NotificationResponse {
  data: {
    id: string;
    userId: string;
    type: NotificationType;
    payload: Record<string, unknown>;
    readAt?: string;              // ISO 8601, null if unread
    createdAt: string;
  };
  traceId: string;
}

interface NotificationListResponse {
  data: NotificationResponse['data'][];
  meta: {
    cursor?: string;
    limit: number;
    unreadCount: number;          // count of unread notifications for this user
  };
  traceId: string;
}
```

---

## 4. Endpoints

### `GET /notifications/me`
- **Auth:** Any valid JWT (any role)
- **Query params:** `?cursor=<ULID>&limit=<number>&unreadOnly=<boolean>`
- **Logic:**
  1. Query `notifications WHERE user_id = req.user.sub AND deleted_at IS NULL`
  2. If `unreadOnly = true`: add `AND read_at IS NULL`
  3. Apply keyset pagination: `id > cursor ORDER BY id DESC LIMIT limit+1`
  4. Include `unreadCount` in meta (separate `COUNT` query `WHERE read_at IS NULL`)
- **Success:** `200 NotificationListResponse`
- **Errors:**
  - `401` — missing/invalid JWT

---

### `PATCH /notifications/:id/read`
- **Auth:** Any valid JWT
- **Path param:** `id` — ULID of the notifications row
- **Logic:**
  1. Load notification — throw `NotFoundException` if not found
  2. Verify `notifications.user_id = req.user.sub` — throw `403` if mismatch
  3. If `read_at` is already set: return the notification as-is (idempotent)
  4. Set `read_at = NOW()`
- **Success:** `200 NotificationResponse`
- **Errors:**
  - `401`, `403`, `404`

---

## 5. Service Methods

```typescript
class NotificationsService {

  /**
   * Bulk inserts notifications for a batch of users.
   * Called by batch_notify BullMQ processor.
   * Executes a single INSERT ... VALUES (...), (...), ... for all records in the batch.
   * After insert, pushes real-time notification to each user via NotificationsGateway.
   *
   * NEVER called with more than 200 records at once — processor enforces this.
   */
  createBulk(notifications: CreateNotificationDto[]): Promise<void>

  /**
   * Inserts a single notification.
   * Used for targeted notifications (e.g., org_verified, consent_revoked).
   * Pushes real-time notification via NotificationsGateway after insert.
   */
  createOne(notification: CreateNotificationDto): Promise<Notification>

  /**
   * Returns paginated notifications for the authenticated user.
   * Orders by id DESC (newest first).
   * Optionally filters to unread only.
   * Includes unreadCount in the response meta.
   */
  getMyNotifications(
    userId: string,
    query: { cursor?: string; limit: number; unreadOnly?: boolean }
  ): Promise<{ notifications: Notification[]; nextCursor?: string; unreadCount: number }>

  /**
   * Marks a notification as read.
   * Verifies ownership.
   * Idempotent — if already read, returns existing record unchanged.
   * Throws NotFoundException if not found.
   * Throws ForbiddenException if user_id !== caller.
   */
  markRead(id: string, userId: string): Promise<Notification>
}
```

### NotificationsGateway

```typescript
// src/gateways/notifications.gateway.ts

@WebSocketGateway({ namespace: '/notifications', cors: { origin: '*' } })
class NotificationsGateway {

  /**
   * On connection: validate JWT from handshake auth header.
   * If invalid: disconnect immediately.
   * On success: join the socket to room `user:{userId}`.
   */
  handleConnection(client: Socket): void

  /**
   * Pushes a notification event to the user's room.
   * Called by NotificationsService after DB insert.
   * Emits event name: 'notification' with the notification payload.
   */
  pushToUser(userId: string, notification: Notification): void
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `createBulk()` must use a single `INSERT ... VALUES` statement — not a loop of individual inserts. One DB round-trip per batch of 200. |
| BR-2 | Each call to `createBulk()` must not exceed 200 records. The BullMQ batch processor enforces this limit. |
| BR-3 | WebSocket push happens after the DB insert, not before. If the push fails (user not connected), the DB record still exists and will be returned on the next `GET /notifications/me` call. Push failure must not cause the overall operation to fail. |
| BR-4 | `GET /notifications/me` is ordered by `id DESC` (newest first). This is the only list endpoint in the platform that orders descending. |
| BR-5 | `unreadCount` is always included in the `meta` of the list response, even when `unreadOnly = false`. It is a cheap count query filtered to `WHERE read_at IS NULL`. |
| BR-6 | `PATCH /notifications/:id/read` is idempotent. Marking an already-read notification as read returns `200` with the existing record — no error, no update. |
| BR-7 | Notifications are never deleted (soft or hard) via user action in V1. They accumulate indefinitely. Archival/pruning is a V2 concern. |
| BR-8 | The `payload` JSONB field must contain only the fields specified in the payload shapes above. No raw patient data (email, phone, membershipNumber) may appear in a notification payload. |

---

## 7. Dependencies on Other Modules

None. NotificationsModule is called by BullMQ processors which are part of QueuesModule. It does not call out to other modules. `NotificationsService` is injected into the queue processors.

---

## 8. Events Consumed

| Queue | Job name | Consumed by | Action |
|---|---|---|---|
| `notifications` | `batch_notify` | `batch-notify.processor.ts` | Calls `NotificationsService.createBulk()` |
| `notifications` | `consent_revoked` | `consent-revoked.processor.ts` | Calls `NotificationsService.createOne()` for each affected org |
| `admin` | `org_verified` | `org-verification.processor.ts` | Calls `NotificationsService.createOne()` for the org creator |
| `admin` | `program_approved` | `program-approved.processor.ts` | Calls `NotificationsService.createOne()` for the program creator |
| `admin` | `study_approved` | `study-approved.processor.ts` | Calls `NotificationsService.createOne()` for the researcher |

---

## 9. Open Questions or Ambiguities

> ⚠️ WebSocket auth uses the JWT from the handshake `auth` header. Define the exact socket.io handshake format: `{ auth: { token: '<accessToken>' } }`. Confirm the frontend client will send the token in this format.

> ⚠️ The `cors: { origin: '*' }` on the WebSocket gateway is a placeholder. Set the allowed origin to the actual frontend domain before deploying to any non-local environment.
