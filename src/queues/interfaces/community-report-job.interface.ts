import { CommunityReportReason, CommunityReportTarget } from 'src/common/enums';

/**
 * Payload for COMMUNITY_REPORT_JOB — tells the platform admins that content is
 * waiting in the moderation queue.
 *
 * Deliberately self-contained: it carries the community name and a short excerpt so
 * the processor needs no community repositories, which is what keeps QueuesModule
 * from having to import CommunityModule (and creating a cycle, since CommunityModule
 * imports QueuesModule to enqueue this in the first place).
 */
export interface CommunityReportJob {
  reportId: string;
  targetType: CommunityReportTarget;
  targetId: string;
  communityId: string;
  communityName: string;
  reason: CommunityReportReason;
  /** First ~140 characters of the reported body. */
  excerpt: string;
}
