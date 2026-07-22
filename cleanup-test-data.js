#!/usr/bin/env node
// ============================================================
// cleanup-test-data.js
// ============================================================
// Removes data created by a test-suite.js run against a live company.
// Report-only by default -- pass CONFIRM_DELETE=yes to actually delete.
//
// Two independent safety nets, so a single wrong assumption can't cause an
// accidental deletion of real data:
//   1. Users are matched only by test email domain (@testonly.invalid /
//      @certitude-test.invalid -- the exact patterns test-suite.js uses for
//      every account it creates). No real Qatar Post or Certitude account
//      could ever match this.
//   2. Company-scoped content tables (controls, KRIs, issues, obligations,
//      policies, org roles, glossary terms, evidence attachments) are only
//      touched if BOTH company_id matches AND created_at/uploaded_at falls
//      on or after the SINCE cutoff -- i.e. only rows created during (or
//      after) the test run itself, never anything that predates it, even if
//      the "this table was empty before the test run" assumption is wrong.
//
// Deliberately does NOT touch audit_log. schema_v2.sql's audit_log table
// denormalizes changed_by_email specifically "so the trail survives user
// deletion" -- the schema's own stated design intent is that this trail
// persists even after the underlying entity or user is gone, so it is left
// alone here rather than reinterpreted.
//
// Usage (dry run -- always run this first and read the report):
//   DATABASE_URL=... SINCE='2026-07-22 11:45:00+00' node cleanup-test-data.js
//
// Usage (actually delete what the dry run reported):
//   DATABASE_URL=... SINCE='2026-07-22 11:45:00+00' CONFIRM_DELETE=yes node cleanup-test-data.js
//
// COMPANY_ID defaults to 1 (Qatar Post in this instance); override if ever
// reused against a different company.
// ============================================================

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const COMPANY_ID = parseInt(process.env.COMPANY_ID || '1', 10);
const SINCE = process.env.SINCE;
const CONFIRM = process.env.CONFIRM_DELETE === 'yes';

if (!DATABASE_URL || !SINCE) {
    console.error('\n  Usage: DATABASE_URL=... SINCE=\'2026-07-22 11:45:00+00\' [COMPANY_ID=1] [CONFIRM_DELETE=yes] node cleanup-test-data.js\n');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const USER_EMAIL_PATTERN = `(email ILIKE '%@testonly.invalid' OR email ILIKE '%@certitude-test.invalid')`;

// [table, human label, timestamp column, column shown in the report]
const CONTENT_TABLES = [
    ['controls_lib', 'Controls', 'created_at', 'control_uid'],
    ['kris', 'KRIs', 'created_at', 'kri_uid'],
    ['issues', 'Issues', 'created_at', 'issue_uid'],
    ['compliance_obligations', 'Obligations', 'created_at', 'obligation_uid'],
    ['policies', 'Policies', 'created_at', 'name'],
    ['org_roles', 'Org Roles', 'created_at', 'role_title'],
    ['glossary_terms', 'Glossary Terms', 'created_at', 'term'],
    // Polymorphic table -- no FK to controls_lib/kris/issues/etc, so it does
    // NOT cascade when those rows are deleted. Must be cleaned explicitly.
    ['evidence_attachments', 'Evidence Attachments', 'uploaded_at', 'filename'],
];

async function main() {
    const client = await pool.connect();
    try {
        console.log(`\n=== Test data cleanup -- ${CONFIRM ? 'DELETE MODE' : 'DRY RUN'} ===`);
        console.log(`company_id=${COMPANY_ID}  since=${SINCE}\n`);

        const users = await client.query(
            `SELECT id, email, full_name, created_at FROM users WHERE ${USER_EMAIL_PATTERN} ORDER BY id`
        );
        console.log(`Users matching test email patterns: ${users.rows.length}`);
        users.rows.forEach((u) =>
            console.log(`  id=${u.id}  ${u.email}  "${u.full_name}"  created ${u.created_at.toISOString()}`)
        );

        const foundCounts = {};
        for (const [table, label, tsCol, idCol] of CONTENT_TABLES) {
            const r = await client.query(
                `SELECT id, ${idCol} AS label, ${tsCol} AS ts FROM ${table} WHERE company_id = $1 AND ${tsCol} >= $2 ORDER BY id`,
                [COMPANY_ID, SINCE]
            );
            foundCounts[table] = r.rows.length;
            console.log(`\n${label} (company_id=${COMPANY_ID}, ${tsCol} >= ${SINCE}): ${r.rows.length}`);
            r.rows.forEach((row) => console.log(`  id=${row.id}  ${row.label}  ${tsCol}=${row.ts.toISOString()}`));
        }

        if (!CONFIRM) {
            console.log('\nDry run only -- nothing deleted.');
            console.log('Re-run with CONFIRM_DELETE=yes to actually delete exactly the rows listed above.');
            console.log('Note: audit_log is never touched by this script -- see header comment.');
            return;
        }

        console.log('\n=== Deleting (single transaction) ===');
        await client.query('BEGIN');
        try {
            for (const [table, label, tsCol] of CONTENT_TABLES) {
                const r = await client.query(`DELETE FROM ${table} WHERE company_id = $1 AND ${tsCol} >= $2`, [COMPANY_ID, SINCE]);
                console.log(`  DELETE FROM ${table} (${label}): ${r.rowCount} row(s)`);
            }
            const ur = await client.query(`DELETE FROM users WHERE ${USER_EMAIL_PATTERN}`);
            console.log(`  DELETE FROM users: ${ur.rowCount} row(s)`);

            await client.query('COMMIT');
            console.log('\n✔ Cleanup committed.');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('\n✘ Cleanup failed, rolled back -- nothing was deleted:', e.message);
            process.exitCode = 1;
        }
    } finally {
        client.release();
        await pool.end();
    }
}

main();
