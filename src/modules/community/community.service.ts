import { ulid } from 'ulid';

import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';

import {
  AuditAction,
  CommunityContentStatus,
  CommunityModerationAction,
  CommunityReactionType,
  CommunityReportStatus,
  CommunityReportTarget,
  CommunityStatus,
  NotificationType,
  UserRole,
} from 'src/common/enums';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ADMIN_QUEUE, COMMUNITY_REPORT_JOB } from 'src/queues/queues.constants';
import { CommunityReportJob } from 'src/queues/interfaces/community-report-job.interface';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { User } from 'src/modules/auth/entities/user.entity';

import { Community } from './entities/community.entity';
import { CommunityComment } from './entities/community-comment.entity';
import { CommunityMembership } from './entities/community-membership.entity';
import { CommunityPost } from './entities/community-post.entity';
import { CommunityReaction } from './entities/community-reaction.entity';
import { CommunityReport } from './entities/community-report.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ListCommunitiesDto } from './dto/list-communities.dto';
import { ListFeedDto } from './dto/list-feed.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { AuthorDisplay } from './interfaces/author-display.interface';
import { CommentView } from './interfaces/comment-view.interface';
import { CommunityOverviewView } from './interfaces/community-overview.interface';
import { CommunityStatsView } from './interfaces/community-stats-view.interface';
import { CommunityView } from './interfaces/community-view.interface';
import { PostView } from './interfaces/post-view.interface';
import { ReportView } from './interfaces/report-view.interface';
import { TrendingTag } from './interfaces/trending-tag.interface';

/**
 * Reaction counts at which the author is told. Never every like: like volume is
 * unbounded, and one notification row plus a websocket push per like would bury the
 * recipient's feed and hammer the notifications table on a popular post.
 */
const REACTION_MILESTONES = [1, 5, 25, 100];

/** How far back the Trending tab and the portal's "this week" tiles look. */
const TRENDING_WINDOW_DAYS = 7;
const TRENDING_LIMIT = 8;

/** Characters kept in a generated slug. */
const SLUG_ALLOWED = /[^a-z0-9]+/g;

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityMembership)
    private readonly membershipRepo: Repository<CommunityMembership>,
    @InjectRepository(CommunityPost)
    private readonly postRepo: Repository<CommunityPost>,
    @InjectRepository(CommunityComment)
    private readonly commentRepo: Repository<CommunityComment>,
    @InjectRepository(CommunityReaction)
    private readonly reactionRepo: Repository<CommunityReaction>,
    @InjectRepository(CommunityReport)
    private readonly reportRepo: Repository<CommunityReport>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
  ) {}

  // ── Communities ────────────────────────────────────────────────────────────

  /** Browsable communities, keyset id ASC, with the caller's own membership resolved. */
  async listCommunities(
    userId: string,
    query: ListCommunitiesDto,
  ): Promise<{ communities: CommunityView[]; nextCursor?: string }> {
    const qb = this.communityRepo
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CommunityStatus.ACTIVE })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.id', 'ASC')
      .take(query.limit + 1);

    if (query.cursor) qb.andWhere('c.id > :cursor', { cursor: query.cursor });
    if (query.tag) qb.andWhere('c.tags @> ARRAY[:tag]::text[]', { tag: query.tag });
    if (query.joinedOnly) {
      // EXISTS inside SQL rather than an id list assembled in JS — the membership
      // set is unbounded and must never be paged through in application code.
      qb.andWhere(
        `EXISTS (SELECT 1 FROM community_memberships m
                 WHERE m.community_id = c.id AND m.user_id = :userId AND m.deleted_at IS NULL)`,
        { userId },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    const joined = await this.joinedIdsAmong(userId, rows.map((c) => c.id));
    return {
      communities: rows.map((c) => this.toCommunityView(c, joined.has(c.id))),
      nextCursor,
    };
  }

  /** One community. 404 if archived or soft-deleted — an archived one is not browsable. */
  async getCommunity(userId: string, id: string): Promise<CommunityView> {
    const community = await this.communityRepo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!community || community.status !== CommunityStatus.ACTIVE) {
      throw new NotFoundException(`Community ${id} not found`);
    }
    const joined = await this.joinedIdsAmong(userId, [id]);
    return this.toCommunityView(community, joined.has(id));
  }

  /**
   * Founds a community.
   *
   * Among participants this is patients only — enforced at the route, because a
   * professional or benefactor founding a patient-support space changes what the
   * space is for. A platform admin may also create one, to seed the starter set and
   * to curate: without that, an empty platform is deadlocked until some patient
   * happens to found the first community.
   *
   * A patient founder is joined automatically — a community with no members is not
   * a community. An admin is NOT: they are not a participant, and counting them as
   * a member would put a non-participant in every community's roster.
   */
  async createCommunity(
    userId: string,
    dto: CreateCommunityDto,
    options: { joinFounder?: boolean } = {},
  ): Promise<CommunityView> {
    const joinFounder = options.joinFounder ?? true;
    const slug = await this.uniqueSlug(dto.name);

    const community = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(Community, {
        id: ulid(),
        name: dto.name,
        slug,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        accent: dto.accent ?? null,
        tags: dto.tags ?? [],
        status: CommunityStatus.ACTIVE,
        memberCount: joinFounder ? 1 : 0,
        postCount: 0,
        createdByUserId: userId,
      });
      await manager.save(Community, created);

      if (joinFounder) {
        await manager.save(
          manager.create(CommunityMembership, {
            id: ulid(),
            communityId: created.id,
            userId,
            joinedAt: new Date(),
            codeOfConductAt: new Date(),
          }),
        );
      }

      return created;
    });

    await this.tryAudit({
      actorId: userId,
      action: AuditAction.COMMUNITY_CREATED,
      resourceId: community.id,
      resourceType: 'community',
      metadata: { name: community.name, slug: community.slug, byPlatform: !joinFounder },
    });

    return this.toCommunityView(community, joinFounder);
  }

  /** Idempotent: an existing active membership is returned unchanged, not duplicated. */
  async joinCommunity(userId: string, communityId: string): Promise<{ joined: true; memberCount: number }> {
    const community = await this.requireActiveCommunity(communityId);

    const memberCount = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(CommunityMembership, {
        where: { communityId, userId, deletedAt: IsNull() },
      });
      if (existing) return community.memberCount;

      await manager.save(
        manager.create(CommunityMembership, {
          id: ulid(),
          communityId,
          userId,
          joinedAt: new Date(),
          codeOfConductAt: new Date(),
        }),
      );
      return this.bumpCounter(manager, Community, communityId, 'member_count', +1);
    });

    return { joined: true, memberCount };
  }

  /** Soft-deletes the membership. Leaving never removes what the member wrote. */
  async leaveCommunity(userId: string, communityId: string): Promise<{ joined: false; memberCount: number }> {
    const community = await this.requireActiveCommunity(communityId);

    const memberCount = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(CommunityMembership, {
        where: { communityId, userId, deletedAt: IsNull() },
      });
      if (!existing) return community.memberCount;

      await manager.softDelete(CommunityMembership, { id: existing.id });
      return this.bumpCounter(manager, Community, communityId, 'member_count', -1);
    });

    return { joined: false, memberCount };
  }

  /** Admin-only: edit or archive. Archiving closes it to new posts; nothing is deleted. */
  async updateCommunity(adminId: string, id: string, dto: UpdateCommunityDto): Promise<CommunityView> {
    const community = await this.communityRepo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!community) throw new NotFoundException(`Community ${id} not found`);

    await this.communityRepo.update({ id }, { ...dto });
    const updated = await this.communityRepo.findOneOrFail({ where: { id } });

    await this.tryAudit({
      actorId: adminId,
      action: AuditAction.COMMUNITY_CREATED,
      resourceId: id,
      resourceType: 'community',
      metadata: { updated: Object.keys(dto) },
    });

    const joined = await this.joinedIdsAmong(adminId, [id]);
    return this.toCommunityView(updated, joined.has(id));
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  /**
   * The one post feed: whole platform, one community, or only joined communities.
   * Keyset id DESC — ULIDs sort by time, so `id < :cursor` walks backwards without
   * the drift an OFFSET suffers as new posts arrive at the head.
   */
  async listFeed(
    userId: string,
    query: ListFeedDto,
  ): Promise<{ posts: PostView[]; nextCursor?: string }> {
    const qb = this.postRepo
      .createQueryBuilder('p')
      .innerJoin(Community, 'c', 'c.id = p.community_id')
      .where('p.status = :status', { status: CommunityContentStatus.PUBLISHED })
      .andWhere('p.deleted_at IS NULL')
      .andWhere('c.status = :cStatus', { cStatus: CommunityStatus.ACTIVE })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('p.id', 'DESC')
      .take(query.limit + 1);

    if (query.cursor) qb.andWhere('p.id < :cursor', { cursor: query.cursor });
    if (query.communityId) qb.andWhere('p.community_id = :communityId', { communityId: query.communityId });
    if (query.tag) qb.andWhere('p.tags @> ARRAY[:tag]::text[]', { tag: query.tag });
    if (query.joinedOnly) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM community_memberships m
                 WHERE m.community_id = p.community_id AND m.user_id = :userId AND m.deleted_at IS NULL)`,
        { userId },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { posts: await this.toPostViews(userId, rows), nextCursor };
  }

  /** The caller's own posts, newest first — both dashboards' "My Posts" tab. */
  async listMyPosts(
    userId: string,
    query: PaginationDto,
  ): Promise<{ posts: PostView[]; nextCursor?: string }> {
    const qb = this.postRepo
      .createQueryBuilder('p')
      .where('p.author_user_id = :userId', { userId })
      .andWhere('p.deleted_at IS NULL')
      .orderBy('p.id', 'DESC')
      .take(query.limit + 1);

    if (query.cursor) qb.andWhere('p.id < :cursor', { cursor: query.cursor });

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { posts: await this.toPostViews(userId, rows), nextCursor };
  }

  /**
   * Published posts nobody has answered yet — the professional dashboard's queue.
   * Deliberately not "urgent": urgency has no server-side definition, and a filter
   * chip that sorts by a fabricated flag is worse than one that sorts by nothing.
   */
  async listUnanswered(
    userId: string,
    query: PaginationDto,
  ): Promise<{ posts: PostView[]; nextCursor?: string }> {
    const qb = this.postRepo
      .createQueryBuilder('p')
      .innerJoin(Community, 'c', 'c.id = p.community_id')
      .where('p.status = :status', { status: CommunityContentStatus.PUBLISHED })
      .andWhere('p.deleted_at IS NULL')
      .andWhere('p.comment_count = 0')
      .andWhere('p.author_user_id <> :userId', { userId })
      .andWhere('c.status = :cStatus', { cStatus: CommunityStatus.ACTIVE })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('p.id', 'DESC')
      .take(query.limit + 1);

    if (query.cursor) qb.andWhere('p.id < :cursor', { cursor: query.cursor });

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { posts: await this.toPostViews(userId, rows), nextCursor };
  }

  /** 403 unless the caller holds an active membership in the community. */
  async createPost(userId: string, communityId: string, dto: CreatePostDto): Promise<PostView> {
    await this.requireActiveCommunity(communityId);
    await this.requireMembership(userId, communityId);

    const post = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(CommunityPost, {
        id: ulid(),
        communityId,
        authorUserId: userId,
        title: dto.title ?? null,
        body: dto.body,
        tags: dto.tags ?? [],
        status: CommunityContentStatus.PUBLISHED,
        commentCount: 0,
        reactionCount: 0,
        lastActivityAt: new Date(),
      });
      await manager.save(CommunityPost, created);
      await this.bumpCounter(manager, Community, communityId, 'post_count', +1);
      return created;
    });

    const [view] = await this.toPostViews(userId, [post]);
    return view;
  }

  /**
   * Hidden posts are visible to their author, with hiddenReason, and 404 to everyone
   * else — a 403 would confirm the content exists, which is the thing a moderator
   * just decided should not be discoverable.
   */
  async getPost(userId: string, postId: string): Promise<PostView> {
    const post = await this.postRepo.findOne({ where: { id: postId, deletedAt: IsNull() } });
    if (!post) throw new NotFoundException(`Post ${postId} not found`);
    if (post.status === CommunityContentStatus.HIDDEN && post.authorUserId !== userId) {
      throw new NotFoundException(`Post ${postId} not found`);
    }
    const [view] = await this.toPostViews(userId, [post]);
    return view;
  }

  /** Author-only. 409 once hidden: nobody edits their way out of moderation. */
  async updatePost(userId: string, postId: string, dto: UpdatePostDto): Promise<PostView> {
    const post = await this.requireOwnPost(userId, postId);
    if (post.status === CommunityContentStatus.HIDDEN) {
      throw new ConflictException('This post has been removed by a moderator and cannot be edited');
    }

    await this.postRepo.update({ id: postId }, { ...dto });
    const updated = await this.postRepo.findOneOrFail({ where: { id: postId } });
    const [view] = await this.toPostViews(userId, [updated]);
    return view;
  }

  /** Author-only soft delete. Report and audit rows survive it. */
  async deletePost(userId: string, postId: string): Promise<{ id: string; deletedAt: Date }> {
    const post = await this.requireOwnPost(userId, postId);
    const deletedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(CommunityPost, { id: postId });
      // Only adjust the community counter if the post was still counted — a hidden
      // post already decremented it.
      if (post.status === CommunityContentStatus.PUBLISHED) {
        await this.bumpCounter(manager, Community, post.communityId, 'post_count', -1);
      }
    });

    return { id: postId, deletedAt };
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  /** Keyset id ASC so a thread reads top-down, oldest first. */
  async listComments(
    userId: string,
    postId: string,
    query: PaginationDto,
  ): Promise<{ comments: CommentView[]; nextCursor?: string }> {
    // Resolves visibility first: a hidden post's comments must not be reachable by
    // guessing the post id.
    await this.getPost(userId, postId);

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .where('c.post_id = :postId', { postId })
      .andWhere('c.status = :status', { status: CommunityContentStatus.PUBLISHED })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.id', 'ASC')
      .take(query.limit + 1);

    if (query.cursor) qb.andWhere('c.id > :cursor', { cursor: query.cursor });

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { comments: await this.toCommentViews(userId, rows), nextCursor };
  }

  /**
   * Adds a comment or a reply, bumps the post's counters, then notifies the author.
   *
   * Nesting is one level. A reply pointing at another reply is re-parented onto its
   * top-level ancestor rather than rejected — the client should not have to know the
   * depth rule to post successfully, and a 422 here reads as a bug to the user.
   */
  async createComment(userId: string, postId: string, dto: CreateCommentDto): Promise<CommentView> {
    const post = await this.getPost(userId, postId);
    if (post.status === CommunityContentStatus.HIDDEN) {
      throw new ConflictException('This post has been removed and is closed to replies');
    }
    await this.requireActiveCommunity(post.communityId);
    await this.requireMembership(userId, post.communityId);

    let parentCommentId: string | null = null;
    if (dto.parentCommentId) {
      const parent = await this.commentRepo.findOne({
        where: { id: dto.parentCommentId, postId, deletedAt: IsNull() },
      });
      if (!parent) throw new NotFoundException(`Comment ${dto.parentCommentId} not found on this post`);
      parentCommentId = parent.parentCommentId ?? parent.id;
    }

    const comment = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(CommunityComment, {
        id: ulid(),
        postId,
        parentCommentId,
        communityId: post.communityId,
        authorUserId: userId,
        body: dto.body,
        status: CommunityContentStatus.PUBLISHED,
        reactionCount: 0,
      });
      await manager.save(CommunityComment, created);
      await manager
        .createQueryBuilder()
        .update(CommunityPost)
        .set({ commentCount: () => 'comment_count + 1', lastActivityAt: () => 'now()' })
        .where('id = :id', { id: postId })
        .execute();
      return created;
    });

    // Never notify yourself for your own reply.
    if (post.author.userId !== userId) {
      await this.tryNotify(post.author.userId, NotificationType.COMMUNITY_POST_REPLY, {
        postId,
        postTitle: post.title ?? 'your post',
        communityId: post.communityId,
        communityName: post.communityName,
        commentId: comment.id,
        authorName: (await this.resolveAuthors([userId])).get(userId)?.displayName ?? 'Someone',
      });
    }

    const [view] = await this.toCommentViews(userId, [comment]);
    return view;
  }

  /** Author-only. 409 once hidden. */
  async updateComment(userId: string, commentId: string, dto: UpdateCommentDto): Promise<CommentView> {
    const comment = await this.requireOwnComment(userId, commentId);
    if (comment.status === CommunityContentStatus.HIDDEN) {
      throw new ConflictException('This comment has been removed by a moderator and cannot be edited');
    }

    await this.commentRepo.update({ id: commentId }, { body: dto.body });
    const updated = await this.commentRepo.findOneOrFail({ where: { id: commentId } });
    const [view] = await this.toCommentViews(userId, [updated]);
    return view;
  }

  /** Author-only soft delete; decrements the parent post's comment counter. */
  async deleteComment(userId: string, commentId: string): Promise<{ id: string; deletedAt: Date }> {
    const comment = await this.requireOwnComment(userId, commentId);
    const deletedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(CommunityComment, { id: commentId });
      if (comment.status === CommunityContentStatus.PUBLISHED) {
        await this.bumpCounter(manager, CommunityPost, comment.postId, 'comment_count', -1);
      }
    });

    return { id: commentId, deletedAt };
  }

  // ── Reactions ──────────────────────────────────────────────────────────────

  /**
   * Marks a post or comment helpful. Idempotent — a second call inserts nothing and
   * does not double-count. POST/DELETE rather than a toggle: a toggle double-fired by
   * a flaky client silently un-likes.
   *
   * Marking your own content is a 409. That keeps `helpfulMarks` an index-only count:
   * excluding self-reactions at read time would need a heap fetch per row.
   */
  async react(
    userId: string,
    target: CommunityReportTarget,
    targetId: string,
  ): Promise<{ reacted: true; reactionCount: number }> {
    const { authorUserId, currentCount, title, communityName } = await this.loadReactionTarget(userId, target, targetId);
    if (authorUserId === userId) {
      throw new ConflictException('You cannot mark your own contribution as helpful');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(CommunityReaction, {
        where:
          target === CommunityReportTarget.POST
            ? { userId, postId: targetId, type: CommunityReactionType.LIKE }
            : { userId, commentId: targetId, type: CommunityReactionType.LIKE },
      });
      if (existing) return { count: currentCount, inserted: false };

      await manager.save(
        manager.create(CommunityReaction, {
          id: ulid(),
          userId,
          postId: target === CommunityReportTarget.POST ? targetId : null,
          commentId: target === CommunityReportTarget.COMMENT ? targetId : null,
          targetAuthorUserId: authorUserId,
          type: CommunityReactionType.LIKE,
        }),
      );

      const entity = target === CommunityReportTarget.POST ? CommunityPost : CommunityComment;
      const count = await this.bumpCounter(manager, entity, targetId, 'reaction_count', +1);
      return { count, inserted: true };
    });

    if (result.inserted && REACTION_MILESTONES.includes(result.count)) {
      await this.tryNotify(authorUserId, NotificationType.COMMUNITY_REACTION_MILESTONE, {
        targetType: target,
        targetId,
        postTitle: title,
        communityName,
        count: result.count,
      });
    }

    return { reacted: true, reactionCount: result.count };
  }

  /**
   * Removes the mark. A HARD delete, never a soft one: a soft-deleted row still
   * occupies the partial unique index, so re-reacting would violate it and surface as
   * a 500. There is no audit value in retaining an unlike.
   */
  async unreact(
    userId: string,
    target: CommunityReportTarget,
    targetId: string,
  ): Promise<{ reacted: false; reactionCount: number }> {
    const { currentCount } = await this.loadReactionTarget(userId, target, targetId);

    const count = await this.dataSource.transaction(async (manager) => {
      const where =
        target === CommunityReportTarget.POST
          ? { userId, postId: targetId, type: CommunityReactionType.LIKE }
          : { userId, commentId: targetId, type: CommunityReactionType.LIKE };

      const deleted = await manager.delete(CommunityReaction, where);
      if (!deleted.affected) return currentCount;

      const entity = target === CommunityReportTarget.POST ? CommunityPost : CommunityComment;
      return this.bumpCounter(manager, entity, targetId, 'reaction_count', -1);
    });

    return { reacted: false, reactionCount: count };
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  /**
   * Files a report, audits it, and tells the admins. 409 if this reporter already has
   * one open on this target — the partial unique index backs it, so a race loses too.
   */
  async reportContent(
    userId: string,
    target: CommunityReportTarget,
    targetId: string,
    dto: CreateReportDto,
  ): Promise<{ id: string; status: CommunityReportStatus }> {
    const { communityId, body, authorUserId } = await this.loadReportTarget(target, targetId);
    if (authorUserId === userId) {
      throw new ConflictException('You cannot report your own contribution — delete it instead');
    }

    const open = await this.reportRepo.findOne({
      where: {
        reporterUserId: userId,
        status: CommunityReportStatus.PENDING,
        deletedAt: IsNull(),
        ...(target === CommunityReportTarget.POST ? { postId: targetId } : { commentId: targetId }),
      },
    });
    if (open) {
      throw new ConflictException('You have already reported this — a moderator is looking at it');
    }

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        id: ulid(),
        reporterUserId: userId,
        postId: target === CommunityReportTarget.POST ? targetId : null,
        commentId: target === CommunityReportTarget.COMMENT ? targetId : null,
        communityId,
        reason: dto.reason,
        details: dto.details ?? null,
        status: CommunityReportStatus.PENDING,
      }),
    );

    await this.tryAudit({
      actorId: userId,
      action: AuditAction.COMMUNITY_REPORT_SUBMITTED,
      resourceId: report.id,
      resourceType: 'community_report',
      metadata: { targetType: target, targetId, communityId, reason: dto.reason },
    });

    const community = await this.communityRepo.findOne({ where: { id: communityId } });
    const job: CommunityReportJob = {
      reportId: report.id,
      targetType: target,
      targetId,
      communityId,
      communityName: community?.name ?? 'a community',
      reason: dto.reason,
      excerpt: body.slice(0, 140),
    };
    // Guarded: the report has committed, and a Redis outage must not make a
    // successful write look like a failure to the reporter.
    try {
      await this.adminQueue.add(COMMUNITY_REPORT_JOB, job);
    } catch (err) {
      this.logger.error(`Failed to enqueue community report ${report.id}: ${(err as Error).message}`);
    }

    return { id: report.id, status: report.status };
  }

  // ── Stats and discovery ────────────────────────────────────────────────────

  /**
   * The caller's own numbers for the professional and benefactor dashboards.
   *
   * Every count here is a real index-backed COUNT(). None of them reads the
   * denormalised display counters — that split is the whole safety argument for
   * denormalising those: drift from a crashed transaction or a manual fix can never
   * corrupt a number a professional puts on their profile.
   */
  async getStats(userId: string): Promise<CommunityStatsView> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [questionsAnswered, communitiesJoined, helpfulMarks, postsWritten, postsThisMonth] =
      await Promise.all([
        this.commentRepo
          .createQueryBuilder('c')
          .where('c.author_user_id = :userId', { userId })
          .andWhere('c.status = :status', { status: CommunityContentStatus.PUBLISHED })
          .andWhere('c.deleted_at IS NULL')
          .getCount(),
        this.membershipRepo
          .createQueryBuilder('m')
          .where('m.user_id = :userId', { userId })
          .andWhere('m.deleted_at IS NULL')
          .getCount(),
        this.reactionRepo
          .createQueryBuilder('r')
          .where('r.target_author_user_id = :userId', { userId })
          // Index-only via the partial IDX_..._target_author_live; see the note on
          // CommunityReaction.targetAuthorUserId.
          .andWhere('r.deleted_at IS NULL')
          .getCount(),
        this.postRepo
          .createQueryBuilder('p')
          .where('p.author_user_id = :userId', { userId })
          .andWhere('p.status = :status', { status: CommunityContentStatus.PUBLISHED })
          .andWhere('p.deleted_at IS NULL')
          .getCount(),
        this.postRepo
          .createQueryBuilder('p')
          .where('p.author_user_id = :userId', { userId })
          .andWhere('p.status = :status', { status: CommunityContentStatus.PUBLISHED })
          .andWhere('p.deleted_at IS NULL')
          .andWhere('p.created_at >= :monthStart', { monthStart })
          .getCount(),
      ]);

    return { questionsAnswered, communitiesJoined, helpfulMarks, postsWritten, postsThisMonth };
  }

  /** The four tiles across the top of the portal. Platform-wide, not per-user. */
  async getOverview(): Promise<CommunityOverviewView> {
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [memberRow, postsThisWeek, activeRow, communityCount] = await Promise.all([
      this.membershipRepo
        .createQueryBuilder('m')
        .select('COUNT(DISTINCT m.user_id)', 'count')
        .where('m.deleted_at IS NULL')
        .getRawOne<{ count: string }>(),
      this.postRepo
        .createQueryBuilder('p')
        .where('p.status = :status', { status: CommunityContentStatus.PUBLISHED })
        .andWhere('p.deleted_at IS NULL')
        .andWhere('p.created_at >= :since', { since })
        .getCount(),
      // GROUP BY rather than COUNT(DISTINCT): Postgres sorts for a DISTINCT
      // aggregate but hash-aggregates a GROUP BY. Measured over 2M comments that
      // is 449ms against 29ms, for the same answer.
      this.commentRepo.manager.query(
        `SELECT COUNT(*)::int AS count FROM (
           SELECT 1 FROM community_comments c
            WHERE c.status = $1 AND c.deleted_at IS NULL AND c.created_at >= $2
            GROUP BY c.post_id
         ) s`,
        [CommunityContentStatus.PUBLISHED, since],
      ) as Promise<Array<{ count: number }>>,
      this.communityRepo
        .createQueryBuilder('c')
        .where('c.status = :status', { status: CommunityStatus.ACTIVE })
        .andWhere('c.deleted_at IS NULL')
        .getCount(),
    ]);

    return {
      // Raw COUNT() comes back as a string from pg — Number() it here rather than
      // letting a numeric-looking string reach the client.
      memberCount: Number(memberRow?.count ?? 0),
      postsThisWeek,
      activeDiscussions: Number(activeRow[0]?.count ?? 0),
      communityCount,
    };
  }

  /**
   * The Trending tab, computed by unnesting the tags actually on recent posts — so it
   * can never list a tag no post carries, which is exactly what the hardcoded mock it
   * replaces did.
   */
  async getTrending(): Promise<TrendingTag[]> {
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Raw rather than QueryBuilder: `unnest(...) AS t(tag)` is a set-returning
    // function in the FROM clause, which the QueryBuilder's join API cannot alias a
    // column out of. Same idiom MatchingService already uses over condition_tags.
    const rows: Array<{ tag: string; count: number }> = await this.postRepo.manager.query(
      `SELECT t.tag, COUNT(p.id)::int AS count
         FROM community_posts p, unnest(p.tags) AS t(tag)
        WHERE p.status = $1 AND p.deleted_at IS NULL AND p.created_at >= $2
        GROUP BY t.tag
        ORDER BY count DESC, t.tag ASC
        LIMIT $3`,
      [CommunityContentStatus.PUBLISHED, since, TRENDING_LIMIT],
    );

    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  // ── Moderation (platform_admin) ────────────────────────────────────────────

  /** The moderation queue, keyset id DESC, each row carrying a content snapshot. */
  async listReports(query: ListReportsDto): Promise<{ reports: ReportView[]; nextCursor?: string }> {
    const qb = this.reportRepo
      .createQueryBuilder('r')
      .where('r.deleted_at IS NULL')
      .orderBy('r.id', 'DESC')
      .take(query.limit + 1);

    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.cursor) qb.andWhere('r.id < :cursor', { cursor: query.cursor });

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { reports: await this.toReportViews(rows), nextCursor };
  }

  /**
   * Hide or dismiss.
   *
   * `hide` closes EVERY pending report on the same target — one action resolves the
   * whole pile. `dismiss` closes only the named report, because a different reporter's
   * complaint about the same content may have merit for a different reason.
   */
  async resolveReport(adminId: string, reportId: string, dto: ResolveReportDto): Promise<ReportView> {
    const report = await this.reportRepo.findOne({ where: { id: reportId, deletedAt: IsNull() } });
    if (!report) throw new NotFoundException(`Report ${reportId} not found`);
    if (report.status !== CommunityReportStatus.PENDING) {
      throw new ConflictException('This report has already been reviewed');
    }

    const target = report.postId ? CommunityReportTarget.POST : CommunityReportTarget.COMMENT;
    const targetId = (report.postId ?? report.commentId) as string;
    const hiding = dto.action === CommunityModerationAction.HIDE;
    const reviewedAt = new Date();

    const notifyReporters: string[] = [];
    let contentAuthorId: string | undefined;

    await this.dataSource.transaction(async (manager) => {
      if (hiding) {
        contentAuthorId = await this.hideTarget(manager, target, targetId, adminId, dto.note as string);

        // Close every other pending complaint about the same content.
        const others = await manager.find(CommunityReport, {
          where: {
            status: CommunityReportStatus.PENDING,
            deletedAt: IsNull(),
            ...(target === CommunityReportTarget.POST ? { postId: targetId } : { commentId: targetId }),
          },
        });
        notifyReporters.push(...others.map((r) => r.reporterUserId));

        await manager
          .createQueryBuilder()
          .update(CommunityReport)
          .set({
            status: CommunityReportStatus.ACTIONED,
            reviewedAt,
            reviewedBy: adminId,
            resolutionNote: dto.note ?? null,
          })
          .where('id IN (:...ids)', { ids: others.map((r) => r.id) })
          .execute();
      } else {
        notifyReporters.push(report.reporterUserId);
        await manager.update(
          CommunityReport,
          { id: reportId },
          {
            status: CommunityReportStatus.DISMISSED,
            reviewedAt,
            reviewedBy: adminId,
            resolutionNote: dto.note ?? null,
          },
        );
      }
    });

    // Everything below is post-commit and independently guarded: a notification
    // failure must not roll back a moderation decision that already stuck.
    await this.tryAudit({
      actorId: adminId,
      action: hiding ? AuditAction.COMMUNITY_CONTENT_HIDDEN : AuditAction.COMMUNITY_REPORT_RESOLVED,
      resourceId: targetId,
      resourceType: target === CommunityReportTarget.POST ? 'community_post' : 'community_comment',
      metadata: { reportId, action: dto.action, communityId: report.communityId },
    });

    if (hiding && contentAuthorId) {
      const community = await this.communityRepo.findOne({ where: { id: report.communityId } });
      await this.tryNotify(contentAuthorId, NotificationType.COMMUNITY_CONTENT_HIDDEN, {
        targetType: target,
        targetId,
        communityId: report.communityId,
        communityName: community?.name ?? 'the community',
        reason: dto.note,
      });
    }

    try {
      await this.notificationsService.createBulk(
        [...new Set(notifyReporters)],
        NotificationType.COMMUNITY_REPORT_RESOLVED,
        { targetType: target, targetId, actioned: hiding },
      );
    } catch (err) {
      this.logger.error(`Failed to notify reporters for ${reportId}: ${(err as Error).message}`);
    }

    const updated = await this.reportRepo.findOneOrFail({ where: { id: reportId } });
    const [view] = await this.toReportViews([updated]);
    return view;
  }

  /** Direct hide/restore of a post, independent of any report. */
  async setPostVisibility(adminId: string, postId: string, dto: SetVisibilityDto): Promise<PostView> {
    const post = await this.postRepo.findOne({ where: { id: postId, deletedAt: IsNull() } });
    if (!post) throw new NotFoundException(`Post ${postId} not found`);

    await this.dataSource.transaction(async (manager) => {
      if (dto.hidden) {
        await this.hideTarget(manager, CommunityReportTarget.POST, postId, adminId, dto.reason as string);
      } else {
        await this.restoreTarget(manager, CommunityReportTarget.POST, postId);
      }
    });

    await this.afterVisibilityChange(adminId, CommunityReportTarget.POST, postId, post.authorUserId, post.communityId, dto);
    const updated = await this.postRepo.findOneOrFail({ where: { id: postId } });
    const [view] = await this.toPostViews(post.authorUserId, [updated]);
    return view;
  }

  /** Direct hide/restore of a comment. */
  async setCommentVisibility(adminId: string, commentId: string, dto: SetVisibilityDto): Promise<CommentView> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, deletedAt: IsNull() } });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);

    await this.dataSource.transaction(async (manager) => {
      if (dto.hidden) {
        await this.hideTarget(manager, CommunityReportTarget.COMMENT, commentId, adminId, dto.reason as string);
      } else {
        await this.restoreTarget(manager, CommunityReportTarget.COMMENT, commentId);
      }
    });

    await this.afterVisibilityChange(
      adminId,
      CommunityReportTarget.COMMENT,
      commentId,
      comment.authorUserId,
      comment.communityId,
      dto,
    );
    const updated = await this.commentRepo.findOneOrFail({ where: { id: commentId } });
    const [view] = await this.toCommentViews(comment.authorUserId, [updated]);
    return view;
  }

  // ── Author display ─────────────────────────────────────────────────────────

  /**
   * userId → display name and verified badge, for a whole page in one query.
   *
   * PRIVACY: this selects `patients.name` and nothing else from the patients table —
   * never phone, condition_tags, medication_list or location_state. The raw name
   * never leaves this service; only the transformed initial form ("Amaka O.") reaches
   * a PostView. Every join below hits a unique index on user_id, so a 20-post page is
   * 20 primary-key lookups plus 60 unique-index probes.
   *
   * Derived at read time and never snapshotted onto the content row: `verified` is a
   * live claim. A professional whose licence is revoked must lose the badge on
   * everything they ever wrote, on their next request — not on the next backfill.
   */
  private async resolveAuthors(userIds: string[]): Promise<Map<string, AuthorDisplay>> {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (unique.length === 0) return new Map();

    const rows = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('patients', 'p', 'p.user_id = u.id AND p.deleted_at IS NULL')
      .leftJoin('professional_applications', 'pa', 'pa.user_id = u.id AND pa.deleted_at IS NULL')
      .leftJoin('benefactor_applications', 'ba', 'ba.user_id = u.id AND ba.deleted_at IS NULL')
      .select([
        'u.id AS "userId"',
        'u.role AS role',
        'u.name AS "userName"',
        'u.status AS "userStatus"',
        'p.name AS "patientName"',
        'pa.status AS "professionalStatus"',
        'pa.specialty AS specialty',
        'ba.full_name AS "benefactorName"',
        'ba.status AS "benefactorStatus"',
      ])
      .where('u.id IN (:...ids)', { ids: unique })
      .getRawMany<{
        userId: string;
        role: UserRole;
        userName: string | null;
        userStatus: string;
        patientName: string | null;
        professionalStatus: string | null;
        specialty: string | null;
        benefactorName: string | null;
        benefactorStatus: string | null;
      }>();

    const map = new Map<string, AuthorDisplay>();
    for (const r of rows) {
      const active = r.userStatus === 'active';
      let display: AuthorDisplay;

      if (r.role === UserRole.PROFESSIONAL) {
        const verified = active && r.professionalStatus === 'approved';
        display = {
          userId: r.userId,
          displayName: r.userName || 'Health professional',
          initial: '',
          verified,
          badge: verified ? 'verified-professional' : undefined,
          specialty: verified ? r.specialty : undefined,
        };
      } else if (r.role === UserRole.BENEFACTOR) {
        const verified = active && r.benefactorStatus === 'approved';
        display = {
          userId: r.userId,
          displayName: r.benefactorName || r.userName || 'Benefactor',
          initial: '',
          verified,
          badge: verified ? 'verified-benefactor' : undefined,
        };
      } else {
        // Patients — and any other role that somehow holds a post — are pseudonymised.
        display = {
          userId: r.userId,
          displayName: this.toPatientDisplayName(r.patientName ?? r.userName),
          initial: '',
          verified: false,
        };
      }

      display.initial = display.displayName.charAt(0).toUpperCase();
      map.set(r.userId, display);
    }
    return map;
  }

  /**
   * "Amaka Okafor" → "Amaka O.". A single token is returned whole; a missing name
   * degrades to a neutral label rather than an empty string.
   *
   * The transform is policy, not data, which is why it lives here and not in a
   * column: changing the rule must change every historical post on the next request.
   */
  private toPatientDisplayName(name?: string | null): string {
    const tokens = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 'Community member';
    if (tokens.length === 1) return tokens[0];
    return `${tokens[0]} ${tokens[tokens.length - 1].charAt(0).toUpperCase()}.`;
  }

  // ── View mapping ───────────────────────────────────────────────────────────

  private toCommunityView(c: Community, joined: boolean): CommunityView {
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description ?? null,
      icon: c.icon ?? null,
      accent: c.accent ?? null,
      disclaimer: c.disclaimer ?? null,
      tags: c.tags ?? [],
      status: c.status,
      memberCount: c.memberCount,
      postCount: c.postCount,
      joined,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private async toPostViews(userId: string, posts: CommunityPost[]): Promise<PostView[]> {
    if (posts.length === 0) return [];

    const [authors, reacted, communities] = await Promise.all([
      this.resolveAuthors(posts.map((p) => p.authorUserId)),
      this.reactedIdsAmong(userId, CommunityReportTarget.POST, posts.map((p) => p.id)),
      this.communityRepo.find({ where: { id: In([...new Set(posts.map((p) => p.communityId))]) } }),
    ]);
    const byCommunity = new Map(communities.map((c) => [c.id, c]));

    return posts.map((p) => {
      const community = byCommunity.get(p.communityId);
      return {
        id: p.id,
        communityId: p.communityId,
        communityName: community?.name ?? 'Community',
        communityAccent: community?.accent ?? null,
        author: authors.get(p.authorUserId) ?? this.unknownAuthor(p.authorUserId),
        title: p.title ?? null,
        body: p.body,
        tags: p.tags ?? [],
        commentCount: p.commentCount,
        reactionCount: p.reactionCount,
        reactedByMe: reacted.has(p.id),
        createdAt: p.createdAt.toISOString(),
        lastActivityAt: p.lastActivityAt.toISOString(),
        status: p.status,
        visibleToOthers: p.status === CommunityContentStatus.PUBLISHED,
        hiddenReason: p.hiddenReason ?? null,
        hiddenAt: p.hiddenAt ? p.hiddenAt.toISOString() : null,
      };
    });
  }

  private async toCommentViews(userId: string, comments: CommunityComment[]): Promise<CommentView[]> {
    if (comments.length === 0) return [];

    const [authors, reacted] = await Promise.all([
      this.resolveAuthors(comments.map((c) => c.authorUserId)),
      this.reactedIdsAmong(userId, CommunityReportTarget.COMMENT, comments.map((c) => c.id)),
    ]);

    return comments.map((c) => ({
      id: c.id,
      postId: c.postId,
      parentCommentId: c.parentCommentId ?? null,
      author: authors.get(c.authorUserId) ?? this.unknownAuthor(c.authorUserId),
      body: c.body,
      reactionCount: c.reactionCount,
      reactedByMe: reacted.has(c.id),
      createdAt: c.createdAt.toISOString(),
      status: c.status,
      visibleToOthers: c.status === CommunityContentStatus.PUBLISHED,
      hiddenReason: c.hiddenReason ?? null,
    }));
  }

  private async toReportViews(reports: CommunityReport[]): Promise<ReportView[]> {
    if (reports.length === 0) return [];

    const postIds = reports.map((r) => r.postId).filter((id): id is string => !!id);
    const commentIds = reports.map((r) => r.commentId).filter((id): id is string => !!id);

    const [posts, comments, communities] = await Promise.all([
      postIds.length ? this.postRepo.find({ where: { id: In(postIds) }, withDeleted: true }) : Promise.resolve([]),
      commentIds.length
        ? this.commentRepo.find({ where: { id: In(commentIds) }, withDeleted: true })
        : Promise.resolve([]),
      this.communityRepo.find({ where: { id: In([...new Set(reports.map((r) => r.communityId))]) } }),
    ]);

    const authors = await this.resolveAuthors([
      ...reports.map((r) => r.reporterUserId),
      ...posts.map((p) => p.authorUserId),
      ...comments.map((c) => c.authorUserId),
    ]);

    const byPost = new Map(posts.map((p) => [p.id, p]));
    const byComment = new Map(comments.map((c) => [c.id, c]));
    const byCommunity = new Map(communities.map((c) => [c.id, c]));

    // How many people are still waiting on each target, so the queue can say
    // "4 people flagged this" rather than showing four indistinguishable rows.
    const openCounts = await this.openReportCounts(postIds, commentIds);

    return reports.map((r) => {
      const isPost = !!r.postId;
      const targetId = (r.postId ?? r.commentId) as string;
      const post = r.postId ? byPost.get(r.postId) : undefined;
      const comment = r.commentId ? byComment.get(r.commentId) : undefined;
      const targetAuthorId = post?.authorUserId ?? comment?.authorUserId ?? '';
      const targetAuthor = authors.get(targetAuthorId);

      return {
        id: r.id,
        targetType: isPost ? CommunityReportTarget.POST : CommunityReportTarget.COMMENT,
        targetId,
        communityId: r.communityId,
        communityName: byCommunity.get(r.communityId)?.name ?? 'Community',
        reason: r.reason,
        details: r.details ?? null,
        status: r.status,
        resolutionNote: r.resolutionNote ?? null,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        reviewedBy: r.reviewedBy ?? null,
        reporterDisplayName: authors.get(r.reporterUserId)?.displayName ?? 'A member',
        targetTitle: post?.title ?? null,
        targetBody: post?.body ?? comment?.body ?? '(content unavailable)',
        targetAuthorDisplayName: targetAuthor?.displayName ?? 'Unknown',
        targetAuthorVerified: targetAuthor?.verified ?? false,
        targetHidden: (post ?? comment)?.status === CommunityContentStatus.HIDDEN,
        openReportCount: openCounts.get(targetId) ?? 0,
      };
    });
  }

  /** Placeholder for an author whose user row has since gone. Never leaks an id as a name. */
  private unknownAuthor(userId: string): AuthorDisplay {
    return { userId, displayName: 'Community member', initial: 'C', verified: false };
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private async requireActiveCommunity(id: string): Promise<Community> {
    const community = await this.communityRepo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!community) throw new NotFoundException(`Community ${id} not found`);
    if (community.status !== CommunityStatus.ACTIVE) {
      throw new ConflictException('This community has been archived and is closed to new activity');
    }
    return community;
  }

  private async requireMembership(userId: string, communityId: string): Promise<void> {
    const membership = await this.membershipRepo.findOne({
      where: { communityId, userId, deletedAt: IsNull() },
    });
    if (!membership) {
      throw new ForbiddenException('Join this community before posting in it');
    }
  }

  private async requireOwnPost(userId: string, postId: string): Promise<CommunityPost> {
    const post = await this.postRepo.findOne({ where: { id: postId, deletedAt: IsNull() } });
    if (!post) throw new NotFoundException(`Post ${postId} not found`);
    if (post.authorUserId !== userId) {
      throw new ForbiddenException('You can only change your own posts');
    }
    return post;
  }

  private async requireOwnComment(userId: string, commentId: string): Promise<CommunityComment> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, deletedAt: IsNull() } });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    if (comment.authorUserId !== userId) {
      throw new ForbiddenException('You can only change your own comments');
    }
    return comment;
  }

  /** Which of these communities the user is currently in. */
  private async joinedIdsAmong(userId: string, communityIds: string[]): Promise<Set<string>> {
    if (communityIds.length === 0) return new Set();
    const rows = await this.membershipRepo.find({
      where: { userId, communityId: In(communityIds), deletedAt: IsNull() },
      select: { communityId: true },
    });
    return new Set(rows.map((r) => r.communityId));
  }

  /** Which of these posts/comments the user has already marked helpful. */
  private async reactedIdsAmong(
    userId: string,
    target: CommunityReportTarget,
    ids: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.reactionRepo.find({
      where:
        target === CommunityReportTarget.POST
          ? { userId, postId: In(ids) }
          : { userId, commentId: In(ids) },
    });
    return new Set(
      rows.map((r) => (target === CommunityReportTarget.POST ? r.postId : r.commentId)).filter((id): id is string => !!id),
    );
  }

  private async openReportCounts(postIds: string[], commentIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (postIds.length === 0 && commentIds.length === 0) return counts;

    const qb = this.reportRepo
      .createQueryBuilder('r')
      .select('COALESCE(r.post_id, r.comment_id)', 'targetId')
      .addSelect('COUNT(*)', 'count')
      .where('r.status = :status', { status: CommunityReportStatus.PENDING })
      .andWhere('r.deleted_at IS NULL')
      .groupBy('COALESCE(r.post_id, r.comment_id)');

    if (postIds.length && commentIds.length) {
      qb.andWhere('(r.post_id IN (:...postIds) OR r.comment_id IN (:...commentIds))', { postIds, commentIds });
    } else if (postIds.length) {
      qb.andWhere('r.post_id IN (:...postIds)', { postIds });
    } else {
      qb.andWhere('r.comment_id IN (:...commentIds)', { commentIds });
    }

    const rows = await qb.getRawMany<{ targetId: string; count: string }>();
    for (const r of rows) counts.set(r.targetId, Number(r.count));
    return counts;
  }

  /**
   * Moves a counter by ±1 and returns the new value.
   *
   * A SQL expression, never read-modify-write: two concurrent likes read the same
   * value in JS and one of the increments is lost. GREATEST clamps at zero so a
   * double-decrement from a retry cannot drive a displayed count negative.
   */
  private async bumpCounter(
    manager: EntityManager,
    entity: typeof Community | typeof CommunityPost | typeof CommunityComment,
    id: string,
    column: 'member_count' | 'post_count' | 'comment_count' | 'reaction_count',
    delta: 1 | -1,
  ): Promise<number> {
    const expr = delta > 0 ? `${column} + 1` : `GREATEST(${column} - 1, 0)`;
    const result = await manager
      .createQueryBuilder()
      .update(entity)
      .set({ [column.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())]: () => expr })
      .where('id = :id', { id })
      .returning(column)
      .execute();

    const raw = (result.raw as Array<Record<string, unknown>>)[0];
    return Number(raw?.[column] ?? 0);
  }

  private async loadReactionTarget(
    userId: string,
    target: CommunityReportTarget,
    targetId: string,
  ): Promise<{ authorUserId: string; currentCount: number; title?: string | null; communityName: string }> {
    if (target === CommunityReportTarget.POST) {
      const post = await this.getPost(userId, targetId);
      return {
        authorUserId: post.author.userId,
        currentCount: post.reactionCount,
        title: post.title,
        communityName: post.communityName,
      };
    }

    const comment = await this.commentRepo.findOne({ where: { id: targetId, deletedAt: IsNull() } });
    if (!comment || comment.status === CommunityContentStatus.HIDDEN) {
      throw new NotFoundException(`Comment ${targetId} not found`);
    }
    const community = await this.communityRepo.findOne({ where: { id: comment.communityId } });
    return {
      authorUserId: comment.authorUserId,
      currentCount: comment.reactionCount,
      title: 'your comment',
      communityName: community?.name ?? 'the community',
    };
  }

  private async loadReportTarget(
    target: CommunityReportTarget,
    targetId: string,
  ): Promise<{ communityId: string; body: string; authorUserId: string }> {
    if (target === CommunityReportTarget.POST) {
      const post = await this.postRepo.findOne({ where: { id: targetId, deletedAt: IsNull() } });
      if (!post) throw new NotFoundException(`Post ${targetId} not found`);
      return { communityId: post.communityId, body: post.body, authorUserId: post.authorUserId };
    }
    const comment = await this.commentRepo.findOne({ where: { id: targetId, deletedAt: IsNull() } });
    if (!comment) throw new NotFoundException(`Comment ${targetId} not found`);
    return { communityId: comment.communityId, body: comment.body, authorUserId: comment.authorUserId };
  }

  /**
   * Marks content hidden and adjusts the owning counter. Returns the author's id.
   *
   * The row is not deleted and not soft-deleted: the report that caused this points
   * at it, and removing it would destroy the evidence.
   *
   * Comments under a hidden POST are deliberately NOT cascade-hidden. They become
   * unreachable, but they stay published so they keep counting toward their own
   * authors' "Questions answered" — penalising a professional's answer count because
   * someone else's question was abusive would be wrong.
   */
  private async hideTarget(
    manager: EntityManager,
    target: CommunityReportTarget,
    targetId: string,
    adminId: string,
    reason: string,
  ): Promise<string> {
    if (target === CommunityReportTarget.POST) {
      const post = await manager.findOne(CommunityPost, { where: { id: targetId, deletedAt: IsNull() } });
      if (!post) throw new NotFoundException(`Post ${targetId} not found`);
      if (post.status === CommunityContentStatus.PUBLISHED) {
        await manager.update(
          CommunityPost,
          { id: targetId },
          { status: CommunityContentStatus.HIDDEN, hiddenAt: new Date(), hiddenBy: adminId, hiddenReason: reason },
        );
        await this.bumpCounter(manager, Community, post.communityId, 'post_count', -1);
      }
      return post.authorUserId;
    }

    const comment = await manager.findOne(CommunityComment, { where: { id: targetId, deletedAt: IsNull() } });
    if (!comment) throw new NotFoundException(`Comment ${targetId} not found`);
    if (comment.status === CommunityContentStatus.PUBLISHED) {
      await manager.update(
        CommunityComment,
        { id: targetId },
        { status: CommunityContentStatus.HIDDEN, hiddenAt: new Date(), hiddenBy: adminId, hiddenReason: reason },
      );
      await this.bumpCounter(manager, CommunityPost, comment.postId, 'comment_count', -1);
    }
    return comment.authorUserId;
  }

  /** Un-hides and re-increments. Reports already actioned stay actioned — the restore is its own event. */
  private async restoreTarget(
    manager: EntityManager,
    target: CommunityReportTarget,
    targetId: string,
  ): Promise<void> {
    if (target === CommunityReportTarget.POST) {
      const post = await manager.findOne(CommunityPost, { where: { id: targetId, deletedAt: IsNull() } });
      if (!post || post.status === CommunityContentStatus.PUBLISHED) return;
      await manager.update(
        CommunityPost,
        { id: targetId },
        { status: CommunityContentStatus.PUBLISHED, hiddenAt: null, hiddenBy: null, hiddenReason: null },
      );
      await this.bumpCounter(manager, Community, post.communityId, 'post_count', +1);
      return;
    }

    const comment = await manager.findOne(CommunityComment, { where: { id: targetId, deletedAt: IsNull() } });
    if (!comment || comment.status === CommunityContentStatus.PUBLISHED) return;
    await manager.update(
      CommunityComment,
      { id: targetId },
      { status: CommunityContentStatus.PUBLISHED, hiddenAt: null, hiddenBy: null, hiddenReason: null },
    );
    await this.bumpCounter(manager, CommunityPost, comment.postId, 'comment_count', +1);
  }

  private async afterVisibilityChange(
    adminId: string,
    target: CommunityReportTarget,
    targetId: string,
    authorUserId: string,
    communityId: string,
    dto: SetVisibilityDto,
  ): Promise<void> {
    await this.tryAudit({
      actorId: adminId,
      action: dto.hidden ? AuditAction.COMMUNITY_CONTENT_HIDDEN : AuditAction.COMMUNITY_CONTENT_RESTORED,
      resourceId: targetId,
      resourceType: target === CommunityReportTarget.POST ? 'community_post' : 'community_comment',
      metadata: { communityId, direct: true },
    });

    if (dto.hidden) {
      const community = await this.communityRepo.findOne({ where: { id: communityId } });
      await this.tryNotify(authorUserId, NotificationType.COMMUNITY_CONTENT_HIDDEN, {
        targetType: target,
        targetId,
        communityId,
        communityName: community?.name ?? 'the community',
        reason: dto.reason,
      });
    }
  }

  /** Slug from a name, made unique by suffix. Uniqueness is also enforced by index. */
  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(SLUG_ALLOWED, '-').replace(/^-|-$/g, '').slice(0, 60) || 'community';
    let candidate = base;
    for (let n = 2; n < 100; n++) {
      const clash = await this.communityRepo.findOne({ where: { slug: candidate, deletedAt: IsNull() } });
      if (!clash) return candidate;
      candidate = `${base}-${n}`;
    }
    // Falls back to something guaranteed unique rather than looping forever.
    return `${base}-${ulid().slice(-6).toLowerCase()}`;
  }

  /** Audit failures are logged, never propagated — they must not fail the user's request. */
  private async tryAudit(params: Parameters<AuditService['log']>[0]): Promise<void> {
    try {
      await this.auditService.log(params);
    } catch (err) {
      this.logger.error(`Failed to audit ${params.action} on ${params.resourceId}: ${(err as Error).message}`);
    }
  }

  private async tryNotify(userId: string, type: NotificationType, payload: object): Promise<void> {
    try {
      await this.notificationsService.createOne(userId, type, payload);
    } catch (err) {
      this.logger.error(`Failed to notify ${userId} of ${type}: ${(err as Error).message}`);
    }
  }
}
