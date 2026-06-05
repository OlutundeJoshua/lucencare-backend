# Recommendations Module Specification

## 1. Module Overview

The Recommendations module exposes two patient-facing HTTP endpoints that return approved programs and studies matching the calling patient's profile. It owns no entities — it delegates entirely to `MatchingService`. Consent checking is embedded inside the SQL query, not as a pre-flight check. This module may be implemented as a dedicated `RecommendationsController` inside `MatchingModule` or as a standalone thin controller that injects `MatchingService`.

---

## 2. Entities Involved

**Reads (via MatchingService, which queries directly):**
- `programs`
- `studies`
- `patients`
- `consent_grants`

---

## 3. DTOs

No dedicated request DTOs beyond the shared `PaginationDto`.

```typescript
// Reuses common pagination DTO
interface RecommendationQueryDto {
  cursor?: string;    // ULID of last seen item
  limit?: number;     // default 20, max 50
}
```

### Response Shapes

```typescript
interface FundingRecommendationItem {
  id: string;
  orgId: string;
  title: string;
  type: ProgramType;
  status: 'approved';        // always 'approved' — only approved programs returned
  eligibilityCriteria: Array<{ field: string; operator: string; value: unknown }>;
  expiresAt: string;
  createdAt: string;
}

interface StudyRecommendationItem {
  id: string;
  researcherId: string;
  title: string;
  status: 'approved';
  eligibilityCriteria: Array<{ field: string; operator: string; value: unknown }>;
  infoSheetUrl: string;
  targetCount: number;
  compensationDetails?: string;
  createdAt: string;
}

interface FundingRecommendationsResponse {
  data: FundingRecommendationItem[];
  meta: { cursor?: string; limit: number };
  traceId: string;
}

interface StudyRecommendationsResponse {
  data: StudyRecommendationItem[];
  meta: { cursor?: string; limit: number };
  traceId: string;
}
```

---

## 4. Endpoints

### `GET /recommendations/funding`
- **Auth:** `patient` role
- **Query params:** `?cursor=<ULID>&limit=<number>`
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` → `patients.id`
  2. Call `MatchingService.findMatchingPrograms(patientId, { cursor, limit })`
  3. The SQL query inside `findMatchingPrograms` includes:
     - `programs.status = 'approved'`
     - `programs.expires_at > NOW()`
     - `EXISTS (SELECT 1 FROM consent_grants WHERE patient_id = :patientId AND purpose = 'ngo_funding' AND status = 'active')` — inside the SQL, not a separate call
     - JSONB eligibility criteria matched against the patient's fields
  4. Return paginated results
- **Success:** `200 FundingRecommendationsResponse`
- **Errors:**
  - `401` — missing/invalid JWT
  - `403` — caller is not a patient

---

### `GET /recommendations/studies`
- **Auth:** `patient` role
- **Query params:** `?cursor=<ULID>&limit=<number>`
- **Logic:**
  1. Resolve `patientId` from `req.user.sub` → `patients.id`
  2. Call `MatchingService.findMatchingStudies(patientId, { cursor, limit })`
  3. The SQL query inside `findMatchingStudies` includes:
     - `studies.status = 'approved'`
     - `EXISTS (SELECT 1 FROM consent_grants WHERE patient_id = :patientId AND purpose = 'clinical_research_recruitment' AND status = 'active')`
     - JSONB eligibility criteria matched against patient fields
  4. Return paginated results
- **Success:** `200 StudyRecommendationsResponse`
- **Errors:**
  - `401`, `403`

---

## 5. Service Methods

No service methods owned by this module. All logic lives in `MatchingService.findMatchingPrograms()` and `MatchingService.findMatchingStudies()` — see matching.spec.md for full method signatures.

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | The consent existence check (`EXISTS (SELECT 1 FROM consent_grants ...)`) must be inside the SQL query — never a pre-flight `hasActiveGrant()` call followed by a separate query. A JS filter could silently expose records if the pre-flight check has a bug. |
| BR-2 | Only programs with `status = 'approved'` AND `expires_at > NOW()` are returned. Expired programs are excluded at query time — there is no sweeper in V1. |
| BR-3 | Patients with no active consent grant for the relevant purpose will see an empty results list (the `EXISTS` subquery returns false for all programs/studies) — they do NOT receive a `403`. Empty results is the correct behaviour. |
| BR-4 | `eligibilityCriteria` is returned in the response so patients can understand why they matched. No internal data (org IDs, researcher IDs beyond what is already in the schema) is exposed. |
| BR-5 | Keyset pagination is used: `id > cursor ORDER BY id ASC`. Default page size: 20. Maximum: 50. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `MatchingModule` | `MatchingService.findMatchingPrograms(patientId, query)` | `GET /recommendations/funding` |
| `MatchingModule` | `MatchingService.findMatchingStudies(patientId, query)` | `GET /recommendations/studies` |

---

## 8. Events Emitted or Consumed

None.

---

## 9. Open Questions or Ambiguities

> ⚠️ A patient with no active `ngo_funding` consent will receive an empty list from `GET /recommendations/funding`, not a `403`. This may be confusing UX — the patient sees no programs but gets no explanation. Consider whether the response should include a `meta.consentRequired: true` flag when consent is absent, so the frontend can prompt the patient to grant consent.
