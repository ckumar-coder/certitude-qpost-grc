# Architecture Overview

This document is the technical handover reference for the ERM Workstation
(Qatar Post's branded fork of Certitude's GRC platform): how the system is
put together, how data flows through it, and where each feature lives in
the codebase. Pair this with `API_REFERENCE.md` (endpoint catalog) and
`deploy/README.md` (deployment).

> Rewritten 2026-07-21 to reflect the app as it stands today. The previous
> version of this document was frozen at the 2026-06-28 fork point and
> described a ~3,600-line `server.js` with a 3-role model — see
> `docs/SCOPE_NOTES.md` for the full history of what's changed since.

## 1. Tech stack

- **Backend**: Node.js + Express (`server.js`, ~10,600 lines), `pg` for
  PostgreSQL access, `bcryptjs` for password hashing, `docx` for Word
  export, a `pptxgenjs`-based helper for PowerPoint export (Risk
  Management Pack, Accepted Risk Report).
- **Database**: PostgreSQL 15. Schema is split into 74 versioned files
  (`schema_v2.sql` through `schema_v74_remove_maturity_assessment.sql`),
  each idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT
  EXISTS`), applied in order by `migrate-all.js` for fresh installs or by
  the Qatar Post-specific `deploy/migrate-qpost-prod.sh` for this instance.
- **Frontend**: React + Vite, built to static files served by Express from
  `/public`. No server-side rendering — a single-page app with
  client-side routing handled in `App.jsx` (a `page` string state, not a
  router library). 62 files under `frontend/src/`.
- **Sessions**: server-side session tokens (`sessions` table), not JWTs —
  enforces a sliding inactivity timeout and allows immediate revocation on
  lockout or logout.
- **Language**: bilingual English/Arabic UI via a `{en, ar}` translation
  pattern (`translations.js`, `help-content.js`); RTL layout switches with
  the language toggle. Free-text fields (risk descriptions, comments,
  mitigation plans) remain English-only by deliberate decision — see
  `docs/SCOPE_NOTES.md`.

## 2. Role model

Today the app has **eight roles**, defined in `UserManagement.jsx`'s
`ROLES` constant: `Super Admin`, `Admin`, `Risk Champion`, `Risk Owner`,
`Risk Manager`, `CRO`, `Viewer`, `Consultant CRO`.

| Role | Summary |
|---|---|
| Super Admin | Backend-represented as `role: 'Admin'` + `functional_role: 'Super Admin'`. Bypasses every `requireRole()` check unconditionally (see below) and auto-approves its own risk submissions, same as CRO. |
| Admin | Full access to company configuration, users, and (with a couple of narrow, likely-unintentional exceptions — see `docs/SCOPE_NOTES.md`) every module. Also bypasses every `requireRole()` check unconditionally, same as Super Admin. |
| Risk Manager | Department-scoped operational role — manages risks/controls/KRIs/issues/incidents for their department(s). |
| Risk Champion | Submits risks; can only edit their own submissions (not department-wide) until a Risk Manager or above takes ownership. |
| Risk Owner | First-line approver step on the risk workflow; department-scoped. |
| CRO | Enterprise-wide approval authority; final risk acceptance/decline. |
| Consultant CRO | Everywhere the backend checks for `CRO`, an auto-expand rule in `requireRole()` also admits `Consultant CRO` — it inherits CRO's access. Exists to support Certitude's multi-client consultant benchmarking layer. |
| Viewer | Read-only across most modules; excluded from a few (global search, notifications — see `docs/SCOPE_NOTES.md` for known inconsistencies). |

**Planned change, not yet implemented:** Super Admin and Consultant CRO are
slated for deletion prior to Qatar Post handover (neither role fits Qatar
Post's own operating model). When that happens, `requireRole()`'s
Admin/Super-Admin bypass logic, the CRO/Consultant-CRO auto-expand rule,
and every role list throughout `server.js`, `App.jsx`, and `Layout.jsx`
that names either role will need to be revisited. Not done as of this
writing — tracked in the parent project's `CLAUDE.md`.

**Department scoping**: `Risk Champion`, `Risk Owner`, and `Risk Manager`
are the `DEPT_SCOPED_ROLES`. Scoped users see/edit only records in their
department(s) (with business-unit expansion), enforced via
`getManagerDepts()` / `managerScopeClause()` / `managerCanAccess()` in
`server.js`. Admin, Super Admin, CRO, and Consultant CRO see everything.
Risk Champion additionally has an even narrower "own submission" rule on
risk edits, checked directly against `assessed_by` rather than department.

A full, code-verified audit of every place a role decision is made today
— all ~120 backend routes, all frontend page/nav/component gates, and the
inconsistencies the audit surfaced — is in
`Documents/Internal/RBAC_Permissions_Engine_Scoping.docx` (Certitude
internal; scopes a proposed admin-configurable permissions engine so
Qatar Post can manage roles without code changes post-handover — not yet
built).

## 3. Multi-tenancy model

"One application instance per client" is implemented as one deployed app +
one database per client; within that database every business table
carries a `company_id`. A client's subsidiaries are separate rows in
`companies`, sharing the same instance. Qatar Post's instance
(`certitude-qpost`) is fully isolated from Certitude's own staging/
production project.

- `users` are global to the instance (one email = one user record).
- `user_companies` is the join table granting a user a role, optional
  department scope, optional business-unit scope, and optional
  `functional_role` label, *per company*.
- On login, if a user has access to exactly one company, that company is
  auto-selected; otherwise they see a company picker.

## 4. Authentication & sessions

- Email + password, bcrypt-hashed, with a configurable password policy,
  reuse prevention, forced rotation, and account lockout after repeated
  failed attempts.
- `createSession` / `touchSession` / `destroySession` in `auth.js`
  centralize session lifecycle.
- MFA exists in the codebase and is currently disabled for Qatar Post via
  `DISABLE_MFA=true` (demo/UAT convenience) — see `deploy/README.md`'s
  "When Qatar Post is awarded" checklist for re-enabling it.

## 5. Data model — current modules and their core tables

This supersedes the earlier ER diagram, which only covered the original
Tier-1 module set. Rather than one unreadable diagram, tables are grouped
by module:

| Module | Core tables |
|---|---|
| Risk Register & Mitigation | `risks`, `mitigations` |
| Control Library | `controls_lib`, `control_tests`, `risk_controls` |
| KRIs | `kris`, `kri_measurements`, `risk_kris`, `control_kris` |
| Policy Repository | `policies`, `policy_attestations`, `policy_risks`, `policy_controls` |
| Compliance Obligations | `compliance_obligations`, `obligation_status_history`, `obligation_*` link tables |
| Issues & Actions | `issues`, `issue_actions`, `issue_*` link tables |
| Incident Log | `incidents` |
| Risk Appetite | `risk_appetite_statements` (schema v60) |
| Horizon Scanning | `horizon_scans` (schema v61) |
| Risk Governance Documents | `risk_gov_docs`, stored as embedded bytea/base64 in Postgres, not GCS (schema v72 — migrated off object storage) |
| Org Roles (RACI) | `org_roles`, `raci_matrix` (schema v57) |
| Evidence | `evidence_attachments` |
| Escalation Rules | `escalation_rules` |
| Users & Companies | `users`, `user_companies`, `companies`, `departments`, `business_units` |
| Audit Trail | `audit_log` (generic, append-only, every module logs here) |
| Risk Library (reference seed) | `risk_library` — 107 risks across 18 sectors, schema v70 |

Removed since the original build (tables dropped, code removed):
Business Continuity Management (`schema_v73_remove_bcm_module.sql`) and
Maturity Assessment (`schema_v74_remove_maturity_assessment.sql`). The
Training Video Library was removed at the application layer without a
schema migration.

Versioned entities (`risks`) still follow the original G10-style pattern:
edits overwrite in place; the version number only increments on
Close/Reopen (a deliberate simplification from full draft-versioning —
see `docs/SCOPE_NOTES.md`).

## 6. Frontend structure

`frontend/src/`:
- `App.jsx` — top-level routing (a `page` string + `onNavigate`, no router
  library). About two dozen page-visibility gates, one per page, each a
  role comparison.
- `AuthContext.jsx` / `api.js` — session state, the `api` client, idle
  timeout warning.
- `pages/` — one file per screen (30+ files, e.g. `RiskRegister.jsx`,
  `IncidentLog.jsx`, `HorizonScanning.jsx`, `RiskAppetite.jsx`,
  `RiskGovDocs.jsx`).
- `components/` — shared pieces: `Layout.jsx` (sidebar + shell, holds the
  `NAV_ITEMS` role-visibility array), `TopBar.jsx` (global search +
  notifications), `DepartmentField.jsx`, `EvidenceAttachments.jsx`,
  `scoreBadge.js`.
- `translations.js` / `help-content.js` — the `{en, ar}` bilingual content
  source, consumed via `useLanguage()` / `useT()`.
- `data/changelog.json` — in-app "what's new" feed shown to end users
  (not a substitute for this document or git history).

## 7. Cross-cutting concerns

- **Audit trail**: `logAudit()` in `auth.js` writes to `audit_log` on
  every meaningful state change. Nothing is deleted or overwritten by
  application code.
- **CSV helper (`csv.js`)**: hand-written parser/stringifier used by bulk
  import and export — no external CSV dependency.
- **Reporting exports**: PDF (browser print) and PowerPoint (`pptxgenjs`,
  with a shared branded slide master) for the Risk Management Pack and
  Accepted Risk Report. The PPTX path handles both external-URL and
  base64 `data:` URI branding logos (Qatar Post's logo is stored as the
  latter).
- **Health check**: `GET /healthz` checks DB connectivity.
- **Demo mode**: `DEMO_MODE=risk-only` hides the Governance and Compliance
  nav groups entirely for every role — a deployment-level toggle, not a
  permission (see `Documents/Internal/RBAC_Permissions_Engine_Scoping.docx`
  section 3.5 for why this is kept separate from the role model).
