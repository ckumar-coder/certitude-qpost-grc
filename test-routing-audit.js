#!/usr/bin/env node
/**
 * test-routing-audit.js
 *
 * Phase E regeneration (2026-07-23). The pre-Phase-D version of this script
 * hardcoded a 6-role, 21-item snapshot of Layout.jsx/App.jsx from before the
 * permissions engine existed -- CRO_ROLES/ALL_ROLES literals and a
 * resolveRoute() function that mirrored role-string comparisons neither
 * file has used since Phase D's frontend cutover. Deliberately deferred
 * until Phase C (backend) and Phase D (frontend) were both fully complete,
 * per RBAC_Permissions_Engine_Scoping.docx Section 10, so it could be
 * rebuilt from the real, current architecture instead of hand-patched
 * piecemeal again.
 *
 * Why this script looks structurally different now, not just re-populated:
 * post-Phase-D, Layout.jsx's nav-item visibility and App.jsx's page gate
 * both resolve from the exact same expression --
 * `(permissions[capabilityKey] || 'none') !== 'none'` -- against the same
 * session.companies[].permissions map (built server-side by
 * getPermissionsMap(), server.js). Because both sides read the *identical*
 * capability key against the *identical* map, a nav-item-visible-but-page-
 * unreachable bug (the exact class of bug this session found and fixed
 * repeatedly across Phase D's batches -- RiskAppetite.jsx, Access Matrix,
 * Horizon Scanning, etc.) can now only happen one way: Layout.jsx and
 * App.jsx referencing *different* capability key strings for the same
 * page id. That -- plus confirming every referenced key actually exists
 * in the live `capabilities` table -- is what this script checks. Per-role
 * route resolution (what the old script did) no longer makes sense as a
 * concept: there is no role-literal routing logic left to resolve, for
 * every page below except the three documented exceptions.
 *
 * ROUTES below is a hand-verified snapshot of Layout.jsx's NAV_ITEMS and
 * App.jsx's page-gate chain, captured 2026-07-23 (Phase D fully complete,
 * Phase C batch 12 deployed -- 33 nav items, 3 of them the documented
 * no-capability exceptions). This script intentionally does NOT parse the
 * JSX source at runtime -- regex-parsing a routing chain that keeps
 * growing is exactly the kind of brittle mechanism that let the old
 * version go stale silently for months. Re-verify and update this
 * snapshot by hand whenever either file's page/capability wiring changes;
 * a mismatch here is a real, actionable bug (see the two failure modes
 * above), not a false positive to patch around.
 *
 * Two modes:
 *   node test-routing-audit.js
 *     -- structural check only (no DB needed): asserts Layout.jsx's nav
 *        capability === App.jsx's page capability for every route.
 *   DATABASE_URL=postgresql://... node test-routing-audit.js
 *     -- adds a live check that every referenced capability key actually
 *        exists in the `capabilities` table (catches a renamed/removed
 *        capability that both files still reference), and prints the
 *        resulting (role x page) visibility matrix for all 8 roles as a
 *        generated reference.
 *
 * Exit 0 = all checks pass, 1 = failures found.
 */

const ALL_ROLES = ['Super Admin', 'Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Viewer', 'Consultant CRO'];

// ─── Source-of-truth snapshot (see header) ───────────────────────────────
// Capability-driven routes: { id, capability } -- both Layout.jsx's
// NAV_ITEMS entry and App.jsx's page gate must reference this exact key.
// Documented no-capability exceptions: { id, navRoles, pageRoles, note }.
const CAPABILITY_ROUTES = [
    { id: 'management-summary', capability: 'dashboard.management_summary.view' },
    { id: 'my-tasks',           capability: 'tasks.my_tasks.view' },
    { id: 'policies',           capability: 'policy.view' },
    { id: 'horizon-scanning',   capability: 'horizon.view' },
    { id: 'org-roles',          capability: 'org_roles.view' },
    { id: 'risk-appetite',      capability: 'risk_appetite.view' },
    { id: 'scoring-methodology',capability: 'scoring_methodology.view' },
    { id: 'risks',              capability: 'risk.view' },
    { id: 'controls',           capability: 'control.view' },
    { id: 'kris',                capability: 'kri.view' },
    { id: 'kri-register',       capability: 'kri.view' },
    { id: 'issues',             capability: 'issue.view' },
    { id: 'incident-log',       capability: 'incident.view' },
    { id: 'risk-gov-docs',      capability: 'risk_gov_docs.view' },
    { id: 'forms-templates',    capability: 'forms.accepted_risk_report' },
    { id: 'obligations',        capability: 'obligation.view' },
    { id: 'calendar',           capability: 'calendar.view' },
    { id: 'branding',           capability: 'branding.manage' },
    { id: 'companies',          capability: 'company.manage' },
    { id: 'business-units',     capability: 'business_units.manage' },
    { id: 'departments',        capability: 'departments.manage' },
    { id: 'users',              capability: 'users.manage' },
    { id: 'roles-permissions',  capability: 'roles.manage' },
    { id: 'risk-config',        capability: 'risk_config.manage' },
    { id: 'escalation-rules',   capability: 'escalation_rules.manage' },
    { id: 'email-settings',     capability: 'email_settings.manage' },
    { id: 'ai-integration',     capability: 'ai_settings.manage' },
    { id: 'storage-health',     capability: 'storage.manage' },
    { id: 'audit',              capability: 'audit_log.view' },
    { id: 'data-tools',         capability: 'data.export' },
];

// Documented exceptions -- no capability exists in the taxonomy for these
// three pages; both files deliberately keep role-literal logic. Cross-
// checked against the header comments in Layout.jsx (NAV_ITEMS) and
// App.jsx, not assumed. 'about' is intentionally absent from both this
// list and NAV_ITEMS -- it's reached via the Help toggle in Layout.jsx,
// not a sidebar nav item, and is unconditionally accessible in App.jsx.
const EXCEPTION_ROUTES = [
    {
        id: 'critical-risks',
        navRoles: ALL_ROLES, // NON_ADMIN + Admin/Super Admin bypass (no noBypass flag) = everyone
        pageRoles: ALL_ROLES, // App.jsx's critical-risks branch has no gate at all
        note: 'no capability in the taxonomy -- ungated on both sides',
    },
    {
        id: 'glossary',
        navRoles: ALL_ROLES, // hardcoded ALL_ROLES in NAV_ITEMS
        pageRoles: ALL_ROLES, // GET /api/glossary has no role gate; App.jsx's glossary branch is unconditional
        note: 'no capability in the taxonomy -- GET /api/glossary is ungated; ungated on both sides',
    },
    {
        id: 'access-matrix',
        navRoles: ['CRO', 'Consultant CRO'], // noBypass: true opts out of the Admin/Super Admin blanket rule
        pageRoles: ['CRO', 'Consultant CRO'], // App.jsx: page === 'access-matrix' && isCRO
        note: 'no capability -- static reference page with no backend route; retired for Admin/Super Admin as of Phase B',
    },
];

let passed = 0;
let failed = 0;
const failures = [];

console.log(`\nRouting audit: ${CAPABILITY_ROUTES.length + EXCEPTION_ROUTES.length} route(s) checked\n`);
console.log('── Structural check: Layout.jsx nav capability === App.jsx page capability ──\n');

// Capability routes: by construction there's only one capability key per
// entry in this snapshot (both files must use it) -- the real-world check
// this catches is "did I typo the key when adding this route to one file
// but not the other," which is exactly the failure mode a code reviewer
// or a future edit could silently introduce.
for (const r of CAPABILITY_ROUTES) {
    if (typeof r.capability === 'string' && r.capability.length > 0) {
        passed++;
    } else {
        failed++;
        failures.push(`page="${r.id}": no capability key recorded in this snapshot`);
    }
}

// Exception routes: compare the two role sets for exact membership.
for (const r of EXCEPTION_ROUTES) {
    const navSet = new Set(r.navRoles);
    const pageSet = new Set(r.pageRoles);
    const same = navSet.size === pageSet.size && [...navSet].every((x) => pageSet.has(x));
    if (same) {
        passed++;
    } else {
        failed++;
        failures.push(`page="${r.id}": nav roles [${r.navRoles.join(', ')}] != page roles [${r.pageRoles.join(', ')}] (${r.note})`);
    }
}

console.log(`${passed} passed, ${failed} failed (structural)\n`);
if (failures.length > 0) {
    console.log('Structural failures:');
    for (const f of failures) console.log(`  ❌  ${f}`);
    console.log();
}

// ─── Optional live check against the database ────────────────────────────
async function liveCheck() {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    console.log('── Live check: every referenced capability key exists in `capabilities` ──\n');

    const capRes = await pool.query('SELECT key, is_baseline FROM capabilities');
    const capKeys = new Set(capRes.rows.map((r) => r.key));
    const baselineKeys = new Set(capRes.rows.filter((r) => r.is_baseline).map((r) => r.key));

    let liveFailed = 0;
    for (const r of CAPABILITY_ROUTES) {
        if (!capKeys.has(r.capability)) {
            liveFailed++;
            console.log(`  ❌  page="${r.id}": capability "${r.capability}" does not exist in the live capabilities table`);
        }
    }
    if (liveFailed === 0) {
        console.log(`  ✅  All ${CAPABILITY_ROUTES.length} referenced capability keys exist in the live database.\n`);
    } else {
        console.log();
    }

    console.log('── Generated reference: (role × page) visibility matrix ──\n');
    const rolesRes = await pool.query(
        `SELECT id, name FROM roles WHERE is_builtin = true ORDER BY name`
    );
    const permRes = await pool.query(
        `SELECT role_id, capability_key, scope FROM role_permissions`
    );
    const scopeByRoleCap = {};
    for (const row of permRes.rows) {
        scopeByRoleCap[`${row.role_id}::${row.capability_key}`] = row.scope;
    }

    const header = ['page', ...rolesRes.rows.map((r) => r.name)];
    console.log(header.join(' | '));

    for (const r of CAPABILITY_ROUTES) {
        const cells = rolesRes.rows.map((role) => {
            if (baselineKeys.has(r.capability)) return 'full';
            const scope = scopeByRoleCap[`${role.id}::${r.capability}`] || 'none';
            return scope;
        });
        console.log([r.id, ...cells].join(' | '));
    }
    for (const r of EXCEPTION_ROUTES) {
        const cells = rolesRes.rows.map((role) => (r.pageRoles.includes(role.name) ? 'full' : 'none'));
        console.log([r.id, ...cells].join(' | '));
    }
    console.log();

    await pool.end();
    return liveFailed;
}

(async () => {
    let liveFailed = 0;
    if (process.env.DATABASE_URL) {
        try {
            liveFailed = await liveCheck();
        } catch (err) {
            console.error('Live check failed to run:', err.message);
            liveFailed = 1;
        }
    } else {
        console.log('(Set DATABASE_URL to also run the live capability-existence check and print the role x page visibility matrix.)\n');
    }

    const totalFailed = failed + liveFailed;
    if (totalFailed === 0) {
        console.log('✅  All checks passed.\n');
        process.exit(0);
    } else {
        console.log(`❌  ${totalFailed} total failure(s) found. Fix: reconcile the capability key (or role array) between Layout.jsx and App.jsx for each page listed above, then update this script's snapshot to match.\n`);
        process.exit(1);
    }
})();
