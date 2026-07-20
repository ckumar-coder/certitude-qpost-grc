-- schema_v73_remove_bcm_module.sql
-- Removes the BCM/BCP module entirely, per decision to keep only the
-- lightweight "critical risk" flag on the Risk Register (risks.is_critical,
-- risks.bcp_status, risks.bcp_link — informational only, feeds the Critical
-- Risks Log page). Those three columns are intentionally NOT touched here.
--
-- Drops:
--   - risk_bcps (bridge table linking risks to BCPs)
--   - all 14 dedicated BCM tables (processes, BCPs, tests, scenarios,
--     dependencies, activations, and their join tables)
--   - the two BCM-specific issue source_type values added in schema_v24
--     (reverts issues_source_type_check to its original 8-value list)
--
-- Safe to re-run (IF EXISTS everywhere). CASCADE is used on the DROP TABLEs
-- to also remove any FKs/indexes/views that depend on them.

-- ── Bridge table (risk ↔ BCP linking, replaced by the simple bcp_link/bcp_status fields) ──
DROP TABLE IF EXISTS risk_bcps CASCADE;

-- ── Activations ───────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_activation_processes CASCADE;
DROP TABLE IF EXISTS bcm_activation_bcps CASCADE;
DROP TABLE IF EXISTS bcm_activations CASCADE;

-- ── Dependencies / SPOFs ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_dependency_processes CASCADE;
DROP TABLE IF EXISTS bcm_dependencies CASCADE;

-- ── Scenarios ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_scenario_bcps CASCADE;
DROP TABLE IF EXISTS bcm_scenario_processes CASCADE;
DROP TABLE IF EXISTS bcm_scenarios CASCADE;

-- ── BCP Tests ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_bcp_tests CASCADE;

-- ── BCPs ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_bcp_risks CASCADE;
DROP TABLE IF EXISTS bcm_bcp_processes CASCADE;
DROP TABLE IF EXISTS bcm_bcps CASCADE;

-- ── Critical Processes ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS bcm_process_risks CASCADE;
DROP TABLE IF EXISTS bcm_processes CASCADE;

-- ── Issues source_type — revert to the pre-BCM 8-value list ────────────────
-- NOTE: this will fail if any existing issue row has source_type =
-- 'BCP Test Finding' or 'BCP Activation — Lessons Learned'. Given the BCM
-- module was never live/populated in this environment, no such rows are
-- expected — but the migration will surface loudly (not silently corrupt
-- data) if that assumption is wrong.
ALTER TABLE issues
    DROP CONSTRAINT IF EXISTS issues_source_type_check;

ALTER TABLE issues
    ADD CONSTRAINT issues_source_type_check
        CHECK (source_type IN (
            'Self-identified (Control Test)',
            'Self-identified (KRI Breach)',
            'Self-identified (Management Review)',
            'Internal Audit',
            'External Audit',
            'Regulatory',
            'Whistleblower-Ethics',
            'Customer Complaint'
        ));
