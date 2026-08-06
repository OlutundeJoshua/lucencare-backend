import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ApplicationStatus, UserRole } from 'src/common/enums';
import { AuditAction } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { User } from 'src/modules/auth/entities/user.entity';

import { BenefactorOnboardingDto, ProfessionalOnboardingDto, ReviewApplicationDto } from './dto/applications.dto';
import { ProfessionalApplication } from './entities/professional-application.entity';
import { BenefactorApplication } from './entities/benefactor-application.entity';
import { ApplicationWithUser } from './interfaces/application-with-user.interface';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(ProfessionalApplication)
    private readonly professionalRepo: Repository<ProfessionalApplication>,
    @InjectRepository(BenefactorApplication)
    private readonly benefactorRepo: Repository<BenefactorApplication>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

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
