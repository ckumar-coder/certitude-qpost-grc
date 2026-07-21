# API Reference

A curated endpoint catalog (not a full OpenAPI spec), grouped by module.
"Role" is the minimum `requireRole(...)` today — routes with no role
listed are reachable by any authenticated user with an active company
session. Two rules apply everywhere and aren't repeated per row: **Admin
and Super Admin bypass every role check unconditionally**, and **any list
that includes `CRO` automatically also admits `Consultant CRO`** via an
auto-expand rule inside `requireRole()` itself.

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
| GET | `/api/admin/ai-settings` | Admin, CRO, Consultant CRO, Risk Manager |
| PATCH | `/api/admin/ai-settings` | Admin |

## Risk configuration

| Method | Path | Role |
|---|---|---|
| CRUD | `/api/risk-categories`, `/api/risk-sub-categories` | Admin |
| GET | `/api/risk-taxonomy`, `/api/taxonomies/:type` | Public (read) |
| POST | `/api/taxonomies/:type` | Admin, Risk Manager, Risk Champion, CRO |
| DELETE | `/api/taxonomies/:type` | Admin |
| POST/GET | `/api/matrix/config` | Write: Admin. Read: public |
| GET | `/api/scoring-methodology` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST | `/api/scoring-methodology` | CRO, Consultant CRO only (Admin notably excluded — see `docs/SCOPE_NOTES.md`) |

## Users & Access

| Method | Path | Role |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/users*` | Admin |
| GET | `/api/users/risk-owners` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST | `/api/users/:id/active` | Admin |

## Risk Register & Mitigation

| Method | Path | Role |
|---|---|---|
| GET | `/api/risks`, `/api/risks/:id` | List: any session. Detail: Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| GET | `/api/risks/next-id` | Admin, Risk Manager, Risk Champion, CRO |
| POST | `/api/risks` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO |
| PATCH | `/api/risks/:id` | Risk Champion (own submission only), Risk Manager/Owner (own department), CRO/Consultant CRO (full) |
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
| GET | `/api/incidents` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, Viewer |
| POST/PUT | `/api/incidents*` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — **Admin excluded** (known gap, see `docs/SCOPE_NOTES.md`) |
| DELETE | `/api/incidents/:id` | Risk Manager, CRO, Consultant CRO only |
| PATCH | `/:id/link-risk`, `/:id/dismiss` | Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO |

## Risk Appetite

| Method | Path | Role |
|---|---|---|
| GET | `/api/risk-appetite*` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO, and a role literally named `Approver` that doesn't exist in the assignable role list (see `docs/SCOPE_NOTES.md`) |
| POST/DELETE | manage/history | Admin, CRO, Consultant CRO |

## Horizon Scanning

| Method | Path | Role |
|---|---|---|
| GET | `/api/horizon-scans` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO |
| POST/PATCH | create/edit/convert | Admin, Risk Manager, CRO, Consultant CRO |
| DELETE, `/ai-draft` | Admin, CRO, Consultant CRO (Risk Manager excluded from just these two) |

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
| GET | `/api/audit-log` | Admin, Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO — **excludes Viewer**, though the sidebar shows the link to Viewer too (known gap, see `docs/SCOPE_NOTES.md`) |
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
| GET | `/api/search` | Admin, Risk Manager, Risk Champion, CRO — **Risk Owner and Viewer excluded** (known gap, see `docs/SCOPE_NOTES.md`) |

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
