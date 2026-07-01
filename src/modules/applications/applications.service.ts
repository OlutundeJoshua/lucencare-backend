import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ApplicationStatus, UserRole } from 'src/common/enums';
import { AuditAction } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { User } from 'src/modules/auth/entities/user.entity';

import { BenefactorOnboardingDto, ProfessionalOnboardingDto, ReviewApplicationDto } from './dto/applications.dto';
import { ProfessionalApplication } from './entities/professional-application.entity';
import { BenefactorApplication } from './entities/benefactor-application.entity';

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

    const application = this.professionalRepo.create({
      userId,
      profession: dto.profession,
      licenseNumber: dto.licenseNumber,
      specialty: dto.specialty,
      yearsOfExperience: dto.yearsOfExperience,
      phone: dto.phone,
      bio: dto.bio,
      status: ApplicationStatus.PENDING,
    });

    return this.professionalRepo.save(application);
  }

  async createBenefactor(userId: string, dto: BenefactorOnboardingDto): Promise<BenefactorApplication> {
    const existing = await this.benefactorRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('Benefactor application already submitted');
    }

    const application = this.benefactorRepo.create({
      userId,
      fullName: dto.fullName,
      phone: dto.phone,
      reasonForSupport: dto.reasonForSupport,
      idConsentGiven: true,
      status: ApplicationStatus.PENDING,
    });

    return this.benefactorRepo.save(application);
  }

  async findAllProfessional(status?: ApplicationStatus): Promise<ProfessionalApplication[]> {
    const where = status ? { status } : {};
    return this.professionalRepo.find({ where, order: { submittedAt: 'DESC' } });
  }

  async findAllBenefactor(status?: ApplicationStatus): Promise<BenefactorApplication[]> {
    const where = status ? { status } : {};
    return this.benefactorRepo.find({ where, order: { submittedAt: 'DESC' } });
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

  async getProfessionalByUser(userId: string): Promise<ProfessionalApplication | null> {
    return this.professionalRepo.findOne({ where: { userId } });
  }

  async getBenefactorByUser(userId: string): Promise<BenefactorApplication | null> {
    return this.benefactorRepo.findOne({ where: { userId } });
  }
}
