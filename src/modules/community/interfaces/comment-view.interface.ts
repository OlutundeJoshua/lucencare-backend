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
}
