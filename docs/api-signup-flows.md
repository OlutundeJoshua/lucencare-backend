# API Signup & Onboarding Flows

Reference for all 5 role flows. Base URL: `http://localhost:3000/api` (dev).

---

## 1. Patient Flow

### Step 1 — Signup
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "Password1!",
    "role": "patient"
  }'
```

**Response `201`:**
```json
{
  "data": {
    "accessToken": "<JWT>",
    "user": { "id": "01HZXXX", "name": "Jane Doe", "email": "jane@example.com", "role": "patient", "status": "active" }
  },
  "traceId": "..."
}
```

### Step 2 — Complete Onboarding
```bash
curl -X POST http://localhost:3000/api/auth/onboarding/patient \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "accountType": "patient",
    "dateOfBirth": "1990-05-20",
    "biologicalSex": "female",
    "country": "NG",
    "conditions": "Diabetes, Hypertension",
    "primaryLanguage": "en",
    "termsConsent": true,
    "ngoConsent": true,
    "researchConsent": false
  }'
```

**Response `201`:** Updated patient record.

**Error cases:**
- `422` — termsConsent must be true
- `401` — missing/expired token

---

## 2. NGO Flow

### Step 1 — Signup
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Health Africa Foundation",
    "email": "admin@healthafrica.org",
    "password": "Password1!",
    "role": "ngo"
  }'
```
User created with `status: 'pending'`. Organisation skeleton created with `status: 'pending_verification'`.

### Step 2 — Submit Org Details
```bash
curl -X POST http://localhost:3000/api/auth/onboarding/ngo \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "orgName": "Health Africa Foundation",
    "registrationNumber": "CAC-123456",
    "focusAreas": "Maternal health, HIV/AIDS",
    "website": "https://healthafrica.org",
    "operatingRegions": "Nigeria, Ghana, Kenya",
    "headOfficeCountry": "NG",
    "programDescription": "We fund maternal health programs across West Africa.",
    "termsConsent": true,
    "dataProcessingConsent": true
  }'
```
Admin notification queued. Org profile updated. Admin reviews via `PATCH /admin/organizations/:id`.

---

## 3. HMO Flow

### Step 1 — Signup
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Total Health HMO",
    "email": "coordinator@totalhealthhmo.com",
    "password": "Password1!",
    "role": "hmo"
  }'
```

### Step 2 — Submit HMO Details
```bash
curl -X POST http://localhost:3000/api/auth/onboarding/hmo \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "orgName": "Total Health HMO",
    "licenceNumber": "NHIS-001234",
    "contactPhone": "+234-800-000-0000",
    "coverageRegion": "NG",
    "enrolledPatientCount": "2000-10000",
    "specialtyFocus": "Chronic disease management",
    "baaAcknowledgement": true,
    "termsConsent": true
  }'
```

---

## 4. Professional Flow

### Step 1 — Signup
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dr. Amara Osei",
    "email": "amara.osei@hospital.com",
    "password": "Password1!",
    "role": "professional"
  }'
```

### Step 2 — Submit Application
```bash
curl -X POST http://localhost:3000/api/auth/onboarding/professional \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "profession": "Doctor",
    "licenseNumber": "MDC-2024-001",
    "specialty": "Cardiology",
    "yearsOfExperience": 8,
    "phone": "+233-200-000-000",
    "bio": "Board-certified cardiologist with 8 years of experience in preventive care.",
    "termsConsent": true,
    "codeOfConductConsent": true
  }'
```

### Step 3 — Admin Review
```bash
curl -X PATCH http://localhost:3000/api/admin/applications/professional/<id>/review \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "approve" }'
# → application.status='approved', user.status='active'

# Or reject:
curl -X PATCH http://localhost:3000/api/admin/applications/professional/<id>/review \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "reject", "reason": "License number could not be verified." }'
```

---

## 5. Benefactor Flow

### Step 1 — Signup
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Michael Adeyemi",
    "email": "michael@example.com",
    "password": "Password1!",
    "role": "benefactor"
  }'
```

### Step 2 — Submit Application
```bash
curl -X POST http://localhost:3000/api/auth/onboarding/benefactor \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Michael Adeyemi",
    "phone": "+234-801-000-0000",
    "reasonForSupport": "I want to contribute to improving health outcomes in underserved communities across Africa.",
    "idConsent": true,
    "termsConsent": true,
    "codeOfConductConsent": true
  }'
```

### Step 3 — Admin Review
```bash
curl -X PATCH http://localhost:3000/api/admin/applications/benefactor/<id>/review \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "approve" }'
```

---

## Token Refresh

```bash
curl -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/refresh
# → new accessToken + new refresh cookie
```

## Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer <accessToken>"
# → refresh token revoked in Redis, cookie cleared
```

---

## Common Error Shapes

**Validation error (422):**
```json
{
  "type": "https://lucencare.io/errors/unprocessable-entity",
  "title": "UnprocessableEntityException",
  "status": 422,
  "detail": "Validation failed",
  "traceId": "...",
  "errors": [
    { "path": "termsConsent", "message": "You must accept the terms and privacy policy" }
  ]
}
```

**Auth error (401):**
```json
{
  "type": "https://lucencare.io/errors/unauthorized",
  "title": "UnauthorizedException",
  "status": 401,
  "detail": "Invalid credentials",
  "traceId": "..."
}
```
