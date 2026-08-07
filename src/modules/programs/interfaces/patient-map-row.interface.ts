/**
 * One row of the NGO coverage map: how the organisation's own applicants are spread
 * across states.
 *
 * Aggregates only. `topCondition` comes from the enrollment's sharedDataSnapshot —
 * data the applicant consented to share with this organisation and which it already
 * reads in the applicant queue. The state itself comes from the patient record and is
 * never emitted per patient; a patient with no location recorded lands in the
 * "Unspecified" row rather than vanishing from the totals.
 */
export interface PatientMapRow {
  state: string;
  selected: number;
  inReview: number;
  waitlisted: number;
  total: number;
  topCondition?: string;
}
