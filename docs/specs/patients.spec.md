# Patients Module Specification

## 1. Module Overview

The Patients module owns the `Patient` and `CareEvent` entities. It handles patient self-profile management, HMO coordinator patient lookup, care event recording, and the patient summary endpoint (which validates a single-use export token before returning data). It does not own authentication, consent logic, or enrollment logic.

---

## 2. Entities Involved

**Owns:**
- `patients`
- `care_events`

**Reads (does not own):**
- `users` — to create patient user identity (HMO coordinator registration)
- `consent_grants` — HMO_CARE consent check in lookup and link-request flows
- `organizations` — fetch org name for link-request notification payload

---

## 3. DTOs

```typescript
// src/modules/patients/dto/patient.dto.ts

// Used by POST /patients (HMO coordinator manually registers a patient)
// Also used internally by PatientsService.createForUser() called within AuthService transaction
export class CreatePatientDto {
  name: string;                    // required, max 200
  email: string;                   // required — used to create the users row and send credentials
  phone: string;                   // required — plain text (not hashed)
  membershipNumber?: string;       // optional, max 100
  dateOfBirth?: string;            // ISO date YYYY-MM-DD
  gender?: Gender;
  address?: string;                // single address field (not split into state/lga)
  conditionTags: string[];         // default []
  medicationList?: MedicationItemDto[];
}

export class UpdatePatientDto {
  name?: string;
  phone?: string;
  conditionTags?: string[];
  dateOfBirth?: string;
  gender?: Gender;
  address?: string;
  medicationList?: MedicationItemDto[];
  directContactShared?: boolean;
}

export class LookupPatientDto {
  phone?: string;
  membershipNumber?: string;
  // At least one required — enforced in service (throws BadRequestException)
}

export class CreateCareEventDto {
  type: CareEventType;
  eventDate: string;               // ISO date YYYY-MM-DD — stored as Postgres date (day precision)
  providerName?: string;           // max 200 chars, plain text
  structured: Record<string, unknown>;  // type-specific data; not validated per type in V1
  notes?: string;                  // max 2000 chars
}

export class CareEventQueryDto extends PaginationDto {
  type?: CareEventType;            // optional filter
}

export class RespondToLinkRequestDto {
  action: 'approve' | 'reject';
}

export class ListLinkRequestsQueryDto {
  status?: HmoLinkRequestStatus;
}
```

### Response Shapes

```typescript
interface PatientResponse {
  data: {
    id: string;                  // patients.id (ULID)
    name: string;
    phone: string;               // returned to patient (own profile) and hmo_coordinator
    conditionTags: string[];
    dateOfBirth?: string;        // YYYY-MM-DD
    gender?: string;
    address?: string;
    membershipNumber?: string;   // included only when caller is hmo_coordinator
    hmoId?: string;
    directContactShared: boolean;
    createdAt: string;           // ISO 8601
  };
  traceId: string;
}

interface HmoLinkRequestResponse {
  id: string;
  orgId: string;
  status: HmoLinkRequestStatus;  // 'pending' | 'approved' | 'rejected'
  expiresAt: string;             // ISO 8601
  createdAt: string;
}

interface CareEventResponse {
  data: {
    id: string;
    patientId: string;
    type: CareEventType;
    eventDate: string;           // YYYY-MM-DD
    providerName?: string;
    structured: Record<string, unknown>;
    notes?: string;
    createdAt: string;
    createdBy?: string;
  };
  traceId: string;
}

interface CareEventListResponse {
  data: CareEventResponse['data'][];
  meta: {
    cursor?: string;
    limit: number;
  };
  traceId: string;
}

// Returned by GET /patients/:id/summary
interface PatientSummaryData {
  patient: Patient;
  careEvents: CareEvent[];
}
```

---

## 4. Endpoints

### `GET /patients/me`
- **Auth:** `patient` role
- **Logic:** Return the `patients` row where `user_id = req.user.sub`
- **Success:** `200 PatientResponse`
- **Errors:** `401`, `404` (should not happen after registration, but guarded)

---

### `PATCH /patients/me`
- **Auth:** `patient` role
- **Request body:** `UpdatePatientDto`
- **Logic:** Partial update — only fields present in body are written
- **Success:** `200 PatientResponse` (updated record)
- **Errors:** `401`, `404`, `422`

---

### `GET /patients/lookup`
- **Auth:** `hmo_coordinator` role
- **Query params:** `?phone=<string>` OR `?membershipNumber=<string>`
- **Logic:**
  1. Throw `400` if neither param provided
  2. Find `patients` row by phone OR membershipNumber (global — no hmo_id filter)
  3. Verify active `HMO_CARE` consent grant in SQL (NOT in JS) — throw `404` if none (do not reveal the patient exists without consent)
  4. Return the patient
- **Success:** `200 PatientResponse`
- **Errors:** `400`, `401`, `403`, `404`

---

### `POST /patients`
- **Auth:** `hmo_coordinator` role
- **Request body:** `CreatePatientDto`
- **Logic:**
  1. For HMO coordinators to register a patient who is not yet in the system
  2. Conflict-check `phone` and `membershipNumber` before transaction
  3. In a single transaction: create `users` row (role: patient, status: active, bcrypt-hashed temp password) + `patients` row (hmoId = req.user.orgId)
  4. Enqueue `send_patient_credentials` job: `{ to: dto.email, tempPassword }`
- **Success:** `201 PatientResponse`
- **Errors:** `401`, `403`, `409` (duplicate phone or membership), `422`

---

### `POST /patients/:id/link-request`
- **Auth:** `hmo_coordinator` role
- **Path param:** `id` — ULID of the patients row
- **Logic:**
  1. Find patient by `id` — throw `404` if not found
  2. Verify active `HMO_CARE` consent grant via SQL EXISTS check — throw `403` if none
  3. Verify `patient.hmoId IS NULL` — throw `409` if already linked to any HMO
  4. Verify no PENDING `hmo_link_requests` row for this patient-org pair — throw `409` if one exists
  5. INSERT `hmo_link_requests` (status: PENDING, expiresAt: now + 7 days)
  6. Call `NotificationsService.createOne()` for the patient: type `HMO_LINK_REQUEST`, payload `{ orgId, orgName, linkRequestId }`
- **Success:** `201 HmoLinkRequestResponse`
- **Errors:** `401`, `403`, `404`, `409`

---

### `GET /patients/me/link-requests`
- **Auth:** `patient` role
- **Query params:** `?status=pending|approved|rejected` (optional filter)
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` via patients table
  2. Query `hmo_link_requests` where `patient_id = patientId`
  3. Exclude expired pending rows (`expires_at < NOW()`) unless status filter is `approved` or `rejected` (LR-7)
- **Success:** `200 { data: HmoLinkRequestResponse[] }`
- **Errors:** `401`, `403`

---

### `PATCH /patients/me/link-requests/:requestId`
- **Auth:** `patient` role
- **Request body:** `RespondToLinkRequestDto` — `{ action: 'approve' | 'reject' }`
- **Logic:**
  1. Find request by `id` AND `patient_id = resolvedPatientId` — throw `404` if not found
  2. Verify `status = PENDING` — throw `409` if already actioned
  3. Verify `expires_at > NOW()` — throw `410 Gone` if expired
  4. **If approve:**
     - Inside a single transaction: re-fetch patient to verify `hmoId IS NULL` (race condition safety) — throw `409` if already linked
     - `UPDATE patients SET hmo_id = orgId` + `UPDATE hmo_link_requests SET status = APPROVED`
  5. **If reject:** `UPDATE hmo_link_requests SET status = REJECTED`
- **Success:** `200 HmoLinkRequestResponse`
- **Errors:** `400`, `401`, `403`, `404`, `409`, `410`

---

### `GET /patients/:id`
- **Auth:** `hmo_coordinator` role
- **Logic:** `SELECT * FROM patients WHERE id = :id AND hmo_id = req.user.orgId`
- **Success:** `200 PatientResponse` (includes `membershipNumber`)
- **Errors:** `401`, `403`, `404`

---

### `GET /patients/:id/events`
- **Auth:** `hmo_coordinator` role
- **Query params:** `?cursor=<ULID>&limit=<number>&type=<CareEventType>`
- **Logic:**
  1. Scope check: `patients.hmo_id = req.user.orgId`
  2. Keyset pagination: `id > cursor ORDER BY id ASC LIMIT limit+1`
  3. Optional type filter
- **Success:** `200 CareEventListResponse`
- **Errors:** `401`, `403`, `404`, `422`

---

### `POST /patients/:id/events`
- **Auth:** `hmo_coordinator` role
- **Request body:** `CreateCareEventDto`
- **Logic:**
  1. Scope check: `patients.hmo_id = req.user.orgId`
  2. Insert `care_events` row; `patientId = :id`
- **Success:** `201 CareEventResponse`
- **Errors:** `401`, `403`, `404`, `422`

---

### `GET /patients/:id/summary`
- **Auth:** `hmo_coordinator` role — export JWT in `Authorization: Bearer` header
- **Export token design:**
  The export token is a single-use JWT obtained from `POST /export/tokens`. It replaces the session JWT as the bearer credential for this endpoint (both are JWTs signed with the same RS256 key). The export token payload contains `{ sub, role, orgId, patientId, purpose: 'pdf_export', jti }` — so JwtAuthGuard validates it normally and RoleGuard passes. The controller additionally calls `ExportService.validateAndConsumeToken()` to consume the Redis jti (single-use enforcement). The "two tokens" in the architecture refers to the two-step flow: (1) coordinator uses session JWT to create the export token, (2) coordinator uses the export token to access the summary. There is one token in the request.
- **Logic:**
  1. Extract raw bearer token from `Authorization` header
  2. Call `ExportService.validateAndConsumeToken(token)` — throws `UnauthorizedException` if invalid/expired/used
  3. Verify token's `patientId` claim matches `:id` — throw `401` if mismatch
  4. Scope check: `patients.hmo_id = req.user.orgId`
  5. Fetch care events
  6. Write audit log: `EXPORT`, resourceId = patientId — **must be written before returning (BR-8, E-03)**
- **Success:** `200 PatientSummaryData`
- **Errors:** `401`, `403`, `404`

---

## 5. Service Methods

```typescript
class PatientsService {
  createForUser(userId: string, dto: CreatePatientDto, manager: EntityManager): Promise<Patient>
  getMyProfile(userId: string): Promise<Patient>
  updateMyProfile(userId: string, dto: UpdatePatientDto): Promise<Patient>
  lookupPatient(dto: LookupPatientDto, orgId: string): Promise<Patient>
  createPatient(dto: CreatePatientDto, orgId: string): Promise<Patient>
  createLinkRequest(patientId: string, orgId: string): Promise<HmoLinkRequest>
  getMyLinkRequests(patientUserId: string, status?: HmoLinkRequestStatus): Promise<HmoLinkRequest[]>
  respondToLinkRequest(requestId: string, patientUserId: string, action: 'approve' | 'reject'): Promise<HmoLinkRequest>
  getPatientById(id: string, orgId: string): Promise<Patient>
  getCareEvents(patientId: string, orgId: string, query: CareEventQueryDto): Promise<{ events: CareEvent[]; nextCursor?: string }>
  createCareEvent(patientId: string, orgId: string, dto: CreateCareEventDto): Promise<CareEvent>
  getPatientSummary(patientId: string, orgId: string, exportToken: string): Promise<PatientSummaryData>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `hmoId` is NEVER set from the request body. For `POST /patients` (HMO creates patient), it is set from `req.user.orgId`. For the link-request flow, it is set only when the **patient** approves — never by the coordinator directly. |
| BR-2 | HMO coordinators can access a patient via lookup only if that patient has an active `HMO_CARE` consent grant. All other patient endpoints require `patients.hmo_id = req.user.orgId`. |
| BR-3 | `membershipNumber` is included in responses only when the caller is an `hmo_coordinator`. |
| BR-4 | The summary endpoint uses the export JWT as the bearer credential. The export JWT is created with `role` and `orgId` embedded so it functions as both auth and export credentials for this single endpoint. |
| BR-5 | Care events are never soft-deleted in V1. Queries always filter `deleted_at IS NULL`. |
| BR-6 | `eventDate` is stored as a Postgres `date` (day precision, not timestamptz). |
| BR-7 | `providerName` is plain text. No FK validation. Max 200 chars. |
| BR-8 | The audit log entry for EXPORT must be written even if downstream PDF steps fail. The access was made — that must be recorded. Audit is written before the response is returned. |

### Link Request Rules

| # | Rule |
|---|---|
| LR-1 | A coordinator cannot send a link request if `patient.hmoId` is already set (any HMO). |
| LR-2 | Only one PENDING request per patient-org pair. A new request may be sent after the previous was rejected or expired. |
| LR-3 | Link requests expire after 7 days (`expiresAt = now + 7d`). Enforced at query time — no background cleanup job in V1. |
| LR-4 | On approve, `patient.hmoId` must still be NULL inside the transaction (race condition safety). |
| LR-5 | Only the patient who owns the request can approve or reject. |
| LR-6 | The approve action is atomic: `patients.hmo_id` and `hmo_link_requests.status` update in the same DB transaction. |
| LR-7 | A patient may see approved/rejected requests regardless of `expiresAt`. Only pending requests are hidden once expired. |

---

## 7. Dependencies on Other Modules

| Module | Usage | When |
|---|---|---|
| `ExportModule` | `ExportService.validateAndConsumeToken(token)` | In `GET /patients/:id/summary` before returning data |
| `AuditModule` | `AuditService.log({ action: EXPORT, ... })` | After serving summary data (before return) |
| `NotificationsModule` | `NotificationsService.createOne()` | In `createLinkRequest` after inserting the request |

---

## 8. Events Emitted or Consumed

None. The Patients module does not emit or consume queue events directly (it enqueues `send_patient_credentials` mail job but does not own or consume queue processors).

---

## 9. Known Issues / Follow-up Decisions

> **DECIDED — POST /patients claim flow:** When an HMO coordinator creates a patient via `POST /patients`, the `send_patient_credentials` job emails the patient their temporary credentials. The patient claims their account using the **existing password-reset flow**: call `POST /auth/forgot-password` with their email to receive a reset link, then `POST /auth/reset-password` to set a permanent password. No new endpoints are needed in V1 — the existing auth reset flow serves as the claim mechanism.

> ⚠️ `CreateCareEventDto.structured` accepts `Record<string, unknown>`. Service-layer structural validation per `CareEventType` is deferred to V2.

> ⚠️ `PatientsService.createForUser()` is defined for future use by `AuthService`. Currently `AuthService.registerPatient()` builds the patient row inline. When `ConsentsService.hasActiveGrant()` is implemented, the direct `Repository<ConsentGrant>` injection in `PatientsService` can be replaced with a call to `ConsentsService`.
