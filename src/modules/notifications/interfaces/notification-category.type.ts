/**
 * How a notification is grouped in the UI's filter tabs.
 *
 * Deliberately coarser than NotificationType: eleven types would make an unusable
 * row of tabs, and the grouping is stable even as new types are added.
 */
export type NotificationCategory =
  | 'application'
  | 'program'
  | 'care'
  | 'community'
  | 'system';
