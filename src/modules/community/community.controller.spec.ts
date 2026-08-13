import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';
import { CommunityReportStatus, CommunityReportTarget } from 'src/common/enums';

import { CommunityController, CommunityModerationController } from './community.controller';
import { CommunityService } from './community.service';

const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZUSER';
const TEST_ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZADMN';
const COMMUNITY_ID = '01HZZZZZZZZZZZZZZZZZZZZCOM';
const POST_ID = '01HZZZZZZZZZZZZZZZZZZZPOST';
const REPORT_ID = '01HZZZZZZZZZZZZZZZZZZZZRPT';

const mockPost = {
  id: POST_ID,
  communityId: COMMUNITY_ID,
  author: { userId: TEST_USER_ID, displayName: 'Amaka O.', initial: 'A', verified: false },
  body: 'Any tips?',
};

const mockCommunityService = {
  listCommunities: jest.fn(),
  getCommunity: jest.fn(),
  createCommunity: jest.fn(),
  joinCommunity: jest.fn(),
  leaveCommunity: jest.fn(),
  listFeed: jest.fn(),
  listMyPosts: jest.fn(),
  listUnanswered: jest.fn(),
  createPost: jest.fn(),
  getPost: jest.fn(),
  updatePost: jest.fn(),
  deletePost: jest.fn(),
  listComments: jest.fn(),
  listReplies: jest.fn(),
  createComment: jest.fn(),
  updateComment: jest.fn(),
  deleteComment: jest.fn(),
  react: jest.fn(),
  unreact: jest.fn(),
  reportContent: jest.fn(),
  getStats: jest.fn(),
  getOverview: jest.fn(),
  getTrending: jest.fn(),
  listReports: jest.fn(),
  resolveReport: jest.fn(),
  setPostVisibility: jest.fn(),
  setCommentVisibility: jest.fn(),
  updateCommunity: jest.fn(),
};

function guardFor(userId: string, role: string) {
  return {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { sub: userId, role };
      return true;
    },
  };
}

const participantGuard = guardFor(TEST_USER_ID, 'patient');
const adminGuard = guardFor(TEST_ADMIN_ID, 'platform_admin');

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

// The global throttler guard is an APP_GUARD in production; here it would need a
// Redis-backed storage, so it is stubbed out. The per-route @Throttle metadata is
// still declared on the handlers — this only prevents the guard from running.
const allowThrottle = { canActivate: () => true };

function withPipe(app: INestApplication): INestApplication {
  // Registered for real, not stubbed: several assertions below turn on the
  // difference between a hand-wrapped { data, meta } handler and a bare one, and
  // that difference only exists once this interceptor is in the chain.
  app.useGlobalInterceptors(new TransformInterceptor());
  // Must match main.ts exactly, exceptionFactory included, or the 422 assertions
  // below silently pass as 400s.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          errors: errors.map((e) => ({
            path: e.property,
            message: Object.values(e.constraints ?? {}).join('; '),
          })),
        }),
    }),
  );
  return app;
}

async function buildParticipantApp(roleGuardOverride = participantGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [CommunityController],
    providers: [{ provide: CommunityService, useValue: mockCommunityService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(participantGuard)
    .overrideGuard(RoleGuard)
    .useValue(roleGuardOverride)
    .overrideGuard(ThrottlerGuard)
    .useValue(allowThrottle)
    .compile();

  const app = withPipe(moduleRef.createNestApplication());
  await app.init();
  return app;
}

async function buildAdminApp(roleGuardOverride = adminGuard): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [CommunityModerationController],
    providers: [{ provide: CommunityService, useValue: mockCommunityService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(adminGuard)
    .overrideGuard(RoleGuard)
    .useValue(roleGuardOverride)
    .overrideGuard(ThrottlerGuard)
    .useValue(allowThrottle)
    .compile();

  const app = withPipe(moduleRef.createNestApplication());
  await app.init();
  return app;
}

describe('CommunityController', () => {
  let app: INestApplication;

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => await app?.close());

  describe('GET /community/communities', () => {
    it('returns 200 with a cursor in meta', async () => {
      mockCommunityService.listCommunities.mockResolvedValue({
        communities: [{ id: COMMUNITY_ID, name: 'Diabetes Support' }],
        nextCursor: 'NEXT',
      });
      app = await buildParticipantApp();

      const res = await request(app.getHttpServer()).get('/community/communities').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.cursor).toBe('NEXT');
    });

    // ngo_admin, hmo_coordinator and researcher never get past the class-level guard.
    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildParticipantApp(denyGuard);
      await request(app.getHttpServer()).get('/community/communities').expect(403);
    });

    it('returns 422 for a limit beyond the cap', async () => {
      app = await buildParticipantApp();
      await request(app.getHttpServer()).get('/community/communities?limit=500').expect(422);
    });
  });

  describe('GET /community/comments/:id/replies', () => {
    it('returns 200 with a cursor in meta', async () => {
      mockCommunityService.listReplies.mockResolvedValue({
        comments: [{ id: 'R1', body: 'Same here' }],
        nextCursor: 'NEXT',
      });
      app = await buildParticipantApp();

      const res = await request(app.getHttpServer())
        .get('/community/comments/01J0000000000000000000CMNT/replies')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.cursor).toBe('NEXT');
      expect(mockCommunityService.listReplies).toHaveBeenCalledWith(
        TEST_USER_ID,
        '01J0000000000000000000CMNT',
        expect.anything(),
      );
    });

    it('returns 403 when RoleGuard denies access', async () => {
      app = await buildParticipantApp(denyGuard);
      await request(app.getHttpServer())
        .get('/community/comments/01J0000000000000000000CMNT/replies')
        .expect(403);
    });

    it('returns 404 when the comment does not exist', async () => {
      mockCommunityService.listReplies.mockRejectedValue(new NotFoundException());
      app = await buildParticipantApp();
      await request(app.getHttpServer())
        .get('/community/comments/01J0000000000000000000CMNT/replies')
        .expect(404);
    });
  });

  describe('POST /community/communities', () => {
    it('returns 201 and passes the caller from the JWT, never the body', async () => {
      mockCommunityService.createCommunity.mockResolvedValue({ id: COMMUNITY_ID });
      app = await buildParticipantApp();

      await request(app.getHttpServer())
        .post('/community/communities')
        .send({ name: 'Diabetes Support' })
        .expect(201);

      expect(mockCommunityService.createCommunity).toHaveBeenCalledWith(TEST_USER_ID, {
        name: 'Diabetes Support',
      });
    });

    it('returns 422 for a missing name', async () => {
      app = await buildParticipantApp();
      await request(app.getHttpServer()).post('/community/communities').send({}).expect(422);
    });

    it('returns 422 for an unknown field (forbidNonWhitelisted)', async () => {
      app = await buildParticipantApp();
      await request(app.getHttpServer())
        .post('/community/communities')
        .send({ name: 'X', memberCount: 9999 })
        .expect(422);
    });

    it('returns 403 when RoleGuard denies a non-patient', async () => {
      app = await buildParticipantApp(denyGuard);
      await request(app.getHttpServer()).post('/community/communities').send({ name: 'X' }).expect(403);
    });
  });

  describe('POST /community/communities/:id/posts', () => {
    it('returns 201 on success', async () => {
      mockCommunityService.createPost.mockResolvedValue(mockPost);
      app = await buildParticipantApp();

      await request(app.getHttpServer())
        .post(`/community/communities/${COMMUNITY_ID}/posts`)
        .send({ body: 'Any tips?' })
        .expect(201);
    });

    it('returns 403 when the service says the caller is not a member', async () => {
      mockCommunityService.createPost.mockRejectedValue(new ForbiddenException());
      app = await buildParticipantApp();

      await request(app.getHttpServer())
        .post(`/community/communities/${COMMUNITY_ID}/posts`)
        .send({ body: 'Any tips?' })
        .expect(403);
    });

    it('returns 422 for an empty body', async () => {
      app = await buildParticipantApp();
      await request(app.getHttpServer())
        .post(`/community/communities/${COMMUNITY_ID}/posts`)
        .send({ body: '   ' })
        .expect(422);
    });
  });

  describe('GET /community/posts/:id', () => {
    it('returns 200', async () => {
      mockCommunityService.getPost.mockResolvedValue(mockPost);
      app = await buildParticipantApp();

      const res = await request(app.getHttpServer()).get(`/community/posts/${POST_ID}`).expect(200);
      expect(res.body.data.author.displayName).toBe('Amaka O.');
    });

    it('returns 404 for a hidden post that is not yours', async () => {
      mockCommunityService.getPost.mockRejectedValue(new NotFoundException());
      app = await buildParticipantApp();

      await request(app.getHttpServer()).get(`/community/posts/${POST_ID}`).expect(404);
    });
  });

  describe('reactions', () => {
    it('POST returns 200 with the authoritative count', async () => {
      mockCommunityService.react.mockResolvedValue({ reacted: true, reactionCount: 9 });
      app = await buildParticipantApp();

      const res = await request(app.getHttpServer())
        .post(`/community/posts/${POST_ID}/reactions`)
        .expect(200);
      expect(res.body.data.reactionCount).toBe(9);
      expect(mockCommunityService.react).toHaveBeenCalledWith(
        TEST_USER_ID,
        CommunityReportTarget.POST,
        POST_ID,
      );
    });

    it('POST returns 409 on your own content', async () => {
      mockCommunityService.react.mockRejectedValue(new ConflictException());
      app = await buildParticipantApp();

      await request(app.getHttpServer()).post(`/community/posts/${POST_ID}/reactions`).expect(409);
    });

    it('DELETE returns 200', async () => {
      mockCommunityService.unreact.mockResolvedValue({ reacted: false, reactionCount: 8 });
      app = await buildParticipantApp();

      await request(app.getHttpServer()).delete(`/community/posts/${POST_ID}/reactions`).expect(200);
    });
  });

  describe('POST /community/posts/:id/reports', () => {
    it('returns 201', async () => {
      mockCommunityService.reportContent.mockResolvedValue({
        id: REPORT_ID,
        status: CommunityReportStatus.PENDING,
      });
      app = await buildParticipantApp();

      await request(app.getHttpServer())
        .post(`/community/posts/${POST_ID}/reports`)
        .send({ reason: 'harassment' })
        .expect(201);
    });

    it('returns 422 when reason is "other" with no detail', async () => {
      app = await buildParticipantApp();
      await request(app.getHttpServer())
        .post(`/community/posts/${POST_ID}/reports`)
        .send({ reason: 'other' })
        .expect(422);
    });

    it('returns 409 on a duplicate open report', async () => {
      mockCommunityService.reportContent.mockRejectedValue(new ConflictException());
      app = await buildParticipantApp();

      await request(app.getHttpServer())
        .post(`/community/posts/${POST_ID}/reports`)
        .send({ reason: 'spam' })
        .expect(409);
    });
  });

  describe('GET /community/stats', () => {
    it('returns the caller’s own numbers, bare (no meta)', async () => {
      mockCommunityService.getStats.mockResolvedValue({
        questionsAnswered: 3,
        communitiesJoined: 2,
        helpfulMarks: 11,
        postsWritten: 4,
        postsThisMonth: 1,
      });
      app = await buildParticipantApp();

      const res = await request(app.getHttpServer()).get('/community/stats').expect(200);
      // Bare handlers must not double-wrap — TransformInterceptor only unwraps a
      // payload carrying BOTH data and meta.
      expect(res.body.data.questionsAnswered).toBe(3);
      expect(res.body.data.data).toBeUndefined();
      expect(mockCommunityService.getStats).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });
});

describe('CommunityModerationController', () => {
  let app: INestApplication;

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => await app?.close());

  describe('GET /admin/community/reports', () => {
    it('returns 200 with a cursor', async () => {
      mockCommunityService.listReports.mockResolvedValue({ reports: [], nextCursor: undefined });
      app = await buildAdminApp();

      const res = await request(app.getHttpServer()).get('/admin/community/reports').expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 403 to anyone who is not a platform admin', async () => {
      app = await buildAdminApp(denyGuard);
      await request(app.getHttpServer()).get('/admin/community/reports').expect(403);
    });

    it('returns 422 for an unknown status filter', async () => {
      app = await buildAdminApp();
      await request(app.getHttpServer()).get('/admin/community/reports?status=nonsense').expect(422);
    });
  });

  describe('PATCH /admin/community/reports/:id', () => {
    it('returns 200 and passes the admin id from the JWT', async () => {
      mockCommunityService.resolveReport.mockResolvedValue({ id: REPORT_ID, status: 'actioned' });
      app = await buildAdminApp();

      await request(app.getHttpServer())
        .patch(`/admin/community/reports/${REPORT_ID}`)
        .send({ action: 'hide', note: 'Contains a phone number' })
        .expect(200);

      expect(mockCommunityService.resolveReport).toHaveBeenCalledWith(TEST_ADMIN_ID, REPORT_ID, {
        action: 'hide',
        note: 'Contains a phone number',
      });
    });

    it('returns 422 when hiding with no reason', async () => {
      app = await buildAdminApp();
      await request(app.getHttpServer())
        .patch(`/admin/community/reports/${REPORT_ID}`)
        .send({ action: 'hide' })
        .expect(422);
    });

    it('returns 409 when the report was already reviewed', async () => {
      mockCommunityService.resolveReport.mockRejectedValue(new ConflictException());
      app = await buildAdminApp();

      await request(app.getHttpServer())
        .patch(`/admin/community/reports/${REPORT_ID}`)
        .send({ action: 'dismiss' })
        .expect(409);
    });

    it('returns 404 for an unknown report', async () => {
      mockCommunityService.resolveReport.mockRejectedValue(new NotFoundException());
      app = await buildAdminApp();

      await request(app.getHttpServer())
        .patch(`/admin/community/reports/${REPORT_ID}`)
        .send({ action: 'dismiss' })
        .expect(404);
    });
  });

  describe('PATCH /admin/community/posts/:id/visibility', () => {
    it('returns 200 on a restore, which needs no reason', async () => {
      mockCommunityService.setPostVisibility.mockResolvedValue(mockPost);
      app = await buildAdminApp();

      await request(app.getHttpServer())
        .patch(`/admin/community/posts/${POST_ID}/visibility`)
        .send({ hidden: false })
        .expect(200);
    });

    it('returns 422 when hiding with no reason', async () => {
      app = await buildAdminApp();
      await request(app.getHttpServer())
        .patch(`/admin/community/posts/${POST_ID}/visibility`)
        .send({ hidden: true })
        .expect(422);
    });
  });
});
