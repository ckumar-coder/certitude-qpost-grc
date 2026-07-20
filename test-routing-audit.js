#!/usr/bin/env node
/**
 * test-routing-audit.js
 *
 * Verifies that every (page, role) combination shown in the sidebar nav
 * resolves to a real component in App.jsx — not the error fallback.
 *
 * Run with:  node test-routing-audit.js
 *
 * No test framework needed. Exit 0 = all pass, exit 1 = failures found.
 */

const CRO_ROLES = ['Admin', 'Risk Manager', 'CRO', 'Consultant CRO'];
const ALL_ROLES  = ['Admin', 'Risk Champion', 'Risk Manager', 'CRO', 'Viewer', 'Consultant CRO'];

// ─── Source of truth: mirrors NAV_ITEMS in Layout.jsx ────────────────────────
const NAV_ITEMS = [
    { id: 'management-summary',  roles: CRO_ROLES },
    { id: 'my-tasks',            roles: ALL_ROLES },
    { id: 'policies',            roles: [...CRO_ROLES, 'Viewer'] },
    { id: 'org-roles',           roles: CRO_ROLES },
    { id: 'risks',               roles: CRO_ROLES },
    { id: 'controls',            roles: CRO_ROLES },
    { id: 'kris',                roles: CRO_ROLES },
    { id: 'kri-register',        roles: CRO_ROLES },
    { id: 'issues',              roles: CRO_ROLES },
    { id: 'scoring-methodology', roles: CRO_ROLES },
    { id: 'obligations',         roles: CRO_ROLES },
    { id: 'calendar',            roles: CRO_ROLES },
    { id: 'glossary',            roles: ALL_ROLES },
    { id: 'data-tools',          roles: CRO_ROLES },
    { id: 'users',               roles: ['Admin'] },
    { id: 'departments',         roles: ['Admin'] },
    { id: 'escalation-rules',    roles: ['Admin'] },
    { id: 'email-settings',      roles: ['Admin'] },
    { id: 'branding',            roles: ['Admin'] },
    { id: 'audit',               roles: CRO_ROLES },
    { id: 'storage-health',      roles: ['Admin'] },
    { id: 'companies',           roles: ['Admin'] },
    { id: 'maturity-assessment', roles: ['Admin', 'CRO', 'Consultant CRO'] },
];

// ─── Mirrors the routing logic in App.jsx ────────────────────────────────────
function resolveRoute(page, role) {
    const isCRO = role === 'CRO' || role === 'Consultant CRO';

    if (page === 'my-tasks')   return 'MyTasks';
    if (page === 'about')      return 'About';
    if (page === 'glossary')   return 'Glossary';
    if (page === 'policies')   return 'PolicyRepository';

    if (page === 'management-summary' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'ManagementSummary';
    if (page === 'users' && role === 'Admin')
        return 'UserManagement';
    if (page === 'audit' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'AuditLog';
    if (page === 'controls' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'ControlLibrary';
    if (page === 'kris' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'KriLibrary';
    if (page === 'kri-register' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'KriRegister';
    if (page === 'obligations' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'ComplianceObligations';
    if (page === 'issues' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'IssuesTracker';
    if (page === 'org-roles' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'OrgRoles';
    if (page === 'data-tools' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'DataTools';
    if (page === 'escalation-rules' && role === 'Admin')
        return 'EscalationRules';
    if (page === 'branding' && role === 'Admin')
        return 'Branding';
    if (page === 'storage-health' && role === 'Admin')
        return 'StorageHealth';
    if (page === 'departments' && role === 'Admin')
        return 'Departments';
    if (page === 'companies' && role === 'Admin')
        return 'Companies';
    if (page === 'scoring-methodology' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'ScoringMethodology';
    if (page === 'calendar' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'ComplianceCalendar';
    if (page === 'maturity-assessment' && (role === 'Admin' || isCRO))
        return 'MaturityAssessment';
    if (page === 'email-settings' && role === 'Admin')
        return 'EmailSettings';
    if (page === 'risks' && (role === 'Admin' || role === 'Risk Manager' || isCRO))
        return 'RiskRegister';

    // Catch-all fallbacks
    if (role === 'Admin' || role === 'Risk Manager' || isCRO) return 'RiskRegister';
    if (role === 'Viewer') return 'PolicyRepository';

    return '__ERROR__';
}

// ─── Run audit ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

for (const item of NAV_ITEMS) {
    for (const role of item.roles) {
        const result = resolveRoute(item.id, role);
        if (result === '__ERROR__') {
            failed++;
            failures.push({ page: item.id, role, result });
        } else {
            passed++;
        }
    }
}

// ─── Report ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nRouting audit: ${total} combinations tested\n`);

if (failures.length === 0) {
    console.log(`✅  All ${total} (page × role) combinations resolve correctly.\n`);
    process.exit(0);
} else {
    console.log(`❌  ${failed} failure(s) found:\n`);
    for (const f of failures) {
        console.log(`    page="${f.page}"  role="${f.role}"  → hits error fallback`);
    }
    console.log('\nFix: add an explicit route in App.jsx for each failure above.\n');
    process.exit(1);
}
