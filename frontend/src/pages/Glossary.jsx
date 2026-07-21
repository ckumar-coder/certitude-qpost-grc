// Glossary.jsx — Glossary page. Viewing is open to everyone; `isAdmin`
// (below) gates adding/editing/deleting custom terms to Admin only. See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

const BUILT_IN_TERMS = [
    { term: 'Audit Trail',            definition: 'A chronological record of all changes to risks, controls, policies, and other records — who changed what, and when. Required for regulatory compliance and internal investigations.' },
    { term: 'Control',                definition: 'An action, process, or safeguard put in place to reduce the likelihood or impact of a risk. Controls can be Preventive (stop it happening), Detective (spot it after the fact), or Corrective (fix it once detected).' },
    { term: 'Control Effectiveness',  definition: 'The degree to which a control achieves its intended purpose. Rated Effective, Partially Effective, or Ineffective based on recorded test results — never by manual override.' },
    { term: 'COSO ERM',               definition: 'Committee of Sponsoring Organizations of the Treadway Commission — Enterprise Risk Management. A widely used risk management framework that aligns strategy, performance, and risk.' },
    { term: 'Escalation',             definition: 'Automatic notification to a supervisor or senior role when an item (overdue control test, Red KRI, non-compliant obligation) has not been addressed within a defined period.' },
    { term: 'Inherent Risk',          definition: 'The level of risk before any controls are applied — the raw exposure. Scored on a 1–5 likelihood × impact scale (1–25 range). Compared to residual risk to assess control effectiveness.' },
    { term: 'Issue',                  definition: 'A confirmed problem or gap that requires a remediation action. Issues are raised automatically on KRI breaches, control failures, and non-compliant obligations, or manually by any Manager or Admin.' },
    { term: 'ISO 31000',              definition: 'International standard for risk management principles and guidelines. The primary framework reference for this application\'s risk methodology.' },
    { term: 'KRI',                    definition: 'Key Risk Indicator. A metric that signals whether a risk is increasing or approaching a threshold. KRIs are measured at a defined frequency (e.g. monthly) and rated Green, Amber, or Red against defined tolerance bands.' },
    { term: 'Likelihood',             definition: 'The probability that a risk event will occur, scored 1 (Rare) to 5 (Almost Certain). Multiplied by Impact to produce the overall risk score.' },
    { term: 'Impact',                 definition: 'The consequence if a risk event occurs, scored 1 (Negligible) to 5 (Catastrophic). Multiplied by Likelihood to produce the overall risk score.' },
    { term: 'Obligation',             definition: 'A specific regulatory or contractual requirement the organisation must comply with. Each obligation is tracked to a compliance status and linked to the policies, controls, and KRIs that support compliance.' },
    { term: 'RACI',                   definition: 'Responsible, Accountable, Consulted, Informed — a framework for defining roles on risks, controls, and policies. The Org Roles screen records the organisation\'s RACI directory.' },
    { term: 'RAG Status',             definition: 'Red / Amber / Green — a traffic-light rating used for KRI bands, compliance status, and issue priority. Red = breach or critical; Amber = watch; Green = within tolerance.' },
    { term: 'Residual Risk',          definition: 'The level of risk remaining after controls are applied. If residual risk still exceeds the risk appetite threshold, the risk is flagged as an Appetite Breach.' },
    { term: 'Risk Accepted',          definition: 'A disposition applied to a risk or issue where the organisation decides not to remediate. Requires formal approval from an Admin (not the item owner) and a documented rationale and review date.' },
    { term: 'Risk Appetite',          definition: 'The level of risk the organisation is willing to accept in pursuit of its objectives. Expressed as a numeric threshold (1–25). Risks with a residual score above this threshold are flagged for attention.' },
    { term: 'Risk Owner',             definition: 'The person accountable for managing a risk — monitoring it, ensuring controls remain effective, and escalating when the risk profile changes.' },
    { term: 'Risk Register',          definition: 'The central record of all risks the organisation tracks, including their causes, consequences, scores, controls, treatment strategies, and history.' },
    { term: 'Risk Treatment',         definition: 'The strategy chosen for a risk: Mitigate (reduce likelihood/impact through controls), Avoid (cease the activity), Transfer (insure or outsource), or Accept (document and monitor).' },
    { term: 'Risk Velocity',          definition: 'How quickly a risk could materialise once triggered — Immediate, Short-term, Medium-term, or Long-term. Useful for prioritising response plans alongside the risk score.' },
    { term: 'Separation of Duties',   definition: 'A control principle requiring that the person who closes or verifies an issue must be different from the person who owns it. Prevents self-approval of remediation.' },
    { term: 'Three Lines of Defence', definition: 'A governance model: 1st line = business units (own and manage risk); 2nd line = risk and compliance functions (oversight); 3rd line = internal audit (independent assurance).' },
];

export default function Glossary() {
    const { api, session } = useAuth();
    const t = useT();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isAdmin = role === 'Admin';

    const [customTerms, setCustomTerms] = useState([]);
    const [loading, setLoading]         = useState(true);
    const [search, setSearch]           = useState('');
    const [showForm, setShowForm]       = useState(false);
    const [form, setForm]               = useState({ term: '', definition: '' });
    const [saving, setSaving]           = useState(false);
    const [error, setError]             = useState('');

    async function load() {
        try {
            const data = await api.get('/glossary');
            setCustomTerms(data || []);
        } catch (e) {
            // No custom terms yet — fine
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    async function handleAdd(e) {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.post('/glossary', form);
            setForm({ term: '', definition: '' });
            setShowForm(false);
            await load();
        } catch (err) {
            setError(err.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id) {
        try {
            await api.delete(`/glossary/${id}`);
            await load();
        } catch (err) {
            setError(err.message || 'Failed to delete');
        }
    }

    const allTerms = [
        ...BUILT_IN_TERMS.map((t) => ({ ...t, builtin: true })),
        ...customTerms.map((t)    => ({ ...t, builtin: false })),
    ].sort((a, b) => a.term.localeCompare(b.term));

    const filtered = search.trim()
        ? allTerms.filter((t) =>
            t.term.toLowerCase().includes(search.toLowerCase()) ||
            t.definition.toLowerCase().includes(search.toLowerCase()))
        : allTerms;

    return (
        <div>
            <h1 className="page-title">{t('glossary_title')}</h1>
            <p className="page-subtitle">
                {t('glossary_subtitle')}
                {isAdmin && t('glossary_subtitle_admin')}
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
                <input
                    className="form-control"
                    placeholder={t('glossary_search_ph')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ maxWidth: 320 }}
                />
                <span className="text-muted" style={{ fontSize: 13 }}>{filtered.length} term{filtered.length !== 1 ? 's' : ''}</span>
                {isAdmin && (
                    <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowForm((s) => !s)}>
                        {showForm ? t('glossary_cancel_add') : t('glossary_add_term')}
                    </button>
                )}
            </div>

            {showForm && isAdmin && (
                <form className="card" onSubmit={handleAdd} style={{ marginBottom: 20 }}>
                    <h3 style={{ marginTop: 0 }}>{t('glossary_add_custom')}</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>{t('glossary_term_label')}</label>
                            <input className="form-control" value={form.term} onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))} required />
                        </div>
                        <div className="form-group" style={{ flex: 3 }}>
                            <label>{t('glossary_def_label')}</label>
                            <textarea className="form-control" rows={2} value={form.definition} onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))} required style={{ resize: 'vertical' }} />
                        </div>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('saving') : t('glossary_add_btn')}</button>
                </form>
            )}

            {loading ? (
                <div className="card">{t('loading')}</div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: '22%' }}>{t('glossary_col_term')}</th>
                                <th>{t('glossary_col_def')}</th>
                                <th style={{ width: 40 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((item) => (
                                <tr key={item.term}>
                                    <td>
                                        <strong>{item.term}</strong>
                                        {!item.builtin && (
                                            <span style={{ fontSize: 11, marginLeft: 6, background: '#eff6ff', color: 'var(--color-primary)', padding: '1px 6px', borderRadius: 4 }}>{t('glossary_custom_badge')}</span>
                                        )}
                                    </td>
                                    <td className="text-muted" style={{ lineHeight: 1.6 }}>{item.definition}</td>
                                    <td>
                                        {isAdmin && !item.builtin && (
                                            <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(item.id)}>✕</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={3} className="text-muted" style={{ padding: 24 }}>{t('glossary_no_match')}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
