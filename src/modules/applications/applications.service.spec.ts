import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  ApplicantRole,
  ApplicationEmailEvent,
  ApplicationStatus,
  AuditAction,
  ProfessionType,
} from 'src/common/enums';
import {
  ADMIN_QUEUE,
  APPLICATION_REVIEW_JOB,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  SEND_APPLICATION_STATUS_JOB,
} from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { User } from 'src/modules/auth/entities/user.entity';

import { ApplicationsService } from './applications.service';
import { BenefactorApplication } from './entities/benefactor-application.entity';
import { ProfessionalApplication } from './entities/professional-application.entity';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZAA';
const ADMIN_ID = '01HZZZZZZZZZZZZZZZZZZZZZAB';
const APP_ID = '01HZZZZZZZZZZZZZZZZZZZZZAC';

const professionalDto = {
  profession: ProfessionType.DOCTOR,
  licenseNumber: 'MDCN-12345',
  specialty: 'Endocrinology',
  yearsOfExperience: 8,
  phone: '+2348030000000',
  bio: 'Endocrinologist focused on community diabetes care.',
  termsConsent: true as const,
  codeOfConductConsent: true as const,
};

const benefactorDto = {
  fullName: 'Adunola Fashola',
  phone: '+2348034567890',
  reasonForSupport: 'I want to support patients navigating the healthcare system.',
  idConsent: true as const,
  termsConsent: true as const,
  codeOfConductConsent: true as const,
};

const makeRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: object) => data),
  save: jest.fn((data: object) => Promise.resolve(data)),
  update: jest.fn(),
});

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let professionalRepo: ReturnType<typeof makeRepo>;
  let benefactorRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let auditService: { log: jest.Mock };
  let mailQueue: { add: jest.Mock };
  let adminQueue: { add: jest.Mock };
  let txUpdate: jest.Mock;
  let txUserUpdate: jest.Mock;

  beforeEach(async () => {
    professionalRepo = makeRepo();
    benefactorRepo = makeRepo();
    userRepo = makeRepo();
    auditService = { log: jest.fn() };
    mailQueue = { add: jest.fn() };
    adminQueue = { add: jest.fn() };
    // Applications carry only userId; email/name come from the users table.
    userRepo.findOne.mockResolvedValue({ id: USER_ID, name: 'Dr Ada Obi', email: 'ada@example.com' });
    txUpdate = jest.fn();
    txUserUpdate = jest.fn();

    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === User ? { update: txUserUpdate } : { update: txUpdate },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: getRepositoryToken(ProfessionalApplication), useValue: professionalRepo },
        { provide: getRepositoryToken(BenefactorApplication), useValue: benefactorRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
          },
        },
        { provide: AuditService, useValue: auditService },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
        { provide: getQueueToken(ADMIN_QUEUE), useValue: adminQueue },
      ],
    }).compile();

    service = module.get(ApplicationsService);
  });

  describe('createProfessional', () => {
    it('persists every submitted field plus consent timestamps', async () => {
      professionalRepo.findOne.mockResolvedValue(null);

      await service.createProfessional(USER_ID, professionalDto);

      expect(professionalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          profession: ProfessionType.DOCTOR,
          licenseNumber: professionalDto.licenseNumber,
          specialty: professionalDto.specialty,
          yearsOfExperience: 8,
          phone: professionalDto.phone,
          bio: professionalDto.bio,
          termsConsentAt: expect.any(Date),
          codeOfConductConsentAt: expect.any(Date),
          status: ApplicationStatus.PENDING,
        }),
      );
    });

    it('throws 409 on a second submission for the same user', async () => {
      professionalRepo.findOne.mockResolvedValue({ id: APP_ID });

      await expect(service.createProfessional(USER_ID, professionalDto)).rejects.toThrow(
        ConflictException,
      );
      expect(professionalRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createBenefactor', () => {
    it('persists every submitted field plus consent timestamps', async () => {
      benefactorRepo.findOne.mockResolvedValue(null);

      await service.createBenefactor(USER_ID, benefactorDto);

      expect(benefactorRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          fullName: benefactorDto.fullName,
          phone: benefactorDto.phone,
          reasonForSupport: benefactorDto.reasonForSupport,
          idConsentGiven: true,
          idConsentAt: expect.any(Date),
          termsConsentAt: expect.any(Date),
          codeOfConductConsentAt: expect.any(Date),
          status: ApplicationStatus.PENDING,
        }),
      );
    });

    it('throws 409 on a second submission for the same user', async () => {
      benefactorRepo.findOne.mockResolvedValue({ id: APP_ID });

      await expect(service.createBenefactor(USER_ID, benefactorDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // Application rows have no email, and professional rows have no name — the
  // admin review screens need both.
  describe('list enrichment', () => {
    it('attaches the applicant email and name to professional applications', async () => {
      professionalRepo.find.mockResolvedValue([{ id: APP_ID, userId: USER_ID }]);
      userRepo.find.mockResolvedValue([{ id: USER_ID, name: 'Dr Ada Okafor', email: 'ada@example.com' }]);

      const [row] = await service.findAllProfessional();

      expect(row).toEqual(
        expect.objectContaining({ email: 'ada@example.com', name: 'Dr Ada Okafor' }),
      );
    });

    it('attaches the applicant email to benefactor applications', async () => {
      benefactorRepo.find.mockResolvedValue([{ id: APP_ID, userId: USER_ID }]);
      userRepo.find.mockResolvedValue([{ id: USER_ID, name: 'Adunola', email: 'adunola@example.com' }]);

      const [row] = await service.findAllBenefactor();

      expect(row.email).toBe('adunola@example.com');
    });

    it('does not query users when there are no applications', async () => {
      professionalRepo.find.mockResolvedValue([]);

      await expect(service.findAllProfessional()).resolves.toEqual([]);
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('falls back to an empty email when the applicant user is missing', async () => {
      benefactorRepo.find.mockResolvedValue([{ id: APP_ID, userId: USER_ID }]);
      userRepo.find.mockResolvedValue([]);

      const [row] = await service.findAllBenefactor();

      expect(row.email).toBe('');
    });
  });

  describe('reviewProfessional', () => {
    it('approves the application and activates the user in one transaction', async () => {
      professionalRepo.findOne.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        status: ApplicationStatus.PENDING,
      });

      await service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' });

      expect(txUpdate).toHaveBeenCalledWith(
        APP_ID,
        expect.objectContaining({ status: ApplicationStatus.APPROVED, reviewedBy: ADMIN_ID }),
      );
      expect(txUserUpdate).toHaveBeenCalledWith({ id: USER_ID }, { status: 'active' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_APPROVE, resourceId: APP_ID }),
      );
    });

    it('rejects with a reason and leaves the user pending', async () => {
      professionalRepo.findOne.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        status: ApplicationStatus.PENDING,
      });

      await service.reviewProfessional(APP_ID, ADMIN_ID, {
        action: 'reject',
        reason: 'License could not be verified',
      });

      expect(txUpdate).toHaveBeenCalledWith(
        APP_ID,
        expect.objectContaining({
          status: ApplicationStatus.REJECTED,
          rejectionReason: 'License could not be verified',
        }),
      );
      expect(txUserUpdate).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ADMIN_REJECT }),
      );
    });

    it('throws 404 when the application does not exist', async () => {
      professionalRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when the application has already been reviewed', async () => {
      professionalRepo.findOne.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        status: ApplicationStatus.APPROVED,
      });

      await expect(
        service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reviewBenefactor', () => {
    it('approves the application and activates the user', async () => {
      benefactorRepo.findOne.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        status: ApplicationStatus.PENDING,
      });

      await service.reviewBenefactor(APP_ID, ADMIN_ID, { action: 'approve' });

      expect(txUserUpdate).toHaveBeenCalledWith({ id: USER_ID }, { status: 'active' });
    });

    it('throws 409 when the application has already been reviewed', async () => {
      benefactorRepo.findOne.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        status: ApplicationStatus.REJECTED,
      });

      await expect(
        service.reviewBenefactor(APP_ID, ADMIN_ID, { action: 'approve' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // None of these emails existed: professional and benefactor applicants were never
  // told their application arrived, nor that it had been approved or rejected.
  describe('applicant emails', () => {
    /** Asserts a SEND_APPLICATION_STATUS_JOB was enqueued with these fields. */
    function expectEmail(fields: Record<string, unknown>) {
      expect(mailQueue.add).toHaveBeenCalledWith(
        SEND_APPLICATION_STATUS_JOB,
        expect.objectContaining(fields),
        MAIL_JOB_OPTIONS,
      );
    }

    describe('on submission', () => {
      it('emails a professional applicant and alerts admins', async () => {
        professionalRepo.findOne.mockResolvedValue(null);

        await service.createProfessional(USER_ID, professionalDto);

        expectEmail({
          to: 'ada@example.com',
          role: ApplicantRole.PROFESSIONAL,
          event: ApplicationEmailEvent.RECEIVED,
        });
        // Previously nobody was told a professional application had arrived.
        expect(adminQueue.add).toHaveBeenCalledWith(
          APPLICATION_REVIEW_JOB,
          expect.objectContaining({ applicationType: 'professional_application' }),
        );
      });

      it('emails a benefactor applicant using their supplied full name', async () => {
        benefactorRepo.findOne.mockResolvedValue(null);

        await service.createBenefactor(USER_ID, benefactorDto);

        expectEmail({
          role: ApplicantRole.BENEFACTOR,
          event: ApplicationEmailEvent.RECEIVED,
          applicantName: 'Adunola Fashola',
        });
        expect(adminQueue.add).toHaveBeenCalledWith(
          APPLICATION_REVIEW_JOB,
          expect.objectContaining({ applicationType: 'benefactor_application' }),
        );
      });
    });

    describe('on review', () => {
      beforeEach(() => {
        professionalRepo.findOne.mockResolvedValue({
          id: APP_ID,
          userId: USER_ID,
          status: ApplicationStatus.PENDING,
        });
        benefactorRepo.findOne.mockResolvedValue({
          id: APP_ID,
          userId: USER_ID,
          fullName: 'Adunola Fashola',
          status: ApplicationStatus.PENDING,
        });
      });

      it('emails an approval to a professional', async () => {
        await service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' });

        expectEmail({ role: ApplicantRole.PROFESSIONAL, event: ApplicationEmailEvent.APPROVED });
      });

      it('emails a rejection with its reason', async () => {
        await service.reviewProfessional(APP_ID, ADMIN_ID, {
          action: 'reject',
          reason: 'Licence could not be verified',
        });

        expectEmail({
          event: ApplicationEmailEvent.REJECTED,
          reason: 'Licence could not be verified',
        });
      });

      it('emails a benefactor outcome too', async () => {
        await service.reviewBenefactor(APP_ID, ADMIN_ID, { action: 'approve' });

        expectEmail({ role: ApplicantRole.BENEFACTOR, event: ApplicationEmailEvent.APPROVED });
      });

      // The review has committed by this point; surfacing the enqueue failure would
      // make the admin retry into a 409 "not in a reviewable state".
      it('still succeeds when the mail enqueue fails', async () => {
        mailQueue.add.mockRejectedValue(new Error('redis unreachable'));

        await expect(
          service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' }),
        ).resolves.toBeDefined();

        expect(txUserUpdate).toHaveBeenCalledWith({ id: USER_ID }, { status: 'active' });
      });

      it('sends nothing when the applicant user row is missing', async () => {
        userRepo.findOne.mockResolvedValue(null);

        await expect(
          service.reviewProfessional(APP_ID, ADMIN_ID, { action: 'approve' }),
        ).resolves.toBeDefined();

        expect(mailQueue.add).not.toHaveBeenCalled();
      });
    });
  });
});
