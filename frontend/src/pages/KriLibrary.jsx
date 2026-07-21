// KriLibrary.jsx — KRI Library & Register (B3) page. `canManageKri`
// (below) gates defining a KRI and recording measurements: Admin, Risk
// Manager, CRO, Consultant CRO. Viewing (incl. Risk Champion/Owner/
// Viewer) is broader. See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import DepartmentField from '../components/DepartmentField';
import Sparkline, { bandBadgeClass } from '../components/Sparkline';
import { useT } from '../contexts/LanguageContext';

// Shared hook: fetches current risk appetite statements for the RAM dropdown.
// Returns [statements, loading] where each statement has { id, risk_category, appetite_level, max_residual_score }.
function useAppetiteStatements(api) {
    const [statements, setStatements] = useState([]);
    const [loading, setLoading] = useState(true);
    const fetch = useCallback(() => {
        setLoading(true);
        api.get('/risk-appetite').then((r) => {
            setStatements((r.statements || []).filter((s) => s.is_current));
        }).catch(() => {}).finally(() => setLoading(false));
    }, [api]);
    useEffect(() => { fetch(); }, [fetch]);
    return [statements, loading];
}

const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];
const THRESHOLD_SOURCES = ['None', 'Internal', 'Regulatory', 'Both'];
const DIRECTIONS = [
    { value: 'above', label: 'Breach if value goes ABOVE threshold' },
    { value: 'below', label: 'Breach if value goes BELOW threshold' },
];

const RAG_OPTIONS = [
    { value: 'Green', label: '🟢 Green — No breach, within tolerance' },
    { value: 'Amber', label: '🟡 Amber — Approaching threshold, monitor closely' },
    { value: 'Red',   label: '🔴 Red — Threshold breached, action required' },
];

const RAG_STYLES = {
    Green: { background: '#e8f5e9', color: '#1b5e20', border: '1px solid #a5d6a7' },
    Amber: { background: '#fff8e1', color: '#e65100', border: '1px solid #ffcc80' },
    Red:   { background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a' },
};

// Multi-band tolerance editor: each band = { rag, min, max, label }
function ThresholdBandEditor({ bands, onChange }) {
    function addBand() {
        onChange([...bands, { rag: 'Green', min: '', max: '', label: '' }]);
    }
    function update(idx, field, val) {
        onChange(bands.map((b, i) => (i === idx ? { ...b, [field]: val } : b)));
    }
    function remove(idx) {
        onChange(bands.filter((_, i) => i !== idx));
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ marginBottom: 0 }}>Tolerance Bands</label>
                <button type="button" className="btn btn-sm btn-secondary" onClick={addBand}>+ Add Band</button>
            </div>
            {bands.length === 0 && (
                <div className="text-muted" style={{ fontSize: 13, padding: '6px 0 10px' }}>
                    No bands defined yet. Click "+ Add Band" to configure Green/Amber/Red ranges (e.g. &lt;30 days = Green, 31–60 = Amber, &gt;60 = Red).
                </div>
            )}
            {bands.map((band, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, padding: '6px 10px', borderRadius: 6, ...RAG_STYLES[band.rag] }}>
                    <select
                        style={{ width: 130, background: 'transparent', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                        value={band.rag}
                        onChange={(e) => update(idx, 'rag', e.target.value)}
                    >
                        <option value="Green">🟢 Green</option>
                        <option value="Amber">🟡 Amber</option>
                        <option value="Red">🔴 Red</option>
                    </select>
                    <span style={{ fontSize: 12, whiteSpace: 'nowrap', opacity: 0.8 }}>Min ≥</span>
                    <input
                        type="number" step="any"
                        className="form-control"
                        style={{ width: 75, background: 'transparent', padding: '4px 8px' }}
                        placeholder="None"
                        value={band.min}
                        onChange={(e) => update(idx, 'min', e.target.value)}
                    />
                    <span style={{ fontSize: 12, whiteSpace: 'nowrap', opacity: 0.8 }}>Max ≤</span>
                    <input
                        type="number" step="any"
                        className="form-control"
                        style={{ width: 75, background: 'transparent', padding: '4px 8px' }}
                        placeholder="None"
                        value={band.max}
                        onChange={(e) => update(idx, 'max', e.target.value)}
                    />
                    <input
                        className="form-control"
                        style={{ flex: 1, background: 'transparent', padding: '4px 8px' }}
                        placeholder="Label (e.g. < 30 days)"
                        value={band.label}
                        onChange={(e) => update(idx, 'label', e.target.value)}
                    />
                    <button type="button" onClick={() => remove(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, opacity: 0.7, padding: '0 4px' }}>×</button>
                </div>
            ))}
        </div>
    );
}


// Compute next-due date string for display
function nextDueLabel(freq, lastDateStr) {
    if (!lastDateStr) return null;
    const freqDays = { Daily: 1, Weekly: 7, Monthly: 31, Quarterly: 92, 'Semi-Annual': 183, Annual: 365 };
    const days = freqDays[freq] ?? 31;
    const due = new Date(new Date(lastDateStr).getTime() + days * 24 * 60 * 60 * 1000);
    return due.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

export default function KriLibrary() {
    const { api, user, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const isBuMode = !!activeCompany?.has_business_units;
    const canManageKri = role === 'Admin' || role === 'Risk Manager' || role === 'CRO' || role === 'Consultant CRO';
    const [kris, setKris] = useState([]);
    const [allDepartments, setAllDepartments] = useState([]);
    const [allBus, setAllBus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [measuringKri, setMeasuringKri] = useState(null);
    const [editingKri, setEditingKri] = useState(null);
    const [dismissedAlerts, setDismissedAlerts] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem('kri_dismissed') || '[]'); } catch { return []; }
    });

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [kriData, depts, bus] = await Promise.all([
                api.get('/kris'),
                api.get('/departments').catch(() => []),
                isBuMode ? api.get('/business-units').catch(() => []) : Promise.resolve([]),
            ]);
            setKris(kriData);
            setAllDepartments(depts || []);
            setAllBus(bus || []);
        } catch (e) {
            setError(e.message || 'Failed to load KRIs');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function dismissAlert(id) {
        const next = [...dismissedAlerts, id];
        setDismissedAlerts(next);
        sessionStorage.setItem('kri_dismissed', JSON.stringify(next));
    }

    const overdueKris = kris.filter((k) => k.is_overdue && !dismissedAlerts.includes(k.id));

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('kris_title')}</h1>
                    <p className="page-subtitle">{t('kris_subtitle')}</p>
                </div>
                {canManageKri && (
                    <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
                        {showForm ? 'Close' : t('add_kri')}
                    </button>
                )}
            </div>

            {overdueKris.length > 0 && (
                <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontWeight: 700, color: '#e65100', fontSize: 15, marginBottom: 6 }}>
                                ⚠ {overdueKris.length} KRI{overdueKris.length > 1 ? 's' : ''} pending update
                            </div>
                            <div style={{ fontSize: 13, color: '#5d4037', marginBottom: 8 }}>
                                The following KRIs have not been updated within their scheduled measurement period.
                                Please record the latest value to keep the register current.
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {overdueKris.map((k) => (
                                    <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                        <strong style={{ color: '#bf360c', minWidth: 110 }}>{k.kri_uid}</strong>
                                        <span>{k.name}</span>
                                        {k.owner && <span style={{ color: '#795548' }}>— Owner: {k.owner}</span>}
                                        <span style={{ color: '#9e9e9e', fontSize: 12 }}>
                                            (was due {nextDueLabel(k.measurement_frequency, k.history?.at(-1)?.measurement_date) ?? 'unknown'})
                                        </span>
                                        <button
                                            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#ff8f00', fontSize: 12, textDecoration: 'underline', padding: 0 }}
                                            onClick={() => setMeasuringKri(k)}
                                        >
                                            Record now →
                                        </button>
                                        <button
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
                                            title="Dismiss for this session"
                                            onClick={() => dismissAlert(k.id)}
                                        >×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <NewKriForm
                    onCreated={() => {
                        setShowForm(false);
                        load();
                    }}
                    onError={setError}
                />
            )}

            {measuringKri && (
                <MeasurementForm
                    kri={measuringKri}
                    onDone={() => {
                        setMeasuringKri(null);
                        load();
                    }}
                    onError={setError}
                />
            )}

            {editingKri && (
                <EditKriForm
                    kri={editingKri}
                    onUpdated={() => {
                        setEditingKri(null);
                        load();
                    }}
                    onCancel={() => setEditingKri(null)}
                    onError={setError}
                />
            )}

            <div className="card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 24 }}>{t('loading')}</div>
                ) : kris.length === 0 ? (
                    <div style={{ padding: 24 }} className="text-muted">
                        {t('no_kris')}
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>{t('kri_id')}</th>
                                <th>{t('col_owner')}</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Thresholds</th>
                                <th>Current</th>
                                <th>Trend</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {kris.map((k) => (
                                <tr key={k.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <strong>{k.kri_uid}</strong>
                                            {k.is_overdue && (
                                                <span title="Measurement overdue — update required" style={{ background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '1px 6px' }}>
                                                    ⚠ Overdue
                                                </span>
                                            )}
                                        </div>
                                        <div>{k.name}</div>
                                        {k.description && <div style={{ fontSize: 12, marginTop: 2 }}>{k.description}</div>}
                                        {k.definition && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>Formula: {k.definition}</div>}
                                        {k.data_source && <div className="text-muted" style={{ fontSize: 11 }}>Source: {k.data_source}</div>}
                                    </td>
                                    <td>{k.owner || '—'}</td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === k.department || d.name === k.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td className="text-muted">{bu ? bu.name : (dept ? dept.name : (k.department || 'Enterprise-wide'))}</td>;
                                    })()}
                                    <td className="text-muted">{allDepartments.find((d) => d.code === k.department || d.name === k.department)?.name || k.department || 'Enterprise-wide'}</td>
                                    <td className="text-muted" style={{ fontSize: 12 }}>
                                        {k.threshold_source === 'None' && 'Trend only'}
                                        {k.threshold_bands && k.threshold_bands.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                {k.threshold_bands.map((b, i) => {
                                                    const emoji = b.rag === 'Green' ? '🟢' : b.rag === 'Amber' ? '🟡' : '🔴';
                                                    let range = '';
                                                    if (b.min != null && b.max != null) range = `${b.min}–${b.max}`;
                                                    else if (b.min != null) range = `≥${b.min}`;
                                                    else if (b.max != null) range = `≤${b.max}`;
                                                    const text = `${emoji} ${range}${b.label ? ' ' + b.label : ''}`.trim();
                                                    return (
                                                        <span key={i} style={{ padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, ...RAG_STYLES[b.rag] }}>
                                                            {text}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <>
                                                {(k.threshold_source === 'Internal' || k.threshold_source === 'Both') && (
                                                    <div>Internal: {k.internal_tolerance}</div>
                                                )}
                                                {(k.threshold_source === 'Regulatory' || k.threshold_source === 'Both') && (
                                                    <div>Regulatory: {k.regulatory_limit}</div>
                                                )}
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        {k.current_value !== null ? (
                                            <>
                                                <div style={{ fontWeight: 700 }}>{k.current_value}</div>
                                                {k.band && <span className={`badge ${bandBadgeClass(k.band)}`}>{k.band}</span>}
                                                {(() => {
                                                    const last = k.history && k.history[k.history.length - 1];
                                                    if (!last || !last.rag_status) return null;
                                                    const s = RAG_STYLES[last.rag_status];
                                                    return (
                                                        <div style={{ marginTop: 4, display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, ...s }}>
                                                            {last.rag_status === 'Green' ? '🟢' : last.rag_status === 'Amber' ? '🟡' : '🔴'} {last.rag_status}
                                                        </div>
                                                    );
                                                })()}
                                            </>
                                        ) : (
                                            <span className="text-muted">No data</span>
                                        )}
                                    </td>
                                    <td>
                                        <Sparkline history={k.history} />
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {canManageKri && (
                                                <button className="btn btn-sm btn-secondary" onClick={() => setMeasuringKri(k)}>
                                                    Record Value
                                                </button>
                                            )}
                                            {canManageKri && (
                                                <button className="btn btn-sm btn-secondary" onClick={() => setEditingKri(k)}>
                                                    Edit
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function NewKriForm({ onCreated, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [nextId, setNextId] = useState('');
    const [appetiteStatements, appetiteLoading] = useAppetiteStatements(api);
    const [form, setForm] = useState({
        name: '',
        description: '',
        definition: '',
        owner: '',
        measurement_frequency: 'Monthly',
        threshold_source: 'None',
        threshold_bands: [],
        regulatory_limit: '',
        regulatory_reference: '',
        breach_direction: 'above',
        department: '',
        data_source: '',
        appetite_statement_id: '',
    });

    useEffect(() => {
        const dept = form.department ? `?department=${encodeURIComponent(form.department)}` : '';
        api.get(`/kris/next-id${dept}`).then((r) => setNextId(r.next_id)).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.department]);

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            await api.post('/kris', {
                ...form,
                threshold_bands: form.threshold_bands.length > 0
                    ? form.threshold_bands.map((b) => ({
                        rag: b.rag,
                        min: b.min === '' ? null : Number(b.min),
                        max: b.max === '' ? null : Number(b.max),
                        label: b.label,
                    }))
                    : null,
                regulatory_limit: form.regulatory_limit === '' ? null : Number(form.regulatory_limit),
            });
            onCreated();
        } catch (e) {
            onError(e.message || 'Failed to create KRI');
        } finally {
            setSubmitting(false);
        }
    }

    const showInternal = form.threshold_source === 'Internal' || form.threshold_source === 'Both';
    const showRegulatory = form.threshold_source === 'Regulatory' || form.threshold_source === 'Both';

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>New KRI</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>KRI ID</label>
                    <input
                        className="form-control"
                        value={nextId || '—'}
                        readOnly
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: 'default', fontWeight: 600 }}
                    />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Name</label>
                    <input className="form-control" value={form.name} onChange={(e) => update('name', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Owner</label>
                    <input className="form-control" value={form.owner} onChange={(e) => update('owner', e.target.value)} />
                </div>
                <DepartmentField value={form.department} onChange={(v) => update('department', v)} twoFields />
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Description</label>
                    <textarea className="form-control" rows={2} placeholder="What does this KRI measure and why does it matter?" value={form.description} onChange={(e) => update('description', e.target.value)} />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Definition / Formula</label>
                    <textarea className="form-control" rows={2} placeholder="How is the value calculated or sourced?" value={form.definition} onChange={(e) => update('definition', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Data Source</label>
                    <input
                        className="form-control"
                        placeholder="e.g. Core banking system, Treasury feed"
                        value={form.data_source}
                        onChange={(e) => update('data_source', e.target.value)}
                    />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Measurement Frequency</label>
                    <select className="form-control" value={form.measurement_frequency} onChange={(e) => update('measurement_frequency', e.target.value)}>
                        {FREQUENCIES.map((f) => (
                            <option key={f}>{f}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Threshold Source</label>
                    <select className="form-control" value={form.threshold_source} onChange={(e) => update('threshold_source', e.target.value)}>
                        {THRESHOLD_SOURCES.map((t) => (
                            <option key={t} value={t}>
                                {t === 'None' ? 'None (trend/visibility only)' : t}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Risk Appetite Category</label>
                    <select
                        className="form-control"
                        value={form.appetite_statement_id}
                        onChange={(e) => update('appetite_statement_id', e.target.value ? Number(e.target.value) : '')}
                        disabled={appetiteLoading}
                    >
                        <option value="">— None —</option>
                        {appetiteStatements.map((s) => (
                            <option key={s.id} value={s.id}>{s.risk_category} ({s.appetite_level})</option>
                        ))}
                    </select>
                    {(() => {
                        const sel = appetiteStatements.find((s) => s.id === form.appetite_statement_id);
                        return sel ? (
                            <div style={{ fontSize: 11, color: '#1B3A6B', marginTop: 3, fontWeight: 500 }}>
                                Board ceiling: max residual score <strong>{sel.max_residual_score}</strong> / 25
                            </div>
                        ) : null;
                    })()}
                </div>
                {form.threshold_source !== 'None' && (
                    <div className="form-group">
                        <label>Breach Direction</label>
                        <select className="form-control" value={form.breach_direction} onChange={(e) => update('breach_direction', e.target.value)}>
                            {DIRECTIONS.map((d) => (
                                <option key={d.value} value={d.value}>
                                    {d.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>
            {showInternal && (
                <div className="form-row">
                    <div className="form-group" style={{ flex: 1 }}>
                        <ThresholdBandEditor
                            bands={form.threshold_bands}
                            onChange={(bands) => update('threshold_bands', bands)}
                        />
                    </div>
                </div>
            )}
            {showRegulatory && (
                <div className="form-row">
                    <div className="form-group">
                        <label>Regulatory Limit</label>
                        <input
                            type="number"
                            step="any"
                            className="form-control"
                            value={form.regulatory_limit}
                            onChange={(e) => update('regulatory_limit', e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>Regulatory Reference</label>
                        <input
                            className="form-control"
                            placeholder="e.g. QCB Circular No. XXX"
                            value={form.regulatory_reference}
                            onChange={(e) => update('regulatory_reference', e.target.value)}
                        />
                    </div>
                </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save KRI'}
            </button>
        </form>
    );
}

function EditKriForm({ kri, onUpdated, onCancel, onError }) {
    const { api } = useAuth();
    const t = useT();
    const [submitting, setSubmitting] = useState(false);
    const [appetiteStatements, appetiteLoading] = useAppetiteStatements(api);
    const [form, setForm] = useState({
        name: kri.name || '',
        description: kri.description || '',
        definition: kri.definition || '',
        owner: kri.owner || '',
        measurement_frequency: kri.measurement_frequency || 'Monthly',
        threshold_source: kri.threshold_source || 'None',
        threshold_bands: (kri.threshold_bands || []).map((b) => ({
            rag: b.rag,
            min: b.min ?? '',
            max: b.max ?? '',
            label: b.label || '',
        })),
        internal_tolerance: kri.internal_tolerance || '',
        regulatory_limit: kri.regulatory_limit ?? '',
        regulatory_reference: kri.regulatory_reference || '',
        breach_direction: kri.breach_direction || 'above',
        data_source: kri.data_source || '',
        department: kri.department || '',
        appetite_statement_id: kri.appetite_statement_id ?? '',
    });

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            await api.patch(`/kris/${kri.id}`, {
                ...form,
                threshold_bands: form.threshold_bands.length > 0
                    ? form.threshold_bands.map((b) => ({
                        rag: b.rag,
                        min: b.min === '' ? null : Number(b.min),
                        max: b.max === '' ? null : Number(b.max),
                        label: b.label,
                    }))
                    : null,
                internal_tolerance: form.internal_tolerance === '' ? null : Number(form.internal_tolerance),
                regulatory_limit: form.regulatory_limit === '' ? null : Number(form.regulatory_limit),
            });
            onUpdated();
        } catch (e) {
            onError(e.message || 'Failed to update KRI');
        } finally {
            setSubmitting(false);
        }
    }

    const showInternal = form.threshold_source === 'Internal' || form.threshold_source === 'Both';
    const showRegulatory = form.threshold_source === 'Regulatory' || form.threshold_source === 'Both';

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>Edit KRI — {kri.kri_uid}</h3>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Name</label>
                    <input className="form-control" value={form.name} onChange={(e) => update('name', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Owner</label>
                    <input className="form-control" value={form.owner} onChange={(e) => update('owner', e.target.value)} />
                </div>
                <DepartmentField value={form.department} onChange={(v) => update('department', v)} twoFields />
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Description</label>
                    <textarea className="form-control" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Definition / Formula</label>
                    <textarea className="form-control" rows={2} value={form.definition} onChange={(e) => update('definition', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Data Source</label>
                    <input className="form-control" value={form.data_source} onChange={(e) => update('data_source', e.target.value)} />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Measurement Frequency</label>
                    <select className="form-control" value={form.measurement_frequency} onChange={(e) => update('measurement_frequency', e.target.value)}>
                        {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Threshold Source</label>
                    <select className="form-control" value={form.threshold_source} onChange={(e) => update('threshold_source', e.target.value)}>
                        {THRESHOLD_SOURCES.map((t) => (
                            <option key={t} value={t}>{t === 'None' ? 'None (trend/visibility only)' : t}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Risk Appetite Category</label>
                    <select
                        className="form-control"
                        value={form.appetite_statement_id}
                        onChange={(e) => update('appetite_statement_id', e.target.value ? Number(e.target.value) : null)}
                        disabled={appetiteLoading}
                    >
                        <option value="">— None —</option>
                        {appetiteStatements.map((s) => (
                            <option key={s.id} value={s.id}>{s.risk_category} ({s.appetite_level})</option>
                        ))}
                    </select>
                    {(() => {
                        const sel = appetiteStatements.find((s) => s.id === form.appetite_statement_id);
                        return sel ? (
                            <div style={{ fontSize: 11, color: '#1B3A6B', marginTop: 3, fontWeight: 500 }}>
                                Board ceiling: max residual score <strong>{sel.max_residual_score}</strong> / 25
                            </div>
                        ) : null;
                    })()}
                </div>
                {form.threshold_source !== 'None' && (
                    <div className="form-group">
                        <label>Breach Direction</label>
                        <select className="form-control" value={form.breach_direction} onChange={(e) => update('breach_direction', e.target.value)}>
                            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </div>
                )}
            </div>
            {showInternal && (
                <div className="form-row">
                    <div className="form-group" style={{ flex: 1 }}>
                        <ThresholdBandEditor
                            bands={form.threshold_bands}
                            onChange={(bands) => update('threshold_bands', bands)}
                        />
                    </div>
                </div>
            )}
            {showRegulatory && (
                <div className="form-row">
                    <div className="form-group">
                        <label>Regulatory Limit</label>
                        <input type="number" step="any" className="form-control" value={form.regulatory_limit} onChange={(e) => update('regulatory_limit', e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label>Regulatory Reference</label>
                        <input className="form-control" value={form.regulatory_reference} onChange={(e) => update('regulatory_reference', e.target.value)} />
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : t('save')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onCancel}>
                    {t('cancel')}
                </button>
            </div>
        </form>
    );
}

function MeasurementForm({ kri, onDone, onError }) {
    const { api } = useAuth();
    const t = useT();
    const [submitting, setSubmitting] = useState(false);
    const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().slice(0, 10));
    const [value, setValue] = useState('');
    const [ragStatus, setRagStatus] = useState('');
    const [notes, setNotes] = useState('');
    const [reportingPeriod, setReportingPeriod] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [result, setResult] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            const res = await api.post(`/kris/${kri.id}/measurements`, {
                measurement_date: measurementDate,
                value: Number(value),
                rag_status: ragStatus || null,
                notes: notes || null,
                reporting_period: reportingPeriod || null,
            });
            if (res.created_issue) {
                setResult(res);
            } else {
                onDone();
            }
        } catch (e) {
            onError(e.message || 'Failed to record measurement');
        } finally {
            setSubmitting(false);
        }
    }

    if (result) {
        return (
            <div className="card">
                <h3 style={{ marginTop: 0 }}>Measurement recorded</h3>
                <div className="alert alert-info">
                    Value <strong>{result.value}</strong> is in the <strong>{result.band}</strong> band, which automatically logged{' '}
                    <strong>{result.created_issue.issue_uid}</strong> in the Issues &amp; Actions Tracker, linked to {kri.kri_uid}.
                </div>
                <button className="btn btn-primary" onClick={onDone}>
                    Done
                </button>
            </div>
        );
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>
                Record Measurement — {kri.kri_uid}: {kri.name}
            </h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Reporting Period</label>
                    <input
                        className="form-control"
                        placeholder="e.g. 2026-06 or 2026-Q2"
                        value={reportingPeriod}
                        onChange={(e) => setReportingPeriod(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label>Measurement Date</label>
                    <input type="date" className="form-control" value={measurementDate} onChange={(e) => setMeasurementDate(e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Value</label>
                    <input type="number" step="any" className="form-control" value={value} onChange={(e) => setValue(e.target.value)} required />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>RAG Status</label>
                    <select
                        className="form-control"
                        value={ragStatus}
                        onChange={(e) => setRagStatus(e.target.value)}
                        style={ragStatus ? RAG_STYLES[ragStatus] : {}}
                    >
                        <option value="">— Select status —</option>
                        {RAG_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Notes / Commentary</label>
                    <textarea
                        className="form-control"
                        rows={2}
                        placeholder="Context for this period's reading — what drove the value, any mitigating actions taken, etc."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>
            </div>
            {kri.threshold_bands && kri.threshold_bands.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tolerance Reference</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {kri.threshold_bands.map((b, i) => {
                            const emoji = b.rag === 'Green' ? '🟢' : b.rag === 'Amber' ? '🟡' : '🔴';
                            let range = '';
                            if (b.min != null && b.max != null) range = `${b.min}–${b.max}`;
                            else if (b.min != null) range = `≥${b.min}`;
                            else if (b.max != null) range = `≤${b.max}`;
                            const text = `${emoji} ${range}${b.label ? ' ' + b.label : ''}`.trim();
                            return (
                            <span key={i} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600, ...RAG_STYLES[b.rag] }}>
                                {text}
                            </span>
                        );})}
                    </div>
                </div>
            )}
            {kri.threshold_source !== 'None' && (
                <div className="alert alert-info">
                    A reading that breaches the threshold will automatically log an issue in the Issues &amp; Actions Tracker.
                </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Record'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onDone}>
                    {t('cancel')}
                </button>
            </div>
        </form>
    );
}
