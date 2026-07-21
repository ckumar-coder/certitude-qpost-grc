# User Guide — ERM Workstation

Welcome. This guide is written for people who are new to formal risk and
compliance processes — no prior experience assumed. If a term feels
unfamiliar, check the **Glossary** at the end.

> This is a lightweight, all-roles overview. For detailed, screenshot-based
> instructions, see the role-specific User Manuals in the parent project's
> `Documents/` folder — the Risk Champion manual (English + Arabic) exists
> today; Admin, CRO, and Risk Manager manuals are planned (see the
> documentation tracker spreadsheet for status).
>
> Rewritten 2026-07-21 — the previous version described a 3-role model
> (Admin/Manager/Viewer) that no longer matches the app.

## 1. Logging in

1. Go to the URL your administrator gave you.
2. Enter the email and temporary password your administrator gave you.
3. **First login only**: you'll be asked to set a new password. The
   system remembers your last 5 passwords and won't let you reuse them.
4. If you belong to more than one company, you'll see a company picker —
   you can switch later from the sidebar.

**Staying logged in**: for security, you'll be signed out automatically
after a period of inactivity, with an on-screen warning first.

## 2. What you'll see, depending on your role

| Role | What you can do |
|---|---|
| **Viewer** | Read published policies, acknowledge ("attest to") them, and see most registers and dashboards read-only, plus **My Tasks**. |
| **Risk Champion** | Submit risks and day-to-day records for your department; edit only your own submissions until they're picked up by a Risk Manager. |
| **Risk Owner** | First-line approval step on risks submitted in your department. |
| **Risk Manager** | Full working access to risks, controls, KRIs, issues, and incidents **for your own department**; approve risks your Risk Champions submit. |
| **CRO** | Enterprise-wide final approval authority on risk acceptance; manages Risk Appetite statements and Scoring Methodology. |
| **Admin** | Configuration and administration across all departments — users, categories, branding, escalation rules — plus working access to most modules. |
| **Super Admin** / **Consultant CRO** | Certitude-only roles supporting delivery and multi-client consulting. *Planned for removal before Qatar Post handover.* |

Don't worry about memorizing this — the menu on the left only shows what
you have access to.

## 3. Finding your way around

- **Sidebar (left)**: your main menu. Items only appear if your role can
  use them.
- **My Tasks**: your personal to-do list — pending policy attestations,
  control tests due, your open issues, policy reviews due, and your KRIs.
  **This is the best place to start your day.**
- **Search bar (top)**: search across Risks, Controls, KRIs, Compliance
  Obligations, Issues, and Policies by ID, name, or keyword.
- **Notification bell (top right)**: things that need your attention —
  overdue control tests, Red-band KRIs, policy reviews coming due, overdue
  issues, and Non-Compliant obligations.
- **Language toggle**: switch the interface between English and Arabic at
  any time — structured fields, navigation, and Help content follow;
  free-text entries stay in whichever language they were written in.

## 4. How to complete a control test

1. Go to **Control Library** (or click through from a notification/My
   Tasks).
2. Find the control that's due for testing.
3. Open the control and click **Record Test**.
4. Work through the test checklist and add notes.
5. Submit. The system calculates **Effective**, **Partially Effective**,
   or **Ineffective** from your answers.

A Partially Effective or Ineffective result **automatically creates an
Issue**, pre-filled with a reference back to this test — make sure it
gets an owner and a due date.

## 5. How to respond to a KRI breach notification

1. You'll see a notification when a KRI's latest reading falls into the
   **Red** band.
2. Open **Key Risk Indicators** and check the sparkline for the recent
   trend.
3. The system has already created an Issue for the breach — find it in
   **Issues & Actions** and use it to track remediation.

## 6. How to log and close an issue

Issues can come from several sources — Self-identified, Internal/External
Audit, KRI Breach, Control Test Failure, Regulatory (Non-Compliant
obligations), or Whistleblower/Ethics.

1. Go to **Issues & Actions**, click **+ New Issue**.
2. Choose a source type, describe the issue and root cause, assign an
   owner and due date, set a priority, and optionally link it to a
   related Risk, Control, KRI, or Obligation.
3. **Separation of duties**: the person who closes/verifies an issue must
   be different from the issue's owner — the system enforces this.
4. **Risk Accepted**: occasionally the decision is made not to fix
   something — this requires approval from someone other than the
   issue's owner.

## 7. How policy attestation works

1. Go to **Policy Repository**, open a published policy, and read it.
2. Click **"I have read this policy"** — recorded with your name and a
   timestamp.
3. If a policy is updated, you'll need to attest again against the new
   version.

## 8. Logging an incident

Go to **Incident Log**, click **+ Log Incident**, and record what
happened (title, description, severity, department). You can link an
incident to an existing risk, or dismiss it if it doesn't warrant one.
Incidents move through Open → Under Investigation → Resolved → Closed.

## 9. Horizon Scanning and Risk Appetite

**Horizon Scanning** is where you log an emerging signal before it
becomes a fully scored risk — useful for "we should keep an eye on this"
items that aren't ready for the full Risk Register process yet. A scan
can be converted directly into a risk once it's understood well enough.

**Risk Appetite** (CRO/Consultant CRO/Admin) holds the organization's
formal category-level appetite statements — distinct from the per-risk
appetite threshold used for breach flagging on individual risks.

## 10. For Admins: configuring notifications & escalation, users, and branding

- **Escalation Rules** — define, per trigger type, how long before the
  first notification fires, who it goes to, and when it escalates
  further.
- **Users & Access** — add/remove people, set role and department scope,
  deactivate accounts.
- **Branding** — logo and primary color for the login screen and app.
- **Import / Export** — bring in an existing register via CSV template;
  export any module to CSV.
- **Audit Log** — a complete, append-only history of who changed what and
  when.

---

## Glossary

| Term | Meaning |
|---|---|
| **Risk** | Something that could go wrong and affect the organization's objectives. |
| **Inherent risk** | How bad the risk would be with *no* controls in place. |
| **Residual risk** | How bad the risk is *after* accounting for current controls — the number that matters day-to-day. |
| **Control** | An activity that reduces a risk. |
| **Control test** | A periodic check that a control is actually working. |
| **KRI (Key Risk Indicator)** | An early-warning metric with Green/Amber/Red bands. |
| **Issue** | A tracked problem with an owner, due date, and remediation plan. |
| **Incident** | Something that already happened (distinct from a risk, which is something that might). |
| **Risk Accepted** | A formal, approved decision to knowingly leave a risk/issue unaddressed. |
| **Compliance Obligation** | A specific regulatory requirement, tracked against a compliance status. |
| **Policy attestation** | A staff member formally confirming they've read and understood a policy. |
| **RACI** | Accountable / Responsible / Consulted / Informed. |
| **Department scoping** | Risk Champions/Owners/Managers see and manage records for their own department. |
| **Risk Appetite** | How much of a given category of risk the organization has formally decided it's willing to accept. |
| **Horizon Scanning** | Logging an emerging risk signal before it's assessed as a full Risk Register entry. |
| **Escalation** | Notifying someone more senior if something stays unresolved too long. |

---

If something in the app doesn't match this guide, or you hit an error you
don't understand, contact your Admin — they can check the Audit Log for
exactly what happened and when.
