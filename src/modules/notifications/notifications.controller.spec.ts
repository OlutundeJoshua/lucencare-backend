import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const TEST_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';
const NOTIF_ID = '01HZZZZZZZZZZZZZZZZZZZZZAB';

const mockNotificationsService = {
  listForCurrentUser: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
};

// Populates request.user so @CurrentUser() resolves to a valid JWT payload
const allowAllGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'ngo_admin' };
    return true;
  },
};

const denyGuard = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

async function buildApp(jwtGuardOverride = allowAllGuard): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [{ provide: NotificationsService, useValue: mockNotificationsService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtGuardOverride)
    .compile();

  const app = moduleRef.createNestApplication();
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
  await app.init();
  return app;
}

describe('NotificationsController', () => {
  let app: INestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /notifications/me', () => {
    it('returns the caller’s feed', async () => {
      mockNotificationsService.listForCurrentUser.mockResolvedValue({
        notifications: [{ id: NOTIF_ID, title: 'New application received' }],
        unreadCount: 1,
      });
      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/notifications/me').expect(200);

      expect(res.body.unreadCount).toBe(1);
      // The id comes from the JWT, never from the query string.
      expect(mockNotificationsService.listForCurrentUser).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('passes the unread filter through', async () => {
      mockNotificationsService.listForCurrentUser.mockResolvedValue({
        notifications: [],
        unreadCount: 0,
      });
      app = await buildApp();

      await request(app.getHttpServer()).get('/notifications/me?unreadOnly=true').expect(200);

      expect(mockNotificationsService.listForCurrentUser).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ unreadOnly: true }),
      );
    });

    // enableImplicitConversion would otherwise read the string 'false' as true.
    it('treats unreadOnly=false as false', async () => {
      mockNotificationsService.listForCurrentUser.mockResolvedValue({
        notifications: [],
        unreadCount: 0,
      });
      app = await buildApp();

      await request(app.getHttpServer()).get('/notifications/me?unreadOnly=false').expect(200);

      expect(mockNotificationsService.listForCurrentUser).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ unreadOnly: false }),
      );
    });

    it('returns 403 when the auth guard denies access', async () => {
      app = await buildApp(denyGuard);

      await request(app.getHttpServer()).get('/notifications/me').expect(403);
      expect(mockNotificationsService.listForCurrentUser).not.toHaveBeenCalled();
    });

    it('returns 422 for an out-of-range limit', async () => {
      app = await buildApp();

      await request(app.getHttpServer()).get('/notifications/me?limit=500').expect(422);
    });

    it('returns 422 for an unknown notification type', async () => {
      app = await buildApp();

      await request(app.getHttpServer()).get('/notifications/me?type=not_a_type').expect(422);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('marks one notification read', async () => {
      mockNotificationsService.markRead.mockResolvedValue({ id: NOTIF_ID, read: true });
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .patch(`/notifications/${NOTIF_ID}/read`)
        .expect(200);

      expect(res.body.read).toBe(true);
      expect(mockNotificationsService.markRead).toHaveBeenCalledWith(NOTIF_ID, TEST_USER_ID);
    });

    it('returns 404 when the notification does not exist', async () => {
      mockNotificationsService.markRead.mockRejectedValue(new NotFoundException());
      app = await buildApp();

      await request(app.getHttpServer()).patch(`/notifications/${NOTIF_ID}/read`).expect(404);
    });

    it('returns 403 when it belongs to someone else', async () => {
      mockNotificationsService.markRead.mockRejectedValue(new ForbiddenException());
      app = await buildApp();

      await request(app.getHttpServer()).patch(`/notifications/${NOTIF_ID}/read`).expect(403);
    });
  });

  describe('PATCH /notifications/read-all', () => {
    // Declared before :id/read, so it must not be swallowed by the param route.
    it('routes to markAllRead rather than markRead("read-all")', async () => {
      mockNotificationsService.markAllRead.mockResolvedValue({ updated: 3 });
      app = await buildApp();

      const res = await request(app.getHttpServer()).patch('/notifications/read-all').expect(200);

      expect(res.body.updated).toBe(3);
      expect(mockNotificationsService.markRead).not.toHaveBeenCalled();
      expect(mockNotificationsService.markAllRead).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });
});
