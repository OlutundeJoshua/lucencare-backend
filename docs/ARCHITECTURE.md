# LucenCare — Backend Architecture V1.1

> **Stack:** NestJS 11 · TypeScript · PostgreSQL 17 · Redis · BullMQ · JWT RS256 · TypeORM · ULID
> **Last updated:** 2026-07-01

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
11. [Scaffold Implementation Notes](#11-scaffold-implementation-notes)

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
| `hmo_coordinator` | Looks up patients by membership number or phone, creates care events, requests export tokens. |
| `researcher` | Registers with institutional email + OTP, submits studies for review, invites interested patients. |
| `professional` | Healthcare professional (doctor, nurse, therapist) who applies for care coordination access. Requires admin approval. |
| `benefactor` | Individual supporter/donor who applies to support patients. Requires admin approval. |
| `platform_admin` | Approves/rejects orgs, programs, studies, and professional/benefactor applications. Has no access to patient health data. |

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
| Realtime | WebSocket | `@nestjs/websockets` — live notification push |
| Storage | S3-compatible | PDF exports, study information sheets |
| Validation | class-validator + class-transformer | NestJS global `ValidationPipe` |
| API Docs | `@nestjs/swagger` | OpenAPI 3 — served at `/api/docs` (non-production) |
| Async Context | `nestjs-cls` | Carries `userId` for automatic `createdBy`/`updatedBy` tracking |
| Logging | `nestjs-pino` | Structured JSON logs with trace IDs |
| Health Checks | `@nestjs/terminus` | DB + Redis + S3 liveness probes |
| Rate Limiting | `@nestjs/throttler` + `nestjs-throttler-storage-redis` | Fixed window, Redis-backed |

### 1.5 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        API Gateway  (:3000)                          │
│         JWT RS256 · RLS · OrgScopeGuard · global ValidationPipe      │
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
   │  Notifications · Audit · Admin · Applications   │
   └──────────┬──────────────────────┬────────────────┘
              │ TypeORM              │ BullMQ Jobs
   ┌──────────▼──────┐   ┌──────────▼──────────────────┐
   │  PostgreSQL 17  │   │  Redis                       │
   │  (RLS enabled)  │   │  · BullMQ queues             │
   │                 │   │  · OTP keys (otp:{userId})   │
   └─────────────────┘   │  · Export jti keys           │
                         │  · Refresh revocation        │
                         │  · Match count cache         │
                         └───────────────────────────────┘
```

### 1.6 Two-Phase Registration Flow

All roles except `researcher` use a two-phase registration to match the frontend onboarding UX:

```
Phase 1 — POST /api/auth/signup
  { name, email, password, role }
  → creates User + skeleton entity (empty Patient or org stub)
  → returns { accessToken (15m), user } + httpOnly refresh cookie (7d)

Phase 2 — POST /api/auth/onboarding/:role  [Bearer required]
  → patient:     updates Patient fields + upserts ConsentGrant rows
  → ngo/hmo:     updates Organization; queues ORG_VERIFICATION_JOB
  → professional/benefactor: creates Application record

Researcher (exception) — OTP flow:
  POST /auth/request-otp → email OTP → POST /auth/register/researcher
```

---

## 2. Folder Structure

```
src/
├── common/
│   ├── entities/base.entity.ts
│   ├── subscribers/entity-actor.subscriber.ts
│   ├── enums/index.ts
│   ├── constants/snapshot-fields.ts
│   ├── guards/
│   ├── decorators/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   └── dto/
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
│   ├── community/                      # Communities, posts, comments, reactions, moderation
│   ├── admin/
│   └── applications/
├── queues/
├── gateways/
├── config/
├── database/
│   ├── migrations/
│   └── seeds/
├── health/
└── main.ts
```

---

## 3. Database Entities

All entities extend `BaseEntity`:

```typescript
abstract class BaseEntity {
  id: string;           // ULID, PK, char(26), NOT NULL
  createdAt: Date;      // timestamptz, NOT NULL, default NOW()
  updatedAt: Date;      // timestamptz, NOT NULL, auto-updated
  deletedAt?: Date;     // timestamptz, nullable — soft delete
  createdBy?: string;   // char(26), FK → users.id
  updatedBy?: string;   // char(26), FK → users.id
}
```

---

### 3.1 `users`

```typescript
interface User extends BaseEntity {
  role: UserRole;
  orgId?: string;           // char(26), nullable (null for patients/researchers/professionals/benefactors)
  email: string;            // UNIQUE, NOT NULL
  passwordHash: string;     // bcrypt cost 12
  status: string;           // 'pending' | 'active' | 'suspended' — default 'pending'
  institutionId?: string;   // nullable — researcher institution (future entity)
}
```

Indexes: `UNIQUE` on `email`, `INDEX` on `org_id`, `INDEX` on `role`.

Constraints:
- `orgId` non-null when `role` is `ngo_admin` or `hmo_coordinator`; null for `patient`, `researcher`, `professional`, `benefactor`
- `professional` and `benefactor` remain `status: 'pending'` until admin approves their application

---

### 3.2 `organizations`

```typescript
interface Organization extends BaseEntity {
  name: string;
  type: OrgType;
  status: OrgStatus;             // default 'pending_verification'
  contactEmail: string;
  verifiedAt?: Date;
  verifiedBy?: string;
  // Onboarding fields (migration 1751380001000 — all nullable)
  registrationNumber?: string;
  contactPhone?: string;         // varchar(30)
  website?: string;              // varchar(500)
  // NGO-specific
  focusAreas?: string;
  operatingRegions?: string;
  headOfficeCountry?: string;    // varchar(10)
  programDescription?: string;
  // HMO-specific
  licenceNumber?: string;
  coverageRegion?: string;       // varchar(10)
  enrolledPatientCount?: string; // varchar(20) — category e.g. '500-2000'
  specialtyFocus?: string;
}
```

---

### 3.3 `patients`

```typescript
interface Patient extends BaseEntity {
  userId: string;              // UNIQUE, NOT NULL
  hmoId?: string;              // set server-side from JWT — never from body
  name: string;
  phone?: string;              // UNIQUE, nullable — nullable for two-phase registration flow
  membershipNumber?: string;   // UNIQUE, nullable
  dateOfBirth?: string;        // ISO date YYYY-MM-DD
  gender?: Gender;
  address?: string;
  conditionTags: string[];     // text[], default '{}'
  medicationList?: object[];   // jsonb
  directContactShared: boolean;// default false
  // Added in migration 1751380000000
  country?: string;            // varchar(10)
  primaryLanguage?: string;    // varchar(10)
  isCaregiver: boolean;        // default false
}
```

Indexes: `UNIQUE` on `user_id`, `UNIQUE` on `phone WHERE NOT NULL`, `UNIQUE` on `membership_number WHERE NOT NULL`, `INDEX` on `hmo_id`, `GIN` on `condition_tags`, `GIN` on `medication_list`.

> `phone` is nullable to support the two-phase registration flow. `POST /auth/register/patient` (direct HMO coordinator path) still requires phone upfront.

---

### 3.4 `hmo_link_requests`

```typescript
interface HmoLinkRequest extends BaseEntity {
  patientId: string;
  orgId: string;
  status: HmoLinkRequestStatus; // 'pending' | 'approved' | 'rejected'
  expiresAt: Date;               // pending requests expire after 7 days
}
```

---

### 3.5 `care_events`

```typescript
interface CareEvent extends BaseEntity {
  patientId: string;
  type: CareEventType;
  eventDate: Date;               // date, day precision
  providerName?: string;         // max 200 chars
  structured: object;            // jsonb — shape varies by CareEventType
  notes?: string;                // max 2000 chars
}
```

`structured` shapes: `CLINIC_VISIT { visitReason, diagnosisCodes, followUpDate? }` · `LAB_RESULT { testName, value, unit, referenceRange?, flagged? }` · `PRESCRIPTION { drugName, rxnormCode?, dosage, frequency, refills? }` · `REFERRAL { speciality, referredToProvider?, urgency }`.

---

### 3.6 `consent_grants`

```typescript
interface ConsentGrant extends BaseEntity {
  patientId: string;
  purpose: ConsentPurpose;
  dataScopes: string[];
  status: ConsentStatus;         // default 'active'
  grantedAt: Date;
  revokedAt?: Date;
  version: number;               // @VersionColumn — optimistic locking
}
```

State machine: `NOT_GRANTED → PENDING → ACTIVE → PAUSED ⇄ ACTIVE` · `ACTIVE/PAUSED → REVOKED` (terminal).

Partial UNIQUE INDEX on `(patient_id, purpose)` WHERE `status != 'revoked'` — allows re-grant after revocation.

---

### 3.7 `programs`

```typescript
interface Program extends BaseEntity {
  orgId: string;                  // from JWT — never from body
  title: string;
  type: ProgramType;
  status: ProgramStatus;          // default 'pending_review'
  eligibilityCriteria: object[];  // jsonb
  expiresAt: Date;
}
```

GIN INDEX on `eligibility_criteria`.

---

### 3.8 `studies`

```typescript
interface Study extends BaseEntity {
  researcherId: string;
  title: string;
  irbNumber: string;              // validated by regex
  status: StudyStatus;            // default 'pending_review'
  eligibilityCriteria: object[];  // jsonb
  infoSheetUrl: string;           // S3 URL
  targetCount: number;
  compensationDetails?: string;
}
```

---

### 3.9 `enrollments`

```typescript
interface Enrollment extends BaseEntity {
  patientId: string;
  programId: string;
  consentGrantId: string;
  status: EnrollmentStatus;       // default 'active'
  sharedDataSnapshot: object;     // jsonb — consented fields only, captured at enrollment time
  version: number;
}
```

**Critical:** `sharedDataSnapshot` is the only field returned to NGOs. The `patients` table is **never joined** when serving enrollment data to an org.

---

### 3.10 `study_enrollments`

```typescript
interface StudyEnrollment extends BaseEntity {
  patientId: string;
  studyId: string;
  consentGrantId: string;
  status: StudyEnrollmentStatus;  // default 'interested'
  sharedDataSnapshot: object;
  directContactShared: boolean;   // default false — explicit patient action required
}
```

---

### 3.11 `messages`

```typescript
interface Message extends BaseEntity {
  senderId: string;
  recipientId: string;
  enrollmentId?: string;          // nullable
  studyEnrollmentId?: string;     // nullable
  body: string;                   // max 5000 chars
  readAt?: Date;
  // DB CHECK: num_nonnulls(enrollment_id, study_enrollment_id) = 1
}
```

---

### 3.12 `notifications`

```typescript
interface Notification extends BaseEntity {
  userId: string;
  type: NotificationType;
  payload: object;                // jsonb
  readAt?: Date;
}
```

---

### 3.13 `audit_log`

```typescript
interface AuditLog extends BaseEntity {
  actorId: string;
  action: AuditAction;
  resourceId: string;
  resourceType: string;
  metadata?: object;              // jsonb
}
```

INSERT-only — `GRANT SELECT, INSERT` only via Postgres RLS. No UPDATE, no DELETE.

---

### 3.14 `professional_applications`

**Purpose:** Application submitted by a `professional` user at onboarding. Admin must approve to activate the account.

```typescript
interface ProfessionalApplication extends BaseEntity {
  userId: string;              // UNIQUE FK → users.id
  profession: ProfessionType;
  licenseNumber: string;
  specialty: string;
  yearsOfExperience: number;
  phone: string;               // varchar(30)
  bio: string;                 // min 10 chars
  status: ApplicationStatus;   // default 'pending'
  rejectionReason?: string;
  submittedAt: Date;           // default NOW()
  reviewedAt?: Date;
  reviewedBy?: string;         // FK → users.id (platform_admin)
}
```

Migration: `1751380002000-CreateProfessionalApplicationTable`

---

### 3.15 `benefactor_applications`

**Purpose:** Application submitted by a `benefactor` user at onboarding.

```typescript
interface BenefactorApplication extends BaseEntity {
  userId: string;              // UNIQUE FK → users.id
  fullName: string;
  phone: string;               // varchar(30)
  reasonForSupport: string;    // min 20 chars
  idConsentGiven: boolean;
  status: ApplicationStatus;   // default 'pending'
  rejectionReason?: string;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
}
```

Migration: `1751380003000-CreateBenefactorApplicationTable`

### 3.16 `communities`, `community_memberships`, `community_posts`, `community_comments`, `community_reactions`, `community_reports`

**Purpose:** The peer-support space. Six tables, all created by `1785600000000-CreateCommunityTables`.

```typescript
interface Community extends BaseEntity {
  name: string; slug: string;              // slug UNIQUE among non-deleted rows
  description?: string; icon?: string; accent?: string;
  disclaimer?: string;                     // shown before a member's first post
  tags: string[];                          // GIN indexed
  status: CommunityStatus;                 // default 'active'
  memberCount: number; postCount: number;  // DISPLAY ONLY — never read by getStats()
  createdByUserId: string;
}

interface CommunityMembership extends BaseEntity {
  communityId: string; userId: string;     // userId is a JWT sub, NOT a patientId
  joinedAt: Date; codeOfConductAt?: Date;
}
// Leaving is a SOFT delete, so uniqueness is PARTIAL:
//   UNIQUE (community_id, user_id) WHERE deleted_at IS NULL
// A plain unique index would make rejoining after leaving impossible.

interface CommunityPost extends BaseEntity {
  communityId: string; authorUserId: string;
  title?: string; body: string; tags: string[];
  status: CommunityContentStatus;          // 'published' | 'hidden'
  hiddenAt?: Date; hiddenBy?: string; hiddenReason?: string;
  commentCount: number; reactionCount: number; lastActivityAt: Date;
}

interface CommunityComment extends BaseEntity {
  postId: string;
  parentCommentId?: string;                // one level only; deeper replies re-parent
  communityId: string;                     // denormalised from the post
  authorUserId: string; body: string;
  status: CommunityContentStatus;
  hiddenAt?: Date; hiddenBy?: string; hiddenReason?: string;
  reactionCount: number;
}

interface CommunityReaction extends BaseEntity {
  userId: string;
  postId?: string; commentId?: string;      // CHECK num_nonnulls(...) = 1
  targetAuthorUserId: string;               // denormalised — backs "Helpful marks"
  type: CommunityReactionType;
}
// TWO partial unique indexes, not one composite: Postgres treats NULLs as distinct,
// so a UNIQUE over both nullable columns would constrain nothing.
//   UNIQUE (user_id, post_id, type)    WHERE post_id    IS NOT NULL
//   UNIQUE (user_id, comment_id, type) WHERE comment_id IS NOT NULL
// Un-reacting is a HARD delete — a soft-deleted row still occupies the index.

interface CommunityReport extends BaseEntity {
  reporterUserId: string;
  postId?: string; commentId?: string;      // CHECK num_nonnulls(...) = 1
  communityId: string;
  reason: CommunityReportReason; details?: string;
  status: CommunityReportStatus;            // CHECK status='pending' OR reviewed_at IS NOT NULL
  resolutionNote?: string; reviewedAt?: Date; reviewedBy?: string;
}
// One OPEN report per reporter per target, also a partial unique index.
```

**No RLS.** §6.5 of CLAUDE.md scopes RLS to org- and patient-scoped tables. Community content is participant-public by design; the boundary that matters — no `ngo_admin`, `hmo_coordinator` or `researcher` — is the controller's class-level `RoleGuard`.

Migration: `1785600000000-CreateCommunityTables`

---

## 4. Enums

### `UserRole`

| Value | Description |
|---|---|
| `patient` | Self-registered — manages consents and enrollments |
| `ngo_admin` | NGO staff — creates programs, views matched patients |
| `hmo_coordinator` | HMO staff — looks up members, records care events |
| `researcher` | Submits IRB-approved studies, recruits participants |
| `professional` | Healthcare professional requiring admin approval |
| `benefactor` | Individual supporter requiring admin approval |
| `platform_admin` | Internal staff — reviews and approves all entities |

### `ApplicationStatus`

| Value | Description |
|---|---|
| `pending` | Submitted, awaiting admin review |
| `approved` | Admin approved — `user.status` set to `'active'` atomically |
| `rejected` | Admin rejected — `rejectionReason` stored |

### `ProfessionType`

| Value | Description |
|---|---|
| `Doctor` | Medical doctor |
| `Nurse` | Registered nurse |
| `Therapist` | Therapist or counselor |
| `Other` | Other healthcare professional |

### `OrgType`

| Value | Description |
|---|---|
| `ngo` | Non-governmental organisation |
| `hmo` | Health maintenance organisation |

### `OrgStatus`

| Value | Description |
|---|---|
| `pending_verification` | Awaiting admin approval |
| `active` | Approved — full access per org type |
| `suspended` | Access revoked |

### `ConsentPurpose`

| Value | Description |
|---|---|
| `ngo_funding` | Share data for NGO funding program matching |
| `clinical_research_recruitment` | Share data for clinical study matching |
| `hmo_care` | Share data with HMO for care coordination |

### `ConsentStatus`

| Value | Description |
|---|---|
| `not_granted` | Before patient takes any action |
| `pending` | Initiated but not confirmed |
| `active` | Consent is live |
| `paused` | Temporarily halted |
| `revoked` | Terminal — all linked enrollments tombstoned |

### `ProgramStatus`

| Value | Description |
|---|---|
| `pending_review` | Awaiting admin approval |
| `approved` | Live — visible in patient matching results |
| `rejected` | Declined by admin |
| `expired` | Passed `expiresAt` — treated as inactive |

### `StudyStatus`

| Value | Description |
|---|---|
| `pending_review` | Awaiting admin review |
| `approved` | Appears in patient study recommendations |
| `active` | Researcher has begun enrolling participants |
| `completed` | Study closed — no new enrollments |
| `rejected` | Declined by admin |

### `EnrollmentStatus`

| Value | Description |
|---|---|
| `active` | Patient currently enrolled |
| `revoked_by_patient` | Patient revoked underlying consent — tombstoned |
| `expired` | Underlying program expired |

### `StudyEnrollmentStatus`

| Value | Description |
|---|---|
| `interested` | Patient expressed interest |
| `screened` | Researcher reviewed patient's shared data |
| `enrolled` | Patient formally enrolled |
| `withdrawn` | Patient withdrew |

### `CareEventType`

| Value | Description |
|---|---|
| `clinic_visit` | In-person or virtual consultation |
| `lab_result` | Laboratory test result |
| `prescription` | Drug prescribed |
| `referral` | Referral to a specialist |

### `NotificationType`

| Value | Description |
|---|---|
| `program_match` | New approved program matches patient profile |
| `enrollment_update` | Status change on enrollment |
| `consent_revoked` | Patient revoked a consent |
| `new_message` | Message received in enrollment thread |
| `study_match` | New approved study matches patient profile |
| `org_verified` | Admin approved the org |
| `community_post_reply` | Someone commented on, or replied under, your post |
| `community_reaction_milestone` | Your content crossed 1 / 5 / 25 / 100 helpful marks. Never per-like |
| `community_content_hidden` | A moderator removed your post or comment, and why |
| `community_report_resolved` | The report you filed has been reviewed — sent to the reporter |
| `community_content_reported` | Content was reported — sent to platform admins |

### `AuditAction`

| Value | Description |
|---|---|
| `export` | PDF export triggered |
| `revoke_consent` | Patient revoked a consent grant |
| `admin_approve` | Admin approved an org, program, study, or application |
| `admin_reject` | Admin rejected an org, program, study, or application |
| `login` | Successful authentication |
| `consent_change` | Any consent status change |
| `cross_org_attempt` | Request blocked for accessing another org's data |
| `community_created` | A patient founded a community, or an admin edited one |
| `community_content_hidden` | A moderator removed a post or comment |
| `community_content_restored` | A moderator restored previously removed content |
| `community_report_submitted` | A member reported content |
| `community_report_resolved` | A moderator hid or dismissed a report |

Community rows are deliberately **absent** from `NAMED_AUDIT_RESOURCE_TYPES`: that allowlist resolves a resourceId to a human label, and for a community post that would put patient free-text health disclosures onto the admin audit screen.

### `CommunityStatus`, `CommunityContentStatus`, `CommunityReactionType`, `CommunityReportTarget`, `CommunityReportReason`, `CommunityReportStatus`, `CommunityModerationAction`

| Enum | Values |
|---|---|
| `CommunityStatus` | `active`, `archived` |
| `CommunityContentStatus` | `published`, `hidden` — shared by posts and comments, which moderate identically |
| `CommunityReactionType` | `like` — one member, so "helpful"/"supportive" need no migration later |
| `CommunityReportTarget` | `post`, `comment` |
| `CommunityReportReason` | `spam`, `harassment`, `misinformation`, `medical_advice`, `personal_data`, `other` |
| `CommunityReportStatus` | `pending`, `actioned`, `dismissed` |
| `CommunityModerationAction` | `hide`, `dismiss` — an intent the DTO validates, kept distinct from the stored status |

`COMMUNITY_PARTICIPANT_ROLES` (`as const`) is `[patient, professional, benefactor]`. `ngo_admin`, `hmo_coordinator` and `researcher` are deliberately absent.

### `TokenPurpose`

| Value | Description |
|---|---|
| `pdf_export` | Single-use export token (Redis jti) |
| `otp_verify` | OTP verification for researcher registration |

---

## 5. DTOs

All responses: `StandardResponse<T>` — `{ data: T; meta?: { cursor?, total?, limit? }; traceId: string }`.

### 5.1 Auth DTOs

**`SignupDto`** (lite two-phase signup)
```typescript
{ name: string; email: string; password: string; role: 'patient'|'ngo'|'hmo'|'professional'|'benefactor' }
```

**`PatientOnboardingDto`**
```typescript
{
  accountType: 'patient' | 'caregiver';
  dateOfBirth?: string;          // ISO8601
  biologicalSex?: 'male'|'female'|'other';
  country?: string;
  conditions?: string;           // comma-separated → split to conditionTags
  primaryLanguage?: string;
  termsConsent: true;            // @Equals(true) — must be exactly true
  ngoConsent: boolean;
  researchConsent: boolean;
}
```

**`NgoOnboardingDto`**
```typescript
{
  orgName: string; registrationNumber: string; focusAreas: string; website?: string;
  operatingRegions: string; headOfficeCountry: string; programDescription: string;
  termsConsent: true; dataProcessingConsent: true;
}
```

**`HmoOnboardingDto`**
```typescript
{
  orgName: string; licenceNumber: string; contactPhone: string;
  coverageRegion: string; enrolledPatientCount: string; specialtyFocus?: string;
  baaAcknowledgement: true; termsConsent: true;
}
```

**`RegisterPatientDto`** (HMO coordinator direct path — phone required):
```typescript
{ email, password, name, phone, membershipNumber?, dateOfBirth?, gender?, address?, conditionTags[], consentPurposes[] }
```

**`LoginDto`**: `{ email: string; password: string }`

**Auth Response** — `POST /auth/signup`, `POST /auth/login`, `POST /auth/register/*`:
```typescript
{
  data: {
    accessToken: string;  // JWT RS256, 15-min expiry
    user: { id, name?, email, role, status, orgId? };
  }
  // + httpOnly refresh cookie (7d)
}
```

### 5.2 Application DTOs

**`ProfessionalOnboardingDto`**:
```typescript
{
  profession: ProfessionType; licenseNumber: string; specialty: string;
  yearsOfExperience: number; // @Min(0)
  phone: string; bio: string; // @MinLength(10)
  termsConsent: true; codeOfConductConsent: true;
}
```

**`BenefactorOnboardingDto`**:
```typescript
{
  fullName: string; phone: string;
  reasonForSupport: string; // @MinLength(20)
  idConsent: true; termsConsent: true; codeOfConductConsent: true;
}
```

**`ReviewApplicationDto`**: `{ action: 'approve'|'reject'; reason?: string }`

### 5.3 Admin DTO

**`AdminApproveDto`**: `{ status: 'approved'|'rejected'; reason?: string }`

### 5.4 Common DTOs

**`PaginationDto`**: `{ cursor?: string; limit?: number }` — default 20, max 50.

See `src/modules/*/dto/` and `docs/specs/` for full DTO definitions per module.

---

## 6. Module Breakdown

### `AuthModule`
Lite signup + all onboarding endpoints. Manages User entity, JWT issuance, token refresh, OTP. Delegates professional/benefactor onboarding to `ApplicationsService`.

### `ApplicationsModule`
Owns `ProfessionalApplication` and `BenefactorApplication` entities. Exported `ApplicationsService` imported by `AuthModule` (onboarding) and `AdminModule` (review).

### `PatientsModule`
Patient self-service (profile, link requests). HMO coordinator patient lookup + care events.

### `OrganizationsModule`
Organization CRUD. Status updated by `AdminModule`.

### `ConsentsModule`
Consent state machine, revocation cascade (tombstones enrollments), impact preview.

### `ProgramsModule`
NGO program creation, aggregate match preview via `MatchingService`, fan-out trigger.

### `StudiesModule`
Researcher study submission, study enrollment management.

### `EnrollmentsModule`
Patient self-enrollment. `sharedDataSnapshot` construction at enrollment time.

### `MatchingModule`
JSONB eligibility engine for recommendations. Patient ID queries are internal-only (BullMQ workers only — never HTTP).

### `NotificationsModule`
BullMQ notification producer + real-time WebSocket push via `NotificationsGateway`.

### `MessagesModule`
Enrollment-scoped messaging (participants only).

### `ExportModule`
Single-use export JWT (Redis jti) + PDF generation + mandatory audit log write.

### `AuditModule`
Write-only `AuditService.log()`. `audit_log` is INSERT-only.

### `AdminModule`
Admin review for orgs, programs, studies, and professional/benefactor applications.

### `CommunityModule`
Communities, memberships, posts, comments, reactions and the report → moderation pipeline. Two controllers in one file: `CommunityController` (`patient` / `professional` / `benefactor`) and `CommunityModerationController` under `/admin/community` (`platform_admin`). Owns `GET /community/stats`, the only source for the community numbers on the professional and benefactor dashboards. Author display names and verified badges are derived at read time by `resolveAuthors()` and never snapshotted. See `docs/specs/community.spec.md`.

### `QueuesModule`
Three queues (`notifications`, `admin`, `mail`), ten processors filtering on `job.name`.

---

## 7. API Contract

All routes prefixed with `/api`. All responses wrapped in `StandardResponse<T>`.

### 7.1 Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/signup | — | Lite signup → tokens immediately |
| POST | /auth/register/patient | — | Full patient registration (HMO coordinator direct-create) |
| POST | /auth/register/org | — | Full org staff registration |
| POST | /auth/register/researcher | — | Researcher registration (OTP required) |
| POST | /auth/login | — | Login → access token + refresh cookie |
| POST | /auth/refresh | Refresh Cookie | Rotate both tokens |
| POST | /auth/logout | JWT | Revoke refresh token |
| POST | /auth/forgot-password | — | Request password reset email |
| POST | /auth/reset-password | — | Complete password reset |
| POST | /auth/request-otp | — | Request OTP (researcher pre-registration) |
| POST | /auth/onboarding/patient | `patient` | Complete health profile + consent grants |
| POST | /auth/onboarding/ngo | `ngo_admin` | Submit NGO org details for verification |
| POST | /auth/onboarding/hmo | `hmo_coordinator` | Submit HMO org details for verification |
| POST | /auth/onboarding/professional | `professional` | Submit professional application |
| POST | /auth/onboarding/benefactor | `benefactor` | Submit benefactor application |

### 7.2 Patients

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /patients/me | `patient` | Own profile |
| PATCH | /patients/me | `patient` | Update own profile |
| GET | /patients/lookup | `hmo_coordinator` | Lookup by phone or membershipNumber (requires HMO_CARE consent) |
| POST | /patients | `hmo_coordinator` | Create patient (hmoId set from JWT) |
| POST | /patients/:id/link-request | `hmo_coordinator` | Send link request to self-registered patient |
| GET | /patients/me/link-requests | `patient` | List own link requests |
| PATCH | /patients/me/link-requests/:requestId | `patient` | Approve or reject link request |
| GET | /patients/:id | `hmo_coordinator` | Patient detail (org-scoped) |
| GET | /patients/:id/events | `hmo_coordinator` | Care events — paginated (org-scoped) |
| POST | /patients/:id/events | `hmo_coordinator` | Add care event (org-scoped) |
| GET | /patients/:id/summary | `hmo_coordinator` | PDF summary — requires export JWT |

### 7.3 Consents

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /consents/me | `patient` | List all consent grants |
| POST | /consents | `patient` | Create new consent grant |
| PATCH | /consents/:id | `patient` | Transition consent status |
| GET | /consents/:id/impact | `patient` | Preview revocation impact |

### 7.4 Programs

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /programs | `ngo_admin` | Create program (org-scoped, triggers review job) |
| GET | /organizations/:id/programs | `ngo_admin` | List programs for org |
| GET | /programs/:id/matches | `ngo_admin` | Aggregate match preview (count + tag summary only — no patient IDs) |
| GET | /programs/:id/enrollments | `ngo_admin` | List enrollments — snapshots only |
| POST | /programs/:id/notify | `ngo_admin` | Trigger fan-out notification |

### 7.5 Studies

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /studies | `researcher` | Submit study for review |
| GET | /researchers/:id/studies | `researcher` | List own studies |
| GET | /studies/:id/enrollments | `researcher` | List study enrollments |
| POST | /study-enrollments/:id/invite | `researcher` | Advance enrollment status |

### 7.6 Enrollments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /enrollments | `patient` | Self-enroll in approved program |
| GET | /enrollments/:id | `patient` | View own enrollment |
| POST | /study-enrollments | `patient` | Express interest in a study |

### 7.7 Recommendations

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /recommendations/funding | `patient` | Approved programs matching patient profile (consent check in SQL) |
| GET | /recommendations/studies | `patient` | Approved studies matching patient profile (consent check in SQL) |

### 7.8 Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /messages | `ngo_admin`, `researcher` | Send message in enrollment thread |
| GET | /messages/:enrollmentId | `ngo_admin`, `researcher`, `patient` | Read thread — participants only |

### 7.9 Export

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /tokens | `hmo_coordinator` | Generate single-use PDF export token |

### 7.10 Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /notifications/me | JWT | List own notifications — paginated |
| PATCH | /notifications/:id/read | JWT | Mark notification as read |

### 7.11 Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | /admin/programs/:id | `platform_admin` | Approve or reject a program |
| PATCH | /admin/studies/:id | `platform_admin` | Approve or reject a study |
| PATCH | /admin/organizations/:id | `platform_admin` | Approve or reject an org |
| GET | /admin/applications/professional | `platform_admin` | List professional applications (filter by status) |
| PATCH | /admin/applications/professional/:id/review | `platform_admin` | Approve or reject professional |
| GET | /admin/applications/benefactor | `platform_admin` | List benefactor applications (filter by status) |
| PATCH | /admin/applications/benefactor/:id/review | `platform_admin` | Approve or reject benefactor |

### 7.13 Community

`patient`, `professional` and `benefactor` only — every other role is refused at the class-level guard.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /community/overview | participant | Platform-wide counters for the portal header |
| GET | /community/trending | participant | Top tags on posts from the last 7 days |
| GET | /community/stats | participant | The caller's own community numbers |
| GET | /community/communities | participant | Browse active communities (`?tag`, `?joinedOnly`) |
| POST | /community/communities | `patient` | Found a community; the founder is auto-joined |
| GET | /community/communities/:id | participant | One community |
| POST | /community/communities/:id/join | participant | Join (idempotent) |
| DELETE | /community/communities/:id/join | participant | Leave; your posts stay |
| POST | /community/communities/:id/posts | participant | Post — 403 without an active membership |
| GET | /community/posts | participant | The feed (`?communityId`, `?tag`, `?joinedOnly`) |
| GET | /community/posts/mine | participant | Your own posts, hidden ones included |
| GET | /community/posts/unanswered | participant | Posts with no replies yet |
| GET | /community/posts/:id | participant | One post — 404, not 403, if hidden and not yours |
| PATCH | /community/posts/:id | author | 409 once a moderator has hidden it |
| DELETE | /community/posts/:id | author | Soft delete |
| GET | /community/posts/:id/comments | participant | The thread, oldest first |
| POST | /community/posts/:id/comments | participant | Comment, or reply via `parentCommentId` |
| PATCH \| DELETE | /community/comments/:id | author | Edit / delete your own |
| POST \| DELETE | /community/{posts,comments}/:id/reactions | participant | Mark helpful — 409 on your own |
| POST | /community/{posts,comments}/:id/reports | participant | Report — 409 on a duplicate |

**Moderation** — `platform_admin` only:

| Method | Path | Description |
|---|---|---|
| GET | /admin/community/reports | The queue, newest first (`?status`) |
| PATCH | /admin/community/reports/:id | `hide` (note required) or `dismiss` |
| PATCH | /admin/community/posts/:id/visibility | Direct hide / restore |
| PATCH | /admin/community/comments/:id/visibility | Direct hide / restore |
| PATCH | /admin/community/communities/:id | Edit or archive a community |

### 7.12 Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | — | DB + Redis + S3 liveness check |

---

## 8. Business Rules & Constraints

### 8.1 Registration & Identity

| # | Rule |
|---|---|
| R-01 | Patient registration is a **single atomic transaction**: `users` + `patients` + `consent_grants`. Any failure rolls back entirely. |
| R-02 | Phone numbers stored as plain text over HTTPS. Protected at the API layer by JWT auth guards + RLS. |
| R-03 | Researcher institutional email domain must be validated server-side. |
| R-04 | Org registration creates `users` + `organizations` atomically. Both start in `pending` / `pending_verification`. |
| R-05 | Lite signup (`POST /auth/signup`) issues tokens for all roles immediately. `professional` and `benefactor` remain `status: 'pending'` until admin approves. |

### 8.2 Authorisation & Scope

| # | Rule |
|---|---|
| A-01 | `orgId`, `hmoId`, `patientId` are **never accepted from request bodies**. Always from `req.user` JWT claims. |
| A-02 | HMO coordinators look up patients globally only if patient has active `HMO_CARE` consent. |
| A-03 | NGO admins access only programs where `programs.org_id = req.user.orgId`. |
| A-04 | Researchers access only studies where `studies.researcher_id = req.user.sub`. |
| A-05 | Patients access only their own consents, enrollments, and notifications. |
| A-06 | Postgres RLS is the **hard boundary**. Always use `SET LOCAL app.org_id = $orgId` inside transactions — never bare `SET`. |
| A-07 | Cross-org access attempts are blocked and written to `audit_log` with `CROSS_ORG_ATTEMPT`. |
| A-08 | Patient-scoped tables have parallel RLS via `SET LOCAL app.user_id = $patientId`. |
| A-09 | `platform_admin` blocked from patient health data at both guard and DB (RLS) levels. |

### 8.3 Consent & Data Sharing

| # | Rule |
|---|---|
| C-01 | Active `ConsentGrant` required before any enrollment is created. |
| C-02 | Consent revocation is **atomic**: update status + tombstone enrollments + audit log + queue job. |
| C-03 | Consent state machine transitions strictly enforced — no skipping states, no exiting `REVOKED`. |
| C-04 | `sharedDataSnapshot` is a point-in-time copy — orgs never read from a live `patients` join. |
| C-05 | `directContactShared` defaults `false`; requires explicit patient boolean `true`. |
| C-06 | `ConsentPurpose → fields` mapping lives only in `src/common/constants/snapshot-fields.ts`. Canonical mapping: `ngo_funding → ['name', 'conditionTags', 'address', 'directContactShared']` · `hmo_care → ['name', 'conditionTags', 'address', 'membershipNumber', 'medicationList']` · `clinical_research_recruitment → ['name', 'conditionTags', 'address', 'directContactShared', 'medicationList']`. |

### 8.4 Application Review (Professional & Benefactor)

| # | Rule |
|---|---|
| AP-01 | User `status: 'pending'` from signup until admin approval. |
| AP-02 | Admin approval is **atomic**: `application.status = 'approved'` AND `user.status = 'active'` in one transaction. |
| AP-03 | Admin rejection stores `rejectionReason`; `user.status` remains `'pending'`. |

### 8.5 Matching & Privacy

| # | Rule |
|---|---|
| M-01 | `GET /programs/:id/matches` returns aggregate counts and tag summaries only — no patient IDs ever. |
| M-02 | `MatchingService.getEligiblePatientIds()` is for BullMQ workers only — never via HTTP. |
| M-03 | Consent check in recommendations must be a SQL `EXISTS` subquery — not a post-fetch JS filter. |

### 8.6 Notifications (Fan-out)

| # | Rule |
|---|---|
| N-01 | `POST /programs/:id/notify` enqueues **one `fan_out_notify` coordinator job** — not per-patient. |
| N-02 | Fan-out coordinator pages in chunks of 200 → one `batch_notify` job per chunk. |
| N-03 | Each `batch_notify` does one bulk INSERT into `notifications`. |

### 8.7 Export & Audit

| # | Rule |
|---|---|
| E-01 | Export tokens are single-use — `redis.getdel()` is the atomic check-and-delete. |
| E-02 | `ExportService.buildPdf()` always writes to `audit_log`. |
| E-03 | All sensitive actions write to `audit_log` before the response is returned. |
| E-04 | `audit_log` is INSERT-only at the Postgres RLS level. |
| E-05 | Refresh token jti written to Redis on logout (`refresh:revoked:{jti}`); checked on every `POST /auth/refresh`. |

### 8.8 Auth Key Business Rules

| # | Rule |
|---|---|
| BR-8 | Login returns identical 401 for wrong email and wrong password (no email enumeration). |
| BR-9 | Suspended accounts get 403, not 401. |
| BR-11 | Logout never throws (always 200). |
| LR-4 | HMO link approval re-fetches patient in transaction (prevents race conditions). |

---

## 9. Inter-module Dependencies

| Module | Depends On | Reason |
|---|---|---|
| `AuthModule` | `PatientsModule`, `ConsentsModule`, `QueuesModule`, `ApplicationsModule` | Atomic registration; consent creation; OTP; professional/benefactor onboarding |
| `ApplicationsModule` | `AuditModule` | Logs review decisions |
| `PatientsModule` | `ExportModule`, `AuditModule` | Export token validation; audit log writes |
| `ConsentsModule` | `EnrollmentsModule`, `AuditModule`, `QueuesModule` | Revocation cascade; audit; queue |
| `EnrollmentsModule` | `ConsentsModule`, `PatientsModule` | Consent check; snapshot construction |
| `ProgramsModule` | `MatchingModule`, `AuditModule`, `QueuesModule` | Match preview; fan-out queue |
| `StudiesModule` | `MatchingModule`, `QueuesModule` | Match preview; review queue |
| `AdminModule` | `OrganizationsModule`, `ProgramsModule`, `StudiesModule`, `MatchingModule`, `AuditModule`, `QueuesModule`, `ApplicationsModule` | Multi-entity review; application approval |
| `MatchingModule` | `ProgramsModule`, `StudiesModule`, `ConsentsModule` | Eligibility engine with consent SQL check |
| `MessagesModule` | `EnrollmentsModule` | Participant validation |
| `ExportModule` | `AuditModule` | Mandatory audit on every export |
| `QueuesModule` | `MatchingModule`, `NotificationsModule`, `AuditModule` | Processors inject these services |

---

## 10. Non-functional Requirements

### 10.1 Pagination
All list endpoints use **keyset (cursor) pagination** — not offset. Default 20, max 50. Cursor = ULID of last item. Response includes `meta.cursor` and `meta.limit`.

### 10.2 Error Handling
RFC 7807 Problem Detail on all errors:
```typescript
{ type: string; title: string; status: number; detail: string; traceId: string; errors?: Array<{ path, message }> }
```

HTTP codes: 400 malformed · 401 missing/expired JWT · 403 role/scope violation · 404 not found · 409 conflict · 422 validation · 429 rate limited.

### 10.3 Logging
Structured JSON via `nestjs-pino`. Every request gets a `traceId` (UUID v4) from `ClsService`, attached to every log line and HTTP response. **Never log:** `passwordHash`, patient `phone`, JWT payloads, `sharedDataSnapshot`.

### 10.4 Rate Limiting

| Group | Limit | Key |
|---|---|---|
| `/auth/login`, `/auth/register/*`, `/auth/signup` | 10 req / 60s | IP |
| OTP endpoints | 3 req / 300s | `userId` |
| `/tokens` (export) | 5 req / 60s | `orgId` |
| All other | 60 req / 60s | `userId` |

### 10.5 Health
`GET /health` — PostgreSQL + Redis + S3 liveness via `@nestjs/terminus`.

### 10.6 Security Headers
`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Strict-Transport-Security: max-age=63072000; includeSubDomains` · `Content-Security-Policy: default-src 'none'`

### 10.7 Database Migrations
TypeORM CLI. `synchronize: true` active in development when `DB_SYNC` is not `'false'`. Always set `DB_SYNC=false` in production. All schema changes require timestamped migration files committed to version control.

---

## 11. Scaffold Implementation Notes

### 11.1 CLI DataSource vs. Application DataSource
`src/database/data-source.ts` is for TypeORM CLI only — calls `dotenv.config()` directly. Application uses `database.config.ts` via `ConfigService`. Keep `entities:` and `migrations:` globs in sync between both files.

### 11.2 HealthModule
Both `health.module.ts` and `health.controller.ts` required in `src/health/`. `AppModule` imports `HealthModule`. Do not register `HealthController` directly in `AppModule.controllers`.

### 11.3 TransformInterceptor CLS Gap
`TransformInterceptor` is instantiated with `new TransformInterceptor()` in `main.ts` — bypasses NestJS DI, so `traceId` falls back to `crypto.randomUUID()`. Fix: use `app.get(TransformInterceptor)` and add to `AppModule.providers`.

### 11.4 BullMQ Three-Queue Architecture
Three queues (`notifications`, `admin`, `mail`), nine processors filtering on `job.name`. Do not add queues ad hoc.

### 11.5 StudyEnrollmentsController Actor-Ownership Split
Patient action (`POST /study-enrollments`) → `EnrollmentsModule`. Researcher action (`POST /study-enrollments/:id/invite`) → `StudiesModule`. Avoids circular imports.

### 11.6 PassportModule and JwtStrategy
Implemented at `src/modules/auth/strategies/jwt.strategy.ts`. Uses RS256 public key from `ConfigService` (`jwt.publicKey`). **Stateless validation** — `JwtStrategy.validate()` returns the decoded payload as-is; suspension is enforced at login only (business rule BR-9).

### 11.7 `common/constants/` Privacy Boundary
`src/common/constants/snapshot-fields.ts` imports only from `src/common/enums` — safe to import from any module. Single source of truth for `ConsentPurpose → patient fields` mapping.

### 11.8 Phone Nullability
`patients.phone` is nullable (migration `1751380000000`) to support two-phase registration. `POST /auth/register/patient` (direct HMO path) still requires phone.

### 11.9 Applied Migrations

| Timestamp | Migration | Change |
|---|---|---|
| 1751380000000 | `AddPatientOnboardingFields` | Added `country`, `primary_language`, `is_caregiver` to `patients`; made `phone` nullable |
| 1751380001000 | `AddOrgOnboardingFields` | Added 11 nullable onboarding columns to `organizations` |
| 1751380002000 | `CreateProfessionalApplicationTable` | Created `professional_applications` table |
| 1751380003000 | `CreateBenefactorApplicationTable` | Created `benefactor_applications` table |

---

*LucenCare Healthtech Platform — Architecture V1.1*
*NestJS 11 · TypeScript · PostgreSQL 17 · Redis · BullMQ · ULID*
