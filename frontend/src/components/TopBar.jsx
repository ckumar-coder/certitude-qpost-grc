// TopBar.jsx — global search + notification bell, shown in Layout's shell.
// `canSearch` (below) includes Risk Owner — but the backend's
// GET /api/search route excludes Risk Owner (docs/API_REFERENCE.md
// "Import / Export / Search"), so a Risk Owner sees a working-looking
// search box that 403s. Confirmed still true as of 2026-07-21; see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx Finding 3.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

const NOTIFICATION_PAGE = {
    control_test_overdue: 'controls',
    kri_red_breach: 'kris',
    policy_review_due: 'policies',
    issue_overdue: 'issues',
    obligation_non_compliant: 'obligations',
};

const RESULT_GROUP_KEYS = [
    { key: 'risks',       tKey: 'search_group_risks',       page: 'risks' },
    { key: 'controls',    tKey: 'search_group_controls',    page: 'controls' },
    { key: 'kris',        tKey: 'search_group_kris',        page: 'kris' },
    { key: 'obligations', tKey: 'search_group_obligations', page: 'obligations' },
    { key: 'issues',      tKey: 'search_group_issues',      page: 'issues' },
    { key: 'policies',    tKey: 'search_group_policies',    page: 'policies' },
];

// H8: global search bar across Risks, Controls, KRIs, Obligations,
// Issues, and Policies; G5: in-app notifications driven by the
// configurable escalation rules.
export default function TopBar({ onNavigate, role }) {
    const t = useT();
    const { api } = useAuth();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const searchBoxRef = useRef(null);
    const notifBoxRef = useRef(null);

    const canSearch = role === 'Admin' || role === 'Risk Manager' || role === 'Risk Champion' || role === 'CRO' || role === 'Consultant CRO' || role === 'Risk Owner';

    useEffect(() => {
        if (!canSearch) return;
        let active = true;
        api.get('/notifications')
            .then((data) => {
                if (active) setNotifications(data.notifications || []);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        function handleClickOutside(e) {
            if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setShowResults(false);
            if (notifBoxRef.current && !notifBoxRef.current.contains(e.target)) setShowNotifications(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!canSearch || query.trim().length < 2) {
            setResults(null);
            return;
        }
        setSearching(true);
        const timer = setTimeout(() => {
            api.get(`/search?q=${encodeURIComponent(query.trim())}`)
                .then((data) => setResults(data.results))
                .catch(() => setResults(null))
                .finally(() => setSearching(false));
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    if (!canSearch) return null;

    const totalResults = results ? Object.values(results).reduce((sum, arr) => sum + arr.length, 0) : 0;
    const escalatedCount = notifications.filter((n) => n.level === 'escalated').length;

    return (
        <div className="topbar">
            <div className="topbar-search" ref={searchBoxRef}>
                <input
                    className="form-control"
                    placeholder={t('search_placeholder')}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowResults(true);
                    }}
                    onFocus={() => setShowResults(true)}
                />
                {showResults && query.trim().length >= 2 && (
                    <div className="topbar-dropdown">
                        {searching && (
                            <div className="text-muted" style={{ padding: 10 }}>
                                {t('searching')}
                            </div>
                        )}
                        {!searching && totalResults === 0 && (
                            <div className="text-muted" style={{ padding: 10 }}>
                                {t('no_matches')} &ldquo;{query}&rdquo;
                            </div>
                        )}
                        {!searching &&
                            results &&
                            RESULT_GROUP_KEYS.map((group) => {
                                const items = results[group.key] || [];
                                if (items.length === 0) return null;
                                return (
                                    <div key={group.key}>
                                        <div className="topbar-dropdown-heading">{t(group.tKey)}</div>
                                        {items.map((item) => (
                                            <button
                                                key={item.uid}
                                                className="topbar-dropdown-item"
                                                onClick={() => {
                                                    onNavigate(group.page);
                                                    setShowResults(false);
                                                    setQuery('');
                                                }}
                                            >
                                                <strong>{item.uid}</strong> {item.title}
                                                {item.subtitle ? <span className="text-muted"> — {item.subtitle}</span> : null}
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}
                    </div>
                )}
            </div>

            <div className="topbar-notifications" ref={notifBoxRef}>
                <button className="topbar-bell" onClick={() => setShowNotifications((s) => !s)}>
                    🔔
                    {notifications.length > 0 && (
                        <span className={`topbar-badge ${escalatedCount > 0 ? 'topbar-badge-escalated' : ''}`}>{notifications.length}</span>
                    )}
                </button>
                {showNotifications && (
                    <div className="topbar-dropdown topbar-dropdown-right">
                        <div className="topbar-dropdown-heading">{t('notifications')}</div>
                        {notifications.length === 0 ? (
                            <div className="text-muted" style={{ padding: 10 }}>
                                {t('nothing_needs_attention')}
                            </div>
                        ) : (
                            notifications.map((n, idx) => (
                                <button
                                    key={idx}
                                    className="topbar-dropdown-item"
                                    onClick={() => {
                                        onNavigate(NOTIFICATION_PAGE[n.type] || 'my-tasks');
                                        setShowNotifications(false);
                                    }}
                                >
                                    {n.level === 'escalated' && (
                                        <span className="badge badge-extreme" style={{ marginRight: 6 }}>
                                            {t('status_escalated')}
                                        </span>
                                    )}
                                    {n.message}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
