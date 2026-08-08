// Single source of truth: which audit resourceType values may have their subject named

/**
 * Audit `resourceType` values whose subject may be resolved to a human-readable
 * name for the admin audit screen.
 *
 * This is a privacy boundary, in the same spirit as snapshot-fields.ts (§11.8).
 * `patient`, `medication` and `ConsentGrant` are deliberately ABSENT — those rows
 * exist (PDF export, refill requests, consent revocation) and naming them would put
 * patient identity and health data onto an admin screen that shows none today. Their
 * rows still render their `resourceId`, so an admin can trace exactly which record
 * an action touched without the screen revealing whose it is.
 *
 * Do not add a type here without first confirming its name column carries no patient
 * data. AuditService.attachResource() resolves names for these types and only these.
 *
 * The casing mismatch is intentional: 'User' is written PascalCase by AuthService
 * while the rest are snake_case. These strings match what is actually persisted —
 * normalising them here would orphan every historical row.
 */
export const NAMED_AUDIT_RESOURCE_TYPES = [
  'organization',
  'program',
  'study',
  'professional_application',
  'benefactor_application',
  'User',
] as const;

export type NamedAuditResourceType = (typeof NAMED_AUDIT_RESOURCE_TYPES)[number];

export function isNamedAuditResourceType(
  resourceType: string,
): resourceType is NamedAuditResourceType {
  return (NAMED_AUDIT_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}
