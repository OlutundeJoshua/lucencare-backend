# Common Infrastructure Specification

## 1. Overview

This file specifies all shared infrastructure that must be built before any module can be implemented: `BaseEntity`, `EntityActorSubscriber`, all platform enums, guards, decorators, interceptors, filters, pipes, common DTOs, and the `snapshot-fields` constant.

---

## 2. BaseEntity

```typescript
// src/common/entities/base.entity.ts
import { ulid } from 'ulid';
import {
  PrimaryColumn, CreateDateColumn, UpdateDateColumn,
  DeleteDateColumn, Column, BeforeInsert, VersionColumn,
} from 'typeorm';

export abstract class BaseEntity {
  @PrimaryColumn({ type: 'char', length: 26 })
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @Column({ name: 'created_by', type: 'char', length: 26, nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', type: 'char', length: 26, nullable: true })
  updatedBy?: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
```

**Rules:**
- Every entity that extends `BaseEntity` gets ULID PK auto-generated on insert.
- `deletedAt` enables soft delete via TypeORM's `@DeleteDateColumn`. All queries must include `.where('entity.deleted_at IS NULL')` unless explicitly querying deleted records.
- `createdBy` / `updatedBy` are set by `EntityActorSubscriber` — never manually.
- `@VersionColumn()` is added per-entity only where optimistic locking is required (`consent_grants`, `enrollments`).

---

## 3. EntityActorSubscriber

```typescript
// src/common/subscribers/entity-actor.subscriber.ts
import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { ClsService } from 'nestjs-cls';

@EventSubscriber()
export class EntityActorSubscriber implements EntitySubscriberInterface {

  constructor(private readonly cls: ClsService) {}

  /**
   * Before any INSERT: set createdBy and updatedBy from CLS userId.
   */
  beforeInsert(event: InsertEvent<any>): void {
    const userId = this.cls.get('userId');
    if (userId) {
      event.entity.createdBy = userId;
      event.entity.updatedBy = userId;
    }
  }

  /**
   * Before any UPDATE: set updatedBy from CLS userId.
   */
  beforeUpdate(event: UpdateEvent<any>): void {
    const userId = this.cls.get('userId');
    if (userId) {
      if (event.entity) event.entity.updatedBy = userId;
    }
  }
}
```

**Rules:**
- `JwtAuthGuard` must call `cls.set('userId', user.id)` on every authenticated request.
- For unauthenticated requests (registration, login), `userId` will be undefined — `createdBy` / `updatedBy` will be null, which is acceptable.
- `EntityActorSubscriber` must be registered in the TypeORM data source config via `subscribers: [EntityActorSubscriber]`.

---

## 4. Enums

```typescript
// src/common/enums/index.ts

export enum UserRole {
  PATIENT = 'patient',
  NGO_ADMIN = 'ngo_admin',
  HMO_COORDINATOR = 'hmo_coordinator',
  RESEARCHER = 'researcher',
  PLATFORM_ADMIN = 'platform_admin',
}

export enum OrgType {
  NGO = 'ngo',
  HMO = 'hmo',
}

export enum OrgStatus {
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export enum ConsentPurpose {
  NGO_FUNDING = 'ngo_funding',
  CLINICAL_RESEARCH_RECRUITMENT = 'clinical_research_recruitment',
  HMO_CARE = 'hmo_care',
}

export enum ConsentStatus {
  NOT_GRANTED = 'not_granted',
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  REVOKED = 'revoked',
}

export enum ProgramType {
  NGO_FUNDING = 'ngo_funding',
  RESEARCH_STUDY = 'research_study',
}

export enum ProgramStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum StudyStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

export enum EnrollmentStatus {
  ACTIVE = 'active',
  REVOKED_BY_PATIENT = 'revoked_by_patient',
  EXPIRED = 'expired',
}

export enum StudyEnrollmentStatus {
  INTERESTED = 'interested',
  SCREENED = 'screened',
  ENROLLED = 'enrolled',
  WITHDRAWN = 'withdrawn',
}

export enum CareEventType {
  CLINIC_VISIT = 'clinic_visit',
  LAB_RESULT = 'lab_result',
  PRESCRIPTION = 'prescription',
  REFERRAL = 'referral',
}

export enum NotificationType {
  PROGRAM_MATCH = 'program_match',
  ENROLLMENT_UPDATE = 'enrollment_update',
  CONSENT_REVOKED = 'consent_revoked',
  NEW_MESSAGE = 'new_message',
  STUDY_MATCH = 'study_match',
  ORG_VERIFIED = 'org_verified',
}

export enum AuditAction {
  EXPORT = 'export',
  REVOKE_CONSENT = 'revoke_consent',
  ADMIN_APPROVE = 'admin_approve',
  ADMIN_REJECT = 'admin_reject',
  LOGIN = 'login',
  CONSENT_CHANGE = 'consent_change',
  CROSS_ORG_ATTEMPT = 'cross_org_attempt',
}

export enum TokenPurpose {
  PDF_EXPORT = 'pdf_export',
  OTP_VERIFY = 'otp_verify',
}
```

---

## 5. Guards

### `JwtAuthGuard`

```typescript
// src/common/guards/jwt-auth.guard.ts
// Extends NestJS AuthGuard('jwt')
// On successful auth: calls cls.set('userId', user.id)
// Sets req.user = { sub, role, orgId? }
// Returns 401 on missing or invalid token
```

### `RoleGuard`

```typescript
// src/common/guards/role.guard.ts
// Reads required roles from @Roles() decorator metadata
// Checks req.user.role is in the allowed roles
// Returns 403 if role not permitted
```

### `OrgScopeGuard`

```typescript
// src/common/guards/org-scope.guard.ts
// Applied via @OrgScoped() decorator
// Verifies req.user.orgId matches the :orgId path param (where applicable)
// Verifies org.status === 'active' (pending/suspended orgs get 403)
// Returns 403 on scope violation — logs CROSS_ORG_ATTEMPT to audit_log
```

---

## 6. Decorators

```typescript
// src/common/decorators/roles.decorator.ts
export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

// src/common/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);

// src/common/decorators/org-scoped.decorator.ts
export const OrgScoped = () => UseGuards(OrgScopeGuard);
```

---

## 7. TransformInterceptor

```typescript
// src/common/interceptors/transform.interceptor.ts
// Wraps every successful response in StandardResponse<T>
// Adds traceId from ClsService
// Structure:
// {
//   data: <service return value>,
//   meta?: { cursor?, total?, limit? },  // only if service returns { data, meta }
//   traceId: string
// }
```

**Rule:** Services return plain data. They never pre-wrap in `StandardResponse`. The interceptor adds the wrapper.

---

## 8. GlobalExceptionFilter

```typescript
// src/common/filters/global-exception.filter.ts
// Catches all HttpException and unknown errors
// Maps to RFC 7807 Problem Detail format:
// {
//   type: 'https://lucencare.io/errors/<slug>',
//   title: string,
//   status: number,
//   detail: string,
//   traceId: string,
//   errors?: [{ path, message }]   // validation failures only
// }
// 500 errors: detail is generic ('Internal server error'), full error logged via pino
// Validation failures (422): includes errors array with path + message per field
```

---

## 9. Global ValidationPipe

```typescript
// Registered in src/main.ts — applies to all routes automatically
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,           // strip unknown properties
  transform: true,           // coerce types (e.g. query string → number)
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

**Usage in controllers — no pipe argument needed:**
```typescript
@Post()
create(@Body() dto: CreatePatientDto) {
  return this.service.create(dto);
}
```

**Validation errors produce 422 `UnprocessableEntityException` with shape:**
```typescript
// { errors: [{ path: 'fieldName', message: 'error message' }] }
// Handled and formatted by GlobalExceptionFilter.
```

---

## 10. Common DTOs

```typescript
// src/common/dto/pagination.dto.ts
export class PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number)
  limit: number = 20;
}

// src/common/dto/response.dto.ts
export interface StandardResponse<T> {
  data: T;
  meta?: {
    total?: number;
    cursor?: string;
    limit?: number;
  };
  traceId: string;
}
```

---

## 11. Snapshot Fields Constant

```typescript
// src/common/constants/snapshot-fields.ts
import { ConsentPurpose } from '../enums';

export const SNAPSHOT_FIELDS: Record<ConsentPurpose, string[]> = {
  [ConsentPurpose.NGO_FUNDING]: [
    'name',
    'conditionTags',
    'locationState',
    'locationLga',
    'directContactShared',
  ],
  [ConsentPurpose.HMO_CARE]: [
    'name',
    'conditionTags',
    'locationState',
    'locationLga',
    'membershipNumber',
    'medicationList',
  ],
  [ConsentPurpose.CLINICAL_RESEARCH_RECRUITMENT]: [
    'name',
    'conditionTags',
    'locationState',
    'locationLga',
    'directContactShared',
    'medicationList',
  ],
};
```

**Rule:** This is the single source of truth for snapshot construction. `EnrollmentsService.buildSnapshot()` must use this constant — never hardcode field names anywhere else.

---

## 12. Rate Limiting Configuration

```typescript
// Configured in AppModule via ThrottlerModule.forRootAsync()
// Uses nestjs-throttler-storage-redis for Redis-backed fixed window limiting

// Default throttler (applied globally):
// ttl: 60 seconds, limit: 60 requests per userId

// Override with @Throttle() decorator at route level:
// Auth endpoints:    ttl: 60, limit: 10  (per IP)
// OTP endpoints:     ttl: 300, limit: 3  (per userId)
// Export endpoints:  ttl: 60, limit: 5   (per orgId)
```

---

## 13. Logging Standards

All logging via `nestjs-pino`. Configuration:

- `traceId` generated as ULID at the start of each request via CLS middleware
- Attached to every log line and every HTTP response header (`X-Trace-Id`)
- Log levels: `error` (thrown exceptions), `warn` (auth failures, cross-org attempts), `info` (audit events), `debug` (disabled in production)
- **Never log:** `passwordHash`, `phoneHash`, JWT payloads, `sharedDataSnapshot`, `medicationList`

---

## 14. Security Headers

Applied globally via NestJS middleware or Helmet:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy: default-src 'none'
X-Trace-Id: <traceId>
```
