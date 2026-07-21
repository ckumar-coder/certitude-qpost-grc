// CompanySelect.jsx — V2.0 collapsible hierarchical company picker
// Blue/green alternating colour scheme per company.
// Role gating: `isAdmin` (below) shows admin-only company-switcher
// options, true for Admin role OR the separate is_consultant account
// flag (a different authorization axis — see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6).

import { useState } from 'react';
import { useAuth } from '../AuthContext';

const PALETTE = [
    {
        header:  '#EBF2FA',
        sub:     '#F3F8FD',
        border:  '#C8D8EC',
        badge:   '#D0E4F5',
        badgeTx: '#1A3A6A',
        avatar:  '#1F396428',
        avatarTx:'#1F3964',
        dot:     '#7AAAD0',
    },
    {
        header:  '#E6F4EF',
        sub:     '#EDF7F2',
        border:  '#B8DDD0',
        badge:   '#C2E8D8',
        badgeTx: '#0A5C40',
        avatar:  '#0A5C4020',
        avatarTx:'#0A5C40',
        dot:     '#6FB899',
    },
];

export default function CompanySelect() {
    const { session, switchCompany, switchGroupView, logout } = useAuth();
    const { companies } = session;

    const INDUSTRIES = [
        'Insurance', 'Reinsurance', 'Banking', 'Financial Services', 'Investment Management',
        'Healthcare', 'Pharmaceuticals', 'Energy & Utilities', 'Oil & Gas', 'Manufacturing',
        'Retail & Consumer Goods', 'Technology', 'Telecommunications', 'Real Estate',
        'Government & Public Sector', 'Education', 'Logistics & Transportation', 'Other',
    ];
    const FISCAL_YEAR_ENDS = ['31 March', '30 June', '30 September', '31 December'];

    const [expanded, setExpanded]   = useState({});
    const [showNewForm, setShowNewForm] = useState(false);
    const [form, setForm] = useState({ name: '', code: '', industry: '', company_type: '', country: '', regulatory_body: '', fiscal_year_end: '', description: '' });
    const [creating, setCreating]   = useState(false);
    const [createError, setCreateError] = useState('');
    const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const isAdmin = companies.some((c) => c.role === 'Admin') || !!session.user.is_consultant;

    const toggle = (id) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

    const createCompany = async (e) => {
        e.preventDefault();
        setCreateError('');
        if (!form.name.trim() || !form.code.trim()) return setCreateError('Name and code are required.');
        setCreating(true);
        try {
            const res = await fetch('/api/companies/standalone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ ...form, name: form.name.trim(), code: form.code.trim().toUpperCase() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create company');
            window.location.reload();
        } catch (err) {
            setCreateError(err.message);
            setCreating(false);
        }
    };

    const groupParents    = companies.filter((c) => c.group_access_scope && c.group_access_scope !== 'none');
    const directCompanies = companies.filter((c) => !c.via_group_access);
    const viaGroupSubs    = companies.filter((c) => c.via_group_access);

    const subsByParent = {};
    for (const c of directCompanies) {
        if (c.parent_company_id) {
            (subsByParent[c.parent_company_id] = subsByParent[c.parent_company_id] || []).push(c);
        }
    }

    const topLevel   = directCompanies.filter((c) => !c.parent_company_id);
    const orphanSubs = directCompanies.filter(
        (c) => c.parent_company_id && !directCompanies.find((p) => p.id === c.parent_company_id)
    );
    const groupOnlyParents = groupParents.filter((g) => !directCompanies.find((d) => d.id === g.id));

    // All top-level entries in display order (for palette index)
    const allTopLevel = [...topLevel, ...orphanSubs, ...groupOnlyParents];

    function palette(idx) {
        return PALETTE[idx % PALETTE.length];
    }

    function avatar(c) {
        return (c.code || c.name || '').slice(0, 2).toUpperCase();
    }

    function CompanyCard({ c, idx }) {
        const p      = palette(idx);
        const subs   = subsByParent[c.id] || [];
        const gp     = groupParents.find((g) => g.id === c.id);
        const viaSubs = gp && gp.group_access_scope !== 'consolidated_only'
            ? viaGroupSubs.filter((s) => s.group_via_parent_id === c.id)
            : [];
        const allSubs = [...subs, ...viaSubs.filter((s) => !subs.find((d) => d.id === s.id))];
        const hasChildren = gp || allSubs.length > 0;
        const isOpen = !!expanded[c.id];

        return (
            <div style={{
                border: `0.5px solid ${p.border}`,
                borderRadius: 10,
                overflow: 'hidden',
                marginBottom: 8,
            }}>
                {/* Header row */}
                <div
                    style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '13px 16px',
                        background: p.header,
                        cursor: 'pointer',
                    }}
                    onClick={() => hasChildren ? toggle(c.id) : switchCompany(c.id)}
                >
                    <div style={{
                        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                        background: p.avatar,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: p.avatarTx, fontWeight: 600, fontSize: 13,
                    }}>
                        {avatar(c)}
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text, #1a1a1a)' }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted, #888)', marginTop: 1 }}>
                            {c.code}{gp ? ' · Group' : ''}{allSubs.length > 0 ? ` · ${allSubs.length} subsidiar${allSubs.length === 1 ? 'y' : 'ies'}` : ''}
                        </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 500,
                            background: p.badge, color: p.badgeTx,
                        }}>{c.role}</span>
                        {hasChildren && (
                            <span style={{
                                fontSize: 13, color: 'var(--color-text-muted, #888)',
                                display: 'inline-block',
                                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s',
                                lineHeight: 1,
                            }}>▾</span>
                        )}
                    </div>
                </div>

                {/* Expanded content */}
                {isOpen && (
                    <>
                        {/* Consolidated dashboard button */}
                        {gp && (
                            <button
                                onClick={() => switchGroupView(c.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    width: '100%', padding: '10px 16px',
                                    background: '#1F3964', color: '#fff',
                                    border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                                    borderTop: 'none',
                                }}
                            >
                                <span style={{ fontSize: 15 }}>🌐</span>
                                View consolidated dashboard
                            </button>
                        )}

                        {/* Subsidiaries */}
                        {allSubs.map((sub) => (
                            <button
                                key={sub.id}
                                onClick={() => switchCompany(sub.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    width: '100%', padding: '11px 16px 11px 22px',
                                    background: p.sub,
                                    border: 'none', borderTop: `0.5px solid ${p.border}`,
                                    cursor: 'pointer', textAlign: 'left',
                                }}
                            >
                                <div style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: p.dot, flexShrink: 0,
                                }} />
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text, #1a1a1a)' }}>{sub.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted, #888)' }}>{sub.code}</div>
                                </div>
                                <span style={{
                                    marginLeft: 'auto', fontSize: 11, padding: '2px 8px',
                                    borderRadius: 4, fontWeight: 500,
                                    background: p.badge, color: p.badgeTx,
                                }}>{sub.role}</span>
                            </button>
                        ))}

                        {/* Direct click into the company itself (if it also has direct membership) */}
                        <button
                            onClick={() => switchCompany(c.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '10px 16px',
                                background: p.sub,
                                border: 'none', borderTop: `0.5px solid ${p.border}`,
                                cursor: 'pointer', fontSize: 13,
                                color: p.avatarTx, fontWeight: 500,
                            }}
                        >
                            <span style={{ fontSize: 14 }}>→</span>
                            Open {c.name} directly
                        </button>
                    </>
                )}

            </div>
        );
    }

    return (
        <div className="login-screen">
            <div className="login-card" style={{ maxWidth: 520 }}>
                <div className="login-title" style={{ marginBottom: 4 }}>Your workspaces</div>
                <p className="text-muted" style={{ textAlign: 'center', marginBottom: 24, fontSize: 13 }}>
                    {session.user.full_name ? `${session.user.full_name} · ` : ''}{session.user.email}
                </p>

                <div className="company-grid">
                    {topLevel.map((c, i) => (
                        <CompanyCard key={c.id} c={c} idx={i} />
                    ))}
                    {orphanSubs.map((c, i) => (
                        <CompanyCard key={c.id} c={c} idx={topLevel.length + i} />
                    ))}
                    {groupOnlyParents.map((g, i) => (
                        <CompanyCard key={g.id} c={g} idx={topLevel.length + orphanSubs.length + i} />
                    ))}
                </div>

                {isAdmin && (
                    <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                        {!showNewForm ? (
                            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setShowNewForm(true)}>
                                + Create new company
                            </button>
                        ) : (
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>New standalone company</div>
                                {createError && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{createError}</p>}
                                <form onSubmit={createCompany}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                                        <div>
                                            <label className="form-label">Company name *</label>
                                            <input className="form-control" placeholder="e.g. Gulf Insurance Ltd"
                                                value={form.name} onChange={(e) => upd('name', e.target.value)} autoFocus />
                                        </div>
                                        <div>
                                            <label className="form-label">Company code *</label>
                                            <input className="form-control" placeholder="e.g. GIL" maxLength={20}
                                                value={form.code} onChange={(e) => upd('code', e.target.value.toUpperCase())} />
                                        </div>
                                        <div>
                                            <label className="form-label">Industry</label>
                                            <select className="form-control" value={form.industry} onChange={(e) => upd('industry', e.target.value)}>
                                                <option value="">— Select —</option>
                                                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label">Company type</label>
                                            <input className="form-control" placeholder="e.g. Public, Private, Mutual"
                                                value={form.company_type} onChange={(e) => upd('company_type', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="form-label">Country / jurisdiction</label>
                                            <input className="form-control" placeholder="e.g. Qatar"
                                                value={form.country} onChange={(e) => upd('country', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="form-label">Regulatory body</label>
                                            <input className="form-control" placeholder="e.g. Qatar Central Bank (QCB)"
                                                value={form.regulatory_body} onChange={(e) => upd('regulatory_body', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="form-label">Fiscal year end</label>
                                            <select className="form-control" value={form.fiscal_year_end} onChange={(e) => upd('fiscal_year_end', e.target.value)}>
                                                <option value="">— Select —</option>
                                                {FISCAL_YEAR_ENDS.map((d) => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 10 }}>
                                        <label className="form-label">Description</label>
                                        <textarea className="form-control" rows={2} placeholder="Brief description (optional)"
                                            value={form.description} onChange={(e) => upd('description', e.target.value)} />
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={creating}>
                                            {creating ? 'Creating…' : 'Create company'}
                                        </button>
                                        <button type="button" className="btn btn-secondary"
                                            onClick={() => { setShowNewForm(false); setCreateError(''); }}>
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <button className="nav-link" style={{ width: 'auto', display: 'inline', color: 'var(--color-text-muted)' }} onClick={logout}>
                        Sign out
                    </button>
                </div>
            </div>
        </div>
    );
}
