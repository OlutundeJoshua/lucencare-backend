import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';

import { StudyEnrollmentStatus, StudyStatus } from 'src/common/enums';
import { ADMIN_QUEUE } from 'src/queues/queues.constants';
import { StudyEnrollment } from 'src/modules/enrollments/entities/study-enrollment.entity';
import { MatchingService } from 'src/modules/matching/matching.service';

import { Study } from './entities/study.entity';
import { StudiesService } from './studies.service';
import { ListStudiesDto, ListStudyEnrollmentsDto } from './dto/list-studies.dto';

const STUDY_ID = '01HZZZZZZZZZZZZZZZZZZZSTUDY';
const RESEARCHER_ID = '01HZZZZZZZZZZZZZZZZZZZRSCH';
const ENROLLMENT_ID = '01HZZZZZZZZZZZZZZZZZZZZENR';

function makeStudy(overrides: Partial<Study> = {}): Study {
  const s = new Study();
  s.id = STUDY_ID;
  s.researcherId = RESEARCHER_ID;
  s.title = 'Test Study';
  s.irbNumber = 'IRB-2024-0042';
  s.status = StudyStatus.PENDING_REVIEW;
  s.eligibilityCriteria = [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }];
  s.infoSheetUrl = 'https://s3.example.com/info.pdf';
  s.targetCount = 100;
  s.createdAt = new Date();
  return Object.assign(s, overrides);
}

function makeStudyEnrollment(overrides: Partial<StudyEnrollment> = {}): StudyEnrollment {
  const e = new StudyEnrollment();
  e.id = ENROLLMENT_ID;
  e.studyId = STUDY_ID;
  e.patientId = '01HZZZZZZZZZZZZZZZZZZPAT01';
  e.consentGrantId = '01HZZZZZZZZZZZZZZZZZZZCGR';
  e.status = StudyEnrollmentStatus.INTERESTED;
  e.sharedDataSnapshot = { conditionTags: ['diabetes'] };
  e.directContactShared = false;
  e.createdAt = new Date();
  return Object.assign(e, overrides);
}

const mockStudyQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
  getMany: jest.fn(),
};

const mockEnrollmentQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockStudyRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => mockStudyQb),
};

const mockStudyEnrollmentRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => mockEnrollmentQb),
};

const mockMatchingService = {
  indexStudy: jest.fn(),
};

const mockAdminQueue = { add: jest.fn() };

describe('StudiesService', () => {
  let service: StudiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudiesService,
        { provide: getRepositoryToken(Study), useValue: mockStudyRepo },
        { provide: getRepositoryToken(StudyEnrollment), useValue: mockStudyEnrollmentRepo },
        { provide: MatchingService, useValue: mockMatchingService },
        { provide: getQueueToken(ADMIN_QUEUE), useValue: mockAdminQueue },
      ],
    }).compile();

    service = module.get<StudiesService>(StudiesService);
    jest.clearAllMocks();
    mockStudyQb.where.mockReturnThis();
    mockStudyQb.andWhere.mockReturnThis();
    mockStudyQb.orderBy.mockReturnThis();
    mockStudyQb.take.mockReturnThis();
    mockEnrollmentQb.where.mockReturnThis();
    mockEnrollmentQb.andWhere.mockReturnThis();
    mockEnrollmentQb.orderBy.mockReturnThis();
    mockEnrollmentQb.take.mockReturnThis();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    const dto = {
      title: 'Test Study',
      irbNumber: 'IRB-2024-0042',
      eligibilityCriteria: [{ field: 'conditionTags', operator: 'eq', value: 'diabetes' }],
      infoSheetUrl: 'https://s3.example.com/info.pdf',
      targetCount: 100,
    };

    it('creates and returns study with PENDING_REVIEW status', async () => {
      const study = makeStudy();
      mockStudyQb.getOne.mockResolvedValue(null);
      mockStudyRepo.create.mockReturnValue(study);
      mockStudyRepo.save.mockResolvedValue(study);
      mockAdminQueue.add.mockResolvedValue(undefined);

      const result = await service.create(RESEARCHER_ID, dto);

      expect(mockStudyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          researcherId: RESEARCHER_ID,
          status: StudyStatus.PENDING_REVIEW,
        }),
      );
      expect(result.status).toBe(StudyStatus.PENDING_REVIEW);
    });

    it('enqueues study_review job after creation', async () => {
      const study = makeStudy();
      mockStudyQb.getOne.mockResolvedValue(null);
      mockStudyRepo.create.mockReturnValue(study);
      mockStudyRepo.save.mockResolvedValue(study);
      mockAdminQueue.add.mockResolvedValue(undefined);

      await service.create(RESEARCHER_ID, dto);

      expect(mockAdminQueue.add).toHaveBeenCalledWith(
        'study_review',
        expect.objectContaining({ studyId: study.id, researcherId: RESEARCHER_ID }),
      );
    });

    it('throws ConflictException when duplicate non-rejected IRB exists', async () => {
      mockStudyQb.getOne.mockResolvedValue(makeStudy());

      await expect(service.create(RESEARCHER_ID, dto)).rejects.toThrow(ConflictException);
    });

    it('allows creation when existing study with same IRB is rejected', async () => {
      // The query filters OUT rejected studies, so getOne returns null
      mockStudyQb.getOne.mockResolvedValue(null);
      const study = makeStudy();
      mockStudyRepo.create.mockReturnValue(study);
      mockStudyRepo.save.mockResolvedValue(study);
      mockAdminQueue.add.mockResolvedValue(undefined);

      await expect(service.create(RESEARCHER_ID, dto)).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // findByResearcher
  // ---------------------------------------------------------------------------

  describe('findByResearcher', () => {
    it('returns paginated studies for matching caller', async () => {
      const studies = Array.from({ length: 21 }, (_, i) =>
        makeStudy({ id: `STD${i.toString().padStart(23, '0')}` }),
      );
      mockStudyQb.getMany.mockResolvedValue(studies);

      const result = await service.findByResearcher(
        RESEARCHER_ID,
        RESEARCHER_ID,
        { limit: 20 } as ListStudiesDto,
      );

      expect(result.studies).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });

    it('throws ForbiddenException when callerId does not match researcherId', async () => {
      await expect(
        service.findByResearcher(RESEARCHER_ID, 'OTHER_RESEARCHER_ZZZZZZ', {} as ListStudiesDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applies status filter when provided', async () => {
      mockStudyQb.getMany.mockResolvedValue([]);

      await service.findByResearcher(
        RESEARCHER_ID,
        RESEARCHER_ID,
        { status: StudyStatus.APPROVED } as ListStudiesDto,
      );

      expect(mockStudyQb.andWhere).toHaveBeenCalledWith('s.status = :status', {
        status: StudyStatus.APPROVED,
      });
    });

    it('applies cursor filter when provided', async () => {
      mockStudyQb.getMany.mockResolvedValue([]);

      await service.findByResearcher(
        RESEARCHER_ID,
        RESEARCHER_ID,
        { cursor: STUDY_ID } as ListStudiesDto,
      );

      expect(mockStudyQb.andWhere).toHaveBeenCalledWith('s.id > :cursor', {
        cursor: STUDY_ID,
      });
    });

    it('returns empty array when no studies match', async () => {
      mockStudyQb.getMany.mockResolvedValue([]);

      const result = await service.findByResearcher(
        RESEARCHER_ID,
        RESEARCHER_ID,
        {} as ListStudiesDto,
      );

      expect(result.studies).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // findByIdForResearcher
  // ---------------------------------------------------------------------------

  describe('findByIdForResearcher', () => {
    it('returns study when found and researcher matches', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());

      const result = await service.findByIdForResearcher(STUDY_ID, RESEARCHER_ID);

      expect(result.id).toBe(STUDY_ID);
    });

    it('throws NotFoundException when study not found', async () => {
      mockStudyRepo.findOne.mockResolvedValue(null);

      await expect(service.findByIdForResearcher(STUDY_ID, RESEARCHER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when researcher does not match', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());

      await expect(
        service.findByIdForResearcher(STUDY_ID, 'OTHER_RESEARCHER_ZZZZZ'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // getEnrollments
  // ---------------------------------------------------------------------------

  describe('getEnrollments', () => {
    it('returns enrollment snapshots', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockEnrollmentQb.getMany.mockResolvedValue([makeStudyEnrollment()]);

      const result = await service.getEnrollments(STUDY_ID, RESEARCHER_ID, {
        limit: 20,
      } as ListStudyEnrollmentsDto);

      expect(result.enrollments).toHaveLength(1);
      expect(result.enrollments[0]).toMatchObject({
        id: ENROLLMENT_ID,
        studyId: STUDY_ID,
        directContactShared: false,
      });
    });

    it('strips contact fields from snapshot when directContactShared is false', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      const enrollment = makeStudyEnrollment({
        directContactShared: false,
        sharedDataSnapshot: {
          conditionTags: ['diabetes'],
          email: 'patient@test.com',
          phone: '+2348012345678',
        },
      });
      mockEnrollmentQb.getMany.mockResolvedValue([enrollment]);

      const result = await service.getEnrollments(STUDY_ID, RESEARCHER_ID, {
        limit: 20,
      } as ListStudyEnrollmentsDto);

      expect(result.enrollments[0].sharedDataSnapshot).not.toHaveProperty('email');
      expect(result.enrollments[0].sharedDataSnapshot).not.toHaveProperty('phone');
      expect(result.enrollments[0].sharedDataSnapshot).toHaveProperty('conditionTags');
    });

    it('keeps contact fields in snapshot when directContactShared is true', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      const enrollment = makeStudyEnrollment({
        directContactShared: true,
        sharedDataSnapshot: {
          conditionTags: ['diabetes'],
          email: 'patient@test.com',
          phone: '+2348012345678',
        },
      });
      mockEnrollmentQb.getMany.mockResolvedValue([enrollment]);

      const result = await service.getEnrollments(STUDY_ID, RESEARCHER_ID, {
        limit: 20,
      } as ListStudyEnrollmentsDto);

      expect(result.enrollments[0].sharedDataSnapshot).toHaveProperty('email', 'patient@test.com');
      expect(result.enrollments[0].sharedDataSnapshot).toHaveProperty('phone');
    });

    it('applies optional status filter', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockEnrollmentQb.getMany.mockResolvedValue([]);

      await service.getEnrollments(STUDY_ID, RESEARCHER_ID, {
        status: StudyEnrollmentStatus.SCREENED,
        limit: 20,
      } as ListStudyEnrollmentsDto);

      expect(mockEnrollmentQb.andWhere).toHaveBeenCalledWith('se.status = :status', {
        status: StudyEnrollmentStatus.SCREENED,
      });
    });

    it('throws ForbiddenException when study belongs to different researcher', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());

      await expect(
        service.getEnrollments(STUDY_ID, 'OTHER_RESEARCHER_ZZZZZ', { limit: 20 } as ListStudyEnrollmentsDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns nextCursor when more rows exist', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      const enrollments = Array.from({ length: 21 }, (_, i) =>
        makeStudyEnrollment({ id: `ENR${i.toString().padStart(23, '0')}` }),
      );
      mockEnrollmentQb.getMany.mockResolvedValue(enrollments);

      const result = await service.getEnrollments(STUDY_ID, RESEARCHER_ID, {
        limit: 20,
      } as ListStudyEnrollmentsDto);

      expect(result.enrollments).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // inviteParticipant
  // ---------------------------------------------------------------------------

  describe('inviteParticipant', () => {
    it('advances status from INTERESTED to SCREENED', async () => {
      const enrollment = makeStudyEnrollment({ status: StudyEnrollmentStatus.INTERESTED });
      const updated = makeStudyEnrollment({ status: StudyEnrollmentStatus.SCREENED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockStudyEnrollmentRepo.save.mockResolvedValue(updated);

      const result = await service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID);

      expect(mockStudyEnrollmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: StudyEnrollmentStatus.SCREENED }),
      );
      expect(result.status).toBe(StudyEnrollmentStatus.SCREENED);
    });

    it('advances status from SCREENED to ENROLLED', async () => {
      const enrollment = makeStudyEnrollment({ status: StudyEnrollmentStatus.SCREENED });
      const updated = makeStudyEnrollment({ status: StudyEnrollmentStatus.ENROLLED });
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockStudyEnrollmentRepo.save.mockResolvedValue(updated);

      const result = await service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID);

      expect(result.status).toBe(StudyEnrollmentStatus.ENROLLED);
    });

    it('throws ConflictException when status is already ENROLLED', async () => {
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(
        makeStudyEnrollment({ status: StudyEnrollmentStatus.ENROLLED }),
      );
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());

      await expect(service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when status is WITHDRAWN', async () => {
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(
        makeStudyEnrollment({ status: StudyEnrollmentStatus.WITHDRAWN }),
      );
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());

      await expect(service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when enrollment not found', async () => {
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when study belongs to different researcher', async () => {
      mockStudyEnrollmentRepo.findOne.mockResolvedValue(makeStudyEnrollment());
      mockStudyRepo.findOne.mockResolvedValue(makeStudy({ researcherId: 'OTHER_RESEARCHER_ZZ' }));

      await expect(service.inviteParticipant(ENROLLMENT_ID, RESEARCHER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('updates study status and returns saved study', async () => {
      const study = makeStudy();
      const updated = makeStudy({ status: StudyStatus.APPROVED });
      mockStudyRepo.findOne.mockResolvedValue(study);
      mockStudyRepo.save.mockResolvedValue(updated);
      mockMatchingService.indexStudy.mockResolvedValue(undefined);

      const result = await service.updateStatus(STUDY_ID, StudyStatus.APPROVED);

      expect(mockStudyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: StudyStatus.APPROVED }),
      );
      expect(result).toBe(updated);
    });

    it('calls indexStudy when status transitions to APPROVED', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockStudyRepo.save.mockResolvedValue(makeStudy({ status: StudyStatus.APPROVED }));
      mockMatchingService.indexStudy.mockResolvedValue(undefined);

      await service.updateStatus(STUDY_ID, StudyStatus.APPROVED);

      expect(mockMatchingService.indexStudy).toHaveBeenCalledWith(STUDY_ID);
    });

    it('does not call indexStudy when status is REJECTED', async () => {
      mockStudyRepo.findOne.mockResolvedValue(makeStudy());
      mockStudyRepo.save.mockResolvedValue(makeStudy({ status: StudyStatus.REJECTED }));

      await service.updateStatus(STUDY_ID, StudyStatus.REJECTED);

      expect(mockMatchingService.indexStudy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when study not found', async () => {
      mockStudyRepo.findOne.mockResolvedValue(null);

      await expect(service.updateStatus(STUDY_ID, StudyStatus.APPROVED)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
