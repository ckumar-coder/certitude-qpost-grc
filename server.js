// ============================================================================
// ERM Workstation — backend entry point (Qatar Post's branded fork of
// Certitude's GRC platform).
//
// This file is intentionally a single Express app rather than split into
// per-module route files — see docs/ARCHITECTURE.md for why, and
// docs/API_REFERENCE.md for the full endpoint catalog with roles. This
// header is a navigation aid only; treat the two docs above as the source
// of truth if anything here drifts.
//
// MODULE MAP — search for the "// ====" divider with this name to jump to
// a module. Listed in the order they appear in the file.
//
//   Helpers                         — shared query/formatting utilities
//   Department scoping (DEPT_SCOPED_ROLES, managerScopeClause, ...)
//                                   — see the block comment above requireRole()
//   Cookie helpers                  — session cookie set/clear (SOC 2 CC6.1)
//   Auth middleware                 — authenticate / requireRole / requireCompany
//   Auth routes                     — /api/auth/* (login, logout, me, MFA, switch-company)
//   Password reset                  — unauthenticated /api/auth/reset-password/*
//   Email settings                  — /api/email-settings (Admin only)
//   Risk taxonomy                   — /api/risk-categories, /api/risk-sub-categories (Admin)
//   Risk cause/consequence taxonomy — /api/taxonomies/:type
//   Branding                        — /api/companies/current/branding (Admin)
//   Departments / Business Units    — /api/departments, /api/business-units (Admin)
//   Risk Register                  — /api/risks/* — see docs/API_REFERENCE.md
//                                     "Risk Register & Mitigation" for the full role table
//   Risk interdependencies          — /api/risks/:uid/related
//   Control Library                 — /api/controls/*
//   Key Risk Indicators (B3)        — /api/kris/*, /api/kri-register
//   Org Roles                       — /api/org-roles (RACI directory)
//   RACI Matrix                     — /api/raci-matrix
//   Policy & Procedure Repository   — /api/policies/*
//   Compliance Obligations Register — /api/obligations/*
//   Issues & Actions Tracker        — /api/issues/*
//   Issue Action Items              — /api/issues/:id/actions/*
//   Dashboards                      — /api/dashboard/*
//   Bulk Import                     — /api/import/:module/*
//   Standard Controls Seeding       — /api/seed-controls/*  (Admin)
//   Data Export                     — /api/export/:module
//   Global Search                   — /api/search
//   Escalation Rules & Notifications — /api/escalation-rules, /api/notifications
//   Users & Access                  — /api/users/*  (Admin)
//   Roles & Permissions (Phase B)   — /api/roles/*, /api/capabilities  (Admin) —
//                                     admin screen for the permissions engine;
//                                     additive only, not yet enforced (Phase C/D)
//   Glossary                        — /api/glossary
//   Compliance Calendar             — /api/calendar
//   Scoring Methodology             — /api/scoring-methodology
//   Evidence                        — /api/evidence/*
//   Risk Appetite                   — /api/risk-appetite/*
//   Company management              — /api/companies/*  (Admin)
//   Consolidated summary            — /api/consolidated-summary (group dashboard view)
//   Incident Log                    — /api/incidents/*
//   Consultant Dashboard API        — /api/consultant/*  (requires is_consultant flag,
//                                     a separate authorization axis from role — see
//                                     Documents/Internal/RBAC_Permissions_Engine_Scoping.docx §4)
//   AI Integration                  — /api/admin/ai-settings  (Admin)
//   Horizon Scanning                — /api/horizon-scans/*
//   Risk Governance Documents       — /api/risk-gov/*
//   Forms & Templates               — /api/forms/*
//
// ROLE MODEL (as of 2026-07-21) — eight roles: Super Admin, Admin, Risk
// Champion, Risk Owner, Risk Manager, CRO, Consultant CRO, Viewer. Two
// blanket rules apply across every route below and are NOT repeated at
// each call site (see the block comment above requireRole() for the code):
//   1. Admin and Super Admin bypass every requireRole() check unconditionally.
//   2. Any requireRole() list containing 'CRO' automatically also admits
//      'Consultant CRO'.
// Super Admin and Consultant CRO are planned for removal before Qatar Post
// handover (not yet done — see CLAUDE.md "Engineering — pending items").
// ============================================================================

require('dotenv').config();

const express = require('express');
const path    = require('path');
const {
    encryptPassword,
    sendTestEmail,
    sendTempPassword,
    sendPasswordResetEmail,
    sendSecurityAlert,
} = require('./email');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const pool = require('./db');
const { parseCSV, toCSV } = require('./csv');
const SEED_CONTROLS = require('./seed-controls-data');
const { validate, schemas } = require('./validate');   // SOC 2: CC5.2
const { scanFile }          = require('./fileScan');    // SOC 2: CC6.8
const {
    SESSION_IDLE_TIMEOUT_MINUTES,
    validatePasswordPolicy,
    isPasswordReused,
    setPassword,
    isPasswordExpired,
    isLocked,
    recordFailedLogin,
    resetFailedLogins,
    createSession,
    createPreAuthSession,
    touchSession,
    destroySession,
    setActiveCompany,
    purgeExpiredSessions,
    logAudit,
    MAX_FAILED_ATTEMPTS,
} = require('./auth');

const app = express();

// ── Security headers (SOC 2: CC5.2, CC6.6) ──────────────────────────────────
// Pure Express middleware — no external packages required.
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://api.qrserver.com",
            "connect-src 'self'",
            "font-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
        ].join('; ')
    );
    next();
});

// ── Rate limiters (SOC 2: CC6.6) ─────────────────────────────────────────────
// Pure in-memory implementation — no external packages required.
// Note: for multi-replica deployments, replace with Redis-backed rate limiting.
// ── In-memory rate limiter (general API throttle only) ───────────────────────
// Used exclusively for the broad apiLimiter (600 req/15 min).
// Security-critical endpoints (login, MFA, password reset/change) use the
// Postgres-backed makeDbRateLimiter below so limits are shared across replicas.
function makeRateLimiter({ windowMs, max, skipSuccessfulRequests = false, message }) {
    const store = new Map(); // IP -> { count, resetAt }

    setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of store.entries()) {
            if (entry.resetAt < now) store.delete(ip);
        }
    }, windowMs);

    return function rateLimitMiddleware(req, res, next) {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();
        let entry = store.get(ip);

        if (!entry || entry.resetAt < now) {
            entry = { count: 0, resetAt: now + windowMs };
            store.set(ip, entry);
        }

        if (entry.count >= max) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', 0);
            return res.status(429).json(message);
        }

        if (!skipSuccessfulRequests) entry.count++;

        const originalJson = res.json.bind(res);
        res.json = function (body) {
            if (skipSuccessfulRequests && res.statusCode < 400) {
                // Don't count successful requests toward the limit.
            } else if (skipSuccessfulRequests) {
                entry.count++;
            }
            return originalJson(body);
        };

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
        next();
    };
}

// ── Postgres-backed rate limiter (cross-replica safe) ────────────────────────
// One row per limiter+IP in rate_limit_attempts. The UPSERT resets the window
// atomically when expired, so no separate cron is needed for correctness.
// Background cleanup runs every 10 min to keep the table small.
// Fails open on DB error — a transient DB issue won't lock users out.
function makeDbRateLimiter({ name, windowMs, max, skipSuccessfulRequests = false, message }) {
    const windowSecs = Math.ceil(windowMs / 1000);

    async function increment(ip) {
        const key = `${name}:${ip}`;
        const r = await pool.query(
            `INSERT INTO rate_limit_attempts (key, count, window_start)
             VALUES ($1, 1, now())
             ON CONFLICT (key) DO UPDATE SET
               count        = CASE
                                WHEN rate_limit_attempts.window_start < now() - ($2 * interval '1 second')
                                THEN 1
                                ELSE rate_limit_attempts.count + 1
                              END,
               window_start = CASE
                                WHEN rate_limit_attempts.window_start < now() - ($2 * interval '1 second')
                                THEN now()
                                ELSE rate_limit_attempts.window_start
                              END
             RETURNING count, window_start`,
            [key, windowSecs]
        );
        return r.rows[0];
    }

    async function peek(ip) {
        const key = `${name}:${ip}`;
        const r = await pool.query(
            `SELECT count, window_start FROM rate_limit_attempts WHERE key = $1`,
            [key]
        );
        if (!r.rows.length) return { count: 0, window_start: null };
        const { count, window_start } = r.rows[0];
        const expired = Date.now() - new Date(window_start).getTime() >= windowMs;
        return { count: expired ? 0 : count, window_start };
    }

    return async function dbRateLimitMiddleware(req, res, next) {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        try {
            if (!skipSuccessfulRequests) {
                const { count, window_start } = await increment(ip);
                res.setHeader('X-RateLimit-Limit', max);
                res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
                if (count > max) {
                    const retryAfter = Math.ceil(
                        (new Date(window_start).getTime() + windowMs - Date.now()) / 1000
                    );
                    res.setHeader('Retry-After', Math.max(1, retryAfter));
                    return res.status(429).json(message);
                }
                return next();
            } else {
                // skipSuccessfulRequests: check current count first, only write on failure
                const { count, window_start } = await peek(ip);
                res.setHeader('X-RateLimit-Limit', max);
                res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
                if (count >= max) {
                    const retryAfter = Math.ceil(
                        (new Date(window_start).getTime() + windowMs - Date.now()) / 1000
                    );
                    res.setHeader('Retry-After', Math.max(1, retryAfter));
                    return res.status(429).json(message);
                }
                const originalJson = res.json.bind(res);
                res.json = async function (body) {
                    if (res.statusCode >= 400) {
                        await increment(ip).catch(() => {});
                    }
                    return originalJson(body);
                };
                return next();
            }
        } catch (err) {
            console.error('[rate-limit-db] DB error, failing open:', err.message);
            return next();
        }
    };
}

// Periodic cleanup: delete rate limit entries older than 1 hour.
// Runs every 10 minutes. Errors are silently ignored.
setInterval(async () => {
    try {
        await pool.query(`DELETE FROM rate_limit_attempts WHERE window_start < now() - interval '1 hour'`);
    } catch (_) { /* ignore */ }
}, 10 * 60 * 1000);

const loginLimiter = makeDbRateLimiter({
    name: 'login',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'staging' ? 60 : 10,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const mfaLimiter = makeDbRateLimiter({
    name: 'mfa',
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many MFA attempts. Please try again in 15 minutes.' },
});

// ── TOTP (RFC 6238) — pure Node.js crypto, no external packages ─────────────
function base32Decode(encoded) {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0;
    const output = [];
    for (const char of encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
        const idx = CHARS.indexOf(char);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(output);
}

function base32Encode(buf) {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '', bits = 0, value = 0;
    for (const byte of buf) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { result += CHARS[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) result += CHARS[(value << (5 - bits)) & 31];
    return result;
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function computeTotp(secret, timeStep) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(timeStep));
    const key  = base32Decode(secret);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const off  = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[off] & 0x7f) << 24)
               | ((hmac[off + 1] & 0xff) << 16)
               | ((hmac[off + 2] & 0xff) << 8)
               |  (hmac[off + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret, token) {
    const clean = String(token).replace(/\s/g, '');
    const step  = Math.floor(Date.now() / 30_000);
    // Accept current window ±1 (accounts for clock drift up to 30 s).
    for (const delta of [-1, 0, 1]) {
        if (computeTotp(secret, step + delta) === clean) return true;
    }
    return false;
}

function totpUri(secret, email) {
    const label  = encodeURIComponent(`ERM Workstation:${email}`);
    const issuer = encodeURIComponent('ERM Workstation');
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

// #10: Restrict body size — 100 KB is ample for all API payloads (SOC 2: CC6.6)
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            // Content-hashed build output (e.g. index-<hash>.js) — the filename
            // changes on every deploy, so it's safe to cache indefinitely.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (path.basename(filePath) === 'index.html') {
            // Never let a stale shell get cached — always revalidate, so a client
            // always picks up the current build's asset filenames after a deploy.
            res.setHeader('Cache-Control', 'no-cache');
        }
    },
}));

// #9: API-wide rate limiter — 200 requests / 15 min per IP (SOC 2: CC6.6)
// Applied after static files so asset requests don't count toward the limit.
const apiLimiter = makeRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 600,   // high enough for automated test suite (~350 requests); still blocks bots
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
});
app.use('/api/', apiLimiter);

const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Unauthenticated version endpoint — used by the sidebar to display the
// current app version without requiring a full auth round-trip.
const APP_VERSION = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '1.0.0-beta';
    } catch {
        return '1.0.0-beta';
    }
})();

app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION, demo_mode: process.env.DEMO_MODE || null });
});

// ── Security disclosure contact (SOC 2: CC2.3) ───────────────────────────────
// Served at the standard /.well-known/security.txt location so that security
// researchers know where to report vulnerabilities.
app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(
        'Contact: mailto:c.kumar@certitude-advisory.ca\n' +
        'Preferred-Languages: en\n' +
        'Expires: 2027-01-01T00:00:00.000Z\n'
    );
});

// Cloud Run / load-balancer health check (G3 -- Phase 8). Deliberately
// unauthenticated and outside the /api router: verifies the process is up
// and can reach the database, without exposing any tenant data.
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ok' });
    } catch (e) {
        res.status(503).json({ status: 'degraded' });  // SOC 2: CC6.7 — no backend detail
    }
});


// Periodically clear expired sessions so the table doesn't grow forever.
setInterval(() => purgeExpiredSessions().catch((e) => console.error('Session purge failed:', e)), 15 * 60 * 1000);

// ============================================================
// Helpers
// ============================================================

// Resolves SLOT1 and SLOT2 for the universal 4-part ID format (v2.0.0+).
// ── Standard risk taxonomy seed data ─────────────────────────────────────────
// Pre-loaded for every new company. Admin can add/rename/delete after creation.
const SEED_TAXONOMY = [
    {
        name: 'Strategic',
        subs: ['Key client loss', 'Revenue concentration', 'Market disruption', 'Scaling failure',
               'Owner/founder dependency', 'Competitive pricing pressure', 'New market entrant',
               'Digital transformation lag', 'Partnership underperformance', 'Strategic misalignment'],
    },
    {
        name: 'Operational',
        subs: ['Process failure', 'Human error', 'Internal fraud', 'Workplace safety',
               'Supplier failure', 'Capacity constraint', 'Quality failure'],
    },
    {
        name: 'Financial',
        subs: ['Credit default', 'Liquidity shortfall', 'FX exposure', 'Budget overrun',
               'Financial misstatement', 'Investment loss', 'Pricing risk'],
    },
    {
        name: 'Compliance & Regulatory',
        subs: ['Licensing breach', 'Data protection (PIPEDA/GDPR)', 'AML failure',
               'Employment law breach', 'Sector regulation breach', 'Tax non-compliance'],
    },
    {
        name: 'Technology & Cyber',
        subs: ['Cybersecurity breach', 'Data loss', 'System downtime', 'Ransomware/malware',
               'Third-party software failure', 'IT change failure'],
    },
    {
        name: 'Reputational',
        subs: ['Negative media coverage', 'Social media incident', 'Client complaint escalation',
               'ESG perception', 'Executive misconduct'],
    },
    {
        name: 'Legal',
        subs: ['Contract dispute', 'IP infringement', 'Employment litigation',
               'Regulatory enforcement', 'Privacy litigation'],
    },
    {
        name: 'People & Culture',
        subs: ['Key person dependency', 'Talent retention', 'Conduct/culture issue',
               'Health and wellness', 'Succession gap'],
    },
    {
        name: 'Third-Party & Vendor',
        subs: ['Vendor failure', 'Supply chain disruption', 'Vendor concentration',
               'Due diligence gap', 'Outsourcing underperformance'],
    },
    {
        name: 'Business Continuity',
        subs: ['Natural disaster', 'Pandemic/health crisis', 'Site access loss',
               'Infrastructure failure', 'Crisis management failure'],
    },
    {
        name: 'ESG',
        subs: ['Carbon/emissions', 'Climate physical risk', 'Social impact',
               'Governance failure', 'Supply chain ethics'],
    },
];

// Seed the standard risk taxonomy for a company (idempotent — skips existing rows).
// Accepts a pool or client (both expose .query()).
async function seedRiskTaxonomy(db, companyId) {
    for (let i = 0; i < SEED_TAXONOMY.length; i++) {
        const { name, subs } = SEED_TAXONOMY[i];
        // Insert category (skip if already exists)
        const catRes = await db.query(
            `INSERT INTO risk_categories (company_id, name, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (company_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
             RETURNING id`,
            [companyId, name, i + 1]
        );
        const categoryId = catRes.rows[0].id;
        // Insert sub-categories
        for (let j = 0; j < subs.length; j++) {
            await db.query(
                `INSERT INTO risk_sub_categories (category_id, name, sort_order)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (category_id, name) DO NOTHING`,
                [categoryId, subs[j], j + 1]
            );
        }
    }
}

// Standard default department set — used to seed a new company's departments
// when no wizard-provided list is given. Was previously only ever seeded for
// top-level companies created via the setup wizard; POST /api/companies
// (subsidiary creation) never seeded departments at all, silently leaving
// every subsidiary with zero departments and blocking risk/control/KRI/issue
// creation there (found 2026-07-22, via the test suite's subsidiary data-
// isolation test — a real production gap, not just a test artifact).
const DEFAULT_DEPARTMENTS = [
    { name: 'Finance',                  code: 'FIN' },
    { name: 'Human Resources',           code: 'HRD' },
    { name: 'Operations',               code: 'OPS' },
    { name: 'Information Technology',   code: 'ITS' },
    { name: 'Legal & Compliance',       code: 'LEG' },
    { name: 'Sales & Marketing',        code: 'SAL' },
    { name: 'Executive / Management',   code: 'EXC' },
    { name: 'Procurement',              code: 'PRO' },
    { name: 'Audit & Internal Control', code: 'AUD' },
    { name: 'General',                  code: 'GEN' },
];

async function seedDefaultDepartments(db, companyId, departments) {
    const list = (departments && departments.length > 0) ? departments : DEFAULT_DEPARTMENTS;
    for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const dCode = d.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
        await db.query(
            `INSERT INTO departments (company_id, name, code, sort_order)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [companyId, d.name.trim(), dCode, (i + 1) * 10]
        );
    }
}

// BU Mode:         SLOT1 = BU code,          SLOT2 = dept code
// Simple sub-dept: SLOT1 = parent dept code,  SLOT2 = sub-dept code
// Simple top-dept: SLOT1 = dept code,         SLOT2 = dept code (repeated)
// No dept:         SLOT1 = 'GEN',             SLOT2 = 'GEN'
async function resolveIDSlots(client, companyId, deptCodeOrName) {
    if (!deptCodeOrName) return { slot1: 'GEN', slot2: 'GEN' };
    const deptRes = await client.query(
        `SELECT d.code, bu.code AS bu_code, pd.code AS parent_code
         FROM departments d
         LEFT JOIN business_units bu ON bu.id = d.business_unit_id
         LEFT JOIN departments pd ON pd.id = d.parent_dept_id
         WHERE d.company_id = $1
           AND (UPPER(d.code) = UPPER($2) OR LOWER(d.name) = LOWER($2))
         LIMIT 1`,
        [companyId, deptCodeOrName]
    );
    if (deptRes.rows.length === 0) {
        const raw = deptCodeOrName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10).padEnd(3, 'X');
        return { slot1: raw, slot2: raw };
    }
    const { code, bu_code, parent_code } = deptRes.rows[0];
    const deptCode = code.toUpperCase();
    if (bu_code)     return { slot1: bu_code.toUpperCase(),     slot2: deptCode }; // BU Mode
    if (parent_code) return { slot1: parent_code.toUpperCase(), slot2: deptCode }; // Simple sub-dept
    return { slot1: deptCode, slot2: deptCode };                                   // Simple top-dept
}

async function generateUniqueRiskID(client, companyId, deptCodeOrName) {
    const { slot1, slot2 } = await resolveIDSlots(client, companyId, deptCodeOrName);
    const prefix = `RI-${slot1}-${slot2}`;
    const result = await client.query(
        `SELECT COUNT(DISTINCT risk_uid) AS cnt FROM risks WHERE company_id = $1 AND risk_uid LIKE $2`,
        [companyId, `${prefix}-%`]
    );
    const next = parseInt(result.rows[0].cnt, 10) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function generateUniqueControlID(client, companyId, deptCodeOrName) {
    const { slot1, slot2 } = await resolveIDSlots(client, companyId, deptCodeOrName);
    const prefix = `CI-${slot1}-${slot2}`;
    const result = await client.query(
        `SELECT COUNT(DISTINCT control_uid) AS cnt FROM controls_lib WHERE company_id = $1 AND control_uid LIKE $2`,
        [companyId, `${prefix}-%`]
    );
    const next = parseInt(result.rows[0].cnt, 10) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function generateUniqueKriID(client, companyId, deptCodeOrName) {
    const { slot1, slot2 } = await resolveIDSlots(client, companyId, deptCodeOrName);
    const prefix = `KRI-${slot1}-${slot2}`;
    const result = await client.query(
        `SELECT COUNT(DISTINCT kri_uid) AS cnt FROM kris WHERE company_id = $1 AND kri_uid LIKE $2`,
        [companyId, `${prefix}-%`]
    );
    const next = parseInt(result.rows[0].cnt, 10) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function generateUniqueUid(client, companyId, table, uidColumn, prefix) {
    const result = await client.query(`SELECT COUNT(DISTINCT ${uidColumn}) AS cnt FROM ${table} WHERE company_id = $1 AND ${uidColumn} LIKE $2`, [
        companyId,
        `${prefix}-%`,
    ]);
    const next = parseInt(result.rows[0].cnt, 10) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

// Universal 4-part UID generator: PREFIX-SLOT1-SLOT2-NNNN (v2.0.0+).
// Delegates slot resolution to resolveIDSlots; null deptCodeOrName → GEN-GEN.
async function generateUnique4PartID(client, companyId, table, uidColumn, prefix, deptCodeOrName) {
    const { slot1, slot2 } = await resolveIDSlots(client, companyId, deptCodeOrName);
    const fullPrefix = `${prefix}-${slot1}-${slot2}`;
    const result = await client.query(
        `SELECT COUNT(DISTINCT ${uidColumn}) AS cnt FROM ${table} WHERE company_id = $1 AND ${uidColumn} LIKE $2`,
        [companyId, `${fullPrefix}-%`]
    );
    const next = parseInt(result.rows[0].cnt, 10) + 1;
    return `${fullPrefix}-${String(next).padStart(4, '0')}`;
}

// MAP UID generator: MAP-NNNN, sequential per company across all mitigations.
async function generateMitigationUID(client, companyId) {
    const result = await client.query(
        `SELECT COALESCE(MAX(
            CASE WHEN m.mitigation_uid ~ '^MAP-[0-9]+$'
                 THEN CAST(REGEXP_REPLACE(m.mitigation_uid, 'MAP-', '') AS INT)
                 ELSE 0 END
         ), 0) + 1 AS next
         FROM mitigations m
         JOIN risks r ON r.id = m.risk_id
         WHERE r.company_id = $1`,
        [companyId]
    );
    const next = parseInt(result.rows[0].next, 10);
    return `MAP-${String(next).padStart(4, '0')}`;
}

// ---- E: department scoping for the Manager role ----
//
// A Manager may be scoped to one OR MORE departments via the
// user_companies.departments TEXT[] column (schema v19).
// A NULL/empty departments array means "enterprise-wide" — the Manager
// sees everything (same as Admin for list views).
// A NULL department value on a risk/control/KRI/issue means
// "enterprise-wide" — visible to all Managers regardless of their scope.

// Returns the Manager's effective department list as a normalised lowercase array.
// Uses resolvedDepts pre-computed by requireCompany (includes BU expansion + sub-depts).
// Falls back to the legacy columns if resolvedDepts is not present.
function getManagerDepts(req) {
    if (req.company.resolvedDepts !== undefined) return req.company.resolvedDepts;
    const arr = req.company.departments;
    if (Array.isArray(arr) && arr.length > 0) return arr.map(d => d.toLowerCase());
    if (req.company.department) return [req.company.department.toLowerCase()];
    return [];
}

// Roles that are scoped to specific departments (vs. enterprise-wide).
const DEPT_SCOPED_ROLES = ['Risk Champion', 'Risk Owner', 'Risk Manager'];

// SQL fragment + param for filtering a dept-scoped role's list view by department.
// Returns null for Admin/CRO/Viewer (no filter applied) or a scoped user with no dept.
// Resolves code↔name mismatches via the departments table so that a user whose
// dept is stored as 'FIN' (code) will match rows where department = 'Finance' (name).
function managerScopeClause(req, column, paramIndex) {
    if (!DEPT_SCOPED_ROLES.includes(req.company.role)) return null;
    const depts = getManagerDepts(req);
    if (depts.length === 0) return null; // no scope restriction
    return {
        clause: `(lower(${column}) = ANY($${paramIndex}::text[])
                  OR lower(${column}) IN (SELECT lower(name) FROM departments WHERE company_id = $1 AND lower(code) = ANY($${paramIndex}::text[]))
                  OR lower(${column}) IN (SELECT lower(code) FROM departments WHERE company_id = $1 AND lower(name) = ANY($${paramIndex}::text[]))
                  OR ${column} IS NULL)`,
        value: depts,
    };
}

// Whether a dept-scoped role may view/edit a row with the given department value.
// Async to allow resolving code↔name mismatches via the departments table.
async function managerCanAccess(req, rowDepartment) {
    if (!DEPT_SCOPED_ROLES.includes(req.company.role)) return true;
    if (!rowDepartment) return true; // enterprise-wide row
    const depts = getManagerDepts(req);
    if (depts.length === 0) return true; // no dept restriction set
    if (depts.includes(rowDepartment.toLowerCase())) return true;
    // Resolve code↔name mismatches (e.g. user stored as 'FIN', row stored as 'Finance')
    const res = await pool.query(
        `SELECT 1 FROM departments WHERE company_id = $1
          AND (lower(code) = ANY($2::text[]) AND lower(name) = lower($3)
            OR lower(name) = ANY($2::text[]) AND lower(code) = lower($3))
         LIMIT 1`,
        [req.company.id, depts, rowDepartment]
    );
    return res.rows.length > 0;
}

// Resolves the department to store on create/update. Admins and CRO may set any
// value (including null/blank for "enterprise-wide"). Dept-scoped roles may
// only assign items to one of their own departments.
function resolveDepartmentForWrite(req, requestedDepartment) {
    if (req.company.role === 'Admin' || req.company.role === 'CRO' || req.company.role === 'Consultant CRO') {
        if (requestedDepartment === undefined) return { department: undefined };
        return { department: requestedDepartment || null };
    }
    const depts = getManagerDepts(req);
    if (
        requestedDepartment !== undefined &&
        requestedDepartment !== null &&
        requestedDepartment !== '' &&
        depts.length > 0 &&
        !depts.includes(requestedDepartment.toLowerCase())
    ) {
        return { error: 'You can only assign items to your own department(s).' };
    }
    // If no specific dept requested, default to the first dept in the scope
    if (!requestedDepartment) return { department: depts[0] || null };
    return { department: requestedDepartment };
}

// Green/Amber/Red per B3. Supports two modes:
// 1. Multi-band (threshold_bands JSONB): each band has {rag, min, max, label}.
//    First matching band wins (order matters — bands are evaluated top-to-bottom).
// 2. Legacy single-threshold: Red = regulatory limit breached, Amber = internal
//    tolerance breached, Green = within tolerance.
// Returns null if the KRI has no thresholds configured or no value yet.
function computeKriBand(kri, value) {
    if (value === null || value === undefined) return null;
    const num = Number(value);

    // Multi-band mode
    if (Array.isArray(kri.threshold_bands) && kri.threshold_bands.length > 0) {
        for (const band of kri.threshold_bands) {
            const minOk = band.min === null || band.min === undefined || band.min === '' || num >= Number(band.min);
            const maxOk = band.max === null || band.max === undefined || band.max === '' || num <= Number(band.max);
            if (minOk && maxOk) return band.rag;
        }
        return null;
    }

    // Legacy single-threshold mode
    const breaches = (threshold) => {
        if (threshold === null || threshold === undefined) return false;
        return kri.breach_direction === 'below' ? num < Number(threshold) : num > Number(threshold);
    };
    if (breaches(kri.regulatory_limit)) return 'Red';
    if (breaches(kri.internal_tolerance)) return 'Amber';
    if (kri.regulatory_limit == null && kri.internal_tolerance == null) return null;
    return 'Green';
}

// Returns true if a KRI has not been updated within its measurement frequency window.
function isKriOverdue(measurementFrequency, lastMeasDate) {
    if (!lastMeasDate || !measurementFrequency) return false;
    const freqDays = { Daily: 1, Weekly: 7, Monthly: 31, Quarterly: 92, 'Semi-Annual': 183, Annual: 365 };
    const days = freqDays[measurementFrequency] ?? 31;
    const due = new Date(new Date(lastMeasDate).getTime() + days * 24 * 60 * 60 * 1000);
    return new Date() > due;
}

async function attachControlsAndMitigations(risks) {
    if (risks.length === 0) return risks;
    const ids = risks.map((r) => r.id);

    // Collect unique assessed_by emails and resolve to full names in one query
    const emails = [...new Set(risks.map((r) => r.assessed_by).filter(Boolean))];
    const nameMap = {};
    if (emails.length > 0) {
        const nameRes = await pool.query(
            `SELECT email, full_name FROM users WHERE email = ANY($1::text[])`,
            [emails]
        );
        for (const u of nameRes.rows) nameMap[u.email] = u.full_name;
    }

    const EMPTY = { rows: [] };
    const [controlsRes, mitigationsRes, krisRes, issueLinksRes] = (await Promise.allSettled([
        pool.query(
            `SELECT rc.risk_id, cl.id, cl.control_uid, cl.name, cl.owner, cl.control_type, cl.automation,
                    cl.testing_frequency, cl.last_test_date, cl.last_test_result
             FROM risk_controls rc JOIN controls_lib cl ON cl.id = rc.control_id
             WHERE rc.risk_id = ANY($1::int[])`,
            [ids]
        ),
        pool.query('SELECT * FROM mitigations WHERE risk_id = ANY($1::int[])', [ids]),
        pool.query(
            `SELECT rk.risk_id, k.id, k.kri_uid, k.name, k.threshold_source, k.internal_tolerance, k.regulatory_limit,
                    k.breach_direction, k.threshold_bands, k.appetite_statement_id,
                    ras.risk_category AS appetite_category,
                    (SELECT value FROM kri_measurements m WHERE m.kri_id = k.id ORDER BY measurement_date DESC, id DESC LIMIT 1) AS current_value
             FROM risk_kris rk
             JOIN kris k ON k.id = rk.kri_id
             LEFT JOIN risk_appetite_statements ras ON ras.id = k.appetite_statement_id
             WHERE rk.risk_id = ANY($1::int[])`,
            [ids]
        ),
        pool.query(
            `SELECT ir.risk_id, i.id, i.issue_uid, i.description, i.status, i.priority
             FROM issue_risks ir JOIN issues i ON i.id = ir.issue_id
             WHERE ir.risk_id = ANY($1::int[])`,
            [ids]
        ),
    ])).map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`attachControlsAndMitigations query[${i}] failed:`, r.reason?.message || r.reason);
        return EMPTY;
    });

    const controlsByRisk = {};
    for (const c of controlsRes.rows) {
        (controlsByRisk[c.risk_id] = controlsByRisk[c.risk_id] || []).push({
            id: c.id,
            control_uid: c.control_uid,
            name: c.name,
            owner: c.owner,
            control_type: c.control_type,
            automation: c.automation,
            testing_frequency: c.testing_frequency,
            last_test_date: c.last_test_date,
            last_test_result: c.last_test_result,
        });
    }

    const mitigationsByRisk = {};
    for (const m of mitigationsRes.rows) {
        (mitigationsByRisk[m.risk_id] = mitigationsByRisk[m.risk_id] || []).push({
            id: m.id,
            mitigation_uid: m.mitigation_uid,
            action: m.action,
            action_owner: m.action_owner,
            root_cause: m.root_cause,
            start_date: m.start_date,
            end_date: m.end_date,
            status: m.status,
            compensatory_controls_in_place: m.compensatory_controls_in_place,
        });
    }

    const krisByRisk = {};
    for (const k of krisRes.rows) {
        (krisByRisk[k.risk_id] = krisByRisk[k.risk_id] || []).push({
            id: k.id,
            kri_uid: k.kri_uid,
            name: k.name,
            current_value: k.current_value,
            band: computeKriBand(k, k.current_value),
        });
    }

    const issuesByRisk = {};
    for (const i of issueLinksRes.rows) {
        (issuesByRisk[i.risk_id] = issuesByRisk[i.risk_id] || []).push({
            id: i.id,
            issue_uid: i.issue_uid,
            description: i.description,
            status: i.status,
            priority: i.priority,
        });
    }

    return risks.map((r) => {
        const controls = controlsByRisk[r.id] || [];
        const residualScore = r.residual_likelihood * r.residual_impact;

        // G5/G6 (Risk Register enhancements): flag when residual risk
        // exceeds the owner-defined appetite, and when a linked control
        // has been tested as non-Effective more recently than this risk
        // version's last assessment -- a nudge that the residual score
        // may no longer reflect reality.
        const appetiteBreach = r.tolerance_threshold_score != null && residualScore > r.tolerance_threshold_score; // per-risk tolerance breach
        const reassessmentRecommended = controls.some((c) => {
            if (!c.last_test_date || c.last_test_result === 'Effective' || c.last_test_result === 'Not Tested' || c.last_test_result === 'Not yet tested') return false;
            if (!r.last_evaluated_timestamp) return true;
            return new Date(c.last_test_date).getTime() > Number(r.last_evaluated_timestamp);
        });

        return {
            ...r,
            assessed_by_name: nameMap[r.assessed_by] || r.assessed_by || null,
            controls,
            mitigations: mitigationsByRisk[r.id] || [],
            kris: krisByRisk[r.id] || [],
            linked_issues: issuesByRisk[r.id] || [],
            residual_score: residualScore,
            tolerance_breach: appetiteBreach,            // per-risk: score > tolerance_threshold_score
            appetite_breach: appetiteBreach,             // legacy alias — keep for one release cycle
            appetite_category_breach: r.appetite_category_breach || false, // category-level from DB
            reassessment_recommended: reassessmentRecommended,
        };
    });
}

// ============================================================
// Cookie helpers (SOC 2: CC6.1 — httpOnly prevents JS token theft)
// ============================================================

const COOKIE_NAME = 'grc_session';
const IS_PROD = process.env.NODE_ENV === 'production';

function getSessionCookie(req) {
    const cookieStr = req.headers.cookie || '';
    for (const part of cookieStr.split(';')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const key = part.slice(0, eqIdx).trim();
        if (key === COOKIE_NAME) return part.slice(eqIdx + 1).trim();
    }
    return null;
}

function setSessionCookie(res, token) {
    const flags = [
        `${COOKIE_NAME}=${token}`,
        'HttpOnly',
        'Path=/',
        'SameSite=Strict',
        ...(IS_PROD ? ['Secure'] : []),
    ];
    res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
}

// ============================================================
// Auth middleware
// ============================================================

// Validates the session cookie (primary) or Bearer header (API clients /
// backward compat), slides its expiry, and loads the user.
// Rejects pre-auth sessions — those may only be used with /api/auth/mfa/*.
const authenticate = asyncHandler(async (req, res, next) => {
    const cookieToken = getSessionCookie(req);
    const header = req.headers['authorization'] || '';
    const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = cookieToken || bearerToken;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const session = await touchSession(token);
    if (!session) return res.status(401).json({ error: 'Session expired or invalid, please log in again' });

    // Pre-auth sessions (MFA not yet verified) cannot access protected routes.
    if (session.pre_auth) {
        return res.status(401).json({ error: 'MFA verification required', mfa_required: true });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [session.user_id]);
    const user = userRes.rows[0];
    if (!user) return res.status(401).json({ error: 'Account not found or deactivated' });

    req.user = user;
    req.session = session;
    next();
});

// Validates a pre-auth session token. Used exclusively by /api/auth/mfa/* endpoints.
const authenticatePreAuth = asyncHandler(async (req, res, next) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Pre-auth token required' });

    const result = await pool.query(
        `SELECT s.*, u.* FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token = $1 AND s.expires_at > now() AND s.pre_auth = TRUE AND u.is_active = TRUE`,
        [token]
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'Pre-auth token invalid or expired. Please log in again.' });

    req.user = row;
    req.preAuthToken = token;
    next();
});

// Blocks everything except auth self-service endpoints until a forced
// password change (must_change_password) is completed.
function requirePasswordCurrent(req, res, next) {
    if (req.user.must_change_password) {
        return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
}

// Loads the user's role/department for the session's active company
// and attaches it as req.company. Super-admins get implicit Admin
// access to any company.
const requireCompany = asyncHandler(async (req, res, next) => {
    const companyId = req.session.active_company_id;
    if (!companyId) {
        const companies = await getUserCompanies(req.user);
        return res.status(409).json({ error: 'No active company selected', code: 'NO_ACTIVE_COMPANY', companies });
    }

    const companyRes = await pool.query('SELECT * FROM companies WHERE id = $1 AND is_active = true', [companyId]);
    const company = companyRes.rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (req.user.is_super_admin) {
        req.company = { ...company, role: 'Admin', functional_role: 'Super Admin', department: null, resolvedDepts: [] };
        return next();
    }

    const ucRes = await pool.query('SELECT * FROM user_companies WHERE user_id = $1 AND company_id = $2', [
        req.user.id,
        companyId,
    ]);
    if (ucRes.rows.length === 0) return res.status(403).json({ error: 'You do not have access to this company' });

    req.company = { ...company, ...ucRes.rows[0] };

    // Pre-resolve dept scope so getManagerDepts() stays synchronous.
    const buIds = (req.company.business_unit_ids || []).map(Number).filter(Boolean);
    if (buIds.length > 0) {
        // BU Manager: expand to all active depts under the assigned BUs
        const deptRes = await pool.query(
            `SELECT code FROM departments
             WHERE company_id = $1 AND active = TRUE AND business_unit_id = ANY($2::int[])`,
            [companyId, buIds]
        );
        req.company.resolvedDepts = deptRes.rows.map(r => r.code.toLowerCase());
    } else {
        const directDepts = Array.isArray(req.company.departments) && req.company.departments.length > 0
            ? req.company.departments
            : (req.company.department ? [req.company.department] : []);
        if (directDepts.length > 0) {
            // Also include any sub-depts whose parent resolves to one of the direct depts
            const subRes = await pool.query(
                `SELECT d.code FROM departments d
                 JOIN departments pd ON pd.id = d.parent_dept_id
                 WHERE d.company_id = $1 AND d.active = TRUE
                   AND (lower(pd.code) = ANY($2::text[]) OR lower(pd.name) = ANY($2::text[]))`,
                [companyId, directDepts.map(d => d.toLowerCase())]
            );
            req.company.resolvedDepts = [
                ...directDepts.map(d => d.toLowerCase()),
                ...subRes.rows.map(r => r.code.toLowerCase()),
            ];
        } else {
            req.company.resolvedDepts = [];
        }
    }

    next();
});

function requireRole(...roles) {
    // Consultant CRO inherits all CRO permissions — auto-expand so every
    // route guard that includes 'CRO' also accepts 'Consultant CRO' without
    // needing to enumerate it at every call site.
    const expanded = roles.includes('CRO') && !roles.includes('Consultant CRO')
        ? [...roles, 'Consultant CRO']
        : roles;
    return (req, res, next) => {
        // Admin and Super Admin have full access to all endpoints.
        if (req.company.role === 'Admin' || req.company.role === 'Super Admin' || expanded.includes(req.company.role)) return next();
        return res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}` });
    };
}

// ── can() / resolveScope() — Phase C shared authorization primitive ────────
// (Documents/Internal/RBAC_Permissions_Engine_Scoping.docx, Section 8.1).
// Replaces requireRole() one module at a time -- reads the scope
// ('none'|'own'|'dept'|'full') for a capability from the
// roles/capabilities/role_permissions tables Phase A seeded, instead of a
// hardcoded role list at the call site.
//
// Effective-role nuance: a real Super Admin's session carries
// req.company.role === 'Admin' with req.company.functional_role ===
// 'Super Admin' (see the /company middleware above) -- the two other
// places that need to tell them apart, the auto-approve business logic at
// ~line 2667/3588, key off functional_role for exactly this reason. Admin
// and Super Admin are seeded as distinct roles with one deliberate
// difference (risk.auto_approve), so resolveScope() must key off the same
// functional_role check those call sites use, or a real Super Admin user
// would silently inherit Admin's (narrower) permissions instead of their
// own.
//
// Cached in-process per (companyId, effectiveRole, capabilityKey) rather
// than per-request -- role_permissions only changes when an Admin saves
// the Roles & Permissions screen (Phase B), and that route clears this
// cache on every successful save, so edits take effect immediately without
// requiring affected users to log out and back in.
const _scopeCache = new Map();

function clearScopeCache() {
    _scopeCache.clear();
}

function _effectiveRoleName(company) {
    return company.functional_role === 'Super Admin' ? 'Super Admin' : company.role;
}

async function resolveScope(company, capabilityKey) {
    const roleName = _effectiveRoleName(company);
    const cacheKey = `${company.id}::${roleName}::${capabilityKey}`;
    if (_scopeCache.has(cacheKey)) return _scopeCache.get(cacheKey);

    const capRes = await pool.query('SELECT is_baseline FROM capabilities WHERE key = $1', [capabilityKey]);
    if (capRes.rows.length === 0) {
        // Fail closed on a typo'd/unknown capability key rather than silently
        // granting or denying -- this should only ever happen during
        // development of a new can() call site.
        throw new Error(`Unknown capability key: ${capabilityKey}`);
    }
    if (capRes.rows[0].is_baseline) {
        _scopeCache.set(cacheKey, 'full');
        return 'full';
    }

    // Built-in roles (company_id IS NULL) first; a company-specific custom
    // role of the same name would only exist once custom roles are actually
    // assignable (Phase D), so this is a non-issue today but resolved
    // deterministically regardless.
    const roleRes = await pool.query(
        `SELECT id FROM roles WHERE name = $1 AND (company_id IS NULL OR company_id = $2)
         ORDER BY company_id IS NULL DESC LIMIT 1`,
        [roleName, company.id]
    );
    if (roleRes.rows.length === 0) {
        _scopeCache.set(cacheKey, 'none');
        return 'none';
    }

    const permRes = await pool.query(
        'SELECT scope FROM role_permissions WHERE role_id = $1 AND capability_key = $2',
        [roleRes.rows[0].id, capabilityKey]
    );
    const scope = permRes.rows.length > 0 ? permRes.rows[0].scope : 'none';
    _scopeCache.set(cacheKey, scope);
    return scope;
}

// Route guard, drop-in analog of requireRole() for a single capability.
// On success, sets req.scope to 'own' | 'dept' | 'full' so the handler can
// apply department/ownership filtering exactly as it already does today
// via managerScopeClause()/managerCanAccess() -- Phase C does not change
// that existing filtering logic, only which mechanism decides whether the
// request is allowed through at all.
function can(capabilityKey) {
    return (req, res, next) => {
        resolveScope(req.company, capabilityKey)
            .then((scope) => {
                if (scope === 'none') {
                    return res.status(403).json({ error: `Missing capability: ${capabilityKey}` });
                }
                req.scope = scope;
                next();
            })
            .catch(next);
    };
}


// Gates routes that require the platform-level Consultant flag.
// Used for the Consultant Dashboard — independent of company-scoped roles.
function requireConsultant(req, res, next) {
    if (!req.user.is_consultant) {
        return res.status(403).json({ error: 'Consultant access required' });
    }
    next();
}

// ── Scope helpers (V1.9 group/subsidiary) ──────────────────────────────────
const SCOPE_RANK = { none: 0, consolidated_only: 1, view: 2, full: 3 };
function minScope(a, b) {
    return SCOPE_RANK[a] <= SCOPE_RANK[b] ? a : b;
}

// Returns the list of companies (with role) a user has access to.
// V1.9: also includes subsidiaries reachable via group_access_scope.
async function getUserCompanies(user) {
    if (user.is_super_admin) {
        const result = await pool.query(
            `SELECT id, name, code, branding_logo_url, branding_primary_color,
                    parent_company_id, max_group_access_scope, industry
             FROM companies WHERE is_active = true ORDER BY name`
        );
        return result.rows.map((c) => ({
            ...c, role: 'Admin', department: null, functional_role: null,
            group_access_scope: 'full', via_group_access: false, effective_group_scope: 'full',
        }));
    }

    // Direct memberships
    const directRes = await pool.query(
        `SELECT c.id, c.name, c.code, c.branding_logo_url, c.branding_primary_color,
                c.parent_company_id, c.max_group_access_scope, c.industry,
                c.has_business_units,
                uc.role, uc.department, uc.departments, uc.business_unit_ids,
                uc.functional_role, uc.group_access_scope
         FROM user_companies uc
         JOIN companies c ON c.id = uc.company_id
         WHERE uc.user_id = $1 AND c.is_active = true
         ORDER BY c.name`,
        [user.id]
    );
    const companies = directRes.rows.map((r) => ({ ...r, via_group_access: false }));
    const seen = new Set(companies.map((c) => c.id));

    // Group access: for each parent company where this user has group_access_scope != 'none',
    // add the subsidiaries with effective role computed from minScope.
    const parents = companies.filter((c) => c.group_access_scope && c.group_access_scope !== 'none');
    for (const parent of parents) {
        const subRes = await pool.query(
            `SELECT id, name, code, branding_logo_url, branding_primary_color,
                    parent_company_id, max_group_access_scope, industry, has_business_units
             FROM companies WHERE parent_company_id = $1 AND is_active = true ORDER BY name`,
            [parent.id]
        );
        for (const sub of subRes.rows) {
            if (seen.has(sub.id)) continue; // already a direct member — direct role takes precedence
            const effectiveScope = minScope(parent.group_access_scope, sub.max_group_access_scope);
            if (effectiveScope === 'none') continue;
            const effectiveRole = effectiveScope === 'full' ? parent.role : 'Viewer';
            companies.push({
                ...sub,
                role: effectiveRole,
                department: null, functional_role: null, group_access_scope: 'none',
                via_group_access: true,
                group_via_parent_id: parent.id,
                group_via_parent_name: parent.name,
                effective_group_scope: effectiveScope,
            });
            seen.add(sub.id);
        }
    }

    return companies;
}

function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        is_super_admin: user.is_super_admin,
        is_consultant: !!user.is_consultant,
        must_change_password: user.must_change_password,
        disclaimer_accepted: !!user.disclaimer_accepted_at,
    };
}

// ============================================================
// Auth routes
// ============================================================

// G9: per-client branding. Unauthenticated, since the login screen
// needs it before any session exists. With "one application instance
// per client" (G1), branding is effectively instance-wide -- this
// returns the lowest-id active company's branding, which in practice is
// the client's primary/holding company. Per-company branding for
// subsidiaries (post-login) is still available via /api/auth/me.
app.get(
    '/api/branding',
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT name, branding_logo_url, branding_primary_color FROM companies WHERE is_active = true ORDER BY id LIMIT 1`
        );
        if (result.rows.length === 0) return res.json({ name: null, branding_logo_url: null, branding_primary_color: '#2563eb' });
        res.json(result.rows[0]);
    })
);

app.post(
    '/api/auth/login',
    loginLimiter,
    validate(schemas.login),
    asyncHandler(async (req, res) => {
        const { email, password } = req.body;

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        const user = userRes.rows[0];

        // Same response whether the user doesn't exist or the password is wrong,
        // so the endpoint can't be used to enumerate accounts.
        const genericFail = () => res.status(401).json({ error: 'Invalid email or password' });

        if (!user || !user.is_active) return genericFail();

        if (isLocked(user)) {
            return res.status(423).json({
                error: `Account locked due to repeated failed logins. Try again after ${new Date(user.locked_until).toLocaleString()}.`,
            });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            const attempts = await recordFailedLogin(user.id);
            await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login_failed', actor: user, details: { attempts } });
            if (attempts >= MAX_FAILED_ATTEMPTS) {
                await logAudit(null, { entityType: 'user', entityId: user.id, action: 'account_locked', actor: user, details: { attempts, reason: 'repeated_failed_logins' } });
                sendSecurityAlert(user, 'account_locked', { attempts }).catch(() => {});
            }
            return genericFail();
        }

        await resetFailedLogins(user.id);
        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login_password_ok', actor: user });

        // ── Automated-test bypass (CI/CD only) ───────────────────────────
        // Skips the MFA gate when the caller presents the shared test API key.
        // Only active when TEST_API_KEY is configured on this Cloud Run revision.
        // The key is never committed to source; it lives in Cloud Run env vars.
        const TEST_API_KEY = process.env.TEST_API_KEY;
        if (TEST_API_KEY && req.headers['x-test-api-key'] === TEST_API_KEY) {
            const companies = await getUserCompanies(user);
            const activeCompanyId = companies.length === 1 ? companies[0].id : null;
            const session = await createSession(user.id, activeCompanyId);
            await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login', actor: user, companyId: activeCompanyId });
            setSessionCookie(res, session.token);
            return res.json({
                token: session.token,
                idleTimeoutMinutes: session.idleTimeoutMinutes,
                user: publicUser(user),
                passwordExpired: isPasswordExpired(user),
                companies,
                activeCompanyId,
            });
        }

        // ── Demo bypass (no MFA for prospect demos) ──────────────────────
        // When DISABLE_MFA=true the MFA gate is skipped and a full session is
        // issued immediately after password verification. Must NOT be set on
        // staging or production Cloud Run revisions.
        if (process.env.DISABLE_MFA === 'true') {
            const companies = await getUserCompanies(user);
            const activeCompanyId = companies.length === 1 ? companies[0].id : null;
            const session = await createSession(user.id, activeCompanyId);
            await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login', actor: user, companyId: activeCompanyId });
            setSessionCookie(res, session.token);
            return res.json({
                token: session.token,
                idleTimeoutMinutes: session.idleTimeoutMinutes,
                user: publicUser(user),
                passwordExpired: isPasswordExpired(user),
                companies,
                activeCompanyId,
            });
        }

        // ── MFA gate (SOC 2: CC6.1) ──────────────────────────────────────
        // Issue a short-lived pre-auth token. The real session token is only
        // granted after the user completes TOTP verification below.
        const preAuth = await createPreAuthSession(user.id);

        if (!user.mfa_verified) {
            // User has not yet enrolled MFA — send them to the setup flow.
            return res.json({
                mfa_setup_required: true,
                pre_auth_token: preAuth.token,
            });
        }

        // User has MFA enrolled — send them to the verify flow.
        return res.json({
            mfa_required: true,
            pre_auth_token: preAuth.token,
        });
    })
);

// ── MFA: get setup secret + QR code ──────────────────────────────────────────
app.get(
    '/api/auth/mfa/setup',
    mfaLimiter,
    authenticatePreAuth,
    asyncHandler(async (req, res) => {
        const secret = generateTotpSecret();
        const uri    = totpUri(secret, req.user.email);

        // Persist the (unverified) secret so we can validate the first code.
        await pool.query('UPDATE users SET mfa_secret = $1, mfa_enabled = FALSE, mfa_verified = FALSE WHERE id = $2', [
            secret,
            req.user.id,
        ]);

        // QR code rendered client-side via api.qrserver.com (no server-side package needed).
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(uri)}`;

        res.json({ secret, qr_url: qrUrl });
    })
);

// ── MFA: confirm setup with first TOTP code ───────────────────────────────────
app.post(
    '/api/auth/mfa/setup/verify',
    mfaLimiter,
    authenticatePreAuth,
    validate(schemas.mfaCode),
    asyncHandler(async (req, res) => {
        const { code } = req.body;

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];

        if (!user.mfa_secret) {
            return res.status(400).json({ error: 'MFA setup not initiated. Please request a setup QR code first.' });
        }

        if (!verifyTotp(user.mfa_secret, code)) {
            await logAudit(null, { entityType: 'user', entityId: user.id, action: 'mfa_verify_failed', actor: user, details: { stage: 'setup' } });
            return res.status(400).json({ error: 'Invalid code. Please check your authenticator app and try again.' });
        }

        // Mark MFA as enrolled and verified.
        await pool.query('UPDATE users SET mfa_enabled = TRUE, mfa_verified = TRUE WHERE id = $1', [user.id]);
        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'mfa_enrolled', actor: user });

        // Destroy the pre-auth session and issue a real session.
        await pool.query('DELETE FROM sessions WHERE token = $1', [req.preAuthToken]);
        const companies = await getUserCompanies(user);
        const activeCompanyId = companies.length === 1 ? companies[0].id : null;
        const session = await createSession(user.id, activeCompanyId);
        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login', actor: user, companyId: activeCompanyId });

        setSessionCookie(res, session.token);
        res.json({
            token: session.token,          // also in body for API clients / test suite
            idleTimeoutMinutes: session.idleTimeoutMinutes,
            user: publicUser(user),
            passwordExpired: isPasswordExpired(user),
            companies,
            activeCompanyId,
        });
    })
);

// ── MFA: verify TOTP code for an already-enrolled user ───────────────────────
app.post(
    '/api/auth/mfa/verify',
    mfaLimiter,
    authenticatePreAuth,
    validate(schemas.mfaCode),
    asyncHandler(async (req, res) => {
        const { code } = req.body;

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];

        if (!user.mfa_secret || !user.mfa_verified) {
            return res.status(400).json({ error: 'MFA not enrolled for this account.' });
        }

        if (!verifyTotp(user.mfa_secret, code)) {
            await logAudit(null, { entityType: 'user', entityId: user.id, action: 'mfa_verify_failed', actor: user, details: { stage: 'login' } });
            return res.status(400).json({ error: 'Invalid code. Please check your authenticator app and try again.' });
        }

        // Destroy the pre-auth session and issue a real session.
        await pool.query('DELETE FROM sessions WHERE token = $1', [req.preAuthToken]);
        const companies = await getUserCompanies(user);
        const activeCompanyId = companies.length === 1 ? companies[0].id : null;
        const session = await createSession(user.id, activeCompanyId);
        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'login', actor: user, companyId: activeCompanyId });

        setSessionCookie(res, session.token);
        res.json({
            token: session.token,          // also in body for API clients / test suite
            idleTimeoutMinutes: session.idleTimeoutMinutes,
            user: publicUser(user),
            passwordExpired: isPasswordExpired(user),
            companies,
            activeCompanyId,
        });
    })
);

// First-time setup wizard — creates the first company for a user who has no
// company memberships yet. Used when a new client instance is deployed or when
// a new user account is created before a company is assigned to them.
app.post(
    '/api/setup/initialize',
    authenticate,
    validate(schemas.setup),
    asyncHandler(async (req, res) => {
        // Block if user already belongs to at least one company.
        const existing = await pool.query(
            'SELECT 1 FROM user_companies WHERE user_id = $1 LIMIT 1',
            [req.user.id]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Your account already has a company assigned.' });
        }

        const { org_name, org_code, industry, admin_full_name, departments } = req.body;
        if (!org_name || !org_code) {
            return res.status(400).json({ error: 'Organization name and code are required.' });
        }

        const cleanCode = org_code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
        if (cleanCode.length < 2) {
            return res.status(400).json({ error: 'Organization code must be at least 2 characters.' });
        }

        // Ensure code is unique.
        const codeCheck = await pool.query('SELECT id FROM companies WHERE code = $1', [cleanCode]);
        if (codeCheck.rows.length > 0) {
            return res.status(409).json({ error: 'That organization code is already in use. Please choose another.' });
        }

        // Create the company.
        const companyRes = await pool.query(
            `INSERT INTO companies (name, code, industry, is_active)
             VALUES ($1, $2, $3, true) RETURNING *`,
            [org_name.trim(), cleanCode, industry || null]
        );
        const company = companyRes.rows[0];

        // Seed standard risk taxonomy for the new company.
        await seedRiskTaxonomy(pool, company.id);

        // Assign this user as Admin with full group access scope.
        await pool.query(
            `INSERT INTO user_companies (user_id, company_id, role, group_access_scope)
             VALUES ($1, $2, 'Admin', 'full')`,
            [req.user.id, company.id]
        );

        // Update the admin's display name if provided.
        if (admin_full_name && admin_full_name.trim()) {
            await pool.query(
                'UPDATE users SET full_name = $1 WHERE id = $2',
                [admin_full_name.trim(), req.user.id]
            );
        }

        // Seed departments — use wizard-provided list or fall back to defaults.
        const deptsToSeed = (departments && departments.length > 0) ? departments : DEFAULT_DEPARTMENTS;
        await seedDefaultDepartments(pool, company.id, deptsToSeed);

        await logAudit(null, {
            companyId: company.id,
            entityType: 'company',
            entityId: company.id,
            action: 'create',
            actor: req.user,
            details: { name: company.name, code: company.code, industry, departments: deptsToSeed.length, via: 'setup_wizard' },
        });

        res.json({ company });
    })
);

app.post(
    '/api/auth/logout',
    authenticate,
    asyncHandler(async (req, res) => {
        await destroySession(req.session.token);
        clearSessionCookie(res);
        res.json({ message: 'Logged out' });
    })
);

app.get(
    '/api/auth/me',
    authenticate,
    asyncHandler(async (req, res) => {
        const companies = await getUserCompanies(req.user);
        res.json({
            user: publicUser(req.user),
            passwordExpired: isPasswordExpired(req.user),
            companies,
            activeCompanyId: req.session.active_company_id,
            isGroupView: req.session.is_group_view || false,
            idleTimeoutMinutes: SESSION_IDLE_TIMEOUT_MINUTES,
        });
    })
);

// Legal disclaimer — marks the user as having accepted on first use.
// Stored permanently on the users row so it persists across devices.
app.post(
    '/api/auth/accept-disclaimer',
    authenticate,
    asyncHandler(async (req, res) => {
        await pool.query(
            'UPDATE users SET disclaimer_accepted_at = now() WHERE id = $1',
            [req.user.id]
        );
        res.json({ ok: true });
    })
);

app.post(
    '/api/auth/switch-company',
    authenticate,
    asyncHandler(async (req, res) => {
        const { company_id, group_view } = req.body;
        const companies = await getUserCompanies(req.user);

        const tok = req.session.token;

        // group_view mode: company_id must be a parent the user has group access on
        if (group_view) {
            const match = companies.find((c) => c.id === company_id && c.group_access_scope && c.group_access_scope !== 'none');
            if (!match) return res.status(403).json({ error: 'You do not have group access to this company' });
            await setActiveCompany(tok, company_id);
            await pool.query('UPDATE sessions SET is_group_view = true WHERE token = $1', [tok]);
            return res.json({ activeCompanyId: company_id, role: match.role, isGroupView: true });
        }

        const match = companies.find((c) => c.id === company_id);
        if (!match) return res.status(403).json({ error: 'You do not have access to this company' });

        await setActiveCompany(tok, company_id);
        await pool.query('UPDATE sessions SET is_group_view = false WHERE token = $1', [tok]);
        res.json({ activeCompanyId: company_id, role: match.role, isGroupView: false });
    })
);

app.post(
    '/api/auth/change-password',
    authenticate,
    validate(schemas.changePassword),
    asyncHandler(async (req, res) => {
        const { currentPassword, newPassword } = req.body;

        const match = await bcrypt.compare(currentPassword, req.user.password_hash);
        if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

        const policyIssues = validatePasswordPolicy(newPassword);
        if (policyIssues.length > 0) {
            return res.status(400).json({ error: `Password must ${policyIssues.join(', ')}` });
        }

        if (await isPasswordReused(req.user.id, newPassword)) {
            return res.status(400).json({ error: 'New password must not match any of your last 5 passwords' });
        }

        await setPassword(req.user.id, newPassword);

        // Invalidate all other active sessions — no concurrent session should
        // remain valid after a password change (closes the session-fixation gap).
        await pool.query(
            'DELETE FROM sessions WHERE user_id = $1 AND token != $2',
            [req.user.id, req.session.token]
        );

        await logAudit(null, { entityType: 'user', entityId: req.user.id, action: 'password_changed', actor: req.user });

        res.json({ message: 'Password updated' });
    })
);

// ============================================================
// Password reset (Task #34) — unauthenticated routes
// ============================================================

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
const PASSWORD_RESET_MODE = process.env.PASSWORD_RESET_MODE || 'self_service';

// POST /api/auth/forgot-password  — generate a temporary password (no email required)
app.post(
    '/api/auth/forgot-password',
    makeDbRateLimiter({ name: 'pwd-reset', windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many reset requests. Try again later.' } }),
    validate(schemas.forgotPassword),
    asyncHandler(async (req, res) => {
        if (PASSWORD_RESET_MODE === 'it_managed') {
            return res.status(403).json({ error: 'Self-service password reset is disabled. Please contact your administrator.' });
        }

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const userRes = await pool.query(
            'SELECT u.*, uc.company_id FROM users u LEFT JOIN user_companies uc ON u.id = uc.user_id WHERE u.email = $1 AND u.is_active = TRUE LIMIT 1',
            [email.toLowerCase().trim()]
        );
        const user = userRes.rows[0];
        if (!user) return res.json({ found: false });

        // Check per-company feature flag
        if (user.company_id) {
            const compRes = await pool.query('SELECT password_reset_mode FROM companies WHERE id = $1', [user.company_id]);
            const mode = compRes.rows[0]?.password_reset_mode || 'self_service';
            if (mode === 'it_managed') {
                return res.status(403).json({ error: 'Self-service password reset is disabled. Please contact your administrator.' });
            }
        }

        // Clean up any dangling reset tokens
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

        // Generate a temp password that satisfies the password policy.
        function makeTempPassword() {
            const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const lower = 'abcdefghjkmnpqrstuvwxyz';
            const digits = '23456789';
            const special = '!@#$%^&*';
            const all = upper + lower + digits + special;
            let p = upper[Math.floor(Math.random() * upper.length)]
                  + lower[Math.floor(Math.random() * lower.length)]
                  + digits[Math.floor(Math.random() * digits.length)]
                  + special[Math.floor(Math.random() * special.length)];
            for (let i = 4; i < 12; i++) p += all[Math.floor(Math.random() * all.length)];
            return p.split('').sort(() => Math.random() - 0.5).join('');
        }

        const tempPassword = makeTempPassword();
        const hash = await bcrypt.hash(tempPassword, 10);

        // Set temp password and force change on next login.
        await pool.query(
            `UPDATE users
             SET password_hash = $1, password_changed_at = now(), must_change_password = true,
                 failed_login_attempts = 0, locked_until = NULL
             WHERE id = $2`,
            [hash, user.id]
        );

        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'password_reset_requested', actor: user });
        return res.json({ found: true, tempPassword });
    })
);

// POST /api/auth/reset-password  — consume a reset token
app.post(
    '/api/auth/reset-password',
    makeDbRateLimiter({ name: 'pwd-change', windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many requests.' } }),
    validate(schemas.resetPassword),
    asyncHandler(async (req, res) => {
        const { token, newPassword } = req.body;

        if (PASSWORD_RESET_MODE === 'it_managed') {
            return res.status(403).json({ error: 'Self-service password reset is disabled. Please contact IT.' });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const tokenRes = await pool.query(
            'SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
            [tokenHash]
        );
        const record = tokenRes.rows[0];
        if (!record) return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });

        const policyIssues = validatePasswordPolicy(newPassword);
        if (policyIssues.length > 0) return res.status(400).json({ error: `Password must ${policyIssues.join(', ')}` });

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [record.user_id]);
        const user = userRes.rows[0];
        if (!user || !user.is_active) return res.status(400).json({ error: 'Account not found or deactivated' });

        if (await isPasswordReused(user.id, newPassword)) {
            return res.status(400).json({ error: 'New password must not match any of your last 5 passwords' });
        }

        await setPassword(user.id, newPassword);
        // Mark token as used
        await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [record.id]);
        // Invalidate all sessions (security: log out everywhere on password reset)
        await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        await logAudit(null, { entityType: 'user', entityId: user.id, action: 'password_reset_completed', actor: user });

        res.json({ message: 'Password reset successfully. Please log in with your new password.' });
    })
);

// ============================================================
// Email settings — Admin only, requires company context
// ============================================================

// GET /api/email-settings — get current company's email config
app.get(
    '/api/email-settings',
    authenticate,
    requirePasswordCurrent,
    requireCompany,
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { rows } = await pool.query(
            'SELECT * FROM company_email_settings WHERE company_id = $1',
            [req.company.id]
        );
        const cfg = rows[0];
        if (!cfg) return res.json(null);
        // Never return the encrypted password — mask it
        res.json({ ...cfg, smtp_password_enc: cfg.smtp_password_enc ? '••••••••' : null });
    })
);

// PUT /api/email-settings — save/update email config
app.put(
    '/api/email-settings',
    authenticate,
    requirePasswordCurrent,
    requireCompany,
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { inherit_from_parent, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_name, from_email, reply_to } = req.body;

        // Encrypt password only if a new one is provided
        let encPassword = null;
        if (smtp_password && smtp_password !== '••••••••') {
            try {
                encPassword = encryptPassword(smtp_password);
            } catch (e) {
                return res.status(500).json({ error: 'Email encryption key not configured on server. Contact your administrator.' });
            }
        }

        const existing = await pool.query('SELECT smtp_password_enc FROM company_email_settings WHERE company_id = $1', [req.company.id]);
        const keepExistingPassword = smtp_password === '••••••••' && existing.rows[0]?.smtp_password_enc;

        await pool.query(
            `INSERT INTO company_email_settings
                (company_id, inherit_from_parent, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc, from_name, from_email, reply_to, verified_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NULL, now())
             ON CONFLICT (company_id) DO UPDATE SET
                inherit_from_parent = EXCLUDED.inherit_from_parent,
                smtp_host           = EXCLUDED.smtp_host,
                smtp_port           = EXCLUDED.smtp_port,
                smtp_secure         = EXCLUDED.smtp_secure,
                smtp_user           = EXCLUDED.smtp_user,
                smtp_password_enc   = COALESCE($7, CASE WHEN $11 THEN company_email_settings.smtp_password_enc ELSE NULL END),
                from_name           = EXCLUDED.from_name,
                from_email          = EXCLUDED.from_email,
                reply_to            = EXCLUDED.reply_to,
                verified_at         = NULL,
                updated_at          = now()`,
            [req.company.id, inherit_from_parent || false, smtp_host, smtp_port || 587, smtp_secure !== false,
             smtp_user, encPassword, from_name, from_email, reply_to || null, keepExistingPassword]
        );

        await logAudit(null, { companyId: req.company.id, entityType: 'company', entityId: req.company.id, action: 'email_settings_updated', actor: req.user });
        res.json({ message: 'Email settings saved. Send a test email to verify.' });
    })
);

// POST /api/email-settings/test — send a test email
app.post(
    '/api/email-settings/test',
    authenticate,
    requirePasswordCurrent,
    requireCompany,
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        try {
            await sendTestEmail(req.company.id, req.user.email);
            await logAudit(null, { companyId: req.company.id, entityType: 'company', entityId: req.company.id, action: 'email_test_sent', actor: req.user });
            res.json({ message: `Test email sent to ${req.user.email}. Check your inbox.` });
        } catch (e) {
            res.status(400).json({ error: `Test failed: ${e.message}` });
        }
    })
);

// Create a standalone company — no active company required, just authenticated Admin.
// Must be registered BEFORE the requireCompany catch-all below.
app.post('/api/companies/standalone', authenticate, requirePasswordCurrent,
    asyncHandler(async (req, res) => {
        const { name, code, industry, company_type, country, regulatory_body, fiscal_year_end, description, address, has_business_units } = req.body;
        if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

        // BUG-06: block duplicate name in the same country
        const dupCheck = await pool.query(
            `SELECT 1 FROM companies WHERE LOWER(name) = LOWER($1) AND LOWER(COALESCE(country,'')) = LOWER(COALESCE($2,''))`,
            [name.trim(), country || '']
        );
        if (dupCheck.rows.length > 0) {
            return res.status(409).json({ error: 'A company with this name already exists in this country.' });
        }

        // Verify user is Admin on at least one company, OR is a consultant super-admin.
        // RBAC-01: is_consultant alone is not sufficient — must also be is_super_admin
        // to prevent a broadly-granted consultant flag from conferring company-creation rights.
        const check = await pool.query(
            `SELECT 1 FROM user_companies uc
             JOIN companies c ON c.id = uc.company_id
             WHERE uc.user_id = $1 AND uc.role = 'Admin' AND c.is_active = true
             LIMIT 1`,
            [req.user.id]
        );
        const isConsultantSuperAdmin = req.user.is_consultant && req.user.is_super_admin;
        if (check.rows.length === 0 && !isConsultantSuperAdmin) {
            return res.status(403).json({ error: 'Admin access required to create a company' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO companies (name, code, parent_company_id, industry, company_type, country, regulatory_body, fiscal_year_end, description, address, has_business_units)
                 VALUES ($1, UPPER($2), NULL, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                [name.trim(), code.trim(),
                 industry || null, company_type || null, country || null,
                 regulatory_body || null, fiscal_year_end || null, description || null,
                 address || null, has_business_units === true || has_business_units === 'true']
            );
            const newCompany = r.rows[0];
            await client.query(
                `INSERT INTO user_companies (user_id, company_id, role)
                 VALUES ($1, $2, 'Admin') ON CONFLICT (user_id, company_id) DO NOTHING`,
                [req.user.id, newCompany.id]
            );
            await seedRiskTaxonomy(client, newCompany.id);
            await client.query('COMMIT');
            res.status(201).json(newCompany);
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.code === '23505') return res.status(409).json({ error: 'Company code already exists' });
            throw err;
        } finally {
            client.release();
        }
    })
);

// ============================================================
// From here on, every route requires an authenticated user with a
// current password and an active company context.
// ============================================================
app.use('/api', authenticate, requirePasswordCurrent, requireCompany);

// ============================================================
// Risk taxonomy — structured category + sub-category CRUD (Admin only)
// DC-04: /api/categories (legacy flat routes) removed — superseded by /api/risk-taxonomy
// ============================================================

// GET /api/risk-taxonomy — full structured list for the current company
app.get('/api/risk-taxonomy', asyncHandler(async (req, res) => {
    const cats = await pool.query(
        `SELECT id, name FROM risk_categories WHERE company_id = $1 ORDER BY sort_order, name`,
        [req.company.id]
    );
    const subs = await pool.query(
        `SELECT s.id, s.category_id, s.name
         FROM risk_sub_categories s
         JOIN risk_categories c ON s.category_id = c.id
         WHERE c.company_id = $1
         ORDER BY s.sort_order, s.name`,
        [req.company.id]
    );
    const subMap = {};
    subs.rows.forEach((s) => {
        if (!subMap[s.category_id]) subMap[s.category_id] = [];
        subMap[s.category_id].push({ id: s.id, name: s.name });
    });
    res.json(cats.rows.map((c) => ({ id: c.id, name: c.name, sub_categories: subMap[c.id] || [] })));
}));

// POST /api/risk-categories — add a category (Admin only)
app.post('/api/risk-categories', requireRole('Admin'), asyncHandler(async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    try {
        await pool.query(
            `INSERT INTO risk_categories (company_id, name, sort_order)
             VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order),0)+1 FROM risk_categories WHERE company_id = $1))`,
            [req.company.id, name]
        );
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'A category with that name already exists' });
        throw e;
    }
    res.status(201).json({ ok: true });
}));

// PUT /api/risk-categories/:id — rename a category (Admin only)
app.put('/api/risk-categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const r = await pool.query(
        `UPDATE risk_categories SET name = $1 WHERE id = $2 AND company_id = $3 RETURNING id`,
        [name, req.params.id, req.company.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true });
}));

// DELETE /api/risk-categories/:id — delete a category (Admin only, blocked if in use)
app.delete('/api/risk-categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
    // Check for category in use on any risk
    const catRow = await pool.query(
        `SELECT name FROM risk_categories WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.company.id]
    );
    if (catRow.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    const catName = catRow.rows[0].name;
    const inUse = await pool.query(
        `SELECT COUNT(*) FROM risks WHERE company_id = $1 AND risk_category = $2`,
        [req.company.id, catName]
    );
    const count = parseInt(inUse.rows[0].count, 10);
    if (count > 0) {
        return res.status(409).json({
            error: `Cannot delete — ${count} risk${count === 1 ? '' : 's'} currently use this category.`,
        });
    }
    // D-04: also block if any risks reference sub-categories of this category
    const subInUse = await pool.query(
        `SELECT COUNT(*) FROM risks
         WHERE company_id = $1
           AND sub_category IN (
               SELECT name FROM risk_sub_categories WHERE category_id = $2
           )`,
        [req.company.id, req.params.id]
    );
    const subCount = parseInt(subInUse.rows[0].count, 10);
    if (subCount > 0) {
        return res.status(409).json({
            error: `Cannot delete — ${subCount} risk${subCount === 1 ? '' : 's'} use sub-categories of this category.`,
        });
    }
    await pool.query(`DELETE FROM risk_categories WHERE id = $1 AND company_id = $2`, [req.params.id, req.company.id]);
    res.json({ ok: true });
}));

// POST /api/risk-sub-categories — add a sub-category (Admin only)
app.post('/api/risk-sub-categories', requireRole('Admin'), asyncHandler(async (req, res) => {
    const { category_id, name } = req.body;
    if (!category_id || !name?.trim()) return res.status(400).json({ error: 'category_id and name are required' });
    // Ensure the category belongs to this company
    const cat = await pool.query(
        `SELECT id FROM risk_categories WHERE id = $1 AND company_id = $2`,
        [category_id, req.company.id]
    );
    if (cat.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    try {
        await pool.query(
            `INSERT INTO risk_sub_categories (category_id, name, sort_order)
             VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order),0)+1 FROM risk_sub_categories WHERE category_id = $1))`,
            [category_id, name.trim()]
        );
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'A sub-category with that name already exists' });
        throw e;
    }
    res.status(201).json({ ok: true });
}));

// PUT /api/risk-sub-categories/:id — rename a sub-category (Admin only)
app.put('/api/risk-sub-categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = await pool.query(
        `UPDATE risk_sub_categories s SET name = $1
         FROM risk_categories c
         WHERE s.id = $2 AND s.category_id = c.id AND c.company_id = $3
         RETURNING s.id`,
        [name, req.params.id, req.company.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Sub-category not found' });
    res.json({ ok: true });
}));

// DELETE /api/risk-sub-categories/:id — delete a sub-category (Admin only, blocked if in use)
app.delete('/api/risk-sub-categories/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
    // Verify ownership and get name for in-use check
    const subRow = await pool.query(
        `SELECT s.name FROM risk_sub_categories s
         JOIN risk_categories c ON s.category_id = c.id
         WHERE s.id = $1 AND c.company_id = $2`,
        [req.params.id, req.company.id]
    );
    if (subRow.rowCount === 0) return res.status(404).json({ error: 'Sub-category not found' });
    const subName = subRow.rows[0].name;
    const inUse = await pool.query(
        `SELECT COUNT(*) FROM risks WHERE company_id = $1 AND sub_category = $2`,
        [req.company.id, subName]
    );
    const count = parseInt(inUse.rows[0].count, 10);
    if (count > 0) {
        return res.status(409).json({
            error: `Cannot delete — ${count} risk${count === 1 ? '' : 's'} currently use this sub-category.`,
        });
    }
    // Include company scope in the DELETE for defense-in-depth (NEW-03 fix).
    // Ownership was already verified above, but belt-and-suspenders ensures
    // a TOCTOU window cannot be exploited even in theory.
    await pool.query(
        `DELETE FROM risk_sub_categories WHERE id = $1
         AND category_id IN (SELECT id FROM risk_categories WHERE company_id = $2)`,
        [req.params.id, req.company.id]
    );
    res.json({ ok: true });
}));

// ============================================================
// Risk cause/consequence taxonomy (controlled vocabulary)
// ============================================================
//
// Free-text risk_cause/risk_consequence fields fragment into near-duplicate
// phrasing over time ("system outage" vs "IT system failure" vs
// "technology disruption"). These endpoints back a "pick from a list, or
// add your own" control on the Risk form -- any Admin/Manager can add a
// new term (it's then available to everyone), keeping the vocabulary
// curated without a separate admin step blocking day-to-day use.

const TAXONOMY_TYPES = ['cause', 'consequence'];

app.get(
    '/api/taxonomies/:type',
    asyncHandler(async (req, res) => {
        if (!TAXONOMY_TYPES.includes(req.params.type)) return res.status(404).json({ error: 'Unknown taxonomy type' });
        const result = await pool.query(
            'SELECT name FROM risk_taxonomy_terms WHERE company_id = $1 AND term_type = $2 ORDER BY sort_order, name',
            [req.company.id, req.params.type]
        );
        res.json(result.rows.map((r) => r.name));
    })
);

app.post(
    '/api/taxonomies/:type',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    asyncHandler(async (req, res) => {
        if (!TAXONOMY_TYPES.includes(req.params.type)) return res.status(404).json({ error: 'Unknown taxonomy type' });
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name is required' });

        await pool.query(
            `INSERT INTO risk_taxonomy_terms (company_id, term_type, name, sort_order)
             VALUES ($1, $2::varchar(20), $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM risk_taxonomy_terms WHERE company_id = $1 AND term_type = $2::varchar(20)))
             ON CONFLICT (company_id, term_type, name) DO NOTHING`,
            [req.company.id, req.params.type, name]
        );

        const result = await pool.query(
            'SELECT name FROM risk_taxonomy_terms WHERE company_id = $1 AND term_type = $2 ORDER BY sort_order, name',
            [req.company.id, req.params.type]
        );
        res.status(201).json(result.rows.map((r) => r.name));
    })
);

app.delete(
    '/api/taxonomies/:type',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        if (!TAXONOMY_TYPES.includes(req.params.type)) return res.status(404).json({ error: 'Unknown taxonomy type' });
        await pool.query('DELETE FROM risk_taxonomy_terms WHERE company_id = $1 AND term_type = $2 AND name = $3', [
            req.company.id, req.params.type, req.body.name,
        ]);
        const result = await pool.query(
            'SELECT name FROM risk_taxonomy_terms WHERE company_id = $1 AND term_type = $2 ORDER BY sort_order, name',
            [req.company.id, req.params.type]
        );
        res.json(result.rows.map((r) => r.name));
    })
);


app.get(
    '/api/matrix/config',
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            'SELECT current_dimensions, fiscal_year_start_month FROM matrix_settings WHERE company_id = $1',
            [req.company.id]
        );
        const row = result.rows[0] || { current_dimensions: '5x5', fiscal_year_start_month: 0 };
        res.json({ currentDimensions: row.current_dimensions, fiscalYearStartMonth: row.fiscal_year_start_month });
    })
);

app.post(
    '/api/matrix/config',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const current = await pool.query(
            'SELECT current_dimensions, fiscal_year_start_month FROM matrix_settings WHERE company_id = $1',
            [req.company.id]
        );
        const row = current.rows[0] || { current_dimensions: '5x5', fiscal_year_start_month: 0 };

        const newDimensions = req.body.dimensions || row.current_dimensions;
        const newFiscalStart =
            req.body.fiscalYearStartMonth !== undefined
                ? parseInt(req.body.fiscalYearStartMonth, 10)
                : row.fiscal_year_start_month;

        await pool.query(
            `INSERT INTO matrix_settings (company_id, current_dimensions, fiscal_year_start_month)
             VALUES ($1, $2, $3)
             ON CONFLICT (company_id) DO UPDATE SET current_dimensions = $2, fiscal_year_start_month = $3`,
            [req.company.id, newDimensions, newFiscalStart]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'matrix_settings',
            entityId: req.company.id,
            action: 'update',
            actor: req.user,
            details: { dimensions: newDimensions, fiscalYearStartMonth: newFiscalStart },
        });

        res.json({ currentDimensions: newDimensions, fiscalYearStartMonth: newFiscalStart });
    })
);

// ============================================================
// Branding (G9) -- per-client logo + primary color
// ============================================================
//
// branding_logo_url accepts either an external URL or a data: URI (for
// uploaded images, encoded client-side) -- see frontend Branding page.
// Capped well under Postgres's TEXT limit but large enough for a
// reasonably-sized logo; the frontend additionally caps uploads to keep
// this practical.

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

app.get(
    '/api/companies/current/branding',
    asyncHandler(async (req, res) => {
        const result = await pool.query('SELECT name, branding_logo_url, branding_primary_color FROM companies WHERE id = $1', [req.company.id]);
        res.json(result.rows[0] || { name: null, branding_logo_url: null, branding_primary_color: '#2563eb' });
    })
);

app.patch(
    '/api/companies/current/branding',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { branding_logo_url, branding_primary_color } = req.body;

        if (branding_primary_color !== undefined && branding_primary_color !== null && !HEX_COLOR_RE.test(branding_primary_color)) {
            return res.status(400).json({ error: 'branding_primary_color must be a hex color like #2563eb' });
        }
        if (typeof branding_logo_url === 'string' && branding_logo_url.length > 2_000_000) {
            return res.status(400).json({ error: 'Logo is too large (max ~1.5MB)' });
        }

        const updates = [];
        const values = [];
        if (branding_logo_url !== undefined) {
            values.push(branding_logo_url || null);
            updates.push(`branding_logo_url = $${values.length}`);
        }
        if (branding_primary_color !== undefined) {
            values.push(branding_primary_color || '#2563eb');
            updates.push(`branding_primary_color = $${values.length}`);
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.company.id);
        const result = await pool.query(
            `UPDATE companies SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING name, branding_logo_url, branding_primary_color`,
            values
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'company',
            entityId: req.company.id,
            action: 'branding_update',
            actor: req.user,
            details: { branding_primary_color: result.rows[0].branding_primary_color, logo_changed: branding_logo_url !== undefined },
        });

        res.json(result.rows[0]);
    })
);

// ── Departments ──────────────────────────────────────────────────────────────

app.get(
    '/api/departments',
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT id, name, code, sort_order, active, business_unit_id, parent_dept_id
             FROM departments WHERE company_id = $1 AND active = TRUE ORDER BY sort_order, name`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

app.post(
    '/api/departments',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name, code, business_unit_id, parent_dept_id } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
        if (!code || !code.trim()) return res.status(400).json({ error: 'code is required' });
        if (name.trim().length > 100) return res.status(400).json({ error: 'name must be 100 characters or fewer' });
        const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
        if (cleanCode.length < 2) return res.status(400).json({ error: 'code must be at least 2 alphanumeric characters' });
        try {
            const result = await pool.query(
                `INSERT INTO departments (company_id, name, code, sort_order, business_unit_id, parent_dept_id)
                 VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order),0)+10 FROM departments WHERE company_id = $1), $4, $5)
                 RETURNING *`,
                [req.company.id, name.trim(), cleanCode, business_unit_id || null, parent_dept_id || null]
            );
            res.status(201).json(result.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ error: `Department code '${cleanCode}' already exists` });
            throw e;
        }
    })
);

app.patch(
    '/api/departments/:id',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name, business_unit_id, parent_dept_id } = req.body;
        const sets = [];
        const params = [];
        if (name !== undefined) {
            if (!name.trim()) return res.status(400).json({ error: 'name cannot be blank' });
            params.push(name.trim()); sets.push(`name = $${params.length}`);
        }
        if (business_unit_id !== undefined) {
            params.push(business_unit_id || null); sets.push(`business_unit_id = $${params.length}`);
        }
        if (parent_dept_id !== undefined) {
            params.push(parent_dept_id || null); sets.push(`parent_dept_id = $${params.length}`);
        }
        if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
        params.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE departments SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND company_id = $${params.length} RETURNING *`,
            params
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Department not found' });
        res.json(result.rows[0]);
    })
);

app.delete(
    '/api/departments/:id',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        // Check if the department is referenced by any active risks, users, or controls.
        const code = (await pool.query(
            'SELECT code FROM departments WHERE id = $1 AND company_id = $2',
            [req.params.id, req.company.id]
        )).rows[0]?.code;
        if (!code) return res.status(404).json({ error: 'Department not found' });

        const usage = await pool.query(
            `SELECT
               (SELECT COUNT(*) FROM risks   WHERE company_id = $1 AND UPPER(department) = UPPER($2)) AS risks,
               (SELECT COUNT(*) FROM user_companies WHERE company_id = $1 AND department = $2)        AS users`,
            [req.company.id, code]
        );
        const { risks, users } = usage.rows[0];
        if (parseInt(risks) > 0 || parseInt(users) > 0) {
            return res.status(409).json({
                error: `Cannot deactivate — department is assigned to ${risks} risk(s) and ${users} user(s). Reassign them first.`,
            });
        }

        await pool.query(
            `UPDATE departments SET active = FALSE WHERE id = $1 AND company_id = $2`,
            [req.params.id, req.company.id]
        );
        res.json({ ok: true });
    })
);

// ── Business Units (v2.0.0) ───────────────────────────────────────────────────
// Available only for BU Mode companies (has_business_units = true).
// Admin: full CRUD. All other roles: read-only (for filter dropdowns).

app.get(
    '/api/business-units',
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT id, name, code, created_at FROM business_units
             WHERE company_id = $1 ORDER BY name`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

app.post(
    '/api/business-units',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name, code } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
        if (!code || !code.trim()) return res.status(400).json({ error: 'code is required' });
        const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20);
        if (cleanCode.length < 2) return res.status(400).json({ error: 'code must be at least 2 alphanumeric characters' });
        try {
            const result = await pool.query(
                `INSERT INTO business_units (company_id, name, code) VALUES ($1, $2, $3) RETURNING *`,
                [req.company.id, name.trim(), cleanCode]
            );
            res.status(201).json(result.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ error: `BU code '${cleanCode}' already exists` });
            throw e;
        }
    })
);

app.patch(
    '/api/business-units/:id',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
        const result = await pool.query(
            `UPDATE business_units SET name = $1 WHERE id = $2 AND company_id = $3 RETURNING *`,
            [name.trim(), req.params.id, req.company.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Business Unit not found' });
        res.json(result.rows[0]);
    })
);

app.delete(
    '/api/business-units/:id',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const usage = await pool.query(
            `SELECT COUNT(*) AS cnt FROM departments
             WHERE business_unit_id = $1 AND company_id = $2 AND active = TRUE`,
            [req.params.id, req.company.id]
        );
        if (parseInt(usage.rows[0].cnt) > 0) {
            return res.status(409).json({
                error: 'Cannot delete — departments are assigned to this Business Unit. Reassign them first.',
            });
        }
        const result = await pool.query(
            `DELETE FROM business_units WHERE id = $1 AND company_id = $2 RETURNING id`,
            [req.params.id, req.company.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Business Unit not found' });
        res.json({ ok: true });
    })
);

// ============================================================
// Risk Register & Mitigation (B1) — /api/risks/*
// ============================================================
// The core module. Full role/scope table is in docs/API_REFERENCE.md
// under "Risk Register & Mitigation" — summary:
//   - Create: Risk Manager, Risk Champion, Risk Owner, CRO, Consultant CRO.
//   - Edit: Risk Champion is restricted to their OWN submissions (checked
//     against assessed_by, not department — see the PATCH /api/risks/:id
//     handler below). Risk Manager/Owner are department-scoped via
//     managerScopeClause()/managerCanAccess(). CRO/Consultant CRO/Admin
//     have full access.
//   - Approval workflow: Risk Champion submission -> Risk Owner first-line
//     approval -> Risk Manager -> CRO (where applicable). Admin/Super
//     Admin/CRO-created risks auto-approve.
//   - Versioning: edits currently overwrite the risk in place; the
//     version number only increments on Close/Reopen (a deliberate
//     G10-style simplification — see docs/SCOPE_NOTES.md).
//
// GET /api/departments/without-manager
// Returns the names of departments that have NO active Manager assigned.
// Used by the CRO Risk Register view to decide which risks the CRO should approve
// (only risks from unmanaged departments bubble up to the CRO).
app.get(
    '/api/departments/without-manager',
    requireRole('CRO', 'Consultant CRO', 'Admin'),
    asyncHandler(async (req, res) => {
        // Collect all department names/codes that have at least one active Manager.
        // A Manager is enterprise-wide only if they have NO dept restrictions AND NO BU restrictions.
        // BU-scoped managers (non-empty business_unit_ids) are NOT enterprise-wide.
        const enterpriseMgr = await pool.query(
            `SELECT 1 FROM user_companies uc
             JOIN users u ON u.id = uc.user_id
             WHERE uc.company_id = $1
               AND uc.role = 'Risk Manager'
               AND u.is_active = TRUE
               AND (uc.departments IS NULL OR uc.departments = '{}')
               AND (uc.business_unit_ids IS NULL OR uc.business_unit_ids = '{}')
             LIMIT 1`,
            [req.company.id]
        );
        // If there's a truly enterprise-wide Manager, they cover all departments —
        // no risk is "unmanaged" and the CRO should not see any in their queue.
        if (enterpriseMgr.rows.length > 0) {
            return res.json({ enterprise_manager_exists: true, unmanaged_departments: [] });
        }

        // Otherwise find which specific departments ARE covered by a Manager.
        // This includes both directly-assigned departments and departments that fall
        // under a BU-scoped Manager's assigned Business Units.
        const managedRes = await pool.query(
            `SELECT DISTINCT unnest(uc.departments) AS dept
             FROM user_companies uc
             JOIN users u ON u.id = uc.user_id
             WHERE uc.company_id = $1
               AND uc.role = 'Risk Manager'
               AND u.is_active = TRUE
               AND uc.departments IS NOT NULL
               AND uc.departments != '{}'
             UNION
             SELECT d.code AS dept
             FROM user_companies uc
             JOIN users u ON u.id = uc.user_id
             JOIN departments d ON d.company_id = $1
               AND d.business_unit_id = ANY(
                   -- Filter out any non-numeric legacy values (e.g. "CORP") before casting
                   ARRAY(SELECT x::int FROM unnest(uc.business_unit_ids) AS x WHERE x ~ '^\d+$')
               )
             WHERE uc.company_id = $1
               AND uc.role = 'Risk Manager'
               AND u.is_active = TRUE
               AND uc.business_unit_ids IS NOT NULL
               AND uc.business_unit_ids != '{}'`,
            [req.company.id]
        );
        const managedDepts = new Set(managedRes.rows.map((r) => r.dept.toLowerCase()));

        // Return all active department names that are NOT in the managed set.
        const allDepts = await pool.query(
            `SELECT name, code FROM departments WHERE company_id = $1 AND active = TRUE`,
            [req.company.id]
        );
        const unmanaged = allDepts.rows
            .filter((d) => !managedDepts.has(d.name.toLowerCase()) && !managedDepts.has(d.code.toLowerCase()))
            .map((d) => d.name);

        res.json({ enterprise_manager_exists: false, unmanaged_departments: unmanaged });
    })
);

// Preview the next available risk ID for a given department code (no side effects).
app.get(
    '/api/risks/next-id',
    can('risk.create'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'); resolved 2026-07-22 -- Chandrashekar confirmed Risk Owner should gain access here, matching POST /api/risks (create) and the risk.create seed
    asyncHandler(async (req, res) => {
        const deptParam = req.query.department || 'GEN';
        const client = await pool.connect();
        try {
            const nextId = await generateUniqueRiskID(client, req.company.id, deptParam);
            res.json({ next_id: nextId });
        } finally {
            client.release();
        }
    })
);

// ─────────────────────────────────────────────────────────────────────────────

app.get(
    '/api/risks',
    can('risk.view'), // Phase C cutover -- was ungated (open to any authenticated session); risk.view is granted to all 8 roles (dept or full) in the seed, so this never actually blocks anyone -- makes the authorization explicit rather than accidental
    asyncHandler(async (req, res) => {
        const { role, department } = req.company;

        // Viewers have read-only access to the risk register (Role Access Matrix v2.4.0)
        // Closed risks (see POST /api/risks/:id/close) are hidden from
        // the working register by default -- pass ?include_closed=true to
        // see them (e.g. for a historical/audit view). "Closed" is
        // determined by the LATEST version of a risk_uid, so the full
        // version history of a now-closed risk stays available when
        // requested, rather than disappearing version-by-version.
        const includeClosed = req.query.include_closed === 'true';
        // Exclude any risk_uid whose latest version is Closed, unless include_closed.
        const closedClause = includeClosed
            ? ''
            : `AND risk_uid NOT IN (
                 SELECT risk_uid FROM risks r3 WHERE r3.company_id = risks.company_id AND r3.risk_status = 'Closed'
                   AND r3.version = (SELECT MAX(version) FROM risks r4 WHERE r4.company_id = r3.company_id AND r4.risk_uid = r3.risk_uid)
               )`;

        // Only show the latest version of each risk_uid.
        const latestVersionClause = `AND version = (SELECT MAX(version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)`;

        let result;
        const mgrDepts = getManagerDepts(req);
        if (DEPT_SCOPED_ROLES.includes(role) && mgrDepts.length > 0) {
            // Risk Champion, Approver, Manager: show only their department(s).
            // Resolves code↔name mismatches (e.g. user stored as 'FIN', risk stored as 'Finance').
            result = await pool.query(
                `SELECT * FROM risks WHERE company_id = $1
                  AND (lower(department) = ANY($2::text[])
                       OR lower(department) IN (SELECT lower(name) FROM departments WHERE company_id = $1 AND lower(code) = ANY($2::text[]))
                       OR lower(department) IN (SELECT lower(code) FROM departments WHERE company_id = $1 AND lower(name) = ANY($2::text[]))
                       OR department IS NULL)
                  ${latestVersionClause} ${closedClause} ORDER BY id`,
                [req.company.id, mgrDepts]
            );
        } else {
            result = await pool.query(`SELECT * FROM risks WHERE company_id = $1 ${latestVersionClause} ${closedClause} ORDER BY id`, [req.company.id]);
        }

        res.json(await attachControlsAndMitigations(result.rows));
    })
);

// ─── CRO Workflow Endpoints ─────────────────────────────────────────────────
// The CSO role has been replaced by CRO (Chief Risk Officer).
// CRO has company-wide approval authority and handles "Accept" treatment risks.

// GET /api/risks/pending-cro — returns all risks awaiting CRO acceptance.
// Accessible to Admin (oversight) and CRO (action).
app.get(
    '/api/risks/pending-cro',
    can('risk.cro_accept'), // Phase C cutover -- was requireRole('Admin', 'CRO') (Consultant CRO already passed via the CRO auto-expand rule)
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT * FROM risks
             WHERE company_id = $1
               AND cro_acceptance_status = 'pending_cro'
               AND approval_status = 'Approved'
             ORDER BY id`,
            [req.company.id]
        );
        res.json(await attachControlsAndMitigations(result.rows));
    })
);

// POST /api/risks/:id/cro-accept — CRO formally accepts the risk treatment.
// Records the CRO user, timestamp, optional notes, and sets status = 'accepted'.
app.post(
    '/api/risks/:id/cro-accept',
    can('risk.cro_accept'), // Phase C cutover -- was requireRole('CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const notes = req.body.notes || null;

        const risk = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (risk.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });
        if (risk.rows[0].cro_acceptance_status !== 'pending_cro') {
            return res.status(400).json({ error: 'Risk is not pending CRO acceptance' });
        }

        const updated = await pool.query(
            `UPDATE risks
             SET cro_acceptance_status = 'accepted',
                 cro_user_id           = $1,
                 cro_actioned_at       = NOW(),
                 cro_notes             = $2
             WHERE id = $3 AND company_id = $4
             RETURNING *`,
            [req.user.id, notes, riskId, req.company.id]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'cro_accepted',
            actor: req.user,
            detail: notes ? `Notes: ${notes}` : 'No notes provided',
        });

        res.json(updated.rows[0]);
    })
);

// POST /api/risks/:id/cro-decline — CRO sends the risk back to the Approver.
// Reverts cro_acceptance_status to null so the Approver can reconsider.
app.post(
    '/api/risks/:id/cro-decline',
    can('risk.cro_decline'), // Phase C cutover -- was requireRole('CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const reason = req.body.reason || null;

        const risk = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (risk.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });
        const r = risk.rows[0];
        if (r.cro_acceptance_status !== 'pending_cro') {
            return res.status(400).json({ error: 'Risk is not pending CRO acceptance' });
        }
        // W-01: only allow decline when the risk has been Manager-approved.
        // Without this guard, a PATCH that sets cro_acceptance_status='pending_cro'
        // on a Draft/Awaiting risk would let CRO decline skip the approval chain.
        if (r.approval_status !== 'Approved') {
            return res.status(400).json({ error: 'Risk must be Manager-approved before CRO can decline it.' });
        }

        const updated = await pool.query(
            `UPDATE risks
             SET cro_acceptance_status = null,
                 cro_user_id           = null,
                 cro_actioned_at       = null,
                 cro_notes             = $1,
                 approval_status       = 'Awaiting Approval'
             WHERE id = $2 AND company_id = $3
             RETURNING *`,
            [reason, riskId, req.company.id]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'cro_declined',
            actor: req.user,
            detail: reason ? `Reason: ${reason}` : 'No reason provided',
        });

        res.json(updated.rows[0]);
    })
);

// POST /api/risks/:id/cro-comment — CRO adds a note but does NOT accept.
// Risk stays in 'pending_cro'; the comment is appended to cro_notes.
app.post(
    '/api/risks/:id/cro-comment',
    can('risk.cro_accept'), // Phase C cutover -- was requireRole('CRO', 'Consultant CRO'); no dedicated cro_comment capability was seeded, reusing risk.cro_accept since its role/scope shape is identical (Admin/Super Admin/CRO/Consultant CRO = full, everyone else none)
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const { comment } = req.body;
        if (!comment) return res.status(400).json({ error: 'comment is required' });

        const risk = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (risk.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });

        const existing = risk.rows[0].cro_notes || '';
        const timestamp = new Date().toISOString();
        const appended = existing
            ? `${existing}\n\n[${timestamp}] ${req.user.email}: ${comment}`
            : `[${timestamp}] ${req.user.email}: ${comment}`;

        const updated = await pool.query(
            `UPDATE risks
             SET cro_notes = $1
             WHERE id = $2 AND company_id = $3
             RETURNING *`,
            [appended, riskId, req.company.id]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'cro_commented',
            actor: req.user,
            detail: comment,
        });

        res.json(updated.rows[0]);
    })
);

// ─────────────────────────────────────────────────────────────────────────────

app.post(
    '/api/risks',
    can('risk.create'), // Phase C cutover -- was requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO')
    validate(schemas.createRisk),
    asyncHandler(async (req, res) => {
        // Determine initial workflow status:
        // - CRO / Consultant CRO creating a risk self-approve immediately (they are the top approver).
        // - Risk Champions route to 'Awaiting Approver' if the company has active Approver
        //   users assigned to the same department; otherwise go straight to Manager.
        // - Manager, Risk Owner, Approver go directly to 'Awaiting Approval'.
        // - save_as_draft: true → always save as 'Draft' regardless of role (no workflow triggered).
        const saveAsDraft = req.body.save_as_draft === true;
        let initialStatus = 'Awaiting Approval';
        if (saveAsDraft) {
            initialStatus = 'Draft';
        } else if (req.company.role === 'CRO' || req.company.role === 'Consultant CRO' || req.company.role === 'Super Admin' || req.company.functional_role === 'Super Admin') {
            // Bug fix (2026-07-22): the live admin account has user_companies.role
            // literally 'Super Admin' (not 'Admin' + functional_role='Super Admin' —
            // that convention only applies via the is_super_admin bypass path). This
            // check used to only test functional_role, so that account's own risks
            // never auto-approved. Same bug class as POLICY_TRANSITIONS/canSeeDrafts
            // below — added the direct role check to match.
            initialStatus = 'Approved';
        }

        // Risk Champions may only create risks for their own assigned department(s).
        if (req.company.role === 'Risk Champion') {
            const submittedDept = (req.body.department || '').toLowerCase();
            const userDepts = Array.isArray(req.company.departments) && req.company.departments.length > 0
                ? req.company.departments.map(d => d.toLowerCase())
                : req.company.department ? [req.company.department.toLowerCase()] : [];
            if (userDepts.length > 0 && !userDepts.includes(submittedDept)) {
                return res.status(403).json({ error: 'You can only submit risks for your assigned department.' });
            }
        }

        if (!saveAsDraft) {
            const scoreFields = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'];
            for (const f of scoreFields) {
                const v = parseInt(req.body[f], 10);
                if (req.body[f] != null && (isNaN(v) || v < 1 || v > 5)) {
                    return res.status(400).json({ error: `${f} must be an integer between 1 and 5` });
                }
            }

            // B1: "Accept" and "Avoid" treatments require a documented rationale.
            const treatmentStrategy = req.body.treatment_strategy || 'Mitigate / Treat';
            if (treatmentStrategy === 'Accept' || treatmentStrategy === 'Avoid') {
                if (!req.body.treatment_plan_rationale) {
                    return res.status(400).json({
                        error: `"${treatmentStrategy}" treatment requires a treatment plan rationale.`,
                    });
                }
            }
        }

        const currentResL = parseInt(req.body.residual_likelihood, 10) || 5;
        const currentResI = parseInt(req.body.residual_impact, 10) || 5;
        const currentResScore = currentResL * currentResI;

        const treatmentStrategy = req.body.treatment_strategy || 'Mitigate / Treat';

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // D-01: Validate submitted department exists in the departments table.
            if (req.body.department) {
                const deptCheck = await client.query(
                    `SELECT 1 FROM departments WHERE company_id = $1 AND (UPPER(code) = UPPER($2) OR LOWER(name) = LOWER($2))`,
                    [req.company.id, req.body.department]
                );
                if (!deptCheck.rows.length) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Department "${req.body.department}" not found. Please select a valid department.` });
                }
            }

            let targetUid = req.body.risk_uid;
            let targetVersion = 1;
            let calculatedTrend = 'STABLE';

            if (targetUid && targetUid !== 'null' && targetUid !== 'undefined') {
                targetUid = targetUid.trim();
                const parentRes = await client.query(
                    'SELECT * FROM risks WHERE company_id = $1 AND risk_uid = $2 ORDER BY version DESC LIMIT 1',
                    [req.company.id, targetUid]
                );
                if (parentRes.rows.length > 0) {
                    const parent = parentRes.rows[0];
                    targetVersion = parent.version + 1;

                    const parentScore = parent.residual_likelihood * parent.residual_impact;
                    if (currentResScore < parentScore) calculatedTrend = 'DECREASED';
                    else if (currentResScore > parentScore) calculatedTrend = 'INCREASED';
                    else calculatedTrend = 'STABLE';
                }
            } else {
                targetUid = await generateUniqueRiskID(client, req.company.id, req.body.department);
            }

            const matrixRes = await client.query('SELECT fiscal_year_start_month FROM matrix_settings WHERE company_id = $1', [
                req.company.id,
            ]);
            const startMonth = matrixRes.rows[0]?.fiscal_year_start_month || 0;
            const now = new Date();
            let monthsSinceStart = now.getMonth() - startMonth;
            if (monthsSinceStart < 0) monthsSinceStart += 12;
            const quarterIndex = Math.floor(monthsSinceStart / 3) + 1;
            const reportingQuarter = `Q${quarterIndex}-FY${now.getFullYear()}`;

            const VELOCITIES = ['Immediate (<1 month)', 'Short-term (1-6 months)', 'Medium-term (6-12 months)', 'Long-term (>12 months)'];
            const riskVelocity = VELOCITIES.includes(req.body.risk_velocity) ? req.body.risk_velocity : null;
            const toleranceScore = req.body.tolerance_threshold_score !== undefined && req.body.tolerance_threshold_score !== null && req.body.tolerance_threshold_score !== ''
                ? Math.min(25, Math.max(1, parseInt(req.body.tolerance_threshold_score, 10)))
                : null;

            // Route Risk Champion-created risks to Approver queue if an active Approver
            // is assigned to this department (or, if a sub-dept, its parent dept).
            if (req.company.role === 'Risk Champion') {
                const riskDept = req.body.department;
                let approverCheck = await client.query(
                    `SELECT 1 FROM user_companies uc
                     JOIN users u ON u.id = uc.user_id
                     WHERE uc.company_id = $1
                       AND uc.role = 'Risk Owner'
                       AND u.is_active = TRUE
                       AND (
                           uc.departments IS NULL OR uc.departments = '{}'
                           OR $2::text IS NULL
                           OR lower($2::text) = ANY(SELECT lower(d) FROM unnest(uc.departments) d)
                           OR lower(uc.department) = lower($2::text)
                       )
                     LIMIT 1`,
                    [req.company.id, riskDept]
                );
                // Cascade: if no Approver at immediate dept level, check parent dept
                // (covers sub-department scenario in Simple Mode).
                if (approverCheck.rows.length === 0 && riskDept) {
                    const parentRes = await client.query(
                        `SELECT pd.code AS parent_code
                         FROM departments d
                         JOIN departments pd ON pd.id = d.parent_dept_id
                         WHERE d.company_id = $1
                           AND (UPPER(d.code) = UPPER($2) OR LOWER(d.name) = LOWER($2))
                         LIMIT 1`,
                        [req.company.id, riskDept]
                    );
                    if (parentRes.rows.length > 0) {
                        const parentCode = parentRes.rows[0].parent_code;
                        approverCheck = await client.query(
                            `SELECT 1 FROM user_companies uc
                             JOIN users u ON u.id = uc.user_id
                             WHERE uc.company_id = $1
                               AND uc.role = 'Risk Owner'
                               AND u.is_active = TRUE
                               AND (
                                   lower($2::text) = ANY(SELECT lower(d) FROM unnest(uc.departments) d)
                                   OR lower(uc.department) = lower($2::text)
                               )
                             LIMIT 1`,
                            [req.company.id, parentCode]
                        );
                    }
                }
                if (approverCheck.rows.length > 0 && !saveAsDraft) {
                    initialStatus = 'Awaiting Approver';
                }
            }

            const inherentLikelihood = parseInt(req.body.inherent_likelihood, 10) || 3;
            const inherentImpact     = parseInt(req.body.inherent_impact, 10) || 5;

            const insertRes = await client.query(
                `INSERT INTO risks (
                    company_id, risk_uid, version, reporting_quarter, department, risk_category, sub_category,
                    risk_detail, risk_cause, risk_consequence, risk_owner, risk_consulted, risk_informed, treatment_strategy,
                    inherent_likelihood, inherent_impact, residual_likelihood, residual_impact,
                    tolerance_threshold, treatment_plan_rationale, accept_approved_by,
                    review_frequency, next_review_date, framework_reference,
                    approval_status, assessed_by, change_reason, directional_trend,
                    last_evaluated_timestamp, escalation_justification,
                    tolerance_threshold_score, risk_velocity, cro_acceptance_status,
                    bcp_status, bcp_link, is_critical, risk_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
                RETURNING *`,
                [
                    req.company.id,
                    targetUid,
                    targetVersion,
                    reportingQuarter,
                    req.body.department,
                    req.body.risk_category || 'Operational Risk',
                    req.body.sub_category || 'Process Risk',
                    req.body.risk_detail,
                    req.body.risk_cause || null,
                    req.body.risk_consequence || null,
                    req.body.risk_owner || null,
                    req.body.risk_consulted || null,
                    req.body.risk_informed || null,
                    treatmentStrategy,
                    inherentLikelihood,
                    inherentImpact,
                    currentResL,
                    currentResI,
                    req.body.tolerance_threshold || null,
                    req.body.treatment_plan_rationale || null,
                    null, // accept_approved_by deprecated — CRO workflow handles acceptance
                    req.body.review_frequency || 'Annual',
                    req.body.next_review_date || null,
                    req.body.framework_reference || null,
                    initialStatus,
                    req.user.email,
                    req.body.change_reason || (targetVersion === 1 ? 'Baseline Entry Ingestion' : 'Interim Shift Assessment Update'),
                    calculatedTrend,
                    Date.now(),
                    req.body.escalation_justification || '',
                    toleranceScore,
                    riskVelocity,
                    // Accept and Avoid are CRO-level decisions; route both to CRO inbox.
                    ['Accept', 'Avoid'].includes(treatmentStrategy) ? 'pending_cro' : null,
                    req.body.bcp_status || null,
                    req.body.bcp_link   || null,
                    req.body.is_critical === true || req.body.is_critical === 'true' ? true : false,
                    'Active', // risk_status always starts Active
                ]
            );

            const newRisk = insertRes.rows[0];

            // New controls created inline go straight into the Control
            // Library (B2), linked to this risk via risk_controls.
            const newControls = req.body.controls || [];
            for (const c of newControls) {
                if (!c.title) continue;
                const uid = await generateUniqueControlID(client, req.company.id, req.body.department);
                const insertControl = await client.query(
                    `INSERT INTO controls_lib (company_id, control_uid, name, control_type, automation, testing_frequency, department, owner, last_test_result)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                    [
                        req.company.id,
                        uid,
                        c.title,
                        c.control_type || 'Preventive',
                        c.automation || 'Manual',
                        c.testing_frequency || 'Quarterly',
                        req.body.department || null,
                        c.owner?.trim() || null,
                        ['Effective', 'Partially Effective', 'Ineffective'].includes(c.effectiveness) ? c.effectiveness : 'Not Tested',
                    ]
                );
                await client.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2)', [newRisk.id, insertControl.rows[0].id]);
            }

            // Link existing Control Library entries and KRIs.
            for (const controlId of req.body.link_control_ids || []) {
                await client.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                    newRisk.id,
                    controlId,
                ]);
            }
            for (const kriId of req.body.link_kri_ids || []) {
                await client.query('INSERT INTO risk_kris (risk_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [newRisk.id, kriId]);
            }

            const mitigations = req.body.mitigations || [];
            for (const m of mitigations) {
                const st = m.status || 'Pending';
                // D-02: compensatory_controls_in_place is required when status is Deferred.
                if (st === 'Deferred' && !['Yes', 'No'].includes(m.compensatory_controls_in_place)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'compensatory_controls_in_place (Yes/No) is required for each Deferred MAP.' });
                }
                const compCtrl = st === 'Deferred' ? m.compensatory_controls_in_place : null;
                const mapUid = await generateMitigationUID(client, req.company.id);
                await client.query(
                    `INSERT INTO mitigations (risk_id, mitigation_uid, action, action_owner, root_cause, start_date, end_date, status, compensatory_controls_in_place, company_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [newRisk.id, mapUid, m.action, m.action_owner || null, m.root_cause || null, m.start_date || null, m.end_date || null, st, compCtrl, req.company.id]
                );
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'risk',
                entityId: newRisk.id,
                action: 'create',
                actor: req.user,
                details: { risk_uid: targetUid, version: targetVersion, approval_status: initialStatus },
            });

            await client.query('COMMIT');

            // Recalculate category-level appetite breach flag for this risk's category
            if (newRisk.risk_category) {
                recalcAppetiteCategoryBreaches(req.company.id, newRisk.risk_category).catch(() => {});
            }

            const [enriched] = await attachControlsAndMitigations([newRisk]);
            res.status(201).json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// ── MAP CRUD endpoints (ENH-14) ──────────────────────────────────────────────

const MAP_ROLES = ['Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO'];
const VALID_MAP_STATUSES = ['Pending', 'In Progress', 'Complete', 'Deferred', 'Cancelled'];

// POST /api/risks/:id/mitigations — add a MAP to an existing risk
app.post(
    '/api/risks/:id/mitigations',
    can('risk.mitigation.manage'), // Phase C cutover -- was requireRole(...MAP_ROLES)
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });

        const { action, action_owner, root_cause, start_date, end_date, status, compensatory_controls_in_place } = req.body;
        if (!action || !action.trim()) return res.status(400).json({ error: 'action is required' });
        const st = status || 'Pending';
        if (!VALID_MAP_STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status' });
        // W-05: compensatory_controls_in_place is required when deferring a MAP.
        if (st === 'Deferred' && !['Yes', 'No'].includes(compensatory_controls_in_place)) {
            return res.status(400).json({ error: 'compensatory_controls_in_place (Yes/No) is required when status is Deferred.' });
        }
        const compCtrl = st === 'Deferred' ? compensatory_controls_in_place : null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const mapUid = await generateMitigationUID(client, req.company.id);
            const ins = await client.query(
                `INSERT INTO mitigations (risk_id, mitigation_uid, action, action_owner, root_cause, start_date, end_date, status, compensatory_controls_in_place, company_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                [riskId, mapUid, action.trim(), action_owner || null, root_cause || null, start_date || null, end_date || null, st, compCtrl, req.company.id]
            );
            const newMap = ins.rows[0];
            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'mitigation',
                entityId: newMap.id,
                action: 'map_create',
                actor: req.user,
                details: { mitigation_uid: mapUid, risk_id: riskId, status: st },
            });
            await client.query('COMMIT');
            res.status(201).json({
                ...newMap,
                compensatory_controls_in_place: newMap.compensatory_controls_in_place,
            });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// PUT /api/mitigations/:id — edit a MAP
app.put(
    '/api/mitigations/:id',
    can('risk.mitigation.manage'), // Phase C cutover -- was requireRole(...MAP_ROLES)
    asyncHandler(async (req, res) => {
        const mapId = parseInt(req.params.id, 10);
        // Verify the MAP belongs to this company
        const mapRes = await pool.query(
            `SELECT m.*, r.company_id FROM mitigations m
             JOIN risks r ON r.id = m.risk_id
             WHERE m.id = $1 AND r.company_id = $2`,
            [mapId, req.company.id]
        );
        if (mapRes.rows.length === 0) return res.status(404).json({ error: 'MAP not found' });
        const existing = mapRes.rows[0];

        const { action, action_owner, root_cause, start_date, end_date, status, compensatory_controls_in_place } = req.body;
        const st = status || existing.status;
        if (!VALID_MAP_STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status' });
        // W-05: when setting status to Deferred, compensatory_controls_in_place is required.
        // Allow omitting it only if the status stays Deferred and we fall back to the existing value.
        const resolvedCompCtrl = compensatory_controls_in_place !== undefined
            ? compensatory_controls_in_place
            : existing.compensatory_controls_in_place;
        if (st === 'Deferred' && !['Yes', 'No'].includes(resolvedCompCtrl)) {
            return res.status(400).json({ error: 'compensatory_controls_in_place (Yes/No) is required when status is Deferred.' });
        }
        const compCtrl = st === 'Deferred' ? resolvedCompCtrl : null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const upd = await client.query(
                `UPDATE mitigations
                 SET action = $1, action_owner = $2, root_cause = $3,
                     start_date = $4, end_date = $5, status = $6,
                     compensatory_controls_in_place = $7
                 WHERE id = $8 RETURNING *`,
                [
                    action !== undefined ? action : existing.action,
                    action_owner !== undefined ? action_owner : existing.action_owner,
                    root_cause !== undefined ? root_cause : existing.root_cause,
                    start_date !== undefined ? (start_date || null) : existing.start_date,
                    end_date !== undefined ? (end_date || null) : existing.end_date,
                    st,
                    compCtrl,
                    mapId,
                ]
            );
            const updated = upd.rows[0];
            // Audit log — always log edits; add extra detail when Deferred
            const auditDetails = { mitigation_uid: existing.mitigation_uid, status: st };
            if (st === 'Deferred' && existing.status !== 'Deferred') {
                auditDetails.deferred = true;
                auditDetails.compensatory_controls_in_place = compCtrl;
            }
            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'mitigation',
                entityId: mapId,
                action: 'map_update',
                actor: req.user,
                details: auditDetails,
            });
            await client.query('COMMIT');
            res.json({ ...updated });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// DELETE /api/mitigations/:id — remove a MAP
app.delete(
    '/api/mitigations/:id',
    can('risk.mitigation.manage'), // Phase C cutover -- was requireRole(...MAP_ROLES)
    asyncHandler(async (req, res) => {
        const mapId = parseInt(req.params.id, 10);
        const mapRes = await pool.query(
            `SELECT m.*, r.company_id FROM mitigations m
             JOIN risks r ON r.id = m.risk_id
             WHERE m.id = $1 AND r.company_id = $2`,
            [mapId, req.company.id]
        );
        if (mapRes.rows.length === 0) return res.status(404).json({ error: 'MAP not found' });
        const existing = mapRes.rows[0];

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM mitigations WHERE id = $1', [mapId]);
            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'mitigation',
                entityId: mapId,
                action: 'map_delete',
                actor: req.user,
                details: { mitigation_uid: existing.mitigation_uid, risk_id: existing.risk_id },
            });
            await client.query('COMMIT');
            res.json({ ok: true });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// ─────────────────────────────────────────────────────────────────────────────

app.post(
    '/api/risks/:id/approve',
    can('risk.approve_manager'), // Phase C cutover -- was requireRole('Risk Manager', 'CRO', 'Consultant CRO'); not scope-aware, so the Risk Manager department check below stays a role-literal check
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);

        // Fetch risk first so we can enforce dept scoping and detect self-approval.
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const risk = riskRes.rows[0];

        if (req.company.role === 'Risk Manager') {
            // Enterprise-wide risks (no department) must be approved by CRO.
            if (!risk.department) {
                return res.status(403).json({
                    error: 'Enterprise-wide risks (no department) must be approved by the CRO.',
                });
            }
            // Manager may only approve risks within their own department(s).
            if (!await managerCanAccess(req, risk.department)) {
                return res.status(403).json({
                    error: 'Managers can only approve risks in their own department(s).',
                });
            }
        }
        // CRO: no department restriction — may approve any risk.

        // Detect self-approval (submitter == approver). Always allowed but
        // flagged in the audit log for governance transparency.
        const isSelfApproval = (risk.assessed_by === req.user.email);

        // Re-route Accept/Avoid risks to CRO acceptance queue on approval.
        const needsCro = ['Accept', 'Avoid'].includes(risk.treatment_strategy);
        const result = await pool.query(
            `UPDATE risks
             SET approval_status         = 'Approved',
                 last_evaluated_timestamp = $1,
                 cro_acceptance_status    = $2,
                 risk_status             = CASE WHEN risk_status = 'Re-opened' THEN 'Active' ELSE risk_status END
             WHERE id = $3 AND company_id = $4 AND approval_status = 'Awaiting Approval' RETURNING *`,
            [Date.now(), needsCro ? 'pending_cro' : null, riskId, req.company.id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: 'Risk is not in Awaiting Approval status' });
        }

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: result.rows[0].id,
            action: 'approve',
            actor: req.user,
            details: isSelfApproval
                ? { self_approved: true, note: 'Approver is the same user who submitted the risk.' }
                : {},
        });

        const [enriched] = await attachControlsAndMitigations(result.rows);
        res.json({ ...enriched, self_approved: isSelfApproval });
    })
);

// Columns carried forward when cloning a risk into a new version (all
// except id/created_at, which are auto-generated, and version/risk_status/
// closure_reason/change_reason/last_evaluated_timestamp, which the caller
// sets explicitly).
const RISK_CLONE_COLUMNS = [
    'company_id', 'risk_uid', 'reporting_quarter', 'department', 'risk_category', 'sub_category',
    'risk_detail', 'risk_cause', 'risk_consequence', 'risk_owner', 'risk_consulted', 'risk_informed',
    'treatment_strategy', 'inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact',
    'tolerance_threshold', 'tolerance_threshold_score', 'treatment_plan_rationale', 'accept_approved_by',
    'review_frequency', 'next_review_date', 'framework_reference', 'risk_velocity',
    'approval_status', 'assessed_by', 'directional_trend', 'escalation_justification',
    'bcp_status', 'bcp_link',
];

// Risk Register lifecycle (G10-style versioning applied to closure): a
// risk is never deleted. "Closing" or "reopening" inserts a new version
// that's identical to the latest one except for risk_status,
// closure_reason, and change_reason -- the full history stays intact and
// auditable.
async function cloneRiskAsNewVersion(client, latest, overrides, actorEmail) {
    const cols = [...RISK_CLONE_COLUMNS, 'version', 'risk_status', 'closure_reason', 'reopen_reason', 'change_reason', 'last_evaluated_timestamp'];
    const values = RISK_CLONE_COLUMNS.map((c) => latest[c]);
    values.push(latest.version + 1, overrides.risk_status, overrides.closure_reason ?? null, overrides.reopen_reason ?? null, overrides.change_reason, Date.now());

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const insertRes = await client.query(
        `INSERT INTO risks (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
    );
    return insertRes.rows[0];
}


// ── Approver Workflow Endpoints ────────────────────────────────────────────────
// Approver is an optional first-line reviewer between Risk Champion and Manager.
// These endpoints move a risk out of (or back to) 'Awaiting Approver' status.

// POST /api/risks/:id/approver-approve — Approver forwards risk to Manager queue.
app.post(
    '/api/risks/:id/approver-approve',
    can('risk.approve_first_line'), // Phase C cutover -- was requireRole('Risk Owner')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const risk = riskRes.rows[0];

        if (risk.approval_status !== 'Awaiting Approver') {
            return res.status(400).json({ error: `Risk is not awaiting Approver review (current status: ${risk.approval_status})` });
        }
        if (!await managerCanAccess(req, risk.department)) {
            return res.status(403).json({ error: 'This risk is outside your department scope.' });
        }

        const note = req.body.note || null;
        await pool.query(
            `UPDATE risks SET approval_status = 'Awaiting Approval', approver_email = $1, approved_at_approver = NOW()
               WHERE id = $2`,
            [req.user.email, riskId]
        );
        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'approver_approved',
            actor: req.user,
            meta: { from: 'Awaiting Approver', to: 'Awaiting Approval', note },
        });
        const updated = await pool.query('SELECT * FROM risks WHERE id = $1', [riskId]);
        res.json(updated.rows[0]);
    })
);

// POST /api/risks/:id/approver-reject — Approver sends risk back to Risk Champion (Draft).
app.post(
    '/api/risks/:id/approver-reject',
    can('risk.approve_first_line'), // Phase C cutover -- was requireRole('Risk Owner')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const risk = riskRes.rows[0];

        if (risk.approval_status !== 'Awaiting Approver') {
            return res.status(400).json({ error: `Risk is not awaiting Approver review (current status: ${risk.approval_status})` });
        }
        if (!await managerCanAccess(req, risk.department)) {
            return res.status(403).json({ error: 'This risk is outside your department scope.' });
        }

        const reason = req.body.reason || null;
        await pool.query(
            `UPDATE risks SET approval_status = 'Draft', approver_email = NULL, approved_at_approver = NULL
               WHERE id = $1`,
            [riskId]
        );
        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'approver_rejected',
            actor: req.user,
            meta: { from: 'Awaiting Approver', to: 'Draft', reason },
        });
        const updated = await pool.query('SELECT * FROM risks WHERE id = $1', [riskId]);
        res.json(updated.rows[0]);
    })
);

// POST /api/risks/:id/manager-reject — Manager/CRO sends risk back to Risk Champion (Draft).
app.post(
    '/api/risks/:id/manager-reject',
    can('risk.reject'), // Phase C cutover -- was requireRole('Risk Manager', 'Admin', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const risk = riskRes.rows[0];

        if (risk.approval_status !== 'Awaiting Approval') {
            return res.status(400).json({ error: `Risk is not awaiting Manager approval (current status: ${risk.approval_status})` });
        }
        if (!await managerCanAccess(req, risk.department)) {
            return res.status(403).json({ error: 'This risk is outside your department scope.' });
        }

        const reason = req.body.reason || null;
        await pool.query(
            `UPDATE risks SET approval_status = 'Draft' WHERE id = $1`,
            [riskId]
        );
        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'manager_rejected',
            actor: req.user,
            meta: { from: 'Awaiting Approval', to: 'Draft', reason },
        });
        const updated = await pool.query('SELECT * FROM risks WHERE id = $1', [riskId]);
        res.json(updated.rows[0]);
    })
);

app.post(
    '/api/risks/:id/close',
    can('risk.close'), // Phase C cutover -- was requireRole('Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        if (!req.body.closure_reason || !req.body.closure_reason.trim()) {
            return res.status(400).json({ error: 'closure_reason is required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query('SELECT * FROM risks WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Not found' });
            }
            const latest = await client.query(
                'SELECT * FROM risks WHERE company_id = $1 AND risk_uid = $2 ORDER BY version DESC LIMIT 1',
                [req.company.id, current.rows[0].risk_uid]
            );
            const row = latest.rows[0];
            if (!await managerCanAccess(req, row.department)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This risk belongs to a different department.' });
            }
            if (row.risk_status === 'Closed') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This risk is already closed.' });
            }

            const closed = await cloneRiskAsNewVersion(
                client,
                row,
                { risk_status: 'Closed', closure_reason: req.body.closure_reason.trim(), reopen_reason: null, change_reason: `Closed: ${req.body.closure_reason.trim()}` },
                req.user.email
            );

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'risk',
                entityId: closed.id,
                action: 'close',
                actor: req.user,
                details: { risk_uid: row.risk_uid, version: closed.version, closure_reason: req.body.closure_reason.trim() },
            });

            await client.query('COMMIT');
            const [enriched] = await attachControlsAndMitigations([closed]);
            res.json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.post(
    '/api/risks/:id/reopen',
    can('risk.reopen'), // Phase C cutover -- was requireRole('Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        if (!req.body.reopen_reason || !req.body.reopen_reason.trim()) {
            return res.status(400).json({ error: 'reopen_reason is required' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query('SELECT * FROM risks WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Not found' });
            }
            const latest = await client.query(
                'SELECT * FROM risks WHERE company_id = $1 AND risk_uid = $2 ORDER BY version DESC LIMIT 1',
                [req.company.id, current.rows[0].risk_uid]
            );
            const row = latest.rows[0];
            if (!await managerCanAccess(req, row.department)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This risk belongs to a different department.' });
            }
            if (row.risk_status !== 'Closed') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'This risk is not closed.' });
            }

            // Bug fix (2026-07-22): risk_status has a DB CHECK constraint
            // (risks_risk_status_check, schema_v9) allowing only 'Active' or
            // 'Closed' -- 'Re-opened' has never been a valid value, so every
            // reopen attempt hit a constraint violation -> 500. The
            // reopen_reason column already exists specifically to preserve the
            // "this was reopened" signal for display, so this uses 'Active'
            // (matching the CHECK constraint and this test's own long-standing
            // expectation) instead of adding a new schema value.
            const reason = req.body.reopen_reason.trim();
            const reopened = await cloneRiskAsNewVersion(
                client,
                row,
                { risk_status: 'Active', closure_reason: null, reopen_reason: reason, change_reason: `Re-opened: ${reason}` },
                req.user.email
            );

            // Reset approval_status to Awaiting Approval — the risk needs re-review
            await client.query(
                `UPDATE risks SET approval_status = 'Awaiting Approval' WHERE id = $1`,
                [reopened.id]
            );
            reopened.approval_status = 'Awaiting Approval';

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'risk',
                entityId: reopened.id,
                action: 'reopen',
                actor: req.user,
                details: { risk_uid: row.risk_uid, version: reopened.version, reopen_reason: reason },
            });

            await client.query('COMMIT');
            const [enriched] = await attachControlsAndMitigations([reopened]);
            res.json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);


// ── GET /api/risks/:id — Fetch a single risk (read-only) ────────────────────
app.get(
    '/api/risks/:id',
    can('risk.view'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer') (i.e. all 8 roles)
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const result = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });
        res.json(result.rows[0]);
    })
);

// ── PATCH /api/risks/:id — Edit a risk ──────────────────────────────────────
//
// Authority (risk.edit capability, driven by req.scope as of Phase C):
//   Risk Champion         → own submissions only (assessed_by === req.user.email) -- scope 'own'
//   Risk Manager/Risk Owner → any risk in their dept(s) -- scope 'dept'
//   CRO/Consultant CRO/Admin/Super Admin → any risk, company-wide -- scope 'full'
//   Viewer                → blocked (403, no risk.edit capability at all)
// Note: the comment here previously said "Admin → blocked (403)", which never
// actually matched runtime behaviour -- requireRole()'s hardcoded Admin/Super
// Admin bypass always let them through regardless of the route's own role
// list. risk.edit is seeded 'full' for Admin/Super Admin specifically to
// preserve that real, pre-existing behaviour, not to change it.
//
// Status reset: if the risk's current approval_status is 'Approved', any edit
// automatically resets it back to 'Awaiting Approval'.
//
// Treatment routing: if treatment_strategy changes to Accept or Avoid,
// cro_acceptance_status is set to 'pending_cro'. If it changes away from
// Accept/Avoid, cro_acceptance_status is cleared to null.
// Resolved 2026-07-22 -- Chandrashekar confirmed Risk Owner should gain real
// dept-scoped edit access here, matching the risk.edit seed and fixing the
// dead code below that already anticipated it (see git history / CLAUDE.md
// for the discrepancy this was flagged against before the decision).
app.patch(
    '/api/risks/:id',
    can('risk.edit'), // Phase C cutover -- was requireRole('Risk Champion', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const riskId = parseInt(req.params.id, 10);
        const role = req.company.role;

        // 1. Fetch the existing risk
        const riskRes = await pool.query(
            'SELECT * FROM risks WHERE id = $1 AND company_id = $2',
            [riskId, req.company.id]
        );
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });
        const risk = riskRes.rows[0];

        // 2. Enforce edit authority -- driven by req.scope (Phase C's
        // can('risk.edit') result) rather than role literals. Previously this
        // branched on `role === 'Risk Champion'` / `role === 'Risk Manager' ||
        // role === 'Risk Owner'`; Risk Owner's branch was unreachable dead
        // code because the outer requireRole() gate excluded Risk Owner
        // entirely. Now that the gate is can('risk.edit') and risk.edit is
        // seeded 'dept' for Risk Owner, this scope check is what actually
        // grants that access (resolved 2026-07-22, see CLAUDE.md).
        if (req.scope === 'own') {
            if (risk.assessed_by !== req.user.email) {
                return res.status(403).json({ error: 'You may only edit your own submissions.' });
            }
        } else if (req.scope === 'dept') {
            if (!await managerCanAccess(req, risk.department)) {
                return res.status(403).json({ error: 'You may only edit risks in your own department(s).' });
            }
        }
        // 'full' (CRO, Consultant CRO, Admin, Super Admin): no restriction — falls through

        // 3. Build update list from provided fields
        const EDITABLE_FIELDS = [
            'risk_detail', 'risk_cause', 'risk_consequence', 'department',
            'risk_category', 'sub_category', 'risk_owner', 'risk_consulted',
            'risk_informed', 'treatment_strategy', 'treatment_plan_rationale',
            'inherent_likelihood', 'inherent_impact', 'residual_likelihood',
            'residual_impact', 'tolerance_threshold', 'tolerance_threshold_score',
            'review_frequency', 'next_review_date', 'framework_reference',
            'escalation_justification', 'risk_velocity', 'change_reason',
            'bcp_status', 'bcp_link', 'is_critical',
        ];

        const updates = [];
        const values = [];

        // Fields with DB CHECK constraints that reject empty strings — must be null when blank.
        // The POST route handles this via Zod preprocessing; PATCH does not use Zod.
        const NULLABLE_ENUM_FIELDS = new Set(['bcp_status', 'risk_velocity']);

        for (const f of EDITABLE_FIELDS) {
            if (req.body[f] !== undefined) {
                const val = (NULLABLE_ENUM_FIELDS.has(f) && req.body[f] === '') ? null : req.body[f];
                values.push(val);
                updates.push(`${f} = $${values.length}`);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No editable fields provided.' });
        }

        // 4. Validate numeric score fields
        const scoreFields = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'];
        for (const f of scoreFields) {
            if (req.body[f] !== undefined) {
                const v = parseInt(req.body[f], 10);
                if (isNaN(v) || v < 1 || v > 5) {
                    return res.status(400).json({ error: `${f} must be an integer between 1 and 5` });
                }
            }
        }


        // 5. Treatment strategy routing: Accept/Avoid → CRO inbox; others → clear
        const newTreatment = req.body.treatment_strategy;
        if (newTreatment !== undefined) {
            const croStatus = ['Accept', 'Avoid'].includes(newTreatment) ? 'pending_cro' : null;
            values.push(croStatus);
            updates.push(`cro_acceptance_status = $${values.length}`);

            // Rationale required for Accept/Avoid
            if (['Accept', 'Avoid'].includes(newTreatment) && !req.body.treatment_plan_rationale && !risk.treatment_plan_rationale) {
                return res.status(400).json({ error: `"${newTreatment}" treatment requires a treatment plan rationale.` });
            }
        }

        // 6. Status transitions
        if (req.body.submit_draft === true && risk.approval_status === 'Draft') {
            // Submitting a saved draft → move to normal workflow status
            let newStatus = 'Awaiting Approval';
            if (role === 'CRO' || role === 'Consultant CRO' || role === 'Super Admin' || req.company.functional_role === 'Super Admin') newStatus = 'Approved'; // same fix as POST /api/risks above
            // Check for approver routing (same logic as POST)
            const deptCode = req.body.department || risk.department;
            if (newStatus !== 'Approved' && deptCode) {
                const parentCode = deptCode.includes('-') ? deptCode.split('-')[0] : deptCode;
                const approverCheck = await pool.query(
                    `SELECT 1 FROM user_companies WHERE company_id = $1 AND role = 'Risk Owner'
                     AND (UPPER(department) = UPPER($2) OR UPPER(department) LIKE UPPER($3) || '-%') LIMIT 1`,
                    [req.company.id, deptCode, parentCode]
                );
                if (approverCheck.rows.length > 0) newStatus = 'Awaiting Approver';
            }
            values.push(newStatus);
            updates.push(`approval_status = $${values.length}`);
        } else if (risk.approval_status === 'Approved') {
            // Editing an Approved risk sends it back for re-approval
            values.push('Awaiting Approval');
            updates.push(`approval_status = $${values.length}`);
        }
        // Draft → Draft (auto-save): no status change needed

        // 7. Update last_evaluated_timestamp
        values.push(Date.now());
        updates.push(`last_evaluated_timestamp = $${values.length}`);

        // 8. Execute update
        values.push(riskId, req.company.id);
        const result = await pool.query(
            `UPDATE risks SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );

        const statusReset = risk.approval_status === 'Approved';

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: riskId,
            action: 'edit',
            actor: req.user,
            details: {
                fields_changed: Object.keys(req.body).filter(k => EDITABLE_FIELDS.includes(k)),
                approval_status_reset: statusReset,
            },
        });

        // Recalculate category appetite breach for this risk's category
        const editedRisk = result.rows[0];
        if (editedRisk?.risk_category) {
            recalcAppetiteCategoryBreaches(req.company.id, editedRisk.risk_category).catch(() => {});
        }

        const [enriched] = await attachControlsAndMitigations(result.rows);
        res.json({ ...enriched, approval_status_reset: statusReset });
    })
);

// ============================================================
// Risk interdependencies (related risks)
// ============================================================
//
// Simple, undirected cross-references between risks -- no scoring logic,
// just "these two risks tend to move together / are part of the same
// story" so a risk committee can see clusters instead of isolated rows.
// Open to any Admin/Manager regardless of department (linking doesn't
// expose data, it just records a relationship -- consistent with how
// risk_controls/risk_kris links work).

function sortedRiskUidPair(a, b) {
    return a < b ? [a, b] : [b, a];
}

app.get(
    '/api/risks/:uid/related',
    can('risk.link_related'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const uid = req.params.uid;
        const linksRes = await pool.query(
            `SELECT risk_uid_a, risk_uid_b, note, created_by, created_at FROM risk_links
             WHERE company_id = $1 AND (risk_uid_a = $2 OR risk_uid_b = $2) ORDER BY created_at`,
            [req.company.id, uid]
        );
        const otherUids = linksRes.rows.map((l) => (l.risk_uid_a === uid ? l.risk_uid_b : l.risk_uid_a));

        let riskInfo = {};
        if (otherUids.length > 0) {
            const risksRes = await pool.query(
                `SELECT risk_uid, risk_detail, department, residual_likelihood, residual_impact FROM risks r WHERE company_id = $1 AND risk_uid = ANY($2::text[])
                   AND version = (SELECT MAX(version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid)`,
                [req.company.id, otherUids]
            );
            riskInfo = Object.fromEntries(risksRes.rows.map((r) => [r.risk_uid, r]));
        }

        const linkedRisks = await Promise.all(
            linksRes.rows.map(async (l) => {
                const otherUid = l.risk_uid_a === uid ? l.risk_uid_b : l.risk_uid_a;
                const info = riskInfo[otherUid];
                const accessible = !!info && await managerCanAccess(req, info.department);
                return {
                    risk_uid: otherUid,
                    note: l.note,
                    accessible,
                    risk_detail: accessible ? info.risk_detail : null,
                    department: accessible ? info.department : null,
                    residual_score: accessible ? info.residual_likelihood * info.residual_impact : null,
                };
            })
        );
        res.json(linkedRisks);
    })
);

app.post(
    '/api/risks/:uid/related',
    can('risk.link_related'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const uid = req.params.uid;
        const otherUid = (req.body.related_risk_uid || '').trim();
        if (!otherUid) return res.status(400).json({ error: 'related_risk_uid is required' });
        if (otherUid === uid) return res.status(400).json({ error: 'A risk cannot be related to itself' });

        const exists = await pool.query('SELECT 1 FROM risks WHERE company_id = $1 AND risk_uid = $2 LIMIT 1', [req.company.id, otherUid]);
        if (exists.rows.length === 0) return res.status(404).json({ error: `Risk ${otherUid} not found` });

        const [a, b] = sortedRiskUidPair(uid, otherUid);
        try {
            await pool.query(
                `INSERT INTO risk_links (company_id, risk_uid_a, risk_uid_b, note, created_by) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (company_id, risk_uid_a, risk_uid_b) DO UPDATE SET note = EXCLUDED.note`,
                [req.company.id, a, b, req.body.note || null, req.user.email]
            );
        } catch (e) {
            if (e.code === '23514') return res.status(400).json({ error: 'Invalid risk pair' });
            throw e;
        }

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'risk',
            entityId: 0,
            action: 'related_risk_added',
            actor: req.user,
            details: { risk_uid_a: a, risk_uid_b: b },
        });

        res.status(201).json({ risk_uid_a: a, risk_uid_b: b });
    })
);

app.delete(
    '/api/risks/:uid/related/:otherUid',
    can('risk.link_related'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const [a, b] = sortedRiskUidPair(req.params.uid, req.params.otherUid);
        await pool.query('DELETE FROM risk_links WHERE company_id = $1 AND risk_uid_a = $2 AND risk_uid_b = $3', [req.company.id, a, b]);
        res.json({ ok: true });
    })
);


// ============================================================
// Control Library (B2) — /api/controls/*
// ============================================================
// Standalone control catalogue, linked to risks many-to-many via
// risk_controls. Create/edit: Admin, Risk Manager, Risk Champion, CRO.
// Recording a test result (/:id/test) is narrower: Admin, Risk Manager,
// CRO, Consultant CRO only — Risk Champion/Owner can view test history
// but not record a new test.
app.get(
    '/api/controls',
    can('control.view'), // Phase C cutover -- was requireRole(all 8 roles)
    asyncHandler(async (req, res) => {
        const scope = managerScopeClause(req, 'department', 2);
        // Also surface controls assigned TO this department (owner_department match),
        // even if the creating department is different.
        const controlsRes = await pool.query(
            `SELECT * FROM controls_lib WHERE company_id = $1 ${scope ? `AND (${scope.clause} OR lower(owner_department) = ANY($2::text[]))` : ''} ORDER BY control_uid`,
            scope ? [req.company.id, scope.value] : [req.company.id]
        );
        const ids = controlsRes.rows.map((c) => c.id);

        let linksByControl = {};
        if (ids.length > 0) {
            const linksRes = await pool.query(
                `SELECT rc.control_id, r.id, r.risk_uid, r.department
                 FROM risk_controls rc JOIN risks r ON r.id = rc.risk_id
                 WHERE rc.control_id = ANY($1::int[]) AND r.version = (
                    SELECT MAX(version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid
                 )`,
                [ids]
            );
            for (const l of linksRes.rows) {
                (linksByControl[l.control_id] = linksByControl[l.control_id] || []).push({
                    id: l.id,
                    risk_uid: l.risk_uid,
                    department: l.department,
                });
            }
        }

        let openIssuesByControl = {};
        if (ids.length > 0) {
            const issuesRes = await pool.query(
                `SELECT ic.control_id, COUNT(*) AS cnt FROM issue_controls ic
                 JOIN issues i ON i.id = ic.issue_id
                 WHERE ic.control_id = ANY($1::int[]) AND i.status = ANY($2::text[])
                 GROUP BY ic.control_id`,
                [ids, OPEN_ISSUE_STATUSES]
            );
            for (const row of issuesRes.rows) openIssuesByControl[row.control_id] = parseInt(row.cnt, 10);
        }

        const myDepts = getManagerDepts(req);
        res.json(
            controlsRes.rows.map((c) => {
                const creatorMatch = !c.department || myDepts.includes(c.department.toLowerCase());
                const ownerMatch   = c.owner_department && myDepts.includes(c.owner_department.toLowerCase());
                return {
                    ...c,
                    linked_risks: linksByControl[c.id] || [],
                    open_issues_count: openIssuesByControl[c.id] || 0,
                    // true when this control was assigned TO my dept by another dept
                    assigned_to_my_team: !!(ownerMatch && !creatorMatch),
                };
            })
        );
    })
);

app.get('/api/controls/next-id', can('control.create'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    const deptParam = req.query.department || 'GEN';
    const client = await pool.connect();
    try {
        const nextId = await generateUniqueControlID(client, req.company.id, deptParam);
        res.json({ next_id: nextId });
    } finally {
        client.release();
    }
}));

app.post(
    '/api/controls',
    can('control.create'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    validate(schemas.createControl),
    asyncHandler(async (req, res) => {

        const deptResult = resolveDepartmentForWrite(req, req.body.department);
        if (deptResult.error) return res.status(400).json({ error: deptResult.error });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const uid = await generateUniqueControlID(client, req.company.id, deptResult.department || req.body.department);
            const insertRes = await client.query(
                `INSERT INTO controls_lib (company_id, control_uid, name, description, control_type, automation, owner,
                                            testing_frequency, evidence_required, framework_reference, accountable, consulted, informed, department, owner_department)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
                [
                    req.company.id,
                    uid,
                    req.body.name,
                    req.body.description || null,
                    req.body.control_type || 'Preventive',
                    req.body.automation || 'Manual',
                    req.body.owner || null,
                    req.body.testing_frequency || 'Quarterly',
                    req.body.evidence_required || null,
                    req.body.framework_reference || null,
                    req.body.accountable || null,
                    req.body.consulted || null,
                    req.body.informed || null,
                    deptResult.department || null,
                    req.body.owner_department || null,
                ]
            );
            const control = insertRes.rows[0];

            for (const riskId of req.body.link_risk_ids || []) {
                await client.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                    riskId,
                    control.id,
                ]);
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'control',
                entityId: control.id,
                action: 'create',
                actor: req.user,
                details: { control_uid: uid, name: control.name },
            });

            await client.query('COMMIT');
            res.status(201).json({ ...control, linked_risks: [] });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.patch(
    '/api/controls/:id',
    can('control.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const current = await pool.query('SELECT * FROM controls_lib WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Control not found' });

        const ctrl = current.rows[0];
        // Access granted if: user's dept created the control OR user's dept is the assigned owner dept.
        const canAccessAsCreator = await managerCanAccess(req, ctrl.department);
        const canAccessAsOwner   = await managerCanAccess(req, ctrl.owner_department);
        if (!canAccessAsCreator && !canAccessAsOwner) {
            return res.status(403).json({ error: 'This control belongs to a different department.' });
        }

        const fields = ['name', 'description', 'control_type', 'automation', 'owner', 'testing_frequency', 'evidence_required', 'framework_reference', 'accountable', 'consulted', 'informed', 'owner_department'];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }

        if (req.body.department !== undefined) {
            const deptResult = resolveDepartmentForWrite(req, req.body.department);
            if (deptResult.error) return res.status(400).json({ error: deptResult.error });
            values.push(deptResult.department);
            updates.push(`department = $${values.length}`);
        }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE controls_lib SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'control',
            entityId: result.rows[0].id,
            action: 'update',
            actor: req.user,
            details: req.body,
        });

        res.json(result.rows[0]);
    })
);

// Link an existing control to a risk from within the risk register detail view.
app.post(
    '/api/risks/:riskId/link-control',
    can('control.link_to_risk'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const { control_id } = req.body;
        if (!control_id) return res.status(400).json({ error: 'control_id required' });
        // Verify risk belongs to company
        const riskRes = await pool.query('SELECT id FROM risks WHERE id = $1 AND company_id = $2', [req.params.riskId, req.company.id]);
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });
        await pool.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.riskId, control_id]);
        res.status(201).json({ ok: true });
    })
);

// Unlink a control from a risk.
app.delete(
    '/api/risks/:riskId/link-control/:controlId',
    can('control.link_to_risk'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM risk_controls WHERE risk_id = $1 AND control_id = $2', [req.params.riskId, req.params.controlId]);
        res.json({ ok: true });
    })
);

// Create a new control and immediately link it to a risk (Option A from design doc).
app.post(
    '/api/risks/:riskId/create-and-link-control',
    can('control.create'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const riskRes = await pool.query('SELECT id, company_id FROM risks WHERE id = $1 AND company_id = $2', [req.params.riskId, req.company.id]);
        if (riskRes.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const uid = await generateUniqueControlID(client, req.company.id, req.body.department);
            const insertRes = await client.query(
                `INSERT INTO controls_lib (company_id, control_uid, name, description, owner, control_type, automation, testing_frequency, evidence_required, framework_reference, department, owner_department)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                [
                    req.company.id, uid,
                    req.body.name || 'Unnamed Control',
                    req.body.description || null,
                    req.body.owner || null,
                    req.body.control_type || 'Preventive',
                    req.body.automation || 'Manual',
                    req.body.testing_frequency || 'Quarterly',
                    req.body.evidence_required || null,
                    req.body.framework_reference || null,
                    req.body.department || null,
                    req.body.owner_department || null,
                ]
            );
            const control = insertRes.rows[0];
            await client.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.riskId, control.id]);
            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'control',
                entityId: control.id,
                action: 'create',
                actor: req.user,
                details: { control_uid: uid, linked_risk_id: req.params.riskId },
            });
            await client.query('COMMIT');
            res.status(201).json(control);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Link/unlink an existing control to a risk (e.g. from the risk register
// "linked controls" picker, or from the Control Library itself).
app.post(
    '/api/controls/:id/link-risk',
    can('control.link_to_risk'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const { risk_id } = req.body;
        const control_id = req.params.id;
        const cid = req.company.id;
        const [riskCheck, ctrlCheck] = await Promise.all([
            pool.query('SELECT id FROM risks WHERE id = $1 AND company_id = $2', [risk_id, cid]),
            pool.query('SELECT id FROM controls_lib WHERE id = $1 AND company_id = $2', [control_id, cid]),
        ]);
        if (!riskCheck.rows.length) return res.status(404).json({ error: 'Risk not found' });
        if (!ctrlCheck.rows.length) return res.status(404).json({ error: 'Control not found' });
        await pool.query('INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
            risk_id,
            control_id,
        ]);
        res.status(201).json({ message: 'Linked' });
    })
);

app.delete(
    '/api/controls/:id/link-risk/:riskId',
    can('control.link_to_risk'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM risk_controls WHERE control_id = $1 AND risk_id = $2', [req.params.id, req.params.riskId]);
        res.json({ message: 'Unlinked' });
    })
);

// Testing workflow (B2): each test (self-test or independent audit test) is
// its own record. The control's summary last_test_* fields are updated to
// reflect whichever test was just recorded -- status changes ONLY via test
// results, never automatically from issue closure.
app.post(
    '/api/controls/:id/test',
    can('control.test'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const { test_type, test_date, result, notes, remediation_plan, remediation_owner, remediation_due_date } = req.body;
        if (!test_date || !result) return res.status(400).json({ error: 'test_date and result are required' });
        if (!['Effective', 'Partially Effective', 'Ineffective', 'Not yet tested'].includes(result)) {
            return res.status(400).json({ error: 'result must be Effective, Partially Effective, Ineffective, or Not yet tested' });
        }
        // Mitigation Workflow: a Partially Effective/Ineffective result
        // can't be submitted on its own -- the remediation action plan
        // (and who owns it, and by when) must be captured in the same
        // submission, not left for someone to add to the auto-created
        // issue later.  "Not yet tested" is a neutral reset — no remediation needed.
        if (result !== 'Effective' && result !== 'Not yet tested') {
            if (!remediation_plan || !remediation_plan.trim()) {
                return res.status(400).json({ error: 'A Remediation Action Plan is required when the result is Partially Effective or Ineffective.' });
            }
            if (!remediation_owner || !remediation_owner.trim()) {
                return res.status(400).json({ error: 'A remediation owner is required when the result is Partially Effective or Ineffective.' });
            }
            if (!remediation_due_date) {
                return res.status(400).json({ error: 'A remediation due date is required when the result is Partially Effective or Ineffective.' });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const controlCheck = await client.query('SELECT id, department FROM controls_lib WHERE id = $1 AND company_id = $2', [
                req.params.id,
                req.company.id,
            ]);
            if (controlCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Control not found' });
            }
            if (!await managerCanAccess(req, controlCheck.rows[0].department)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This control belongs to a different department.' });
            }

            const testInsert = await client.query(
                `INSERT INTO control_tests (control_id, test_type, test_date, result, notes, tested_by)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [req.params.id, test_type || 'Self-Test', test_date, result, notes || null, req.user.email]
            );
            const testId = testInsert.rows[0].id;

            const updateRes = await client.query(
                `UPDATE controls_lib SET last_test_date = $1, last_test_result = $2, test_notes = $3
                 WHERE id = $4 RETURNING *`,
                [test_date, result, notes || null, req.params.id]
            );
            const control = updateRes.rows[0];

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'control',
                entityId: req.params.id,
                action: 'test_recorded',
                actor: req.user,
                details: { test_type: test_type || 'Self-Test', test_date, result },
            });

            // D: "one control can spawn multiple linked issues" -- every
            // non-Effective test result automatically logs a new issue,
            // pre-filled with the remediation plan captured above.
            // "Not yet tested" is a neutral reset -- no issue created.
            let createdIssue = null;
            if (result !== 'Effective' && result !== 'Not yet tested') {
                createdIssue = await createIssue(client, req.company.id, req.user.email, {
                    source_type: 'Self-identified (Control Test)',
                    source_detail: `${test_type || 'Self-Test'} on ${test_date}${notes ? `: ${notes}` : ''}`,
                    description: `Control ${control.control_uid} (${control.name}) tested as ${result}`,
                    remediation_plan: remediation_plan.trim(),
                    owner: remediation_owner.trim(),
                    due_date: remediation_due_date,
                    priority: result === 'Ineffective' ? 'High' : 'Medium',
                    department: control.department || null,
                    raised_by_dept: control.department || null,
                    link_control_ids: [control.id],
                    auto: true,
                });
            }

            await client.query('COMMIT');
            res.status(201).json({ ...control, test_id: testId, created_issue: createdIssue });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.get(
    '/api/controls/:id/tests',
    can('control.test_history.view'), // Phase C cutover -- was requireRole(all 8 roles)
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT ct.* FROM control_tests ct JOIN controls_lib cl ON cl.id = ct.control_id
             WHERE ct.control_id = $1 AND cl.company_id = $2 ORDER BY ct.test_date DESC, ct.id DESC`,
            [req.params.id, req.company.id]
        );
        res.json(result.rows);
    })
);

// ============================================================
// Key Risk Indicators (B3) — /api/kris/*, /api/kri-register
// ============================================================
// Library (definitions + thresholds) vs. Register (actual readings over
// time) is the same distinction as elsewhere: view is broad (incl.
// Viewer), but defining a KRI or recording a measurement is Admin, Risk
// Manager, CRO, Consultant CRO only. A Red reading auto-creates a linked
// Issue (see Issues & Actions Tracker below).

app.get(
    '/api/kris/next-id',
    can('kri.manage_definition'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const client = await pool.connect();
        try {
            const dept = req.query.department || null;
            const nextId = await generateUniqueKriID(client, req.company.id, dept);
            res.json({ next_id: nextId });
        } finally {
            client.release();
        }
    })
);

app.get(
    '/api/kris',
    can('kri.view'), // Phase C cutover -- was requireRole(all 8 roles); managerScopeClause() below still applies dept filtering unchanged
    asyncHandler(async (req, res) => {
        const scope = managerScopeClause(req, 'department', 2);
        const krisRes = await pool.query(
            `SELECT * FROM kris WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY kri_uid`,
            scope ? [req.company.id, scope.value] : [req.company.id]
        );
        const ids = krisRes.rows.map((k) => k.id);

        let measurementsByKri = {};
        if (ids.length > 0) {
            const measurementsRes = await pool.query(
                `SELECT * FROM (
                    SELECT kri_id, measurement_date, value, rag_status, notes, reporting_period,
                           ROW_NUMBER() OVER (PARTITION BY kri_id ORDER BY measurement_date DESC, id DESC) AS rn
                    FROM kri_measurements WHERE kri_id = ANY($1::int[])
                 ) sub WHERE rn <= 12 ORDER BY measurement_date ASC`,
                [ids]
            );
            for (const m of measurementsRes.rows) {
                (measurementsByKri[m.kri_id] = measurementsByKri[m.kri_id] || []).push({
                    measurement_date: m.measurement_date,
                    value: m.value,
                    rag_status: m.rag_status,
                    notes: m.notes,
                    reporting_period: m.reporting_period,
                });
            }
        }

        res.json(
            krisRes.rows.map((k) => {
                const history = measurementsByKri[k.id] || [];
                const last = history.length > 0 ? history[history.length - 1] : null;
                const current = last ? last.value : null;
                const lastDate = last ? last.measurement_date : null;
                return {
                    ...k,
                    history,
                    current_value: current,
                    band: computeKriBand(k, current),
                    is_overdue: isKriOverdue(k.measurement_frequency, lastDate),
                };
            })
        );
    })
);

// KRI Register — full monitoring view with complete measurement history,
// recorded_by, and created_at timestamps. Separate from /api/kris which
// caps history at 12 for the sparkline view.
app.get(
    '/api/kri-register',
    can('kri.view'), // Phase C cutover -- was requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer') (Admin/Super Admin passed via the old hardcoded bypass; kri.view is 'full' for them in the seed, so behavior is unchanged)
    asyncHandler(async (req, res) => {
        const scope = managerScopeClause(req, 'department', 2);
        const krisRes = await pool.query(
            `SELECT * FROM kris WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY kri_uid`,
            scope ? [req.company.id, scope.value] : [req.company.id]
        );
        const ids = krisRes.rows.map((k) => k.id);

        let measurementsByKri = {};
        if (ids.length > 0) {
            // Full history, most-recent first within each KRI, no row limit.
            const measRes = await pool.query(
                `SELECT kri_id, id, measurement_date, value, rag_status, notes,
                        reporting_period, recorded_by, created_at
                 FROM kri_measurements WHERE kri_id = ANY($1::int[])
                 ORDER BY kri_id, measurement_date DESC, id DESC`,
                [ids]
            );
            for (const m of measRes.rows) {
                (measurementsByKri[m.kri_id] = measurementsByKri[m.kri_id] || []).push({
                    id: m.id,
                    measurement_date: m.measurement_date,
                    value: m.value,
                    rag_status: m.rag_status,
                    notes: m.notes,
                    reporting_period: m.reporting_period,
                    recorded_by: m.recorded_by,
                    created_at: m.created_at,
                });
            }
        }

        const rows = krisRes.rows.map((k) => {
            const history = measurementsByKri[k.id] || [];
            // history is newest-first; current = first entry
            const last = history[0] || null;
            const current = last ? last.value : null;
            return {
                ...k,
                history,           // newest-first, full history
                current_value: current,
                current_rag: last ? last.rag_status : null,
                band: computeKriBand(k, current),
                is_overdue: isKriOverdue(k.measurement_frequency, last ? last.measurement_date : null),
                last_measurement_date: last ? last.measurement_date : null,
            };
        });

        // RAG summary counts
        const summary = { Red: 0, Amber: 0, Green: 0, None: 0, overdue: 0 };
        for (const r of rows) {
            const rag = r.current_rag || r.band;
            if (rag === 'Red') summary.Red++;
            else if (rag === 'Amber') summary.Amber++;
            else if (rag === 'Green') summary.Green++;
            else summary.None++;
            if (r.is_overdue) summary.overdue++;
        }

        res.json({ kris: rows, summary });
    })
);

app.post(
    '/api/kris',
    can('kri.manage_definition'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    validate(schemas.createKri),
    asyncHandler(async (req, res) => {

        const deptResult = resolveDepartmentForWrite(req, req.body.department);
        if (deptResult.error) return res.status(400).json({ error: deptResult.error });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const uid = await generateUniqueKriID(client, req.company.id, deptResult.department);
            const insertRes = await client.query(
                `INSERT INTO kris (company_id, kri_uid, name, description, definition, owner, measurement_frequency,
                                   threshold_source, internal_tolerance, regulatory_limit, regulatory_reference,
                                   breach_direction, department, data_source, threshold_bands, appetite_statement_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
                [
                    req.company.id,
                    uid,
                    req.body.name,
                    req.body.description || null,
                    req.body.definition || null,
                    req.body.owner || null,
                    req.body.measurement_frequency || 'Monthly',
                    req.body.threshold_source || 'None',
                    req.body.internal_tolerance !== '' ? req.body.internal_tolerance ?? null : null,
                    req.body.regulatory_limit   !== '' ? req.body.regulatory_limit   ?? null : null,
                    req.body.regulatory_reference || null,
                    req.body.breach_direction || 'above',
                    deptResult.department || null,
                    req.body.data_source || null,
                    req.body.threshold_bands ? JSON.stringify(req.body.threshold_bands) : null,
                    req.body.appetite_statement_id || null,
                ]
            );
            const kri = insertRes.rows[0];

            for (const riskId of req.body.link_risk_ids || []) {
                await client.query('INSERT INTO risk_kris (risk_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [riskId, kri.id]);
            }
            for (const controlId of req.body.link_control_ids || []) {
                await client.query('INSERT INTO control_kris (control_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [controlId, kri.id]);
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'kri',
                entityId: kri.id,
                action: 'create',
                actor: req.user,
                details: { kri_uid: uid, name: kri.name },
            });

            await client.query('COMMIT');
            res.status(201).json({ ...kri, history: [], current_value: null, band: null });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.patch(
    '/api/kris/:id',
    can('kri.manage_definition'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'); managerCanAccess() below still enforces department scope unchanged
    asyncHandler(async (req, res) => {
        const current = await pool.query('SELECT * FROM kris WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'KRI not found' });
        if (!await managerCanAccess(req, current.rows[0].department)) {
            return res.status(403).json({ error: 'This KRI belongs to a different department.' });
        }

        const fields = [
            'name',
            'description',
            'definition',
            'owner',
            'measurement_frequency',
            'threshold_source',
            'internal_tolerance',
            'regulatory_limit',
            'regulatory_reference',
            'breach_direction',
            'data_source',
            'appetite_statement_id',
        ];
        const updates = [];
        const values = [];
        // Integer FK and numeric fields must never reach the DB as ''.
        // The KRI Zod schema uses .passthrough() so these bypass Zod coercion.
        const KRI_EMPTY_TO_NULL = new Set(['appetite_statement_id', 'internal_tolerance', 'regulatory_limit']);
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                const val = (KRI_EMPTY_TO_NULL.has(f) && req.body[f] === '') ? null : req.body[f];
                values.push(val);
                updates.push(`${f} = $${values.length}`);
            }
        }
        if (req.body.threshold_bands !== undefined) {
            values.push(req.body.threshold_bands ? JSON.stringify(req.body.threshold_bands) : null);
            updates.push(`threshold_bands = $${values.length}`);
        }

        if (req.body.department !== undefined) {
            const deptResult = resolveDepartmentForWrite(req, req.body.department);
            if (deptResult.error) return res.status(400).json({ error: deptResult.error });
            values.push(deptResult.department);
            updates.push(`department = $${values.length}`);
        }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE kris SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'kri',
            entityId: result.rows[0].id,
            action: 'update',
            actor: req.user,
            details: req.body,
        });

        res.json(result.rows[0]);
    })
);

// Records a new measurement (B3: "Current value + trend (history)").
app.post(
    '/api/kris/:id/measurements',
    can('kri.record_measurement'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'); managerCanAccess() below still enforces department scope unchanged
    asyncHandler(async (req, res) => {
        const { measurement_date, value, rag_status, notes, reporting_period } = req.body;
        if (!measurement_date || value === undefined || value === null) {
            return res.status(400).json({ error: 'measurement_date and value are required' });
        }
        const validRag = ['Green', 'Amber', 'Red'];
        if (rag_status && !validRag.includes(rag_status)) {
            return res.status(400).json({ error: 'rag_status must be Green, Amber, or Red' });
        }

        const kriRes = await pool.query(
            `SELECT k.*, ras.risk_category AS appetite_category
             FROM kris k
             LEFT JOIN risk_appetite_statements ras ON ras.id = k.appetite_statement_id
             WHERE k.id = $1 AND k.company_id = $2`,
            [req.params.id, req.company.id]
        );
        if (kriRes.rows.length === 0) return res.status(404).json({ error: 'KRI not found' });
        const kri = kriRes.rows[0];
        if (!await managerCanAccess(req, kri.department)) {
            return res.status(403).json({ error: 'This KRI belongs to a different department.' });
        }

        const band = computeKriBand(kri, value);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO kri_measurements (kri_id, measurement_date, value, recorded_by, rag_status, notes, reporting_period)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [req.params.id, measurement_date, value, req.user.email, rag_status || null, notes || null, reporting_period || null]
            );

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'kri',
                entityId: kri.id,
                action: 'measurement_recorded',
                actor: req.user,
                details: { measurement_date, value, band },
            });

            // D: a Red band reading is a regulatory/internal-tolerance
            // breach -- log it as a KRI Breach issue automatically.
            let createdIssue = null;
            if (band === 'Red') {
                createdIssue = await createIssue(client, req.company.id, req.user.email, {
                    source_type: 'Self-identified (KRI Breach)',
                    source_detail: `Measurement on ${measurement_date}: value = ${value}`,
                    description: `KRI ${kri.kri_uid} (${kri.name}) breached its ${
                        kri.regulatory_limit != null ? 'regulatory limit' : 'internal tolerance'
                    } with a value of ${value}${kri.appetite_category ? `. Risk Appetite category: ${kri.appetite_category}` : ''}`,
                    owner: kri.owner || null,
                    priority: 'High',
                    regulatory_notification_required: kri.threshold_source === 'Regulatory' || kri.threshold_source === 'Both',
                    department: kri.department || null,
                    raised_by_dept: kri.department || null,
                    link_kri_ids: [kri.id],
                    auto: true,
                });
            }

            await client.query('COMMIT');
            res.status(201).json({ measurement_date, value, band, created_issue: createdIssue });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);


// ============================================================
// Users & Access (H2) — /api/users/*
// ============================================================
// Admin-only throughout. This is the one part of the permission model
// that is already fully self-service today — an Admin can add a user,
// assign any of the roles in UserManagement.jsx's ROLES array, scope
// them to department(s)/business unit(s), deactivate, or remove them,
// entirely through the UI. What is NOT self-service is the set of roles
// itself, or what each role can do — see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx for the scoped
// design that would make that configurable too.
app.get(
    '/api/users',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.must_change_password,
                    uc.role, uc.functional_role, uc.department, uc.departments,
                    uc.business_unit_ids, uc.group_access_scope
             FROM user_companies uc JOIN users u ON u.id = uc.user_id
             WHERE uc.company_id = $1 ORDER BY u.email`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

// Returns users with the 'Risk Owner' role — used to populate Control Owner dropdowns.
// Accessible to all operational roles (not just Admin).
app.get(
    '/api/users/risk-owners',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT u.id, u.email, u.full_name
             FROM user_companies uc JOIN users u ON u.id = uc.user_id
             WHERE uc.company_id = $1 AND uc.role = 'Risk Owner' AND u.is_active = true
             ORDER BY u.full_name, u.email`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

// Adds a user to the current company. If the email already exists
// globally (e.g. a group-level user being added to another company),
// just creates the user_companies link. Otherwise creates a new user
// with a temporary password that must be changed on first login.
app.post(
    '/api/users',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { email, full_name, role, functional_role, department, departments, business_unit_ids, temporary_password } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        // RFC 5321: local part ≤ 64 chars, total ≤ 254 chars, must have @ with local and domain parts
        const emailStr = String(email).trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailStr) || emailStr.length > 254 || emailStr.split('@')[0].length > 64) {
            return res.status(400).json({ error: 'Invalid email address' });
        }
        if (full_name && String(full_name).length > 255) {
            return res.status(400).json({ error: 'full_name must be 255 characters or fewer' });
        }
        if (!['Super Admin', 'Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Viewer', 'Consultant CRO'].includes(role)) {
            return res.status(400).json({ error: 'Role must be Super Admin, Admin, Risk Champion, Risk Owner, Risk Manager, CRO, Viewer, or Consultant CRO' });
        }

        const normalizedEmail = emailStr.toLowerCase();
        let userId;
        let generatedPassword = null;

        // Generate a temp password that always satisfies the password policy.
        function makeTempPassword() {
            const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const lower = 'abcdefghjkmnpqrstuvwxyz';
            const digits = '23456789';
            const special = '!@#$%^&*';
            const all = upper + lower + digits + special;
            let p = upper[Math.floor(Math.random() * upper.length)]
                  + lower[Math.floor(Math.random() * lower.length)]
                  + digits[Math.floor(Math.random() * digits.length)]
                  + special[Math.floor(Math.random() * special.length)];
            for (let i = 4; i < 12; i++) p += all[Math.floor(Math.random() * all.length)];
            return p.split('').sort(() => Math.random() - 0.5).join('');
        }

        // Validate an explicitly provided temp password before opening a transaction.
        if (temporary_password) {
            const earlyPolicyIssues = validatePasswordPolicy(temporary_password);
            if (earlyPolicyIssues.length > 0) {
                return res.status(400).json({ error: `Temporary password must ${earlyPolicyIssues.join(', ')}` });
            }
        }

        // Wrap the entire user + user_companies creation in a transaction so that
        // if user_companies INSERT fails (e.g. role CHECK constraint), the users row
        // is also rolled back. Without this, a failed first attempt leaves a ghost
        // user record that causes subsequent retries to skip temp password generation.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
            if (existing.rows.length > 0) {
                userId = existing.rows[0].id;
                // Check if this is a ghost user — exists in the users table but was never
                // successfully added to any company (first attempt failed mid-transaction).
                // Ghost users have no user_companies rows and it is safe to reset their password.
                const companyCheck = await client.query(
                    'SELECT 1 FROM user_companies WHERE user_id = $1 LIMIT 1',
                    [userId]
                );
                if (companyCheck.rows.length === 0) {
                    // Ghost user: reset password so this attempt behaves like a fresh invite.
                    const tempPassword = temporary_password || makeTempPassword();
                    const hash = await bcrypt.hash(tempPassword, 10);
                    await client.query(
                        'UPDATE users SET password_hash = $1, must_change_password = true, full_name = COALESCE(NULLIF($2,\'\'), full_name) WHERE id = $3',
                        [hash, full_name || '', userId]
                    );
                    await client.query(
                        'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
                        [userId, hash]
                    );
                    generatedPassword = tempPassword;
                }
                // else: user is active at other companies — do NOT reset their password.
                // The admin should direct them to log in with existing credentials.
            } else {
                const tempPassword = temporary_password || makeTempPassword();
                const hash = await bcrypt.hash(tempPassword, 10);
                const insertUser = await client.query(
                    `INSERT INTO users (email, full_name, password_hash, must_change_password)
                     VALUES ($1, $2, $3, true) RETURNING id`,
                    [normalizedEmail, full_name || '', hash]
                );
                userId = insertUser.rows[0].id;
                await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, hash]);
                generatedPassword = tempPassword;
            }

            // Normalise departments: accept either `departments` (array) or legacy `department` (string).
            // Always store both for backward compat: department = first element, departments = full array.
            let deptArray = null;
            if (Array.isArray(departments) && departments.length > 0) {
                deptArray = departments.map(d => String(d).trim()).filter(Boolean);
            } else if (department) {
                deptArray = [String(department).trim()];
            }
            const primaryDept = deptArray ? deptArray[0] : null;
            const buIdsArray = Array.isArray(business_unit_ids) ? business_unit_ids.map(String) : [];

            await client.query(
                `INSERT INTO user_companies (user_id, company_id, role, functional_role, department, departments, business_unit_ids)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, req.company.id, role, functional_role || null, primaryDept, deptArray, buIdsArray]
            );

            await client.query('COMMIT');
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            if (e.code === '23505') return res.status(400).json({ error: 'This user already has access to this company' });
            throw e;
        } finally {
            client.release();
        }

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'user',
            entityId: userId,
            action: 'added_to_company',
            actor: req.user,
            details: { email: normalizedEmail, role },
        });

        // ── Task #7: email the temp password if SMTP is configured ───────────
        let emailSent = false;
        if (generatedPassword) {
            const loginUrl = process.env.APP_URL || 'https://grc.certitude-advisory.ca';
            try {
                const result = await sendTempPassword(req.company.id, {
                    toEmail: normalizedEmail,
                    toName: full_name || '',
                    tempPassword: generatedPassword,
                    loginUrl,
                });
                emailSent = result.sent;
                if (result.sent) {
                    console.log(`[email] Welcome email sent to user ${userId}`);
                } else {
                    console.warn(`[email] Welcome email NOT sent to user ${userId}: ${result.reason}`);
                }
            } catch (emailErr) {
                console.error(`[email] Failed to send welcome email to user ${userId}:`, emailErr.message);
            }
        }

        // Always return the temp password to the admin so they can share it directly,
        // regardless of whether the email was also sent. This prevents the case where
        // email delivery silently fails and the admin has no way to onboard the user.
        res.status(201).json({
            id: userId,
            email: normalizedEmail,
            role,
            email_sent: emailSent,
            ...(generatedPassword ? { tempPassword: generatedPassword } : {}),
        });
    })
);

app.patch(
    '/api/users/:userId',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetId = parseInt(req.params.userId, 10);
        const { role, functional_role, department, departments, business_unit_ids } = req.body;
        if (role && !['Super Admin', 'Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Viewer', 'Consultant CRO'].includes(role)) {
            return res.status(400).json({ error: 'Role must be Super Admin, Admin, Risk Champion, Risk Owner, Risk Manager, CRO, Viewer, or Consultant CRO' });
        }

        const current = await pool.query('SELECT * FROM user_companies WHERE user_id = $1 AND company_id = $2', [
            targetId,
            req.company.id,
        ]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'User not found in this company' });

        // Guard: don't allow demoting the last remaining Admin of a company.
        // Super Admin is considered admin-equivalent and is never treated as a demotion.
        const isAdminEquivalent = (r) => r === 'Admin' || r === 'Super Admin';
        if (role && !isAdminEquivalent(role) && isAdminEquivalent(current.rows[0].role)) {
            const adminCount = await pool.query(
                "SELECT COUNT(*) AS cnt FROM user_companies WHERE company_id = $1 AND role IN ('Admin', 'Super Admin')",
                [req.company.id]
            );
            if (parseInt(adminCount.rows[0].cnt, 10) <= 1) {
                return res.status(403).json({ error: 'Cannot demote the last Admin of this company' });
            }
        }

        // Normalise departments: accept `departments` (array) or legacy `department` (string).
        // Build SET clause dynamically to only touch dept columns when the caller sends them.
        let patchDeptArray = undefined;
        let patchPrimaryDept = undefined;
        if (departments !== undefined) {
            patchDeptArray = Array.isArray(departments) && departments.length > 0
                ? departments.map(d => String(d).trim()).filter(Boolean)
                : null;
            patchPrimaryDept = patchDeptArray ? patchDeptArray[0] : null;
        } else if (department !== undefined) {
            patchPrimaryDept = department || null;
            patchDeptArray = department ? [String(department).trim()] : null;
        }

        const setClauses = ['role = COALESCE($1, role)', 'functional_role = COALESCE($2, functional_role)'];
        const params = [role || null, functional_role || null];
        if (patchPrimaryDept !== undefined) {
            params.push(patchPrimaryDept);
            setClauses.push(`department = $${params.length}`);
        }
        if (patchDeptArray !== undefined) {
            params.push(patchDeptArray);
            setClauses.push(`departments = $${params.length}::text[]`);
        }
        if (business_unit_ids !== undefined) {
            const buArr = Array.isArray(business_unit_ids) ? business_unit_ids.map(String) : [];
            params.push(buArr);
            setClauses.push(`business_unit_ids = $${params.length}::text[]`);
        }
        params.push(targetId, req.company.id);

        const updated = await pool.query(
            `UPDATE user_companies SET ${setClauses.join(', ')}
             WHERE user_id = $${params.length - 1} AND company_id = $${params.length}
             RETURNING *`,
            params
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'user',
            entityId: targetId,
            action: 'role_updated',
            actor: req.user,
            details: { role, functional_role, departments: patchDeptArray },
        });

        res.json(updated.rows[0]);
    })
);

// Revokes a user's access to the current company (does not delete the
// global user record, preserving audit trail integrity per G10).
app.delete(
    '/api/users/:userId',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetId = parseInt(req.params.userId, 10);

        if (targetId === req.user.id) return res.status(403).json({ error: 'You cannot remove your own access' });

        const current = await pool.query('SELECT * FROM user_companies WHERE user_id = $1 AND company_id = $2', [
            targetId,
            req.company.id,
        ]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'User not found in this company' });

        if (current.rows[0].role === 'Admin' || current.rows[0].role === 'Super Admin') {
            const adminCount = await pool.query(
                "SELECT COUNT(*) AS cnt FROM user_companies WHERE company_id = $1 AND role IN ('Admin', 'Super Admin')",
                [req.company.id]
            );
            if (parseInt(adminCount.rows[0].cnt, 10) <= 1) {
                return res.status(403).json({ error: 'Cannot remove the last Admin of this company' });
            }
        }

        await pool.query('DELETE FROM user_companies WHERE user_id = $1 AND company_id = $2', [targetId, req.company.id]);

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'user',
            entityId: targetId,
            action: 'removed_from_company',
            actor: req.user,
        });

        res.json({ message: 'Access revoked' });
    })
);

// H2: "create/deactivate users" -- a global account-level toggle on
// users.is_active, which already gates login and session validation
// (see authenticate middleware). Distinct from DELETE above, which only
// revokes access to *this* company; deactivation suspends the account
// everywhere while preserving its history for the audit trail.
app.post(
    '/api/users/:userId/active',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetId = parseInt(req.params.userId, 10);
        const { is_active } = req.body;
        if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active (boolean) is required' });

        if (targetId === req.user.id) return res.status(403).json({ error: 'You cannot deactivate your own account' });

        const current = await pool.query('SELECT * FROM user_companies WHERE user_id = $1 AND company_id = $2', [
            targetId,
            req.company.id,
        ]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'User not found in this company' });

        if (!is_active && (current.rows[0].role === 'Admin' || current.rows[0].role === 'Super Admin')) {
            const adminCount = await pool.query(
                `SELECT COUNT(*) AS cnt FROM user_companies uc JOIN users u ON u.id = uc.user_id
                 WHERE uc.company_id = $1 AND uc.role IN ('Admin', 'Super Admin') AND u.is_active = true`,
                [req.company.id]
            );
            if (parseInt(adminCount.rows[0].cnt, 10) <= 1) {
                return res.status(403).json({ error: 'Cannot deactivate the last active Admin of this company' });
            }
        }

        const updated = await pool.query('UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, is_active', [is_active, targetId]);
        if (updated.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        // Deactivating immediately ends any active sessions for this user.
        if (!is_active) {
            await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
        }

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'user',
            entityId: targetId,
            action: is_active ? 'reactivated' : 'deactivated',
            actor: req.user,
        });

        res.json(updated.rows[0]);
    })
);

// ============================================================
// Roles & Permissions -- Phase B of the admin-configurable permissions
// engine (see Documents/Internal/RBAC_Permissions_Engine_Scoping.docx
// Section 9). Reads/writes the roles/capabilities/role_permissions tables
// seeded in Phase A (schema_v75_permissions_engine.sql). This screen is
// purely so Qatar Post can see and edit the model. It is still gated by
// requireRole('Admin') itself, not by can() -- role/permission management
// is one of the two safety-baseline-adjacent capabilities (users.manage /
// roles.manage) with a lockout guardrail below, so leaving its own gate on
// the simple hardcoded check is deliberate, not an oversight.
//
// As of Phase C, other modules' route guards *do* now consult these
// tables via can() (see resolveScope() near requireRole() above) --
// starting with KRI Library/Register, Glossary, and Escalation Rules
// (the doc's Section "Phase C" calls these out as the more isolated,
// lower-traffic modules to cut over first). Most routes are still on
// requireRole(); this is an in-progress, module-by-module migration, not
// a completed cutover.
// ============================================================

// GET /api/roles -- built-in roles (company_id IS NULL) plus this
// company's own custom roles, if any exist yet.
app.get(
    '/api/roles',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT id, name, is_builtin, company_id
             FROM roles
             WHERE company_id IS NULL OR company_id = $1
             ORDER BY is_builtin DESC, name`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

// POST /api/roles -- create a custom role, name only. Seeded with zero
// permissions by construction (no role_permissions rows are created) --
// nothing is ever accidentally over-granted (Section 9.1).
app.post(
    '/api/roles',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name is required' });
        if (name.length > 100) return res.status(400).json({ error: 'name must be 100 characters or fewer' });

        const clash = await pool.query(
            `SELECT 1 FROM roles WHERE lower(name) = lower($1) AND (company_id IS NULL OR company_id = $2)`,
            [name, req.company.id]
        );
        if (clash.rows.length > 0) {
            return res.status(409).json({ error: `A role named "${name}" already exists.` });
        }

        const inserted = await pool.query(
            `INSERT INTO roles (company_id, name, is_builtin) VALUES ($1, $2, false) RETURNING id, name, is_builtin, company_id`,
            [req.company.id, name]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'role',
            entityId: inserted.rows[0].id,
            action: 'created',
            actor: req.user,
            details: { name },
        });

        res.status(201).json(inserted.rows[0]);
    })
);

// GET /api/capabilities -- the full seeded catalogue (both configurable
// and non-configurable baseline capabilities -- see is_baseline). This
// list itself is not editable from the admin screen (Section 9.1); it
// only changes when the application gains or removes a real feature.
app.get(
    '/api/capabilities',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT key, module, label, supports_scope, is_baseline FROM capabilities ORDER BY module, key`
        );
        res.json(result.rows);
    })
);

// GET /api/roles/:id/permissions -- every capability for the given role,
// with its current scope (defaults to 'none' if no role_permissions row
// exists yet). Baseline capabilities are included for transparency but
// always report scope 'full' and are not meant to be edited (enforced
// again server-side on the PUT below, not just hidden client-side).
app.get(
    '/api/roles/:id/permissions',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const roleId = parseInt(req.params.id, 10);
        const roleRes = await pool.query(
            `SELECT id, name, is_builtin FROM roles WHERE id = $1 AND (company_id IS NULL OR company_id = $2)`,
            [roleId, req.company.id]
        );
        if (roleRes.rows.length === 0) return res.status(404).json({ error: 'Role not found' });

        const permRes = await pool.query(
            `SELECT c.key, c.module, c.label, c.supports_scope, c.is_baseline,
                    CASE WHEN c.is_baseline THEN 'full' ELSE COALESCE(rp.scope, 'none') END AS scope
             FROM capabilities c
             LEFT JOIN role_permissions rp ON rp.capability_key = c.key AND rp.role_id = $1
             ORDER BY c.module, c.key`,
            [roleId]
        );

        res.json({ role: roleRes.rows[0], permissions: permRes.rows });
    })
);

// PUT /api/roles/:id/permissions -- bulk-save the permission grid for one
// role. Body: { permissions: { [capability_key]: 'none'|'own'|'dept'|'full' } }
app.put(
    '/api/roles/:id/permissions',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const roleId = parseInt(req.params.id, 10);
        const incoming = req.body.permissions;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ error: 'permissions (object) is required' });
        }

        const roleRes = await pool.query(
            `SELECT id, name, is_builtin FROM roles WHERE id = $1 AND (company_id IS NULL OR company_id = $2)`,
            [roleId, req.company.id]
        );
        if (roleRes.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
        const role = roleRes.rows[0];

        const capRes = await pool.query(`SELECT key, supports_scope, is_baseline FROM capabilities`);
        const capByKey = {};
        capRes.rows.forEach((c) => { capByKey[c.key] = c; });

        const VALID_SCOPES = ['none', 'own', 'dept', 'full'];
        const updates = {};
        for (const [key, scope] of Object.entries(incoming)) {
            const cap = capByKey[key];
            if (!cap) return res.status(400).json({ error: `Unknown capability: ${key}` });
            if (cap.is_baseline) {
                return res.status(400).json({ error: `${key} is a non-configurable safety baseline and cannot be edited.` });
            }
            if (!VALID_SCOPES.includes(scope)) {
                return res.status(400).json({ error: `Invalid scope "${scope}" for ${key}` });
            }
            if (!cap.supports_scope && scope !== 'none' && scope !== 'full') {
                return res.status(400).json({ error: `${key} does not support Own/Department scoping -- use None or Full.` });
            }
            updates[key] = scope;
        }

        // ── Lockout guardrail (Section 9.1) ──────────────────────────────
        // Refuse a save that would leave this company with zero active
        // users able to reach users.manage or roles.manage -- otherwise
        // there would be no way back into this screen. Mirrors the
        // existing "last active Admin" protection on POST /api/users/:id/active.
        for (const guardKey of ['users.manage', 'roles.manage']) {
            if (!(guardKey in updates)) continue;
            if (updates[guardKey] === 'full') continue; // being granted, not reduced -- always safe

            const holders = await pool.query(
                `SELECT DISTINCT r.id, r.name,
                        COALESCE(rp.scope, CASE WHEN c.is_baseline THEN 'full' ELSE 'none' END) AS scope
                 FROM roles r
                 CROSS JOIN capabilities c
                 LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.capability_key = c.key
                 WHERE c.key = $1 AND (r.company_id IS NULL OR r.company_id = $2)`,
                [guardKey, req.company.id]
            );
            const effectiveScope = (rId) => {
                if (rId === roleId) return updates[guardKey];
                const row = holders.rows.find((h) => h.id === rId);
                return row ? row.scope : 'none';
            };
            const fullRoleIds = holders.rows
                .map((h) => h.id)
                .filter((rId) => effectiveScope(rId) === 'full');

            if (fullRoleIds.length === 0) {
                return res.status(403).json({
                    error: `Cannot remove ${guardKey} from ${role.name} -- no role would retain it, and there would be no way back into this screen.`,
                });
            }

            const activeHolder = await pool.query(
                `SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id
                 JOIN roles r ON r.name = uc.role AND (r.company_id IS NULL OR r.company_id = $2)
                 WHERE uc.company_id = $2 AND u.is_active = true AND r.id = ANY($1::int[]) LIMIT 1`,
                [fullRoleIds, req.company.id]
            );
            if (activeHolder.rows.length === 0) {
                return res.status(403).json({
                    error: `Cannot remove ${guardKey} from ${role.name} -- no active user in this company would still hold it.`,
                });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const changes = {};
            for (const [key, scope] of Object.entries(updates)) {
                if (scope === 'none') {
                    await client.query(
                        `DELETE FROM role_permissions WHERE role_id = $1 AND capability_key = $2`,
                        [roleId, key]
                    );
                } else {
                    await client.query(
                        `INSERT INTO role_permissions (role_id, capability_key, scope, updated_by, updated_at)
                         VALUES ($1, $2, $3, $4, now())
                         ON CONFLICT (role_id, capability_key) DO UPDATE SET
                            scope = EXCLUDED.scope, updated_by = EXCLUDED.updated_by, updated_at = now()`,
                        [roleId, key, scope, req.user.id]
                    );
                }
                changes[key] = scope;
            }
            await client.query('COMMIT');

            // Phase C: any can() call already resolved for this role is now
            // stale -- drop the whole cache (cheap; it only ever holds a
            // handful of entries) so the new scopes apply to the very next
            // request, not just future logins.
            clearScopeCache();

            await logAudit(null, {
                companyId: req.company.id,
                entityType: 'role_permissions',
                entityId: roleId,
                action: 'updated',
                actor: req.user,
                details: { role: role.name, changes },
            });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        const permRes = await pool.query(
            `SELECT c.key, c.module, c.label, c.supports_scope, c.is_baseline,
                    CASE WHEN c.is_baseline THEN 'full' ELSE COALESCE(rp.scope, 'none') END AS scope
             FROM capabilities c
             LEFT JOIN role_permissions rp ON rp.capability_key = c.key AND rp.role_id = $1
             ORDER BY c.module, c.key`,
            [roleId]
        );
        res.json({ role, permissions: permRes.rows });
    })
);

// ============================================================
// Org Roles -- A2: Role -> Person -> Department mapping, used as a
// reference when filling in RACI fields on Risks/Controls/Policies.
// ============================================================

app.get(
    '/api/org-roles',
    can('org_roles.view'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    asyncHandler(async (req, res) => {
        const result = await pool.query(`
            SELECT
                'user-' || u.id AS id,
                COALESCE(NULLIF(uc.functional_role, ''), uc.role) AS role_title,
                u.full_name AS person_name,
                uc.department,
                u.email,
                'system' AS source
            FROM user_companies uc
            JOIN users u ON u.id = uc.user_id
            WHERE uc.company_id = $1
            UNION ALL
            SELECT
                id::text,
                role_title,
                person_name,
                department,
                email,
                'manual' AS source
            FROM org_roles
            WHERE company_id = $1
              AND (email IS NULL OR email = '' OR NOT EXISTS (
                  SELECT 1 FROM user_companies uc2
                  JOIN users u2 ON u2.id = uc2.user_id
                  WHERE uc2.company_id = $1
                    AND lower(u2.email) = lower(org_roles.email)
              ))
            ORDER BY department NULLS LAST, role_title
        `, [req.company.id]);
        res.json(result.rows);
    })
);

app.post(
    '/api/org-roles',
    can('org_roles.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        if (!req.body.role_title || !req.body.person_name) {
            return res.status(400).json({ error: 'role_title and person_name are required' });
        }
        const result = await pool.query(
            `INSERT INTO org_roles (company_id, role_title, person_name, department, email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.company.id, req.body.role_title, req.body.person_name, req.body.department || null, req.body.email || null]
        );
        res.status(201).json(result.rows[0]);
    })
);

app.patch(
    '/api/org-roles/:id',
    can('org_roles.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const fields = ['role_title', 'person_name', 'department', 'email'];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE org_roles SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    })
);

app.delete(
    '/api/org-roles/:id',
    can('org_roles.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM org_roles WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        res.json({ message: 'Deleted' });
    })
);

// ============================================================
// RACI Matrix
// ============================================================

const DEFAULT_RACI = [
    { module: 'Risk Register',          sort_order: 10,  activity: 'Identify and submit risk',      admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: 'R', viewer: 'I' },
    { module: 'Risk Register',          sort_order: 20,  activity: 'Assess and score risk',          admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'R', submitter: 'C', viewer: 'I' },
    { module: 'Risk Register',          sort_order: 30,  activity: 'Approve risk rating',            admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'C', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Risk Register',          sort_order: 40,  activity: 'Escalate critical risk',         admin: 'I',   cro: 'R/A', consultant_cro: 'C', manager: 'C', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Risk Register',          sort_order: 50,  activity: 'Review and close risk',          admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Control Library',        sort_order: 110, activity: 'Define or update control',       admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: '',  viewer: 'I' },
    { module: 'Control Library',        sort_order: 120, activity: 'Execute control test',           admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'R', submitter: '',  viewer: 'I' },
    { module: 'Control Library',        sort_order: 130, activity: 'Upload test evidence',           admin: 'I',   cro: 'I',   consultant_cro: 'I', manager: 'R', approver: 'R', submitter: '',  viewer: 'I' },
    { module: 'Control Library',        sort_order: 140, activity: 'Approve test result',            admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'A', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'KRI',                    sort_order: 210, activity: 'Define KRI and thresholds',      admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: '',  viewer: 'I' },
    { module: 'KRI',                    sort_order: 220, activity: 'Record KRI measurement',         admin: 'I',   cro: 'I',   consultant_cro: 'I', manager: 'R', approver: 'R', submitter: '',  viewer: 'I' },
    { module: 'KRI',                    sort_order: 230, activity: 'Review KRI breaches',            admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: '',  viewer: 'I' },
    { module: 'Issues and Actions',     sort_order: 310, activity: 'Raise issue',                    admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: 'R', viewer: 'I' },
    { module: 'Issues and Actions',     sort_order: 320, activity: 'Assign owner department',        admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Issues and Actions',     sort_order: 330, activity: 'Develop remediation plan',       admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'R', submitter: '',  viewer: 'I' },
    { module: 'Issues and Actions',     sort_order: 340, activity: 'Verify issue closure',           admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'A', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Compliance Obligations', sort_order: 410, activity: 'Add or update obligation',       admin: 'I',   cro: 'A',   consultant_cro: 'R', manager: 'R', approver: 'C', submitter: '',  viewer: 'I' },
    { module: 'Compliance Obligations', sort_order: 420, activity: 'Monitor obligation status',      admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'R', submitter: '',  viewer: 'I' },
    { module: 'Compliance Obligations', sort_order: 430, activity: 'Escalate overdue obligation',    admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Policy Repository',      sort_order: 510, activity: 'Draft or update policy',         admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: 'C', submitter: '',  viewer: 'I' },
    { module: 'Policy Repository',      sort_order: 520, activity: 'Approve and publish policy',     admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'C', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Policy Repository',      sort_order: 530, activity: 'Acknowledge policy',             admin: 'I',   cro: 'I',   consultant_cro: 'I', manager: 'I', approver: 'I', submitter: 'R', viewer: 'I' },
    { module: 'Governance',             sort_order: 610, activity: 'Review management summary',      admin: 'I',   cro: 'A',   consultant_cro: 'C', manager: 'R', approver: '',  submitter: '',  viewer: 'I' },
    { module: 'Governance',             sort_order: 630, activity: 'View compliance calendar',       admin: 'I',   cro: 'I',   consultant_cro: 'I', manager: 'I', approver: 'I', submitter: 'I', viewer: 'I' },
    { module: 'System Administration',  sort_order: 710, activity: 'Manage users and access',       admin: 'R/A', cro: 'I',   consultant_cro: '',  manager: '',  approver: '',  submitter: '',  viewer: '' },
    { module: 'System Administration',  sort_order: 720, activity: 'Configure departments',         admin: 'R/A', cro: 'I',   consultant_cro: '',  manager: '',  approver: '',  submitter: '',  viewer: '' },
    { module: 'System Administration',  sort_order: 730, activity: 'Manage escalation rules',       admin: 'R/A', cro: 'C',   consultant_cro: '',  manager: '',  approver: '',  submitter: '',  viewer: '' },
    { module: 'System Administration',  sort_order: 740, activity: 'Import and export data',        admin: 'R/A', cro: 'C',   consultant_cro: '',  manager: '',  approver: '',  submitter: '',  viewer: '' },
];

async function seedRaciForCompany(client, companyId) {
    for (const row of DEFAULT_RACI) {
        await client.query(
            `INSERT INTO raci_matrix
                (company_id, module, activity, admin, cro, consultant_cro, manager, approver, submitter, viewer, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (company_id, module, activity) DO NOTHING`,
            [companyId, row.module, row.activity, row.admin, row.cro, row.consultant_cro,
             row.manager, row.approver, row.submitter, row.viewer, row.sort_order]
        );
    }
}

app.get(
    '/api/raci-matrix',
    can('raci.view'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    asyncHandler(async (req, res) => {
        let result = await pool.query(
            'SELECT * FROM raci_matrix WHERE company_id = $1 ORDER BY sort_order',
            [req.company.id]
        );
        if (result.rows.length === 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await seedRaciForCompany(client, req.company.id);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
            result = await pool.query(
                'SELECT * FROM raci_matrix WHERE company_id = $1 ORDER BY sort_order',
                [req.company.id]
            );
        }
        res.json(result.rows);
    })
);

const VALID_RACI_VALUES = new Set(['', 'R', 'A', 'C', 'I', 'R/A']);
const RACI_ROLE_COLS = ['admin', 'cro', 'consultant_cro', 'manager', 'approver', 'submitter', 'viewer'];

app.patch(
    '/api/raci-matrix/:id',
    can('raci.edit'), // Phase C cutover -- was requireRole('Admin', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const updates = [];
        const values = [];
        for (const col of RACI_ROLE_COLS) {
            if (req.body[col] !== undefined) {
                if (!VALID_RACI_VALUES.has(req.body[col])) {
                    return res.status(400).json({ error: `Invalid RACI value: ${req.body[col]}` });
                }
                values.push(req.body[col]);
                updates.push(`${col} = $${values.length}`);
            }
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(new Date());
        updates.push(`updated_at = $${values.length}`);
        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE raci_matrix SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    })
);

// ============================================================
// Policy & Procedure Repository (A1) — /api/policies/*
// ============================================================
// Lifecycle: Draft -> Under Review -> Approved -> Published -> Archived,
// gated per-transition by POLICY_TRANSITIONS below (not a flat role list).
// Confidential policies have a separate Admin-only access list
// (/:id/access) layered on top of the normal view permission.

// Bug fix (2026-07-22): these lists used to list only 'Admin', not 'Super
// Admin'. requireRole()'s outer gate explicitly bypasses both literal role
// strings (line ~1038: `role === 'Admin' || role === 'Super Admin'`), but this
// inner exact-match check did not, so any account whose company.role is
// literally 'Super Admin' (not normalized to 'Admin' -- see the /company
// middleware's is_super_admin-boolean path vs. a plain user_companies.role =
// 'Super Admin' assignment) could reach this handler via the outer gate and
// then get silently 403'd on every single transition. Confirmed this is the
// live Qatar Post admin account's actual state (dashboard sidebar renders
// activeCompany.role directly, and shows "Super Admin"), so this was a real
// production gap, not just a test artifact.
const POLICY_TRANSITIONS = {
    Draft: { 'Under Review': ['Admin', 'Super Admin', 'Risk Manager', 'Risk Owner'] },
    'Under Review': { Draft: ['Admin', 'Super Admin', 'Risk Manager', 'Risk Owner'], Approved: ['Admin', 'Super Admin', 'Risk Owner'] },
    Approved: { Published: ['Admin', 'Super Admin', 'Risk Owner'], Draft: ['Admin', 'Super Admin', 'Risk Manager', 'Risk Owner'] },
    Published: { Archived: ['Admin', 'Super Admin'] },
};

async function attachPolicyMeta(client, policies) {
    if (policies.length === 0) return policies;
    const ids = policies.map((p) => p.id);
    const companyId = policies[0].company_id;

    const [linksRiskRes, linksControlRes, linksObligationRes, attestRes, usersRes] = await Promise.all([
        client.query(
            `SELECT pr.policy_id, r.id, r.risk_uid FROM policy_risks pr JOIN risks r ON r.id = pr.risk_id WHERE pr.policy_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT pc.policy_id, cl.id, cl.control_uid, cl.name FROM policy_controls pc JOIN controls_lib cl ON cl.id = pc.control_id WHERE pc.policy_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT op.policy_id, co.id, co.obligation_uid, co.regulation_name FROM obligation_policies op JOIN compliance_obligations co ON co.id = op.obligation_id WHERE op.policy_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(`SELECT policy_id, user_email, acknowledged_at FROM policy_attestations WHERE policy_id = ANY($1::int[])`, [ids]),
        client.query(
            `SELECT u.email FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.company_id = $1 AND u.is_active = true`,
            [companyId]
        ),
    ]);

    const risksByPolicy = {};
    for (const r of linksRiskRes.rows) (risksByPolicy[r.policy_id] = risksByPolicy[r.policy_id] || []).push({ id: r.id, risk_uid: r.risk_uid });

    const controlsByPolicy = {};
    for (const c of linksControlRes.rows)
        (controlsByPolicy[c.policy_id] = controlsByPolicy[c.policy_id] || []).push({ id: c.id, control_uid: c.control_uid, name: c.name });

    const obligationsByPolicy = {};
    for (const o of linksObligationRes.rows)
        (obligationsByPolicy[o.policy_id] = obligationsByPolicy[o.policy_id] || []).push({ id: o.id, obligation_uid: o.obligation_uid, regulation_name: o.regulation_name });

    const attestByPolicy = {};
    for (const a of attestRes.rows) (attestByPolicy[a.policy_id] = attestByPolicy[a.policy_id] || []).push(a);

    const totalUsers = usersRes.rows.length;

    return policies.map((p) => ({
        ...p,
        linked_risks: risksByPolicy[p.id] || [],
        linked_controls: controlsByPolicy[p.id] || [],
        linked_obligations: obligationsByPolicy[p.id] || [],
        attestation_count: (attestByPolicy[p.id] || []).length,
        total_users: totalUsers,
    }));
}

app.get(
    '/api/policies',
    can('policy.view'), // Phase C cutover -- was ungated (any authenticated role); policy.view is seeded 'full' for all 8 roles, so this is explicit rather than a behavior change
    asyncHandler(async (req, res) => {
        // Viewers see the latest PUBLISHED version only.
        // Confidential policies are hidden from users who lack an explicit access grant,
        // unless they are Admin. Admins always see everything.
        const userId = req.user.id;
        const isAdmin = req.company.role === 'Admin';

        const confidentialClause = isAdmin
            ? ''
            : `AND (p.confidential = FALSE OR EXISTS (SELECT 1 FROM policy_access pa WHERE pa.policy_id = p.id AND pa.user_id = ${userId}))`;

        const result =
            req.company.role === 'Viewer'
                ? await pool.query(
                      `SELECT p.* FROM policies p
                       WHERE p.company_id = $1 AND p.status = 'Published'
                         AND p.version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid AND p2.status = 'Published')
                         ${confidentialClause}
                       ORDER BY p.policy_uid`,
                      [req.company.id]
                  )
                : await pool.query(
                      `SELECT p.* FROM policies p
                       WHERE p.company_id = $1
                         AND p.version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid)
                         ${confidentialClause}
                       ORDER BY p.policy_uid`,
                      [req.company.id]
                  );
        res.json(await attachPolicyMeta(pool, result.rows));
    })
);

app.get(
    '/api/policies/:uid/history',
    can('policy.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'); no dedicated view_history capability exists for policies, policy.edit's seed matches this role list exactly
    asyncHandler(async (req, res) => {
        const result = await pool.query('SELECT * FROM policies WHERE company_id = $1 AND policy_uid = $2 ORDER BY version DESC', [
            req.company.id,
            req.params.uid,
        ]);
        res.json(result.rows);
    })
);

app.post(
    '/api/policies',
    can('policy.create'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    validate(schemas.createPolicy),
    asyncHandler(async (req, res) => {

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const uid = await generateUnique4PartID(client, req.company.id, 'policies', 'policy_uid', 'POL', null);
            const insertRes = await client.query(
                `INSERT INTO policies (company_id, policy_uid, version, name, category, description, content_owner, approver,
                                        review_frequency, next_review_date, created_by, confidential)
                 VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [
                    req.company.id,
                    uid,
                    req.body.name,
                    req.body.category || 'Governance',
                    req.body.description || null,
                    req.body.content_owner || null,
                    req.body.approver || null,
                    req.body.review_frequency || 'Annual',
                    req.body.next_review_date || null,
                    req.user.email,
                    req.body.confidential === true || req.body.confidential === 'true' ? true : false,
                ]
            );
            const policy = insertRes.rows[0];

            for (const riskId of req.body.link_risk_ids || []) {
                await client.query('INSERT INTO policy_risks (policy_id, risk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [policy.id, riskId]);
            }
            for (const controlId of req.body.link_control_ids || []) {
                await client.query('INSERT INTO policy_controls (policy_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                    policy.id,
                    controlId,
                ]);
            }
            for (const obligationId of req.body.link_obligation_ids || []) {
                await client.query('INSERT INTO obligation_policies (obligation_id, policy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                    obligationId,
                    policy.id,
                ]);
            }
            // Grant access to specific users for confidential policies
            for (const userId of req.body.access_user_ids || []) {
                await client.query(
                    'INSERT INTO policy_access (policy_id, user_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [policy.id, userId, req.user.id]
                );
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'policy',
                entityId: policy.id,
                action: 'create',
                actor: req.user,
                details: { policy_uid: uid, name: policy.name },
            });

            await client.query('COMMIT');
            const [enriched] = await attachPolicyMeta(pool, [policy]);
            res.status(201).json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Edits are only permitted while a policy is in Draft -- once it enters
// review/approval, changes require a new version (see /new-version below).
app.patch(
    '/api/policies/:id',
    can('policy.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const current = await pool.query('SELECT * FROM policies WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Policy not found' });
        if (current.rows[0].status !== 'Draft') {
            return res.status(400).json({ error: 'Only Draft policies can be edited directly. Create a new version instead.' });
        }

        const fields = ['name', 'category', 'description', 'content_owner', 'approver', 'review_frequency', 'next_review_date', 'confidential'];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let updated = current.rows[0];
            if (updates.length > 0) {
                values.push(req.params.id);
                const result = await client.query(`UPDATE policies SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
                updated = result.rows[0];
            }

            if (req.body.link_risk_ids) {
                await client.query('DELETE FROM policy_risks WHERE policy_id = $1', [req.params.id]);
                for (const riskId of req.body.link_risk_ids) {
                    await client.query('INSERT INTO policy_risks (policy_id, risk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                        req.params.id,
                        riskId,
                    ]);
                }
            }
            if (req.body.link_control_ids) {
                await client.query('DELETE FROM policy_controls WHERE policy_id = $1', [req.params.id]);
                for (const controlId of req.body.link_control_ids) {
                    await client.query('INSERT INTO policy_controls (policy_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                        req.params.id,
                        controlId,
                    ]);
                }
            }
            if (req.body.link_obligation_ids) {
                await client.query('DELETE FROM obligation_policies WHERE policy_id = $1', [req.params.id]);
                for (const obligationId of req.body.link_obligation_ids) {
                    await client.query('INSERT INTO obligation_policies (obligation_id, policy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
                        obligationId,
                        req.params.id,
                    ]);
                }
            }
            if (req.body.access_user_ids) {
                await client.query('DELETE FROM policy_access WHERE policy_id = $1', [req.params.id]);
                for (const userId of req.body.access_user_ids) {
                    await client.query(
                        'INSERT INTO policy_access (policy_id, user_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                        [req.params.id, userId, req.user.id]
                    );
                }
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'policy',
                entityId: updated.id,
                action: 'update',
                actor: req.user,
                details: req.body,
            });

            await client.query('COMMIT');
            const [enriched] = await attachPolicyMeta(pool, [updated]);
            res.json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Workflow: Draft -> Under Review -> Approved -> Published -> Archived
// (with Under Review/Approved able to bounce back to Draft for rework).
// Approve and Publish require Admin (the "Risk Owner" role in our 3-role model).
app.post(
    '/api/policies/:id/transition',
    can('policy.transition'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO'); this is only the outer gate -- POLICY_TRANSITIONS below still does its own per-transition role check unchanged
    asyncHandler(async (req, res) => {
        const targetStatus = req.body.status;
        const current = await pool.query('SELECT * FROM policies WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Policy not found' });
        const policy = current.rows[0];

        const allowed = POLICY_TRANSITIONS[policy.status] || {};
        const allowedRoles = allowed[targetStatus];
        if (!allowedRoles) {
            return res.status(400).json({ error: `Cannot transition from ${policy.status} to ${targetStatus}` });
        }
        if (!allowedRoles.includes(req.company.role)) {
            return res.status(403).json({ error: `Only ${allowedRoles.join('/')} can move a policy from ${policy.status} to ${targetStatus}` });
        }

        const setEffectiveDate = targetStatus === 'Published' && !policy.effective_date;
        const result = await pool.query(
            setEffectiveDate
                ? `UPDATE policies SET status = $1, effective_date = CURRENT_DATE WHERE id = $2 RETURNING *`
                : `UPDATE policies SET status = $1 WHERE id = $2 RETURNING *`,
            [targetStatus, req.params.id]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'policy',
            entityId: policy.id,
            action: 'transition',
            actor: req.user,
            details: { from: policy.status, to: targetStatus },
        });

        const [enriched] = await attachPolicyMeta(pool, result.rows);
        res.json(enriched);
    })
);

// Creates a new Draft revision of a Published/Archived policy, carrying
// forward its fields and links. The prior version remains in history.
app.post(
    '/api/policies/:id/new-version',
    can('policy.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const current = await client.query('SELECT * FROM policies WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Policy not found' });
            }
            const source = current.rows[0];
            if (!['Published', 'Archived'].includes(source.status)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'A new version can only be created from a Published or Archived policy' });
            }

            const insertRes = await client.query(
                `INSERT INTO policies (company_id, policy_uid, version, name, category, description, content_owner, approver,
                                        review_frequency, next_review_date, created_by, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Draft') RETURNING *`,
                [
                    source.company_id,
                    source.policy_uid,
                    source.version + 1,
                    source.name,
                    source.category,
                    source.description,
                    source.content_owner,
                    source.approver,
                    source.review_frequency,
                    null, // next_review_date is re-set when the revision is published
                    req.user.email,
                ]
            );
            const newVersion = insertRes.rows[0];

            await client.query(
                `INSERT INTO policy_risks (policy_id, risk_id) SELECT $1, risk_id FROM policy_risks WHERE policy_id = $2`,
                [newVersion.id, source.id]
            );
            await client.query(
                `INSERT INTO policy_controls (policy_id, control_id) SELECT $1, control_id FROM policy_controls WHERE policy_id = $2`,
                [newVersion.id, source.id]
            );

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'policy',
                entityId: newVersion.id,
                action: 'new_version',
                actor: req.user,
                details: { policy_uid: source.policy_uid, version: newVersion.version, supersedes: source.id },
            });

            await client.query('COMMIT');
            const [enriched] = await attachPolicyMeta(pool, [newVersion]);
            res.status(201).json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Attestation (A1: "who has read & accepted, with timestamps").
// Restricted to roles with genuine authority to acknowledge a policy.
// Viewers are excluded — they can read policies but cannot formally attest.
app.post(
    '/api/policies/:id/attest',
    can('policy.attest'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO')
    asyncHandler(async (req, res) => {
        const policyRes = await pool.query('SELECT * FROM policies WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (policyRes.rows.length === 0) return res.status(404).json({ error: 'Policy not found' });
        if (policyRes.rows[0].status !== 'Published') {
            return res.status(400).json({ error: 'Only Published policies can be attested to' });
        }

        const result = await pool.query(
            `INSERT INTO policy_attestations (policy_id, user_email) VALUES ($1, $2)
             ON CONFLICT (policy_id, user_email) DO UPDATE SET acknowledged_at = now() RETURNING *`,
            [req.params.id, req.user.email]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'policy',
            entityId: policyRes.rows[0].id,
            action: 'attest',
            actor: req.user,
        });

        res.status(201).json(result.rows[0]);
    })
);

app.get(
    '/api/policies/:id/attestations',
    can('policy.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'); same shape as the history route above, reusing policy.edit
    asyncHandler(async (req, res) => {
        const policyRes = await pool.query('SELECT * FROM policies WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (policyRes.rows.length === 0) return res.status(404).json({ error: 'Policy not found' });

        const [attested, allUsers] = await Promise.all([
            pool.query('SELECT user_email, acknowledged_at FROM policy_attestations WHERE policy_id = $1 ORDER BY acknowledged_at', [req.params.id]),
            pool.query(
                `SELECT u.email FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.company_id = $1 AND u.is_active = true ORDER BY u.email`,
                [req.company.id]
            ),
        ]);

        const attestedEmails = new Set(attested.rows.map((a) => a.user_email));
        res.json({
            attested: attested.rows,
            outstanding: allUsers.rows.map((u) => u.email).filter((e) => !attestedEmails.has(e)),
        });
    })
);

// Policy confidential access management (Admin only)
app.get(
    '/api/policies/:id/access',
    can('policy.manage_confidential_access'), // Phase C cutover -- was requireRole('Admin')
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT pa.user_id, u.email, u.full_name, pa.granted_at
             FROM policy_access pa JOIN users u ON u.id = pa.user_id
             WHERE pa.policy_id = $1`,
            [req.params.id]
        );
        res.json(result.rows);
    })
);

app.post(
    '/api/policies/:id/access',
    can('policy.manage_confidential_access'), // Phase C cutover -- was requireRole('Admin')
    asyncHandler(async (req, res) => {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        await pool.query(
            'INSERT INTO policy_access (policy_id, user_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [req.params.id, user_id, req.user.id]
        );
        res.status(201).json({ ok: true });
    })
);

app.delete(
    '/api/policies/:id/access/:userId',
    can('policy.manage_confidential_access'), // Phase C cutover -- was requireRole('Admin')
    asyncHandler(async (req, res) => {
        await pool.query('DELETE FROM policy_access WHERE policy_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
        res.json({ ok: true });
    })
);

// ============================================================
// Compliance Obligations Register (C1)
// ============================================================

async function attachObligationLinks(client, obligations) {
    if (obligations.length === 0) return obligations;
    const ids = obligations.map((o) => o.id);

    const [policiesRes, controlsRes, krisRes, risksRes, historyRes, issuesRes] = await Promise.all([
        client.query(
            `SELECT op.obligation_id, p.id, p.policy_uid, p.name FROM obligation_policies op
             JOIN policies p ON p.id = op.policy_id WHERE op.obligation_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT oc.obligation_id, cl.id, cl.control_uid, cl.name FROM obligation_controls oc
             JOIN controls_lib cl ON cl.id = oc.control_id WHERE oc.obligation_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT ok.obligation_id, k.id, k.kri_uid, k.name FROM obligation_kris ok
             JOIN kris k ON k.id = ok.kri_id WHERE ok.obligation_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT orr.obligation_id, r.id, r.risk_uid FROM obligation_risks orr
             JOIN risks r ON r.id = orr.risk_id WHERE orr.obligation_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT * FROM (
                SELECT obligation_id, status, changed_at,
                       ROW_NUMBER() OVER (PARTITION BY obligation_id ORDER BY changed_at DESC, id DESC) AS rn
                FROM obligation_status_history WHERE obligation_id = ANY($1::int[])
             ) sub WHERE rn = 1`,
            [ids]
        ),
        client.query(
            `SELECT io.obligation_id, COUNT(*) AS cnt FROM issue_obligations io
             JOIN issues i ON i.id = io.issue_id
             WHERE io.obligation_id = ANY($1::int[]) AND i.status = ANY($2::text[])
             GROUP BY io.obligation_id`,
            [ids, OPEN_ISSUE_STATUSES]
        ),
    ]);

    const group = (rows, mapper) => {
        const byId = {};
        for (const row of rows) (byId[row.obligation_id] = byId[row.obligation_id] || []).push(mapper(row));
        return byId;
    };

    const policiesByObl = group(policiesRes.rows, (p) => ({ id: p.id, policy_uid: p.policy_uid, name: p.name }));
    const controlsByObl = group(controlsRes.rows, (c) => ({ id: c.id, control_uid: c.control_uid, name: c.name }));
    const krisByObl = group(krisRes.rows, (k) => ({ id: k.id, kri_uid: k.kri_uid, name: k.name }));
    const risksByObl = group(risksRes.rows, (r) => ({ id: r.id, risk_uid: r.risk_uid }));

    const lastStatusChangeByObl = {};
    for (const h of historyRes.rows) lastStatusChangeByObl[h.obligation_id] = h.changed_at;

    const openIssuesByObl = {};
    for (const row of issuesRes.rows) openIssuesByObl[row.obligation_id] = parseInt(row.cnt, 10);

    return obligations.map((o) => ({
        ...o,
        linked_policies: policiesByObl[o.id] || [],
        linked_controls: controlsByObl[o.id] || [],
        linked_kris: krisByObl[o.id] || [],
        linked_risks: risksByObl[o.id] || [],
        status_last_changed: lastStatusChangeByObl[o.id] || null,
        open_issues_count: openIssuesByObl[o.id] || 0,
    }));
}

async function linkObligation(client, obligationId, body) {
    for (const policyId of body.link_policy_ids || []) {
        await client.query('INSERT INTO obligation_policies (obligation_id, policy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
            obligationId,
            policyId,
        ]);
    }
    for (const controlId of body.link_control_ids || []) {
        await client.query('INSERT INTO obligation_controls (obligation_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
            obligationId,
            controlId,
        ]);
    }
    for (const kriId of body.link_kri_ids || []) {
        await client.query('INSERT INTO obligation_kris (obligation_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [obligationId, kriId]);
    }
    for (const riskId of body.link_risk_ids || []) {
        await client.query('INSERT INTO obligation_risks (obligation_id, risk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [obligationId, riskId]);
    }
}

app.get(
    '/api/obligations',
    can('obligation.view'), // Phase C cutover -- was requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    asyncHandler(async (req, res) => {
        const scope = managerScopeClause(req, 'applicable_to', 2);
        const result = await pool.query(
            `SELECT * FROM compliance_obligations WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY obligation_uid`,
            scope ? [req.company.id, scope.value] : [req.company.id]
        );
        res.json(await attachObligationLinks(pool, result.rows));
    })
);

app.post(
    '/api/obligations',
    can('obligation.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    validate(schemas.createObligation),
    asyncHandler(async (req, res) => {

        const deptResult = resolveDepartmentForWrite(req, req.body.applicable_to);
        if (deptResult.error) return res.status(400).json({ error: deptResult.error });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const uid = await generateUnique4PartID(client, req.company.id, 'compliance_obligations', 'obligation_uid', 'OBL', deptResult.department || null);

            const insertRes = await client.query(
                `INSERT INTO compliance_obligations (
                    company_id, obligation_uid, regulatory_body, regulation_name, reference, description, applicable_to,
                    compliance_status, obligation_owner, evidence_of_compliance, reporting_requirement, next_reporting_date,
                    last_reviewed_date, next_review_date, created_by
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
                [
                    req.company.id,
                    uid,
                    req.body.regulatory_body || null,
                    req.body.regulation_name,
                    req.body.reference || null,
                    req.body.description || null,
                    deptResult.department || null,
                    req.body.compliance_status || 'Not Yet Assessed',
                    req.body.obligation_owner || null,
                    req.body.evidence_of_compliance || null,
                    req.body.reporting_requirement || null,
                    req.body.next_reporting_date || null,
                    req.body.last_reviewed_date || null,
                    req.body.next_review_date || null,
                    req.user.email,
                ]
            );
            const obligation = insertRes.rows[0];

            await linkObligation(client, obligation.id, req.body);

            // Seed the status history so "last changed" is meaningful from creation.
            await client.query('INSERT INTO obligation_status_history (obligation_id, status, notes, changed_by) VALUES ($1,$2,$3,$4)', [
                obligation.id,
                obligation.compliance_status,
                'Initial assessment on creation',
                req.user.email,
            ]);

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'obligation',
                entityId: obligation.id,
                action: 'create',
                actor: req.user,
                details: { obligation_uid: uid, regulation_name: obligation.regulation_name },
            });

            await client.query('COMMIT');
            const [enriched] = await attachObligationLinks(pool, [obligation]);
            res.status(201).json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.patch(
    '/api/obligations/:id',
    can('obligation.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const fields = [
            'regulatory_body',
            'regulation_name',
            'reference',
            'description',
            'obligation_owner',
            'evidence_of_compliance',
            'reporting_requirement',
            'next_reporting_date',
            'last_reviewed_date',
            'next_review_date',
        ];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const current = await client.query('SELECT * FROM compliance_obligations WHERE id = $1 AND company_id = $2', [
                req.params.id,
                req.company.id,
            ]);
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Obligation not found' });
            }
            if (!await managerCanAccess(req, current.rows[0].applicable_to)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This obligation belongs to a different department.' });
            }

            if (req.body.applicable_to !== undefined) {
                const deptResult = resolveDepartmentForWrite(req, req.body.applicable_to);
                if (deptResult.error) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: deptResult.error });
                }
                values.push(deptResult.department);
                updates.push(`applicable_to = $${values.length}`);
            }

            let updated = current.rows[0];
            if (updates.length > 0) {
                values.push(req.params.id);
                const result = await client.query(
                    `UPDATE compliance_obligations SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
                    values
                );
                updated = result.rows[0];
            }

            // Relinking replaces the full set for whichever link arrays were provided.
            if (req.body.link_policy_ids) await client.query('DELETE FROM obligation_policies WHERE obligation_id = $1', [req.params.id]);
            if (req.body.link_control_ids) await client.query('DELETE FROM obligation_controls WHERE obligation_id = $1', [req.params.id]);
            if (req.body.link_kri_ids) await client.query('DELETE FROM obligation_kris WHERE obligation_id = $1', [req.params.id]);
            if (req.body.link_risk_ids) await client.query('DELETE FROM obligation_risks WHERE obligation_id = $1', [req.params.id]);
            await linkObligation(client, req.params.id, req.body);

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'obligation',
                entityId: updated.id,
                action: 'update',
                actor: req.user,
                details: req.body,
            });

            await client.query('COMMIT');
            const [enriched] = await attachObligationLinks(pool, [updated]);
            res.json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Compliance status changes are recorded as their own history entries
// (G10 audit trail) -- this is exactly what auditors ask "show me how
// and when this assessment changed" about.
app.post(
    '/api/obligations/:id/status',
    can('obligation.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'); no dedicated status-change capability seeded, reuses obligation.manage (identical role/scope shape)
    asyncHandler(async (req, res) => {
        const { status, notes } = req.body;
        if (!['Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Yet Assessed'].includes(status)) {
            return res.status(400).json({ error: 'status must be Compliant, Partially Compliant, Non-Compliant, or Not Yet Assessed' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query('SELECT * FROM compliance_obligations WHERE id = $1 AND company_id = $2', [
                req.params.id,
                req.company.id,
            ]);
            if (existing.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Obligation not found' });
            }
            if (!await managerCanAccess(req, existing.rows[0].applicable_to)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This obligation belongs to a different department.' });
            }

            const result = await client.query(
                `UPDATE compliance_obligations SET compliance_status = $1, last_reviewed_date = CURRENT_DATE
                 WHERE id = $2 AND company_id = $3 RETURNING *`,
                [status, req.params.id, req.company.id]
            );

            await client.query('INSERT INTO obligation_status_history (obligation_id, status, notes, changed_by) VALUES ($1,$2,$3,$4)', [
                req.params.id,
                status,
                notes || null,
                req.user.email,
            ]);

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'obligation',
                entityId: result.rows[0].id,
                action: 'status_change',
                actor: req.user,
                details: { status, notes },
            });

            // D: a Non-Compliant assessment logs a Management Review issue
            // automatically, flagged for regulatory notification review.
            let createdIssue = null;
            if (status === 'Non-Compliant') {
                const obligation = result.rows[0];
                createdIssue = await createIssue(client, req.company.id, req.user.email, {
                    source_type: 'Self-identified (Management Review)',
                    source_detail: notes || `Compliance status set to Non-Compliant`,
                    description: `Obligation ${obligation.obligation_uid} (${obligation.regulation_name}) assessed Non-Compliant`,
                    owner: obligation.obligation_owner || null,
                    priority: 'High',
                    regulatory_notification_required: true,
                    regulatory_notification_deadline: obligation.next_reporting_date || null,
                    department: obligation.applicable_to || null,
                    raised_by_dept: obligation.applicable_to || null,
                    link_obligation_ids: [obligation.id],
                    auto: true,
                });
            }

            await client.query('COMMIT');
            const [enriched] = await attachObligationLinks(pool, result.rows);
            res.json({ ...enriched, created_issue: createdIssue });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.get(
    '/api/obligations/:id/history',
    can('obligation.view_history'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO')
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT h.* FROM obligation_status_history h
             JOIN compliance_obligations o ON o.id = h.obligation_id
             WHERE h.obligation_id = $1 AND o.company_id = $2 ORDER BY h.changed_at DESC`,
            [req.params.id, req.company.id]
        );
        res.json(result.rows);
    })
);


app.get(
    '/api/audit-log',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO'),
    // RBAC-02: Viewer excluded — audit log contains company-wide change history.
    // This backend decision IS intentional, but Layout.jsx's NAV_ITEMS still
    // shows the Audit Log sidebar link to Viewer regardless — so a Viewer
    // sees a working-looking link that 403s when clicked. The frontend nav
    // item is the actual bug here, not this role list. See
    // Documents/Internal/RBAC_Permissions_Engine_Scoping.docx Finding 2.
    asyncHandler(async (req, res) => {
        const { entity_type, entity_id } = req.query;
        const conditions = ['company_id = $1'];
        const params = [req.company.id];

        if (entity_type) {
            params.push(entity_type);
            conditions.push(`entity_type = $${params.length}`);
        }
        if (entity_id) {
            params.push(parseInt(entity_id, 10));
            conditions.push(`entity_id = $${params.length}`);
        }

        const result = await pool.query(
            `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY changed_at DESC LIMIT 200`,
            params
        );
        res.json(result.rows);
    })
);

// Security event log — filtered view of audit_log for security-relevant
// actions only. Admin-only. Satisfies SOC 2 CC7.2 (monitor for anomalies).
const SECURITY_EVENT_ACTIONS = [
    'login_failed',
    'account_locked',
    'mfa_verify_failed',
    'mfa_enrolled',
    'login',
    'password_changed',
    'password_reset_requested',
    'password_reset_completed',
    'logout',
];

app.get(
    '/api/admin/security-log',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const placeholders = SECURITY_EVENT_ACTIONS.map((_, i) => `$${i + 2}`).join(', ');
        const result = await pool.query(
            `SELECT * FROM audit_log
             WHERE company_id = $1
               AND action = ANY(ARRAY[${placeholders}])
             ORDER BY changed_at DESC
             LIMIT 500`,
            [req.company.id, ...SECURITY_EVENT_ACTIONS]
        );
        res.json(result.rows);
    })
);

// ============================================================
// Issues & Actions Tracker (D) — /api/issues/*
// ============================================================
// Separation-of-duties is enforced here by identity comparison
// (created_by vs the acting user), independent of role — a business
// rule, not a permission check, and deliberately NOT something the RBAC
// engine scoping in Documents/Internal/RBAC_Permissions_Engine_Scoping.docx
// would change (see that doc's section 5.2).

const OPEN_ISSUE_STATUSES = ['Open', 'In Progress'];

// Creates an issue and links it to whichever entities triggered it.
// Shared by the manual POST /api/issues endpoint and the automatic
// hooks below (control test failures, KRI breaches, non-compliance).
async function createIssue(client, companyId, actorEmail, fields) {
    const uid = await generateUnique4PartID(client, companyId, 'issues', 'issue_uid', 'ISS', fields.department || null);
    const insertRes = await client.query(
        `INSERT INTO issues (
            company_id, issue_uid, source_type, source_detail, description, root_cause, remediation_plan,
            owner, due_date, priority, regulatory_notification_required, regulatory_notification_deadline,
            created_by, department, raised_by_dept, is_recurring
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
            companyId,
            uid,
            fields.source_type,
            fields.source_detail || null,
            fields.description,
            fields.root_cause || null,
            fields.remediation_plan || null,
            fields.owner || null,           // kept for auto-created issues (control test remediation owner)
            fields.due_date || null,
            fields.priority || 'Medium',
            fields.regulatory_notification_required || false,
            fields.regulatory_notification_deadline || null,
            actorEmail,
            fields.department || null,      // owner department (who fixes it)
            fields.raised_by_dept || null,  // department that identified the issue
            fields.is_recurring || false,
        ]
    );
    const issue = insertRes.rows[0];

    for (const controlId of fields.link_control_ids || []) {
        await client.query('INSERT INTO issue_controls (issue_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, controlId]);
    }
    for (const riskId of fields.link_risk_ids || []) {
        await client.query('INSERT INTO issue_risks (issue_id, risk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, riskId]);
    }
    for (const obligationId of fields.link_obligation_ids || []) {
        await client.query('INSERT INTO issue_obligations (issue_id, obligation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, obligationId]);
    }
    for (const kriId of fields.link_kri_ids || []) {
        await client.query('INSERT INTO issue_kris (issue_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [issue.id, kriId]);
    }

    await logAudit(client, {
        companyId,
        entityType: 'issue',
        entityId: issue.id,
        action: 'create',
        actor: { email: actorEmail },
        details: { issue_uid: uid, source_type: fields.source_type, auto: fields.auto || false },
    });

    return issue;
}

async function attachIssueLinks(client, issues) {
    if (issues.length === 0) return issues;
    const ids = issues.map((i) => i.id);

    const [controlsRes, risksRes, obligationsRes, krisRes] = await Promise.all([
        client.query(
            `SELECT ic.issue_id, cl.id, cl.control_uid, cl.name FROM issue_controls ic
             JOIN controls_lib cl ON cl.id = ic.control_id WHERE ic.issue_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT ir.issue_id, r.id, r.risk_uid FROM issue_risks ir
             JOIN risks r ON r.id = ir.risk_id WHERE ir.issue_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT io.issue_id, o.id, o.obligation_uid, o.regulation_name FROM issue_obligations io
             JOIN compliance_obligations o ON o.id = io.obligation_id WHERE io.issue_id = ANY($1::int[])`,
            [ids]
        ),
        client.query(
            `SELECT ik.issue_id, k.id, k.kri_uid, k.name FROM issue_kris ik
             JOIN kris k ON k.id = ik.kri_id WHERE ik.issue_id = ANY($1::int[])`,
            [ids]
        ),
    ]);

    const group = (rows, mapper) => {
        const byId = {};
        for (const row of rows) (byId[row.issue_id] = byId[row.issue_id] || []).push(mapper(row));
        return byId;
    };

    const controlsByIssue = group(controlsRes.rows, (c) => ({ id: c.id, control_uid: c.control_uid, name: c.name }));
    const risksByIssue = group(risksRes.rows, (r) => ({ id: r.id, risk_uid: r.risk_uid }));
    const obligationsByIssue = group(obligationsRes.rows, (o) => ({ id: o.id, obligation_uid: o.obligation_uid, regulation_name: o.regulation_name }));
    const krisByIssue = group(krisRes.rows, (k) => ({ id: k.id, kri_uid: k.kri_uid, name: k.name }));

    return issues.map((i) => ({
        ...i,
        linked_controls: controlsByIssue[i.id] || [],
        linked_risks: risksByIssue[i.id] || [],
        linked_obligations: obligationsByIssue[i.id] || [],
        linked_kris: krisByIssue[i.id] || [],
    }));
}

app.get(
    '/api/issues',
    can('issue.view'), // Phase C cutover -- was requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    asyncHandler(async (req, res) => {
        // Risk Champions see issues their dept raised (raised_by_dept).
        // Managers / Approvers see issues their dept owns (department).
        // CRO / Admin / Viewer see all (managerScopeClause returns null for non-scoped roles).
        const scopeColumn = req.company.role === 'Risk Champion' ? 'raised_by_dept' : 'department';
        const scope = managerScopeClause(req, scopeColumn, 2);
        const result = await pool.query(
            `SELECT * FROM issues WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY issue_uid`,
            scope ? [req.company.id, scope.value] : [req.company.id]
        );
        res.json(await attachIssueLinks(pool, result.rows));
    })
);

app.post(
    '/api/issues',
    can('issue.create'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO')
    validate(schemas.createIssue),
    asyncHandler(async (req, res) => {
        // Raised-by department: auto-filled from the submitter's own department
        const userDepts = getManagerDepts(req);
        const raisedByDept = userDepts[0] || null;

        // Owner department: defaults to submitter's dept (action items now carry per-dept assignments)
        // Bug fix (2026-07-22): this used to reference raisedByDept before its `const`
        // declaration two lines below (temporal-dead-zone violation), throwing a
        // ReferenceError -> 500 on every request where req.body.department was falsy
        // (i.e. every "ownerless"/no-department issue creation). Reordered so
        // raisedByDept is declared first.
        const ownerDept = req.body.department || raisedByDept || null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const issue = await createIssue(client, req.company.id, req.user.email, {
                ...req.body,
                department: ownerDept,
                raised_by_dept: raisedByDept,
            });

            // Insert any action items submitted with the issue
            if (Array.isArray(req.body.action_items)) {
                for (const item of req.body.action_items) {
                    if (!item.description?.trim()) continue;
                    await client.query(
                        `INSERT INTO issue_actions
                            (issue_id, company_id, description, department, due_date, created_by, action_plan_status)
                         VALUES ($1, $2, $3, $4, $5, $6, 'Draft')`,
                        [issue.id, req.company.id, item.description.trim(),
                         item.department || null, item.due_date || null, req.user.id]
                    );
                }
            }

            await client.query('COMMIT');
            const [enriched] = await attachIssueLinks(pool, [issue]);
            res.status(201).json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

app.patch(
    '/api/issues/:id',
    can('issue.edit'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        // 'owner' removed — issues are now owned by departments, not individuals
        const fields = ['source_type', 'source_detail', 'description', 'root_cause', 'remediation_plan', 'due_date', 'priority', 'is_recurring'];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const current = await client.query('SELECT * FROM issues WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
            if (current.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Issue not found' });
            }
            // Risk Champions edit issues they raised (raised_by_dept); Managers/Approvers edit issues they own (department)
            const accessDept = req.company.role === 'Risk Champion'
                ? current.rows[0].raised_by_dept
                : current.rows[0].department;
            if (!await managerCanAccess(req, accessDept)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'This issue belongs to a different department.' });
            }

            if (req.body.department !== undefined) {
                // Owner department: any dept is valid — cross-dept reassignment is permitted
                values.push(req.body.department);
                updates.push(`department = $${values.length}`);
            }

            let updated = current.rows[0];
            if (updates.length > 0) {
                values.push(req.params.id);
                const result = await client.query(`UPDATE issues SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
                updated = result.rows[0];
            }

            if (req.body.link_control_ids) {
                await client.query('DELETE FROM issue_controls WHERE issue_id = $1', [req.params.id]);
                for (const id of req.body.link_control_ids) {
                    await client.query('INSERT INTO issue_controls (issue_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, id]);
                }
            }
            if (req.body.link_risk_ids) {
                await client.query('DELETE FROM issue_risks WHERE issue_id = $1', [req.params.id]);
                for (const id of req.body.link_risk_ids) {
                    await client.query('INSERT INTO issue_risks (issue_id, risk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, id]);
                }
            }
            if (req.body.link_obligation_ids) {
                await client.query('DELETE FROM issue_obligations WHERE issue_id = $1', [req.params.id]);
                for (const id of req.body.link_obligation_ids) {
                    await client.query('INSERT INTO issue_obligations (issue_id, obligation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, id]);
                }
            }
            if (req.body.link_kri_ids) {
                await client.query('DELETE FROM issue_kris WHERE issue_id = $1', [req.params.id]);
                for (const id of req.body.link_kri_ids) {
                    await client.query('INSERT INTO issue_kris (issue_id, kri_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, id]);
                }
            }

            // Insert any new action items added via the edit form
            if (Array.isArray(req.body.new_action_items)) {
                for (const item of req.body.new_action_items) {
                    if (!item.description?.trim()) continue;
                    await client.query(
                        `INSERT INTO issue_actions
                            (issue_id, company_id, description, department, due_date, created_by, action_plan_status)
                         VALUES ($1, $2, $3, $4, $5, $6, 'Draft')`,
                        [req.params.id, req.company.id, item.description.trim(),
                         item.department || null, item.due_date || null, req.user.id]
                    );
                }
            }

            await logAudit(client, {
                companyId: req.company.id,
                entityType: 'issue',
                entityId: updated.id,
                action: 'update',
                actor: req.user,
                details: req.body,
            });

            await client.query('COMMIT');
            const [enriched] = await attachIssueLinks(pool, [updated]);
            res.json(enriched);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// Status transitions enforce the two governance safeguards from D:
//  - "Risk Accepted" requires a documented rationale and sign-off from
//    an Admin (higher authority) other than the issue owner.
//  - "Closed-Remediated" requires verification by someone other than
//    the issue owner (separation of duties).
app.post(
    '/api/issues/:id/status',
    // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO').
    // Found 2026-07-22: that list's literal 'CRO' triggered requireRole()'s
    // auto-expand to 'Consultant CRO' too, but the issue.update_status seed
    // (schema_v75) has no Consultant CRO row -- a seed omission, not a
    // deliberate exclusion (every other issue.* capability has one). Patched
    // live via PUT /api/roles/:id/permissions (Consultant CRO -> 'full') as
    // part of this same cutover so behavior doesn't regress on deploy.
    can('issue.update_status'),
    asyncHandler(async (req, res) => {
        const { status } = req.body;
        const validStatuses = ['Open', 'In Progress', 'Closed-Remediated', 'Risk Accepted', 'Deferred', 'No Longer Relevant'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        }

        const current = await pool.query('SELECT * FROM issues WHERE id = $1 AND company_id = $2', [req.params.id, req.company.id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Issue not found' });
        const issue = current.rows[0];
        const statusAccessDept = req.company.role === 'Risk Champion'
            ? issue.raised_by_dept
            : issue.department;
        if (!await managerCanAccess(req, statusAccessDept)) {
            return res.status(403).json({ error: 'This issue belongs to a different department.' });
        }

        const updates = ['status = $1'];
        const values = [status];

        if (status === 'Risk Accepted') {
            const { disposition_rationale, accepted_approved_by, accepted_review_date } = req.body;
            if (!disposition_rationale || !accepted_approved_by || !accepted_review_date) {
                return res.status(400).json({
                    error: '"Risk Accepted" requires disposition_rationale, accepted_approved_by, and accepted_review_date.',
                });
            }
            // W-04: SoD check uses created_by (the person who logged the issue),
            // not owner (which is now null for manually-created issues).
            if (issue.created_by && accepted_approved_by.toLowerCase() === issue.created_by.toLowerCase()) {
                return res.status(400).json({ error: 'Approved By must be someone other than the person who raised the issue.' });
            }
            const approverRes = await pool.query(
                `SELECT uc.role FROM user_companies uc JOIN users u ON u.id = uc.user_id
                 WHERE uc.company_id = $1 AND u.email = $2`,
                [req.company.id, accepted_approved_by.toLowerCase()]
            );
            if (approverRes.rows.length === 0 || approverRes.rows[0].role !== 'Admin') {
                return res.status(400).json({ error: 'Approved By must be an Admin (higher authority than the person who raised the issue).' });
            }

            values.push(disposition_rationale, accepted_approved_by, accepted_review_date);
            updates.push(`disposition_rationale = $${values.length - 2}`, `accepted_approved_by = $${values.length - 1}`, `accepted_review_date = $${values.length}`);
        }

        if (status === 'Closed-Remediated') {
            const { closure_verified_by } = req.body;
            if (!closure_verified_by) {
                return res.status(400).json({ error: '"Closed-Remediated" requires closure_verified_by (separation of duties).' });
            }
            // W-04: SoD check uses created_by, not owner (owner is null for manual issues).
            if (issue.created_by && closure_verified_by.toLowerCase() === issue.created_by.toLowerCase()) {
                return res.status(400).json({ error: 'Closure must be verified by someone other than the person who raised the issue.' });
            }
            values.push(closure_verified_by);
            updates.push(`closure_verified_by = $${values.length}`, `closed_at = now()`);
        }

        values.push(req.params.id);
        const result = await pool.query(`UPDATE issues SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'issue',
            entityId: issue.id,
            action: 'status_change',
            actor: req.user,
            details: { from: issue.status, to: status },
        });

        const [enriched] = await attachIssueLinks(pool, result.rows);
        res.json(enriched);
    })
);

// ============================================================
// Issue Action Items (multi-department action plan lifecycle)
// ============================================================

const VALID_ACTION_STATUSES = [
    'Draft', 'Pending Approval', 'Approved',
    'In Progress', 'Completed', 'Verified',
    'Rejected', 'Deferred',
];
const VALID_INTERIM_ACTIONS = ['Compensating controls', 'Accept', 'Scores updated', 'No interim action'];

// GET /api/issues/:id/actions — list action items for an issue
app.get(
    '/api/issues/:id/actions',
    can('issue.view'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Viewer'); no dedicated action-item view capability exists, and issue.view's seed (all 8 roles incl. Viewer) matches this list exactly once Admin/Super Admin/Consultant CRO's requireRole() bypass+auto-expand are accounted for
    asyncHandler(async (req, res) => {
        const issueCheck = await pool.query(
            'SELECT id FROM issues WHERE id = $1 AND company_id = $2',
            [req.params.id, req.company.id]
        );
        if (issueCheck.rows.length === 0) return res.status(404).json({ error: 'Issue not found' });

        const { rows } = await pool.query(
            `SELECT ia.*,
                    u_created.full_name  AS created_by_name,
                    u_assigned.full_name AS assigned_to_name,
                    u_approved.full_name AS approved_by_name,
                    u_verified.full_name AS verified_by_name,
                    bu.name              AS business_unit_name
             FROM issue_actions ia
             LEFT JOIN users u_created  ON u_created.id  = ia.created_by
             LEFT JOIN users u_assigned ON u_assigned.id = ia.assigned_to
             LEFT JOIN users u_approved ON u_approved.id = ia.approved_by
             LEFT JOIN users u_verified ON u_verified.id = ia.verified_by
             LEFT JOIN business_units bu ON bu.id = ia.business_unit_id
             WHERE ia.issue_id = $1
             ORDER BY ia.created_at ASC`,
            [req.params.id]
        );
        res.json(rows);
    })
);

// POST /api/issues/:id/actions — create a new action item
app.post(
    '/api/issues/:id/actions',
    // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO').
    // Same Consultant CRO seed gap as POST /api/issues/:id/status above --
    // patched live alongside that one as part of this cutover.
    can('issue.action.manage'),
    asyncHandler(async (req, res) => {
        const issueCheck = await pool.query(
            'SELECT id FROM issues WHERE id = $1 AND company_id = $2',
            [req.params.id, req.company.id]
        );
        if (issueCheck.rows.length === 0) return res.status(404).json({ error: 'Issue not found' });

        const { description, department, business_unit_id, due_date, assigned_to } = req.body;
        if (!description || !description.trim()) {
            return res.status(400).json({ error: 'description is required' });
        }

        const { rows } = await pool.query(
            `INSERT INTO issue_actions
                (issue_id, company_id, description, department, business_unit_id,
                 due_date, assigned_to, created_by, action_plan_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Draft')
             RETURNING *`,
            [
                req.params.id,
                req.company.id,
                description.trim(),
                department || null,
                business_unit_id || null,
                due_date || null,
                assigned_to || null,
                req.user.id,
            ]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'issue_action',
            entityId: rows[0].id,
            action: 'created',
            actor: req.user,
            details: { issue_id: req.params.id, department },
        });

        res.status(201).json(rows[0]);
    })
);

// PATCH /api/issues/:id/actions/:aid — edit action item fields (Draft only)
app.patch(
    '/api/issues/:id/actions/:aid',
    can('issue.action.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO'); same Consultant CRO seed gap, patched alongside the others
    asyncHandler(async (req, res) => {
        const { rows: existing } = await pool.query(
            'SELECT * FROM issue_actions WHERE id = $1 AND issue_id = $2 AND company_id = $3',
            [req.params.aid, req.params.id, req.company.id]
        );
        if (existing.length === 0) return res.status(404).json({ error: 'Action item not found' });
        const action = existing[0];

        // Only allow field edits in Draft status
        if (action.action_plan_status !== 'Draft') {
            return res.status(400).json({ error: 'Action item fields can only be edited while in Draft status.' });
        }

        const { description, department, business_unit_id, due_date, assigned_to } = req.body;
        const updates = ['updated_at = now()'];
        const values = [];

        if (description !== undefined) { values.push(description.trim()); updates.push(`description = $${values.length}`); }
        if (department !== undefined)  { values.push(department || null); updates.push(`department = $${values.length}`); }
        if (business_unit_id !== undefined) { values.push(business_unit_id || null); updates.push(`business_unit_id = $${values.length}`); }
        if (due_date !== undefined)    { values.push(due_date || null);   updates.push(`due_date = $${values.length}`); }
        if (assigned_to !== undefined) { values.push(assigned_to || null); updates.push(`assigned_to = $${values.length}`); }

        values.push(req.params.aid);
        const { rows } = await pool.query(
            `UPDATE issue_actions SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        res.json(rows[0]);
    })
);

// DELETE /api/issues/:id/actions/:aid — delete (Draft only)
app.delete(
    '/api/issues/:id/actions/:aid',
    can('issue.action.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO'); same Consultant CRO seed gap, patched alongside the others
    asyncHandler(async (req, res) => {
        const { rows: existing } = await pool.query(
            'SELECT * FROM issue_actions WHERE id = $1 AND issue_id = $2 AND company_id = $3',
            [req.params.aid, req.params.id, req.company.id]
        );
        if (existing.length === 0) return res.status(404).json({ error: 'Action item not found' });
        if (existing[0].action_plan_status !== 'Draft') {
            return res.status(400).json({ error: 'Only Draft action items can be deleted.' });
        }
        await pool.query('DELETE FROM issue_actions WHERE id = $1', [req.params.aid]);
        res.json({ ok: true });
    })
);

// POST /api/issues/:id/actions/:aid/status — advance the action plan lifecycle
//
// Allowed transitions and SoD rules:
//   Draft           → Pending Approval  (any authorised user)
//   Pending Approval→ Approved           (approver ≠ created_by)
//   Pending Approval→ Draft              (return for revision — created_by or Admin)
//   Approved        → In Progress        (any authorised user)
//   In Progress     → Completed          (any authorised user)
//   Completed       → Verified           (verifier ≠ created_by AND ≠ approved_by)
//   Approved|In Progress|Completed → Rejected|Deferred  (any authorised user, requires interim_action)
app.post(
    '/api/issues/:id/actions/:aid/status',
    can('issue.action.manage'), // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO'); same Consultant CRO seed gap, patched alongside the others
    asyncHandler(async (req, res) => {
        const { rows: existing } = await pool.query(
            'SELECT * FROM issue_actions WHERE id = $1 AND issue_id = $2 AND company_id = $3',
            [req.params.aid, req.params.id, req.company.id]
        );
        if (existing.length === 0) return res.status(404).json({ error: 'Action item not found' });
        const action = existing[0];
        const { status, interim_action } = req.body;
        const currentUserId = req.user.id;

        if (!VALID_ACTION_STATUSES.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${VALID_ACTION_STATUSES.join(', ')}` });
        }

        // Valid transition map
        const TRANSITIONS = {
            'Draft':            ['Pending Approval'],
            'Pending Approval': ['Approved', 'Draft'],
            'Approved':         ['In Progress', 'Rejected', 'Deferred'],
            'In Progress':      ['Completed', 'Rejected', 'Deferred'],
            'Completed':        ['Verified', 'Rejected', 'Deferred'],
            'Verified':         [],
            'Rejected':         ['Draft'],
            'Deferred':         ['Draft'],
        };
        if (!TRANSITIONS[action.action_plan_status]?.includes(status)) {
            return res.status(400).json({
                error: `Cannot transition from "${action.action_plan_status}" to "${status}".`,
            });
        }

        const updates = ['action_plan_status = $1', 'updated_at = now()'];
        const values = [status];

        // ── SoD: Approval ───────────────────────────────────────────────────
        if (status === 'Approved') {
            if (action.created_by && currentUserId === action.created_by) {
                return res.status(400).json({ error: 'The approver must be someone other than the person who created this action item.' });
            }
            values.push(currentUserId, new Date());
            updates.push(`approved_by = $${values.length - 1}`, `approved_at = $${values.length}`);
        }

        // ── SoD: Verification ───────────────────────────────────────────────
        if (status === 'Verified') {
            if (action.created_by && currentUserId === action.created_by) {
                return res.status(400).json({ error: 'The verifier must be someone other than the person who created this action item.' });
            }
            if (action.approved_by && currentUserId === action.approved_by) {
                return res.status(400).json({ error: 'The verifier must be someone other than the approver.' });
            }
            values.push(currentUserId, new Date());
            updates.push(`verified_by = $${values.length - 1}`, `verified_at = $${values.length}`);
        }

        // ── Completed timestamp ─────────────────────────────────────────────
        if (status === 'Completed') {
            updates.push('completed_at = now()');
        }

        // ── Interim action required for Rejected / Deferred ─────────────────
        if (status === 'Rejected' || status === 'Deferred') {
            if (!interim_action || !VALID_INTERIM_ACTIONS.includes(interim_action)) {
                return res.status(400).json({
                    error: `"${status}" requires interim_action. Must be one of: ${VALID_INTERIM_ACTIONS.join(', ')}.`,
                });
            }
            values.push(interim_action);
            updates.push(`interim_action = $${values.length}`);
        }

        // ── Clear approval/verification state when returning to Draft ────────
        if (status === 'Draft') {
            updates.push('submitted_at = NULL');
        }

        // ── Submitted_at when moving to Pending Approval ─────────────────────
        if (status === 'Pending Approval') {
            updates.push('submitted_at = now()');
        }

        values.push(req.params.aid);
        const { rows } = await pool.query(
            `UPDATE issue_actions SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'issue_action',
            entityId: action.id,
            action: 'status_change',
            actor: req.user,
            details: { from: action.action_plan_status, to: status, interim_action },
        });

        res.json(rows[0]);
    })
);

// ============================================================
// Dashboards (F)
// ============================================================

// How long after a test before the next one is "due", per testing
// frequency (B2). Used by F2 "control tests due/overdue".
const TESTING_FREQUENCY_MONTHS = { Monthly: 1, Quarterly: 3, Annual: 12 };

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

function daysBetween(a, b) {
    return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// F1: Management Summary (Executive + Compliance Coordinator combined view).
// Scoped to the Manager's department like every other module (E); Admins
// see the whole company.
app.get(
    '/api/dashboard/management-summary',
    requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer'),
    asyncHandler(async (req, res) => {
        const riskScope = managerScopeClause(req, 'department', 2);
        const obligationScope = managerScopeClause(req, 'applicable_to', 2);
        const issueScope = managerScopeClause(req, 'department', 2);
        const kriScope = managerScopeClause(req, 'department', 2);

        const latestRisksQuery = `
            SELECT * FROM risks r WHERE company_id = $1 AND (risk_status IS NULL OR risk_status != 'Closed')
              AND version = (SELECT MAX(version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid)
              ${riskScope ? `AND ${riskScope.clause}` : ''}`;

        const [risksResRaw, krisRes, obligationsRes, issuesRes] = await Promise.all([
            pool.query(latestRisksQuery, riskScope ? [req.company.id, riskScope.value] : [req.company.id]),
            pool.query(
                `SELECT * FROM kris WHERE company_id = $1 ${kriScope ? `AND ${kriScope.clause}` : ''}`,
                kriScope ? [req.company.id, kriScope.value] : [req.company.id]
            ),
            pool.query(
                `SELECT * FROM compliance_obligations WHERE company_id = $1 ${obligationScope ? `AND ${obligationScope.clause}` : ''}`,
                obligationScope ? [req.company.id, obligationScope.value] : [req.company.id]
            ),
            pool.query(
                `SELECT * FROM issues WHERE company_id = $1 ${issueScope ? `AND ${issueScope.clause}` : ''}`,
                issueScope ? [req.company.id, issueScope.value] : [req.company.id]
            ),
        ]);

        // Enrich with appetite_breach / reassessment_recommended (same
        // logic as the Risk Register list).
        const risksRes = { rows: await attachControlsAndMitigations(risksResRaw.rows) };

        // ---- Risk heatmap (5x5) + top risks by residual score ----
        const heatmap = [];
        for (let impact = 5; impact >= 1; impact--) {
            for (let likelihood = 1; likelihood <= 5; likelihood++) {
                const cellRisks = risksRes.rows.filter((r) => parseInt(r.residual_likelihood, 10) === likelihood && parseInt(r.residual_impact, 10) === impact);
                heatmap.push({
                    likelihood, impact, score: likelihood * impact, count: cellRisks.length,
                    risks: cellRisks.map((r) => ({
                        id: r.id, risk_uid: r.risk_uid, department: r.department,
                        risk_detail: r.risk_detail, risk_owner: r.risk_owner,
                        approval_status: r.approval_status,
                    })),
                });
            }
        }

        const topRisks = [...risksRes.rows]
            .map((r) => ({
                risk_uid: r.risk_uid,
                department: r.department,
                risk_detail: r.risk_detail,
                risk_owner: r.risk_owner,
                residual_score: r.residual_likelihood * r.residual_impact,
                residual_likelihood: r.residual_likelihood,
                residual_impact: r.residual_impact,
                directional_trend: r.directional_trend,
                approval_status: r.approval_status,
            }))
            .sort((a, b) => b.residual_score - a.residual_score)
            .slice(0, 10);

        // ---- KRI summary: Green/Amber/Red counts, Red items named ----
        const kriIds = krisRes.rows.map((k) => k.id);
        let latestByKri = {};
        if (kriIds.length > 0) {
            const measurementsRes = await pool.query(
                `SELECT * FROM (
                    SELECT kri_id, value, measurement_date,
                           ROW_NUMBER() OVER (PARTITION BY kri_id ORDER BY measurement_date DESC, id DESC) AS rn
                    FROM kri_measurements WHERE kri_id = ANY($1::int[])
                 ) sub WHERE rn = 1`,
                [kriIds]
            );
            for (const m of measurementsRes.rows) latestByKri[m.kri_id] = m.value;
        }

        const kriSummary = { green: 0, amber: 0, red: 0, none: 0, red_items: [] };
        for (const k of krisRes.rows) {
            const value = latestByKri[k.id] ?? null;
            const band = computeKriBand(k, value);
            if (band === 'Green') kriSummary.green++;
            else if (band === 'Amber') kriSummary.amber++;
            else if (band === 'Red') {
                kriSummary.red++;
                kriSummary.red_items.push({ kri_uid: k.kri_uid, name: k.name, current_value: value });
            } else kriSummary.none++;
        }

        // ---- Compliance status summary: overall % + by regulator ----
        const statusKeys = ['Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Yet Assessed'];
        const overall = { total: obligationsRes.rows.length };
        for (const s of statusKeys) overall[s] = obligationsRes.rows.filter((o) => o.compliance_status === s).length;

        const byRegulator = {};
        for (const o of obligationsRes.rows) {
            const key = o.regulatory_body || 'Unspecified';
            if (!byRegulator[key]) {
                byRegulator[key] = { regulatory_body: key, total: 0, Compliant: 0, 'Partially Compliant': 0, 'Non-Compliant': 0, 'Not Yet Assessed': 0 };
            }
            byRegulator[key].total++;
            byRegulator[key][o.compliance_status]++;
        }

        // ---- Open issues by priority and age (flag >30 days overdue) ----
        const openIssues = issuesRes.rows.filter((i) => OPEN_ISSUE_STATUSES.includes(i.status));
        const byPriority = { Critical: 0, High: 0, Medium: 0, Low: 0 };
        for (const i of openIssues) byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;

        const today = new Date();
        const overdueIssues = openIssues
            .filter((i) => i.due_date && daysBetween(today, new Date(i.due_date)) > 30)
            .map((i) => ({
                issue_uid: i.issue_uid,
                description: i.description,
                priority: i.priority,
                owner: i.owner,
                due_date: i.due_date,
                days_overdue: daysBetween(today, new Date(i.due_date)),
            }))
            .sort((a, b) => b.days_overdue - a.days_overdue);

        // ---- Department Risk Distribution (Inherent vs Residual by band) ----
        const deptDistMap = {};
        for (const r of risksRes.rows) {
            const dept = r.department || 'Enterprise-wide';
            if (!deptDistMap[dept]) {
                deptDistMap[dept] = {
                    department: dept,
                    inherent: { extreme: 0, high: 0, moderate: 0, low: 0, total: 0 },
                    residual: { extreme: 0, high: 0, moderate: 0, low: 0, total: 0 },
                };
            }
            const il = parseInt(r.inherent_likelihood, 10);
            const ii = parseInt(r.inherent_impact, 10);
            const rl = parseInt(r.residual_likelihood, 10);
            const ri = parseInt(r.residual_impact, 10);
            if (il && ii) {
                const iScore = il * ii;
                const iBand = iScore >= 17 ? 'extreme' : iScore >= 10 ? 'high' : iScore >= 5 ? 'moderate' : 'low';
                deptDistMap[dept].inherent[iBand]++;
                deptDistMap[dept].inherent.total++;
            }
            if (rl && ri) {
                const rScore = rl * ri;
                const rBand = rScore >= 17 ? 'extreme' : rScore >= 10 ? 'high' : rScore >= 5 ? 'moderate' : 'low';
                deptDistMap[dept].residual[rBand]++;
                deptDistMap[dept].residual.total++;
            }
        }
        const riskDistByDept = Object.values(deptDistMap)
            .sort((a, b) => a.department.localeCompare(b.department));

        // ---- Risk Accepted register: B1 risks + D issues, with review dates ----
        const acceptedRisks = risksRes.rows
            .filter((r) => r.treatment_strategy === 'Accept')
            .map((r) => ({
                risk_uid: r.risk_uid,
                risk_detail: r.risk_detail,
                residual_score: r.residual_likelihood * r.residual_impact,
                accept_approved_by: r.accept_approved_by,
                treatment_plan_rationale: r.treatment_plan_rationale,
                next_review_date: r.next_review_date,
            }));

        const acceptedIssues = issuesRes.rows
            .filter((i) => i.status === 'Risk Accepted')
            .map((i) => ({
                issue_uid: i.issue_uid,
                description: i.description,
                accepted_approved_by: i.accepted_approved_by,
                disposition_rationale: i.disposition_rationale,
                accepted_review_date: i.accepted_review_date,
            }));

        // ---- Tolerance breaches: residual score exceeds the per-risk threshold ----
        const appetiteBreaches = risksRes.rows
            .filter((r) => r.tolerance_breach)
            .map((r) => ({
                risk_uid: r.risk_uid,
                risk_detail: r.risk_detail,
                department: r.department,
                risk_category: r.risk_category,
                residual_score: r.residual_score,
                tolerance_threshold_score: r.tolerance_threshold_score,
            }))
            .sort((a, b) => b.residual_score - a.residual_score);

        // ---- Category appetite breaches: from the board appetite statements ----
        const categoryAppetiteStmts = await pool.query(
            `SELECT risk_category, appetite_level, max_residual_score FROM risk_appetite_statements
              WHERE company_id = $1 AND is_current = TRUE`,
            [req.company.id]
        );
        const appetiteByCategory = {};
        for (const s of categoryAppetiteStmts.rows) appetiteByCategory[s.risk_category] = s;

        const categoryBreaches = [];
        const breachByCategory = {};
        for (const r of risksRes.rows.filter((r) => r.appetite_category_breach)) {
            const stmt = appetiteByCategory[r.risk_category];
            if (!breachByCategory[r.risk_category]) {
                breachByCategory[r.risk_category] = {
                    risk_category: r.risk_category,
                    appetite_level: stmt?.appetite_level || null,
                    max_residual_score: stmt?.max_residual_score || null,
                    risks: [],
                };
                categoryBreaches.push(breachByCategory[r.risk_category]);
            }
            breachByCategory[r.risk_category].risks.push({
                risk_uid: r.risk_uid,
                risk_detail: r.risk_detail,
                department: r.department,
                residual_score: r.residual_score,
            });
        }
        categoryBreaches.sort((a, b) => b.risks.length - a.risks.length);

        // ---- Risks flagged for reassessment: a linked control was tested
        // as non-Effective more recently than this risk was assessed ----
        const reassessmentRecommended = risksRes.rows
            .filter((r) => r.reassessment_recommended)
            .map((r) => ({ risk_uid: r.risk_uid, risk_detail: r.risk_detail, department: r.department, residual_score: r.residual_score }));

        // ---- Risk movement: top movers vs. their immediately preceding
        // version (same comparison that produced directional_trend) ----
        const movedRisks = risksRes.rows.filter((r) => r.version > 1 && r.directional_trend !== 'STABLE');
        let riskMovement = [];
        if (movedRisks.length > 0) {
            const uids = [...new Set(movedRisks.map((r) => r.risk_uid))];
            const versionsRes = await pool.query(
                `SELECT risk_uid, version, residual_likelihood, residual_impact, reporting_quarter FROM risks WHERE company_id = $1 AND risk_uid = ANY($2::text[])`,
                [req.company.id, uids]
            );
            const byUid = {};
            for (const row of versionsRes.rows) (byUid[row.risk_uid] = byUid[row.risk_uid] || []).push(row);

            riskMovement = movedRisks
                .map((r) => {
                    const prev = (byUid[r.risk_uid] || []).find((v) => v.version === r.version - 1);
                    if (!prev) return null;
                    const previousScore = prev.residual_likelihood * prev.residual_impact;
                    return {
                        risk_uid: r.risk_uid,
                        risk_detail: r.risk_detail,
                        department: r.department,
                        current_score: r.residual_score,
                        previous_score: previousScore,
                        delta: r.residual_score - previousScore,
                        direction: r.directional_trend,
                        current_quarter: r.reporting_quarter,
                        previous_quarter: prev.reporting_quarter,
                    };
                })
                .filter(Boolean)
                .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                .slice(0, 10);
        }

        res.json({
            risk_heatmap: heatmap,
            top_risks: topRisks,
            appetite_breaches: appetiteBreaches,          // legacy: per-risk tolerance breaches
            tolerance_breaches: appetiteBreaches,         // renamed: same data, new key
            category_appetite_breaches: categoryBreaches, // new: board-level category breaches
            reassessment_recommended: reassessmentRecommended,
            risk_movement: riskMovement,
            kri_summary: kriSummary,
            compliance_summary: { overall, by_regulator: Object.values(byRegulator) },
            issues_summary: { open_count: openIssues.length, by_priority: byPriority, overdue: overdueIssues },
            risk_accepted_register: { risks: acceptedRisks, issues: acceptedIssues },
            risk_distribution_by_dept: riskDistByDept,
        });
    })
);

// F2: My Tasks (personalized per user). Available to every role --
// Viewers' only task type is policy attestations; Admin/Manager get the
// full set (control tests due, issues assigned to them, policies they
// own/approve due for review, and KRIs they're responsible for).
app.get(
    '/api/dashboard/my-tasks',
    asyncHandler(async (req, res) => {
        const email = req.user.email.toLowerCase();
        const today = new Date();

        // Outstanding policy attestations -- relevant to every role.
        const publishedPolicies = await pool.query(
            `SELECT p.* FROM policies p
             WHERE p.company_id = $1 AND p.status = 'Published'
               AND p.version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid AND p2.status = 'Published')`,
            [req.company.id]
        );
        const policyIds = publishedPolicies.rows.map((p) => p.id);
        let attestedSet = new Set();
        if (policyIds.length > 0) {
            const attestedRes = await pool.query(
                `SELECT policy_id FROM policy_attestations WHERE policy_id = ANY($1::int[]) AND lower(user_email) = $2`,
                [policyIds, email]
            );
            attestedSet = new Set(attestedRes.rows.map((a) => a.policy_id));
        }
        const pendingAttestations = publishedPolicies.rows
            .filter((p) => !attestedSet.has(p.id))
            .map((p) => ({ policy_uid: p.policy_uid, name: p.name, category: p.category }));

        if (req.company.role === 'Viewer') {
            return res.json({ pending_attestations: pendingAttestations });
        }

        // Control tests due/overdue (B2) -- mine if I'm Responsible (owner),
        // Accountable, Consulted, or Informed (A2 RACI).
        const myControls = await pool.query(
            `SELECT * FROM controls_lib WHERE company_id = $1
               AND (lower(owner) = $2 OR lower(accountable) = $2 OR lower(consulted) = $2 OR lower(informed) = $2)`,
            [req.company.id, email]
        );
        const controlTasks = myControls.rows
            .map((c) => {
                const months = TESTING_FREQUENCY_MONTHS[c.testing_frequency] || 12;
                const nextDue = c.last_test_date ? addMonths(new Date(c.last_test_date), months) : null;
                const daysOverdue = nextDue ? daysBetween(today, nextDue) : null; // positive = overdue, negative = days remaining
                return {
                    control_uid: c.control_uid,
                    name: c.name,
                    testing_frequency: c.testing_frequency,
                    last_test_date: c.last_test_date,
                    last_test_result: c.last_test_result,
                    next_due: nextDue ? nextDue.toISOString().slice(0, 10) : null,
                    days_overdue: daysOverdue,
                    never_tested: !c.last_test_date,
                };
            })
            // Surface anything never tested, overdue, or due within 30 days.
            .filter((c) => c.never_tested || c.days_overdue === null || c.days_overdue > -30)
            .sort((a, b) => (b.days_overdue ?? 999) - (a.days_overdue ?? 999));

        // Issues for my department, still open.
        // - CRO / Consultant CRO / Admin: all open issues (enterprise-wide oversight)
        // - Risk Champion: issues raised by their department (raised_by_dept)
        // - Manager / Approver: issues owned by their department (department)
        const issueRole = req.company.role;
        const issueDepts = getManagerDepts(req).map((d) => d.toLowerCase());
        let myIssuesRes;
        if (issueRole === 'CRO' || issueRole === 'Consultant CRO' || issueRole === 'Admin') {
            myIssuesRes = await pool.query(
                `SELECT * FROM issues WHERE company_id = $1 AND status = ANY($2::text[]) ORDER BY due_date ASC NULLS LAST`,
                [req.company.id, OPEN_ISSUE_STATUSES]
            );
        } else if (issueRole === 'Risk Champion') {
            if (issueDepts.length > 0) {
                myIssuesRes = await pool.query(
                    `SELECT * FROM issues WHERE company_id = $1 AND lower(raised_by_dept) = ANY($2::text[]) AND status = ANY($3::text[]) ORDER BY due_date ASC NULLS LAST`,
                    [req.company.id, issueDepts, OPEN_ISSUE_STATUSES]
                );
            } else {
                myIssuesRes = { rows: [] };
            }
        } else {
            // Manager / Approver — issues owned by their dept(s)
            if (issueDepts.length > 0) {
                myIssuesRes = await pool.query(
                    `SELECT * FROM issues WHERE company_id = $1 AND lower(department) = ANY($2::text[]) AND status = ANY($3::text[]) ORDER BY due_date ASC NULLS LAST`,
                    [req.company.id, issueDepts, OPEN_ISSUE_STATUSES]
                );
            } else {
                // Enterprise-wide Manager/Approver — all open issues
                myIssuesRes = await pool.query(
                    `SELECT * FROM issues WHERE company_id = $1 AND status = ANY($2::text[]) ORDER BY due_date ASC NULLS LAST`,
                    [req.company.id, OPEN_ISSUE_STATUSES]
                );
            }
        }
        const myIssues = myIssuesRes.rows.map((i) => ({
            issue_uid: i.issue_uid,
            description: i.description,
            priority: i.priority,
            status: i.status,
            due_date: i.due_date,
            source_type: i.source_type,
            department: i.department,
            raised_by_dept: i.raised_by_dept,
        }));

        // Policies I own or approve, due for review (or awaiting my approval).
        const myPoliciesRes = await pool.query(
            `SELECT * FROM policies p WHERE p.company_id = $1
               AND (lower(content_owner) = $2 OR lower(approver) = $2)
               AND p.version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid)`,
            [req.company.id, email]
        );
        const policyTasks = myPoliciesRes.rows
            .filter((p) => {
                if (p.status === 'Under Review' && p.approver?.toLowerCase() === email) return true; // awaiting my approval
                if (p.content_owner?.toLowerCase() === email && p.next_review_date) {
                    return daysBetween(today, new Date(p.next_review_date)) <= 30; // due within 30 days or overdue
                }
                return false;
            })
            .map((p) => ({
                policy_uid: p.policy_uid,
                name: p.name,
                status: p.status,
                next_review_date: p.next_review_date,
                awaiting_my_approval: p.status === 'Under Review' && p.approver?.toLowerCase() === email,
            }));

        // KRIs I'm responsible for -- current value, trend, zone.
        const myKrisRes = await pool.query(`SELECT * FROM kris WHERE company_id = $1 AND lower(owner) = $2`, [req.company.id, email]);
        const myKriIds = myKrisRes.rows.map((k) => k.id);
        let historyByKri = {};
        if (myKriIds.length > 0) {
            const measurementsRes = await pool.query(
                `SELECT * FROM (
                    SELECT kri_id, measurement_date, value,
                           ROW_NUMBER() OVER (PARTITION BY kri_id ORDER BY measurement_date DESC, id DESC) AS rn
                    FROM kri_measurements WHERE kri_id = ANY($1::int[])
                 ) sub WHERE rn <= 12 ORDER BY measurement_date ASC`,
                [myKriIds]
            );
            for (const m of measurementsRes.rows) {
                (historyByKri[m.kri_id] = historyByKri[m.kri_id] || []).push({ measurement_date: m.measurement_date, value: m.value });
            }
        }
        const kriTasks = myKrisRes.rows.map((k) => {
            const history = historyByKri[k.id] || [];
            const last = history.length > 0 ? history[history.length - 1] : null;
            const current = last ? last.value : null;
            const lastDate = last ? last.measurement_date : null;
            const freqDays = { Daily: 1, Weekly: 7, Monthly: 31, Quarterly: 92, 'Semi-Annual': 183, Annual: 365 };
            const days = freqDays[k.measurement_frequency] ?? 31;
            const nextDueDate = lastDate
                ? new Date(new Date(lastDate).getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                : null;
            return {
                kri_uid: k.kri_uid,
                name: k.name,
                current_value: current,
                band: computeKriBand(k, current),
                history,
                measurement_frequency: k.measurement_frequency,
                last_measurement_date: lastDate ? new Date(lastDate).toISOString().slice(0, 10) : null,
                next_due_date: nextDueDate,
                is_overdue: isKriOverdue(k.measurement_frequency, lastDate),
                never_measured: !lastDate,
            };
        });

        const overdueKriCount = kriTasks.filter((k) => k.is_overdue || k.never_measured).length;

        // ── Approver queue: risks awaiting Approver review ──────────────────────
        let approverQueue = [];
        if (req.company.role === 'Risk Owner') {
            const depts = getManagerDepts(req);
            let approverRisksRes;
            if (depts.length > 0) {
                approverRisksRes = await pool.query(
                    `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, last_evaluated_timestamp
                     FROM risks
                     WHERE company_id = $1
                       AND approval_status = 'Awaiting Approver'
                       AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                       AND (department IS NULL OR lower(department) = ANY(SELECT lower(d) FROM unnest($2::text[]) d))
                     ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                    [req.company.id, depts]
                );
            } else {
                // No department restriction — see all Awaiting Approver risks
                approverRisksRes = await pool.query(
                    `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, last_evaluated_timestamp
                     FROM risks
                     WHERE company_id = $1
                       AND approval_status = 'Awaiting Approver'
                       AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                     ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                    [req.company.id]
                );
            }
            approverQueue = approverRisksRes.rows.map((r) => ({
                id: r.id,
                risk_uid: r.risk_uid,
                department: r.department,
                risk_category: r.risk_category,
                risk_detail: r.risk_detail,
                risk_owner: r.risk_owner,
                assessed_by: r.assessed_by,
                submitted_at: r.last_evaluated_timestamp,
            }));
        }

        // ── Manager queue: risks awaiting Manager approval ───────────────────────
        let managerQueue = [];
        if (req.company.role === 'Risk Manager' || req.company.role === 'Admin') {
            const depts = getManagerDepts(req);
            let managerRisksRes;
            if (depts.length > 0) {
                managerRisksRes = await pool.query(
                    `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, cro_notes, last_evaluated_timestamp
                     FROM risks
                     WHERE company_id = $1
                       AND approval_status = 'Awaiting Approval'
                       AND (risk_status IS NULL OR risk_status != 'Closed')
                       AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                       AND (department IS NULL
                            OR lower(department) = ANY($2::text[])
                            OR lower(department) IN (SELECT lower(name) FROM departments WHERE company_id = $1 AND lower(code) = ANY($2::text[]))
                            OR lower(department) IN (SELECT lower(code) FROM departments WHERE company_id = $1 AND lower(name) = ANY($2::text[])))
                     ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                    [req.company.id, depts]
                );
            } else {
                // Enterprise-wide Manager/Admin — see all awaiting approval risks
                managerRisksRes = await pool.query(
                    `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, approver_email, cro_notes, last_evaluated_timestamp
                     FROM risks
                     WHERE company_id = $1
                       AND approval_status = 'Awaiting Approval'
                       AND (risk_status IS NULL OR risk_status != 'Closed')
                       AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                     ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                    [req.company.id]
                );
            }
            managerQueue = managerRisksRes.rows.map((r) => ({
                id: r.id,
                risk_uid: r.risk_uid,
                department: r.department,
                risk_category: r.risk_category,
                risk_detail: r.risk_detail,
                risk_owner: r.risk_owner,
                assessed_by: r.assessed_by,
                cro_notes: r.cro_notes || null,
                submitted_at: r.last_evaluated_timestamp,
            }));
        }

        // ── CRO queue: risks awaiting CRO action ─────────────────────────────────
        // 1. Awaiting Approval risks from departments with NO active Manager.
        // 2. Approved risks with cro_acceptance_status = 'pending_cro' (Accept/Avoid treatment).
        //
        // Department coverage is resolved in JS first (pre-resolution approach):
        //   - Fetch all active Managers and their dept assignments
        //   - For each, resolve assigned codes/names to ALL matching strings via departments table
        //   - Build a flat "covered" set; risks whose dept is in that set go to the Manager, not CRO
        let croApprovalQueue = [];
        let croAcceptanceQueue = [];
        let _dbgCro = null; // staging debug only
        if (req.company.role === 'CRO' || req.company.role === 'Consultant CRO') {
            const cid = req.company.id;

            // Step 1: load all active Managers for this company
            const mgrRes = await pool.query(
                `SELECT uc.department, uc.departments
                 FROM user_companies uc
                 JOIN users u ON u.id = uc.user_id
                 WHERE uc.company_id = $1 AND uc.role = 'Risk Manager' AND u.is_active = TRUE`,
                [cid]
            );

            // Step 2: determine enterprise-wide managers and collect assigned dept values
            let hasEnterpriseMgr = false;
            const assignedValues = new Set(); // lowercase codes/names assigned to any scoped Manager

            for (const mgr of mgrRes.rows) {
                const arr = Array.isArray(mgr.departments) && mgr.departments.length > 0
                    ? mgr.departments.map(d => d.toLowerCase())
                    : mgr.department ? [mgr.department.toLowerCase()] : [];

                if (arr.length === 0) {
                    hasEnterpriseMgr = true;
                    break;
                }
                arr.forEach(v => assignedValues.add(v));
            }

            // Step 3: expand assigned values to include both code AND name for each department
            // so that 'FIN'→'Finance' and 'Technology'→'TEC' are both matched regardless of
            // how the risk stored its department value.
            let coveredSet = [];
            if (!hasEnterpriseMgr && assignedValues.size > 0) {
                const assignedArr = [...assignedValues];
                const deptRows = await pool.query(
                    `SELECT lower(code) AS code, lower(name) AS name
                     FROM departments
                     WHERE company_id = $1
                       AND (lower(code) = ANY($2::text[]) OR lower(name) = ANY($2::text[]))`,
                    [cid, assignedArr]
                );
                // Start with the raw assigned values, then add their resolved counterparts
                coveredSet = [...assignedValues];
                for (const d of deptRows.rows) {
                    coveredSet.push(d.code, d.name);
                }
                coveredSet = [...new Set(coveredSet)]; // deduplicate
            }

            if (process.env.NODE_ENV !== 'production') { // SEC-08: never expose in production
                _dbgCro = { hasEnterpriseMgr, assignedValues: [...assignedValues], coveredSet, managers: mgrRes.rows };
            }

            // Step 4: query risks
            const [awaiting, acceptance] = await Promise.all([
                hasEnterpriseMgr
                    // Enterprise-wide Manager exists → CRO sees no awaiting-approval risks
                    ? Promise.resolve({ rows: [] })
                    : coveredSet.length === 0
                        // No managers at all → CRO sees everything
                        ? pool.query(
                            `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, last_evaluated_timestamp
                             FROM risks
                             WHERE company_id = $1
                               AND approval_status = 'Awaiting Approval'
                               AND (risk_status IS NULL OR risk_status != 'Closed')
                               AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                             ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                            [cid]
                        )
                        // Scoped managers exist → exclude risks in covered departments
                        : pool.query(
                            `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, last_evaluated_timestamp
                             FROM risks
                             WHERE company_id = $1
                               AND approval_status = 'Awaiting Approval'
                               AND (risk_status IS NULL OR risk_status != 'Closed')
                               AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                               AND (department IS NOT NULL AND lower(department) != ALL($2::text[]))
                             ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                            [cid, coveredSet]
                        ),
                pool.query(
                    `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, assessed_by, treatment_strategy, last_evaluated_timestamp
                     FROM risks
                     WHERE company_id = $1
                       AND approval_status = 'Approved'
                       AND cro_acceptance_status = 'pending_cro'
                       AND (risk_status IS NULL OR risk_status != 'Closed')
                       AND version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
                     ORDER BY last_evaluated_timestamp ASC NULLS FIRST`,
                    [cid]
                ),
            ]);
            croApprovalQueue = awaiting.rows.map((r) => ({
                id: r.id, risk_uid: r.risk_uid, department: r.department,
                risk_category: r.risk_category, risk_detail: r.risk_detail,
                risk_owner: r.risk_owner, assessed_by: r.assessed_by,
                submitted_at: r.last_evaluated_timestamp,
            }));
            croAcceptanceQueue = acceptance.rows.map((r) => ({
                id: r.id, risk_uid: r.risk_uid, department: r.department,
                risk_category: r.risk_category, risk_detail: r.risk_detail,
                risk_owner: r.risk_owner, treatment_strategy: r.treatment_strategy,
                submitted_at: r.last_evaluated_timestamp,
            }));
        }

        // ── Risks due for review ─────────────────────────────────────────────────
        // Surface approved/open risks whose next_review_date is within 30 days or overdue.
        // Scoped by role:
        //   CRO / Consultant CRO → all risks company-wide
        //   Risk Manager         → risks in their department(s)
        //   Risk Champion        → risks they submitted (assessed_by)
        //   Risk Owner           → risks they own (risk_owner)
        let riskReviewsDue = [];
        const reviewRole = req.company.role;
        const REVIEW_WINDOW_DAYS = 30;
        const latestVersionSubq = `version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)`;
        const reviewBaseWhere = `company_id = $1 AND ${latestVersionSubq} AND approval_status = 'Approved' AND (risk_status IS NULL OR risk_status != 'Closed') AND next_review_date IS NOT NULL AND next_review_date <= (CURRENT_DATE + INTERVAL '${REVIEW_WINDOW_DAYS} days')`;

        let reviewRes;
        const reviewSelect = `SELECT id, risk_uid, department, risk_category, risk_detail, risk_owner, next_review_date, assessed_by FROM risks`;
        if (reviewRole === 'CRO' || reviewRole === 'Consultant CRO') {
            reviewRes = await pool.query(
                `${reviewSelect} WHERE ${reviewBaseWhere} ORDER BY next_review_date ASC`,
                [req.company.id]
            );
        } else if (reviewRole === 'Risk Manager') {
            const mgDepts = getManagerDepts(req);
            if (mgDepts.length > 0) {
                reviewRes = await pool.query(
                    `${reviewSelect} WHERE ${reviewBaseWhere} AND (lower(department) = ANY($2::text[]) OR lower(department) IN (SELECT lower(name) FROM departments WHERE company_id = $1 AND lower(code) = ANY($2::text[])) OR lower(department) IN (SELECT lower(code) FROM departments WHERE company_id = $1 AND lower(name) = ANY($2::text[]))) ORDER BY next_review_date ASC`,
                    [req.company.id, mgDepts]
                );
            } else {
                reviewRes = await pool.query(
                    `${reviewSelect} WHERE ${reviewBaseWhere} ORDER BY next_review_date ASC`,
                    [req.company.id]
                );
            }
        } else if (reviewRole === 'Risk Champion') {
            reviewRes = await pool.query(
                `${reviewSelect} WHERE ${reviewBaseWhere} AND lower(assessed_by) = $2 ORDER BY next_review_date ASC`,
                [req.company.id, email]
            );
        } else if (reviewRole === 'Risk Owner') {
            reviewRes = await pool.query(
                `${reviewSelect} WHERE ${reviewBaseWhere} AND lower(risk_owner) = $2 ORDER BY next_review_date ASC`,
                [req.company.id, email]
            );
        }
        if (reviewRes) {
            riskReviewsDue = reviewRes.rows.map((r) => ({
                id: r.id,
                risk_uid: r.risk_uid,
                department: r.department,
                risk_category: r.risk_category,
                risk_detail: r.risk_detail,
                risk_owner: r.risk_owner,
                next_review_date: r.next_review_date ? new Date(r.next_review_date).toISOString().slice(0, 10) : null,
                assessed_by: r.assessed_by,
                overdue: r.next_review_date && new Date(r.next_review_date) < today,
            }));
        }

        // ── Appetite breaches relevant to this user ──────────────────────────────
        // Surfaced for CRO (all breaches), Risk Manager (their depts), Risk Owner
        // (risks they own). The breach_notification_severity on the appetite
        // statement controls urgency display (Critical / High) in the UI.
        let appetiteBreaches = [];
        const breachRole = req.company.role;
        if (['CRO', 'Consultant CRO', 'Risk Manager', 'Risk Owner'].includes(breachRole)) {
            const latestVerSubq = `r.version = (SELECT MAX(r2.version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid)`;
            const baseWhere = `r.company_id = $1 AND r.appetite_category_breach = TRUE AND r.approval_status NOT IN ('Draft','Declined') AND ${latestVerSubq}`;
            const breachSelect = `
                SELECT r.id, r.risk_uid, r.risk_detail, r.department, r.risk_category, r.risk_owner,
                       r.residual_likelihood * r.residual_impact AS residual_score,
                       ras.max_residual_score, ras.breach_notification_severity, ras.required_breach_action
                  FROM risks r
                  LEFT JOIN risk_appetite_statements ras
                         ON ras.company_id = r.company_id AND ras.risk_category = r.risk_category AND ras.is_current = TRUE`;
            const orderBy = `ORDER BY (ras.breach_notification_severity = 'Critical') DESC, (r.residual_likelihood * r.residual_impact) DESC`;

            let breachRes;
            if (breachRole === 'CRO' || breachRole === 'Consultant CRO') {
                breachRes = await pool.query(
                    `${breachSelect} WHERE ${baseWhere} ${orderBy}`,
                    [req.company.id]
                );
            } else if (breachRole === 'Risk Manager') {
                const mgDepts = getManagerDepts(req);
                if (mgDepts.length > 0) {
                    breachRes = await pool.query(
                        `${breachSelect} WHERE ${baseWhere}
                           AND (lower(r.department) = ANY($2::text[])
                                OR lower(r.department) IN (SELECT lower(name) FROM departments WHERE company_id = $1 AND lower(code) = ANY($2::text[]))
                                OR lower(r.department) IN (SELECT lower(code) FROM departments WHERE company_id = $1 AND lower(name) = ANY($2::text[])))
                         ${orderBy}`,
                        [req.company.id, mgDepts]
                    );
                } else {
                    // Enterprise-wide manager — all breaches
                    breachRes = await pool.query(
                        `${breachSelect} WHERE ${baseWhere} ${orderBy}`,
                        [req.company.id]
                    );
                }
            } else if (breachRole === 'Risk Owner') {
                breachRes = await pool.query(
                    `${breachSelect} WHERE ${baseWhere} AND lower(r.risk_owner) = $2 ${orderBy}`,
                    [req.company.id, email]
                );
            }

            if (breachRes) {
                appetiteBreaches = breachRes.rows.map((r) => ({
                    id: r.id,
                    risk_uid: r.risk_uid,
                    risk_detail: r.risk_detail,
                    department: r.department,
                    risk_category: r.risk_category,
                    risk_owner: r.risk_owner,
                    residual_score: parseInt(r.residual_score, 10),
                    max_residual_score: r.max_residual_score,
                    breach_notification_severity: r.breach_notification_severity,
                    required_breach_action: r.required_breach_action,
                }));
            }
        }

        res.json({
            pending_attestations: pendingAttestations,
            control_tests: controlTasks,
            my_issues: myIssues,
            policy_reviews: policyTasks,
            my_kris: kriTasks,
            overdue_kri_count: overdueKriCount,
            approver_queue: approverQueue,
            manager_queue: managerQueue,
            cro_approval_queue: croApprovalQueue,
            cro_acceptance_queue: croAcceptanceQueue,
            risk_reviews_due: riskReviewsDue,
            appetite_breaches: appetiteBreaches,
            ...(process.env.NODE_ENV === 'staging' ? { _debug_cro: _dbgCro } : {}),
        });
    })
);

// ============================================================
// Bulk Import (H1)
// ============================================================
//
// CSV-based onboarding for clients moving off Excel. Each module has a
// downloadable template (header row + one example row) and an import
// endpoint that processes every row independently -- a bad row is
// reported with its error but doesn't block the rest of the batch, so
// a 200-row register with three typos still imports the other 197.

const IMPORT_SPECS = {
    risks: {
        columns: [
            'department', 'risk_category', 'sub_category', 'risk_detail', 'risk_cause', 'risk_consequence', 'risk_owner',
            'treatment_strategy', 'inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact',
            'tolerance_threshold', 'tolerance_threshold_score', 'risk_velocity', 'treatment_plan_rationale', 'accept_approved_by',
            'review_frequency', 'next_review_date', 'framework_reference',
        ],
        example: {
            department: 'Finance', risk_category: 'Operational Risk', sub_category: 'Process Risk',
            risk_detail: 'Manual journal entries are not independently reviewed before posting',
            risk_cause: 'Process - Lack of Control', risk_consequence: 'Financial Loss',
            risk_owner: 'finance.manager@client.com', treatment_strategy: 'Mitigate / Treat (ISO Standard Target)',
            inherent_likelihood: '4', inherent_impact: '4', residual_likelihood: '2', residual_impact: '3',
            tolerance_threshold: '', tolerance_threshold_score: '12', risk_velocity: 'Medium-term (6-12 months)',
            treatment_plan_rationale: '', accept_approved_by: '', review_frequency: 'Annual',
            next_review_date: '2027-01-01', framework_reference: 'COSO',
        },
    },
    controls: {
        columns: ['name', 'description', 'control_type', 'automation', 'owner', 'testing_frequency', 'evidence_required', 'framework_reference', 'department'],
        example: {
            name: 'Quarterly Bank Reconciliation', description: 'All bank accounts reconciled to GL monthly',
            control_type: 'Detective', automation: 'Manual', owner: 'finance.manager@client.com',
            testing_frequency: 'Quarterly', evidence_required: 'Signed reconciliation worksheet', framework_reference: 'COSO',
            department: 'Finance',
        },
    },
    policies: {
        columns: ['name', 'category', 'description', 'content_owner', 'approver', 'effective_date', 'review_frequency', 'next_review_date'],
        example: {
            name: 'Code of Conduct', category: 'Governance', description: 'Sets expectations for employee behaviour',
            content_owner: 'hr.manager@client.com', approver: 'admin@client.com', effective_date: '2026-01-01',
            review_frequency: 'Annual', next_review_date: '2027-01-01',
        },
    },
    obligations: {
        columns: [
            'regulatory_body', 'regulation_name', 'reference', 'description', 'applicable_to', 'obligation_owner',
            'evidence_of_compliance', 'reporting_requirement', 'next_reporting_date', 'next_review_date', 'compliance_status',
        ],
        example: {
            regulatory_body: 'QCB', regulation_name: 'AML/CFT Circular', reference: 'QCB-2024-07',
            description: 'Quarterly AML/CFT compliance reporting requirement', applicable_to: 'Finance',
            obligation_owner: 'finance.manager@client.com', evidence_of_compliance: 'Quarterly filing confirmation',
            reporting_requirement: 'Quarterly filing to QCB', next_reporting_date: '2026-09-30',
            next_review_date: '2027-01-01', compliance_status: 'Not Yet Assessed',
        },
    },
    risk_register: {
        columns: [
            // Risk
            'department', 'risk_detail', 'risk_cause', 'risk_consequence', 'risk_owner',
            'risk_category', 'sub_category', 'treatment_strategy',
            'inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact',
            'tolerance_threshold', 'treatment_plan_rationale', 'review_frequency', 'next_review_date',
            'framework_reference', 'risk_velocity',
            // Controls (max 5)
            'control_1_name', 'control_1_type', 'control_1_automation', 'control_1_owner', 'control_1_frequency', 'control_1_effectiveness',
            'control_2_name', 'control_2_type', 'control_2_owner', 'control_2_effectiveness',
            'control_3_name', 'control_3_owner', 'control_3_effectiveness',
            'control_4_name', 'control_4_owner',
            'control_5_name', 'control_5_owner',
            // Mitigation actions (max 3)
            'action_1_description', 'action_1_owner', 'action_1_due_date', 'action_1_status',
            'action_2_description', 'action_2_owner', 'action_2_due_date',
            'action_3_description', 'action_3_owner',
        ],
        example: {
            department: 'Finance', risk_detail: 'Risk of fraudulent transactions due to inadequate access controls',
            risk_cause: 'Excessive user privileges in the ERP system', risk_consequence: 'Financial loss and reputational damage',
            risk_owner: 'finance.manager@client.com', risk_category: 'Operational Risk', sub_category: 'Process Risk',
            treatment_strategy: 'Mitigate / Treat (ISO Standard Target)',
            inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 2, residual_impact: 3,
            tolerance_threshold: 'Low', treatment_plan_rationale: 'Implement segregation of duties and periodic access reviews',
            review_frequency: 'Quarterly', next_review_date: '2026-10-01',
            framework_reference: 'ISO 31000', risk_velocity: 'Short-term (1-6 months)',
            control_1_name: 'Segregation of Duties', control_1_type: 'Preventive', control_1_automation: 'Manual',
            control_1_owner: 'it.manager@client.com', control_1_frequency: 'Monthly', control_1_effectiveness: 'Effective',
            control_2_name: 'Monthly Access Review', control_2_type: 'Detective', control_2_owner: 'it.manager@client.com', control_2_effectiveness: 'Partially Effective',
            control_3_name: 'Fraud Detection Alerts', control_3_owner: 'finance.manager@client.com', control_3_effectiveness: 'Not yet tested',
            control_4_name: '', control_4_owner: '',
            control_5_name: '', control_5_owner: '',
            action_1_description: 'Implement role-based access control in ERP and remove excessive privileges',
            action_1_owner: 'it.manager@client.com', action_1_due_date: '2026-09-30', action_1_status: 'In Progress',
            action_2_description: 'Conduct quarterly privileged access reviews',
            action_2_owner: 'it.manager@client.com', action_2_due_date: '2026-12-31',
            action_3_description: '', action_3_owner: '',
        },
    },
};

app.get(
    '/api/import/:module/template',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    (req, res) => {
        const spec = IMPORT_SPECS[req.params.module];
        if (!spec) return res.status(404).json({ error: 'Unknown import module' });

        const csv = toCSV([spec.example], spec.columns);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.module}_import_template.csv"`);
        res.send(csv);
    }
);

const INT_1_5 = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : fallback;
};

async function importRisksRow(client, req, row, reportingQuarter) {
    const department = req.company.role === 'Risk Manager'
        ? (getManagerDepts(req)[0] || null)
        : (row.department?.trim() || row.business_unit?.trim() || null);
    if (!department) return { error: 'department is required' };
    if (!row.risk_detail?.trim()) return { error: 'risk_detail is required' };

    const il = INT_1_5(row.inherent_likelihood, null);
    const ii = INT_1_5(row.inherent_impact, null);
    const rl = INT_1_5(row.residual_likelihood, null);
    const ri = INT_1_5(row.residual_impact, null);
    if (!il || !ii || !rl || !ri) return { error: 'inherent/residual likelihood and impact must be 1-5' };

    const treatmentStrategy = row.treatment_strategy?.trim() || 'Mitigate / Treat (ISO Standard Target)';
    if (treatmentStrategy === 'Accept') {
        if (!row.treatment_plan_rationale?.trim() || !row.accept_approved_by?.trim()) {
            return { error: '"Accept" treatment requires treatment_plan_rationale and accept_approved_by' };
        }
        if (req.company.role === 'Risk Manager' && row.accept_approved_by.trim().toLowerCase() === req.user.email.toLowerCase()) {
            return { error: 'A Risk Manager cannot self-approve a "Risk Accepted" disposition' };
        }
    }

    const uid = await generateUniqueRiskID(client, req.company.id, department);
    const approvalStatus = req.company.role === 'Admin' ? 'Approved' : 'Awaiting Approval';
    const croAcceptanceStatus = (approvalStatus === 'Approved' && ['Accept', 'Avoid'].includes(treatmentStrategy)) ? 'pending_cro' : null;

    const VELOCITIES = ['Immediate (<1 month)', 'Short-term (1-6 months)', 'Medium-term (6-12 months)', 'Long-term (>12 months)'];
    const riskVelocity = VELOCITIES.includes(row.risk_velocity?.trim()) ? row.risk_velocity.trim() : null;
    let toleranceScore = null;
    if (row.tolerance_threshold_score?.trim()) {
        const parsed = parseInt(row.tolerance_threshold_score, 10);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 25) toleranceScore = parsed;
    }

    const insertRes = await client.query(
        `INSERT INTO risks (
            company_id, risk_uid, version, reporting_quarter, department, risk_category, sub_category,
            risk_detail, risk_cause, risk_consequence, risk_owner, treatment_strategy,
            inherent_likelihood, inherent_impact, residual_likelihood, residual_impact,
            tolerance_threshold, treatment_plan_rationale, accept_approved_by,
            review_frequency, next_review_date, framework_reference,
            approval_status, assessed_by, directional_trend, tolerance_threshold_score, risk_velocity,
            cro_acceptance_status
         ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'STABLE',$24,$25,$26)
         RETURNING risk_uid`,
        [
            req.company.id, uid, reportingQuarter, department,
            row.risk_category?.trim() || 'Operational Risk', row.sub_category?.trim() || 'Process Risk',
            row.risk_detail.trim(), row.risk_cause?.trim() || null, row.risk_consequence?.trim() || null,
            row.risk_owner?.trim() || null, treatmentStrategy, il, ii, rl, ri,
            row.tolerance_threshold?.trim() || null, row.treatment_plan_rationale?.trim() || null,
            row.accept_approved_by?.trim() || null, row.review_frequency?.trim() || 'Annual',
            row.next_review_date?.trim() || null, row.framework_reference?.trim() || null,
            approvalStatus, req.user.email, toleranceScore, riskVelocity, croAcceptanceStatus,
        ]
    );
    return { uid: insertRes.rows[0].risk_uid };
}

async function importControlsRow(client, req, row) {
    if (!row.name?.trim()) return { error: 'name is required' };

    const department = req.company.role === 'Risk Manager' ? (getManagerDepts(req)[0] || null) : row.department?.trim() || null;
    const controlType = ['Preventive', 'Detective', 'Corrective', 'Directive'].includes(row.control_type?.trim()) ? row.control_type.trim() : 'Preventive';
    const automation = ['Manual', 'Automated'].includes(row.automation?.trim()) ? row.automation.trim() : 'Manual';
    const frequency = ['Monthly', 'Quarterly', 'Annual'].includes(row.testing_frequency?.trim()) ? row.testing_frequency.trim() : 'Quarterly';

    const uid = await generateUniqueControlID(client, req.company.id, row.department?.trim() || null);
    const insertRes = await client.query(
        `INSERT INTO controls_lib (company_id, control_uid, name, description, control_type, automation, owner,
                                    testing_frequency, evidence_required, framework_reference, department)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING control_uid`,
        [
            req.company.id, uid, row.name.trim(), row.description?.trim() || null, controlType, automation,
            row.owner?.trim() || null, frequency, row.evidence_required?.trim() || null,
            row.framework_reference?.trim() || null, department,
        ]
    );
    return { uid: insertRes.rows[0].control_uid };
}

async function importPoliciesRow(client, req, row) {
    if (!row.name?.trim()) return { error: 'name is required' };
    const frequency = ['Monthly', 'Quarterly', 'Annual', 'Biennial'].includes(row.review_frequency?.trim()) ? row.review_frequency.trim() : 'Annual';

    const uid = await generateUnique4PartID(client, req.company.id, 'policies', 'policy_uid', 'POL', null);
    const insertRes = await client.query(
        `INSERT INTO policies (company_id, policy_uid, version, name, category, description, content_owner, approver,
                                effective_date, review_frequency, next_review_date, created_by)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING policy_uid`,
        [
            req.company.id, uid, row.name.trim(), row.category?.trim() || 'Governance', row.description?.trim() || null,
            row.content_owner?.trim() || null, row.approver?.trim() || null, row.effective_date?.trim() || null,
            frequency, row.next_review_date?.trim() || null, req.user.email,
        ]
    );
    return { uid: insertRes.rows[0].policy_uid };
}

async function importObligationsRow(client, req, row) {
    if (!row.regulation_name?.trim()) return { error: 'regulation_name is required' };

    const applicableTo = req.company.role === 'Risk Manager' ? (getManagerDepts(req)[0] || null) : row.applicable_to?.trim() || null;
    const validStatuses = ['Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Yet Assessed'];
    const status = validStatuses.includes(row.compliance_status?.trim()) ? row.compliance_status.trim() : 'Not Yet Assessed';

    const uid = await generateUnique4PartID(client, req.company.id, 'compliance_obligations', 'obligation_uid', 'OBL', applicableTo || null);
    const insertRes = await client.query(
        `INSERT INTO compliance_obligations (
            company_id, obligation_uid, regulatory_body, regulation_name, reference, description, applicable_to,
            compliance_status, obligation_owner, evidence_of_compliance, reporting_requirement, next_reporting_date,
            next_review_date, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING obligation_uid`,
        [
            req.company.id, uid, row.regulatory_body?.trim() || null, row.regulation_name.trim(),
            row.reference?.trim() || null, row.description?.trim() || null, applicableTo, status,
            row.obligation_owner?.trim() || null, row.evidence_of_compliance?.trim() || null,
            row.reporting_requirement?.trim() || null, row.next_reporting_date?.trim() || null,
            row.next_review_date?.trim() || null, req.user.email,
        ]
    );

    await client.query('INSERT INTO obligation_status_history (obligation_id, status, notes, changed_by) VALUES ((SELECT id FROM compliance_obligations WHERE company_id=$1 AND obligation_uid=$2), $3, $4, $5)', [
        req.company.id, insertRes.rows[0].obligation_uid, status, 'Imported', req.user.email,
    ]);

    return { uid: insertRes.rows[0].obligation_uid };
}

// ── Risk Register (Full) — creates risk + linked controls + action in one row ─

async function importRiskRegisterRow(client, req, row, reportingQuarter) {
    // 1. Create the risk — reuse existing handler
    const riskResult = await importRisksRow(client, req, row, reportingQuarter);
    if (riskResult.error) return riskResult;

    // Look up the integer PK so we can attach controls / actions
    const riskPkRes = await client.query(
        'SELECT id FROM risks WHERE company_id = $1 AND risk_uid = $2',
        [req.company.id, riskResult.uid]
    );
    const riskId = riskPkRes.rows[0]?.id;
    if (!riskId) return { error: 'Risk was created but could not be retrieved — please retry' };

    const CONTROL_TYPES    = ['Preventive', 'Detective', 'Corrective', 'Directive'];
    const AUTOMATIONS      = ['Manual', 'Automated'];
    const FREQUENCIES      = ['Monthly', 'Quarterly', 'Annual'];
    const EFFECTIVENESS    = ['Effective', 'Partially Effective', 'Ineffective'];
    const dept             = row.department?.trim() || null;

    // Expand inline-delimited controls in control_1_name (e.g. "Firewall; MFA\nPatch Mgmt")
    // into control_2_name, control_3_name … slots (up to the 5-control limit).
    // Only the name is split; other attributes (type, owner, etc.) inherit defaults.
    if (row.control_1_name && /[\n;]/.test(row.control_1_name)) {
        const parts = row.control_1_name.split(/\n|;\s*/).map(s => s.trim()).filter(Boolean);
        parts.forEach((name, idx) => {
            const slot = idx + 1; // slot 1 is control_1_name
            if (slot <= 5 && !row[`control_${slot}_name`]?.trim()) {
                row[`control_${slot}_name`] = name;
            }
        });
        row.control_1_name = parts[0] || '';
    }

    // Similarly expand action_1_description if it contains multiple actions delimited by newlines or semicolons
    if (row.action_1_description && /[\n;]/.test(row.action_1_description)) {
        const parts = row.action_1_description.split(/\n|;\s*/).map(s => s.trim()).filter(Boolean);
        parts.forEach((desc, idx) => {
            const slot = idx + 1;
            if (slot <= 3 && !row[`action_${slot}_description`]?.trim()) {
                row[`action_${slot}_description`] = desc;
            }
        });
        row.action_1_description = parts[0] || '';
    }

    // 2. Up to 5 controls per row (control_1_* … control_5_*)
    for (let i = 1; i <= 5; i++) {
        const ctrlName = row[`control_${i}_name`]?.trim();
        if (!ctrlName) continue;

        const ctrlType   = CONTROL_TYPES.includes(row[`control_${i}_type`]?.trim())   ? row[`control_${i}_type`].trim()   : 'Preventive';
        const automation = AUTOMATIONS.includes(row[`control_${i}_automation`]?.trim()) ? row[`control_${i}_automation`].trim() : 'Manual';
        const frequency  = FREQUENCIES.includes(row[`control_${i}_frequency`]?.trim()) ? row[`control_${i}_frequency`].trim() : 'Quarterly';
        const eff        = EFFECTIVENESS.includes(row[`control_${i}_effectiveness`]?.trim()) ? row[`control_${i}_effectiveness`].trim() : 'Not Tested';

        const ctrlUid = await generateUniqueControlID(client, req.company.id, dept);
        const ctrlInsert = await client.query(
            `INSERT INTO controls_lib
                (company_id, control_uid, name, description, control_type, automation, owner,
                 testing_frequency, last_test_result, framework_reference, department)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
                req.company.id, ctrlUid, ctrlName,
                row[`control_${i}_description`]?.trim() || null,
                ctrlType, automation,
                row[`control_${i}_owner`]?.trim() || null,
                frequency, eff,
                row[`control_${i}_framework`]?.trim() || null,
                dept,
            ]
        );
        await client.query(
            'INSERT INTO risk_controls (risk_id, control_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [riskId, ctrlInsert.rows[0].id]
        );
    }

    // 3. Up to 3 mitigation actions (MAP) per row (action_1_* … action_3_*)
    const VALID_ACTION_STATUSES = ['Pending', 'In Progress', 'Complete', 'Deferred', 'Cancelled'];
    for (let j = 1; j <= 3; j++) {
        const actionDesc = row[`action_${j}_description`]?.trim();
        if (!actionDesc) continue;
        const actionStatus = VALID_ACTION_STATUSES.includes(row[`action_${j}_status`]?.trim()) ? row[`action_${j}_status`].trim() : 'Pending';
        const mapUid = await generateMitigationUID(client, req.company.id);
        await client.query(
            `INSERT INTO mitigations
                (risk_id, mitigation_uid, action, action_owner, end_date, status, company_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [riskId, mapUid, actionDesc, row[`action_${j}_owner`]?.trim() || null, row[`action_${j}_due_date`]?.trim() || null, actionStatus, req.company.id]
        );
    }

    return { uid: riskResult.uid };
}

const IMPORT_ROW_HANDLERS = {
    risks: importRisksRow,
    controls: importControlsRow,
    policies: importPoliciesRow,
    obligations: importObligationsRow,
    risk_register: importRiskRegisterRow,
};

app.post(
    '/api/import/:module',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    asyncHandler(async (req, res) => {
        const handler = IMPORT_ROW_HANDLERS[req.params.module];
        if (!handler) return res.status(404).json({ error: 'Unknown import module' });
        if (!req.body.csv) return res.status(400).json({ error: 'csv (text) is required' });

        const dry_run = !!req.body.dry_run;

        const rows = parseCSV(req.body.csv);
        if (rows.length === 0) return res.status(400).json({ error: 'No data rows found in CSV' });
        if (rows.length > 1000) return res.status(400).json({ error: 'Import is limited to 1000 rows per file' });

        // Reporting quarter for risks is computed once, same as POST /api/risks.
        let reportingQuarter = null;
        if (req.params.module === 'risks') {
            const matrixRes = await pool.query('SELECT fiscal_year_start_month FROM matrix_settings WHERE company_id = $1', [req.company.id]);
            const startMonth = matrixRes.rows[0]?.fiscal_year_start_month || 0;
            const now = new Date();
            let monthsSinceStart = now.getMonth() - startMonth;
            if (monthsSinceStart < 0) monthsSinceStart += 12;
            reportingQuarter = `Q${Math.floor(monthsSinceStart / 3) + 1}-FY${now.getFullYear()}`;
        }

        const client = await pool.connect();
        const results = [];
        try {
            // Wrap all rows in a single transaction.
            // SAVEPOINTs allow per-row error recovery without aborting the whole tx.
            // dry_run=true rolls back at the end so nothing is persisted.
            await client.query('BEGIN');
            for (let i = 0; i < rows.length; i++) {
                await client.query('SAVEPOINT sp');
                try {
                    const outcome = await handler(client, req, rows[i], reportingQuarter);
                    if (outcome.error) {
                        await client.query('ROLLBACK TO SAVEPOINT sp');
                        results.push({ row: i + 2, status: 'error', error: outcome.error });
                    } else {
                        await client.query('RELEASE SAVEPOINT sp');
                        results.push({ row: i + 2, status: 'ok', uid: outcome.uid });
                    }
                } catch (e) {
                    await client.query('ROLLBACK TO SAVEPOINT sp');
                    results.push({ row: i + 2, status: 'error', error: e.message });
                }
            }
            if (dry_run) {
                await client.query('ROLLBACK');
            } else {
                await client.query('COMMIT');
            }
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        } finally {
            client.release();
        }

        const created = results.filter((r) => r.status === 'ok');
        if (!dry_run) {
            await logAudit(null, {
                companyId: req.company.id,
                entityType: req.params.module,
                entityId: 0,
                action: 'bulk_import',
                actor: req.user,
                details: { module: req.params.module, total_rows: rows.length, created: created.length, errors: rows.length - created.length },
            });
        }

        res.json({ dry_run, total_rows: rows.length, created: created.length, errors: rows.length - created.length, results });
    })
);

// ============================================================
// Standard Controls Seeding (v2.20.0)
// ============================================================

// Jaccard similarity on tokenized control names (used by preview route).
function _tokenizeCtrl(name) {
    return new Set(name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
}
function _jaccard(a, b) {
    const inter = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
}

// GET /api/seed-controls — return the full approved seed list.
app.get(
    '/api/seed-controls',
    requireRole('Admin'),
    asyncHandler(async (_req, res) => {
        res.json({ controls: SEED_CONTROLS });
    })
);

// POST /api/seed-controls/preview
// Body: { csv?: string }
// Parses the client's control CSV and returns Jaccard-based similarity matches.
// Threshold: 0.40 — surfaces probable duplicates without flooding with false positives.
app.post(
    '/api/seed-controls/preview',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { csv } = req.body;
        if (!csv) return res.json({ clientControls: [], matches: [] });

        const rows = parseCSV(csv);
        if (rows.length > 1000) return res.status(400).json({ error: 'Control register must not exceed 1000 rows.' });
        const clientControls = rows
            .filter((r) => r.name?.trim())
            .map((r, i) => ({ idx: i, name: r.name.trim(), department: r.department?.trim() || null }));

        const matches = [];
        SEED_CONTROLS.forEach((seed, si) => {
            const seedTokens = _tokenizeCtrl(seed.name);
            let bestScore = 0;
            let bestClientIdx = -1;
            clientControls.forEach((client, ci) => {
                const score = _jaccard(seedTokens, _tokenizeCtrl(client.name));
                if (score > bestScore) { bestScore = score; bestClientIdx = ci; }
            });
            if (bestScore >= 0.40) {
                matches.push({ seedIdx: si, clientIdx: bestClientIdx, score: Math.round(bestScore * 100) });
            }
        });

        res.json({ clientControls, matches });
    })
);

// POST /api/seed-controls/apply
// Body: {
//   departmentMap: { [seedDept]: companyDeptName },
//   decisions: [{ seedIdx, action: 'seed'|'skip', clientIdx?: number }],
//   csv?: string   // client's control CSV (omitted if company has no existing register)
// }
// action='seed'  → create the standard control (with mapped dept); if clientIdx present,
//                  skip that row from the CSV import (admin chose seed over client).
// action='skip'  → do NOT seed; corresponding client control is imported normally.
app.post(
    '/api/seed-controls/apply',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { departmentMap = {}, decisions = [], csv } = req.body;
        if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions must be an array' });

        // Idempotency guard — prevent double-seeding if wizard is run twice.
        const namesToSeed = decisions
            .filter((d) => d.action === 'seed')
            .map((d) => SEED_CONTROLS[d.seedIdx]?.name)
            .filter(Boolean);
        if (namesToSeed.length > 0) {
            const { rows: existing } = await pool.query(
                `SELECT name FROM controls_lib WHERE company_id = $1 AND name = ANY($2::text[]) LIMIT 1`,
                [req.company.id, namesToSeed]
            );
            if (existing.length > 0) {
                return res.status(409).json({
                    error: `Standard controls have already been seeded for this company (e.g. "${existing[0].name}"). To re-seed, remove the existing standard controls first.`,
                });
            }
        }

        // Build set of client-control indices to suppress from CSV import.
        const suppressedClientIdxs = new Set(
            decisions
                .filter((d) => d.action === 'seed' && d.clientIdx != null)
                .map((d) => d.clientIdx)
        );

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let seeded = 0;
            // 1. Seed selected standard controls.
            for (const decision of decisions) {
                if (decision.action !== 'seed') continue;
                const template = SEED_CONTROLS[decision.seedIdx];
                if (!template) continue;
                const mappedDept = departmentMap[template.department];
                if (!mappedDept) continue; // Admin chose to skip this function
                const uid = await generateUniqueControlID(client, req.company.id, mappedDept);
                await client.query(
                    `INSERT INTO controls_lib (company_id, control_uid, name, description, control_type, department)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [req.company.id, uid, template.name, template.description, template.control_type, mappedDept]
                );
                seeded++;
            }

            // 2. Import client controls from CSV, skipping suppressed rows.
            let imported = 0;
            let importErrors = 0;
            const importRowResults = [];
            if (csv) {
                const rows = parseCSV(csv);
                for (let i = 0; i < rows.length; i++) {
                    if (suppressedClientIdxs.has(i)) continue;
                    const row = rows[i];
                    if (!row.name?.trim()) continue;
                    try {
                        const outcome = await importControlsRow(client, req, row);
                        if (outcome.error) {
                            importErrors++;
                            importRowResults.push({ row: i + 2, status: 'error', error: outcome.error });
                        } else {
                            imported++;
                            importRowResults.push({ row: i + 2, status: 'created', uid: outcome.uid });
                        }
                    } catch (e) {
                        importErrors++;
                        importRowResults.push({ row: i + 2, status: 'error', error: e.message });
                    }
                }
            }

            await client.query('COMMIT');

            // Audit after COMMIT so the log only appears if the data persisted.
            await logAudit(null, {
                companyId: req.company.id,
                entityType: 'controls',
                entityId: 0,
                action: 'seed_controls',
                actor: req.user,
                details: { seeded, imported, importErrors },
            });

            res.json({ seeded, imported, importErrors, importRowResults });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// ============================================================
// Data Export (H6)
// ============================================================
//
// Per-module CSV exports of everything currently visible to the
// requesting user (Manager exports are department-scoped, same as the
// list endpoints) -- covers "export full dataset on request" for
// backup/portability, and Excel opens CSV natively.

const EXPORT_SPECS = {
    risks: {
        columns: [
            'risk_uid', 'version', 'department', 'risk_category', 'sub_category', 'risk_detail', 'risk_cause', 'risk_consequence',
            'risk_owner', 'treatment_strategy', 'inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact',
            'tolerance_threshold_score', 'risk_velocity', 'risk_status', 'closure_reason',
            'approval_status', 'directional_trend', 'next_review_date', 'framework_reference',
        ],
        async fetch(req) {
            const scope = managerScopeClause(req, 'department', 2);
            const result = await pool.query(
                `SELECT * FROM risks r WHERE company_id = $1
                   AND version = (SELECT MAX(version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid)
                   ${scope ? `AND ${scope.clause}` : ''} ORDER BY risk_uid`,
                scope ? [req.company.id, scope.value] : [req.company.id]
            );
            return result.rows;
        },
    },
    controls: {
        columns: ['control_uid', 'name', 'description', 'control_type', 'automation', 'owner', 'department', 'testing_frequency', 'last_test_date', 'last_test_result', 'framework_reference'],
        async fetch(req) {
            const scope = managerScopeClause(req, 'department', 2);
            const result = await pool.query(
                `SELECT * FROM controls_lib WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY control_uid`,
                scope ? [req.company.id, scope.value] : [req.company.id]
            );
            return result.rows;
        },
    },
    kris: {
        columns: ['kri_uid', 'name', 'definition', 'owner', 'department', 'measurement_frequency', 'threshold_source', 'internal_tolerance', 'regulatory_limit', 'breach_direction'],
        async fetch(req) {
            const scope = managerScopeClause(req, 'department', 2);
            const result = await pool.query(
                `SELECT * FROM kris WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY kri_uid`,
                scope ? [req.company.id, scope.value] : [req.company.id]
            );
            return result.rows;
        },
    },
    policies: {
        columns: ['policy_uid', 'version', 'name', 'category', 'description', 'status', 'content_owner', 'approver', 'effective_date', 'review_frequency', 'next_review_date'],
        async fetch(req) {
            const result = await pool.query('SELECT * FROM policies WHERE company_id = $1 ORDER BY policy_uid, version', [req.company.id]);
            return result.rows;
        },
    },
    obligations: {
        columns: ['obligation_uid', 'regulatory_body', 'regulation_name', 'reference', 'description', 'applicable_to', 'compliance_status', 'obligation_owner', 'reporting_requirement', 'next_reporting_date', 'next_review_date'],
        async fetch(req) {
            const scope = managerScopeClause(req, 'applicable_to', 2);
            const result = await pool.query(
                `SELECT * FROM compliance_obligations WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY obligation_uid`,
                scope ? [req.company.id, scope.value] : [req.company.id]
            );
            return result.rows;
        },
    },
    issues: {
        columns: ['issue_uid', 'source_type', 'source_detail', 'description', 'root_cause', 'remediation_plan', 'owner', 'department', 'due_date', 'priority', 'status'],
        async fetch(req) {
            const scope = managerScopeClause(req, 'department', 2);
            const result = await pool.query(
                `SELECT * FROM issues WHERE company_id = $1 ${scope ? `AND ${scope.clause}` : ''} ORDER BY issue_uid`,
                scope ? [req.company.id, scope.value] : [req.company.id]
            );
            return result.rows;
        },
    },
};

app.get(
    '/api/export/:module',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    asyncHandler(async (req, res) => {
        const spec = EXPORT_SPECS[req.params.module];
        if (!spec) return res.status(404).json({ error: 'Unknown export module' });

        const rows = await spec.fetch(req);
        const csv = toCSV(rows, spec.columns);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.module}_export.csv"`);
        res.send(csv);
    })
);

// ============================================================
// Global Search (H8)
// ============================================================
//
// "Where does X show up" -- searches Risks, Controls, Policies,
// Compliance Obligations, KRIs, and Issues by ID, name, or keyword.
// Respects the same department scoping as each module's list view.

app.get(
    '/api/search',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    asyncHandler(async (req, res) => {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json({ results: [] });
        const like = `%${q}%`;

        const riskScope = managerScopeClause(req, 'department', 3);
        const controlScope = managerScopeClause(req, 'department', 3);
        const kriScope = managerScopeClause(req, 'department', 3);
        const obligationScope = managerScopeClause(req, 'applicable_to', 3);
        const issueScope = managerScopeClause(req, 'department', 3);

        const buildParams = (scope) => (scope ? [req.company.id, like, scope.value] : [req.company.id, like]);

        const [risks, controls, policies, kris, obligations, issues] = await Promise.all([
            pool.query(
                `SELECT risk_uid AS uid, risk_detail AS title, department AS subtitle FROM risks r WHERE company_id = $1
                   AND (risk_uid ILIKE $2 OR risk_detail ILIKE $2)
                   AND version = (SELECT MAX(version) FROM risks r2 WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid)
                   ${riskScope ? `AND ${riskScope.clause}` : ''} ORDER BY risk_uid LIMIT 10`,
                buildParams(riskScope)
            ),
            pool.query(
                `SELECT control_uid AS uid, name AS title, department AS subtitle FROM controls_lib WHERE company_id = $1
                   AND (control_uid ILIKE $2 OR name ILIKE $2 OR description ILIKE $2)
                   ${controlScope ? `AND ${controlScope.clause}` : ''} ORDER BY control_uid LIMIT 10`,
                buildParams(controlScope)
            ),
            pool.query(
                `SELECT policy_uid AS uid, name AS title, status AS subtitle FROM policies p WHERE company_id = $1
                   AND (policy_uid ILIKE $2 OR name ILIKE $2 OR description ILIKE $2)
                   AND version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid)
                   ORDER BY policy_uid LIMIT 10`,
                [req.company.id, like]
            ),
            pool.query(
                `SELECT kri_uid AS uid, name AS title, department AS subtitle FROM kris WHERE company_id = $1
                   AND (kri_uid ILIKE $2 OR name ILIKE $2 OR definition ILIKE $2)
                   ${kriScope ? `AND ${kriScope.clause}` : ''} ORDER BY kri_uid LIMIT 10`,
                buildParams(kriScope)
            ),
            pool.query(
                `SELECT obligation_uid AS uid, regulation_name AS title, applicable_to AS subtitle FROM compliance_obligations WHERE company_id = $1
                   AND (obligation_uid ILIKE $2 OR regulation_name ILIKE $2 OR description ILIKE $2 OR reference ILIKE $2)
                   ${obligationScope ? `AND ${obligationScope.clause}` : ''} ORDER BY obligation_uid LIMIT 10`,
                buildParams(obligationScope)
            ),
            pool.query(
                `SELECT issue_uid AS uid, description AS title, status AS subtitle FROM issues WHERE company_id = $1
                   AND (issue_uid ILIKE $2 OR description ILIKE $2 OR root_cause ILIKE $2)
                   ${issueScope ? `AND ${issueScope.clause}` : ''} ORDER BY issue_uid LIMIT 10`,
                buildParams(issueScope)
            ),
        ]);

        res.json({
            results: {
                risks: risks.rows,
                controls: controls.rows,
                policies: policies.rows,
                kris: kris.rows,
                obligations: obligations.rows,
                issues: issues.rows,
            },
        });
    })
);

// ============================================================
// Escalation Rules & Notifications (G5)
// ============================================================
//
// Configurable workflow: the Client Admin defines, per trigger type, who
// gets notified and (optionally) who it escalates to after how many days.
// GET /api/notifications computes current notifications from these rules
// against live data -- the same overdue/breach logic as F2 My Tasks and
// F1 Management Summary, just filtered through the configured targets.
// Email delivery is a follow-on once an SMTP provider is configured; this
// phase delivers the in-app side and the configuration screen.

app.get(
    '/api/escalation-rules',
    can('escalation_rules.manage'), // Phase C cutover -- was requireRole('Admin', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const result = await pool.query('SELECT * FROM escalation_rules WHERE company_id = $1 ORDER BY trigger_type', [req.company.id]);
        res.json(result.rows);
    })
);

app.post(
    '/api/escalation-rules',
    can('escalation_rules.manage'), // Phase C cutover -- was requireRole('Admin', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const { trigger_type, threshold_days = 0, notify_target = 'Owner', escalate_after_days = null, escalate_to = null, channels = 'in_app', is_active = true } = req.body;

        const VALID_TRIGGERS = ['control_test_overdue', 'kri_red_breach', 'kri_measurement_due', 'policy_review_due', 'issue_overdue', 'obligation_non_compliant', 'appetite_review_due'];
        if (!trigger_type || !VALID_TRIGGERS.includes(trigger_type)) {
            return res.status(400).json({ error: 'Invalid trigger_type' });
        }

        const result = await pool.query(
            `INSERT INTO escalation_rules (company_id, trigger_type, threshold_days, notify_target, escalate_after_days, escalate_to, channels, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [req.company.id, trigger_type, threshold_days, notify_target, escalate_after_days, escalate_to, channels, is_active]
        );

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'escalation_rule',
            entityId: result.rows[0].id,
            action: 'create',
            actor: req.user,
            details: req.body,
        });

        res.status(201).json(result.rows[0]);
    })
);

app.patch(
    '/api/escalation-rules/:id',
    can('escalation_rules.manage'), // Phase C cutover -- was requireRole('Admin', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const fields = ['threshold_days', 'notify_target', 'escalate_after_days', 'escalate_to', 'channels', 'is_active'];
        const updates = [];
        const values = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE escalation_rules SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Escalation rule not found' });

        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'escalation_rule',
            entityId: result.rows[0].id,
            action: 'update',
            actor: req.user,
            details: req.body,
        });

        res.json(result.rows[0]);
    })
);

// Resolves who an escalation rule's target maps to for a given item.
// "Owner" = the item's own owner field; "Department Manager" = any
// Manager whose department matches the item's department (or any Manager
// if the item is enterprise-wide); "Admin" = any Admin of the company.
function resolveNotifyTargets(target, itemDepartment, itemOwner, usersByEmail, managersByDept, admins) {
    if (target === 'Owner') return itemOwner ? [itemOwner] : [];
    if (target === 'Admin') return admins;
    if (target === 'Department Manager') {
        if (!itemDepartment) return admins; // enterprise-wide items escalate straight to Admin-equivalent oversight
        return managersByDept[itemDepartment.toLowerCase()] || [];
    }
    return [];
}

app.get(
    '/api/notifications',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'CRO'),
    asyncHandler(async (req, res) => {
        const rulesRes = await pool.query('SELECT * FROM escalation_rules WHERE company_id = $1 AND is_active = true', [req.company.id]);
        const rules = {};
        for (const r of rulesRes.rows) rules[r.trigger_type] = r;

        const usersRes = await pool.query(
            `SELECT u.email, uc.role, uc.department FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.company_id = $1 AND u.is_active = true`,
            [req.company.id]
        );
        const admins = usersRes.rows.filter((u) => u.role === 'Admin').map((u) => u.email);
        const managersByDept = {};
        for (const u of usersRes.rows) {
            if (u.role === 'Risk Manager' && u.department) {
                const key = u.department.toLowerCase();
                (managersByDept[key] = managersByDept[key] || []).push(u.email);
            }
        }

        const today = new Date();
        const notifications = [];

        const isForMe = (recipients) => recipients.some((r) => r.toLowerCase() === req.user.email.toLowerCase());
        const escalationLevel = (rule, daysPast) => {
            if (rule.escalate_after_days != null && daysPast >= rule.threshold_days + rule.escalate_after_days) return 'escalated';
            return 'initial';
        };

        // -- Control tests overdue --
        if (rules.control_test_overdue) {
            const rule = rules.control_test_overdue;
            const controlsRes = await pool.query('SELECT * FROM controls_lib WHERE company_id = $1', [req.company.id]);
            for (const c of controlsRes.rows) {
                if (!c.last_test_date) continue;
                const months = TESTING_FREQUENCY_MONTHS[c.testing_frequency] || 12;
                const nextDue = addMonths(new Date(c.last_test_date), months);
                const daysPast = daysBetween(today, nextDue);
                if (daysPast < rule.threshold_days) continue;
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, c.department, c.owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'control_test_overdue', level, entity_uid: c.control_uid, entity_name: c.name,
                        message: `Control ${c.control_uid} (${c.name}) test is ${daysPast} day(s) overdue`, days_past: daysPast,
                    });
                }
            }
        }

        // -- KRI Red breaches --
        if (rules.kri_red_breach) {
            const rule = rules.kri_red_breach;
            const krisRes = await pool.query('SELECT * FROM kris WHERE company_id = $1', [req.company.id]);
            for (const k of krisRes.rows) {
                const latestRes = await pool.query(
                    `SELECT value, measurement_date FROM kri_measurements WHERE kri_id = $1 ORDER BY measurement_date DESC, id DESC LIMIT 1`,
                    [k.id]
                );
                if (latestRes.rows.length === 0) continue;
                const { value, measurement_date } = latestRes.rows[0];
                if (computeKriBand(k, value) !== 'Red') continue;
                const daysPast = daysBetween(today, new Date(measurement_date));
                if (daysPast < rule.threshold_days) continue;
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, k.department, k.owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'kri_red_breach', level, entity_uid: k.kri_uid, entity_name: k.name,
                        message: `KRI ${k.kri_uid} (${k.name}) is in the Red zone (value ${value})`, days_past: daysPast,
                    });
                }
            }
        }

        // -- KRI measurements due (proactive: fires N days before next measurement is due) --
        if (rules.kri_measurement_due) {
            const rule = rules.kri_measurement_due;
            const freqDays = { Daily: 1, Weekly: 7, Monthly: 31, Quarterly: 92, 'Semi-Annual': 183, Annual: 365 };
            const krisRes = await pool.query('SELECT * FROM kris WHERE company_id = $1', [req.company.id]);
            for (const k of krisRes.rows) {
                const periodDays = freqDays[k.measurement_frequency] ?? 31;
                const latestRes = await pool.query(
                    `SELECT measurement_date FROM kri_measurements WHERE kri_id = $1 ORDER BY measurement_date DESC, id DESC LIMIT 1`,
                    [k.id]
                );
                // nextDueDays: how many days until (or past) the next measurement is due.
                // Positive = overdue by N days. Negative = due in N days.
                let nextDueDays;
                if (latestRes.rows.length === 0) {
                    // Never measured — treat as immediately due
                    nextDueDays = 0;
                } else {
                    const lastDate = new Date(latestRes.rows[0].measurement_date);
                    const nextDue = new Date(lastDate.getTime() + periodDays * 24 * 60 * 60 * 1000);
                    nextDueDays = daysBetween(today, nextDue); // positive = past due
                }
                // threshold_days here is the advance notice window:
                // e.g. threshold_days = -7 means "fire 7 days before due"
                // Negative threshold_days = advance warning; 0 = fire on/after due date.
                if (nextDueDays < -Math.abs(rule.threshold_days)) continue;
                const level = escalationLevel(rule, nextDueDays);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, k.department, k.owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    const dueMsg = nextDueDays >= 0
                        ? `${nextDueDays} day(s) overdue`
                        : `due in ${Math.abs(nextDueDays)} day(s)`;
                    notifications.push({
                        type: 'kri_measurement_due', level, entity_uid: k.kri_uid, entity_name: k.name,
                        message: `KRI ${k.kri_uid} (${k.name}) measurement is ${dueMsg}`,
                        days_past: nextDueDays,
                    });
                }
            }
        }

        // -- Policy reviews due --
        if (rules.policy_review_due) {
            const rule = rules.policy_review_due;
            const policiesRes = await pool.query(
                `SELECT * FROM policies p WHERE company_id = $1 AND next_review_date IS NOT NULL
                   AND version = (SELECT MAX(version) FROM policies p2 WHERE p2.company_id = p.company_id AND p2.policy_uid = p.policy_uid)`,
                [req.company.id]
            );
            for (const p of policiesRes.rows) {
                const daysPast = daysBetween(today, new Date(p.next_review_date));
                if (daysPast < -rule.threshold_days) continue; // not yet within the notification window
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, null, p.content_owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'policy_review_due', level, entity_uid: p.policy_uid, entity_name: p.name,
                        message: daysPast >= 0 ? `Policy ${p.policy_uid} (${p.name}) review is ${daysPast} day(s) overdue` : `Policy ${p.policy_uid} (${p.name}) review is due in ${-daysPast} day(s)`,
                        days_past: daysPast,
                    });
                }
            }
        }

        // -- Issues overdue --
        if (rules.issue_overdue) {
            const rule = rules.issue_overdue;
            const issuesRes = await pool.query(
                `SELECT * FROM issues WHERE company_id = $1 AND status = ANY($2::text[]) AND due_date IS NOT NULL`,
                [req.company.id, OPEN_ISSUE_STATUSES]
            );
            for (const i of issuesRes.rows) {
                const daysPast = daysBetween(today, new Date(i.due_date));
                if (daysPast < rule.threshold_days) continue;
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, i.department, i.owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'issue_overdue', level, entity_uid: i.issue_uid, entity_name: i.description,
                        message: `Issue ${i.issue_uid} is ${daysPast} day(s) overdue`, days_past: daysPast,
                    });
                }
            }
        }

        // -- Obligations Non-Compliant --
        if (rules.obligation_non_compliant) {
            const rule = rules.obligation_non_compliant;
            const obligationsRes = await pool.query(
                `SELECT o.*, (SELECT MAX(changed_at) FROM obligation_status_history h WHERE h.obligation_id = o.id AND h.status = 'Non-Compliant') AS flagged_at
                 FROM compliance_obligations o WHERE company_id = $1 AND compliance_status = 'Non-Compliant'`,
                [req.company.id]
            );
            for (const o of obligationsRes.rows) {
                const flaggedAt = o.flagged_at ? new Date(o.flagged_at) : today;
                const daysPast = daysBetween(today, flaggedAt);
                if (daysPast < rule.threshold_days) continue;
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, o.applicable_to, o.obligation_owner, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'obligation_non_compliant', level, entity_uid: o.obligation_uid, entity_name: o.regulation_name,
                        message: `Obligation ${o.obligation_uid} (${o.regulation_name}) is Non-Compliant`, days_past: daysPast,
                    });
                }
            }
        }

        // -- Appetite statement reviews due --
        if (rules.appetite_review_due) {
            const rule = rules.appetite_review_due;
            const appetiteRes = await pool.query(
                `SELECT * FROM risk_appetite_statements WHERE company_id = $1 AND is_current = TRUE AND next_review_date IS NOT NULL`,
                [req.company.id]
            );
            for (const s of appetiteRes.rows) {
                const daysPast = daysBetween(today, new Date(s.next_review_date));
                if (daysPast < rule.threshold_days) continue;
                const level = escalationLevel(rule, daysPast);
                const recipients = resolveNotifyTargets(level === 'escalated' ? rule.escalate_to : rule.notify_target, null, null, null, managersByDept, admins);
                if (isForMe(recipients)) {
                    notifications.push({
                        type: 'appetite_review_due', level,
                        entity_uid: s.risk_category,
                        entity_name: `${s.risk_category} Appetite Statement`,
                        message: daysPast >= 0
                            ? `Risk Appetite statement for "${s.risk_category}" is ${daysPast} day(s) overdue for review`
                            : `Risk Appetite statement for "${s.risk_category}" review is due in ${-daysPast} day(s)`,
                        days_past: daysPast,
                    });
                }
            }
        }

        notifications.sort((a, b) => b.days_past - a.days_past);
        res.json({ notifications });
    })
);


// ─── Risk Appetite Module ─────────────────────────────────────────────────────
// Category-level board appetite statements. Versioned, append-only.
// Per-risk tolerance (tolerance_threshold_score) is a separate, finer-grained field.

/**
 * Recalculates appetite_category_breach for every active risk in the given
 * company (and optionally a specific category). Called after any appetite
 * statement is saved, and on every risk save for the risk's own category.
 */
async function recalcAppetiteCategoryBreaches(companyId, categoryFilter = null) {
    // Fetch all current appetite statements
    const stmtsRes = await pool.query(
        `SELECT risk_category, max_residual_score
           FROM risk_appetite_statements
          WHERE company_id = $1 AND is_current = TRUE`,
        [companyId]
    );
    if (stmtsRes.rows.length === 0) return;

    const LIVE_RISK_CLAUSE = `
        AND approval_status NOT IN ('Draft', 'Declined')
        AND version = (SELECT MAX(version) FROM risks r2
                       WHERE r2.company_id = risks.company_id
                         AND r2.risk_uid = risks.risk_uid)`;

    for (const stmt of stmtsRes.rows) {
        const { risk_category: category, max_residual_score: maxScore } = stmt;
        if (categoryFilter && category !== categoryFilter) continue;

        // Update breach flags — TRUE when residual score exceeds category ceiling
        await pool.query(
            `UPDATE risks SET appetite_category_breach =
                CASE WHEN (residual_likelihood * residual_impact) > $1 THEN TRUE ELSE FALSE END
             WHERE company_id = $2 AND risk_category = $3 ${LIVE_RISK_CLAUSE}`,
            [maxScore, companyId, category]
        );
    }

    // Clear breach flag on risks whose category no longer has an active statement
    const activeCategories = stmtsRes.rows.map((s) => s.risk_category);
    if (activeCategories.length > 0) {
        await pool.query(
            `UPDATE risks SET appetite_category_breach = FALSE
              WHERE company_id = $1 AND risk_category != ALL($2::text[]) AND appetite_category_breach = TRUE`,
            [companyId, activeCategories]
        );
    }
}

// ============================================================
// Risk Appetite — /api/risk-appetite/*
// ============================================================
// Category-level appetite statements (tolerance + approver), distinct
// from the per-risk appetite threshold on individual risks in the Risk
// Register. Manage (create/edit/history): Admin, CRO, Consultant CRO.
//
// NOTE: the view role list below includes 'Approver', a role name that
// does not exist in UserManagement.jsx's assignable ROLES array — it can
// only be set directly in the database, never through the product's own
// UI. Confirmed still present as of 2026-07-21; see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx Finding 4.

// GET /api/risk-appetite — all current statements for the company, enriched with breach counts
app.get(
    '/api/risk-appetite',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Approver'),
    asyncHandler(async (req, res) => {
        const stmtsRes = await pool.query(
            `SELECT * FROM risk_appetite_statements WHERE company_id = $1 AND is_current = TRUE ORDER BY risk_category`,
            [req.company.id]
        );

        // Enrich with live breach count per category
        const breachRes = await pool.query(
            `SELECT risk_category, COUNT(*) AS breach_count
             FROM risks
             WHERE company_id = $1 AND appetite_category_breach = TRUE
               AND approval_status NOT IN ('Draft', 'Declined')
               AND version = (SELECT MAX(version) FROM risks r2
                              WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
             GROUP BY risk_category`,
            [req.company.id]
        );
        const breachMap = {};
        for (const b of breachRes.rows) breachMap[b.risk_category] = parseInt(b.breach_count, 10);

        // Enrich with the breaching risks themselves (for the breach banner)
        const breachRisksRes = await pool.query(
            `SELECT risk_uid, risk_category, risk_detail, department,
                    residual_likelihood * residual_impact AS residual_score
             FROM risks
             WHERE company_id = $1 AND appetite_category_breach = TRUE
               AND approval_status NOT IN ('Draft', 'Declined')
               AND version = (SELECT MAX(version) FROM risks r2
                              WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
             ORDER BY residual_likelihood * residual_impact DESC`,
            [req.company.id]
        );
        const breachRisksByCategory = {};
        for (const r of breachRisksRes.rows) {
            (breachRisksByCategory[r.risk_category] = breachRisksByCategory[r.risk_category] || []).push(r);
        }

        const statements = stmtsRes.rows.map((s) => ({
            ...s,
            breach_count: breachMap[s.risk_category] || 0,
            breaching_risks: breachRisksByCategory[s.risk_category] || [],
        }));

        res.json(statements);
    })
);

// GET /api/risk-appetite/summary — lightweight summary for management summary panel
app.get(
    '/api/risk-appetite/summary',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Approver'),
    asyncHandler(async (req, res) => {
        const stmtsRes = await pool.query(
            `SELECT risk_category, appetite_level, max_residual_score FROM risk_appetite_statements
              WHERE company_id = $1 AND is_current = TRUE ORDER BY risk_category`,
            [req.company.id]
        );
        const breachRes = await pool.query(
            `SELECT risk_category, COUNT(*) AS breach_count,
                    MAX(residual_likelihood * residual_impact) AS max_breach_score
             FROM risks
             WHERE company_id = $1 AND appetite_category_breach = TRUE
               AND approval_status NOT IN ('Draft', 'Declined')
               AND version = (SELECT MAX(version) FROM risks r2
                              WHERE r2.company_id = risks.company_id AND r2.risk_uid = risks.risk_uid)
             GROUP BY risk_category`,
            [req.company.id]
        );
        const breachMap = {};
        for (const b of breachRes.rows) breachMap[b.risk_category] = { count: parseInt(b.breach_count, 10), max_score: parseInt(b.max_breach_score, 10) };

        res.json({
            statements: stmtsRes.rows.map((s) => ({
                ...s,
                breach_count: (breachMap[s.risk_category] || {}).count || 0,
                max_breach_score: (breachMap[s.risk_category] || {}).max_score || 0,
            })),
            total_breaches: Object.values(breachMap).reduce((sum, b) => sum + b.count, 0),
        });
    })
);

// GET /api/risk-appetite/:category — current statement + full version history for one category
app.get(
    '/api/risk-appetite/:category',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Approver'),
    asyncHandler(async (req, res) => {
        const category = req.params.category;
        const currentRes = await pool.query(
            `SELECT * FROM risk_appetite_statements
              WHERE company_id = $1 AND risk_category = $2 AND is_current = TRUE`,
            [req.company.id, category]
        );
        if (currentRes.rows.length === 0) return res.status(404).json({ error: 'No active statement for this category' });

        const historyRes = await pool.query(
            `SELECT * FROM risk_appetite_statements
              WHERE company_id = $1 AND risk_category = $2
              ORDER BY version DESC`,
            [req.company.id, category]
        );
        res.json({ current: currentRes.rows[0], history: historyRes.rows });
    })
);

// GET /api/risk-appetite/:category/history — version history for a category
app.get(
    '/api/risk-appetite/:category/history',
    requireRole('Admin', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT * FROM risk_appetite_statements
              WHERE company_id = $1 AND risk_category = $2
              ORDER BY version DESC`,
            [req.company.id, req.params.category]
        );
        res.json(result.rows);
    })
);

// POST /api/risk-appetite — create or update (versions) a category appetite statement
app.post(
    '/api/risk-appetite',
    requireRole('Admin', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const {
            risk_category,
            appetite_level,
            qualitative_statement,
            max_residual_score,
            tolerance_band_min,
            tolerance_band_max,
            required_breach_action,
            breach_notification_severity,
            notes,
            approved_by_role,
            approved_by_name,
            approval_date,
            effective_date,
            next_review_date,
        } = req.body;

        if (!risk_category) return res.status(400).json({ error: 'risk_category is required' });
        const validAppetiteLevels = ['Zero Tolerance', 'Low', 'Moderate', 'High'];
        if (!appetite_level || !validAppetiteLevels.includes(appetite_level))
            return res.status(400).json({ error: 'Invalid appetite_level' });
        if (!qualitative_statement || qualitative_statement.trim().length < 20)
            return res.status(400).json({ error: 'qualitative_statement must be at least 20 characters' });

        // max_residual_score is optional (NULL = qualitative-only statement)
        let maxScore = null;
        if (max_residual_score !== null && max_residual_score !== undefined && max_residual_score !== '') {
            maxScore = parseInt(max_residual_score, 10);
            if (isNaN(maxScore) || maxScore < 1 || maxScore > 25)
                return res.status(400).json({ error: 'max_residual_score must be 1–25' });
        }

        // required_breach_action minimum length
        if (required_breach_action && required_breach_action.trim().length > 0 && required_breach_action.trim().length < 20)
            return res.status(400).json({ error: 'required_breach_action must be at least 20 characters' });

        // approved_by_role must be one of the allowed values
        const validApproverRoles = ['Board of Directors', 'CEO', 'CFO', 'CRO', 'Other'];
        if (approved_by_role && !validApproverRoles.includes(approved_by_role))
            return res.status(400).json({ error: 'Invalid approved_by_role' });

        // approval_date must not be in the future
        if (approval_date) {
            const ad = new Date(approval_date);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (ad > today) return res.status(400).json({ error: 'approval_date must not be in the future' });
        }

        // Auto-default breach_notification_severity from appetite_level if not supplied
        let severity = null;
        if (breach_notification_severity && ['Critical', 'High'].includes(breach_notification_severity)) {
            severity = breach_notification_severity;
        } else {
            // Zero Tolerance / Low → Critical; Moderate / High → High
            severity = ['Zero Tolerance', 'Low'].includes(appetite_level) ? 'Critical' : 'High';
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Fetch the current row so we can diff before/after in the audit log
            const existing = await client.query(
                `SELECT id, version, appetite_level, max_residual_score, breach_notification_severity
                   FROM risk_appetite_statements
                  WHERE company_id = $1 AND risk_category = $2 AND is_current = TRUE`,
                [req.company.id, risk_category]
            );
            const prevRow = existing.rows[0] || null;
            const nextVersion = prevRow ? prevRow.version + 1 : 1;

            // Archive the existing current row
            if (prevRow) {
                await client.query(
                    `UPDATE risk_appetite_statements SET is_current = FALSE, updated_at = NOW()
                      WHERE id = $1`,
                    [prevRow.id]
                );
            }

            // Insert new version
            const result = await client.query(
                `INSERT INTO risk_appetite_statements
                    (company_id, risk_category, version, is_current, appetite_level,
                     qualitative_statement, max_residual_score, tolerance_band_min, tolerance_band_max,
                     required_breach_action, breach_notification_severity,
                     notes, approved_by_role, approved_by_name, approval_date,
                     effective_date, next_review_date, created_by)
                 VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
                [
                    req.company.id, risk_category, nextVersion, appetite_level,
                    qualitative_statement.trim(), maxScore,
                    tolerance_band_min || null, tolerance_band_max || null,
                    required_breach_action ? required_breach_action.trim() : null,
                    severity,
                    notes ? notes.trim() : null,
                    approved_by_role || null,
                    approved_by_name ? approved_by_name.trim() : null,
                    approval_date || null,
                    effective_date || null,
                    next_review_date || null,
                    req.user.email,
                ]
            );

            // Audit log with before/after diff
            const changes = { version: nextVersion, appetite_level, max_residual_score: maxScore };
            if (prevRow) {
                if (prevRow.appetite_level !== appetite_level)
                    changes.appetite_level = { from: prevRow.appetite_level, to: appetite_level };
                if (prevRow.max_residual_score !== maxScore)
                    changes.max_residual_score = { from: prevRow.max_residual_score, to: maxScore };
                if (prevRow.breach_notification_severity !== severity)
                    changes.breach_notification_severity = { from: prevRow.breach_notification_severity, to: severity };
            }
            await client.query(
                `INSERT INTO audit_log (company_id, user_id, entity_type, entity_id, action, changes_json)
                 VALUES ($1, $2, 'risk_appetite', $3, $4, $5)`,
                [
                    req.company.id, req.user.id,
                    risk_category,
                    nextVersion === 1 ? 'created' : 'updated',
                    JSON.stringify(changes),
                ]
            );

            await client.query('COMMIT');

            // Recalculate category breach flags for all risks in this category
            await recalcAppetiteCategoryBreaches(req.company.id, risk_category);

            res.json({ ...result.rows[0], version_message: `Appetite statement saved — version ${nextVersion}` });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    })
);

// DELETE /api/risk-appetite/:category — archive (soft-delete) current statement
app.delete(
    '/api/risk-appetite/:category',
    requireRole('Admin', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `UPDATE risk_appetite_statements SET is_current = FALSE, updated_at = NOW()
              WHERE company_id = $1 AND risk_category = $2 AND is_current = TRUE RETURNING id`,
            [req.company.id, req.params.category]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'No active statement found for this category' });
        // Clear breach flags for risks in this category
        await pool.query(
            `UPDATE risks SET appetite_category_breach = FALSE
              WHERE company_id = $1 AND risk_category = $2`,
            [req.company.id, req.params.category]
        );
        res.json({ ok: true });
    })
);

// ─── Scoring Methodology (A5) ────────────────────────────────────────────────
// Stores company-customised Likelihood/Impact descriptions in company_settings.
// NOTE: POST (edit) is CRO/Consultant CRO only — Admin is deliberately(?)
// excluded here, unlike almost every other module. Confirmed still true as
// of 2026-07-21; flagged as a likely-unintentional gap, not documented
// policy — see Documents/Internal/RBAC_Permissions_Engine_Scoping.docx
// Finding 5 and docs/SCOPE_NOTES.md section 14.

app.get('/api/scoring-methodology', requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer'), asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT setting_value FROM company_settings WHERE company_id=$1 AND setting_key='scoring_methodology'`,
        [req.company.id]
    );
    if (r.rows.length === 0) return res.json({});
    res.json(JSON.parse(r.rows[0].setting_value));
}));

app.post('/api/scoring-methodology', requireRole('CRO', 'Consultant CRO'), asyncHandler(async (req, res) => {
    const { likelihood, impact, pillars, currency } = req.body;
    if (!Array.isArray(likelihood) || !Array.isArray(impact))
        return res.status(400).json({ error: 'likelihood and impact arrays required' });
    if (pillars !== undefined && !Array.isArray(pillars))
        return res.status(400).json({ error: 'pillars must be an array' });
    // Fetch existing to preserve any keys we are not updating
    const existing = await pool.query(
        `SELECT setting_value FROM company_settings WHERE company_id=$1 AND setting_key='scoring_methodology'`,
        [req.company.id]
    );
    let current = {};
    if (existing.rows.length > 0) {
        try { current = JSON.parse(existing.rows[0].setting_value); } catch { current = {}; }
    }
    const merged = {
        ...current,
        likelihood,
        impact,
        ...(pillars !== undefined ? { pillars } : {}),
        ...(currency !== undefined ? { currency } : {}),
    };
    await pool.query(
        `INSERT INTO company_settings (company_id, setting_key, setting_value)
         VALUES ($1, 'scoring_methodology', $2)
         ON CONFLICT (company_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [req.company.id, JSON.stringify(merged)]
    );
    res.json({ ok: true });
}));

// ─── GRC Glossary (H4) ───────────────────────────────────────────────────────
// Built-in terms live in the frontend; this stores company-specific custom terms.

app.get('/api/glossary', asyncHandler(async (req, res) => {
    const r = await pool.query(
        `SELECT id, term, definition, created_by, created_at FROM glossary_terms
         WHERE company_id=$1 ORDER BY term`,
        [req.company.id]
    );
    res.json(r.rows);
}));

app.post('/api/glossary', can('glossary.manage'), validate(schemas.createGlossaryTerm), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin')
    const { term, definition } = req.body;
    const r = await pool.query(
        `INSERT INTO glossary_terms (company_id, term, definition, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.company.id, term.trim(), definition.trim(), req.user.email]
    );
    res.status(201).json(r.rows[0]);
}));

app.delete('/api/glossary/:id', can('glossary.manage'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin')
    const r = await pool.query(
        `DELETE FROM glossary_terms WHERE id=$1 AND company_id=$2`,
        [req.params.id, req.company.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({ ok: true });
}));

// ─── Compliance Calendar (H3) ─────────────────────────────────────────────────
// Aggregates due dates from controls, KRIs, policies, issues, and obligations.

app.get('/api/calendar', requireRole('Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer'), asyncHandler(async (req, res) => {
    const cid = req.company.id;
    const events = [];

    // Control tests due (computed from last_test_date + testing_frequency)
    // Scope: same pattern as /api/controls — dept created OR owner_department matches.
    const ctrlScope = managerScopeClause(req, 'department', 2);
    const controls = await pool.query(
        `SELECT control_uid, name, owner, last_test_date, last_test_result, testing_frequency
         FROM controls_lib WHERE company_id=$1
         ${ctrlScope ? `AND (${ctrlScope.clause} OR lower(owner_department) = ANY($2::text[]))` : ''}`,
        ctrlScope ? [cid, ctrlScope.value] : [cid]
    );
    const ctrlFreqDays = { Monthly: 30, Quarterly: 91, Annual: 365 };
    controls.rows.forEach((c) => {
        const days = ctrlFreqDays[c.testing_frequency];
        if (!days) return;
        const base = c.last_test_date ? new Date(c.last_test_date) : new Date();
        base.setDate(base.getDate() + days);
        const nextDue = base.toISOString().substring(0, 10);
        events.push({
            module: 'control', uid: c.control_uid, title: c.name,
            due_date: nextDue, owner: c.owner, status: c.last_test_result || 'Not Tested',
        });
    });

    // KRI measurements due (computed from last measurement + frequency)
    const kriScope = managerScopeClause(req, 'k.department', 2);
    const kris = await pool.query(
        `SELECT k.kri_uid, k.name, k.owner, k.measurement_frequency,
                (SELECT MAX(m.measurement_date) FROM kri_measurements m WHERE m.kri_id=k.id) AS last_measured
         FROM kris k WHERE k.company_id=$1 AND k.measurement_frequency IS NOT NULL
         ${kriScope ? `AND ${kriScope.clause}` : ''}`,
        kriScope ? [cid, kriScope.value] : [cid]
    );
    kris.rows.forEach((k) => {
        let nextDue = null;
        const freqDays = { Daily:1, Weekly:7, Monthly:30, Quarterly:91, 'Semi-Annual':182, Annual:365 };
        const days = freqDays[k.measurement_frequency];
        if (days) {
            const base = k.last_measured ? new Date(k.last_measured) : new Date();
            base.setDate(base.getDate() + days);
            nextDue = base.toISOString().substring(0, 10);
        }
        if (nextDue) events.push({
            module: 'kri', uid: k.kri_uid, title: k.name,
            due_date: nextDue, owner: k.owner, status: k.measurement_frequency,
        });
    });

    // Policy reviews due — policies are enterprise-wide (no dept column), no scoping applied.
    const policies = await pool.query(
        `SELECT policy_uid, name, content_owner, next_review_date, status
         FROM policies WHERE company_id=$1 AND status != 'Archived' AND next_review_date IS NOT NULL`,
        [cid]
    );
    policies.rows.forEach((p) => events.push({
        module: 'policy', uid: p.policy_uid, title: p.name,
        due_date: p.next_review_date, owner: p.content_owner, status: p.status,
    }));

    // Issues due — same column choice as /api/issues: Risk Champions scope by raised_by_dept, others by department.
    const issueScopeCol = req.company.role === 'Risk Champion' ? 'raised_by_dept' : 'department';
    const issueScope = managerScopeClause(req, issueScopeCol, 2);
    const issues = await pool.query(
        `SELECT issue_uid, description, owner, due_date, status, priority
         FROM issues WHERE company_id=$1
           AND status NOT IN ('Closed-Remediated','Risk Accepted','No Longer Relevant')
           AND due_date IS NOT NULL
         ${issueScope ? `AND ${issueScope.clause}` : ''}`,
        issueScope ? [cid, issueScope.value] : [cid]
    );
    issues.rows.forEach((i) => events.push({
        module: 'issue', uid: i.issue_uid,
        title: i.description?.substring(0, 60) + (i.description?.length > 60 ? '…' : ''),
        due_date: i.due_date, owner: i.owner, status: i.status,
    }));

    // Compliance obligation reviews due — scoped by applicable_to (same as /api/obligations).
    const oblScope = managerScopeClause(req, 'applicable_to', 2);
    const obligations = await pool.query(
        `SELECT obligation_uid, regulation_name, obligation_owner, next_review_date, compliance_status
         FROM compliance_obligations WHERE company_id=$1 AND next_review_date IS NOT NULL
         ${oblScope ? `AND ${oblScope.clause}` : ''}`,
        oblScope ? [cid, oblScope.value] : [cid]
    );
    obligations.rows.forEach((o) => events.push({
        module: 'obligation', uid: o.obligation_uid, title: o.regulation_name,
        due_date: o.next_review_date, owner: o.obligation_owner, status: o.compliance_status,
    }));

    res.json(events);
}));

// ─── Evidence Attachments (G7) ────────────────────────────────────────────────
// Base64 file storage per entity. entity_type: risk|control|issue|obligation|kri
// IMPORTANT: the /download/:id route MUST be registered before /:entityType/:entityId
// so Express doesn't swallow "download" as the entityType parameter.

app.get('/api/evidence/download/:id', can('evidence.view'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    const r = await pool.query(
        `SELECT filename, mime_type, file_data FROM evidence_attachments WHERE id=$1 AND company_id=$2`,
        [req.params.id, req.company.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const { filename, mime_type, file_data } = r.rows[0];
    const buf = Buffer.from(file_data, 'base64');
    res.set('Content-Type', mime_type);
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
}));

app.get('/api/evidence/:entityType/:entityId', can('evidence.view'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO', 'Viewer')
    const r = await pool.query(
        `SELECT id, filename, mime_type, file_size_bytes, uploaded_by, uploaded_at
         FROM evidence_attachments
         WHERE company_id=$1 AND entity_type=$2 AND entity_id=$3
         ORDER BY uploaded_at DESC`,
        [req.company.id, req.params.entityType, req.params.entityId]
    );
    res.json(r.rows);
}));

app.post('/api/evidence/:entityType/:entityId', can('evidence.upload'), validate(schemas.evidence), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO')
    const { filename, mime_type, file_data } = req.body;

    const MAX_BYTES = 2 * 1024 * 1024; // 2MB per-file limit
    const QUOTA_BYTES = 500 * 1024 * 1024; // 500MB per-company quota
    const bytes = Buffer.byteLength(file_data, 'base64');
    if (bytes > MAX_BYTES)
        return res.status(400).json({ error: `File too large (${Math.round(bytes/1024)}KB). Maximum is 2MB per file.` });

    // Enforce per-company quota
    const usageRes = await pool.query(
        `SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM evidence_attachments WHERE company_id = $1`,
        [req.company.id]
    );
    if (parseInt(usageRes.rows[0].total) + bytes > QUOTA_BYTES)
        return res.status(400).json({ error: 'Company storage quota exceeded (500 MB). Please delete old evidence files before uploading new ones.' });

    // Malware / file-type scan (SOC 2: CC6.8) — validates magic bytes and
    // optionally calls an external AV API if FILE_SCAN_API_URL is configured.
    const scan = await scanFile(filename, mime_type, file_data);
    if (!scan.safe)
        return res.status(400).json({ error: `File rejected: ${scan.reason}` });

    const r = await pool.query(
        `INSERT INTO evidence_attachments
           (company_id, entity_type, entity_id, filename, mime_type, file_data, file_size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime_type, file_size_bytes, uploaded_by, uploaded_at`,
        [req.company.id, req.params.entityType, req.params.entityId,
         filename, mime_type, file_data, bytes, req.user.email]
    );
    res.status(201).json(r.rows[0]);
}));

app.delete('/api/evidence/:id', can('evidence.delete'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin')
    const r = await pool.query(
        `DELETE FROM evidence_attachments WHERE id=$1 AND company_id=$2`,
        [req.params.id, req.company.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Evidence not found' });
    res.json({ ok: true });
}));

// ── Storage & Health (Admin only) ─────────────────────────────────────────────

app.get('/api/admin/storage-stats', can('storage.manage'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin')
    const companyId = req.company.id;
    const QUOTA_BYTES = 500 * 1024 * 1024;

    const [dbSize, byType, total, vacuum, files] = await Promise.all([
        pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty,
                           pg_database_size(current_database()) AS bytes`),
        pool.query(`SELECT entity_type,
                           COUNT(*)::int AS file_count,
                           COALESCE(SUM(file_size_bytes),0)::bigint AS total_bytes
                    FROM evidence_attachments WHERE company_id=$1
                    GROUP BY entity_type ORDER BY total_bytes DESC`, [companyId]),
        pool.query(`SELECT COUNT(*)::int AS file_count,
                           COALESCE(SUM(file_size_bytes),0)::bigint AS total_bytes
                    FROM evidence_attachments WHERE company_id=$1`, [companyId]),
        pool.query(`SELECT last_autovacuum, last_autoanalyze,
                           n_dead_tup::int, n_live_tup::int
                    FROM pg_stat_user_tables WHERE relname='evidence_attachments'`),
        pool.query(`SELECT id, entity_type, entity_id, filename, mime_type,
                           file_size_bytes, uploaded_by, uploaded_at
                    FROM evidence_attachments WHERE company_id=$1
                    ORDER BY uploaded_at DESC`, [companyId]),
    ]);

    res.json({
        db:            { pretty: dbSize.rows[0].pretty, bytes: parseInt(dbSize.rows[0].bytes) },
        evidence:      { by_type: byType.rows, ...total.rows[0], quota_bytes: QUOTA_BYTES },
        vacuum:        vacuum.rows[0] || null,
        files:         files.rows,
    });
}));

app.delete('/api/admin/evidence/bulk', can('evidence.bulk_manage'), asyncHandler(async (req, res) => { // Phase C cutover -- was requireRole('Admin')
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: 'ids array required' });
    const result = await pool.query(
        `DELETE FROM evidence_attachments WHERE id = ANY($1) AND company_id=$2 RETURNING id`,
        [ids, req.company.id]
    );
    res.json({ deleted: result.rows.length });
}));

// ============================================================
// V1.9 — Company management endpoints
// ============================================================

// List companies the current Admin can manage:
//   - the active company itself
//   - all its direct subsidiaries
// Super-admins see every company.
app.get('/api/companies', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const cid = req.company.id;
        if (req.user.is_super_admin) {
            const r = await pool.query(
                `SELECT id, name, code, parent_company_id, max_group_access_scope,
                        branding_primary_color, is_active, created_at
                 FROM companies ORDER BY name`
            );
            return res.json(r.rows);
        }
        const r = await pool.query(
            `SELECT id, name, code, parent_company_id, max_group_access_scope,
                    branding_primary_color, is_active, created_at
             FROM companies
             WHERE id = $1 OR parent_company_id = $1
             ORDER BY parent_company_id NULLS FIRST, name`,
            [cid]
        );
        res.json(r.rows);
    })
);

// Create a new company. Only an Admin of the current company can create subsidiaries.
// If parent_company_id is provided it must be the current company (no arbitrary parenting).
app.post('/api/companies', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name, code, parent_company_id, max_group_access_scope,
                industry, company_type, country, regulatory_body, fiscal_year_end, description, address } = req.body;
        if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

        // BUG-06: block duplicate name in the same country
        const dupCheckSub = await pool.query(
            `SELECT 1 FROM companies WHERE LOWER(name) = LOWER($1) AND LOWER(COALESCE(country,'')) = LOWER(COALESCE($2,''))`,
            [name.trim(), country || '']
        );
        if (dupCheckSub.rows.length > 0) {
            return res.status(409).json({ error: 'A company with this name already exists in this country.' });
        }

        // Prevent arbitrary parent assignment — must be current company or null
        const parentId = parent_company_id || null;
        if (parentId && parentId !== req.company.id) {
            return res.status(400).json({ error: 'parent_company_id must be the current company' });
        }

        // Guard: a company cannot be its own parent (circular reference)
        const scope = max_group_access_scope || 'full';
        if (!['consolidated_only', 'view', 'full'].includes(scope)) {
            return res.status(400).json({ error: 'Invalid max_group_access_scope' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO companies (name, code, parent_company_id, max_group_access_scope,
                                        industry, company_type, country, regulatory_body, fiscal_year_end, description, address)
                 VALUES ($1, UPPER($2), $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [name.trim(), code.trim(), parentId, scope,
                 industry || null, company_type || null, country || null,
                 regulatory_body || null, fiscal_year_end || null, description || null, address || null]
            );
            const newCompany = r.rows[0];

            // Auto-grant the creating user Admin access to the new company
            await client.query(
                `INSERT INTO user_companies (user_id, company_id, role)
                 VALUES ($1, $2, 'Admin')
                 ON CONFLICT (user_id, company_id) DO NOTHING`,
                [req.user.id, newCompany.id]
            );
            await seedRiskTaxonomy(client, newCompany.id);
            // Bug fix (2026-07-22): subsidiaries previously got zero departments,
            // blocking risk/control/KRI/issue creation there entirely -- see
            // DEFAULT_DEPARTMENTS/seedDefaultDepartments above.
            await seedDefaultDepartments(client, newCompany.id, null);

            await client.query('COMMIT');
            await logAudit(null, {
                companyId: req.company.id,
                entityType: 'company', entityId: newCompany.id,
                action: 'create', actor: req.user,
                details: { name, code, parentId },
            });
            res.status(201).json(newCompany);
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.code === '23505') return res.status(409).json({ error: 'Company code already exists' });
            throw err;
        } finally {
            client.release();
        }
    })
);

// Get / update the current company's profile fields.
app.get('/api/companies/current/profile', requirePasswordCurrent, requireCompany,
    asyncHandler(async (req, res) => {
        const r = await pool.query(
            `SELECT name, code, industry, company_type, country, regulatory_body, fiscal_year_end, description, address, has_business_units
             FROM companies WHERE id = $1`,
            [req.company.id]
        );
        res.json(r.rows[0] || {});
    })
);

app.put('/api/companies/current/profile', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { name, industry, company_type, country, regulatory_body, fiscal_year_end, description, address, has_business_units } = req.body;
        if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Company name cannot be blank.' });
        // has_business_units: only update when explicitly provided (null = leave unchanged)
        const buMode = has_business_units !== undefined ? Boolean(has_business_units) : null;
        const r = await pool.query(
            `UPDATE companies
             SET name = COALESCE($1, name),
                 industry = $2, company_type = $3, country = $4,
                 regulatory_body = $5, fiscal_year_end = $6, description = $7, address = $8,
                 has_business_units = COALESCE($10::boolean, has_business_units)
             WHERE id = $9 RETURNING *`,
            [name?.trim() || null, industry || null, company_type || null, country || null,
             regulatory_body || null, fiscal_year_end || null, description || null, address || null,
             req.company.id, buMode]
        );
        await logAudit(null, {
            companyId: req.company.id, entityType: 'company', entityId: req.company.id,
            action: 'update_profile', actor: req.user, details: req.body,
        });
        res.json(r.rows[0]);
    })
);

// Update a company's name, max_group_access_scope, or is_active.
// Must be the current company or one of its direct subsidiaries.
app.put('/api/companies/:id', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetId = parseInt(req.params.id, 10);
        const cid = req.company.id;

        // Access check: must be current company or its subsidiary
        if (!req.user.is_super_admin) {
            const check = await pool.query(
                `SELECT id FROM companies WHERE id = $1 AND (id = $2 OR parent_company_id = $2)`,
                [targetId, cid]
            );
            if (check.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
        }

        const { name, max_group_access_scope, is_active,
                industry, company_type, country, regulatory_body, fiscal_year_end, description, address } = req.body;
        const updates = [];
        const values = [];

        if (name !== undefined) { values.push(name.trim()); updates.push(`name = $${values.length}`); }
        if (max_group_access_scope !== undefined) {
            if (!['consolidated_only', 'view', 'full'].includes(max_group_access_scope))
                return res.status(400).json({ error: 'Invalid max_group_access_scope' });
            values.push(max_group_access_scope); updates.push(`max_group_access_scope = $${values.length}`);
        }
        if (is_active !== undefined) { values.push(is_active); updates.push(`is_active = $${values.length}`); }
        if (industry !== undefined) { values.push(industry || null); updates.push(`industry = $${values.length}`); }
        if (company_type !== undefined) { values.push(company_type || null); updates.push(`company_type = $${values.length}`); }
        if (country !== undefined) { values.push(country || null); updates.push(`country = $${values.length}`); }
        if (regulatory_body !== undefined) { values.push(regulatory_body || null); updates.push(`regulatory_body = $${values.length}`); }
        if (fiscal_year_end !== undefined) { values.push(fiscal_year_end || null); updates.push(`fiscal_year_end = $${values.length}`); }
        if (description !== undefined) { values.push(description || null); updates.push(`description = $${values.length}`); }
        if (address !== undefined) { values.push(address || null); updates.push(`address = $${values.length}`); }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(targetId);
        const r = await pool.query(
            `UPDATE companies SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        await logAudit(null, { companyId: cid, entityType: 'company', entityId: targetId, action: 'update', actor: req.user, details: req.body });
        res.json(r.rows[0]);
    })
);

// Delete a company (current company or one of its subsidiaries).
// Blocked if the target company still has active subsidiaries of its own.
// All associated data (risks, controls, users etc.) is removed via ON DELETE CASCADE.
app.delete('/api/companies/:id', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetId = parseInt(req.params.id, 10);
        const cid = req.company.id;

        // Access check: must be current company or a direct subsidiary
        if (!req.user.is_super_admin) {
            const check = await pool.query(
                `SELECT id FROM companies WHERE id = $1 AND (id = $2 OR parent_company_id = $2)`,
                [targetId, cid]
            );
            if (check.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
        }

        // Block deletion if this company has active subsidiaries
        const childCheck = await pool.query(
            'SELECT id FROM companies WHERE parent_company_id = $1 AND is_active = true LIMIT 1',
            [targetId]
        );
        if (childCheck.rows.length > 0) {
            return res.status(409).json({
                error: 'This company has active subsidiaries. Delete or reassign them first.',
            });
        }

        // Attempt delete — FK violations (existing data) will surface as a 409
        try {
            await pool.query('DELETE FROM companies WHERE id = $1', [targetId]);
        } catch (e) {
            if (e.code === '23503') {
                return res.status(409).json({
                    error: 'Cannot delete: this company still has associated data (risks, controls, policies, etc.). Remove that data first or deactivate the company instead.',
                });
            }
            throw e;
        }

        await logAudit(null, {
            entityType: 'company', entityId: targetId,
            action: 'delete', actor: req.user,
            details: { deleted_company_id: targetId },
        });
        res.json({ message: 'Company deleted' });
    })
);

// Update group_access_scope for a user on the current (parent) company.
app.put('/api/users/:id/group-access', requirePasswordCurrent, requireCompany, requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);
        const { group_access_scope } = req.body;
        if (!['none', 'consolidated_only', 'view', 'full'].includes(group_access_scope)) {
            return res.status(400).json({ error: 'Invalid group_access_scope' });
        }
        const r = await pool.query(
            `UPDATE user_companies SET group_access_scope = $1
             WHERE user_id = $2 AND company_id = $3 RETURNING *`,
            [group_access_scope, targetUserId, req.company.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'User not found in this company' });
        await logAudit(null, {
            companyId: req.company.id,
            entityType: 'user', entityId: targetUserId, action: 'update',
            actor: req.user, details: { group_access_scope },
        });
        res.json(r.rows[0]);
    })
);

// ============================================================
// V1.9 — Consolidated summary (group dashboard)
// ============================================================
// Available when the user's active session is in group view mode
// OR when the user explicitly has group access on the active company.
// Effective scope determines depth: consolidated_only / view / full.
app.get('/api/consolidated-summary', requirePasswordCurrent, requireCompany,
    asyncHandler(async (req, res) => {
        const parentId = req.company.id;

        // Verify the user has group access on this company
        let userScope = 'none';
        if (req.user.is_super_admin) {
            userScope = 'full';
        } else {
            const ucRes = await pool.query(
                `SELECT group_access_scope FROM user_companies WHERE user_id = $1 AND company_id = $2`,
                [req.user.id, parentId]
            );
            userScope = ucRes.rows[0]?.group_access_scope || 'none';
        }
        if (userScope === 'none') return res.status(403).json({ error: 'No group access on this company' });

        // Get subsidiaries
        const subsRes = await pool.query(
            `SELECT id, name, code, max_group_access_scope FROM companies
             WHERE parent_company_id = $1 AND is_active = true ORDER BY name`,
            [parentId]
        );
        const subsidiaries = subsRes.rows;

        const summary = [];
        for (const sub of subsidiaries) {
            const effectiveScope = minScope(userScope, sub.max_group_access_scope);
            if (effectiveScope === 'none') continue;

            // Aggregate risk counts by residual score band
            // Column names: risk_status (not status), residual_likelihood/residual_impact (not likelihood/impact)
            const risksRes = await pool.query(
                `SELECT
                   COUNT(*) FILTER (WHERE risk_status = 'Active') AS open_total,
                   COUNT(*) FILTER (WHERE risk_status = 'Active' AND (residual_likelihood * residual_impact) >= 20) AS extreme,
                   COUNT(*) FILTER (WHERE risk_status = 'Active' AND (residual_likelihood * residual_impact) BETWEEN 12 AND 19) AS high,
                   COUNT(*) FILTER (WHERE risk_status = 'Active' AND (residual_likelihood * residual_impact) BETWEEN 6 AND 11) AS medium,
                   COUNT(*) FILTER (WHERE risk_status = 'Active' AND (residual_likelihood * residual_impact) < 6) AS low
                 FROM risks WHERE company_id = $1`,
                [sub.id]
            );

            // KRI status counts (latest reading vs bands)
            // Table: kri_measurements (not kri_readings), column: rag_status (not status), measurement_date (not recorded_at)
            const krisRes = await pool.query(
                `SELECT
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE latest_status = 'Red')   AS red,
                   COUNT(*) FILTER (WHERE latest_status = 'Amber') AS amber,
                   COUNT(*) FILTER (WHERE latest_status = 'Green') AS green,
                   COUNT(*) FILTER (WHERE latest_status IS NULL)   AS no_reading
                 FROM (
                   SELECT k.id,
                     (SELECT rag_status FROM kri_measurements m WHERE m.kri_id = k.id ORDER BY m.measurement_date DESC LIMIT 1) AS latest_status
                   FROM kris k WHERE k.company_id = $1
                 ) t`,
                [sub.id]
            );

            // Open issues
            const issuesRes = await pool.query(
                `SELECT COUNT(*) AS open FROM issues WHERE company_id = $1 AND status NOT IN ('Closed-Remediated','Risk Accepted')`,
                [sub.id]
            );

            // Compliance obligations overdue
            // Column names: compliance_status (not status), next_review_date (not due_date)
            const oblRes = await pool.query(
                `SELECT COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE next_review_date < now() AND compliance_status <> 'Compliant') AS overdue
                 FROM compliance_obligations WHERE company_id = $1`,
                [sub.id]
            );

            // Controls tested/not
            const ctrlRes = await pool.query(
                `SELECT COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE last_test_result = 'Effective') AS effective,
                        COUNT(*) FILTER (WHERE last_test_result IN ('Partially Effective','Ineffective')) AS non_effective,
                        COUNT(*) FILTER (WHERE last_test_result IS NULL) AS not_tested
                 FROM controls_lib WHERE company_id = $1`,
                [sub.id]
            );

            summary.push({
                id: sub.id,
                name: sub.name,
                code: sub.code,
                effective_scope: effectiveScope,
                risks: risksRes.rows[0],
                kris: krisRes.rows[0],
                issues: { open: parseInt(issuesRes.rows[0].open, 10) },
                obligations: oblRes.rows[0],
                controls: ctrlRes.rows[0],
            });
        }

        // Rollup totals
        const rollup = summary.reduce((acc, s) => {
            const add = (k, fields) => fields.forEach((f) => { acc[k][f] = (acc[k][f] || 0) + parseInt(s[k][f] || 0, 10); });
            add('risks',       ['open_total','extreme','high','medium','low']);
            add('kris',        ['total','red','amber','green','no_reading']);
            add('issues',      ['open']);
            add('obligations', ['total','overdue']);
            add('controls',    ['total','effective','non_effective','not_tested']);
            return acc;
        }, { risks: {}, kris: {}, issues: {}, obligations: {}, controls: {} });

        res.json({
            parent: { id: req.company.id, name: req.company.name, code: req.company.code },
            user_scope: userScope,
            subsidiaries: summary,
            rollup,
        });
    })
);

// ============================================================
// Incident Log Module — /api/incidents/*
// ============================================================
// Historical note, corrected 2026-07-22: the comment here used to claim
// "INCIDENT_WRITE_ROLES deliberately excludes Admin -- Admin can view
// incidents but not log/edit one." That described the literal array only,
// not actual enforced behavior -- requireRole()'s unconditional Admin/
// Super-Admin bypass (see the comment above requireRole()) has always let
// Admin through regardless of this array, so Admin has in practice always
// had full incident write access. Finding 5 (RBAC_Permissions_Engine_
// Scoping.docx) is resolved per Decision 2 in CLAUDE.md: incident.create
// is a non-configurable safety-baseline capability (full for every role,
// including Viewer -- wide reporting intake), while edit/delete/link_risk/
// dismiss stay role-restricted (the seeded role_permissions rows for those
// four capabilities already match today's actual bypass-inclusive
// behavior exactly -- Admin/Super Admin full, RM/RC/RO scoped, Viewer
// none -- so cutting over below is zero-behavior-change, not a new
// exclusion).

// INCIDENT_ROLES / INCIDENT_WRITE_ROLES were removed 2026-07-22 once every
// route below was cut over to can() -- no remaining call site references
// them (grepped clean before deletion).

// Auto-generate next incident UID (INC-001, INC-002, …)
async function nextIncidentUid(companyId) {
    const res = await pool.query(
        `SELECT incident_uid FROM incident_log WHERE company_id = $1 ORDER BY id DESC LIMIT 1`,
        [companyId]
    );
    if (res.rows.length === 0) return 'INC-001';
    const last = res.rows[0].incident_uid; // e.g. INC-042
    const num = parseInt(last.replace(/\D/g, ''), 10) || 0;
    return `INC-${String(num + 1).padStart(3, '0')}`;
}

app.get(
    '/api/incidents',
    can('incident.view'), // Phase C cutover -- was requireRole(...INCIDENT_ROLES)
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT i.*,
                    r.risk_uid       AS linked_risk_uid,
                    r.risk_detail    AS linked_risk_detail
               FROM incident_log i
               LEFT JOIN risks r ON r.id = i.linked_risk_id
              WHERE i.company_id = $1 AND i.is_deleted = false
              ORDER BY i.incident_date DESC, i.id DESC`,
            [req.company.id]
        );
        res.json(result.rows);
    })
);

app.post(
    '/api/incidents',
    can('incident.create'), // Phase C cutover -- was requireRole(...INCIDENT_WRITE_ROLES); incident.create is a safety-baseline capability (Decision 2/3) -- full for every role including Admin and Viewer, wide reporting intake by design
    asyncHandler(async (req, res) => {
        const { title, incident_date, description, severity, status, affected_dept, root_cause, action_taken, reported_by } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
        if (!incident_date) return res.status(400).json({ error: 'incident_date is required' });
        const uid = await nextIncidentUid(req.company.id);
        const result = await pool.query(
            `INSERT INTO incident_log
                (company_id, incident_uid, title, incident_date, description, severity, status, affected_dept, root_cause, action_taken, reported_by, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [req.company.id, uid, title.trim(), incident_date,
             description || null, severity || 'Medium', status || 'Open',
             affected_dept || null, root_cause || null, action_taken || null,
             reported_by || null, req.user?.email || null]
        );
        res.status(201).json(result.rows[0]);
    })
);

app.put(
    '/api/incidents/:id',
    can('incident.edit'), // Phase C cutover -- was requireRole(...INCIDENT_WRITE_ROLES)
    asyncHandler(async (req, res) => {
        const { title, incident_date, description, severity, status, affected_dept, root_cause, action_taken, reported_by } = req.body;
        const result = await pool.query(
            `UPDATE incident_log SET
                title = COALESCE($1, title),
                incident_date = COALESCE($2, incident_date),
                description = $3,
                severity = COALESCE($4, severity),
                status = COALESCE($5, status),
                affected_dept = $6,
                root_cause = $7,
                action_taken = $8,
                reported_by = $9,
                updated_at = NOW()
             WHERE id = $10 AND company_id = $11 AND is_deleted = false
             RETURNING *`,
            [title?.trim() || null, incident_date || null, description || null,
             severity || null, status || null, affected_dept || null,
             root_cause || null, action_taken || null, reported_by || null,
             parseInt(req.params.id, 10), req.company.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
        res.json(result.rows[0]);
    })
);

app.delete(
    '/api/incidents/:id',
    can('incident.delete'), // Phase C cutover -- was requireRole('Risk Manager', 'CRO', 'Consultant CRO')
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `UPDATE incident_log SET is_deleted = true, updated_at = NOW()
              WHERE id = $1 AND company_id = $2 AND is_deleted = false
              RETURNING id`,
            [parseInt(req.params.id, 10), req.company.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
        res.json({ ok: true });
    })
);

// PATCH /api/incidents/:id/link-risk — Option 1 (link to existing) or Option 2 (link after creating)
// Body: { risk_id, decision } where decision is 'Linked' or 'Risk Created'
app.patch(
    '/api/incidents/:id/link-risk',
    can('incident.link_risk'), // Phase C cutover -- was requireRole(...INCIDENT_WRITE_ROLES)
    asyncHandler(async (req, res) => {
        const incidentId = parseInt(req.params.id, 10);
        const { risk_id, decision } = req.body;
        if (!risk_id) return res.status(400).json({ error: 'risk_id is required' });
        const validDecisions = ['Linked', 'Risk Created'];
        const registerDecision = validDecisions.includes(decision) ? decision : 'Linked';

        // Verify the risk belongs to the same company
        const riskCheck = await pool.query(
            `SELECT id, risk_uid FROM risks WHERE id = $1 AND company_id = $2`,
            [parseInt(risk_id, 10), req.company.id]
        );
        if (riskCheck.rows.length === 0) return res.status(404).json({ error: 'Risk not found' });

        const result = await pool.query(
            `UPDATE incident_log
                SET linked_risk_id   = $1,
                    register_decision = $2,
                    updated_at        = NOW()
              WHERE id = $3 AND company_id = $4 AND is_deleted = false
              RETURNING *`,
            [parseInt(risk_id, 10), registerDecision, incidentId, req.company.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

        // Return incident with linked risk details
        const enriched = await pool.query(
            `SELECT i.*, r.risk_uid AS linked_risk_uid, r.risk_detail AS linked_risk_detail
               FROM incident_log i
               LEFT JOIN risks r ON r.id = i.linked_risk_id
              WHERE i.id = $1`,
            [incidentId]
        );
        res.json(enriched.rows[0]);
    })
);

// PATCH /api/incidents/:id/dismiss — Option 3: no register entry required
app.patch(
    '/api/incidents/:id/dismiss',
    can('incident.dismiss'), // Phase C cutover -- was requireRole(...INCIDENT_WRITE_ROLES)
    asyncHandler(async (req, res) => {
        const incidentId = parseInt(req.params.id, 10);
        const { dismiss_note } = req.body;
        if (!dismiss_note || dismiss_note.trim().length < 10)
            return res.status(400).json({ error: 'dismiss_note must be at least 10 characters' });

        const result = await pool.query(
            `UPDATE incident_log
                SET register_decision = 'Dismissed',
                    dismiss_note      = $1,
                    updated_at        = NOW()
              WHERE id = $2 AND company_id = $3 AND is_deleted = false
              RETURNING *`,
            [dismiss_note.trim(), incidentId, req.company.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
        res.json(result.rows[0]);
    })
);


// ── Risk Reference Library ────────────────────────────────────────────────────
// GET /api/risk-library?search=&pillar=&sector=
// Global read-only reference — no company scope required, any authenticated user.
app.get(
    '/api/risk-library',
    asyncHandler(async (req, res) => {
        const { search = '', pillar = '', sector = '' } = req.query;
        const params = [];
        const conditions = [];

        if (pillar) {
            params.push(pillar);
            conditions.push(`pillar = $${params.length}`);
        }
        if (sector && sector !== 'All Sectors') {
            // Include explicit sector match OR the "All Sectors" catch-all rows
            params.push(sector);
            conditions.push(`(sector = $${params.length} OR sector = 'All Sectors')`);
        }
        if (search) {
            params.push(`%${search}%`);
            const p = params.length;
            conditions.push(
                `(risk_detail ILIKE $${p} OR typical_cause ILIKE $${p} OR typical_impact ILIKE $${p} OR treatment_strategy ILIKE $${p})`
            );
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT id, pillar, sector, risk_detail, typical_cause, typical_impact, treatment_strategy
             FROM risk_library ${where}
             ORDER BY pillar, sector, risk_detail`,
            params
        );
        res.json(result.rows);
    })
);

// ── Control Reference Library ─────────────────────────────────────────────────
// GET /api/control-library-ref?search=&type=
// Separate from /api/controls (which is the company's own control register).
app.get(
    '/api/control-library-ref',
    asyncHandler(async (req, res) => {
        const { search = '', type = '' } = req.query;
        const params = [];
        const conditions = [];

        if (type) {
            params.push(type);
            conditions.push(`control_type = $${params.length}`);
        }
        if (search) {
            params.push(`%${search}%`);
            const p = params.length;
            conditions.push(
                `(name ILIKE $${p} OR description ILIKE $${p} OR framework_reference ILIKE $${p})`
            );
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT id, name, description, control_type, automation, framework_reference, testing_frequency
             FROM control_library ${where}
             ORDER BY control_type, name`,
            params
        );
        res.json(result.rows);
    })
);

// ============================================================
// Consultant Dashboard API  (Phase 3 — requires is_consultant)
// All routes: authenticate → requireConsultant.
// No requireCompany — these are platform-level, not company-scoped.
// ============================================================

// GET /api/consultant/sources
// Returns all registered benchmark sources, ordered by name.
app.get(
    '/api/consultant/sources',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT id, name, organisation, url, format, publication_frequency,
                    pillar_coverage, sector_coverage, is_active, last_fetched_at, created_at
             FROM source_registry
             ORDER BY organisation, name`
        );
        res.json(result.rows);
    })
);

// PATCH /api/consultant/sources/:id
// Toggle is_active on a source (enable / disable without deleting history).
app.patch(
    '/api/consultant/sources/:id',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { is_active } = req.body;
        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ error: 'is_active must be a boolean' });
        }
        const result = await pool.query(
            `UPDATE source_registry SET is_active = $1 WHERE id = $2
             RETURNING id, name, is_active`,
            [is_active, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Source not found' });
        await logAudit(null, {
            entityType: 'source_registry', entityId: id,
            action: is_active ? 'source_enabled' : 'source_disabled',
            actor: req.user,
        });
        res.json(result.rows[0]);
    })
);

// GET /api/consultant/queue
// Returns pending ingestion_queue items awaiting consultant review.
// Optional ?status= filter (pending|approved|rejected); defaults to pending.
app.get(
    '/api/consultant/queue',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const status = req.query.status || 'pending';
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status must be pending, approved, or rejected' });
        }
        const result = await pool.query(
            `SELECT q.id, q.pillar, q.sector, q.risk_theme,
                    q.frequency, q.frequency_raw, q.severity, q.severity_raw,
                    q.confidence_score, q.page_reference, q.period, q.raw_extract,
                    q.status, q.rejection_reason, q.reviewed_at,
                    q.created_at,
                    s.name AS source_name, s.organisation
             FROM ingestion_queue q
             JOIN source_registry s ON s.id = q.source_registry_id
             WHERE q.status = $1
             ORDER BY q.confidence_score DESC, q.created_at ASC`,
            [status]
        );
        res.json(result.rows);
    })
);

// PATCH /api/consultant/queue/:id
// Approve or reject a queued item.
// Approving inserts the item into external_benchmark.
app.patch(
    '/api/consultant/queue/:id',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { action, rejection_reason } = req.body;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be approve or reject' });
        }
        if (action === 'reject' && !rejection_reason) {
            return res.status(400).json({ error: 'rejection_reason is required when rejecting' });
        }

        const VALID_REASONS = [
            'Wrong pillar', 'Wrong sector', 'Insufficient evidence',
            'Not applicable to our markets', 'Duplicate',
        ];
        if (action === 'reject' && !VALID_REASONS.includes(rejection_reason)) {
            return res.status(400).json({ error: `rejection_reason must be one of: ${VALID_REASONS.join(', ')}` });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const qRes = await client.query(
                `SELECT * FROM ingestion_queue WHERE id = $1 AND status = 'pending' FOR UPDATE`,
                [id]
            );
            if (qRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Queue item not found or already reviewed' });
            }
            const item = qRes.rows[0];

            if (action === 'approve') {
                await client.query(
                    `INSERT INTO external_benchmark
                        (source_registry_id, pillar, sector, risk_theme,
                         frequency, frequency_raw, severity, severity_raw,
                         confidence_score, page_reference, period,
                         approved_by, approved_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
                    [item.source_registry_id, item.pillar, item.sector, item.risk_theme,
                     item.frequency, item.frequency_raw, item.severity, item.severity_raw,
                     item.confidence_score, item.page_reference, item.period,
                     req.user.id]
                );
                await client.query(
                    `UPDATE ingestion_queue
                     SET status = 'approved', reviewed_by = $1, reviewed_at = now()
                     WHERE id = $2`,
                    [req.user.id, id]
                );
            } else {
                await client.query(
                    `UPDATE ingestion_queue
                     SET status = 'rejected', reviewed_by = $1, reviewed_at = now(),
                         rejection_reason = $2
                     WHERE id = $3`,
                    [req.user.id, rejection_reason, id]
                );
            }

            await client.query('COMMIT');
            await logAudit(null, {
                entityType: 'ingestion_queue', entityId: id,
                action: action === 'approve' ? 'queue_item_approved' : 'queue_item_rejected',
                actor: req.user,
                meta: action === 'reject' ? { rejection_reason } : undefined,
            });
            res.json({ ok: true, action, id });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    })
);

// GET /api/consultant/companies
// Returns the companies where this consultant user has is_external = true,
// along with their role in each. Used to populate the company switcher.
app.get(
    '/api/consultant/companies',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const result = await pool.query(
            `SELECT c.id, c.name, c.code, c.industry,
                    uc.role, uc.is_external
             FROM user_companies uc
             JOIN companies c ON c.id = uc.company_id
             WHERE uc.user_id = $1
               AND uc.is_external = true
               AND c.is_active = true
             ORDER BY c.name`,
            [req.user.id]
        );
        res.json(result.rows);
    })
);

// GET /api/consultant/benchmarks
// Returns approved external_benchmark records.
// Optional filters: ?pillar=&sector=&period=
app.get(
    '/api/consultant/benchmarks',
    requireConsultant,
    asyncHandler(async (req, res) => {
        const { pillar, sector, period } = req.query;
        const params = [];
        const conditions = ['eb.is_active = true'];

        if (pillar) { params.push(pillar); conditions.push(`eb.pillar = $${params.length}`); }
        if (sector) { params.push(sector); conditions.push(`eb.sector = $${params.length}`); }
        if (period) { params.push(period); conditions.push(`eb.period = $${params.length}`); }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const result = await pool.query(
            `SELECT eb.id, eb.pillar, eb.sector, eb.risk_theme,
                    eb.frequency, eb.severity, eb.confidence_score,
                    eb.page_reference, eb.period, eb.approved_at,
                    s.name AS source_name, s.organisation
             FROM external_benchmark eb
             JOIN source_registry s ON s.id = eb.source_registry_id
             ${where}
             ORDER BY eb.pillar, eb.sector, eb.risk_theme`,
            params
        );
        res.json(result.rows);
    })
);

// ============================================================
// AI Integration — Admin API key management
// ============================================================

// GET /api/admin/ai-settings — returns provider label + masked key (last 4 chars only)
app.get(
    '/api/admin/ai-settings',
    requireRole('Admin', 'CRO', 'Consultant CRO', 'Risk Manager'),
    asyncHandler(async (req, res) => {
        const r = await pool.query(
            'SELECT ai_api_key, ai_api_provider FROM companies WHERE id = $1',
            [req.company.id]
        );
        const row = r.rows[0] || {};
        const key = row.ai_api_key || null;
        res.json({
            ai_api_provider: row.ai_api_provider || null,
            ai_api_key_masked: key ? `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}` : null,
            has_ai_key: Boolean(key),
        });
    })
);

// PATCH /api/admin/ai-settings — store or clear the AI API key (Admin only)
app.patch(
    '/api/admin/ai-settings',
    requireRole('Admin'),
    asyncHandler(async (req, res) => {
        const { ai_api_key, ai_api_provider } = req.body;
        // Passing ai_api_key: null explicitly clears the key
        const updates = [];
        const values = [];
        if (ai_api_key !== undefined) {
            values.push(ai_api_key || null);
            updates.push(`ai_api_key = $${values.length}`);
        }
        if (ai_api_provider !== undefined) {
            values.push(ai_api_provider || null);
            updates.push(`ai_api_provider = $${values.length}`);
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(req.company.id);
        await pool.query(`UPDATE companies SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
        await logAudit(null, {
            companyId: req.company.id, entityType: 'company', entityId: req.company.id,
            action: 'ai_settings_updated', actor: req.user,
            details: { ai_api_provider: ai_api_provider || null, key_set: Boolean(ai_api_key) },
        });
        res.json({ ok: true });
    })
);

// ============================================================
// Horizon Scanning
// ============================================================

const HORIZON_CATEGORIES  = ['Regulatory', 'Geopolitical', 'Technology', 'Economic', 'Environmental', 'Social'];
const HORIZON_HORIZONS    = ['Near-term (<1yr)', 'Medium-term (1-3yr)', 'Long-term (3yr+)'];
const HORIZON_IMPACTS     = ['Low', 'Medium', 'High', 'Critical'];
const HORIZON_LIKELIHOODS = ['Unlikely', 'Possible', 'Likely'];
const HORIZON_STATUSES    = ['Draft', 'Monitoring', 'Escalated', 'Converted', 'Dismissed'];

// GET /api/horizon-scans — list signals (Drafts visible to Admin/CRO/Risk Manager only)
app.get(
    '/api/horizon-scans',
    requireRole('Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const { status, category, time_horizon, owner } = req.query;
        // Bug fix (2026-07-22): same class of bug as POLICY_TRANSITIONS above --
        // was missing the literal 'Super Admin' role string.
        const canSeeDrafts = ['Admin', 'Super Admin', 'CRO', 'Consultant CRO', 'Risk Manager'].includes(req.company.role);

        const conditions = ['company_id = $1', 'is_deleted = FALSE'];
        const values = [req.company.id];

        if (!canSeeDrafts) {
            conditions.push(`status != 'Draft'`);
        }
        if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
        if (category) { values.push(category); conditions.push(`category = $${values.length}`); }
        if (time_horizon) { values.push(time_horizon); conditions.push(`time_horizon = $${values.length}`); }
        if (owner) { values.push(owner); conditions.push(`owner = $${values.length}`); }

        const result = await pool.query(
            `SELECT * FROM horizon_scans WHERE ${conditions.join(' AND ')}
             ORDER BY
               CASE status WHEN 'Escalated' THEN 0 WHEN 'Draft' THEN 1 WHEN 'Monitoring' THEN 2 ELSE 3 END,
               CASE potential_impact WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
               CASE time_horizon WHEN 'Near-term (<1yr)' THEN 0 WHEN 'Medium-term (1-3yr)' THEN 1 ELSE 2 END,
               created_at DESC`,
            values
        );

        // Return has_ai_key so the frontend can show/hide the AI scan button without a separate call
        const companyRow = await pool.query('SELECT has_ai_key FROM (SELECT ai_api_key IS NOT NULL AS has_ai_key FROM companies WHERE id = $1) sub', [req.company.id]);

        res.json({
            signals: result.rows,
            has_ai_key: companyRow.rows[0]?.has_ai_key || false,
        });
    })
);

// POST /api/horizon-scans — create a new signal
app.post(
    '/api/horizon-scans',
    requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const { title, category, description, source_name, source_url, time_horizon,
                potential_impact, likelihood, department, notes } = req.body;
        if (!title || !category || !description || !time_horizon || !potential_impact || !likelihood) {
            return res.status(400).json({ error: 'title, category, description, time_horizon, potential_impact, and likelihood are required' });
        }
        if (!HORIZON_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
        if (!HORIZON_HORIZONS.includes(time_horizon)) return res.status(400).json({ error: 'Invalid time_horizon' });
        if (!HORIZON_IMPACTS.includes(potential_impact)) return res.status(400).json({ error: 'Invalid potential_impact' });
        if (!HORIZON_LIKELIHOODS.includes(likelihood)) return res.status(400).json({ error: 'Invalid likelihood' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Generate UID: HS-{DEPT_CODE}-{NNNN}
            const deptCode = department
                ? department.replace(/\s+/g, '').toUpperCase().slice(0, 4)
                : 'ENT';
            const countRes = await client.query(
                `SELECT COUNT(*) FROM horizon_scans WHERE company_id = $1`, [req.company.id]
            );
            const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0');
            const scan_uid = `HS-${deptCode}-${seq}`;

            const ins = await client.query(
                `INSERT INTO horizon_scans
                 (company_id, scan_uid, title, category, description, source_name, source_url,
                  time_horizon, potential_impact, likelihood, status, owner, department, notes, added_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Monitoring',$11,$12,$13,$14) RETURNING *`,
                [req.company.id, scan_uid, title, category, description, source_name || null,
                 source_url || null, time_horizon, potential_impact, likelihood,
                 req.user.email, department || null, notes || null, req.user.email]
            );
            await logAudit(client, {
                companyId: req.company.id, entityType: 'horizon_scan', entityId: scan_uid,
                action: 'created', actor: req.user, details: { scan_uid, title, category },
            });
            await client.query('COMMIT');
            res.status(201).json(ins.rows[0]);
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    })
);

// PATCH /api/horizon-scans/:id — update a signal
app.patch(
    '/api/horizon-scans/:id',
    requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const current = await pool.query(
            'SELECT * FROM horizon_scans WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE',
            [req.params.id, req.company.id]
        );
        if (current.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });

        const editableFields = ['title', 'category', 'description', 'source_name', 'source_url',
                                'time_horizon', 'potential_impact', 'likelihood', 'owner', 'department',
                                'notes', 'status', 'converted_risk_uid'];
        const updates = [];
        const values = [];
        for (const f of editableFields) {
            if (req.body[f] !== undefined) {
                values.push(req.body[f]);
                updates.push(`${f} = $${values.length}`);
            }
        }

        // Set transition timestamps
        const newStatus = req.body.status;
        if (newStatus === 'Escalated' && current.rows[0].status !== 'Escalated') {
            updates.push(`escalated_at = NOW()`);
        }
        if (newStatus === 'Converted') {
            updates.push(`converted_at = NOW()`);
            if (req.body.converted_risk_uid) {
                // Store risk ID as well if provided
                const riskRes = await pool.query(
                    'SELECT id FROM risks WHERE risk_uid = $1 AND company_id = $2',
                    [req.body.converted_risk_uid, req.company.id]
                );
                if (riskRes.rows.length > 0) {
                    values.push(riskRes.rows[0].id);
                    updates.push(`converted_risk_id = $${values.length}`);
                }
            }
        }
        if (newStatus === 'Dismissed') {
            updates.push(`dismissed_at = NOW()`);
        }

        updates.push(`updated_at = NOW()`);
        values.push(req.params.id, req.company.id);
        const result = await pool.query(
            `UPDATE horizon_scans SET ${updates.join(', ')}
             WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
            values
        );
        await logAudit(null, {
            companyId: req.company.id, entityType: 'horizon_scan', entityId: current.rows[0].scan_uid,
            action: newStatus && newStatus !== current.rows[0].status ? newStatus.toLowerCase() : 'updated',
            actor: req.user, details: req.body,
        });
        res.json(result.rows[0]);
    })
);

// POST /api/horizon-scans/:id/convert — return pre-populated risk payload
app.post(
    '/api/horizon-scans/:id/convert',
    requireRole('Admin', 'Risk Manager', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const r = await pool.query(
            'SELECT * FROM horizon_scans WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE',
            [req.params.id, req.company.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });
        const s = r.rows[0];

        const CATEGORY_MAP = {
            Regulatory: 'Compliance Risk', Geopolitical: 'Strategic Risk',
            Technology: 'Operational Risk', Economic: 'Financial Risk',
            Environmental: 'Operational Risk', Social: 'Reputational Risk',
        };
        res.json({
            risk_detail: s.title,
            risk_category: CATEGORY_MAP[s.category] || '',
            department: s.department || '',
            framework_reference: s.scan_uid,
            source_signal_id: s.id,
            source_signal_uid: s.scan_uid,
        });
    })
);

// DELETE /api/horizon-scans/:id — soft delete
app.delete(
    '/api/horizon-scans/:id',
    requireRole('Admin', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        const r = await pool.query(
            'SELECT scan_uid FROM horizon_scans WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE',
            [req.params.id, req.company.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });
        await pool.query(
            'UPDATE horizon_scans SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND company_id = $2',
            [req.params.id, req.company.id]
        );
        await logAudit(null, {
            companyId: req.company.id, entityType: 'horizon_scan', entityId: r.rows[0].scan_uid,
            action: 'deleted', actor: req.user,
        });
        res.json({ ok: true });
    })
);

// POST /api/horizon-scans/ai-draft — AI-assisted signal generation
// Fetches GCC-relevant RSS/news sources, passes to AI API, creates Draft signals.
app.post(
    '/api/horizon-scans/ai-draft',
    requireRole('Admin', 'CRO', 'Consultant CRO'),
    asyncHandler(async (req, res) => {
        // Check company has an AI key configured
        const companyRow = await pool.query(
            'SELECT ai_api_key, ai_api_provider FROM companies WHERE id = $1', [req.company.id]
        );
        const { ai_api_key, ai_api_provider } = companyRow.rows[0] || {};
        if (!ai_api_key) {
            return res.status(400).json({ error: 'No AI API key configured. Contact your Admin.' });
        }

        // Curated GCC/postal-logistics relevant RSS sources
        const SOURCES = [
            'https://www.qcb.gov.qa/English/MediaCenter/Pages/NewsDetails.aspx',
            'https://feeds.reuters.com/reuters/businessNews',
            'https://www.weforum.org/agenda/feed/',
            'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
            'https://www.cisa.gov/news.xml',
        ];

        // Fetch source content (best-effort — skip failures)
        const https = require('https');
        const http = require('http');
        async function fetchText(url) {
            return new Promise((resolve) => {
                const mod = url.startsWith('https') ? https : http;
                mod.get(url, { timeout: 5000, headers: { 'User-Agent': 'GRC-Horizon-Scanner/1.0' } }, (resp) => {
                    let data = '';
                    resp.on('data', (c) => { data += c; });
                    resp.on('end', () => resolve(data.slice(0, 8000)));
                }).on('error', () => resolve(''));
            });
        }

        const contents = await Promise.all(SOURCES.map(fetchText));
        const combinedContent = contents.filter(Boolean).join('\n\n---\n\n').slice(0, 30000);

        if (!combinedContent.trim()) {
            return res.status(502).json({ error: 'Could not fetch any source content. Try again later.' });
        }

        // Build prompt
        const prompt = `You are a senior risk analyst for Qatar Post, a government-owned postal and logistics organisation in Qatar. Review the following news and regulatory content and identify up to 8 emerging risk signals that could affect Qatar Post's operations, compliance, or strategic position.

For each signal, return a JSON array with objects containing exactly these fields:
- title: short headline (max 15 words)
- category: one of Regulatory, Geopolitical, Technology, Economic, Environmental, Social
- time_horizon: one of "Near-term (<1yr)", "Medium-term (1-3yr)", "Long-term (3yr+)"
- potential_impact: one of Low, Medium, High, Critical
- likelihood: one of Unlikely, Possible, Likely
- description: 3-4 sentences covering what the signal is, why it matters to Qatar Post specifically, and the potential consequence if it materialises.

Return ONLY a valid JSON array. No markdown, no explanation, no wrapper object.

Content to analyse:
${combinedContent}`;

        // Call AI API
        let aiResponse;
        try {
            aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': ai_api_key,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 3000,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
        } catch (fetchErr) {
            return res.status(502).json({ error: 'Could not reach AI API. Check your API key and provider.' });
        }

        if (!aiResponse.ok) {
            const errBody = await aiResponse.text().catch(() => '');
            return res.status(502).json({ error: `AI API returned ${aiResponse.status}. Check your API key.` });
        }

        const aiData = await aiResponse.json();
        const rawText = aiData?.content?.[0]?.text || aiData?.choices?.[0]?.message?.content || '';

        let signals;
        try {
            signals = JSON.parse(rawText.trim());
            if (!Array.isArray(signals)) throw new Error('Not an array');
        } catch {
            return res.status(502).json({ error: 'AI response was not valid JSON. Try again.' });
        }

        // Fetch existing signal titles for duplicate detection
        const existingRes = await pool.query(
            `SELECT title FROM horizon_scans WHERE company_id = $1 AND is_deleted = FALSE AND status != 'Dismissed'`,
            [req.company.id]
        );
        const existingTitles = existingRes.rows.map((r) => r.title.toLowerCase());

        function similarity(a, b) {
            const A = a.toLowerCase(), B = b.toLowerCase();
            const longer = A.length > B.length ? A : B;
            const shorter = A.length > B.length ? B : A;
            if (longer.length === 0) return 1;
            let matches = 0;
            for (let i = 0; i < shorter.length; i++) {
                if (longer.includes(shorter[i])) matches++;
            }
            return matches / longer.length;
        }

        let drafted = 0, skipped = 0;
        const errors = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const s of signals) {
                // Validate required fields
                if (!s.title || !s.category || !s.description || !s.time_horizon || !s.potential_impact || !s.likelihood) {
                    errors.push(`Skipped malformed signal: ${s.title || '(no title)'}`);
                    continue;
                }
                if (!HORIZON_CATEGORIES.includes(s.category) || !HORIZON_HORIZONS.includes(s.time_horizon) ||
                    !HORIZON_IMPACTS.includes(s.potential_impact) || !HORIZON_LIKELIHOODS.includes(s.likelihood)) {
                    errors.push(`Skipped signal with invalid enum value: ${s.title}`);
                    continue;
                }
                // Duplicate check (80% similarity threshold)
                const isDuplicate = existingTitles.some((t) => similarity(t, s.title) >= 0.8);
                if (isDuplicate) { skipped++; continue; }

                const countRes = await client.query(
                    'SELECT COUNT(*) FROM horizon_scans WHERE company_id = $1', [req.company.id]
                );
                const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0');
                const scan_uid = `HS-ENT-${seq}`;

                await client.query(
                    `INSERT INTO horizon_scans
                     (company_id, scan_uid, title, category, description, time_horizon,
                      potential_impact, likelihood, status, added_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft','ai-assistant')`,
                    [req.company.id, scan_uid, s.title.slice(0, 200), s.category, s.description,
                     s.time_horizon, s.potential_impact, s.likelihood]
                );
                drafted++;
            }
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }

        await logAudit(null, {
            companyId: req.company.id, entityType: 'horizon_scan', entityId: 'ai-draft',
            action: 'ai_draft_run', actor: req.user,
            details: { drafted, skipped, errors, provider: ai_api_provider || 'unknown' },
        });

        res.json({ drafted, skipped, errors });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// FORMS & TEMPLATES
// Access: CRO, Consultant CRO, Admin, Super Admin
// ─────────────────────────────────────────────────────────────────────────────

const FORMS_ROLES = ['Admin', 'Super Admin', 'CRO', 'Consultant CRO'];

// GET /api/forms/accepted-risks?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns the latest version of every risk accepted (cro_acceptance_status='accepted')
// with cro_actioned_at falling within the requested date range.
app.get('/api/forms/accepted-risks', requireRole(...FORMS_ROLES), asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to query params are required (YYYY-MM-DD)' });

    const rows = await pool.query(
        `SELECT r.id, r.risk_uid, r.risk_detail AS title, r.risk_category, r.sub_category,
                r.treatment_strategy, r.treatment_plan_rationale,
                r.inherent_likelihood, r.inherent_impact,
                r.inherent_likelihood * r.inherent_impact AS inherent_score,
                r.residual_likelihood, r.residual_impact,
                r.residual_likelihood * r.residual_impact AS residual_score,
                r.cro_actioned_at, r.cro_notes, r.department,
                u.full_name AS cro_name
         FROM risks r
         LEFT JOIN users u ON u.id = r.cro_user_id
         WHERE r.company_id = $1
           AND r.cro_acceptance_status = 'accepted'
           AND r.cro_actioned_at >= $2::date
           AND r.cro_actioned_at <  $3::date + interval '1 day'
           AND r.version = (
               SELECT MAX(r2.version) FROM risks r2
               WHERE r2.company_id = r.company_id AND r2.risk_uid = r.risk_uid
           )
         ORDER BY r.cro_actioned_at ASC, r.risk_uid`,
        [req.company.id, from, to]
    );
    res.json(rows.rows);
}));

// ─────────────────────────────────────────────────────────────────────────────
// RISK GOVERNANCE DOCUMENTS
// Access: CRO, Consultant CRO, Risk Manager, Admin, Super Admin
// Files are stored embedded in Postgres (schema v72), not Google Cloud
// Storage — migrated off GCS specifically to remove an external storage
// dependency ahead of a possible on-premises handover (see
// docs/SCOPE_NOTES.md section 14).
// ─────────────────────────────────────────────────────────────────────────────

const RGD_ROLES = ['Admin', 'Super Admin', 'CRO', 'Consultant CRO', 'Risk Manager'];

// GET /api/risk-gov/categories
app.get('/api/risk-gov/categories', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const rows = await pool.query(
        `SELECT id, code, name, display_order,
                (SELECT COUNT(*) FROM risk_gov_documents d WHERE d.category_id = rgc.id AND d.is_latest = true) AS doc_count
         FROM risk_gov_categories rgc
         WHERE company_id = $1
         ORDER BY display_order, name`,
        [req.company.id]
    );
    res.json(rows.rows);
}));

// POST /api/risk-gov/categories
app.post('/api/risk-gov/categories', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    const safeCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (!safeCode) return res.status(400).json({ error: 'code must contain letters or numbers' });
    const maxOrd = await pool.query(
        'SELECT COALESCE(MAX(display_order), 0) AS m FROM risk_gov_categories WHERE company_id = $1',
        [req.company.id]
    );
    const r = await pool.query(
        `INSERT INTO risk_gov_categories (company_id, code, name, display_order)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.company.id, safeCode, name.trim(), parseInt(maxOrd.rows[0].m, 10) + 1]
    );
    res.status(201).json(r.rows[0]);
}));

// DELETE /api/risk-gov/categories/:id
app.delete('/api/risk-gov/categories/:id', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const catId = parseInt(req.params.id, 10);
    const cat = await pool.query(
        'SELECT id FROM risk_gov_categories WHERE id = $1 AND company_id = $2',
        [catId, req.company.id]
    );
    if (!cat.rows.length) return res.status(404).json({ error: 'Category not found' });
    const docCount = await pool.query(
        'SELECT COUNT(*) AS cnt FROM risk_gov_documents WHERE category_id = $1',
        [catId]
    );
    if (parseInt(docCount.rows[0].cnt, 10) > 0) {
        return res.status(409).json({ error: 'Cannot delete a category that has documents. Move or delete the documents first.' });
    }
    await pool.query('DELETE FROM risk_gov_categories WHERE id = $1', [catId]);
    res.json({ ok: true });
}));

// GET /api/risk-gov/documents  — latest versions only by default; ?all=1 returns all versions
app.get('/api/risk-gov/documents', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const all = req.query.all === '1';
    const rows = await pool.query(
        `SELECT d.id, d.doc_id, d.version, d.title, d.description,
                d.file_name, d.file_size, d.uploaded_at, d.is_latest,
                c.id AS category_id, c.code AS category_code, c.name AS category_name,
                u.full_name AS uploaded_by_name
         FROM risk_gov_documents d
         JOIN risk_gov_categories c ON c.id = d.category_id
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.company_id = $1 ${all ? '' : 'AND d.is_latest = true'}
         ORDER BY d.doc_id, d.version DESC`,
        [req.company.id]
    );
    res.json(rows.rows);
}));

// Documents are stored as base64 blobs directly in Postgres (same pattern
// as evidence_attachments) rather than external object storage — see
// schema_v72_risk_gov_docs_embed_storage.sql.
const RGD_MAX_BYTES   = 10 * 1024 * 1024;  // 10MB per-file limit
const RGD_QUOTA_BYTES = 500 * 1024 * 1024; // 500MB per-company quota

// POST /api/risk-gov/documents — create a new document (body includes file_data, base64)
app.post('/api/risk-gov/documents', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const { category_id, title, description, file_name, mime_type, file_data } = req.body;
    if (!category_id || !title || !file_name || !file_data) {
        return res.status(400).json({ error: 'category_id, title, file_name, and file_data are required' });
    }
    const bytes = Buffer.byteLength(file_data, 'base64');
    if (bytes > RGD_MAX_BYTES) {
        return res.status(400).json({ error: `File too large (${Math.round(bytes / (1024 * 1024))}MB). Maximum is 10MB per file.` });
    }
    const usageRes = await pool.query(
        `SELECT COALESCE(SUM(file_size), 0) AS total FROM risk_gov_documents WHERE company_id = $1`,
        [req.company.id]
    );
    if (parseInt(usageRes.rows[0].total, 10) + bytes > RGD_QUOTA_BYTES) {
        return res.status(400).json({ error: 'Company storage quota exceeded (500 MB). Please delete old documents before uploading new ones.' });
    }
    const scan = await scanFile(file_name, mime_type || 'application/octet-stream', file_data);
    if (!scan.safe) return res.status(400).json({ error: `File rejected: ${scan.reason}` });

    const cat = await pool.query(
        'SELECT id, code FROM risk_gov_categories WHERE id = $1 AND company_id = $2',
        [category_id, req.company.id]
    );
    if (!cat.rows.length) return res.status(404).json({ error: 'Category not found' });
    const { code } = cat.rows[0];
    const year = new Date().getFullYear();
    // Next sequence: count distinct doc_ids starting with CODE-YEAR- for this company
    const seqRow = await pool.query(
        `SELECT COUNT(DISTINCT doc_id) + 1 AS next_seq
         FROM risk_gov_documents
         WHERE company_id = $1 AND doc_id LIKE $2`,
        [req.company.id, `${code}-${year}-%`]
    );
    const seq = String(seqRow.rows[0].next_seq).padStart(3, '0');
    const docId = `${code}-${year}-${seq}`;
    const r = await pool.query(
        `INSERT INTO risk_gov_documents
           (company_id, category_id, doc_id, version, title, description, file_name, file_size, mime_type, file_data, uploaded_by, is_latest)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, true)
         RETURNING id, company_id, category_id, doc_id, version, title, description, file_name, file_size, mime_type, uploaded_by, uploaded_at, is_latest`,
        [req.company.id, category_id, docId, title.trim(), description?.trim() || null,
         file_name, bytes, mime_type || null, file_data, req.user.id]
    );
    res.status(201).json(r.rows[0]);
}));

// POST /api/risk-gov/documents/:id/version — upload a new version of an existing document
app.post('/api/risk-gov/documents/:id/version', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const docDbId = parseInt(req.params.id, 10);
    const { file_name, mime_type, file_data, description } = req.body;
    if (!file_name || !file_data) return res.status(400).json({ error: 'file_name and file_data are required' });
    const bytes = Buffer.byteLength(file_data, 'base64');
    if (bytes > RGD_MAX_BYTES) {
        return res.status(400).json({ error: `File too large (${Math.round(bytes / (1024 * 1024))}MB). Maximum is 10MB per file.` });
    }
    const usageRes = await pool.query(
        `SELECT COALESCE(SUM(file_size), 0) AS total FROM risk_gov_documents WHERE company_id = $1`,
        [req.company.id]
    );
    if (parseInt(usageRes.rows[0].total, 10) + bytes > RGD_QUOTA_BYTES) {
        return res.status(400).json({ error: 'Company storage quota exceeded (500 MB). Please delete old documents before uploading new ones.' });
    }
    const scan = await scanFile(file_name, mime_type || 'application/octet-stream', file_data);
    if (!scan.safe) return res.status(400).json({ error: `File rejected: ${scan.reason}` });

    // Get the current latest record
    const current = await pool.query(
        'SELECT * FROM risk_gov_documents WHERE id = $1 AND company_id = $2 AND is_latest = true',
        [docDbId, req.company.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Document not found' });
    const prev = current.rows[0];
    // Mark all existing versions as not latest
    await pool.query(
        'UPDATE risk_gov_documents SET is_latest = false WHERE company_id = $1 AND doc_id = $2',
        [req.company.id, prev.doc_id]
    );
    // Insert new version
    const r = await pool.query(
        `INSERT INTO risk_gov_documents
           (company_id, category_id, doc_id, version, title, description, file_name, file_size, mime_type, file_data, uploaded_by, is_latest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
         RETURNING id, company_id, category_id, doc_id, version, title, description, file_name, file_size, mime_type, uploaded_by, uploaded_at, is_latest`,
        [req.company.id, prev.category_id, prev.doc_id, prev.version + 1,
         prev.title, description?.trim() ?? prev.description,
         file_name, bytes, mime_type || null, file_data, req.user.id]
    );
    res.status(201).json(r.rows[0]);
}));

// GET /api/risk-gov/documents/:id/download — streams the file directly from Postgres
app.get('/api/risk-gov/documents/:id/download', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const r = await pool.query(
        'SELECT file_name, mime_type, file_data FROM risk_gov_documents WHERE id = $1 AND company_id = $2',
        [parseInt(req.params.id, 10), req.company.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Document not found' });
    const { file_name, mime_type, file_data } = r.rows[0];
    if (!file_data) return res.status(404).json({ error: 'File data not available for this document.' });
    const buf = Buffer.from(file_data, 'base64');
    res.set('Content-Type', mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${file_name}"`);
    res.send(buf);
}));

// GET /api/risk-gov/documents/:id/versions — all versions of a document
app.get('/api/risk-gov/documents/:id/versions', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const doc = await pool.query(
        'SELECT doc_id FROM risk_gov_documents WHERE id = $1 AND company_id = $2',
        [parseInt(req.params.id, 10), req.company.id]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'Document not found' });
    const rows = await pool.query(
        `SELECT d.id, d.version, d.file_name, d.file_size, d.uploaded_at, d.is_latest, d.description,
                u.full_name AS uploaded_by_name
         FROM risk_gov_documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.company_id = $1 AND d.doc_id = $2
         ORDER BY d.version DESC`,
        [req.company.id, doc.rows[0].doc_id]
    );
    res.json(rows.rows);
}));

// DELETE /api/risk-gov/documents/:id — delete all versions of a document
app.delete('/api/risk-gov/documents/:id', requireRole(...RGD_ROLES), asyncHandler(async (req, res) => {
    const docDbId = parseInt(req.params.id, 10);
    const doc = await pool.query(
        'SELECT doc_id FROM risk_gov_documents WHERE id = $1 AND company_id = $2',
        [docDbId, req.company.id]
    );
    if (!doc.rows.length) return res.status(404).json({ error: 'Document not found' });
    await pool.query(
        'DELETE FROM risk_gov_documents WHERE company_id = $1 AND doc_id = $2',
        [req.company.id, doc.rows[0].doc_id]
    );
    res.json({ ok: true });
}));

// SPA catch-all — must be AFTER all API routes so it never intercepts /api/* requests.
// Only falls back to index.html for real page navigations. A request for a static
// asset that express.static didn't find (e.g. a stale cached client — standalone Dock
// app or otherwise — asking for a JS/CSS bundle filename from a previous deploy) gets
// a real 404 instead of silently being served index.html's markup, which the browser
// can't execute as JS/apply as CSS and which used to render as a blank page.
app.get('*', (req, res) => {
    const looksLikeStaticAsset = req.path.startsWith('/assets/') || /\.[a-zA-Z0-9]+$/.test(req.path);
    if (looksLikeStaticAsset) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Body-size error handler — must come before the generic 500 handler ─────────
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({ error: 'Request body too large' });
    }
    next(err);
});

app.use((err, req, res, next) => {
    console.error(err);
    const detail = process.env.NODE_ENV !== 'production'
        ? ` [${err?.message || String(err)}]`
        : '';
    res.status(500).json({ error: `Internal server error${detail}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ERM Workstation (v2, multi-tenant) running on port ${PORT}`));
