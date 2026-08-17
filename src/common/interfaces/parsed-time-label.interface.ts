/** A parsed user-facing time label — see parseTimeLabel in common/utils/time-label.util.ts. */
export interface ParsedTimeLabel {
  /** Minutes past local midnight. */
  minutes: number;
  /** Weekday the label named, if it named one — weekly items only. */
  weekday?: string;
}
