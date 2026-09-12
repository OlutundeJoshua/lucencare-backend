/** Acknowledges one patient's application to one programme, at submission time. */
export interface SendEnrollmentSubmittedJob {
  to: string;
  patientName: string;
  programTitle: string;
}
