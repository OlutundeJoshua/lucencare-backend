/**
 * The display fields resolved for an audit row's subject.
 *
 * `subtype` distinguishes variants that share one resourceType — an `organization`
 * row resolves to 'ngo' or 'hmo' so the admin screen can badge it correctly instead
 * of assuming one or the other.
 */
export interface AuditResource {
  name?: string;
  subtype?: string;
}
