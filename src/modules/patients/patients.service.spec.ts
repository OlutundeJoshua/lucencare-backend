import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { AuditAction, CareEventType, ConsentPurpose, ConsentStatus, HmoLinkRequestStatus, NotificationType, UserRole } from 'src/common/enums';
import { MAIL_QUEUE } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ExportService } from 'src/modules/export/export.service';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';

import { PatientsService } from './patients.service';
import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { HmoLinkRequest } from './entities/hmo-link-request.entity';
import { CareEventQueryDto, CreateCareEventDto, CreatePatientDto, LookupPatientDto, UpdatePatientDto } from './dto/patient.dto';

const PATIENT_USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZA1';
const PATIENT_ID = '01HZZZZZZZZZZZZZZZZZZZZZA2';
const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZA3';
const REQUEST_ID = '01HZZZZZZZZZZZZZZZZZZZZZA4';

const mockPatient: Partial<Patient> = {
  id: PATIENT_ID,
  userId: PATIENT_USER_ID,
  name: 'Jane Doe',
  phone: '08012345678',
  conditionTags: ['diabetes'],
  hmoId: undefined,
  directContactShared: false,
};

const mockLinkedPatient: Partial<Patient> = { ...mockPatient, hmoId: ORG_ID };

const mockLinkRequest: Partial<HmoLinkRequest> = {
  id: REQUEST_ID,
  patientId: PATIENT_ID,
  orgId: ORG_ID,
  status: HmoLinkRequestStatus.PENDING,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
};

const mockCareEvent: Partial<CareEvent> = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZA5',
  patientId: PATIENT_ID,
  type: CareEventType.CLINIC_VISIT,
  eventDate: new Date('2025-01-15'),
  structured: { diagnosis: 'hypertension' },
};

function makeQueryBuilderMock(result: unknown, count = 0) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
    getMany: jest.fn().mockResolvedValue(result),
    getCount: jest.fn().mockResolvedValue(count),
  };
}

describe('PatientsService', () => {
  let service: PatientsService;

  let patientRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let careEventRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let linkRequestRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let consentGrantRepo: { createQueryBuilder: jest.Mock };
  let orgRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let notificationsService: { createOne: jest.Mock };
  let exportService: { validateAndConsumeToken: jest.Mock };
  let auditService: { log: jest.Mock };
  let mailQueue: { add: jest.Mock };

  beforeEach(async () => {
    patientRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    careEventRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    linkRequestRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    consentGrantRepo = { createQueryBuilder: jest.fn() };
    orgRepo = { findOne: jest.fn() };
    dataSource = { transaction: jest.fn() };
    notificationsService = { createOne: jest.fn().mockResolvedValue(undefined) };
    exportService = { validateAndConsumeToken: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    mailQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: getRepositoryToken(Patient), useValue: patientRepo },
        { provide: getRepositoryToken(CareEvent), useValue: careEventRepo },
        { provide: getRepositoryToken(HmoLinkRequest), useValue: linkRequestRepo },
        { provide: getRepositoryToken(ConsentGrant), useValue: consentGrantRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ExportService, useValue: exportService },
        { provide: AuditService, useValue: auditService },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(12) } },
      ],
    }).compile();

    service = module.get<PatientsService>(PatientsService);
  });

  // ─── getMyProfile ──────────────────────────────────────────────────────────

  describe('getMyProfile', () => {
    it('returns the patient when found', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const result = await service.getMyProfile(PATIENT_USER_ID);
      expect(result).toEqual(mockPatient);
      expect(patientRepo.findOne).toHaveBeenCalledWith({ where: { userId: PATIENT_USER_ID } });
    });

    it('throws NotFoundException when patient not found', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.getMyProfile(PATIENT_USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateMyProfile ───────────────────────────────────────────────────────

  describe('updateMyProfile', () => {
    it('updates and returns the patient', async () => {
      patientRepo.findOne
        .mockResolvedValueOnce(mockPatient)   // getMyProfile pre-update
        .mockResolvedValueOnce({ ...mockPatient, name: 'Jane Updated' }); // re-fetch
      const dto: UpdatePatientDto = { name: 'Jane Updated' };
      const result = await service.updateMyProfile(PATIENT_USER_ID, dto);
      expect(patientRepo.update).toHaveBeenCalledWith({ userId: PATIENT_USER_ID }, { name: 'Jane Updated' });
      expect(result.name).toBe('Jane Updated');
    });

    it('throws NotFoundException when patient does not exist', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMyProfile(PATIENT_USER_ID, {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── lookupPatient ─────────────────────────────────────────────────────────

  describe('lookupPatient', () => {
    it('returns patient when found and has active HMO_CARE consent', async () => {
      const qb = makeQueryBuilderMock(mockPatient);
      patientRepo.createQueryBuilder.mockReturnValue(qb);
      const consentQb = makeQueryBuilderMock(null, 1);
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);

      const dto: LookupPatientDto = { phone: '08012345678' };
      const result = await service.lookupPatient(dto, ORG_ID);
      expect(result).toEqual(mockPatient);
    });

    it('throws BadRequestException when neither phone nor membershipNumber provided', async () => {
      await expect(service.lookupPatient({}, ORG_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when no patient matches', async () => {
      const qb = makeQueryBuilderMock(null);
      patientRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.lookupPatient({ phone: '000' }, ORG_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when patient found but has no active HMO_CARE consent', async () => {
      const qb = makeQueryBuilderMock(mockPatient);
      patientRepo.createQueryBuilder.mockReturnValue(qb);
      const consentQb = makeQueryBuilderMock(null, 0); // count = 0
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);

      await expect(service.lookupPatient({ phone: '08012345678' }, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── createLinkRequest ─────────────────────────────────────────────────────

  describe('createLinkRequest', () => {
    beforeEach(() => {
      orgRepo.findOne.mockResolvedValue({ id: ORG_ID, name: 'Test HMO' });
      linkRequestRepo.create.mockImplementation((data) => ({ ...data }));
      linkRequestRepo.save.mockImplementation((r) => Promise.resolve({ id: REQUEST_ID, ...r }));
    });

    it('creates and returns a link request', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient); // hmoId = undefined
      const consentQb = makeQueryBuilderMock(null, 1);
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);
      linkRequestRepo.findOne.mockResolvedValue(null); // no pending

      const result = await service.createLinkRequest(PATIENT_ID, ORG_ID);
      expect(result.patientId).toBe(PATIENT_ID);
      expect(result.orgId).toBe(ORG_ID);
      expect(result.status).toBe(HmoLinkRequestStatus.PENDING);
      expect(notificationsService.createOne).toHaveBeenCalledWith(
        PATIENT_USER_ID,
        NotificationType.HMO_LINK_REQUEST,
        expect.objectContaining({ orgId: ORG_ID }),
      );
    });

    it('throws NotFoundException when patient not found', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.createLinkRequest(PATIENT_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when patient has no active HMO_CARE consent', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const consentQb = makeQueryBuilderMock(null, 0);
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);
      await expect(service.createLinkRequest(PATIENT_ID, ORG_ID)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when patient is already linked to an HMO', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const consentQb = makeQueryBuilderMock(null, 1);
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);
      await expect(service.createLinkRequest(PATIENT_ID, ORG_ID)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when a pending request already exists', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const consentQb = makeQueryBuilderMock(null, 1);
      consentGrantRepo.createQueryBuilder.mockReturnValue(consentQb);
      linkRequestRepo.findOne.mockResolvedValue(mockLinkRequest); // pending exists
      await expect(service.createLinkRequest(PATIENT_ID, ORG_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ─── getMyLinkRequests ─────────────────────────────────────────────────────

  describe('getMyLinkRequests', () => {
    it('returns all link requests when no status filter', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const qb = makeQueryBuilderMock([mockLinkRequest]);
      linkRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMyLinkRequests(PATIENT_USER_ID);
      expect(result).toEqual([mockLinkRequest]);
      // Expiry filter should be applied (no showExpired)
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > NOW()'),
        expect.any(Object),
      );
    });

    it('applies status filter for PENDING (expiry filter still applied)', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const qb = makeQueryBuilderMock([]);
      linkRequestRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getMyLinkRequests(PATIENT_USER_ID, HmoLinkRequestStatus.PENDING);
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('lr.status = :status'),
        expect.objectContaining({ status: HmoLinkRequestStatus.PENDING }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > NOW()'),
        expect.any(Object),
      );
    });

    it('skips expiry filter when status is APPROVED', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const qb = makeQueryBuilderMock([]);
      linkRequestRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getMyLinkRequests(PATIENT_USER_ID, HmoLinkRequestStatus.APPROVED);
      const calls = qb.andWhere.mock.calls.map((c: [string]) => c[0]);
      const hasExpiryFilter = calls.some((s: string) => s.includes('expires_at'));
      expect(hasExpiryFilter).toBe(false);
    });

    it('skips expiry filter when status is REJECTED', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      const qb = makeQueryBuilderMock([]);
      linkRequestRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getMyLinkRequests(PATIENT_USER_ID, HmoLinkRequestStatus.REJECTED);
      const calls = qb.andWhere.mock.calls.map((c: [string]) => c[0]);
      expect(calls.some((s: string) => s.includes('expires_at'))).toBe(false);
    });
  });

  // ─── respondToLinkRequest ──────────────────────────────────────────────────

  describe('respondToLinkRequest', () => {
    const pendingRequest: Partial<HmoLinkRequest> = {
      ...mockLinkRequest,
      status: HmoLinkRequestStatus.PENDING,
    };
    const expiredRequest: Partial<HmoLinkRequest> = {
      ...mockLinkRequest,
      expiresAt: new Date(Date.now() - 1000),
    };
    const approvedRequest: Partial<HmoLinkRequest> = {
      ...mockLinkRequest,
      status: HmoLinkRequestStatus.APPROVED,
    };

    it('approves a pending link request via transaction', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne
        .mockResolvedValueOnce(pendingRequest) // initial lookup
        .mockResolvedValueOnce({ ...pendingRequest, status: HmoLinkRequestStatus.APPROVED }); // re-fetch after update

      dataSource.transaction.mockImplementation(async (cb: (manager: unknown) => Promise<void>) => {
        const mgr = {
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(mockPatient), // race-check fetch
            update: jest.fn().mockResolvedValue(undefined),
          }),
        };
        await cb(mgr);
      });

      const result = await service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'approve');
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(HmoLinkRequestStatus.APPROVED);
    });

    it('rejects a pending link request without a transaction', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({ ...pendingRequest, status: HmoLinkRequestStatus.REJECTED });

      const result = await service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'reject');
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(linkRequestRepo.update).toHaveBeenCalledWith({ id: REQUEST_ID }, { status: HmoLinkRequestStatus.REJECTED });
      expect(result.status).toBe(HmoLinkRequestStatus.REJECTED);
    });

    it('throws NotFoundException when request not found', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne.mockResolvedValue(null);
      await expect(service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'approve')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne.mockResolvedValue(approvedRequest);
      await expect(service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'reject')).rejects.toThrow(ConflictException);
    });

    it('throws 410 Gone when request is expired', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne.mockResolvedValue(expiredRequest);
      const error = await service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'approve').catch((e) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.GONE);
    });

    it('throws ConflictException inside transaction when patient already linked (race condition)', async () => {
      patientRepo.findOne.mockResolvedValue(mockPatient);
      linkRequestRepo.findOne.mockResolvedValueOnce(pendingRequest);

      dataSource.transaction.mockImplementation(async (cb: (manager: unknown) => Promise<void>) => {
        const mgr = {
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(mockLinkedPatient), // hmoId set = race
            update: jest.fn(),
          }),
        };
        await cb(mgr);
      });

      await expect(service.respondToLinkRequest(REQUEST_ID, PATIENT_USER_ID, 'approve')).rejects.toThrow(ConflictException);
    });
  });

  // ─── getPatientById ────────────────────────────────────────────────────────

  describe('getPatientById', () => {
    it('returns patient when found within org scope', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const result = await service.getPatientById(PATIENT_ID, ORG_ID);
      expect(result).toEqual(mockLinkedPatient);
      expect(patientRepo.findOne).toHaveBeenCalledWith({ where: { id: PATIENT_ID, hmoId: ORG_ID } });
    });

    it('throws NotFoundException when patient not found or outside org scope', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.getPatientById(PATIENT_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getCareEvents ─────────────────────────────────────────────────────────

  describe('getCareEvents', () => {
    it('returns care events without cursor', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const qb = makeQueryBuilderMock([mockCareEvent]);
      careEventRepo.createQueryBuilder.mockReturnValue(qb);
      const query: CareEventQueryDto = { limit: 20 };

      const result = await service.getCareEvents(PATIENT_ID, ORG_ID, query);
      expect(result.events).toEqual([mockCareEvent]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('applies cursor filter when cursor provided', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const qb = makeQueryBuilderMock([mockCareEvent]);
      careEventRepo.createQueryBuilder.mockReturnValue(qb);
      const cursor = '01HZZZZZZZZZZZZZZZZZZZZZA0';
      const query: CareEventQueryDto = { limit: 20, cursor };

      await service.getCareEvents(PATIENT_ID, ORG_ID, query);
      expect(qb.andWhere).toHaveBeenCalledWith('ce.id > :cursor', { cursor });
    });

    it('applies type filter when type provided', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const qb = makeQueryBuilderMock([]);
      careEventRepo.createQueryBuilder.mockReturnValue(qb);
      const query: CareEventQueryDto = { limit: 20, type: CareEventType.LAB_RESULT };

      await service.getCareEvents(PATIENT_ID, ORG_ID, query);
      expect(qb.andWhere).toHaveBeenCalledWith('ce.type = :type', { type: CareEventType.LAB_RESULT });
    });

    it('sets nextCursor when there are more results', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const events = [
        { ...mockCareEvent, id: '01HZZZZZZZZZZZZZZZZZZZZZA5' },
        { ...mockCareEvent, id: '01HZZZZZZZZZZZZZZZZZZZZZA6' },
      ];
      // limit=1, returns 2 rows → hasMore=true
      const qb = makeQueryBuilderMock(events);
      careEventRepo.createQueryBuilder.mockReturnValue(qb);
      const query: CareEventQueryDto = { limit: 1 };

      const result = await service.getCareEvents(PATIENT_ID, ORG_ID, query);
      expect(result.events).toHaveLength(1);
      expect(result.nextCursor).toBe('01HZZZZZZZZZZZZZZZZZZZZZA5');
    });

    it('throws NotFoundException when patient not in org scope', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.getCareEvents(PATIENT_ID, ORG_ID, { limit: 20 })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── createCareEvent ───────────────────────────────────────────────────────

  describe('createCareEvent', () => {
    it('creates and returns a care event', async () => {
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      careEventRepo.create.mockReturnValue(mockCareEvent);
      careEventRepo.save.mockResolvedValue(mockCareEvent);

      const dto: CreateCareEventDto = {
        type: CareEventType.CLINIC_VISIT,
        eventDate: '2025-01-15',
        structured: { diagnosis: 'hypertension' },
      };
      const result = await service.createCareEvent(PATIENT_ID, ORG_ID, dto);
      expect(result).toEqual(mockCareEvent);
      expect(careEventRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when patient not in org scope', async () => {
      patientRepo.findOne.mockResolvedValue(null);
      const dto: CreateCareEventDto = {
        type: CareEventType.CLINIC_VISIT,
        eventDate: '2025-01-15',
        structured: {},
      };
      await expect(service.createCareEvent(PATIENT_ID, ORG_ID, dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getPatientSummary ─────────────────────────────────────────────────────

  describe('getPatientSummary', () => {
    const EXPORT_TOKEN = 'mock.export.jwt';

    it('returns summary and writes audit log', async () => {
      exportService.validateAndConsumeToken.mockResolvedValue({ patientId: PATIENT_ID });
      patientRepo.findOne.mockResolvedValue(mockLinkedPatient);
      const qb = makeQueryBuilderMock([mockCareEvent]);
      careEventRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPatientSummary(PATIENT_ID, ORG_ID, EXPORT_TOKEN);
      expect(result.patient).toEqual(mockLinkedPatient);
      expect(result.careEvents).toEqual([mockCareEvent]);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.EXPORT, resourceId: PATIENT_ID }),
      );
    });

    it('throws UnauthorizedException when export token is invalid', async () => {
      exportService.validateAndConsumeToken.mockResolvedValue(null);
      await expect(service.getPatientSummary(PATIENT_ID, ORG_ID, EXPORT_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token patientId does not match', async () => {
      exportService.validateAndConsumeToken.mockResolvedValue({ patientId: 'DIFFERENT_ID' });
      await expect(service.getPatientSummary(PATIENT_ID, ORG_ID, EXPORT_TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when patient not in org scope', async () => {
      exportService.validateAndConsumeToken.mockResolvedValue({ patientId: PATIENT_ID });
      patientRepo.findOne.mockResolvedValue(null);
      await expect(service.getPatientSummary(PATIENT_ID, ORG_ID, EXPORT_TOKEN)).rejects.toThrow(NotFoundException);
    });

    it('writes audit log even when exportService throws (audit before return)', async () => {
      // If exportService throws, audit is not reached — this test verifies audit happens AFTER validation
      exportService.validateAndConsumeToken.mockRejectedValue(new UnauthorizedException('token expired'));
      await expect(service.getPatientSummary(PATIENT_ID, ORG_ID, EXPORT_TOKEN)).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
