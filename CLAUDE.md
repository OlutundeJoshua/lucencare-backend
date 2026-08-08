# CLAUDE.md — LucenCare Backend

This file is read at the start of every session. Follow every rule here without exception unless the user explicitly overrides one. When in doubt, re-read this file before writing any code.

---

## 1. Project Summary

LucenCare is a multi-sided health data platform built with NestJS and PostgreSQL. It connects six actor types — Patients, NGOs, HMOs, Clinical Researchers, Healthcare Professionals, and Benefactors — through a consent-first data sharing model. Patients register and explicitly grant consent for their health data to be shared with specific purposes (NGO funding, HMO care, research recruitment). NGOs create funding programs; HMOs look up members and record care events; Researchers submit IRB-approved studies; Professionals apply for care coordination access; Benefactors apply to support patients. A Platform Admin approves all organisations, programs, studies, professional applications, and benefactor applications before they become active. No organisation ever receives live access to the `patients` table — they always read from a point-in-time `sharedDataSnapshot` captured at enrollment time. All sensitive actions are written to an immutable audit log.

---

## 2. Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | 22 LTS | Runtime |
| pnpm | 9.14.x | Package manager |
| NestJS | 11.x | Framework |
| TypeScript | 5.x | Language — `strict: true` always |
| TypeORM | 0.3.x | ORM — typed queries only |
| PostgreSQL | 17 | Primary database — RLS enabled |
| `ulid` | 2.3.x | ID generation — 26-char sortable non-guessable strings |
| `bcrypt` | 5.1.x | Password hashing — cost factor 12 |
| `jsonwebtoken` / `@nestjs/jwt` | 9.0.x / 10.2.x | JWT RS256 — access tokens (15 min) and export tokens |
| `nestjs-cls` | 4.4.x | Async local storage — carries `userId` for actor tracking |
| `nestjs-pino` | 4.1.x | Structured JSON logging |
| Redis | 7.x | Cache, BullMQ queue backend, OTP storage, export jti |
| BullMQ | 5.x | Background job queue — all async processing |
| `@nestjs/websockets` + `socket.io` | 11.x / 4.7.x | WebSocket — live notification push (AI chat is V2 — deferred) |
| `class-validator` + `class-transformer` | 0.14.x / 0.5.x | DTO validation — NestJS global `ValidationPipe` |
| `@nestjs/swagger` | 8.x | OpenAPI 3 documentation — served at `/api/docs` (non-production) |
| `@nestjs/terminus` | 11.x | Health checks — DB, Redis, S3 |
| `@nestjs/throttler` + `nestjs-throttler-storage-redis` | 6.x / 5.x | Rate limiting — fixed window, Redis-backed |
| S3-compatible storage | — | PDF exports, study info sheets |

---

## 3. Folder Structure

Every new file must be placed in the correct location. Do not invent new top-level directories.

```
src/
├── common/
│   ├── entities/
│   │   └── base.entity.ts              # Shared ULID PK, timestamps, createdBy/updatedBy
│   ├── subscribers/
│   │   └── entity-actor.subscriber.ts  # TypeORM subscriber — auto-fills createdBy/updatedBy from CLS
│   ├── enums/
│   │   └── index.ts                    # All platform enums live here
│   ├── interfaces/
│   │   ├── jwt-payload.interface.ts    # Canonical JWT payload shape — the only JwtPayload in the codebase
│   │   ├── problem-detail.interface.ts
│   │   └── paginated-payload.type.ts   # Cross-module interfaces/types only — see §4.4
│   ├── constants/
│   │   └── snapshot-fields.ts          # ConsentPurpose → field[] mapping — single source of truth for sharedDataSnapshot
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── role.guard.ts
│   │   └── org-scope.guard.ts
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   ├── current-user.decorator.ts
│   │   └── org-scoped.decorator.ts
│   ├── interceptors/
│   │   ├── transform.interceptor.ts    # Wraps every response in StandardResponse<T>
│   │   └── audit.interceptor.ts
│   ├── filters/
│   │   └── global-exception.filter.ts  # Maps all thrown errors to RFC 7807 Problem Detail
│   ├── pipes/                          # No pipes currently — ValidationPipe is registered globally in main.ts
│   └── dto/
│       ├── pagination.dto.ts
│       └── response.dto.ts
├── modules/
│   ├── auth/
│   ├── patients/
│   ├── organizations/
│   ├── consents/
│   ├── programs/
│   ├── studies/
│   ├── enrollments/
│   ├── matching/
│   ├── notifications/
│   ├── messages/
│   ├── export/
│   ├── audit/
│   ├── admin/
│   └── applications/                   # ProfessionalApplication + BenefactorApplication entities and admin review service
├── queues/
│   ├── queues.module.ts
│   ├── queues.constants.ts
│   ├── interfaces/                     # One <job-name>-job.interface.ts per BullMQ job payload
│   │   └── send-otp-job.interface.ts
│   └── processors/
│       ├── fan-out-notify.processor.ts
│       ├── batch-notify.processor.ts
│       ├── consent-revoked.processor.ts
│       ├── program-review.processor.ts
│       ├── study-review.processor.ts
│       ├── org-verification.processor.ts
│       ├── program-approved.processor.ts
│       ├── study-approved.processor.ts
│       └── send-otp.processor.ts
├── gateways/
│   ├── chat.gateway.ts                 # V2 placeholder only — do not add business logic
│   └── notifications.gateway.ts
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   └── jwt.config.ts
├── database/
│   ├── migrations/
│   └── seeds/
├── health/
│   ├── health.module.ts
│   └── health.controller.ts
└── main.ts
```

Each module follows this internal structure. Never deviate from it:

```
modules/<name>/
├── <name>.module.ts
├── <name>.controller.ts
├── <name>.controller.spec.ts
├── <name>.service.ts
├── <name>.service.spec.ts
├── entities/
│   └── <entity>.entity.ts
├── interfaces/                # Only if the module has interfaces/types not covered by dto/ or entities/ — see §4.4
│   └── <name>.interface.ts
└── dto/
    ├── create-<name>.dto.ts
    ├── update-<name>.dto.ts
    └── <other>.dto.ts
```

---

## 4. Coding Conventions

### 4.1 Naming

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `create-patient.dto.ts`, `fan-out-notify.processor.ts` |
| Classes | `PascalCase` | `PatientsService`, `ConsentGrant` |
| Interfaces/Types | `PascalCase` | `StandardResponse<T>`, `ExportTokenPayload` |
| Methods | `camelCase` | `findPrograms()`, `validateAndConsume()` |
| Variables | `camelCase` | `consentGrantId`, `sharedDataSnapshot` |
| Constants | `SCREAMING_SNAKE_CASE` | `NOTIFICATIONS_QUEUE`, `OTP_TTL_SECONDS` |
| Enum names | `PascalCase` | `ConsentStatus`, `UserRole` |
| Enum values | `SCREAMING_SNAKE_CASE` | `ConsentStatus.NOT_GRANTED`, `UserRole.NGO_ADMIN` |
| DB columns | `snake_case` | `created_by`, `hmo_id`, `membership_number` |
| DB tables | `snake_case`, plural | `consent_grants`, `study_enrollments`, `audit_log` |
| TypeORM column decorators | always include explicit `name:` | `@Column({ name: 'patient_id' })` |

### 4.2 File Naming Patterns

Every file in a module follows this pattern exactly:

```
<entity>.entity.ts
<name>.service.ts
<name>.service.spec.ts      ← unit test
<name>.controller.ts
<name>.controller.spec.ts   ← integration test
<name>.module.ts
create-<name>.dto.ts
update-<name>.dto.ts
lookup-<name>.dto.ts
<name>.interface.ts         ← plain interface (not a DTO, not an entity)
<name>.type.ts              ← plain type alias / union type
<name>.processor.ts
<name>.processor.spec.ts    ← processor unit test
<name>.gateway.ts
<name>.guard.ts
<name>.decorator.ts
<name>.interceptor.ts
<name>.filter.ts
<name>.e2e-spec.ts          ← e2e test (in test/ directory)
```

### 4.3 Import Order

Enforce this order in every file. Separate each group with a blank line:

```typescript
// 1. Node.js built-ins
import { randomUUID } from 'crypto';

// 2. Third-party packages
import { IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ulid } from 'ulid';

// 3. NestJS packages
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiProperty } from '@nestjs/swagger';

// 4. Local — absolute paths (src/...)
import { ConsentStatus } from 'src/common/enums';
import { BaseEntity } from 'src/common/entities/base.entity';

// 5. Local — relative paths (same or sibling module)
import { ConsentGrant } from './entities/consent-grant.entity';
import { UpdateConsentDto } from './dto/update-consent.dto';
```

### 4.4 Interfaces, Types & Enums Placement

**Never declare a plain `interface`, `type` alias, or lookup-table type inline inside a `.service.ts`, `.controller.ts`, `.processor.ts`, `.gateway.ts`, `.decorator.ts`, `.filter.ts`, or `.interceptor.ts` file.** Every one of these gets its own file, one declaration per file, named `<name>.interface.ts` (interfaces) or `<name>.type.ts` (type aliases / unions) — exactly the same one-declaration-per-file discipline already used for entities and DTOs.

This does **not** apply to `enum` — all platform enums still live exclusively in `src/common/enums/index.ts` (unchanged). It also does not apply to `class-validator` DTOs, which stay in each module's `dto/` folder.

**Where the file goes** depends on how many places import the type:

| Scope | Location | Example |
|---|---|---|
| Used only within one module (its service, controller, and/or that module's own processors) | `modules/<name>/interfaces/<thing>.interface.ts` | `modules/medications/interfaces/refill-alert-result.interface.ts` |
| Used across two or more modules (e.g. a shape returned by one service and consumed by another module's DTO or controller) | `src/common/interfaces/<thing>.interface.ts` | `src/common/interfaces/jwt-payload.interface.ts` |
| A BullMQ job payload (the `Job<T>` generic for a processor) | `src/queues/interfaces/<job-name>-job.interface.ts` | `src/queues/interfaces/send-otp-job.interface.ts` |

**Rules:**
- One interface or type per file — do not bundle unrelated shapes into a shared `types.ts` grab-bag file.
- A queue job's payload interface is the single source of truth: the processor that consumes it and the service that enqueues it must both import the same file. Never let the producer and consumer each define their own local copy of the same job shape — this is exactly the kind of drift that produces silent runtime bugs when the two definitions disagree.
- There is exactly one canonical `JwtPayload`, defined at `src/common/interfaces/jwt-payload.interface.ts`. Do not redeclare it anywhere else, including in `JwtStrategy` or in `@CurrentUser()`.
- If you're unsure whether a type is module-local or shared, check for existing imports across modules first (`grep -rn "TypeName" src`) before deciding where the file goes — do not default to `common/interfaces/` just to be safe, since that erodes the point of scoping types to their owning module.

---

## 5. Architecture Rules

### 5.1 Layer Responsibilities

```
Request → Guard(s) → Controller → Service → Repository (TypeORM)
                                    ↓
                              AuditService (where required)
                              BullMQ Queue (for async side effects)
```

- **Controllers** accept HTTP requests, call one service method, and return the result. They contain zero business logic and zero database calls.
- **Services** contain all business logic. They may call other services, repositories, and the queue. They never call `res.send()` or touch HTTP primitives.
- **Repositories / TypeORM** handle all DB interaction. Services inject the `Repository<Entity>` via `@InjectRepository()`.
- **Guards** run before the controller. They authenticate the JWT and enforce role and org-scope. They never modify data.
- **Processors (BullMQ)** handle async jobs. They inject services and follow the same layering rules as controllers.
- **Gateways** handle WebSocket connections. Auth happens on the first message frame, not via HTTP middleware.

### 5.2 Where Business Logic Lives

All logic goes in the **service**. This includes:

- Consent state machine transitions
- Org-scope enforcement beyond what the guard provides
- `sharedDataSnapshot` construction at enrollment time
- Eligibility criteria evaluation
- Redis jti operations for export tokens
- Audit log writes
- BullMQ job enqueuing

If you find yourself writing an `if` statement in a controller, move it to the service.

### 5.3 Error Handling

**Throw NestJS HTTP exceptions from services.** Do not return error objects or `null` to signal failure.

```typescript
// Correct
throw new NotFoundException(`Patient ${id} not found`);
throw new ForbiddenException('Access denied: cross-org attempt');
throw new ConflictException('Active consent grant already exists for this purpose');
throw new UnauthorizedException('Export token invalid or already used');

// Wrong — never do this
return null;
return { error: 'not found' };
```

The `GlobalExceptionFilter` catches all thrown exceptions and formats them as RFC 7807 Problem Detail. You never need to format error responses manually.

**Standard HTTP codes to use:**

| Code | When |
|---|---|
| 400 | Malformed request — cannot be parsed at all |
| 401 | Missing or expired JWT |
| 403 | Valid JWT, insufficient role or org-scope violation |
| 404 | Resource does not exist or is soft-deleted |
| 409 | Conflict — duplicate active consent, duplicate active enrollment |
| 422 | Validation failure (handled automatically by global `ValidationPipe`) |
| 429 | Rate limit exceeded |

### 5.4 DTO Validation

This project uses **class-validator** + **class-transformer** with NestJS's built-in global `ValidationPipe`. Do not use Zod for HTTP request validation.

Every DTO is a `class` with `class-validator` decorators and `@ApiProperty()` from `@nestjs/swagger`:

```typescript
// create-patient.dto.ts
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePatientDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;

  @ApiProperty() @IsString() @IsNotEmpty() phone: string;

  @ApiPropertyOptional() @IsOptional() @IsString() membershipNumber?: string;

  @ApiProperty({ type: [String] }) @IsString({ each: true }) conditionTags: string[];
}
```

Controllers use plain `@Body()` and `@Query()` — no pipe argument:

```typescript
@Post()
create(@Body() dto: CreatePatientDto) {
  return this.patientsService.create(dto);
}
```

**Key conventions:**

- Enums validated with `@IsEnum(EnumName)`
- Nested objects: `@ValidateNested({ each: true })` + `@Type(() => NestedClass)`
- ULID fields: `@IsString() @Length(26)`
- "At least one of" constraint: use `@ValidateIf((o) => !o.otherField)` on the secondary field
- "Exactly one of" constraint: use a custom `@ValidatorConstraint` class
- Conditional validation: `@ValidateIf((o) => o.status === 'rejected')` (e.g. reason required on rejection)
- Query param numeric coercion: `@Type(() => Number)` (combined with `ValidationPipe({ transform: true })`)
- Every DTO field must have `@ApiProperty()` or `@ApiPropertyOptional()` — Swagger documentation is not optional
- **`@IsTrue()` does not exist in this version of class-validator.** Use `@Equals(true, { message: '...' })` for boolean consent fields that must be exactly `true`.

**Global pipe (registered in `main.ts`):**
```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

### 5.5 Response Shape

Every controller endpoint returns `StandardResponse<T>`. The `TransformInterceptor` wraps the service return value automatically. Services return plain data objects — not pre-wrapped responses.

```typescript
// StandardResponse shape (applied by interceptor, not manually)
{
  data: T;
  meta?: { cursor?: string; total?: number; limit?: number };
  traceId: string;
}
```

### 5.6 Pagination

All list endpoints use **keyset (cursor) pagination**. Never use offset/skip pagination.

```typescript
// Standard paginated query pattern
const qb = this.repo.createQueryBuilder('e')
  .where('e.deleted_at IS NULL')
  .orderBy('e.id', 'ASC')
  .take(dto.limit + 1);

if (dto.cursor) {
  qb.andWhere('e.id > :cursor', { cursor: dto.cursor });
}

const rows = await qb.getMany();
const hasMore = rows.length > dto.limit;
if (hasMore) rows.pop();
const nextCursor = hasMore ? rows[rows.length - 1].id : undefined;
```

Return `meta.cursor` in the response when there are more pages.

### 5.7 Actor Tracking

Never set `createdBy` or `updatedBy` manually. The `EntityActorSubscriber` reads `userId` from `ClsService` and sets both fields automatically before every insert and update. Your only responsibility is to ensure `ClsService` is populated at the start of each request — the `JwtAuthGuard` or a CLS middleware must call `cls.set('userId', user.id)`.

### 5.8 Two-Phase Registration Pattern

All roles except `researcher` use a **two-phase registration** flow to match the frontend onboarding UX:

**Phase 1 — Lite Signup** (`POST /auth/signup`):
- Accepts `{ name, email, password, role }` only
- Creates `User` + optional skeleton entity in one transaction:
  - `patient` → empty `Patient` row (phone is nullable to support deferred collection)
  - `ngo` / `hmo` → pending `Organization` stub
  - `professional` / `benefactor` → `User` only (application created in Phase 2)
- Issues access token + refresh cookie immediately
- Returns `{ accessToken, user: { id, name, email, role, status } }`

**Phase 2 — Onboarding** (`POST /auth/onboarding/:role`):
- Requires Bearer access token from Phase 1
- Completes the profile or creates application record:
  - `patient` → updates Patient fields + upserts ConsentGrant rows
  - `ngo` / `hmo` → updates Organization with verified details, queues admin notification
  - `professional` / `benefactor` → creates Application record; user stays `status: 'pending'` until admin approves

**Researcher** is the exception — uses OTP flow: `POST /auth/request-otp` → `POST /auth/register/researcher`.

---

## 6. Database Rules

### 6.1 TypeORM Usage

- Always inject `Repository<Entity>` via `@InjectRepository(EntityClass)`. Do not use `DataSource` directly for CRUD.
- Use `createQueryBuilder()` for any query involving joins, conditions on related entities, or JSONB operators.
- **`synchronize` in development:** `synchronize: true` is enabled by default in development when the `DB_SYNC` env var is not explicitly set to `'false'`. This auto-applies entity changes to the schema. **In production, always set `DB_SYNC=false`** and use explicit migrations.
- Use TypeORM's `@VersionColumn()` on entities that need optimistic locking (`ConsentGrant`, `Enrollment`).
- Soft deletes are handled via `@DeleteDateColumn()` on `BaseEntity`. Always query with `.where('entity.deleted_at IS NULL')` unless you explicitly need deleted records.
- Use `dataSource.transaction(async (manager) => { ... })` for operations that must be atomic across multiple entities.

### 6.2 IDs

Every entity uses ULID as its primary key. Never use auto-increment integers or UUID v4.

```typescript
// BaseEntity generates the ID on @BeforeInsert
@BeforeInsert()
generateId() {
  if (!this.id) this.id = ulid();
}
```

- All FK columns are `char(26)` — matching the ULID length.
- Declare FK columns explicitly: `@Column({ name: 'patient_id', type: 'char', length: 26 })`.
- Do not use TypeORM `@ManyToOne` / `@JoinColumn` relation decorators unless you need eager loading (you almost never do). Use plain FK columns and join manually in queries.

### 6.3 JSONB Columns

Three entities use `jsonb` columns: `patients.medication_list`, `programs.eligibility_criteria`, `studies.eligibility_criteria`, `care_events.structured`, `enrollments.shared_data_snapshot`, `notifications.payload`, `audit_log.metadata`.

Required GIN indexes — add in migrations, not in entity decorators:

```sql
CREATE INDEX ON programs USING GIN (eligibility_criteria);
CREATE INDEX ON studies USING GIN (eligibility_criteria);
CREATE INDEX ON care_events USING GIN (structured);
CREATE INDEX ON patients USING GIN (medication_list);
CREATE INDEX ON patients USING GIN (condition_tags);  -- array column
```

Use JSONB operators in raw queries — never deserialise to JS and filter in application code:

```typescript
// Correct — filtering inside SQL
.where("p.eligibility_criteria @> :criteria::jsonb", { criteria: JSON.stringify([{ field: 'locationState', value: 'Lagos' }]) })

// Wrong — never do this
const all = await this.programRepo.find();
return all.filter(p => matchesCriteria(p.eligibilityCriteria, patient));
```

### 6.4 Migrations

- Generate migrations with: `pnpm run migration:generate -- -n <MigrationName>`
- Run migrations with: `pnpm run migration:run`
- Revert last migration: `pnpm run migration:revert`
- **Never edit a migration file that has already been run in any environment.** Create a new migration instead.
- Every schema change — new table, new column, new index, new constraint — requires a migration file.
- Migration files are timestamped and committed to version control.
- Include GIN indexes and RLS policy setup in migrations, not in application code.

### 6.5 Row-Level Security (RLS)

Postgres RLS is the hard data boundary — independent of NestJS guards. Both layers must be in place.

**Org-scoped tables** (`programs`, `enrollments`, `organizations`, `care_events`): call `SET LOCAL app.org_id = $orgId` inside every transaction.

**Patient-scoped tables** (`consent_grants`, `enrollments`, `study_enrollments`, `care_events`): call `SET LOCAL app.user_id = $patientId` inside every patient-authenticated transaction.

```typescript
// Correct — SET LOCAL inside the transaction
await dataSource.transaction(async (manager) => {
  await manager.query('SET LOCAL app.org_id = $1', [orgId]);
  // all queries in this transaction are now RLS-filtered
});
```

**Critical rules:**
- **Always use `SET LOCAL`** — never bare `SET`. `SET LOCAL` resets when the transaction ends, so it is safe with connection pools. Bare `SET` persists for the full connection lifetime and will contaminate subsequent pooled requests.
- **Never skip `SET LOCAL`** because a NestJS guard already checked the scope. Guards can have bugs; RLS is the safety net.
- RLS policy definitions and `SET LOCAL` usage must both be tested together in integration tests.

### 6.6 Seeds

Seeds live in `src/database/seeds/`. They are run manually and only in development/staging environments. Seeds must be idempotent — running them twice must not create duplicate records. Use `INSERT ... ON CONFLICT DO NOTHING` or check-before-insert patterns.

---

## 7. Testing Standards

### 7.1 What to Test

| Layer | Test Type | What to Cover |
|---|---|---|
| Services | Unit | Business logic, state machine transitions, error throwing, consent checks |
| DTOs | Unit | class-validator decorators — valid input passes, invalid input fails with correct error paths |
| Processors | Unit | Job payload handling, service method calls, error re-queuing |
| Controllers | Integration | HTTP status codes, request/response shapes, guard rejections |
| Critical flows | E2E | Patient registration, consent revocation cascade, enrollment creation, export token lifecycle |

Do not write tests for TypeORM entity definitions or NestJS module wiring — these are framework concerns.

### 7.2 File Location and Naming

Unit and integration tests live **next to the file they test**:

```
patients.service.ts
patients.service.spec.ts       ← unit test

patients.controller.ts
patients.controller.spec.ts    ← integration test (with supertest)
```

E2E tests live in a top-level `test/` directory:

```
test/
├── auth.e2e-spec.ts
├── enrollment.e2e-spec.ts
├── consent-revocation.e2e-spec.ts
└── export-token.e2e-spec.ts
```

### 7.3 Test Runner

Jest with `ts-jest`. Configuration in `jest.config.ts` at the project root. Run unit tests with `pnpm test`, E2E tests with `pnpm test:e2e`.

### 7.4 Mocking Conventions

- Mock **repositories** using Jest's `createMockRepository()` helper or a manual object with `jest.fn()` for each method used.
- Mock **external services** (Redis, BullMQ, S3) at the module level using `jest.mock()` or NestJS test module overrides.
- Mock **ClsService** in unit tests by providing a stub that returns a fixed `userId`.
- Never mock the entity classes themselves — instantiate them directly.
- Use `@nestjs/testing`'s `Test.createTestingModule()` for all service and controller tests. Do not instantiate services with `new` in tests.

```typescript
// Standard service test setup
const module = await Test.createTestingModule({
  providers: [
    PatientsService,
    { provide: getRepositoryToken(Patient), useValue: mockRepository },
    { provide: ClsService, useValue: { get: jest.fn().mockReturnValue('user-ulid-123') } },
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
}).compile();
```

#### Controller Integration Test Pattern

**Every `<name>.controller.spec.ts` MUST follow this pattern.** The broken "no providers" stub (just `controllers: [XController]` with no providers or guard overrides) is not acceptable — it cannot pass and provides zero value.

The canonical reference is `src/modules/admin/admin.controller.spec.ts`. The pattern has three parts:

**1. Guard helpers** — populate `req.user` so `@CurrentUser()` resolves correctly:

```typescript
const allowAllGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: TEST_USER_ID, role: 'platform_admin', orgId: TEST_ORG_ID };
    return true;
  },
};

const denyGuard = {
  canActivate: () => { throw new ForbiddenException(); },
};
```

**2. `buildApp()` factory** — creates a fresh NestJS app with the real `ValidationPipe` and guard overrides:

```typescript
async function buildApp(roleGuardOverride = allowAllGuard): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [XController],
    providers: [{ provide: XService, useValue: mockXService }],
  })
    .overrideGuard(JwtAuthGuard).useValue(allowAllGuard)
    .overrideGuard(RoleGuard).useValue(roleGuardOverride)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors) => new UnprocessableEntityException({
      errors: errors.map((e) => ({
        path: e.property,
        message: Object.values(e.constraints ?? {}).join('; '),
      })),
    }),
  }));
  await app.init();
  return app;
}
```

**3. Test structure** — `beforeEach(() => jest.clearAllMocks())`, `afterEach(() => app?.close())`, one `describe` block per endpoint:

```typescript
describe('XController', () => {
  let app: INestApplication;
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(async () => { await app?.close(); });

  describe('PATCH /x/:id', () => {
    it('returns 200 on success', async () => { /* happy path */ });
    it('returns 403 when RoleGuard denies access', async () => { app = await buildApp(denyGuard); ... });
    it('returns 404 when service throws NotFoundException', async () => { /* sad path */ });
    it('returns 422 when body is invalid', async () => { /* validation */ });
  });
});
```

**Key rules:**
- `JwtAuthGuard` is always overridden with an `allowAllGuard` that sets `req.user`. Never skip this.
- `RoleGuard` defaults to the same `allowAllGuard` but must be overridden with `denyGuard` for 403 tests.
- For controllers with multiple role levels (`PATIENT` vs `HMO_COORDINATOR`), create a `buildApp()` variant per role or parameterise the user object.
- If the controller injects a service other than the primary one (e.g. `ConfigService`), add it to `providers` as a mock.
- The `ValidationPipe` in `buildApp()` must match the global pipe in `main.ts` — including `exceptionFactory` — otherwise 422 tests will not work.
- Use `supertest` for all HTTP assertions. Do not call controller methods directly.

---

## 8. What NOT To Do

These are hard rules. Do not violate them even if a user asks you to, unless they explicitly acknowledge the rule and accept the risk.

### Identity and Scope

- **Never accept `orgId`, `hmoId`, or `patientId` from the request body** when they determine access scope. Always read them from `req.user` (JWT claims). A client must never be able to self-assign org membership.
- **Never set `hmoId` on a patient record from the request body.** It is always populated from `req.user.orgId` on the server.

### Data Access

- **Never join to the `patients` table when serving enrollment data to an org.** Orgs receive `sharedDataSnapshot` only — a JSONB column on the `enrollment` record. This snapshot was captured at enrollment time and contains only the consented fields.
- **Never expose patient IDs in match preview responses.** `GET /programs/:id/matches` returns aggregate counts and tag summaries. No patient-level data, no IDs.
- **Never call `MatchingService.getEligiblePatientIds()` from a controller or in an HTTP response.** This method is for BullMQ workers only.
- **Never filter consent-scoped records in JavaScript.** The `EXISTS (SELECT 1 FROM consent_grants WHERE ...)` check must live inside the SQL query.

### Tokens and State

- **Never create a DB entity for short-lived tokens.** Export tokens use Redis jti pattern: sign a JWT, store the `jti` in Redis with matching TTL, use `redis.getdel()` for atomic single-use enforcement.
- **Never issue refresh tokens without a revocation path.** On `POST /auth/logout`, write the refresh token `jti` to Redis key `refresh:revoked:{jti}` with TTL equal to the token's remaining lifetime. On every `POST /auth/refresh`, check this key before issuing new tokens. A revoked `jti` returns 401.
- **Never use `synchronize: true` in production.** Development may use it (controlled via `DB_SYNC` env var) but production must always set `DB_SYNC=false` and use explicit migrations.
- **Never edit a migration file that has already been committed and run.**

### Schema Design

- **Never use a single FK column that references two different tables.** The `messages` table links to both `enrollments` and `study_enrollments`. Use two nullable FK columns (`enrollmentId` and `studyEnrollmentId`) with a database-level `CHECK (num_nonnulls(enrollment_id, study_enrollment_id) = 1)` constraint. This enforces exactly one is non-null at the DB level, not just in application code.

### Validation and IDs

- **Never use Zod for HTTP request validation.** class-validator is the project standard.
- **Never use `@IsTrue()` — it does not exist in this version of class-validator.** Use `@Equals(true, { message: '...' })` for boolean consent fields that must be exactly `true`.
- **Never skip `@ApiProperty()` on DTO fields.** Every DTO field must be documented for Swagger — `@ApiProperty()` for required fields, `@ApiPropertyOptional()` for optional ones.
- **Never use UUID v4 or auto-increment integers as primary keys.** All IDs are ULIDs.
- **Never use offset pagination.** Cursor-based keyset pagination only.

### Writes and Side Effects

- **Never skip the audit log for these actions:** PDF export, consent revocation, admin approval/rejection, cross-org access attempts.
- **Never update or delete rows in `audit_log`.** It is insert-only.
- **Never enqueue one BullMQ job per patient for fan-out notifications.** The fan-out coordinator enqueues one batch job per 200 patients. One job per patient at scale breaks Redis.
- **Never write business logic in a controller.** Controllers call one service method and return.
- **Never use `getRepository()` from the global `DataSource`.** Always inject `Repository<Entity>` via `@InjectRepository()`.

### Security

- **Never log `passwordHash`, patient `phone`, JWT payloads, or `sharedDataSnapshot`.**
- **Never return patient contact details (email, phone) to organisations via enrollment data.** Phone is accessible to HMO coordinators via the patients API only after the patient is linked to their org. Enrollment `sharedDataSnapshot` contains only consented fields, not raw contact info.

---

## 9. How To Run The Project

### Development

```bash
# Install dependencies
pnpm install

# Start in watch mode (port 3000, Swagger at /api/docs)
pnpm run start:dev
```

**Required environment variables:** Copy `.env.example` to `.env`. The critical ones for startup:
- `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` — RS256 PEM keys (use `\n` escapes in `.env` for multi-line)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — PostgreSQL connection
- `REDIS_HOST`, `REDIS_PORT` — Redis connection

### Database

```bash
# Run pending migrations
pnpm run migration:run

# Generate a new migration from entity changes
pnpm run migration:generate -- -n <MigrationName>

# Revert last migration
pnpm run migration:revert

# Run seeds (development/staging only)
pnpm run seed
```

### Testing

```bash
# Run all unit tests
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run unit tests with coverage report
pnpm test:cov

# Run E2E tests
pnpm test:e2e
```

### Build and Production

```bash
# Compile TypeScript to dist/
pnpm build

# Start compiled production build
pnpm start:prod
```

### Linting

```bash
# Lint and auto-fix
pnpm lint

# Format with Prettier
pnpm format
```

---

## 10. Auth Endpoints & Role Reference

All routes are prefixed with `/api`. All responses are `StandardResponse<T>`.

### Auth Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/signup | — | Lite signup — creates User + skeleton, returns tokens immediately |
| POST | /auth/login | — | Login (email + password), returns tokens |
| POST | /auth/refresh | Refresh Cookie | Rotate access + refresh tokens |
| POST | /auth/logout | JWT | Revoke refresh token |
| POST | /auth/forgot-password | — | Request password reset email |
| POST | /auth/reset-password | — | Complete password reset |
| POST | /auth/request-otp | — | Request OTP (researcher pre-registration) |
| POST | /auth/register/patient | — | Full patient registration (HMO coordinator use) |
| POST | /auth/register/org | — | Full org registration |
| POST | /auth/register/researcher | — | Researcher registration with OTP |
| POST | /auth/onboarding/patient | `patient` JWT | Complete health profile + consent grants |
| POST | /auth/onboarding/ngo | `ngo_admin` JWT | Submit NGO org details for verification |
| POST | /auth/onboarding/hmo | `hmo_coordinator` JWT | Submit HMO org details for verification |
| POST | /auth/onboarding/professional | `professional` JWT | Submit professional application |
| POST | /auth/onboarding/benefactor | `benefactor` JWT | Submit benefactor application |

### Admin Application Review Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /admin/applications/professional | `platform_admin` | List professional applications (filter by status) |
| PATCH | /admin/applications/professional/:id/review | `platform_admin` | Approve or reject |
| GET | /admin/applications/benefactor | `platform_admin` | List benefactor applications |
| PATCH | /admin/applications/benefactor/:id/review | `platform_admin` | Approve or reject |

### User Roles

| Role enum value | Frontend `role` param | Description |
|---|---|---|
| `patient` | `patient` | Self-registered patients and caregivers |
| `ngo_admin` | `ngo` | NGO staff managing funding programs |
| `hmo_coordinator` | `hmo` | HMO staff managing enrolled members |
| `researcher` | — | Researchers (OTP flow, separate endpoint) |
| `professional` | `professional` | Healthcare professionals (requires admin approval) |
| `benefactor` | `benefactor` | Individual supporters/donors (requires admin approval) |
| `platform_admin` | — | Internal platform administrators |

### Consent Grant Lifecycle (Patient Onboarding)

Consents are upserted during `POST /auth/onboarding/patient`:
- `termsConsent: true` → internal validation only (no ConsentGrant row)
- `ngoConsent: true` → `ConsentGrant(purpose=NGO_FUNDING, status=ACTIVE)`
- `ngoConsent: false` → `ConsentGrant(purpose=NGO_FUNDING, status=NOT_GRANTED)`
- `researchConsent: true/false` → `ConsentGrant(purpose=CLINICAL_RESEARCH_RECRUITMENT, ...)`
- `HMO_CARE` consent is created separately when a patient approves an HMO link request

### Application Review Lifecycle (Professional & Benefactor)

1. Lite signup → `user.status = 'pending'`
2. Onboarding → `ProfessionalApplication` / `BenefactorApplication` created with `status = 'pending'`
3. Admin approves → `application.status = 'approved'` + `user.status = 'active'` (one transaction)
4. Admin rejects → `application.status = 'rejected'` + `rejectionReason` stored

---

## 11. Implementation Decisions

These are known scaffold decisions that every implementer must be aware of. They are not bugs — they are explicit trade-offs or deferred work with documented rationale.

### 11.1 CLI DataSource vs. Application DataSource

`src/database/data-source.ts` is used exclusively by the TypeORM CLI (`pnpm run migration:run`, etc.). It is **not** imported by the NestJS application. It calls `dotenv.config()` directly because it runs outside the NestJS container. The application uses `database.config.ts` (via `ConfigService`). Keep the `entities:` and `migrations:` glob patterns in both files in sync — they must point to the same files or migration generation will be inconsistent.

### 11.2 HealthModule

NestJS requires every controller to be registered in a module's `controllers[]` array. The `src/health/` directory needs both `health.module.ts` and `health.controller.ts`. `AppModule` imports `HealthModule`. Do not register `HealthController` directly in `AppModule.controllers` — use the module.

### 11.3 TransformInterceptor — DI Wiring Gap

`TransformInterceptor` is currently instantiated with `new TransformInterceptor()` in `main.ts`. This bypasses NestJS DI, so `ClsService` is never injected — `traceId` falls back to `crypto.randomUUID()` per response instead of the CLS request-scoped trace ID. **When implementing:** change to `app.get(TransformInterceptor)` and add `TransformInterceptor` to `AppModule.providers`.

### 11.4 BullMQ Processor Multiplexing

Multiple processors share a single queue and filter on `job.name`. Do not create separate queues per processor. Three queues (`notifications`, `admin`, `mail`) serve all nine processors. The `NOTIFICATIONS_QUEUE` batch size constant is 200 — never change this without considering Redis memory implications.

### 11.5 StudyEnrollmentsController in Two Modules

Patient action (`POST /study-enrollments`) lives in `EnrollmentsModule`; researcher action (`POST /study-enrollments/:id/invite`) lives in `StudiesModule`. This preserves actor-ownership boundaries and avoids a circular import between the two modules. Both register a `StudyEnrollmentsController` — with different route handlers.

### 11.6 PassportModule, JwtStrategy and Per-Request Account Status

`JwtAuthGuard` extends `AuthGuard('jwt')`. `PassportModule`, `passport-jwt`, and `JwtStrategy` are implemented at `src/modules/auth/strategies/jwt.strategy.ts`. The strategy validates RS256 JWTs using the public key from `ConfigService` (`jwt.publicKey`).

**Token verification is stateless; account status is not.** `JwtStrategy.validate()` still returns the decoded payload as-is — the token carries no `status` claim. `JwtAuthGuard` then performs a per-request lookup of `users.status` and rejects anything that is not `'active'`:

- `'suspended'` → `403 Account suspended`
- `'pending'` → `403 Account pending verification`
- row missing → `401`

This supersedes the earlier "suspension is enforced at login only" design. Enforcing at login alone meant a pending NGO admin or HMO coordinator could reach every endpoint their role allowed — including patient lookup and care events — and a suspended user could rotate refresh tokens indefinitely. Status is read live rather than added as a token claim so that an admin approval or suspension takes effect on the **next request**, not up to 15 minutes later when the access token expires.

`refreshTokens()` additionally rejects `'suspended'` (but not `'pending'`, which is a legitimate session).

**Opting out.** Routes a pending user legitimately needs are marked with `@AllowPending()` (`src/common/decorators/allow-pending.decorator.ts`), which skips the status check only: the five `POST /auth/onboarding/*` routes, `GET /auth/me`, `POST /auth/logout`, and `PATCH /applications/professional/me/bio`. **Never** put `@AllowPending()` on a route that returns or mutates platform data.

Because the check lives in `JwtAuthGuard`, every authenticated route is covered automatically — a new endpoint is protected the moment it authenticates. It cannot be a global `APP_GUARD`: NestJS runs global guards before controller- and route-scoped ones, so `req.user` would not yet be populated.

`CommonModule` is `@Global()` and exports `TypeOrmModule.forFeature([User])` so the guard can resolve `UserRepository` from any feature module. The lookup is a primary-key hit selecting two columns; if it ever profiles hot, cache it in Redis (see the comment in the guard for the invalidation points required).

### 11.7 `strictPropertyInitialization` Disabled Intentionally

`tsconfig.json` sets `"strictPropertyInitialization": false`. This is a deliberate project-wide decision, not an oversight.

TypeORM entities and NestJS DTO classes are populated by the framework at runtime — TypeORM hydrates entity columns from DB rows, and `class-transformer` hydrates DTO fields from the request body. TypeScript cannot see these runtime assignments, so `strictPropertyInitialization: true` would require `!` on every column and DTO field, which is noise without safety value.

The real runtime guarantees come from two other layers that are always in place:
- **DTOs**: `class-validator` decorators + global `ValidationPipe` — a request with a missing required field is rejected before it reaches a controller.
- **Entities**: TypeORM column definitions + database NOT NULL and FK constraints — missing required data is rejected at the DB level.

Do not re-enable `strictPropertyInitialization` and do not add `!` assertions to entity columns or DTO fields. All other strict flags remain on.

### 11.8 `common/constants/` Privacy Boundary

`src/common/constants/snapshot-fields.ts` is the single source of truth for the `ConsentPurpose → patient fields` mapping. No service may define its own field list. This file has no imports from other `src/` paths — it imports only from `src/common/enums` — making it safe to import from any module without creating circular dependencies.

### 11.9 Two-Phase Registration — Phone Nullability

The `patients.phone` column is **nullable** in this implementation, which differs from the original scaffold spec. This was a deliberate change to support the two-phase registration flow: lite signup creates the Patient row with minimal data, and the phone is collected during the onboarding step. HMO coordinators using `POST /auth/register/patient` (the full direct-registration path) still require phone upfront via `RegisterPatientDto`.

---

*LucenCare Backend — CLAUDE.md v7*
*Read `docs/ARCHITECTURE.md` for full entity schemas, API contracts, and business rules.*
*Read `docs/specs/` for per-module implementation specs.*
