/**
 * The single label an NGO sees on a programme card.
 *
 * Before approval it reports the review state one-for-one — `Draft`, `In review`,
 * `Not approved`. After approval it reports the operational state, which is a
 * second axis entirely: an approved programme can be `Full` or `Paused` at the
 * same time, so the two could never share one stored column.
 *
 * Every value except `Paused` (stored as programs.paused_at) is derived at read
 * time, so a label cannot drift out of step with the status, slot counts and
 * expiry it describes. `Draft` used to cover pending_review AND rejected, which
 * is exactly the drift this split removes.
 */
export type ProgramLifecycle =
  | 'Draft'
  | 'In review'
  | 'Not approved'
  | 'Active'
  | 'Closing'
  | 'Full'
  | 'Paused'
  | 'Expired';
