import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

import { UserRole } from 'src/common/enums';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  orgId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.publicKey'),
      algorithms: ['RS256'],
    });
  }

  // Assumption A-3: validate() returns the decoded payload as-is (stateless).
  // Suspension is enforced at login time only — no per-request DB lookup.
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
