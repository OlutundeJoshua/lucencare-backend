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
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Redis } from 'ioredis';

import { AuditAction, ConsentPurpose, ConsentStatus, OrgStatus, UserRole } from 'src/common/enums';
import { SNAPSHOT_FIELDS } from 'src/common/constants/snapshot-fields';
import { ADMIN_QUEUE, MAIL_QUEUE, ORG_VERIFICATION_JOB, SEND_OTP_JOB, SEND_RESET_PASSWORD_JOB } from 'src/queues/queues.constants';
import { AuditService } from 'src/modules/audit/audit.service';

import { User } from './entities/user.entity';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterOrgDto,
  RegisterPatientDto,
  RegisterResearcherDto,
  RequestOtpDto,
  ResetPasswordDto,
} from './dto/auth.dto';

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

export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: UserRole; orgId?: string };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    @InjectQueue(ADMIN_QUEUE) private readonly adminQueue: Queue,
    private readonly auditService: AuditService,
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

    return this.buildAuthPayload(user);
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
    await this.mailQueue.add(SEND_OTP_JOB, {
      to: dto.email,
      code,
      expiresInMinutes: OTP_TTL_SECONDS / 60,
    });
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

    return this.buildAuthPayload(user);
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

    const remainingTtl = payload.exp - Math.floor(Date.now() / 1000);
    if (remainingTtl > 0) {
      await this.redis.set(`refresh:revoked:${payload.jti}`, '1', 'EX', remainingTtl);
    }

    return this.buildAuthPayload(user);
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
    await this.mailQueue.add(SEND_RESET_PASSWORD_JOB, {
      to: dto.email,
      token,
      expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
    });
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

  private buildAuthPayload(user: User): AuthPayload {
    return {
      accessToken: this.issueAccessToken(user),
      refreshToken: this.issueRefreshToken(user),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
      },
    };
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
