# Matching Module Specification

## 1. Module Overview

The Matching module owns no entities. It is a pure service module that implements the JSONB eligibility engine used by both the patient recommendations flow and the fan-out notification pipeline. It runs all queries against `programs` and `studies` using JSONB operators in SQL — no in-memory filtering. Eligible patient ID lookups are internal-only and never exposed via HTTP.

---

## 2. Entities Involved

**Reads (does not own):**
- `programs` — reads `eligibility_criteria` JSONB for program matching
- `studies` — reads `eligibility_criteria` JSONB for study matching
- `patients` — reads `condition_tags`, `location_state`, `location_lga`, `medication_list` for eligibility evaluation
- `consent_grants` — SQL `EXISTS` subquery checks active consent before returning matches

**Writes:**
- Redis — caches eligible patient counts per program/study after indexing

---

## 3. DTOs

No HTTP-facing DTOs. All methods are internal service calls.

```typescript
// Internal types

interface EligibilityCriterion {
  field: string;       // e.g. 'conditionTags', 'locationState', 'locationLga', 'medicationList'
  operator: 'eq' | 'in' | 'gte' | 'lte' | 'contains';
  value: unknown;
}

interface MatchPreview {
  eligibleCount: number;
  tagSummary: Record<string, number>;   // { conditionTag: patientCount }
}

interface PaginatedPatientIds {
  patientIds: string[];
  nextCursor?: string;
}
```

---

## 4. Endpoints

**None.** The Matching module exposes no HTTP endpoints. All interaction is via service method calls from other modules. `getEligiblePatientIds()` must never be called from a controller.

---

## 5. Service Methods

```typescript
class MatchingService {

  /**
   * Returns approved programs that match the calling patient's profile.
   * Used by GET /recommendations/funding.
   *
   * Query strategy:
   *   SELECT p.*
   *   FROM programs p
   *   WHERE p.status = 'approved'
   *     AND p.expires_at > NOW()
   *     AND p.deleted_at IS NULL
   *     AND EXISTS (
   *       SELECT 1 FROM consent_grants cg
   *       WHERE cg.patient_id = :patientId
   *         AND cg.purpose = 'ngo_funding'
   *         AND cg.status = 'active'
   *     )
   *     AND <eligibility_criteria are matched via JSONB operators against patient fields>
   *     AND p.id > :cursor
   *   ORDER BY p.id ASC
   *   LIMIT :limit + 1
   *
   * Eligibility matching uses JSONB @> operator for containment checks.
   * Consent check is a SQL EXISTS subquery — never a JS filter.
   */
  findMatchingPrograms(
    patientId: string,
    query: { cursor?: string; limit: number }
  ): Promise<{ programs: Program[]; nextCursor?: string }>

  /**
   * Returns approved studies that match the calling patient's profile.
   * Used by GET /recommendations/studies.
   *
   * Same query strategy as findMatchingPrograms but against studies table
   * and checking consent purpose 'clinical_research_recruitment'.
   */
  findMatchingStudies(
    patientId: string,
    query: { cursor?: string; limit: number }
  ): Promise<{ studies: Study[]; nextCursor?: string }>

  /**
   * Returns a paginated list of patient IDs eligible for a given program.
   * Used ONLY by BullMQ fan-out worker — never from any HTTP handler.
   * Calling this method from a controller is a hard violation.
   *
   * Does NOT check consent — consent checking is the responsibility of the
   * enrollment creation step. Fan-out sends notifications to all eligible
   * patients; patients without active consent will simply not be able to enroll.
   *
   * Query:
   *   SELECT pa.id
   *   FROM patients pa
   *   WHERE <eligibility_criteria JSONB match>
   *     AND pa.deleted_at IS NULL
   *     AND pa.id > :cursor
   *   ORDER BY pa.id ASC
   *   LIMIT 200
   */
  getEligiblePatientIds(
    programId: string,
    cursor?: string
  ): Promise<PaginatedPatientIds>

  /**
   * Computes and caches the eligible patient count for a program.
   * Called by AdminModule/ProgramsModule after a program is approved.
   * Stores result in Redis: SET match:program:{programId}:count {count} EX 3600
   *
   * Also computes tagSummary:
   *   For each eligible patient, aggregate their condition_tags and count occurrences.
   *   Store in Redis: SET match:program:{programId}:tags {json} EX 3600
   */
  indexProgram(programId: string): Promise<void>

  /**
   * Computes and caches the eligible patient count for a study.
   * Called by AdminModule/StudiesModule after a study is approved.
   * Stores: match:study:{studyId}:count and match:study:{studyId}:tags in Redis.
   */
  indexStudy(studyId: string): Promise<void>

  /**
   * Returns the cached match preview for a program.
   * Used by ProgramsService.getMatchPreview().
   * Reads from Redis cache: match:program:{programId}:count and :tags
   * If cache miss: recomputes and stores (lazy re-index).
   * Never returns patient IDs.
   */
  getMatchPreview(programId: string): Promise<MatchPreview>

  /**
   * Returns the cached match preview for a study.
   * Used by StudiesService (future) or AdminModule.
   */
  getStudyMatchPreview(studyId: string): Promise<MatchPreview>

  /**
   * Builds the SQL WHERE clause fragment from an array of EligibilityCriterion.
   * Used internally by findMatchingPrograms, findMatchingStudies, getEligiblePatientIds.
   *
   * Field-to-column mapping:
   *   conditionTags  → patients.condition_tags (text[]) — uses && for 'in', @> for 'contains'
   *   locationState  → patients.location_state (text)   — uses = for 'eq'
   *   locationLga    → patients.location_lga (text)     — uses = for 'eq'
   *   medicationList → patients.medication_list (jsonb)  — uses @> for 'contains'
   *
   * NEVER evaluates criteria in JavaScript. All filtering is in SQL.
   */
  private buildCriteriaWhere(
    criteria: EligibilityCriterion[],
    alias: string
  ): { sql: string; params: Record<string, unknown> }
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | `getEligiblePatientIds()` must NEVER be called from any HTTP controller or in response to any HTTP request. It is called exclusively from BullMQ processors. |
| BR-2 | All eligibility filtering must happen inside the SQL query using JSONB operators (`@>`, `&&`). No JavaScript-level filtering of fetched records. A JS filter is a silent privacy violation — it could expose records the SQL should have excluded. |
| BR-3 | The consent `EXISTS` check in `findMatchingPrograms` and `findMatchingStudies` must be inside the SQL query, not a separate round-trip check. |
| BR-4 | `getMatchPreview()` must never return patient IDs, names, or any individually identifying information. Only `eligibleCount` (integer) and `tagSummary` (aggregated counts). |
| BR-5 | Fan-out uses `getEligiblePatientIds()` without a consent check. The intent is to notify patients about programs they might be eligible for — the enrollment step enforces consent. Do not add consent checking to this method. |
| BR-6 | Pagination in `getEligiblePatientIds()` uses a chunk size of exactly 200. The fan-out processor enqueues one batch job per page of 200 patient IDs. Never increase this limit without evaluating Redis queue impact. |
| BR-7 | The field-to-column mapping in `buildCriteriaWhere()` must exactly match the patient entity's column names. Any deviation silently returns wrong results. |
| BR-8 | Redis cache keys for indexed counts have a 1-hour TTL. On cache miss in `getMatchPreview()`, recompute and cache. Stale counts are acceptable — they are estimates, not guarantees. |

---

## 7. Dependencies on Other Modules

None. MatchingModule reads directly from DB tables without injecting other services. It does not call into ProgramsModule, StudiesModule, or ConsentsModule via their services — it queries the underlying tables directly using injected TypeORM repositories.

**Repositories injected:**
- `Repository<Program>`
- `Repository<Study>`
- `Repository<Patient>`
- `Repository<ConsentGrant>`

---

## 8. Events Emitted or Consumed

None. MatchingModule is called synchronously by other services and by BullMQ processors. It does not emit or consume queue events.

---

## 9. Open Questions or Ambiguities

> ⚠️ The JSONB eligibility matching for `medicationList` (an array of objects with `name`, `rxnormCode`, etc.) is more complex than `conditionTags` (a simple text array). The `@>` operator on a JSONB array of objects matches if the left side contains all items from the right side — but partial matching on nested fields (e.g., "medication with rxnormCode X") requires a more sophisticated query. Clarify the expected matching semantics for `medicationList` before implementing `buildCriteriaWhere` for that field.

> ⚠️ The `tagSummary` in `MatchPreview` is computed by aggregating `condition_tags` across all eligible patients. This is potentially an expensive query on large patient tables. Confirm whether this should always be computed fresh or always read from Redis cache only (refusing to serve stale data).
