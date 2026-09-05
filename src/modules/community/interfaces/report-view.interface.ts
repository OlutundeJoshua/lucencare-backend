import {
  CommunityReportReason,
  CommunityReportStatus,
  CommunityReportTarget,
} from 'src/common/enums';

/**
 * One row of the admin moderation queue.
 *
 * Carries a snapshot of the reported content so the queue stays readable after the
 * content is hidden — and so a moderator never has to leave the queue to decide. An
 * admin cannot open the participant-facing post route anyway; RoleGuard rejects them.
 */
export interface ReportView {
  id: string;
  targetType: CommunityReportTarget;
  targetId: string;
  communityId: string;
  communityName: string;
  reason: CommunityReportReason;
  details?: string | null;
  status: CommunityReportStatus;
  resolutionNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  /** Who filed it, pseudonymised the same way any other author is. */
  reporterDisplayName: string;
  /** The reported content itself. */
  targetTitle?: string | null;
  targetBody: string;
  targetAuthorDisplayName: string;
  targetAuthorVerified: boolean;
  /** Whether the content is currently hidden — a queue row can outlive its action. */
  targetHidden: boolean;
  /** How many people have flagged this same content and are still waiting. */
  openReportCount: number;
}
