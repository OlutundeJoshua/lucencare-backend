import { ConflictException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { AuditAction, OrgStatus, ProgramStatus, StudyStatus } from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { Program } from 'src/modules/programs/entities/program.entity';
import { ProgramsService } from 'src/modules/programs/programs.service';
import { Study } from 'src/modules/studies/entities/study.entity';
import { StudiesService } from 'src/modules/studies/studies.service';
import { MatchingService } from 'src/modules/matching/matching.service';
import {
  ADMIN_QUEUE,
  ORG_REJECTED_JOB,
  ORG_VERIFIED_JOB,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  STUDY_APPROVED_JOB,
  STUDY_REJECTED_JOB,
} from 'src/queues/queues.constants';

import { AdminApproveDto } from './dto/admin-approve.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly orgsService: OrganizationsService,
    private readonly programsService: ProgramsService,
    private readonly studiesService: StudiesService,
    private readonly matchingService: MatchingService,
    private readonly auditService: AuditService,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
  ) {}

  async reviewOrganization(orgId: string, adminUserId: string, dto: AdminApproveDto): Promise<Organization> {
    // Dependent service stubs have no return type annotations; cast to entity
    const org = (await this.orgsService.findOne(orgId)) as unknown as Organization;

    if (org.status !== OrgStatus.PENDING_VERIFICATION) {
      throw new ConflictException('Organization is not in a reviewable state');
    }

    const newStatus = dto.status === 'approved' ? OrgStatus.ACTIVE : OrgStatus.REJECTED;
    await this.orgsService.updateStatus(orgId, newStatus, adminUserId);

    const auditAction = dto.status === 'approved' ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT;
    await this.auditService.log({
      actorId: adminUserId,
      action: auditAction,
      resourceId: orgId,
      resourceType: 'organization',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    if (dto.status === 'approved') {
      await this.adminQueue.add(ORG_VERIFIED_JOB, {
        orgId: org.id,
        creatorUserId: org.createdBy,
        orgName: org.name,
      });
    } else {
      await this.adminQueue.add(ORG_REJECTED_JOB, {
        orgId: org.id,
        creatorUserId: org.createdBy,
        reason: dto.reason,
      });
    }

    return (await this.orgsService.findOne(orgId)) as unknown as Organization;
  }

  async reviewProgram(programId: string, adminUserId: string, dto: AdminApproveDto): Promise<Program> {
    const program = (await this.programsService.findOne(programId)) as unknown as Program;

    if (program.status !== ProgramStatus.PENDING_REVIEW) {
      throw new ConflictException('Program is not in a reviewable state');
    }

    const newStatus = dto.status === 'approved' ? ProgramStatus.APPROVED : ProgramStatus.REJECTED;
    await this.programsService.updateStatus(programId, newStatus);

    if (dto.status === 'approved') {
      await this.matchingService.indexProgram(programId);
    }

    const auditAction = dto.status === 'approved' ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT;
    await this.auditService.log({
      actorId: adminUserId,
      action: auditAction,
      resourceId: programId,
      resourceType: 'program',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    if (dto.status === 'approved') {
      await this.adminQueue.add(PROGRAM_APPROVED_JOB, {
        programId: program.id,
        orgAdminUserId: program.createdBy,
        programTitle: program.title,
      });
    } else {
      await this.adminQueue.add(PROGRAM_REJECTED_JOB, {
        programId: program.id,
        orgAdminUserId: program.createdBy,
        reason: dto.reason,
      });
    }

    return (await this.programsService.findOne(programId)) as unknown as Program;
  }

  async reviewStudy(studyId: string, adminUserId: string, dto: AdminApproveDto): Promise<Study> {
    const study = (await this.studiesService.findOne(studyId)) as unknown as Study;

    if (study.status !== StudyStatus.PENDING_REVIEW) {
      throw new ConflictException('Study is not in a reviewable state');
    }

    const newStatus = dto.status === 'approved' ? StudyStatus.APPROVED : StudyStatus.REJECTED;
    await this.studiesService.updateStatus(studyId, newStatus);

    if (dto.status === 'approved') {
      await this.matchingService.indexStudy(studyId);
    }

    const auditAction = dto.status === 'approved' ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT;
    await this.auditService.log({
      actorId: adminUserId,
      action: auditAction,
      resourceId: studyId,
      resourceType: 'study',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    if (dto.status === 'approved') {
      await this.adminQueue.add(STUDY_APPROVED_JOB, {
        studyId: study.id,
        researcherUserId: study.researcherId,
        studyTitle: study.title,
      });
    } else {
      await this.adminQueue.add(STUDY_REJECTED_JOB, {
        studyId: study.id,
        researcherUserId: study.researcherId,
        reason: dto.reason,
      });
    }

    return (await this.studiesService.findOne(studyId)) as unknown as Study;
  }
}
