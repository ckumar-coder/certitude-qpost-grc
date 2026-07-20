import { useState } from 'react';
import { useAuth } from '../AuthContext';

// ── Permission model ──────────────────────────────────────────────────────────
// Sourced from requireRole() guards in server.js and routing logic in App.jsx.
// Update whenever backend route guards or frontend routing changes.
//
// Cell types:
//   F = full    → green  ✓ Full
//   D = dept    → amber  ◐ Dept only  (Risk Manager: own dept(s) only)
//   O = own     → amber  ◐ Own only   (Risk Champion: own submissions only)
//   N = none    → grey   – no access

const F = 'full';
const D = 'dept';
const O = 'own';
const N = 'none';

const ROLES = [
    { id: 'Admin',          short: 'Admin' },
    { id: 'Risk Manager',   short: 'Risk Mgr' },
    { id: 'Risk Owner',     short: 'Risk Owner' },
    { id: 'Risk Champion',  short: 'Risk Champion' },
    { id: 'CRO',            short: 'CRO' },
    { id: 'Consultant CRO', short: 'Consult. CRO' },
    { id: 'Viewer',         short: 'Viewer' },
];

//                                                           Admin  RM     RO     RC     CRO    CCRO   Viewer
const SECTIONS = [
    {
        title: 'Risk Register',
        rows: [
            { action: 'View risks',
              note: 'Admin and all operational roles can view risks. Admin and Viewers have read-only access.',
              cells: [F,    F,    F,    F,    F,    F,    F] },
            { action: 'Create risk',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    N] },
            { action: 'Edit risk',
              note: 'Risk Manager: risks in own department(s) only · Risk Champion: own submissions only · CRO / Consultant CRO: any risk',
              cells: [N,    D,    N,    O,    F,    F,    N] },
            { action: '1st-line review',
              note: 'Risk Owner approves or returns a risk at the first review stage before it escalates to the Risk Manager.',
              cells: [N,    N,    F,    N,    N,    N,    N] },
            { action: 'Manager approval',
              note: 'Risk Manager sends risk to CRO or rejects it back to the creator. CRO / Consultant CRO may also action this step.',
              cells: [N,    F,    N,    N,    F,    F,    N] },
            { action: 'CRO acceptance',
              note: 'Final CRO-level accept or decline before a risk is marked as accepted.',
              cells: [N,    N,    N,    N,    F,    F,    N] },
            { action: 'Close / Reopen risk',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'Control Library',
        rows: [
            { action: 'View controls',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit control',
              note: null,
              cells: [N,    F,    N,    F,    F,    N,    N] },
            { action: 'Test control effectiveness',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'KRI Library & Register',
        rows: [
            { action: 'View KRIs & readings',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit KRI',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
            { action: 'Record KRI measurement',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'Issues & Actions',
        rows: [
            { action: 'View issues',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit issue',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    N] },
            { action: 'Update issue status',
              note: null,
              cells: [N,    F,    F,    F,    F,    N,    N] },
        ],
    },
    {
        title: 'Policy Repository',
        rows: [
            { action: 'View policies',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit policy',
              note: null,
              cells: [N,    F,    N,    F,    F,    N,    N] },
            { action: 'Workflow transitions',
              note: 'Submit for review, approve, send back, or publish. Consultant CRO and Viewer cannot trigger policy workflow steps.',
              cells: [N,    F,    F,    F,    F,    N,    N] },
            { action: 'Attest to policy',
              note: null,
              cells: [N,    F,    F,    F,    F,    N,    N] },
        ],
    },
    {
        title: 'Compliance Obligations',
        rows: [
            { action: 'View obligations',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit obligation',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
            { action: 'Update compliance status',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'Org Roles (RACI Matrix)',
        rows: [
            { action: 'View RACI matrix',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'Create / Edit / Delete roles',
              note: null,
              cells: [N,    F,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'Tasks & Dashboards',
        rows: [
            { action: 'Management Summary',
              note: null,
              cells: [N,    F,    F,    F,    F,    F,    F] },
            { action: 'My Tasks (workflow)',
              note: 'Shows pending workflow items assigned to the logged-in user. Viewer has no workflow role.',
              cells: [N,    F,    F,    F,    F,    F,    N] },
        ],
    },
    {
        title: 'Admin Settings',
        note: 'These modules are exclusively for the Admin role.',
        rows: [
            { action: 'Manage Users & Access',
              note: null,
              cells: [F,    N,    N,    N,    N,    N,    N] },
            { action: 'Company Structure',
              note: null,
              cells: [F,    N,    N,    N,    N,    N,    N] },
            { action: 'Risk Configuration',
              note: null,
              cells: [F,    N,    N,    N,    N,    N,    N] },
            { action: 'Email & Escalation Rules',
              note: null,
              cells: [F,    N,    N,    N,    N,    N,    N] },
            { action: 'Branding & Storage',
              note: null,
              cells: [F,    N,    N,    N,    N,    N,    N] },
            { action: 'View Access Matrix',
              note: 'CRO and Consultant CRO can view this page in read-only mode.',
              cells: [F,    N,    N,    N,    F,    F,    N] },
        ],
    },
    {
        title: 'Resources & Utilities',
        rows: [
            { action: 'Audit Log',
              note: 'All roles except Viewer can view the audit trail.',
              cells: [F,    F,    F,    F,    F,    F,    N] },
            { action: 'Import data',
              note: null,
              cells: [F,    F,    N,    F,    F,    N,    N] },
            { action: 'Export data',
              note: null,
              cells: [F,    F,    N,    F,    F,    N,    N] },
            { action: 'Scoring Methodology',
              note: null,
              cells: [F,    F,    F,    F,    F,    F,    F] },
            { action: 'Glossary',
              note: null,
              cells: [F,    F,    F,    F,    F,    F,    F] },
        ],
    },
];

// ── Cell rendering ────────────────────────────────────────────────────────────

const CELL_CONFIG = {
    full: { bg: '#e6f4ea', color: '#1a7a3c', border: '#b7dfc4', icon: '✓', label: 'Full'      },
    dept: { bg: '#fff8e6', color: '#7a5a00', border: '#f5d98a', icon: '◐', label: 'Dept only' },
    own:  { bg: '#fff8e6', color: '#7a5a00', border: '#f5d98a', icon: '◐', label: 'Own only'  },
    none: { bg: '#f4f5f7', color: '#b0b5c0', border: '#e2e4ea', icon: '–', label: 'No access' },
};

function Cell({ type, isYourRole }) {
    const cfg = CELL_CONFIG[type] || CELL_CONFIG.none;
    return (
        <td style={{
            padding: '8px 6px',
            textAlign: 'center',
            borderBottom: '1px solid #eef0f5',
            background: isYourRole ? (type === 'none' ? '#f8f9ff' : 'rgba(42,82,152,0.06)') : 'transparent',
        }}>
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '3px 8px',
                borderRadius: 99,
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                color: cfg.color,
                fontWeight: type === 'none' ? 400 : 600,
                fontSize: 11,
                whiteSpace: 'nowrap',
            }}>
                <span style={{ fontSize: type === 'none' ? 14 : 11 }}>{cfg.icon}</span>
                {type !== 'none' && <span>{cfg.label}</span>}
            </span>
        </td>
    );
}

// ── Info tooltip ──────────────────────────────────────────────────────────────

function InfoTip({ text }) {
    const [visible, setVisible] = useState(false);
    return (
        <span style={{ position: 'relative', display: 'inline-block', marginLeft: 5 }}>
            <span
                style={{ cursor: 'default', color: '#8a9ab5', fontSize: 12, fontWeight: 700, userSelect: 'none' }}
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
            >ⓘ</span>
            {visible && (
                <span style={{
                    position: 'absolute',
                    left: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    marginLeft: 8,
                    zIndex: 100,
                    background: '#1F3964',
                    color: '#fff',
                    fontSize: 11,
                    lineHeight: 1.5,
                    borderRadius: 6,
                    padding: '7px 10px',
                    width: 280,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
                    pointerEvents: 'none',
                }}>
                    {text}
                </span>
            )}
        </span>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccessMatrix() {
    const { session } = useAuth();
    const activeCompany = session?.companies?.find(c => c.id === session.activeCompanyId);
    const userRole = activeCompany?.role;

    const roleIndex = ROLES.findIndex(r => r.id === userRole);

    return (
        <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>
                Access Matrix
            </h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>
                Action-level permissions for each role, sourced from the system's backend access controls.
                {userRole && (
                    <> Your role (<strong>{userRole}</strong>) is highlighted.</>
                )}
            </p>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}>
                {Object.entries(CELL_CONFIG).map(([type, cfg]) => (
                    <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            padding: '2px 7px', borderRadius: 99,
                            background: cfg.bg, border: `1px solid ${cfg.border}`,
                            color: cfg.color, fontWeight: type === 'none' ? 400 : 600, fontSize: 11,
                        }}>
                            <span style={{ fontSize: type === 'none' ? 13 : 11 }}>{cfg.icon}</span>
                            {type !== 'none' && <span>{cfg.label}</span>}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)' }}>
                            {type === 'full' && '— unrestricted access to this action'}
                            {type === 'dept' && '— limited to own department(s)'}
                            {type === 'own'  && '— limited to own submissions'}
                            {type === 'none' && '— no access'}
                        </span>
                    </span>
                ))}
            </div>

            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #dde3f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        <tr>
                            <th style={{
                                padding: '10px 14px', textAlign: 'left', fontWeight: 600,
                                fontSize: 11, color: '#fff', background: '#1F3964',
                                minWidth: 190, position: 'sticky', top: 0, zIndex: 2,
                            }}>
                                Action
                            </th>
                            {ROLES.map((r, i) => {
                                const isYours = r.id === userRole;
                                return (
                                    <th key={r.id} style={{
                                        padding: '10px 8px', textAlign: 'center', fontWeight: 600,
                                        fontSize: 11, color: '#fff',
                                        background: isYours ? '#2a5298' : '#1F3964',
                                        outline: isYours ? '2px solid #7aa3e8' : 'none',
                                        outlineOffset: -2,
                                        minWidth: 90,
                                        position: 'sticky', top: 0, zIndex: 2,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {r.short}
                                        {isYours && (
                                            <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>
                                                (your role)
                                            </div>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {SECTIONS.map((section) => (
                            <>
                                {/* Section header row */}
                                <tr key={`hdr-${section.title}`}>
                                    <td
                                        colSpan={ROLES.length + 1}
                                        style={{
                                            padding: '8px 14px',
                                            fontWeight: 700,
                                            fontSize: 11,
                                            color: '#1F3964',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em',
                                            background: '#f0f4ff',
                                            borderTop: '2px solid #d0d9ef',
                                        }}
                                    >
                                        {section.title}
                                        {section.note && (
                                            <span style={{
                                                fontWeight: 400, fontSize: 11, color: '#5a6a8a',
                                                textTransform: 'none', letterSpacing: 0, marginLeft: 8,
                                            }}>
                                                — {section.note}
                                            </span>
                                        )}
                                    </td>
                                </tr>

                                {/* Action rows */}
                                {section.rows.map((row) => (
                                    <tr
                                        key={row.action}
                                        style={{ background: '#fff' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = '#f7f9ff'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                                    >
                                        <td style={{
                                            padding: '9px 14px',
                                            borderBottom: '1px solid #eef0f5',
                                            color: 'var(--color-text)',
                                            fontSize: 12,
                                        }}>
                                            {row.action}
                                            {row.note && <InfoTip text={row.note} />}
                                        </td>
                                        {row.cells.map((type, i) => (
                                            <Cell
                                                key={ROLES[i].id}
                                                type={type}
                                                isYourRole={ROLES[i].id === userRole}
                                            />
                                        ))}
                                    </tr>
                                ))}
                            </>
                        ))}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12 }}>
                Permissions reflect backend access controls as of the current version.
                Contact your administrator to request access changes.
            </p>
        </div>
    );
}
