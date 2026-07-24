# API Reference

A curated endpoint catalog (not a full OpenAPI spec), grouped by module.
Routes with no role listed are reachable by any authenticated user with an
active company session.

> **Updated 2026-07-23.** As of this update, most routes below are gated by
> `can('some.capability')` reading the database-backed permissions engine
> (`role_permissions` table) rather than a hardcoded `requireRole(...)`
> list — see `docs/ARCHITECTURE.md` section 2a. The "Role" column still
> shows the effective role set, since that's what a reader needs day to
> day, but it now reflects the **current default seed**, which Qatar
> Post's own Admin can change at any time via the Roles & Permissions
> screen (see below) without a Certitude code deploy. If you're checking
> whether a specific role can do something today, the Roles & Permissions
> admin screen is the authoritative live answer; this table is a snapshot.
> A handful of routes remain on literal `requireRole(...)` where no
> capability represents them (a few standalone utility/lookup routes) or
> where the logic is a manager-approval-chain business rule rather than a
> flat capability (exactly which risk/policy workflow transition a role
> may perform) — those are the routes where "Role" still means the old,
> literal sense.
>
> Two rules still apply to whichever routes remain on literal
> `requireRole(...)`, and aren't repeated per row: **Admin and Super Admin
> bypass every `requireRole()` check unconditionally**, and **any
> `requireRole()` list that includes `CRO` automatically also admits
> `Consultant CRO`**. Neither rule is universal for `can()`-gated routes —
> several capabilities deliberately seed Admin at `none` (e.g.
> `risk.create`/`risk.edit`/`risk.approve_manager`,
> `scoring_methodology.manage`, all four `horizon.*` capabilities,
> `ai_settings.manage`) as a real, decided exception to the old blanket
> bypass; those rows call this out explicitly. Super Admin is unaffected
> by any of these exceptions and retains `full` access throughout.

> Rewritten 2026-07-21 from a full route-by-route audit of the current
> `server.js` (~120 distinct routes), replacing the previous version which
> catalogued the original ~3,600-line build. The complete audit, with exact
> line numbers, lives in `Documents/Internal/RBAC_Permissions_Engine_Scoping.docx`
> section 3.1 — this file is the readable summary of it.

## System & auth

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/healthz`, `/api/version` | Public | Liveness + version check |
| GET | `/api/branding` | Public | Pre-login branding lookup |
| \* | `/api/auth/*` (login, logout, me, mfa, change-password, reset, switch-company) | Authenticated | Identity/session actions, not authorization |
| POST | `/api/setup/initialize` | Authenticated | First-time setup only |

## Admin / company settings

| Method | Path | Role |
|---|---|---|
| GET/PUT | `/api/email-settings`, POST `/test` | Admin |
| GET/PATCH | `/api/companies/current/branding` | Admin |
| PUT | `/api/companies/current/profile` | Admin |
| GET/POST/PUT/DELETE | `/api/companies*` | Admin |
| PUT | `/api/users/:id/group-access` | Admin |
| CRUD | `/api/departments*`, `/api/business-units*` | Admin |
| GET | `/api/admin/storage-stats`, `/api/admin/security-log` | Admin |
| DELETE | `/api/admin/evidence/bulk` | Admin |
| GET | `/api/admin/ai-settings` | **Admin, Super Admin only** — narrowed 2026-07-23 to match `ai_settings.manage`'s seed; CRO/Consultant CRO/Risk Manager never actually reached this page via the UI despite the old broader `requireRole()` list, confirmed via `Layout.jsx`/`App.jsx`'s Admin-only gate before narrowing |
| PATCH | `/api/admin/ai-settings` | Admin, Super Admin |

## Risk configuration

| Method | Path | Role |
|---|---|---|
| CRUD | `/api/risk-categories`, `/api/risk-sub-categories` | Admin, Super Admin, CRO, Consultant CRO, Risk Manager — widened 2026-07-23 (`risk_config.manage`, see below) |
| GET | `/api/risk-taxonomy`, `/api/taxonomies/:type` | Public (read) |
| POST | `/api/taxonomies/:type` | Admin, Super Admin, CRO, Consultant CRO, Risk Manager — **Risk Champion lost access** in this same 2026-07-23 change, which widened the shared `risk_config.manage` capability to match this route's broader historical role list rather than narrowing this route to match its stricter sibling routes |
| DELETE | `/api/taxonomies/:type` | Admin, Super Admin, CRO, Consultant CRO, Risk Manager — same `risk_config.manage` widening |
| POST/GET | `/api/matrix/config` | Write: Admin. Read: public |
| GET | `/api/scoring-methodology` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST | `/api/scoring-methodology` | CRO, Consultant CRO only (Admin notably excluded — see `docs/SCOPE_NOTES.md`) |

## Users & Access

| Method | Path | Role |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/users*` | Admin |
| GET | `/api/users/risk-owners` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST | `/api/users/:id/active` | Admin |

## Roles & Permissions (admin-configurable permissions engine)

Admin screen for the `roles` / `capabilities` / `role_permissions` tables
seeded in Phase A (`schema_v75_permissions_engine.sql`). **Fully live as of
2026-07-23** — this is now the authoritative source almost every route in
this document reads from via `can()` (see the note at the top of this
file and `docs/ARCHITECTURE.md` section 2a); it is no longer just an
additive admin screen ahead of enforcement. Changes saved here take effect
on the affected users' very next request (the in-process scope cache is
cleared on save), not just on next login. See
`Documents/Internal/RBAC_Permissions_Engine_Scoping.docx` Section 9.

| Method | Path | Role |
|---|---|---|
| GET | `/api/roles` | Admin |
| POST | `/api/roles` | Admin — creates a custom role, name only, starts at zero permissions |
| GET | `/api/capabilities` | Admin — full catalogue, including non-configurable safety baselines |
| GET | `/api/roles/:id/permissions` | Admin — one role's scope per capability |
| PUT | `/api/roles/:id/permissions` | Admin — bulk save; server enforces the lockout guardrail (refuses to zero out `users.manage`/`roles.manage` company-wide) and writes to the Audit Log |

## Risk Register & Mitigation

| Method | Path | Role |
|---|---|---|
| GET | `/api/risks`, `/api/risks/:id` | List: any session. Detail: Admin, Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| GET | `/api/risks/next-id` | **Admin excluded** — `risk.create` (which this shares) was deliberately narrowed off Admin 2026-07-22 ("Admin is no longer permitted to create or approve risks — role governance v2", previously unenforced due to the old blanket bypass). Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — Risk Owner gained this 2026-07-23 (matches `POST /api/risks` below) |
| POST | `/api/risks` | Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — **Admin excluded**, longstanding business rule, now actually enforced (see `next-id` above) |
| PATCH | `/api/risks/:id` | **Admin excluded** (`risk.edit` = `none` for Admin). Risk Champion — own submission, **and only while still in Draft status**; editing after submission is Risk Manager/CRO/Admin-tier territory. Risk Owner — own department, same Draft-only restriction (gained real edit access 2026-07-23; previously blocked at the outer gate despite dead code already expecting it). Risk Manager — own department, no Draft restriction. Super Admin/CRO/Consultant CRO — full |
| POST | `/api/risks/:id/approve` | Risk Manager, CRO, Consultant CRO |
| POST | `/api/risks/:id/approver-approve`, `/approver-reject` | Risk Owner |
| POST | `/api/risks/:id/manager-reject` | Risk Manager, Admin, CRO, Consultant CRO |
| POST | `/api/risks/:id/close`, `/reopen` | Risk Manager, CRO, Consultant CRO |
| POST | `/api/risks/:id/cro-accept`, `/cro-decline`, `/cro-comment` | CRO, Consultant CRO |
| GET | `/api/risks/pending-cro` | Admin, CRO |
| GET | `/api/departments/without-manager` | CRO, Consultant CRO, Admin |
| GET/POST/DELETE | `/api/risks/:uid/related` | Admin, Risk Manager, Risk Champion, CRO |
| POST/PUT/DELETE | `/api/risks/:id/mitigations`, `/api/mitigations/:id` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO |

## Control Library

| Method | Path | Role |
|---|---|---|
| GET | `/api/controls` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| GET | `/api/controls/next-id` | Admin, Risk Manager, Risk Champion, CRO |
| POST/PATCH | `/api/controls`, `/api/controls/:id` | Admin, Risk Manager, Risk Champion, CRO |
| POST/DELETE | link/unlink to risk, create-and-link | Admin, Risk Manager, Risk Champion, CRO |
| POST | `/api/controls/:id/test` | Admin, Risk Manager, CRO, Consultant CRO |
| GET | `/api/controls/:id/tests` | Admin, Risk Manager, CRO, Consultant CRO, Risk Champion, Risk Owner, Viewer |

## KRI Library & Register

| Method | Path | Role |
|---|---|---|
| GET | `/api/kris/next-id` | Admin, Risk Manager, CRO, Consultant CRO |
| GET | `/api/kris`, `/api/kri-register` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST/PATCH | `/api/kris`, `/api/kris/:id` | Admin, Risk Manager, CRO, Consultant CRO |
| POST | `/api/kris/:id/measurements` | Admin, Risk Manager, CRO, Consultant CRO |

## Org Roles (RACI)

| Method | Path | Role |
|---|---|---|
| GET | `/api/org-roles`, `/api/raci-matrix` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST/PATCH/DELETE | `/api/org-roles*` | Admin, Risk Manager, CRO, Consultant CRO |
| PATCH | `/api/raci-matrix/:id` | Admin, CRO, Consultant CRO |

## Policy Repository

| Method | Path | Role |
|---|---|---|
| GET | `/api/policies` | Any session |
| GET | `/api/policies/:uid/history`, `/:id/attestations` | Admin, Risk Manager, Risk Champion, CRO |
| POST/PATCH | `/api/policies*`, `/:id/new-version` | Admin, Risk Manager, Risk Champion, CRO |
| POST | `/api/policies/:id/transition` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO |
| POST | `/api/policies/:id/attest` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO |
| GET/POST/DELETE | `/api/policies/:id/access` | Admin only |

## Compliance Obligations

| Method | Path | Role |
|---|---|---|
| GET | `/api/obligations` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST/PATCH | `/api/obligations*` | Admin, Risk Manager, CRO, Consultant CRO |
| GET | `/api/obligations/:id/history` | Admin, Risk Manager, Risk Champion, CRO |

## Issues & Actions

| Method | Path | Role |
|---|---|---|
| GET | `/api/issues` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST/PATCH | `/api/issues*` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO |
| GET | `/api/issues/:id/actions` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Viewer |
| POST/PATCH/DELETE | action items | Admin, Risk Manager, Risk Champion, Risk Owner, CRO |

Creator/approver separation-of-duties is enforced by identity comparison
(`created_by`), independent of role, and is not reflected in this table —
see `docs/SCOPE_NOTES.md`.

## Incident Log

| Method | Path | Role |
|---|---|---|
| GET | `/api/incidents` | Admin, Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST | `/api/incidents` | **Every role, including Admin, Super Admin, and Viewer** — `incident.create` is a non-configurable safety-baseline capability (always `full`, cannot be edited away from any role, including future custom roles), deliberately resolving the old "Admin excluded" gap in favor of wide reporting intake / narrow triage |
| PUT | `/api/incidents/:id` | Admin, Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — Viewer excluded (edit stays narrower than create) |
| DELETE | `/api/incidents/:id` | Admin, Super Admin, Risk Manager, CRO, Consultant CRO |
| PATCH | `/:id/link-risk`, `/:id/dismiss` | Admin, Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO |

## Risk Appetite

| Method | Path | Role |
|---|---|---|
| GET | `/api/risk-appetite*` | All 8 roles, including Viewer — restored 2026-07-23 (`risk_appetite.view` is seeded `full` company-wide, and the nav link was already visible to Viewer; this closed a nav/backend mismatch in the access-granting direction, matching a client decision to restore rather than narrow). The orphaned `Approver` role string that used to appear in this list was deleted from the codebase the same day (Finding 4) — it never corresponded to an assignable role |
| POST/DELETE | manage/history | Admin, Super Admin, CRO, Consultant CRO |

## Horizon Scanning

**Narrowed 2026-07-23** to **Super Admin, CRO, Consultant CRO only** across
every route in this module — a real, deliberate access reduction decided
directly by Chandrashekar (after two rounds of correction settling on this
final set), not a mechanical mapping. Admin, Risk Manager, Risk Champion,
and Risk Owner all lost access they previously had (Risk Manager/Risk
Champion/Risk Owner had real access before; Admin's had only ever come
from the general bypass).

| Method | Path | Role |
|---|---|---|
| GET | `/api/horizon-scans` | Super Admin, CRO, Consultant CRO |
| POST/PATCH | create/edit/convert | Super Admin, CRO, Consultant CRO |
| DELETE, `/ai-draft` | Super Admin, CRO, Consultant CRO |

## Risk Governance Documents & Forms

| Method | Path | Role |
|---|---|---|
| GET/POST/DELETE | `/api/risk-gov/*` | Admin, Super Admin, CRO, Consultant CRO, Risk Manager |
| GET | `/api/forms/accepted-risks` | Admin, Super Admin, CRO, Consultant CRO |

## Dashboards, Audit, Evidence, Misc.

| Method | Path | Role |
|---|---|---|
| GET | `/api/dashboard/management-summary` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| GET | `/api/dashboard/my-tasks` | Any session (self-scoped) |
| GET | `/api/audit-log` | **All 8 roles, including Viewer** — `audit_log.view` is a non-configurable safety-baseline capability (always `full`), resolving the old nav/backend mismatch where Viewer saw the sidebar link but got a 403 |
| GET/POST | `/api/evidence/*` | View: Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer. Upload: same minus Viewer. Delete: Admin only |
| GET/POST/PATCH | `/api/escalation-rules*` | Admin, CRO, Consultant CRO |
| GET | `/api/notifications` | Admin, Risk Manager, Risk Champion, CRO |
| GET/POST/DELETE | `/api/glossary*` | View: public. Manage: Admin |
| GET | `/api/calendar` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |

## Import / Export / Search

| Method | Path | Role |
|---|---|---|
| GET/POST | `/api/import/:module*` | Admin, Risk Manager, Risk Champion, CRO |
| GET | `/api/export/:module` | Admin, Risk Manager, Risk Champion, CRO |
| GET/POST | `/api/seed-controls*` | Admin |
| GET | `/api/search` | Admin, Super Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — **Risk Owner gained access 2026-07-23** (`search.global` is scope-aware: full for Admin/Super Admin/CRO/Consultant CRO, dept for Risk Manager, own for Risk Champion/Risk Owner). **Viewer remains excluded** — the one part of this finding not resolved |

## Consultant layer & reference data

| Method | Path | Role |
|---|---|---|
| GET/PATCH | `/api/consultant/*` | Gated by the `is_consultant` account flag, not by role — separate authorization axis |
| GET | `/api/risk-library`, `/api/control-library-ref` | Public — static reference content |

## Common patterns

- **Errors**: `{ "error": "message" }` with an appropriate HTTP status
  (400 validation, 401 auth, 403 role/scope, 404 not found, 423 locked
  account, 503 for `/healthz` DB failure).
- **Pagination**: none of the list endpoints paginate — fine at SME data
  volumes; would need adding if a client's register grows very large.
- **Versioned entities** (`risks`): list/get endpoints return the latest
  version per `risk_uid`; edits currently overwrite in place, with the
  version number only incrementing on Close/Reopen (see
  `docs/ARCHITECTURE.md` section 5).
- **Audit trail**: writes to `audit_log` happen inside the same request as
  the state change, via `logAudit()` — not a separate async process.
- All routes except `/healthz`, `/api/branding`, `/api/auth/*`, and the SPA
  fallback (`*`) require an active session and an active company
  (`req.company`).
- Department-scoped roles (`Risk Champion`, `Risk Owner`, `Risk Manager`)
  are filtered server-side via `managerScopeClause()` wherever a module
  has a `department` field — this doesn't change which routes are
  reachable, only which rows come back.
- For the full audit this table was generated from, including exact line
  numbers and every inconsistency found, see
  `Documents/Internal/RBAC_Permissions_Engine_Scoping.docx`.
