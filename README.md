# ERM Workstation (Qatar Post) — v2.42.29 (Certitude Advisory Services)

A multi-tenant, role-based, audit-logged Enterprise Risk Management platform
covering the Risk Register, Control Library, KRIs, Policy Repository,
Compliance Obligations, Issues & Actions, Incident Log, Risk Appetite,
Horizon Scanning, Risk Governance Documents, dashboards, bulk import/export,
notifications, bilingual (English/Arabic) UI, and per-client branding.

This is Qatar Post's own isolated fork of Certitude's GRC platform,
rebranded "ERM Workstation." If you're picking this codebase up cold, read
this first, then `docs/ARCHITECTURE.md` and `docs/API_REFERENCE.md`.

> **Documentation status note (2026-07-21):** this file and the rest of
> `docs/` were rewritten on this date to reflect the app as it actually
> stands today. They had previously gone untouched since 2026-06-28, the
> moment this codebase was forked from Certitude's generic platform, and
> described a much earlier, simpler version of the product (3 roles, a
> ~3,600-line `server.js`, no Qatar Post-specific modules). See
> `Documents/Qatar_Post_Documentation_Handover_Tracker.xlsx` (in the parent
> project folder) for the living checklist this rewrite was tracked against.

## Roles today — and a pending change

The app currently has **eight roles**: Super Admin, Admin, Risk Champion,
Risk Owner, Risk Manager, CRO, Consultant CRO, and Viewer (see
`docs/ARCHITECTURE.md` section 2 for what each can do).

**Planned change, not yet made:** Qatar Post and Certitude have agreed that
**Super Admin and Consultant CRO will be deleted and removed from the app
before handover.** Neither role is needed in Qatar Post's own operating
model — Super Admin exists for Certitude's own consulting staff, and
Consultant CRO supports the multi-client consultant benchmarking layer,
neither of which applies once Qatar Post is operating the instance
independently. This has **not been implemented yet** — the code, this
documentation, and the six user manuals all still describe the current
8-role reality. Once the roles are actually removed, this file, the
manuals for those two roles (if any exist), and every place both roles are
named throughout `docs/` will need a follow-up pass. Tracked in the
parent project's `CLAUDE.md` and in the documentation tracker spreadsheet.

## What the platform does

- **Risk Register** — inherent/residual scoring, department-scoped
  submission and approval workflow, mitigation action plans, close/reopen
  with versioning.
- **Control Library** — control testing, test history, linking to risks.
- **KRI Library & Register** — threshold-based key risk indicators with
  measurement history.
- **Policy Repository** — versioned policies, attestation tracking,
  confidential access lists.
- **Compliance Obligations** — regulatory obligation register with status
  history.
- **Issues & Actions** — issue tracking with action items and
  separation-of-duties enforcement.
- **Incident Log** — operational incident capture, linking to risks.
- **Risk Appetite** — statements and thresholds by category.
- **Horizon Scanning** — emerging-risk capture, with an AI-assisted draft
  option.
- **Risk Governance Documents** — charters/terms of reference, stored in
  Postgres (no external object storage dependency).
- **Org Roles (RACI)**, **Compliance Calendar**, **Glossary**, **Audit
  Log**, **Access Matrix** (static reference), **Escalation Rules**,
  **Evidence attachments**, **Data import/export/search**.
- **Reporting** — Management Summary dashboard, PDF and PowerPoint export
  (Risk Management Pack, Accepted Risk Report).
- **Bilingual UI** — English/Arabic toggle for all structured fields, nav,
  and Help content; free-text fields remain English-only by deliberate
  decision (see `docs/SCOPE_NOTES.md`).

**Removed since the original build** (see `docs/SCOPE_NOTES.md` for why):
Business Continuity Management (BCM/BCP), Maturity Assessment, and the
Training Video Library.

## Tech stack

- **Backend**: Node.js + Express (`server.js`, ~10,600 lines), `pg` for
  PostgreSQL, `bcryptjs` for password hashing, `docx`/`pptxgenjs`-style
  export helpers for reports.
- **Database**: PostgreSQL 15. Schema is split into 74 versioned files
  (`schema_v2.sql` ... `schema_v74_remove_maturity_assessment.sql`), each
  idempotent, applied by `migrate-all.js` for fresh installs.
- **Frontend**: React + Vite, built to static files served by Express from
  `/public`. Client-side routing is a `page` string in `App.jsx`, not a
  router library.
- **Sessions**: server-side session tokens (`sessions` table), with a
  sliding inactivity timeout.

## Local setup (fresh install)

```bash
# 1. Install backend dependencies
npm install

# 2. Start Postgres (your own instance, or via docker compose)
docker compose up -d db

# 3. Apply the full schema (skip if using docker compose -- it auto-applies)
node migrate-all.js

# 4. Build the frontend
npm run build:frontend

# 5. Configure environment
cp .env.example .env   # fill in DATABASE_URL, etc.

# 6. Start the server
npm start
```

Bootstrap the first company and Admin user with
`ADMIN_EMAIL=you@example.com bash deploy/migrate-qpost-prod.sh bootstrap`
(or the equivalent non-Qatar-Post script) rather than seeding by hand.

## Running everything with Docker Compose

```bash
docker compose up --build
```

Starts Postgres (full schema auto-applied on first boot, fresh installs
only) and the app (which builds the React frontend as part of its image
build). The same Docker image is what would be handed to Qatar Post for
an on-premises deployment, per `docs/SCOPE_NOTES.md` Phase 3 notes.

## Health check

`GET /healthz` returns `{"status":"ok"}` if the app is up and can reach the
database (used by Cloud Run / load balancers).

## Environment variables

See `.env.example`. Notable ones beyond the standard `DATABASE_URL`,
session-timeout, and lockout settings:
- `DEMO_MODE` — set to `risk-only` to show only the Risk module (used for
  Qatar Post's pre-award demo); unset to unlock all modules.
- `DISABLE_MFA` — set to `true` to skip MFA (used during Qatar Post UAT);
  should be removed once Qatar Post goes live.

## Documentation

- `docs/ARCHITECTURE.md` — architecture overview, role model, ER diagram,
  and a module map from feature to code.
- `docs/API_REFERENCE.md` — endpoint catalog grouped by module, with the
  role required for each.
- `docs/FEATURES.md` — plain-language feature overview, module by module.
- `docs/USER_GUIDE.md` — a lightweight, all-roles overview. For detailed,
  screenshot-based instructions, see the role-specific User Manuals in the
  parent project's `Documents/` folder (Risk Champion today; Admin, CRO,
  and Risk Manager manuals are planned — see the documentation tracker).
- `deploy/README.md` — deployment guide, including the Qatar Post-specific
  scripts in `deploy/`.
- `docs/SCOPE_NOTES.md` — consolidated list of deferred items, known
  limitations, and decisions made across the life of this codebase.

## Project status (as of 2026-07-21)

Qatar Post's instance is in Phase 2 (isolated GCP project, full
infrastructure, demo mode active, MFA disabled) — see the parent project's
`CLAUDE.md` for full deployment-phase tracking. This codebase itself has
had continuous feature work since the original Tier-1 build; `docs/
SCOPE_NOTES.md`'s Qatar Post addendum section is the running log of what's
changed and why.
