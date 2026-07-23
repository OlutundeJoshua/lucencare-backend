import { StudyEnrollmentStatus } from 'src/common/enums';

export interface StudyEnrollmentSnapshot {
  id: string;
  studyId: string;
  status: StudyEnrollmentStatus;
  sharedDataSnapshot: Record<string, unknown>;
  directContactShared: boolean;
  createdAt: string;
}
