// RiskRegister.jsx — Risk Register (B1) page, the largest and most
// role-sensitive component in the app. Local capability flags include:
//   - isSuperAdmin / isCro — used together throughout (Super Admin mirrors
//     CRO approval power); both are planned for removal/consolidation once
//     Super Admin and Consultant CRO are deleted from the app (not yet
//     done — see CLAUDE.md "Engineering — pending items").
//   - croCanApprove() — CRO/Consultant CRO/Super Admin final approval gate.
//   - canManageLifecycle — Close/Reopen: Risk Manager, CRO, Consultant CRO,
//     Super Admin.
//   - canEditMaps — mitigation action plan edits: everyone except Admin
//     and Viewer.
//   - submitterRefs / isLocked (department field) — a UX default/lock
//     derived from the submitter's role and department scope, not a
//     permission gate; see server.js's Risk Register section header for
//     the actual edit-scope rules (own-submission for Risk Champion,
//     department for Risk Manager/Owner, full for CRO/Admin).
// Full detail: Documents/Internal/RBAC_Permissions_Engine_Scoping.docx
// section 3.6.
import { Fragment, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import scoreBadge from '../components/scoreBadge';
import EvidenceAttachments from '../components/EvidenceAttachments';
import RiskLibraryModal from '../components/RiskLibraryModal';
import ControlLibraryModal from '../components/ControlLibraryModal';
import CascadingDeptSelector from '../components/CascadingDeptSelector';
import { useT } from '../contexts/LanguageContext';

// Read-only board approval evidence list shown in risk detail after CRO acceptance.
function BoardApprovalFiles({ riskId, api }) {
    const [files, setFiles] = useState([]);
    useEffect(() => {
        api.get(`/evidence/board_approval/${riskId}`).then(setFiles).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [riskId]);
    if (!files.length) return <div />;
    return (
        <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                Board Approval Document{files.length > 1 ? 's' : ''}
            </div>
            {files.map((f) => (
                <a
                    key={f.id}
                    href={`/api/evidence/download/${f.id}`}
                    download={f.filename}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none', marginRight: 16 }}
                >
                    📎 {f.filename}
                </a>
            ))}
        </div>
    );
}

const TREATMENT_STRATEGIES = ['Mitigate / Treat', 'Avoid', 'Transfer', 'Accept'];
const REVIEW_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Half-yearly', 'Annual'];
const VELOCITIES = ['Immediate (<1 month)', 'Short-term (1-6 months)', 'Medium-term (6-12 months)', 'Long-term (>12 months)'];
const SCALE = [1, 2, 3, 4, 5];
const LIKELIHOOD_LABELS = ['', 'Unlikely', 'Seldom', 'Occasional', 'Likely', 'Very Likely'];
const IMPACT_LABELS    = ['', 'Insignificant', 'Low / Minor', 'Moderate', 'Major', 'Catastrophic'];
const LIKELIHOOD_DESCS = [
    '',
    'Exceptionally unlikely — not expected to occur within 10 years.',
    'Possible at some time but not expected — at least once in 10 years.',
    'Reasonable likelihood based on circumstances or historical data — at least once in 5 years.',
    'More likely to happen than not — at least once in 3 years.',
    'Already occurred or happens regularly — at least once in 6 months.',
];
const IMPACT_DESCS = [
    '',
    'Negligible impact; handled through normal operations.',
    'Minor disruption; limited impact, resolved quickly with additional resources.',
    'Noticeable disruption requiring management attention; moderate recovery effort.',
    'Serious operational, financial, or reputational harm; prolonged recovery required.',
    'Existential threat — severe financial loss, regulatory action, or irreversible reputational damage.',
];
const PILLAR_ICONS = {
    'Financial':          '💰',
    'Operational':        '⚙️',
    'Strategic':          '🎯',
    'Reputational':       '📢',
    'Legal & Regulatory': '⚖️',
    'People & Safety':    '👥',
};

const DEFAULT_PILLARS = [
    { name: 'Financial', definitions: [
        { score: 1, label: 'Insignificant', description: '0–1 (financial loss threshold)' },
        { score: 2, label: 'Low / Minor',   description: '1–5' },
        { score: 3, label: 'Moderate',      description: '5–25' },
        { score: 4, label: 'Major',          description: '25–50' },
        { score: 5, label: 'Catastrophic',   description: '>50' },
    ]},
    { name: 'Operational', definitions: [
        { score: 1, label: 'Insignificant', description: 'Minor disruptions; service disruption less than 2 hours.' },
        { score: 2, label: 'Low / Minor',   description: 'Slight disruption to a few processes; service disruption 2–4 hours.' },
        { score: 3, label: 'Moderate',      description: 'Noticeable disruption; key services affected; disruption 4 hours–1 day.' },
        { score: 4, label: 'Major',          description: 'Significant disruption; critical services impacted; up to 3 days.' },
        { score: 5, label: 'Catastrophic',   description: 'Severe disruption; entire services halted; more than 3 days.' },
    ]},
    { name: 'Strategic', definitions: [
        { score: 1, label: 'Insignificant', description: 'Minimal effect on strategic goals; no disruption to long-term plans.' },
        { score: 2, label: 'Low / Minor',   description: 'Small manageable effects; some adjustments needed but no major deviation.' },
        { score: 3, label: 'Moderate',      description: 'Noticeable effects on strategic goals; reallocation of resources required.' },
        { score: 4, label: 'Major',          description: 'Significant disruption to strategic initiatives; substantial changes required.' },
        { score: 5, label: 'Catastrophic',   description: 'Critical impact; strategic goals unachievable; complete overhaul required.' },
    ]},
    { name: 'Reputational', definitions: [
        { score: 1, label: 'Insignificant', description: 'Limited local adverse publicity within the organisation.' },
        { score: 2, label: 'Low / Minor',   description: 'Adverse publicity at local level; some dissatisfaction amongst service users.' },
        { score: 3, label: 'Moderate',      description: 'Adverse publicity in local media; significant dissatisfaction of service users.' },
        { score: 4, label: 'Major',          description: 'Adverse publicity in regional media; or sustained adverse local media coverage.' },
        { score: 5, label: 'Catastrophic',   description: 'Substantial adverse media at regional level; potential resignation of key staff.' },
    ]},
    { name: 'Legal & Regulatory', definitions: [
        { score: 1, label: 'Insignificant', description: 'Minor compliance issue; no formal action required.' },
        { score: 2, label: 'Low / Minor',   description: 'Formal notice or warning from regulator.' },
        { score: 3, label: 'Moderate',      description: 'Regulatory fine or formal corrective action required.' },
        { score: 4, label: 'Major',          description: 'Major regulatory penalties or legal action; potential investigation.' },
        { score: 5, label: 'Catastrophic',   description: 'Severe legal consequences; regulatory shutdown or loss of licences.' },
    ]},
    { name: 'People & Safety', definitions: [
        { score: 1, label: 'Insignificant', description: 'Minor injuries; no hospitalisation.' },
        { score: 2, label: 'Low / Minor',   description: 'Injuries requiring hospital treatment.' },
        { score: 3, label: 'Moderate',      description: 'Lost time injury or restricted work injury to one or more people.' },
        { score: 4, label: 'Major',          description: 'Serious injuries or permanent disability; work-related disease.' },
        { score: 5, label: 'Catastrophic',   description: 'Fatalities and/or multiple serious injuries.' },
    ]},
];
const DEFAULT_LIKELIHOOD_DEFS = [
    { score: 5, label: 'Very Likely',  frequency: 'At least once in 6 months',             description: 'The event has already happened or happens regularly, or there is significant reason to believe it is virtually imminent.' },
    { score: 4, label: 'Likely',       frequency: 'At least once in 3 years',               description: 'The event is more likely to happen than not. There is a notable probability of occurrence based on past frequency or current circumstances.' },
    { score: 3, label: 'Occasional',   frequency: 'At least once in 5 years',               description: 'The event has a reasonable likelihood of happening based on current circumstances or historical data. More than a remote possibility.' },
    { score: 2, label: 'Seldom',       frequency: 'At least once in 10 years',              description: 'There is a possibility the event could occur at some time, but it is not expected. Likelihood of occurrence is low based on available information.' },
    { score: 1, label: 'Unlikely',     frequency: 'Not expected to occur within 10 years',  description: 'The event is exceptionally unlikely to happen based on past frequency and current circumstances. Occurrence would be an extreme outlier.' },
];

const FRAMEWORK_REFS = [
    'ISO 31000', 'ISO 27001', 'COSO ERM', 'COSO ICFR',
    'NIST CSF', 'SOC 2', 'PCI DSS', 'PIPEDA',
    'CIS Controls', 'COBIT 2019', 'OSFI E-21', 'Basel III',
];

function ApprovalBadge({ status }) {
    let cls = 'badge-pending';
    if (status === 'Approved') cls = 'badge-approved';
    else if (status === 'Awaiting Approver') cls = 'badge-medium';
    else if (status === 'Draft') cls = 'badge-role';
    return <span className={`badge ${cls}`}>{status}</span>;
}

// Open/Closed/Re-opened lifecycle badge
function StatusBadge({ status }) {
    if (status === 'Closed')    return <span className="badge badge-role">Closed</span>;
    if (status === 'Re-opened') return <span className="badge badge-medium">Re-opened</span>;
    return <span className="badge badge-approved">Open</span>;
}

function controlResultClass(result) {
    if (result === 'Effective') return 'badge-low';
    if (result === 'Partially Effective') return 'badge-medium';
    if (result === 'Ineffective') return 'badge-extreme';
    return 'badge-role';
}

function kriBandClass(band) {
    if (band === 'Green') return 'badge-low';
    if (band === 'Amber') return 'badge-medium';
    if (band === 'Red') return 'badge-extreme';
    return 'badge-role';
}

export default function RiskRegister({ fromIncidentId = null, onIncidentLinked = null }) {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isSuperAdmin = role === 'Super Admin';
    const isBuMode = !!activeCompany?.has_business_units;

    const [risks, setRisks] = useState([]);
    const [categories, setCategories] = useState([]);
    const [allControls, setAllControls] = useState([]);
    const [allKris, setAllKris] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [showRiskLibrary, setShowRiskLibrary] = useState(false);
    const [expanded, setExpanded] = useState(null);
    const [selectedRisk, setSelectedRisk] = useState(null); // full-screen detail view
    const [editingDraft, setEditingDraft] = useState(null); // draft risk being edited
    const [includeClosed, setIncludeClosed] = useState(false);

    const [allDepartments, setAllDepartments] = useState([]);
    const [allBus, setAllBus] = useState([]);

    // Send-back modal (Manager reject / Approver reject)
    const [sendBackModal, setSendBackModal] = useState(null); // { id, endpoint }
    const [sendBackReason, setSendBackReason] = useState('');
    const [sendBackBusy, setSendBackBusy] = useState(false);
    const [sendBackError, setSendBackError] = useState('');
    // Close risk modal
    const [closeRiskModal, setCloseRiskModal] = useState(null); // { id }
    const [closeRiskReason, setCloseRiskReason] = useState('');
    const [closeRiskBusy, setCloseRiskBusy] = useState(false);
    const [closeRiskError, setCloseRiskError] = useState('');
    // For CRO: set of department names (lowercase) with no active Manager, plus a flag
    // for when an enterprise-wide Manager exists (meaning CRO sees no approval buttons at all).
    const [unmanagedDepts, setUnmanagedDepts] = useState(null); // null = not loaded yet
    const [enterpriseMgrExists, setEnterpriseMgrExists] = useState(false);
    const [riskOwnerUsers, setRiskOwnerUsers] = useState([]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const isCro = role === 'CRO' || role === 'Consultant CRO' || isSuperAdmin;
            const isBuMode = !!activeCompany?.has_business_units;
            const [riskData, categoryData, controlsData, krisData, deptData, croMgrData, buData, riskOwnerData] = await Promise.all([
                api.get(`/risks${includeClosed ? '?include_closed=true' : ''}`),
                api.get('/risk-taxonomy'),
                api.get('/controls'),
                api.get('/kris'),
                api.get('/departments'),
                isCro ? api.get('/departments/without-manager') : Promise.resolve(null),
                isBuMode ? api.get('/business-units').catch(() => []) : Promise.resolve([]),
                api.get('/users/risk-owners').catch(() => []),
            ]);
            setRisks(riskData);
            setCategories(categoryData);
            setAllControls(controlsData);
            setAllKris(krisData);
            setAllDepartments(deptData);
            setAllBus(buData);
            setRiskOwnerUsers(Array.isArray(riskOwnerData) ? riskOwnerData : []);
            if (croMgrData) {
                setEnterpriseMgrExists(croMgrData.enterprise_manager_exists);
                setUnmanagedDepts(new Set((croMgrData.unmanaged_departments || []).map((d) => d.toLowerCase())));
            }
        } catch (e) {
            setError(e.message || 'Failed to load risk register');
        } finally {
            setLoading(false);
        }
    }

    // Returns true if the CRO (or Super Admin) should show approve/reject buttons for this risk.
    function croCanApprove(risk) {
        if (role !== 'CRO' && role !== 'Consultant CRO' && !isSuperAdmin) return false;
        if (risk.approval_status !== 'Awaiting Approval') return false;
        if (isSuperAdmin) return true; // Super Admin can approve any risk regardless of dept/manager structure
        if (enterpriseMgrExists) return false; // enterprise Manager covers everything
        if (!risk.department) return true; // enterprise-wide risk, no Manager owns it
        if (unmanagedDepts === null) return false; // still loading
        return unmanagedDepts.has(risk.department.toLowerCase());
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [includeClosed]);

    // Auto-open new risk form when navigated from Incident Log
    useEffect(() => {
        if (fromIncidentId && role !== 'Admin') {
            setShowForm(true);
            setEditingDraft(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromIncidentId]);

    // Bug 3: Refresh departments whenever the form is opened so newly-created
    // departments (added in the Org Structure module) are immediately available.
    useEffect(() => {
        if (showForm) {
            api.get('/departments').then(setAllDepartments).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showForm]);

    async function handleApprove(id) {
        try {
            await api.post(`/risks/${id}/approve`);
            await load();
        } catch (e) {
            setError(e.message || 'Failed to approve risk');
        }
    }

    async function handleApproverApprove(id) {
        try {
            await api.post(`/risks/${id}/approver-approve`);
            await load();
        } catch (e) {
            setError(e.message || 'Failed to forward risk');
        }
    }

    function handleApproverReject(id) {
        setSendBackModal({ id, endpoint: 'approver-reject' });
        setSendBackReason('');
        setSendBackError('');
    }

    function handleManagerReject(id) {
        setSendBackModal({ id, endpoint: 'manager-reject' });
        setSendBackReason('');
        setSendBackError('');
    }

    async function handleSendBackConfirm() {
        setSendBackBusy(true);
        setSendBackError('');
        try {
            await api.post(`/risks/${sendBackModal.id}/${sendBackModal.endpoint}`, { reason: sendBackReason || null });
            setSendBackModal(null);
            await load();
        } catch (e) {
            setSendBackError(e.message || 'Failed to send back risk');
        } finally {
            setSendBackBusy(false);
        }
    }

    async function handleClose(id, reason) {
        try {
            await api.post(`/risks/${id}/close`, { closure_reason: reason });
            await load();
        } catch (e) {
            setError(e.message || 'Failed to close risk');
        }
    }

    async function handleCloseRiskConfirm() {
        if (!closeRiskModal) return;
        setCloseRiskBusy(true);
        setCloseRiskError('');
        try {
            await api.post(`/risks/${closeRiskModal.id}/close`, { closure_reason: closeRiskReason });
            setCloseRiskModal(null);
            setCloseRiskReason('');
            await load();
        } catch (e) {
            setCloseRiskError(e.message || 'Failed to close risk');
        } finally {
            setCloseRiskBusy(false);
        }
    }

    async function handleReopen(id, reason) {
        try {
            await api.post(`/risks/${id}/reopen`, { reopen_reason: reason });
            await load();
        } catch (e) {
            setError(e.message || 'Failed to reopen risk');
        }
    }

    // ── Full-screen risk detail view ───────────────────────────────────────────
    if (selectedRisk) {
        return (
            <div>
                <div style={{ marginBottom: 16 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedRisk(null); load(); }}>
                        ← Back to Risk Register
                    </button>
                </div>
                <RiskDetail
                    risk={selectedRisk}
                    api={api}
                    onClose={handleClose}
                    onReopen={handleReopen}
                    onRefresh={() => { load(); }}
                    onEditDraft={(r) => { setSelectedRisk(null); setEditingDraft(r); setShowForm(true); }}
                />
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">{t('risks_title')}</h1>
                    <p className="page-subtitle">
                        {role === 'Risk Manager'
                            ? (() => {
                                const depts = activeCompany?.departments?.length > 0
                                    ? activeCompany.departments
                                    : (activeCompany?.department ? [activeCompany.department] : []);
                                const label = depts.length > 0 ? depts.join(', ') : '—';
                                return `Showing risks for your department${depts.length !== 1 ? 's' : ''} (${label})`;
                            })()
                            : t('risks_subtitle')}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
                        Show closed risks
                    </label>
                    <button className="btn btn-secondary" onClick={() => setShowRiskLibrary(true)}>
                        📚 Risk Library
                    </button>
                    {role !== 'Admin' && (
                        <button className="btn btn-primary" onClick={() => { setShowForm((s) => !s); if (showForm) setEditingDraft(null); }}>
                            {showForm ? 'Close' : editingDraft ? `✎ Edit ${editingDraft.risk_uid}` : '+ New Risk Assessment'}
                        </button>
                    )}
                </div>
            </div>

            {showRiskLibrary && (
                <RiskLibraryModal onClose={() => setShowRiskLibrary(false)} />
            )}

            {error && <div className="alert alert-error">{error}</div>}

            {showForm && (
                <NewRiskForm
                    categories={categories}
                    department={activeCompany?.department}
                    departments={activeCompany?.departments}
                    allDepartments={allDepartments}
                    allBus={allBus}
                    isBuMode={!!activeCompany?.has_business_units}
                    role={role}
                    userEmail={session.user.email}
                    allControls={allControls}
                    allKris={allKris}
                    riskOwnerUsers={riskOwnerUsers}
                    initialRisk={editingDraft}
                    onCreated={async (created) => {
                        setShowForm(false);
                        setEditingDraft(null);
                        // If navigated from Incident Log, auto-link the new risk to the originating incident
                        if (fromIncidentId && created?.id) {
                            try {
                                await api.patch(`/incidents/${fromIncidentId}/link-risk`, {
                                    risk_id: created.id,
                                    decision: 'Risk Created',
                                });
                            } catch { /* non-fatal — incident log will show Pending */ }
                            onIncidentLinked?.();
                            return;
                        }
                        load();
                    }}
                    onError={setError}
                />
            )}

            <div className="card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 24 }}>Loading…</div>
                ) : risks.length === 0 ? (
                    <div style={{ padding: 24 }} className="text-muted">
                        No risks recorded yet.
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Risk ID</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Category</th>
                                <th>Description</th>
                                <th>Owner</th>
                                <th>Created By</th>
                                <th>Inherent</th>
                                <th>Residual</th>
                                <th>Treatment</th>
                                <th>Lifecycle Status</th>
                                <th>Status</th>
                                <th>Flags</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {risks.map((r) => {
                                const inherent = scoreBadge(r.inherent_likelihood, r.inherent_impact);
                                const residual = scoreBadge(r.residual_likelihood, r.residual_impact);
                                return (
                                    <Fragment key={r.id}>
                                        <tr onClick={() => setSelectedRisk(r)} style={{ cursor: 'pointer' }}>
                                            <td>
                                                <strong>{r.risk_uid}</strong>
                                                <div className="text-muted">v{r.version}</div>
                                            </td>
                                            {(() => {
                                                const dept = allDepartments.find((d) => d.code === r.department || d.name === r.department);
                                                const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                                const buDisplay = bu ? bu.name : (dept ? dept.name : r.department);
                                                return <td>{buDisplay || '—'}</td>;
                                            })()}
                                            <td>{allDepartments.find((d) => d.code === r.department || d.name === r.department)?.name || r.department}</td>
                                            <td>
                                                {r.risk_category}
                                                <div className="text-muted">{r.sub_category}</div>
                                            </td>
                                            <td style={{ maxWidth: 240 }}>{r.risk_detail}</td>
                                            <td>{r.risk_owner || '—'}</td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.assessed_by_name || '—'}</td>
                                            <td>
                                                <span className={`badge ${inherent.className}`}>
                                                    {inherent.label} ({inherent.score})
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`badge ${residual.className}`}>
                                                    {residual.label} ({residual.score})
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                    <span>{r.treatment_strategy}</span>
                                                    {r.cro_acceptance_status === 'pending_cro' && (
                                                        <span className="badge badge-medium" style={{ fontSize: 10 }}>⏳ Pending CRO</span>
                                                    )}
                                                    {r.cro_acceptance_status === 'accepted' && (
                                                        <span className="badge badge-low" style={{ fontSize: 10 }}>✔ CRO Accepted</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td><ApprovalBadge status={r.approval_status} /></td>
                                            <td><StatusBadge status={r.risk_status} /></td>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {r.appetite_category_breach && <span className="badge badge-extreme">Exceeds Appetite</span>}
                                                    {!r.appetite_category_breach && r.tolerance_breach && <span className="badge badge-high">Exceeds Tolerance</span>}
                                                    {r.reassessment_recommended && <span className="badge badge-medium">Reassess</span>}
                                                </div>
                                            </td>
                                            <td>
                                                {(role === 'Risk Manager' && r.approval_status === 'Awaiting Approval' || croCanApprove(r)) && (
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        <button
                                                            className="btn btn-sm btn-primary"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleApprove(r.id);
                                                            }}
                                                        >
                                                            Approve ✓
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleManagerReject(r.id);
                                                            }}
                                                        >
                                                            Send Back
                                                        </button>
                                                    </div>
                                                )}
                                                {role === 'Risk Owner' && r.approval_status === 'Awaiting Approver' && (
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        <button
                                                            className="btn btn-sm btn-primary"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleApproverApprove(r.id);
                                                            }}
                                                        >
                                                            Forward ↑
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleApproverReject(r.id);
                                                            }}
                                                        >
                                                            Send Back
                                                        </button>
                                                    </div>
                                                )}
                                                {(role === 'CRO' || role === 'Consultant CRO' || role === 'Risk Manager' || isSuperAdmin) &&
                                                    r.approval_status === 'Approved' &&
                                                    r.risk_status !== 'Closed' && (
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        style={{ marginTop: 4 }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setCloseRiskReason('');
                                                            setCloseRiskError('');
                                                            setCloseRiskModal({ id: r.id });
                                                        }}
                                                    >
                                                        Close Risk
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Send-back modal (Manager reject / Approver reject) */}
            {sendBackModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ width: 440, padding: 24 }}>
                        <h3 style={{ margin: '0 0 16px' }}>Send Back Risk</h3>
                        <div className="form-group">
                            <label>Reason (optional)</label>
                            <textarea
                                className="form-control"
                                rows={3}
                                placeholder="Explain why this risk is being sent back…"
                                value={sendBackReason}
                                onChange={(e) => setSendBackReason(e.target.value)}
                            />
                        </div>
                        {sendBackError && (
                            <div className="alert alert-error" style={{ marginBottom: 12 }}>{sendBackError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setSendBackModal(null)} disabled={sendBackBusy}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={handleSendBackConfirm} disabled={sendBackBusy}>
                                {sendBackBusy ? 'Sending…' : 'Send Back'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Close risk modal */}
            {closeRiskModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ width: 440, padding: 24 }}>
                        <h3 style={{ margin: '0 0 16px' }}>Close Risk</h3>
                        <div className="form-group">
                            <label>Closure Reason (optional)</label>
                            <textarea
                                className="form-control"
                                rows={3}
                                placeholder="Explain why this risk is being closed…"
                                value={closeRiskReason}
                                onChange={(e) => setCloseRiskReason(e.target.value)}
                            />
                        </div>
                        {closeRiskError && (
                            <div className="alert alert-error" style={{ marginBottom: 12 }}>{closeRiskError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setCloseRiskModal(null)} disabled={closeRiskBusy}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={handleCloseRiskConfirm} disabled={closeRiskBusy}>
                                {closeRiskBusy ? 'Closing…' : 'Close Risk'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div>
            <div className="text-muted" style={{ marginBottom: 2 }}>
                {label}
            </div>
            <div>{children || '—'}</div>
        </div>
    );
}

export function RiskDetail({ risk: r, api, onClose, onReopen, onRefresh, onEditDraft }) {
    const { session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isSuperAdmin = role === 'Super Admin';

    const [showCloseForm, setShowCloseForm] = useState(false);
    const [closureReason, setClosureReason] = useState('');
    const [showReopenForm, setShowReopenForm] = useState(false);
    const [reopenReason, setReopenReason] = useState('');
    const canManageLifecycle = role === 'Risk Manager' || role === 'CRO' || role === 'Consultant CRO' || isSuperAdmin;
    const [related, setRelated] = useState(null);
    const [relatedError, setRelatedError] = useState('');
    const [newRelatedUid, setNewRelatedUid] = useState('');
    const [newRelatedNote, setNewRelatedNote] = useState('');
    const [addControlMode, setAddControlMode] = useState(null); // null | 'link' | 'create'
    const [allLibControls, setAllLibControls] = useState([]);
    const [selectedControlId, setSelectedControlId] = useState('');
    const [newCtrlForm, setNewCtrlForm] = useState({ name: '', owner: '', control_type: 'Preventive', testing_frequency: 'Quarterly', evidence_required: '' });
    const [ctrlBusy, setCtrlBusy] = useState(false);
    const [ctrlError, setCtrlError] = useState('');

    // ── MAP state (ENH-14) ──────────────────────────────────────────────────────
    const MAP_STATUSES = ['Pending', 'In Progress', 'Complete', 'Deferred', 'Cancelled'];
    const canEditMaps = role !== 'Admin' && role !== 'Viewer';
    const [mapModal, setMapModal] = useState(null); // { map: existing|null }
    const [mapForm, setMapForm] = useState({});
    const [mapBusy, setMapBusy] = useState(false);
    const [mapError, setMapError] = useState('');

    function openMapAdd() {
        setMapForm({ action: '', action_owner: '', root_cause: '', start_date: '', end_date: '', status: 'Pending', compensatory_controls_in_place: '' });
        setMapError('');
        setMapModal({ map: null });
    }

    function openMapEdit(map) {
        setMapForm({
            action: map.action || '',
            action_owner: map.action_owner || '',
            root_cause: map.root_cause || '',
            start_date: map.start_date ? String(map.start_date).split('T')[0] : '',
            end_date: map.end_date ? String(map.end_date).split('T')[0] : '',
            status: map.status || 'Pending',
            compensatory_controls_in_place: map.compensatory_controls_in_place || '',
        });
        setMapError('');
        setMapModal({ map });
    }

    async function handleMapSave() {
        setMapBusy(true);
        setMapError('');
        try {
            const body = {
                action: mapForm.action.trim(),
                action_owner: mapForm.action_owner || null,
                root_cause: mapForm.root_cause || null,
                start_date: mapForm.start_date || null,
                end_date: mapForm.end_date || null,
                status: mapForm.status,
                compensatory_controls_in_place: mapForm.status === 'Deferred' ? (mapForm.compensatory_controls_in_place || null) : null,
            };
            if (!body.action) { setMapError('Action is required'); setMapBusy(false); return; }
            if (mapModal.map) {
                await api.put(`/mitigations/${mapModal.map.id}`, body);
            } else {
                await api.post(`/risks/${r.id}/mitigations`, body);
            }
            setMapModal(null);
            onRefresh();
        } catch (e) {
            setMapError(e.message || 'Failed to save MAP');
        } finally {
            setMapBusy(false);
        }
    }

    async function handleMapDelete(mapId) {
        if (!window.confirm('Delete this mitigation action? This cannot be undone.')) return;
        try {
            await api.delete(`/mitigations/${mapId}`);
            onRefresh();
        } catch (e) {
            setMapError(e.message || 'Failed to delete MAP');
        }
    }

    function mapStatusBadgeStyle(m) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const isOverdue = m.end_date && new Date(m.end_date) < today && (m.status === 'Pending' || m.status === 'In Progress');
        if (isOverdue) return { background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 };
        if (m.status === 'Complete') return { background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, padding: '1px 6px', fontSize: 11 };
        if (m.status === 'Deferred') return { background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74', borderRadius: 4, padding: '1px 6px', fontSize: 11 };
        if (m.status === 'Cancelled') return { background: '#f9fafb', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 6px', fontSize: 11 };
        return { background: '#eff6ff', color: '#2563eb', border: '1px solid #93c5fd', borderRadius: 4, padding: '1px 6px', fontSize: 11 };
    }

    function mapStatusLabel(m) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const isOverdue = m.end_date && new Date(m.end_date) < today && (m.status === 'Pending' || m.status === 'In Progress');
        return isOverdue ? 'Overdue' : m.status;
    }

    // CRO acceptance workflow state
    const [csoStatus, setCsoStatus] = useState(r.cro_acceptance_status || null);
    const [showCsoAcceptConfirm, setShowCsoAcceptConfirm] = useState(false);
    const [csoAcceptNotes, setCsoAcceptNotes] = useState('');
    const [csoComment, setCsoComment] = useState('');
    const [csoBusy, setCsoBusy] = useState(false);
    const [csoError, setCsoError] = useState('');
    const [csoSuccess, setCsoSuccess] = useState('');

    useEffect(() => {
        let active = true;
        api.get(`/risks/${r.risk_uid}/related`)
            .then((data) => active && setRelated(data))
            .catch(() => active && setRelated([]));
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [r.risk_uid]);

    useEffect(() => {
        if (addControlMode === 'link') {
            api.get('/controls').then(setAllLibControls).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addControlMode]);

    async function handleLinkExisting() {
        if (!selectedControlId) return;
        setCtrlBusy(true); setCtrlError('');
        try {
            await api.post(`/risks/${r.id}/link-control`, { control_id: parseInt(selectedControlId) });
            setAddControlMode(null); setSelectedControlId('');
            onRefresh();
        } catch (e) { setCtrlError(e.message || 'Failed to link control'); }
        finally { setCtrlBusy(false); }
    }

    async function handleCreateAndLink() {
        if (!newCtrlForm.name.trim()) return;
        setCtrlBusy(true); setCtrlError('');
        try {
            await api.post(`/risks/${r.id}/create-and-link-control`, newCtrlForm);
            setAddControlMode(null);
            setNewCtrlForm({ name: '', owner: '', control_type: 'Preventive', testing_frequency: 'Quarterly', evidence_required: '' });
            onRefresh();
        } catch (e) { setCtrlError(e.message || 'Failed to create control'); }
        finally { setCtrlBusy(false); }
    }

    async function handleUnlinkControl(controlId) {
        try {
            await api.delete(`/risks/${r.id}/link-control/${controlId}`);
            onRefresh();
        } catch (e) { setCtrlError(e.message || 'Failed to unlink control'); }
    }

    async function addRelated() {
        if (!newRelatedUid.trim()) return;
        setRelatedError('');
        try {
            await api.post(`/risks/${r.risk_uid}/related`, { related_risk_uid: newRelatedUid.trim().toUpperCase(), note: newRelatedNote });
            const data = await api.get(`/risks/${r.risk_uid}/related`);
            setRelated(data);
            setNewRelatedUid('');
            setNewRelatedNote('');
        } catch (e) {
            setRelatedError(e.message || 'Failed to add related risk');
        }
    }

    async function removeRelated(otherUid) {
        await api.delete(`/risks/${r.risk_uid}/related/${otherUid}`);
        setRelated((rs) => rs.filter((x) => x.risk_uid !== otherUid));
    }

    return (
    <>
        {/* ── Header card ──────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                        {r.department}{r.risk_category ? ` · ${r.risk_category}` : ''}{r.sub_category ? ` / ${r.sub_category}` : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{r.risk_uid}</h2>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>v{r.version}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <ApprovalBadge status={r.approval_status} />
                        <StatusBadge status={r.risk_status} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {(() => { const s = scoreBadge(r.inherent_likelihood, r.inherent_impact); return <span className={`badge ${s.className}`} title="Inherent">Inherent: {s.label} ({s.score})</span>; })()}
                        {(() => { const s = scoreBadge(r.residual_likelihood, r.residual_impact); return <span className={`badge ${s.className}`} title="Residual">Residual: {s.label} ({s.score})</span>; })()}
                    </div>
                    {(r.is_critical || r.appetite_category_breach || r.tolerance_breach || r.reassessment_recommended) && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {r.is_critical && <span className="badge badge-extreme" style={{ fontSize: 11 }}>⚠ Critical</span>}
                            {r.appetite_category_breach && <span className="badge badge-extreme">Exceeds Board Appetite</span>}
                            {!r.appetite_category_breach && r.tolerance_breach && <span className="badge badge-high">Exceeds Tolerance</span>}
                            {r.reassessment_recommended && <span className="badge badge-medium">Reassessment recommended</span>}
                        </div>
                    )}
                    {r.approval_status === 'Draft' && onEditDraft && (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => onEditDraft(r)}>
                            ✎ Edit Draft
                        </button>
                    )}
                    {r.approval_status !== 'Draft' && r.risk_status !== 'Closed' && canManageLifecycle && onEditDraft && (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onEditDraft(r)}>
                            ✎ Edit Risk
                        </button>
                    )}
                    {canManageLifecycle && r.risk_status !== 'Closed' && (
                        showCloseForm ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                    className="form-control"
                                    placeholder="Reason for closing"
                                    value={closureReason}
                                    onChange={(e) => setClosureReason(e.target.value)}
                                    style={{ width: 240 }}
                                />
                                <button type="button" className="btn btn-sm btn-primary" disabled={!closureReason.trim()} onClick={() => { onClose(r.id, closureReason); setShowCloseForm(false); setClosureReason(''); }}>Confirm</button>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowCloseForm(false)}>Cancel</button>
                            </div>
                        ) : (
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowCloseForm(true)}>Close Risk</button>
                        )
                    )}
                    {canManageLifecycle && r.risk_status === 'Closed' && (
                        <>
                            {r.closure_reason && <div className="text-muted" style={{ fontSize: 12, textAlign: 'right' }}>Closed: {r.closure_reason}</div>}
                            {showReopenForm ? (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input
                                        className="form-control"
                                        placeholder="Reason for re-opening"
                                        value={reopenReason}
                                        onChange={(e) => setReopenReason(e.target.value)}
                                        style={{ width: 240 }}
                                    />
                                    <button type="button" className="btn btn-sm btn-primary" disabled={!reopenReason.trim()} onClick={() => { onReopen(r.id, reopenReason); setShowReopenForm(false); setReopenReason(''); }}>Confirm</button>
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowReopenForm(false)}>Cancel</button>
                                </div>
                            ) : (
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowReopenForm(true)}>Re-open Risk</button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>

        {/* ── Risk Identification ──────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px' }}>Risk Identification</h3>
            <div className="form-group">
                <label>Risk Statement</label>
                <div style={{ fontSize: 15, fontWeight: 500, padding: '6px 0', lineHeight: 1.5 }}>{r.risk_detail || '—'}</div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Risk Owner</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.risk_owner || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Submitted By</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.assessed_by_name || r.assessed_by || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Review Frequency</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.review_frequency || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Next Review Date</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.next_review_date ? String(r.next_review_date).split('T')[0] : '—'}</div>
                </div>
                <div className="form-group">
                    <label>Framework Reference</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.framework_reference || '—'}</div>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                    <label>Tolerance Threshold</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>
                    {r.tolerance_threshold || '—'}
                    {r.tolerance_threshold_score != null && (
                        <span className={`badge ${r.tolerance_breach ? 'badge-extreme' : 'badge-approved'}`} style={{ marginLeft: 6 }}>
                            {r.tolerance_breach ? 'Exceeds' : 'Within'} tolerance ({r.residual_score} vs {r.tolerance_threshold_score})
                        </span>
                    )}
                    {r.appetite_category_breach && (
                        <span className="badge badge-extreme" style={{ marginLeft: 6 }}>Exceeds Board Appetite</span>
                    )}
                    </div>
                </div>
            </div>
        </div>

        {/* ── Risk Assessment ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px' }}>Risk Assessment</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Inherent Likelihood</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.inherent_likelihood || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Inherent Impact</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.inherent_impact || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Inherent Score</label>
                    <div style={{ padding: '6px 0' }}>{(() => { const s = scoreBadge(r.inherent_likelihood, r.inherent_impact); return <span className={`badge ${s.className}`}>{s.label} ({s.score})</span>; })()}</div>
                </div>
                <div className="form-group">
                    <label>Residual Likelihood</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.residual_likelihood || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Residual Impact</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.residual_impact || '—'}</div>
                </div>
                <div className="form-group">
                    <label>Residual Score</label>
                    <div style={{ padding: '6px 0' }}>{(() => { const s = scoreBadge(r.residual_likelihood, r.residual_impact); return <span className={`badge ${s.className}`}>{s.label} ({s.score})</span>; })()}</div>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Risk Velocity (speed of onset)</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.risk_velocity || '—'}</div>
                </div>
            </div>
        </div>

        {/* ── Treatment ────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px' }}>Treatment</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Treatment Strategy</label>
                    <div style={{ padding: '6px 0', fontSize: 14 }}>{r.treatment_strategy || '—'}</div>
                </div>
                {csoStatus && (
                    <div className="form-group">
                        <label>CRO Acceptance</label>
                        <div style={{ padding: '6px 0', fontSize: 14 }}>
                            {csoStatus === 'accepted' && <span style={{ color: 'var(--color-success, #2e7d32)', fontWeight: 600 }}>✔ Accepted by CRO</span>}
                            {csoStatus === 'pending_cro' && <span style={{ color: 'var(--color-warning, #f5a623)', fontWeight: 600 }}>⏳ Pending CRO Acceptance</span>}
                        </div>
                    </div>
                )}
            </div>
            {['Accept', 'Avoid'].includes(r.treatment_strategy) && (
                <div className="form-row">
                    <div className="form-group" style={{ flex: 2 }}>
                        <label>Treatment Plan Rationale</label>
                        <div style={{ padding: '6px 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{r.treatment_plan_rationale || '—'}</div>
                    </div>
                    {r.cro_notes && (
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>CRO Notes</label>
                            <div style={{ padding: '6px 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{r.cro_notes}</div>
                        </div>
                    )}
                </div>
            )}
            {csoStatus === 'accepted' && <BoardApprovalFiles riskId={r.id} api={api} />}
        </div>

        {/* ── CRO Action Panel ─────────────────────────────────────────────── */}
        {(role === 'CRO' || role === 'Consultant CRO' || isSuperAdmin) && csoStatus === 'pending_cro' && (
            <div className="card" style={{ marginBottom: 16, background: 'var(--color-warning-bg, #fff8e1)', border: '1px solid var(--color-warning, #f5a623)' }}>
                <h3 style={{ margin: '0 0 16px' }}>CRO Risk Acceptance</h3>
                {csoError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{csoError}</div>}
                {csoSuccess && <div className="alert alert-success" style={{ marginBottom: 8 }}>{csoSuccess}</div>}
                {!showCsoAcceptConfirm ? (
                    <>
                        <div className="form-group">
                            <label>Add a comment (optional — does not accept the risk)</label>
                            <textarea className="form-control" rows={2} value={csoComment} onChange={(e) => setCsoComment(e.target.value)} placeholder="Add notes or questions for the record…" />
                            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} disabled={csoBusy || !csoComment.trim()} onClick={async () => { setCsoBusy(true); setCsoError(''); setCsoSuccess(''); try { await api.post(`/risks/${r.id}/cro-comment`, { comment: csoComment }); setCsoSuccess('Comment saved.'); setCsoComment(''); if (onRefresh) onRefresh(); } catch (e) { setCsoError(e.message || 'Failed to save comment.'); } finally { setCsoBusy(false); } }}>Save Comment</button>
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCsoAcceptConfirm(true)}>Accept Risk</button>
                    </>
                ) : (
                    <div style={{ background: 'var(--color-danger-bg, #ffebee)', border: '1px solid var(--color-danger, #c62828)', borderRadius: 6, padding: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-danger, #c62828)' }}>⚠ Confirmation Required</div>
                        <p style={{ margin: '0 0 10px', fontSize: 13 }}>By accepting this risk you confirm that <strong>board approval has been obtained</strong> for this risk disposition. This action will be recorded in the audit log.</p>
                        <div className="form-group">
                            <label>Acceptance notes (optional)</label>
                            <textarea className="form-control" rows={2} value={csoAcceptNotes} onChange={(e) => setCsoAcceptNotes(e.target.value)} placeholder="Reference board resolution, meeting date, etc." />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" className="btn btn-danger btn-sm" disabled={csoBusy} onClick={async () => { setCsoBusy(true); setCsoError(''); setCsoSuccess(''); try { await api.post(`/risks/${r.id}/cro-accept`, { notes: csoAcceptNotes || null }); setCsoStatus('accepted'); setCsoSuccess('Risk accepted and recorded.'); setShowCsoAcceptConfirm(false); if (onRefresh) onRefresh(); } catch (e) { setCsoError(e.message || 'Failed to accept risk.'); } finally { setCsoBusy(false); } }}>Confirm Acceptance</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCsoAcceptConfirm(false)}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* ── Lifecycle ────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px' }}>Lifecycle</h3>
            <div className="form-row">
                <div className="form-group">
                    <label>Approval Status</label>
                    <div style={{ padding: '6px 0' }}><ApprovalBadge status={r.approval_status} /></div>
                </div>
                <div className="form-group">
                    <label>Risk Status</label>
                    <div style={{ padding: '6px 0' }}>
                        <StatusBadge status={r.risk_status} />
                        {r.risk_status === 'Closed' && r.closure_reason && (
                            <div className="text-muted" style={{ marginTop: 4, fontSize: 13 }}>Reason: {r.closure_reason}</div>
                        )}
                        {r.risk_status === 'Re-opened' && r.reopen_reason && (
                            <div className="text-muted" style={{ marginTop: 4, fontSize: 13 }}>Re-open reason: {r.reopen_reason}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* ── BCP ──────────────────────────────────────────────────────────── */}
        {(r.bcp_status || r.bcp_link) && (
            <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 16px' }}>Business Continuity</h3>
                <div className="form-row">
                    {r.bcp_status && (
                        <div className="form-group">
                            <label>BCP Status</label>
                            <div style={{ padding: '6px 0', fontSize: 14 }}>{r.bcp_status}</div>
                        </div>
                    )}
                    {r.bcp_link && (
                        <div className="form-group">
                            <label>BCP Document Link</label>
                            <div style={{ padding: '6px 0', fontSize: 14 }}>
                                <a href={r.bcp_link} target="_blank" rel="noreferrer">{r.bcp_link}</a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* ── Linked Controls ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>Linked Controls</h3>
                {!addControlMode && (
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAddControlMode('link')}>+ Link existing</button>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAddControlMode('create')}>+ Create new</button>
                    </div>
                )}
            </div>
            {ctrlError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{ctrlError}</div>}
            {addControlMode === 'link' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                    <select className="form-control" style={{ maxWidth: 320 }} value={selectedControlId} onChange={(e) => setSelectedControlId(e.target.value)}>
                        <option value="">— Select a control —</option>
                        {allLibControls.filter((c) => !r.controls.find((rc) => rc.id === c.id)).map((c) => (
                            <option key={c.id} value={c.id}>{c.control_uid}: {c.name}</option>
                        ))}
                    </select>
                    <button type="button" className="btn btn-sm btn-primary" disabled={!selectedControlId || ctrlBusy} onClick={handleLinkExisting}>Link</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAddControlMode(null)}>Cancel</button>
                </div>
            )}
            {addControlMode === 'create' && (
                <div className="card" style={{ margin: '0 0 10px', padding: 12, background: 'var(--color-bg-subtle, #f9fafb)' }}>
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Control Name</label>
                            <input className="form-control" value={newCtrlForm.name} onChange={(e) => setNewCtrlForm((f) => ({ ...f, name: e.target.value }))} required />
                        </div>
                        <div className="form-group">
                            <label>Owner</label>
                            <input className="form-control" value={newCtrlForm.owner} onChange={(e) => setNewCtrlForm((f) => ({ ...f, owner: e.target.value }))} />
                        </div>
                        <div className="form-group">
                            <label>Type</label>
                            <select className="form-control" value={newCtrlForm.control_type} onChange={(e) => setNewCtrlForm((f) => ({ ...f, control_type: e.target.value }))}>
                                <option>Preventive</option><option>Detective</option><option>Corrective</option><option>Directive</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Test Frequency</label>
                            <select className="form-control" value={newCtrlForm.testing_frequency} onChange={(e) => setNewCtrlForm((f) => ({ ...f, testing_frequency: e.target.value }))}>
                                <option>Monthly</option><option>Quarterly</option><option>Annual</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Evidence Required</label>
                        <input className="form-control" placeholder="e.g. signed reconciliation, screenshot" value={newCtrlForm.evidence_required} onChange={(e) => setNewCtrlForm((f) => ({ ...f, evidence_required: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-sm btn-primary" disabled={!newCtrlForm.name.trim() || ctrlBusy} onClick={handleCreateAndLink}>{ctrlBusy ? 'Saving…' : 'Save & Link'}</button>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAddControlMode(null)}>Cancel</button>
                    </div>
                </div>
            )}
            {r.controls.length === 0 && !addControlMode ? (
                <span className="text-muted">No controls linked yet. Use the buttons above to add one.</span>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {r.controls.map((c) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`badge ${controlResultClass(c.last_test_result)}`}>{c.control_uid}: {c.name}</span>
                            <span className="text-muted" style={{ fontSize: 12 }}>
                                {c.owner ? `Owner: ${c.owner}` : ''}{c.testing_frequency ? ` · ${c.testing_frequency}` : ''}
                                {c.last_test_result ? ` · ${c.last_test_result}` : ' · Not yet tested'}
                                {c.last_test_date ? ` (${c.last_test_date})` : ''}
                            </span>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleUnlinkControl(c.id)} style={{ marginLeft: 'auto' }}>Unlink</button>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* ── Mitigation Action Plan ────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>Mitigation Action Plan (MAP)</h3>
                {canEditMaps && <button className="btn btn-secondary btn-sm" onClick={openMapAdd}>+ Add MAP</button>}
            </div>
            {mapError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{mapError}</div>}
            {r.mitigations.length === 0 ? (
                <span className="text-muted">None</span>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {r.mitigations.map((m) => (
                        <div key={m.id} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px', background: 'var(--color-bg-subtle, #fafafa)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                                        {m.mitigation_uid && <span style={{ color: 'var(--color-primary)', marginRight: 6 }}>{m.mitigation_uid}</span>}
                                        {m.action}
                                    </span>
                                    <span style={{ ...mapStatusBadgeStyle(m), marginLeft: 8 }}>{mapStatusLabel(m)}</span>
                                </div>
                                {canEditMaps && (
                                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                        <button className="btn btn-secondary btn-sm" onClick={() => openMapEdit(m)} style={{ padding: '2px 8px', fontSize: 12 }}>Edit</button>
                                        <button className="btn btn-danger btn-sm" onClick={() => handleMapDelete(m.id)} style={{ padding: '2px 8px', fontSize: 12 }}>Delete</button>
                                    </div>
                                )}
                            </div>
                            <div className="text-muted" style={{ marginTop: 4, fontSize: 12 }}>
                                {m.action_owner && <span>Owner: {m.action_owner} · </span>}
                                <span>{m.start_date ? String(m.start_date).split('T')[0] : 'n/a'} → {m.end_date ? String(m.end_date).split('T')[0] : 'n/a'}</span>
                                {m.root_cause && <span> · Root cause: {m.root_cause}</span>}
                                {m.status === 'Deferred' && m.compensatory_controls_in_place && (
                                    <span> · Compensatory controls: <strong>{m.compensatory_controls_in_place}</strong></span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* ── Linked KRIs ──────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px' }}>Linked KRIs</h3>
            {r.kris.length === 0 ? (
                <span className="text-muted">—</span>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {r.kris.map((k) => (
                        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span className={`badge ${kriBandClass(k.band)}`}>
                                {k.kri_uid}: {k.name} {k.current_value !== null ? `= ${k.current_value}` : '(no data)'}{k.band ? ` (${k.band})` : ''}
                            </span>
                            {k.appetite_category && (
                                <span style={{ fontSize: 11, color: '#1B3A6B', background: '#e8eef7', borderRadius: 4, padding: '2px 7px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                    Appetite: {k.appetite_category}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* ── Linked Issues ────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px' }}>Linked Issues</h3>
            {(r.linked_issues || []).length === 0 ? (
                <span className="text-muted">None</span>
            ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(r.linked_issues || []).map((i) => (
                        <li key={i.id}>
                            <strong>{i.issue_uid}</strong>
                            <span className={`badge badge-${i.priority === 'Critical' ? 'extreme' : i.priority === 'High' ? 'high' : i.priority === 'Medium' ? 'medium' : 'low'}`} style={{ marginLeft: 6, fontSize: 11 }}>{i.priority}</span>
                            <span className="text-muted"> — {i.description}</span>
                            <span className="text-muted"> [{i.status}]</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>

        {/* ── Related Risks ────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px' }}>Related Risks</h3>
            {relatedError && <div className="alert alert-error">{relatedError}</div>}
            {related === null ? <span className="text-muted">Loading…</span> : related.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {related.map((rel) => (
                        <div key={rel.risk_uid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="badge badge-role">{rel.risk_uid}</span>
                            {rel.accessible ? (
                                <span>{rel.risk_detail} ({rel.department}, score {rel.residual_score})</span>
                            ) : (
                                <span className="text-muted">Different department — details not visible to you</span>
                            )}
                            {rel.note && <span className="text-muted">— {rel.note}</span>}
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => removeRelated(rel.risk_uid)}>Remove</button>
                        </div>
                    ))}
                </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input className="form-control" placeholder="Risk ID, e.g. FIN-OP-0002" value={newRelatedUid} onChange={(e) => setNewRelatedUid(e.target.value)} style={{ maxWidth: 200 }} />
                <input className="form-control" placeholder="Note (optional)" value={newRelatedNote} onChange={(e) => setNewRelatedNote(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm btn-secondary" onClick={addRelated}>Link</button>
            </div>
        </div>

        {/* ── Evidence Attachments ──────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 16 }}>
            <EvidenceAttachments entityType="risk" entityId={r.risk_uid} />
        </div>

        {/* MAP add/edit modal */}
        {mapModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ width: 540, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
                    <h3 style={{ margin: '0 0 16px' }}>{mapModal.map ? 'Edit Mitigation Action' : 'Add Mitigation Action'}</h3>

                    <div className="form-group">
                        <label>Action <span style={{ color: '#e53935' }}>*</span></label>
                        <textarea
                            className="form-control"
                            rows={2}
                            value={mapForm.action}
                            onChange={(e) => setMapForm((f) => ({ ...f, action: e.target.value }))}
                            placeholder="Describe the action to be taken"
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Action Owner</label>
                            <input className="form-control" value={mapForm.action_owner} onChange={(e) => setMapForm((f) => ({ ...f, action_owner: e.target.value }))} placeholder="Name or email" />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Status</label>
                            <select className="form-control" value={mapForm.status} onChange={(e) => setMapForm((f) => ({ ...f, status: e.target.value, compensatory_controls_in_place: e.target.value !== 'Deferred' ? '' : f.compensatory_controls_in_place }))}>
                                {MAP_STATUSES.map((s) => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    {mapForm.status === 'Deferred' && (
                        <div className="form-group" style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, padding: '10px 12px' }}>
                            <label style={{ color: '#ea580c' }}>Do you have compensatory controls in place?</label>
                            <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input type="radio" name="comp_ctrl" value="Yes" checked={mapForm.compensatory_controls_in_place === 'Yes'} onChange={() => setMapForm((f) => ({ ...f, compensatory_controls_in_place: 'Yes' }))} />
                                    Yes
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input type="radio" name="comp_ctrl" value="No" checked={mapForm.compensatory_controls_in_place === 'No'} onChange={() => setMapForm((f) => ({ ...f, compensatory_controls_in_place: 'No' }))} />
                                    No
                                </label>
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label>Root Cause</label>
                        <input className="form-control" value={mapForm.root_cause} onChange={(e) => setMapForm((f) => ({ ...f, root_cause: e.target.value }))} placeholder="" />
                    </div>

                    <div className="form-row">
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Start Date</label>
                            <input type="date" className="form-control" value={mapForm.start_date} onChange={(e) => setMapForm((f) => ({ ...f, start_date: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>End Date</label>
                            <input type="date" className="form-control" value={mapForm.end_date} onChange={(e) => setMapForm((f) => ({ ...f, end_date: e.target.value }))} />
                        </div>
                    </div>

                    {mapError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{mapError}</div>}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" onClick={() => setMapModal(null)} disabled={mapBusy}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleMapSave} disabled={mapBusy}>
                            {mapBusy ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </>
    );
}

// Controlled vocabulary for risk_cause / risk_consequence: pick from the
// existing list, or type a new term which gets added to the taxonomy (and
// is then available to everyone) as well as used on this risk.
function TaxonomyField({ label, terms, type, value, onChange, onTermsChanged }) {
    const { api } = useAuth();
    const [adding, setAdding] = useState(false);
    const [newTerm, setNewTerm] = useState('');
    const [busy, setBusy] = useState(false);

    async function handleAdd() {
        if (!newTerm.trim()) return;
        setBusy(true);
        try {
            const updated = await api.post(`/taxonomies/${type}`, { name: newTerm.trim() });
            onTermsChanged(type, updated);
            onChange(newTerm.trim());
            setAdding(false);
            setNewTerm('');
        } catch {
            // fall back to using the typed value even if saving to the taxonomy failed
            onChange(newTerm.trim());
            setAdding(false);
            setNewTerm('');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="form-group">
            <label>{label}</label>
            {adding ? (
                <div style={{ display: 'flex', gap: 6 }}>
                    <input className="form-control" autoFocus value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder={`New ${label.toLowerCase()} term`} />
                    <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={handleAdd}>
                        Add
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAdding(false)}>
                        Cancel
                    </button>
                </div>
            ) : (
                <select
                    className="form-control"
                    value={terms.includes(value) ? value : ''}
                    onChange={(e) => {
                        if (e.target.value === '__add_new__') setAdding(true);
                        else onChange(e.target.value);
                    }}
                >
                    <option value="">— Select —</option>
                    {value && !terms.includes(value) && <option value={value}>{value} (current)</option>}
                    {terms.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                    <option value="__add_new__">+ Add new term…</option>
                </select>
            )}
        </div>
    );
}

function ScoreSelect({ label, value, onChange, kind, onShowInfo }) {
    const shortLabels = kind === 'impact' ? IMPACT_LABELS : LIKELIHOOD_LABELS;
    const fullDescs   = kind === 'impact' ? IMPACT_DESCS   : LIKELIHOOD_DESCS;
    return (
        <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>{label}</label>
                {onShowInfo && (
                    <button
                        type="button"
                        title="View scale definitions"
                        onClick={onShowInfo}
                        style={{
                            width: 22, height: 22, borderRadius: '50%',
                            border: 'none',
                            background: kind === 'likelihood' ? '#1d4ed8' : '#b45309',
                            cursor: 'pointer', fontSize: 11, fontWeight: 700,
                            color: '#fff', display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                    >ⓘ</button>
                )}
            </div>
            <select className="form-control" value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
                {SCALE.map((n) => (
                    <option key={n} value={n}>{n} — {shortLabels[n]}</option>
                ))}
            </select>
            {value ? (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 3, fontStyle: 'italic' }}>
                    {fullDescs[value]}
                </div>
            ) : null}
        </div>
    );
}

const SCORE_COLORS = { 5: '#C0152A', 4: '#D9500A', 3: '#C07D0A', 2: '#127A47', 1: '#166534' };
const SCORE_BG     = { 5: '#FEE2E2', 4: '#FFEDD5', 3: '#FEF9C3', 2: '#DCFCE7', 1: '#f0fdf4' };

// ─── Scoring Info Modals ───────────────────────────────────────────────────
function LikelihoodInfoModal({ defs, onClose }) {
    const sorted = [...defs].sort((a, b) => b.score - a.score);
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 10, width: 700, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                <div style={{ padding: '14px 20px', background: '#1e3a5f', color: '#fff', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Likelihood Scale — Definitions</span>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={{ padding: '10px 14px', textAlign: 'center', width: 50, borderBottom: '2px solid #e2e8f0', fontWeight: 700 }}>#</th>
                                <th style={{ padding: '10px 14px', borderBottom: '2px solid #e2e8f0', fontWeight: 700, width: 110 }}>Label</th>
                                <th style={{ padding: '10px 14px', borderBottom: '2px solid #e2e8f0', fontWeight: 700, width: 200 }}>Indicative Frequency</th>
                                <th style={{ padding: '10px 14px', borderBottom: '2px solid #e2e8f0', fontWeight: 700 }}>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((d) => (
                                <tr key={d.score} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                        <span style={{ display: 'inline-flex', width: 24, height: 24, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', background: SCORE_COLORS[d.score], color: '#fff', fontWeight: 700, fontSize: 12 }}>{d.score}</span>
                                    </td>
                                    <td style={{ padding: '10px 14px', fontWeight: 700, color: SCORE_COLORS[d.score] }}>{d.label}</td>
                                    <td style={{ padding: '10px 14px', color: '#64748b', fontSize: 12 }}>{d.frequency || '—'}</td>
                                    <td style={{ padding: '10px 14px', color: '#374151', lineHeight: 1.5 }}>{d.description}</td>
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
                                        <span style={{ display: 'inline-flex', width: 24, height: 24, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', background: SCORE_COLORS[score], color: '#fff', fontWeight: 700, fontSize: 12 }}>{score}</span>
                                    </td>
                                    <td style={{ padding: '10px 12px', fontWeight: 700, color: SCORE_COLORS[score], verticalAlign: 'top', whiteSpace: 'nowrap' }}>{IMPACT_LABELS[score]}</td>
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

function FrameworkRefField({ value, onChange }) {
    const [custom, setCustom] = useState(!FRAMEWORK_REFS.includes(value) && !!value);
    return (
        <div className="form-group" style={{ flex: 2 }}>
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
                    placeholder="e.g. ISO 31000 Clause 6.4"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoFocus
                />
            )}
        </div>
    );
}

// ─── Risk Statement Quality Check ────────────────────────────────────────────
// Keyword heuristic: detects cause, effect, and impact in the risk description.
// No AI required — runs entirely in the browser.

const CAUSE_WORDS = [
    'due to', 'because', 'because of', 'owing to', 'as a result of', 'caused by',
    'triggered by', 'driven by', 'stemming from', 'arising from', 'following',
    'given that', 'since ', 'lack of', 'absence of', 'failure to', 'failure of',
    'inadequate', 'insufficient', 'poor ', 'weak ', 'limited ', 'reliance on',
];
const EFFECT_WORDS = [
    'risk that', 'risk of', 'there is a risk', 'may ', 'might ', 'could ',
    'possibility', 'potential ', 'threatens', 'at risk', 'unable to', 'fails to',
    'may result', 'could result', 'might result', 'risk exists', 'exposing',
];
const IMPACT_WORDS = [
    'resulting in', 'leading to', 'which may cause', 'which could cause',
    'impacting', 'affecting', 'causing ', 'damage to', 'harm to', 'disruption',
    'financial loss', 'financial impact', 'reputational', 'regulatory',
    'penalty', 'penalties', 'fine', 'fines', 'legal', 'liability', 'breach',
    'loss of', 'failure of service', 'downtime', 'outage', 'non-compliance',
    'sanction', 'cost to', 'exposure', 'data loss',
];

function checkRiskStatement(text) {
    const t = (text || '').toLowerCase();
    const has = (words) => words.some((w) => t.includes(w));
    const cause  = has(CAUSE_WORDS);
    const effect = has(EFFECT_WORDS);
    const impact = has(IMPACT_WORDS);
    const missing = [
        !cause  && 'cause (why does this risk exist?)',
        !effect && 'risk event (what might happen?)',
        !impact && 'impact (what would the consequence be?)',
    ].filter(Boolean);
    return { cause, effect, impact, missing, allPresent: cause && effect && impact };
}

function NewRiskForm({ categories, causeTerms, consequenceTerms, onTermsChanged, department, departments, allDepartments, allBus = [], isBuMode = false, role, userEmail, allControls, allKris, riskOwnerUsers = [], initialRisk = null, onCreated, onError }) {
    const { api } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [previewId, setPreviewId] = useState('');
    const [statementCheck, setStatementCheck] = useState(null);   // null = not yet checked
    const [checkedOnce, setCheckedOnce] = useState(false);
    const [pillars, setPillars] = useState(DEFAULT_PILLARS);
    const [likelihoodDefs, setLikelihoodDefs] = useState(DEFAULT_LIKELIHOOD_DEFS);
    const [showInfoModal, setShowInfoModal] = useState(null); // null | 'likelihood' | 'impact'

    // Load scoring methodology definitions (pillar + likelihood) for info modals
    useEffect(() => {
        api.get('/scoring-methodology')
            .then((data) => {
                if (data.pillars?.length) setPillars(data.pillars);
                if (data.likelihood?.length) setLikelihoodDefs(data.likelihood);
            })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // taxonomy is [{id, name, sub_categories:[{id,name}]}]
    const firstCat = categories[0]?.name || '';
    const [form, setForm] = useState(() => initialRisk ? {
        department: initialRisk.department || department || '',
        risk_category: initialRisk.risk_category || firstCat,
        sub_category: initialRisk.sub_category || '',
        risk_detail: initialRisk.risk_detail || '',
        risk_cause: initialRisk.risk_cause || '',
        risk_consequence: initialRisk.risk_consequence || '',
        risk_owner: initialRisk.risk_owner || '',
        treatment_strategy: initialRisk.treatment_strategy || TREATMENT_STRATEGIES[0],
        tolerance_threshold: initialRisk.tolerance_threshold || '',
        risk_velocity: initialRisk.risk_velocity || '',
        treatment_plan_rationale: initialRisk.treatment_plan_rationale || '',
        review_frequency: initialRisk.review_frequency || 'Annual',
        next_review_date: initialRisk.next_review_date ? String(initialRisk.next_review_date).split('T')[0] : '',
        bcp_status: initialRisk.bcp_status || '',
        bcp_link: initialRisk.bcp_link || '',
        framework_reference: initialRisk.framework_reference || '',
        inherent_likelihood: initialRisk.inherent_likelihood || 3,
        inherent_impact: initialRisk.inherent_impact || 3,
        residual_likelihood: initialRisk.residual_likelihood || 2,
        residual_impact: initialRisk.residual_impact || 2,
    } : {
        department: department || '',
        risk_category: firstCat,
        sub_category: '',
        risk_detail: '',
        risk_cause: '',
        risk_consequence: '',
        risk_owner: '',
        treatment_strategy: TREATMENT_STRATEGIES[0],
        tolerance_threshold: '',
        risk_velocity: '',
        treatment_plan_rationale: '',
        review_frequency: 'Annual',
        next_review_date: '',
        bcp_status: '',
        bcp_link: '',
        framework_reference: '',
        inherent_likelihood: 3,
        inherent_impact: 3,
        residual_likelihood: 2,
        residual_impact: 2,
    });

    // When allDepartments loads, normalise form.department to a dept code for Risk Champions.
    // The session may store the dept as a name ("Finance") while the dropdown expects a code ("FIN").
    // Also auto-selects the sole department when a Champion has only one assigned.
    useEffect(() => {
        if (role !== 'Risk Champion') return;
        const refs = Array.isArray(departments) && departments.length > 0
            ? departments.map(d => d.toLowerCase())
            : department ? [department.toLowerCase()] : [];
        if (refs.length === 0 || allDepartments.length === 0) return;
        const matched = allDepartments.filter(d =>
            refs.includes(d.code.toLowerCase()) || refs.includes(d.name.toLowerCase()));
        if (matched.length >= 1 && !matched.some(d => d.code === form.department)) {
            // form.department is either blank or a name — set it to the first matched code
            update('department', matched[0].code);
        }
    }, [allDepartments]); // eslint-disable-line react-hooks/exhaustive-deps

    const [controls, setControls] = useState([{ title: '', owner: '', control_type: 'Preventive', effectiveness: 'Not Tested' }]);
    const [mitigations, setMitigations] = useState([{ action: '', action_owner: '', root_cause: '', start_date: '', end_date: '', status: 'Pending', compensatory_controls_in_place: '' }]);
    const [linkControlIds, setLinkControlIds] = useState([]);
    const [linkKriIds, setLinkKriIds] = useState([]);
    const [controlNextId, setControlNextId] = useState('');
    const [showControlPicker, setShowControlPicker] = useState(false);
    const [controlPickerSearch, setControlPickerSearch] = useState('');
    const [controlPickerDeptOnly, setControlPickerDeptOnly] = useState(false);
    const [isCritical, setIsCritical] = useState(() => initialRisk?.is_critical || false);
    const [showRiskLibraryInForm, setShowRiskLibraryInForm] = useState(false);
    const [showControlRefLibrary, setShowControlRefLibrary] = useState(false);

    // ── Draft auto-save ────────────────────────────────────────────────────────
    const [draftId, setDraftId] = useState(() => initialRisk?.id || null);
    const [draftSavedAt, setDraftSavedAt] = useState(null);
    const [draftSaving, setDraftSaving] = useState(false);
    const autoSaveTimerRef = useRef(null);

    function buildPayload(saveAsDraft = true) {
        return {
            ...form,
            tolerance_threshold_score: null,
            next_review_date: form.next_review_date || null,
            controls: controls.filter((c) => c.title.trim()),
            mitigations: mitigations.filter((m) => m.action.trim()),
            link_control_ids: linkControlIds,
            link_kri_ids: linkKriIds,
            is_critical: isCritical,
            save_as_draft: saveAsDraft,
        };
    }

    async function saveDraft() {
        if (!form.risk_detail.trim()) return; // need at least a description
        setDraftSaving(true);
        try {
            if (draftId) {
                await api.patch(`/risks/${draftId}`, buildPayload(true));
            } else {
                const result = await api.post('/risks', buildPayload(true));
                setDraftId(result.id);
            }
            setDraftSavedAt(new Date());
        } catch {
            // silent — don't interrupt the user
        } finally {
            setDraftSaving(false);
        }
    }

    // Schedule auto-save 15s after user stops typing in key fields
    function scheduleAutoSave() {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(saveDraft, 15000);
    }

    function fetchNextIds(dept) {
        if (!dept) return;
        api.get(`/risks/next-id?department=${encodeURIComponent(dept)}`)
            .then((d) => setPreviewId(d.next_id || ''))
            .catch(() => {});
        api.get(`/controls/next-id?department=${encodeURIComponent(dept)}`)
            .then((d) => setControlNextId(d.next_id || ''))
            .catch(() => {});
    }

    function update(field, value) {
        setForm((f) => ({ ...f, [field]: value }));
        if (field === 'department' && value) fetchNextIds(value);
        // Reset the statement check whenever the risk description changes
        if (field === 'risk_detail') {
            setStatementCheck(null);
            setCheckedOnce(false);
        }
        // Schedule auto-save after key content fields
        if (['risk_detail', 'risk_cause', 'risk_consequence', 'risk_category', 'department'].includes(field)) {
            scheduleAutoSave();
        }
    }

    function runStatementCheck() {
        const result = checkRiskStatement(form.risk_detail);
        setStatementCheck(result);
        setCheckedOnce(true);
    }

    // Load preview IDs for initial department value
    useEffect(() => {
        if (form.department) fetchNextIds(form.department);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Compute control ID preview for a given row index (increments off the base next-id)
    function controlIdPreview(idx) {
        if (!controlNextId) return '—';
        // Match any prefix up to the trailing zero-padded number (handles CI-FINA-ACC-0009 etc.)
        const m = controlNextId.match(/^(.*-)(\d+)$/);
        if (!m) return controlNextId;
        return `${m[1]}${String(parseInt(m[2], 10) + idx).padStart(m[2].length, '0')}`;
    }

    function updateControl(idx, field, value) {
        setControls((cs) => cs.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
    }

    function updateMitigation(idx, field, value) {
        setMitigations((ms) => ms.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
    }

    function toggleId(list, setList, id) {
        setList((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    }

    const inherentBadge = scoreBadge(form.inherent_likelihood, form.inherent_impact);
    const residualBadge = scoreBadge(form.residual_likelihood, form.residual_impact);
    const isAccept = form.treatment_strategy === 'Accept';

    // Bug 8: live highlight when poor controls have no MAP
    const poorControls = controls.filter(
        (c) => c.title.trim() && (c.effectiveness === 'Partially Effective' || c.effectiveness === 'Ineffective')
    );
    const hasMitigationAction = mitigations.some((m) => m.action.trim());
    const mapRequired = poorControls.length > 0 && !hasMitigationAction;
    const [showMapPopup, setShowMapPopup] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        onError('');
        // Cancel pending auto-save timer
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        // Bug 8: Require a mitigation action when any control is Partially Effective or Ineffective
        if (mapRequired) {
            setShowMapPopup(true);
            setSubmitting(false);
            return;
        }
        try {
            let created = null;
            if (draftId) {
                // Submit existing draft → triggers workflow status transition
                created = await api.patch(`/risks/${draftId}`, {
                    ...buildPayload(false),
                    submit_draft: true,
                });
            } else {
                created = await api.post('/risks', buildPayload(false));
            }
            onCreated(created);
        } catch (e) {
            onError(e.message || 'Failed to create risk');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className="card" onSubmit={handleSubmit}>
            {showRiskLibraryInForm && <RiskLibraryModal onClose={() => setShowRiskLibraryInForm(false)} />}
            {showControlRefLibrary && <ControlLibraryModal onClose={() => setShowControlRefLibrary(false)} />}
            {showInfoModal === 'likelihood' && <LikelihoodInfoModal defs={likelihoodDefs} onClose={() => setShowInfoModal(null)} />}
            {showInfoModal === 'impact' && <ImpactInfoModal pillars={pillars} onClose={() => setShowInfoModal(null)} />}

            <div className="step-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h3 style={{ margin: 0 }}>{initialRisk ? `Editing Draft — ${initialRisk.risk_uid}` : 'Step 1 — Risk Identification'}</h3>
                    {draftSaving && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Saving draft…</span>}
                    {!draftSaving && draftSavedAt && (
                        <span style={{ fontSize: 12, color: '#16a34a' }}>
                            ✓ Draft saved {draftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowRiskLibraryInForm(true)}
                    title="Browse the Industry Risk Library for reference"
                >
                    📚 Risk Library
                </button>
            </div>
            <div className="form-row">
                {(() => {
                    // Build the visible dept set for Risk Champions.
                    // Match by both code AND name — the session may store either.
                    const submitterRefs = role === 'Risk Champion'
                        ? (Array.isArray(departments) && departments.length > 0
                            ? departments.map(d => d.toLowerCase())
                            : department ? [department.toLowerCase()] : [])
                        : null;
                    const visibleDepts = submitterRefs
                        ? allDepartments.filter(d =>
                            submitterRefs.includes(d.code.toLowerCase()) ||
                            submitterRefs.includes(d.name.toLowerCase()))
                        : allDepartments;
                    const isLocked = (role === 'Risk Manager' && !!department) ||
                                     (role === 'Risk Champion' && visibleDepts.length <= 1 && visibleDepts.length > 0);
                    // Always render Business Unit + Department as two labeled form-groups.
                    // BU Mode: both are active linked dropdowns.
                    // Simple Mode: BU field is disabled and mirrors the selected dept code.
                    return (
                        <CascadingDeptSelector
                            value={form.department}
                            onChange={(v) => update('department', v)}
                            departments={visibleDepts}
                            bus={allBus}
                            isBuMode={isBuMode}
                            twoFields={true}
                            required
                            disabled={isLocked}
                            allowEmpty={true}
                            placeholder="Select department"
                        />
                    );
                })()}
                <div className="form-group">
                    <label>Risk ID</label>
                    <input
                        className="form-control"
                        value={previewId || (form.department ? 'Generating…' : '— Select department first —')}
                        readOnly
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: 'default' }}
                    />
                </div>
                <div className="form-group">
                    <label>Risk Category</label>
                    <select
                        className="form-control"
                        value={form.risk_category}
                        onChange={(e) => {
                            update('risk_category', e.target.value);
                            update('sub_category', '');
                        }}
                    >
                        <option value="">— Select category —</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Sub-category</label>
                    {(() => {
                        const cat = categories.find((c) => c.name === form.risk_category);
                        const subs = cat?.sub_categories || [];
                        return (
                            <select
                                className="form-control"
                                value={form.sub_category}
                                onChange={(e) => update('sub_category', e.target.value)}
                                disabled={!cat}
                            >
                                <option value="">— Select sub-category —</option>
                                {subs.map((s) => (
                                    <option key={s.id} value={s.name}>{s.name}</option>
                                ))}
                            </select>
                        );
                    })()}
                </div>
                <div className="form-group">
                    <label>Risk Owner (Accountable)</label>
                    <input
                        className="form-control"
                        placeholder="e.g. Head of Finance"
                        value={form.risk_owner}
                        onChange={(e) => update('risk_owner', e.target.value)}
                    />
                </div>
            </div>

            <div className="form-group">
                <label>Risk Description</label>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <span>Include:</span>
                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}><em>why it exists</em> (cause)</span>
                    <span>·</span>
                    <span style={{ background: '#f0fdf4', color: '#15803d', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}><em>what might happen</em> (event)</span>
                    <span>·</span>
                    <span style={{ background: '#fefce8', color: '#a16207', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}><em>what the consequence would be</em> (impact)</span>
                </div>
                <textarea
                    className="form-control"
                    rows={3}
                    value={form.risk_detail}
                    onChange={(e) => update('risk_detail', e.target.value)}
                    onBlur={() => { if (form.risk_detail.trim()) runStatementCheck(); }}
                    required
                />
                {statementCheck && (
                    <div style={{
                        marginTop: 6,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: `1px solid ${statementCheck.allPresent ? '#bbf7d0' : '#fde68a'}`,
                        background: statementCheck.allPresent ? '#f0fdf4' : '#fffbeb',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                    }}>
                        <span style={{ fontWeight: 600, color: statementCheck.allPresent ? '#166534' : '#92400e' }}>
                            {statementCheck.allPresent ? '✅ Statement looks complete' : '⚠ Statement may be missing elements'}
                        </span>
                        <span style={{ display: 'flex', gap: 6 }}>
                            {[
                                { label: 'Cause', ok: statementCheck.cause },
                                { label: 'Event', ok: statementCheck.effect },
                                { label: 'Impact', ok: statementCheck.impact },
                            ].map(({ label, ok }) => (
                                <span key={label} style={{
                                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                    background: ok ? '#166534' : '#d97706',
                                    color: '#fff',
                                }}>
                                    {ok ? '✓' : '○'} {label}
                                </span>
                            ))}
                        </span>
                        {!statementCheck.allPresent && (
                            <span style={{ color: '#92400e' }}>
                                You can still save — consider strengthening before submitting.
                            </span>
                        )}
                    </div>
                )}
            </div>
            </div>

            <div className="step-section">
            <h3>Step 2 — Inherent Risk Scoring</h3>
            <div className="form-row">
                <ScoreSelect label="Likelihood" kind="likelihood" value={form.inherent_likelihood} onChange={(v) => update('inherent_likelihood', v)} onShowInfo={() => setShowInfoModal('likelihood')} />
                <ScoreSelect label="Impact" kind="impact" value={form.inherent_impact} onChange={(v) => update('inherent_impact', v)} onShowInfo={() => setShowInfoModal('impact')} />
                <div className="form-group">
                    <label>Inherent Score</label>
                    <div style={{ paddingTop: 6 }}>
                        <span className={`badge ${inherentBadge.className}`}>
                            {inherentBadge.label} ({inherentBadge.score})
                        </span>
                    </div>
                </div>
                <div className="form-group">
                    <label>Treatment Strategy</label>
                    <select className="form-control" value={form.treatment_strategy} onChange={(e) => update('treatment_strategy', e.target.value)}>
                        {TREATMENT_STRATEGIES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                        ))}
                    </select>
                </div>
            </div>
            {isAccept && (
                <div className="alert alert-info">
                    <div className="form-row" style={{ marginBottom: 0 }}>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Treatment Plan Rationale (required for Accept)</label>
                            <textarea
                                className="form-control"
                                rows={2}
                                value={form.treatment_plan_rationale}
                                onChange={(e) => update('treatment_plan_rationale', e.target.value)}
                                required={isAccept}
                            />
                        </div>
                        <div className="form-group">
                            <div style={{ padding: '10px 12px', background: 'var(--color-warning-bg, #fff8e1)', border: '1px solid var(--color-warning, #f5a623)', borderRadius: 6, fontSize: 13, color: 'var(--color-text)' }}>
                                <strong>⚠ CSO Approval Required</strong><br />
                                Selecting "Accept" will route this risk to the CSO's inbox. Only the CSO can formally accept the risk after confirming board approval has been obtained.
                            </div>
                        </div>
                    </div>
                </div>
            )}
            </div>

            <div className="step-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Step 3 — Controls</h3>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowControlRefLibrary(true)}
                    title="Browse the Industry Control Reference Library"
                >
                    📚 Control Reference Library
                </button>
            </div>

            {/* Control Picker Modal */}
            {showControlPicker && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-surface)', borderRadius: 10, width: 640, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>Select Controls from Library</div>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setShowControlPicker(false); setControlPickerSearch(''); setControlPickerDeptOnly(false); }}>✕ Close</button>
                        </div>
                        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input
                                className="form-control"
                                placeholder="Search by ID, description, owner, or type…"
                                value={controlPickerSearch}
                                onChange={(e) => setControlPickerSearch(e.target.value)}
                                autoFocus
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={controlPickerDeptOnly}
                                    onChange={(e) => setControlPickerDeptOnly(e.target.checked)}
                                />
                                Show only controls from this risk's department
                                {controlPickerDeptOnly && form.department && (
                                    <span className="badge badge-role" style={{ fontWeight: 600, textTransform: 'none' }}>{form.department}</span>
                                )}
                                {controlPickerDeptOnly && !form.department && (
                                    <span className="text-muted">(no department selected yet)</span>
                                )}
                            </label>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                            {allControls.length === 0 ? (
                                <div className="text-muted" style={{ padding: '16px 20px', fontSize: 13 }}>No controls in the library yet.</div>
                            ) : (() => {
                                const q = controlPickerSearch.toLowerCase();
                                const riskDept = (form.department || '').toLowerCase();
                                const filtered = allControls.filter((c) => {
                                    if (controlPickerDeptOnly && riskDept) {
                                        const ctrlDept = (c.control_uid || '').split('-')[1] || '';
                                        if (ctrlDept.toLowerCase() !== riskDept.toLowerCase() &&
                                            (c.department || '').toLowerCase() !== riskDept) return false;
                                    }
                                    return !q ||
                                        (c.control_uid || '').toLowerCase().includes(q) ||
                                        (c.name || '').toLowerCase().includes(q) ||
                                        (c.owner || '').toLowerCase().includes(q) ||
                                        (c.control_type || '').toLowerCase().includes(q);
                                });
                                if (filtered.length === 0) return <div className="text-muted" style={{ padding: '16px 20px', fontSize: 13 }}>No controls match your search.</div>;
                                return filtered.map((c) => {
                                    const selected = linkControlIds.includes(c.id);
                                    return (
                                        <div
                                            key={c.id}
                                            onClick={() => toggleId(linkControlIds, setLinkControlIds, c.id)}
                                            style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 20px', cursor: 'pointer', background: selected ? 'var(--color-primary-light, #e8f0fe)' : 'transparent', borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent' }}
                                        >
                                            <input type="checkbox" checked={selected} onChange={() => {}} style={{ marginTop: 3, cursor: 'pointer' }} />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.control_uid}</div>
                                                <div style={{ fontSize: 13, marginTop: 2 }}>{c.name}</div>
                                                <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
                                                    {[c.control_type, c.owner, c.testing_frequency ? `Test: ${c.testing_frequency}` : null].filter(Boolean).join(' · ')}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="text-muted" style={{ fontSize: 13 }}>{linkControlIds.length} selected</span>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setShowControlPicker(false); setControlPickerSearch(''); setControlPickerDeptOnly(false); }}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="form-group">
                <label>Link existing controls from the Control Library</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowControlPicker(true)}
                    >
                        {allControls.length === 0 ? 'No controls in library yet' : `Browse & Select Controls (${allControls.length} available)`}
                    </button>
                    {linkControlIds.length > 0 && (
                        <span className="text-muted" style={{ fontSize: 12 }}>{linkControlIds.length} selected</span>
                    )}
                </div>
                {linkControlIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {linkControlIds.map((id) => {
                            const c = allControls.find((x) => x.id === id);
                            if (!c) return null;
                            return (
                                <span key={id} className="badge badge-role" style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, textTransform: 'none' }}>
                                    {c.control_uid}: {c.name.length > 40 ? c.name.substring(0, 40) + '…' : c.name}
                                    <button type="button" onClick={() => toggleId(linkControlIds, setLinkControlIds, id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, color: 'inherit' }}>✕</button>
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
            <label>Or create new controls</label>
            {controls.map((c, idx) => (
                <div className="form-row" key={idx}>
                    <div className="form-group">
                        <label style={{ fontSize: 11 }}>Control ID</label>
                        <input
                            className="form-control"
                            value={form.department ? controlIdPreview(idx) : '— Select dept first —'}
                            readOnly
                            style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: 'default' }}
                        />
                    </div>
                    <div className="form-group" style={{ flex: 2 }}>
                        <label style={{ fontSize: 11 }}>Control Description</label>
                        <input className="form-control" placeholder="Control description" value={c.title} onChange={(e) => updateControl(idx, 'title', e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label style={{ fontSize: 11 }}>Control Owner</label>
                        {riskOwnerUsers.length > 0 ? (
                            <select className="form-control" value={c.owner || ''} onChange={(e) => updateControl(idx, 'owner', e.target.value)}>
                                <option value="">— Select owner —</option>
                                {riskOwnerUsers.map((u) => (
                                    <option key={u.id} value={u.full_name || u.email}>
                                        {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input className="form-control" placeholder="Name or email" value={c.owner || ''} onChange={(e) => updateControl(idx, 'owner', e.target.value)} />
                        )}
                    </div>
                    <div className="form-group">
                        <label style={{ fontSize: 11 }}>Type</label>
                        <select className="form-control" value={c.control_type || 'Preventive'} onChange={(e) => updateControl(idx, 'control_type', e.target.value)}>
                            <option>Preventive</option>
                            <option>Detective</option>
                            <option>Corrective</option>
                            <option>Directive</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label style={{ fontSize: 11 }}>Effectiveness</label>
                        <select className="form-control" value={c.effectiveness || 'Not Tested'} onChange={(e) => updateControl(idx, 'effectiveness', e.target.value)}>
                            <option value="Not Tested">Not Tested</option>
                            <option value="Effective">Effective</option>
                            <option value="Partially Effective">Partially Effective</option>
                            <option value="Ineffective">Ineffective</option>
                        </select>
                    </div>
                </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setControls((cs) => [...cs, { title: '', owner: '', control_type: 'Preventive', effectiveness: 'Not Tested' }])}>
                + Add new control
            </button>

            {/* ── Critical Risk + BCP Flag ───────────────────────────────────── */}
            <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 10 }}>Is this a Critical Risk?</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    A critical risk is one where failure could cause material operational disruption — typically requiring a Business Continuity Plan.
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: isCritical ? 700 : 400 }}>
                        <input type="radio" name="is_critical" checked={isCritical} onChange={() => { setIsCritical(true); update('bcp_status', 'Yes'); }} />
                        Yes
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: !isCritical ? 700 : 400 }}>
                        <input type="radio" name="is_critical" checked={!isCritical} onChange={() => { setIsCritical(false); update('bcp_status', ''); }} />
                        No
                    </label>
                </div>
                {isCritical && (
                    <div style={{ marginTop: 14 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Is there a Business Continuity Plan (BCP) in place?</div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: form.bcp_status === 'Yes' ? 700 : 400 }}>
                                <input type="radio" name="bcp_in_place" checked={form.bcp_status === 'Yes'} onChange={() => update('bcp_status', 'Yes')} />
                                Yes
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: form.bcp_status === 'In Development' ? 700 : 400 }}>
                                <input type="radio" name="bcp_in_place" checked={form.bcp_status === 'In Development'} onChange={() => update('bcp_status', 'In Development')} />
                                In Development
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: form.bcp_status === 'No' ? 700 : 400 }}>
                                <input type="radio" name="bcp_in_place" checked={form.bcp_status === 'No'} onChange={() => update('bcp_status', 'No')} />
                                No
                            </label>
                        </div>
                        {form.bcp_status === 'Yes' && (
                            <div className="form-group" style={{ marginTop: 10 }}>
                                <label>BCP Document Link <span className="text-muted" style={{ fontWeight: 400 }}>(external URL, optional)</span></label>
                                <input
                                    className="form-control"
                                    placeholder="https://… or SharePoint/Drive URL"
                                    value={form.bcp_link}
                                    onChange={(e) => update('bcp_link', e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
            </div>

            <div className="step-section">
            <h3>Step 4 — Residual Risk Scoring</h3>
            <div className="form-row">
                <ScoreSelect label="Likelihood" kind="likelihood" value={form.residual_likelihood} onChange={(v) => update('residual_likelihood', v)} onShowInfo={() => setShowInfoModal('likelihood')} />
                <ScoreSelect label="Impact" kind="impact" value={form.residual_impact} onChange={(v) => update('residual_impact', v)} onShowInfo={() => setShowInfoModal('impact')} />
                <div className="form-group">
                    <label>Residual Score</label>
                    <div style={{ paddingTop: 6 }}>
                        <span className={`badge ${residualBadge.className}`}>
                            {residualBadge.label} ({residualBadge.score})
                        </span>
                    </div>
                </div>
            </div>
            </div>

            {/* Bug 8 — MAP popup */}
            {showMapPopup && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 28, width: 420, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                        <h3 style={{ marginTop: 0, color: '#dc2626' }}>⚠ Mitigation Action Plan Required</h3>
                        <p style={{ fontSize: 14 }}>
                            One or more controls are marked as <strong>Partially Effective</strong> or <strong>Ineffective</strong>.
                            A Mitigation Action Plan is mandatory before this risk can be saved.
                        </p>
                        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                            Please scroll down to <strong>Step 5 — Mitigation Action Plan</strong> and add at least one action.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={() => setShowMapPopup(false)}>OK, I'll add one</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="step-section">
            <h3 style={mapRequired ? { color: '#dc2626', borderLeft: '4px solid #dc2626', paddingLeft: 10 } : {}}>
                Step 5 — Mitigation Action Plan (MAP)
                {mapRequired && <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 10, color: '#dc2626' }}>⚠ Required for Partially Effective / Ineffective controls</span>}
            </h3>
            {mitigations.map((m, idx) => (
                <div key={idx} style={{ border: `1px solid ${mapRequired ? '#dc2626' : 'var(--color-border)'}`, borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Action</label>
                            <input className="form-control" value={m.action} onChange={(e) => updateMitigation(idx, 'action', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Action Owner</label>
                            <input className="form-control" placeholder="Name or email" value={m.action_owner} onChange={(e) => updateMitigation(idx, 'action_owner', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <select className="form-control" value={m.status} onChange={(e) => updateMitigation(idx, 'status', e.target.value)}>
                                <option>Pending</option>
                                <option>In Progress</option>
                                <option>Complete</option>
                                <option>Deferred</option>
                                <option>Cancelled</option>
                            </select>
                        </div>
                    </div>
                    {m.status === 'Deferred' && (
                        <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                            <label style={{ color: '#ea580c', fontWeight: 600, fontSize: 13 }}>Do you have compensatory controls in place?</label>
                            <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input type="radio" name={`comp_ctrl_${idx}`} value="Yes" checked={m.compensatory_controls_in_place === 'Yes'} onChange={() => updateMitigation(idx, 'compensatory_controls_in_place', 'Yes')} />
                                    Yes
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input type="radio" name={`comp_ctrl_${idx}`} value="No" checked={m.compensatory_controls_in_place === 'No'} onChange={() => updateMitigation(idx, 'compensatory_controls_in_place', 'No')} />
                                    No
                                </label>
                            </div>
                        </div>
                    )}
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Root Cause</label>
                            <input className="form-control" placeholder="" value={m.root_cause} onChange={(e) => updateMitigation(idx, 'root_cause', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Start Date</label>
                            <input type="date" className="form-control" value={m.start_date} onChange={(e) => updateMitigation(idx, 'start_date', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>End Date</label>
                            <input type="date" className="form-control" value={m.end_date} onChange={(e) => updateMitigation(idx, 'end_date', e.target.value)} />
                        </div>
                    </div>
                </div>
            ))}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setMitigations((ms) => [...ms, { action: '', action_owner: '', root_cause: '', start_date: '', end_date: '', status: 'Pending', compensatory_controls_in_place: '' }])}
            >
                + Add mitigation action
            </button>
            </div>

            <div className="step-section">
            <h3>Step 6 — Review &amp; Framework</h3>
            <div className="form-row">
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
                <FrameworkRefField value={form.framework_reference} onChange={(v) => update('framework_reference', v)} />
            </div>
            </div>

            {/* ── Step 9 — Save ── */}
            <div className="step-section">
                <h3 style={{ marginTop: 0 }}>Step 7 — Save</h3>
                <p style={{ color: 'var(--color-text-muted, #666)', fontSize: 13, marginBottom: 12 }}>
                    Review your entries above, then save. The statement quality check runs automatically when you leave the Risk Description field.
                </p>

                {statementCheck && (
                    <div style={{
                        borderRadius: 8,
                        border: `1px solid ${statementCheck.allPresent ? 'var(--color-success, #2e7d32)' : 'var(--color-warning, #b45309)'}`,
                        background: statementCheck.allPresent ? 'var(--color-success-bg, #f0faf0)' : 'var(--color-warning-bg, #fff8e1)',
                        padding: '14px 18px',
                        marginBottom: 16,
                        fontSize: 13,
                    }}>
                        {statementCheck.allPresent ? (
                            <div>
                                <strong style={{ color: 'var(--color-success, #2e7d32)', fontSize: 14 }}>
                                    ✅ Statement looks good
                                </strong>
                                <p style={{ margin: '6px 0 0', color: 'var(--color-text, #333)' }}>
                                    Your description appears to include a <strong>cause</strong>, a <strong>risk event</strong>, and an <strong>impact</strong>. The statement is ready to save.
                                </p>
                            </div>
                        ) : (
                            <div>
                                <strong style={{ color: 'var(--color-warning-text, #7c4700)', fontSize: 14 }}>
                                    ⚠ Statement may be missing elements
                                </strong>
                                <p style={{ margin: '6px 0 8px', color: 'var(--color-text, #333)' }}>
                                    The following elements were not clearly detected in your description:
                                </p>
                                <ul style={{ margin: '0 0 10px 0', paddingLeft: 20, color: 'var(--color-text, #333)' }}>
                                    {statementCheck.missing.map((m) => <li key={m}><strong>{m}</strong></li>)}
                                </ul>
                                <div style={{
                                    background: 'rgba(0,0,0,0.04)',
                                    borderRadius: 6,
                                    padding: '10px 14px',
                                    marginBottom: 8,
                                    fontSize: 12,
                                    color: 'var(--color-text, #333)',
                                }}>
                                    <strong>Example of a complete risk statement:</strong><br />
                                    <em style={{ color: 'var(--color-text-muted, #555)', lineHeight: 1.6 }}>
                                        "Due to <u>inadequate patch management processes</u>, there is a risk that <u>a known vulnerability in our systems is exploited by an attacker</u>, resulting in <u>a data breach and regulatory penalties under PIPEDA</u>."
                                    </em>
                                    <br /><br />
                                    <strong>Try adding trigger words like:</strong>{' '}
                                    <span style={{ color: 'var(--color-text-muted, #555)' }}>
                                        {!statementCheck.cause && <><em>cause: "due to…", "because of…", "failure to…"</em>{(!statementCheck.effect || !statementCheck.impact) && ' · '}</>}
                                        {!statementCheck.effect && <><em>event: "there is a risk that…", "could…", "may…"</em>{!statementCheck.impact && ' · '}</>}
                                        {!statementCheck.impact && <><em>impact: "resulting in…", "leading to…", "causing…"</em></>}
                                    </span>
                                </div>
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
                                    You can still save — but consider strengthening the description first. A clear statement is more defensible in a Board or audit review.
                                </p>
                            </div>
                        )}

                        {/* Element indicators */}
                        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                            {[
                                { label: 'Cause', ok: statementCheck.cause },
                                { label: 'Risk event', ok: statementCheck.effect },
                                { label: 'Impact', ok: statementCheck.impact },
                            ].map(({ label, ok }) => (
                                <span key={label} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                    background: ok ? 'var(--color-success, #2e7d32)' : '#ccc',
                                    color: ok ? '#fff' : '#555',
                                }}>
                                    {ok ? '✓' : '○'} {label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: 4 }}>
                    {submitting ? 'Saving…' : statementCheck?.allPresent ? '✅ Save Risk Assessment' : 'Save Risk Assessment'}
                </button>
            </div>
        </form>
    );
}
