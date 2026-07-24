# Scope Notes & Known Limitations

**Status: all 10 phases of the Tier 1 build are complete.** This document
is a running log of deliberate simplifications, deferred items, and
follow-up candidates across all build phases -- the single reference for
post-launch review and for scoping any Tier 2 work.

---

## How to read this document

Each item is tagged with the spec section it relates to (where applicable)
and the phase in which the decision was made. "Deferred" means it was
explicitly out of scope for this build (often because the spec itself
marks it Tier 2/3); "Simplification" means a Tier-1 feature was built in a
deliberately lighter-weight way than the fullest possible interpretation.

---

## 1. Deferred per the spec's own Tier 2/3 roadmap

These were never in scope for Phases 0-7 -- the spec explicitly defers
them. Listed here so they're not mistaken for gaps.

- **A4 (Tier 2/3) -- Board & Committee Management**: meeting records,
  resolutions, minutes, and a multi-level Risk Appetite Framework. Only
  relevant if/when a client is a regulated financial entity.
- **A5 (Tier 2) -- Risk Criteria / Scoring Methodology Reference**: a
  reference document defining what each Likelihood/Impact score (1-5)
  concretely means. Recommended early in Phase 9 (documentation) since
  it's cheap to write and is the artifact auditors most often ask for.
- **C2 (Tier 3) -- Regulatory Change Management**: curated regulator feeds
  and change detection.
- **H3 -- Unified compliance/action calendar**: a calendar view aggregating
  due dates across all modules. F2 (My Tasks) and the notifications system
  (G5) cover "what's due from me" / "what's overdue"; a true calendar view
  is still open.
- **H4 -- In-app glossary / contextual help**: tooltips for GRC terms
  (inherent vs. residual, KRI, Risk Accepted, etc.). Not built; would help
  the GRC-immature client base the spec targets.
- **H9 -- Notification digest option**: daily/weekly digest emails. Depends
  on G5 email delivery (see below) being wired up first.
- **Tier 2 access refinements (E)**: Internal Audit role (read + independent
  test entry, can't edit self-tests), External Auditor (time-limited
  read-only), and "cross-linked items show summary-only status if user
  lacks access to linked module." The current model is the Tier 1
  three-role (Admin/Manager/Viewer) system from the spec.
- **G7 -- Evidence file storage**: no file upload/attachment capability yet
  (signed reconciliations, screenshots, policy PDFs as binary attachments).
  All "evidence" fields today are free-text descriptions, not files.

---

## 2. G5 -- Notifications & Escalation (Phase 7)

- **Email delivery not implemented.** The escalation rules engine, in-app
  notification bell, and "Notify -> Escalate to" workflow are fully built
  and tested, but the `channels` field (e.g. `email,in_app`) is currently
  informational only -- no SMTP/email provider is wired up. This was
  flagged as the natural first follow-up once a provider is chosen during
  deployment (Phase 8).
- **Notifications are computed on demand**, not via a background job or
  persisted `notifications` table. Each load of the bell re-evaluates all
  active rules against live data. This is fine at SME data volumes but
  would need a scheduled job + persisted read/unread state if email
  delivery (and therefore "don't re-send the same alert") is added.
- Escalation routing resolves "Department Manager" to *any* Manager in
  that department, and falls back to all Admins for enterprise-wide
  (NULL-department) items. If a client wants per-item named recipients
  rather than role-based routing, that's a schema extension.

---

## 3. G6 -- Reporting & Export (Phase 7)

- **PDF and Word export were not built.** H6 (CSV/Excel export) and H8
  (search) are complete and cover data portability and findability, but
  the spec's G6 ask for **dashboards, risk registers, and other key views
  exportable as PDF and Word**, styled around ISO 31000/COSO terminology,
  is still open. This is a substantial standalone piece (report templates +
  a PDF/Word generation library) and is the most significant remaining gap
  from the original spec.
- CSV exports are per-module (Risks, Controls, KRIs, Policies, Obligations,
  Issues) rather than a single "export everything" zip -- no archiving
  library was added to keep dependencies minimal. A client wanting one-click
  full-dataset export would need this added.

---

## 4. H1 -- Bulk Import (Phase 7)

- **1,000-row limit per import file.** Reasonable for SME onboarding; a
  larger client migration might need batching or a raised limit.
- The CSV parser/serializer (`csv.js`) is a small hand-written
  implementation (no external dependency) -- handles quoted fields, commas,
  and newlines, but hasn't been tested against more exotic CSV dialects
  (e.g. semicolon-delimited exports from some European Excel locales).
- Each row is validated and inserted independently (no all-or-nothing
  transaction), which is the intended behavior (partial success with
  per-row error reporting) but means a failed import can't be "rolled
  back" as a single unit -- successfully-imported rows stay.
- For Managers, a CSV row specifying a different department than their own
  is **silently overridden** to their own department rather than rejected
  (unlike the manual create-forms, which reject mismatches with a 400).
  This was a deliberate import-friendliness tradeoff, but worth confirming
  matches client expectations.

---

## 5. Phase 5 -- Access Control / Department Scoping (E)

- Department-based scoping (view/edit restricted to a Manager's own
  department, or enterprise-wide items with no department) was applied to
  the **primary list/create/edit/status endpoints** for Risks, Controls,
  KRIs, Issues, and Obligations. It was **not** extended to the
  many-to-many link-management endpoints (e.g. linking a Control to a Risk,
  or a KRI to a Control) -- those remain Admin/Manager-unrestricted. In
  practice this is low-risk (linking doesn't expose data, just creates
  relationships), but worth knowing if stricter cross-department isolation
  is required later.
- "Enterprise-wide" (NULL department) is the convention for items every
  Manager can see/edit. There's no intermediate "visible to multiple named
  departments" option -- an item belongs to exactly one department or none.

---

## 6. Phase 4 -- Issues & Actions Tracker (D)

- Auto-issue-creation on KRI breach only fires for the **Red** band, not
  Amber. (Amber is "watch" territory; Red is "breach requiring action" --
  this matches the KRI band semantics, but a client wanting earlier
  automatic flagging would need Amber-triggered issues added.)
- "Separation of duties" for issue closure is enforced via a simple
  case-insensitive email comparison (`closure_verified_by != owner`) --
  there's no organizational-hierarchy check that the verifier actually
  outranks the owner, only that they're a different person.
- "Risk Accepted" disposition requires the approver to hold the Admin role
  in that company -- there's no separate "higher authority than the owner"
  concept beyond the three-tier role model (Tier 2 access refinements,
  noted above, would formalize this further).

---

## 7. Phase 2/3 -- Policies & Compliance Obligations (A1, C1)

- **Policy approval is single-approver.** The spec's Draft -> Reviewer ->
  Approver -> Published workflow is implemented as Draft -> Under Review
  -> Approved -> Published -> Archived with one named Approver field, not
  a multi-step/multi-person review chain. Multiple approvers or sequential
  review steps are called out in the spec itself as a Tier 2 refinement.
- Compliance Obligations and the Issues/Controls/KRIs modules are
  Admin/Manager only -- Viewers' only entitlements remain the Policy
  Repository (published policies + their own attestations) and My Tasks,
  per the Tier 1 access model.

---

## 8. Phase 0 -- Foundations

- The pre-existing `controls` table (per-risk-version embedded controls
  from the original single-tenant build) was migrated into the new
  `controls_lib` and **renamed to `controls_v2_legacy`** rather than
  dropped, in case historical data needs to be referenced. Similarly,
  `users_v1_legacy` is excluded from delivery packages but remains in the
  database. These legacy tables are unused by the application and are
  candidates for cleanup once the migration history is no longer needed
  (e.g. before a fresh production deployment).
- Sessions use a 10-minute sliding inactivity timeout. This is a
  reasonable default but should be confirmed against the client's actual
  security policy during deployment.

---

## 9. General / cross-cutting

- **All test data, user accounts, and passwords used during development
  (e.g. `admin@acm.local`, `test@acm.local`, etc.) are sandbox-only** and
  must not ship to a production deployment.
- **H7 (Backup & Disaster Recovery)** is infrastructure-level and explicitly
  deferred to Phase 8 (deployment), where automated daily Cloud SQL backups
  and a retention/restore procedure should be configured and documented.
- The 10-year retention requirement (G7) has no special handling yet beyond
  "nothing currently deletes old records" -- there's no archival/cold-storage
  strategy for evidence files (which don't exist yet either, see G7 above)
  or for pruning the audit log, which will grow indefinitely.

---

## 9. Phase 8 -- Cloud Deployment (G3)

- **Built**: a full GCP Cloud Run + Cloud SQL deployment toolkit
  (`deploy/`) -- one-time per-client infrastructure setup, build/deploy,
  schema migration + tenant bootstrap as Cloud Run Jobs, optional
  Cloud Build CI/CD, and a `/healthz` endpoint. `migrate-all.js` (apply all
  schema files to a fresh DB) and `bootstrap-tenant.js` (create the first
  company + Admin user) were tested end-to-end against a fresh local
  Postgres database and confirmed login works.
- **Not built / untested**: the actual `gcloud`/Cloud Build commands have
  not been run against a real GCP project (no `gcloud` available in this
  sandbox) -- the scripts are written carefully against documented GCP
  APIs and conventions (Cloud SQL Auth Proxy unix sockets, Secret Manager,
  per-client service accounts) but should be dry-run against a real
  project before being treated as production-ready.
- **G1 consolidated group-level dashboard**: the spec calls for both a
  per-company view (built, Phases 0/6) and a consolidated cross-company
  rollup view for group-level users. Only the per-company view exists.
  This is an application feature (not infrastructure) and would extend
  the Phase 6 dashboard endpoints to aggregate across all companies a
  user has access to.
- **Self-service "add company" UI**: adding a subsidiary company to an
  existing client instance currently requires a direct SQL insert
  (documented in `deploy/README.md`). An admin screen for this would be a
  natural Tier 2 addition.
- Default Cloud SQL tier (`db-g1-small`) and `--min-instances=1` /
  `--max-instances=4` for Cloud Run are reasonable starting points for an
  SME client but should be reviewed against actual usage once a client is
  live -- these are easy to adjust without downtime.

---

## 10. Phase 9 -- Branding & Documentation (G9, G11, G12)

- **G9 (branding) built and tested**: each company has a logo and primary
  color (`companies.branding_logo_url/branding_primary_color`, columns
  that existed since Phase 0 but were unused until now). Admins manage
  this from a new **Branding** screen; the login screen uses the
  lowest-id active company's branding (instance-wide, consistent with "one
  application instance per client," G1); the in-app sidebar/theme use the
  active company's own branding if set. Logos are stored as data URIs
  (capped at ~1.5MB) rather than requiring file-storage infrastructure
  (G7, still not built -- see section 1).
- **G11 (documentation) delivered**: `docs/ARCHITECTURE.md` (overview,
  multi-tenancy/auth model, Mermaid ER diagram, module map),
  `docs/API_REFERENCE.md` (all ~65 endpoints, grouped by module, with
  roles and purpose), and `deploy/README.md` (deployment, from Phase 8).
  The ER diagram is Mermaid (renders in GitHub/most markdown viewers and
  the docs/ folder), not a binary image file -- if a client specifically
  needs a PNG/PDF export of it, that's a quick follow-up (render the
  Mermaid source with `mmdc` or similar).
- **G11 API reference caveat**: this is a curated catalog (method, path,
  role, one-line purpose), not a full OpenAPI/Swagger spec with request/
  response schemas. Generating a full OpenAPI spec from the existing routes
  would be a worthwhile follow-up if the client wants interactive API docs
  (e.g. Swagger UI) or auto-generated client SDKs.
- **G12 (user guide) delivered**: `docs/USER_GUIDE.md` covers login/forced
  password change, role differences, navigation, and -- per the spec's
  explicit minimum -- completing a control test, responding to a KRI
  breach, logging/closing an issue (incl. separation of duties and Risk
  Accepted), and policy attestation, plus an Admin section and a glossary
  (a lightweight stand-in for the deferred H4 in-app glossary, see section
  1).
- **Not built**: a separate `ADMIN_GUIDE.md` -- admin-specific workflows
  (users, escalation rules, branding, import/export, audit log) are folded
  into `USER_GUIDE.md` sections 8-9 instead. Split out if the client wants
  a distinct document to hand to their GRC Coordinator/Compliance Officer
  specifically.

---

## 11. Risk Register Enhancements (post-Phase-9, schema v9)

Following a review of the live register, five enhancements were added on
top of the completed Tier 1 build:

- **Corrective controls**: `controls_lib.control_type` now accepts
  `Corrective` alongside `Preventive`/`Detective`.
- **Mandatory remediation plans**: `POST /api/controls/:id/test` now
  rejects Partially Effective/Ineffective results unless a remediation
  plan, owner, and due date are supplied in the same request -- the
  auto-created Issue (D) is pre-filled from these rather than left for a
  follow-up edit.
- **Risk appetite breach flag**: `risks.tolerance_threshold_score` (1-25,
  optional) is compared against the residual score on every read; a risk
  exceeding it is flagged `appetite_breach: true` and surfaced on the
  Management Summary.
- **Risk lifecycle**: risks can be formally **Closed** (with a required
  reason) or **Reopened** via `POST /api/risks/:id/close` /
  `/api/risks/:id/reopen` -- each creates a new version (G10-consistent),
  and Closed risk chains are hidden from the default register view
  (`?include_closed=true` to see them).
- **Reassessment nudge**: if a linked control was tested as non-Effective
  more recently than the risk's `last_evaluated_timestamp`, the risk is
  flagged `reassessment_recommended: true`.
- **Risk movement (top movers)**: the Management Summary now includes a
  `risk_movement` list -- risks whose residual score changed from their
  immediately preceding version, sorted by magnitude of change.
- **Risk interdependencies**: `risk_links` lets any Admin/Manager record
  an undirected "these risks are related" cross-reference between two
  risk UIDs, with an optional note. No scoring/aggregation logic --
  purely informational, for spotting clusters.
- **Controlled vocabularies for cause/consequence**: `risk_taxonomy_terms`
  backs a "pick from a list, or add your own" control for `risk_cause`/
  `risk_consequence` on the Risk form. Seeded with ~10 common causes and
  ~8 common consequences per company; anyone can add new terms.

**Not done / follow-ups**:
- Risk velocity and appetite score are **not yet included in bulk
  export/import for Controls/Policies/Obligations** (only Risks) -- not
  applicable to those modules, so this is expected, not a gap.
- `risk_links` has no UI indication when a linked risk is itself Closed --
  a closed risk remains linkable and visible in the "Related Risks" list
  with no visual distinction. Minor polish item.
- The reassessment nudge compares timestamps but doesn't yet appear as a
  G5 notification/escalation-rule trigger type -- it's currently
  Register/Dashboard-only. Adding `reassessment_recommended` as a sixth
  escalation rule trigger type would be a natural follow-up if Admins want
  it surfaced in the notification bell too.

---

## 12. Post-V1.2 change requests (logged 2026-06-17)

The following items were raised after Beta V1.2 deployment and are queued
for the next build cycle:

- **Likelihood/Impact score descriptions (Inherent Risk)**: When a user
  selects a score (1–5) for Likelihood or Impact in the Inherent Risk
  Scoring section, a short descriptive label should appear alongside the
  number (e.g. "1 = Rare", "3 = Possible", "5 = Almost Certain" for
  Likelihood; "1 = Negligible", "5 = Catastrophic" for Impact). Currently
  only the numeric value is shown with no contextual guidance.

- **Likelihood/Impact score descriptions (Residual Risk)**: Same requirement
  as above applies to the Residual Risk Scoring section. Both sections
  should use identical label sets for consistency.

- **Control ID auto-generation (department-based)**: Control IDs should be
  auto-generated using the same department-based pattern as Risk IDs:
  `CI-{DEPT}-{SEQ}` (e.g. `CI-FIN-001`, `CI-HRD-001`). The ID should be
  assigned immediately when "New Control" is clicked (or when a department
  is selected), displayed as a read-only preview field in the form, and
  only permanently committed on save. Unused IDs (if the form is abandoned)
  can be deleted, matching the Risk ID behaviour. Currently control IDs use
  a separate auto-increment sequence with no department prefix.

- **Risk Appetite score (Step 5) -- auto-calculation**: The appetite score
  in the risk form (Step 5, "Risk Appetite & Tolerance") is currently a
  free-text input. It should either be (a) auto-calculated from
  Likelihood × Impact using the same 1–25 matrix as the Inherent/Residual
  scores, or (b) presented as a constrained numeric field (1–25) with the
  same scoring matrix visual. A free-text field allows nonsensical values
  and is inconsistent with the scoring methodology. Recommend option (a)
  to keep it consistent and reduce data entry errors.

- **Framework Reference -- dropdown list**: The "Framework Reference" field
  on the Control form (and anywhere else it appears) should be a dropdown
  or searchable multi-select rather than a free-text input. Suggested
  values to seed: ISO 27001, ISO 31000, COSO ERM, COSO ICFR, NIST CSF,
  SOC 2, PCI DSS, PIPEDA, CIS Controls, COBIT 2019, OSFI E-21, Basel III.
  Users should still be able to add custom values ("Other / specify"). Free
  text currently produces inconsistent entries that are hard to filter or
  report on.

---

## 13. Post-V1.3 change requests (logged 2026-06-18)

- **Step 3 (New Risk) — "Link existing control" UX**: The checkbox list to
  link existing controls from the Control Library already exists in the
  form but is hidden when the library is empty. This confused a user who
  saw only "Or create new controls" and assumed linking wasn't possible.
  Fix: always render the link section in Step 3, even when the library is
  empty — show a message like "No controls in the library yet — add some
  in the Control Library first, or create a new one below." This prevents
  duplicate controls being created unnecessarily. Additionally, consider
  replacing the checkbox badge list with a searchable/filterable picker
  once the library grows beyond ~10 controls.

---

## Suggested priority order for follow-up work

1. **Step 3 link-existing UX fix** (item above) -- low effort, prevents
   control duplication, important for correct many-to-many usage.
2. **Score descriptions + appetite fix** -- completed in V1.3.
3. **Control ID auto-generation** -- completed in V1.3.
4. **Framework Reference dropdown** -- completed in V1.3.
4. **G6 PDF/Word export** -- largest remaining functional gap from the
   original spec; high visibility for client demos and audits.
5. **G5 email delivery** -- the configuration UI and rules engine are
   ready; this is "just" wiring in an SMTP/email API provider.
6. **G7 evidence file attachments** -- currently the biggest "this doesn't
   match how real audits work" gap (auditors expect to see the actual
   signed reconciliation, not a text description of it).
7. **A5 Risk Scoring Methodology document** -- cheap to produce (a
   well-written policy document), high audit value.
8. **H3 compliance calendar / H4 glossary** -- UX polish items, good
   candidates once the above functional gaps are closed.

---

## 14. Qatar Post Addendum (logged 2026-07-21)

This codebase was forked from the generic platform above on 2026-06-28 to
become Qatar Post's "ERM Workstation." Everything in sections 1-13 above
is the original platform's decision log, frozen at that fork point. This
section is the running log of what's happened since, kept in the same
file rather than a new one so there's one place to read the full history.
`docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/API_REFERENCE.md`, and
`README.md` were all rewritten on 2026-07-21 to reflect the state
described here; this section is the "why."

**Product rename.** The instance was renamed from "GRC Workstation" to
"ERM Workstation" throughout the UI, backend, `package.json`, and deploy
scripts (v2.42.28-29). The underlying platform is still Certitude's GRC
platform by origin -- only Qatar Post's branded instance uses the ERM
name.

**Modules removed.** Business Continuity Management (BCM/BCP,
`schema_v73_remove_bcm_module.sql`) and Maturity Assessment
(`schema_v74_remove_maturity_assessment.sql`) were removed entirely except
for the critical-risk fields BCM left behind on `risks`. The Training
Video Library was removed at the application layer (no schema change
needed). All three were judged not relevant to Qatar Post's scope.

**Modules added since the fork.** Incident Log, Risk Appetite (category-
level statements), Horizon Scanning (with AI-assisted drafting), Risk
Governance Documents (stored embedded in Postgres, migrated off GCS in
schema v72 specifically to remove an external storage dependency ahead of
a possible on-premises handover), Evidence attachments, PowerPoint export
for the Risk Management Pack and Accepted Risk Report, and a full
bilingual (English/Arabic) UI for structured fields, navigation, and
in-app Help.

**Arabic language scope -- free text stays English (deliberate).**
Qatar Post's RFP asks for the ability to enter Risk Register details in
Arabic. Structured/enum-driven fields are fully bilingual. Free-text
fields (risk description, root cause, mitigation plan, comments) are
English-only by decision, not by technical limitation -- Postgres is
UTF-8 and stores Arabic text in the same columns with zero schema
changes. The actual constraint is cross-role workflow (a Risk Champion's
Arabic write-up wouldn't be actionable by an English-reading Risk
Manager) and, internally, Certitude's own delivery team's ability to
validate Arabic content for support purposes. If this needs to change
later, the AI Integration hook already used for Horizon Scanning drafts
is the natural extension point for a machine-translation aid --
not built; scoped as a future option only.

**Role model today, and one pending change.** The app has eight roles:
Super Admin, Admin, Risk Champion, Risk Owner, Risk Manager, CRO,
Consultant CRO, Viewer -- see `docs/ARCHITECTURE.md` section 2.

**Consultant CRO is permanent, not a removal candidate** (clarified
2026-07-21, superseding an earlier note that said otherwise). It is kept
in deliberately so the Qatar Post CRO can draw on a Certitude consultant's
assistance post-handover if needed; the Qatar Post Admin controls
whether/when a real person is actually assigned the role. No code or
documentation changes are planned around it.

**Super Admin is temporary -- retained for training, removed at/after
Phase 3 on-prem deployment** (clarified 2026-07-21). It will be deleted
either just before the app is deployed onto Qatar Post's own server, or
immediately after -- timing is Qatar Post's call, confirmed when Phase 3
actually happens. **This has not been implemented yet**. When it is, every
place Super Admin is named in `server.js` (`requireRole()`'s Admin/Super-
Admin bypass, the `functional_role = 'Super Admin'` special-casing),
`App.jsx`, `Layout.jsx`, and this documentation set will need a follow-up
pass. Tracked in the parent project's `CLAUDE.md` and the documentation
tracker spreadsheet.

**Known inconsistencies found during a full RBAC audit (2026-07-21) —
all six resolved as of 2026-07-23.** A code-verified audit of every
role-based check in the app (backend routes, frontend page/nav/component
gates) surfaced six places where different parts of the app already
disagreed with each other. All six were resolved by the admin-configurable
permissions engine built in response to this audit (Phases A–E, see
`docs/ARCHITECTURE.md` section 2a) — kept here as a record of what was
found and how each was actually closed out, not as an open list:

- **Viewer shown the Audit Log nav link but 403'd by the backend** —
  resolved by making `audit_log.view` a non-configurable safety-baseline
  capability, full for every role including Viewer, on both sides.
- **Risk Owner shown a working global search box but 403'd by the
  backend** — resolved: `search.global` is now scope-aware and grants
  Risk Owner `own`-scope access, matching the frontend. (Viewer remains
  excluded from search — that part of the original design was
  intentional, not a bug.)
- **A role literally named `Approver`** in the Risk Appetite view route's
  role list, which didn't exist in the assignable role list — deleted
  outright from the codebase; it had no live purpose.
- **Admin excluded from editing Scoring Methodology** (CRO/Consultant CRO
  only) — investigated and confirmed as intentional policy, not a gap:
  kept as a CRO-owned risk decision, consistent with Admin's other
  CRO-tier exclusions (e.g. `risk.create`/`risk.edit`/`risk.approve_manager`).
  Not changed.
- **Admin excluded from logging a new Incident** — resolved more broadly
  than the narrow gap originally flagged: incident creation was opened to
  *every* role, including Admin, Super Admin, and Viewer, as a
  non-configurable safety baseline (wide reporting intake, narrow triage —
  delete/link/dismiss stay restricted to the operational/CRO tier).
- **`test-routing-audit.js` had drifted from the real sidebar/routing
  logic** — the script was fully rebuilt 2026-07-23 against the current
  `Layout.jsx`/`App.jsx`, and redesigned around the new architecture: nav
  visibility and page reachability now read the identical capability key
  against the identical permissions map, so the only remaining failure
  mode is the two files disagreeing on which key to use for a given page
  — which is exactly what the rebuilt script checks.

The full original audit, with exact file/line references, is at
`Documents/Internal/RBAC_Permissions_Engine_Scoping.docx` (Certitude
internal). The permissions engine it scoped is now fully built and
deployed — schema and seed data (Phase A), an admin UI for managing roles
and permissions (Phase B), backend enforcement across roughly 132 route
guards (Phase C), frontend enforcement across routing and 17
component-level files (Phase D), and cleanup (Phase E) — replacing the
~20-file hardcoded permission model the audit was scoped against.

**Documentation itself was stale until this pass.** `README.md` and all of
`docs/` carried the same 2026-06-28 timestamp as the fork, describing the
original 3-role, ~3,600-line-`server.js` product, until the 2026-07-21
rewrite this section is part of. See
`Documents/Qatar_Post_Documentation_Handover_Tracker.xlsx` for the
consolidated, living checklist of every documentation artifact's status
going forward -- that spreadsheet, not this file, is now the place to
check what still needs updating.
