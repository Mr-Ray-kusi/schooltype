# Schooltype

A multi-tenant school management system for Ghanaian schools: student and staff records,
QR code attendance, class and report card management, fee collection through Paystack,
bulk SMS and email to parents, and a school wallet with bank and MoMo payouts.

Each school is a tenant. A school admin only ever sees that school's data; a platform
super admin oversees every school, broadcasts, SMS credit, and analytics.

## Layout

| Path | What it is |
| --- | --- |
| `backend/` | Express API. Deployed to Render. |
| `frontend/` | React + Vite single page app. Deployed to Vercel. |
| `database/` | SQL you run once in the Supabase SQL editor to create the schema. |
| `backend/migrations/` | Incremental SQL, each file added by a later feature. |
| `scripts/` | One-off tooling, currently the system-flow PDF generator. |

The root `package.json` only orchestrates the two sub-projects; it has no source of its own.

## Tech stack

**Backend** — Node 24, Express 4, Supabase (Postgres over the HTTPS API, plus the
transaction pooler for write-heavy paths), JWT auth with httpOnly cookies, bcrypt,
Paystack for payments, Twilio for SMS, Nodemailer for email.

**Frontend** — React 19, Vite 8, React Router 7, TailwindCSS, Axios, jsPDF for report
cards and receipts, `@zxing` for QR scanning.

## Prerequisites

- Node.js 22.5 or newer (the backend targets Node 24; Render pins 22)
- A Supabase project
- A Paystack account — new schools are only created after a successful payment, so
  signup cannot be tested without at least test keys
- Optional for full functionality: Twilio (SMS), a Gmail or SMTP account (verification
  email and broadcasts)

## Setup

### 1. Install

```bash
git clone <repository-url>
cd schootype
npm run install:all
```

`install:all` installs the root, backend, and frontend dependencies in one pass.

### 2. Create the database

In the Supabase SQL editor, run these files in order:

1. `database/migrations.sql` — base tables and columns
2. `database/fix_school_approval_columns.sql` — the columns signup and super admin approval need
3. `database/supabase_core_billing.sql` — plans, subscriptions, wallets, fee payments
4. `database/supabase_tenant_privacy.sql` — enables row level security so one school cannot read another
5. `database/supabase_backend_access.sql` — the grants the API needs once RLS is on

Order matters for the last three: the privacy wall has to come after the tables it
protects, and the grants after the wall. Do not disable RLS to work around a permission
error — the anon key plus a JWT carrying `school_id` is the tenancy model.

Then run every file in `backend/migrations/` that your project does not already have.
They are each `ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`, so re-running
one is harmless. `add_performance_indexes.sql` is worth running before any real load.

There is no automatic migration runner. The API applies two columns at boot through the
pooler (`students.gender` and `students.extra_fees`) and nothing else.

### 3. Configure the backend

```bash
cp backend/.env.example backend/.env
```

`backend/.env.example` documents every variable. The ones without a working default:

| Variable | Why it is needed |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Database access. Use the project URL, not a Postgres connection string. |
| `SUPABASE_JWT_SECRET` | Scopes each request to one school. |
| `SUPABASE_DB_URL` | Transaction pooler URL on port 6543, not the direct URI on 5432. Morning attendance scanning is many small writes and will exhaust a direct connection limit. |
| `JWT_SECRET` | Session signing, 32+ characters. The API refuses to issue sessions in production if this is still the default. |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | School signup and parent fee payments. |
| `EMAIL_USER`, `EMAIL_PASSWORD` | Signup verification and broadcasts. |
| `CRON_SECRET` | Locks the subscription reminder endpoint. |

`CORS_ORIGINS` must list every browser origin that calls the API. Unknown origins are
rejected rather than reflected, so a missing entry shows up as a CORS failure in the
browser rather than a server error.

Point the Paystack webhook at `BACKEND_URL/api/webhooks/paystack`.

### 4. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

For local development you can leave `VITE_API_URL` empty — Vite proxies `/api` to
`http://localhost:5000`. In production it must be the full Render URL with no trailing
slash, because the browser calls that host directly.

### 5. Run

```bash
npm run dev
```

This starts the API on port 5000 and the app on port 3000 together. To run one side
alone, use `npm run dev:backend` or `npm run dev:frontend`.

### 6. Create a super admin

Set these in `backend/.env` and restart once:

```
SEED_SUPER_ADMIN=true
DEV_SUPER_ADMIN_EMAIL=you@example.com
DEV_SUPER_ADMIN_PASSWORD=<a strong password>
```

The seed is skipped in production unless `DEV_SUPER_ADMIN_PASSWORD` is set explicitly,
and it refuses the built-in default password there. Turn `SEED_SUPER_ADMIN` back off
afterwards.

School admin accounts are not seeded. They are created through signup, which completes
only after Paystack confirms payment.

## Tests

```bash
npm test
```

Runs both suites. Use `npm run test:backend` or `npm run test:frontend` for one side.

The backend uses the Node test runner and covers the parts where a mistake is expensive:
tenant isolation, money handling, account lockout, plan features, student ID generation,
SMS delivery, and the public endpoints that must not leak parent contact details.

The frontend uses Vitest and covers the pure utilities — extra fee amounts, list
pagination, and report card ranking. Components are not covered yet.

## Deployment

The frontend and backend deploy separately and are configured in the repo:

- **Vercel** builds `frontend/` per `vercel.json`. Set `VITE_API_URL` in the project and
  redeploy — it is baked in at build time, so changing it needs a rebuild.
- **Render** runs the API per `render.yaml`. Every secret is marked `sync: false`, so set
  those in the Render dashboard. Keep `numInstances` at 1 until scanner locks and the API
  cache move into Supabase; the current ones are per-process.

`frontend/dist/` is a build artifact and is not tracked.

## Regenerating the system-flow diagram

```bash
npm run docs:flow
```

Rewrites `SCHOOLTYPE-system-flow.pdf` from `scripts/system-flow-pdf.mjs`.
