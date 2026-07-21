// MyTasks.jsx — My Tasks page, the identity-scoped cross-module inbox.
// Section visibility below is role-conditional (Viewer sees no task
// groups; Risk Champion/CRO-tier/Admin see different groups), but the
// underlying data is always filtered to the logged-in user, not a
// department or role scope. See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import Sparkline, { bandBadgeClass } from '../components/Sparkline';
import { useT } from '../contexts/LanguageContext';
import { RiskDetail } from './RiskRegister';

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

function dueLabel(daysOverdue, neverTested) {
    if (neverTested) return <span className="badge badge-extreme">Never tested</span>;
    if (daysOverdue === null) return <span className="text-muted">—</span>;
    if (daysOverdue > 0) return <span className="badge badge-extreme">{daysOverdue} days overdue</span>;
    if (daysOverdue === 0) return <span className="badge badge-high">Due today</span>;
    return <span className="badge badge-medium">Due in {-daysOverdue} days</span>;
}

export default function MyTasks() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isBuMode = !!activeCompany?.has_business_units;

    const [data, setData] = useState(null);
    const [allDepartments, setAllDepartments] = useState([]);
    const [allBus, setAllBus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionBusy, setActionBusy] = useState(null); // risk id being actioned
    const [actionError, setActionError] = useState('');
    const [selectedRisk, setSelectedRisk] = useState(null); // full-screen risk detail
    const [riskDetailLoading, setRiskDetailLoading] = useState(false);

    // CRO acceptance modal
    const [acceptModal, setAcceptModal] = useState(null); // { id, risk_uid }
    const [acceptNotes, setAcceptNotes] = useState('');
    const [acceptFile, setAcceptFile]   = useState(null);
    const [acceptBusy, setAcceptBusy]   = useState(false);
    const [acceptError, setAcceptError] = useState('');

    // CRO decline modal
    const [declineModal, setDeclineModal] = useState(null); // { id, risk_uid }
    const [declineReason, setDeclineReason] = useState('');
    const [declineBusy, setDeclineBusy]    = useState(false);
    const [declineError, setDeclineError]  = useState('');

    // Send-back modal (Manager reject / Approver reject)
    const [sendBackModal, setSendBackModal] = useState(null); // { id, endpoint }
    const [sendBackReason, setSendBackReason] = useState('');
    const [sendBackBusy, setSendBackBusy]    = useState(false);
    const [sendBackError, setSendBackError]  = useState('');

    async function load() {
        setLoading(true);
        setError('');
        try {
            const [tasks, depts, bus] = await Promise.all([
                api.get('/dashboard/my-tasks'),
                api.get('/departments').catch(() => []),
                isBuMode ? api.get('/business-units').catch(() => []) : Promise.resolve([]),
            ]);
            setData(tasks);
            setAllDepartments(depts || []);
            setAllBus(bus || []);
        } catch (e) {
            setError(e.message || 'Failed to load My Tasks');
        } finally {
            setLoading(false);
        }
    }

    async function openRisk(id) {
        setRiskDetailLoading(true);
        try {
            const risk = await api.get(`/risks/${id}`);
            setSelectedRisk(risk);
        } catch (e) {
            setActionError(e.message || 'Failed to load risk');
        } finally {
            setRiskDetailLoading(false);
        }
    }

    async function handleApprove(id) {
        setActionBusy(id); setActionError('');
        try {
            await api.post(`/risks/${id}/approve`);
            await load();
        } catch (e) {
            setActionError(e.message || 'Failed to approve risk');
        } finally { setActionBusy(null); }
    }

    function handleManagerReject(id) {
        setSendBackModal({ id, endpoint: 'manager-reject' });
        setSendBackReason('');
        setSendBackError('');
    }

    function openAcceptModal(risk) {
        setAcceptModal({ id: risk.id, risk_uid: risk.risk_uid });
        setAcceptNotes('');
        setAcceptFile(null);
        setAcceptError('');
    }

    async function handleAcceptConfirm() {
        setAcceptBusy(true); setAcceptError('');
        try {
            if (acceptFile) {
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(acceptFile);
                });
                await api.post(`/evidence/board_approval/${acceptModal.id}`, {
                    filename:  acceptFile.name,
                    mime_type: acceptFile.type,
                    file_data: base64,
                });
            }
            await api.post(`/risks/${acceptModal.id}/cro-accept`, { notes: acceptNotes || null });
            setAcceptModal(null);
            await load();
        } catch (e) {
            setAcceptError(e.message || 'Failed to accept risk');
        } finally {
            setAcceptBusy(false);
        }
    }

    function openDeclineModal(risk) {
        setDeclineModal({ id: risk.id, risk_uid: risk.risk_uid });
        setDeclineReason('');
        setDeclineError('');
    }

    async function handleDeclineConfirm() {
        setDeclineBusy(true); setDeclineError('');
        try {
            await api.post(`/risks/${declineModal.id}/cro-decline`, { reason: declineReason || null });
            setDeclineModal(null);
            await load();
        } catch (e) {
            setDeclineError(e.message || 'Failed to send back risk');
        } finally {
            setDeclineBusy(false);
        }
    }

    async function handleApproverApprove(id) {
        setActionBusy(id); setActionError('');
        try {
            await api.post(`/risks/${id}/approver-approve`);
            await load();
        } catch (e) {
            setActionError(e.message || 'Failed to forward risk');
        } finally { setActionBusy(null); }
    }

    function handleApproverReject(id) {
        setSendBackModal({ id, endpoint: 'approver-reject' });
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

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return (
            <div>
                <h1 className="page-title">{t('tasks_title')}</h1>
                <div className="card">{t('loading')}</div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div>
                <h1 className="page-title">{t('tasks_title')}</h1>
                <div className="alert alert-error">{error || 'No data available'}</div>
            </div>
        );
    }

    const overdueKris = (data.my_kris || []).filter((k) => k.is_overdue || k.never_measured);

    const approverQueue = data.approver_queue || [];
    const managerQueue = data.manager_queue || [];
    const croApprovalQueue = data.cro_approval_queue || [];
    const croAcceptanceQueue = data.cro_acceptance_queue || [];
    const riskReviewsDue = data.risk_reviews_due || [];
    const appetiteBreaches = data.appetite_breaches || [];
    const hasCriticalBreach = appetiteBreaches.some((b) => b.breach_notification_severity === 'Critical');

    const hasAnyTask =
        appetiteBreaches.length > 0 ||
        data.pending_attestations.length > 0 ||
        (data.control_tests && data.control_tests.length > 0) ||
        (data.my_issues && data.my_issues.length > 0) ||
        (data.policy_reviews && data.policy_reviews.length > 0) ||
        (data.my_kris && data.my_kris.length > 0) ||
        approverQueue.length > 0 ||
        managerQueue.length > 0 ||
        croApprovalQueue.length > 0 ||
        croAcceptanceQueue.length > 0 ||
        riskReviewsDue.length > 0;

    if (selectedRisk) {
        return (
            <div>
                <div style={{ marginBottom: 16 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedRisk(null); load(); }}>
                        ← Back to My Tasks
                    </button>
                </div>
                <RiskDetail
                    risk={selectedRisk}
                    api={api}
                    onClose={async (id, reason) => {
                        await api.post(`/risks/${id}/close`, { closure_reason: reason });
                        setSelectedRisk(null);
                        load();
                    }}
                    onReopen={async (id, reason) => {
                        await api.post(`/risks/${id}/reopen`, { reopen_reason: reason });
                        setSelectedRisk(null);
                        load();
                    }}
                    onRefresh={() => openRisk(selectedRisk.id)}
                />
            </div>
        );
    }

    return (
        <div>
            {/* ── CRO Acceptance modal ── */}
            {acceptModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                }}>
                    <div style={{
                        background: 'var(--color-surface)', borderRadius: 12, padding: 28,
                        width: 500, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: 18 }}>
                            CRO Acceptance — {acceptModal.risk_uid}
                        </h3>

                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                            Acceptance Notes <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span>
                        </label>
                        <textarea
                            value={acceptNotes}
                            onChange={e => setAcceptNotes(e.target.value)}
                            placeholder="Add notes about this acceptance decision…"
                            style={{
                                width: '100%', minHeight: 80, marginBottom: 18, boxSizing: 'border-box',
                                padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
                                fontSize: 14, resize: 'vertical',
                                background: 'var(--color-bg)', color: 'var(--color-text)',
                            }}
                        />

                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                            Board Approval Document <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span>
                        </label>
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
                            Attach evidence of board authorisation for this Accept / Avoid treatment decision.
                        </p>
                        <input
                            type="file"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.xls"
                            onChange={e => setAcceptFile(e.target.files[0] || null)}
                            style={{ fontSize: 13, marginBottom: acceptFile ? 6 : 18 }}
                        />
                        {acceptFile && (
                            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 18px' }}>
                                {acceptFile.name} — {Math.round(acceptFile.size / 1024)} KB
                            </p>
                        )}

                        {acceptError && (
                            <div className="alert alert-error" style={{ marginBottom: 14 }}>{acceptError}</div>
                        )}

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setAcceptModal(null)}
                                disabled={acceptBusy}
                            >
                                {t('cancel')}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAcceptConfirm}
                                disabled={acceptBusy}
                            >
                                {acceptBusy ? 'Processing…' : 'Confirm Acceptance'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CRO Decline modal ── */}
            {declineModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                }}>
                    <div style={{
                        background: 'var(--color-surface)', borderRadius: 12, padding: 28,
                        width: 460, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: 16 }}>
                            Send Back — {declineModal.risk_uid}
                        </h3>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                            {t('reason_label')}
                        </label>
                        <textarea
                            value={declineReason}
                            onChange={e => setDeclineReason(e.target.value)}
                            placeholder="Explain why this risk is being sent back to the Manager…"
                            style={{
                                width: '100%', minHeight: 80, marginBottom: 18, boxSizing: 'border-box',
                                padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)',
                                fontSize: 14, resize: 'vertical',
                                background: 'var(--color-bg)', color: 'var(--color-text)',
                            }}
                        />
                        {declineError && (
                            <div className="alert alert-error" style={{ marginBottom: 14 }}>{declineError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setDeclineModal(null)} disabled={declineBusy}>
                                {t('cancel')}
                            </button>
                            <button className="btn btn-danger" onClick={handleDeclineConfirm} disabled={declineBusy}>
                                {declineBusy ? 'Sending…' : 'Send Back to Manager'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <h1 className="page-title">{t('tasks_title')}</h1>
            <p className="page-subtitle">{t('tasks_subtitle')}</p>
            {riskDetailLoading && <div className="card text-muted">Loading risk…</div>}

            {/* ── Appetite breach alerts ── */}
            {appetiteBreaches.length > 0 && (
                <div style={{
                    border: `2px solid ${hasCriticalBreach ? '#DC2626' : '#EA580C'}`,
                    borderRadius: 8, marginBottom: 20, overflow: 'hidden',
                }}>
                    {/* Header */}
                    <div style={{
                        background: hasCriticalBreach ? '#DC2626' : '#EA580C',
                        color: '#fff', padding: '14px 20px',
                        display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                        <span style={{ fontSize: 20 }}>⚠️</span>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 0.2 }}>
                                {hasCriticalBreach
                                    ? `CRITICAL — Risk Appetite Breach${appetiteBreaches.length > 1 ? 'es' : ''} Require Immediate Action`
                                    : `Risk Appetite Breach${appetiteBreaches.length > 1 ? 'es' : ''} — Action Required Within 24 Hours`}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                                {appetiteBreaches.length} risk{appetiteBreaches.length !== 1 ? 's' : ''} exceed{appetiteBreaches.length === 1 ? 's' : ''} the board-approved appetite boundary
                            </div>
                        </div>
                    </div>

                    {/* Risk rows */}
                    <div style={{ background: hasCriticalBreach ? '#FEF2F2' : '#FFF7ED' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${hasCriticalBreach ? '#FCA5A5' : '#FED7AA'}` }}>
                                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Risk</th>
                                    <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Category</th>
                                    <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Department</th>
                                    <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Owner</th>
                                    <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Score vs Appetite</th>
                                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: hasCriticalBreach ? '#991B1B' : '#9A3412', textTransform: 'uppercase' }}>Urgency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {appetiteBreaches.map((b) => (
                                    <tr
                                        key={b.risk_uid}
                                        style={{
                                            borderBottom: `1px solid ${hasCriticalBreach ? '#FECACA' : '#FED7AA'}`,
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => openRisk(b.id)}
                                    >
                                        <td style={{ padding: '10px 16px' }}>
                                            <strong style={{ color: '#DC2626', fontSize: 13 }}>{b.risk_uid}</strong>
                                            <div style={{ fontSize: 12, color: '#666', marginTop: 2, maxWidth: 280 }}>{b.risk_detail}</div>
                                        </td>
                                        <td style={{ padding: '10px 8px', fontSize: 12 }}>{b.risk_category}</td>
                                        <td style={{ padding: '10px 8px', fontSize: 12, color: '#666' }}>{b.department || '—'}</td>
                                        <td style={{ padding: '10px 8px', fontSize: 12, color: '#666' }}>{b.risk_owner || '—'}</td>
                                        <td style={{ padding: '10px 8px', fontWeight: 700, fontSize: 13, color: '#DC2626', whiteSpace: 'nowrap' }}>
                                            {b.residual_score} <span style={{ fontWeight: 400, color: '#666' }}>vs ≤{b.max_residual_score}</span>
                                        </td>
                                        <td style={{ padding: '10px 16px' }}>
                                            {b.breach_notification_severity === 'Critical'
                                                ? <span className="badge badge-extreme">🔴 Critical</span>
                                                : b.breach_notification_severity === 'High'
                                                ? <span className="badge badge-high">🟠 High</span>
                                                : <span className="badge badge-medium">Breach</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {/* Required action — shown if all breaching risks share the same action */}
                        {appetiteBreaches[0]?.required_breach_action && (
                            <div style={{
                                padding: '10px 20px 14px',
                                fontSize: 12,
                                color: hasCriticalBreach ? '#7F1D1D' : '#7C2D12',
                                borderTop: `1px solid ${hasCriticalBreach ? '#FCA5A5' : '#FED7AA'}`,
                            }}>
                                <strong>Required action ({appetiteBreaches[0].risk_category}):</strong>{' '}
                                {appetiteBreaches[0].required_breach_action}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {overdueKris.length > 0 && (
                <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 8, padding: '16px 20px', marginBottom: 20 }}>
                    <div style={{ fontWeight: 700, color: '#bf360c', fontSize: 16, marginBottom: 4 }}>
                        ⚠ KRI Update{overdueKris.length > 1 ? 's' : ''} Required — {overdueKris.length} indicator{overdueKris.length > 1 ? 's' : ''} pending
                    </div>
                    <div style={{ fontSize: 13, color: '#5d4037', marginBottom: 12 }}>
                        The following KRIs assigned to you have not been updated within their measurement period.
                        Navigate to the Key Risk Indicators register to record the latest values.
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #ffcc80' }}>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#795548' }}>KRI</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#795548' }}>Frequency</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#795548' }}>Last Updated</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#795548' }}>Was Due</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#795548' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {overdueKris.map((k) => (
                                <tr key={k.kri_uid}>
                                    <td style={{ padding: '6px 8px', fontSize: 13 }}>
                                        <strong style={{ color: '#bf360c' }}>{k.kri_uid}</strong>
                                        <div style={{ fontSize: 12, color: '#5d4037' }}>{k.name}</div>
                                    </td>
                                    <td style={{ padding: '6px 8px', fontSize: 13, color: '#5d4037' }}>{k.measurement_frequency}</td>
                                    <td style={{ padding: '6px 8px', fontSize: 13, color: '#795548' }}>
                                        {k.never_measured ? <em>Never recorded</em> : k.last_measurement_date}
                                    </td>
                                    <td style={{ padding: '6px 8px', fontSize: 13, color: '#795548' }}>
                                        {k.next_due_date || '—'}
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <span style={{ background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                                            {k.never_measured ? 'Never measured' : 'Overdue'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!hasAnyTask && <div className="card text-muted">Nothing outstanding right now — you're all caught up.</div>}

            {managerQueue.length > 0 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                        Risks Awaiting Your Approval
                        <span style={{ marginLeft: 10, background: '#e53935', color: '#fff', borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 10px' }}>
                            {managerQueue.length}
                        </span>
                    </h3>
                    {actionError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{actionError}</div>}
                    <table>
                        <thead>
                            <tr>
                                <th>Risk ID</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Category</th>
                                <th>Risk Detail</th>
                                <th>Submitted By</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {managerQueue.map((r) => (
                                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRisk(r.id)}>
                                    <td><strong>{r.risk_uid}</strong></td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === r.department || d.name === r.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td>{bu ? bu.name : (dept ? dept.name : (r.department || <span className="text-muted">Enterprise</span>))}</td>;
                                    })()}
                                    <td>{allDepartments.find((d) => d.code === r.department || d.name === r.department)?.name || r.department || <span className="text-muted">Enterprise</span>}</td>
                                    <td>{r.risk_category}</td>
                                    <td style={{ maxWidth: 280 }}>
                                        {r.risk_detail}
                                        {r.cro_notes && (
                                            <div style={{ marginTop: 4, fontSize: 11, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '3px 7px' }}>
                                                ↩ CRO note: {r.cro_notes}
                                            </div>
                                        )}
                                    </td>
                                    <td>{r.assessed_by || r.risk_owner || '—'}</td>
                                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="btn btn-sm btn-primary"
                                            disabled={actionBusy === r.id}
                                            onClick={() => handleApprove(r.id)}
                                        >
                                            {actionBusy === r.id ? '…' : 'Approve ✓'}
                                        </button>
                                        {' '}
                                        <button
                                            className="btn btn-sm btn-danger"
                                            disabled={actionBusy === r.id}
                                            onClick={() => handleManagerReject(r.id)}
                                        >
                                            {t('send_back')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {croApprovalQueue.length > 0 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                        Risks Awaiting Approval
                        <span style={{ marginLeft: 10, background: '#e53935', color: '#fff', borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 10px' }}>
                            {croApprovalQueue.length}
                        </span>
                    </h3>
                    <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
                        The following risks are pending approval. As CRO you may approve or send back any risk.
                    </p>
                    {actionError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{actionError}</div>}
                    <table>
                        <thead>
                            <tr>
                                <th>Risk ID</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Category</th>
                                <th>Risk Detail</th>
                                <th>Submitted By</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {croApprovalQueue.map((r) => (
                                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRisk(r.id)}>
                                    <td><strong>{r.risk_uid}</strong></td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === r.department || d.name === r.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td>{bu ? bu.name : (dept ? dept.name : (r.department || <span className="text-muted">Enterprise</span>))}</td>;
                                    })()}
                                    <td>{allDepartments.find((d) => d.code === r.department || d.name === r.department)?.name || r.department || <span className="text-muted">Enterprise</span>}</td>
                                    <td>{r.risk_category}</td>
                                    <td style={{ maxWidth: 280 }}>{r.risk_detail}</td>
                                    <td>{r.assessed_by || r.risk_owner || '—'}</td>
                                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                        <button className="btn btn-sm btn-primary" disabled={actionBusy === r.id} onClick={() => handleApprove(r.id)}>
                                            {actionBusy === r.id ? '…' : 'Approve ✓'}
                                        </button>
                                        {' '}
                                        <button className="btn btn-sm btn-danger" disabled={actionBusy === r.id} onClick={() => handleManagerReject(r.id)}>
                                            {t('send_back')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {croAcceptanceQueue.length > 0 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                        Risks Requiring CRO Acceptance
                        <span style={{ marginLeft: 10, background: '#e53935', color: '#fff', borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 10px' }}>
                            {croAcceptanceQueue.length}
                        </span>
                    </h3>
                    <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
                        These risks have been approved with an <strong>Accept</strong> or <strong>Avoid</strong> treatment strategy and require your formal acceptance.
                    </p>
                    {actionError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{actionError}</div>}
                    <table>
                        <thead>
                            <tr>
                                <th>Risk ID</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Category</th>
                                <th>Risk Detail</th>
                                <th>Treatment</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {croAcceptanceQueue.map((r) => (
                                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRisk(r.id)}>
                                    <td><strong>{r.risk_uid}</strong></td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === r.department || d.name === r.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td>{bu ? bu.name : (dept ? dept.name : (r.department || <span className="text-muted">Enterprise</span>))}</td>;
                                    })()}
                                    <td>{allDepartments.find((d) => d.code === r.department || d.name === r.department)?.name || r.department || <span className="text-muted">Enterprise</span>}</td>
                                    <td>{r.risk_category}</td>
                                    <td style={{ maxWidth: 280 }}>{r.risk_detail}</td>
                                    <td><span className="badge badge-medium">{r.treatment_strategy}</span></td>
                                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="btn btn-sm btn-primary"
                                            disabled={actionBusy === r.id}
                                            onClick={() => openAcceptModal(r)}
                                            style={{ marginRight: 6 }}
                                        >
                                            Accept ✓
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-danger"
                                            disabled={actionBusy === r.id}
                                            onClick={() => openDeclineModal(r)}
                                        >
                                            {t('send_back')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {approverQueue.length > 0 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                        Risks Awaiting Your Review
                        <span style={{ marginLeft: 10, background: '#e53935', color: '#fff', borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 10px' }}>
                            {approverQueue.length}
                        </span>
                    </h3>
                    <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
                        The following risks have been submitted and require your review before routing to the Manager queue.
                    </p>
                    {actionError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{actionError}</div>}
                    <table>
                        <thead>
                            <tr>
                                <th>Risk ID</th>
                                <th>Business Unit</th>
                                <th>Department</th>
                                <th>Category</th>
                                <th>Risk Detail</th>
                                <th>Submitted By</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {approverQueue.map((r) => (
                                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRisk(r.id)}>
                                    <td><strong>{r.risk_uid}</strong></td>
                                    {(() => {
                                        const dept = allDepartments.find((d) => d.code === r.department || d.name === r.department);
                                        const bu = isBuMode && dept ? allBus.find((b) => b.id === dept.business_unit_id) : null;
                                        return <td>{bu ? bu.name : (dept ? dept.name : (r.department || <span className="text-muted">Enterprise</span>))}</td>;
                                    })()}
                                    <td>{allDepartments.find((d) => d.code === r.department || d.name === r.department)?.name || r.department || <span className="text-muted">Enterprise</span>}</td>
                                    <td>{r.risk_category}</td>
                                    <td style={{ maxWidth: 260 }}>{r.risk_detail}</td>
                                    <td>{r.assessed_by || r.risk_owner || '—'}</td>
                                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="btn btn-sm btn-primary"
                                            disabled={actionBusy === r.id}
                                            onClick={() => handleApproverApprove(r.id)}
                                        >
                                            {actionBusy === r.id ? '…' : 'Forward ✓'}
                                        </button>
                                        {' '}
                                        <button
                                            className="btn btn-sm btn-danger"
                                            disabled={actionBusy === r.id}
                                            onClick={() => handleApproverReject(r.id)}
                                        >
                                            {t('send_back')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data.pending_attestations.length > 0 && (
                <div className="card">
                    <h3 style={{ marginTop: 0 }}>Policy Attestations Pending</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Policy</th>
                                <th>Category</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.pending_attestations.map((p) => (
                                <tr key={p.policy_uid}>
                                    <td>
                                        <strong>{p.policy_uid}</strong> {p.name}
                                    </td>
                                    <td className="text-muted">{p.category || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="text-muted" style={{ marginTop: 8 }}>
                        Acknowledge these in the Policy Repository.
                    </div>
                </div>
            )}

            {role === 'Viewer' ? null : (
                <>
                    {data.control_tests && data.control_tests.length > 0 && (
                        <div className="card">
                            <h3 style={{ marginTop: 0 }}>Control Tests Due / Overdue</h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Control</th>
                                        <th>Frequency</th>
                                        <th>Last Test</th>
                                        <th>Next Due</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.control_tests.map((c) => (
                                        <tr key={c.control_uid}>
                                            <td>
                                                <strong>{c.control_uid}</strong>
                                                <div className="text-muted">{c.name}</div>
                                            </td>
                                            <td className="text-muted">{c.testing_frequency}</td>
                                            <td className="text-muted">
                                                {c.last_test_date || 'Never'}
                                                {c.last_test_result && c.last_test_date && <div>{c.last_test_result}</div>}
                                            </td>
                                            <td className="text-muted">{c.next_due || '—'}</td>
                                            <td>{dueLabel(c.days_overdue, c.never_tested)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {data.my_issues && data.my_issues.length > 0 && (
                        <div className="card">
                            <h3 style={{ marginTop: 0 }}>
                                {role === 'Risk Champion'
                                    ? 'Issues Raised by My Department'
                                    : role === 'CRO' || role === 'Consultant CRO' || role === 'Admin'
                                        ? 'All Open Issues'
                                        : 'Issues Owned by My Department'}
                            </h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Issue</th>
                                        <th>Source</th>
                                        <th>Owner Dept</th>
                                        <th>Priority</th>
                                        <th>Status</th>
                                        <th>Due</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.my_issues.map((i) => (
                                        <tr key={i.issue_uid}>
                                            <td>
                                                <strong>{i.issue_uid}</strong>
                                                <div className="text-muted">{i.description}</div>
                                                {i.raised_by_dept && i.raised_by_dept !== i.department && (
                                                    <div className="text-muted" style={{ fontSize: 11 }}>Raised by: {i.raised_by_dept}</div>
                                                )}
                                            </td>
                                            <td className="text-muted">{i.source_type}</td>
                                            <td className="text-muted">{i.department || 'Enterprise-wide'}</td>
                                            <td>
                                                <span className={`badge ${priorityBadgeClass(i.priority)}`}>{i.priority}</span>
                                            </td>
                                            <td>
                                                <span className="badge badge-high">{i.status}</span>
                                            </td>
                                            <td className="text-muted">{i.due_date || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {riskReviewsDue.length > 0 && (
                        <div className="card">
                            <h3 style={{ marginTop: 0 }}>
                                Risks Due for Review
                                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                                    — due within 30 days or overdue
                                </span>
                            </h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Risk</th>
                                        <th>Department</th>
                                        <th>Owner</th>
                                        <th>Next Review</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {riskReviewsDue.map((r) => (
                                        <tr key={r.risk_uid} style={{ cursor: 'pointer' }} onClick={() => openRisk(r.id)}>
                                            <td>
                                                <strong style={{ color: 'var(--color-primary)' }}>{r.risk_uid}</strong>
                                                <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{r.risk_detail}</div>
                                            </td>
                                            <td className="text-muted">{r.department || '—'}</td>
                                            <td className="text-muted">{r.risk_owner || '—'}</td>
                                            <td className="text-muted">{r.next_review_date || '—'}</td>
                                            <td>
                                                {r.overdue
                                                    ? <span className="badge badge-extreme">Overdue</span>
                                                    : <span className="badge badge-medium">Due Soon</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {data.policy_reviews && data.policy_reviews.length > 0 && (
                        <div className="card">
                            <h3 style={{ marginTop: 0 }}>Policy Reviews &amp; Approvals</h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Policy</th>
                                        <th>Status</th>
                                        <th>Next Review</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.policy_reviews.map((p) => (
                                        <tr key={p.policy_uid}>
                                            <td>
                                                <strong>{p.policy_uid}</strong> {p.name}
                                            </td>
                                            <td>
                                                <span className={`badge ${p.status === 'Published' ? 'badge-approved' : 'badge-pending'}`}>{p.status}</span>
                                            </td>
                                            <td className="text-muted">{p.next_review_date || '—'}</td>
                                            <td>
                                                {p.awaiting_my_approval && <span className="badge badge-extreme">Awaiting your approval</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {data.my_kris && data.my_kris.length > 0 && (
                        <div className="card">
                            <h3 style={{ marginTop: 0 }}>KRIs I'm Responsible For</h3>
                            <table>
                                <thead>
                                    <tr>
                                        <th>KRI</th>
                                        <th>Current Value</th>
                                        <th>Zone</th>
                                        <th>Next Due</th>
                                        <th>Trend</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.my_kris.map((k) => (
                                        <tr key={k.kri_uid}>
                                            <td>
                                                <strong>{k.kri_uid}</strong>
                                                <div className="text-muted">{k.name}</div>
                                            </td>
                                            <td>{k.current_value ?? '—'}</td>
                                            <td>
                                                <span className={`badge ${bandBadgeClass(k.band)}`}>{k.band || 'No data'}</span>
                                            </td>
                                            <td>
                                                {k.never_measured ? (
                                                    <span className="badge badge-extreme">Never measured</span>
                                                ) : k.is_overdue ? (
                                                    <span className="badge badge-extreme">Overdue (was {k.next_due_date})</span>
                                                ) : (
                                                    <span className="text-muted">{k.next_due_date || '—'}</span>
                                                )}
                                            </td>
                                            <td>
                                                <Sparkline history={k.history} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* Send-back modal (Manager reject / Approver reject) */}
            {sendBackModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ width: 440, padding: 24 }}>
                        <h3 style={{ margin: '0 0 16px' }}>Send Back Risk</h3>
                        <div className="form-group">
                            <label>{t('reason_label')}</label>
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
                                {t('cancel')}
                            </button>
                            <button className="btn btn-danger" onClick={handleSendBackConfirm} disabled={sendBackBusy}>
                                {sendBackBusy ? 'Sending…' : t('send_back')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
