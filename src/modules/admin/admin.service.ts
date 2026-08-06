import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import {
  ApplicantRole,
  ApplicationEmailEvent,
  AuditAction,
  OrgStatus,
  OrgType,
  ProgramStatus,
  StudyStatus,
} from 'src/common/enums';
import { AuditService } from 'src/modules/audit/audit.service';
import { User } from 'src/modules/auth/entities/user.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { Program } from 'src/modules/programs/entities/program.entity';
import { ProgramsService } from 'src/modules/programs/programs.service';
import { Study } from 'src/modules/studies/entities/study.entity';
import { StudiesService } from 'src/modules/studies/studies.service';
import { MatchingService } from 'src/modules/matching/matching.service';
import {
  ADMIN_QUEUE,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  PROGRAM_APPROVED_JOB,
  PROGRAM_REJECTED_JOB,
  SEND_APPLICATION_STATUS_JOB,
  STUDY_APPROVED_JOB,
  STUDY_REJECTED_JOB,
} from 'src/queues/queues.constants';
import { SendApplicationStatusJob } from 'src/queues/interfaces/send-application-status-job.interface';

import { AdminApproveDto } from './dto/admin-approve.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly orgsService: OrganizationsService,
    private readonly programsService: ProgramsService,
    private readonly studiesService: StudiesService,
    private readonly matchingService: MatchingService,
    private readonly auditService: AuditService,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    private readonly dataSource: DataSource,
  ) {}

  async reviewOrganization(orgId: string, adminUserId: string, dto: AdminApproveDto): Promise<Organization> {
    // Dependent service stubs have no return type annotations; cast to entity
    const org = (await this.orgsService.findOne(orgId)) as unknown as Organization;

    if (org.status !== OrgStatus.PENDING_VERIFICATION) {
      throw new ConflictException('Organization is not in a reviewable state');
    }

    const approved = dto.status === 'approved';
    const newStatus = approved ? OrgStatus.ACTIVE : OrgStatus.REJECTED;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Organization).update(
        { id: orgId },
        {
          status: newStatus,
          rejectionReason: approved ? undefined : dto.reason,
          verifiedAt: approved ? new Date() : undefined,
          verifiedBy: approved ? adminUserId : undefined,
        },
      );

      // Parity with the professional/benefactor review path: approval activates
      // the staff account, otherwise NGO/HMO users stay 'pending' forever.
      if (approved) {
        await manager.getRepository(User).update({ orgId }, { status: 'active' });
      }
    });

    const auditAction = approved ? AuditAction.ADMIN_APPROVE : AuditAction.ADMIN_REJECT;
    await this.auditService.log({
      actorId: adminUserId,
      action: auditAction,
      resourceId: orgId,
      resourceType: 'organization',
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    // org.createdBy is null for orgs created during unauthenticated signup — the
    // EntityActorSubscriber has no CLS userId to read. Resolve the staff user by orgId.
    // Selecting email/name here too, so telling them the outcome costs no extra query.
    const staffUser = await this.dataSource
      .getRepository(User)
      .findOne({ where: { orgId }, select: ['id', 'email', 'name'] });

    // Replaces ORG_VERIFIED_JOB / ORG_REJECTED_JOB, which were enqueued on ADMIN_QUEUE
    // with no handler — AdminQueueProcessor's `default: return` plus removeOnComplete
    // meant every approval and rejection was silently discarded.
    await this.enqueueOutcomeEmail({
      to: staffUser?.email ?? org.contactEmail,
      applicantName: org.name,
      // Both org types come through here, so read the type rather than assuming NGO.
      role: org.type === OrgType.HMO ? ApplicantRole.HMO : ApplicantRole.NGO,
      event: approved ? ApplicationEmailEvent.APPROVED : ApplicationEmailEvent.REJECTED,
      reason: dto.reason,
    });

    return (await this.orgsService.findOne(orgId)) as unknown as Organization;
  }

  /**
   * The review has already committed by the time this runs. If the enqueue threw, the
   * admin would see a 500 for an approval that succeeded and a 409 "not in a
   * reviewable state" on retry — so a queue outage is logged, not surfaced.
   */
  private async enqueueOutcomeEmail(payload: SendApplicationStatusJob): Promise<void> {
    try {
      await this.mailQueue.add(SEND_APPLICATION_STATUS_JOB, payload, MAIL_JOB_OPTIONS);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${payload.event} email for ${payload.role}: ${(err as Error).message}`,
      );
    }
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
