import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import DisclaimerModal from './components/DisclaimerModal';
import About from './pages/About';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import CompanySelect from './pages/CompanySelect';
import Layout from './pages/Layout';
import RiskRegister from './pages/RiskRegister';
import ControlLibrary from './pages/ControlLibrary';
import KriLibrary from './pages/KriLibrary';
import KriRegister from './pages/KriRegister';
import ComplianceObligations from './pages/ComplianceObligations';
import IssuesTracker from './pages/IssuesTracker';
import PolicyRepository from './pages/PolicyRepository';
import OrgRoles from './pages/OrgRoles';
import UserManagement from './pages/UserManagement';
import RiskConfig from './pages/RiskConfig';
import AuditLog from './pages/AuditLog';
import ManagementSummary from './pages/ManagementSummary';
import MyTasks from './pages/MyTasks';
import DataTools from './pages/DataTools';
import EscalationRules from './pages/EscalationRules';
import Branding from './pages/Branding';
import ScoringMethodology from './pages/ScoringMethodology';
import EmailSettings from './pages/EmailSettings';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import ComplianceCalendar from './pages/ComplianceCalendar';
import Glossary from './pages/Glossary';
import StorageHealth from './pages/StorageHealth';
import Companies from './pages/Companies';
import Departments from './pages/Departments';
import BusinessUnits from './pages/BusinessUnits';
import ConsolidatedDashboard from './pages/ConsolidatedDashboard';
import SetupWizard from './pages/SetupWizard';
import ConsultantDashboard from './pages/ConsultantDashboard';
import CriticalRisksLog from './pages/CriticalRisksLog';
import AccessMatrix from './pages/AccessMatrix';
import IncidentLog from './pages/IncidentLog';
import RiskAppetite from './pages/RiskAppetite';
import HorizonScanning from './pages/HorizonScanning';
import RiskGovDocs from './pages/RiskGovDocs';
import FormsTemplates from './pages/FormsTemplates';
import AiIntegration from './pages/AiIntegration';

export default function App() {
    const { session, loading, companyPickerOpen } = useAuth();
    const [page, setPage] = useState('my-tasks');
    // Incident → Risk Register cross-navigation state
    const [fromIncidentId, setFromIncidentId] = useState(null);

    // Reset to the correct default page on every login (handles logout → re-login without a full
    // page reload, which would otherwise leave `page` at whatever it was last set to).
    useEffect(() => {
        if (!session?.user?.id) return;
        const activeRole = session.companies.find((c) => c.id === session.activeCompanyId)?.role;
        setPage(activeRole === 'Admin' || activeRole === 'Super Admin'
            ? 'management-summary'
            : 'my-tasks');
    }, [session?.user?.id, session?.activeCompanyId]);

    if (loading) {
        return <div className="login-screen">Loading…</div>;
    }

    // Public routes (unauthenticated)
    if (window.location.pathname === '/reset-password' || window.location.search.includes('token=')) {
        return <ResetPassword />;
    }
    if (window.location.pathname === '/reset-password-request') {
        return <ForgotPassword />;
    }

    if (!session) {
        return <Login />;
    }

    if (session.user.must_change_password || session.passwordExpired) {
        return <ChangePassword forced reason={session.passwordExpired ? 'expired' : 'required'} />;
    }

    // Legal disclaimer — shown once per user ever; stored server-side.
    if (!session.user.disclaimer_accepted) {
        return <DisclaimerModal />;
    }

    // No company memberships at all → first-time setup wizard.
    if (session.companies.length === 0) {
        return <SetupWizard />;
    }

    if (!session.activeCompanyId || companyPickerOpen) {
        return <CompanySelect />;
    }

    const isConsultant = !!session.user.is_consultant;

    // Consultant dashboard is platform-level — accessible from any view including group view
    if (page === 'consultant-dashboard' && isConsultant) {
        return (
            <Layout page="consultant-dashboard" onNavigate={setPage} groupView={session.isGroupView}>
                <ConsultantDashboard />
            </Layout>
        );
    }

    // Group view: show consolidated dashboard regardless of page
    if (session.isGroupView) {
        return (
            <Layout page="consolidated-dashboard" onNavigate={setPage} groupView>
                <ConsolidatedDashboard />
            </Layout>
        );
    }

    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;

    const isSuperAdmin = role === 'Super Admin';
    const isCRO = role === 'CRO' || role === 'Consultant CRO';
    const isOp  = isSuperAdmin || role === 'Risk Manager' || role === 'Risk Owner' || isCRO;

    let content;

    // ── Admin-only pages ──────────────────────────────────────────────────────
    if (page === 'risk-config' && (isSuperAdmin || role === 'Admin')) {
        content = <RiskConfig />;
    } else if (page === 'users' && (isSuperAdmin || role === 'Admin')) {
        content = <UserManagement />;
    } else if (page === 'departments' && (isSuperAdmin || role === 'Admin')) {
        content = <Departments />;
    } else if (page === 'business-units' && (isSuperAdmin || role === 'Admin')) {
        content = <BusinessUnits />;
    } else if (page === 'escalation-rules' && (isSuperAdmin || role === 'Admin' || isCRO)) {
        content = <EscalationRules />;
    } else if (page === 'email-settings' && (isSuperAdmin || role === 'Admin')) {
        content = <EmailSettings />;
    } else if (page === 'ai-integration' && (isSuperAdmin || role === 'Admin')) {
        content = <AiIntegration />;
    } else if (page === 'branding' && (isSuperAdmin || role === 'Admin')) {
        content = <Branding />;
    } else if (page === 'storage-health' && (isSuperAdmin || role === 'Admin')) {
        content = <StorageHealth />;
    } else if (page === 'companies' && (isSuperAdmin || role === 'Admin')) {
        content = <Companies />;
    } else if (page === 'access-matrix' && (isSuperAdmin || role === 'Admin' || isCRO)) {
        content = <AccessMatrix />;

    // ── Admin + ops shared pages ──────────────────────────────────────────────
    } else if (page === 'scoring-methodology' && (isSuperAdmin || role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <ScoringMethodology />;
    } else if (page === 'audit') {
        content = <AuditLog />;
    } else if (page === 'data-tools' && (isSuperAdmin || role === 'Admin' || isOp)) {
        content = <DataTools />;

    // ── Always accessible ─────────────────────────────────────────────────────
    } else if (page === 'about') {
        content = <About />;
    } else if (page === 'glossary') {
        content = <Glossary />;

    // ── Operational pages (Admin has full access for demo) ───────────────────
    } else if (page === 'my-tasks' && (role === 'Admin' || isOp || role === 'Risk Champion')) {
        content = <MyTasks />;
    } else if (page === 'management-summary' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <ManagementSummary />;
    } else if (page === 'policies' && true) {
        content = <PolicyRepository />;
    } else if (page === 'risks' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <RiskRegister
            fromIncidentId={fromIncidentId}
            onIncidentLinked={() => { setFromIncidentId(null); setPage('incident-log'); }}
        />;
    } else if (page === 'critical-risks') {
        content = <CriticalRisksLog />;
    } else if (page === 'controls' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <ControlLibrary />;
    } else if (page === 'kris' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <KriLibrary />;
    } else if (page === 'kri-register' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <KriRegister />;
    } else if (page === 'issues' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <IssuesTracker onNavigate={setPage} />;
    } else if (page === 'horizon-scanning') {
        content = <HorizonScanning />;
    } else if (page === 'risk-gov-docs' && (isSuperAdmin || role === 'Admin' || role === 'CRO' || role === 'Consultant CRO' || role === 'Risk Manager')) {
        content = <RiskGovDocs />;
    } else if (page === 'forms-templates' && (isSuperAdmin || role === 'Admin' || role === 'CRO' || role === 'Consultant CRO')) {
        content = <FormsTemplates />;
    } else if (page === 'risk-appetite') {
        content = <RiskAppetite />;
    } else if (page === 'incident-log' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <IncidentLog
            onNavigate={setPage}
            onCreateRisk={(incId) => { setFromIncidentId(incId); setPage('risks'); }}
        />;
    } else if (page === 'obligations' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <ComplianceObligations />;
    } else if (page === 'calendar' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <ComplianceCalendar />;
    } else if (page === 'org-roles' && (role === 'Admin' || isOp || role === 'Risk Champion' || role === 'Viewer')) {
        content = <OrgRoles />;

    // ── Fallbacks ─────────────────────────────────────────────────────────────
    } else if (role === 'Super Admin') {
        // Super Admin default landing: Risk Register
        content = <RiskRegister
            fromIncidentId={fromIncidentId}
            onIncidentLinked={() => { setFromIncidentId(null); setPage('incident-log'); }}
        />;
    } else if (role === 'Admin') {
        // Admin default landing: Users & Access
        content = <UserManagement />;
    } else if (isOp || role === 'Risk Champion') {
        // Operational roles default to Risk Register
        content = <RiskRegister
            fromIncidentId={fromIncidentId}
            onIncidentLinked={() => { setFromIncidentId(null); setPage('incident-log'); }}
        />;
    } else if (role === 'Viewer') {
        // Viewer default landing: Policy Repository
        content = <PolicyRepository />;
    } else {
        content = (
            <div className="card">
                Your account does not yet have access to any modules. Contact your administrator.
            </div>
        );
    }

    return (
        <Layout page={page} onNavigate={setPage}>
            {content}
        </Layout>
    );
}
