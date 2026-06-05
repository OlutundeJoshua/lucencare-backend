# Studies Module Specification

## 1. Module Overview

The Studies module owns the `Study` entity and handles the clinical researcher flow: study submission with IRB validation, listing a researcher's own studies, viewing study enrollments, and inviting interested patients to advance through the enrollment status machine. It does not own `StudyEnrollment` — that belongs to EnrollmentsModule — but it calls into EnrollmentsModule to advance enrollment status.

---

## 2. Entities Involved

**Owns:**
- `studies`

**Reads/writes (via injected services):**
- `study_enrollments` — reads for the enrollments list; `invite` action calls EnrollmentsService to advance status

---

## 3. DTOs

```typescript
// src/modules/studies/dto/create-study.dto.ts
export const CreateStudySchema = z.object({
  title: z.string().min(1).max(300),
  irbNumber: z.string().regex(/^IRB-\d{4}-\d{4}$/),   // e.g. IRB-2024-0042
  eligibilityCriteria: z.array(z.object({
    field: z.string().min(1),
    operator: z.enum(['eq', 'in', 'gte', 'lte', 'contains']),
    value: z.unknown(),
  })).min(1),
  infoSheetUrl: z.string().url(),                       // S3 URL — uploaded before submission
  targetCount: z.number().int().positive(),
  compensationDetails: z.string().max(500).optional(),
});
export type CreateStudyDto = z.infer<typeof CreateStudySchema>;
```

```typescript
// src/modules/studies/dto/invite-participant.dto.ts
export const InviteParticipantSchema = z.object({
  studyEnrollmentId: z.string().length(26),   // ULID of the study_enrollments row to advance
});
export type InviteParticipantDto = z.infer<typeof InviteParticipantSchema>;
```

### Response Shapes

```typescript
interface StudyResponse {
  data: {
    id: string;
    researcherId: string;
    title: string;
    irbNumber: string;
    status: StudyStatus;
    eligibilityCriteria: Array<{ field: string; operator: string; value: unknown }>;
    infoSheetUrl: string;
    targetCount: number;
    compensationDetails?: string;
    createdAt: string;
  };
  traceId: string;
}

interface StudyListResponse {
  data: StudyResponse['data'][];
  meta: { cursor?: string; limit: number };
  traceId: string;
}

interface StudyEnrollmentListResponse {
  data: Array<{
    id: string;
    studyId: string;
    status: StudyEnrollmentStatus;
    sharedDataSnapshot: Record<string, unknown>;  // consented fields only — no patient ID unless directContactShared = true
    directContactShared: boolean;
    createdAt: string;
  }>;
  meta: { cursor?: string; limit: number };
  traceId: string;
}

interface StudyEnrollmentResponse {
  data: {
    id: string;
    studyId: string;
    status: StudyEnrollmentStatus;
    sharedDataSnapshot: Record<string, unknown>;
    directContactShared: boolean;
    createdAt: string;
  };
  traceId: string;
}
```

---

## 4. Endpoints

### `POST /studies`
- **Auth:** `researcher` role
- **Request body:** `CreateStudyDto`
- **Logic:**
  1. Set `researcherId = req.user.sub`
  2. Validate IRB number format against regex
  3. Check for existing non-rejected study with same `irb_number` — throw `409` if found
  4. Insert `studies` row with `status: 'pending_review'`
  5. Enqueue `study_review` job
- **Success:** `201 StudyResponse`
- **Errors:**
  - `401`, `403`
  - `409` — IRB number already exists in a non-rejected study
  - `422` — validation failure (class-validator) — invalid IRB format, missing fields, invalid URL

---

### `GET /researchers/:researcherId/studies`
- **Auth:** `researcher` role (owner-scoped — `req.user.sub` must equal `:researcherId`)
- **Path param:** `researcherId` — ULID of the users row
- **Query params:** `?cursor=<ULID>&limit=<number>&status=<StudyStatus>`
- **Logic:**
  1. Verify `req.user.sub === researcherId` — throw `403` if mismatch
  2. Query `studies WHERE researcher_id = :researcherId AND deleted_at IS NULL`
  3. Apply optional status filter
  4. Apply keyset pagination
- **Success:** `200 StudyListResponse`
- **Errors:**
  - `401`, `403`

---

### `GET /studies/:id/enrollments`
- **Auth:** `researcher` role (owner-scoped)
- **Path param:** `id` — ULID of the studies row
- **Query params:** `?cursor=<ULID>&limit=<number>&status=<StudyEnrollmentStatus>`
- **Logic:**
  1. Verify `studies.researcher_id = req.user.sub`
  2. Query `study_enrollments WHERE study_id = :id`
  3. Return `sharedDataSnapshot` — if `directContactShared = false`, do NOT include contact fields even if they are in the snapshot
  4. Apply keyset pagination
- **Success:** `200 StudyEnrollmentListResponse`
- **Errors:**
  - `401`, `403`, `404`

---

### `POST /study-enrollments/:id/invite`
- **Auth:** `researcher` role
- **Path param:** `id` — ULID of the study_enrollments row
- **Request body:** None (the path param identifies the enrollment to advance)
- **Logic:**
  1. Load `study_enrollments` row
  2. Verify `studies.researcher_id = req.user.sub` (via join to studies)
  3. Validate status transition: `INTERESTED → SCREENED` or `SCREENED → ENROLLED`
  4. Call `EnrollmentsService.advanceStudyEnrollment(id, newStatus)`
- **Success:** `200 StudyEnrollmentResponse`
- **Errors:**
  - `401`, `403`, `404`
  - `409` — invalid status transition (e.g. already ENROLLED or WITHDRAWN)

---

## 5. Service Methods

```typescript
class StudiesService {

  /**
   * Creates a new study for the authenticated researcher.
   * Validates IRB number format.
   * Checks for duplicate non-rejected IRB numbers — throws ConflictException if found.
   * Inserts study with status 'pending_review'.
   * Enqueues study_review job.
   */
  create(researcherId: string, dto: CreateStudyDto): Promise<Study>

  /**
   * Returns paginated studies for the given researcher.
   * Verifies researcherId matches caller.
   * Applies optional status filter.
   * Throws ForbiddenException if researcherId !== caller.
   */
  findByResearcher(
    researcherId: string,
    callerId: string,
    query: { cursor?: string; limit: number; status?: StudyStatus }
  ): Promise<{ studies: Study[]; nextCursor?: string }>

  /**
   * Returns a single study by ID, verifying researcher ownership.
   * Throws NotFoundException if not found.
   * Throws ForbiddenException if researcher_id !== callerId.
   */
  findByIdForResearcher(id: string, researcherId: string): Promise<Study>

  /**
   * Returns paginated study enrollments for the given study.
   * Verifies study belongs to the calling researcher.
   * Returns sharedDataSnapshot fields.
   * Does NOT expose contact fields if directContactShared = false.
   */
  getEnrollments(
    studyId: string,
    researcherId: string,
    query: { cursor?: string; limit: number; status?: StudyEnrollmentStatus }
  ): Promise<{ enrollments: StudyEnrollmentSnapshot[]; nextCursor?: string }>

  /**
   * Advances a study enrollment status on behalf of the researcher.
   * Validates researcher owns the study.
   * Calls EnrollmentsService.advanceStudyEnrollment() for the state transition.
   * Valid transitions via this method: INTERESTED→SCREENED, SCREENED→ENROLLED.
   */
  inviteParticipant(studyEnrollmentId: string, researcherId: string): Promise<StudyEnrollment>

  /**
   * Called by AdminModule to approve or reject a study.
   * On approval: calls MatchingService.indexStudy(studyId) and enqueues notifications.
   */
  updateStatus(studyId: string, status: StudyStatus): Promise<Study>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `researcherId` is always set from `req.user.sub` — never from the request body. |
| BR-2 | IRB number must match `/^IRB-\d{4}-\d{4}$/`. Reject with `422` otherwise. This regex may need adjustment for different institutional formats — flag as config if multi-institution. |
| BR-3 | Duplicate IRB number check: query for any study with the same `irb_number` where `status NOT IN ('rejected')`. If found, throw `409`. A researcher may re-submit with the same IRB only after prior submission is rejected. |
| BR-4 | New studies start with `status: 'pending_review'`. Not visible in patient recommendations until admin approves. |
| BR-5 | `GET /studies/:id/enrollments` must not include direct contact fields (email, phone) in `sharedDataSnapshot` unless `directContactShared = true` on that specific enrollment row. This must be enforced at the service layer, not relying on the snapshot contents alone. |
| BR-6 | Researchers can only view/act on their own studies (`researcher_id = req.user.sub`). Cross-researcher access throws `403`. |
| BR-7 | Invite endpoint valid transitions: `INTERESTED → SCREENED`, `SCREENED → ENROLLED`. Any other transition (e.g., trying to enroll a WITHDRAWN patient) throws `409`. |
| BR-8 | `infoSheetUrl` must be a valid URL pointing to an already-uploaded S3 object. The server does not validate S3 object existence in V1 — the URL is stored as-is. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `EnrollmentsModule` | `EnrollmentsService.advanceStudyEnrollment(id, newStatus)` | `inviteParticipant()` |
| `MatchingModule` | `MatchingService.indexStudy(studyId)` | Called by `updateStatus()` when admin approves |
| `QueuesModule` | `Queue.add('study_review', { studyId })` | After study creation |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `admin` | `study_review` | `{ studyId: string; researcherId: string; irbNumber: string; title: string }` | `create()` |

---

## 9. Open Questions or Ambiguities

> ⚠️ `infoSheetUrl` — the current design requires the client to upload the info sheet to S3 before calling `POST /studies` and then pass the URL. There is no pre-signed URL generation endpoint defined. Either add `POST /uploads/presign` (returning a pre-signed S3 upload URL) or document an alternative approach before implementing study creation.

> ⚠️ The IRB number regex `/^IRB-\d{4}-\d{4}$/` is a placeholder format. Real IRB numbers vary by institution. If the platform serves multiple institutions, a more flexible format or a configurable pattern is needed. Confirm acceptable formats before writing the class-validator constraint.

> ⚠️ There is no `PATCH /studies/:id` endpoint. Once submitted, a study cannot be updated. If a researcher needs to fix an error (wrong IRB number, wrong eligibility criteria), there is no recourse short of deleting and resubmitting. Confirm this is acceptable for V1.
