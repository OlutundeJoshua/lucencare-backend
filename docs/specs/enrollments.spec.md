# Enrollments Module Specification

## 1. Module Overview

The Enrollments module owns the `Enrollment` and `StudyEnrollment` entities. It handles patient self-enrollment into approved programs, patient interest in studies, snapshot construction at enrollment time, and enrollment revocation cascade (called by ConsentsModule). It is also responsible for advancing `StudyEnrollment` status when researchers invite participants (called by StudiesModule).

---

## 2. Entities Involved

**Owns:**
- `enrollments`
- `study_enrollments`

**Reads (via injected services):**
- `consent_grants` — verifies active consent before enrollment (via ConsentsService)
- `patients` — reads consented fields to build `sharedDataSnapshot`
- `programs` — verifies program is approved and not expired before enrollment
- `studies` — verifies study is approved before enrollment

---

## 3. DTOs

```typescript
// src/modules/enrollments/dto/create-enrollment.dto.ts
export const CreateEnrollmentSchema = z.object({
  programId: z.string().length(26),   // ULID
  // patientId: NEVER from body — always from req.user.sub → patients.id
});
export type CreateEnrollmentDto = z.infer<typeof CreateEnrollmentSchema>;
```

```typescript
// src/modules/enrollments/dto/create-study-enrollment.dto.ts
export const CreateStudyEnrollmentSchema = z.object({
  studyId: z.string().length(26),     // ULID
  shareDirectContact: z.boolean().default(false),
  // patientId: NEVER from body — always from req.user.sub → patients.id
});
export type CreateStudyEnrollmentDto = z.infer<typeof CreateStudyEnrollmentSchema>;
```

### Response Shapes

```typescript
interface EnrollmentResponse {
  data: {
    id: string;
    patientId: string;
    programId: string;
    consentGrantId: string;
    status: EnrollmentStatus;
    sharedDataSnapshot: Record<string, unknown>;   // consented fields only
    createdAt: string;
  };
  traceId: string;
}

interface StudyEnrollmentResponse {
  data: {
    id: string;
    patientId: string;
    studyId: string;
    consentGrantId: string;
    status: StudyEnrollmentStatus;
    sharedDataSnapshot: Record<string, unknown>;   // consented fields only
    directContactShared: boolean;
    createdAt: string;
  };
  traceId: string;
}
```

---

## 4. Endpoints

### `POST /enrollments`
- **Auth:** `patient` role
- **Request body:** `CreateEnrollmentDto`
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` → `patients.id`
  2. Load program — throw `NotFoundException` if not found
  3. Verify program `status = 'approved'` — throw `409` if not
  4. Verify program `expiresAt > NOW()` — throw `409` if expired
  5. Verify no existing active enrollment for this `(patientId, programId)` pair — throw `409` if found
  6. Verify active consent grant for `ngo_funding` purpose via `ConsentsService.hasActiveGrant(patientId, 'ngo_funding')` — throw `403` if missing
  7. Get active consent grant: `ConsentsService.getActiveGrant(patientId, 'ngo_funding')`
  8. Build `sharedDataSnapshot` using `buildSnapshot(patient, consentGrant.dataScopes)`
  9. Insert `enrollments` row in a transaction with `SET LOCAL app.user_id = patientId`
- **Success:** `201 EnrollmentResponse`
- **Errors:**
  - `401`, `403` — no active consent for ngo_funding
  - `404` — program not found
  - `409` — program not approved, program expired, or duplicate active enrollment
  - `422` — validation failure (class-validator)

---

### `GET /enrollments/:id`
- **Auth:** `patient` role
- **Path param:** `id` — ULID of the enrollments row
- **Logic:**
  1. Load enrollment — throw `NotFoundException` if not found
  2. Verify `enrollments.patient_id = req.user.patientId` — throw `403` if mismatch
- **Success:** `200 EnrollmentResponse`
- **Errors:**
  - `401`, `403`, `404`

---

### `POST /study-enrollments`
- **Auth:** `patient` role
- **Request body:** `CreateStudyEnrollmentDto`
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` → `patients.id`
  2. Load study — throw `NotFoundException` if not found
  3. Verify study `status = 'approved'` — throw `409` if not
  4. Verify no existing enrollment for this `(patientId, studyId)` pair — throw `409` if found (unique constraint, any status)
  5. Verify active consent grant for `clinical_research_recruitment` via `ConsentsService.hasActiveGrant()`
  6. Get active consent grant
  7. Build `sharedDataSnapshot` using `buildSnapshot(patient, consentGrant.dataScopes)`
  8. Insert `study_enrollments` row with `status: 'interested'`, `directContactShared = dto.shareDirectContact`
- **Success:** `201 StudyEnrollmentResponse`
- **Errors:**
  - `401`, `403` — no active consent for clinical_research_recruitment
  - `404` — study not found
  - `409` — study not approved or duplicate enrollment
  - `422` — validation failure (class-validator)

---

## 5. Service Methods

```typescript
class EnrollmentsService {

  /**
   * Creates an enrollment for a patient in an approved program.
   * Full validation and snapshot construction as described in endpoint logic.
   * Runs inside a transaction with SET LOCAL app.user_id = patientId.
   */
  createEnrollment(patientId: string, dto: CreateEnrollmentDto): Promise<Enrollment>

  /**
   * Returns a single enrollment by ID.
   * Verifies patient_id = patientId.
   * Throws NotFoundException or ForbiddenException as appropriate.
   */
  getEnrollment(id: string, patientId: string): Promise<Enrollment>

  /**
   * Creates a study enrollment (interest expression).
   * Full validation and snapshot construction.
   * Sets directContactShared from dto.shareDirectContact.
   */
  createStudyEnrollment(patientId: string, dto: CreateStudyEnrollmentDto): Promise<StudyEnrollment>

  /**
   * Called by ConsentsModule.revokeAndCascade() inside a transaction.
   * Tombstones all active enrollments linked to the given consentGrantId.
   * Sets status = 'revoked_by_patient' on all affected enrollments.
   * Sets status = 'withdrawn' on all affected study_enrollments.
   * Returns the IDs of all affected enrollment rows (for the revocation audit log).
   * MUST run inside the provided EntityManager transaction.
   */
  revokeByConsentGrant(
    consentGrantId: string,
    manager: EntityManager
  ): Promise<{ enrollmentIds: string[]; studyEnrollmentIds: string[] }>

  /**
   * Called by StudiesModule.inviteParticipant().
   * Advances study_enrollments.status.
   * Valid transitions: INTERESTED→SCREENED, SCREENED→ENROLLED.
   * Throws ConflictException for invalid transitions.
   * Throws NotFoundException if enrollment not found.
   */
  advanceStudyEnrollment(id: string, newStatus: StudyEnrollmentStatus): Promise<StudyEnrollment>

  /**
   * Builds the sharedDataSnapshot object from the patient's data.
   * Uses the canonical field mapping from src/common/constants/snapshot-fields.ts.
   * Only includes fields present in the consent grant's dataScopes.
   * This is the ONLY place snapshot construction happens — never inline in controllers.
   *
   * Canonical mapping:
   *   ngo_funding                    → ['name', 'conditionTags', 'locationState', 'locationLga', 'directContactShared']
   *   hmo_care                       → ['name', 'conditionTags', 'locationState', 'locationLga', 'membershipNumber', 'medicationList']
   *   clinical_research_recruitment  → ['name', 'conditionTags', 'locationState', 'locationLga', 'directContactShared', 'medicationList']
   */
  private buildSnapshot(patient: Patient, dataScopes: string[]): Record<string, unknown>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `patientId` is NEVER taken from the request body. It is always resolved from `req.user.sub` via the authenticated JWT. |
| BR-2 | Enrollment requires an ACTIVE consent grant for the appropriate purpose. Missing consent → `403`. The check must live inside the SQL transaction, not as a pre-flight HTTP call. |
| BR-3 | The UNIQUE INDEX on `(patient_id, program_id) WHERE status = 'active'` prevents duplicate active enrollments. At the application layer, check for existence and throw `409` before inserting. |
| BR-4 | The UNIQUE INDEX on `(patient_id, study_id)` prevents any duplicate study enrollment regardless of status. A patient who withdrew cannot re-enroll in V1. |
| BR-5 | `sharedDataSnapshot` is constructed at enrollment time and never updated afterwards. Even if the patient updates their profile, the snapshot remains as-is. This is by design — orgs see data as it was at consent time. |
| BR-6 | `buildSnapshot()` is the single authoritative implementation of snapshot construction. It must use the canonical field mapping from `src/common/constants/snapshot-fields.ts`. No other code path may construct a snapshot. |
| BR-7 | `directContactShared` defaults to `false` even if the patient does not explicitly pass it. It requires an explicit `true` value in the request body. |
| BR-8 | `revokeByConsentGrant()` must run inside the transaction provided by ConsentsModule. It must not open its own transaction or commit independently. |
| BR-9 | Program must be `approved` AND `expiresAt > NOW()` for enrollment. Both conditions are checked at the application layer. |
| BR-10 | RLS: insert into `enrollments` runs with `SET LOCAL app.user_id = patientId`. The RLS policy on `enrollments` must allow `patient_id = current_setting('app.user_id')`. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `ConsentsModule` | `ConsentsService.hasActiveGrant(patientId, purpose)` | Before creating any enrollment |
| `ConsentsModule` | `ConsentsService.getActiveGrant(patientId, purpose)` | To get consentGrantId for the enrollment row |
| `PatientsModule` | `PatientsService.getPatientById(patientId)` (internal) | To build sharedDataSnapshot from patient fields |

---

## 8. Events Emitted or Consumed

**Consumed:**
- `consent_revoked` job (via QueuesModule processor) triggers `revokeByConsentGrant()` — see queues.spec.md

No events emitted directly from EnrollmentsModule.

---

## 9. Open Questions or Ambiguities

> ⚠️ The UNIQUE constraint on `(patient_id, study_id)` in `study_enrollments` means a withdrawn patient can never re-enroll in the same study. Confirm this is the intended behaviour. If re-enrollment after withdrawal should be allowed, the constraint design needs to change.

> ⚠️ There is no `GET /study-enrollments/:id` endpoint for a patient to view their own study enrollment. If patients need to track their study interest/enrollment status, this endpoint is missing.

> ⚠️ `buildSnapshot()` reads from the `patients` table at enrollment time. If `PatientsService.getPatientById()` is called within a transaction (e.g., during `revokeByConsentGrant`), the entity manager must be passed through to avoid a second connection outside the transaction.
