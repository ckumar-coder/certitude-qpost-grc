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
                a: 'Admin has full access including user management. Manager can create and edit risks, controls, KRIs, issues, and policies within their department(s). Viewer can read published policies and attest. CRO has read access across all modules and handles risk acceptance. Risk Champion can raise issues and KRI readings.',
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
                a: 'Storage & Health shows the status of your evidence file storage (Google Cloud Storage) and database connectivity. It confirms that file uploads are being stored securely off-container and that database backups are running.',
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

    'maturity-assessment': {
        title: 'Maturity Assessment',
        items: [
            {
                q: 'What is the Maturity Assessment?',
                a: 'The Maturity Assessment is an independent diagnostic tool that scores your GRC program across key domains on a 1–5 maturity scale. It helps identify where your program is strong and where investment is most needed.',
            },
            {
                q: 'What do the maturity levels mean?',
                a: 'Level 1 (Initial) — ad hoc, undocumented. Level 2 (Developing) — some processes exist but are inconsistent. Level 3 (Defined) — documented and standardized. Level 4 (Managed) — measured and monitored. Level 5 (Optimizing) — continuously improved.',
            },
            {
                q: 'How are domains and questions set up?',
                a: 'An Admin configures the assessment domains (e.g., Risk Management, Policy Governance) and the Likert-scale questions within each domain. Domain weights must total 100% for the overall score to be meaningful.',
            },
            {
                q: 'How is the overall maturity score calculated?',
                a: 'Each domain score is the average of its question responses (1–5). The overall score is a weighted average of all domain scores, using the weights set by the Admin. Standard rounding applies.',
            },
            {
                q: 'Can I compare assessments over time?',
                a: 'Yes. The results view overlays the current assessment against the previous one on a radar chart, and shows delta scores per domain so you can track improvement or regression.',
            },
            {
                q: 'Who can run an assessment?',
                a: 'Admins and CROs can start and complete assessments. Admins also have access to the Setup tab to configure domains and questions.',
            },
        ],
    },
};

export function getHelp(pageId) {
    return HELP_CONTENT[pageId] || null;
}
