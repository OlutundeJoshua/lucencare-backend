import { CommunityContentStatus } from 'src/common/enums';

import { AuthorDisplay } from './author-display.interface';

/** One comment or reply. `parentCommentId` is set on replies; nesting is one level. */
export interface CommentView {
  id: string;
  postId: string;
  parentCommentId?: string | null;
  author: AuthorDisplay;
  body: string;
  reactionCount: number;
  reactedByMe: boolean;
  createdAt: string;
  status: CommunityContentStatus;
  visibleToOthers: boolean;
  hiddenReason?: string | null;
  /**
   * Live replies under this comment. Always 0 on a reply — nesting is one level
   * (BR-14), so only a top-level comment can carry any. Drives the collapsed
   * "View N replies" affordance, so the client never fetches a thread it has not
   * been asked to show.
   */
  replyCount: number;
}
