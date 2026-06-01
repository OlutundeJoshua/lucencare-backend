# Auth Module Specification

## 1. Module Overview

The Auth module is the entry point for all user registration and authentication on the platform. It owns the `User` entity and all identity-related logic: patient registration (atomic across three tables), org staff registration, researcher registration with OTP verification, login, token refresh, and logout.

It does NOT own patient health data, consent grants beyond initial creation, or organisation approval. Those concerns belong to their respective modules.

---

## 2. Entities Involved

**Owns:**
- `users` — created by this module for all actor types

**Writes to (via service injection, not ownership):**
- `patients` — created atomically during patient registration (via `PatientsService`)
- `organizations` — created atomically during org registration (via `OrganizationsService`)
- `consent_grants` — created atomically during patient registration (via `ConsentsService`)

**Redis keys owned:**
- `otp:{email}` — 6-digit OTP for researcher verification, TTL 10 minutes
- `refresh:revoked:{jti}` — revoked refresh token jti, TTL = remaining token lifetime
- `reset:{token}` — 64-char hex password reset token → userId, TTL 1 hour

---

## 3. DTOs

> **Prerequisite for `JwtAuthGuard`:** Before wiring `JwtAuthGuard` fully, add `@nestjs/passport ^10.0.3`, `passport ^0.7.0`, `passport-jwt ^4.0.1`, and `@types/passport-jwt ^4.0.1` to `package.json`, then create `src/modules/auth/strategies/jwt.strategy.ts`. The guard skeleton and CLS population (`cls.set('userId', user.sub)`) are already implemented in `src/common/guards/jwt-auth.guard.ts`.

### Request DTOs

```typescript
// src/modules/auth/dto/auth.dto.ts — RegisterPatientDto
export class RegisterPatientDto {
  email: string;
  password: string;              // min 8 chars
  name: string;
  phone: string;                 // required; stored as plain text
  membershipNumber?: string;     // supplemental HMO identifier only
  dateOfBirth?: string;          // ISO date YYYY-MM-DD
  gender?: Gender;
  address?: string;
  conditionTags: string[];
  consentPurposes: ConsentPurpose[];  // min 1
}
```

```typescript
// src/modules/auth/dto/register-org.dto.ts
export const RegisterOrgSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(1).max(200),
  orgType: z.nativeEnum(OrgType),
  contactEmail: z.string().email(),
  role: z.enum(['ngo_admin', 'hmo_coordinator']),
});
export type RegisterOrgDto = z.infer<typeof RegisterOrgSchema>;
```

```typescript
// src/modules/auth/dto/register-researcher.dto.ts
export const RegisterResearcherSchema = z.object({
  email: z.string().email(),   // institutional domain validated server-side
  password: z.string().min(8),
  institutionName: z.string().min(1).max(200),
  otpCode: z.string().length(6),
});
export type RegisterResearcherDto = z.infer<typeof RegisterResearcherSchema>;
```

```typescript
// src/modules/auth/dto/request-otp.dto.ts
export const RequestOtpSchema = z.object({
  email: z.string().email(),
});
export type RequestOtpDto = z.infer<typeof RequestOtpSchema>;
```

```typescript
// src/modules/auth/dto/login.dto.ts
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;
```

### Response DTOs

```typescript
// Auth response — returned by register/* and login
interface AuthResponse {
  data: {
    accessToken: string;       // JWT RS256, 15-min expiry
    user: {
      id: string;              // ULID of the users row
      email: string;
      role: UserRole;
      orgId?: string;          // present for ngo_admin and hmo_coordinator only
    };
  };
  traceId: string;
}
// Refresh token is set as httpOnly cookie named 'refresh_token' — never in body.
```

```typescript
// OTP request response
interface RequestOtpResponse {
  data: { message: string };   // e.g. "OTP sent to your email"
  traceId: string;
}
```

```typescript
// Logout response
interface LogoutResponse {
  data: { message: string };   // "Logged out successfully"
  traceId: string;
}
```

```typescript
// Forgot password / reset password response
interface MessageResponse {
  data: { message: string };
  traceId: string;
}
```

```typescript
// src/modules/auth/dto/auth.dto.ts — ForgotPasswordDto
export class ForgotPasswordDto {
  email: string;
}

// src/modules/auth/dto/auth.dto.ts — ResetPasswordDto
export class ResetPasswordDto {
  token: string;    // 64-char hex token from the reset email link
  password: string; // min 8 chars
}
```

---

## 4. Endpoints

### `POST /auth/request-otp`
- **Auth required:** None
- **Purpose:** Send a 6-digit OTP to a researcher's institutional email before registration.
- **Request body:** `RequestOtpDto` — `{ email: string }`
- **Logic:** Validate email domain → generate 6-digit OTP → store in Redis `otp:{tempKey}` with 10-min TTL → enqueue `send_otp` job
- **Success:** `200 { data: { message: 'OTP sent' } }`
- **Errors:**
  - `422` — invalid email format
  - `429` — rate limit exceeded (3 requests / 5 min / IP)

---

### `POST /auth/register/patient`
- **Auth required:** None
- **Request body:** `RegisterPatientDto`
- **Success:** `201 AuthResponse` + `Set-Cookie: refresh_token=<jwt>; HttpOnly; Secure; SameSite=Strict`
- **Errors:**
  - `409` — email already registered
  - `409` — phoneHash already registered
  - `409` — membershipNumber already registered
  - `422` — validation failure (class-validator) — missing phoneHash AND membershipNumber, invalid email, etc.
  - `429` — rate limit exceeded

---

### `POST /auth/register/org`
- **Auth required:** None
- **Request body:** `RegisterOrgDto`
- **Success:** `201 AuthResponse` + refresh cookie
- **Errors:**
  - `409` — email already registered
  - `422` — validation failure (class-validator)
  - `429` — rate limit exceeded

---

### `POST /auth/register/researcher`
- **Auth required:** None
- **Request body:** `RegisterResearcherDto`
- **Success:** `201 AuthResponse` + refresh cookie
- **Errors:**
  - `400` — institutional email domain not on allowlist
  - `401` — OTP invalid or expired
  - `409` — email already registered
  - `422` — validation failure (class-validator)
  - `429` — rate limit exceeded

---

### `POST /auth/login`
- **Auth required:** None
- **Request body:** `LoginDto`
- **Success:** `200 AuthResponse` + refresh cookie
- **Errors:**
  - `401` — invalid email or password (single generic message — do not reveal which)
  - `403` — user account is suspended
  - `422` — validation failure (class-validator)
  - `429` — rate limit exceeded (10 req / 60 s / IP)

---

### `POST /auth/refresh`
- **Auth required:** Valid `refresh_token` httpOnly cookie
- **Request body:** None
- **Success:** `200 AuthResponse` + new `Set-Cookie: refresh_token`
- **Errors:**
  - `401` — cookie absent, JWT malformed, JWT expired, or jti found in `refresh:revoked:{jti}`
  - `429` — rate limit exceeded

---

### `POST /auth/logout`
- **Auth required:** Valid access token (JWT Bearer)
- **Request body:** None
- **Logic:** Extract refresh token jti from cookie → write `refresh:revoked:{jti}` to Redis with TTL = remaining lifetime → clear cookie
- **Success:** `200 { data: { message: 'Logged out successfully' } }` + `Set-Cookie: refresh_token=; Max-Age=0`
- **Errors:**
  - `401` — access token missing or invalid

---

### `POST /auth/forgot-password`
- **Auth required:** None
- **Request body:** `ForgotPasswordDto` — `{ email: string }`
- **Logic:**
  1. Look up user by email — if not found, still return `200` (never reveal whether an email is registered)
  2. Generate 64-char hex token: `crypto.randomBytes(32).toString('hex')`
  3. Store in Redis: `SET reset:{token} {userId} EX 3600` (1-hour TTL)
  4. Enqueue `send_reset_password` job on the `mail` queue: `{ to: email, token, expiresInMinutes: 60 }`
- **Success:** `200 { data: { message: 'If that email is registered, a reset link has been sent.' } }`
- **Errors:**
  - `422` — invalid email format
  - `429` — rate limit (3 requests / 15 min / IP)

---

### `POST /auth/reset-password`
- **Auth required:** None
- **Request body:** `ResetPasswordDto` — `{ token: string; password: string }`
- **Logic:**
  1. `redis.getdel('reset:{token}')` — atomic read-and-delete (single-use enforcement)
  2. If nil → throw `UnauthorizedException('Reset token invalid or expired')`
  3. Hash new password with bcrypt (cost 12)
  4. Update `users.password_hash` where `id = userId`
- **Success:** `200 { data: { message: 'Password updated successfully.' } }`
- **Errors:**
  - `401` — token missing, expired, or already used
  - `422` — password too short (< 8 chars)
  - `429` — rate limit

---

## 5. Service Methods

```typescript
class AuthService {

  /**
   * Registers a patient.
   * Runs inside a single dataSource.transaction():
   *   1. Hash password with bcrypt (cost 12)
   *   2. Insert users row (role: 'patient', status: 'active')
   *   3. Call PatientsService.createForUser(userId, dto) → inserts patients row
   *   4. For each purpose in dto.consentPurposes:
   *        Call ConsentsService.createInitial(patientId, purpose) → inserts consent_grant rows
   *   5. Issue access token + refresh token
   *   6. Write audit log: action LOGIN, resourceType 'User', resourceId userId
   * Throws ConflictException if email, phoneHash, or membershipNumber already exists.
   */
  registerPatient(dto: RegisterPatientDto): Promise<AuthPayload>

  /**
   * Registers an org staff member.
   * Runs inside a single dataSource.transaction():
   *   1. Hash password
   *   2. Insert organizations row (status: 'pending_verification')
   *   3. Insert users row (role from dto.role, orgId = new org id, status: 'pending')
   *   4. Enqueue org_verification job with orgId
   * Throws ConflictException if email already exists.
   */
  registerOrg(dto: RegisterOrgDto): Promise<AuthPayload>

  /**
   * Registers a researcher.
   *   1. Validate institutional email domain against allowlist (config: ALLOWED_INSTITUTION_DOMAINS)
   *   2. Look up OTP in Redis key `otp:{email}` — throws UnauthorizedException if missing/expired
   *   3. Compare dto.otpCode — throws UnauthorizedException if mismatch
   *   4. Delete OTP key from Redis
   *   5. Hash password
   *   6. Insert users row (role: 'researcher', status: 'active')
   * Throws 400 if domain not on allowlist.
   * Throws UnauthorizedException if OTP invalid or expired.
   * Throws ConflictException if email already exists.
   */
  registerResearcher(dto: RegisterResearcherDto): Promise<AuthPayload>

  /**
   * Sends an OTP to the provided email (for researcher pre-registration verification).
   *   1. Generate 6-digit numeric OTP
   *   2. Store in Redis: SET otp:{email} {code} EX 600 (10 min TTL)
   *   3. Enqueue send_otp job: { to: email, code }
   */
  requestOtp(dto: RequestOtpDto): Promise<void>

  /**
   * Authenticates a user.
   *   1. Find user by email — throws UnauthorizedException (generic) if not found
   *   2. Compare password with bcrypt — throws UnauthorizedException (generic) if mismatch
   *   3. Check user.status !== 'suspended' — throws ForbiddenException if suspended
   *   4. Issue access token + refresh token
   *   5. Write audit log: action LOGIN
   * NOTE: error message must be generic ('Invalid credentials') for both not-found and wrong-password.
   */
  login(dto: LoginDto): Promise<AuthPayload>

  /**
   * Rotates access + refresh tokens.
   *   1. Verify refresh JWT signature and expiry — throws UnauthorizedException if invalid
   *   2. Check Redis: GET refresh:revoked:{jti} — throws UnauthorizedException if found
   *   3. Issue new access token and new refresh token (new jti)
   *   4. Write old jti to refresh:revoked:{oldJti} with TTL = remaining lifetime of old token
   */
  refreshTokens(refreshToken: string): Promise<AuthPayload>

  /**
   * Logs out a user.
   *   1. Decode refresh token (no signature verify — just extract jti and exp)
   *   2. Calculate remaining TTL: exp - now
   *   3. If TTL > 0: SET refresh:revoked:{jti} 1 EX {ttl}
   * Does not throw — logout is always treated as successful even if cookie is absent.
   */
  logout(refreshToken: string | undefined): Promise<void>

  /**
   * Initiates password reset.
   *   1. Look up user by email — if not found, return silently (no error leak)
   *   2. Generate token: crypto.randomBytes(32).toString('hex')
   *   3. SET reset:{token} {userId} EX 3600
   *   4. Enqueue send_reset_password job: { to: email, token, expiresInMinutes: 60 }
   * Never throws NotFoundException — always returns successfully.
   */
  forgotPassword(dto: ForgotPasswordDto): Promise<void>

  /**
   * Completes password reset.
   *   1. redis.getdel('reset:{token}') — atomic single-use consumption
   *   2. Throws UnauthorizedException if nil (expired or already used)
   *   3. Hash new password with bcrypt (cost 12)
   *   4. Update users.password_hash where id = userId
   * Known V1 limitation: existing refresh tokens remain valid until their 7-day TTL expires.
   */
  resetPassword(dto: ResetPasswordDto): Promise<void>

  /**
   * Issues a signed RS256 access token.
   * Payload: { sub: userId, role, orgId?, iat, exp }
   * TTL: 15 minutes
   */
  private issueAccessToken(user: User): string

  /**
   * Issues a signed RS256 refresh token.
   * Payload: { sub: userId, jti: ulid(), iat, exp }
   * TTL: 7 days
   */
  private issueRefreshToken(user: User): string
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | Patient registration is a single atomic DB transaction. Any failure (duplicate email, DB error) rolls back all three inserts (users, patients, consent_grants). |
| BR-2 | Phone numbers are received as plain text over HTTPS and stored as plain text. Phone is a required field for all patients; it is not a credential and does not need hashing. Access is protected by JWT auth guards and RLS. |
| BR-3 | `hmoId` on the patient record is NEVER set from the registration payload. It is always null at registration. HMOs link patients via lookup, not registration. |
| BR-4 | Org staff users start with `status: 'pending'` and their org starts with `status: 'pending_verification'`. They cannot perform org-scoped actions until the admin approves. |
| BR-5 | Researcher institutional email domain must be validated against a configurable allowlist (`ALLOWED_INSTITUTION_DOMAINS` env var, comma-separated). Reject with `400` if domain not on list. |
| BR-6 | OTP is stored under `otp:{email}` (not `otp:{userId}`) because the user record does not exist yet at OTP request time. |
| BR-7 | OTP TTL is 10 minutes. After use, the key is deleted immediately (not left to expire). |
| BR-8 | Login error message must be identical for wrong email and wrong password: `'Invalid credentials'`. Never reveal which field was wrong. |
| BR-9 | Suspended users (`status: 'suspended'`) receive `403 Forbidden` on login, not `401`. |
| BR-10 | Refresh tokens are single-rotation: when a valid refresh token is used, it is immediately revoked and a new one is issued. |
| BR-11 | Logout writes the refresh jti to Redis even if the access token has expired — logout should never fail from the user's perspective. |
| BR-12 | `consentPurposes` must contain at least one value. Each purpose results in one `consent_grant` row with status `active`. |
| BR-13 | The `audit_log` entry for `LOGIN` must be written inside the same transaction as the auth operation where possible, or immediately after if not transactional. |

---

## 7. Dependencies on Other Modules

| Module | Method called | When |
|---|---|---|
| `PatientsModule` | `PatientsService.createForUser(userId, dto)` | Inside patient registration transaction |
| `OrganizationsModule` | `OrganizationsService.create(dto)` | Inside org registration transaction |
| `ConsentsModule` | `ConsentsService.createInitial(patientId, purpose)` | Inside patient registration transaction, once per purpose |
| `AuditModule` | `AuditService.log({ actorId, action: LOGIN, ... })` | After every successful login |
| `QueuesModule` | `Queue.add('send_otp', { to, code })` | After OTP generation |
| `QueuesModule` | `Queue.add('org_verification', { orgId })` | After org registration |
| `QueuesModule` | `Queue.add('send_reset_password', { to, token, expiresInMinutes })` | After forgot-password request |

---

## 8. Events Emitted

| Queue | Job name | Payload | Triggered by |
|---|---|---|---|
| `mail` | `send_otp` | `{ to: string; code: string; expiresInMinutes: 10 }` | `requestOtp()` |
| `mail` | `send_reset_password` | `{ to: string; token: string; expiresInMinutes: 60 }` | `forgotPassword()` |
| `mail` | `send_patient_credentials` | `{ to: string; tempPassword: string }` | `PatientsService.createPatient()` (HMO coordinator path) |
| `admin` | `org_verification` | `{ orgId: string; orgName: string; contactEmail: string }` | `registerOrg()` |

No events consumed — Auth is a producer only.

---

## 9. Open Questions or Ambiguities

> ⚠️ The `ALLOWED_INSTITUTION_DOMAINS` allowlist is environment-config-driven. There is no admin UI to manage it in V1. Decide whether to seed a default list or require it to be set at deploy time.

> ⚠️ OTP delivery channel is email only. There is no SMS path defined. Ensure `send_otp` processor uses an email client (e.g. nodemailer, SendGrid) — not SMS.

> ⚠️ The refresh token cookie attributes (`Secure`, `SameSite`, `Domain`, `Path`) must be set correctly for the deployment environment. `SameSite=Strict` may cause issues with cross-origin frontend setups — confirm frontend origin before finalising.
