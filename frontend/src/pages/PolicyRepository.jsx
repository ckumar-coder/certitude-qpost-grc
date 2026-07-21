// PolicyRepository.jsx — Policy & Procedure Repository (A1) page.
// `canManage` (below) is Admin and Risk Manager ONLY — narrower than most
// other modules (no Risk Champion/CRO). Lifecycle transitions
// (Draft/Review/Approve/Publish/Archive) have their own per-transition
// role gates server-side (POLICY_TRANSITIONS in server.js), not fully
// captured by this single flag. See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

const CATEGORIES = ['Governance', 'Finance', 'HR', 'IT', 'Compliance', 'Operations', 'Risk', 'BCM'];
const REVIEW_FREQUENCIES = ['Quarterly', 'Annual', 'Biennial'];

function statusBadgeClass(status) {
    switch (status) {
        case 'Draft':
            return 'badge-role';
        case 'Under Review':
            return 'badge-medium';
        case 'Approved':
            return 'badge-high';
        case 'Published':
            return 'badge-approved';
        case 'Archived':
            return 'badge-pending';
        default:
            return 'badge-role';
    }
}

// Forward transitions a user can request from the current status. The
// server re-validates role permissions (Approve/Publish/Archive = Admin).
const FORWARD_TRANSITIONS = {
    Draft: ['Under Review'],
    'Under Review': ['Approved', 'Draft'],
    Approved: ['Published', 'Draft'],
    Published: ['Archived'],
    Archived: [],
};

export default function PolicyRepository() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const canManage = role === 'Admin' || role === 'Risk Manager';

    const [policies, setPolicies] = useState([]);
    const [allRisks, setAllRisks] = useState([]);
    const [allControls, setAllControls] = useState([]);
    const [allObligations, setAllObligations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [attestations, setAttestations] = useState({}); // policyId -> {attested, outstanding}
    const [myAttestations, setMyAttestations] = useState(new Set());

    const [allUsers, setAllUsers] = useState([]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const calls = [api.get('/policies')];
            if (canManage) {
                calls.push(api.get('/risks'), api.get('/controls'), api.get('/obligations'), api.get('/users'));
            }
            const [policyData, riskData, controlData, obligationData, userData] = await Promise.all(calls);
            setPolicies(policyData);
            if (riskData) setAllRisks(riskData);
            if (controlData) setAllControls(controlData);
            if (obligationData) setAllObligations(obligationData);
            if (userData) setAllUsers(userData);
        } catch (e) {
            setError(e.message || 'Failed to load Policy Repository');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadAttestations(policyId) {
        try {
            const result = await api.get(`/policies/${policyId}/attestations`);
            setAttestations((a) => ({ ...a, [policyId]: result }));
        } catch (e) {
            setError(e.message || 'Failed to load attestations');
        }
    }

    async function handleTransition(policy, status) {
        try {
            await api.post(`/policies/${policy.id}/transition`, { status });
            await load();
        } catch (e) {
            setError(e.message || 'Failed to update status');
        }
    }

    async function handleNewVersion(policy) {
        try {
            await api.post(`/policies/${policy.id}/new-version`);
            await load();
        } catch (e) {
            setError(e.message || 'Failed to create new version');
        }
    }

    async function handleAttest(policy) {
        try {
            await api.post(`/policies/${policy.id}/attest`);
            setMyAttestations((s) => new Set(s).add(policy.id));
        } catch (e) {
            setError(e.message || 'Failed to record attestation');
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('policies_title')}</h1>
                    <p className="page-subtitle">{t('policies_subtitle')}</p>
                </div>
                {canManage && (
                    <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
                        {showForm ? 'Close' : '+ New Policy'}
                    </button>
                )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <NewPolicyForm
                    allRisks={allRisks}
                    allControls={allControls}
                    allObligations={allObligations}
                    allUsers={allUsers}
                    onCreated={() => {
                        setShowForm(false);
                        load();
                    }}
                    onError={setError}
                />
            )}

            <div className="card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 24 }}>Loading…</div>
                ) : policies.length === 0 ? (
                    <div style={{ padding: 24 }} className="text-muted">
                        No policies yet.
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Policy</th>
                                <th>Category</th>
                                <th>Owner / Approver</th>
                                <th>Status</th>
                                <th>Effective / Next Review</th>
                                <th>Attestation</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {policies.map((p) => {
                                const attested = myAttestations.has(p.id);
                                return (
                                    <tr key={p.id}>
                                        <td>
                                            <strong>{p.policy_uid}</strong> (v{p.version})
                                            {p.confidential && <span className="badge badge-high" style={{ marginLeft: 6 }}>Confidential</span>}
                                            <div>{p.name}</div>
                                            {p.description && <div className="text-muted">{p.description}</div>}
                                            {(p.linked_risks.length > 0 || p.linked_controls.length > 0 || (p.linked_obligations || []).length > 0) && (
                                                <div className="text-muted" style={{ marginTop: 4 }}>
                                                    {p.linked_risks.length > 0 && `Risks: ${p.linked_risks.map((r) => r.risk_uid).join(', ')}`}
                                                    {p.linked_risks.length > 0 && p.linked_controls.length > 0 && ' · '}
                                                    {p.linked_controls.length > 0 &&
                                                        `Controls: ${p.linked_controls.map((c) => c.control_uid).join(', ')}`}
                                                    {(p.linked_risks.length > 0 || p.linked_controls.length > 0) && (p.linked_obligations || []).length > 0 && ' · '}
                                                    {(p.linked_obligations || []).length > 0 &&
                                                        `Obligations: ${p.linked_obligations.map((o) => o.obligation_uid).join(', ')}`}
                                                </div>
                                            )}
                                        </td>
                                        <td>{p.category}</td>
                                        <td>
                                            <div>{p.content_owner || '—'}</div>
                                            <div className="text-muted">Approver: {p.approver || '—'}</div>
                                        </td>
                                        <td>
                                            <span className={`badge ${statusBadgeClass(p.status)}`}>{p.status}</span>
                                        </td>
                                        <td>
                                            <div>{p.effective_date || '—'}</div>
                                            <div className="text-muted">{p.next_review_date || '—'}</div>
                                        </td>
                                        <td>
                                            {canManage ? (
                                                attestations[p.id] ? (
                                                    <div className="text-muted">
                                                        {attestations[p.id].attested.length} attested
                                                        <br />
                                                        Outstanding: {attestations[p.id].outstanding.join(', ') || 'none'}
                                                    </div>
                                                ) : p.status === 'Published' ? (
                                                    <button className="btn btn-sm btn-secondary" onClick={() => loadAttestations(p.id)}>
                                                        {p.attestation_count}/{p.total_users} — view
                                                    </button>
                                                ) : (
                                                    '—'
                                                )
                                            ) : p.status === 'Published' ? (
                                                attested ? (
                                                    <span className="badge badge-approved">Attested</span>
                                                ) : (
                                                    <button className="btn btn-sm btn-secondary" onClick={() => handleAttest(p)}>
                                                        I have read this policy
                                                    </button>
                                                )
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td>
                                            {canManage && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {(FORWARD_TRANSITIONS[p.status] || []).map((target) => (
                                                        <button key={target} className="btn btn-sm btn-secondary" onClick={() => handleTransition(p, target)}>
                                                            {target === 'Draft' ? 'Send back to Draft' : target}
                                                        </button>
                                                    ))}
                                                    {['Published', 'Archived'].includes(p.status) && (
                                                        <button className="btn btn-sm btn-secondary" onClick={() => handleNewVersion(p)}>
                                                            New Version
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function NewPolicyForm({ allRisks, allControls, allObligations, allUsers, onCreated, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        name: '',
        category: CATEGORIES[0],
        description: '',
        content_owner: '',
        approver: '',
        review_frequency: 'Annual',
        next_review_date: '',
        confidential: false,
    });
    const [linkRiskIds, setLinkRiskIds] = useState([]);
    const [linkControlIds, setLinkControlIds] = useState([]);
    const [linkObligationIds, setLinkObligationIds] = useState([]);
    const [accessUserIds, setAccessUserIds] = useState([]);

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    function toggleId(list, setList, id) {
        setList((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            await api.post('/policies', {
                ...form,
                next_review_date: form.next_review_date || null,
                link_risk_ids: linkRiskIds,
                link_control_ids: linkControlIds,
                link_obligation_ids: linkObligationIds,
                access_user_ids: form.confidential ? accessUserIds : [],
            });
            onCreated();
        } catch (e) {
            onError(e.message || 'Failed to create policy');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>New Policy (Draft)</h3>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Policy Name</label>
                    <input className="form-control" value={form.name} onChange={(e) => update('name', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Category</label>
                    <select className="form-control" value={form.category} onChange={(e) => update('category', e.target.value)}>
                        {CATEGORIES.map((c) => (
                            <option key={c}>{c}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="form-group">
                <label>Description / Scope</label>
                <textarea className="form-control" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Content Owner</label>
                    <input className="form-control" value={form.content_owner} onChange={(e) => update('content_owner', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Approver</label>
                    <input
                        className="form-control"
                        placeholder="approver@company.com"
                        value={form.approver}
                        onChange={(e) => update('approver', e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label>Review Frequency</label>
                    <select className="form-control" value={form.review_frequency} onChange={(e) => update('review_frequency', e.target.value)}>
                        {REVIEW_FREQUENCIES.map((f) => (
                            <option key={f}>{f}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Next Review Date</label>
                    <input type="date" className="form-control" value={form.next_review_date} onChange={(e) => update('next_review_date', e.target.value)} />
                </div>
            </div>

            {allRisks.length > 0 && (
                <div className="form-group">
                    <label>Linked Risks</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {allRisks.map((r) => (
                            <label key={r.id} className="badge badge-role" style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={linkRiskIds.includes(r.id)}
                                    onChange={() => toggleId(linkRiskIds, setLinkRiskIds, r.id)}
                                    style={{ marginRight: 4 }}
                                />
                                {r.risk_uid}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {allControls.length > 0 && (
                <div className="form-group">
                    <label>Linked Controls</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {allControls.map((c) => (
                            <label key={c.id} className="badge badge-role" style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={linkControlIds.includes(c.id)}
                                    onChange={() => toggleId(linkControlIds, setLinkControlIds, c.id)}
                                    style={{ marginRight: 4 }}
                                />
                                {c.control_uid}: {c.name}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {allObligations.length > 0 && (
                <div className="form-group">
                    <label>Linked Compliance Obligations</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {allObligations.map((o) => (
                            <label key={o.id} className="badge badge-role" style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={linkObligationIds.includes(o.id)}
                                    onChange={() => toggleId(linkObligationIds, setLinkObligationIds, o.id)}
                                    style={{ marginRight: 4 }}
                                />
                                {o.obligation_uid}: {o.regulation_name}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={form.confidential}
                        onChange={(e) => update('confidential', e.target.checked)}
                    />
                    <span><strong>Confidential</strong> — only selected users can see this policy</span>
                </label>
            </div>

            {form.confidential && allUsers.length > 0 && (
                <div className="form-group">
                    <label>Grant access to</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {allUsers.map((u) => (
                            <label key={u.id} className="badge badge-role" style={{ cursor: 'pointer', fontWeight: 600, textTransform: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={accessUserIds.includes(u.id)}
                                    onChange={() => setAccessUserIds((ids) => ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id])}
                                    style={{ marginRight: 4 }}
                                />
                                {u.email}
                            </label>
                        ))}
                    </div>
                    <div className="text-muted" style={{ marginTop: 4 }}>Admins always have access regardless of this setting.</div>
                </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save as Draft'}
            </button>
        </form>
    );
}
