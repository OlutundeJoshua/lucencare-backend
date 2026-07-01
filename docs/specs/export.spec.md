# Export Module Specification

## 1. Module Overview

The Export module owns the export token lifecycle and PDF generation. It generates single-use RS256 export tokens backed by Redis jti, validates and atomically consumes tokens on use, and builds patient health data PDFs for HMO coordinators. Every export action writes a mandatory audit log entry.

---

## 2. Entities Involved

**Owns (Redis, not DB):**
- `export:{jti}` — Redis key, TTL matching the token's expiry; value `"1"`

**Reads (does not own):**
- `patients` — reads health data to build PDF
- `care_events` — included in PDF export
- `enrollments` — optionally included in PDF

**Writes (via AuditService):**
- `audit_log` — mandatory entry on every export

---

## 3. DTOs

```typescript
// src/modules/export/dto/create-token.dto.ts
export const CreateTokenSchema = z.object({
  purpose: z.literal('pdf_export'),
  patientId: z.string().length(26),    // ULID — must be within coordinator's org scope
  ttl: z.number().int().min(30).max(120),  // seconds
});
export type CreateTokenDto = z.infer<typeof CreateTokenSchema>;
```

### Response Shapes

```typescript
interface ExportTokenResponse {
  data: {
    token: string;          // signed RS256 JWT — single-use
    expiresIn: number;      // TTL in seconds (echoes the requested ttl)
    expiresAt: string;      // ISO 8601 datetime
  };
  traceId: string;
}
```

**Export token JWT payload:**
```typescript
interface ExportTokenPayload {
  sub: string;                    // userId of the requesting coordinator (NOT orgId)
  role: 'hmo_coordinator';        // embedded so JwtAuthGuard can validate role claim
  orgId: string;                  // coordinator's orgId — used by controller for scope check
  patientId: string;              // ULID — the patient this token grants access to
  jti: string;                    // ULID — unique token ID stored in Redis
  purpose: 'pdf_export';
  iat: number;
  exp: number;
}
```

> **Design rationale:** The export token IS the bearer credential for `GET /patients/:id/summary`. It is placed in `Authorization: Bearer` and validated by the standard `JwtAuthGuard` (same RS256 key). For this to work, the token must contain `sub` (userId), `role`, and `orgId` claims — the same fields that a session access JWT has. The controller extracts `user.orgId` from the decoded token payload for scope checking. Without `role` and `orgId`, `RoleGuard` and `@CurrentUser()` would break for this endpoint.

---

## 4. Endpoints

### `POST /tokens`
- **Auth:** `hmo_coordinator` role
- **Request body:** `CreateTokenDto`
- **Logic:**
  1. Verify `patients.hmo_id = req.user.orgId` — throw `403` if patient not in org scope
  2. Generate `jti = ulid()`
  3. Sign JWT with RS256 private key: payload = `{ sub: userId, role: 'hmo_coordinator', orgId, patientId, jti, purpose: 'pdf_export', exp: now + ttl }`
  4. Store in Redis: `SET export:{jti} "1" EX {ttl}`
  5. Return token + expiresIn
- **Success:** `201 ExportTokenResponse`
- **Errors:**
  - `401`, `403` — patient not in org scope
  - `404` — patient not found
  - `422` — validation failure (class-validator) — ttl out of range
  - `429` — rate limit exceeded (5 req / 60 s / orgId)

---

## 5. Service Methods

```typescript
class ExportTokenService {

  /**
   * Generates a single-use export token for a specific patient.
   * Verifies the patient is within the coordinator's org scope.
   * Generates jti = ulid().
   * Signs JWT with RS256 private key.
   * Stores jti in Redis with matching TTL.
   * Returns the signed token string.
   * Throws ForbiddenException if patients.hmo_id !== orgId.
   * Throws NotFoundException if patient not found.
   */
  generateToken(orgId: string, dto: CreateTokenDto): Promise<ExportTokenData>

  /**
   * Validates and atomically consumes an export token.
   * Called by PatientsModule before serving /patients/:id/summary.
   *
   * Steps:
   *   1. Verify JWT signature (RS256 public key) — throws UnauthorizedException if invalid
   *   2. Check JWT expiry — throws UnauthorizedException if expired
   *   3. Verify purpose === 'pdf_export' — throws UnauthorizedException if wrong purpose
   *   4. Execute: result = await redis.getdel(`export:{jti}`)
   *      - If result is null: token already used or never existed → throw UnauthorizedException
   *      - If result is "1": token is valid and has been consumed (atomic single-use)
   *   5. Return the decoded payload
   *
   * ATOMICITY: redis.getdel() is the only acceptable pattern.
   * Do NOT use GET + DEL as two separate commands — that is not atomic.
   */
  validateAndConsume(token: string): Promise<ExportTokenPayload>
}
```

```typescript
class ExportService {

  /**
   * Builds the patient PDF summary.
   * Called after ExportTokenService.validateAndConsume() succeeds.
   * Reads: patient profile, care events, active enrollments.
   * Writes audit log: AuditAction.EXPORT, resourceId = patientId, metadata = { orgId, exportedFields }
   *
   * The audit log MUST be written even if the PDF build fails.
   * If PDF build fails after audit log is written, return a 500 — the audit record stays.
   *
   * Returns the assembled data for PDF rendering (or the PDF binary, depending on implementation).
   */
  buildExportPayload(patientId: string, orgId: string): Promise<PatientExportData>
}
```

---

## 6. Business Rules

| # | Rule |
|---|---|
| BR-1 | Export tokens are single-use. `redis.getdel()` provides atomic check-and-delete in one command. A second use of the same token returns `null` from Redis → `UnauthorizedException`. |
| BR-2 | `redis.getdel()` is the ONLY acceptable Redis operation for token consumption. `GET` + `DEL` as two commands is not atomic and creates a race condition where the same token could be used twice. |
| BR-3 | The audit log entry for EXPORT must be written before returning the patient data. If the audit write fails, the entire export request fails — an unaudited export is a security violation. |
| BR-4 | The audit log entry is written even if the subsequent PDF build step fails. The fact that the token was redeemed and access was granted must be recorded regardless of what happens next. |
| BR-5 | Export tokens can only be generated for patients within the coordinator's org scope (`patients.hmo_id = req.user.orgId`). Cross-org token generation is rejected with `403` and logged as `CROSS_ORG_ATTEMPT`. |
| BR-6 | TTL range is 30–120 seconds. This is intentionally short — export tokens are meant for immediate use (one request), not stored or forwarded. |
| BR-7 | The export JWT replaces the session JWT as the bearer credential for `GET /patients/:id/summary`. It is placed in `Authorization: Bearer` and validated by `JwtAuthGuard` (same RS256 keypair). The export token payload must include `sub` (userId), `role`, and `orgId` so the guard and role check pass normally. The controller additionally calls `ExportService.validateAndConsumeToken()` for Redis jti single-use enforcement. The coordinator obtains the export token by calling `POST /tokens` with their session JWT; they then use the export token for the summary request. |
| BR-8 | The `jti` is a ULID (not UUID v4). It follows the platform ID strategy and is sortable by generation time. |

---

## 7. Dependencies on Other Modules

| Module | Method | When |
|---|---|---|
| `AuditModule` | `AuditService.log({ action: EXPORT, resourceId: patientId, ... })` | Inside `buildExportPayload()` |
| `PatientsModule` | Called by — not calling. `ExportService` is invoked by PatientsService. | — |

---

## 8. Events Emitted or Consumed

None. Export module has no queue involvement.

---

## 9. Open Questions or Ambiguities

> ⚠️ `buildExportPayload()` returns `PatientExportData` — a structured object. The architecture does not specify whether the PDF is generated server-side (returns a binary blob / S3 URL) or whether the client renders the PDF from the structured data. Decide before implementing: server-side PDF generation (e.g., Puppeteer, PDFKit) vs client-side rendering of structured JSON.

> ⚠️ The RS256 keys for export tokens — are they the same RS256 keypair used for access tokens, or a separate keypair? Using the same keypair simplifies key management but means a leaked access token private key also compromises export tokens. Recommend separate keypairs.
