// AuthContext.jsx
//
// Holds the session token, current user, company list, and active
// company. Also runs the client-side idle timer that mirrors the
// server's 10-minute sliding session timeout (G8) -- the server is
// the source of truth (it rejects expired tokens), but warning the
// user client-side before that happens is much friendlier.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createApiClient, ApiError } from './api';

const AuthContext = createContext(null);

const WARNING_BEFORE_MS = 60 * 1000; // show "you're about to be logged out" 60s before timeout

// True when running as a standalone window (macOS "Add to Dock", iOS/Android
// "Add to Home Screen", or an installed PWA) rather than a regular browser tab.
// `display-mode: standalone` is the standard check; `navigator.standalone` is
// the older iOS Safari-specific flag, kept as a fallback.
export function isStandaloneApp() {
    return (
        (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true
    );
}

export function AuthProvider({ children }) {
    // Session is the source of truth — no token stored in JS (httpOnly cookie handles that).
    const [session, setSession] = useState(null); // { user, companies, activeCompanyId, idleTimeoutMinutes, passwordExpired }
    const [loading, setLoading] = useState(true);
    const [idleWarning, setIdleWarning] = useState(false);
    const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
    // mfaState: null | { type: 'verify' | 'setup', preAuthToken: string }
    const [mfaState, setMfaState] = useState(null);

    const idleTimerRef = useRef(null);
    const warningTimerRef = useRef(null);
    const heartbeatRef = useRef(null);

    const handleUnauthorized = useCallback(() => {
        setSession(null);
    }, []);

    // No token getter needed — cookie is sent automatically by the browser.
    const api = createApiClient(null, handleUnauthorized);

    const refreshMe = useCallback(async () => {
        try {
            const me = await api.get('/auth/me');
            setSession(me);
        } catch (e) {
            // 401 = no valid cookie → stay logged out; other errors log to console
            if (!(e instanceof ApiError)) console.error(e);
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Check session once on mount (cookie is sent automatically).
    useEffect(() => {
        refreshMe();
    }, []);

    // ---- Idle timer: resets on any user activity or API response ----
    const resetIdleTimer = useCallback(() => {
        if (!session) return;
        setIdleWarning(false);
        clearTimeout(idleTimerRef.current);
        clearTimeout(warningTimerRef.current);

        const timeoutMs = (session.idleTimeoutMinutes || 10) * 60 * 1000;

        warningTimerRef.current = setTimeout(() => setIdleWarning(true), timeoutMs - WARNING_BEFORE_MS);
        idleTimerRef.current = setTimeout(() => {
            handleUnauthorized();
        }, timeoutMs);
    }, [session, handleUnauthorized]);

    useEffect(() => {
        if (!session) return;
        resetIdleTimer();
        const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        const handler = () => resetIdleTimer();
        events.forEach((ev) => window.addEventListener(ev, handler));
        return () => {
            events.forEach((ev) => window.removeEventListener(ev, handler));
            clearTimeout(idleTimerRef.current);
            clearTimeout(warningTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    // Session heartbeat — polls /api/auth/me every 30 s while logged in.
    // If another device has logged in and invalidated this session, the server
    // returns 401, handleUnauthorized() fires, and this device is logged out
    // within 30 seconds rather than waiting for the next user-triggered API call.
    useEffect(() => {
        if (!session) {
            clearInterval(heartbeatRef.current);
            return;
        }
        heartbeatRef.current = setInterval(async () => {
            try {
                await api.get('/auth/me');
            } catch {
                // 401 is handled by handleUnauthorized via the api client;
                // other errors (network blip) are silently ignored.
            }
        }, 30 * 1000);
        return () => clearInterval(heartbeatRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    async function login(email, password) {
        const result = await api.post('/auth/login', { email, password });

        // MFA gate — server returns a pre-auth Bearer token, not a session cookie.
        if (result.mfa_setup_required) {
            setMfaState({ type: 'setup', preAuthToken: result.pre_auth_token });
            return result;
        }
        if (result.mfa_required) {
            setMfaState({ type: 'verify', preAuthToken: result.pre_auth_token });
            return result;
        }

        // Full session granted (server set the httpOnly cookie — nothing to store here).
        setSession(result);
        return result;
    }

    // Fetch the QR code for MFA setup — uses the pre-auth token.
    async function getMfaSetup() {
        if (!mfaState) throw new Error('No MFA state');
        const preAuthApi = createApiClient(() => mfaState.preAuthToken, () => setMfaState(null));
        return preAuthApi.get('/auth/mfa/setup');
    }

    // Confirm MFA setup with the first TOTP code.
    async function confirmMfaSetup(code) {
        if (!mfaState) throw new Error('No MFA state');
        const preAuthApi = createApiClient(() => mfaState.preAuthToken, () => setMfaState(null));
        const result = await preAuthApi.post('/auth/mfa/setup/verify', { code });
        // Server sets the httpOnly cookie; we just store the session payload.
        setMfaState(null);
        setSession(result);
        return result;
    }

    // Verify TOTP code for an already-enrolled user.
    async function verifyMfa(code) {
        if (!mfaState) throw new Error('No MFA state');
        const preAuthApi = createApiClient(() => mfaState.preAuthToken, () => setMfaState(null));
        const result = await preAuthApi.post('/auth/mfa/verify', { code });
        setMfaState(null);
        setSession(result);
        return result;
    }

    function cancelMfa() {
        setMfaState(null);
    }

    async function logout() {
        // window.close() is only permitted while "user activation" from the
        // click that triggered this is still fresh -- it expires quickly and
        // does not reliably survive an awaited network round trip. So in the
        // standalone case we close synchronously, right here in the same
        // tick as the click, and let the /auth/logout call fire in the
        // background rather than blocking on it first.
        if (isStandaloneApp()) {
            api.post('/auth/logout').catch(() => {
                // ignore -- we're logging out regardless
            });
            handleUnauthorized();
            window.close();
            return;
        }
        try {
            await api.post('/auth/logout');
        } catch {
            // ignore -- we're logging out regardless
        }
        handleUnauthorized();
    }

    async function changePassword(currentPassword, newPassword) {
        await api.post('/auth/change-password', { currentPassword, newPassword });
        await refreshMe();
    }

    async function acceptDisclaimer() {
        await api.post('/auth/accept-disclaimer');
        // Update session in place — no need for a full round-trip.
        setSession((s) => s ? { ...s, user: { ...s.user, disclaimer_accepted: true } } : s);
    }

    async function switchCompany(companyId) {
        await api.post('/auth/switch-company', { company_id: companyId, group_view: false });
        await refreshMe();
        setCompanyPickerOpen(false);
    }

    // Enter consolidated group view for a parent company
    async function switchGroupView(companyId) {
        await api.post('/auth/switch-company', { company_id: companyId, group_view: true });
        await refreshMe();
        setCompanyPickerOpen(false);
    }

    const value = {
        session,
        loading,
        idleWarning,
        companyPickerOpen,
        mfaState,
        openCompanyPicker: () => setCompanyPickerOpen(true),
        api,
        login,
        logout,
        changePassword,
        acceptDisclaimer,
        switchCompany,
        switchGroupView,
        refreshMe,
        dismissIdleWarning: () => setIdleWarning(false),
        getMfaSetup,
        confirmMfaSetup,
        verifyMfa,
        cancelMfa,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
