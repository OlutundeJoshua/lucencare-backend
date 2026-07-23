import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType } from 'src/common/enums';

import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  const mockRepository = {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: 'notif-1', ...entity })),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
