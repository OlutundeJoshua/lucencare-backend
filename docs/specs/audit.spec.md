# Audit Module Specification

## 1. Module Overview

The Audit module owns the `AuditLog` entity and exposes a single write-only `AuditService.log()` method called by other modules after sensitive actions. It has no public HTTP endpoints in V1. The `audit_log` table is INSERT-only — no updates or deletes are permitted at any layer.

---

> **Integration with common guards:** Once `AuditService` is available, inject it into `OrgScopeGuard` (`src/common/guards/org-scope.guard.ts`) to write `CROSS_ORG_ATTEMPT` audit entries on cross-org rejections, and into `AuditInterceptor` (`src/common/interceptors/audit.interceptor.ts`) to auto-log sensitive actions declared via a decorator. Both files are stubs ready to receive the injection.

## 2. Entities Involved

**Owns:**
- `audit_log`

---

## 3. DTOs

```typescript
// Internal DTO — used by other services when calling AuditService.log()
interface CreateAuditLogDto {
  actorId: string;          // ULID — users.id of the user who performed the action
  action: AuditAction;
  resourceId: string;       // ULID — ID of the affected resource
  resourceType: string;     // e.g. 'Enrollment', 'ConsentGrant', 'Organization', 'User'
  metadata?: Record<string, unknown>;  // action-specific context (see below)
}
```

**Metadata shapes by `AuditAction`:**

```typescript
// EXPORT
{ orgId: string; exportedFields: string[]; patientId: string }

// REVOKE_CONSENT
{ purpose: ConsentPurpose; affectedEnrollmentIds: string[] }

// ADMIN_APPROVE
{ resourceType: 'Organization' | 'Program' | 'Study'; reason?: string }

// ADMIN_REJECT
{ resourceType: 'Organization' | 'Program' | 'Study'; reason: string }  // reason required on reject

// LOGIN
{ ipAddress?: string; userAgent?: string }

// CONSENT_CHANGE
{ fromStatus: ConsentStatus; toStatus: ConsentStatus }

// CROSS_ORG_ATTEMPT
{ attemptedResourceId: string; attemptedResourceType: string; callerOrgId: string }
```

---

## 4. Endpoints

None. No public HTTP endpoints in V1.

---

## 5. Service Methods

```typescript
class AuditService {

  /**
   * Inserts a single audit_log row.
   * This is the only public method on AuditService.
   *
   * If an EntityManager is provided (i.e., caller is inside a transaction),
   * the insert runs within that transaction so it is part of the same atomic unit.
   * If no EntityManager is provided, a new standalone insert is performed.
   *
   * NEVER throws. If the audit insert fails, it logs the error via nestjs-pino
   * at ERROR level and allows the caller to continue. However, callers for
   * security-critical actions (EXPORT, REVOKE_CONSENT) should treat audit
   * failure as fatal and roll back or abort.
   */
  log(dto: CreateAuditLogDto, manager?: EntityManager): Promise<void>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `audit_log` is INSERT-only. The Postgres RLS policy grants only `SELECT` and `INSERT` on this table. No `UPDATE` or `DELETE` is permitted at any layer — application, service, or migration. |
| BR-2 | The following actions MUST always produce an audit log entry before the response is returned: `EXPORT`, `REVOKE_CONSENT`, `ADMIN_APPROVE`, `ADMIN_REJECT`, `CROSS_ORG_ATTEMPT`. Missing audit entries for these actions is a bug. |
| BR-3 | `LOGIN` entries are written to `audit_log` on every successful authentication. High-volume concern noted — a separate `auth_events` table is recommended for V2 if volume becomes an issue, but all auth events stay in `audit_log` for V1. |
| BR-4 | `actorId` is always a real `users.id` ULID. For system-generated actions (e.g., scheduled jobs), a dedicated system user ID should be established — not a null `actorId`. |
| BR-5 | `metadata` must never contain: `passwordHash`, `phoneHash`, JWT payloads, or `sharedDataSnapshot` contents. These fields must be explicitly excluded before calling `log()`. |
| BR-6 | When `log()` is called inside a transaction (via the `manager` parameter), the audit entry is committed or rolled back atomically with the surrounding transaction. Use this pattern for `REVOKE_CONSENT` and `EXPORT`. |
| BR-7 | `audit_log` rows are never soft-deleted. They have no `deleted_at` column. `BaseEntity.deletedAt` is not used here. |

---

## 7. Dependencies on Other Modules

None. AuditModule is a leaf module — it has no outbound dependencies.

---

## 8. Events Emitted or Consumed

None.

---

## 9. Open Questions or Ambiguities

> ⚠️ There is no admin-facing audit viewer endpoint in V1. If a compliance audit is required, someone must query the DB directly. Confirm whether a read endpoint (`GET /admin/audit-log`) is needed in V1 or is acceptable as V2.

> ⚠️ `actorId` for system/automated actions (BullMQ processors, scheduled jobs) is undefined. A seeded system user (`id = '01SYSTEM00000000000000000000'` or similar fixed ULID) should be created in the seeds file and used as `actorId` for non-human actions.
