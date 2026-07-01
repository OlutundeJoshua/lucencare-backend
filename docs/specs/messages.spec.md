# Messages Module Specification

## 1. Module Overview

The Messages module owns the `Message` entity and handles enrollment-scoped messaging between organisations/researchers and patients. Messages are tied to either a program enrollment or a study enrollment via two nullable FK columns with a CHECK constraint. It does not own enrollments — it calls into EnrollmentsModule to verify that a sender and recipient are both participants in the enrollment thread before allowing a message.

---

## 2. Entities Involved

**Owns:**
- `messages`

**Reads (via injected services or direct query):**
- `enrollments` — validates thread membership for program enrollment threads
- `study_enrollments` — validates thread membership for study enrollment threads

---

## 3. DTOs

```typescript
// src/modules/messages/dto/send-message.dto.ts
export const SendMessageSchema = z.object({
  enrollmentId: z.string().length(26).optional(),
  studyEnrollmentId: z.string().length(26).optional(),
  body: z.string().min(1).max(5000),
}).refine(
  d => (d.enrollmentId !== undefined) !== (d.studyEnrollmentId !== undefined),
  { message: 'Exactly one of enrollmentId or studyEnrollmentId must be provided' }
);
export type SendMessageDto = z.infer<typeof SendMessageSchema>;
```

### Response Shapes

```typescript
interface MessageResponse {
  data: {
    id: string;
    senderId: string;
    recipientId: string;          // internal users.id — never raw email/phone
    enrollmentId?: string;
    studyEnrollmentId?: string;
    body: string;
    readAt?: string;
    createdAt: string;
  };
  traceId: string;
}

interface MessageListResponse {
  data: MessageResponse['data'][];
  meta: { cursor?: string; limit: number };
  traceId: string;
}
```

---

## 4. Endpoints

### `POST /messages`
- **Auth:** `ngo_admin`, `researcher`, or `patient` role
- **Request body:** `SendMessageDto`
- **Logic:**
  1. Validate exactly one of `enrollmentId` / `studyEnrollmentId` is present (custom @ValidatorConstraint)
  2. If `enrollmentId` is provided:
     - Load enrollment — throw `404` if not found
     - Verify caller is a participant: `enrollment.patient_id = req.user.sub` OR `enrollment.org_id = req.user.orgId` (via the program's orgId)
     - `recipientId` = the other participant's `userId`
  3. If `studyEnrollmentId` is provided:
     - Load study enrollment — throw `404` if not found
     - Verify caller is a participant: `study_enrollment.patient_id = req.user.sub` OR the study's `researcher_id = req.user.sub`
     - `recipientId` = the other participant's `userId`
  4. Insert message row; `senderId = req.user.sub`
  5. Enqueue `new_message` notification for the recipient
- **Success:** `201 MessageResponse`
- **Errors:**
  - `401`, `403` — caller is not a participant in the enrollment thread
  - `404` — enrollment or study enrollment not found
  - `422` — validation failure (class-validator) — both or neither FK provided, body too long

---

### `GET /messages/:enrollmentId`
- **Auth:** `ngo_admin`, `researcher`, or `patient` role
- **Path param:** `enrollmentId` — NOTE: despite the name, this is the thread identifier. For study threads, a query param distinguishes.
- **Query params:** `?type=enrollment|study_enrollment&cursor=<ULID>&limit=<number>`
- **Logic:**
  1. If `type = 'enrollment'` (default): load enrollment and verify caller is a participant
  2. If `type = 'study_enrollment'`: load study enrollment and verify caller is a participant
  3. Query `messages WHERE (enrollment_id = :enrollmentId OR study_enrollment_id = :enrollmentId) AND deleted_at IS NULL`
  4. Apply keyset pagination: `id > cursor ORDER BY id ASC`
- **Success:** `200 MessageListResponse`
- **Errors:**
  - `401`, `403` — caller not a participant
  - `404` — enrollment not found

---

## 5. Service Methods

```typescript
class MessagesService {

  /**
   * Sends a message in an enrollment thread.
   * Validates that exactly one of enrollmentId/studyEnrollmentId is provided.
   * Verifies caller is a participant in the thread.
   * Resolves recipientId (the other participant).
   * Inserts the message row.
   * Enqueues new_message notification for the recipient.
   * Returns the inserted message.
   */
  send(senderId: string, callerOrgId: string | undefined, dto: SendMessageDto): Promise<Message>

  /**
   * Returns paginated messages for an enrollment thread.
   * Verifies caller is a participant before returning any messages.
   * Orders by id ASC (chronological).
   * Throws ForbiddenException if caller is not a participant.
   * Throws NotFoundException if enrollment not found.
   */
  getThread(
    threadId: string,
    threadType: 'enrollment' | 'study_enrollment',
    callerId: string,
    callerOrgId: string | undefined,
    query: { cursor?: string; limit: number }
  ): Promise<{ messages: Message[]; nextCursor?: string }>

  /**
   * Resolves the two participants (sender user ID + recipient user ID)
   * for an enrollment thread. Used internally by send() and getThread().
   *
   * For enrollment threads:
   *   participant1 = enrollment.patient_id → users.id (patient's userId)
   *   participant2 = programs.org_id → org coordinator's users.id
   *
   * For study enrollment threads:
   *   participant1 = study_enrollment.patient_id → users.id
   *   participant2 = studies.researcher_id (already a users.id)
   */
  private resolveParticipants(
    enrollmentId: string | undefined,
    studyEnrollmentId: string | undefined
  ): Promise<{ patientUserId: string; orgUserId: string }>

  /**
   * Verifies the caller is one of the two participants.
   * Throws ForbiddenException if not.
   */
  private assertIsParticipant(
    callerId: string,
    callerOrgId: string | undefined,
    participants: { patientUserId: string; orgUserId: string }
  ): void
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | The DB CHECK constraint `CHECK (num_nonnulls(enrollment_id, study_enrollment_id) = 1)` enforces exactly one FK at the DB level. The custom @ValidatorConstraint in `SendMessageDto` enforces the same at the API layer. Both must be in place. |
| BR-2 | Only the two participants in an enrollment thread can send or read messages. Participants are: (1) the patient and (2) the org staff (for program enrollments) or the researcher (for study enrollments). Any other caller gets `403`. |
| BR-3 | `senderId` is always set from `req.user.sub` — never from the request body. |
| BR-4 | `recipientId` is always the internal `users.id` — never a raw email address or phone number. |
| BR-5 | A new message enqueues a `new_message` notification for the recipient. This is non-blocking — the message insert succeeds even if the notification enqueue fails. |
| BR-6 | Thread messages are ordered chronologically (`id ASC`) — oldest first. This is different from notifications (`id DESC`). |
| BR-7 | There is no delete or edit message functionality in V1. Messages are permanent records. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `EnrollmentsModule` | Direct repo query on `enrollments` and `study_enrollments` | To resolve participants and verify thread membership |
| `QueuesModule` | `Queue.add('new_message', { ... })` | After message insert |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `notifications` | `new_message` | `{ recipientUserId: string; senderId: string; enrollmentId?: string; studyEnrollmentId?: string; preview: string }` | `send()` |

---

## 9. Open Questions or Ambiguities

> ⚠️ `GET /messages/:enrollmentId` uses a path param named `enrollmentId` but works for both enrollment types via a query param. The path design is ambiguous — consider whether separate routes (`GET /threads/enrollment/:id` and `GET /threads/study-enrollment/:id`) would be cleaner. Confirm the API design before implementing the controller.

> ⚠️ Participant resolution for enrollment threads requires knowing the org coordinator's `userId`. The `organizations` table does not have a single `ownerId` field — an org may have multiple coordinators. Clarify: is ANY coordinator for the org a valid participant, or only the one who created the program? This affects how `orgUserId` is resolved in `resolveParticipants()`.
