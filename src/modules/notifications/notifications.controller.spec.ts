// TODO: Implement — see docs/specs/notifications.spec.md

import { Test, TestingModule } from '@nestjs/testing';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const mockNotificationsService = {
  listForCurrentUser: jest.fn(),
  markRead: jest.fn(),
  createOne: jest.fn(),
  createBulk: jest.fn(),
};

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockNotificationsService }],
    }).compile();
    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /notifications/me', () => {
    it('delegates to NotificationsService.listForCurrentUser', () => {
      const pagination = { limit: 20 };
      controller.listMine(pagination);
      expect(mockNotificationsService.listForCurrentUser).toHaveBeenCalledWith(pagination);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('delegates to NotificationsService.markRead', () => {
      controller.markRead('notif-1');
      expect(mockNotificationsService.markRead).toHaveBeenCalledWith('notif-1');
    });
  });
});
