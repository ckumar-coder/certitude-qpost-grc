// ControlLibrary.jsx — Control Library (B2) page.
// Role gating: `canTest` (below) is Admin/Risk Manager/CRO/Consultant CRO
// only — Risk Champion/Owner/Viewer can view controls and test history but
// not record a new test result. Create/edit controls is a broader set
// (see docs/API_REFERENCE.md "Control Library"). See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6 for
// the full audit of this and the other 16 frontend files with local
// capability flags like this one.
import { Fragment, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import DepartmentField from '../components/DepartmentField';
import EvidenceAttachments from '../components/EvidenceAttachments';
import ControlLibraryModal from '../components/ControlLibraryModal';
import { useT } from '../contexts/LanguageContext';

const CONTROL_TYPES = ['Preventive', 'Detective', 'Corrective', 'Directive'];
const AUTOMATION = ['Manual', 'Automated'];
const FREQUENCIES = ['Monthly', 'Quarterly', 'Annual'];
const RESULTS = ['Effective', 'Partially Effective', 'Ineffective', 'Not yet tested'];
const FRAMEWORK_REFS = [
    'ISO 31000', 'ISO 27001', 'COSO ERM', 'COSO ICFR',
    'NIST CSF', 'SOC 2', 'PCI DSS', 'PIPEDA',
    'CIS Controls', 'COBIT 2019', 'OSFI E-21', 'Basel III',
];

function FrameworkRefField({ value, onChange }) {
    const [custom, setCustom] = useState(!FRAMEWORK_REFS.includes(value) && !!value);
    return (
        <div className="form-group">
            <label>Framework Reference</label>
            <select
                className="form-control"
                value={custom ? '__custom__' : (value || '')}
                onChange={(e) => {
                    if (e.target.value === '__custom__') { setCustom(true); onChange(''); }
                    else { setCustom(false); onChange(e.target.value); }
                }}
            >
                <option value="">— None —</option>
                {FRAMEWORK_REFS.map((f) => <option key={f} value={f}>{f}</option>)}
                <option value="__custom__">Other / Custom…</option>
            </select>
            {custom && (
                <input
                    className="form-control"
                    style={{ marginTop: 4 }}
                    placeholder="e.g. COSO Principle 10"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoFocus
                />
            )}
        </div>
    );
}

function resultBadgeClass(result) {
    if (result === 'Effective') return 'badge-approved';
    if (result === 'Partially Effective') return 'badge-pending';
    if (result === 'Ineffective') return 'badge-extreme';
    if (result === 'Not yet tested') return 'badge-role';
    return 'badge-role';
}

function TestHistoryPanel({ control }) {
    const { api } = useAuth();
    const [tests, setTests] = useState(null);
    const [expandedTestId, setExpandedTestId] = useState(null);

    useEffect(() => {
        api.get(`/controls/${control.id}/tests`)
            .then(setTests)
            .catch(() => setTests([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [control.id]);

    if (tests === null) return <div className="text-muted" style={{ fontSize: 12 }}>Loading test history…</div>;
    if (tests.length === 0) return <div className="text-muted" style={{ fontSize: 12 }}>No tests recorded yet.</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tests.map((t) => {
                const expanded = expandedTestId === t.id;
                return (
                    <div key={t.id} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', background: 'var(--color-surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{t.test_date}</span>
                            <span className={`badge ${resultBadgeClass(t.result)}`}>{t.result}</span>
                            <span className="text-muted" style={{ fontSize: 12 }}>{t.test_type}</span>
                            <span className="text-muted" style={{ fontSize: 12 }}>by {t.tested_by}</span>
                            {t.notes && <span className="text-muted" style={{ fontSize: 12 }}>— {t.notes}</span>}
                            <button
                                className="btn btn-sm btn-secondary"
                                style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}
                                onClick={() => setExpandedTestId(expanded ? null : t.id)}
                            >
                                {expanded ? 'Hide Evidence' : 'Evidence'}
                            </button>
                        </div>
                        {expanded && (
                            <div style={{ marginTop: 8 }}>
                                <EvidenceAttachments entityType="control_test" entityId={String(t.id)} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function ControlTable({ controls, onTest, onLink, onEvidence, evidenceControl, historyControl, onHistory }) {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const isBuMode = !!activeCompany?.has_business_units;
    const canTest = role === 'Admin' || role === 'Risk Manager' || role === 'CRO' || role === 'Consultant CRO';
    const [allDepartments, setAllDepartments] = useState([]);
    const [allBus, setAllBus] = useState([]);
    useEffect(() => {
        api.get('/departments').then((d) => setAllDepartments(d || [])).catch(() => {});
        if (isBuMode) api.get('/business-units').then((b) => setAllBus(b || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBuMode]);
    return (
        <table>
            <thead>
                <tr>
                    <th>{t('control_id')}</th>
                    <th>{t('control_type')}</th>
                    <th>{t('col_owner')}</th>
                    <th>Business Unit</th>
                    <th>Created By</th>
                    <th>Assigned To</th>
                    <th>{t('last_tested')}</th>
                    <th>{t('effectiveness')}</th>
                    <th>Linked Risks</th>
                    <th>{t('col_actions')}</th>
                </tr>
            </thead>
            <tbody>
                {controls.map((c) => {
                    const showEvidence = evidenceControl === c.id;
                    const showHistory = historyControl === c.id;
                    return (
                        <Fragment key={c.id}>
                            <tr>
                                <td>
                                    <strong>{c.control_uid}</strong>
                                    <div>{c.name}</div>
                                    {c.description && <div className="text-muted">{c.description}</div>}
                                </td>
                                <td>
                                    {c.control_type}
                                    <div className="text-muted">{c.automation}</div>
                                </td>
                                <td>{c.owner || '—'}</td>
                                {(() => {
                                    const dept = allDepartments.find((d) => d.code === c.department || d.name === c.department);
                                    const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                    return <td className="text-muted">{bu ? bu.name : (dept ? dept.name : (c.department || 'Enterprise-wide'))}</td>;
                                })()}
                                <td className="text-muted">{allDepartments.find((d) => d.code === c.department || d.name === c.department)?.name || c.department || 'Enterprise-wide'}</td>
                                <td>
                                    {c.owner_department ? (
                                        <span className="badge badge-role">{allDepartments.find((d) => d.code === c.owner_department || d.name === c.owner_department)?.name || c.owner_department}</span>
                                    ) : (
                                        <span className="text-muted">—</span>
                                    )}
                                </td>
                                <td>
                                    {c.testing_frequency}
                                    {c.last_test_date && <div className="text-muted">Last: {c.last_test_date}</div>}
                                </td>
                                <td>
                                    <span className={`badge ${resultBadgeClass(c.last_test_result)}`}>{c.last_test_result}</span>
                                    {c.open_issues_count > 0 && (
                                        <div className="text-muted" style={{ marginTop: 4 }}>
                                            {c.open_issues_count} open issue{c.open_issues_count > 1 ? 's' : ''}
                                        </div>
                                    )}
                                </td>
                                <td>
                                    {c.linked_risks.length === 0
                                        ? '—'
                                        : c.linked_risks.map((r) => r.risk_uid).join(', ')}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {canTest && (
                                            <button className="btn btn-sm btn-secondary" onClick={() => onTest(c)}>
                                                Record Test
                                            </button>
                                        )}
                                        <button className="btn btn-sm btn-secondary" onClick={() => onLink(c)}>
                                            Link to Risk
                                        </button>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => onHistory(showHistory ? null : c.id)}
                                        >
                                            {showHistory ? 'Hide History' : 'Test History'}
                                        </button>
                                        {canTest && (
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => onEvidence(showEvidence ? null : c.id)}
                                            >
                                                {showEvidence ? 'Hide Docs' : 'Documents'}
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                            {showHistory && (
                                <tr>
                                    <td colSpan={9} style={{ background: 'var(--color-bg)', padding: '8px 16px' }}>
                                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Test History — {c.control_uid}</div>
                                        <TestHistoryPanel control={c} />
                                    </td>
                                </tr>
                            )}
                            {showEvidence && (
                                <tr>
                                    <td colSpan={9} style={{ background: 'var(--color-bg)', padding: '8px 16px' }}>
                                        <EvidenceAttachments entityType="control" entityId={c.control_uid} />
                                    </td>
                                </tr>
                            )}
                        </Fragment>
                    );
                })}
            </tbody>
        </table>
    );
}

export default function ControlLibrary() {
    const { api } = useAuth();
    const t = useT();
    const [controls, setControls] = useState([]);
    const [allRisks, setAllRisks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [showControlLibrary, setShowControlLibrary] = useState(false);
    const [testingControl, setTestingControl] = useState(null);
    const [linkingControl, setLinkingControl] = useState(null);
    const [selectedRiskId, setSelectedRiskId] = useState('');
    const [evidenceControl, setEvidenceControl] = useState(null);
    const [historyControl, setHistoryControl] = useState(null);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [ctrlData, riskData] = await Promise.all([api.get('/controls'), api.get('/risks')]);
            setControls(ctrlData);
            setAllRisks(riskData);
        } catch (e) {
            setError(e.message || 'Failed to load Control Library');
        } finally {
            setLoading(false);
        }
    }

    async function handleLinkToRisk(control) {
        if (!selectedRiskId) return;
        try {
            await api.post(`/controls/${control.id}/link-risk`, { risk_id: parseInt(selectedRiskId) });
            setLinkingControl(null);
            setSelectedRiskId('');
            await load();
        } catch (e) {
            setError(e.message || 'Failed to link control to risk');
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const myControls      = controls.filter((c) => !c.assigned_to_my_team);
    const assignedToMe    = controls.filter((c) => c.assigned_to_my_team);
    const hasAssigned     = assignedToMe.length > 0;

    const tableProps = {
        onTest:        setTestingControl,
        onLink:        (c) => { setLinkingControl(c); setSelectedRiskId(''); },
        onEvidence:    setEvidenceControl,
        evidenceControl,
        historyControl,
        onHistory:     setHistoryControl,
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('controls_title')}</h1>
                    <p className="page-subtitle">{t('controls_subtitle')}</p>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-secondary" onClick={() => setShowControlLibrary(true)}>
                        📚 Control Reference Library
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
                        {showForm ? 'Close' : t('add_control_btn')}
                    </button>
                </div>
            </div>

            {showControlLibrary && (
                <ControlLibraryModal onClose={() => setShowControlLibrary(false)} />
            )}

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <NewControlForm
                    onCreated={() => { setShowForm(false); load(); }}
                    onError={setError}
                />
            )}

            {testingControl && (
                <TestForm
                    control={testingControl}
                    onDone={() => { setTestingControl(null); load(); }}
                    onError={setError}
                />
            )}

            {linkingControl && (
                <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>Link {linkingControl.control_uid} to risk:</strong>
                    <select className="form-control" style={{ maxWidth: 300 }} value={selectedRiskId} onChange={(e) => setSelectedRiskId(e.target.value)}>
                        <option value="">— Select risk —</option>
                        {allRisks.filter((r) => !linkingControl.linked_risks?.find((lr) => lr.risk_id === r.id)).map((r) => (
                            <option key={r.id} value={r.id}>{r.risk_uid}: {r.risk_detail?.substring(0, 60)}</option>
                        ))}
                    </select>
                    <button className="btn btn-sm btn-primary" disabled={!selectedRiskId} onClick={() => handleLinkToRisk(linkingControl)}>Link</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => { setLinkingControl(null); setSelectedRiskId(''); }}>Cancel</button>
                </div>
            )}

            {loading ? (
                <div className="card" style={{ padding: 24 }}>{t('loading')}</div>
            ) : controls.length === 0 ? (
                <div className="card" style={{ padding: 24 }} >
                    <span className="text-muted">{t('no_controls')}</span>
                </div>
            ) : (
                <>
                    {/* My team's controls */}
                    {myControls.length > 0 && (
                        <>
                            {hasAssigned && (
                                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '16px 0 8px', color: 'var(--color-text-muted)' }}>
                                    My Team's Controls
                                </h2>
                            )}
                            <div className="card" style={{ padding: 0 }}>
                                <ControlTable controls={myControls} {...tableProps} />
                            </div>
                        </>
                    )}

                    {/* Controls assigned to my department by another department */}
                    {hasAssigned && (
                        <>
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '24px 0 8px', color: 'var(--color-text-muted)' }}>
                                Assigned to My Team
                                <span style={{ marginLeft: 8, fontSize: '0.85rem', fontWeight: 400 }}>
                                    — controls created by another department where your team is responsible for execution
                                </span>
                            </h2>
                            <div className="card" style={{ padding: 0 }}>
                                <ControlTable controls={assignedToMe} {...tableProps} />
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function NewControlForm({ onCreated, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [previewId, setPreviewId] = useState('');
    const [form, setForm] = useState({
        name: '',
        description: '',
        control_type: 'Preventive',
        automation: 'Manual',
        owner: '',
        testing_frequency: 'Quarterly',
        evidence_required: '',
        framework_reference: '',
        department: '',
        owner_department: '',
    });

    useEffect(() => {
        const dept = form.department || 'GEN';
        api.get(`/controls/next-id?department=${encodeURIComponent(dept)}`)
            .then((d) => setPreviewId(d.next_id || ''))
            .catch(() => {});
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
            await api.post('/controls', form);
            onCreated();
        } catch (e) {
            onError(e.message || 'Failed to create control');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>New Control</h3>
            <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Name</label>
                    <input className="form-control" value={form.name} onChange={(e) => update('name', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Owner</label>
                    <input className="form-control" value={form.owner} onChange={(e) => update('owner', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>Control ID</label>
                    <input
                        className="form-control"
                        value={previewId || 'Generating…'}
                        readOnly
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: 'default' }}
                    />
                </div>
            </div>
            <div className="form-row">
                <DepartmentField label="Created By (Department)" value={form.department} onChange={(v) => update('department', v)} twoFields />
                <DepartmentField label="Assigned To (Department)" value={form.owner_department} onChange={(v) => update('owner_department', v)} twoFields />
            </div>
            {form.owner_department && form.owner_department !== form.department && (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                    This control will appear in the <strong>{form.owner_department}</strong> team's "Assigned to My Team" queue.
                </div>
            )}
            <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Control Type</label>
                    <select className="form-control" value={form.control_type} onChange={(e) => update('control_type', e.target.value)}>
                        {CONTROL_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Automation</label>
                    <select className="form-control" value={form.automation} onChange={(e) => update('automation', e.target.value)}>
                        {AUTOMATION.map((a) => <option key={a}>{a}</option>)}
                    </select>
                </div>
                <div className="form-group">
                    <label>Testing Frequency</label>
                    <select className="form-control" value={form.testing_frequency} onChange={(e) => update('testing_frequency', e.target.value)}>
                        {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Evidence Required</label>
                    <input
                        className="form-control"
                        placeholder="e.g. signed reconciliation, screenshot"
                        value={form.evidence_required}
                        onChange={(e) => update('evidence_required', e.target.value)}
                    />
                </div>
                <FrameworkRefField value={form.framework_reference} onChange={(v) => update('framework_reference', v)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save Control'}
            </button>
        </form>
    );
}

const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

function TestForm({ control, onDone, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [createdIssue, setCreatedIssue] = useState(null);
    const [testId, setTestId] = useState(null);
    const [evidenceFile, setEvidenceFile] = useState(null);
    const [evidenceError, setEvidenceError] = useState('');
    const fileRef = useRef(null);
    const [form, setForm] = useState({
        test_type: 'Self-Test',
        test_date: new Date().toISOString().slice(0, 10),
        result: 'Effective',
        notes: '',
        remediation_plan: '',
        remediation_owner: control.owner || '',
        remediation_due_date: '',
    });

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
    }

    function handleFileChange(e) {
        const file = e.target.files?.[0] || null;
        if (file && file.size > MAX_EVIDENCE_BYTES) {
            setEvidenceError(`File too large — maximum is 2 MB.`);
            setEvidenceFile(null);
            if (fileRef.current) fileRef.current.value = '';
        } else {
            setEvidenceError('');
            setEvidenceFile(file);
        }
    }

    async function uploadEvidence(tid, file) {
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        await api.post(`/evidence/control_test/${tid}`, {
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_data: base64,
            file_size_bytes: file.size,
        });
    }

    const needsRemediation = form.result !== 'Effective' && form.result !== 'Not yet tested';
    const remediationComplete = form.remediation_plan.trim() && form.remediation_owner.trim() && form.remediation_due_date;

    async function handleSubmit(e) {
        e.preventDefault();
        if (needsRemediation && !remediationComplete) {
            onError('A Remediation Action Plan (with owner and due date) is required before you can submit a Partially Effective or Ineffective result.');
            return;
        }
        setSubmitting(true);
        onError('');
        try {
            const result = await api.post(`/controls/${control.id}/test`, form);
            if (evidenceFile) {
                try { await uploadEvidence(result.test_id, evidenceFile); } catch (_) { /* non-fatal */ }
            }
            if (result.created_issue) {
                setCreatedIssue(result.created_issue);
                setTestId(result.test_id);
            } else {
                onDone();
            }
        } catch (e) {
            onError(e.message || 'Failed to record test');
        } finally {
            setSubmitting(false);
        }
    }

    if (createdIssue) {
        return (
            <div className="card">
                <h3 style={{ marginTop: 0 }}>Test recorded</h3>
                <div className="alert alert-info">
                    Result <strong>{form.result}</strong> automatically logged <strong>{createdIssue.issue_uid}</strong> in the
                    Issues &amp; Actions Tracker, linked to {control.control_uid}, with the remediation plan you entered
                    (owner: {createdIssue.owner}, due {createdIssue.due_date}).
                </div>
                {testId && <EvidenceAttachments entityType="control_test" entityId={String(testId)} />}
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onDone}>Done</button>
            </div>
        );
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>
                Record Test — {control.control_uid}: {control.name}
            </h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Test Type</label>
                    <select className="form-control" value={form.test_type} onChange={(e) => update('test_type', e.target.value)}>
                        <option value="Self-Test">Self-Test (operational)</option>
                        <option value="Internal Audit">Internal Audit (independent sample)</option>
                    </select>
                </div>
                <div className="form-group">
                    <label>Test Date</label>
                    <input type="date" className="form-control" value={form.test_date} onChange={(e) => update('test_date', e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>Result</label>
                    <select className="form-control" value={form.result} onChange={(e) => update('result', e.target.value)}>
                        {RESULTS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                </div>
            </div>
            <div className="form-group">
                <label>Notes</label>
                <textarea className="form-control" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
            </div>
            {needsRemediation && (
                <div className="alert alert-info">
                    <strong>Remediation Action Plan required.</strong> Marking this control {form.result.toLowerCase()} will
                    automatically log an issue in the Issues &amp; Actions Tracker, pre-filled with the plan below.
                    <div className="form-row" style={{ marginTop: 12, marginBottom: 0 }}>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Remediation Action Plan</label>
                            <textarea
                                className="form-control"
                                rows={2}
                                value={form.remediation_plan}
                                onChange={(e) => update('remediation_plan', e.target.value)}
                                required={needsRemediation}
                                placeholder="What will be done to fix this?"
                            />
                        </div>
                        <div className="form-group">
                            <label>Owner</label>
                            <input
                                className="form-control"
                                value={form.remediation_owner}
                                onChange={(e) => update('remediation_owner', e.target.value)}
                                required={needsRemediation}
                                placeholder="owner@company.com"
                            />
                        </div>
                        <div className="form-group">
                            <label>Due Date</label>
                            <input
                                type="date"
                                className="form-control"
                                value={form.remediation_due_date}
                                onChange={(e) => update('remediation_due_date', e.target.value)}
                                required={needsRemediation}
                            />
                        </div>
                    </div>
                </div>
            )}
            <div className="form-group">
                <label>Evidence <span className="text-muted" style={{ fontWeight: 400 }}>(optional — attach proof of this test)</span></label>
                <input
                    ref={fileRef}
                    type="file"
                    className="form-control"
                    style={{ fontSize: 13, padding: '4px 8px' }}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.txt,.zip"
                    onChange={handleFileChange}
                />
                {evidenceFile && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Selected: {evidenceFile.name}</div>}
                {evidenceError && <div className="alert alert-error" style={{ marginTop: 4, fontSize: 12 }}>{evidenceError}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting || (needsRemediation && !remediationComplete) || !!evidenceError}>
                    {submitting ? 'Saving…' : 'Record Test'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onDone}>Cancel</button>
            </div>
        </form>
    );
}
