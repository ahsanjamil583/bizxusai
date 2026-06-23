# BizXusAI Backend

FastAPI backend for BizXusAI.

## Setup

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env
python -m uvicorn app.main:app --reload
```

## Main Health Endpoints

```text
GET /api/v1/health
GET /api/v1/health/readiness
GET /api/v1/health/demo-accounts
GET /api/v1/health/phase-summary
```

## Demo Data

```bash
python scripts/seed_demo_data.py
```

Creates:

```text
owner@bizxus.demo / Demo@12345
customer@bizxus.demo / Demo@12345
admin@bizxus.demo / Admin@12345
/businesses/demo-bazaar
```

## Tests and Checks

```bash
python -m compileall app tests scripts
python -m unittest discover -s tests -p "test_*.py" -v
python scripts/smoke_check.py http://localhost:8000/api/v1
```

## Backup

```bash
python scripts/backup_mongo.py
```

## Production Notes

```text
APP_ENV=production
DEBUG=false
JWT_SECRET_KEY must be strong
CORS_ORIGINS must be restricted
RATE_LIMIT_ENABLED=true or use gateway-level rate limiting
Use HTTPS and secure MongoDB credentials
```


## Phase 28 Launch APIs

```text
GET  /api/v1/tenants/{tenantId}/launch/status
POST /api/v1/tenants/{tenantId}/launch/apply-profile
POST /api/v1/tenants/{tenantId}/launch/finalize
```


## Phase 29: Phone-first OTP auth

Business owners and customers can now use phone OTP registration, phone OTP login, and phone OTP password reset. In local demo mode, the OTP is returned in the API response and defaults to `123456`. Email/password login remains available as a fallback.


## Phase 30: Final QA APIs

```text
GET  /api/v1/tenants/{tenantId}/qa/checklist
POST /api/v1/tenants/{tenantId}/qa/demo-run
GET  /api/v1/health/phase-summary
```

Use `/dashboard/final-qa` in the frontend for the final supervisor demo checklist and manual QA run recording.


## Phase 31: Submission Center APIs

```text
GET  /api/v1/tenants/{tenantId}/submission/package
GET  /api/v1/tenants/{tenantId}/submission/export
POST /api/v1/tenants/{tenantId}/submission/signoff
GET  /api/v1/health/submission-summary
```

Use `/dashboard/submission-center` in the frontend to review proposal traceability, record final sign-off, and export a safe tenant evidence snapshot.
