import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';

import {
  AuditAction,
  CommunityContentStatus,
  CommunityModerationAction,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityReportTarget,
  CommunityStatus,
  NotificationType,
  UserRole,
} from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ADMIN_QUEUE, COMMUNITY_REPORT_JOB } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { User } from 'src/modules/auth/entities/user.entity';

import { CommunityService } from './community.service';
import { Community } from './entities/community.entity';
import { CommunityComment } from './entities/community-comment.entity';
import { CommunityMembership } from './entities/community-membership.entity';
import { CommunityPost } from './entities/community-post.entity';
import { CommunityReaction } from './entities/community-reaction.entity';
import { CommunityReport } from './entities/community-report.entity';
import { ListFeedDto } from './dto/list-feed.dto';

const COMMUNITY_ID = '01HZZZZZZZZZZZZZZZZZZZZCOM';
const POST_ID = '01HZZZZZZZZZZZZZZZZZZZPOST';
const COMMENT_ID = '01HZZZZZZZZZZZZZZZZZZZCMNT';
const REPORT_ID = '01HZZZZZZZZZZZZZZZZZZZZRPT';
const AUTHOR_ID = '01HZZZZZZZZZZZZZZZZZZZAUTH';
const OTHER_ID = '01HZZZZZZZZZZZZZZZZZZOTHER';
const ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZADMN';

function makeCommunity(over: Partial<Community> = {}): Community {
  const c = new Community();
  Object.assign(c, {
    id: COMMUNITY_ID,
    name: 'Diabetes Support',
    slug: 'diabetes-support',
    tags: [],
    status: CommunityStatus.ACTIVE,
    memberCount: 3,
    postCount: 2,
    createdByUserId: AUTHOR_ID,
    createdAt: new Date(),
  });
  return Object.assign(c, over);
}

function makePost(over: Partial<CommunityPost> = {}): CommunityPost {
  const p = new CommunityPost();
  Object.assign(p, {
    id: POST_ID,
    communityId: COMMUNITY_ID,
    authorUserId: AUTHOR_ID,
    title: 'Metformin side effects',
    body: 'Any tips?',
    tags: ['Metformin'],
    status: CommunityContentStatus.PUBLISHED,
    commentCount: 0,
    reactionCount: 0,
    lastActivityAt: new Date(),
    createdAt: new Date(),
  });
  return Object.assign(p, over);
}

function makeComment(over: Partial<CommunityComment> = {}): CommunityComment {
  const c = new CommunityComment();
  Object.assign(c, {
    id: COMMENT_ID,
    postId: POST_ID,
    parentCommentId: null,
    communityId: COMMUNITY_ID,
    authorUserId: OTHER_ID,
    body: 'Take it with food.',
    status: CommunityContentStatus.PUBLISHED,
    reactionCount: 0,
    createdAt: new Date(),
  });
  return Object.assign(c, over);
}

function makeReport(over: Partial<CommunityReport> = {}): CommunityReport {
  const r = new CommunityReport();
  Object.assign(r, {
    id: REPORT_ID,
    reporterUserId: OTHER_ID,
    postId: POST_ID,
    commentId: null,
    communityId: COMMUNITY_ID,
    reason: CommunityReportReason.SPAM,
    status: CommunityReportStatus.PENDING,
    createdAt: new Date(),
  });
  return Object.assign(r, over);
}

/** A QueryBuilder stub whose terminal methods are set per test. */
function makeQb() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
    getCount: jest.fn().mockResolvedValue(0),
  };
}

describe('CommunityService', () => {
  let service: CommunityService;
  let communityRepo: any;
  let membershipRepo: any;
  let postRepo: any;
  let commentRepo: any;
  let reactionRepo: any;
  let reportRepo: any;
  let userRepo: any;
  let auditService: { log: jest.Mock };
  let notificationsService: { createOne: jest.Mock; createBulk: jest.Mock };
  let adminQueue: { add: jest.Mock };
  let manager: any;

  function repoStub() {
    return {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => makeQb()),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
  }

  beforeEach(async () => {
    communityRepo = repoStub();
    membershipRepo = repoStub();
    postRepo = repoStub();
    commentRepo = repoStub();
    reactionRepo = repoStub();
    reportRepo = repoStub();
    userRepo = repoStub();

    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      createOne: jest.fn().mockResolvedValue(undefined),
      createBulk: jest.fn().mockResolvedValue(undefined),
    };
    adminQueue = { add: jest.fn().mockResolvedValue(undefined) };

    manager = {
      // TypeORM stamps @CreateDateColumn/@UpdateDateColumn on the entity before the
      // insert, so anything the service saves comes back with them set. The stub has
      // to do the same or every toView() call trips over an undefined createdAt.
      create: jest.fn((_e: unknown, v: Record<string, unknown>) => ({
        createdAt: new Date(),
        updatedAt: new Date(),
        ...v,
      })),
      save: jest.fn((_e: unknown, v?: unknown) => Promise.resolve(v ?? _e)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw: [{ member_count: 4, post_count: 3, comment_count: 1, reaction_count: 1 }] }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: getRepositoryToken(CommunityMembership), useValue: membershipRepo },
        { provide: getRepositoryToken(CommunityPost), useValue: postRepo },
        { provide: getRepositoryToken(CommunityComment), useValue: commentRepo },
        { provide: getRepositoryToken(CommunityReaction), useValue: reactionRepo },
        { provide: getRepositoryToken(CommunityReport), useValue: reportRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)) },
        },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: getQueueToken(ADMIN_QUEUE), useValue: adminQueue },
      ],
    }).compile();

    service = module.get(CommunityService);
  });

  afterEach(() => jest.clearAllMocks());

  /** Wires resolveAuthors' raw query to return one row per user. */
  function stubAuthors(rows: Array<Record<string, unknown>>) {
    const qb = makeQb();
    qb.getRawMany.mockResolvedValue(rows);
    userRepo.createQueryBuilder.mockReturnValue(qb);
  }

  function patientAuthorRow(userId = AUTHOR_ID, name = 'Amaka Okafor') {
    return {
      userId,
      role: UserRole.PATIENT,
      userName: name,
      userStatus: 'active',
      patientName: name,
      professionalStatus: null,
      specialty: null,
      benefactorName: null,
      benefactorStatus: null,
    };
  }

  // ── The privacy transform ────────────────────────────────────────────────
  // This is the whole reason a patient can post about their health at all, so it
  // is tested at its edges rather than only on the happy path.
  describe('patient display names', () => {
    const cases: Array<[string, string | null | undefined, string]> = [
      ['first name and surname', 'Amaka Okafor', 'Amaka O.'],
      ['three names take the LAST as the initial', 'Amaka Ngozi Okafor', 'Amaka O.'],
      ['a single token is returned whole', 'Amaka', 'Amaka'],
      ['extra whitespace is normalised', '  amaka   okafor  ', 'amaka O.'],
      ['a missing name degrades to a label', null, 'Community member'],
      ['an empty name degrades to a label', '   ', 'Community member'],
    ];

    it.each(cases)('%s', async (_label, input, expected) => {
      stubAuthors([{ ...patientAuthorRow(), userName: input, patientName: input }]);
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.find.mockResolvedValue([makeCommunity()]);

      const view = await service.getPost(AUTHOR_ID, POST_ID);
      expect(view.author.displayName).toBe(expected);
    });

    it('never puts the raw patient name on the wire', async () => {
      stubAuthors([patientAuthorRow(AUTHOR_ID, 'Amaka Ngozi Okafor')]);
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.find.mockResolvedValue([makeCommunity()]);

      const view = await service.getPost(AUTHOR_ID, POST_ID);
      expect(JSON.stringify(view)).not.toContain('Okafor');
      expect(JSON.stringify(view)).not.toContain('Ngozi');
    });

    it('derives the avatar initial from the display name, so the two cannot disagree', async () => {
      stubAuthors([patientAuthorRow(AUTHOR_ID, 'amaka okafor')]);
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.find.mockResolvedValue([makeCommunity()]);

      const view = await service.getPost(AUTHOR_ID, POST_ID);
      expect(view.author.displayName).toBe('amaka O.');
      expect(view.author.initial).toBe('A');
    });
  });

  describe('verified badges', () => {
    function proRow(over: Record<string, unknown> = {}) {
      return {
        userId: AUTHOR_ID,
        role: UserRole.PROFESSIONAL,
        userName: 'Dr Yemi Adekunle',
        userStatus: 'active',
        patientName: null,
        professionalStatus: 'approved',
        specialty: 'Endocrinology',
        benefactorName: null,
        benefactorStatus: null,
        ...over,
      };
    }

    async function badgeFor(row: Record<string, unknown>) {
      stubAuthors([row]);
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.find.mockResolvedValue([makeCommunity()]);
      return (await service.getPost(AUTHOR_ID, POST_ID)).author;
    }

    it('badges an approved professional and keeps their full name', async () => {
      const author = await badgeFor(proRow());
      expect(author.displayName).toBe('Dr Yemi Adekunle');
      expect(author.badge).toBe('verified-professional');
      expect(author.specialty).toBe('Endocrinology');
    });

    it('does not badge a pending application', async () => {
      const author = await badgeFor(proRow({ professionalStatus: 'pending' }));
      expect(author.verified).toBe(false);
      expect(author.badge).toBeUndefined();
    });

    // The case a snapshotted badge would get wrong: approval is still on record, but
    // the account has been suspended, so the claim must stop being made immediately.
    it('does not badge an approved professional whose account is suspended', async () => {
      const author = await badgeFor(proRow({ userStatus: 'suspended' }));
      expect(author.verified).toBe(false);
      expect(author.specialty).toBeUndefined();
    });

    it('prefers the benefactor application name over the user name', async () => {
      const author = await badgeFor({
        userId: AUTHOR_ID,
        role: UserRole.BENEFACTOR,
        userName: 'A. F.',
        userStatus: 'active',
        patientName: null,
        professionalStatus: null,
        specialty: null,
        benefactorName: 'Adunola Fashola',
        benefactorStatus: 'approved',
      });
      expect(author.displayName).toBe('Adunola Fashola');
      expect(author.badge).toBe('verified-benefactor');
    });
  });

  // ── Membership ───────────────────────────────────────────────────────────
  describe('membership', () => {
    it('refuses a post from a non-member', async () => {
      communityRepo.findOne.mockResolvedValue(makeCommunity());
      membershipRepo.findOne.mockResolvedValue(null);

      await expect(service.createPost(OTHER_ID, COMMUNITY_ID, { body: 'hi' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('joining twice inserts nothing and leaves the count alone', async () => {
      communityRepo.findOne.mockResolvedValue(makeCommunity({ memberCount: 3 }));
      manager.findOne.mockResolvedValue({ id: 'existing' });

      const result = await service.joinCommunity(OTHER_ID, COMMUNITY_ID);
      expect(result).toEqual({ joined: true, memberCount: 3 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('leaving when not a member is a no-op', async () => {
      communityRepo.findOne.mockResolvedValue(makeCommunity({ memberCount: 3 }));
      manager.findOne.mockResolvedValue(null);

      const result = await service.leaveCommunity(OTHER_ID, COMMUNITY_ID);
      expect(result).toEqual({ joined: false, memberCount: 3 });
      expect(manager.softDelete).not.toHaveBeenCalled();
    });

    it('refuses activity in an archived community', async () => {
      communityRepo.findOne.mockResolvedValue(makeCommunity({ status: CommunityStatus.ARCHIVED }));
      await expect(service.joinCommunity(OTHER_ID, COMMUNITY_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ── Founding ─────────────────────────────────────────────────────────────
  describe('createCommunity', () => {
    it('joins a patient founder — a community with no members is not a community', async () => {
      const view = await service.createCommunity(AUTHOR_ID, { name: 'Diabetes Support' });

      expect(view.joined).toBe(true);
      expect(view.memberCount).toBe(1);
      // Two saves: the community, then the founder's membership.
      expect(manager.save).toHaveBeenCalledTimes(2);
    });

    // Without this an admin seeding the starter set would be seated in every
    // community's member roster, and every member count would start at 1.
    it('does NOT join a platform admin creating the starter set', async () => {
      const view = await service.createCommunity(ADMIN_ID, { name: 'Diabetes Support' }, { joinFounder: false });

      expect(view.joined).toBe(false);
      expect(view.memberCount).toBe(0);
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('audits either way, recording which it was', async () => {
      await service.createCommunity(ADMIN_ID, { name: 'X' }, { joinFounder: false });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.COMMUNITY_CREATED,
          metadata: expect.objectContaining({ byPlatform: true }),
        }),
      );
    });

    it('slugifies the name', async () => {
      const view = await service.createCommunity(AUTHOR_ID, { name: 'Nutrition & Diet' });
      expect(view.slug).toBe('nutrition-diet');
    });
  });

  // ── Comments ─────────────────────────────────────────────────────────────
  describe('comments', () => {
    beforeEach(() => {
      stubAuthors([patientAuthorRow(), patientAuthorRow(OTHER_ID, 'Emeka Obi')]);
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.find.mockResolvedValue([makeCommunity()]);
      communityRepo.findOne.mockResolvedValue(makeCommunity());
      membershipRepo.findOne.mockResolvedValue({ id: 'm1' });
    });

    it('notifies the post author', async () => {
      await service.createComment(OTHER_ID, POST_ID, { body: 'Take it with food.' });
      expect(notificationsService.createOne).toHaveBeenCalledWith(
        AUTHOR_ID,
        NotificationType.COMMUNITY_POST_REPLY,
        expect.objectContaining({ postId: POST_ID }),
      );
    });

    it('does not notify you about your own comment', async () => {
      await service.createComment(AUTHOR_ID, POST_ID, { body: 'Following up.' });
      expect(notificationsService.createOne).not.toHaveBeenCalled();
    });

    // One level of nesting. A reply to a reply attaches to the top-level ancestor
    // rather than 422-ing, so a client never has to know the depth rule.
    it('re-parents a reply-to-a-reply onto the top-level comment', async () => {
      const reply = makeComment({ id: 'REPLY', parentCommentId: COMMENT_ID });
      commentRepo.findOne.mockResolvedValue(reply);

      const created = await service.createComment(OTHER_ID, POST_ID, {
        body: 'Me too',
        parentCommentId: 'REPLY',
      });
      expect(created.parentCommentId).toBe(COMMENT_ID);
    });

    it('keeps a first-level reply attached to its own parent', async () => {
      commentRepo.findOne.mockResolvedValue(makeComment());

      const created = await service.createComment(OTHER_ID, POST_ID, {
        body: 'How much?',
        parentCommentId: COMMENT_ID,
      });
      expect(created.parentCommentId).toBe(COMMENT_ID);
    });

    it('refuses a reply on a post a moderator has hidden', async () => {
      postRepo.findOne.mockResolvedValue(
        makePost({ status: CommunityContentStatus.HIDDEN, hiddenReason: 'Off topic' }),
      );
      await expect(service.createComment(AUTHOR_ID, POST_ID, { body: 'hi' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── Reactions ────────────────────────────────────────────────────────────
  describe('reactions', () => {
    beforeEach(() => {
      stubAuthors([patientAuthorRow()]);
      postRepo.findOne.mockResolvedValue(makePost({ reactionCount: 4 }));
      communityRepo.find.mockResolvedValue([makeCommunity()]);
    });

    it('refuses a reaction on your own content', async () => {
      await expect(service.react(AUTHOR_ID, CommunityReportTarget.POST, POST_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('is idempotent — a second reaction inserts nothing', async () => {
      manager.findOne.mockResolvedValue({ id: 'r1' });
      const result = await service.react(OTHER_ID, CommunityReportTarget.POST, POST_ID);
      expect(result).toEqual({ reacted: true, reactionCount: 4 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('notifies the author at a milestone, not on every like', async () => {
      manager.findOne.mockResolvedValue(null);
      manager.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw: [{ reaction_count: 5 }] }),
      });

      await service.react(OTHER_ID, CommunityReportTarget.POST, POST_ID);
      expect(notificationsService.createOne).toHaveBeenCalledWith(
        AUTHOR_ID,
        NotificationType.COMMUNITY_REACTION_MILESTONE,
        expect.objectContaining({ count: 5 }),
      );
    });

    it('stays silent between milestones', async () => {
      manager.findOne.mockResolvedValue(null);
      manager.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ raw: [{ reaction_count: 7 }] }),
      });

      await service.react(OTHER_ID, CommunityReportTarget.POST, POST_ID);
      expect(notificationsService.createOne).not.toHaveBeenCalled();
    });

    it('un-reacting when nothing is there leaves the count alone', async () => {
      manager.delete.mockResolvedValue({ affected: 0 });
      const result = await service.unreact(OTHER_ID, CommunityReportTarget.POST, POST_ID);
      expect(result).toEqual({ reacted: false, reactionCount: 4 });
    });

    // A soft delete would keep occupying the partial unique index, so re-reacting
    // would violate it and surface as a 500.
    it('un-reacting HARD deletes the row rather than soft-deleting it', async () => {
      await service.unreact(OTHER_ID, CommunityReportTarget.POST, POST_ID);
      expect(manager.delete).toHaveBeenCalled();
      expect(manager.softDelete).not.toHaveBeenCalled();
    });
  });

  // ── Visibility ───────────────────────────────────────────────────────────
  describe('hidden content', () => {
    beforeEach(() => {
      stubAuthors([patientAuthorRow()]);
      communityRepo.find.mockResolvedValue([makeCommunity()]);
      postRepo.findOne.mockResolvedValue(
        makePost({ status: CommunityContentStatus.HIDDEN, hiddenReason: 'Contains a phone number' }),
      );
    });

    it('shows the author their own hidden post, with the reason', async () => {
      const view = await service.getPost(AUTHOR_ID, POST_ID);
      expect(view.hiddenReason).toBe('Contains a phone number');
      expect(view.visibleToOthers).toBe(false);
    });

    // 404 rather than 403: a 403 confirms the content exists, which is precisely
    // what a moderator just decided should not be discoverable.
    it('404s to everyone else — never 403', async () => {
      await expect(service.getPost(OTHER_ID, POST_ID)).rejects.toThrow(NotFoundException);
      await expect(service.getPost(OTHER_ID, POST_ID)).rejects.not.toThrow(ForbiddenException);
    });

    it('refuses to let the author edit their way out of moderation', async () => {
      await expect(service.updatePost(AUTHOR_ID, POST_ID, { body: 'rewritten' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('still lets the author delete it', async () => {
      const result = await service.deletePost(AUTHOR_ID, POST_ID);
      expect(result.id).toBe(POST_ID);
      expect(manager.softDelete).toHaveBeenCalled();
    });
  });

  // ── Reports and moderation ───────────────────────────────────────────────
  describe('reporting', () => {
    beforeEach(() => {
      postRepo.findOne.mockResolvedValue(makePost());
      communityRepo.findOne.mockResolvedValue(makeCommunity());
      reportRepo.findOne.mockResolvedValue(null);
      reportRepo.save.mockImplementation((r: CommunityReport) => Promise.resolve(r));
    });

    it('audits the report and queues the admin notice', async () => {
      await service.reportContent(OTHER_ID, CommunityReportTarget.POST, POST_ID, {
        reason: CommunityReportReason.PERSONAL_DATA,
      });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.COMMUNITY_REPORT_SUBMITTED,
          resourceType: 'community_report',
        }),
      );
      expect(adminQueue.add).toHaveBeenCalledWith(
        COMMUNITY_REPORT_JOB,
        expect.objectContaining({ targetId: POST_ID, excerpt: 'Any tips?' }),
      );
    });

    it('refuses a second open report from the same person', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      await expect(
        service.reportContent(OTHER_ID, CommunityReportTarget.POST, POST_ID, {
          reason: CommunityReportReason.SPAM,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a report on your own content', async () => {
      await expect(
        service.reportContent(AUTHOR_ID, CommunityReportTarget.POST, POST_ID, {
          reason: CommunityReportReason.SPAM,
        }),
      ).rejects.toThrow(ConflictException);
    });

    // Both side effects are post-commit and guarded: the row is already saved, so a
    // Redis or audit outage must not report failure for work that succeeded.
    it('still succeeds when the audit write fails', async () => {
      auditService.log.mockRejectedValue(new Error('audit down'));
      await expect(
        service.reportContent(OTHER_ID, CommunityReportTarget.POST, POST_ID, {
          reason: CommunityReportReason.SPAM,
        }),
      ).resolves.toMatchObject({ status: CommunityReportStatus.PENDING });
    });

    it('still succeeds when the queue is unreachable', async () => {
      adminQueue.add.mockRejectedValue(new Error('redis down'));
      await expect(
        service.reportContent(OTHER_ID, CommunityReportTarget.POST, POST_ID, {
          reason: CommunityReportReason.SPAM,
        }),
      ).resolves.toMatchObject({ status: CommunityReportStatus.PENDING });
    });
  });

  describe('resolving a report', () => {
    beforeEach(() => {
      stubAuthors([patientAuthorRow()]);
      communityRepo.findOne.mockResolvedValue(makeCommunity());
      communityRepo.find.mockResolvedValue([makeCommunity()]);
      reportRepo.findOne.mockResolvedValue(makeReport());
      reportRepo.findOneOrFail.mockResolvedValue(
        makeReport({ status: CommunityReportStatus.ACTIONED, reviewedAt: new Date() }),
      );
      reportRepo.find.mockResolvedValue([]);
      postRepo.find.mockResolvedValue([makePost()]);
      manager.findOne.mockResolvedValue(makePost());
    });

    it('hiding closes EVERY pending report on the same target', async () => {
      manager.find.mockResolvedValue([
        makeReport({ id: 'R1', reporterUserId: 'U1' }),
        makeReport({ id: 'R2', reporterUserId: 'U2' }),
      ]);

      await service.resolveReport(ADMIN_ID, REPORT_ID, {
        action: CommunityModerationAction.HIDE,
        note: 'Contains a phone number',
      });

      const updateQb = manager.createQueryBuilder.mock.results.at(-1)?.value;
      expect(updateQb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['R1', 'R2'] });
      expect(notificationsService.createBulk).toHaveBeenCalledWith(
        ['U1', 'U2'],
        NotificationType.COMMUNITY_REPORT_RESOLVED,
        expect.objectContaining({ actioned: true }),
      );
    });

    it('tells the author their content was removed, and why', async () => {
      manager.find.mockResolvedValue([]);
      await service.resolveReport(ADMIN_ID, REPORT_ID, {
        action: CommunityModerationAction.HIDE,
        note: 'Contains a phone number',
      });

      expect(notificationsService.createOne).toHaveBeenCalledWith(
        AUTHOR_ID,
        NotificationType.COMMUNITY_CONTENT_HIDDEN,
        expect.objectContaining({ reason: 'Contains a phone number' }),
      );
    });

    // Another reporter's complaint about the same content may have merit for a
    // different reason, so a dismissal must not close it too.
    it('dismissing leaves the content and the other reports alone', async () => {
      await service.resolveReport(ADMIN_ID, REPORT_ID, { action: CommunityModerationAction.DISMISS });

      expect(manager.update).toHaveBeenCalledWith(
        CommunityReport,
        { id: REPORT_ID },
        expect.objectContaining({ status: CommunityReportStatus.DISMISSED }),
      );
      expect(notificationsService.createOne).not.toHaveBeenCalled();
    });

    it('refuses to review the same report twice', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport({ status: CommunityReportStatus.ACTIONED }));
      await expect(
        service.resolveReport(ADMIN_ID, REPORT_ID, { action: CommunityModerationAction.DISMISS }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  describe('getStats', () => {
    it('counts real rows and never reads the display counters', async () => {
      const counts = [3, 2, 11, 4, 1];
      let i = 0;
      const qb = makeQb();
      qb.getCount.mockImplementation(() => Promise.resolve(counts[i++]));
      commentRepo.createQueryBuilder.mockReturnValue(qb);
      membershipRepo.createQueryBuilder.mockReturnValue(qb);
      reactionRepo.createQueryBuilder.mockReturnValue(qb);
      postRepo.createQueryBuilder.mockReturnValue(qb);

      const stats = await service.getStats(AUTHOR_ID);

      expect(stats.questionsAnswered).toBe(3);
      expect(stats.communitiesJoined).toBe(2);
      expect(stats.helpfulMarks).toBe(11);
      // If any of these came from a counter column, findOne would have been used.
      expect(communityRepo.findOne).not.toHaveBeenCalled();
      expect(postRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── Pagination ───────────────────────────────────────────────────────────
  describe('keyset pagination', () => {
    beforeEach(() => {
      stubAuthors([patientAuthorRow()]);
      communityRepo.find.mockResolvedValue([makeCommunity()]);
    });

    it('drops the extra row and returns its predecessor as the cursor', async () => {
      const query = Object.assign(new ListFeedDto(), { limit: 2 });
      const qb = makeQb();
      qb.getMany.mockResolvedValue([
        makePost({ id: 'P1' }),
        makePost({ id: 'P2' }),
        makePost({ id: 'P3' }),
      ]);
      postRepo.createQueryBuilder.mockReturnValue(qb);

      const { posts, nextCursor } = await service.listFeed(AUTHOR_ID, query);
      expect(posts).toHaveLength(2);
      expect(nextCursor).toBe('P2');
    });

    it('returns no cursor on the last page', async () => {
      const query = Object.assign(new PaginationDto(), { limit: 5 });
      const qb = makeQb();
      qb.getMany.mockResolvedValue([makePost({ id: 'P1' })]);
      postRepo.createQueryBuilder.mockReturnValue(qb);

      const { nextCursor } = await service.listMyPosts(AUTHOR_ID, query);
      expect(nextCursor).toBeUndefined();
    });
  });
});
