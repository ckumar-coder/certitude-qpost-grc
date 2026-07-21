// OrgRoles.jsx — Org Roles (RACI) page. `canManageRaci` gates RACI matrix
// edits (Admin, CRO, Consultant CRO); `canManageDir` gates the underlying
// Role -> Person -> Department directory and additionally admits Risk
// Manager. Viewing is broad (incl. Viewer). See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

// ── RACI helpers ─────────────────────────────────────────────────────────────
const RACI_STYLES = {
    'R':   { background: '#1a56db', color: '#fff' },
    'A':   { background: '#e02424', color: '#fff' },
    'C':   { background: '#d97706', color: '#fff' },
    'I':   { background: '#dbeafe', color: '#1e40af' },
    'R/A': { background: '#7c3aed', color: '#fff' },
};
const RACI_LABELS = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed', 'R/A': 'Responsible & Accountable' };
const RACI_OPTIONS = ['', 'R', 'A', 'C', 'I', 'R/A'];
const ROLE_KEYS   = ['admin', 'cro', 'consultant_cro', 'manager', 'approver', 'submitter', 'viewer'];
const ROLE_LABELS = ['Admin', 'CRO', 'Consultant CRO', 'Risk Manager', 'Risk Owner', 'Risk Champion', 'Viewer'];

function RaciChip({ value }) {
    if (!value) return <span style={{ color: '#ccc', fontSize: 13 }}>—</span>;
    const s = RACI_STYLES[value] || {};
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 30, height: 22, borderRadius: 4, padding: '0 5px',
            fontSize: 11, fontWeight: 700, ...s,
        }}>
            {value}
        </span>
    );
}

function RaciCell({ rowId, roleKey, value, canManage, onSave }) {
    const [editing, setEditing]   = useState(false);
    const [saving,  setSaving]    = useState(false);

    async function handleChange(newVal) {
        setSaving(true);
        setEditing(false);
        await onSave(rowId, roleKey, newVal);
        setSaving(false);
    }

    if (editing) {
        return (
            <select
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => setEditing(false)}
                autoFocus
                style={{ width: 64, fontSize: 11, padding: '2px 4px', borderRadius: 4 }}
            >
                {RACI_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o || '—'}</option>
                ))}
            </select>
        );
    }

    return (
        <span
            onClick={() => canManage && !saving && setEditing(true)}
            title={canManage ? 'Click to edit' : (value ? RACI_LABELS[value] : '')}
            style={{ cursor: canManage ? 'pointer' : 'default', padding: '4px 6px', display: 'inline-block' }}
        >
            {saving ? <span style={{ color: '#aaa', fontSize: 12 }}>…</span> : <RaciChip value={value} />}
        </span>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OrgRoles() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const canManageRaci = role === 'Admin' || role === 'CRO' || role === 'Consultant CRO';
    const canManageDir  = role === 'Admin' || role === 'Risk Manager' || role === 'CRO' || role === 'Consultant CRO';

    const [activeTab, setActiveTab] = useState('raci');

    // ── RACI state ────────────────────────────────────────────────────────────
    const [raciRows,    setRaciRows]    = useState([]);
    const [raciLoading, setRaciLoading] = useState(true);
    const [raciError,   setRaciError]   = useState('');

    // ── Directory state ───────────────────────────────────────────────────────
    const [roles,      setRoles]      = useState([]);
    const [dirLoading, setDirLoading] = useState(false);
    const [dirError,   setDirError]   = useState('');
    const [form,       setForm]       = useState({ role_title: '', person_name: '', department: '', email: '' });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => { loadRaci(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (activeTab === 'directory' && roles.length === 0) loadDirectory();
    }, [activeTab]);  // eslint-disable-line react-hooks/exhaustive-deps

    async function loadRaci() {
        setRaciLoading(true);
        setRaciError('');
        try {
            setRaciRows(await api.get('/raci-matrix'));
        } catch (e) {
            setRaciError(e.message || 'Failed to load RACI matrix');
        } finally {
            setRaciLoading(false);
        }
    }

    async function loadDirectory() {
        setDirLoading(true);
        setDirError('');
        try {
            setRoles(await api.get('/org-roles'));
        } catch (e) {
            setDirError(e.message || 'Failed to load directory');
        } finally {
            setDirLoading(false);
        }
    }

    async function handleRaciSave(id, roleKey, value) {
        try {
            await api.patch(`/raci-matrix/${id}`, { [roleKey]: value });
            setRaciRows((rows) => rows.map((r) => r.id === id ? { ...r, [roleKey]: value } : r));
        } catch (e) {
            setRaciError(e.message || 'Failed to save');
        }
    }

    async function handleDirSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setDirError('');
        try {
            await api.post('/org-roles', form);
            setForm({ role_title: '', person_name: '', department: '', email: '' });
            await loadDirectory();
        } catch (e) {
            setDirError(e.message || 'Failed to add');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDirDelete(id) {
        try {
            await api.delete(`/org-roles/${id}`);
            await loadDirectory();
        } catch (e) {
            setDirError(e.message || 'Failed to delete');
        }
    }

    // Group RACI rows by module
    const moduleOrder = [];
    const moduleMap   = {};
    raciRows.forEach((row) => {
        if (!moduleMap[row.module]) {
            moduleMap[row.module] = [];
            moduleOrder.push(row.module);
        }
        moduleMap[row.module].push(row);
    });

    const TAB_STYLE = (active) => ({
        padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
        fontSize: 14, fontWeight: active ? 600 : 400,
        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
        marginBottom: -1,
    });

    return (
        <div>
            <h1 className="page-title">{t('org_roles_title')}</h1>
            <p className="page-subtitle">{t('org_roles_subtitle')}</p>

            {/* ── Tabs ─────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}>
                <button style={TAB_STYLE(activeTab === 'raci')}      onClick={() => setActiveTab('raci')}>RACI Matrix</button>
                <button style={TAB_STYLE(activeTab === 'directory')} onClick={() => setActiveTab('directory')}>People & Roles</button>
            </div>

            {/* ── RACI Matrix ───────────────────────────────────────────────── */}
            {activeTab === 'raci' && (
                <div>
                    {raciError && <div className="alert alert-error">{raciError}</div>}

                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                        {Object.entries(RACI_STYLES).map(([key, s]) => (
                            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 28, height: 20, borderRadius: 3, padding: '0 4px', fontSize: 10, fontWeight: 700, ...s }}>{key}</span>
                                {RACI_LABELS[key]}
                            </span>
                        ))}
                        {canManageRaci && (
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                Click any cell to edit
                            </span>
                        )}
                    </div>

                    {raciLoading ? (
                        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('loading')}</div>
                    ) : (
                        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', width: '24%' }}>
                                            Activity
                                        </th>
                                        {ROLE_LABELS.map((lbl) => (
                                            <th key={lbl} style={{ textAlign: 'center', padding: '10px 6px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                                                {lbl}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {moduleOrder.map((mod) => (
                                        <>
                                            <tr key={`sect-${mod}`}>
                                                <td colSpan={8} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: '#eff6ff', color: '#1d4ed8', borderTop: '1px solid var(--color-border)' }}>
                                                    {mod}
                                                </td>
                                            </tr>
                                            {moduleMap[mod].map((row) => (
                                                <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '7px 14px', fontSize: 13, color: 'var(--color-text)' }}>{row.activity}</td>
                                                    {ROLE_KEYS.map((rk) => (
                                                        <td key={rk} style={{ textAlign: 'center', padding: '3px 4px' }}>
                                                            <RaciCell
                                                                rowId={row.id}
                                                                roleKey={rk}
                                                                value={row[rk]}
                                                                canManage={canManageRaci}
                                                                onSave={handleRaciSave}
                                                            />
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── People & Roles (directory) ────────────────────────────────── */}
            {activeTab === 'directory' && (
                <div>
                    {dirError && <div className="alert alert-error">{dirError}</div>}

                    {canManageDir && (
                        <form className="card" onSubmit={handleDirSubmit}>
                            <h3 style={{ marginTop: 0 }}>Add external contact</h3>
                            <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                                System users are listed automatically. Use this form to add external contacts not in the system (e.g. board members, advisors).
                            </p>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Role Title</label>
                                    <input className="form-control" placeholder="e.g. Board Advisor" value={form.role_title} onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))} required />
                                </div>
                                <div className="form-group">
                                    <label>Person</label>
                                    <input className="form-control" value={form.person_name} onChange={(e) => setForm((f) => ({ ...f, person_name: e.target.value }))} required />
                                </div>
                                <div className="form-group">
                                    <label>Department</label>
                                    <input className="form-control" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label>Email</label>
                                    <input type="email" className="form-control" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? t('saving') : t('add')}
                            </button>
                        </form>
                    )}

                    <div className="card" style={{ padding: 0 }}>
                        {dirLoading ? (
                            <div style={{ padding: 24 }}>{t('loading')}</div>
                        ) : roles.length === 0 ? (
                            <div style={{ padding: 24 }} className="text-muted">No entries yet.</div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>Role</th>
                                        <th>Person</th>
                                        <th>Department</th>
                                        <th>Email</th>
                                        <th>Source</th>
                                        {canManageDir && <th></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {roles.map((r) => (
                                        <tr key={r.id}>
                                            <td>{r.role_title}</td>
                                            <td>{r.person_name}</td>
                                            <td>{r.department || '—'}</td>
                                            <td>{r.email || '—'}</td>
                                            <td>
                                                <span style={{
                                                    display: 'inline-block', fontSize: 11, padding: '2px 8px',
                                                    borderRadius: 10, fontWeight: 600,
                                                    background: r.source === 'system' ? '#dbeafe' : '#dcfce7',
                                                    color:      r.source === 'system' ? '#1e40af' : '#166534',
                                                }}>
                                                    {r.source === 'system' ? 'System' : 'Manual'}
                                                </span>
                                            </td>
                                            {canManageDir && (
                                                <td>
                                                    {r.source === 'manual' && (
                                                        <button className="btn btn-sm btn-secondary" onClick={() => handleDirDelete(r.id)}>
                                                            {t('remove')}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
