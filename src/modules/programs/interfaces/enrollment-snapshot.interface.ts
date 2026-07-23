export interface EnrollmentSnapshot {
  id: string;
  status: string;
  sharedDataSnapshot: Record<string, unknown>;
  createdAt: string;
}
