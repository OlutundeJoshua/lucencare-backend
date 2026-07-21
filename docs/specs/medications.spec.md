# Medications Module Specification

## 1. Module Overview

The Medications module owns the `Medication` and `MedicationDoseLog` entities. It handles patient-facing medication CRUD, the daily dose schedule (with idempotent dose-log generation), dose logging (taken/pending/later/skipped), refill urgency alerts, adherence stats, refill requests, and reminder opt-in/opt-out. It is patient-only — no org or admin role has access to any endpoint in this module.

It keeps `patients.medication_list` (a pre-existing jsonb summary column owned by the Patients module, consumed by `MatchingService` and `EnrollmentsService`'s consent snapshot) in sync on every create/update/delete, writing only the `{name, dosage, frequency, rxnormCode?}` shape that column has always had. This is a one-way, write-side sync — `MatchingService` and `EnrollmentsService` are unmodified.

---

## 2. Entities Involved

**Owns:**
- `medications`
- `medication_dose_logs`

**Reads (does not own):**
- `patients` — resolves the caller's `patientId` via `PatientsService.getMyProfile()`; writes the `medication_list` summary and the `timezone`/`medication_reminders_enabled` reminder-opt-in columns.
- `users` — resolves patient email for reminder emails (`findDueReminderTargets`).

---

## 3. DTOs

```typescript
// src/modules/medications/dto/create-medication.dto.ts
export class CreateMedicationDto {
  name: string;
  dosage: string;
  condition: string;
  frequency: string;
  scheduleTimes: string[];      // e.g. ['8:00 AM', '8:00 PM'] — frontend only offers 4 fixed slots today
  prescriber: string;
  specialty: string;
  pillsTotal: number;           // pillsRemaining is seeded to this value on create
  refillDate: string;           // ISO date YYYY-MM-DD
  rxnormCode?: string;
  notes?: string;
}

// update-medication.dto.ts — all fields above optional, plus pillsRemaining?: number

// log-dose.dto.ts
export class LogDoseDto {
  doseDate?: string;            // ISO date, defaults to today
  scheduledTime: string;
  status: DoseStatus;           // 'taken' | 'pending' | 'later' | 'skipped'
}

// medication-schedule-query.dto.ts
export class MedicationScheduleQueryDto {
  date?: string;                 // ISO date, defaults to today
}

// register-reminders.dto.ts
export class RegisterRemindersDto {
  timezone: string;              // IANA timezone, e.g. 'Africa/Lagos'
}
```

### Response Shapes

```typescript
interface MedicationResponse { data: Medication; traceId: string; }
interface MedicationListResponse { data: Medication[]; traceId: string; }

interface ScheduleResponse {
  data: {
    date: string;
    slots: { time: string; doses: { doseLogId: string; medicationId: string; medName: string; dosage: string; note?: string; status: DoseStatus }[] }[];
  };
  traceId: string;
}

interface RefillAlertsResponse {
  data: {
    alerts: { medicationId: string; name: string; pillsLeft: number; refillDateISO: string; urgency: 'urgent' | 'upcoming' | 'ok' }[];
    okCount: number;
  };
  traceId: string;
}

interface MedicationStatsResponse {
  data: { activeMeds: number; takenToday: number; dueToday: number; adherenceStreakDays: number };
  traceId: string;
}
```

---

## 4. Endpoints

All endpoints: `Auth: patient role`, JWT `sub` resolves the scoped `patientId` server-side — never accepted from the request.

| Method | Path | Logic | Success | Errors |
|---|---|---|---|---|
| GET | `/medications` | List active medications for the caller | 200 | 401 |
| POST | `/medications` | Create; `pillsRemaining = pillsTotal`; syncs `patients.medication_list` | 201 | 401, 422 |
| PATCH | `/medications/:id` | Scoped partial update; re-syncs summary if name/dosage/frequency/rxnormCode changed | 200 | 401, 404, 422 |
| DELETE | `/medications/:id` | Soft delete (discontinue); re-syncs summary | 200 | 401, 404 |
| GET | `/medications/schedule?date=` | Idempotently upserts today's (or given date's) `PENDING` dose-log rows, returns them grouped by time slot | 200 | 401 |
| POST | `/medications/:id/doses/log` | Upserts a dose log's status; decrements `pillsRemaining` by 1 (floor 0) only on the PENDING/LATER/SKIPPED → TAKEN transition | 200 | 401, 404, 422 |
| GET | `/medications/refills` | Urgency per medication: `urgent` ≤7 days to `refillDate`, `upcoming` ≤14 days, else `ok`. Returns non-ok alerts + `okCount` | 200 | 401 |
| POST | `/medications/:id/request-refill` | Writes `AuditAction.MEDICATION_REFILL_REQUESTED` + `NotificationsService.createOne(REFILL_ALERT, {source: 'patient_request'})` | 200 | 401, 404 |
| GET | `/medications/stats` | `activeMeds`, `takenToday`, `dueToday` (PENDING+LATER today), `adherenceStreakDays` | 200 | 401 |
| POST | `/medications/reminders/register` | Sets `patients.timezone` + `medication_reminders_enabled = true` | 200 | 401, 422 |
| DELETE | `/medications/reminders/unregister` | Sets `medication_reminders_enabled = false` | 200 | 401 |

---

## 5. Service Methods

```typescript
class MedicationsService {
  listMedications(userId: string): Promise<Medication[]>
  createMedication(userId: string, dto: CreateMedicationDto): Promise<Medication>
  updateMedication(userId: string, id: string, dto: UpdateMedicationDto): Promise<Medication>
  deleteMedication(userId: string, id: string): Promise<{ id: string; deletedAt: Date }>
  getSchedule(userId: string, date?: string): Promise<{ date: string; slots: ScheduleSlotResult[] }>
  logDose(userId: string, medicationId: string, dto: LogDoseDto): Promise<MedicationDoseLog>
  getRefillAlerts(userId: string): Promise<{ alerts: RefillAlertResult[]; okCount: number }>
  requestRefill(userId: string, medicationId: string): Promise<{ requested: true }>
  getStats(userId: string): Promise<MedicationStats>
  registerReminders(userId: string, dto: RegisterRemindersDto): Promise<{ registered: true }>
  unregisterReminders(userId: string): Promise<{ registered: false }>

  // Called by queue processors only — never from a controller
  findDueReminderTargets(now?: Date): Promise<ReminderTarget[]>
  findMedicationsNeedingRefillAlert(): Promise<RefillAlertTarget[]>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `patientId` is never accepted from the request body/query — always resolved from `req.user.sub` via `PatientsService.getMyProfile()`. |
| BR-2 | `patients.medication_list` sync writes only `{name, dosage, frequency, rxnormCode?}` — never the richer fields (condition, prescriber, specialty, refillDate, notes, pill counts). Those fields are copied into the `HMO_CARE`/`CLINICAL_RESEARCH_RECRUITMENT` consent snapshot via `SNAPSHOT_FIELDS`, so widening the synced shape would silently expand what's shared under existing patient consent. |
| BR-3 | `pillsRemaining` only decrements on a genuine PENDING/LATER/SKIPPED → TAKEN transition, never on repeat calls that leave the dose already TAKEN. |
| BR-4 | Dose-log rows are generated lazily and idempotently (`ON CONFLICT DO NOTHING` on `(medication_id, dose_date, scheduled_time)`) the first time a date's schedule is read — no pre-generation cron. |
| BR-5 | Refill urgency thresholds (`urgent` ≤7 days, `upcoming` ≤14 days) match the frontend's client-side `calcUrgency` exactly, so urgency is consistent regardless of which side computes it. |
| BR-6 | `adherenceStreakDays` counts consecutive fully-completed days ending yesterday, plus today only if today is already fully completed. A day with zero scheduled doses breaks the streak. |
| BR-7 | Medications are soft-deleted only (discontinue) — never hard-deleted. |

---

## 7. Dependencies on Other Modules

| Module | Usage | When |
|---|---|---|
| `PatientsModule` | `PatientsService.getMyProfile()` | Every endpoint, to resolve `patientId` |
| `AuditModule` | `AuditService.log({ action: MEDICATION_REFILL_REQUESTED, ... })` | `requestRefill` |
| `NotificationsModule` | `NotificationsService.createOne(REFILL_ALERT)` | `requestRefill`; also called directly by `medication-refill-check.processor.ts` |

---

## 8. Events Emitted or Consumed

Not consumed directly by this module's controller/service — but two BullMQ processors in `QueuesModule` call into `MedicationsService`:

| Queue | Job name | Processor | Action |
|---|---|---|---|
| `notifications` | `medication_reminder_tick` (repeatable, every minute) | `medication-reminder-tick.processor.ts` | Calls `findDueReminderTargets()`, chunks results into ≤200-item batches, enqueues one `send_medication_reminder_email` job per batch |
| `notifications` | `medication_refill_check` (repeatable, daily 07:00) | `medication-refill-check.processor.ts` | Calls `findMedicationsNeedingRefillAlert()`, calls `NotificationsService.createOne(REFILL_ALERT)` per target |
| `mail` | `send_medication_reminder_email` | `send-medication-reminder-email.processor.ts` | Loops the batch calling `MailService.send()` — currently a logging stub, not a real SMTP send |

---

## 9. Known Issues / Follow-up Decisions

> **DECIDED — reminder send step is stubbed.** `MailService.send()` (`src/modules/mail/mail.service.ts`) logs instead of sending real email. No `nodemailer`/SMTP provider is wired up yet. Swapping the body of `send()` for a real provider call is the only change needed to go live.
>
> **DECIDED — refill-check alerts are not deduplicated.** `medication-refill-check.processor.ts` runs daily and will create a new in-app `REFILL_ALERT` notification every day a medication stays in the `urgent`/`upcoming` window, rather than once per urgency-level transition. Acceptable for V1; add a "last alerted" timestamp if this becomes noisy.
>
> ⚠️ `scheduleTimes` values are free-form strings, not a validated enum — the frontend currently only ever sends one of 4 fixed labels (`8:00 AM`, `2:00 PM`, `8:00 PM`, `10:00 PM`). The reminder tick's slot-matching (`SLOT_TIME_LABELS` in `medications.service.ts`) only recognizes those 4 — a medication saved with a different time string will never trigger a reminder, though it will still appear correctly on the schedule/list views (which don't depend on that mapping).
