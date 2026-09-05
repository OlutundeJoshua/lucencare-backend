import { EnrollmentStatus, StudyEnrollmentStatus } from 'src/common/enums';

export interface ConsentImpact {
  affectedEnrollments: Array<{
    id: string;
    programId: string;
    programTitle: string;
    status: EnrollmentStatus;
  }>;
  affectedStudyEnrollments: Array<{
    id: string;
    studyId: string;
    studyTitle: string;
    status: StudyEnrollmentStatus;
  }>;
  totalAffected: number;
}
