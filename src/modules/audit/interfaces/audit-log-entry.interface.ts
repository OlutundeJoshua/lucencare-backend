import { AuditLog } from '../entities/audit-log.entity';

/**
 * An audit row enriched for display. The table stores only `actorId` and
 * `resourceId`; the admin audit screen shows who performed the action and what
 * it was performed on.
 *
 * `resourceName` and `resourceSubtype` are populated only for the resource types on
 * the NAMED_AUDIT_RESOURCE_TYPES allowlist — see src/common/constants/auditable-resources.ts.
 * They are absent for patient, medication and consent rows by design, and absent for
 * any row whose subject has since been deleted.
 */
export interface AuditLogEntry extends AuditLog {
  actorName?: string;
  actorEmail?: string;
  resourceName?: string;
  resourceSubtype?: string;
}
