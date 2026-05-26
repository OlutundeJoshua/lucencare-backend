# LucenCare — Backend Architecture V1

> **Stack:** NestJS 11 · TypeScript · PostgreSQL 17 · Redis · BullMQ · JWT RS256 · TypeORM · ULID  
> **Last updated:** 2026-05-24

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Folder Structure](#2-folder-structure)
3. [Database Entities](#3-database-entities)
4. [Enums](#4-enums)
5. [DTOs](#5-dtos)
6. [Module Breakdown](#6-module-breakdown)
7. [API Contract](#7-api-contract)
8. [Business Rules & Constraints](#8-business-rules--constraints)
9. [Inter-module Dependencies](#9-inter-module-dependencies)
10. [Non-functional Requirements](#10-non-functional-requirements)

---

## 1. System Overview

### 1.1 Purpose

LucenCare is a **multi-sided health data platform** that enables patients to selectively share their health records with NGOs (funding programs), HMOs (care coordination), and clinical researchers — all under explicit, revocable, patient-controlled consent. No party can access patient data without a valid, active consent grant. The platform acts as a trusted broker, never exposing raw patient identifiers to organisations unless the patient explicitly authorises it.

### 1.2 Platform Goals

| Goal | Description |
|---|---|
| Patient sovereignty | Patients control exactly what data is shared, with whom, and for what purpose. Consent is revocable at any time. |
| Privacy by default | Data is never shared beyond the scope of an active consent grant. Snapshots, not live joins. |
| Org accountability | NGOs and HMOs must be verified by a platform admin before accessing any patient data. |
| Research integrity | Clinical studies must carry a valid IRB number and pass admin review before researchers can recruit. |
| Auditability | Every sensitive action (export, revocation, admin decision) is written to an immutable audit log. |
| Scalability of notifications | Fan-out notifications to matched patients are batch-processed via BullMQ — not naively queued per patient. |

### 1.3 User Roles

| Role | Description |
|---|---|
| `patient` | Registers, manages consents, views matching programs/studies, enrolls, messages orgs. |
| `ngo_admin` | Creates funding programs (post-verification), views matched patients, sends notifications, messages enrolled patients. |
| `hmo_coordinator` | Looks up patients by membership number or phone hash, creates care events, requests export tokens. |
| `researcher` | Registers with institutional email + OTP, submits studies for review, invites interested patients, views study enrollments. |
| `platform_admin` | Approves/rejects orgs, programs, and studies. Has no access to patient health data. |

### 1.4 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js 22+ | LTS |
| Package Manager | pnpm 9.14.x | Hoisted node_modules for NestJS compatibility |
| Framework | NestJS 11 | Modular, decorator-driven |
| Language | TypeScript | Strict mode (`strict: true`) |
| Database | PostgreSQL 17 | Row-level security (RLS) enabled per-org |
| ORM | TypeORM 0.3.x | Typed queries; no `getRepository()` magic |
| ID Strategy | ULID | `ulid` npm package — sortable, non-guessable, 26-char URL-safe string |
| Auth | JWT RS256 | Access token: 15 min · Refresh token: 7 days in httpOnly cookie |
| Cache / Queue | Redis + BullMQ | Notifications, consent revocation events, OTP, export jti |
| Realtime | WebSocket | `@nestjs/websockets` — AI chat streaming + live notification push |
| Storage | S3-compatible | PDF exports, study information sheets |
| Validation | class-validator + class-transformer | NestJS global `ValidationPipe` — decorators on DTO classes |
| API Docs | `@nestjs/swagger` | OpenAPI 3 — served at `/api/docs` (non-production) |
| Async Context | `nestjs-cls` | Carries `userId` for automatic `createdBy`/`updatedBy` tracking |
| Logging | `nestjs-pino` | Structured JSON logs with trace IDs |
| Health Checks | `@nestjs/terminus` | DB + Redis + S3 liveness probes |
| Rate Limiting | `@nestjs/throttler` + `nestjs-throttler-storage-redis` | Fixed window, Redis-backed, per-IP / per-user / per-org |

### 1.5 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        API Gateway  (:3000)                          │
│         JWT RS256 · RLS · OrgScopeGuard · global ValidationPipe        │
└──────────────┬────────────────────┬─────────────────────────────────-┘
               │  HTTP              │  WebSocket
   ┌───────────▼──────────┐   ┌────▼──────────────┐
   │    NestJS Modules     │   │   ChatGateway      │
   │  (REST Controllers)   │   │   NotifGateway     │
   └───────────┬──────────┘   └────────────────────┘
               │
   ┌───────────▼──────────────────────────────────────┐
   │                   Service Layer                   │
   │  Auth · Patients · Orgs · Consents · Programs    │
   │  Studies · Enrollments · Matching · Export       │
   │  Notifications · Audit · Admin                   │
   └──────────┬──────────────────────┬────────────────┘
              │ TypeORM              │ BullMQ Jobs
   ┌──────────▼──────┐   ┌──────────▼──────────────────┐
   │  PostgreSQL 15  │   │  Redis                       │
   │  (RLS enabled)  │   │  • BullMQ queues                      │
   │                 │   │  • OTP keys (otp:{userId})            │
   └─────────────────┘   │  • Export jti keys                    │
                         │  • Refresh revocation (refresh:revoked:{jti}) │
                         │  • Match count cache                  │
                         └───────────────────────────────────────┘
```

---

## 2. Folder Structure

```
src/
├── common/
│   ├── entities/
│   │   └── base.entity.ts              # ULID PK, timestamps, createdBy/updatedBy
│   ├── subscribers/
│   │   └── entity-actor.subscriber.ts  # Auto-populates createdBy/updatedBy from CLS
│   ├── enums/
│   │   └── index.ts                    # All platform enums
│   ├── constants/
│   │   └── snapshot-fields.ts          # ConsentPurpose → field[] mapping — single source of truth for sharedDataSnapshot
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── role.guard.ts
│   │   └── org-scope.guard.ts          # Enforces req.user.orgId === resource.orgId
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   ├── current-user.decorator.ts
│   │   └── org-scoped.decorator.ts
│   ├── interceptors/
│   │   ├── transform.interceptor.ts    # Wraps all responses in StandardResponse<T>
│   │   └── audit.interceptor.ts        # Auto-logs sensitive actions
│   ├── filters/
│   │   └── global-exception.filter.ts  # Maps errors to RFC 7807 problem detail
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
│   └── admin/
├── queues/
│   ├── queues.module.ts
│   ├── queues.constants.ts             # Queue name constants
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
│   ├── chat.gateway.ts                 # WebSocket — AI chat (V2 feature — deferred; placeholder only)
│   └── notifications.gateway.ts        # WebSocket — live notification push
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   └── jwt.config.ts
├── database/
│   ├── migrations/
│   └── seeds/
├── health/
│   └── health.controller.ts
└── main.ts
```

---

## 3. Database Entities

All entities extend `BaseEntity` and share the following fields:

```typescript
// src/common/entities/base.entity.ts
abstract class BaseEntity {
  id: string;           // ULID, PK, char(26), NOT NULL
  createdAt: Date;      // timestamptz, NOT NULL, default NOW()
  updatedAt: Date;      // timestamptz, NOT NULL, auto-updated
  deletedAt?: Date;     // timestamptz, nullable — soft delete
  createdBy?: string;   // char(26), FK → users.id (nullable for system actions)
  updatedBy?: string;   // char(26), FK → users.id (nullable for system actions)
}
```

> **Note:** `@BeforeInsert()` calls `ulid()` to generate `id` if not already set.  
> `EntityActorSubscriber` reads from `ClsService` to auto-set `createdBy`/`updatedBy`.

---

### 3.1 `users`

**Purpose:** Authentication identity for all platform users.

```typescript
interface User extends BaseEntity {
  role: UserRole;           // enum, NOT NULL
  orgId?: string;           // char(26), FK → organizations.id, nullable (null for patients/researchers)
  email: string;            // text, UNIQUE, NOT NULL
  passwordHash: string;     // text, NOT NULL — bcrypt, cost factor 12
  status: string;           // text, default 'pending' — 'pending' | 'active' | 'suspended' (plain text intentional for V1; class-validator enforces valid values at API layer)
  institutionId?: string;   // char(26), nullable — researcher institution FK (future entity)
}
```

**Indexes:**
- `UNIQUE INDEX` on `email`
- `INDEX` on `org_id` (coordinator/admin lookups)
- `INDEX` on `role` (admin queries)

**Constraints:**
- `orgId` must be non-null when `role` is `ngo_admin` or `hmo_coordinator`
- `orgId` must be null when `role` is `patient` or `researcher`

> **V1 decision:** `status` stays as plain `text`. Valid values (`'pending' | 'active' | 'suspended'`) are enforced by class-validator at the API layer. A `UserStatus` enum can be added in a future migration if DB-level constraint enforcement becomes necessary.

---

### 3.2 `organizations`

**Purpose:** Represents verified NGO or HMO organisations.

```typescript
interface Organization extends BaseEntity {
  name: string;         // text, NOT NULL
  type: OrgType;        // enum, NOT NULL
  status: OrgStatus;    // enum, NOT NULL, default 'pending_verification'
  contactEmail: string; // text, NOT NULL
  verifiedAt?: Date;    // timestamptz, nullable — set when admin approves
  verifiedBy?: string;  // char(26), FK → users.id (must be platform_admin role)
}
```

**Indexes:**
- `INDEX` on `type`
- `INDEX` on `status` (admin review queue)

---

### 3.3 `patients`

**Purpose:** Health profile for a registered patient user.

```typescript
interface Patient extends BaseEntity {
  userId: string;              // char(26), UNIQUE, FK → users.id, NOT NULL
  hmoId?: string;              // char(26), FK → organizations.id, nullable — set server-side from JWT
  name: string;                // text, NOT NULL
  phone: string;               // text, UNIQUE, NOT NULL — stored as plain text, protected by auth guards + RLS
  membershipNumber?: string;   // text, UNIQUE, nullable — supplemental HMO policy/card number
  dateOfBirth?: string;        // date, nullable — ISO date YYYY-MM-DD
  gender?: Gender;             // enum, nullable
  address?: string;            // text, nullable — free-text full address (replaces locationState + locationLga)
  conditionTags: string[];     // text[], NOT NULL, default '{}'
  medicationList?: object[];   // jsonb, nullable — array of { name, rxnormCode?, dosage?, frequency? }
  directContactShared: boolean;// boolean, NOT NULL, default false
}
```

**Indexes:**
- `UNIQUE INDEX` on `user_id`
- `UNIQUE INDEX` on `phone`
- `UNIQUE INDEX` on `membership_number` (WHERE membership_number IS NOT NULL)
- `INDEX` on `hmo_id`
- `GIN INDEX` on `condition_tags` — supports array overlap queries (`&&`)
- `GIN INDEX` on `medication_list` — supports JSONB containment queries (`@>`)

**Constraints:**
- `phone` is required for all patients — not nullable
- `hmoId` is NEVER set from the request body. For `POST /patients` it is set from `req.user.orgId`; for the link-request flow it is set only when the **patient** approves via `PATCH /patients/me/link-requests/:id`

---

### 3.4 `hmo_link_requests`

**Purpose:** Tracks pending/actioned requests from HMO coordinators to link a self-registered patient to their organisation. The patient must explicitly approve before `patients.hmo_id` is set.

```typescript
interface HmoLinkRequest extends BaseEntity {
  patientId: string;            // char(26), FK → patients.id, NOT NULL
  orgId: string;                // char(26), FK → organizations.id, NOT NULL
  status: HmoLinkRequestStatus; // enum: 'pending' | 'approved' | 'rejected', NOT NULL
  expiresAt: Date;              // timestamptz, NOT NULL — pending requests expire after 7 days
}
```

**Indexes:**
- `INDEX` on `patient_id`
- `INDEX` on `org_id`
- Composite `INDEX` on `(patient_id, org_id, status)` — used for duplicate-pending check

---

### 3.5 `care_events`

**Purpose:** Clinical events recorded by HMO coordinators for a patient.

```typescript
interface CareEvent extends BaseEntity {
  patientId: string;    // char(26), FK → patients.id, NOT NULL
  type: CareEventType;    // enum, NOT NULL
  eventDate: Date;        // date (not timestamptz — day precision), NOT NULL
  providerName?: string;  // text, nullable, max 200 chars — free-text provider name (e.g. 'Dr. Adeyemi', 'Lagos Island General Hospital'); FK to a providers entity is V2
  structured: object;     // jsonb, NOT NULL — shape varies per CareEventType (see below)
  notes?: string;       // text, nullable, max 2000 chars
}
```

**`structured` JSONB shapes by `CareEventType`:**

```typescript
// CLINIC_VISIT
{ visitReason: string; diagnosisCodes: string[]; followUpDate?: string }

// LAB_RESULT
{ testName: string; value: number | string; unit: string; referenceRange?: string; flagged?: boolean }

// PRESCRIPTION
{ drugName: string; rxnormCode?: string; dosage: string; frequency: string; refills?: number }

// REFERRAL
{ speciality: string; referredToProvider?: string; urgency: 'routine' | 'urgent' | 'emergency' }
```

**Indexes:**
- `INDEX` on `patient_id`
- `INDEX` on `(patient_id, event_date DESC)` — timeline queries
- `GIN INDEX` on `structured`

> **V1 decision:** `providerName` is a plain `text` field (max 200 chars) storing the name of the healthcare provider who delivered the care — e.g. the doctor, clinic, or hospital. A structured `providers` entity with FK referencing is deferred to V2.

---

### 3.5 `consent_grants`

**Purpose:** A patient's explicit consent to share data for a specific purpose.

```typescript
interface ConsentGrant extends BaseEntity {
  patientId: string;      // char(26), FK → patients.id, NOT NULL
  purpose: ConsentPurpose;// enum, NOT NULL
  dataScopes: string[];   // text[], NOT NULL — e.g. ['name', 'conditionTags', 'locationState']
  status: ConsentStatus;  // enum, NOT NULL, default 'active'
  grantedAt: Date;        // timestamptz, NOT NULL, default NOW()
  revokedAt?: Date;       // timestamptz, nullable — set atomically on revocation
  version: number;        // int, NOT NULL — TypeORM @VersionColumn for optimistic locking
}
```

**Indexes:**
- `INDEX` on `(patient_id, purpose)` — active grant lookups
- `INDEX` on `(patient_id, status)`
- `UNIQUE INDEX` on `(patient_id, purpose)` WHERE `status != 'revoked'` — enforces at most one non-revoked grant per purpose; multiple historical (revoked) grants for the same purpose are permitted

**State machine — legal transitions:**

```
NOT_GRANTED → PENDING → ACTIVE → PAUSED → ACTIVE  (re-activate)
                                ACTIVE → REVOKED   (terminal)
                                PAUSED → REVOKED   (terminal)
```

> **V1 decision:** Patients can have multiple historical `consent_grants` for the same purpose (e.g., grant → revoke → re-grant). The partial UNIQUE INDEX `WHERE status != 'revoked'` correctly blocks concurrent active/paused/pending grants while allowing a new grant after revocation.

---

### 3.6 `programs`

**Purpose:** Funding or support programs created by verified NGOs.

```typescript
interface Program extends BaseEntity {
  orgId: string;                  // char(26), FK → organizations.id, NOT NULL — always from JWT
  title: string;                  // text, NOT NULL
  type: ProgramType;              // enum, NOT NULL
  status: ProgramStatus;          // enum, NOT NULL, default 'pending_review'
  eligibilityCriteria: object[];  // jsonb, NOT NULL — array of { field, operator, value }
  expiresAt: Date;                // timestamptz, NOT NULL
}
```

**Indexes:**
- `INDEX` on `org_id`
- `INDEX` on `status`
- `INDEX` on `expires_at` (expiry job)
- `GIN INDEX` on `eligibility_criteria` — JSONB containment matching

**Constraints:**
- `orgId` is set server-side from `req.user.orgId` — never from request body
- `type` must match the creator org's `OrgType` (NGO creates `NGO_FUNDING`, etc.)

> **V1 decision:** The expiry sweeper job is deferred to V2. In V1, all queries against `programs` that are patient-facing (recommendations, matching) must include `AND p.expires_at > NOW()` to exclude expired programs at query time. Enrollments under expired programs are not automatically tombstoned in V1 — they remain as-is and the `expired` status on `ProgramStatus` is reserved for the V2 sweeper. The scheduled BullMQ processor (`program-expiry.processor.ts`) is a V2 addition.

---

### 3.7 `studies`

**Purpose:** Clinical research studies submitted by researchers.

```typescript
interface Study extends BaseEntity {
  researcherId: string;           // char(26), FK → users.id, NOT NULL
  title: string;                  // text, NOT NULL
  irbNumber: string;              // text, NOT NULL — format validated by regex at API layer
  status: StudyStatus;            // enum, NOT NULL, default 'pending_review'
  eligibilityCriteria: object[];  // jsonb, NOT NULL
  infoSheetUrl: string;           // text, NOT NULL — S3 object URL
  targetCount: number;            // int, NOT NULL — must be > 0
  compensationDetails?: string;   // text, nullable
}
```

**Indexes:**
- `INDEX` on `researcher_id`
- `INDEX` on `status`
- `GIN INDEX` on `eligibility_criteria`

---

### 3.8 `enrollments`

**Purpose:** A patient's active participation in an NGO program.

```typescript
interface Enrollment extends BaseEntity {
  patientId: string;              // char(26), FK → patients.id, NOT NULL
  programId: string;              // char(26), FK → programs.id, NOT NULL
  consentGrantId: string;         // char(26), FK → consent_grants.id, NOT NULL
  status: EnrollmentStatus;       // enum, NOT NULL, default 'active'
  sharedDataSnapshot: object;     // jsonb, NOT NULL — point-in-time copy of consented fields ONLY
  version: number;                // int — optimistic locking
}
```

**Indexes:**
- `INDEX` on `patient_id`
- `INDEX` on `program_id`
- `INDEX` on `consent_grant_id` — cascade revocation lookup
- `UNIQUE INDEX` on `(patient_id, program_id)` WHERE `status = 'active'` — no duplicate active enrollments

**Critical:** `sharedDataSnapshot` is the only field returned to NGOs. The `patients` table is **never joined** when serving enrollment data to an org.

---

### 3.9 `study_enrollments`

**Purpose:** A patient's interest or participation in a clinical study.

```typescript
interface StudyEnrollment extends BaseEntity {
  patientId: string;              // char(26), FK → patients.id, NOT NULL
  studyId: string;                // char(26), FK → studies.id, NOT NULL
  consentGrantId: string;         // char(26), FK → consent_grants.id, NOT NULL
  status: StudyEnrollmentStatus;  // enum, NOT NULL, default 'interested'
  sharedDataSnapshot: object;     // jsonb, NOT NULL
  directContactShared: boolean;   // boolean, NOT NULL, default false — explicit patient action required
}
```

**Indexes:**
- `INDEX` on `patient_id`
- `INDEX` on `study_id`
- `UNIQUE INDEX` on `(patient_id, study_id)`

---

### 3.10 `messages`

**Purpose:** Enrollment-scoped messaging between orgs/researchers and patients.

```typescript
interface Message extends BaseEntity {
  senderId: string;             // char(26), FK → users.id, NOT NULL
  recipientId: string;          // char(26), FK → users.id, NOT NULL — internal ID only, no raw contact details
  enrollmentId?: string;        // char(26), FK → enrollments.id, nullable
  studyEnrollmentId?: string;   // char(26), FK → study_enrollments.id, nullable
  body: string;                 // text, NOT NULL, max 5000 chars
  readAt?: Date;                // timestamptz, nullable
  // DB constraint: CHECK (num_nonnulls(enrollment_id, study_enrollment_id) = 1)
  // Exactly one of enrollmentId or studyEnrollmentId must be non-null.
}
```

**Indexes:**
- `INDEX` on `(enrollment_id, created_at DESC)` WHERE `enrollment_id IS NOT NULL`
- `INDEX` on `(study_enrollment_id, created_at DESC)` WHERE `study_enrollment_id IS NOT NULL`
- `INDEX` on `recipient_id`

**Constraints:**
- `CHECK (num_nonnulls(enrollment_id, study_enrollment_id) = 1)` — enforced at DB level in the migration.
- Never use a single FK column that references two different tables. Two nullable FKs + CHECK is the correct pattern.

---

### 3.11 `notifications`

**Purpose:** In-app notification records (fed by BullMQ workers).

```typescript
interface Notification extends BaseEntity {
  userId: string;       // char(26), FK → users.id, NOT NULL
  type: NotificationType; // enum, NOT NULL
  payload: object;      // jsonb, NOT NULL — type-specific payload (e.g., { programId, title })
  readAt?: Date;        // timestamptz, nullable
}
```

**Indexes:**
- `INDEX` on `(user_id, created_at DESC)`
- `INDEX` on `(user_id, read_at)` WHERE `read_at IS NULL` — unread count queries

---

### 3.12 `audit_log`

**Purpose:** Immutable record of all sensitive platform actions. No soft delete. No updates.

```typescript
interface AuditLog extends BaseEntity {
  actorId: string;      // char(26), FK → users.id, NOT NULL
  action: AuditAction;  // enum, NOT NULL
  resourceId: string;   // char(26), NOT NULL — ID of the affected resource
  resourceType: string; // text, NOT NULL — e.g. 'Enrollment', 'ConsentGrant'
  metadata?: object;    // jsonb, nullable — e.g. { reason, ipAddress, exportedFields }
}
```

**Indexes:**
- `INDEX` on `actor_id`
- `INDEX` on `(resource_type, resource_id)`
- `INDEX` on `created_at DESC`

**Constraints:** No UPDATE or DELETE operations are permitted on this table. Enforced via Postgres RLS policy (`GRANT SELECT, INSERT` only).

---

## 4. Enums

### `UserRole`

| Value | Description |
|---|---|
| `patient` | Individual registering to share health data and receive program/study matches |
| `ngo_admin` | Staff member of a verified NGO managing funding programs |
| `hmo_coordinator` | Staff member of a verified HMO looking up and managing patient care events |
| `researcher` | Academic/clinical researcher submitting IRB-approved studies |
| `platform_admin` | Internal LucenCare staff — approves orgs, programs, and studies. Cannot access patient health data. |

### `OrgType`

| Value | Description |
|---|---|
| `ngo` | Non-governmental organisation — creates funding programs, enrolls patients |
| `hmo` | Health maintenance organisation — looks up members, records care events, requests PDF exports |

### `OrgStatus`

| Value | Description |
|---|---|
| `pending_verification` | Newly registered org — cannot access patient data until approved |
| `active` | Approved by platform admin — full access per org type |
| `suspended` | Access revoked by platform admin — all coordinator/admin actions blocked |

### `ConsentPurpose`

| Value | Description |
|---|---|
| `ngo_funding` | Patient consents to share data for NGO funding program matching and enrollment |
| `clinical_research_recruitment` | Patient consents to share data for clinical study matching and researcher contact |
| `hmo_care` | Patient consents to share data with their HMO for care coordination |

### `ConsentStatus`

| Value | Description |
|---|---|
| `not_granted` | Initial state before patient takes any action |
| `pending` | Consent initiated but not yet confirmed (e.g., awaiting email verification) |
| `active` | Consent is live — data sharing is permitted for this purpose |
| `paused` | Patient temporarily halted sharing — no new data exposed, existing enrollments frozen |
| `revoked` | Terminal state — all linked enrollments are tombstoned, no re-activation possible |

### `ProgramType`

| Value | Description |
|---|---|
| `ngo_funding` | A financial or material support program created by an NGO |
| `research_study` | Reserved for future study-program hybrid types (distinct from `studies` entity) |

### `ProgramStatus`

| Value | Description |
|---|---|
| `pending_review` | Submitted, awaiting platform admin approval |
| `approved` | Live — visible in patient matching results |
| `rejected` | Declined by admin — creator notified with reason |
| `expired` | Passed `expiresAt` — treated as inactive, active enrollments tombstoned |

### `StudyStatus`

| Value | Description |
|---|---|
| `pending_review` | Submitted with IRB number, awaiting admin review |
| `approved` | Admin approved — appears in patient study recommendations |
| `active` | Researcher has begun enrolling participants |
| `completed` | Study closed — no new enrollments |
| `rejected` | Declined by admin — researcher notified with reason |

### `EnrollmentStatus`

| Value | Description |
|---|---|
| `active` | Patient is currently enrolled in the program |
| `revoked_by_patient` | Patient revoked the underlying consent — enrollment tombstoned |
| `expired` | Underlying program expired — enrollment closed automatically |

### `StudyEnrollmentStatus`

| Value | Description |
|---|---|
| `interested` | Patient expressed interest — researcher can see anonymised profile |
| `screened` | Researcher has reviewed the patient's shared data |
| `enrolled` | Patient formally enrolled into the study |
| `withdrawn` | Patient withdrew from the study |

### `CareEventType`

| Value | Description |
|---|---|
| `clinic_visit` | In-person or virtual consultation with structured SOAP-style data |
| `lab_result` | Laboratory test result with value, unit, and reference range |
| `prescription` | Drug prescribed with dosage and frequency |
| `referral` | Referral to a specialist or service |

### `NotificationType`

| Value | Description |
|---|---|
| `program_match` | A new approved program matches the patient's profile |
| `enrollment_update` | Status change on an existing enrollment |
| `consent_revoked` | Patient revoked a consent — notified orgs that their access has ended |
| `new_message` | A message received in an enrollment thread |
| `study_match` | A new approved study matches the patient's eligibility profile |
| `org_verified` | Admin has approved the org's registration |

### `AuditAction`

| Value | Description |
|---|---|
| `export` | PDF export of patient health data triggered |
| `revoke_consent` | Patient revoked a consent grant |
| `admin_approve` | Platform admin approved an org, program, or study |
| `admin_reject` | Platform admin rejected an org, program, or study |
| `login` | Successful authentication event |
| `consent_change` | Any consent status change (not just revocation) |
| `cross_org_attempt` | A request was blocked because it attempted to access another org's data |

### `TokenPurpose`

| Value | Description |
|---|---|
| `pdf_export` | JWT claim value identifying a single-use export token (stored in Redis jti, no DB entity) |
| `otp_verify` | OTP verification token for researcher registration or cross-org patient linking |

---

## 5. DTOs

All request DTOs are validated with class-validator + class-transformer via NestJS's global `ValidationPipe`. All responses are wrapped in `StandardResponse<T>`.

```typescript
// src/common/dto/response.dto.ts
interface StandardResponse<T> {
  data: T;
  meta?: {
    total?: number;
    cursor?: string;  // ULID of last item — keyset pagination
    limit?: number;
  };
  traceId: string;   // Correlation ID present on every response
}
```

### 5.1 Auth Module

**`RegisterPatientDto` (Request)**
```typescript
{
  email: string;                  // valid email
  password: string;               // min 8 chars
  name: string;
  phone: string;                  // required; plain text sent over HTTPS
  membershipNumber?: string;      // supplemental HMO identifier only
  dateOfBirth?: string;           // ISO date YYYY-MM-DD, optional
  gender?: Gender;                // optional
  address?: string;               // optional free-text full address
  conditionTags: string[];
  consentPurposes: ConsentPurpose[]; // min 1
}
```

**`ForgotPasswordDto` (Request)**
```typescript
{ email: string; }
```

**`ResetPasswordDto` (Request)**
```typescript
{
  token: string;    // 64-char hex token from the reset email link
  password: string; // min 8 chars
}
```

**`RegisterOrgDto` (Request)**
```typescript
{
  email: string;
  password: string;               // min 8 chars
  orgName: string;
  orgType: OrgType;
  contactEmail: string;
  role: 'ngo_admin' | 'hmo_coordinator';
}
```

**`RegisterResearcherDto` (Request)**
```typescript
{
  email: string;                  // Institutional domain validated server-side
  password: string;               // min 8 chars
  institutionName: string;
  otpCode: string;                // exactly 6 chars
}
```

**`LoginDto` (Request)**
```typescript
{
  email: string;
  password: string;
}
```

**Auth Response — `POST /auth/login`, `POST /auth/register/*`**
```typescript
{
  data: {
    accessToken: string;          // JWT RS256, 15-min expiry
    user: {
      id: string;
      email: string;
      role: UserRole;
      orgId?: string;
    };
  };
  // Refresh token is set as httpOnly cookie — not in body
}
```

---

### 5.2 Patients Module

**`CreatePatientDto` (Request) — used internally by auth service on patient register**
```typescript
{
  name: string;
  phone: string;                  // required
  membershipNumber?: string;      // supplemental HMO identifier
  dateOfBirth?: string;           // ISO date YYYY-MM-DD
  gender?: Gender;
  address?: string;
  conditionTags: string[];
  medicationList?: Array<{
    name: string;
    rxnormCode?: string;
    dosage?: string;
    frequency?: string;
  }>;
  // hmoId: NEVER from body — always from JWT
}
```

**`UpdatePatientDto` (Request)**
```typescript
{
  name?: string;
  phone?: string;
  conditionTags?: string[];
  dateOfBirth?: string;
  gender?: Gender;
  address?: string;
  medicationList?: Array<{ name: string; rxnormCode?: string; dosage?: string; frequency?: string }>;
  directContactShared?: boolean;
}
```

**`LookupPatientDto` (Request) — HMO coordinator only**
```typescript
{
  phone?: string;
  membershipNumber?: string;
  // At least one must be present. Searches globally — no hmo_id filter.
  // Patient must have active HMO_CARE consent to be returned.
}
```

**Patient Response Shape**
```typescript
{
  data: {
    id: string;
    name: string;
    phone: string;                // returned to patient (own profile) and hmo_coordinator
    conditionTags: string[];
    dateOfBirth?: string;
    gender?: Gender;
    address?: string;
    membershipNumber?: string;    // returned to HMO coordinator only
    hmoId?: string;
    directContactShared: boolean;
    createdAt: string;
  };
}
```

**`CreateCareEventDto` (Request)**
```typescript
{
  type: CareEventType;
  eventDate: string;              // ISO date string — coerced to Date
  providerName?: string;          // free-text, max 200 chars — e.g. 'Dr. Adeyemi', 'Lagos Island General Hospital'
  structured: Record<string, any>;
  notes?: string;                 // max 2000 chars
}
```

**CareEvent Response Shape**
```typescript
{
  data: {
    id: string;
    patientId: string;
    type: CareEventType;
    eventDate: string;
    providerName?: string;
    structured: Record<string, any>;
    notes?: string;
    createdAt: string;
    createdBy?: string;
  };
}
```

---

### 5.3 Consents Module

**`CreateConsentGrantDto` (Request)**
```typescript
{
  purpose: ConsentPurpose;
  dataScopes: string[];           // min 1 — e.g. ['name', 'conditionTags']
}
```

**`UpdateConsentDto` (Request)**
```typescript
{
  status: ConsentStatus;
  // State machine transition is validated in ConsentService.transition()
}
```

**ConsentGrant Response Shape**
```typescript
{
  data: {
    id: string;
    patientId: string;
    purpose: ConsentPurpose;
    dataScopes: string[];
    status: ConsentStatus;
    grantedAt: string;
    revokedAt?: string;
  };
}
```

**Consent Impact Response — `GET /consents/:id/impact`**
```typescript
{
  data: {
    affectedEnrollments: Array<{
      id: string;
      programId: string;
      programTitle: string;
      status: EnrollmentStatus;
    }>;
    count: number;
  };
}
```

---

### 5.4 Programs Module

**`CreateProgramDto` (Request)**
```typescript
{
  title: string;
  type: ProgramType;
  eligibilityCriteria: Array<{
    field: string;                // e.g. 'conditionTags', 'locationState'
    operator: 'eq' | 'in' | 'gte' | 'lte' | 'contains';
    value: any;
  }>;
  expiresAt: string;             // ISO datetime string
  // orgId: NEVER from body — from JWT
}
```

**Program Response Shape**
```typescript
{
  data: {
    id: string;
    orgId: string;
    title: string;
    type: ProgramType;
    status: ProgramStatus;
    eligibilityCriteria: object[];
    expiresAt: string;
    createdAt: string;
  };
}
```

**Program Match Preview Response — `GET /programs/:id/matches`**
```typescript
{
  data: {
    eligibleCount: number;        // Aggregate only — NO patient IDs
    tagSummary: Record<string, number>; // e.g. { diabetes: 45, hypertension: 30 }
  };
}
```

---

### 5.5 Studies Module

**`CreateStudyDto` (Request)**
```typescript
{
  title: string;
  irbNumber: string;             // Validated against /^IRB-\d{4}-\d{4}$/ (adjust per institution)
  eligibilityCriteria: Array<{ field: string; operator: string; value: any }>;
  infoSheetUrl: string;          // URL — S3 pre-signed or CDN URL
  targetCount: number;           // positive integer
  compensationDetails?: string;
}
```

**`InviteParticipantDto` (Request)**
```typescript
{
  studyEnrollmentId: string;     // ULID — the interested patient to formally invite
}
```

**Study Response Shape**
```typescript
{
  data: {
    id: string;
    researcherId: string;
    title: string;
    irbNumber: string;
    status: StudyStatus;
    targetCount: number;
    compensationDetails?: string;
    createdAt: string;
  };
}
```

---

### 5.6 Enrollments Module

**`CreateEnrollmentDto` (Request)**
```typescript
{
  programId: string;             // ULID
  // patientId: NEVER from body — always from JWT sub claim
}
```

**`CreateStudyEnrollmentDto` (Request)**
```typescript
{
  studyId: string;               // ULID
  shareDirectContact?: boolean;  // default false — explicit patient action only
}
```

**Enrollment Response Shape**
```typescript
{
  data: {
    id: string;
    patientId: string;
    programId: string;
    status: EnrollmentStatus;
    sharedDataSnapshot: Record<string, any>; // consented fields only
    createdAt: string;
  };
}
```

---

### 5.7 Messages Module

**`SendMessageDto` (Request)**
```typescript
{
  enrollmentId?: string;         // ULID — for NGO program enrollment threads
  studyEnrollmentId?: string;    // ULID — for study enrollment threads
  body: string;                  // min 1, max 5000 chars
  // Refinement: exactly one of enrollmentId or studyEnrollmentId must be present
}
```

**Message Response Shape**
```typescript
{
  data: {
    id: string;
    senderId: string;
    recipientId: string;
    enrollmentId?: string;
    studyEnrollmentId?: string;
    body: string;
    readAt?: string;
    createdAt: string;
  };
}
```

---

### 5.8 Export Module

**`CreateTokenDto` (Request) — HMO coordinator only**
```typescript
{
  purpose: TokenPurpose;         // 'pdf_export'
  patientId: string;             // ULID — must be within coordinator's org scope
  ttl: number;                   // seconds, min 30, max 120
}
```

**Export Token Response**
```typescript
{
  data: {
    token: string;               // signed JWT — single-use, jti stored in Redis
    expiresIn: number;           // TTL in seconds
  };
}
```

---

### 5.9 Admin Module

**`AdminApproveDto` (Request)**
```typescript
{
  status: 'approved' | 'rejected';
  reason?: string;               // Required when status is 'rejected'
}
```

---

### 5.10 Common DTOs

**`PaginationDto` (Request query params)**
```typescript
{
  cursor?: string;               // ULID of last seen item — keyset pagination
  limit?: number;                // default 20, min 1, max 50
}
```

---

## 6. Module Breakdown

### `AuthModule`
**Owns:** `User` entity, login/registration logic, JWT issuance, token refresh, OTP sending.  
**Responsibilities:**
- Register patients (atomically: `users` + `patients` + `consent_grants`)
- Register org admins/coordinators (creates `users` and pending `organizations` rows)
- Register researchers (validates institutional email, verifies OTP)
- Issue access tokens (RS256 JWT, 15 min)
- Manage refresh tokens (httpOnly cookie, 7 days) with Redis-backed revocation (`refresh:revoked:{jti}`)
- On logout: add refresh `jti` to Redis revocation set with remaining TTL
- On token refresh: check `jti` against revocation set before issuing new tokens
- Trigger `send_otp` queue job on researcher registration
- Forgot password: generate reset token, store in Redis (`reset:{token}` → userId, TTL 1h), trigger `send_reset_password` mail job
- Reset password: consume reset token atomically via `redis.getdel`, update `password_hash`

**Does NOT own:** consent creation beyond initial registration; patient health data.

---

### `PatientsModule`
**Owns:** `Patient` entity, `CareEvent` entity.  
**Responsibilities:**
- Patient self-profile read/update (`GET /patients/me`)
- HMO coordinator patient lookup by `phoneHash` or `membershipNumber` (org-scoped)
- HMO coordinator care event creation and retrieval (org-scoped)
- Patient summary endpoint — validates export JWT before returning snapshot data

**Enforcement:** `hmoId` on patient records is ALWAYS set from `req.user.orgId`. Coordinators can only query patients where `hmo_id = req.user.orgId`.

---

### `OrganizationsModule`
**Owns:** `Organization` entity.  
**Responsibilities:**
- Create organization on org staff registration
- Read org details
- Status is updated by `AdminModule` — `OrganizationsModule` exposes the service method

---

### `ConsentsModule`
**Owns:** `ConsentGrant` entity, consent state machine.  
**Responsibilities:**
- Patient grant creation (initial or additional purpose)
- State machine transitions with validation (`ConsentService.transition()`)
- Revocation with cascade: tombstone linked enrollments + enqueue `consent_revoked` job
- Impact preview before revocation (`GET /consents/:id/impact`)
- Consent existence check for `EnrollmentsModule` (`hasActiveGrant()`)

---

### `ProgramsModule`
**Owns:** `Program` entity.  
**Responsibilities:**
- NGO creates programs (org-scoped, status starts at `pending_review`)
- List programs by org
- Trigger `program_review` queue job on creation
- Expose program match preview (aggregate only, via `MatchingService`)
- Fan-out notify endpoint (enqueues `fan_out_notify` job)

---

### `StudiesModule`
**Owns:** `Study` entity.  
**Responsibilities:**
- Researcher submits studies (triggers `study_review` job)
- List studies by researcher
- Researcher views their study enrollments

---

### `EnrollmentsModule`
**Owns:** `Enrollment` entity, `StudyEnrollment` entity.  
**Responsibilities:**
- Patient self-enrolls in an approved program (checks active consent first)
- Patient expresses interest in a study
- Researcher invites an interested patient (advances `StudyEnrollmentStatus`)
- Enrollment revocation cascade (called by `ConsentsModule` on revoke)
- Building `sharedDataSnapshot` from active consent scopes at enrollment time

---

### `MatchingModule`
**Owns:** Matching logic only — no entities.  
**Responsibilities:**
- JSONB eligibility engine — `findPrograms()` and `findStudies()` for patient recommendations
- Pre-indexing eligible patient counts on program/study approval (`indexProgram()`, `indexStudy()`)
- Paginated eligible patient ID fetch for fan-out workers — internal only, never via API

---

### `NotificationsModule`
**Owns:** `Notification` entity.  
**Responsibilities:**
- BullMQ producer — enqueue single and batch notification jobs
- Patient reads their notifications (`GET /notifications/me`)
- `NotificationsGateway` — pushes real-time notification via WebSocket after DB insert

---

### `MessagesModule`
**Owns:** `Message` entity.  
**Responsibilities:**
- Send message within an enrollment thread
- Retrieve thread messages (participants only)
- Mark messages read

---

### `ExportModule`
**Owns:** Export token logic (Redis), PDF generation.  
**Responsibilities:**
- `ExportTokenService` — generate single-use JWT with Redis jti enforcement
- `ExportService` — build PDF from consented fields, write mandatory `audit_log` entry
- Token validation on patient summary endpoint (`GET /patients/:id/summary`)

---

### `AuditModule`
**Owns:** `AuditLog` entity.  
**Responsibilities:**
- Write-only `AuditService.log()` method called by other services
- No public read API in V1 (admin audit viewer is a future feature)

---

### `AdminModule`
**Owns:** Admin review logic — no entities.  
**Responsibilities:**
- Approve/reject orgs, programs, and studies
- On approval: enqueue appropriate notification job + trigger `MatchingService.index*()`
- On rejection: notify creator with reason
- All actions write to `audit_log`

---

### `QueuesModule`
**Owns:** BullMQ queue definitions, all processors.  
**Responsibilities:**
- Register all queues: `notifications`, `admin`, `mail`
- Run fan-out, batch notify, consent revocation, org verification, program/study review, OTP processors

---

### `ChatGateway` (in `gateways/`)
**Status: V2 — deferred. Do not implement in V1.**

The AI chat feature (per-patient LLM streaming with encrypted history) is explicitly out of scope for V1. The file `gateways/chat.gateway.ts` exists as a placeholder only and must not contain business logic. Key management for per-patient encryption was unresolved and is a security-critical prerequisite before this feature can be designed. V2 will require a formal key management spec (KMS or Vault) before any implementation begins.

---

## 7. API Contract

All routes prefixed with `/api/v1`. All responses are `StandardResponse<T>`.  
Auth column: `—` = public, `JWT` = any valid token, role name = specific role required.

### 7.1 Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/register/patient | — | Register patient + initial consents (atomic) |
| POST | /auth/register/org | — | Register org staff + pending org |
| POST | /auth/register/researcher | — | Register researcher (OTP required) |
| POST | /auth/login | — | Login, returns access token + refresh cookie |
| POST | /auth/refresh | Refresh Cookie | Rotate access + refresh tokens |
| POST | /auth/logout | JWT | Clear refresh cookie |
| POST | /auth/forgot-password | — | Request password reset email |
| POST | /auth/reset-password | — | Complete password reset with token |

---

### 7.2 Patients

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /patients/me | `patient` | Get own profile |
| PATCH | /patients/me | `patient` | Update own profile |
| GET | /patients/lookup | `hmo_coordinator` | Lookup patient by phone or membershipNumber (global, requires HMO_CARE consent) |
| POST | /patients | `hmo_coordinator` | Create patient record (sets hmoId from JWT) |
| POST | /patients/:id/link-request | `hmo_coordinator` | Send a link request to a self-registered patient (patient must approve) |
| GET | /patients/me/link-requests | `patient` | List own link requests (filter by status) |
| PATCH | /patients/me/link-requests/:requestId | `patient` | Approve or reject a pending link request |
| GET | /patients/:id | `hmo_coordinator` | Get patient detail (org-scoped) |
| GET | /patients/:id/events | `hmo_coordinator` | List care events — paginated (org-scoped) |
| POST | /patients/:id/events | `hmo_coordinator` | Add care event (org-scoped) |
| GET | /patients/:id/summary | `hmo_coordinator` | Get patient PDF summary — requires valid export JWT in `Authorization: Bearer` header |

**Request/Response — `GET /patients/lookup`:**
```
Query: ?phoneHash=<sha256> OR ?membershipNumber=<string>
Response: StandardResponse<Patient>
```

**Request/Response — `GET /patients/:id/events`:**
```
Query: ?cursor=<ULID>&limit=20&type=<CareEventType>
Response: StandardResponse<CareEvent[]> + meta.cursor
```

---

### 7.3 Consents

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /consents/me | `patient` | List all consent grants for current patient |
| POST | /consents | `patient` | Create a new consent grant |
| PATCH | /consents/:id | `patient` | Transition consent status (owner-scoped) |
| GET | /consents/:id/impact | `patient` | Preview which enrollments will be affected by revocation |

---

### 7.4 Programs

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /programs | `ngo_admin` | Create program (org-scoped, triggers review job) |
| GET | /organizations/:id/programs | `ngo_admin` | List programs for org (org-scoped) |
| GET | /programs/:id/matches | `ngo_admin` | Aggregate match preview — count + tag summary (org-scoped) |
| GET | /programs/:id/enrollments | `ngo_admin` | List enrollments — returns snapshots only (org-scoped) |
| POST | /programs/:id/notify | `ngo_admin` | Trigger fan-out notification to eligible patients (org-scoped) |

**Response — `GET /programs/:id/enrollments`:**
```typescript
{
  data: Array<{
    id: string;
    status: EnrollmentStatus;
    sharedDataSnapshot: Record<string, any>; // consented fields only — no patient ID exposed
    createdAt: string;
  }>;
  meta: { cursor?: string; limit: number };
}
```

---

### 7.5 Studies

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /studies | `researcher` | Submit study for review |
| GET | /researchers/:id/studies | `researcher` | List own studies (owner-scoped) |
| GET | /studies/:id/enrollments | `researcher` | List study enrollments (owner-scoped) |
| POST | /study-enrollments/:id/invite | `researcher` | Advance enrollment to `screened` or `enrolled` |

---

### 7.6 Enrollments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /enrollments | `patient` | Self-enroll in an approved program |
| GET | /enrollments/:id | `patient` | View own enrollment |
| POST | /study-enrollments | `patient` | Express interest in a study |

---

### 7.7 Recommendations

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /recommendations/funding | `patient` | List approved programs matching patient profile (consent check in SQL) |
| GET | /recommendations/studies | `patient` | List approved studies matching patient profile (consent check in SQL) |

**Response — both recommendations endpoints:**
```typescript
{
  data: Array<{
    id: string;
    title: string;
    type: ProgramType | StudyStatus;
    eligibilityCriteria: object[];
    expiresAt?: string;
    compensationDetails?: string;
  }>;
  meta: { cursor?: string; limit: number };
}
```

---

### 7.8 Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /messages | `ngo_admin`, `researcher` | Send a message in an enrollment thread |
| GET | /messages/:enrollmentId | `ngo_admin`, `researcher`, `patient` | Read thread — participants only |

---

### 7.9 Export

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /tokens | `hmo_coordinator` | Generate single-use PDF export token (Redis jti) |

---

### 7.10 Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /notifications/me | JWT (any role) | List own notifications — paginated |
| PATCH | /notifications/:id/read | JWT (any role) | Mark notification as read |

---

### 7.11 Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | /admin/programs/:id | `platform_admin` | Approve or reject a program |
| PATCH | /admin/studies/:id | `platform_admin` | Approve or reject a study |
| PATCH | /admin/organizations/:id | `platform_admin` | Approve or reject an org registration |

---

### 7.12 Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | — | DB + Redis + S3 liveness check |

---

## 8. Business Rules & Constraints

### 8.1 Registration & Identity

| # | Rule |
|---|---|
| R-01 | Patient registration is a **single atomic transaction**: `users` row + `patients` row + one `consent_grant` per requested purpose. Any failure rolls back entirely. |
| R-02 | Phone numbers are transmitted as plain text over HTTPS and stored as plain text. Access is protected at the API layer by JWT auth guards (patients see their own; HMO coordinators see linked patients). Phone is not a credential — hashing is not required. |
| R-03 | A researcher's institutional email domain must be validated server-side against a whitelist or MX record check. |
| R-04 | An org registration creates both a `users` row and an `organizations` row. The org starts in `pending_verification` and the user in `pending` status. Neither can take org-scoped actions until admin approves. |

### 8.2 Authorisation & Scope

| # | Rule |
|---|---|
| A-01 | `orgId` and `hmoId` are **never accepted from the request body**. They are always read from `req.user.orgId` (JWT claim). |
| A-02 | HMO coordinators can look up patients globally via `GET /patients/lookup` only if the patient has an active `HMO_CARE` consent grant. All other patient endpoints (`GET /patients/:id`, care events, summary) enforce `patients.hmo_id = req.user.orgId`. |
| A-03 | NGO admins can only access programs where `programs.org_id = req.user.orgId`. |
| A-04 | Researchers can only access studies where `studies.researcher_id = req.user.sub`. |
| A-05 | Patients can only access their own consents, enrollments, and notifications. |
| A-06 | Postgres RLS is the **hard boundary**. `SET LOCAL app.org_id = $orgId` must be called **inside every database transaction** that touches org-scoped tables: `await manager.query('SET LOCAL app.org_id = $1', [orgId])`. `SET LOCAL` resets automatically when the transaction ends — safe with connection pools. **Never use `SET` without `LOCAL`** — that persists for the full connection lifetime and will contaminate subsequent requests from the same pool connection. |
| A-07 | Cross-org access attempts are blocked and written to `audit_log` with action `CROSS_ORG_ATTEMPT`. |
| A-08 | Patient-owned tables (`consent_grants`, `enrollments`, `study_enrollments`, `care_events`) have a **parallel patient-scoped RLS policy** controlled by `SET LOCAL app.user_id = $patientId`. This runs alongside the org-scoped policy. A compromised patient JWT cannot access another patient's records even if the org-scope check passes. |
| A-09 | `platform_admin` access to patient health data is blocked at two layers: (1) the `OrgScopeGuard` rejects requests from `platform_admin` users targeting patient-scoped routes; (2) the admin DB session uses a `lucencare_admin` Postgres role that is excluded from patient-data RLS policies. No `app.org_id` value is ever set for admin sessions targeting patient data. |

### 8.3 Consent & Data Sharing

| # | Rule |
|---|---|
| C-01 | A patient must have an `ACTIVE` consent grant for the relevant `ConsentPurpose` before any enrollment is created. |
| C-02 | Consent revocation is **atomic**: update `consent_grants.status`, tombstone all linked `enrollments`, insert `audit_log` row, enqueue `consent_revoked` job. One transaction — partial execution is not acceptable. |
| C-03 | Consent state machine transitions are strictly enforced: no skipping states, no exiting `REVOKED`. |
| C-04 | `sharedDataSnapshot` on `enrollments` is a **point-in-time copy** of only consented fields, captured at enrollment time. Orgs always read from this snapshot — never from a live join to `patients`. |
| C-05 | `directContactShared` on `study_enrollments` defaults to `false` and requires an **explicit patient boolean** set to `true`. It is never inferred from any other action. |
| C-06 | The mapping from `ConsentPurpose` to the patient fields included in `sharedDataSnapshot` is the **single source of truth** defined in `src/common/constants/snapshot-fields.ts`. No service may define its own field list. The canonical mapping is: `ngo_funding → ['name', 'conditionTags', 'address', 'directContactShared']` · `hmo_care → ['name', 'conditionTags', 'address', 'membershipNumber', 'medicationList']` · `clinical_research_recruitment → ['name', 'conditionTags', 'address', 'directContactShared', 'medicationList']`. |

### 8.4 Matching & Privacy

| # | Rule |
|---|---|
| M-01 | `GET /programs/:id/matches` returns **aggregate counts and tag summaries only**. Patient IDs must never appear in any API response. |
| M-02 | `MatchingService.getEligiblePatientIds()` is called **only inside BullMQ workers**. It is never exposed via any HTTP endpoint. |
| M-03 | The consent existence check for `/recommendations/*` must be a SQL `EXISTS` subquery — not a JS `.filter()` applied after fetching. A post-fetch filter can silently fail and expose records. |

### 8.5 Notifications (Fan-out)

| # | Rule |
|---|---|
| N-01 | `POST /programs/:id/notify` enqueues **one `fan_out_notify` coordinator job** — not one job per patient. |
| N-02 | The fan-out coordinator pages eligible patients in chunks of 200 and enqueues **one `batch_notify` job per chunk**. |
| N-03 | Each `batch_notify` job performs **one bulk `INSERT`** into `notifications` for all patient IDs in the batch. |

### 8.6 Export & Audit

| # | Rule |
|---|---|
| E-01 | Export tokens are single-use. `redis.getdel()` provides atomic check-and-delete. A replayed token is rejected. |
| E-02 | `ExportService.buildPdf()` **always** writes an `audit_log` row. An export that produces no audit record is a bug. |
| E-03 | All sensitive actions (export, revocation, admin decisions, cross-org attempts, logins) are written to `audit_log` before the response is returned. |
| E-04 | The `audit_log` table is INSERT-only at the Postgres RLS level. No application code may UPDATE or DELETE audit records. |
| E-05 | Refresh tokens are revocable. On `POST /auth/logout`, the refresh token `jti` is written to a Redis key `refresh:revoked:{jti}` with TTL equal to the token's remaining lifetime. On every `POST /auth/refresh`, the `jti` is checked against this key before issuing new tokens. A revoked `jti` returns 401. No DB entity is created — Redis TTL ensures automatic cleanup. |

### 8.7 Edge Cases

| # | Edge Case | Behaviour |
|---|---|---|
| EC-01 | Patient revokes consent while an enrollment is mid-creation | The `PATCH /consents/:id` transaction tombstones enrollments. The in-flight `POST /enrollments` will fail its consent check and return 409. |
| EC-02 | Fan-out job runs on a program with 0 eligible patients | No batch jobs enqueued. Coordinator job completes silently. |
| EC-03 | Export token used twice | First use succeeds (`getdel` returns `"1"`). Second use: `getdel` returns `null` → `UnauthorizedException`. |
| EC-04 | Researcher submits a study with a duplicate IRB number | Handled at service layer: query for existing non-rejected study with same `irb_number`. Return 409 if found. |
| EC-05 | Org suspended while patients are enrolled in its programs | Enrollment records remain (historical). New enrollments are blocked. Org staff JWT is rejected by role guard. |

---

## 9. Inter-module Dependencies

The table below shows which modules **call into** other modules' services. An arrow `A → B` means module A imports and injects a service from module B.

| Module | Depends On | Reason |
|---|---|---|
| `AuthModule` | `PatientsModule`, `ConsentsModule`, `QueuesModule` | Atomic patient registration creates patient + consent records; sends OTP via queue |
| `PatientsModule` | `ExportModule`, `AuditModule` | Validates export token before returning summary; logs export actions |
| `ConsentsModule` | `EnrollmentsModule`, `AuditModule`, `QueuesModule` | Revocation tombstones enrollments; writes audit; enqueues revocation event |
| `EnrollmentsModule` | `ConsentsModule`, `PatientsModule` | Checks active grant before creating enrollment; builds snapshot from patient data |
| `ProgramsModule` | `MatchingModule`, `AuditModule`, `QueuesModule` | Match preview uses MatchingService; notify enqueues fan-out job |
| `StudiesModule` | `MatchingModule`, `QueuesModule` | Match preview; triggers review job |
| `AdminModule` | `OrganizationsModule`, `ProgramsModule`, `StudiesModule`, `MatchingModule`, `AuditModule`, `QueuesModule` | Updates status across entities; triggers indexing and notifications |
| `MatchingModule` | `ProgramsModule`, `StudiesModule`, `ConsentsModule` | Reads eligibility criteria; joins consent check in SQL |
| `NotificationsModule` | `QueuesModule` | Produces jobs; no direct service injection needed beyond queue |
| `MessagesModule` | `EnrollmentsModule` | Validates sender and recipient are participants of the enrollment |
| `ExportModule` | `AuditModule` | Every export writes an audit record |
| `QueuesModule` | `MatchingModule`, `NotificationsModule`, `AuditModule` | Processors inject these services |

**Dependency diagram (simplified):**

```
AuthModule
  └─→ PatientsModule ←─ EnrollmentsModule ←─ ConsentsModule
  └─→ ConsentsModule                              └─→ AuditModule
  └─→ QueuesModule ←────────────────────────────────── ProgramsModule
                                                    └─→ MatchingModule
AdminModule ─→ MatchingModule
           ─→ AuditModule
           ─→ QueuesModule
ExportModule ─→ AuditModule
```

---

## 10. Non-functional Requirements

### 10.1 Pagination

- All list endpoints use **keyset (cursor) pagination** — not offset pagination.
- Cursor is the ULID of the last item in the previous page.
- Default page size: `20`. Maximum: `50`.
- Response includes `meta.cursor` (next page cursor) and `meta.limit`.
- ULIDs are sortable by time, so `WHERE id > $cursor ORDER BY id ASC LIMIT $limit` is the standard query pattern.
- Total count (`meta.total`) is only included on endpoints where it is cheap to compute (e.g., notification unread count). It is omitted from paginated lists to avoid COUNT(*) scans.

### 10.2 Error Handling

All errors are returned as [RFC 7807 Problem Detail](https://datatracker.ietf.org/doc/html/rfc7807):

```typescript
// HTTP error response shape
{
  type: string;       // e.g. "https://lucencare.io/errors/not-found"
  title: string;      // e.g. "Resource Not Found"
  status: number;     // HTTP status code
  detail: string;     // Human-readable message
  traceId: string;    // Correlation ID — matches the request's traceId
  errors?: Array<{    // Present on 422 Unprocessable Entity (validation failures)
    path: string;
    message: string;
  }>;
}
```

**Standard HTTP status codes:**

| Code | When |
|---|---|
| 400 | Malformed request body (not parseable) |
| 401 | Missing or expired JWT |
| 403 | Valid JWT but insufficient role or org scope violation |
| 404 | Resource does not exist or is soft-deleted |
| 409 | Conflict — e.g. duplicate active consent, duplicate enrollment |
| 422 | Validation failure (class-validator) — includes `errors` array |
| 429 | Rate limit exceeded |
| 500 | Unhandled server error — detail is generic, full error in logs |

### 10.3 Logging Standards

- All logs are structured JSON via `nestjs-pino`.
- Every request generates a `traceId` (UUID v4) in `ClsService` at the start of the request lifecycle.
- `traceId` is attached to every log line and every HTTP response.
- Log levels: `error` for thrown exceptions, `warn` for auth failures and cross-org attempts, `info` for audit-worthy actions, `debug` for service internals (disabled in production).
- Sensitive fields are **never logged**: `passwordHash`, patient `phone`, JWT payloads, `sharedDataSnapshot`.

### 10.4 Rate Limiting

**Implementation:** `@nestjs/throttler` with `nestjs-throttler-storage-redis` as the Redis storage adapter. **Fixed window** strategy for V1 — simple, predictable, and sufficient at this scale.

**Setup:** `ThrottlerModule.forRootAsync()` configured globally in `AppModule` with the Redis connection. `ThrottlerGuard` applied globally. Individual controllers or routes override limits with the `@Throttle()` decorator.

| Endpoint group | Limit | Key |
|---|---|---|
| `/auth/login`, `/auth/register/*` | 10 req / 60 s | IP address |
| OTP endpoints | 3 req / 300 s | `userId` |
| `/tokens` (export) | 5 req / 60 s | `orgId` |
| All other endpoints | 60 req / 60 s | `userId` |

### 10.5 Health Checks

`GET /health` returns a `@nestjs/terminus` health report covering:
- PostgreSQL: connection pool liveness
- Redis: ping
- S3: `HeadBucket` check

### 10.6 Security Headers

All responses include:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy: default-src 'none'
```

### 10.7 Database Migrations

- Migrations are managed via TypeORM CLI (`typeorm migration:generate`, `migration:run`).
- No `synchronize: true` in any environment — schema changes are explicit migrations only.
- Each migration file is timestamped and checked into version control.
- Migrations are run as part of the deployment pipeline before the app starts.

---

---

## 11. Scaffold Implementation Notes

These are known decisions made during initial scaffolding. Each implementer must read this section before writing any module code.

### 11.1 CLI DataSource vs. Application DataSource

`src/database/data-source.ts` is used exclusively by the TypeORM CLI. It calls `dotenv.config()` directly because it runs outside the NestJS container. The application uses `database.config.ts` via `ConfigService`. Keep `entities:` and `migrations:` glob patterns in both files in sync — desynchronisation silently breaks migration generation.

### 11.2 HealthModule

NestJS requires every controller to be registered in a module's `controllers[]`. Both `health.module.ts` and `health.controller.ts` are required in `src/health/`. `AppModule` imports `HealthModule`. Do not register `HealthController` directly in `AppModule.controllers`.

### 11.3 TransformInterceptor CLS Gap

`TransformInterceptor` is currently instantiated with `new TransformInterceptor()` in `main.ts`. This bypasses NestJS DI — `ClsService` is never injected, so `traceId` falls back to `crypto.randomUUID()` per response instead of the CLS request-scoped trace ID. Fix: change to `app.get(TransformInterceptor)` and add `TransformInterceptor` to `AppModule.providers`.

### 11.4 BullMQ Three-Queue Architecture

Multiple processors share a queue and filter on `job.name`. Three queues (`notifications`, `admin`, `mail`) serve all nine processors. Adding a fourth queue requires evaluating Redis memory and worker thread impact — do not add queues ad hoc.

### 11.5 StudyEnrollmentsController Actor-Ownership Split

Patient action (`POST /study-enrollments`) lives in `EnrollmentsModule`; researcher action (`POST /study-enrollments/:id/invite`) lives in `StudiesModule`. This preserves actor-ownership boundaries and avoids a circular import between the two modules.

### 11.6 PassportModule Deferred

`JwtAuthGuard` extends `AuthGuard('jwt')` but `PassportModule`, `passport-jwt`, and `JwtStrategy` are not yet added. These are deferred because the JWT payload shape and claim structure must be finalised first. When implementing: add `@nestjs/passport ^10.0.3`, `passport ^0.7.0`, `passport-jwt ^4.0.1` and create `src/modules/auth/strategies/jwt.strategy.ts`.

### 11.7 `common/constants/` Privacy Boundary

`src/common/constants/snapshot-fields.ts` has zero imports from other `src/` paths (only `src/common/enums`). This makes it safe to import from any module without creating circular dependencies. No service may define its own `ConsentPurpose → fields` mapping — this file is the single source of truth.

---

*LucenCare Healthtech Platform — Architecture V1*  
*NestJS 11 · TypeScript · PostgreSQL 17 · Redis · BullMQ · ULID*
