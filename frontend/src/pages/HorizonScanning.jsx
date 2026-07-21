// HorizonScanning.jsx — Horizon Scanning page. `canEdit` (below) covers
// create/edit/convert (Admin, CRO, Consultant CRO, Risk Manager); delete
// and the AI-draft action are narrower still (Admin, CRO, Consultant CRO
// only — Risk Manager excluded from just those two, per
// docs/API_REFERENCE.md "Horizon Scanning"). See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

const CATEGORIES  = ['Regulatory', 'Geopolitical', 'Technology', 'Economic', 'Environmental', 'Social'];
const HORIZONS    = ['Near-term (<1yr)', 'Medium-term (1-3yr)', 'Long-term (3yr+)'];
const IMPACTS     = ['Low', 'Medium', 'High', 'Critical'];
const LIKELIHOODS = ['Unlikely', 'Possible', 'Likely'];

const CAT_COLORS = {
    Regulatory:    { bg: '#1B3A6B', text: '#fff' },
    Geopolitical:  { bg: '#7f1d1d', text: '#fff' },
    Technology:    { bg: '#1d4ed8', text: '#fff' },
    Economic:      { bg: '#166534', text: '#fff' },
    Environmental: { bg: '#0f766e', text: '#fff' },
    Social:        { bg: '#7e22ce', text: '#fff' },
};

const IMPACT_CLASS = { Critical: 'badge-extreme', High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
const STATUS_STYLE = {
    Draft:      { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
    Monitoring: { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' },
    Escalated:  { background: '#fefce8', color: '#b45309', border: '1px solid #fef08a' },
    Converted:  { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
    Dismissed:  { background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' },
};

function CatBadge({ category }) {
    const c = CAT_COLORS[category] || { bg: '#64748b', text: '#fff' };
    return (
        <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 4,
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {category}
        </span>
    );
}

function StatusBadge({ status }) {
    const s = STATUS_STYLE[status] || STATUS_STYLE.Monitoring;
    return (
        <span style={{ ...s, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
            {status}
        </span>
    );
}

function SignalCard({ signal, onView, onEdit, onConvert, onPublish, onDismiss, userRole }) {
    const canEdit    = ['Admin', 'CRO', 'Consultant CRO', 'Risk Manager'].includes(userRole);
    const canConvert = ['Admin', 'CRO', 'Consultant CRO', 'Risk Manager'].includes(userRole);
    const isDraft    = signal.status === 'Draft';
    const isDismissed = signal.status === 'Dismissed';

    return (
        <div className="card" style={{ borderLeft: signal.status === 'Escalated' ? '3px solid #d97706' : undefined, opacity: isDismissed ? 0.6 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <CatBadge category={signal.category} />
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace', fontWeight: 600 }}>
                    {signal.scan_uid}
                </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8, lineHeight: 1.35 }}>
                {signal.title}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className={`badge ${IMPACT_CLASS[signal.potential_impact] || 'badge-medium'}`}>{signal.potential_impact} impact</span>
                <span className="badge badge-role" style={{ fontSize: 10 }}>{signal.time_horizon}</span>
                <StatusBadge status={signal.status} />
                {signal.added_by === 'ai-assistant' && (
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, border: '1px solid #bfdbfe' }}>AI Draft</span>
                )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {signal.owner && signal.owner !== 'ai-assistant' && <span>{signal.owner}</span>}
                {signal.department && <span>{signal.department}</span>}
                <span>Updated {new Date(signal.updated_at).toLocaleDateString()}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, paddingTop: 10, borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => onView(signal)}>View</button>
                {canEdit && !isDismissed && !isDraft && (
                    <button className="btn btn-sm btn-secondary" onClick={() => onEdit(signal)}>Edit</button>
                )}
                {isDraft && canEdit && (
                    <button className="btn btn-sm btn-secondary" style={{ background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}
                        onClick={() => onPublish(signal)}>Publish</button>
                )}
                {canConvert && ['Monitoring', 'Escalated'].includes(signal.status) && (
                    <button className="btn btn-sm btn-secondary" style={{ background: '#fefce8', color: '#854d0e', borderColor: '#fef08a' }}
                        onClick={() => onConvert(signal)}>Convert to risk</button>
                )}
                {canEdit && ['Monitoring', 'Escalated', 'Draft'].includes(signal.status) && (
                    <button className="btn btn-sm btn-secondary" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}
                        onClick={() => onDismiss(signal)}>Dismiss</button>
                )}
            </div>
        </div>
    );
}

function RadarMatrix({ signals }) {
    const activeSignals = signals.filter((s) => !['Dismissed', 'Converted'].includes(s.status));

    function cellSignals(impact, horizon) {
        return activeSignals.filter((s) => s.potential_impact === impact && s.time_horizon === horizon);
    }

    const MAX_VISIBLE = 3;

    return (
        <div className="card">
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Signal radar</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                Signals plotted by time horizon × potential impact. Escalated signals shown with amber ring.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr', gap: 0 }}>
                <div />
                {HORIZONS.map((h) => (
                    <div key={h} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 8px',
                        textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#1B3A6B', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                        {h}
                    </div>
                ))}
                {[...IMPACTS].reverse().map((impact) => (
                    <div key={`row-${impact}`} style={{ display: 'contents' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                            paddingRight: 8, fontSize: 10, fontWeight: 700, color: '#64748b', borderTop: '1px solid #e2e8f0',
                            textTransform: 'uppercase' }}>
                            {impact}
                        </div>
                        {HORIZONS.map((horizon) => {
                            const cells = cellSignals(impact, horizon);
                            return (
                                <div key={`${impact}-${horizon}`} style={{ border: '1px solid #e2e8f0', borderLeft: 'none',
                                    minHeight: 72, padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
                                    background: impact === 'Critical' ? '#fff9f9' : impact === 'High' ? '#fffcf5' : '#fff' }}>
                                    {cells.slice(0, MAX_VISIBLE).map((sig) => {
                                        const c = CAT_COLORS[sig.category] || { bg: '#64748b' };
                                        return (
                                            <span key={sig.id} style={{ background: c.bg, color: '#fff', borderRadius: 20,
                                                padding: '2px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                                                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                                                boxShadow: sig.status === 'Escalated' ? '0 0 0 2px #d97706, 0 0 0 4px #fef9c3' : undefined }}>
                                                {sig.category.slice(0, 3).toUpperCase()} · {sig.title.slice(0, 22)}{sig.title.length > 22 ? '…' : ''}
                                            </span>
                                        );
                                    })}
                                    {cells.length > MAX_VISIBLE && (
                                        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>
                                            +{cells.length - MAX_VISIBLE} more
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                {CATEGORIES.map((cat) => (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text)' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: CAT_COLORS[cat]?.bg, display: 'inline-block' }} />
                        {cat}
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d97706',
                        boxShadow: '0 0 0 2px #d97706, 0 0 0 4px #fef9c3', display: 'inline-block' }} />
                    Escalated
                </div>
            </div>
        </div>
    );
}

function SignalForm({ initial, onSave, onCancel, submitting }) {
    const [form, setForm] = useState(initial ? {
        title: initial.title || '', category: initial.category || 'Regulatory',
        description: initial.description || '', source_name: initial.source_name || '',
        source_url: initial.source_url || '', time_horizon: initial.time_horizon || 'Near-term (<1yr)',
        potential_impact: initial.potential_impact || 'Medium', likelihood: initial.likelihood || 'Possible',
        department: initial.department || '', notes: initial.notes || '',
    } : {
        title: '', category: 'Regulatory', description: '', source_name: '', source_url: '',
        time_horizon: 'Near-term (<1yr)', potential_impact: 'Medium', likelihood: 'Possible',
        department: '', notes: '',
    });
    function set(field, val) { setForm((f) => ({ ...f, [field]: val })); }
    return (
        <div className="card">
            <h3 style={{ marginTop: 0 }}>{initial ? `Edit — ${initial.scan_uid}` : 'New signal'}</h3>
            <div className="form-row">
                <div className="form-group" style={{ flex: 3 }}>
                    <label>Title *</label>
                    <input className="form-control" value={form.title} onChange={(e) => set('title', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Category *</label>
                    <select className="form-control" value={form.category} onChange={(e) => set('category', e.target.value)}>
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Description *</label>
                    <textarea className="form-control" rows={3} value={form.description}
                        onChange={(e) => set('description', e.target.value)}
                        placeholder="Origin, relevance to this organisation, and potential consequence if it materialises." />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Time horizon *</label>
                    <select className="form-control" value={form.time_horizon} onChange={(e) => set('time_horizon', e.target.value)}>
                        {HORIZONS.map((h) => <option key={h}>{h}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Potential impact *</label>
                    <select className="form-control" value={form.potential_impact} onChange={(e) => set('potential_impact', e.target.value)}>
                        {IMPACTS.map((i) => <option key={i}>{i}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Likelihood *</label>
                    <select className="form-control" value={form.likelihood} onChange={(e) => set('likelihood', e.target.value)}>
                        {LIKELIHOODS.map((l) => <option key={l}>{l}</option>)}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Source name</label>
                    <input className="form-control" placeholder="e.g. World Economic Forum" value={form.source_name}
                        onChange={(e) => set('source_name', e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Source URL</label>
                    <input className="form-control" type="url" placeholder="https://…" value={form.source_url}
                        onChange={(e) => set('source_url', e.target.value)} />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Department</label>
                    <input className="form-control" placeholder="Leave blank for enterprise-wide" value={form.department}
                        onChange={(e) => set('department', e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Notes</label>
                    <input className="form-control" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn btn-primary" disabled={submitting || !form.title || !form.description}
                    onClick={() => onSave(form)}>
                    {submitting ? 'Saving…' : 'Save signal'}
                </button>
                <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

function DetailPanel({ signal, onClose, onEdit, onConvert, onPublish, onDismiss, userRole }) {
    const canAct = ['Admin', 'CRO', 'Consultant CRO', 'Risk Manager'].includes(userRole);
    return (
        <div className="card" style={{ marginBottom: 16, borderLeft: signal.status === 'Escalated' ? '3px solid #d97706' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CatBadge category={signal.category} />
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace', fontWeight: 600 }}>
                        {signal.scan_uid}
                    </span>
                </div>
                <button className="btn btn-sm btn-secondary" onClick={onClose}>✕ Close</button>
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: 15, lineHeight: 1.35 }}>{signal.title}</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                <span className={`badge ${IMPACT_CLASS[signal.potential_impact] || 'badge-medium'}`}>{signal.potential_impact} impact</span>
                <span className="badge badge-role" style={{ fontSize: 10 }}>{signal.time_horizon}</span>
                <span className="badge badge-role" style={{ fontSize: 10 }}>{signal.likelihood}</span>
                <StatusBadge status={signal.status} />
                {signal.added_by === 'ai-assistant' && (
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, border: '1px solid #bfdbfe' }}>AI Draft</span>
                )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6, marginBottom: 14 }}>{signal.description}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                {[
                    ['Owner', signal.owner && signal.owner !== 'ai-assistant' ? signal.owner : '—'],
                    ['Department', signal.department || 'Enterprise-wide'],
                    ['Source', signal.source_name || '—'],
                    ['Added by', signal.added_by === 'ai-assistant' ? 'AI assistant (draft)' : (signal.added_by || '—')],
                    ['Created', new Date(signal.created_at).toLocaleDateString()],
                    ['Updated', new Date(signal.updated_at).toLocaleDateString()],
                ].map(([label, val]) => (
                    <div key={label}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 12 }}>{val}</div>
                    </div>
                ))}
            </div>
            {signal.source_url && (
                <div style={{ marginBottom: 14 }}>
                    <a href={signal.source_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#1d4ed8' }}>
                        View source ↗
                    </a>
                </div>
            )}
            {signal.notes && (
                <div style={{ background: '#f8fafc', borderRadius: 6, padding: '8px 12px', fontSize: 12,
                    color: 'var(--color-text)', marginBottom: 14, lineHeight: 1.5 }}>
                    <strong>Notes:</strong> {signal.notes}
                </div>
            )}
            {signal.converted_risk_uid && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px', fontSize: 12,
                    color: '#166534', marginBottom: 14 }}>
                    Converted to risk: <strong>{signal.converted_risk_uid}</strong>
                </div>
            )}
            {canAct && !['Dismissed', 'Converted'].includes(signal.status) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                    {signal.status === 'Draft' && (
                        <button className="btn btn-primary" onClick={() => onPublish(signal)}>Publish signal</button>
                    )}
                    {['Monitoring', 'Escalated'].includes(signal.status) && (
                        <button className="btn btn-primary" onClick={() => onConvert(signal)}>Convert to risk</button>
                    )}
                    {!['Draft'].includes(signal.status) && (
                        <button className="btn btn-secondary" onClick={() => onEdit(signal)}>Edit</button>
                    )}
                    <button className="btn btn-secondary" style={{ color: '#991b1b', borderColor: '#fecaca' }}
                        onClick={() => onDismiss(signal)}>Dismiss</button>
                </div>
            )}
        </div>
    );
}

export default function HorizonScanning() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session?.companies?.find((c) => c.id === session.activeCompanyId);
    const userRole = activeCompany?.role || '';

    const [signals, setSignals]             = useState([]);
    const [hasAiKey, setHasAiKey]           = useState(false);
    const [loading, setLoading]             = useState(true);
    const [error, setError]                 = useState('');
    const [tab, setTab]                     = useState('list'); // list | radar | add
    const [subTab, setSubTab]               = useState('active'); // active | drafts
    const [viewSignal, setViewSignal]       = useState(null);
    const [editSignal, setEditSignal]       = useState(null);
    const [submitting, setSubmitting]       = useState(false);
    const [aiScanning, setAiScanning]       = useState(false);
    const [aiResult, setAiResult]           = useState(null);
    const [filterCat, setFilterCat]         = useState('');
    const [filterHorizon, setFilterHorizon] = useState('');
    const [filterImpact, setFilterImpact]   = useState('');
    const [showDismissed, setShowDismissed] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        api.get('/horizon-scans').then((r) => {
            setSignals(r.signals || []);
            setHasAiKey(r.has_ai_key || false);
        }).catch((e) => setError(e?.message || 'Failed to load signals.'))
          .finally(() => setLoading(false));
    }, [api]);

    useEffect(() => { load(); }, [load]);

    async function handleSave(form) {
        setSubmitting(true);
        setError('');
        try {
            if (editSignal) {
                await api.patch(`/horizon-scans/${editSignal.id}`, form);
            } else {
                await api.post('/horizon-scans', form);
            }
            setEditSignal(null);
            setTab('list');
            load();
        } catch (e) { setError(e.message || 'Failed to save signal.'); }
        finally { setSubmitting(false); }
    }

    async function handlePublish(signal) {
        try {
            await api.patch(`/horizon-scans/${signal.id}`, { status: 'Monitoring' });
            setViewSignal(null);
            load();
        } catch (e) { setError(e.message || 'Failed to publish signal.'); }
    }

    async function handleDismiss(signal) {
        if (!window.confirm(`Dismiss "${signal.title}"? It will be removed from the active list.`)) return;
        try {
            await api.patch(`/horizon-scans/${signal.id}`, { status: 'Dismissed' });
            setViewSignal(null);
            load();
        } catch (e) { setError(e.message || 'Failed to dismiss signal.'); }
    }

    async function handleConvert(signal) {
        try {
            const payload = await api.post(`/horizon-scans/${signal.id}/convert`, {});
            alert(
                `Signal ${signal.scan_uid} is ready to convert.\n\n` +
                `Pre-populated risk detail:\n"${payload.risk_detail}"\n\n` +
                `Category: ${payload.risk_category}\n` +
                `Framework ref: ${payload.framework_reference || '—'}\n\n` +
                `Open the Risk Register and use "Add Risk" to complete the conversion.`
            );
            load();
        } catch (e) { setError(e.message || 'Failed to prepare conversion.'); }
    }

    async function handleAiScan() {
        if (!hasAiKey) return;
        if (!window.confirm('Run AI scan? The AI will draft candidate signals from external sources for your review. Drafts won\'t appear in the active list until you publish them.')) return;
        setAiScanning(true);
        setAiResult(null);
        setError('');
        try {
            const r = await api.post('/horizon-scans/ai-draft', {});
            setAiResult(r);
            setSubTab('drafts');
            load();
        } catch (e) { setError(e.message || 'AI scan failed. Check your API key in Admin → AI Integration.'); }
        finally { setAiScanning(false); }
    }

    const activeSignals = signals.filter((s) => s.status !== 'Draft' && (showDismissed || s.status !== 'Dismissed'));
    const draftSignals  = signals.filter((s) => s.status === 'Draft');

    const displaySignals = tab === 'list'
        ? (subTab === 'drafts' ? draftSignals : activeSignals)
        : activeSignals;

    const filtered = displaySignals.filter((s) => {
        if (filterCat && s.category !== filterCat) return false;
        if (filterHorizon && s.time_horizon !== filterHorizon) return false;
        if (filterImpact && s.potential_impact !== filterImpact) return false;
        return true;
    });

    // KPI counts
    const total     = signals.filter((s) => !['Dismissed', 'Draft'].includes(s.status)).length;
    const escalated = signals.filter((s) => s.status === 'Escalated').length;
    const nearHigh  = signals.filter((s) => s.time_horizon === 'Near-term (<1yr)' && ['High', 'Critical'].includes(s.potential_impact) && s.status !== 'Dismissed').length;
    const converted = signals.filter((s) => s.status === 'Converted').length;

    const canAdd      = ['Admin', 'CRO', 'Consultant CRO', 'Risk Manager'].includes(userRole);
    const canSeeDrafts = canAdd;

    if (loading) return <div className="page-content"><p>Loading…</p></div>;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: '0 0 4px' }}>{t('horizon_title')}</h2>
                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>{t('horizon_subtitle')}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div title={!hasAiKey ? 'No AI API key configured. Contact your Admin.' : 'Draft candidate signals from external sources using AI.'}>
                        <button
                            className="btn btn-secondary"
                            onClick={handleAiScan}
                            disabled={!hasAiKey || aiScanning}
                            style={{ opacity: !hasAiKey ? 0.5 : 1, cursor: !hasAiKey ? 'not-allowed' : 'pointer' }}
                        >
                            {aiScanning ? 'Scanning…' : '✦ AI scan'}
                        </button>
                    </div>
                    {canAdd && (
                        <button className="btn btn-primary" onClick={() => { setEditSignal(null); setTab('add'); }}>
                            + Add signal
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px',
                    fontSize: 13, color: '#991b1b', marginBottom: 16 }}>
                    {error}
                </div>
            )}

            {aiResult && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '10px 14px',
                    fontSize: 13, color: '#1e40af', marginBottom: 16 }}>
                    AI scan complete — <strong>{aiResult.drafted}</strong> signal{aiResult.drafted !== 1 ? 's' : ''} drafted,{' '}
                    <strong>{aiResult.skipped}</strong> duplicate{aiResult.skipped !== 1 ? 's' : ''} skipped.
                    {draftSignals.length > 0 && <> Review them in the <button onClick={() => { setTab('list'); setSubTab('drafts'); }}
                        style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', padding: 0, fontWeight: 600, textDecoration: 'underline' }}>Drafts tab</button>.</>}
                </div>
            )}

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { label: 'Active signals', value: total, color: 'var(--color-text)' },
                    { label: 'Escalated', value: escalated, color: escalated > 0 ? '#b45309' : 'var(--color-text)' },
                    { label: 'Near-term · High/Critical', value: nearHigh, color: nearHigh > 0 ? '#991b1b' : 'var(--color-text)' },
                    { label: 'Converted to risk', value: converted, color: 'var(--color-text-muted)' },
                ].map(({ label, value, color }) => (
                    <div key={label} className="card" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                    </div>
                ))}
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
                {[
                    { key: 'list', label: 'Signal list' },
                    { key: 'radar', label: 'Radar matrix' },
                    ...(canAdd ? [{ key: 'add', label: tab === 'add' && editSignal ? `Edit — ${editSignal.scan_uid}` : 'Add signal' }] : []),
                ].map(({ key, label }) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        padding: '9px 18px', fontSize: 13, fontWeight: tab === key ? 600 : 500,
                        color: tab === key ? '#1B3A6B' : 'var(--color-text-muted)',
                        background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #1B3A6B' : '2px solid transparent',
                        marginBottom: -1, cursor: 'pointer',
                    }}>{label}</button>
                ))}
            </div>

            {/* Signal List tab */}
            {tab === 'list' && (
                <>
                    {/* Sub-tabs: Active | Drafts */}
                    {canSeeDrafts && draftSignals.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                            {[
                                { key: 'active', label: `Active (${activeSignals.length})`, accent: false },
                                { key: 'drafts', label: `Drafts (${draftSignals.length})`, accent: true },
                            ].map(({ key, label, accent }) => (
                                <button key={key} onClick={() => setSubTab(key)} style={{
                                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                                    cursor: 'pointer', border: '1px solid',
                                    background: subTab === key ? (accent ? '#eff6ff' : '#1B3A6B') : '#fff',
                                    color: subTab === key ? (accent ? '#1d4ed8' : '#fff') : 'var(--color-text-muted)',
                                    borderColor: subTab === key ? (accent ? '#bfdbfe' : '#1B3A6B') : 'var(--color-border)',
                                }}>{label}</button>
                            ))}
                        </div>
                    )}

                    {/* Filter bar */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Filter:</span>
                        {[
                            { value: filterCat, set: setFilterCat, options: CATEGORIES, placeholder: 'All categories' },
                            { value: filterHorizon, set: setFilterHorizon, options: HORIZONS, placeholder: 'All horizons' },
                            { value: filterImpact, set: setFilterImpact, options: IMPACTS, placeholder: 'All impact levels' },
                        ].map(({ value, set, options, placeholder }) => (
                            <select key={placeholder} className="form-control" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                                value={value} onChange={(e) => set(e.target.value)}>
                                <option value="">{placeholder}</option>
                                {options.map((o) => <option key={o}>{o}</option>)}
                            </select>
                        ))}
                        <div style={{ marginLeft: 'auto' }}>
                            <button onClick={() => setShowDismissed((v) => !v)} style={{
                                padding: '4px 12px', fontSize: 11, borderRadius: 20, border: '1px solid var(--color-border)',
                                background: showDismissed ? '#f1f5f9' : '#fff', color: 'var(--color-text-muted)',
                                cursor: 'pointer', fontWeight: 500,
                            }}>
                                {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
                            </button>
                        </div>
                    </div>

                    {/* Detail panel */}
                    {viewSignal && (
                        <DetailPanel signal={viewSignal} userRole={userRole}
                            onClose={() => setViewSignal(null)}
                            onEdit={(s) => { setEditSignal(s); setTab('add'); setViewSignal(null); }}
                            onConvert={handleConvert}
                            onPublish={handlePublish}
                            onDismiss={handleDismiss} />
                    )}

                    {/* Signal grid */}
                    {filtered.length === 0 ? (
                        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-muted)' }}>
                            {subTab === 'drafts'
                                ? <><p style={{ fontSize: 32, margin: '0 0 12px' }}>✦</p><p style={{ margin: 0 }}>No draft signals. Run an AI scan to generate candidates.</p></>
                                : <><p style={{ fontSize: 32, margin: '0 0 12px' }}>🔭</p><p style={{ margin: 0 }}>No signals match the selected filters.</p></>}
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {filtered.map((s) => (
                                <SignalCard key={s.id} signal={s} userRole={userRole}
                                    onView={setViewSignal}
                                    onEdit={(sig) => { setEditSignal(sig); setTab('add'); }}
                                    onConvert={handleConvert}
                                    onPublish={handlePublish}
                                    onDismiss={handleDismiss} />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Radar Matrix tab */}
            {tab === 'radar' && <RadarMatrix signals={signals} />}

            {/* Add / Edit Signal tab */}
            {tab === 'add' && (
                <SignalForm
                    initial={editSignal}
                    submitting={submitting}
                    onSave={handleSave}
                    onCancel={() => { setEditSignal(null); setTab('list'); }} />
            )}
        </div>
    );
}
