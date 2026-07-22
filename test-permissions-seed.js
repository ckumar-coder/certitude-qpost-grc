#!/usr/bin/env node
// ============================================================
// test-permissions-seed.js — Phase A regression check
// ============================================================
// Verifies that the permissions-engine seed (schema_v75_permissions_engine.sql)
// landed exactly as decided in RBAC_Permissions_Engine_Scoping.docx v1.1,
// Section 11 (Decisions Log). This is the "fourth test asset" recommended in
// Section 3.9 -- it walks every seeded (role, capability) pair and asserts it
// matches the DECIDED target state, not (per Decision 4) today's literal
// pre-existing hardcoded behaviour.
//
// Usage:
//   DATABASE_URL=postgresql://... node test-permissions-seed.js
//
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
// Requires Node 18+ and the 'pg' package (already a dependency of this app).
// ============================================================

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
    console.error('\n  Usage: DATABASE_URL=postgresql://... node test-permissions-seed.js\n');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Expected target state, generated directly from the same source data used
// to build schema_v75_permissions_engine.sql's seed -- see the Phase A build
// notes in CLAUDE.md (2026-07-22 entry) for how this was derived from
// Section 3 of the scoping doc plus Decisions 1-5.
const EXPECTED = {
    "BASELINE": {
        "audit_log.view": {
            "label": "View audit log (safety baseline \u2014 see Decision 3)",
            "module": "Audit"
        },
        "incident.create": {
            "label": "Create an incident report (safety baseline \u2014 see Decision 3)",
            "module": "Incident Log"
        }
    },
    "CAPS": {
        "ai_settings.manage": {
            "label": "Manage AI integration settings",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "branding.manage": {
            "label": "Manage branding",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "business_units.manage": {
            "label": "Manage business units",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "calendar.view": {
            "label": "View compliance calendar",
            "module": "Compliance Obligations & Calendar",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "company.manage": {
            "label": "Manage company profile",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "control.create": {
            "label": "Create/edit controls",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "control.edit": {
            "label": "Edit controls",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "control.link_to_risk": {
            "label": "Link control to risk",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "control.test": {
            "label": "Record a control test result",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "control.test_history.view": {
            "label": "View control test history",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "full",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "control.view": {
            "label": "View controls",
            "module": "Control Library",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "dashboard.management_summary.view": {
            "label": "View management summary dashboard",
            "module": "Dashboards & Tasks",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "data.export": {
            "label": "Export data",
            "module": "Import / Export / Search",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "data.import": {
            "label": "Import data",
            "module": "Import / Export / Search",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "data.seed_controls": {
            "label": "Seed reference controls",
            "module": "Import / Export / Search",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "departments.manage": {
            "label": "Manage departments",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "email_settings.manage": {
            "label": "Manage email settings",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "escalation_rules.manage": {
            "label": "Manage escalation rules",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "evidence.bulk_manage": {
            "label": "Bulk evidence admin tools",
            "module": "Evidence",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "evidence.delete": {
            "label": "Delete evidence",
            "module": "Evidence",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "evidence.upload": {
            "label": "Upload evidence",
            "module": "Evidence",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "evidence.view": {
            "label": "View / download evidence",
            "module": "Evidence",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "forms.accepted_risk_report": {
            "label": "Accepted-risk report / Management Pack",
            "module": "Risk Gov. Documents & Forms",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "glossary.manage": {
            "label": "Manage glossary",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "horizon.ai_draft": {
            "label": "Generate AI draft scan",
            "module": "Horizon Scanning",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "horizon.delete": {
            "label": "Delete a horizon scan",
            "module": "Horizon Scanning",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "horizon.manage": {
            "label": "Create/edit/convert horizon scans",
            "module": "Horizon Scanning",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "horizon.view": {
            "label": "View horizon scans",
            "module": "Horizon Scanning",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "incident.delete": {
            "label": "Delete an incident",
            "module": "Incident Log",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "incident.dismiss": {
            "label": "Dismiss an incident",
            "module": "Incident Log",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "incident.edit": {
            "label": "Edit an incident",
            "module": "Incident Log",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "incident.link_risk": {
            "label": "Link incident to a risk",
            "module": "Incident Log",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "incident.view": {
            "label": "View incidents",
            "module": "Incident Log",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "issue.action.manage": {
            "label": "Manage issue action items",
            "module": "Issues & Actions",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "none",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "issue.create": {
            "label": "Create an issue",
            "module": "Issues & Actions",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "issue.edit": {
            "label": "Edit an issue",
            "module": "Issues & Actions",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "issue.update_status": {
            "label": "Update issue status",
            "module": "Issues & Actions",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "none",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "issue.view": {
            "label": "View issues",
            "module": "Issues & Actions",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "kri.manage_definition": {
            "label": "Define/edit a KRI",
            "module": "KRI Library & Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "kri.record_measurement": {
            "label": "Record a KRI measurement",
            "module": "KRI Library & Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "kri.view": {
            "label": "View KRIs",
            "module": "KRI Library & Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "obligation.manage": {
            "label": "Manage obligations",
            "module": "Compliance Obligations & Calendar",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "obligation.view": {
            "label": "View obligations",
            "module": "Compliance Obligations & Calendar",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "obligation.view_history": {
            "label": "View obligation history",
            "module": "Compliance Obligations & Calendar",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "org_roles.manage": {
            "label": "Manage org roles directory",
            "module": "Org Roles (RACI)",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "org_roles.view": {
            "label": "View org roles / RACI",
            "module": "Org Roles (RACI)",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "policy.attest": {
            "label": "Attest to a policy",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "policy.create": {
            "label": "Create a policy",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "policy.edit": {
            "label": "Edit a policy / new version",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "policy.manage_confidential_access": {
            "label": "Manage confidential policy access list",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "policy.transition": {
            "label": "Transition policy status",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "policy.view": {
            "label": "View policies",
            "module": "Policy Repository",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "raci.edit": {
            "label": "Edit RACI matrix",
            "module": "Org Roles (RACI)",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "raci.view": {
            "label": "View RACI matrix",
            "module": "Org Roles (RACI)",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "risk.approve_first_line": {
            "label": "First-line risk approval (Approver step)",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.approve_manager": {
            "label": "Manager-level risk approval",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.auto_approve": {
            "label": "Auto-approve own submitted risks",
            "module": "Risk Register",
            "scopes": {
                "Admin": "none",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.close": {
            "label": "Close a risk",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.create": {
            "label": "Create a risk",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.cro_accept": {
            "label": "CRO risk acceptance",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.cro_decline": {
            "label": "CRO decline / send back",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.edit": {
            "label": "Edit a risk",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "own",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "risk.link_related": {
            "label": "Link related risks",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.mitigation.manage": {
            "label": "Manage mitigation action plan items",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "risk.reject": {
            "label": "Reject/send back a risk",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.reopen": {
            "label": "Reopen a risk",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk.view": {
            "label": "View risks",
            "module": "Risk Register",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "dept",
                "Risk Manager": "dept",
                "Risk Owner": "dept",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": true
        },
        "risk_appetite.manage": {
            "label": "Manage risk appetite statements",
            "module": "Risk Appetite & Scoring",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk_appetite.view": {
            "label": "View risk appetite statements",
            "module": "Risk Appetite & Scoring",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "risk_config.manage": {
            "label": "Manage risk configuration/taxonomy",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk_gov_docs.manage": {
            "label": "Manage risk governance documents",
            "module": "Risk Gov. Documents & Forms",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "risk_gov_docs.view": {
            "label": "View risk governance documents",
            "module": "Risk Gov. Documents & Forms",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "full",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "roles.manage": {
            "label": "Manage roles & permissions (this engine\u2019s own admin screen)",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "scoring_methodology.manage": {
            "label": "Manage scoring methodology",
            "module": "Risk Appetite & Scoring",
            "scopes": {
                "Admin": "none",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "none",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "scoring_methodology.view": {
            "label": "View scoring methodology",
            "module": "Risk Appetite & Scoring",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "full",
                "Risk Manager": "full",
                "Risk Owner": "full",
                "Super Admin": "full",
                "Viewer": "full"
            },
            "supportsScope": false
        },
        "search.global": {
            "label": "Global search",
            "module": "Import / Export / Search",
            "scopes": {
                "Admin": "full",
                "CRO": "full",
                "Consultant CRO": "full",
                "Risk Champion": "own",
                "Risk Manager": "dept",
                "Risk Owner": "own",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "storage.manage": {
            "label": "Manage storage & health tools",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        },
        "tasks.my_tasks.view": {
            "label": "View My Tasks (identity-scoped, always self)",
            "module": "Dashboards & Tasks",
            "scopes": {
                "Admin": "full",
                "CRO": "own",
                "Consultant CRO": "own",
                "Risk Champion": "own",
                "Risk Manager": "own",
                "Risk Owner": "own",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": true
        },
        "users.manage": {
            "label": "Manage users",
            "module": "Users & Company Admin",
            "scopes": {
                "Admin": "full",
                "CRO": "none",
                "Consultant CRO": "none",
                "Risk Champion": "none",
                "Risk Manager": "none",
                "Risk Owner": "none",
                "Super Admin": "full",
                "Viewer": "none"
            },
            "supportsScope": false
        }
    },
    "ROLES": [
        "Admin",
        "Super Admin",
        "Risk Manager",
        "Risk Champion",
        "Risk Owner",
        "CRO",
        "Consultant CRO",
        "Viewer"
    ]
};

let failures = 0;
let checks = 0;

function ok(name) {
    checks++;
    console.log(`  \u2705  ${name}`);
}

function fail(name, detail) {
    checks++;
    failures++;
    console.log(`  \u274c  ${name}`);
    if (detail) console.log(`       ${detail}`);
}

async function main() {
    console.log('========================================================');
    console.log('  Phase A regression: permissions engine seed');
    console.log('========================================================\n');

    const rolesRes = await pool.query(
        "SELECT id, name, is_builtin FROM roles WHERE company_id IS NULL ORDER BY name"
    );
    const roleByName = {};
    for (const r of rolesRes.rows) roleByName[r.name] = r;

    // ── 1. Exactly the 8 expected built-in roles, nothing else ──────────
    const expectedRoleSet = new Set(EXPECTED.ROLES);
    const actualRoleSet = new Set(rolesRes.rows.map((r) => r.name));
    if (rolesRes.rows.length === EXPECTED.ROLES.length &&
        EXPECTED.ROLES.every((r) => actualRoleSet.has(r))) {
        ok(`Exactly the ${EXPECTED.ROLES.length} expected built-in roles are seeded`);
    } else {
        fail('Built-in role set mismatch',
            `expected [${EXPECTED.ROLES.join(', ')}], got [${[...actualRoleSet].join(', ')}]`);
    }

    // ── 2. 'Approver' must NOT exist (Finding 4) ─────────────────────────
    if (!actualRoleSet.has('Approver')) {
        ok("Orphaned 'Approver' role is not seeded (Finding 4)");
    } else {
        fail("'Approver' role should not exist", 'Finding 4 was resolved as: delete outright');
    }

    // ── 3. All 8 roles are marked is_builtin = true ──────────────────────
    const nonBuiltin = rolesRes.rows.filter((r) => !r.is_builtin);
    if (nonBuiltin.length === 0) {
        ok('All built-in roles have is_builtin = true');
    } else {
        fail('Some built-in roles missing is_builtin flag', JSON.stringify(nonBuiltin));
    }

    // ── 4. Capabilities: configurable + baseline counts and flags ───────
    const capsRes = await pool.query('SELECT key, module, label, supports_scope, is_baseline FROM capabilities');
    const capByKey = {};
    for (const c of capsRes.rows) capByKey[c.key] = c;

    const expectedCapKeys = Object.keys(EXPECTED.CAPS);
    const expectedBaselineKeys = Object.keys(EXPECTED.BASELINE);
    const expectedTotal = expectedCapKeys.length + expectedBaselineKeys.length;

    if (capsRes.rows.length === expectedTotal) {
        ok(`Capability count matches expected (${expectedTotal}: ${expectedCapKeys.length} configurable + ${expectedBaselineKeys.length} baseline)`);
    } else {
        fail('Capability count mismatch', `expected ${expectedTotal}, got ${capsRes.rows.length}`);
    }

    for (const key of expectedCapKeys) {
        const c = capByKey[key];
        if (!c) { fail(`Capability missing: ${key}`); continue; }
        const exp = EXPECTED.CAPS[key];
        if (c.is_baseline !== false) {
            fail(`${key}: is_baseline should be false`, `got ${c.is_baseline}`);
        } else if (c.supports_scope !== exp.supportsScope) {
            fail(`${key}: supports_scope mismatch`, `expected ${exp.supportsScope}, got ${c.supports_scope}`);
        } else {
            ok(`${key}: capability row correct (module=${c.module}, supports_scope=${c.supports_scope})`);
        }
    }

    for (const key of expectedBaselineKeys) {
        const c = capByKey[key];
        if (!c) { fail(`Baseline capability missing: ${key}`); continue; }
        if (c.is_baseline !== true) {
            fail(`${key}: is_baseline should be true (Decision 3 safety baseline)`, `got ${c.is_baseline}`);
        } else {
            ok(`${key}: correctly marked as non-configurable safety baseline`);
        }
    }

    // ── 5. role_permissions: every (role, capability) cell matches ──────
    const rpRes = await pool.query(
        `SELECT r.name AS role_name, rp.capability_key, rp.scope
         FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
         WHERE r.company_id IS NULL`
    );
    const actualScope = {}; // actualScope[role][capability_key] = scope
    for (const row of rpRes.rows) {
        actualScope[row.role_name] = actualScope[row.role_name] || {};
        actualScope[row.role_name][row.capability_key] = row.scope;
    }

    let cellMismatches = 0;
    for (const key of expectedCapKeys) {
        const exp = EXPECTED.CAPS[key];
        for (const role of EXPECTED.ROLES) {
            const expectedScope = exp.scopes[role] || 'none';
            const actual = (actualScope[role] && actualScope[role][key]) || 'none';
            if (actual !== expectedScope) {
                fail(`${role} \u00d7 ${key}: scope mismatch`, `expected '${expectedScope}', got '${actual}'`);
                cellMismatches++;
            }
        }
    }
    if (cellMismatches === 0) {
        ok(`All ${expectedCapKeys.length * EXPECTED.ROLES.length} (role \u00d7 capability) cells match the decided target state`);
    }

    // ── 6. Baseline capabilities must have ZERO role_permissions rows ───
    for (const key of expectedBaselineKeys) {
        const rowsForKey = rpRes.rows.filter((r) => r.capability_key === key);
        if (rowsForKey.length === 0) {
            ok(`${key}: has no role_permissions rows (correctly outside the configurable grid)`);
        } else {
            fail(`${key}: should have zero role_permissions rows`, `found ${rowsForKey.length}`);
        }
    }

    // ── 7. Spot-check the two Admin/Super Admin exceptions ──────────────
    const adminScoring = (actualScope['Admin'] && actualScope['Admin']['scoring_methodology.manage']) || 'none';
    const superAdminScoring = (actualScope['Super Admin'] && actualScope['Super Admin']['scoring_methodology.manage']) || 'none';
    if (adminScoring === 'none' && superAdminScoring === 'none') {
        ok('Admin and Super Admin both correctly excluded from scoring_methodology.manage (Finding 5)');
    } else {
        fail('Admin/Super Admin scoring_methodology.manage exception broken',
            `Admin=${adminScoring}, Super Admin=${superAdminScoring}, both should be 'none'`);
    }
    const adminAutoApprove = (actualScope['Admin'] && actualScope['Admin']['risk.auto_approve']) || 'none';
    if (adminAutoApprove === 'none') {
        ok('Admin correctly excluded from risk.auto_approve (never part of the bypass in the first place)');
    } else {
        fail('Admin risk.auto_approve exception broken', `expected 'none', got '${adminAutoApprove}'`);
    }

    console.log(`\n========================================================`);
    console.log(`  ${checks - failures}/${checks} checks passed`);
    console.log(`========================================================\n`);

    await pool.end();
    process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error('Fatal error running regression check:', e);
    process.exit(1);
});
