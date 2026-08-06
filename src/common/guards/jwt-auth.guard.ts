import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';

import { ALLOW_PENDING_KEY } from 'src/common/decorators/allow-pending.decorator';
import { User } from 'src/modules/auth/entities/user.entity';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Authenticates the request and populates req.user via handleRequest below.
    await super.canActivate(context);

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowPending) return true;

    const { user } = context.switchToHttp().getRequest();

    // Status is read live rather than from the token, which carries no status claim:
    // an admin approval or suspension must take effect on the next request, not up to
    // 15 minutes later when the access token expires.
    //
    // This is a primary-key lookup selecting two columns. If it ever profiles hot it
    // can be cached in Redis (already injected elsewhere for OTP and refresh
    // revocation) as `user:status:{id}` with a short TTL — but that cache would need
    // invalidating everywhere status changes: AdminService.reviewOrganization,
    // ApplicationsService.reviewProfessional and .reviewBenefactor,
    // PatientsService.create, and any future suspension path.
    const record = await this.userRepo.findOne({
      where: { id: user.sub },
      select: ['id', 'status'],
    });

    if (!record) {
      throw new UnauthorizedException('Missing or expired JWT');
    }

    // Distinct messages are safe here — the caller is already authenticated, so there
    // is no account-enumeration surface (unlike login, where BR-8 requires one generic
    // message for every failure).
    if (record.status === 'suspended') {
      throw new ForbiddenException('Account suspended');
    }
    if (record.status !== 'active') {
      throw new ForbiddenException('Account pending verification');
    }

    return true;
  }

  handleRequest<TUser extends { sub: string }>(err: Error, user: TUser): TUser {
    if (err || !user) {
      throw err || new UnauthorizedException('Missing or expired JWT');
    }
    this.cls.set('userId', user.sub);
    return user;
  }
}
