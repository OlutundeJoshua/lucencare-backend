import { CommunityContentStatus } from 'src/common/enums';

import { AuthorDisplay } from './author-display.interface';

/**
 * One post on the wire.
 *
 * Deliberately absent: the author's raw name, patient id, phone, condition tags or
 * any other patients column. `author.userId` IS returned so a client can render
 * "your post" affordances — which makes patients pseudonymous, not anonymous.
 */
export interface PostView {
  id: string;
  communityId: string;
  communityName: string;
  communityAccent?: string | null;
  author: AuthorDisplay;
  title?: string | null;
  body: string;
  tags: string[];
  commentCount: number;
  reactionCount: number;
  /** Whether the requesting user has already marked this helpful. */
  reactedByMe: boolean;
  createdAt: string;
  lastActivityAt: string;
  /** Only ever `hidden` on the author's own copy — others get a 404 instead. */
  status: CommunityContentStatus;
  /** False when a moderator has hidden it. Present so the author sees why. */
  visibleToOthers: boolean;
  hiddenReason?: string | null;
  hiddenAt?: string | null;
}
