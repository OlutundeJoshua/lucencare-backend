import * as bcrypt from 'bcrypt';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Queue } from 'bullmq';

import { AuditAction, ConsentPurpose, ConsentStatus, HmoLinkRequestStatus, NotificationType, UserRole } from 'src/common/enums';
import { MAIL_QUEUE, SEND_PATIENT_CREDENTIALS_JOB } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { ExportService } from 'src/modules/export/export.service';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { User } from 'src/modules/auth/entities/user.entity';

import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { HmoLinkRequest } from './entities/hmo-link-request.entity';
import {
  CareEventQueryDto,
  CreateCareEventDto,
  CreatePatientDto,
  LookupPatientDto,
  UpdatePatientDto,
} from './dto/patient.dto';

export interface PatientSummaryData {
  patient: Patient;
  careEvents: CareEvent[];
}

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(CareEvent)
    private readonly careEventRepo: Repository<CareEvent>,

    @InjectRepository(HmoLinkRequest)
    private readonly linkRequestRepo: Repository<HmoLinkRequest>,

    @InjectRepository(ConsentGrant)
    private readonly consentGrantRepo: Repository<ConsentGrant>,

    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,

    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly exportService: ExportService,
    private readonly auditService: AuditService,

    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue,

    private readonly configService: ConfigService,
  ) {}

  // Called by AuthService inside the patient registration transaction.
  async createForUser(userId: string, dto: CreatePatientDto, manager: EntityManager): Promise<Patient> {
    const repo = manager.getRepository(Patient);
    const patient = repo.create({
      userId,
      name: dto.name,
      phone: dto.phone,
      membershipNumber: dto.membershipNumber,
      dateOfBirth: dto.dateOfBirth,
      gender: dto.gender,
      address: dto.address,
      conditionTags: dto.conditionTags ?? [],
      directContactShared: false,
    });
    return repo.save(patient);
  }

  async getMyProfile(userId: string): Promise<Patient> {
    const patient = await this.patientRepo.findOne({ where: { userId } });
    if (!patient) throw new NotFoundException('Patient profile not found');
    return patient;
  }

  async updateMyProfile(userId: string, dto: UpdatePatientDto): Promise<Patient> {
    await this.getMyProfile(userId);

    const updates: Partial<Patient> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.conditionTags !== undefined) updates.conditionTags = dto.conditionTags;
    if (dto.dateOfBirth !== undefined) updates.dateOfBirth = dto.dateOfBirth;
    if (dto.gender !== undefined) updates.gender = dto.gender;
    if (dto.address !== undefined) updates.address = dto.address;
    if (dto.medicationList !== undefined) updates.medicationList = dto.medicationList as object[];
    if (dto.directContactShared !== undefined) updates.directContactShared = dto.directContactShared;

    await this.patientRepo.update({ userId }, updates);
    return this.getMyProfile(userId);
  }

  async lookupPatient(dto: LookupPatientDto, _orgId: string): Promise<Patient> {
    if (!dto.phone && !dto.membershipNumber) {
      throw new BadRequestException('At least one of phone or membershipNumber is required');
    }

    const qb = this.patientRepo.createQueryBuilder('p').where('p.deleted_at IS NULL');

    if (dto.phone && dto.membershipNumber) {
      qb.andWhere('(p.phone = :phone OR p.membership_number = :membershipNumber)', {
        phone: dto.phone,
        membershipNumber: dto.membershipNumber,
      });
    } else if (dto.phone) {
      qb.andWhere('p.phone = :phone', { phone: dto.phone });
    } else {
      qb.andWhere('p.membership_number = :membershipNumber', { membershipNumber: dto.membershipNumber });
    }

    const patient = await qb.getOne();
    if (!patient) throw new NotFoundException('Patient not found');

    // Consent check must live in SQL — never filter in JS (CLAUDE.md)
    const consentCount = await this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId: patient.id })
      .andWhere('cg.purpose = :purpose', { purpose: ConsentPurpose.HMO_CARE })
      .andWhere('cg.status = :status', { status: ConsentStatus.ACTIVE })
      .andWhere('cg.deleted_at IS NULL')
      .getCount();

    // 404 — do not reveal patient exists without consent (spec BR-2)
    if (!consentCount) throw new NotFoundException('Patient not found');

    return patient;
  }

  async createPatient(dto: CreatePatientDto, orgId: string): Promise<Patient> {
    const existingByPhone = await this.patientRepo.findOne({ where: { phone: dto.phone } });
    if (existingByPhone) throw new ConflictException('Phone number already registered');

    if (dto.membershipNumber) {
      const existingByMembership = await this.patientRepo.findOne({ where: { membershipNumber: dto.membershipNumber } });
      if (existingByMembership) throw new ConflictException('Membership number already registered');
    }

    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);
    const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12).toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, saltRounds);

    const patient = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const patientRepo = manager.getRepository(Patient);

      const user = userRepo.create({
        role: UserRole.PATIENT,
        email: dto.email,
        passwordHash,
        status: 'active',
      });
      await userRepo.save(user);

      const newPatient = patientRepo.create({
        userId: user.id,
        name: dto.name,
        phone: dto.phone,
        membershipNumber: dto.membershipNumber,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        address: dto.address,
        conditionTags: dto.conditionTags ?? [],
        hmoId: orgId, // set from JWT, never from request body (CLAUDE.md)
        directContactShared: false,
      });
      return patientRepo.save(newPatient);
    });

    await this.mailQueue.add(SEND_PATIENT_CREDENTIALS_JOB, {
      to: dto.email,
      tempPassword,
    });

    return patient;
  }

  async createLinkRequest(patientId: string, orgId: string): Promise<HmoLinkRequest> {
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const consentCount = await this.consentGrantRepo
      .createQueryBuilder('cg')
      .where('cg.patient_id = :patientId', { patientId })
      .andWhere('cg.purpose = :purpose', { purpose: ConsentPurpose.HMO_CARE })
      .andWhere('cg.status = :status', { status: ConsentStatus.ACTIVE })
      .andWhere('cg.deleted_at IS NULL')
      .getCount();

    if (!consentCount) {
      throw new ForbiddenException('Patient does not have an active HMO_CARE consent grant');
    }

    if (patient.hmoId) {
      throw new ConflictException('Patient is already linked to an HMO');
    }

    const existingPending = await this.linkRequestRepo.findOne({
      where: { patientId, orgId, status: HmoLinkRequestStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException('A pending link request already exists for this patient-org pair');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const linkRequest = this.linkRequestRepo.create({
      patientId,
      orgId,
      status: HmoLinkRequestStatus.PENDING,
      expiresAt,
    });
    await this.linkRequestRepo.save(linkRequest);

    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    const orgName = org?.name ?? '';

    await this.notificationsService.createOne(patient.userId, NotificationType.HMO_LINK_REQUEST, {
      orgId,
      orgName,
      linkRequestId: linkRequest.id,
    });

    return linkRequest;
  }

  async getMyLinkRequests(patientUserId: string, status?: HmoLinkRequestStatus): Promise<HmoLinkRequest[]> {
    const patient = await this.getMyProfile(patientUserId);

    const qb = this.linkRequestRepo
      .createQueryBuilder('lr')
      .where('lr.patient_id = :patientId', { patientId: patient.id });

    if (status) {
      qb.andWhere('lr.status = :status', { status });
    }

    // LR-7: hide expired pending rows unless explicitly filtering for approved/rejected
    const showExpired = status === HmoLinkRequestStatus.APPROVED || status === HmoLinkRequestStatus.REJECTED;
    if (!showExpired) {
      qb.andWhere("(lr.status != :pending OR lr.expires_at > NOW())", {
        pending: HmoLinkRequestStatus.PENDING,
      });
    }

    return qb.getMany();
  }

  async respondToLinkRequest(
    requestId: string,
    patientUserId: string,
    action: 'approve' | 'reject',
  ): Promise<HmoLinkRequest> {
    const patient = await this.getMyProfile(patientUserId);

    const request = await this.linkRequestRepo.findOne({
      where: { id: requestId, patientId: patient.id },
    });
    if (!request) throw new NotFoundException('Link request not found');

    if (request.status !== HmoLinkRequestStatus.PENDING) {
      throw new ConflictException('Link request has already been actioned');
    }

    if (request.expiresAt < new Date()) {
      throw new HttpException('Link request has expired', HttpStatus.GONE);
    }

    if (action === 'approve') {
      await this.dataSource.transaction(async (manager) => {
        const patientRepo = manager.getRepository(Patient);
        const linkRepo = manager.getRepository(HmoLinkRequest);

        // Re-fetch inside transaction for race condition safety (LR-4)
        const freshPatient = await patientRepo.findOne({ where: { id: patient.id } });
        if (freshPatient?.hmoId) {
          throw new ConflictException('Patient is already linked to an HMO');
        }

        await patientRepo.update({ id: patient.id }, { hmoId: request.orgId });
        await linkRepo.update({ id: requestId }, { status: HmoLinkRequestStatus.APPROVED });
      });
    } else {
      await this.linkRequestRepo.update({ id: requestId }, { status: HmoLinkRequestStatus.REJECTED });
    }

    const updated = await this.linkRequestRepo.findOne({ where: { id: requestId } });
    return updated!;
  }

  async getPatientById(id: string, orgId: string): Promise<Patient> {
    const patient = await this.patientRepo.findOne({ where: { id, hmoId: orgId } });
    if (!patient) throw new NotFoundException('Patient not found or not within org scope');
    return patient;
  }

  async getCareEvents(
    patientId: string,
    orgId: string,
    query: CareEventQueryDto,
  ): Promise<{ events: CareEvent[]; nextCursor?: string }> {
    await this.getPatientById(patientId, orgId);

    const qb = this.careEventRepo
      .createQueryBuilder('ce')
      .where('ce.patient_id = :patientId', { patientId })
      .andWhere('ce.deleted_at IS NULL')
      .orderBy('ce.id', 'ASC')
      .take(query.limit + 1);

    if (query.cursor) {
      qb.andWhere('ce.id > :cursor', { cursor: query.cursor });
    }

    if (query.type) {
      qb.andWhere('ce.type = :type', { type: query.type });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > query.limit;
    if (hasMore) rows.pop();
    const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;

    return { events: rows, nextCursor };
  }

  async createCareEvent(patientId: string, orgId: string, dto: CreateCareEventDto): Promise<CareEvent> {
    await this.getPatientById(patientId, orgId);

    const event = this.careEventRepo.create({
      patientId,
      type: dto.type,
      eventDate: new Date(dto.eventDate) as unknown as Date,
      providerName: dto.providerName,
      structured: dto.structured,
      notes: dto.notes,
    });

    return this.careEventRepo.save(event);
  }

  async getPatientSummary(patientId: string, orgId: string, exportToken: string): Promise<PatientSummaryData> {
    // Single-use token validation — throws UnauthorizedException if invalid/expired/consumed
    const tokenPayload = await this.exportService.validateAndConsumeToken(exportToken) as unknown as { patientId?: string } | null;

    if (!tokenPayload || tokenPayload.patientId !== patientId) {
      throw new UnauthorizedException('Export token does not match requested patient');
    }

    const patient = await this.getPatientById(patientId, orgId);

    const careEvents = await this.careEventRepo
      .createQueryBuilder('ce')
      .where('ce.patient_id = :patientId', { patientId })
      .andWhere('ce.deleted_at IS NULL')
      .orderBy('ce.id', 'ASC')
      .getMany();

    // Audit BEFORE returning — BR-8: must be recorded even if caller discards the result (E-03)
    await this.auditService.log({
      actorId: patient.userId,
      action: AuditAction.EXPORT,
      resourceId: patientId,
      resourceType: 'patient',
      metadata: { orgId },
    });

    return { patient, careEvents };
  }
}
