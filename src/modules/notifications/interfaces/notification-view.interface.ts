import { NotificationType } from 'src/common/enums';

import { NotificationCategory } from './notification-category.type';

/**
 * One notification as the API returns it.
 *
 * `title` and `body` are rendered server-side from the stored payload so that every
 * client shows the same wording — a payload is a bag of ids and names whose shape
 * differs per type, and eleven client-side renderers would drift apart immediately.
 * The raw `payload` still travels so a client can build its own deep link.
 */
export interface NotificationView {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read: boolean;
  readAt?: string;
  createdAt: string;
}
