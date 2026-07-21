// RiskAppetite.jsx — Risk Appetite page (category-level statements).
// `canEdit` (below) is Admin/CRO/Consultant CRO. Note the backend's view
// role list also includes a role literally named 'Approver' that isn't
// in the assignable roles list (UserManagement.jsx) — see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx Finding 4 and
// section 3.6.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

// ── Colour palette ────────────────────────────────────────────────────────────
const CELL_COLOR = { extreme: '#D4182E', high: '#E8601A', medium: '#D4920C', low: '#16924F' };
const SCORE_COL  = { 5: '#C0152A', 4: '#D9500A', 3: '#C07D0A', 2: '#127A47', 1: '#166534' };

const IMPACT_LABELS = ['', 'Insignificant', 'Low / Minor', 'Moderate', 'Major', 'Catastrophic'];
const PILLAR_ICONS  = {
    'Financial': '💰', 'Operational': '⚙️', 'Strategic': '🎯',
    'Reputational': '📢', 'Legal & Regulatory': '⚖️', 'People & Safety': '👥',
};
const DEFAULT_PILLARS = [
    { name: 'Financial',          definitions: [
        { score: 1, description: '0–1 (financial loss threshold)' }, { score: 2, description: '1–5' },
        { score: 3, description: '5–25' }, { score: 4, description: '25–50' }, { score: 5, description: '>50' },
    ]},
    { name: 'Operational',        definitions: [
        { score: 1, description: 'Minor disruptions; service disruption less than 2 hours.' },
        { score: 2, description: 'Slight disruption to a few processes; service disruption 2–4 hours.' },
        { score: 3, description: 'Noticeable disruption; key services affected; disruption 4 hours–1 day.' },
        { score: 4, description: 'Significant disruption; critical services impacted; up to 3 days.' },
        { score: 5, description: 'Severe disruption; entire services halted; more than 3 days.' },
    ]},
    { name: 'Strategic',          definitions: [
        { score: 1, description: 'Minimal effect on strategic goals; no disruption to long-term plans.' },
        { score: 2, description: 'Small manageable effects; some adjustments needed but no major deviation.' },
        { score: 3, description: 'Noticeable effects on strategic goals; reallocation of resources required.' },
        { score: 4, description: 'Significant disruption to strategic initiatives; substantial changes required.' },
        { score: 5, description: 'Critical impact; strategic goals unachievable; complete overhaul required.' },
    ]},
    { name: 'Reputational',       definitions: [
        { score: 1, description: 'Limited local adverse publicity within the organisation.' },
        { score: 2, description: 'Adverse publicity at local level; some dissatisfaction amongst service users.' },
        { score: 3, description: 'Adverse publicity in local media; significant dissatisfaction of service users.' },
        { score: 4, description: 'Adverse publicity in regional media; or sustained adverse local media coverage.' },
        { score: 5, description: 'Substantial adverse media at regional level; potential resignation of key staff.' },
    ]},
    { name: 'Legal & Regulatory', definitions: [
        { score: 1, description: 'Minor compliance issue; no formal action required.' },
        { score: 2, description: 'Formal notice or warning from regulator.' },
        { score: 3, description: 'Regulatory fine or formal corrective action required.' },
        { score: 4, description: 'Major regulatory penalties or legal action; potential investigation.' },
        { score: 5, description: 'Severe legal consequences; regulatory shutdown or loss of licences.' },
    ]},
    { name: 'People & Safety',    definitions: [
        { score: 1, description: 'Minor injuries; no hospitalisation.' },
        { score: 2, description: 'Injuries requiring hospital treatment.' },
        { score: 3, description: 'Lost time injury or restricted work injury to one or more people.' },
        { score: 4, description: 'Serious injuries or permanent disability; work-related disease.' },
        { score: 5, description: 'Fatalities and/or multiple serious injuries.' },
    ]},
];

// ── Impact Scale modal ────────────────────────────────────────────────────────
function ImpactInfoModal({ pillars, onClose }) {
    if (!pillars || pillars.length === 0) return null;
    const scores = [5, 4, 3, 2, 1];
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 10, width: '92vw', maxWidth: 1140, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                <div style={{ padding: '14px 20px', background: '#1e3a5f', color: '#fff', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Impact Scale — Definitions by Pillar</span>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
                </div>
                <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={{ padding: '10px 12px', textAlign: 'center', width: 44, borderBottom: '2px solid #e2e8f0', fontWeight: 700 }}>#</th>
                                <th style={{ padding: '10px 12px', width: 100, borderBottom: '2px solid #e2e8f0', fontWeight: 700 }}>Level</th>
                                {pillars.map((p) => (
                                    <th key={p.name} style={{ padding: '10px 12px', borderBottom: '2px solid #e2e8f0', borderLeft: '1px solid #e2e8f0', fontWeight: 700, textAlign: 'left', minWidth: 150 }}>
                                        {PILLAR_ICONS[p.name] || '📋'} {p.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {scores.map((score) => (
                                <tr key={score} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'top' }}>
                                        <span style={{ display: 'inline-flex', width: 24, height: 24, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', background: SCORE_COL[score], color: '#fff', fontWeight: 700, fontSize: 12 }}>{score}</span>
                                    </td>
                                    <td style={{ padding: '10px 12px', fontWeight: 700, color: SCORE_COL[score], verticalAlign: 'top', whiteSpace: 'nowrap' }}>{IMPACT_LABELS[score]}</td>
                                    {pillars.map((p) => {
                                        const def = (p.definitions || []).find((d) => d.score === score);
                                        return (
                                            <td key={p.name} style={{ padding: '10px 12px', color: '#374151', lineHeight: 1.4, borderLeft: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                                                {def?.description || '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}

function getBand(score) {
    if (score >= 17) return 'extreme';
    if (score >= 10) return 'high';
    if (score >= 5)  return 'medium';
    return 'low';
}

const APPETITE_BADGE = {
    'Zero Tolerance': { bg: '#1e1e2e', color: '#fff' },
    'Low':            { bg: '#16924F', color: '#fff' },
    'Moderate':       { bg: '#D4920C', color: '#fff' },
    'High':           { bg: '#D4182E', color: '#fff' },
};

const APPETITE_LEVELS    = ['Zero Tolerance', 'Low', 'Moderate', 'High'];
const APPROVER_ROLES     = ['Board of Directors', 'CEO', 'CFO', 'CRO', 'Other'];

// Auto-default breach urgency from appetite level
function defaultSeverity(appetiteLevel) {
    return ['Zero Tolerance', 'Low'].includes(appetiteLevel) ? 'Critical' : 'High';
}

// Pre-fill templates for breach action statement
const BREACH_TEMPLATES = {
    Critical: 'Immediately notify the CRO and Board. Suspend or restrict the risk activity if possible. Prepare a written remediation plan within 48 hours and present to the Risk Committee within 5 business days.',
    High: 'Notify the relevant Risk Manager and CRO within 24 hours. Develop a remediation plan within 5 business days and schedule a follow-up review within 30 days.',
};

function AppetiteBadge({ level }) {
    const style = APPETITE_BADGE[level] || { bg: '#64748b', color: '#fff' };
    return (
        <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 12,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
            background: style.bg, color: style.color,
        }}>{level}</span>
    );
}

function ScoreBar({ value, max = 25 }) {
    if (value == null) return <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Qualitative only</span>;
    const band = getBand(value);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--color-border)' }}>
                <div style={{ height: '100%', borderRadius: 4, width: `${(value / max) * 100}%`, background: CELL_COLOR[band] }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: CELL_COLOR[band], minWidth: 28 }}>{value}</span>
        </div>
    );
}

function AppetiteHeatmap({ cells, maxScore }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: 4 }}>
            <div />
            {[1, 2, 3, 4, 5].map((l) => (
                <div key={l} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', padding: '2px 0' }}>L{l}</div>
            ))}
            {[5, 4, 3, 2, 1].map((impact) => (
                <>
                    <div key={`lbl-${impact}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 54, borderRadius: 6, background: SCORE_COL[impact], color: '#fff', fontSize: 13, fontWeight: 700 }}>I{impact}</div>
                    {[1, 2, 3, 4, 5].map((l) => {
                        const score  = l * impact;
                        const band   = getBand(score);
                        const within = maxScore != null && score <= maxScore;
                        const atBoundary = maxScore != null && score === maxScore;
                        const cell   = cells?.find((c) => c.likelihood === l && c.impact === impact);
                        const count  = cell?.count || 0;
                        return (
                            <div key={`${l}-${impact}`} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                height: 54, borderRadius: 6, background: CELL_COLOR[band], color: '#fff', fontSize: 18, fontWeight: 800,
                                opacity: maxScore != null ? (within ? 1 : 0.35) : 1,
                                outline: atBoundary ? '3px dashed #3b82f6' : within ? '2px solid rgba(59,130,246,0.4)' : 'none',
                                outlineOffset: atBoundary ? '-3px' : '-2px', position: 'relative',
                            }}>
                                {count > 0 ? count : ''}
                            </div>
                        );
                    })}
                </>
            ))}
        </div>
    );
}

// ── Statement card — inline version history (Admin/CRO only) ──────────────────
function StatementCard({ stmt, onEdit, canEdit, canViewHistory, api }) {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [history, setHistory]         = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    async function toggleHistory() {
        if (!historyOpen && history.length === 0) {
            setHistoryLoading(true);
            try {
                const data = await api.get(`/risk-appetite/${encodeURIComponent(stmt.risk_category)}/history`);
                setHistory(Array.isArray(data) ? data : []);
            } catch { setHistory([]); }
            finally { setHistoryLoading(false); }
        }
        setHistoryOpen((o) => !o);
    }

    // Build "approved by" display string
    const approvedByStr = stmt.approved_by_role
        ? [stmt.approved_by_role, stmt.approved_by_name].filter(Boolean).join(' — ')
        : stmt.approved_by || null;
    const approvalDateStr = stmt.approval_date
        ? new Date(stmt.approval_date).toLocaleDateString()
        : stmt.approved_at ? new Date(stmt.approved_at).toLocaleDateString() : null;

    return (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
            {/* Breach banner */}
            {stmt.breach_count > 0 && (
                <div style={{ background: '#FEE2E2', borderBottom: '1px solid #FCA5A5', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>
                        {stmt.breach_count} risk{stmt.breach_count !== 1 ? 's' : ''} exceeding appetite in this category
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(stmt.breaching_risks || []).map((r) => (
                            <span key={r.risk_uid} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: '#DC2626', color: '#fff', fontWeight: 700 }}>
                                {r.risk_uid} · Score {r.residual_score}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ padding: '20px 24px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{stmt.risk_category}</h3>
                            <AppetiteBadge level={stmt.appetite_level} />
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>v{stmt.version}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            {approvedByStr && <>Approved by {approvedByStr}</>}
                            {approvalDateStr && <> · {approvalDateStr}</>}
                            {stmt.next_review_date && <> · Review due {new Date(stmt.next_review_date).toLocaleDateString()}</>}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {canEdit && (
                            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onEdit(stmt)}>✎ Edit</button>
                        )}
                        {canViewHistory && (
                            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={toggleHistory}>
                                {historyOpen ? '▲ Hide History' : '▼ History'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Qualitative statement */}
                <div style={{ borderLeft: '4px solid var(--color-primary)', paddingLeft: 16, marginBottom: 16, color: 'var(--color-text)', fontSize: 14, lineHeight: 1.6, fontStyle: 'italic' }}>
                    "{stmt.qualitative_statement}"
                </div>

                {/* Quantitative row */}
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 200, flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>MAX RESIDUAL SCORE (OUT OF 25)</div>
                        <ScoreBar value={stmt.max_residual_score} />
                        {stmt.tolerance_band_min != null && stmt.tolerance_band_max != null && (
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                Tolerance band: {stmt.tolerance_band_min}–{stmt.tolerance_band_max}
                            </div>
                        )}
                    </div>
                    {stmt.required_breach_action && (
                        <div style={{ flex: 2, minWidth: 200 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>BREACH ACTION REQUIRED</div>
                            <span style={{ fontSize: 13 }}>{stmt.required_breach_action}</span>
                        </div>
                    )}
                    {stmt.breach_notification_severity && (
                        <div style={{ minWidth: 140 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>BREACH URGENCY</div>
                            <span style={{
                                display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700,
                                background: stmt.breach_notification_severity === 'Critical' ? '#C0152A' : '#b45309', color: '#fff',
                            }}>
                                {stmt.breach_notification_severity === 'Critical' ? '🔴 Critical — immediate action required' : '🟠 High — action within 24 hours'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Notes */}
                {stmt.notes && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--color-bg)', borderRadius: 6, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        📝 {stmt.notes}
                    </div>
                )}

                {/* Inline version history panel (Admin/CRO only) */}
                {historyOpen && (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Version History
                        </div>
                        {historyLoading ? (
                            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</div>
                        ) : history.length === 0 ? (
                            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No history found.</div>
                        ) : history.map((h) => (
                            <div key={h.id} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 12, marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>v{h.version}</span>
                                    <AppetiteBadge level={h.appetite_level} />
                                    {h.is_current && <span style={{ fontSize: 11, color: '#16924F', fontWeight: 700 }}>CURRENT</span>}
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                                        {h.approved_by_role
                                            ? `${h.approved_by_role}${h.approved_by_name ? ' — ' + h.approved_by_name : ''} · `
                                            : h.approved_by ? `${h.approved_by} · ` : ''}
                                        {h.approval_date
                                            ? new Date(h.approval_date).toLocaleDateString()
                                            : h.approved_at ? new Date(h.approved_at).toLocaleDateString()
                                            : new Date(h.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                                <p style={{ margin: '0 0 4px', fontSize: 12, fontStyle: 'italic', color: 'var(--color-text)' }}>
                                    "{h.qualitative_statement}"
                                </p>
                                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                    Max score: {h.max_residual_score ?? 'Qualitative only'}
                                    {h.notes && <> · Notes: {h.notes}</>}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Add / Edit form ───────────────────────────────────────────────────────────
function AppetiteForm({ categories, initial, onSaved, onCancel, api }) {
    const [form, setForm] = useState(() => {
        if (initial) {
            return {
                risk_category:                initial.risk_category,
                appetite_level:               initial.appetite_level,
                qualitative_statement:        initial.qualitative_statement,
                max_residual_score:           initial.max_residual_score != null ? String(initial.max_residual_score) : '',
                tolerance_band_min:           initial.tolerance_band_min != null ? String(initial.tolerance_band_min) : '',
                tolerance_band_max:           initial.tolerance_band_max != null ? String(initial.tolerance_band_max) : '',
                required_breach_action:       initial.required_breach_action || '',
                breach_notification_severity: initial.breach_notification_severity || defaultSeverity(initial.appetite_level),
                notes:                        initial.notes || '',
                approved_by_role:             initial.approved_by_role || '',
                approved_by_name:             initial.approved_by_name || '',
                approval_date:                initial.approval_date ? String(initial.approval_date).split('T')[0] : '',
                effective_date:               initial.effective_date ? String(initial.effective_date).split('T')[0] : '',
                next_review_date:             initial.next_review_date ? String(initial.next_review_date).split('T')[0] : '',
            };
        }
        return {
            risk_category:                categories[0]?.name || '',
            appetite_level:               'Moderate',
            qualitative_statement:        '',
            max_residual_score:           '',
            tolerance_band_min:           '',
            tolerance_band_max:           '',
            required_breach_action:       '',
            breach_notification_severity: 'High', // default for 'Moderate'
            notes:                        '',
            approved_by_role:             '',
            approved_by_name:             '',
            approval_date:                '',
            effective_date:               '',
            next_review_date:             '',
        };
    });

    const [submitting, setSubmitting]     = useState(false);
    const [error, setError]               = useState('');
    const [pillars, setPillars]           = useState(DEFAULT_PILLARS);
    const [showImpactModal, setShowImpactModal] = useState(false);

    useEffect(() => {
        api.get('/scoring-methodology')
            .then((data) => { if (data.pillars?.length) setPillars(data.pillars); })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const update = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

    // Auto-default breach_urgency when appetite_level changes
    function handleAppetiteLevelChange(level) {
        setForm((f) => ({
            ...f,
            appetite_level: level,
            breach_notification_severity: defaultSeverity(level),
        }));
    }

    // Pre-fill breach action when urgency changes and field is empty or was previously a template
    function handleUrgencyChange(sev) {
        setForm((f) => {
            const currentAction = f.required_breach_action.trim();
            const wasTemplate   = currentAction === '' || currentAction === BREACH_TEMPLATES.Critical || currentAction === BREACH_TEMPLATES.High;
            return {
                ...f,
                breach_notification_severity: sev,
                required_breach_action: wasTemplate ? (BREACH_TEMPLATES[sev] || '') : f.required_breach_action,
            };
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            const payload = {
                risk_category:                form.risk_category,
                appetite_level:               form.appetite_level,
                qualitative_statement:        form.qualitative_statement,
                max_residual_score:           form.max_residual_score !== '' ? parseInt(form.max_residual_score, 10) : null,
                tolerance_band_min:           form.tolerance_band_min !== '' ? parseInt(form.tolerance_band_min, 10) : null,
                tolerance_band_max:           form.tolerance_band_max !== '' ? parseInt(form.tolerance_band_max, 10) : null,
                required_breach_action:       form.required_breach_action || null,
                breach_notification_severity: form.breach_notification_severity || null,
                notes:                        form.notes || null,
                approved_by_role:             form.approved_by_role || null,
                approved_by_name:             form.approved_by_name || null,
                approval_date:                form.approval_date || null,
                effective_date:               form.effective_date || null,
                next_review_date:             form.next_review_date || null,
            };
            const result = await api.post('/risk-appetite', payload);
            onSaved(result);
        } catch (err) {
            setError(err.message || 'Failed to save appetite statement');
        } finally {
            setSubmitting(false);
        }
    }

    const stmtLen      = form.qualitative_statement.length;
    const previewScore = form.max_residual_score !== '' ? parseInt(form.max_residual_score, 10) : null;
    const previewBand  = previewScore != null && !isNaN(previewScore) && previewScore >= 1 && previewScore <= 25 ? getBand(previewScore) : null;

    return (
        <form className="card" onSubmit={handleSubmit} style={{ padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>{initial ? `Edit Appetite Statement — ${initial.risk_category}` : 'New Appetite Statement'}</h3>
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Row 1: Category / Level */}
            <div className="form-row">
                <div className="form-group">
                    <label>Risk Category *</label>
                    <select className="form-control" value={form.risk_category} onChange={(e) => update('risk_category', e.target.value)} disabled={!!initial} required>
                        <option value="">— Select category —</option>
                        {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Appetite Level *</label>
                    <select className="form-control" value={form.appetite_level} onChange={(e) => handleAppetiteLevelChange(e.target.value)} required>
                        {APPETITE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>
            </div>

            {/* Qualitative statement with character counter */}
            <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <label style={{ margin: 0 }}>
                        Qualitative Statement * <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>(min 20 characters)</span>
                    </label>
                    <span style={{ fontSize: 11, color: stmtLen < 20 ? '#DC2626' : 'var(--color-text-muted)' }}>
                        {stmtLen} chars
                    </span>
                </div>
                <textarea
                    className="form-control" rows={4}
                    value={form.qualitative_statement}
                    onChange={(e) => update('qualitative_statement', e.target.value)}
                    placeholder="e.g. We have zero tolerance for regulatory compliance risk. Any breach must be escalated immediately to the CRO and remediated within 30 days."
                    required minLength={20}
                />
            </div>

            {/* Max residual score (optional) + tolerance band */}
            <div className="form-row">
                <div className="form-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <label style={{ margin: 0 }}>Max Residual Score (1–25)</label>
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>optional</span>
                        <button type="button" title="View impact scale definitions" onClick={() => setShowImpactModal(true)}
                            style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#b45309', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}>ⓘ</button>
                    </div>
                    {/* Number input + range slider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input className="form-control" type="number" min={1} max={25} value={form.max_residual_score}
                            onChange={(e) => update('max_residual_score', e.target.value)}
                            style={{ width: 80, flexShrink: 0 }} placeholder="—" />
                        <input type="range" min={1} max={25} step={1}
                            value={form.max_residual_score !== '' ? form.max_residual_score : 12}
                            onChange={(e) => update('max_residual_score', e.target.value)}
                            style={{ flex: 1 }} />
                    </div>
                    {previewBand && (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                            <span style={{ padding: '1px 8px', borderRadius: 4, background: CELL_COLOR[previewBand], color: '#fff', fontWeight: 700 }}>
                                {previewBand.toUpperCase()} zone
                            </span>
                        </div>
                    )}
                </div>
                <div className="form-group">
                    <label>Tolerance Band Min</label>
                    <input className="form-control" type="number" min={1} max={25} value={form.tolerance_band_min}
                        onChange={(e) => update('tolerance_band_min', e.target.value)} placeholder="e.g. 1" />
                </div>
                <div className="form-group">
                    <label>Tolerance Band Max</label>
                    <input className="form-control" type="number" min={1} max={25} value={form.tolerance_band_max}
                        onChange={(e) => update('tolerance_band_max', e.target.value)} placeholder="e.g. 12" />
                </div>
            </div>

            {/* Breach action + urgency */}
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Breach Action Required <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted)' }}>(min 20 chars if set)</span></label>
                    <textarea className="form-control" rows={3}
                        value={form.required_breach_action}
                        onChange={(e) => update('required_breach_action', e.target.value)}
                        placeholder="Describe required actions when this appetite is breached…" />
                </div>
                <div className="form-group">
                    <label>Breach Urgency *</label>
                    <select className="form-control" value={form.breach_notification_severity}
                        onChange={(e) => handleUrgencyChange(e.target.value)} required>
                        <option value="Critical">🔴 Critical — immediate action required</option>
                        <option value="High">🟠 High — action within 24 hours</option>
                    </select>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        Auto-set from appetite level. Appears in My Tasks for CRO, risk owner &amp; Risk Manager on breach.
                    </div>
                </div>
            </div>

            {/* Governance / approval row */}
            <div className="form-row">
                <div className="form-group">
                    <label>Approved By (Role) *</label>
                    <select className="form-control" value={form.approved_by_role}
                        onChange={(e) => update('approved_by_role', e.target.value)}>
                        <option value="">— Select —</option>
                        {APPROVER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Approver Name <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>optional</span></label>
                    <input className="form-control" value={form.approved_by_name}
                        onChange={(e) => update('approved_by_name', e.target.value)}
                        placeholder="e.g. Jane Smith" />
                </div>
                <div className="form-group">
                    <label>Approval Date</label>
                    <input className="form-control" type="date" value={form.approval_date}
                        max={new Date().toISOString().split('T')[0]}
                        onChange={(e) => update('approval_date', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Effective Date</label>
                    <input className="form-control" type="date" value={form.effective_date}
                        onChange={(e) => update('effective_date', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Next Review Date</label>
                    <input className="form-control" type="date" value={form.next_review_date}
                        onChange={(e) => update('next_review_date', e.target.value)} />
                </div>
            </div>

            {/* Notes (version note) */}
            <div className="form-group">
                <label>Notes on this version <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-muted)' }}>optional — shown in version history</span></label>
                <input className="form-control" value={form.notes}
                    onChange={(e) => update('notes', e.target.value)}
                    placeholder="e.g. Annual review — appetite ceiling raised from 9 to 12 following board approval" />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                    {submitting ? 'Saving…' : initial ? 'Save Changes' : 'Create Statement'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
            </div>

            {showImpactModal && <ImpactInfoModal pillars={pillars} onClose={() => setShowImpactModal(false)} />}
        </form>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RiskAppetite() {
    const { session, api } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const canEdit       = ['Admin', 'CRO', 'Consultant CRO'].includes(role);
    const canViewHistory = ['Admin', 'CRO', 'Consultant CRO'].includes(role);

    const [tab, setTab]             = useState('statements');
    const [statements, setStatements] = useState([]);
    const [categories, setCategories] = useState([]);
    const [heatmapCells, setHeatmapCells] = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [editingStmt, setEditingStmt] = useState(null);
    const [showForm, setShowForm]   = useState(false);
    const [overlayCategory, setOverlayCategory] = useState('');

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [stmtData, taxData, heatmapData] = await Promise.all([
                api.get('/risk-appetite'),
                api.get('/risk-taxonomy'),
                api.get('/dashboard/management-summary').catch(() => null),
            ]);
            setStatements(Array.isArray(stmtData) ? stmtData : []);
            setCategories(Array.isArray(taxData) ? taxData : []);
            if (heatmapData?.risk_heatmap) setHeatmapCells(heatmapData.risk_heatmap);
        } catch (e) {
            setError(e.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    function handleEdit(stmt) { setEditingStmt(stmt); setShowForm(true); setTab('form'); }
    function handleAdd()      { setEditingStmt(null);  setShowForm(true); setTab('form'); }

    async function handleSaved() {
        setShowForm(false); setEditingStmt(null); setTab('statements');
        await load();
    }

    const LEVEL_SORT = { 'Zero Tolerance': 0, 'Low': 1, 'Moderate': 2, 'High': 3 };
    const sortedStatements = [...statements].sort((a, b) => {
        if (b.breach_count !== a.breach_count) return b.breach_count - a.breach_count;
        return (LEVEL_SORT[a.appetite_level] ?? 99) - (LEVEL_SORT[b.appetite_level] ?? 99);
    });

    const totalBreaches = statements.reduce((s, x) => s + (x.breach_count || 0), 0);
    const overlayStmt   = statements.find((s) => s.risk_category === overlayCategory);
    const overlayMaxScore = overlayStmt?.max_residual_score ?? null;

    if (loading) return <div><h2 className="page-title">Risk Appetite</h2><div className="card">Loading…</div></div>;

    return (
        <div>
            {/* Page header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: '0 0 4px' }}>Risk Appetite</h2>
                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
                        Board-approved appetite statements by risk category — defines boundaries for the entire risk portfolio.
                    </p>
                </div>
                {canEdit && tab !== 'form' && (
                    <button className="btn btn-primary" onClick={handleAdd}>+ New Statement</button>
                )}
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Summary strip */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <div className="card" style={{ flex: 1, padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>{statements.length}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Categories Defined</div>
                </div>
                <div className="card" style={{ flex: 1, padding: '16px 20px', textAlign: 'center', background: totalBreaches > 0 ? '#FEE2E2' : undefined }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: totalBreaches > 0 ? '#DC2626' : '#16924F' }}>{totalBreaches}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: totalBreaches > 0 ? '#991B1B' : 'var(--color-text-muted)', textTransform: 'uppercase' }}>Appetite Breaches</div>
                </div>
                <div className="card" style={{ flex: 1, padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>{Math.max(0, categories.length - statements.length)}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Categories Without Statement</div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)', marginBottom: 20 }}>
                {[
                    { key: 'statements', label: 'Appetite Statements' },
                    { key: 'heatmap',    label: 'Heatmap Overlay' },
                    ...(canEdit ? [{ key: 'form', label: showForm ? (editingStmt ? `Edit — ${editingStmt.risk_category}` : 'New Statement') : 'Add / Edit' }] : []),
                ].map((tb) => (
                    <button key={tb.key}
                        onClick={() => { setTab(tb.key); if (tb.key !== 'form') setShowForm(false); }}
                        style={{
                            padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
                            fontWeight: tab === tb.key ? 700 : 400,
                            borderBottom: tab === tb.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                            marginBottom: -2, color: tab === tb.key ? 'var(--color-primary)' : 'var(--color-text)', fontSize: 14,
                        }}
                    >{tb.label}</button>
                ))}
            </div>

            {/* Statements tab */}
            {tab === 'statements' && (
                <div>
                    {sortedStatements.length === 0 ? (
                        <div className="card" style={{ padding: '48px 32px', textAlign: 'center', maxWidth: 580, margin: '0 auto' }}>
                            <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
                            <h3 style={{ margin: '0 0 8px' }}>No appetite statements defined yet</h3>
                            <p style={{ color: 'var(--color-text-muted)', margin: '0 0 20px' }}>
                                Define board-approved appetite boundaries for each risk category to enable portfolio-level governance.
                            </p>
                            {canEdit && <button className="btn btn-primary" onClick={handleAdd}>+ Create First Statement</button>}
                        </div>
                    ) : sortedStatements.map((stmt) => (
                        <StatementCard
                            key={stmt.id}
                            stmt={stmt}
                            canEdit={canEdit}
                            canViewHistory={canViewHistory}
                            onEdit={handleEdit}
                            api={api}
                        />
                    ))}
                </div>
            )}

            {/* Heatmap Overlay tab */}
            {tab === 'heatmap' && (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div className="card" style={{ flex: '0 0 auto', padding: 24 }}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-muted)' }}>
                                SHOW APPETITE BOUNDARY FOR
                            </label>
                            <select className="form-control" value={overlayCategory} onChange={(e) => setOverlayCategory(e.target.value)} style={{ width: 260 }}>
                                <option value="">— No overlay —</option>
                                {statements.filter((s) => s.max_residual_score != null).map((s) => (
                                    <option key={s.risk_category} value={s.risk_category}>
                                        {s.risk_category} (max {s.max_residual_score})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <AppetiteHeatmap cells={heatmapCells} maxScore={overlayMaxScore} />
                        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 16 }}>
                            <span>■ <span style={{ color: 'var(--color-text)' }}>Solid — within appetite</span></span>
                            <span style={{ opacity: 0.45 }}>■ <span style={{ color: 'var(--color-text)', opacity: 1 }}>Faded — exceeds appetite</span></span>
                            {overlayCategory && <span style={{ color: '#3b82f6', fontWeight: 700 }}>- - - Boundary</span>}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                        <h4 style={{ margin: '0 0 12px' }}>Category Appetite Summary</h4>
                        {statements.length === 0 ? (
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No statements defined.</p>
                        ) : statements.map((s) => (
                            <div key={s.risk_category} className="card"
                                style={{ padding: '12px 16px', marginBottom: 8, cursor: s.max_residual_score != null ? 'pointer' : 'default', outline: overlayCategory === s.risk_category ? '2px solid var(--color-primary)' : 'none' }}
                                onClick={() => s.max_residual_score != null && setOverlayCategory(overlayCategory === s.risk_category ? '' : s.risk_category)}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.risk_category}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                            {s.max_residual_score != null ? `Max score: ${s.max_residual_score}` : 'Qualitative only'}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <AppetiteBadge level={s.appetite_level} />
                                        {s.breach_count > 0 && (
                                            <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: '#DC2626', color: '#fff', fontWeight: 700 }}>
                                                {s.breach_count} breach{s.breach_count !== 1 ? 'es' : ''}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Add / Edit form tab */}
            {tab === 'form' && canEdit && (
                <AppetiteForm
                    categories={categories}
                    initial={editingStmt}
                    api={api}
                    onSaved={handleSaved}
                    onCancel={() => { setTab('statements'); setShowForm(false); setEditingStmt(null); }}
                />
            )}
        </div>
    );
}
