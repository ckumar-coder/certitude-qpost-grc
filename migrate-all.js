// migrate-all.js
//
// Applies schema files in order against DATABASE_URL. Uses a
// schema_migrations tracking table so each file is only ever applied
// once — re-running this script on an existing database is always safe.
//
// On first run against a database that already has schema up to v22
// (pre-tracking), the script detects the existing database and
// pre-seeds the tracking table with v2–v22 so they are not re-applied.
//
// Usage:
//   DATABASE_URL=postgresql://... node migrate-all.js

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Add new schema files here in order as they are introduced.
const SCHEMA_FILES = [
    'schema_v2.sql',
    'schema_v3_additions.sql',
    'schema_v4_additions.sql',
    'schema_v5_additions.sql',
    'schema_v6_additions.sql',
    'schema_v7_additions.sql',
    'schema_v8_additions.sql',
    'schema_v9_additions.sql',
    'schema_v10_additions.sql',
    'schema_v11_additions.sql',
    'schema_v12_additions.sql',
    'schema_v13_additions.sql',
    'schema_v14_additions.sql',
    'schema_v15_additions.sql',
    'schema_v16_legacy_cleanup.sql',
    'schema_v17_additions.sql',
    'schema_v18_additions.sql',
    'schema_v19_additions.sql',
    'schema_v20_role_governance.sql',
    'schema_v21_mfa.sql',
    'schema_v22_email_reset.sql',
    'schema_v23_control_owner_dept.sql',
    'schema_v24_bcm_tier1.sql',
    'schema_v25_disclaimer.sql',
    'schema_v26_departments_partial_unique.sql',
    'schema_v27_bcm_processes.sql',
    'schema_v28_bcm_bcps.sql',
    'schema_v29_bcm_bcp_tests.sql',
    'schema_v30_bcm_scenarios.sql',
    'schema_v31_bcm_dependencies.sql',
    'schema_v32_bcm_activations.sql',
    'schema_v33_risk_bcps.sql',
    'schema_v34_risk_library.sql',
    'schema_v35_consultant_benchmarking.sql',
    'schema_v36_is_critical.sql',
    'schema_v37_maturity_assessment.sql',
    'schema_v38_company_profile.sql',
    'schema_v39_training_videos.sql',
    'schema_v40_approver_role.sql',
    'schema_v41_risk_status_backfill.sql',
    'schema_v41_map_enhancements.sql',
    'schema_v42_fix_cro_declined.sql',
    'schema_v42_issues_recurrence.sql',
    'schema_v43_fix_cro_declined_v2.sql',
    'schema_v43_reopen_reason.sql',
    'schema_v44_evidence_board_approval.sql',
    'schema_v45_business_units.sql',
    'schema_v46_rename_submitter.sql',
    'schema_v47_risk_sub_categories.sql',
    'schema_v48_map_status_compensatory.sql',
    'schema_v49_rate_limit_attempts.sql',
    'schema_v50_map_constraints.sql',
    'schema_v51_role_constraint.sql',
    'schema_v52_bcm_activations_soft_delete.sql',
    'schema_v53_company_address.sql',
    'schema_v54_rename_roles.sql',
    'schema_v55_role_page_access.sql',
    'schema_v56_fix_controls_lib_constraint.sql',
    'schema_v57_raci_matrix.sql',
    'schema_v58_raised_by_dept.sql',
    'schema_v59_incident_log.sql',
    'schema_v60_risk_appetite.sql',
    'schema_v61_horizon_scanning.sql',
    'schema_v62_kri_appetite_link.sql',
    'schema_v63_ai_api_key.sql',
    'schema_v64_breach_notification_severity.sql',
    'schema_v65_ra_il_enhancements.sql',
    'schema_v66_issue_rejected_interim.sql',
    'schema_v67_issue_actions.sql',
    'schema_v68_super_admin.sql',
    'schema_v69_risk_governance_docs.sql',
    'schema_v70_risk_library_seed.sql',
    'schema_v71_remove_training_videos.sql',
    'schema_v72_risk_gov_docs_embed_storage.sql',
    'schema_v73_remove_bcm_module.sql',
    'schema_v74_remove_maturity_assessment.sql',
    'schema_v75_permissions_engine.sql',
];

// Files that were applied before migration tracking was introduced.
// On first run against an existing database these are pre-seeded as
// already applied so they are never re-executed against live data.
const PRE_TRACKING_FILES = [
    'schema_v2.sql',
    'schema_v3_additions.sql',
    'schema_v4_additions.sql',
    'schema_v5_additions.sql',
    'schema_v6_additions.sql',
    'schema_v7_additions.sql',
    'schema_v8_additions.sql',
    'schema_v9_additions.sql',
    'schema_v10_additions.sql',
    'schema_v11_additions.sql',
    'schema_v12_additions.sql',
    'schema_v13_additions.sql',
    'schema_v14_additions.sql',
    'schema_v15_additions.sql',
    'schema_v16_legacy_cleanup.sql',
    'schema_v17_additions.sql',
    'schema_v18_additions.sql',
    'schema_v19_additions.sql',
    'schema_v20_role_governance.sql',
    'schema_v21_mfa.sql',
    'schema_v22_email_reset.sql',
];

async function migrate() {
    const client = await pool.connect();
    try {
        // 1. Create the tracking table if it doesn't exist yet.
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
            )
        `);

        // 2. Check how many entries are already recorded.
        const { rows: recorded } = await client.query(
            'SELECT filename FROM schema_migrations'
        );
        const applied = new Set(recorded.map((r) => r.filename));

        // 3. If the tracking table is empty but the database already has
        //    the controls_lib table (from v3), this is an existing install
        //    that pre-dates tracking. Pre-seed v2–v22 as already applied.
        if (applied.size === 0) {
            const { rows } = await client.query(`
                SELECT to_regclass('public.controls_lib') AS tbl
            `);
            if (rows[0].tbl) {
                console.log('ℹ Existing database detected — pre-seeding migration history for v2–v22.');
                for (const file of PRE_TRACKING_FILES) {
                    await client.query(
                        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                        [file]
                    );
                    applied.add(file);
                }
            }
        }

        // 4. Apply only files not yet recorded.
        let ran = 0;
        for (const file of SCHEMA_FILES) {
            if (applied.has(file)) {
                console.log(`✓ ${file} already applied — skipping`);
                continue;
            }
            const filePath = path.join(__dirname, file);
            if (!fs.existsSync(filePath)) {
                console.log(`⚠ Skipping ${file} (not found)`);
                continue;
            }
            console.log(`↻ Applying ${file}...`);
            const sql = fs.readFileSync(filePath, 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1)',
                    [file]
                );
                await client.query('COMMIT');
                console.log(`✔ ${file} applied`);
                ran++;
            } catch (e) {
                await client.query('ROLLBACK');
                throw new Error(`Failed applying ${file}: ${e.message}`);
            }
        }

        if (ran === 0) {
            console.log('✅ Database is already at the latest version. Nothing to do.');
        } else {
            console.log(`🎉 Applied ${ran} migration(s). Database is at the latest version.`);
        }

        // ── Post-migration data repair (idempotent, always runs) ──────────────
        // Any Approved Accept/Avoid risk missing cro_acceptance_status should be
        // routed to the CRO queue. This covers risks re-approved by a Manager
        // before the manager-approve endpoint was patched to set pending_cro.
        const fixRes = await client.query(`
            UPDATE risks
            SET cro_acceptance_status = 'pending_cro'
            WHERE approval_status = 'Approved'
              AND cro_acceptance_status IS NULL
              AND treatment_strategy IN ('Accept', 'Avoid')
        `);
        if (fixRes.rowCount > 0) {
            console.log(`🔧 Repaired ${fixRes.rowCount} risk(s): cro_acceptance_status set to pending_cro`);
        }

        // ── Seed standard risk taxonomy for companies with no sub-categories yet ──
        const SEED_TAXONOMY = [
            { name: 'Strategic', subs: ['Key client loss','Revenue concentration','Market disruption','Scaling failure','Owner/founder dependency','Competitive pricing pressure','New market entrant','Digital transformation lag','Partnership underperformance','Strategic misalignment'] },
            { name: 'Operational', subs: ['Process failure','Human error','Internal fraud','Workplace safety','Supplier failure','Capacity constraint','Quality failure'] },
            { name: 'Financial', subs: ['Credit default','Liquidity shortfall','FX exposure','Budget overrun','Financial misstatement','Investment loss','Pricing risk'] },
            { name: 'Compliance & Regulatory', subs: ['Licensing breach','Data protection (PIPEDA/GDPR)','AML failure','Employment law breach','Sector regulation breach','Tax non-compliance'] },
            { name: 'Technology & Cyber', subs: ['Cybersecurity breach','Data loss','System downtime','Ransomware/malware','Third-party software failure','IT change failure'] },
            { name: 'Reputational', subs: ['Negative media coverage','Social media incident','Client complaint escalation','ESG perception','Executive misconduct'] },
            { name: 'Legal', subs: ['Contract dispute','IP infringement','Employment litigation','Regulatory enforcement','Privacy litigation'] },
            { name: 'People & Culture', subs: ['Key person dependency','Talent retention','Conduct/culture issue','Health and wellness','Succession gap'] },
            { name: 'Third-Party & Vendor', subs: ['Vendor failure','Supply chain disruption','Vendor concentration','Due diligence gap','Outsourcing underperformance'] },
            { name: 'Business Continuity', subs: ['Natural disaster','Pandemic/health crisis','Site access loss','Infrastructure failure','Crisis management failure'] },
            { name: 'ESG', subs: ['Carbon/emissions','Climate physical risk','Social impact','Governance failure','Supply chain ethics'] },
        ];
        // Find companies that have no sub-categories at all
        const companiesWithNoSubs = await client.query(`
            SELECT DISTINCT c.id FROM companies c
            WHERE NOT EXISTS (
                SELECT 1 FROM risk_sub_categories s
                JOIN risk_categories rc ON s.category_id = rc.id
                WHERE rc.company_id = c.id
            )
        `);
        for (const row of companiesWithNoSubs.rows) {
            for (let i = 0; i < SEED_TAXONOMY.length; i++) {
                const { name, subs } = SEED_TAXONOMY[i];
                const catRes = await client.query(
                    `INSERT INTO risk_categories (company_id, name, sort_order)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (company_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
                     RETURNING id`,
                    [row.id, name, i + 1]
                );
                const categoryId = catRes.rows[0].id;
                for (let j = 0; j < subs.length; j++) {
                    await client.query(
                        `INSERT INTO risk_sub_categories (category_id, name, sort_order)
                         VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO NOTHING`,
                        [categoryId, subs[j], j + 1]
                    );
                }
            }
            console.log(`🌱 Seeded risk taxonomy for company ${row.id}`);
        }

        // ── Ensure evidence_attachments allows 'board_approval' entity_type ──
        const constraintRow = await client.query(`
            SELECT check_clause FROM information_schema.check_constraints
            WHERE constraint_name = 'evidence_attachments_entity_type_check'
        `);
        if (
            constraintRow.rows.length > 0 &&
            !constraintRow.rows[0].check_clause.includes('board_approval')
        ) {
            await client.query(`ALTER TABLE evidence_attachments DROP CONSTRAINT evidence_attachments_entity_type_check`);
            await client.query(`
                ALTER TABLE evidence_attachments
                ADD CONSTRAINT evidence_attachments_entity_type_check
                CHECK (entity_type IN ('risk','control','issue','obligation','kri','board_approval'))
            `);
            console.log('🔧 Updated evidence_attachments entity_type constraint to include board_approval');
        }
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
