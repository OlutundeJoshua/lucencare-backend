/**
 * The operational state of an approved programme, as NGO staff think about it.
 *
 * Distinct from ProgramStatus, which is the platform's review state
 * (pending_review / approved / rejected / expired). A programme can be `approved`
 * and simultaneously `Full` or `Paused`; collapsing the two axes into one column
 * would make those states mutually exclusive.
 *
 * Only `Paused` is stored (as programs.paused_at). The rest are derived at read
 * time, so they cannot drift out of step with the slot counts and expiry they
 * describe.
 */
export type ProgramLifecycle = 'Draft' | 'Active' | 'Closing' | 'Full' | 'Paused' | 'Expired';
