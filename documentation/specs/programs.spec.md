# Programs Module Specification

## 1. Module Overview

The Programs module owns the `Program` entity. It handles NGO program creation, listing by org, exposing an aggregate match preview (never patient IDs), listing enrollments (snapshot data only), and triggering the fan-out notification job. It delegates matching logic to `MatchingModule` and notification enqueueing to `QueuesModule`.

---

## 2. Entities Involved

**Owns:**
- `programs`

**Reads (does not own):**
- `enrollments` — reads snapshot data for the enrollments list endpoint (via EnrollmentsService or direct query)

---

## 3. DTOs

```typescript
// src/modules/programs/dto/create-program.dto.ts
export const CreateProgramSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.nativeEnum(ProgramType),
  eligibilityCriteria: z.array(z.object({
    field: z.string().min(1),       // e.g. 'conditionTags', 'locationState', 'locationLga'
    operator: z.enum(['eq', 'in', 'gte', 'lte', 'contains']),
    value: z.unknown(),
  })).min(1),
  expiresAt: z.string().datetime(),  // ISO 8601 datetime string — must be in the future
  // orgId: NEVER from body
});
export type CreateProgramDto = z.infer<typeof CreateProgramSchema>;
```

### Response Shapes

```typescript
interface ProgramResponse {
  data: {
    id: string;
    orgId: string;
    title: string;
    type: ProgramType;
    status: ProgramStatus;
    eligibilityCriteria: Array<{ field: string; operator: string; value: unknown }>;
    expiresAt: string;
    createdAt: string;
  };
  traceId: string;
}

interface ProgramListResponse {
  data: ProgramResponse['data'][];
  meta: { cursor?: string; limit: number };
  traceId: string;
}

interface ProgramMatchPreviewResponse {
  data: {
    eligibleCount: number;
    tagSummary: Record<string, number>;  // e.g. { diabetes: 45, hypertension: 30 }
    // NO patient IDs — ever
  };
  traceId: string;
}

interface ProgramEnrollmentListResponse {
  data: Array<{
    id: string;
    status: EnrollmentStatus;
    sharedDataSnapshot: Record<string, unknown>;  // consented fields only — no patient ID
    createdAt: string;
  }>;
  meta: { cursor?: string; limit: number };
  traceId: string;
}
```

---

## 4. Endpoints

### `POST /programs`
- **Auth:** `ngo_admin` role
- **Request body:** `CreateProgramDto`
- **Logic:**
  1. Verify `req.user.orgId` is set (org-scope check)
  2. Verify org status is `'active'` — throw `403` if pending/suspended
  3. Validate `expiresAt` is in the future — throw `422` if not
  4. Validate `type` matches org type (NGO creates `NGO_FUNDING`) — throw `422` if mismatch
  5. Insert `programs` row with `orgId = req.user.orgId`, `status: 'pending_review'`
  6. Enqueue `program_review` job
- **Success:** `201 ProgramResponse`
- **Errors:**
  - `401`, `403`
  - `422` — validation failure (past expiresAt, type mismatch, missing fields)

---

### `GET /organizations/:orgId/programs`
- **Auth:** `ngo_admin` role (org-scoped — `req.user.orgId` must equal `:orgId`)
- **Path param:** `orgId`
- **Query params:** `?cursor=<ULID>&limit=<number>&status=<ProgramStatus>`
- **Logic:**
  1. Verify `req.user.orgId === orgId` — throw `403` if mismatch
  2. Query `programs WHERE org_id = :orgId AND deleted_at IS NULL`
  3. Optionally filter by `status`
  4. Apply keyset pagination
- **Success:** `200 ProgramListResponse`
- **Errors:**
  - `401`, `403`

---

### `GET /programs/:id/matches`
- **Auth:** `ngo_admin` role (org-scoped)
- **Path param:** `id` — ULID of the programs row
- **Logic:**
  1. Load program — verify `org_id = req.user.orgId`
  2. Call `MatchingService.getMatchPreview(programId)` — returns `{ eligibleCount, tagSummary }`
  3. Return aggregate data only. NO patient IDs. NO patient-level data.
- **Success:** `200 ProgramMatchPreviewResponse`
- **Errors:**
  - `401`, `403`, `404`

---

### `GET /programs/:id/enrollments`
- **Auth:** `ngo_admin` role (org-scoped)
- **Path param:** `id` — ULID of the programs row
- **Query params:** `?cursor=<ULID>&limit=<number>`
- **Logic:**
  1. Verify `programs.org_id = req.user.orgId`
  2. Query `enrollments WHERE program_id = :id AND deleted_at IS NULL`
  3. Return `sharedDataSnapshot` only — NEVER join to `patients` table
- **Success:** `200 ProgramEnrollmentListResponse`
- **Errors:**
  - `401`, `403`, `404`

---

### `POST /programs/:id/notify`
- **Auth:** `ngo_admin` role (org-scoped)
- **Path param:** `id` — ULID of the programs row
- **Request body:** None
- **Logic:**
  1. Verify `programs.org_id = req.user.orgId`
  2. Verify program status is `'approved'` — throw `409` if not
  3. Verify program `expiresAt > NOW()` — throw `409` if expired
  4. Enqueue ONE `fan_out_notify` coordinator job: `{ programId, orgId }`
- **Success:** `202 { data: { message: 'Notification job queued' } }`
- **Errors:**
  - `401`, `403`, `404`
  - `409` — program not approved or expired

---

## 5. Service Methods

```typescript
class ProgramsService {

  /**
   * Creates a new program for the authenticated NGO.
   * Sets orgId from caller's JWT — never from request body.
   * Sets status to 'pending_review'.
   * Validates expiresAt is in the future.
   * Enqueues program_review job after insert.
   * Throws ForbiddenException if org status is not 'active'.
   * Throws UnprocessableEntityException if expiresAt is in the past.
   */
  create(orgId: string, dto: CreateProgramDto): Promise<Program>

  /**
   * Returns paginated programs for the given orgId.
   * Supports optional status filter.
   * Applies keyset pagination on id ASC.
   * Throws ForbiddenException if orgId does not match caller.
   */
  findByOrg(
    orgId: string,
    query: { cursor?: string; limit: number; status?: ProgramStatus }
  ): Promise<{ programs: Program[]; nextCursor?: string }>

  /**
   * Returns a single program by ID, verifying org ownership.
   * Throws NotFoundException if not found or soft-deleted.
   * Throws ForbiddenException if org_id !== caller orgId.
   */
  findByIdForOrg(id: string, orgId: string): Promise<Program>

  /**
   * Returns aggregate match preview — count + tag summary.
   * Delegates to MatchingService.getMatchPreview(programId).
   * Never returns patient-level data or IDs.
   */
  getMatchPreview(programId: string, orgId: string): Promise<MatchPreview>

  /**
   * Returns paginated enrollments for the program.
   * Returns sharedDataSnapshot only — does NOT join to patients table.
   * Verifies program belongs to orgId.
   */
  getEnrollments(
    programId: string,
    orgId: string,
    query: { cursor?: string; limit: number }
  ): Promise<{ enrollments: EnrollmentSnapshot[]; nextCursor?: string }>

  /**
   * Triggers fan-out notification to eligible patients.
   * Verifies program is 'approved' and not expired.
   * Enqueues ONE fan_out_notify coordinator job.
   * Throws ConflictException if program is not approved or is expired.
   */
  triggerFanOut(programId: string, orgId: string): Promise<void>

  /**
   * Called by AdminModule to update program status to 'approved' or 'rejected'.
   * If approving: also calls MatchingService.indexProgram(programId) to cache eligible count.
   */
  updateStatus(programId: string, status: ProgramStatus): Promise<Program>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `orgId` is always set from `req.user.orgId` — never from the request body. |
| BR-2 | `type` must be `NGO_FUNDING` for NGO admins. If an org of type `ngo` tries to create a `research_study` program, reject with `422`. |
| BR-3 | `expiresAt` must be strictly in the future at creation time. Reject with `422` otherwise. |
| BR-4 | New programs start with `status: 'pending_review'`. They are not visible in patient-facing recommendations until admin approves them. |
| BR-5 | `GET /programs/:id/enrollments` MUST NOT join to the `patients` table. It returns `sharedDataSnapshot` only. This is the primary privacy boundary for NGOs. |
| BR-6 | `GET /programs/:id/matches` returns aggregate data only. Patient IDs, names, and any individually identifying information must never appear in this response. |
| BR-7 | Fan-out can only be triggered on programs with status `'approved'` and `expiresAt > NOW()`. |
| BR-8 | Patient-facing program queries (recommendations) must include `AND p.expires_at > NOW()` to exclude expired programs. No sweeper in V1. |
| BR-9 | An org must have status `'active'` before creating programs. Pending or suspended orgs receive `403`. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `MatchingModule` | `MatchingService.getMatchPreview(programId)` | `GET /programs/:id/matches` |
| `MatchingModule` | `MatchingService.indexProgram(programId)` | Called by `updateStatus()` when admin approves |
| `QueuesModule` | `Queue.add('program_review', { programId })` | After program creation |
| `QueuesModule` | `Queue.add('fan_out_notify', { programId, orgId })` | `POST /programs/:id/notify` |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `admin` | `program_review` | `{ programId: string; orgId: string; title: string }` | `create()` |
| `notifications` | `fan_out_notify` | `{ programId: string; orgId: string }` | `triggerFanOut()` |

---

## 9. Open Questions or Ambiguities

> ⚠️ `GET /organizations/:orgId/programs` is nested under the org resource but implemented in ProgramsModule. Confirm routing configuration — the controller should live in `programs.controller.ts` but handle the `/organizations/:orgId/programs` path.

> ⚠️ There is no `PATCH /programs/:id` endpoint for updating a program after creation. If the NGO wants to edit the title or eligibility criteria, there is currently no path to do so. Confirm whether programs are immutable after submission or if an update endpoint is needed.
