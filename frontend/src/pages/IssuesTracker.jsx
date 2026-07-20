import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../AuthContext';
import EvidenceAttachments from '../components/EvidenceAttachments';
import CascadingDeptSelector from '../components/CascadingDeptSelector';
import { useT } from '../contexts/LanguageContext';

const SOURCE_TYPES = [
    'Self-identified (Control Test)',
    'Self-identified (KRI Breach)',
    'Self-identified (Management Review)',
    'Internal Audit',
    'External Audit',
    'Regulatory',
    'Whistleblower-Ethics',
    'Customer Complaint',
];

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const STATUSES = ['Open', 'In Progress', 'Closed-Remediated', 'Risk Accepted', 'Deferred', 'No Longer Relevant'];

// Action plan statuses (on issue_actions, not on the issue itself)
const ACTION_STATUSES = [
    'Draft', 'Pending Approval', 'Approved',
    'In Progress', 'Completed', 'Verified',
    'Rejected', 'Deferred',
];
const INTERIM_ACTIONS = ['Compensating controls', 'Accept', 'Scores updated', 'No interim action'];

function priorityBadgeClass(priority) {
    switch (priority) {
        case 'Critical':
            return 'badge-extreme';
        case 'High':
            return 'badge-high';
        case 'Medium':
            return 'badge-medium';
        default:
            return 'badge-low';
    }
}

function statusBadgeClass(status) {
    switch (status) {
        case 'Closed-Remediated': return 'badge-approved';
        case 'Risk Accepted':     return 'badge-role';
        case 'In Progress':       return 'badge-medium';
        case 'Deferred':
        case 'No Longer Relevant': return 'badge-pending';
        default:                   return 'badge-high'; // Open
    }
}

function actionStatusBadgeClass(status) {
    switch (status) {
        case 'Verified':           return 'badge-approved';
        case 'Approved':
        case 'Completed':          return 'badge-role';
        case 'In Progress':
        case 'Pending Approval':   return 'badge-medium';
        case 'Rejected':           return 'badge-extreme';
        case 'Deferred':           return 'badge-pending';
        default:                   return 'badge-low'; // Draft
    }
}

export default function IssuesTracker({ onNavigate }) {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isBuMode = !!activeCompany?.has_business_units;

    const [issues, setIssues] = useState([]);
    const [allControls, setAllControls] = useState([]);
    const [allRisks, setAllRisks] = useState([]);
    const [allObligations, setAllObligations] = useState([]);
    const [allKris, setAllKris] = useState([]);
    const [allDepartments, setAllDepartments] = useState([]);
    const [allBus, setAllBus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [statusEditing, setStatusEditing] = useState(null);
    const [editing, setEditing] = useState(null);
    const [evidenceIssue, setEvidenceIssue] = useState(null); // issue_uid whose evidence panel is open
    const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'closed' | 'all'
    const [recurringOnly, setRecurringOnly] = useState(false);
    const [postClosurePrompt, setPostClosurePrompt] = useState(null); // { issue, status }
    const [actionItemsOpenId, setActionItemsOpenId] = useState(null); // issue.id whose action panel is open

    const CLOSED_STATUSES = ['Closed-Remediated', 'Risk Accepted', 'No Longer Relevant'];
    const filteredIssues = issues.filter((i) => {
        if (statusFilter === 'open')   { if (CLOSED_STATUSES.includes(i.status)) return false; }
        else if (statusFilter === 'closed') { if (!CLOSED_STATUSES.includes(i.status)) return false; }
        if (recurringOnly && !i.is_recurring) return false;
        return true;
    });

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [issueData, controlData, riskData, obligationData, kriData, deptData, buData] = await Promise.all([
                api.get('/issues'),
                api.get('/controls'),
                api.get('/risks'),
                api.get('/obligations'),
                api.get('/kris'),
                api.get('/departments').catch(() => []),
                isBuMode ? api.get('/business-units').catch(() => []) : Promise.resolve([]),
            ]);
            setIssues(issueData);
            setAllControls(controlData);
            setAllRisks(riskData);
            setAllObligations(obligationData);
            setAllKris(kriData);
            setAllDepartments(Array.isArray(deptData) ? deptData : []);
            setAllBus(Array.isArray(buData) ? buData : []);
        } catch (e) {
            setError(e.message || 'Failed to load Issues & Actions Tracker');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('issues_title')}</h1>
                    <p className="page-subtitle">{t('issues_subtitle')}</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
                    {showForm ? 'Close' : t('add_issue')}
                </button>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <IssueForm
                    allControls={allControls}
                    allRisks={allRisks}
                    allObligations={allObligations}
                    allKris={allKris}
                    allDepartments={allDepartments}
                    allBus={allBus}
                    isBuMode={isBuMode}
                    onCreated={() => {
                        setShowForm(false);
                        load();
                    }}
                    onError={setError}
                />
            )}

            {editing && (
                <IssueForm
                    issue={editing}
                    allControls={allControls}
                    allRisks={allRisks}
                    allObligations={allObligations}
                    allKris={allKris}
                    allDepartments={allDepartments}
                    allBus={allBus}
                    isBuMode={isBuMode}
                    onCreated={() => {
                        setEditing(null);
                        load();
                    }}
                    onCancel={() => setEditing(null)}
                    onError={setError}
                />
            )}

            {statusEditing && (
                <StatusForm
                    issue={statusEditing}
                    role={role}
                    onDone={(savedStatus) => {
                        const CLOSING = ['Closed-Remediated', 'Risk Accepted'];
                        const closedIssue = statusEditing;
                        setStatusEditing(null);
                        load();
                        if (CLOSING.includes(savedStatus)) {
                            setPostClosurePrompt({ issue: closedIssue, status: savedStatus });
                        }
                    }}
                    onError={setError}
                />
            )}

            {postClosurePrompt && (
                <PostClosurePrompt
                    issue={postClosurePrompt.issue}
                    onNavigate={onNavigate}
                    onDismiss={() => setPostClosurePrompt(null)}
                />
            )}

            {/* Status filter toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([val, label]) => (
                    <button
                        key={val}
                        className={`btn btn-sm ${statusFilter === val ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setStatusFilter(val)}
                    >
                        {label}
                        {val !== 'all' && (
                            <span style={{ marginLeft: 6, opacity: 0.75, fontSize: 11 }}>
                                ({val === 'open'
                                    ? issues.filter((i) => !CLOSED_STATUSES.includes(i.status)).length
                                    : issues.filter((i) =>  CLOSED_STATUSES.includes(i.status)).length})
                            </span>
                        )}
                    </button>
                ))}
                <button
                    className={`btn btn-sm ${recurringOnly ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setRecurringOnly((v) => !v)}
                    style={{ marginLeft: 8 }}
                >
                    🔁 Recurring
                    <span style={{ marginLeft: 6, opacity: 0.75, fontSize: 11 }}>
                        ({issues.filter((i) => i.is_recurring).length})
                    </span>
                </button>
            </div>

            <div className="card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 24 }}>{t('loading')}</div>
                ) : filteredIssues.length === 0 ? (
                    <div style={{ padding: 24 }} className="text-muted">
                        {issues.length === 0 ? t('no_issues') : `No ${statusFilter} issues.`}
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>{t('issue_title_col')}</th>
                                <th>Source</th>
                                <th>Business Unit</th>
                                <th>{t('action_owner')}</th>
                                <th>{t('priority')}</th>
                                <th>{t('col_status')}</th>
                                <th>{t('linked_risk')}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredIssues.map((i) => {
                                const showEvidence = evidenceIssue === i.issue_uid;
                                return (<Fragment key={i.id}>
                                <tr>
                                    <td>
                                        <strong>{i.issue_uid}</strong>
                                        {i.is_recurring && <span className="badge badge-medium" style={{ marginLeft: 8, fontSize: 11 }}>🔁 Recurring</span>}
                                        <div>{i.description}</div>
                                        {i.root_cause && <div className="text-muted">Root cause: {i.root_cause}</div>}
                                        {i.remediation_plan && <div className="text-muted">Plan: {i.remediation_plan}</div>}
                                        {i.status === 'Risk Accepted' && (
                                            <div className="text-muted">
                                                Accepted by {i.accepted_approved_by} (review {i.accepted_review_date}): {i.disposition_rationale}
                                            </div>
                                        )}
                                        {i.status === 'Closed-Remediated' && (
                                            <div className="text-muted">Verified by {i.closure_verified_by}</div>
                                        )}
                                        {i.regulatory_notification_required && (
                                            <div className="text-muted">
                                                ⚠ Regulatory notification required{i.regulatory_notification_deadline ? ` by ${i.regulatory_notification_deadline}` : ''}
                                            </div>
                                        )}
                                    </td>
                                    <td className="text-muted">
                                        {i.source_type}
                                        {i.source_detail && <div>{i.source_detail}</div>}
                                    </td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === i.department || d.name === i.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td>{bu ? bu.name : (dept ? dept.name : (i.department || 'Enterprise-wide'))}</td>;
                                    })()}
                                    <td>
                                        <div>{allDepartments.find((d) => d.code === i.department || d.name === i.department)?.name || i.department || 'Enterprise-wide'}</div>
                                        {i.raised_by_dept && i.raised_by_dept !== i.department && (
                                            <div className="text-muted">Raised by: {allDepartments.find((d) => d.code === i.raised_by_dept || d.name === i.raised_by_dept)?.name || i.raised_by_dept}</div>
                                        )}
                                        <div className="text-muted">{i.due_date || '—'}</div>
                                    </td>
                                    <td>
                                        <span className={`badge ${priorityBadgeClass(i.priority)}`}>{i.priority}</span>
                                    </td>
                                    <td>
                                        <span className={`badge ${statusBadgeClass(i.status)}`}>{i.status}</span>
                                    </td>
                                    <td className="text-muted">
                                        {i.linked_controls.length > 0 && <div>Controls: {i.linked_controls.map((c) => c.control_uid).join(', ')}</div>}
                                        {i.linked_risks.length > 0 && <div>Risks: {i.linked_risks.map((r) => r.risk_uid).join(', ')}</div>}
                                        {i.linked_obligations.length > 0 && (
                                            <div>Obligations: {i.linked_obligations.map((o) => o.obligation_uid).join(', ')}</div>
                                        )}
                                        {i.linked_kris.length > 0 && <div>KRIs: {i.linked_kris.map((k) => k.kri_uid).join(', ')}</div>}
                                        {i.linked_controls.length === 0 &&
                                            i.linked_risks.length === 0 &&
                                            i.linked_obligations.length === 0 &&
                                            i.linked_kris.length === 0 &&
                                            '—'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <button className="btn btn-sm btn-secondary" onClick={() => setEditing(i)}>
                                                Edit
                                            </button>
                                            {!['Closed-Remediated', 'Risk Accepted'].includes(i.status) && (
                                                <button className="btn btn-sm btn-secondary" onClick={() => setStatusEditing(i)}>
                                                    Update Status
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setActionItemsOpenId(actionItemsOpenId === i.id ? null : i.id)}
                                            >
                                                {actionItemsOpenId === i.id ? 'Hide Actions' : 'Action Items'}
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setEvidenceIssue(showEvidence ? null : i.issue_uid)}
                                            >
                                                {showEvidence ? 'Hide Evidence' : 'Evidence'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {actionItemsOpenId === i.id && (
                                    <tr>
                                        <td colSpan={8} style={{ background: 'var(--color-bg)', padding: '8px 16px' }}>
                                            <ActionItemsPanel
                                                issue={i}
                                                allDepartments={allDepartments}
                                                allBus={allBus}
                                                isBuMode={isBuMode}
                                                role={role}
                                                onError={setError}
                                            />
                                        </td>
                                    </tr>
                                )}
                                {showEvidence && (
                                    <tr>
                                        <td colSpan={8} style={{ background: 'var(--color-bg)', padding: '8px 16px' }}>
                                            <EvidenceAttachments entityType="issue" entityId={i.issue_uid} />
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

// Modal that shows a browseable, searchable table of items for linking.
// Rendered via portal directly into document.body to escape form DOM context.
// Maintains its own local selection so Cancel truly cancels.
function PickerModal({ title, items, columns, selected, onConfirm, onClose }) {
    const [query, setQuery] = useState('');
    const [localSelected, setLocalSelected] = useState(new Set(selected));

    // Prevent body scroll while modal is open
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    function toggleItem(id) {
        setLocalSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    const filtered = query.trim().length === 0
        ? items
        : items.filter((item) =>
            columns.some((col) => (col.getValue(item) || '').toLowerCase().includes(query.toLowerCase()))
        );

    const modal = (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={{ background: 'var(--color-card)', borderRadius: 12, width: '90vw', maxWidth: 1000, height: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--color-text-muted)', lineHeight: 1, padding: '0 4px' }}>✕</button>
                </div>

                {/* Search */}
                <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
                    <input
                        className="form-control"
                        placeholder="Search by ID, name, description, department…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* Table — flex: 1 so it fills remaining height, scroll inside */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {filtered.length === 0 ? (
                        <div className="text-muted" style={{ padding: '28px', fontSize: 14 }}>No matches.</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--color-card)', zIndex: 1 }}>
                                <tr>
                                    <th style={{ width: 44, padding: '10px 16px', borderBottom: '2px solid var(--color-border)' }}></th>
                                    {columns.map((col) => (
                                        <th key={col.header} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', borderBottom: '2px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                                            {col.header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((item) => {
                                    const checked = localSelected.has(item.id);
                                    return (
                                        <tr
                                            key={item.id}
                                            onClick={() => toggleItem(item.id)}
                                            style={{ cursor: 'pointer', background: checked ? 'var(--color-primary-bg, #eef2ff)' : 'transparent', borderBottom: '1px solid var(--color-border)' }}
                                        >
                                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                <input type="checkbox" checked={checked} onChange={() => toggleItem(item.id)} onClick={(e) => e.stopPropagation()} style={{ width: 16, height: 16 }} />
                                            </td>
                                            {columns.map((col) => (
                                                <td key={col.header} style={{ padding: '12px 16px', fontSize: 13, verticalAlign: 'top' }}>{col.getValue(item) || '—'}</td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '16px 28px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexShrink: 0 }}>
                    <span className="text-muted" style={{ fontSize: 13, marginRight: 'auto' }}>
                        {localSelected.size} item{localSelected.size !== 1 ? 's' : ''} selected
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={() => onConfirm([...localSelected])}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}

// Chip row + "Link X" button for one category of linked items.
function LinkedSection({ label, buttonLabel, items, selected, getChipLabel, onOpen, onRemove }) {
    const selectedItems = items.filter((item) => selected.includes(item.id));
    return (
        <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: selectedItems.length > 0 ? 8 : 0 }}>
                <label style={{ marginBottom: 0 }}>{label}</label>
                {items.length > 0 && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={onOpen}>
                        {buttonLabel}
                    </button>
                )}
            </div>
            {selectedItems.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selectedItems.map((item) => (
                        <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--color-primary)', color: '#fff', borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                            {getChipLabel(item)}
                            <button type="button" onClick={() => onRemove(item.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 15, lineHeight: 1 }}>×</button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function IssueForm({ issue, allControls, allRisks, allObligations, allKris, allDepartments, allBus = [], isBuMode = false, onCreated, onCancel, onError }) {
    const { api, session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    // User's own department — shown read-only as "Raised By" on new issues
    const userDepts = Array.isArray(activeCompany?.departments) && activeCompany.departments.length > 0
        ? activeCompany.departments
        : activeCompany?.department ? [activeCompany.department] : [];
    const userDept = userDepts[0] || '';

    const [submitting, setSubmitting] = useState(false);
    const isEdit = !!issue;

    // Action items — new rows the user is adding in this form session
    const [actionItems, setActionItems] = useState([]);
    // Existing action items (edit mode only — fetched from DB, shown read-only)
    const [existingActionItems, setExistingActionItems] = useState([]);

    useEffect(() => {
        if (!isEdit) return;
        api.get(`/issues/${issue.id}/actions`).then(setExistingActionItems).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function addActionItem() {
        setActionItems((prev) => [...prev, { _key: Date.now(), description: '', department: userDept, due_date: '' }]);
    }
    function removeActionItem(key) {
        setActionItems((prev) => prev.filter((a) => a._key !== key));
    }
    function updateActionItem(key, field, value) {
        setActionItems((prev) => prev.map((a) => a._key === key ? { ...a, [field]: value } : a));
    }

    const [form, setForm] = useState({
        source_type: issue?.source_type || SOURCE_TYPES[0],
        source_detail: issue?.source_detail || '',
        description: issue?.description || '',
        root_cause: issue?.root_cause || '',
        priority: issue?.priority || 'Medium',
        regulatory_notification_required: issue?.regulatory_notification_required || false,
        regulatory_notification_deadline: issue?.regulatory_notification_deadline || '',
        is_recurring: issue?.is_recurring || false,
    });
    const [linkControlIds, setLinkControlIds] = useState(issue?.linked_controls.map((c) => c.id) || []);
    const [linkRiskIds, setLinkRiskIds] = useState(issue?.linked_risks.map((r) => r.id) || []);
    const [linkObligationIds, setLinkObligationIds] = useState(issue?.linked_obligations.map((o) => o.id) || []);
    const [linkKriIds, setLinkKriIds] = useState(issue?.linked_kris.map((k) => k.id) || []);
    const [pickerOpen, setPickerOpen] = useState(null); // 'controls' | 'risks' | 'obligations' | 'kris'

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
            // Serialise action items — strip local _key, skip blank descriptions
            const serialisedActionItems = actionItems
                .filter((a) => a.description.trim())
                .map(({ description, department, due_date }) => ({
                    description,
                    department: department || null,
                    due_date: due_date || null,
                }));

            const payload = {
                ...form,
                regulatory_notification_deadline: form.regulatory_notification_deadline || null,
                link_control_ids: linkControlIds,
                link_risk_ids: linkRiskIds,
                link_obligation_ids: linkObligationIds,
                link_kri_ids: linkKriIds,
                ...(!isEdit && { raised_by_dept: userDept || null }),
                ...(!isEdit && { action_items: serialisedActionItems }),
                ...(isEdit && serialisedActionItems.length > 0 && { new_action_items: serialisedActionItems }),
            };
            if (isEdit) {
                await api.patch(`/issues/${issue.id}`, payload);
            } else {
                await api.post('/issues', payload);
            }
            onCreated();
        } catch (e) {
            onError(e.message || 'Failed to save issue');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>{isEdit ? `Edit ${issue.issue_uid}` : 'Log New Issue'}</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Source Type</label>
                    <select className="form-control" value={form.source_type} onChange={(e) => update('source_type', e.target.value)}>
                        {SOURCE_TYPES.map((s) => (
                            <option key={s}>{s}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                    <label>Source Detail</label>
                    <input
                        className="form-control"
                        placeholder="Reference to specific test/report/finding"
                        value={form.source_detail}
                        onChange={(e) => update('source_detail', e.target.value)}
                    />
                </div>
            </div>
            <div className="form-group">
                <label>Description</label>
                <textarea className="form-control" rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} required />
            </div>
            <div className="form-group">
                <label>Root Cause</label>
                <textarea className="form-control" rows={2} value={form.root_cause} onChange={(e) => update('root_cause', e.target.value)} />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Raised By (Department)</label>
                    <input
                        className="form-control"
                        value={isEdit ? (issue.raised_by_dept || '—') : (userDept || '—')}
                        disabled
                    />
                    {!isEdit && <div className="text-muted" style={{ marginTop: 4 }}>Auto-filled from your department.</div>}
                </div>
                <div className="form-group">
                    <label>Priority</label>
                    <select className="form-control" value={form.priority} onChange={(e) => update('priority', e.target.value)}>
                        {PRIORITIES.map((p) => (
                            <option key={p}>{p}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>
                        <input
                            type="checkbox"
                            checked={form.is_recurring}
                            onChange={(e) => update('is_recurring', e.target.checked)}
                            style={{ marginRight: 6 }}
                        />
                        Recurring Issue
                    </label>
                    <div className="text-muted" style={{ marginTop: 4 }}>Check if this issue has occurred before or is expected to recur.</div>
                </div>
                <div className="form-group">
                    <label>
                        <input
                            type="checkbox"
                            checked={form.regulatory_notification_required}
                            onChange={(e) => update('regulatory_notification_required', e.target.checked)}
                            style={{ marginRight: 6 }}
                        />
                        Regulatory Notification Required
                    </label>
                </div>
                {form.regulatory_notification_required && (
                    <div className="form-group">
                        <label>Notification Deadline</label>
                        <input
                            type="date"
                            className="form-control"
                            value={form.regulatory_notification_deadline}
                            onChange={(e) => update('regulatory_notification_deadline', e.target.value)}
                        />
                    </div>
                )}
            </div>

            <h3>Action Items</h3>
            <p className="text-muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 13 }}>
                Assign remediation actions to specific departments with individual due dates. Each becomes a tracked action item.
            </p>

            {/* Existing action items in edit mode — read-only summary */}
            {isEdit && existingActionItems.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                    {existingActionItems.map((item) => {
                        const dept = allDepartments.find((d) => d.code === item.department || d.name === item.department);
                        return (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                                <span className={`badge ${actionStatusBadgeClass(item.action_plan_status)}`} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                                    {item.action_plan_status}
                                </span>
                                <span style={{ flex: 1 }}>{item.description}</span>
                                <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                                    {dept?.name || item.department || 'Enterprise-wide'}
                                    {item.due_date ? ` · Due ${item.due_date}` : ''}
                                </span>
                            </div>
                        );
                    })}
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                        To update status on existing action items, use the "Action Items" button in the issues list.
                    </div>
                </div>
            )}

            {/* New action item rows */}
            {actionItems.map((item, idx) => (
                <div key={item._key} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>ACTION ITEM {idx + 1}</span>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => removeActionItem(item._key)} style={{ fontSize: 11, padding: '2px 8px' }}>
                            Remove
                        </button>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>Description *</label>
                        <textarea
                            className="form-control"
                            rows={2}
                            style={{ fontSize: 13 }}
                            placeholder="What action does this department need to take?"
                            value={item.description}
                            onChange={(e) => updateActionItem(item._key, 'description', e.target.value)}
                        />
                    </div>
                    <div className="form-row" style={{ marginBottom: 0 }}>
                        <CascadingDeptSelector
                            value={item.department}
                            onChange={(v) => updateActionItem(item._key, 'department', v)}
                            departments={allDepartments}
                            bus={allBus}
                            isBuMode={isBuMode}
                            label="Action Department"
                            allowEmpty={true}
                            placeholder="Enterprise-wide"
                        />
                        <div className="form-group">
                            <label style={{ fontSize: 12 }}>Due Date</label>
                            <input
                                type="date"
                                className="form-control"
                                style={{ fontSize: 13 }}
                                value={item.due_date}
                                onChange={(e) => updateActionItem(item._key, 'due_date', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            ))}

            <button type="button" className="btn btn-secondary" onClick={addActionItem} style={{ marginBottom: 20 }}>
                + Add Action Item
            </button>

            <h3>Linked Items</h3>
            <LinkedSection label="Controls" buttonLabel="+ Link Control" items={allControls} selected={linkControlIds}
                getChipLabel={(c) => c.control_uid} onOpen={() => setPickerOpen('controls')}
                onRemove={(id) => toggle(linkControlIds, setLinkControlIds, id)} />
            <LinkedSection label="Risks" buttonLabel="+ Link Risk" items={allRisks} selected={linkRiskIds}
                getChipLabel={(r) => r.risk_uid} onOpen={() => setPickerOpen('risks')}
                onRemove={(id) => toggle(linkRiskIds, setLinkRiskIds, id)} />
            <LinkedSection label="Compliance Obligations" buttonLabel="+ Link Obligation" items={allObligations} selected={linkObligationIds}
                getChipLabel={(o) => o.obligation_uid} onOpen={() => setPickerOpen('obligations')}
                onRemove={(id) => toggle(linkObligationIds, setLinkObligationIds, id)} />
            <LinkedSection label="KRIs" buttonLabel="+ Link KRI" items={allKris} selected={linkKriIds}
                getChipLabel={(k) => k.kri_uid} onOpen={() => setPickerOpen('kris')}
                onRemove={(id) => toggle(linkKriIds, setLinkKriIds, id)} />

            {pickerOpen === 'controls' && (
                <PickerModal title="Link Controls" items={allControls} selected={linkControlIds}
                    columns={[
                        { header: 'ID', getValue: (c) => c.control_uid },
                        { header: 'Name', getValue: (c) => c.name },
                        { header: 'Type', getValue: (c) => c.control_type },
                        { header: 'Department', getValue: (c) => c.department || 'Enterprise-wide' },
                    ]}
                    onConfirm={(ids) => { setLinkControlIds(ids); setPickerOpen(null); }}
                    onClose={() => setPickerOpen(null)} />
            )}
            {pickerOpen === 'risks' && (
                <PickerModal title="Link Risks" items={allRisks} selected={linkRiskIds}
                    columns={[
                        { header: 'ID', getValue: (r) => r.risk_uid },
                        { header: 'Description', getValue: (r) => (r.risk_detail || '').substring(0, 90) },
                        { header: 'Department', getValue: (r) => r.department || 'Enterprise-wide' },
                        { header: 'Status', getValue: (r) => r.workflow_status },
                    ]}
                    onConfirm={(ids) => { setLinkRiskIds(ids); setPickerOpen(null); }}
                    onClose={() => setPickerOpen(null)} />
            )}
            {pickerOpen === 'obligations' && (
                <PickerModal title="Link Compliance Obligations" items={allObligations} selected={linkObligationIds}
                    columns={[
                        { header: 'ID', getValue: (o) => o.obligation_uid },
                        { header: 'Regulation', getValue: (o) => o.regulation_name },
                        { header: 'Type', getValue: (o) => o.obligation_type },
                        { header: 'Status', getValue: (o) => o.compliance_status },
                    ]}
                    onConfirm={(ids) => { setLinkObligationIds(ids); setPickerOpen(null); }}
                    onClose={() => setPickerOpen(null)} />
            )}
            {pickerOpen === 'kris' && (
                <PickerModal title="Link KRIs" items={allKris} selected={linkKriIds}
                    columns={[
                        { header: 'ID', getValue: (k) => k.kri_uid },
                        { header: 'Name', getValue: (k) => k.name },
                        { header: 'Department', getValue: (k) => k.department || 'Enterprise-wide' },
                        { header: 'RAG', getValue: (k) => k.current_rag || 'No data' },
                    ]}
                    onConfirm={(ids) => { setLinkKriIds(ids); setPickerOpen(null); }}
                    onClose={() => setPickerOpen(null)} />
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Issue'}
                </button>
                {isEdit && (
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}

// ── Action Items Panel ──────────────────────────────────────────────────────
//
// Renders as an expanded sub-row under an issue. Shows all action items for
// that issue, each with its own 7-step action_plan_status lifecycle.
// Allows creating new items and transitioning statuses with SoD enforcement.

function ActionItemsPanel({ issue, allDepartments, allBus, isBuMode, role, onError }) {
    const { api, session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const currentUserId = session.user?.id || activeCompany?.userId;

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [transitioningId, setTransitioningId] = useState(null); // action item id currently in transition
    const [pendingTransition, setPendingTransition] = useState({}); // { [aid]: { status, interimAction } }
    const [submitting, setSubmitting] = useState(false);
    const [localError, setLocalError] = useState('');

    async function load() {
        setLoading(true);
        try {
            const data = await api.get(`/issues/${issue.id}/actions`);
            setItems(data);
        } catch (e) {
            setLocalError(e.message || 'Failed to load action items');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Determine which status transitions are available for a given action item
    function allowedTransitions(item) {
        const TRANSITIONS = {
            'Draft':             [{ to: 'Pending Approval', label: 'Submit for Approval' }],
            'Pending Approval':  [
                { to: 'Approved', label: 'Approve' },
                { to: 'Draft',    label: 'Return to Draft' },
            ],
            'Approved':    [
                { to: 'In Progress', label: 'Mark In Progress' },
                { to: 'Rejected',    label: 'Reject',  needsInterim: true },
                { to: 'Deferred',    label: 'Defer',   needsInterim: true },
            ],
            'In Progress': [
                { to: 'Completed',   label: 'Mark Completed' },
                { to: 'Rejected',    label: 'Reject',  needsInterim: true },
                { to: 'Deferred',    label: 'Defer',   needsInterim: true },
            ],
            'Completed':   [
                { to: 'Verified',    label: 'Verify' },
                { to: 'Rejected',    label: 'Reject',  needsInterim: true },
                { to: 'Deferred',    label: 'Defer',   needsInterim: true },
            ],
            'Verified':    [],
            'Rejected':    [{ to: 'Draft', label: 'Return to Draft' }],
            'Deferred':    [{ to: 'Draft', label: 'Return to Draft' }],
        };
        let allowed = TRANSITIONS[item.action_plan_status] || [];
        // Client-side SoD hints (server enforces authoritatively)
        if (item.action_plan_status === 'Pending Approval') {
            // Approver cannot be creator
            allowed = allowed.map((t) =>
                t.to === 'Approved' && item.created_by && currentUserId === item.created_by
                    ? { ...t, disabled: true, disabledReason: 'You created this item — approval requires another person.' }
                    : t
            );
        }
        if (item.action_plan_status === 'Completed') {
            // Verifier cannot be creator or approver
            allowed = allowed.map((t) => {
                if (t.to !== 'Verified') return t;
                if (item.created_by && currentUserId === item.created_by) {
                    return { ...t, disabled: true, disabledReason: 'You created this item — verification requires another person.' };
                }
                if (item.approved_by && currentUserId === item.approved_by) {
                    return { ...t, disabled: true, disabledReason: 'You approved this item — verification requires a third person.' };
                }
                return t;
            });
        }
        return allowed;
    }

    async function doTransition(item, toStatus) {
        const pt = pendingTransition[item.id] || {};
        const needsInterim = toStatus === 'Rejected' || toStatus === 'Deferred';
        if (needsInterim && !pt.interimAction) {
            setLocalError('Please select an interim action before saving.');
            return;
        }
        setSubmitting(true);
        setLocalError('');
        try {
            const payload = { status: toStatus };
            if (needsInterim) payload.interim_action = pt.interimAction;
            await api.post(`/issues/${issue.id}/actions/${item.id}/status`, payload);
            setTransitioningId(null);
            setPendingTransition((p) => { const n = { ...p }; delete n[item.id]; return n; });
            await load();
        } catch (e) {
            setLocalError(e.message || 'Failed to update action item status');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleCreate(formData) {
        setSubmitting(true);
        setLocalError('');
        try {
            await api.post(`/issues/${issue.id}/actions`, formData);
            setShowAdd(false);
            await load();
        } catch (e) {
            setLocalError(e.message || 'Failed to create action item');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(item) {
        if (!window.confirm('Delete this action item?')) return;
        try {
            await api.delete(`/issues/${issue.id}/actions/${item.id}`);
            await load();
        } catch (e) {
            setLocalError(e.message || 'Failed to delete action item');
        }
    }

    const canEdit = ['Admin', 'Risk Manager', 'Risk Champion', 'Risk Owner', 'CRO'].includes(role);

    return (
        <div style={{ padding: '12px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontSize: 14 }}>Action Items — {issue.issue_uid}</strong>
                {canEdit && (
                    <button className="btn btn-sm btn-primary" onClick={() => setShowAdd((s) => !s)}>
                        {showAdd ? 'Cancel' : '+ Add Action Item'}
                    </button>
                )}
            </div>

            {localError && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 13 }}>{localError}</div>}

            {showAdd && (
                <AddActionItemForm
                    allDepartments={allDepartments}
                    allBus={allBus}
                    isBuMode={isBuMode}
                    submitting={submitting}
                    onSubmit={handleCreate}
                    onCancel={() => setShowAdd(false)}
                />
            )}

            {loading ? (
                <div className="text-muted" style={{ fontSize: 13 }}>Loading action items…</div>
            ) : items.length === 0 && !showAdd ? (
                <div className="text-muted" style={{ fontSize: 13 }}>
                    No action items yet.{canEdit ? ' Use "Add Action Item" to assign departments.' : ''}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((item) => {
                        const transitions = allowedTransitions(item);
                        const isTransitioning = transitioningId === item.id;
                        const pt = pendingTransition[item.id] || {};
                        const dept = allDepartments.find((d) => d.code === item.department || d.name === item.department);
                        const deptName = dept?.name || item.department || 'Enterprise-wide';
                        const bu = isBuMode && item.business_unit_name ? item.business_unit_name : null;

                        return (
                            <div key={item.id} style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                    {/* Status badge */}
                                    <span className={`badge ${actionStatusBadgeClass(item.action_plan_status)}`} style={{ whiteSpace: 'nowrap', marginTop: 2 }}>
                                        {item.action_plan_status}
                                    </span>

                                    {/* Main content */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
                                            {bu ? `${bu} → ${deptName}` : deptName}
                                            {item.due_date && <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>Due {item.due_date}</span>}
                                        </div>
                                        <div style={{ fontSize: 13, marginBottom: 4 }}>{item.description}</div>
                                        <div className="text-muted" style={{ fontSize: 12 }}>
                                            {item.assigned_to_name && <span>Assigned to {item.assigned_to_name} · </span>}
                                            {item.created_by_name && <span>Created by {item.created_by_name}</span>}
                                            {item.approved_by_name && <span> · Approved by {item.approved_by_name}</span>}
                                            {item.verified_by_name && <span> · Verified by {item.verified_by_name}</span>}
                                        </div>
                                        {(item.action_plan_status === 'Rejected' || item.action_plan_status === 'Deferred') && item.interim_action && (
                                            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                                                Interim arrangement: <strong>{item.interim_action}</strong>
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    {canEdit && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                                            {item.action_plan_status === 'Draft' && (
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => handleDelete(item)}
                                                    style={{ fontSize: 11 }}
                                                >
                                                    Delete
                                                </button>
                                            )}
                                            {transitions.length > 0 && !isTransitioning && (
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => setTransitioningId(item.id)}
                                                    style={{ fontSize: 11 }}
                                                >
                                                    Update Status
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Inline status transition UI */}
                                {isTransitioning && canEdit && (
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-muted)' }}>
                                            TRANSITION STATUS
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {transitions.map((t) => (
                                                <div key={t.to}>
                                                    {t.needsInterim && pt.targetStatus === t.to && (
                                                        <div className="alert alert-info" style={{ marginBottom: 6, padding: '8px 12px' }}>
                                                            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                                                                Interim arrangement *
                                                            </label>
                                                            <select
                                                                className="form-control"
                                                                style={{ fontSize: 12 }}
                                                                value={pt.interimAction || ''}
                                                                onChange={(e) => setPendingTransition((p) => ({
                                                                    ...p,
                                                                    [item.id]: { ...p[item.id], interimAction: e.target.value },
                                                                }))}
                                                            >
                                                                <option value="">— Select interim action —</option>
                                                                {INTERIM_ACTIONS.map((a) => <option key={a}>{a}</option>)}
                                                            </select>
                                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                                                Select the interim measure while this action item is {t.to.toLowerCase()}.
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                                                <button
                                                                    className="btn btn-sm btn-primary"
                                                                    disabled={submitting || !pt.interimAction}
                                                                    onClick={() => doTransition(item, t.to)}
                                                                    style={{ fontSize: 11 }}
                                                                >
                                                                    {submitting ? 'Saving…' : `Confirm ${t.label}`}
                                                                </button>
                                                                <button
                                                                    className="btn btn-sm btn-secondary"
                                                                    onClick={() => setPendingTransition((p) => ({
                                                                        ...p,
                                                                        [item.id]: { ...p[item.id], targetStatus: null, interimAction: '' },
                                                                    }))}
                                                                    style={{ fontSize: 11 }}
                                                                >
                                                                    Back
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {!(t.needsInterim && pt.targetStatus === t.to) && (
                                                        <button
                                                            className={`btn btn-sm ${t.to === 'Approved' || t.to === 'Verified' || t.to === 'In Progress' || t.to === 'Completed' ? 'btn-primary' : t.to === 'Rejected' ? 'btn-danger' : 'btn-secondary'}`}
                                                            disabled={t.disabled || submitting}
                                                            title={t.disabledReason || ''}
                                                            onClick={() => {
                                                                if (t.needsInterim) {
                                                                    setPendingTransition((p) => ({
                                                                        ...p,
                                                                        [item.id]: { ...p[item.id], targetStatus: t.to, interimAction: '' },
                                                                    }));
                                                                } else {
                                                                    doTransition(item, t.to);
                                                                }
                                                            }}
                                                            style={{ fontSize: 11 }}
                                                        >
                                                            {submitting && !t.needsInterim ? 'Saving…' : t.label}
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => { setTransitioningId(null); setPendingTransition((p) => { const n = { ...p }; delete n[item.id]; return n; }); }}
                                                style={{ fontSize: 11 }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function AddActionItemForm({ allDepartments, allBus, isBuMode, submitting, onSubmit, onCancel }) {
    const { session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const userDepts = Array.isArray(activeCompany?.departments) && activeCompany.departments.length > 0
        ? activeCompany.departments : activeCompany?.department ? [activeCompany.department] : [];
    const defaultDept = userDepts[0] || '';

    const [form, setForm] = useState({
        description: '',
        department: defaultDept,
        due_date: '',
        assigned_to: '',
    });

    function update(field, val) { setForm((f) => ({ ...f, [field]: val })); }

    function handleSubmit(e) {
        e.preventDefault();
        if (!form.description.trim()) return;
        onSubmit({
            description: form.description,
            department: form.department || null,
            due_date: form.due_date || null,
            assigned_to: form.assigned_to || null,
        });
    }

    return (
        <form
            onSubmit={handleSubmit}
            style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}
        >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>New Action Item</div>
            <div className="form-group">
                <label style={{ fontSize: 12 }}>Description *</label>
                <textarea
                    className="form-control"
                    rows={2}
                    style={{ fontSize: 13 }}
                    value={form.description}
                    onChange={(e) => update('description', e.target.value)}
                    required
                    placeholder="What action does this department need to take?"
                />
            </div>
            <div className="form-row">
                <CascadingDeptSelector
                    value={form.department}
                    onChange={(v) => update('department', v)}
                    departments={allDepartments}
                    bus={allBus}
                    isBuMode={isBuMode}
                    twoFields={true}
                    allowEmpty={true}
                    placeholder="Enterprise-wide"
                    deptLabel="Action Department"
                />
                <div className="form-group">
                    <label style={{ fontSize: 12 }}>Due Date</label>
                    <input type="date" className="form-control" style={{ fontSize: 13 }} value={form.due_date} onChange={(e) => update('due_date', e.target.value)} />
                </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="submit" className="btn btn-sm btn-primary" disabled={submitting || !form.description.trim()}>
                    {submitting ? 'Saving…' : 'Add Item'}
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}

function PostClosurePrompt({ issue, onNavigate, onDismiss }) {
    const hasLinkedRisks = issue.linked_risks && issue.linked_risks.length > 0;

    const modal = (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
        >
            <div
                style={{ background: 'var(--color-card)', borderRadius: 12, width: 500, maxWidth: '90vw', padding: '28px 32px', boxShadow: '0 16px 48px rgba(0,0,0,0.3)' }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <h3 style={{ marginTop: 0, marginBottom: 12 }}>Risk Register Review</h3>
                {hasLinkedRisks ? (
                    <>
                        <p style={{ marginBottom: 8 }}>
                            <strong>{issue.issue_uid}</strong> is linked to the following risk{issue.linked_risks.length > 1 ? 's' : ''}:
                        </p>
                        <ul style={{ margin: '0 0 14px', paddingLeft: 20 }}>
                            {issue.linked_risks.map((r) => (
                                <li key={r.id} style={{ marginBottom: 4 }}>
                                    <strong>{r.risk_uid}</strong>
                                </li>
                            ))}
                        </ul>
                        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                            Now that this issue is closed, consider reviewing the linked risk{issue.linked_risks.length > 1 ? 's' : ''} — likelihood, impact scores, or lifecycle status may need updating.
                        </p>
                    </>
                ) : (
                    <>
                        <p style={{ marginBottom: 8 }}>
                            <strong>{issue.issue_uid}</strong> was closed with no linked risks.
                        </p>
                        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                            If the root cause relates to an existing risk, consider reviewing the Risk Register and updating the relevant risk ratings or lifecycle status.
                        </p>
                    </>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary" onClick={onDismiss}>
                        Dismiss
                    </button>
                    {onNavigate && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => { onDismiss(); onNavigate('risks'); }}
                        >
                            Go to Risk Register
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}

function StatusForm({ issue, onDone, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState(issue.status);
    const [dispositionRationale, setDispositionRationale] = useState('');
    const [acceptedApprovedBy, setAcceptedApprovedBy] = useState('');
    const [acceptedReviewDate, setAcceptedReviewDate] = useState('');
    const [closureVerifiedBy, setClosureVerifiedBy] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        try {
            const payload = { status };
            if (status === 'Risk Accepted') {
                payload.disposition_rationale = dispositionRationale;
                payload.accepted_approved_by = acceptedApprovedBy;
                payload.accepted_review_date = acceptedReviewDate;
            }
            if (status === 'Closed-Remediated') {
                payload.closure_verified_by = closureVerifiedBy;
            }
            await api.post(`/issues/${issue.id}/status`, payload);
            onDone(status);
        } catch (e) {
            onError(e.message || 'Failed to update status');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>Update Status — {issue.issue_uid}</h3>
            <div className="form-group">
                <label>Status</label>
                <select className="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
            </div>

            {status === 'Risk Accepted' && (
                <div className="alert alert-info">
                    <div className="form-group">
                        <label>Disposition Rationale</label>
                        <textarea className="form-control" rows={2} value={dispositionRationale} onChange={(e) => setDispositionRationale(e.target.value)} required />
                    </div>
                    <div className="form-row" style={{ marginBottom: 0 }}>
                        <div className="form-group">
                            <label>Approved By (must be an Admin, other than the owner)</label>
                            <input className="form-control" placeholder="admin@company.com" value={acceptedApprovedBy} onChange={(e) => setAcceptedApprovedBy(e.target.value)} required />
                        </div>
                        <div className="form-group">
                            <label>Review Date</label>
                            <input type="date" className="form-control" value={acceptedReviewDate} onChange={(e) => setAcceptedReviewDate(e.target.value)} required />
                        </div>
                    </div>
                </div>
            )}

            {status === 'Closed-Remediated' && (
                <div className="alert alert-info">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Closure Verified By (must differ from owner — separation of duties)</label>
                        <input className="form-control" placeholder="reviewer@company.com" value={closureVerifiedBy} onChange={(e) => setClosureVerifiedBy(e.target.value)} required />
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
