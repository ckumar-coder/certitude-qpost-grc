// help-content.js
// Context-sensitive help content keyed by page id.
// Each entry has a title and an array of { q, a } FAQ items.

export const HELP_CONTENT = {
    'my-tasks': {
        title: 'My Tasks',
        items: [
            {
                q: 'What appears in My Tasks?',
                a: 'My Tasks aggregates everything that needs your attention: risks awaiting approval, policies due for attestation, KRI readings that have breached their threshold, and issues assigned to you. It is your daily action queue.',
            },
            {
                q: 'How do I action a task?',
                a: 'Click the task to open the relevant record directly. Completing the required action (approving, attesting, or updating) automatically removes it from your queue.',
            },
            {
                q: 'Why do I see tasks from other modules here?',
                a: 'My Tasks is a cross-module inbox. It pulls open items from the Risk Register, Policy Repository, KRI Register, and Issues Tracker so you never need to check each module separately.',
            },
        ],
    },

    'management-summary': {
        title: 'Management Summary',
        items: [
            {
                q: 'What does the Management Summary show?',
                a: 'The Management Summary gives an executive view of your GRC posture: overall risk exposure, open issues by priority, KRI breach count, policy compliance rate, and pending approvals. It is designed for leadership reporting.',
            },
            {
                q: 'How is the overall risk score calculated?',
                a: 'The score is the average residual risk score across all open risks, weighted by their inherent impact. Each risk is scored on a 1–25 scale (Likelihood × Impact). Scores above 15 are Critical, 10–14 High, 5–9 Medium, and below 5 Low.',
            },
            {
                q: 'How often does this page refresh?',
                a: 'The data is live — it reflects the current state of all modules every time you open the page. There is no scheduled refresh cadence.',
            },
        ],
    },

    'policies': {
        title: 'Policy Repository',
        items: [
            {
                q: 'How do I publish a policy?',
                a: 'Create a policy with status "Draft", complete the required fields, then change the status to "Published". Only published policies are visible to Viewers for attestation.',
            },
            {
                q: 'What is attestation?',
                a: 'Attestation is a formal acknowledgement that a user has read and understood a policy. Published policies can be sent for attestation. Each acknowledgement is time-stamped and stored in the audit log.',
            },
            {
                q: 'What do the policy categories mean?',
                a: 'Categories tag policies by domain: Governance (board and entity-level), IT (technology and security), HR (people), Compliance (regulatory), Operations (process), Finance, Risk, and BCM (business continuity). Use BCM for all BCP-related policies.',
            },
            {
                q: 'What happens when a policy reaches its review date?',
                a: 'The system flags it as overdue and adds a task to the content owner\'s My Tasks queue. The policy remains published until explicitly updated or retired.',
            },
        ],
    },

    'org-roles': {
        title: 'Org Roles (RACI)',
        items: [
            {
                q: 'What is a RACI matrix?',
                a: 'RACI stands for Responsible, Accountable, Consulted, and Informed. It maps which roles own each GRC activity, who approves decisions, who needs to be consulted, and who should be kept informed of outcomes.',
            },
            {
                q: 'How does the RACI connect to risks and controls?',
                a: 'When you assign an owner, consulted party, or informed contact on a risk or control, the RACI matrix reflects those assignments. This ensures accountability is documented and auditable.',
            },
        ],
    },

    'access-matrix': {
        title: 'Access Matrix',
        items: [
            {
                q: 'What does the Access Matrix show?',
                a: 'A static, read-only reference table showing exactly what each role can do across every module — Full access, Department-only, Own-records-only, or No access — so you can see the complete permission model at a glance.',
            },
            {
                q: 'How is this different from Org Roles (RACI)?',
                a: 'Access Matrix shows what the system technically permits each role to do. Org Roles (RACI) is a configurable record of who is actually Responsible, Accountable, Consulted, or Informed for specific activities — a governance/accountability document, not a permissions engine.',
            },
            {
                q: 'Can I change permissions from this page?',
                a: 'No — it\'s a reference view only, generated from the system\'s actual role guards. To change what a specific person can do, adjust their role in Users & Access.',
            },
            {
                q: 'Who can view the Access Matrix?',
                a: 'Admins, CROs, and Consultant CROs.',
            },
        ],
    },

    'risks': {
        title: 'Risk Register',
        items: [
            {
                q: 'How do I create a new risk?',
                a: 'Click "Add Risk" and complete the nine-step form. At minimum you need a department, risk category, and a risk description. Use the Statement Quality Check (Step 9) to validate your risk statement before saving.',
            },
            {
                q: 'What is the difference between inherent and residual risk?',
                a: 'Inherent risk is the raw exposure before any controls are applied. Residual risk is what remains after your controls are in place. The goal is to bring residual risk within your risk appetite.',
            },
            {
                q: 'What does the risk lifecycle look like?',
                a: 'Risks start as Draft, move to Active once approved, and can be Closed when the underlying exposure no longer exists. Every status change creates a new version — no history is ever deleted.',
            },
            {
                q: 'What is the BCP Status field?',
                a: 'BCP Status records whether a Business Continuity Plan exists for the scenario this risk describes. Options are Yes, No, or In Development. You can also link directly to the BCP document.',
            },
            {
                q: 'Who can approve risks?',
                a: 'Risks are approved by Admins or the CRO role. Risks with an "Accept" or "Avoid" treatment strategy are automatically routed to the CRO inbox for sign-off.',
            },
        ],
    },

    'critical-risks': {
        title: 'Critical Risks Log',
        items: [
            {
                q: 'What appears on the Critical Risks Log?',
                a: 'Every risk flagged as Critical using the "Is this a critical risk?" toggle on the Risk Register form, regardless of department — shown together with its residual score, treatment strategy, BCP status, and current workflow status in one consolidated view.',
            },
            {
                q: 'How does a risk get onto this log?',
                a: 'When creating or editing a risk in the Risk Register, mark "Is this a critical risk?" as Yes. It appears here immediately. Unmarking it removes it from the log without deleting the underlying risk.',
            },
            {
                q: 'What does the BCP Status column mean?',
                a: 'It mirrors the BCP Status field on the risk itself (Yes / No / In Development) — a quick read on whether business continuity planning exists for that critical exposure. Update it from the Risk Register.',
            },
            {
                q: 'Can I edit a risk from here?',
                a: 'This log is read-only by design. Open the risk in the Risk Register to make changes — this page always reflects the latest data.',
            },
        ],
    },

    'risk-appetite': {
        title: 'Risk Appetite',
        items: [
            {
                q: 'What is a Risk Appetite statement?',
                a: 'A board-approved boundary for a specific risk category, expressed as a tolerance level (Zero Tolerance, Low, Moderate, or High) plus a named approver (Board of Directors, CEO, CFO, CRO, or Other). It defines how much of that type of risk the organisation is willing to accept.',
            },
            {
                q: 'What counts as an "appetite breach"?',
                a: 'When a risk\'s residual score falls into a band that exceeds the tolerance set for its category\'s appetite statement, it\'s flagged as a breach. The summary strip at the top of the page shows the current breach count across all categories.',
            },
            {
                q: 'What is the Heatmap Overlay tab?',
                a: 'It plots your current risk portfolio against appetite boundaries visually, making it easy to see at a glance which categories are operating within tolerance and which have exposures that exceed it.',
            },
            {
                q: 'Who can create or edit appetite statements?',
                a: 'Admins and CROs. Once approved, a breach action statement — a pre-filled escalation template based on severity — is automatically suggested for Critical and High-severity breaches.',
            },
            {
                q: 'How does this connect to KRIs?',
                a: 'KRIs can be linked to a specific appetite statement, so a KRI breach is automatically read in the context of the boundary the organisation has already agreed to.',
            },
        ],
    },

    'controls': {
        title: 'Control Library',
        items: [
            {
                q: 'What is the Control Library?',
                a: 'The Control Library is a catalogue of all controls your organization has in place. Controls are linked to risks to demonstrate how exposure is being managed, and to KRIs to show how effectiveness is measured.',
            },
            {
                q: 'What does "Assigned to My Team" mean?',
                a: 'Another department has created this control and assigned ownership to your team. Your team can edit it and is responsible for its testing and maintenance — but the creating department retains read access.',
            },
            {
                q: 'What control types are available?',
                a: 'Controls are classified as Preventive (stops an event), Detective (identifies when something goes wrong), or Corrective (fixes the impact after the fact). Most frameworks expect a mix of all three.',
            },
            {
                q: 'How do I record a control test result?',
                a: 'Open the control, go to the Testing section, and record the outcome and date. Results feed into the Management Summary\'s control effectiveness score.',
            },
        ],
    },

    'kris': {
        title: 'KRI Library',
        items: [
            {
                q: 'What is a KRI?',
                a: 'A Key Risk Indicator is a metric that signals when a risk exposure is changing. KRIs are leading indicators — they warn you before a risk event materialises, giving you time to act.',
            },
            {
                q: 'How do I set a threshold?',
                a: 'Each KRI has an Amber threshold (early warning) and a Red threshold (breach). When a reading crosses Amber the KRI is flagged for review. When it crosses Red it escalates to the CRO inbox.',
            },
            {
                q: 'What is the data source field?',
                a: 'The data source records where the KRI reading comes from — for example, a financial system, HR platform, or manual report. This supports auditability and makes it clear who is responsible for supplying the data.',
            },
        ],
    },

    'kri-register': {
        title: 'KRI Register',
        items: [
            {
                q: 'What is the difference between the KRI Library and the KRI Register?',
                a: 'The Library defines your KRIs (what you measure and thresholds). The Register is where you log actual readings over time. Think of the Library as the template and the Register as the data.',
            },
            {
                q: 'How often should I log readings?',
                a: 'Follow the frequency set on each KRI in the Library (monthly, quarterly, etc.). My Tasks will flag overdue readings so nothing is missed.',
            },
        ],
    },

    'horizon-scanning': {
        title: 'Horizon Scanning',
        items: [
            {
                q: 'What is Horizon Scanning?',
                a: 'A structured way to track external, emerging risks — regulatory, geopolitical, technology, economic, environmental, or social — before they become active risks in the Risk Register. Each signal is rated by likelihood, impact, and time horizon (near, medium, or long-term).',
            },
            {
                q: 'What do the statuses mean?',
                a: 'Draft (not yet reviewed), Monitoring (accepted as worth tracking), Escalated (raised for near-term attention), Converted (turned into a formal risk), and Dismissed (assessed and ruled out).',
            },
            {
                q: 'How do I turn a signal into a formal risk?',
                a: 'Once a signal is in Monitoring or Escalated status, Admins, CROs, Consultant CROs, and Risk Managers can click "Convert to risk," which creates a linked entry in the Risk Register and records the connection both ways.',
            },
            {
                q: 'What does the AI scan button do?',
                a: 'If an AI API key is configured (see AI Integration), it drafts candidate signals from external regulatory and news sources for review. Drafts are never published automatically — a qualified role must review and publish each one.',
            },
        ],
    },

    'incident-log': {
        title: 'Incident Log',
        items: [
            {
                q: 'What is the Incident Log for?',
                a: 'It captures operational incidents as they happen — the event, severity, affected department, root cause, and action taken — separately from the formal Risk Register, so nothing gets lost while it\'s still being investigated.',
            },
            {
                q: 'What are the three ways to handle a logged incident?',
                a: 'Link it to an existing risk if one already covers this exposure, create a new risk from it if this is a new type of exposure, or dismiss it with a written note (minimum 10 characters) if, on review, it doesn\'t warrant a risk entry.',
            },
            {
                q: 'What happens after I dismiss an incident?',
                a: 'The dismissal note is saved permanently against the incident record for audit purposes, and its register decision changes to "Dismissed." This can\'t be reversed from the page — contact an Admin if a dismissal needs to be corrected.',
            },
            {
                q: 'Who can log and action incidents?',
                a: 'Risk Managers, Risk Champions, Risk Owners, CROs, and Consultant CROs.',
            },
        ],
    },

    'issues': {
        title: 'Issues & Actions',
        items: [
            {
                q: 'What qualifies as an issue?',
                a: 'An issue is any identified gap, weakness, or failure in your controls or processes. Sources include control test failures, audit findings, regulatory notices, and customer complaints.',
            },
            {
                q: 'What happens when an issue is "Risk Accepted"?',
                a: 'Risk Accepted means the organization has formally decided to tolerate the issue without full remediation. This requires a disposition rationale, an approver name, and a review date — all of which are recorded for audit purposes.',
            },
            {
                q: 'How do priorities work?',
                a: 'Issues are rated Low, Medium, High, or Critical. High and Critical issues appear prominently in the Management Summary and trigger escalation notifications based on your escalation rules.',
            },
        ],
    },

    'scoring-methodology': {
        title: 'Scoring Methodology',
        items: [
            {
                q: 'How is risk scored?',
                a: 'Risk score = Likelihood × Impact, both rated 1–5. The result is a 1–25 score mapped to: Low (1–4), Medium (5–9), High (10–14), Extreme (15–25). You can view the full matrix on this page.',
            },
            {
                q: 'Can I customise the scoring matrix?',
                a: 'Yes. Admins can adjust the label thresholds and colour coding to match your organization\'s risk appetite framework. Changes apply immediately to all risk scores.',
            },
        ],
    },

    'risk-gov-docs': {
        title: 'Risk Gov. Documents',
        items: [
            {
                q: 'What is the Risk Governance Documents library for?',
                a: 'A central place to store your risk framework\'s governing documents — policies, charters, methodology papers, board-approved frameworks — organised by category, separate from day-to-day evidence attachments on individual risks.',
            },
            {
                q: 'What file types and sizes are supported?',
                a: 'Any common document type (PDF, Word, Excel, etc.) up to 10MB per file. There\'s also a 500MB total storage quota per organisation, shared with evidence attachments — check Storage & Health if you\'re getting close to the limit.',
            },
            {
                q: 'Can I keep multiple versions of a document?',
                a: 'Yes. Uploading a new version to an existing document keeps the prior version accessible rather than overwriting it, so you always have a record of what changed and when.',
            },
            {
                q: 'Who can upload or delete documents?',
                a: 'Admins, Super Admins, CROs, Consultant CROs, and Risk Managers.',
            },
        ],
    },

    'forms-templates': {
        title: 'Forms & Templates',
        items: [
            {
                q: 'What can I generate here?',
                a: 'Two branded, letterhead-formatted reports: the Accepted Risk Report (all risks with an "Accept" treatment strategy over a chosen date range, with your commentary) and the Risk Management Pack (a broader executive pack covering the risk heatmap, top risks, KRIs, issues, and compliance status).',
            },
            {
                q: 'How do I generate the Accepted Risk Report?',
                a: 'Choose a date range, review the risks that fall within it, optionally add commentary per risk, then generate — it opens as a print-ready page in a new tab using your organisation\'s logo and colours.',
            },
            {
                q: 'Can I customise which sections appear in the Management Pack?',
                a: 'The pack\'s sections are fixed (heatmap, top risks, KRIs, issues, compliance), but the underlying data always reflects the current state of each module at the time you generate it.',
            },
            {
                q: 'Is this the same as CSV export?',
                a: 'No — these are polished, presentation-ready reports for board or client packs. For raw data exports, use Import / Export instead.',
            },
        ],
    },

    'obligations': {
        title: 'Compliance Obligations',
        items: [
            {
                q: 'What is a compliance obligation?',
                a: 'A compliance obligation is a legal, regulatory, or contractual requirement your organization must meet. Examples include data protection laws, industry regulations, and contractual SLAs.',
            },
            {
                q: 'How do obligations link to policies and controls?',
                a: 'Each obligation can be mapped to the policies and controls that satisfy it. This mapping makes it easy to demonstrate compliance during audits — you can show the regulator exactly what you have in place.',
            },
        ],
    },

    'calendar': {
        title: 'Compliance Calendar',
        items: [
            {
                q: 'What appears on the Compliance Calendar?',
                a: 'The calendar shows all upcoming compliance deadlines: policy review dates, KRI reading due dates, obligation renewal dates, and issue remediation target dates.',
            },
            {
                q: 'Can I export the calendar?',
                a: 'Use the Import / Export tool to export calendar items as a CSV. For direct calendar integration, contact your administrator.',
            },
        ],
    },

    'glossary': {
        title: 'Glossary',
        items: [
            {
                q: 'What is the Glossary for?',
                a: 'The Glossary provides organization-specific definitions for GRC terms. Admins can add, edit, and remove entries. All users can search and browse. It ensures consistent terminology across your GRC program.',
            },
        ],
    },

    'data-tools': {
        title: 'Import / Export',
        items: [
            {
                q: 'What can I import?',
                a: 'You can import risks, controls, KRIs, policies, and issues from CSV files. This is useful when migrating from a spreadsheet-based GRC program. Download the template first to ensure the correct column format.',
            },
            {
                q: 'What can I export?',
                a: 'All modules support CSV export. Exports include all fields visible in the module table. Use exports for offline analysis, board reporting, or audit evidence packages.',
            },
        ],
    },

    'users': {
        title: 'Users & Access',
        items: [
            {
                q: 'What roles are available?',
                a: 'Super Admin (unrestricted access across the platform, used for demos and setup), Admin (full company access including user management), Risk Manager (creates and edits risks, controls, KRIs, issues, and policies within their assigned department(s)), Risk Owner and Risk Champion (department-scoped operational roles for raising and maintaining risk items), CRO (read access across all modules plus risk acceptance and approval authority), Consultant CRO (the same access as CRO, granted temporarily to an external consultant), and Viewer (read-only access to published policies and attestation).',
            },
            {
                q: 'What happens when I create a new user?',
                a: 'A temporary password is generated and emailed to the user. They are required to change it on first login. MFA enrollment is prompted immediately after.',
            },
            {
                q: 'Can a user belong to more than one department?',
                a: 'Yes. Managers can be assigned multiple departments, giving them visibility and edit access across all of them.',
            },
        ],
    },

    'escalation-rules': {
        title: 'Escalation Rules',
        items: [
            {
                q: 'What are escalation rules?',
                a: 'Escalation rules define who gets notified when specific events occur — for example, when a High-priority issue is raised, or when a risk score breaches a threshold. Rules trigger email alerts automatically.',
            },
            {
                q: 'Who can configure escalation rules?',
                a: 'Only Admins can create or modify escalation rules.',
            },
        ],
    },

    'email-settings': {
        title: 'Email Settings',
        items: [
            {
                q: 'What can I configure here?',
                a: 'Email Settings lets you configure the sender address and SMTP relay used for system notifications — including password resets, task alerts, and escalation emails.',
            },
        ],
    },

    'branding': {
        title: 'Branding',
        items: [
            {
                q: 'What branding options are available?',
                a: 'You can upload your organization\'s logo and set a primary color. The logo appears in the sidebar. Changes apply immediately for all users.',
            },
        ],
    },

    'audit': {
        title: 'Audit Log',
        items: [
            {
                q: 'What does the Audit Log record?',
                a: 'The Audit Log records every significant action in the system: risk approvals, policy changes, user management actions, KRI threshold breaches, issue status changes, and login events. It is append-only and cannot be edited.',
            },
            {
                q: 'Can I export the Audit Log?',
                a: 'Yes. Use the Export button to download the full log as CSV. This is commonly used to provide evidence during SOC 2 or ISO 27001 audits.',
            },
        ],
    },

    'storage-health': {
        title: 'Storage & Health',
        items: [
            {
                q: 'What does this page show?',
                a: 'Storage & Health tracks how much of your evidence and document storage quota is in use. Evidence files (attached to risks, controls, issues, obligations, and KRIs) and Risk Governance Documents share a combined 500MB quota per organisation, stored directly in the application database.',
            },
            {
                q: "What happens if I'm near the quota?",
                a: 'New uploads are blocked once the 500MB limit is reached. Use this page to see which module is consuming the most space, and remove attachments that are no longer needed to free up room.',
            },
            {
                q: 'Can I delete files from here?',
                a: 'Yes — Admins can review and delete individual files directly from this page if storage needs to be freed up.',
            },
        ],
    },

    'companies': {
        title: 'Company Structure',
        items: [
            {
                q: 'What is the Company Structure page for?',
                a: 'Company Structure lets you configure parent-subsidiary relationships for multi-entity organizations. A parent company Admin can access a consolidated Group Dashboard that aggregates risk and compliance data across all subsidiaries.',
            },
        ],
    },

    'departments': {
        title: 'Departments',
        items: [
            {
                q: 'What are departments used for?',
                a: 'Departments let you segment risks, controls, issues, and KRIs by business unit. When a Manager is assigned to a department, they see only the records belonging to that department. Admins always see everything.',
            },
            {
                q: 'Can I rename or delete a department?',
                a: 'Yes. Renaming a department updates all linked records automatically. Deleting a department is only permitted if no records are currently assigned to it.',
            },
        ],
    },

    'business-units': {
        title: 'Business Units',
        items: [
            {
                q: 'What are Business Units for?',
                a: 'For organisations structured into multiple divisions, Business Units let you group departments under a larger unit — so reporting, risk register filtering, and dashboards can roll up at the business-unit level as well as the department level.',
            },
            {
                q: 'How do I create one?',
                a: 'Enter a name and a short code is suggested automatically (you can edit it). Business Units only appear for companies with Business Unit mode enabled.',
            },
            {
                q: 'Can I rename or delete a Business Unit?',
                a: 'Renaming updates everywhere it\'s referenced automatically. Deleting is blocked if any department is still assigned to it — reassign those departments first.',
            },
            {
                q: 'Who manages Business Units?',
                a: 'Admins only.',
            },
        ],
    },

    'ai-integration': {
        title: 'AI Integration',
        items: [
            {
                q: 'What does this enable?',
                a: 'Configuring an AI API key (from any provider with a chat-completion endpoint, e.g. Anthropic or OpenAI) turns on the AI-assisted scan in Horizon Scanning, which drafts candidate emerging-risk signals from external sources for human review.',
            },
            {
                q: 'Is the API key secure?',
                a: 'Yes — it\'s stored and used entirely server-side. It\'s never sent to the browser; this page only ever shows a masked version (last 4 characters) once saved.',
            },
            {
                q: 'Who can trigger an AI scan once a key is configured?',
                a: 'CRO, Consultant CRO, and Risk Manager roles. Drafts it produces always land in Draft status and require a qualified role to review and publish before they appear as active signals.',
            },
            {
                q: 'What happens if I remove the key?',
                a: 'The AI scan button in Horizon Scanning is disabled immediately. Manual signal entry is unaffected — only the AI-assisted drafting feature depends on the key.',
            },
        ],
    },

    'risk-config': {
        title: 'Risk Configuration',
        items: [
            {
                q: 'What is Risk Configuration for?',
                a: 'It manages the two-level risk taxonomy — categories and their sub-categories — that populates the dropdowns used when creating or editing a risk in the Risk Register.',
            },
            {
                q: 'How do I add a category or sub-category?',
                a: 'Use the add option under the category list to create a new top-level category, or expand an existing category to add a sub-category beneath it.',
            },
            {
                q: 'Can I rename an existing category?',
                a: 'Yes, inline — click into the category or sub-category name, edit it, and save. The change is reflected everywhere that category is already used.',
            },
            {
                q: 'Who can manage the risk taxonomy?',
                a: 'Admins only.',
            },
        ],
    },

};

export function getHelp(pageId) {
    return HELP_CONTENT[pageId] || null;
}
