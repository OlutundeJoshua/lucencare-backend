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
| `mail` | `send_appointment_confirmation` | `send-appointment-confirmation.processor.ts` | Calls `MailService.send()` with the appointment's date/time/provider/specialty/facility — currently a logging stub, not a real SMTP send (same as the medications module's reminder email) |

---

## 9. Known Issues / Follow-up Decisions

> **DECIDED — confirmation email send step is stubbed.** `MailService.send()` (`src/modules/mail/mail.service.ts`) logs instead of sending real email, same as every other mail job in this codebase. No `nodemailer`/SMTP provider is wired up yet.
>
> **DECIDED — no recurring reminder-tick processor.** Unlike medications, this module does not run a repeating cron job matching against a patient's local time-of-day. The one-shot confirmation email on booking/reschedule is the only automated communication for appointments in this version.
>
> ⚠️ `AppointmentType` is a closed 5-value enum (`consultation`, `follow_up`, `lab_test`, `physiotherapy`, `specialist_review`). The frontend maintains its own Title-Case display labels (`'Consultation'`, `'Follow-up'`, etc.) and a bidirectional map between the two — if either side adds/renames a type, the other must be updated in lockstep or the mapper will fail to translate it.
