import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType } from 'src/common/enums';

import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { ListNotificationsDto } from './dto/list-notifications.dto';

const USER_ID = '01USER0000000000000000001';
const OTHER_USER_ID = '01USER0000000000000000002';

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: '01NOTIF000000000000000001',
    userId: USER_ID,
    type: NotificationType.ENROLLMENT_UPDATE,
    payload: { programTitle: 'Chronic Care Fund', status: 'selected' },
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    ...over,
  } as Notification;
}

function query(over: Partial<ListNotificationsDto> = {}): ListNotificationsDto {
  return { limit: 20, ...over } as ListNotificationsDto;
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  // One builder mock serving both shapes: the insert chain used by createBulk and
  // the select chain used by the feed.
  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const mockRepository = {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: 'notif-1', ...entity })),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    count: jest.fn().mockResolvedValue(0),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.getMany.mockResolvedValue([]);
    mockRepository.count.mockResolvedValue(0);
    mockRepository.update.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: mockRepository },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listForCurrentUser', () => {
    it('scopes to the caller and returns newest first', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([notification()]);

      const result = await service.listForCurrentUser(USER_ID, query());

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('n.user_id = :userId', {
        userId: USER_ID,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('n.id', 'DESC');
      expect(result.notifications).toHaveLength(1);
    });

    // ULIDs sort by time, so paging backwards through a newest-first feed is `<`.
    it('pages backwards from the cursor', async () => {
      await service.listForCurrentUser(USER_ID, query({ cursor: '01NOTIF000000000000000009' }));

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('n.id < :cursor', {
        cursor: '01NOTIF000000000000000009',
      });
    });

    it('returns a cursor only when another page exists', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        notification({ id: '01NOTIF000000000000000003' }),
        notification({ id: '01NOTIF000000000000000002' }),
        notification({ id: '01NOTIF000000000000000001' }),
      ]);

      const result = await service.listForCurrentUser(USER_ID, query({ limit: 2 }));

      expect(result.notifications).toHaveLength(2);
      expect(result.nextCursor).toBe('01NOTIF000000000000000002');
    });

    it('omits the cursor on the last page', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([notification()]);

      const result = await service.listForCurrentUser(USER_ID, query({ limit: 2 }));

      expect(result.nextCursor).toBeUndefined();
    });

    it('filters to unread when asked', async () => {
      await service.listForCurrentUser(USER_ID, query({ unreadOnly: true }));
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('n.read_at IS NULL');
    });

    // The badge counts everything unread, not just what fits on this page.
    it('counts unread across the whole feed, not the page', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([notification()]);
      mockRepository.count.mockResolvedValue(7);

      const result = await service.listForCurrentUser(USER_ID, query({ limit: 1 }));

      expect(result.unreadCount).toBe(7);
    });
  });

  describe('rendering', () => {
    async function viewOf(type: NotificationType, payload: object) {
      mockQueryBuilder.getMany.mockResolvedValue([notification({ type, payload })]);
      const { notifications } = await service.listForCurrentUser(USER_ID, query());
      return notifications[0];
    }

    it('renders an outcome the patient can act on', async () => {
      const view = await viewOf(NotificationType.ENROLLMENT_UPDATE, {
        programTitle: 'Chronic Care Fund',
        status: 'rejected',
        reason: 'Outside catchment area',
      });

      expect(view.title).toBe('Application not approved');
      expect(view.body).toContain('Chronic Care Fund');
      expect(view.body).toContain('Outside catchment area');
      expect(view.category).toBe('application');
    });

    it('omits the reason clause when there is none', async () => {
      const view = await viewOf(NotificationType.ENROLLMENT_UPDATE, {
        programTitle: 'Chronic Care Fund',
        status: 'rejected',
      });

      expect(view.body).not.toContain('Reason:');
    });

    // An NGO's "someone applied" must not read as a patient's "a programme suits you".
    it('distinguishes an incoming application from a programme match', async () => {
      const application = await viewOf(NotificationType.ENROLLMENT_APPLICATION, {
        programTitle: 'Chronic Care Fund',
      });
      const match = await viewOf(NotificationType.PROGRAM_MATCH, {
        programTitle: 'Chronic Care Fund',
      });

      expect(application.title).toBe('New application received');
      expect(application.category).toBe('application');
      expect(match.title).toBe('A programme may suit you');
      expect(match.category).toBe('program');
    });

    it('falls back to neutral wording when a payload field is missing', async () => {
      const view = await viewOf(NotificationType.REFILL_ALERT, {});

      expect(view.title).toBe('Refill needed');
      expect(view.body).toContain('a medication');
      expect(view.category).toBe('care');
    });

    it('exposes the raw payload so a client can build its own link', async () => {
      const view = await viewOf(NotificationType.ENROLLMENT_APPLICATION, {
        programId: '01PROGRAM0000000000000001',
        programTitle: 'Chronic Care Fund',
      });

      expect(view.payload['programId']).toBe('01PROGRAM0000000000000001');
    });

    // Every community type needs its own arm in BOTH switches. Without them they
    // fall through to `default`, which renders { title: 'Notification', body: '' }
    // in the 'system' bucket — wrong, and silent.
    describe('community types', () => {
      const COMMUNITY_TYPES = [
        NotificationType.COMMUNITY_POST_REPLY,
        NotificationType.COMMUNITY_COMMENT_REPLY,
        NotificationType.COMMUNITY_REACTION_MILESTONE,
        NotificationType.COMMUNITY_CONTENT_HIDDEN,
        NotificationType.COMMUNITY_REPORT_RESOLVED,
        NotificationType.COMMUNITY_CONTENT_REPORTED,
      ];

      it.each(COMMUNITY_TYPES)('%s renders real copy in the community category', async (type) => {
        const view = await viewOf(type, {});

        expect(view.title).not.toBe('Notification');
        expect(view.title.length).toBeGreaterThan(0);
        expect(view.body.length).toBeGreaterThan(0);
        expect(view.category).toBe('community');
      });

      it('names the replier and the post on a reply', async () => {
        const view = await viewOf(NotificationType.COMMUNITY_POST_REPLY, {
          authorName: 'Dr Yemi Adekunle',
          postTitle: 'Metformin side effects',
        });

        expect(view.body).toContain('Dr Yemi Adekunle');
        expect(view.body).toContain('Metformin side effects');
      });

      // An author who is not told why cannot correct the behaviour.
      it('gives the author the moderator’s reason when content is hidden', async () => {
        const view = await viewOf(NotificationType.COMMUNITY_CONTENT_HIDDEN, {
          targetType: 'comment',
          communityName: 'Diabetes Support',
          reason: 'Contains a phone number',
        });

        expect(view.title).toContain('comment');
        expect(view.body).toContain('Contains a phone number');
      });

      it('tells a reporter whether their report was acted on', async () => {
        const actioned = await viewOf(NotificationType.COMMUNITY_REPORT_RESOLVED, { actioned: true });
        const dismissed = await viewOf(NotificationType.COMMUNITY_REPORT_RESOLVED, { actioned: false });

        expect(actioned.body).toContain('removed');
        expect(dismissed.body).toContain('left it in place');
      });

      it('pluralises the milestone count', async () => {
        const one = await viewOf(NotificationType.COMMUNITY_REACTION_MILESTONE, { count: 1 });
        const many = await viewOf(NotificationType.COMMUNITY_REACTION_MILESTONE, { count: 25 });

        expect(one.body).toContain('1 person has');
        expect(many.body).toContain('25 people have');
      });
    });
  });

  describe('markRead', () => {
    it('marks an unread notification and reports it read', async () => {
      mockRepository.findOne.mockResolvedValue(notification());

      const view = await service.markRead('01NOTIF000000000000000001', USER_ID);

      expect(mockRepository.update).toHaveBeenCalledWith(
        { id: '01NOTIF000000000000000001' },
        { readAt: expect.any(Date) },
      );
      expect(view.read).toBe(true);
    });

    it('is idempotent — a read notification is not written again', async () => {
      mockRepository.findOne.mockResolvedValue(
        notification({ readAt: new Date('2026-07-02T00:00:00.000Z') }),
      );

      const view = await service.markRead('01NOTIF000000000000000001', USER_ID);

      expect(mockRepository.update).not.toHaveBeenCalled();
      expect(view.readAt).toBe('2026-07-02T00:00:00.000Z');
    });

    it('refuses another user’s notification', async () => {
      mockRepository.findOne.mockResolvedValue(notification({ userId: OTHER_USER_ID }));

      await expect(service.markRead('01NOTIF000000000000000001', USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('404s on a notification that does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.markRead('01NOTIF000000000000000009', USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllRead', () => {
    it('updates only the caller’s unread rows', async () => {
      mockRepository.update.mockResolvedValue({ affected: 4 });

      const result = await service.markAllRead(USER_ID);

      expect(mockRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID }),
        { readAt: expect.any(Date) },
      );
      expect(result).toEqual({ updated: 4 });
    });
  });

  describe('createOne', () => {
    it('creates and saves a single notification', async () => {
      const result = await service.createOne('user-1', NotificationType.REFILL_ALERT, { medicationId: 'med-1' });

      expect(mockRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        type: NotificationType.REFILL_ALERT,
        payload: { medicationId: 'med-1' },
      });
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ userId: 'user-1', type: NotificationType.REFILL_ALERT }),
      );
    });
  });

  describe('createBulk', () => {
    it('performs a single bulk insert for all user ids', async () => {
      await service.createBulk(['user-1', 'user-2'], NotificationType.PROGRAM_MATCH, { programId: 'prog-1' });

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.values).toHaveBeenCalledWith([
        expect.objectContaining({ id: expect.any(String), userId: 'user-1', type: NotificationType.PROGRAM_MATCH, payload: { programId: 'prog-1' } }),
        expect.objectContaining({ id: expect.any(String), userId: 'user-2', type: NotificationType.PROGRAM_MATCH, payload: { programId: 'prog-1' } }),
      ]);
      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an empty user id list', async () => {
      await service.createBulk([], NotificationType.PROGRAM_MATCH, {});

      expect(mockRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
