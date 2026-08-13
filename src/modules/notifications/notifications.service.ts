import { ulid } from 'ulid';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { NotificationType } from 'src/common/enums';

import { Notification } from './entities/notification.entity';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationCategory } from './interfaces/notification-category.type';
import { NotificationView } from './interfaces/notification-view.interface';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  /**
   * The authenticated user's feed, newest first.
   *
   * Keyset pagination on the ULID primary key: ULIDs sort by creation time, so
   * `id < :cursor` walks backwards through time without the drift an OFFSET would
   * suffer as new notifications arrive at the head of the list.
   */
  async listForCurrentUser(
    userId: string,
    query: ListNotificationsDto,
  ): Promise<{ notifications: NotificationView[]; nextCursor?: string; unreadCount: number }> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.deleted_at IS NULL')
      .orderBy('n.id', 'DESC')
      .take(query.limit + 1);

    if (query.unreadOnly) qb.andWhere('n.read_at IS NULL');
    if (query.type) qb.andWhere('n.type = :type', { type: query.type });
    if (query.cursor) qb.andWhere('n.id < :cursor', { cursor: query.cursor });

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    // Counted separately: the badge must reflect every unread notification, not
    // just the ones on the page currently being displayed.
    const unreadCount = await this.notificationRepo.count({
      where: { userId, readAt: IsNull() },
    });

    return { notifications: rows.map((n) => this.toView(n)), nextCursor, unreadCount };
  }

  /** Idempotent: marking an already-read notification returns it unchanged. */
  async markRead(id: string, userId: string): Promise<NotificationView> {
    const notification = await this.notificationRepo.findOne({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException('Access denied: this notification does not belong to you');
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepo.update({ id }, { readAt: notification.readAt });
    }

    return this.toView(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepo.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  // Single bulk INSERT — called by batch_notify processor. Never more than 200 records at once.
  async createBulk(userIds: string[], type: NotificationType, payload: object): Promise<void> {
    if (userIds.length === 0) return;

    const notifications = userIds.map((userId) => this.notificationRepo.create({ id: ulid(), userId, type, payload }));
    await this.notificationRepo
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values(notifications)
      .execute();
  }

  async createOne(userId: string, type: NotificationType, payload: object): Promise<Notification> {
    const notification = this.notificationRepo.create({ userId, type, payload });
    return this.notificationRepo.save(notification);
  }

  private toView(n: Notification): NotificationView {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const { title, body } = this.render(n.type, payload);

    return {
      id: n.id,
      type: n.type,
      category: this.categoryOf(n.type),
      title,
      body,
      payload,
      read: !!n.readAt,
      readAt: n.readAt ? n.readAt.toISOString() : undefined,
      createdAt: n.createdAt.toISOString(),
    };
  }

  /**
   * Payload → the two lines a client displays.
   *
   * A switch rather than a lookup table so TypeScript flags a new NotificationType
   * that nobody wrote copy for; the default below is the safety net for one that
   * slips through in production rather than a licence to skip the case.
   */
  private render(
    type: NotificationType,
    p: Record<string, unknown>,
  ): { title: string; body: string } {
    const s = (key: string, fallback = ''): string => {
      const value = p[key];
      return typeof value === 'string' && value ? value : fallback;
    };

    switch (type) {
      case NotificationType.ENROLLMENT_APPLICATION:
        return {
          title: 'New application received',
          body: `Someone applied to ${s('programTitle', 'one of your programmes')}. Review them in your applicant queue.`,
        };

      case NotificationType.ENROLLMENT_UPDATE: {
        const programTitle = s('programTitle', 'a programme');
        const reason = s('reason');
        switch (s('status')) {
          case 'selected':
            return {
              title: 'You have been selected',
              body: `You have a place on ${programTitle}. The organisation will contact you with next steps.`,
            };
          case 'waitlisted':
            return {
              title: 'You are on the waiting list',
              body: `You have been waitlisted for ${programTitle}. You will be told if a place frees up.`,
            };
          case 'rejected':
            return {
              title: 'Application not approved',
              body: reason
                ? `Your application to ${programTitle} was not approved. Reason: ${reason}`
                : `Your application to ${programTitle} was not approved.`,
            };
          default:
            return {
              title: 'Application updated',
              body: `There is an update to your application to ${programTitle}.`,
            };
        }
      }

      case NotificationType.APPLICATION_PENDING_REVIEW:
        return {
          title: `New ${s('applicationType', 'account')} application`,
          body: `${s('applicantName', 'An applicant')} is awaiting review.`,
        };

      case NotificationType.PROGRAM_PENDING_REVIEW:
        return {
          title: 'Programme awaiting review',
          body: `${s('programTitle', 'A funding programme')} has been submitted and needs approving before patients can see it.`,
        };

      case NotificationType.PROGRAM_REVIEWED: {
        const programTitle = s('programTitle', 'Your programme');
        const reason = s('reason');
        if (p['approved'] === true) {
          return {
            title: 'Programme approved',
            body: `${programTitle} is now live. Patients who match your criteria can see it and apply.`,
          };
        }
        return {
          title: 'Programme not approved',
          body: reason
            ? `${programTitle} was not approved. Reason: ${reason}`
            : `${programTitle} was not approved. Edit it and submit again when you are ready.`,
        };
      }

      case NotificationType.ORG_PENDING_VERIFICATION:
        return {
          title: 'Organisation awaiting verification',
          body: `${s('orgName', 'An organisation')} has submitted its details for verification.`,
        };

      case NotificationType.ORG_VERIFIED:
        return {
          title: 'Organisation verified',
          body: `${s('orgName', 'Your organisation')} has been verified and is now active.`,
        };

      case NotificationType.PROGRAM_MATCH:
        return {
          title: 'A programme may suit you',
          body: `${s('programTitle', 'A funding programme')} is open to people with your profile.`,
        };

      case NotificationType.STUDY_MATCH:
        return {
          title: 'A study may suit you',
          body: `${s('studyTitle', 'A research study')} is recruiting participants who match your profile.`,
        };

      case NotificationType.HMO_LINK_REQUEST:
        return {
          title: 'HMO link request',
          body: `${s('orgName', 'An HMO')} has asked to link your record to their organisation. Your approval is needed.`,
        };

      case NotificationType.CONSENT_REVOKED:
        return {
          title: 'Data sharing stopped',
          body: `Sharing for ${s('purpose', 'a purpose')} has been revoked. Organisations no longer receive your data for it.`,
        };

      case NotificationType.NEW_MESSAGE:
        return {
          title: 'New message',
          body: `${s('senderName', 'Someone')} sent you a message.`,
        };

      case NotificationType.MEDICATION_REMINDER:
        return {
          title: 'Time for your medication',
          body: `It is time to take ${s('medicationName', 'your medication')}.`,
        };

      case NotificationType.REFILL_ALERT:
        return {
          title: 'Refill needed',
          body: `You are running low on ${s('medicationName', 'a medication')}.`,
        };

      case NotificationType.COMMUNITY_POST_REPLY:
        return {
          title: 'New reply',
          body: `${s('authorName', 'Someone')} replied to ${s('postTitle', 'your post')}.`,
        };

      case NotificationType.COMMUNITY_REACTION_MILESTONE: {
        const count = typeof p['count'] === 'number' ? p['count'] : 0;
        return {
          title: 'Your post is helping people',
          body: `${count} ${count === 1 ? 'person has' : 'people have'} marked ${s('postTitle', 'your contribution')} as helpful.`,
        };
      }

      case NotificationType.COMMUNITY_CONTENT_HIDDEN: {
        const reason = s('reason');
        const what = s('targetType') === 'comment' ? 'comment' : 'post';
        return {
          title: `Your ${what} was removed`,
          body: reason
            ? `A moderator removed your ${what} from ${s('communityName', 'the community')}. Reason: ${reason}`
            : `A moderator removed your ${what} from ${s('communityName', 'the community')}.`,
        };
      }

      case NotificationType.COMMUNITY_REPORT_RESOLVED:
        return {
          title: 'Your report was reviewed',
          body:
            p['actioned'] === true
              ? 'Thank you — a moderator agreed and the content has been removed.'
              : 'A moderator reviewed the content you reported and left it in place.',
        };

      case NotificationType.COMMUNITY_CONTENT_REPORTED:
        return {
          title: 'Community content reported',
          body: `A ${s('targetType', 'post')} in ${s('communityName', 'a community')} was reported for ${s('reason', 'review')}. It is waiting in the moderation queue.`,
        };

      default:
        return { title: 'Notification', body: '' };
    }
  }

  private categoryOf(type: NotificationType): NotificationCategory {
    switch (type) {
      case NotificationType.ENROLLMENT_APPLICATION:
      case NotificationType.ENROLLMENT_UPDATE:
      case NotificationType.APPLICATION_PENDING_REVIEW:
      case NotificationType.ORG_PENDING_VERIFICATION:
        return 'application';

      case NotificationType.PROGRAM_MATCH:
      case NotificationType.STUDY_MATCH:
      case NotificationType.PROGRAM_PENDING_REVIEW:
      case NotificationType.PROGRAM_REVIEWED:
        return 'program';

      case NotificationType.MEDICATION_REMINDER:
      case NotificationType.REFILL_ALERT:
      case NotificationType.HMO_LINK_REQUEST:
      case NotificationType.NEW_MESSAGE:
        return 'care';

      case NotificationType.COMMUNITY_POST_REPLY:
      case NotificationType.COMMUNITY_REACTION_MILESTONE:
      case NotificationType.COMMUNITY_CONTENT_HIDDEN:
      case NotificationType.COMMUNITY_REPORT_RESOLVED:
      case NotificationType.COMMUNITY_CONTENT_REPORTED:
        return 'community';

      default:
        return 'system';
    }
  }
}
