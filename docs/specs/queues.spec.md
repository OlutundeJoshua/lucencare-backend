# Queues Module Specification

## 1. Module Overview

The Queues module owns the BullMQ queue definitions and all processor implementations. It defines queue names as constants, registers queues via `BullModule.registerQueue()`, and runs all async job processors. Processors inject services from other modules — they never implement business logic themselves; they delegate to the appropriate service method.

---

## 2. Entities Involved

None. Queues module owns no DB entities.

---

## 3. Queue Definitions

```typescript
// src/queues/queues.constants.ts
export const NOTIFICATIONS_QUEUE = 'notifications';
export const ADMIN_QUEUE = 'admin';
export const MAIL_QUEUE = 'mail';
```

All queues share the same Redis connection defined in the app config.

---

## 4. Processors

### `fan-out-notify.processor.ts`

**Queue:** `notifications`  
**Job name:** `fan_out_notify`

**Job payload:**
```typescript
interface FanOutNotifyJob {
  programId: string;
  orgId: string;
}
```

**Logic:**
1. Load the program to get its eligibility criteria
2. Loop with pagination cursor:
   ```
   do {
     page = await MatchingService.getEligiblePatientIds(programId, cursor)
     if (page.patientIds.length > 0) {
       enqueue batch_notify job: { patientIds: page.patientIds, programId, orgId }
     }
     cursor = page.nextCursor
   } while (cursor !== undefined)
   ```
3. Each page contains at most 200 patient IDs
4. One `batch_notify` job is enqueued per page
5. If 0 eligible patients total: complete silently, no batch jobs enqueued

**Error handling:** If `getEligiblePatientIds` fails, the job retries (BullMQ default retry: 3 attempts with exponential backoff).

---

### `batch-notify.processor.ts`

**Queue:** `notifications`  
**Job name:** `batch_notify`

**Job payload:**
```typescript
interface BatchNotifyJob {
  patientIds: string[];     // max 200 — enforced by fan-out coordinator
  programId: string;
  orgId: string;
}
```

**Logic:**
1. Load program title from programs table (single query)
2. Load org name from organizations table (single query)
3. Build notifications array:
   ```typescript
   const notifications = patientIds.map(patientId => ({
     userId: patientId,   // NOTE: patientId here is patients.id, but userId on notification is users.id
                          // — must resolve patient.userId for each patient, or store userId on patients
     type: NotificationType.PROGRAM_MATCH,
     payload: { programId, programTitle, orgName }
   }))
   ```
4. Call `NotificationsService.createBulk(notifications)` — single bulk INSERT
5. `createBulk` handles WebSocket push for each notification

**Critical:** One `INSERT ... VALUES (...)` for all records — never a loop of individual inserts.

> ⚠️ **Note on userId resolution:** `patientIds` in the job are `patients.id` (ULID). `notifications.user_id` is `users.id`. The batch processor must resolve `patients.user_id` for each patient before inserting. Either: (a) include `userIds` in the job payload (resolved by fan-out coordinator), or (b) do a single `SELECT user_id FROM patients WHERE id = ANY($1)` before the bulk insert. Option (a) is preferred to avoid the extra query in the processor.

---

### `consent-revoked.processor.ts`

**Queue:** `notifications`  
**Job name:** `consent_revoked`

**Job payload:**
```typescript
interface ConsentRevokedJob {
  consentGrantId: string;
  patientId: string;
  purpose: ConsentPurpose;
  affectedEnrollmentIds: string[];
  affectedOrgIds: string[];          // orgs that had active enrollments under this consent
}
```

**Logic:**
1. For each affected orgId, find the org admin/coordinator user IDs
2. For each affected org user: call `NotificationsService.createOne()` with type `CONSENT_REVOKED`
3. Payload: `{ consentGrantId, purpose, affectedEnrollmentCount: affectedEnrollmentIds.length }`

---

### `send-otp.processor.ts`

**Queue:** `mail`  
**Job name:** `send_otp`

**Job payload:**
```typescript
interface SendOtpJob {
  to: string;               // email address
  code: string;             // 6-digit OTP
  expiresInMinutes: number; // 10
}
```

**Logic:**
1. Send email via configured mail provider (nodemailer/SendGrid/etc.)
2. Email subject: "Your LucenCare verification code"
3. Email body: include OTP code and expiry time prominently
4. If send fails: retry up to 3 times with exponential backoff

---

### `org-verification.processor.ts`

**Queue:** `admin`  
**Job name:** `org_verification`

**Job payload:**
```typescript
interface OrgVerificationJob {
  orgId: string;
  orgName: string;
  contactEmail: string;
}
```

**Logic:**
1. Send internal notification to platform admins that a new org is pending review
2. In V1: call `NotificationsService.createOne()` for the platform admin user(s)
3. Payload: `{ orgId, orgName }`, type `ORG_VERIFIED` (repurposed — or add a new type `PENDING_ORG_REVIEW`)

> ⚠️ The platform admin user ID(s) must be known at this point — either seeded or resolved from a query for users with `role = 'platform_admin'`.

---

### `program-review.processor.ts`

**Queue:** `admin`  
**Job name:** `program_review`

**Job payload:**
```typescript
interface ProgramReviewJob {
  programId: string;
  orgId: string;
  title: string;
}
```

**Logic:**
1. Notify platform admin(s) of a new program pending review
2. Call `NotificationsService.createOne()` for each platform admin

---

### `study-review.processor.ts`

**Queue:** `admin`  
**Job name:** `study_review`

**Job payload:**
```typescript
interface StudyReviewJob {
  studyId: string;
  researcherId: string;
  irbNumber: string;
  title: string;
}
```

**Logic:**
1. Notify platform admin(s) of a new study pending review

---

### `program-approved.processor.ts`

**Queue:** `admin`  
**Job name:** `program_approved`

**Job payload:**
```typescript
interface ProgramApprovedJob {
  programId: string;
  orgAdminUserId: string;
  programTitle: string;
}
```

**Logic:**
1. Call `NotificationsService.createOne()` for `orgAdminUserId`
2. Type: `ENROLLMENT_UPDATE` (or a more specific type — see note below)
3. Payload: `{ programId, programTitle, message: 'Your program has been approved' }`

---

### `study-approved.processor.ts`

**Queue:** `admin`  
**Job name:** `study_approved`

**Job payload:**
```typescript
interface StudyApprovedJob {
  studyId: string;
  researcherUserId: string;
  studyTitle: string;
}
```

**Logic:**
1. Call `NotificationsService.createOne()` for `researcherUserId`
2. Type: appropriate study notification type
3. Payload: `{ studyId, studyTitle, message: 'Your study has been approved' }`

---

## 5. Module Structure

```typescript
// src/queues/queues.module.ts
@Module({
  imports: [
    BullModule.registerQueue(
      { name: NOTIFICATIONS_QUEUE },
      { name: ADMIN_QUEUE },
      { name: MAIL_QUEUE },
    ),
    // Import modules whose services are injected into processors
    PatientsModule,
    NotificationsModule,
    MatchingModule,
    AuditModule,
    ConsentsModule,
    EnrollmentsModule,
  ],
  providers: [
    FanOutNotifyProcessor,
    BatchNotifyProcessor,
    ConsentRevokedProcessor,
    SendOtpProcessor,
    OrgVerificationProcessor,
    ProgramReviewProcessor,
    StudyReviewProcessor,
    ProgramApprovedProcessor,
    StudyApprovedProcessor,
  ],
})
export class QueuesModule {}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | Fan-out coordinator enqueues at most one `batch_notify` job per 200 patient IDs. Never one job per patient. |
| BR-2 | `batch_notify` processor calls a single `INSERT ... VALUES` — never a loop of individual inserts. |
| BR-3 | All processors use the injected service layer. No direct DB queries in processor classes. |
| BR-4 | All processors follow BullMQ retry semantics: 3 attempts with exponential backoff. Permanent failures go to the failed queue for manual inspection. |
| BR-5 | Processor classes contain zero business logic — they receive a job payload, call one service method, and return. |
| BR-6 | The `fan_out_notify` processor may run for a long time (large patient tables). It must handle BullMQ job timeout — set a generous `jobTimeout` on this specific queue or configure `lockDuration` appropriately. |

---

## 7. Dependencies on Other Modules

| Processor | Services injected |
|---|---|
| `FanOutNotifyProcessor` | `MatchingService`, `Queue (notifications)` |
| `BatchNotifyProcessor` | `NotificationsService` |
| `ConsentRevokedProcessor` | `NotificationsService` |
| `SendOtpProcessor` | MailService (external — nodemailer/SendGrid adapter) |
| `OrgVerificationProcessor` | `NotificationsService` |
| `ProgramReviewProcessor` | `NotificationsService` |
| `StudyReviewProcessor` | `NotificationsService` |
| `ProgramApprovedProcessor` | `NotificationsService` |
| `StudyApprovedProcessor` | `NotificationsService` |

---

## 8. Open Questions or Ambiguities

> ⚠️ Platform admin notification delivery: the `org_verification`, `program_review`, and `study_review` processors need to know which users have `role = 'platform_admin'`. Either seed a fixed admin user ID (stored in config) or query `users WHERE role = 'platform_admin'` at processor runtime. Agree on the approach before implementing these processors.

> ⚠️ `batch_notify` processor: `patientIds` in the job are `patients.id` values, but `notifications.user_id` needs `users.id`. Resolve this at the fan-out coordinator level (include `userIds` in the job payload) rather than adding a resolution query inside the batch processor. Update the `FanOutNotifyJob` and `BatchNotifyJob` payloads accordingly.

> ⚠️ `NotificationType` enum does not include `PENDING_ORG_REVIEW`, `PROGRAM_APPROVED`, `PROGRAM_REJECTED`, `STUDY_APPROVED`, or `STUDY_REJECTED` types. The current enum only has `PROGRAM_MATCH`, `ENROLLMENT_UPDATE`, `CONSENT_REVOKED`, `NEW_MESSAGE`, `STUDY_MATCH`, `ORG_VERIFIED`. Either add these notification types to the enum or map the approved/rejected events to existing types with a message in the payload. Decide before implementing processors.
