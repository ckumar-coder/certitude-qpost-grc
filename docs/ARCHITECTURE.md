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
>
> **Section 2 updated 2026-07-23** to describe the admin-configurable
> permissions engine, which was scoped-only when this document was first
> rewritten and has since been fully built and deployed (Phases A–E). See
> the note in Section 2 for details.

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

Today the app has **eight roles**, seeded as built-in rows in the `roles`
table (see "Admin-configurable permissions engine" below):
`Super Admin`, `Admin`, `Risk Champion`, `Risk Owner`, `Risk Manager`,
`CRO`, `Viewer`, `Consultant CRO`.

| Role | Summary |
|---|---|
| Super Admin | Backend-represented as `role: 'Admin'` + `functional_role: 'Super Admin'`. Bypasses every `requireRole()` check unconditionally (see below) and auto-approves its own risk submissions, same as CRO. Seeded at `full` on nearly every capability in the permissions engine (two deliberate exceptions — see below). |
| Admin | Full access to company configuration, users, and (with a couple of narrow, deliberate exceptions — e.g. `risk.create`/`risk.edit`/`risk.approve_manager`, `scoring_methodology.manage`, `horizon.*` — see `docs/SCOPE_NOTES.md`) every module. Also bypasses every `requireRole()` check unconditionally, same as Super Admin. |
| Risk Manager | Department-scoped operational role — manages risks/controls/KRIs/issues/incidents for their department(s). |
| Risk Champion | Submits risks; can only edit their own submissions while still in Draft (not department-wide, and not after submission) until a Risk Manager or above takes ownership. |
| Risk Owner | First-line approver step on the risk workflow; department-scoped. |
| CRO | Enterprise-wide approval authority; final risk acceptance/decline. |
| Consultant CRO | Everywhere the backend checks for `CRO`, an auto-expand rule in `requireRole()` also admits `Consultant CRO` — it inherits CRO's access (mirrored in the permissions engine's seed, capability by capability). Retained permanently (not a removal candidate) so the Qatar Post CRO can draw on a Certitude consultant's assistance post-handover if needed; the Qatar Post Admin controls whether/when a real person is assigned this role. |
| Viewer | Read-only across most modules; a couple of historical nav/backend mismatches (global search, the Audit Log link) were resolved by the permissions engine rollout — see below. |

**Planned change, not yet implemented — Super Admin only:** Super Admin is
retained for now for training purposes, and will be deleted either just
before the app is deployed onto Qatar Post's own server, or immediately
after — timing is Qatar Post's call, confirmed when Phase 3 (on-prem
transfer) actually happens. When that happens, `requireRole()`'s
Admin/Super-Admin bypass logic and every role list throughout `server.js`,
`App.jsx`, and `Layout.jsx` that names Super Admin specifically will need to
be revisited — this is now a much smaller, cleaner change than it would
have been before the permissions engine existed, since most of Super
Admin's access lives in one `roles` table row rather than scattered
role-literal checks (removing the role becomes closer to a row deletion
than a multi-file code change). Consultant CRO is unaffected — it is not
planned for removal, so the CRO/Consultant-CRO auto-expand rule stays as-is
indefinitely. Not done as of this writing — tracked in the parent
project's `CLAUDE.md`.

**Department scoping**: `Risk Champion`, `Risk Owner`, and `Risk Manager`
are the `DEPT_SCOPED_ROLES`. Scoped users see/edit only records in their
department(s) (with business-unit expansion), enforced via
`getManagerDepts()` / `managerScopeClause()` / `managerCanAccess()` in
`server.js` — this internal filtering logic is independent of the
permissions engine's own `own`/`dept`/`full` scope values (see below) and
was deliberately left untouched throughout its rollout. Admin, Super
Admin, CRO, and Consultant CRO see everything. Risk Champion additionally
has an even narrower "own submission" rule on risk edits, checked directly
against `assessed_by` rather than department, and only while the risk is
still in Draft status — editing a submitted risk is Risk Manager/CRO/
Admin/Super Admin territory from that point on.

### 2a. Admin-configurable permissions engine (RBAC)

**Built and fully live as of 2026-07-23.** Every route guard and frontend
page/nav/component gate in the app is now driven by a database-backed
capability model instead of hardcoded role-string comparisons, so Qatar
Post's own Admin can create custom roles and change what any role can
access — without Certitude editing code or redeploying.

**Schema** (`schema_v75_permissions_engine.sql`): three tables —
`roles` (8 built-in rows, plus company-created custom roles), `capabilities`
(81 rows: 79 configurable + 2 non-configurable safety baselines — see
below), and `role_permissions` (the (role × capability) → scope grid, one
row per non-`none` grant). `supports_scope` on a capability marks whether
it can be `own`/`dept` scoped or is `none`/`full`-only.

**Backend primitive** (`server.js`): `can(capabilityKey)` is a
`requireRole()`-style Express middleware — 403s if the resolved scope is
`none`, otherwise sets `req.scope` (`'own'|'dept'|'full'`) and calls
`next()`. `resolveScope()` underneath it queries `role_permissions` (cached
in-process per `companyId::role::capability`, cleared immediately whenever
an Admin saves a change via the admin screen below). Roughly 132 route
guards across every module — KRIs, Risk Register, Controls, Issues,
Obligations, Policies, Org Roles/RACI, Evidence, Incident Log, Horizon
Scanning, Risk Gov. Documents, Scoring Methodology/Risk Appetite, and
Users & Company Admin (Users, Departments, Business Units, Company
Structure, Branding, Email Settings, Risk Configuration) — were migrated
from `requireRole()` to `can()` across ten build batches. A handful of
routes deliberately remain on `requireRole()` where no capability
represents them (e.g. the heatmap-dimensions company setting) or where the
logic is manager-approval-chain business rules rather than a flat
capability (e.g. exactly which risk-workflow transition a role may
perform) — each is commented in place explaining why.

**Frontend**: on login, `getPermissionsMap()` attaches a full capability →
scope map to each company in the session payload
(`session.companies[].permissions`). `Layout.jsx`'s `NAV_ITEMS` and
`App.jsx`'s page-gate chain both resolve visibility from that same map
(`(permissions[key] || 'none') !== 'none'`) instead of role-literal arrays,
and `usePermission(key)` (`AuthContext.jsx`) is the equivalent hook for the
~20 component-level `canX` flags (e.g. "show the Record Test button")
across 17 page/component files. Because nav visibility and page
reachability now read the *identical* key against the *identical* map,
they cannot disagree unless the two files reference different capability
keys for the same page — see `test-routing-audit.js` (root of the repo),
which checks exactly that.

**Two non-configurable safety-baseline capabilities** — `audit_log.view`
and `incident.create` — are hardcoded always-`full` in `can()`'s scope
resolution rather than living in `role_permissions`, so they can never be
misconfigured away from any role, including future custom roles that
otherwise start at zero permissions.

**Admin UI**: a Roles & Permissions screen (`RolesPermissions.jsx`,
`/api/roles*` + `/api/capabilities`) lets Admin view/create roles and edit
the full capability grid, with a lockout guardrail (a save that would leave
the company with zero users able to reach `users.manage` or `roles.manage`
is rejected) and every change written to the Audit Log. See
`docs/API_REFERENCE.md`'s "Roles & Permissions" section for the routes.

Full design rationale, the capability taxonomy, and the phase-by-phase
build/decision record are in
`Documents/Internal/RBAC_Permissions_Engine_Scoping.docx` and the parent
project's `CLAUDE.md` respectively (Certitude-internal, not client-facing).

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
  library). About three dozen page-visibility gates, one per page — almost
  all now a capability check (`can('some.capability')`) against the live
  permissions map rather than a role comparison; see Section 2a.
- `AuthContext.jsx` / `api.js` — session state, the `api` client, idle
  timeout warning, and `usePermission(key)` (the component-level
  equivalent of `App.jsx`'s `can()`, used by ~20 `canX` flags across the
  page/component files).
- `pages/` — one file per screen (30+ files, e.g. `RiskRegister.jsx`,
  `IncidentLog.jsx`, `HorizonScanning.jsx`, `RiskAppetite.jsx`,
  `RiskGovDocs.jsx`, `RolesPermissions.jsx` — the permissions-engine admin
  screen).
- `components/` — shared pieces: `Layout.jsx` (sidebar + shell, holds the
  `NAV_ITEMS` array — capability-driven for all but 3 documented
  exceptions with no matching capability), `TopBar.jsx` (global search +
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
