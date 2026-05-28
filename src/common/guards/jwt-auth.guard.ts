import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly cls: ClsService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser extends { sub: string }>(err: Error, user: TUser): TUser {
    if (err || !user) {
      throw err || new UnauthorizedException('Missing or expired JWT');
    }
    this.cls.set('userId', user.sub);
    return user;
  }
}
