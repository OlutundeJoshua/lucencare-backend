import { CommunityStatus } from 'src/common/enums';

/** One community as any participant sees it, with their own membership resolved. */
export interface CommunityView {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  accent?: string | null;
  disclaimer?: string | null;
  tags: string[];
  status: CommunityStatus;
  memberCount: number;
  postCount: number;
  /** Whether the requesting user holds an active membership. */
  joined: boolean;
  createdAt: string;
}
