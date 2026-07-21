# ERM Workstation — Feature Overview

**Certitude Advisory Services, for Qatar Post**

This document describes, in plain business language, everything the ERM
Workstation does today. It's organized by module so a reader can jump
straight to the area they care about. For how it's built, see
`ARCHITECTURE.md`; for step-by-step instructions, see `USER_GUIDE.md` and
the role-specific User Manuals in the parent project's `Documents/` folder.

> Rewritten 2026-07-21. The previous version of this document described
> the original Beta V1.0 build's 3-role model and did not reflect several
> modules added since, or two modules removed since. See
> `docs/SCOPE_NOTES.md` for the full history.

---

## 1. Platform Foundation

**Multi-tenant by design.** One deployed instance can serve a holding
company and its subsidiaries as separate "companies," each with its own
risk register, controls, policies, and users — while sharing the same
login and infrastructure.

**Role-based access control.** Eight roles govern what a person can see
and do today:

- **Super Admin** — Certitude's own consulting staff; full access across
  every company on the instance. *(Planned for removal before Qatar Post
  handover — see `docs/SCOPE_NOTES.md`.)*
- **Admin** — full access across the company: configures users,
  categories, branding, escalation rules, and (with a couple of narrow
  exceptions) every module.
- **Risk Manager** — full working access to their department's risks,
  controls, KRIs, issues, and incidents; approves risks their Risk
  Champions submit.
- **Risk Champion** — submits risks and day-to-day records; can edit only
  their own submissions until ownership passes to a Risk Manager.
- **Risk Owner** — first-line approver on the risk workflow, department-
  scoped.
- **CRO** — enterprise-wide final approval authority on risk acceptance.
- **Consultant CRO** — mirrors CRO's access; supports Certitude's
  multi-client consultant benchmarking layer. *(Planned for removal
  before Qatar Post handover.)*
- **Viewer** — read-only access to published policies, dashboards, and
  most registers.

**Secure session management.** Email/password login with enforced
password complexity, reuse prevention, mandatory periodic rotation, and
account lockout after repeated failed attempts. Sessions time out
automatically after a configurable period of inactivity. MFA exists in
the platform and is currently disabled for Qatar Post's demo/UAT phase.

**Bilingual (English/Arabic) interface.** Every structured field —
categories, statuses, severities, treatment strategies, role labels,
navigation, and in-app Help — is available in both languages with a
one-click toggle, including full right-to-left layout in Arabic.
Free-text fields (risk descriptions, comments, mitigation plans) remain
English-only by deliberate decision, to keep a single authoritative
working record across roles — see `docs/SCOPE_NOTES.md`.

**Complete audit trail.** Every meaningful change — approvals, status
changes, role changes, branding updates, bulk imports — is recorded with
who did it, when, and what changed.

---

## 2. Risk Register

The heart of the platform — a structured, auditable record of every risk
the organization tracks.

**Guided risk capture.** New risks are entered through a step-by-step
form: identification (department, category, description, cause,
consequence, owner), inherent risk scoring, control selection, residual
risk scoring, treatment strategy and tolerance, a mitigation plan, linked
KRIs, and review scheduling.

**5×5 scoring matrix.** Both inherent and residual risk are scored on a
1–5 likelihood × impact scale, automatically classified into Low / Medium
/ High / Extreme bands with color-coded badges throughout the app.

**Controlled vocabulary for causes and consequences**, extendable by
Admin, Risk Manager, Risk Champion, or CRO rather than fragmenting into
near-duplicate free-text phrases over time.

**Treatment strategies**: Mitigate/Treat, Avoid, Transfer, Accept — with
"Accept" requiring documented rationale and sign-off from someone other
than the person proposing it.

**Risk appetite breach flagging.** Each risk can carry an optional
numeric appetite threshold; if the residual score exceeds it, the risk is
automatically flagged "Exceeds Appetite" on the register and the
Management Summary dashboard. (See also the dedicated Risk Appetite
module, section 8 below, for category-level statements.)

**Risk velocity, directional trend tracking, risk movement (top
movers), and reassessment nudges** work as before: velocity tags how
quickly a risk could materialize; every reassessment auto-compares to the
prior version for an INCREASED/DECREASED/STABLE trend; the Management
Summary surfaces the biggest movers; and a non-Effective control test
after a risk's last assessment auto-flags it "Reassess."

**Risk interdependencies.** Risks can be cross-linked to related risks
with an optional note.

**Risk lifecycle.** A risk can be formally **Closed** with a documented
reason and **Reopened** if circumstances change — both versioned and
audit-logged. Unlike a full draft-versioning model, edits currently
overwrite the risk in place; the version number only increments on
Close/Reopen (a deliberate simplification — see `docs/SCOPE_NOTES.md`).

**Approval workflow.** A risk submitted by a Risk Champion goes to a Risk
Owner for first-line approval, then a Risk Manager, then (where
applicable) the CRO — each step visibly badged. Risks created by Admin,
Super Admin, or CRO auto-approve.

---

## 3. Control Library

A standalone library of controls, linked to risks many-to-many.

**Three control types**: Preventive, Detective, Corrective.

**Manual or automated**, with a defined testing frequency (Monthly,
Quarterly, Annual).

**Recorded test history** — every test logged with date, result, tester,
and notes.

**Effectiveness drives status — and action.** A Partially Effective or
Ineffective result requires a remediation action plan (owner + due date)
before the test can be submitted, and that plan automatically becomes a
linked Issue.

---

## 4. Key Risk Indicators (KRIs)

Early-warning metrics with Green/Amber/Red bands (direction of breach
configurable per indicator), trend sparklines, automatic escalation to an
Issue on a Red reading, and links to the risks and controls they relate
to.

---

## 5. Policy & Procedure Repository

Version-controlled policies with a full lifecycle (Draft → Under Review →
Approved → Published → Archived), attestation tracking, links to risks
and controls, and a confidential access list for restricted policies
(Admin-managed).

---

## 6. Organizational Roles (RACI)

A Role → Person → Department directory recording who is Accountable,
Responsible, Consulted, and Informed across the risk and control
landscape.

---

## 7. Compliance Obligations Register

Regulatory obligations tracked against a compliance status, with full
status history, automatic escalation to an Issue on Non-Compliant, and
links to policies, controls, KRIs, and risks.

---

## 8. Risk Appetite

Category-level appetite statements and thresholds, distinct from the
per-risk appetite flag in section 2 — this is where the organization
formally documents "how much of this kind of risk are we willing to
accept," reviewable and editable by CRO/Consultant CRO/Admin.

---

## 9. Horizon Scanning

Emerging-risk capture ahead of formal assessment — a place to log a
signal ("new PDPL enforcement guidance expected Q3") before it becomes a
fully scored risk, with an option to convert a scan directly into a Risk
Register entry, and an AI-assisted draft option (via the configurable AI
Integration settings) to help start the write-up.

---

## 10. Incident Log

Operational incident capture — distinct from the Risk Register in that
it records something that already happened (a system outage, a data
handling slip) rather than something that might. Incidents can be linked
to an existing risk or dismissed, and carry a severity and status
(Open, Under Investigation, Resolved, Closed).

---

## 11. Risk Governance Documents

A repository for governance artifacts — charters, terms of reference,
committee mandates — stored directly in the application database (no
external cloud storage dependency), so the whole platform, including
these documents, travels together in a single Postgres backup or on-
premises deployment.

---

## 12. Issues & Actions Tracker

The organization's central "things that need fixing" list, fed both
manually and automatically by every other module.

**Multiple sources**, including self-identified, audit findings, KRI
breaches and control-test failures (auto-created), and regulatory
non-compliance (auto-created).

**Ownership, priority, and due dates**, with overdue items surfaced on
the Management Summary.

**Separation of duties**, enforced by the system: the person who
closes/verifies an issue must be different from the person who owns it.

**Action items** as a distinct, trackable sub-list under each issue, with
their own status and separation-of-duties rule.

---

## 13. Evidence

File attachments can be linked to risks, controls, and other records as
supporting evidence, with role-scoped upload and an Admin-only delete —
useful for audit trails that need the underlying document, not just a
description of it.

---

## 14. Dashboards & Reporting

**Management Summary** — heatmap, top risks, appetite breaches,
reassessment flags, risk movement, KRI health, compliance status, open
issues, and a Risk Accepted register.

**My Tasks** — a personalized to-do list per user.

**PDF and PowerPoint export.** The Risk Management Pack and Accepted Risk
Report can be exported as a browser-printed PDF or a fully branded,
auto-numbered PowerPoint deck (shared slide master, repeating letterhead
and footer) — useful for board packs and committee meetings where a
native slide format is expected.

---

## 15. Data Tools

Bulk CSV import (with template download and per-row error reporting),
CSV export, and a global search bar across risks, controls, KRIs,
obligations, issues, and policies.

---

## 16. Notifications & Escalation

Configurable escalation rules per trigger type, with a two-stage
(notify → escalate) model and a notification bell surfacing everything
currently needing attention.

---

## 17. Branding & White-Labeling

Each client company has its own logo and primary brand color. Qatar
Post's instance is configured with Qatar Post's navy branding
(`#1B3A6B`) and logo.

---

## 18. Documentation & Onboarding

- **This feature overview**, `ARCHITECTURE.md`, and `API_REFERENCE.md`
  for the technical picture.
- **`USER_GUIDE.md`** — a lightweight, all-roles overview.
- **Role-specific User Manuals** (in the parent project's `Documents/`
  folder) — currently Risk Champion (English + Arabic), with Admin, CRO,
  and Risk Manager manuals planned. See the documentation tracker
  spreadsheet for status.
- **`deploy/README.md`** — deployment guide, including Qatar Post's own
  deploy scripts.
- **In-app Help** — context-sensitive Help panel content, bilingual,
  reachable from every page.

---

## Summary

The ERM Workstation takes an organization from "risks live in someone's
spreadsheet" to a structured, auditable, multi-user system connecting
risks, controls, KRIs, policies, compliance obligations, incidents,
horizon scans, and remediation issues — with the dashboards, escalation
rules, appetite thresholds, and reporting exports needed to keep that
connected picture current, not just accurate on the day it was entered.
