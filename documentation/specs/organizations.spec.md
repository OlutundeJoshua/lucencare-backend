# Organizations Module Specification

## 1. Module Overview

The Organizations module owns the `Organization` entity. It is intentionally thin — it provides create and read methods that are called by other modules (AuthModule for creation, AdminModule for status updates). It has no direct public HTTP endpoints of its own beyond org detail reads. All status transitions are driven by the AdminModule.

---

## 2. Entities Involved

**Owns:**
- `organizations`

---

## 3. DTOs

```typescript
// src/modules/organizations/dto/create-organization.dto.ts
// Used internally by AuthService — not a standalone HTTP endpoint DTO
export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.nativeEnum(OrgType),
  contactEmail: z.string().email(),
});
export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;
```

```typescript
// src/modules/organizations/dto/update-org-status.dto.ts
// Used internally by AdminModule
export const UpdateOrgStatusSchema = z.object({
  status: z.nativeEnum(OrgStatus),
  verifiedBy: z.string().length(26),       // ULID of the admin user
});
export type UpdateOrgStatusDto = z.infer<typeof UpdateOrgStatusSchema>;
```

### Response Shape

```typescript
interface OrganizationResponse {
  data: {
    id: string;
    name: string;
    type: OrgType;
    status: OrgStatus;
    contactEmail: string;
    verifiedAt?: string;    // ISO 8601, present if status is 'active'
    createdAt: string;
  };
  traceId: string;
}
```

---

## 4. Endpoints

### `GET /organizations/:id`
- **Auth:** `ngo_admin` or `hmo_coordinator` (org-scoped — caller's `orgId` must match `:id`)
- **Path param:** `id` — ULID of the organizations row
- **Logic:** Return the organizations row. Caller must belong to this org (`req.user.orgId === id`).
- **Success:** `200 OrganizationResponse`
- **Errors:**
  - `401` — missing/invalid JWT
  - `403` — caller's orgId does not match the requested org id
  - `404` — organization not found

---

### `GET /organizations/:id/programs`
- **Note:** This endpoint is owned by ProgramsModule but is routed through the org path. The OrganizationsModule does not implement it — see programs.spec.md.

---

## 5. Service Methods

```typescript
class OrganizationsService {

  /**
   * Called by AuthService inside the org registration transaction.
   * Inserts an organizations row with status 'pending_verification'.
   * Returns the new organization entity.
   */
  create(dto: CreateOrganizationDto, manager: EntityManager): Promise<Organization>

  /**
   * Returns a single organization by ULID.
   * Throws NotFoundException if not found or soft-deleted.
   */
  findById(id: string): Promise<Organization>

  /**
   * Called by AdminModule to approve or suspend an organization.
   * Sets status, and if approving: sets verifiedAt = NOW(), verifiedBy = adminUserId.
   * Throws NotFoundException if org not found.
   */
  updateStatus(id: string, dto: UpdateOrgStatusDto): Promise<Organization>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | Every new organization starts with `status: 'pending_verification'`. No org can access patient data until the platform admin sets it to `'active'`. |
| BR-2 | `verifiedAt` and `verifiedBy` are only set when status transitions to `'active'`. They must not be set on rejection or suspension. |
| BR-3 | Org staff users linked to a suspended org receive `403` on any org-scoped action. The `OrgScopeGuard` must check `org.status !== 'suspended'` in addition to role validation. |
| BR-4 | `orgId` on the users row is always set to the organization's ULID at creation time. It is never updated after that. |

---

## 7. Dependencies on Other Modules

None. OrganizationsModule is a leaf module — other modules call into it; it does not call out.

---

## 8. Events Emitted or Consumed

None directly. The `org_verification` queue job is enqueued by AuthModule and consumed by QueuesModule. OrganizationsModule only updates state when AdminModule calls `updateStatus()`.

---

## 9. Open Questions or Ambiguities

> ✅ `GET /organizations` (admin list) is implemented in V1 with `platform_admin` role and cursor-based
> pagination. Optional `?status=` filter defaults to returning all statuses. Resolved 2026-06-02.

> ⚠️ `OrganizationsService.create(dto, manager)` exists for `AuthService` to call inside a
> `DataSource.transaction()`. `AuthService` currently creates the org row inline (see TODO comment
> in `auth.service.ts` inside `registerOrg()`).
> Track in V2: refactor `AuthService.registerOrg()` to call this service method.

> ⚠️ `OrgScopeGuard` does not yet enforce `org.status !== SUSPENDED` (BR-3) at the guard level.
> V1 enforcement is inside `OrganizationsService.findOne()` via the optional `callerOrgId` param.
> V2: inject `OrganizationsService` into the guard; make `canActivate` async; all modules that apply
> `@UseGuards(OrgScopeGuard)` must import `OrganizationsModule`.
