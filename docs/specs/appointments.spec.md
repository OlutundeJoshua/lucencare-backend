# Appointments Module Specification

## 1. Module Overview

The Appointments module owns the `Appointment` entity. It handles patient-facing appointment CRUD (book, edit metadata, reschedule, cancel) and aggregate stats for the appointments page/dashboard. It is patient-only — no org or admin role has access to any endpoint in this module. On every successful booking or reschedule, it enqueues a one-shot confirmation email with the appointment details.

---

## 2. Entities Involved

**Owns:**
- `appointments`

**Reads (does not own):**
- `patients` — resolves the caller's `patientId` via `PatientsService.getMyProfile()`.
- `users` — resolves the patient's email for the confirmation email.

---

## 3. DTOs

```typescript
// src/modules/appointments/dto/create-appointment.dto.ts
export class CreateAppointmentDto {
  appointmentDate: string;      // ISO date YYYY-MM-DD
  time: string;                 // display string, e.g. '10:30 AM'
  duration: string;             // display label, e.g. '30 min'
  provider: string;
  specialty: string;
  facility: string;
  type: AppointmentType;
  note?: string;
}

// reschedule-appointment.dto.ts
export class RescheduleAppointmentDto {
  appointmentDate: string;
  time: string;
  duration: string;
  note?: string;
}

// update-appointment.dto.ts — metadata-only partial update, never touches date/time/duration/status
export class UpdateAppointmentDto {
  provider?: string;
  specialty?: string;
  facility?: string;
  type?: AppointmentType;
  note?: string;
}
```

### Response Shapes

```typescript
interface AppointmentResponse { data: Appointment; traceId: string; }
interface AppointmentListResponse { data: Appointment[]; traceId: string; }

interface AppointmentStatsResponse {
  data: { upcoming: number; thisMonth: number; completed: number; cancelled: number };
  traceId: string;
}
```

---

## 4. Endpoints

All endpoints: `Auth: patient role`, JWT `sub` resolves the scoped `patientId` server-side — never accepted from the request.

| Method | Path | Logic | Success | Errors |
|---|---|---|---|---|
| GET | `/appointments` | List all appointments for the caller, ordered by `appointmentDate` ASC | 200 | 401 |
| POST | `/appointments` | Create; `status` always defaults to `CONFIRMED`; enqueues a confirmation email | 201 | 401, 422 |
| GET | `/appointments/stats` | `upcoming`, `thisMonth`, `completed`, `cancelled` counts | 200 | 401 |
| PATCH | `/appointments/:id` | Scoped partial update of `provider`/`specialty`/`facility`/`type`/`note` only | 200 | 401, 404, 422 |
| PATCH | `/appointments/:id/reschedule` | Updates `appointmentDate`/`time`/`duration`/`note`, resets `status` to `CONFIRMED`; re-sends confirmation email | 200 | 401, 404, 409, 422 |
| POST | `/appointments/:id/cancel` | Sets `status` to `CANCELLED` | 200 | 401, 404, 409 |

---

## 5. Service Methods

```typescript
class AppointmentsService {
  listAppointments(userId: string): Promise<Appointment[]>
  createAppointment(userId: string, dto: CreateAppointmentDto): Promise<Appointment>
  updateAppointment(userId: string, id: string, dto: UpdateAppointmentDto): Promise<Appointment>
  rescheduleAppointment(userId: string, id: string, dto: RescheduleAppointmentDto): Promise<Appointment>
  cancelAppointment(userId: string, id: string): Promise<Appointment>
  getStats(userId: string): Promise<AppointmentStatsResult>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `patientId` is never accepted from the request body/query — always resolved from `req.user.sub` via `PatientsService.getMyProfile()`. |
| BR-2 | A newly created appointment always has `status: CONFIRMED` — there is no "pending provider confirmation" flow in this version. |
| BR-3 | `PATCH /appointments/:id/reschedule` and `POST /appointments/:id/cancel` both throw `ConflictException` (409) if the appointment's current status is `CANCELLED` or `COMPLETED` — a finished appointment cannot be rescheduled or re-cancelled. |
| BR-4 | `PATCH /appointments/:id` (metadata edit) has no status guard — correcting the provider/specialty/facility/type/note is allowed regardless of appointment status, since it doesn't represent a state transition. |
| BR-5 | `getStats` counts: `upcoming` = `appointmentDate >= today` (no status filter); `thisMonth` = `upcoming` AND same calendar month/year as today; `completed`/`cancelled` = count by `status`. These match the pre-existing frontend mock's client-side computation exactly, so behavior is unchanged from the user's perspective. |
| BR-6 | A confirmation email is enqueued on both `createAppointment` and `rescheduleAppointment` (not on `updateAppointment` or `cancelAppointment`) — since those two are the actions that set/change the bookable appointment date/time/details a patient would want confirmed by email. |
| BR-7 | Appointments are hard-owned rows, not soft-deleted — there is no delete endpoint; cancellation is a status change, not a removal. |

---

## 7. Dependencies on Other Modules

| Module | Usage | When |
|---|---|---|
| `PatientsModule` | `PatientsService.getMyProfile()` | Every endpoint, to resolve `patientId` |
| `MailModule` (via queue processor) | `MailService.send()` | `send-appointment-confirmation.processor.ts`, triggered by `createAppointment`/`rescheduleAppointment` |

---

## 8. Events Emitted or Consumed

| Queue | Job name | Processor | Action |
|---|---|---|---|
| `mail` | `send_appointment_confirmation` | `send-appointment-confirmation.processor.ts` | Calls `MailService.send()` with the appointment's date/time/provider/specialty/facility. Fires once, at booking or reschedule — it cannot say "in 3 days" because at that moment the appointment may be weeks away |
| `notifications` | `appointment_reminder_tick` (repeatable, `APPOINTMENT_REMINDER_TICK_CRON`, default `*/5 * * * *`) | `appointment-reminder-tick.processor.ts` | Calls `AppointmentsService.findDueReminderTargets()`, chunks into ≤200-item batches, enqueues one `send_appointment_reminder` job per batch |
| `mail` | `send_appointment_reminder` | `send-appointment-reminder.processor.ts` | Sends one reminder per target, picking copy by `AppointmentReminderLead`. Per-target failures are logged and skipped so one bad address cannot drop the rest of the batch |

---

## 9. Known Issues / Follow-up Decisions

> **SUPERSEDED — the send step is no longer stubbed.** `MailService.send()` (`src/modules/mail/mail.service.ts`) sends through `nodemailer` using the `mail.*` config. Delivery failures throw and are caught per target by the reminder processor.
>
> **SUPERSEDED — there is now a reminder-tick processor.** `appointment-reminder-tick.processor.ts` runs on `NOTIFICATIONS_QUEUE` and matches against each patient's own local time, the same shape as the medication reminder tick. Reminders go out at three leads — 3 days before, 1 hour before, and the appointment's own start time — defined in `src/common/constants/appointment-reminder-leads.ts`. The one-shot confirmation on booking/reschedule still exists and is unchanged; the two are different emails.
>
> **Reminder timing rules.** `APPOINTMENT_REMINDER_TICK_CRON` and `APPOINTMENT_REMINDER_WINDOW_MINUTES` are a coupled pair: the window must EQUAL the tick interval, or an appointment falling between two ticks is never reminded (window too small) or is reminded twice (too large). Both default to 5 minutes rather than the medication module's 30 because one lead is the appointment's own start time, where being up to half an hour early would be plainly wrong. Only `CONFIRMED` and `PENDING` appointments are scanned, and status is re-read on each tick so a cancellation always takes effect. An unparseable `time` label is skipped, never guessed at.
>
> ⚠️ `AppointmentType` is a closed 5-value enum (`consultation`, `follow_up`, `lab_test`, `physiotherapy`, `specialist_review`). The frontend maintains its own Title-Case display labels (`'Consultation'`, `'Follow-up'`, etc.) and a bidirectional map between the two — if either side adds/renames a type, the other must be updated in lockstep or the mapper will fail to translate it.
