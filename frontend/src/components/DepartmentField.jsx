import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import CascadingDeptSelector from './CascadingDeptSelector';

// Dept field for use inside entity create/edit forms.
// This is a UX auto-fill/lock behavior derived from role + scope, not a
// permission gate in itself — see
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.3 for
// why this is treated as a distinct category from simple show/hide gates.
//
// Managers: locked to their own dept(s) or BU(s) (read-only).
// Admins/CROs: get a full cascading picker (BU→Dept in BU Mode, or grouped
//              flat list in Simple Mode).
//
// Props:
//   twoFields  : when true, renders as two separate labeled form-groups
//                (Business Unit + Department) via CascadingDeptSelector.
//                The parent must NOT wrap in its own form-group in this case.
//   allowBlank : alias for allowEmpty (default true)
//   blankLabel : text for the blank option — do NOT include em-dashes, the
//                selector wraps it automatically. e.g. "Enterprise-wide".
//                Callers may pass "— Enterprise-wide —"; dashes are stripped.
export default function DepartmentField({
    value, onChange, label = 'Department', required = false, disabled = false,
    twoFields = false,
    allowBlank = true,
    blankLabel,
}) {
    const { api, session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role;
    const isBuMode = !!activeCompany?.has_business_units;

    const [departments, setDepartments] = useState([]);
    const [bus, setBus] = useState([]);

    useEffect(() => {
        // Fetch for all roles that render a dept picker or locked field needing name resolution.
        if (role === 'Admin' || role === 'CRO' || role === 'Consultant CRO' || role === 'Risk Manager' || role === 'Risk Champion' || role === 'Risk Owner') {
            api.get('/departments').then(setDepartments).catch(() => {});
            if (isBuMode) api.get('/business-units').then(setBus).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, isBuMode]);

    // Strip leading/trailing em-dashes + spaces so CascadingDeptSelector's own
    // "— ... —" wrapper doesn't produce "— — Enterprise-wide — —".
    const emptyPlaceholder = blankLabel
        ? blankLabel.replace(/^[\s—\-]+|[\s—\-]+$/g, '').trim() || 'Enterprise-wide'
        : 'Enterprise-wide (all departments)';

    if (role === 'Risk Manager') {
        const deptCodes = activeCompany?.departments?.length > 0
            ? activeCompany.departments
            : (activeCompany?.department ? [activeCompany.department] : []);

        let displayValue;
        let scopeNote;

        if (isBuMode && deptCodes.length === 0 && activeCompany?.business_unit_ids?.length > 0) {
            // BU-scoped Manager: their scope is defined by BUs, not individual depts.
            const buIds = (activeCompany.business_unit_ids || []).map(String);
            const assignedBus = bus.filter((b) => buIds.includes(String(b.id)));
            displayValue = assignedBus.length > 0
                ? assignedBus.map((b) => b.name).join(', ')
                : 'Loading…';
            scopeNote = `Records you create are scoped to your business unit${assignedBus.length !== 1 ? 's' : ''}.`;
        } else {
            // Direct-dept Manager: resolve codes to full names.
            const deptNames = deptCodes.map(
                (code) => departments.find((d) => d.code === code || d.name === code)?.name || code
            );
            displayValue = deptNames.join(', ') || '';
            scopeNote = `Items you create are scoped to your department${deptCodes.length !== 1 ? 's' : ''}.`;
        }

        return (
            <div className="form-group">
                <label>{label}</label>
                <input className="form-control" value={displayValue} disabled />
                <div className="text-muted" style={{ marginTop: 4 }}>{scopeNote}</div>
            </div>
        );
    }

    // twoFields: render as two separate labeled form-groups (BU + Dept).
    // In BU Mode both are active dropdowns; in Simple Mode BU is disabled and mirrors dept.
    if (twoFields) {
        return (
            <CascadingDeptSelector
                value={value}
                onChange={onChange}
                departments={departments}
                bus={bus}
                isBuMode={isBuMode}
                twoFields={true}
                required={required}
                disabled={disabled}
                allowEmpty={allowBlank}
                placeholder={emptyPlaceholder}
            />
        );
    }

    return (
        <CascadingDeptSelector
            label={label}
            value={value}
            onChange={onChange}
            departments={departments}
            bus={bus}
            isBuMode={isBuMode}
            required={required}
            disabled={disabled}
            allowEmpty={allowBlank}
            placeholder={emptyPlaceholder}
        />
    );
}
