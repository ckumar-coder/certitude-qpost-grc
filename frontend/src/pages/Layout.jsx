import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import TopBar from '../components/TopBar';
import HelpPanel from '../components/HelpPanel';
import WhatsNew, { hasUnseenUpdates, markAsSeen } from '../components/WhatsNew';
import { useBranding } from '../components/useBranding';
import { useLanguage, useT } from '../contexts/LanguageContext';
import certitudeLogo from '../assets/certitude-logo.png';

// Nav items grouped by section. 'group' is the section heading shown in the
// sidebar; items with no group (undefined) render ungrouped at the top.
const CRO_ROLES = ['Super Admin', 'Admin', 'Risk Manager', 'CRO', 'Consultant CRO'];
const OP_ROLES  = ['Super Admin', 'Risk Manager', 'Risk Owner', 'CRO', 'Consultant CRO'];
const ALL_ROLES = ['Super Admin', 'Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Viewer', 'Consultant CRO'];
const NON_ADMIN = ['Super Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Consultant CRO', 'Viewer'];
const WORKFLOW  = ['Super Admin', 'Risk Champion', 'Risk Owner', 'Risk Manager', 'CRO', 'Consultant CRO'];

// Arabic translations keyed by nav item id
const AR_LABELS = {
    'management-summary': 'لوحة القيادة',
    'my-tasks':           'مهامي',
    'policies':           'مستودع السياسات',
    'org-roles':          'الأدوار التنظيمية (RACI)',
    'risks':              'سجل المخاطر',
    'critical-risks':     'سجل المخاطر الحرجة',
    'controls':           'مكتبة الضوابط',
    'kris':               'مكتبة مؤشرات المخاطر',
    'kri-register':       'سجل مؤشرات المخاطر',
    'issues':             'القضايا والإجراءات',
    'scoring-methodology':'منهجية التقييم',
    'obligations':        'التزامات الامتثال',
    'calendar':           'تقويم الامتثال',
    'branding':           'العلامة التجارية',
    'companies':          'هيكل الشركة',
    'business-units':     'وحدات الأعمال',
    'departments':        'الأقسام',
    'users':              'المستخدمون والصلاحيات',
    'risk-config':        'إعداد المخاطر',
    'escalation-rules':   'قواعد التصعيد',
    'email-settings':     'إعدادات البريد الإلكتروني',
    'ai-integration':     'تكامل الذكاء الاصطناعي',
    'storage-health':     'التخزين والصحة',
    'glossary':           'المسرد',
    'audit':              'سجل المراجعة',
    'data-tools':         'استيراد / تصدير',
    'incident-log':       'سجل الحوادث',
    'risk-appetite':      'شهية المخاطر',
    'horizon-scanning':   'مسح الأفق الاستراتيجي',
    'access-matrix':      'مصفوفة الصلاحيات',
};

const AR_GROUPS = {
    'Governance':             'الحوكمة',
    'Risk':                   'المخاطر',
    'Compliance':             'الامتثال',
    'Admin':                  'المسؤول',
    'Consultant':             'المستشار',
    'Strategic Intelligence': 'الاستخبارات الاستراتيجية',
};

const NAV_ITEMS = [
    // ── Cross-cutting (ungrouped, always at top) ──
    { id: 'management-summary', label: 'Dashboard', roles: NON_ADMIN },
    { id: 'my-tasks',           label: 'My Tasks',           roles: WORKFLOW },

    // ── Governance ──
    { id: 'policies',   label: 'Policy Repository', roles: [...OP_ROLES, 'Viewer', 'Risk Champion'], group: 'Governance' },

    // ── Strategic Intelligence ──
    { id: 'horizon-scanning',    label: 'Horizon Scanning',     roles: ['CRO', 'Consultant CRO', 'Risk Manager'], group: 'Strategic Intelligence' },
    { id: 'org-roles',           label: 'Org Roles (RACI)',     roles: NON_ADMIN, group: 'Strategic Intelligence' },
    { id: 'risk-appetite',       label: 'Risk Appetite',        roles: [...CRO_ROLES, 'Risk Champion', 'Risk Owner', 'Viewer'], group: 'Strategic Intelligence' },
    { id: 'scoring-methodology', label: 'Scoring Methodology',  roles: [...CRO_ROLES, 'Risk Champion', 'Risk Owner', 'Viewer'], group: 'Strategic Intelligence' },

    // ── Risk ──
    { id: 'risks',               label: 'Risk Register',       roles: ['Admin', ...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'critical-risks',      label: 'Critical Risks Log',  roles: NON_ADMIN, group: 'Risk' },
    { id: 'controls',            label: 'Control Library',     roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'kris',                label: 'KRI Library',         roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'kri-register',        label: 'KRI Register',        roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'issues',              label: 'Issues & Actions',    roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'incident-log',        label: 'Incident Log',        roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Risk' },
    { id: 'risk-gov-docs',        label: 'Risk Gov. Documents',       roles: ['Admin', 'Super Admin', 'CRO', 'Consultant CRO', 'Risk Manager'], group: 'Risk' },
    { id: 'forms-templates',      label: 'Forms & Templates',         roles: ['Admin', 'Super Admin', 'CRO', 'Consultant CRO'], group: 'Risk' },

    // ── Compliance ──
    { id: 'obligations', label: 'Compliance Obligations', roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Compliance' },
    { id: 'calendar',    label: 'Compliance Calendar',    roles: [...OP_ROLES, 'Risk Champion', 'Viewer'], group: 'Compliance' },

    // ── Admin (ordered by setup sequence) ──
    { id: 'branding',         label: 'Branding',           roles: ['Admin'], group: 'Admin' },
    { id: 'companies',        label: 'Company Structure',  roles: ['Admin'], group: 'Admin' },
    { id: 'business-units',   label: 'Business Units',     roles: ['Admin'], group: 'Admin' },
    { id: 'departments',      label: 'Departments',        roles: ['Admin'], group: 'Admin' },
    { id: 'users',            label: 'Users & Access',     roles: ['Admin'], group: 'Admin' },
    { id: 'access-matrix',   label: 'Access Matrix',      roles: ['Admin', 'CRO', 'Consultant CRO'], group: 'Admin' },
    { id: 'risk-config',      label: 'Risk Configuration', roles: ['Admin'], group: 'Admin' },
    { id: 'escalation-rules', label: 'Escalation Rules',   roles: ['Admin', 'CRO', 'Consultant CRO'], group: 'Admin' },
    { id: 'email-settings',   label: 'Email Settings',     roles: ['Admin'], group: 'Admin' },
    { id: 'ai-integration',   label: 'AI Integration',     roles: ['Admin'], group: 'Admin' },
    { id: 'storage-health',   label: 'Storage & Health',   roles: ['Admin'], group: 'Admin' },

    // ── Cross-cutting (ungrouped — below Admin so utility items stay at the bottom) ──
    { id: 'glossary',   label: 'Glossary',          roles: ALL_ROLES },
    { id: 'audit',      label: 'Audit Log',         roles: ALL_ROLES },
    { id: 'data-tools', label: 'Import / Export',   roles: CRO_ROLES },
];

export default function Layout({ page, onNavigate, children, groupView }) {
    const { session, logout, openCompanyPicker, idleWarning, dismissIdleWarning } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const isConsultant = !!session.user.is_consultant;
    const branding = useBranding();
    const { lang, setLang } = useLanguage();
    const ar = lang === 'ar';
    const t = useT();

    // Helper: resolve nav label in active language
    const navLabel = (item) => ar ? (AR_LABELS[item.id] || item.label) : item.label;
    const groupLabel = (g) => ar ? (AR_GROUPS[g] || g) : g;

    const [appVersion, setAppVersion] = useState('');
    const [demoMode, setDemoMode] = useState(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [whatsNewOpen, setWhatsNewOpen] = useState(false);
    const [hasUpdates, setHasUpdates] = useState(false);
    const [prevPage, setPrevPage] = useState(null);
    const [deptMap, setDeptMap] = useState({}); // code → name lookup

    function toggleAbout() {
        if (page === 'about') {
            onNavigate(prevPage || (role === 'Admin' ? 'users' : 'my-tasks'));
        } else {
            setPrevPage(page);
            onNavigate('about');
        }
    }

    useEffect(() => {
        setHasUpdates(hasUnseenUpdates());
    }, []);

    // Security: auto-logout if the browser back button is used.
    // Push a sentinel history entry on mount so there's always something to pop.
    // popstate only fires on browser back/forward — never on internal SPA navigation.
    useEffect(() => {
        window.history.pushState({ grcApp: true }, '');
        const handlePop = () => { logout(); };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetch('/api/version')
            .then((r) => r.json())
            .then((d) => { setAppVersion(d.version || ''); setDemoMode(d.demo_mode || null); })
            .catch(() => {});
        fetch('/api/departments')
            .then((r) => r.json())
            .then((list) => {
                const map = {};
                (list || []).forEach((d) => { map[d.code?.toLowerCase()] = d.name; });
                setDeptMap(map);
            })
            .catch(() => {});
    }, []);

    // Resolve dept code → full name (falls back to the raw value if not found)
    const resolveDept = (code) => code ? (deptMap[code.toLowerCase()] || code) : null;

    const visibleItems = NAV_ITEMS.filter((item) =>
        (role === 'Admin' || role === 'Super Admin' || item.roles.includes(role))
    );

    // Build a list of { type: 'heading'|'item', ... } for rendering.
    const navElements = [];
    const seenGroups = new Set();
    for (const item of visibleItems) {
        if (item.group && !seenGroups.has(item.group)) {
            navElements.push({ type: 'heading', label: item.group });
            seenGroups.add(item.group);
        }
        navElements.push({ type: 'item', item });
    }

    return (
        <div className="app-shell" dir={ar ? 'rtl' : 'ltr'}>
            <aside className="sidebar">
                <div className="sidebar-brand" style={{ paddingTop: 24, paddingBottom: 0 }}>
                    <img
                        src={branding.logoUrl || certitudeLogo}
                        alt={branding.name || 'Certitude Advisory Services'}
                        className="sidebar-logo"
                    />
                </div>

                <div className="sidebar-company">
                    {groupView ? (
                        <>
                            <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                                🌐 {ar ? 'لوحة المجموعة' : 'Group Dashboard'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                {activeCompany?.name}
                            </div>
                        </>
                    ) : (
                        <>
                            <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{activeCompany?.name}</div>
                            <div style={{ marginTop: 2 }}>
                                {session.user.full_name && (
                                    <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 12 }}>
                                        {session.user.full_name}
                                    </div>
                                )}
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                                    {role}
                                    {activeCompany?.departments?.length > 0
                                        ? ` · ${activeCompany.departments.map(resolveDept).join(', ')}`
                                        : activeCompany?.department
                                            ? ` · ${resolveDept(activeCompany.department)}`
                                            : ''}
                                </div>
                            </div>
                        </>
                    )}
                    {session.companies.length > 1 && (
                        <button
                            className="nav-link"
                            style={{ padding: '4px 0', fontSize: 12, fontWeight: 600 }}
                            onClick={openCompanyPicker}
                        >
                            {groupView
                                ? (ar ? 'تبديل / الخروج من عرض المجموعة' : 'Switch / exit group view')
                                : (ar ? 'تبديل الشركة' : 'Switch company')}
                        </button>
                    )}
                </div>

                <div className="sidebar-nav">
                {groupView ? (
                    /* In group view, show Group Dashboard */
                    <button
                        className={`nav-link ${page === 'consolidated-dashboard' ? 'active' : ''}`}
                        style={{ textAlign: ar ? 'right' : 'left' }}
                        onClick={() => onNavigate('consolidated-dashboard')}
                    >
                        🌐 {ar ? 'لوحة المجموعة' : 'Group Dashboard'}
                    </button>
                ) : navElements.map((el, i) =>
                    el.type === 'heading' ? (
                        <div
                            key={`heading-${el.label}`}
                            style={{
                                padding: '12px 12px 2px',
                                fontSize: 13,
                                fontWeight: 700,
                                color: (demoMode === 'risk-only' && (el.label === 'Governance' || el.label === 'Compliance'))
                                    ? 'var(--color-text-muted)' : 'var(--color-text)',
                                userSelect: 'none',
                                marginTop: i === 0 ? 0 : 6,
                                borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                                paddingTop: i === 0 ? 4 : 12,
                                textAlign: ar ? 'right' : 'left',
                                opacity: (demoMode === 'risk-only' && (el.label === 'Governance' || el.label === 'Compliance')) ? 0.45 : 1,
                            }}
                        >
                            {groupLabel(el.label)}
                            {demoMode === 'risk-only' && (el.label === 'Governance' || el.label === 'Compliance') && (
                                <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 6, color: 'var(--color-text-muted)' }}>— not in scope</span>
                            )}
                        </div>
                    ) : (() => {
                        const isOrgRolesException = el.item.id === 'org-roles' &&
                            (role === 'CRO' || role === 'Consultant CRO' || role === 'Super Admin');
                        const isGreyedOut = demoMode === 'risk-only' &&
                            (el.item.group === 'Governance' || el.item.group === 'Compliance') &&
                            !isOrgRolesException;
                        return (
                            <button
                                key={el.item.id}
                                className={`nav-link ${page === el.item.id ? 'active' : ''}`}
                                style={{
                                    textAlign: ar ? 'right' : 'left',
                                    opacity: isGreyedOut ? 0.4 : 1,
                                    cursor: isGreyedOut ? 'not-allowed' : 'pointer',
                                    pointerEvents: isGreyedOut ? 'none' : 'auto',
                                }}
                                onClick={() => !isGreyedOut && onNavigate(el.item.id)}
                                disabled={isGreyedOut}
                                title={isGreyedOut ? 'Not included in this demo' : undefined}
                            >
                                {navLabel(el.item)}
                            </button>
                        );
                    })()
                )}

                {/* ── Consultant section (platform-level, not company-scoped) ── */}
                {isConsultant && (
                    <>
                        <div style={{
                            padding: '12px 12px 2px',
                            fontSize: 13, fontWeight: 700,
                            color: 'var(--color-text)',
                            borderTop: '1px solid var(--color-border)',
                            paddingTop: 12, marginTop: 6,
                        }}>
                            {groupLabel('Consultant')}
                        </div>
                        <button
                            className={`nav-link ${page === 'consultant-dashboard' ? 'active' : ''}`}
                            onClick={() => onNavigate('consultant-dashboard')}
                        >
                            {ar ? 'طبقة المعايير' : 'Benchmarking Layer'}
                        </button>
                    </>
                )}

                </div>{/* end sidebar-nav */}

                <div className="sidebar-footer">
                    <div className="text-muted" style={{ padding: '0 8px' }}>
                        {session.user.email}
                    </div>
                    {appVersion && (
                        <div className="text-muted" style={{ padding: '0 8px', fontSize: 11 }}>
                            Qatar Post GRC Workstation — {appVersion}
                        </div>
                    )}
                    <button
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', position: 'relative' }}
                        onClick={() => {
                            setWhatsNewOpen(true);
                            markAsSeen();
                            setHasUpdates(false);
                        }}
                    >
                        {t('whats_new')}
                        {hasUpdates && (
                            <span style={{
                                position: 'absolute', top: 5, right: 8,
                                width: 7, height: 7, borderRadius: '50%',
                                background: '#e53935',
                                display: 'inline-block',
                            }} />
                        )}
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            className="btn btn-secondary btn-sm"
                            style={{ flex: 1 }}
                            onClick={() => setHelpOpen(true)}
                            title="Help for this page"
                        >
                            {t('help')}
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            style={{ flex: 1 }}
                            onClick={toggleAbout}
                        >
                            {t('about')}
                        </button>
                        {/* Language toggle — always LTR, always centered regardless of lang */}
                        <button
                            className="btn btn-secondary btn-sm"
                            style={{
                                flex: 1,
                                fontWeight: 600,
                                direction: 'ltr',
                                padding: '0 6px',
                            }}
                            onClick={() => setLang(ar ? 'en' : 'ar')}
                            title={ar ? 'Switch to English' : 'التبديل إلى العربية'}
                        >
                            {ar ? 'EN' : 'عر'}
                        </button>
                    </div>
                    <button className="btn btn-primary" style={{ width: '100%', textAlign: 'center' }} onClick={logout}>
                        {ar ? 'تسجيل الخروج' : 'Log out'}
                    </button>
                </div>
            </aside>

            <main
                className={`main-content${page === 'about' ? ' main-content--centered' : ''}`}
            >
                {page !== 'about' && <TopBar onNavigate={onNavigate} role={role} />}
                {children}
            </main>

            {helpOpen && (
                <HelpPanel
                    page={page}
                    onClose={() => setHelpOpen(false)}
                    onNavigate={(dest) => { setHelpOpen(false); onNavigate(dest); }}
                />
            )}

            {whatsNewOpen && (
                <WhatsNew onClose={() => setWhatsNewOpen(false)} />
            )}

            {idleWarning && (
                <div className="idle-toast">
                    {t('idle_warning')}{' '}
                    <button
                        className="btn btn-sm btn-primary"
                        style={{ marginLeft: 8 }}
                        onClick={dismissIdleWarning}
                    >
                        {t('stay_signed_in')}
                    </button>
                </div>
            )}
        </div>
    );
}
