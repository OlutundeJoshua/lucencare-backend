import { UserRole } from 'src/common/enums';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  orgId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
