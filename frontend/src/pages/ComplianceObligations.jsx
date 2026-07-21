// ComplianceObligations.jsx — Compliance Obligations Register (C1) page.
// Role gating: `canManage` (below) is Admin/Risk Manager/CRO/Consultant
// CRO — Risk Champion/Owner/Viewer have read-only access. See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import EvidenceAttachments from '../components/EvidenceAttachments';
import { useT } from '../contexts/LanguageContext';

const STATUSES = ['Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Yet Assessed'];

function statusBadgeClass(status) {
    switch (status) {
        case 'Compliant':
            return 'badge-low';
        case 'Partially Compliant':
            return 'badge-medium';
        case 'Non-Compliant':
            return 'badge-extreme';
        default:
            return 'badge-role';
    }
}

export default function ComplianceObligations() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const canManage = role === 'Admin' || role === 'Risk Manager' || role === 'CRO' || role === 'Consultant CRO';
    const [obligations, setObligations] = useState([]);
    const [allPolicies, setAllPolicies] = useState([]);
    const [allControls, setAllControls] = useState([]);
    const [allKris, setAllKris] = useState([]);
    const [allRisks, setAllRisks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [statusEditing, setStatusEditing] = useState(null);
    const [historyFor, setHistoryFor] = useState(null);
    const [history, setHistory] = useState([]);
    const [evidenceObligation, setEvidenceObligation] = useState(null); // obligation_uid whose evidence panel is open

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [obligationData, policyData, controlData, kriData, riskData] = await Promise.all([
                api.get('/obligations'),
                api.get('/policies'),
                api.get('/controls'),
                api.get('/kris'),
                api.get('/risks'),
            ]);
            setObligations(obligationData);
            setAllPolicies(policyData);
            setAllControls(controlData);
            setAllKris(kriData);
            setAllRisks(riskData);
        } catch (e) {
            setError(e.message || 'Failed to load Compliance Obligations');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function showHistory(obligationId) {
        setError('');
        try {
            setHistory(await api.get(`/obligations/${obligationId}/history`));
            setHistoryFor(obligationId);
        } catch (e) {
            setError(e.message || 'Failed to load history');
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('obligations_title')}</h1>
                    <p className="page-subtitle">{t('obligations_subtitle')}</p>
                </div>
                {canManage && (
                    <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
                        {showForm ? 'Close' : '+ New Obligation'}
                    </button>
                )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <NewObligationForm
                    allPolicies={allPolicies}
                    allControls={allControls}
                    allKris={allKris}
                    allRisks={allRisks}
                    onCreated={() => {
                        setShowForm(false);
                        load();
                    }}
                    onError={setError}
                />
            )}

            {historyFor && (
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <h3 style={{ marginTop: 0 }}>Status History — {obligations.find((o) => o.id === historyFor)?.obligation_uid}</h3>
                        <button className="btn btn-sm btn-secondary" onClick={() => setHistoryFor(null)}>
                            Close
                        </button>
                    </div>
                    {history.length === 0 ? (
                        <div className="text-muted">No history yet.</div>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Status</th>
                                    <th>Notes</th>
                                    <th>Changed By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((h) => (
                                    <tr key={h.id}>
                                        <td>{new Date(h.changed_at).toLocaleString()}</td>
                                        <td>
                                            <span className={`badge ${statusBadgeClass(h.status)}`}>{h.status}</span>
                                        </td>
                                        <td>{h.notes || '—'}</td>
                                        <td>{h.changed_by}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {statusEditing && (
                <StatusForm
                    obligation={statusEditing}
                    onDone={() => {
                        setStatusEditing(null);
                        load();
                    }}
                    onError={setError}
                />
            )}

            <div className="card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 24 }}>Loading…</div>
                ) : obligations.length === 0 ? (
                    <div style={{ padding: 24 }} className="text-muted">
                        No obligations recorded yet.
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Obligation</th>
                                <th>Applicable To</th>
                                <th>Owner</th>
                                <th>Status</th>
                                <th>Reporting</th>
                                <th>Linked</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {obligations.map((o) => {
                                const showEvidence = evidenceObligation === o.obligation_uid;
                                return (<Fragment key={o.id}>
                                <tr>
                                    <td>
                                        <strong>{o.obligation_uid}</strong>
                                        <div>{o.regulation_name}</div>
                                        <div className="text-muted">
                                            {o.regulatory_body}
                                            {o.reference ? ` — ${o.reference}` : ''}
                                        </div>
                                        {o.description && <div className="text-muted">{o.description}</div>}
                                    </td>
                                    <td>{o.applicable_to || '—'}</td>
                                    <td>{o.obligation_owner || '—'}</td>
                                    <td>
                                        <span className={`badge ${statusBadgeClass(o.compliance_status)}`}>{o.compliance_status}</span>
                                        {o.status_last_changed && (
                                            <div className="text-muted" style={{ marginTop: 4 }}>
                                                Reviewed: {new Date(o.status_last_changed).toLocaleDateString()}
                                            </div>
                                        )}
                                        {o.open_issues_count > 0 && (
                                            <div className="text-muted" style={{ marginTop: 4 }}>
                                                {o.open_issues_count} open issue{o.open_issues_count > 1 ? 's' : ''}
                                            </div>
                                        )}
                                    </td>
                                    <td className="text-muted">
                                        {o.reporting_requirement || '—'}
                                        {o.next_reporting_date && <div>Next: {o.next_reporting_date}</div>}
                                    </td>
                                    <td className="text-muted">
                                        {o.linked_policies.length > 0 && <div>Policies: {o.linked_policies.map((p) => p.policy_uid).join(', ')}</div>}
                                        {o.linked_controls.length > 0 && (
                                            <div>Controls: {o.linked_controls.map((c) => c.control_uid).join(', ')}</div>
                                        )}
                                        {o.linked_kris.length > 0 && <div>KRIs: {o.linked_kris.map((k) => k.kri_uid).join(', ')}</div>}
                                        {o.linked_risks.length > 0 && <div>Risks: {o.linked_risks.map((r) => r.risk_uid).join(', ')}</div>}
                                        {o.linked_policies.length === 0 &&
                                            o.linked_controls.length === 0 &&
                                            o.linked_kris.length === 0 &&
                                            o.linked_risks.length === 0 &&
                                            '—'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            {canManage && (
                                                <button className="btn btn-sm btn-secondary" onClick={() => setStatusEditing(o)}>
                                                    Update Status
                                                </button>
                                            )}
                                            <button className="btn btn-sm btn-secondary" onClick={() => showHistory(o.id)}>
                                                History
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setEvidenceObligation(showEvidence ? null : o.obligation_uid)}
                                            >
                                                {showEvidence ? 'Hide Evidence' : 'Evidence'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {showEvidence && (
                                    <tr>
                                        <td colSpan={7} style={{ background: 'var(--color-bg)', padding: '8px 16px' }}>
                                            <EvidenceAttachments entityType="obligation" entityId={o.obligation_uid} />
                                        </td>
                                    </tr>
                                )}
                                </Fragment>);
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function LinkPicker({ label, items, getLabel, selected, onToggle }) {
    if (items.length === 0) return null;
    return (
        <div className="form-group">
            <label>{label}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {items.map((item) => (
                    <label key={item.id} className="badge badge-role" style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'none' }}>
                        <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} style={{ marginRight: 4 }} />
                        {getLabel(item)}
                    </label>
                ))}
            </div>
        </div>
    );
}

function NewObligationForm({ allPolicies, allControls, allKris, allRisks, onCreated, onError }) {
    const { api, session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        regulatory_body: '',
        regulation_name: '',
        reference: '',
        description: '',
        applicable_to: role === 'Risk Manager' ? activeCompany?.department || '' : '',
        compliance_status: 'Not Yet Assessed',
        obligation_owner: '',
        evidence_of_compliance: '',
        reporting_requirement: '',
        next_reporting_date: '',
        next_review_date: '',
    });
    const [linkPolicyIds, setLinkPolicyIds] = useState([]);
    const [linkControlIds, setLinkControlIds] = useState([]);
    const [linkKriIds, setLinkKriIds] = useState([]);
    const [linkRiskIds, setLinkRiskIds] = useState([]);

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    function toggle(list, setList, id) {
        setList((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            await api.post('/obligations', {
                ...form,
                next_reporting_date: form.next_reporting_date || null,
                next_review_date: form.next_review_date || null,
                link_policy_ids: linkPolicyIds,
                link_control_ids: linkControlIds,
                link_kri_ids: linkKriIds,
                link_risk_ids: linkRiskIds,
            });
            onCreated();
        } catch (e) {
            onError(e.message || 'Failed to create obligation');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>New Compliance Obligation</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Regulatory Body / Source</label>
                    <input
                        className="form-control"
                        placeholder="e.g. QCB, SAMA, CBUAE, PDPL Authority"
                        value={form.regulatory_body}
                        onChange={(e) => update('regulatory_body', e.target.value)}
                    />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Regulation / Framework Name</label>
                    <input className="form-control" value={form.regulation_name} onChange={(e) => update('regulation_name', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Reference</label>
                    <input
                        className="form-control"
                        placeholder="Circular / Article No."
                        value={form.reference}
                        onChange={(e) => update('reference', e.target.value)}
                    />
                </div>
            </div>
            <div className="form-group">
                <label>Obligation Description (plain language)</label>
                <textarea className="form-control" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Applicable To (department/function)</label>
                    {role === 'Risk Manager' ? (
                        <>
                            <input className="form-control" value={form.applicable_to} disabled />
                            <div className="text-muted" style={{ marginTop: 4 }}>
                                Obligations you create are scoped to your department.
                            </div>
                        </>
                    ) : (
                        <input
                            className="form-control"
                            placeholder="Leave blank for enterprise-wide"
                            value={form.applicable_to}
                            onChange={(e) => update('applicable_to', e.target.value)}
                        />
                    )}
                </div>
                <div className="form-group">
                    <label>Obligation Owner</label>
                    <input className="form-control" value={form.obligation_owner} onChange={(e) => update('obligation_owner', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Compliance Status</label>
                    <select className="form-control" value={form.compliance_status} onChange={(e) => update('compliance_status', e.target.value)}>
                        {STATUSES.map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Evidence of Compliance</label>
                    <input
                        className="form-control"
                        placeholder="Where the evidence is held, e.g. shared drive folder"
                        value={form.evidence_of_compliance}
                        onChange={(e) => update('evidence_of_compliance', e.target.value)}
                    />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Reporting Requirement</label>
                    <input
                        className="form-control"
                        placeholder="e.g. Quarterly filing to regulator"
                        value={form.reporting_requirement}
                        onChange={(e) => update('reporting_requirement', e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label>Next Reporting Date</label>
                    <input
                        type="date"
                        className="form-control"
                        value={form.next_reporting_date}
                        onChange={(e) => update('next_reporting_date', e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label>Next Review Date</label>
                    <input type="date" className="form-control" value={form.next_review_date} onChange={(e) => update('next_review_date', e.target.value)} />
                </div>
            </div>

            <h3>Linked Items</h3>
            <LinkPicker
                label="Linked Policies"
                items={allPolicies}
                getLabel={(p) => `${p.policy_uid}: ${p.name}`}
                selected={linkPolicyIds}
                onToggle={(id) => toggle(linkPolicyIds, setLinkPolicyIds, id)}
            />
            <LinkPicker
                label="Linked Controls"
                items={allControls}
                getLabel={(c) => `${c.control_uid}: ${c.name}`}
                selected={linkControlIds}
                onToggle={(id) => toggle(linkControlIds, setLinkControlIds, id)}
            />
            <LinkPicker
                label="Linked KRIs"
                items={allKris}
                getLabel={(k) => `${k.kri_uid}: ${k.name}`}
                selected={linkKriIds}
                onToggle={(id) => toggle(linkKriIds, setLinkKriIds, id)}
            />
            <LinkPicker
                label="Linked Risks"
                items={allRisks}
                getLabel={(r) => r.risk_uid}
                selected={linkRiskIds}
                onToggle={(id) => toggle(linkRiskIds, setLinkRiskIds, id)}
            />

            <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save Obligation'}
            </button>
        </form>
    );
}

function StatusForm({ obligation, onDone, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState(obligation.compliance_status);
    const [notes, setNotes] = useState('');
    const [createdIssue, setCreatedIssue] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            const res = await api.post(`/obligations/${obligation.id}/status`, { status, notes });
            if (res.created_issue) {
                setCreatedIssue(res.created_issue);
            } else {
                onDone();
            }
        } catch (e) {
            onError(e.message || 'Failed to update status');
        } finally {
            setSubmitting(false);
        }
    }

    if (createdIssue) {
        return (
            <div className="card">
                <h3 style={{ marginTop: 0 }}>Status updated</h3>
                <div className="alert alert-info">
                    Marking this obligation Non-Compliant automatically logged <strong>{createdIssue.issue_uid}</strong> in the
                    Issues &amp; Actions Tracker, linked to {obligation.obligation_uid}, and flagged it for regulatory
                    notification review.
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
                Update Status — {obligation.obligation_uid}: {obligation.regulation_name}
            </h3>
            {obligation.open_issues_count > 0 && (
                <div className="alert alert-info">
                    {obligation.open_issues_count} open issue{obligation.open_issues_count > 1 ? 's' : ''} linked to this obligation.
                </div>
            )}
            <div className="form-row">
                <div className="form-group">
                    <label>Compliance Status</label>
                    <select className="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                        {STATUSES.map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Notes</label>
                    <input className="form-control" placeholder="Basis for this assessment" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
            </div>
            {status === 'Non-Compliant' && (
                <div className="alert alert-info">
                    Setting this to Non-Compliant will automatically log an issue in the Issues &amp; Actions Tracker.
                </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onDone}>
                    Cancel
                </button>
            </div>
        </form>
    );
}
