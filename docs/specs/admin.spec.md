# Admin Module Specification

## 1. Module Overview

The Admin module handles all platform admin review actions: approving and rejecting organisations, programs, and studies. It owns no entities — it updates status fields on entities owned by other modules. Every admin action writes to the audit log and triggers downstream effects (matching indexing, notifications). All endpoints require `platform_admin` role.

---

## 2. Entities Involved

**Writes (via injected services):**
- `organizations` — status updates via OrganizationsService
- `programs` — status updates via ProgramsService
- `studies` — status updates via StudiesService

**Writes (always):**
- `audit_log` — mandatory entry on every approval or rejection

---

## 3. DTOs

```typescript
// src/modules/admin/dto/admin-approve.dto.ts
export const AdminApproveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(1000).optional(),
}).refine(
  d => d.status !== 'rejected' || d.reason !== undefined,
  { message: 'reason is required when status is rejected' }
);
export type AdminApproveDto = z.infer<typeof AdminApproveSchema>;
```

### Response Shapes

```typescript
// Approval responses re-use the response shapes from their owning modules
// Admin endpoints return the updated resource wrapped in StandardResponse<T>

interface AdminApprovalResponse<T> {
  data: T;         // OrganizationResponse | ProgramResponse | StudyResponse
  traceId: string;
}
```

---

## 4. Endpoints

### `PATCH /admin/organizations/:id`
- **Auth:** `platform_admin` role
- **Path param:** `id` — ULID of the organizations row
- **Request body:** `AdminApproveDto`
- **Logic:**
  1. Load organization — throw `404` if not found
  2. Verify current status is `'pending_verification'` — throw `409` if already approved/rejected/suspended
  3. Call `OrganizationsService.updateStatus(id, { status: mapped, verifiedBy: req.user.sub })`
  4. Write audit log: `ADMIN_APPROVE` or `ADMIN_REJECT`
  5. If approved: enqueue `org_verified` notification job for the org creator
  6. If rejected: enqueue `org_rejected` notification job for the org creator
- **Success:** `200` with updated Organization
- **Errors:**
  - `401`, `403` — caller is not platform_admin
  - `404` — org not found
  - `409` — org not in a reviewable state
  - `422` — reason missing on rejection

---

### `PATCH /admin/programs/:id`
- **Auth:** `platform_admin` role
- **Path param:** `id` — ULID of the programs row
- **Request body:** `AdminApproveDto`
- **Logic:**
  1. Load program — throw `404` if not found
  2. Verify current status is `'pending_review'` — throw `409` if already actioned
  3. Call `ProgramsService.updateStatus(id, status)`
  4. Write audit log
  5. If approved:
     - Call `MatchingService.indexProgram(id)` to compute and cache eligible count
     - Enqueue `program_approved` notification for the NGO admin (org creator)
  6. If rejected: enqueue rejection notification for the NGO admin
- **Success:** `200` with updated Program
- **Errors:**
  - `401`, `403`, `404`, `409`, `422`

---

### `PATCH /admin/studies/:id`
- **Auth:** `platform_admin` role
- **Path param:** `id` — ULID of the studies row
- **Request body:** `AdminApproveDto`
- **Logic:**
  1. Load study — throw `404` if not found
  2. Verify current status is `'pending_review'`
  3. Call `StudiesService.updateStatus(id, status)`
  4. Write audit log
  5. If approved:
     - Call `MatchingService.indexStudy(id)`
     - Enqueue `study_approved` notification for the researcher
  6. If rejected: enqueue rejection notification
- **Success:** `200` with updated Study
- **Errors:**
  - `401`, `403`, `404`, `409`, `422`

---

## 5. Service Methods

```typescript
class AdminService {

  /**
   * Reviews an organization registration.
   * Verifies org is in 'pending_verification' state.
   * Calls OrganizationsService.updateStatus().
   * Writes audit log entry.
   * Enqueues notification for org creator.
   * Throws ConflictException if org not in reviewable state.
   */
  reviewOrganization(
    orgId: string,
    adminUserId: string,
    dto: AdminApproveDto
  ): Promise<Organization>

  /**
   * Reviews a program submission.
   * Verifies program is in 'pending_review' state.
   * Calls ProgramsService.updateStatus().
   * If approving: calls MatchingService.indexProgram(programId).
   * Writes audit log entry.
   * Enqueues notification for program creator.
   */
  reviewProgram(
    programId: string,
    adminUserId: string,
    dto: AdminApproveDto
  ): Promise<Program>

  /**
   * Reviews a study submission.
   * Verifies study is in 'pending_review' state.
   * Calls StudiesService.updateStatus().
   * If approving: calls MatchingService.indexStudy(studyId).
   * Writes audit log entry.
   * Enqueues notification for study researcher.
   */
  reviewStudy(
    studyId: string,
    adminUserId: string,
    dto: AdminApproveDto
  ): Promise<Study>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | All three admin endpoints require `platform_admin` role. Any other role receives `403`. |
| BR-2 | `reason` is required when `status = 'rejected'`. Optional when approving. Enforced by `@ValidateIf` conditional validator. |
| BR-3 | Admin actions are only valid when the resource is in a reviewable state (`pending_verification` for orgs, `pending_review` for programs/studies). Attempting to re-review an already-actioned resource throws `409`. |
| BR-4 | Every admin action (approve or reject) writes a mandatory `ADMIN_APPROVE` or `ADMIN_REJECT` audit log entry with the resource type, resource ID, admin user ID, and reason (if rejected). |
| BR-5 | `platform_admin` users must never have access to patient health data. The `platform_admin` role has no org affiliation (`orgId = null`) and is blocked from all patient-scoped routes by the `RoleGuard`. |
| BR-6 | `MatchingService.indexProgram()` and `MatchingService.indexStudy()` are called synchronously on approval (not via queue) to ensure the match count cache is populated before the first patient-facing recommendation query. |
| BR-7 | Rejection notifications must include the rejection reason so the org/researcher can correct and resubmit. |
| BR-8 | There is no "undo approval" action in V1. Once approved, a resource remains approved. Suspension of orgs is handled separately (not via this flow). |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `OrganizationsModule` | `OrganizationsService.updateStatus(id, dto)` | On org review |
| `ProgramsModule` | `ProgramsService.updateStatus(id, status)` | On program review |
| `StudiesModule` | `StudiesService.updateStatus(id, status)` | On study review |
| `MatchingModule` | `MatchingService.indexProgram(id)` | On program approval |
| `MatchingModule` | `MatchingService.indexStudy(id)` | On study approval |
| `AuditModule` | `AuditService.log({ action: ADMIN_APPROVE/REJECT, ... })` | On every admin action |
| `QueuesModule` | `Queue.add('org_verified' / 'program_approved' / 'study_approved' / rejection variants, ...)` | After each review action |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `admin` | `org_verified` | `{ orgId: string; creatorUserId: string; orgName: string }` | Org approval |
| `admin` | `org_rejected` | `{ orgId: string; creatorUserId: string; reason: string }` | Org rejection |
| `admin` | `program_approved` | `{ programId: string; orgAdminUserId: string; programTitle: string }` | Program approval |
| `admin` | `program_rejected` | `{ programId: string; orgAdminUserId: string; reason: string }` | Program rejection |
| `admin` | `study_approved` | `{ studyId: string; researcherUserId: string; studyTitle: string }` | Study approval |
| `admin` | `study_rejected` | `{ studyId: string; researcherUserId: string; reason: string }` | Study rejection |

---

## 9. Open Questions or Ambiguities

> ⚠️ There is no `GET /admin/pending` endpoint for the admin to list items awaiting review. Currently the admin receives notifications but has no dashboard to view pending orgs, programs, or studies. Confirm whether a paginated pending-review list endpoint is needed in V1.

> ⚠️ `MatchingService.indexProgram()` is called synchronously on approval. If the patient table is large, this could be a slow operation that blocks the admin's HTTP response. Consider whether this should be enqueued instead (accept slight delay before match counts are available).
