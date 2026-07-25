export interface PaginatedPatientIds {
  patientIds: string[];
  nextCursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor?: string;
}
