import { randomBytes } from 'crypto';

import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { ulid } from 'ulid';
import { Queue } from 'bullmq';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Redis } from 'ioredis';

import {
  ApplicantRole,
  ApplicationEmailEvent,
  AuditAction,
  ConsentPurpose,
  ConsentStatus,
  OrgStatus,
  OrgType,
  UserRole,
} from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import {
  CLIENT_ROLE_TO_USER_ROLE,
  USER_ROLE_TO_CLIENT_ROLE,
} from 'src/common/constants/client-roles';
import {
  ADMIN_QUEUE,
  MAIL_JOB_OPTIONS,
  MAIL_QUEUE,
  ORG_VERIFICATION_JOB,
  SEND_APPLICATION_STATUS_JOB,
  SEND_OTP_JOB,
  SEND_PATIENT_ONBOARDING_WELCOME_JOB,
  SEND_RESET_PASSWORD_JOB,
} from 'src/queues/queues.constants';
import { SendApplicationStatusJob } from 'src/queues/interfaces/send-application-status-job.interface';
import { AuditService } from 'src/modules/audit/audit.service';
import { ApplicationsService } from 'src/modules/applications/applications.service';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';

import { User } from './entities/user.entity';
import {
  ForgotPasswordDto,
  HmoOnboardingDto,
  LoginDto,
  NgoOnboardingDto,
  PatientOnboardingDto,
  RegisterOrgDto,
  RegisterPatientDto,
  RegisterResearcherDto,
  RequestOtpDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';
import { AuthPayload } from './interfaces/auth-payload.interface';
import { MeResponse } from './interfaces/me-response.interface';

// Assumption A-1: Patient and org registration use DataSource.transaction() with manager.getRepository()
// directly for atomic cross-entity writes. PatientsService.createForUser() does not exist in the
// current stub; the Patient row is built inline here. The patients team should be aware their eventual
// createForUser must produce consistent rows.
//
// The entity classes are imported by TypeScript path only — no circular NestJS DI dependency.
// DataSource resolves them because AppModule imports the owning modules with autoLoadEntities: true.
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Organization } from 'src/modules/organizations/entities/organization.entity';
import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';

const OTP_TTL_SECONDS = 600; // 10 minutes — spec says 600; app.config defaults to 300 (see follow-up A-5)
const RESET_TOKEN_TTL_SECONDS = 3600; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
    private readonly auditService: AuditService,
    private readonly applicationsService: ApplicationsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async registerPatient(dto: RegisterPatientDto): Promise<AuthPayload> {
    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);

    const { user } = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const patientRepo = manager.getRepository(Patient);
      const consentGrantRepo = manager.getRepository(ConsentGrant);

      const existingByEmail = await userRepo.findOne({ where: { email: dto.email } });
      if (existingByEmail) {
        throw new ConflictException('Email address is already registered');
      }

      const existingByPhone = await patientRepo.findOne({ where: { phone: dto.phone } });
      if (existingByPhone) {
        throw new ConflictException('Phone number is already registered');
      }

      if (dto.membershipNumber) {
        const existingByMembership = await patientRepo.findOne({
          where: { membershipNumber: dto.membershipNumber },
        });
        if (existingByMembership) {
          throw new ConflictException('Membership number is already registered');
        }
      }

      const passwordHash = await bcrypt.hash(dto.password, saltRounds);

      const user = userRepo.create({
        role: UserRole.PATIENT,
        email: dto.email,
        passwordHash,
        status: 'active',
      });
      await userRepo.save(user);

      const patient = patientRepo.create({
        userId: user.id,
        name: dto.name,
        phone: dto.phone,
        membershipNumber: dto.membershipNumber,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        address: dto.address,
        conditionTags: dto.conditionTags ?? [],
        // Assumption A-1: hmoId is always null at registration — never from body
        directContactShared: false,
      });
      await patientRepo.save(patient);

      // Assumption A-2: dataScopes drawn from SNAPSHOT_FIELDS — single source of truth
      for (const purpose of dto.consentPurposes) {
        const consentGrant = consentGrantRepo.create({
          patientId: patient.id,
          purpose,
          dataScopes: SNAPSHOT_FIELDS[purpose],
          status: ConsentStatus.ACTIVE,
          grantedAt: new Date(),
        });
        await consentGrantRepo.save(consentGrant);
      }

      return { user, patient };
    });

    await this.auditService.log({
      actorId: user.id,
      action: AuditAction.LOGIN,
      resourceId: user.id,
      resourceType: 'User',
      metadata: { event: 'patient_registration' },
    });

    return this.buildAuthPayload(user);
  }

  async registerOrg(dto: RegisterOrgDto): Promise<AuthPayload> {
    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);

    const { user, org } = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const orgRepo = manager.getRepository(Organization);

      const existingByEmail = await userRepo.findOne({ where: { email: dto.email } });
      if (existingByEmail) {
        throw new ConflictException('Email address is already registered');
      }

      const passwordHash = await bcrypt.hash(dto.password, saltRounds);

      // TODO (V2): replace inline org creation with OrganizationsService.create(dto, manager).
      // OrganizationsService.create(dto, manager) exists and is ready to be wired.
      // Left inline here (same pattern as Patient) because the service stub was not yet
      // implemented when AuthModule was written. When wiring: inject OrganizationsService
      // into AuthService and replace the block below with:
      //   const org = await this.orgsService.create({ name: dto.orgName, type: dto.orgType, contactEmail: dto.contactEmail }, manager);
      const org = orgRepo.create({
        name: dto.orgName,
        type: dto.orgType,
        contactEmail: dto.contactEmail,
        status: OrgStatus.PENDING_VERIFICATION,
      });
      await orgRepo.save(org);

      // Assumption A-4: org staff get a token immediately; status 'pending' blocks org-scoped routes
      const user = userRepo.create({
        role: dto.role as UserRole,
        orgId: org.id,
        email: dto.email,
        passwordHash,
        status: 'pending',
      });
      await userRepo.save(user);

      return { user, org };
    });

    await this.adminQueue.add(ORG_VERIFICATION_JOB, {
      orgId: org.id,
      orgName: org.name,
      contactEmail: org.contactEmail,
    });

    return this.buildAuthPayload(user, dto.orgName);
  }

  async registerResearcher(dto: RegisterResearcherDto): Promise<AuthPayload> {
    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);

    // Assumption A-6: domain allowlist read from ALLOWED_INSTITUTION_DOMAINS env var.
    // In development, if the var is absent the check is skipped. In production it is enforced.
    this.validateInstitutionalDomain(dto.email);

    const storedOtp = await this.redis.get(`otp:${dto.email}`);
    if (!storedOtp) {
      throw new UnauthorizedException('OTP has expired or was not requested');
    }
    if (storedOtp !== dto.otpCode) {
      throw new UnauthorizedException('OTP is invalid');
    }
    await this.redis.del(`otp:${dto.email}`);

    const existingByEmail = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingByEmail) {
      throw new ConflictException('Email address is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = this.userRepo.create({
      role: UserRole.RESEARCHER,
      email: dto.email,
      passwordHash,
      status: 'active',
    });
    await this.userRepo.save(user);

    await this.auditService.log({
      actorId: user.id,
      action: AuditAction.LOGIN,
      resourceId: user.id,
      resourceType: 'User',
      metadata: { event: 'researcher_registration' },
    });

    return this.buildAuthPayload(user);
  }

  async requestOtp(dto: RequestOtpDto): Promise<void> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${dto.email}`, code, 'EX', OTP_TTL_SECONDS);
    await this.mailQueue.add(
      SEND_OTP_JOB,
      { to: dto.email, code, expiresInMinutes: OTP_TTL_SECONDS / 60 },
      MAIL_JOB_OPTIONS,
    );
  }

  async login(dto: LoginDto): Promise<AuthPayload> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    // BR-8: identical error for wrong email and wrong password — never reveal which
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // The portal is part of the credential: an account may only sign in from the
    // tab matching its own role. Same generic 401 as a bad password (BR-8), so the
    // login form cannot be used to discover whether an email is registered or
    // which portal it belongs to.
    //
    // This MUST stay above the suspended check below, which throws a
    // distinguishable 403 — otherwise probing a suspended account from the wrong
    // portal would confirm both that it exists and that it is suspended.
    if (user.role !== CLIENT_ROLE_TO_USER_ROLE[dto.role]) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // BR-9: suspended users get 403, not 401
    if (user.status === 'suspended') {
      throw new ForbiddenException('Account suspended');
    }

    await this.auditService.log({
      actorId: user.id,
      action: AuditAction.LOGIN,
      resourceId: user.id,
      resourceType: 'User',
    });

    const displayName = await this.resolveDisplayName(user);
    return this.buildAuthPayload(user, displayName);
  }

  async refreshTokens(refreshToken: string): Promise<AuthPayload> {
    const publicKey = this.configService.get<string>('jwt.publicKey');

    let payload: { sub: string; jti: string; exp: number };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: publicKey,
        algorithms: ['RS256'],
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const revoked = await this.redis.get(`refresh:revoked:${payload.jti}`);
    if (revoked) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Without this a suspended user could rotate tokens indefinitely, since the
    // status is otherwise only checked at login. A 'pending' user must still be able
    // to refresh — they hold a valid session and need /auth/me and the onboarding
    // routes, both of which are marked @AllowPending().
    if (user.status === 'suspended') {
      throw new ForbiddenException('Account suspended');
    }

    const remainingTtl = payload.exp - Math.floor(Date.now() / 1000);
    if (remainingTtl > 0) {
      await this.redis.set(`refresh:revoked:${payload.jti}`, '1', 'EX', remainingTtl);
    }

    const displayName = await this.resolveDisplayName(user);
    return this.buildAuthPayload(user, displayName);
  }

  // BR-11: logout never throws — always treated as successful from the user's perspective
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    const decoded = jwt.decode(refreshToken) as { jti?: string; exp?: number } | null;
    if (!decoded?.jti || !decoded?.exp) return;

    const remainingTtl = decoded.exp - Math.floor(Date.now() / 1000);
    if (remainingTtl > 0) {
      await this.redis.set(`refresh:revoked:${decoded.jti}`, '1', 'EX', remainingTtl);
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    // Never reveal whether an email exists — always return 200
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) return;

    const token = randomBytes(32).toString('hex');
    await this.redis.set(`reset:${token}`, user.id, 'EX', RESET_TOKEN_TTL_SECONDS);
    await this.mailQueue.add(
      SEND_RESET_PASSWORD_JOB,
      { to: dto.email, token, expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60 },
      MAIL_JOB_OPTIONS,
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);

    // Atomic single-use consumption — getdel returns the value and deletes the key in one operation
    const userId = await this.redis.getdel(`reset:${dto.token}`);
    if (!userId) {
      throw new UnauthorizedException('Reset token invalid or expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, saltRounds);
    await this.userRepo.update({ id: userId }, { passwordHash });
    // V1 limitation: existing refresh tokens remain valid until their 7-day TTL expires after password reset
  }

  async signupLite(dto: SignupDto): Promise<AuthPayload> {
    const saltRounds = this.configService.get<number>('app.bcryptSaltRounds', 12);

    // SignupDto restricts dto.role to SIGNUP_CLIENT_ROLES, so admin/researcher
    // are unreachable here even though the shared map covers them.
    const userRole = CLIENT_ROLE_TO_USER_ROLE[dto.role];

    const { user } = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);

      const existing = await userRepo.findOne({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email address is already registered');

      const passwordHash = await bcrypt.hash(dto.password, saltRounds);
      const isPatient = userRole === UserRole.PATIENT;
      const isOrg = userRole === UserRole.NGO_ADMIN || userRole === UserRole.HMO_COORDINATOR;

      const user = userRepo.create({
        role: userRole,
        name: dto.name,
        email: dto.email,
        passwordHash,
        status: isPatient ? 'active' : 'pending',
      });
      await userRepo.save(user);

      if (isPatient) {
        const patientRepo = manager.getRepository(Patient);
        const patient = patientRepo.create({
          userId: user.id,
          name: dto.name,
          conditionTags: [],
          isCaregiver: false,
          directContactShared: false,
        });
        await patientRepo.save(patient);
      }

      if (isOrg) {
        const orgRepo = manager.getRepository(Organization);
        const org = orgRepo.create({
          name: dto.name,
          type: userRole === UserRole.NGO_ADMIN ? OrgType.NGO : OrgType.HMO,
          contactEmail: dto.email,
          status: OrgStatus.PENDING_VERIFICATION,
        });
        await orgRepo.save(org);

        await userRepo.update({ id: user.id }, { orgId: org.id });
        user.orgId = org.id;
      }

      return { user };
    });

    return this.buildAuthPayload(user, dto.name);
  }

  async completePatientOnboarding(userId: string, dto: PatientOnboardingDto): Promise<object> {
    const patientRepo = this.dataSource.getRepository(Patient);
    const consentGrantRepo = this.dataSource.getRepository(ConsentGrant);

    const patient = await patientRepo.findOne({ where: { userId } });
    if (!patient) throw new ConflictException('Patient profile not found for this user');

    const user = await this.userRepo.findOne({ where: { id: userId } });

    const conditionTags = dto.conditions
      ? dto.conditions.split(',').map((c) => c.trim()).filter(Boolean)
      : [];

    const genderMap: Record<string, string> = {
      male: 'male',
      female: 'female',
      other: 'other',
    };

    await this.dataSource.transaction(async (manager) => {
      const pRepo = manager.getRepository(Patient);
      const cgRepo = manager.getRepository(ConsentGrant);

      await pRepo.update({ userId }, {
        isCaregiver: dto.accountType === 'caregiver',
        dateOfBirth: dto.dateOfBirth,
        gender: dto.biologicalSex ? (genderMap[dto.biologicalSex] as any) : undefined,
        country: dto.country,
        primaryLanguage: dto.primaryLanguage,
        conditionTags,
      });

      const consentMapping = [
        { granted: dto.ngoConsent, purpose: ConsentPurpose.NGO_FUNDING },
        { granted: dto.researchConsent, purpose: ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT },
      ];

      for (const { granted, purpose } of consentMapping) {
        const existing = await cgRepo.findOne({ where: { patientId: patient.id, purpose } });
        const status = granted ? ConsentStatus.ACTIVE : ConsentStatus.NOT_GRANTED;

        if (existing) {
          await cgRepo.update({ id: existing.id }, { status, grantedAt: granted ? new Date() : existing.grantedAt });
        } else {
          const grant = cgRepo.create({
            patientId: patient.id,
            purpose,
            dataScopes: SNAPSHOT_FIELDS[purpose],
            status,
            grantedAt: new Date(),
          });
          await cgRepo.save(grant);
        }
      }
    });

    if (user) {
      await this.mailQueue.add(
        SEND_PATIENT_ONBOARDING_WELCOME_JOB,
        { to: user.email, patientName: patient.name },
        MAIL_JOB_OPTIONS,
      );
    }

    return patientRepo.findOne({ where: { userId } }) as Promise<object>;
  }

  async completeNgoOnboarding(orgId: string, dto: NgoOnboardingDto, userId: string): Promise<object> {
    const orgRepo = this.dataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new ConflictException('Organisation not found');

    const now = new Date();
    await orgRepo.update({ id: orgId }, {
      name: dto.orgName,
      registrationNumber: dto.registrationNumber,
      tin: dto.tin,
      scumlNumber: dto.scumlNumber,
      focusAreas: dto.focusAreas,
      website: dto.website,
      operatingRegions: dto.operatingRegions,
      headOfficeCountry: dto.headOfficeCountry,
      programDescription: dto.programDescription,
      termsConsentAt: now,
      dataProcessingConsentAt: now,
    });

    await this.auditService.log({
      actorId: userId,
      action: AuditAction.APPLICATION_SUBMITTED,
      resourceId: orgId,
      resourceType: 'organization',
    });

    await this.adminQueue.add(ORG_VERIFICATION_JOB, {
      orgId,
      orgName: dto.orgName,
      contactEmail: org.contactEmail,
    });

    await this.sendApplicationStatusEmail({
      to: org.contactEmail,
      applicantName: dto.orgName,
      role: ApplicantRole.NGO,
      event: ApplicationEmailEvent.RECEIVED,
    });

    return orgRepo.findOne({ where: { id: orgId } }) as Promise<object>;
  }

  async completeHmoOnboarding(orgId: string, dto: HmoOnboardingDto, userId: string): Promise<object> {
    const orgRepo = this.dataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new ConflictException('Organisation not found');

    const now = new Date();
    await orgRepo.update({ id: orgId }, {
      name: dto.orgName,
      licenceNumber: dto.licenceNumber,
      contactPhone: dto.contactPhone,
      coverageRegion: dto.coverageRegion,
      enrolledPatientCount: dto.enrolledPatientCount,
      specialtyFocus: dto.specialtyFocus,
      termsConsentAt: now,
      baaAcknowledgedAt: now,
    });

    await this.auditService.log({
      actorId: userId,
      action: AuditAction.APPLICATION_SUBMITTED,
      resourceId: orgId,
      resourceType: 'organization',
    });

    await this.adminQueue.add(ORG_VERIFICATION_JOB, {
      orgId,
      orgName: dto.orgName,
      contactEmail: org.contactEmail,
    });

    await this.sendApplicationStatusEmail({
      to: org.contactEmail,
      applicantName: dto.orgName,
      // HMO, not NGO — both org types flow through near-identical methods and
      // mislabelling the applicant here is the easy mistake.
      role: ApplicantRole.HMO,
      event: ApplicationEmailEvent.RECEIVED,
    });

    return orgRepo.findOne({ where: { id: orgId } }) as Promise<object>;
  }

  /**
   * Enqueues an application email without letting a queue outage fail the request.
   * The onboarding write has already committed by this point, so a thrown enqueue
   * would report failure for work that actually succeeded.
   */
  private async sendApplicationStatusEmail(payload: SendApplicationStatusJob): Promise<void> {
    try {
      await this.mailQueue.add(SEND_APPLICATION_STATUS_JOB, payload, MAIL_JOB_OPTIONS);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${payload.event} email for ${payload.role}: ${(err as Error).message}`,
      );
    }
  }

  // Live account state for the authenticated user.
  //
  // Access tokens are stateless and carry no status claim, so a client holding a
  // token issued before an admin approval has no way to learn it was approved.
  // The frontend guards, pending screens and profile pages all read from here.
  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const me: MeResponse = {
      id: user.id,
      name: await this.resolveDisplayName(user),
      email: user.email,
      role: this.toClientRole(user.role),
      status: user.status,
      orgId: user.orgId,
    };

    if (user.role === UserRole.PROFESSIONAL) {
      me.application = (await this.applicationsService.getProfessionalByUser(user.id)) ?? undefined;
    } else if (user.role === UserRole.BENEFACTOR) {
      me.application = (await this.applicationsService.getBenefactorByUser(user.id)) ?? undefined;
    } else if (
      (user.role === UserRole.NGO_ADMIN || user.role === UserRole.HMO_COORDINATOR) &&
      user.orgId
    ) {
      // findOne throws if the org is missing; a user with a dangling orgId should
      // still be able to read their own account state.
      me.organization = await this.organizationsService
        .findOne(user.orgId)
        .catch(() => undefined);
    }

    return me;
  }

  // For PATIENT users, name lives on the Patient entity, which stays the source
  // of truth for them (they can edit it via the patients API). Every other role
  // reads users.name. Called at login and token refresh to keep the name fresh
  // in the client-side auth state.
  private async resolveDisplayName(user: User): Promise<string | undefined> {
    if (user.role !== UserRole.PATIENT) return user.name;
    const patient = await this.dataSource.getRepository(Patient).findOne({
      where: { userId: user.id },
      select: ['name'],
    });
    return patient?.name ?? user.name;
  }

  private buildAuthPayload(user: User, name?: string): AuthPayload {
    return {
      accessToken: this.issueAccessToken(user),
      refreshToken: this.issueRefreshToken(user),
      user: {
        id: user.id,
        name,
        email: user.email,
        role: this.toClientRole(user.role),
        status: user.status,
        orgId: user.orgId,
      },
    };
  }

  // Maps internal UserRole enum values to the short-form strings the frontend Role type expects.
  // The JWT still carries the full internal role (ngo_admin, hmo_coordinator) for guards.
  private toClientRole(role: UserRole): string {
    return USER_ROLE_TO_CLIENT_ROLE[role] ?? role;
  }

  private issueAccessToken(user: User): string {
    const expiresIn = this.configService.get<string>('jwt.accessTokenExpiresIn', '15m');
    return this.jwtService.sign(
      { sub: user.id, role: user.role, orgId: user.orgId },
      { expiresIn },
    );
  }

  private issueRefreshToken(user: User): string {
    const privateKey = this.configService.get<string>('jwt.privateKey');
    const expiresIn = this.configService.get<string>('jwt.refreshTokenExpiresIn', '7d');
    return this.jwtService.sign(
      { sub: user.id, jti: ulid() },
      { secret: privateKey, algorithm: 'RS256', expiresIn },
    );
  }

  // Assumption A-6: validates institutional email domain against ALLOWED_INSTITUTION_DOMAINS env var.
  // Skip in development when the var is unset; enforce in production.
  private validateInstitutionalDomain(email: string): void {
    const allowedDomains = process.env.ALLOWED_INSTITUTION_DOMAINS;
    const nodeEnv = this.configService.get<string>('app.nodeEnv', 'development');

    if (!allowedDomains) {
      if (nodeEnv === 'production') {
        throw new BadRequestException('Institutional email domain not configured');
      }
      return;
    }

    const domain = email.split('@')[1]?.toLowerCase();
    const allowed = allowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (!domain || !allowed.includes(domain)) {
      throw new BadRequestException('Email domain is not an approved institution');
    }
  }
}
