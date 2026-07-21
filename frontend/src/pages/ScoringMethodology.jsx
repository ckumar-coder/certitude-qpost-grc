// ScoringMethodology.jsx — Scoring Methodology page. `canManage` (below)
// is CRO/Consultant CRO ONLY — Admin is deliberately(?) excluded, unlike
// almost every other module. Confirmed still true as of 2026-07-21;
// flagged as a likely-unintentional gap, not documented policy — see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx Finding 5.
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

const DEFAULT_LIKELIHOOD = [
    { score: 5, label: 'Very Likely',  description: 'The event has already happened or happens regularly, or there is significant reason to believe it is virtually imminent.', frequency: 'At least once in 6 months' },
    { score: 4, label: 'Likely',       description: 'The event is more likely to happen than not. There is a notable probability of occurrence based on past frequency or current circumstances.', frequency: 'At least once in 3 years' },
    { score: 3, label: 'Occasional',   description: 'The event has a reasonable likelihood of happening based on current circumstances or historical data. More than a remote possibility.', frequency: 'At least once in 5 years' },
    { score: 2, label: 'Seldom',       description: 'There is a possibility the event could occur at some time, but it is not expected. Likelihood of occurrence is low based on available information.', frequency: 'At least once in 10 years' },
    { score: 1, label: 'Unlikely',     description: 'The event is exceptionally unlikely to happen based on past frequency and current circumstances. Occurrence would be an extreme outlier.', frequency: 'Not expected to occur within 10 years' },
];

const DEFAULT_IMPACT = [
    { score: 5, label: 'Catastrophic', description: 'Existential threat. Regulatory licence at risk, severe financial loss, major litigation, or irreversible reputational damage.' },
    { score: 4, label: 'Major',        description: 'Significant disruption. Regulatory sanction, sustained adverse media, major financial loss, or loss of key clients.' },
    { score: 3, label: 'Moderate',     description: 'Moderate impact. Regulatory inquiry, financial loss, negative media coverage, or significant customer complaints.' },
    { score: 2, label: 'Low / Minor',  description: 'Minor disruption. Limited reputational impact, resolved quickly with additional resources.' },
    { score: 1, label: 'Insignificant', description: 'Negligible impact. No regulatory interest; handled through normal operations.' },
];

const DEFAULT_PILLARS = [
    {
        name: 'Financial',
        definitions: [
            { score: 1, label: 'Insignificant', description: '0–1 (financial loss threshold)' },
            { score: 2, label: 'Low / Minor',   description: '1–5' },
            { score: 3, label: 'Moderate',      description: '5–25' },
            { score: 4, label: 'Major',          description: '25–50' },
            { score: 5, label: 'Catastrophic',   description: '>50' },
        ],
    },
    {
        name: 'Operational',
        definitions: [
            { score: 1, label: 'Insignificant', description: 'Minor disruptions, no real impact on operations; service disruption less than 2 hours.' },
            { score: 2, label: 'Low / Minor',   description: 'Slight disruption to a few processes, minimal impact on overall operations; service disruption 2–4 hours.' },
            { score: 3, label: 'Moderate',      description: 'Noticeable disruption to operations, key services affected; disruption 4 hours–1 day.' },
            { score: 4, label: 'Major',          description: 'Significant disruption, critical services impacted; service disruption up to 3 days.' },
            { score: 5, label: 'Catastrophic',   description: 'Severe disruption, entire services could be halted; service disruption more than 3 days.' },
        ],
    },
    {
        name: 'Strategic',
        definitions: [
            { score: 1, label: 'Insignificant', description: 'Minimal effect on achieving strategic goals; no significant disruption to long-term plans.' },
            { score: 2, label: 'Low / Minor',   description: 'Small, manageable effects on strategic plans; some adjustments needed but no major deviation from core objectives.' },
            { score: 3, label: 'Moderate',      description: 'Noticeable effects on one or more strategic goals, requiring reallocation of resources or re-prioritisation.' },
            { score: 4, label: 'Major',          description: 'Significant disruption to strategic initiatives, potentially requiring substantial changes to plans or strategic direction.' },
            { score: 5, label: 'Catastrophic',   description: 'Critical impact that may render strategic goals unachievable, requiring a complete overhaul of strategy.' },
        ],
    },
    {
        name: 'Reputational',
        definitions: [
            { score: 1, label: 'Insignificant', description: 'Limited local adverse publicity or dissatisfaction within the organisation.' },
            { score: 2, label: 'Low / Minor',   description: 'Adverse publicity at local level with some dissatisfaction amongst service users.' },
            { score: 3, label: 'Moderate',      description: 'Adverse publicity in local media and/or significant dissatisfaction of service users.' },
            { score: 4, label: 'Major',          description: 'Adverse publicity in regional media for a short period, or sustained adverse publicity in local media.' },
            { score: 5, label: 'Catastrophic',   description: 'Substantial adverse media comment at regional level with long-term impact, including potential resignation of key senior staff.' },
        ],
    },
    {
        name: 'Legal & Regulatory',
        definitions: [
            { score: 1, label: 'Insignificant', description: 'Minor compliance issue; no formal action required.' },
            { score: 2, label: 'Low / Minor',   description: 'Formal notice or warning from regulator.' },
            { score: 3, label: 'Moderate',      description: 'Regulatory fine or formal corrective action required.' },
            { score: 4, label: 'Major',          description: 'Major regulatory penalties or legal action; potential investigation.' },
            { score: 5, label: 'Catastrophic',   description: 'Severe legal consequences, regulatory shutdown, or loss of licences.' },
        ],
    },
    {
        name: 'People & Safety',
        definitions: [
            { score: 1, label: 'Insignificant', description: 'Minor injuries; no hospitalisation.' },
            { score: 2, label: 'Low / Minor',   description: 'Injuries requiring hospital treatment.' },
            { score: 3, label: 'Moderate',      description: 'Lost time injury or restricted work injury to one or more people.' },
            { score: 4, label: 'Major',          description: 'Serious injuries or permanent disability; work-related disease.' },
            { score: 5, label: 'Catastrophic',   description: 'Fatalities and/or multiple serious injuries.' },
        ],
    },
];

const PILLAR_ICONS = {
    'Financial':        '💰',
    'Operational':      '⚙️',
    'Strategic':        '🎯',
    'Reputational':     '📢',
    'Legal & Regulatory': '⚖️',
    'People & Safety':  '👥',
};

const BANDS = {
    extreme: { label: 'Extreme', bg: '#C0152A', cell: '#D4182E', light: '#FEE2E2', dark: '#7F1D1D', range: '17–25' },
    high:    { label: 'High',    bg: '#D9500A', cell: '#E8601A', light: '#FFEDD5', dark: '#7C2D12', range: '10–16' },
    medium:  { label: 'Medium',  bg: '#C07D0A', cell: '#D4920C', light: '#FEF9C3', dark: '#713F12', range: '5–9'  },
    low:     { label: 'Low',     bg: '#127A47', cell: '#16924F', light: '#DCFCE7', dark: '#14532D', range: '1–4'  },
};

const SCORE_PALETTE = { 5: '#C0152A', 4: '#D9500A', 3: '#C07D0A', 2: '#127A47', 1: '#166534' };

function scoreBand(s) {
    if (s >= 17) return 'extreme';
    if (s >= 10) return 'high';
    if (s >= 5)  return 'medium';
    return 'low';
}

function ScoreBadge({ score, size = 28 }) {
    const color = SCORE_PALETTE[score] || '#666';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, borderRadius: '50%',
            background: color, color: '#fff',
            fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
        }}>
            {score}
        </span>
    );
}

function CardHeader({ title, subtitle, accent }) {
    return (
        <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--color-border)',
            borderLeft: `4px solid ${accent}`,
            background: 'var(--color-surface)',
            borderRadius: '8px 8px 0 0',
        }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
            {subtitle && <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{subtitle}</p>}
        </div>
    );
}

export default function ScoringMethodology() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const canManage = role === 'CRO' || role === 'Consultant CRO';

    const [likelihoods, setLikelihoods] = useState(DEFAULT_LIKELIHOOD);
    const [impacts,     setImpacts]     = useState(DEFAULT_IMPACT);
    const [pillars,     setPillars]     = useState(DEFAULT_PILLARS);
    const [currency,    setCurrency]    = useState('USD');
    const [editingCurrency, setEditingCurrency] = useState(false);
    const [currencyDraft,   setCurrencyDraft]   = useState('');

    // Accordion: which pillar is expanded
    const [openPillar, setOpenPillar] = useState(null);

    // Single editing state across all section types
    // { type: 'likelihood'|'impact'|'pillar', idx, pillarIdx? }
    const [editing, setEditing] = useState(null);
    const [editVal, setEditVal] = useState({ label: '', description: '', frequency: '' });
    const [saving,  setSaving]  = useState(false);
    const [msg,     setMsg]     = useState('');

    const [categories, setCategories] = useState([]);

    useEffect(() => {
        api.get('/scoring-methodology')
            .then((data) => {
                if (data.likelihood?.length) setLikelihoods(data.likelihood);
                if (data.impact?.length)     setImpacts(data.impact);
                if (data.pillars?.length)    setPillars(data.pillars);
                if (data.currency)           setCurrency(data.currency);
            })
            .catch(() => {});
        api.get('/risk-taxonomy').then((d) => setCategories(Array.isArray(d) ? d : [])).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Parse shorthand: "5M" → "5 million", "1.5B" → "1.5 billion" ─────────
    function parseFinancialShorthand(raw) {
        if (!raw) return raw;
        return raw.replace(/(\d+(?:\.\d+)?)\s*([MmBb])\b/g, (_, num, suffix) => {
            const s = suffix.toUpperCase();
            return `${num} ${s === 'M' ? 'million' : 'billion'}`;
        });
    }

    // ── Persist helper ────────────────────────────────────────────────────────
    async function persist(newLikelihood, newImpact, newPillars, newCurrency) {
        await api.post('/scoring-methodology', {
            likelihood: newLikelihood,
            impact:     newImpact,
            currency:   newCurrency !== undefined ? newCurrency : currency,
            pillars:    newPillars,
        });
    }

    // ── Likelihood / Impact edit ──────────────────────────────────────────────
    function startEdit(type, idx, pillarIdx) {
        let row;
        if (type === 'likelihood') row = likelihoods[idx];
        else if (type === 'impact') row = impacts[idx];
        else row = pillars[pillarIdx].definitions[idx];
        setEditing({ type, idx, pillarIdx });
        setEditVal({ label: row.label, description: row.description, frequency: row.frequency || '' });
    }

    async function saveEdit() {
        setSaving(true);
        try {
            let newLike = likelihoods, newImp = impacts, newPil = pillars;
            const isFinancialPillar = editing.type === 'pillar' &&
                pillars[editing.pillarIdx]?.name === 'Financial';
            // For Finance pillar, expand shorthand like "5M" → "5 million"
            const desc = isFinancialPillar
                ? parseFinancialShorthand(editVal.description)
                : editVal.description;

            if (editing.type === 'likelihood') {
                newLike = likelihoods.map((r, i) =>
                    i === editing.idx ? { ...r, label: editVal.label, description: desc, frequency: editVal.frequency } : r
                );
                setLikelihoods(newLike);
            } else if (editing.type === 'impact') {
                newImp = impacts.map((r, i) =>
                    i === editing.idx ? { ...r, label: editVal.label, description: desc } : r
                );
                setImpacts(newImp);
            } else if (editing.type === 'pillar') {
                newPil = pillars.map((p, pi) =>
                    pi === editing.pillarIdx
                        ? {
                            ...p,
                            definitions: p.definitions.map((d, di) =>
                                di === editing.idx ? { ...d, label: editVal.label, description: desc } : d
                            ),
                        }
                        : p
                );
                setPillars(newPil);
            }

            await persist(newLike, newImp, newPil);
            setMsg('Saved.'); setTimeout(() => setMsg(''), 2000);
        } catch (e) {
            setMsg('Save failed: ' + (e.message || 'error'));
        } finally {
            setSaving(false); setEditing(null);
        }
    }

    async function saveCurrency() {
        setSaving(true);
        try {
            const trimmed = currencyDraft.trim().toUpperCase() || 'USD';
            await persist(likelihoods, impacts, pillars, trimmed);
            setCurrency(trimmed);
            setEditingCurrency(false);
            setMsg('Currency saved.'); setTimeout(() => setMsg(''), 2000);
        } catch (e) {
            setMsg('Save failed: ' + (e.message || 'error'));
        } finally {
            setSaving(false);
        }
    }

    // ── Row renderers ─────────────────────────────────────────────────────────
    function DefRow({ type, row, idx, pillarIdx }) {
        const isEditing = editing?.type === type && editing?.idx === idx &&
            (type !== 'pillar' || editing?.pillarIdx === pillarIdx);
        const color = SCORE_PALETTE[row.score];
        return (
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '12px 16px', width: 52 }}>
                    <ScoreBadge score={row.score} />
                </td>
                <td style={{ padding: '12px 8px', width: 150, fontWeight: 600, fontSize: 14, color }}>
                    {isEditing
                        ? <input className="form-control" value={editVal.label}
                            onChange={(e) => setEditVal((v) => ({ ...v, label: e.target.value }))}
                            style={{ fontWeight: 600 }} />
                        : row.label}
                </td>
                <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    {isEditing
                        ? <>
                            <textarea className="form-control" rows={2} value={editVal.description}
                                onChange={(e) => setEditVal((v) => ({ ...v, description: e.target.value }))}
                                style={{ resize: 'vertical', fontSize: 13 }} />
                            {type === 'pillar' && pillarIdx !== undefined && pillars[pillarIdx]?.name === 'Financial' && (
                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                    Tip: use shorthand like <code>5M</code> or <code>1.5B</code> — it will be expanded to "5 million" / "1.5 billion". Currency: <strong>{currency}</strong>
                                </div>
                            )}
                          </>
                        : row.description}
                </td>
                {type === 'likelihood' && (
                    <td style={{ padding: '12px 8px', width: 200, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        {isEditing
                            ? <input className="form-control" value={editVal.frequency}
                                onChange={(e) => setEditVal((v) => ({ ...v, frequency: e.target.value }))}
                                style={{ fontSize: 12 }} />
                            : row.frequency}
                    </td>
                )}
                {canManage && (
                    <td style={{ padding: '12px 12px', width: 90, textAlign: 'right' }}>
                        {isEditing ? (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={saving}>{t('save')}</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setEditing(null)}>✕</button>
                            </div>
                        ) : (
                            <button className="btn btn-sm btn-secondary"
                                onClick={() => startEdit(type, idx, pillarIdx)}>{t('edit')}</button>
                        )}
                    </td>
                )}
            </tr>
        );
    }

    const impactDesc     = [...impacts].sort((a, b) => b.score - a.score);
    const likelihoodDesc = [...likelihoods].sort((a, b) => b.score - a.score);

    return (
        <div>
            <h1 className="page-title">{t('scoring_title')}</h1>
            <p className="page-subtitle">
                {t('scoring_subtitle')}
                {canManage ? ' Click Edit to customise any definition.' : ' Contact the CRO to request changes.'}
            </p>

            {/* ── Currency setting ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    Financial pillar currency:
                </span>
                {editingCurrency ? (
                    <>
                        <input
                            className="form-control"
                            style={{ width: 90, padding: '4px 8px', fontSize: 13 }}
                            value={currencyDraft}
                            onChange={(e) => setCurrencyDraft(e.target.value.toUpperCase())}
                            placeholder="e.g. QAR"
                            maxLength={10}
                            autoFocus
                        />
                        <button className="btn btn-sm btn-primary" disabled={saving} onClick={saveCurrency}>Save</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditingCurrency(false)}>Cancel</button>
                    </>
                ) : (
                    <>
                        <strong style={{ fontSize: 14 }}>{currency}</strong>
                        {canManage && (
                            <button className="btn btn-sm btn-secondary" onClick={() => { setCurrencyDraft(currency); setEditingCurrency(true); }}>
                                Change
                            </button>
                        )}
                    </>
                )}
            </div>

            {msg && (
                <div className="alert" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', marginBottom: 16 }}>{msg}</div>
            )}

            {/* ── 5×5 Heatmap ─────────────────────────────────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <CardHeader title="5 × 5 Risk Matrix" accent="#C0152A" />
                <div style={{ padding: '16px 20px', overflowX: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <table style={{ borderCollapse: 'separate', borderSpacing: 3, minWidth: 405 }}>
                        <thead>
                            <tr>
                                <th style={{
                                    padding: '8px 10px', fontSize: 9, fontWeight: 600,
                                    color: 'var(--color-text-muted)', textAlign: 'left',
                                    background: 'var(--color-surface)', borderRadius: 6, whiteSpace: 'nowrap',
                                }}>
                                    Likelihood ↓ / Impact →
                                </th>
                                {impactDesc.map((imp) => (
                                    <th key={imp.score} style={{
                                        width: 82, height: 60, padding: 0, textAlign: 'center',
                                        fontSize: 9, fontWeight: 700, color: '#fff',
                                        borderRadius: 6, verticalAlign: 'middle', background: SCORE_PALETTE[imp.score],
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                            <div style={{ fontSize: 12, lineHeight: 1 }}>{imp.score}</div>
                                            <div style={{ fontWeight: 500, marginTop: 2, opacity: 0.9 }}>{imp.label}</div>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {likelihoodDesc.map((lik) => (
                                <tr key={lik.score}>
                                    <td style={{
                                        width: 82, height: 60, padding: 0, fontSize: 9, fontWeight: 700,
                                        color: '#fff', background: SCORE_PALETTE[lik.score],
                                        borderRadius: 6, verticalAlign: 'middle', textAlign: 'center',
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                            <div style={{ fontSize: 11 }}>{lik.score}</div>
                                            <div style={{ fontWeight: 500, opacity: 0.9 }}>{lik.label}</div>
                                        </div>
                                    </td>
                                    {impactDesc.map((imp) => {
                                        const score = lik.score * imp.score;
                                        const band  = scoreBand(score);
                                        const b     = BANDS[band];
                                        return (
                                            <td key={imp.score} style={{
                                                width: 82, height: 60, background: b.cell,
                                                color: '#fff', textAlign: 'center', verticalAlign: 'middle',
                                                borderRadius: 6, padding: 0,
                                            }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                                    <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{score}</div>
                                                    <div style={{ fontSize: 8, fontWeight: 600, opacity: 0.85, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{b.label}</div>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {Object.values(BANDS).map((b) => (
                            <div key={b.label} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: b.light, border: `1px solid ${b.bg}`, borderRadius: 20, padding: '4px 12px',
                            }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: b.bg }} />
                                <span style={{ fontSize: 11, fontWeight: 700, color: b.dark }}>{b.label}</span>
                                <span style={{ fontSize: 11, color: b.dark, opacity: 0.7 }}>{b.range}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Likelihood Definitions ───────────────────────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
                <CardHeader
                    title="Likelihood Definitions"
                    subtitle="How frequently is this risk expected to occur?"
                    accent={SCORE_PALETTE[5]}
                />
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'var(--color-surface)' }}>
                            <th style={{ padding: '10px 16px', width: 52, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Score</th>
                            <th style={{ padding: '10px 8px', width: 150, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Label</th>
                            <th style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Description</th>
                            <th style={{ padding: '10px 8px', width: 200, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Indicative Frequency</th>
                            {canManage && <th style={{ width: 90 }}></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {likelihoodDesc.map((row) => {
                            const idx = likelihoods.findIndex((r) => r.score === row.score);
                            return <DefRow key={row.score} type="likelihood" row={row} idx={idx} />;
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Impact Pillar Definitions (accordion) ───────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
                <CardHeader
                    title="Impact Definitions — by Pillar"
                    subtitle="Each impact pillar has its own 1–5 scale. When entering a risk, score each pillar and select the one that best represents the governing impact."
                    accent={SCORE_PALETTE[4]}
                />
                <div style={{ padding: '12px 0' }}>
                    {pillars.map((pillar, pi) => {
                        const isOpen = openPillar === pi;
                        const icon   = PILLAR_ICONS[pillar.name] || '📋';
                        const defsDesc = [...pillar.definitions].sort((a, b) => b.score - a.score);
                        return (
                            <div key={pillar.name} style={{ borderBottom: pi < pillars.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                                {/* Accordion header */}
                                <button
                                    onClick={() => setOpenPillar(isOpen ? null : pi)}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '14px 24px', background: 'none', border: 'none',
                                        cursor: 'pointer', textAlign: 'left',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                >
                                    <span style={{ fontSize: 20 }}>{icon}</span>
                                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
                                        {pillar.name}
                                        {pillar.name === 'Financial' && (
                                            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>({currency})</span>
                                        )}
                                    </span>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        {defsDesc.map((d) => (
                                            <span key={d.score} style={{
                                                width: 22, height: 22, borderRadius: '50%',
                                                background: SCORE_PALETTE[d.score],
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 11, fontWeight: 700, color: '#fff',
                                            }}>{d.score}</span>
                                        ))}
                                    </div>
                                    <span style={{ fontSize: 18, color: 'var(--color-text-muted)', marginLeft: 8, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
                                </button>

                                {/* Accordion body */}
                                {isOpen && (
                                    <div style={{ background: 'var(--color-surface-subtle, #fafafa)', borderTop: '1px solid var(--color-border)' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--color-surface)' }}>
                                                    <th style={{ padding: '8px 16px', width: 52, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Score</th>
                                                    <th style={{ padding: '8px 8px', width: 150, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Label</th>
                                                    <th style={{ padding: '8px 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>Description</th>
                                                    {canManage && <th style={{ width: 90 }}></th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {defsDesc.map((row) => {
                                                    const defIdx = pillar.definitions.findIndex((d) => d.score === row.score);
                                                    return <DefRow key={row.score} type="pillar" row={row} idx={defIdx} pillarIdx={pi} />;
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Risk Category Taxonomy ───────────────────────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
                <CardHeader
                    title="Risk Category Taxonomy"
                    subtitle="Categories available in the Risk Category dropdown when creating or editing risks."
                    accent="#6366f1"
                />
                <div style={{ padding: '20px 24px' }}>
                    {categories.length === 0 ? (
                        <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 13, margin: 0 }}>
                            {t('go_to_risk_config')}
                        </p>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {categories.map((cat) => (
                                <div key={cat.id} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: '#eff6ff', border: '1px solid #bfdbfe',
                                    borderRadius: 20, padding: '5px 14px',
                                    fontSize: 13, fontWeight: 500, color: '#1e40af',
                                }}>
                                    {cat.name}
                                </div>
                            ))}
                        </div>
                    )}
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12, marginBottom: 0 }}>
                        To add or remove categories, go to Admin → Risk Configuration.
                    </p>
                </div>
            </div>
        </div>
    );
}
