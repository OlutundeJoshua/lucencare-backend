# Consents Module Specification

## 1. Module Overview

The Consents module owns the `ConsentGrant` entity and the consent state machine. It handles patient grant creation, status transitions, revocation with cascade (tombstoning linked enrollments), impact preview, and exposes a `hasActiveGrant()` utility for other modules to check consent before performing data-sharing operations.

---

## 2. Entities Involved

**Owns:**
- `consent_grants`

**Reads/writes (via injected services, not ownership):**
- `enrollments` — tombstoned on revocation (via `EnrollmentsService`)
- `study_enrollments` — tombstoned on revocation (via `EnrollmentsService`)
- `audit_log` — written on every revocation (via `AuditService`)

---

## 3. DTOs

```typescript
// src/modules/consents/dto/create-consent-grant.dto.ts
export const CreateConsentGrantSchema = z.object({
  purpose: z.nativeEnum(ConsentPurpose),
  dataScopes: z.array(z.string().min(1)).min(1),
  // dataScopes must be a subset of the canonical fields for the given purpose (validated at service layer)
});
export type CreateConsentGrantDto = z.infer<typeof CreateConsentGrantSchema>;
```

```typescript
// src/modules/consents/dto/update-consent.dto.ts
export const UpdateConsentSchema = z.object({
  status: z.nativeEnum(ConsentStatus),
  // Only PAUSED, ACTIVE (re-activate from PAUSED), and REVOKED are valid targets via this endpoint.
  // NOT_GRANTED and PENDING are not valid transition targets via API.
});
export type UpdateConsentDto = z.infer<typeof UpdateConsentSchema>;
```

### Response Shapes

```typescript
interface ConsentGrantResponse {
  data: {
    id: string;
    patientId: string;
    purpose: ConsentPurpose;
    dataScopes: string[];
    status: ConsentStatus;
    grantedAt: string;           // ISO 8601
    revokedAt?: string;          // ISO 8601, present only if status = REVOKED
    version: number;
    createdAt: string;
  };
  traceId: string;
}

interface ConsentListResponse {
  data: ConsentGrantResponse['data'][];
  traceId: string;
}

interface ConsentImpactResponse {
  data: {
    affectedEnrollments: Array<{
      id: string;
      programId: string;
      programTitle: string;
      status: EnrollmentStatus;
    }>;
    affectedStudyEnrollments: Array<{
      id: string;
      studyId: string;
      studyTitle: string;
      status: StudyEnrollmentStatus;
    }>;
    totalAffected: number;
  };
  traceId: string;
}
```

---

## 4. Endpoints

### `GET /consents/me`
- **Auth:** `patient` role
- **Query params:** None
- **Logic:** Return all `consent_grants` rows where `patient_id = req.user.patientId`, ordered by `created_at DESC`. Include all statuses (including revoked — historical record).
- **Success:** `200 ConsentListResponse`
- **Errors:**
  - `401` — missing/invalid JWT
  - `403` — caller is not a patient

---

### `POST /consents`
- **Auth:** `patient` role
- **Request body:** `CreateConsentGrantDto`
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` → `patients.id`
  2. Check for existing non-revoked grant for this purpose — throws `ConflictException` if found
  3. Insert `consent_grants` row with `status: 'active'`, `grantedAt: NOW()`
- **Success:** `201 ConsentGrantResponse`
- **Errors:**
  - `401`, `403`
  - `409` — non-revoked consent grant already exists for this purpose
  - `422` — validation failure (class-validator)

---

### `PATCH /consents/:id`
- **Auth:** `patient` role
- **Path param:** `id` — ULID of the consent_grants row
- **Request body:** `UpdateConsentDto`
- **Logic:**
  1. Load consent grant — throws `NotFoundException` if not found
  2. Verify `consent_grants.patient_id = req.user.patientId` — throws `ForbiddenException` if mismatch
  3. Validate state machine transition (see business rules)
  4. If transitioning to `REVOKED`: call `revokeAndCascade()` (atomic transaction)
  5. Otherwise: update status field
- **Success:** `200 ConsentGrantResponse`
- **Errors:**
  - `401`, `403`, `404`
  - `409` — invalid state machine transition (e.g. trying to re-activate a REVOKED grant)
  - `422` — validation failure (class-validator)

---

### `GET /consents/:id/impact`
- **Auth:** `patient` role
- **Path param:** `id` — ULID of the consent_grants row
- **Logic:**
  1. Verify ownership (`patient_id = req.user.patientId`)
  2. Query `enrollments` where `consent_grant_id = :id AND status = 'active'`
  3. Query `study_enrollments` where `consent_grant_id = :id AND status NOT IN ('withdrawn')`
  4. Return lists with program/study titles (requires joins to programs and studies tables)
- **Success:** `200 ConsentImpactResponse`
- **Errors:**
  - `401`, `403`, `404`

---

## 5. Service Methods

```typescript
class ConsentsService {

  /**
   * Called by AuthService inside the patient registration transaction.
   * Creates a consent_grant with status 'active' for the given purpose.
   * dataScopes are set to the canonical fields for the purpose from snapshot-fields.ts.
   */
  createInitial(
    patientId: string,
    purpose: ConsentPurpose,
    manager: EntityManager
  ): Promise<ConsentGrant>

  /**
   * Patient creates a new consent grant for an additional purpose.
   * Throws ConflictException if a non-revoked grant already exists for this purpose.
   */
  create(patientId: string, dto: CreateConsentGrantDto): Promise<ConsentGrant>

  /**
   * Returns all consent grants for the patient, ordered by created_at DESC.
   * Includes all statuses (revoked included).
   */
  getMyConsents(patientId: string): Promise<ConsentGrant[]>

  /**
   * Validates and executes a state machine transition.
   * Valid transitions:
   *   PENDING    → ACTIVE
   *   ACTIVE     → PAUSED
   *   ACTIVE     → REVOKED  (delegates to revokeAndCascade)
   *   PAUSED     → ACTIVE
   *   PAUSED     → REVOKED  (delegates to revokeAndCascade)
   * Invalid transitions throw ConflictException with message explaining the violation.
   * Uses optimistic locking (@VersionColumn) — throws ConflictException on version mismatch.
   */
  transition(consentGrantId: string, patientId: string, dto: UpdateConsentDto): Promise<ConsentGrant>

  /**
   * Atomic revocation with cascade. Runs inside a single transaction:
   *   1. SET LOCAL app.user_id = patientId
   *   2. Update consent_grants.status = 'REVOKED', revokedAt = NOW()
   *   3. Call EnrollmentsService.revokeByConsentGrant(consentGrantId, manager)
   *      → tombstones all active enrollments linked to this grant
   *   4. Call AuditService.log({ action: REVOKE_CONSENT, resourceId: consentGrantId, ... }, manager)
   *   5. Enqueue consent_revoked job: { consentGrantId, patientId, affectedEnrollmentIds }
   * Throws ConflictException if consent is already REVOKED.
   */
  revokeAndCascade(consentGrantId: string, patientId: string): Promise<ConsentGrant>

  /**
   * Returns the impact of revoking a consent grant (without actually revoking).
   * Used by GET /consents/:id/impact.
   */
  getImpact(consentGrantId: string, patientId: string): Promise<ConsentImpact>

  /**
   * Utility method — used by EnrollmentsModule before creating an enrollment.
   * Returns true if an ACTIVE consent grant exists for the given patient + purpose.
   * Returns false otherwise.
   * Does NOT throw — callers are responsible for acting on the boolean.
   */
  hasActiveGrant(patientId: string, purpose: ConsentPurpose): Promise<boolean>

  /**
   * Returns the active consent grant for the given patient + purpose.
   * Used by EnrollmentsModule to link enrollment to consent grant.
   * Throws NotFoundException if no active grant exists.
   */
  getActiveGrant(patientId: string, purpose: ConsentPurpose): Promise<ConsentGrant>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | State machine transitions are strictly enforced. Legal transitions: `PENDING→ACTIVE`, `ACTIVE→PAUSED`, `ACTIVE→REVOKED`, `PAUSED→ACTIVE`, `PAUSED→REVOKED`. All others throw `409 ConflictException`. |
| BR-2 | `REVOKED` is a terminal state. No transition out of `REVOKED` is permitted. A patient who wants to re-consent must create a new grant via `POST /consents`. |
| BR-3 | Revocation is atomic. The DB transaction must encompass consent status update + enrollment tombstoning + audit log. If any step fails, the entire transaction rolls back. |
| BR-4 | Optimistic locking is used on `consent_grants` via `@VersionColumn`. If the version sent by the client does not match the DB, a `409` is returned. The client must re-fetch and retry. |
| BR-5 | There can be at most one non-revoked consent grant per `(patient_id, purpose)` pair. The partial UNIQUE INDEX `WHERE status != 'revoked'` enforces this at the DB level. |
| BR-6 | Multiple historical revoked grants for the same `(patient_id, purpose)` are allowed. The partial index does not block them. |
| BR-7 | `dataScopes` submitted by the patient are validated against the canonical field list for the purpose (from `src/common/constants/snapshot-fields.ts`). Any scope not in the canonical list is rejected with `422`. |
| BR-8 | The impact preview (`GET /consents/:id/impact`) is read-only. It must not modify any state. |
| BR-9 | `consent_grants.patient_id` must always equal `req.user.patientId`. A patient cannot read or modify another patient's consents. |
| BR-10 | `createInitial()` (called during registration) uses the full canonical scope for the purpose — it does not accept a custom `dataScopes` array. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `EnrollmentsModule` | `EnrollmentsService.revokeByConsentGrant(consentGrantId, manager)` | Inside `revokeAndCascade()` transaction |
| `AuditModule` | `AuditService.log({ action: REVOKE_CONSENT, ... })` | Inside `revokeAndCascade()` transaction |
| `QueuesModule` | `Queue.add('consent_revoked', { ... })` | After successful revocation transaction |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `notifications` | `consent_revoked` | `{ consentGrantId: string; patientId: string; purpose: ConsentPurpose; affectedEnrollmentIds: string[]; affectedOrgIds: string[] }` | `revokeAndCascade()` |

The `consent_revoked` processor notifies affected organisations that their access to this patient's data has ended.

---

## 9. Open Questions or Ambiguities

> ⚠️ The `PENDING` state is defined in the enum but no endpoint transitions a grant INTO `PENDING`. The only way a grant is created is with `status: 'active'` (directly). Clarify if `PENDING` is used — if not, it may be removed from the state machine or reserved for a future email-confirmation flow.

> ⚠️ `getImpact()` requires joining to `programs` and `studies` to return titles. This creates a read dependency on those tables. Confirm whether OrganizationsModule/ProgramsModule should be injected into ConsentsModule or if a raw query against those tables is acceptable here.
