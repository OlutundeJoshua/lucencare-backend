// Single source of truth: client-facing short role names ↔ internal UserRole enum values.
//
// The frontend deals in short names ('ngo', 'hmo', 'admin'); the JWT and every
// @Roles() guard deal in the internal enum ('ngo_admin', 'hmo_coordinator',
// 'platform_admin'). Both directions live here so login, signup and the auth
// payload builder cannot drift apart.

import { UserRole } from 'src/common/enums';

export const CLIENT_ROLE_TO_USER_ROLE: Record<string, UserRole> = {
  patient: UserRole.PATIENT,
  ngo: UserRole.NGO_ADMIN,
  hmo: UserRole.HMO_COORDINATOR,
  professional: UserRole.PROFESSIONAL,
  benefactor: UserRole.BENEFACTOR,
  admin: UserRole.PLATFORM_ADMIN,
  researcher: UserRole.RESEARCHER,
};

export const USER_ROLE_TO_CLIENT_ROLE: Record<UserRole, string> = Object.fromEntries(
  Object.entries(CLIENT_ROLE_TO_USER_ROLE).map(([client, internal]) => [internal, client]),
) as Record<UserRole, string>;

/** Roles that may sign in. Every account belongs to exactly one portal. */
export const LOGIN_CLIENT_ROLES = Object.keys(CLIENT_ROLE_TO_USER_ROLE);

/**
 * Roles that may self-register via POST /auth/signup. Platform admins and
 * researchers are provisioned separately (researchers via the OTP flow), so
 * they must never be reachable from the public signup endpoint.
 */
export const SIGNUP_CLIENT_ROLES = [
  'patient',
  'ngo',
  'hmo',
  'professional',
  'benefactor',
];
