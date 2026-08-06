import { Queue } from 'bullmq';

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ApplicantRole, ApplicationEmailEvent, ApplicationStatus, UserRole } from 'src/common/enums';
import { AuditAction } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { User } from 'src/modules/auth/entities/user.entity';
import {
  ADMIN_QUEUE,
  APPLICATION_REVIEW_JOB,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  SEND_APPLICATION_STATUS_JOB,
} from 'src/queues/queues.constants';
import { ApplicationReviewJob } from 'src/queues/interfaces/application-review-job.interface';
import { SendApplicationStatusJob } from 'src/queues/interfaces/send-application-status-job.interface';

import { BenefactorOnboardingDto, ProfessionalOnboardingDto, ReviewApplicationDto } from './dto/applications.dto';
import { ProfessionalApplication } from './entities/professional-application.entity';
import { BenefactorApplication } from './entities/benefactor-application.entity';
import { ApplicationWithUser } from './interfaces/application-with-user.interface';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectRepository(ProfessionalApplication)
    private readonly professionalRepo: Repository<ProfessionalApplication>,
    @InjectRepository(BenefactorApplication)
    private readonly benefactorRepo: Repository<BenefactorApplication>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
  ) {}

  /**
   * Applications store only userId; the email and display name live on `users`.
   * BenefactorApplication also has its own fullName, preferred where present.
   */
  private async applicantContact(userId: string, fallbackName?: string): Promise<{ email: string; name: string } | null> {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'name', 'email'] });
    if (!user) return null;
    return { email: user.email, name: fallbackName || user.name || user.email };
  }

  /**
   * Both enqueues are guarded: by the time they run the application row has already
   * been written, so letting a queue outage throw would report failure for work that
   * succeeded — and on the review paths a retry then hits 409 "not in a reviewable state".
   */
  private async enqueueApplicantEmail(payload: SendApplicationStatusJob): Promise<void> {
    try {
      await this.mailQueue.add(SEND_APPLICATION_STATUS_JOB, payload, MAIL_JOB_OPTIONS);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${payload.event} email for ${payload.role}: ${(err as Error).message}`,
      );
    }
  }

  private async enqueueAdminReviewAlert(payload: ApplicationReviewJob): Promise<void> {
    try {
      await this.adminQueue.add(APPLICATION_REVIEW_JOB, payload);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue admin alert for ${payload.applicationType} ${payload.applicationId}: ${(err as Error).message}`,
      );
    }
  }

  async createProfessional(userId: string, dto: ProfessionalOnboardingDto): Promise<ProfessionalApplication> {
    const existing = await this.professionalRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('Professional application already submitted');
    }

    const now = new Date();
    const application = this.professionalRepo.create({
      userId,
      profession: dto.profession,
      licenseNumber: dto.licenseNumber,
      specialty: dto.specialty,
      yearsOfExperience: dto.yearsOfExperience,
      phone: dto.phone,
      bio: dto.bio,
      termsConsentAt: now,
      codeOfConductConsentAt: now,
      status: ApplicationStatus.PENDING,
    });

    const saved = await this.professionalRepo.save(application);

    await this.auditService.log({
      actorId: userId,
      action: AuditAction.APPLICATION_SUBMITTED,
      resourceId: saved.id,
      resourceType: 'professional_application',
    });

    const contact = await this.applicantContact(userId);
    if (contact) {
      await this.enqueueApplicantEmail({
        to: contact.email,
        applicantName: contact.name,
        role: ApplicantRole.PROFESSIONAL,
        event: ApplicationEmailEvent.RECEIVED,
      });
      await this.enqueueAdminReviewAlert({
        applicationId: saved.id,
        applicationType: 'professional_application',
        applicantName: contact.name,
        applicantEmail: contact.email,
      });
    }

    return saved;
  }

  async createBenefactor(userId: string, dto: BenefactorOnboardingDto): Promise<BenefactorApplication> {
    const existing = await this.benefactorRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('Benefactor application already submitted');
    }

    const now = new Date();
    const application = this.benefactorRepo.create({
      userId,
      fullName: dto.fullName,
      phone: dto.phone,
      reasonForSupport: dto.reasonForSupport,
      idConsentGiven: dto.idConsent,
      idConsentAt: now,
      termsConsentAt: now,
      codeOfConductConsentAt: now,
      status: ApplicationStatus.PENDING,
    });

    const saved = await this.benefactorRepo.save(application);

    await this.auditService.log({
      actorId: userId,
      action: AuditAction.APPLICATION_SUBMITTED,
      resourceId: saved.id,
      resourceType: 'benefactor_application',
    });

    const contact = await this.applicantContact(userId, saved.fullName);
    if (contact) {
      await this.enqueueApplicantEmail({
        to: contact.email,
        applicantName: contact.name,
        role: ApplicantRole.BENEFACTOR,
        event: ApplicationEmailEvent.RECEIVED,
      });
      await this.enqueueAdminReviewAlert({
        applicationId: saved.id,
        applicationType: 'benefactor_application',
        applicantName: contact.name,
        applicantEmail: contact.email,
      });
    }

    return saved;
  }

  async findAllProfessional(
    status?: ApplicationStatus,
  ): Promise<(ProfessionalApplication & ApplicationWithUser)[]> {
    const where = status ? { status } : {};
    const rows = await this.professionalRepo.find({ where, order: { submittedAt: 'DESC' } });
    return this.attachApplicant(rows);
  }

  async findAllBenefactor(
    status?: ApplicationStatus,
  ): Promise<(BenefactorApplication & ApplicationWithUser)[]> {
    const where = status ? { status } : {};
    const rows = await this.benefactorRepo.find({ where, order: { submittedAt: 'DESC' } });
    return this.attachApplicant(rows);
  }

  // Application rows carry only userId. The admin review screens display the
  // applicant's email (and, for professionals, their name — the table has no
  // name column of its own), so enrich list responses from users.
  private async attachApplicant<T extends { userId: string }>(
    rows: T[],
  ): Promise<(T & ApplicationWithUser)[]> {
    if (rows.length === 0) return [];

    const users = await this.userRepo.find({
      where: { id: In(rows.map((r) => r.userId)) },
      select: ['id', 'name', 'email'],
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((row) => {
      const user = byId.get(row.userId);
      return Object.assign(row, { email: user?.email ?? '', name: user?.name });
    });
  }

  async reviewProfessional(
    id: string,
    adminId: string,
    dto: ReviewApplicationDto,
  ): Promise<ProfessionalApplication> {
    const application = await this.professionalRepo.findOne({ where: { id } });
    if (!application) throw new NotFoundException('Professional application not found');

    if (application.status !== ApplicationStatus.PENDING) {
      throw new ConflictException('Application is not in a reviewable state');
    }

    const newStatus = dto.action === 'approve' ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProfessionalApplication).update(id, {
        status: newStatus,
        rejectionReason: dto.reason,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      });

      if (dto.action === 'approve') {
        await manager.getRepository(User).update(
          { id: application.userId },
          { status: 'active' },
        );
      }
    });

    await this.auditService.log({
      actorId: adminId,
      action: dto.action === 'approve' ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT,
      resourceId: id,
      resourceType: 'professional_application',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    const contact = await this.applicantContact(application.userId);
    if (contact) {
      await this.enqueueApplicantEmail({
        to: contact.email,
        applicantName: contact.name,
        role: ApplicantRole.PROFESSIONAL,
        event: dto.action === 'approve' ? ApplicationEmailEvent.APPROVED : ApplicationEmailEvent.REJECTED,
        reason: dto.reason,
      });
    }

    return this.professionalRepo.findOne({ where: { id } }) as Promise<ProfessionalApplication>;
  }

  async reviewBenefactor(
    id: string,
    adminId: string,
    dto: ReviewApplicationDto,
  ): Promise<BenefactorApplication> {
    const application = await this.benefactorRepo.findOne({ where: { id } });
    if (!application) throw new NotFoundException('Benefactor application not found');

    if (application.status !== ApplicationStatus.PENDING) {
      throw new ConflictException('Application is not in a reviewable state');
    }

    const newStatus = dto.action === 'approve' ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BenefactorApplication).update(id, {
        status: newStatus,
        rejectionReason: dto.reason,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      });

      if (dto.action === 'approve') {
        await manager.getRepository(User).update(
          { id: application.userId },
          { status: 'active' },
        );
      }
    });

    await this.auditService.log({
      actorId: adminId,
      action: dto.action === 'approve' ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT,
      resourceId: id,
      resourceType: 'benefactor_application',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    const contact = await this.applicantContact(application.userId, application.fullName);
    if (contact) {
      await this.enqueueApplicantEmail({
        to: contact.email,
        applicantName: contact.name,
        role: ApplicantRole.BENEFACTOR,
        event: dto.action === 'approve' ? ApplicationEmailEvent.APPROVED : ApplicationEmailEvent.REJECTED,
        reason: dto.reason,
      });
    }

    return this.benefactorRepo.findOne({ where: { id } }) as Promise<BenefactorApplication>;
  }

  async updateProfessionalBio(userId: string, bio: string): Promise<ProfessionalApplication> {
    const application = await this.professionalRepo.findOne({ where: { userId } });
    if (!application) throw new NotFoundException('Professional application not found');

    await this.professionalRepo.update({ id: application.id }, { bio });

    return this.professionalRepo.findOne({
      where: { id: application.id },
    }) as Promise<ProfessionalApplication>;
  }

  async getProfessionalByUser(userId: string): Promise<ProfessionalApplication | null> {
    return this.professionalRepo.findOne({ where: { userId } });
  }

  async getBenefactorByUser(userId: string): Promise<BenefactorApplication | null> {
    return this.benefactorRepo.findOne({ where: { userId } });
  }
}
