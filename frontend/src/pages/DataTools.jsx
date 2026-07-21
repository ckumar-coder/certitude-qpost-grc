// DataTools.jsx — Import / Export / Search page. The Seed Controls wizard
// (below) is Admin-only. Import/export themselves are gated per-module by
// the backend (Admin, Risk Manager, Risk Champion, CRO — see
// docs/API_REFERENCE.md "Import / Export / Search"). See
// Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';
import readXlsxFile from 'read-excel-file';
import SeedControlsWizard from '../components/SeedControlsWizard';

// ── Module & field definitions ────────────────────────────────────────────────

const IMPORT_MODULES = [
    { id: 'risk_register', label: 'Risk Register (Full)', description: 'Risks + controls + mitigation actions in one file' },
    { id: 'risks',         label: 'Risks only' },
    { id: 'controls',      label: 'Controls only' },
    { id: 'policies',      label: 'Policies' },
    { id: 'obligations',   label: 'Compliance Obligations' },
];

const EXPORT_MODULES = [
    { id: 'risks',       label: 'Risks' },
    { id: 'controls',    label: 'Controls' },
    { id: 'kris',        label: 'Key Risk Indicators' },
    { id: 'policies',    label: 'Policies' },
    { id: 'obligations', label: 'Compliance Obligations' },
    { id: 'issues',      label: 'Issues & Actions' },
];

// Per-module field definitions used for column mapping.
// aliases: normalised strings (lowercase, no spaces/special chars) that the
// client's column header might match.
const FIELD_DEFS = {
    risk_register: [
        // ── Risk fields ───────────────────────────────────────────────────────
        { key: 'department',               label: 'Department',                      required: true,  group: 'Risk',    aliases: ['dept','bu','division','unit','area','function','team','group'] },
        { key: 'business_unit',            label: 'Business Unit',                   required: false, group: 'Risk',    aliases: ['businessunit','bu','businessarea','operationalunit'] },
        { key: 'risk_detail',              label: 'Risk Statement',                  required: true,  group: 'Risk',    aliases: ['riskstatement','statement','riskname','riskdescription','description','risk','detail','name','riskevent','risksummary','riskdefinition','risknarrative','riskdesc','risktext'] },
        { key: 'risk_owner',               label: 'Risk Owner (email)',               required: false, group: 'Risk',    aliases: ['owner','riskowner','owneremail','assignee','responsible','riskowneremail'] },
        { key: 'risk_category',            label: 'Risk Category',                   required: false, group: 'Risk',    aliases: ['category','riskcategory','type','risktype','riskclass','riskclassification','riskclassificationlevel1','classification','level1'] },
        { key: 'sub_category',             label: 'Sub-category',                    required: false, group: 'Risk',    aliases: ['subcategory','subtype','risksubcategory','subclass','riskcategory2','riskcategorylevel2','riskcateogorylevel2','categoryorlevel2','level2','risksubtype'] },
        { key: 'treatment_strategy',       label: 'Treatment Strategy',              required: false, group: 'Risk',    aliases: ['treatment','strategy','treatmentstrategy','riskresponse','response','disposition','risktreatment','mitigationdecision','mitigationstrategy','riskmitigation'] },
        { key: 'inherent_likelihood',      label: 'Inherent Likelihood (1–5)',       required: true,  group: 'Risk',    aliases: ['inherentlikelihood','likelihood','grosslikelihood','rawlikelihood','il','gl','likelihoodscore','probability'] },
        { key: 'inherent_impact',          label: 'Inherent Impact (1–5)',           required: true,  group: 'Risk',    aliases: ['inherentimpact','grossimpact','rawimpact','ii','gi','impactscore','inherentconsequence'] },
        { key: 'residual_likelihood',      label: 'Residual Likelihood (1–5)',       required: true,  group: 'Risk',    aliases: ['residuallikelihood','netlikelihood','rl','nl','controlledlikelihood','residualprob'] },
        { key: 'residual_impact',          label: 'Residual Impact (1–5)',           required: true,  group: 'Risk',    aliases: ['residualimpact','netimpact','ri','ni','residualconsequence','controlledimpact'] },
        { key: 'tolerance_threshold',      label: 'Tolerance Threshold',             required: false, group: 'Risk',    aliases: ['tolerance','threshold','risktolerance','riskappetite','appetite'] },
        { key: 'treatment_plan_rationale', label: 'Treatment Plan / Rationale',      required: false, group: 'Risk',    aliases: ['treatmentplan','rationale','mitigationdetails','mitigationstrategy','plan','treatmentdescription','transferdetails'] },
        { key: 'review_frequency',         label: 'Review Frequency',                required: false, group: 'Risk',    aliases: ['reviewfrequency','frequency','reviewcycle','cycle','reviewperiod'] },
        { key: 'next_review_date',         label: 'Next Review Date',                required: false, group: 'Risk',    aliases: ['nextreviewdate','reviewdate','nextreview','reviewby','reviewdeadline'] },
        { key: 'framework_reference',      label: 'Framework Reference',             required: false, group: 'Risk',    aliases: ['framework','reference','standard','iso','regulation'] },
        { key: 'risk_velocity',            label: 'Risk Velocity',                   required: false, group: 'Risk',    aliases: ['velocity','riskvelocity','speed','timeframe','emergencespeed'] },
        // ── Control 1 ─────────────────────────────────────────────────────────
        { key: 'control_1_name',           label: 'Control 1 — Name',               required: false, group: 'Control 1', aliases: ['controlname','controldescription','controldescription1','control','existingcontrol','existingcontrols','controlmeasure','primarycontrol','ctrl','ctrl1','control1','firstcontrol'] },
        { key: 'control_1_type',           label: 'Control 1 — Type',               required: false, group: 'Control 1', aliases: ['controltype','ctrl1type','controltypology','control1type','typeofcontrol'] },
        { key: 'control_1_automation',     label: 'Control 1 — Automation',         required: false, group: 'Control 1', aliases: ['automation','controlauto','ctrl1auto','automated','manual','control1automation'] },
        { key: 'control_1_owner',          label: 'Control 1 — Owner (email)',       required: false, group: 'Control 1', aliases: ['controlowner','ctrl1owner','controlresponsible','control1owner'] },
        { key: 'control_1_frequency',      label: 'Control 1 — Testing Frequency',  required: false, group: 'Control 1', aliases: ['testingfrequency','monitoringfrequency','controltestfrequency','controlfrequency','ctrl1freq','control1frequency','reviewfrequency1','testcycle'] },
        { key: 'control_1_effectiveness',  label: 'Control 1 — Effectiveness',      required: false, group: 'Control 1', aliases: ['effectiveness','controleffectiveness','teststatus','testresult','controltestresult','controlstatus','ctrl1effectiveness','control1effectiveness','lastteststatus','controlrating'] },
        // ── Control 2 ─────────────────────────────────────────────────────────
        // aliases include suffixed forms e.g. "Control Description_2" → controldescription2
        { key: 'control_2_name',           label: 'Control 2 — Name',               required: false, group: 'Control 2', aliases: ['control2name','ctrl2','control2','secondcontrol','secondarycontrol','controldescription2','controlname2','controldesc2','controlo2','controldefinition2'] },
        { key: 'control_2_type',           label: 'Control 2 — Type',               required: false, group: 'Control 2', aliases: ['control2type','ctrl2type','controltype2','typeofcontrol2','controltypology2'] },
        { key: 'control_2_automation',     label: 'Control 2 — Automation',         required: false, group: 'Control 2', aliases: ['control2automation','controlautomation2','automation2','automated2','automationtype2'] },
        { key: 'control_2_owner',          label: 'Control 2 — Owner (email)',       required: false, group: 'Control 2', aliases: ['control2owner','ctrl2owner','controlowner2','controlresponsible2'] },
        { key: 'control_2_frequency',      label: 'Control 2 — Testing Frequency',  required: false, group: 'Control 2', aliases: ['control2frequency','ctrl2freq','monitoringfrequency2','testingfrequency2','frequency2','controlfrequency2'] },
        { key: 'control_2_effectiveness',  label: 'Control 2 — Effectiveness',      required: false, group: 'Control 2', aliases: ['control2effectiveness','ctrl2effectiveness','controleffectiveness2','effectiveness2','testresult2','controltestresult2','controlstatus2'] },
        // ── Control 3 ─────────────────────────────────────────────────────────
        { key: 'control_3_name',           label: 'Control 3 — Name',               required: false, group: 'Control 3', aliases: ['control3name','ctrl3','control3','thirdcontrol','additionalcontrol','controldescription3','controlname3','controldesc3'] },
        { key: 'control_3_type',           label: 'Control 3 — Type',               required: false, group: 'Control 3', aliases: ['control3type','ctrl3type','controltype3','typeofcontrol3','controltypology3'] },
        { key: 'control_3_automation',     label: 'Control 3 — Automation',         required: false, group: 'Control 3', aliases: ['control3automation','controlautomation3','automation3','automated3'] },
        { key: 'control_3_owner',          label: 'Control 3 — Owner (email)',       required: false, group: 'Control 3', aliases: ['control3owner','ctrl3owner','controlowner3','controlresponsible3'] },
        { key: 'control_3_frequency',      label: 'Control 3 — Testing Frequency',  required: false, group: 'Control 3', aliases: ['control3frequency','monitoringfrequency3','testingfrequency3','frequency3','controlfrequency3'] },
        { key: 'control_3_effectiveness',  label: 'Control 3 — Effectiveness',      required: false, group: 'Control 3', aliases: ['control3effectiveness','ctrl3effectiveness','controleffectiveness3','effectiveness3','testresult3','controlstatus3'] },
        // ── Control 4 ─────────────────────────────────────────────────────────
        { key: 'control_4_name',           label: 'Control 4 — Name',               required: false, group: 'Control 4', aliases: ['control4name','ctrl4','control4','fourthcontrol','controldescription4','controlname4','controldesc4'] },
        { key: 'control_4_type',           label: 'Control 4 — Type',               required: false, group: 'Control 4', aliases: ['control4type','controltype4','typeofcontrol4'] },
        { key: 'control_4_automation',     label: 'Control 4 — Automation',         required: false, group: 'Control 4', aliases: ['control4automation','controlautomation4','automation4','automated4'] },
        { key: 'control_4_owner',          label: 'Control 4 — Owner (email)',       required: false, group: 'Control 4', aliases: ['control4owner','ctrl4owner','controlowner4'] },
        { key: 'control_4_frequency',      label: 'Control 4 — Testing Frequency',  required: false, group: 'Control 4', aliases: ['control4frequency','monitoringfrequency4','testingfrequency4','frequency4'] },
        { key: 'control_4_effectiveness',  label: 'Control 4 — Effectiveness',      required: false, group: 'Control 4', aliases: ['control4effectiveness','ctrl4effectiveness','controleffectiveness4','effectiveness4','testresult4','controlstatus4'] },
        // ── Control 5 ─────────────────────────────────────────────────────────
        { key: 'control_5_name',           label: 'Control 5 — Name',               required: false, group: 'Control 5', aliases: ['control5name','ctrl5','control5','fifthcontrol','controldescription5','controlname5','controldesc5'] },
        { key: 'control_5_type',           label: 'Control 5 — Type',               required: false, group: 'Control 5', aliases: ['control5type','controltype5','typeofcontrol5'] },
        { key: 'control_5_automation',     label: 'Control 5 — Automation',         required: false, group: 'Control 5', aliases: ['control5automation','controlautomation5','automation5','automated5'] },
        { key: 'control_5_owner',          label: 'Control 5 — Owner (email)',       required: false, group: 'Control 5', aliases: ['control5owner','ctrl5owner','controlowner5'] },
        { key: 'control_5_frequency',      label: 'Control 5 — Testing Frequency',  required: false, group: 'Control 5', aliases: ['control5frequency','monitoringfrequency5','testingfrequency5','frequency5'] },
        { key: 'control_5_effectiveness',  label: 'Control 5 — Effectiveness',      required: false, group: 'Control 5', aliases: ['control5effectiveness','ctrl5effectiveness','controleffectiveness5','effectiveness5','testresult5','controlstatus5'] },
        // ── Mitigation Action 1 (MAP) ──────────────────────────────────────────
        { key: 'action_1_description',     label: 'Action 1 — Description',         required: false, group: 'Action 1', aliases: ['action','mitigationaction','treatmentaction','remediationaction','actionplan','treatment','map','mapaction','maporaction','mitigationplan','remediationplan','action1description','action1'] },
        { key: 'action_1_owner',           label: 'Action 1 — Owner (email)',        required: false, group: 'Action 1', aliases: ['actionowner','mapowner','assignee','action1owner','taskowner','actionresponsibility','actionplanresponsibility','responsibilityforaction','defineresponsibility'] },
        { key: 'action_1_due_date',        label: 'Action 1 — Due Date',            required: false, group: 'Action 1', aliases: ['actionduedate','targetdate','duedate','completiondate','mapdue','action1duedate','deadline'] },
        { key: 'action_1_status',          label: 'Action 1 — Status',              required: false, group: 'Action 1', aliases: ['actionstatus','mapstatus','mitigationstatus','action1status','taskstatus'] },
        // ── Mitigation Action 2 ────────────────────────────────────────────────
        { key: 'action_2_description',     label: 'Action 2 — Description',         required: false, group: 'Action 2', aliases: ['action2description','action2','secondaction','secondmitigation'] },
        { key: 'action_2_owner',           label: 'Action 2 — Owner (email)',        required: false, group: 'Action 2', aliases: ['action2owner'] },
        { key: 'action_2_due_date',        label: 'Action 2 — Due Date',            required: false, group: 'Action 2', aliases: ['action2duedate','action2due'] },
        { key: 'action_2_status',          label: 'Action 2 — Status',              required: false, group: 'Action 2', aliases: ['action2status'] },
        // ── Mitigation Action 3 ────────────────────────────────────────────────
        { key: 'action_3_description',     label: 'Action 3 — Description',         required: false, group: 'Action 3', aliases: ['action3description','action3','thirdaction','thirdmitigation'] },
        { key: 'action_3_owner',           label: 'Action 3 — Owner (email)',        required: false, group: 'Action 3', aliases: ['action3owner'] },
        { key: 'action_3_due_date',        label: 'Action 3 — Due Date',            required: false, group: 'Action 3', aliases: ['action3duedate','action3due'] },
        { key: 'action_3_status',          label: 'Action 3 — Status',              required: false, group: 'Action 3', aliases: ['action3status'] },
    ],
    risks: [
        { key: 'department',              label: 'Department',                   required: true,  aliases: ['dept','bu','division','unit','area','function','team','group'] },
        { key: 'business_unit',           label: 'Business Unit',                required: false, aliases: ['businessunit','bu','businessarea','operationalunit'] },
        { key: 'risk_detail',             label: 'Risk Statement',               required: true,  aliases: ['riskstatement','statement','riskname','riskdescription','description','risk','detail','name','riskevent','riskdefinition','risksummary','risknarrative','riskdesc','risktext'] },
        { key: 'risk_owner',              label: 'Risk Owner (email)',            required: false, aliases: ['owner','riskowner','owneremail','assignee','responsible','riskowneremail'] },
        { key: 'risk_category',           label: 'Risk Category',                required: false, aliases: ['category','riskcategory','type','risktype','riskclass','classification'] },
        { key: 'sub_category',            label: 'Sub-category',                 required: false, aliases: ['subcategory','subtype','risksubcategory','subcategory2','subclass'] },
        { key: 'treatment_strategy',      label: 'Treatment Strategy',           required: false, aliases: ['treatment','strategy','treatmentstrategy','riskresponse','response','disposition','risktreatment'] },
        { key: 'inherent_likelihood',     label: 'Inherent Likelihood (1–5)',    required: true,  aliases: ['inherentlikelihood','likelihood','grosslikelihood','rawlikelihood','il','gl','likelihoodrating','probabilityrating','probability','likelihoodscore'] },
        { key: 'inherent_impact',         label: 'Inherent Impact (1–5)',        required: true,  aliases: ['inherentimpact','grossimpact','rawimpact','ii','gi','consequencerating','impactscore','impactrating','inherentconsequence'] },
        { key: 'residual_likelihood',     label: 'Residual Likelihood (1–5)',    required: true,  aliases: ['residuallikelihood','netlikelihood','rl','nl','residualprob','controlledlikelihood'] },
        { key: 'residual_impact',         label: 'Residual Impact (1–5)',        required: true,  aliases: ['residualimpact','netimpact','ri','ni','residualconsequence','controlledimpact'] },
        { key: 'tolerance_threshold',     label: 'Tolerance Threshold',          required: false, aliases: ['tolerance','threshold','risktolerance','riskappetite','appetite'] },
        { key: 'treatment_plan_rationale',label: 'Treatment Plan / Rationale',   required: false, aliases: ['treatmentplan','rationale','mitigationplan','actionplan','plan','mitigationstrategy','treatmentdescription','controls'] },
        { key: 'review_frequency',        label: 'Review Frequency',             required: false, aliases: ['reviewfrequency','frequency','reviewcycle','cycle','reviewperiod'] },
        { key: 'next_review_date',        label: 'Next Review Date',             required: false, aliases: ['nextreviewdate','reviewdate','nextreview','duedate','reviewby','reviewdeadline'] },
        { key: 'framework_reference',     label: 'Framework Reference',          required: false, aliases: ['framework','reference','frameworkreference','standard','standardreference','iso','regulation'] },
        { key: 'risk_velocity',           label: 'Risk Velocity',                required: false, aliases: ['velocity','riskvelocity','speed','timeframe','timeline','emergencespeed'] },
    ],
    controls: [
        { key: 'name',               label: 'Control Name',          required: true,  aliases: ['controlname','title','control','controlid','controlidentifier'] },
        { key: 'description',        label: 'Description',           required: false, aliases: ['controldescription','detail','narrative','fullname','longname','overview'] },
        { key: 'control_type',       label: 'Control Type',          required: false, aliases: ['type','controltype','category','controlcategory','nature'] },
        { key: 'automation',         label: 'Automation',            required: false, aliases: ['automationtype','automated','manual','automationlevel'] },
        { key: 'owner',              label: 'Owner (email)',          required: false, aliases: ['owneremail','controlowner','responsible','accountable'] },
        { key: 'testing_frequency',  label: 'Testing Frequency',     required: false, aliases: ['testingfrequency','testfrequency','frequency','testcycle','reviewfrequency'] },
        { key: 'evidence_required',  label: 'Evidence Required',     required: false, aliases: ['evidence','documentation','artifact','evidencerequired','artefact'] },
        { key: 'framework_reference',label: 'Framework Reference',   required: false, aliases: ['framework','reference','standard','iso'] },
        { key: 'department',         label: 'Department',            required: false, aliases: ['dept','businessunit','bu','division','unit','area'] },
    ],
    policies: [
        { key: 'name',             label: 'Policy Name',          required: true,  aliases: ['policyname','title','policy','document','policytitle'] },
        { key: 'category',         label: 'Category',             required: false, aliases: ['policycategory','type','policytype','classification'] },
        { key: 'description',      label: 'Description',          required: false, aliases: ['summary','overview','abstract','purpose','policydescription'] },
        { key: 'content_owner',    label: 'Content Owner (email)',required: false, aliases: ['contentowner','author','drafter','policyowner','owneremail'] },
        { key: 'approver',         label: 'Approver (email)',     required: false, aliases: ['reviewer','approveremail','policyapprover'] },
        { key: 'effective_date',   label: 'Effective Date',       required: false, aliases: ['startdate','issuedate','publishdate','date','effectivedate','publisheddate'] },
        { key: 'review_frequency', label: 'Review Frequency',     required: false, aliases: ['frequency','cycle','reviewcycle','reviewperiod'] },
        { key: 'next_review_date', label: 'Next Review Date',     required: false, aliases: ['nextreviewdate','reviewdate','nextreview','duedate'] },
    ],
    obligations: [
        { key: 'regulatory_body',        label: 'Regulatory Body',          required: false, aliases: ['regulator','authority','body','issuer','source','regulatorybody'] },
        { key: 'regulation_name',        label: 'Regulation / Law Name',    required: false, aliases: ['regulation','law','act','requirement','name','title','regulationname'] },
        { key: 'reference',              label: 'Reference / Article',      required: false, aliases: ['ref','articleref','sectionref','clause','section','article'] },
        { key: 'description',            label: 'Obligation Description',   required: true,  aliases: ['obligation','detail','requirement','summary','text','obligationdescription'] },
        { key: 'applicable_to',          label: 'Applicable To',            required: false, aliases: ['applicableto','scope','function','unit','applicabledepartment'] },
        { key: 'obligation_owner',       label: 'Obligation Owner (email)', required: false, aliases: ['owner','responsible','owneremail','obligationowner'] },
        { key: 'evidence_of_compliance', label: 'Evidence of Compliance',   required: false, aliases: ['evidence','complianceevidence','documentation','artifact'] },
        { key: 'reporting_requirement',  label: 'Reporting Requirement',    required: false, aliases: ['reporting','report','disclosure','reportingrequirement'] },
        { key: 'next_reporting_date',    label: 'Next Reporting Date',      required: false, aliases: ['reportingdate','duedate','reportby','nextreportingdate'] },
        { key: 'next_review_date',       label: 'Next Review Date',         required: false, aliases: ['nextreviewdate','reviewdate','nextreview'] },
        { key: 'compliance_status',      label: 'Compliance Status',        required: false, aliases: ['status','state','compliancelevel','compliancestatus'] },
    ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalise(str) {
    // Strip everything except letters and digits — handles commas, newlines,
    // em-dashes, parentheses, slashes, dots, and any other punctuation.
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Score how well a client column header matches a field definition (higher = better). */
function matchScore(norm, def) {
    if (normalise(def.key) === norm)   return 5; // exact key
    if (normalise(def.label) === norm) return 5; // exact label
    if ((def.aliases || []).some(a => a === norm)) return 4; // exact alias
    // Long-alias prefix: "actionplan..." starts with alias "actionplan" (≥8 chars)
    const longAliases = (def.aliases || []).filter(a => a.length >= 8);
    if (longAliases.some(a => norm.startsWith(a))) return 3;
    // Token match: ALL key tokens (ignoring numeric) appear in the header
    const tokens = def.key.split('_').filter(t => !/^\d+$/.test(t));
    if (tokens.length >= 2 && tokens.every(t => norm.includes(t))) return 2;
    // Very specific alias contained (≥12 chars): "defineresponsibility" inside a long column name
    const veryLongAliases = longAliases.filter(a => a.length >= 12);
    if (veryLongAliases.some(a => norm.includes(a))) return 2;
    // Medium alias contained (≥8 chars) — lower priority than token match
    if (longAliases.some(a => norm.includes(a))) return 1;
    // Substring / contains match on the bare key
    const keyNorm = normalise(def.key);
    if (norm.includes(keyNorm) || keyNorm.includes(norm)) return 1;
    return 0;
}

/** Given a client column header, suggest the best matching our-field key. */
function autoSuggest(clientHeader, moduleId) {
    const norm = normalise(clientHeader);
    const defs = FIELD_DEFS[moduleId] || [];
    let best = '', bestScore = 0;
    for (const def of defs) {
        const s = matchScore(norm, def);
        if (s > bestScore) { bestScore = s; best = def.key; }
    }
    return best;
}

/**
 * Build initial columnMap iterating over FIELDS first (not headers), so that
 * a more-exact header match always wins over an alias match for the same field.
 * E.g. "Department" (exact) beats "Business Unit" (alias) for the department field.
 */
function buildInitialMap(headers, moduleId) {
    const map = {};
    const usedHeaders = new Set();
    const defs = FIELD_DEFS[moduleId] || [];
    for (const def of defs) {
        let bestHeader = '', bestScore = 0;
        for (const h of headers) {
            if (usedHeaders.has(h)) continue;
            const s = matchScore(normalise(h), def);
            if (s > bestScore) { bestScore = s; bestHeader = h; }
        }
        if (bestHeader && bestScore > 0) {
            map[def.key] = bestHeader;
            usedHeaders.add(bestHeader);
        }
    }
    return map;
}

/** Convert parsed rows + columnMap into a remapped CSV using our field names. */
function remapToCSV(parsedRows, columnMap, moduleId) {
    const defs = FIELD_DEFS[moduleId] || [];
    const mappedFields = defs.map(d => d.key).filter(k => columnMap[k]);
    const header = mappedFields.join(',');
    const lines = parsedRows.map(row => {
        return mappedFields.map(field => {
            const clientCol = columnMap[field];
            const v = clientCol ? (row[clientCol] ?? '') : '';
            const s = String(v);
            return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',');
    });
    return [header, ...lines].join('\n') + '\n';
}

/** Simple client-side CSV parser (header row → array of objects). */
function parseCSVClient(text) {
    // Full RFC 4180 parser — handles quoted fields that contain commas,
    // double-quotes, and embedded newlines (e.g. multi-line cell values).
    const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const allRows = [];
    let row = [], field = '', inQ = false, i = 0;
    while (i < input.length) {
        const c = input[i];
        if (inQ) {
            if (c === '"' && input[i + 1] === '"') { field += '"'; i += 2; } // escaped quote
            else if (c === '"') { inQ = false; i++; }                         // close quote
            else { field += c; i++; }                                          // char inside quotes (incl. \n)
        } else {
            if (c === '"')  { inQ = true; i++; }
            else if (c === ',') { row.push(field); field = ''; i++; }
            else if (c === '\n') {
                row.push(field); field = '';
                allRows.push(row); row = []; i++;
            } else { field += c; i++; }
        }
    }
    // Flush last field / row
    row.push(field);
    if (row.some(f => f !== '')) allRows.push(row);

    if (allRows.length < 1) return { headers: [], rows: [] };
    const headers = allRows[0].map(h => h.trim());
    const rows = allRows.slice(1)
        .filter(vals => vals.some(v => String(v).trim() !== ''))
        .map(vals => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
            return obj;
        });
    return { headers, rows };
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Return list of sheet names from an XLSX file. */
async function getXlsxSheets(file) {
    const sheets = await readXlsxFile(file, { getSheets: true });
    return (sheets || []).map(s => s.name);
}

/**
 * Read one sheet from an XLSX file with three smart behaviours:
 *
 * 1. Auto-detect header row — scans the first 20 rows and picks the one
 *    with the most non-empty cells, so title/metadata rows are ignored.
 *
 * 2. Merge continuation rows — rows where the first 3 cells are all empty
 *    are "sub-rows" belonging to the previous risk (common in risk registers
 *    where each additional control gets its own row). Their columns are
 *    appended to the previous row as "_2", "_3" … "_5" suffixes, so the
 *    column mapper can map "Control Type_2" → control_2_type, etc.
 *
 * 3. Cap at 5 continuations per risk (matching our import limit).
 *
 * Returns { csv, mergeCount } where mergeCount is the total number of
 * continuation rows that were successfully merged.
 */
async function xlsxSheetToCsv(file, sheetName) {
    const rows = await readXlsxFile(file, { sheet: sheetName });
    if (!rows || rows.length === 0) throw new Error('The selected sheet appears to be empty.');

    // 1. Auto-detect header row.
    let headerIdx = 0;
    let maxCells  = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const n = rows[i].filter(c => c != null && String(c).trim() !== '').length;
        if (n > maxCells) { maxCells = n; headerIdx = i; }
    }
    const headers = rows[headerIdx].map(c => (c == null ? '' : String(c).trim()));

    // 2. Build merged row objects.
    const dataRows   = rows.slice(headerIdx + 1);
    const merged     = [];   // array of { colName: value }
    let mergeCount   = 0;

    for (const row of dataRows) {
        const hasData = row.some(c => c != null && String(c).trim() !== '');
        if (!hasData) continue; // blank spacer

        const firstThreeEmpty = row.slice(0, 3).every(c => c == null || String(c).trim() === '');

        if (firstThreeEmpty && merged.length > 0) {
            // Continuation row — find next available suffix (_2 … _5).
            const prev = merged[merged.length - 1];
            let suffix = 2;
            while (suffix <= 5 && Object.keys(prev).some(k => k.endsWith(`_${suffix}`))) suffix++;
            if (suffix <= 5) {
                for (let j = 0; j < headers.length; j++) {
                    const v = row[j];
                    if (v != null && String(v).trim() !== '' && headers[j]) {
                        prev[`${headers[j]}_${suffix}`] = v;
                    }
                }
                mergeCount++;
            }
        } else if (!firstThreeEmpty) {
            // Main risk row.
            const obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = row[j] ?? '';
            }
            merged.push(obj);
        }
    }

    // 3. Collect the full column set (original headers + any _2/_3/… additions).
    const allHeaders = [...headers];
    for (const obj of merged) {
        for (const key of Object.keys(obj)) {
            if (!allHeaders.includes(key)) allHeaders.push(key);
        }
    }

    // 4. Serialise to CSV.
    const escape = (v) => {
        const s = v == null ? '' : String(v);
        return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
        allHeaders.map(escape).join(','),
        ...merged.map(obj => allHeaders.map(h => escape(obj[h] ?? '')).join(',')),
    ];

    return { csv: lines.join('\n') + '\n', mergeCount };
}

// ── Step components ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Upload', 'Map Columns', 'Preview', 'Done'];

function StepBar({ step }) {
    const steps = ['upload', 'map', 'preview', 'done'];
    const idx = steps.indexOf(step);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
            {STEP_LABELS.map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        color: i <= idx ? '#1F3964' : '#aaa',
                        fontWeight: i === idx ? 700 : 400, fontSize: 13,
                    }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                            background: i < idx ? '#1F3964' : i === idx ? '#2a5298' : '#e8eaf0',
                            color: i <= idx ? '#fff' : '#aaa',
                        }}>
                            {i < idx ? '✓' : i + 1}
                        </span>
                        {label}
                    </div>
                    {i < STEP_LABELS.length - 1 && (
                        <div style={{ width: 32, height: 2, background: i < idx ? '#1F3964' : '#e0e4ee', margin: '0 8px' }} />
                    )}
                </div>
            ))}
        </div>
    );
}

function StepUpload({ importModule, setImportModule, onParsed, t }) {
    const [fileName, setFileName]             = useState('');
    const [csvText, setCsvText]               = useState('');
    const [err, setErr]                       = useState('');
    const [loading, setLoading]               = useState(false);
    // Excel-specific
    const [xlsxFile, setXlsxFile]             = useState(null);   // keep File ref for re-reading
    const [sheets, setSheets]                 = useState([]);      // sheet names
    const [selectedSheet, setSelectedSheet]   = useState('');
    const [mergeCount, setMergeCount]             = useState(0);

    function resetState() {
        setCsvText(''); setFileName(''); setSheets([]); setSelectedSheet('');
        setXlsxFile(null); setMergeCount(0); setErr('');
    }

    async function processXlsxSheet(file, sheet) {
        setLoading(true);
        setErr('');
        try {
            const { csv, mergeCount: mc } = await xlsxSheetToCsv(file, sheet);
            setCsvText(csv);
            setMergeCount(mc);
        } catch (ex) {
            setErr(ex.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleFile(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        resetState();
        setFileName(file.name);
        setLoading(true);
        try {
            if (/\.(xlsx|xls)$/i.test(file.name)) {
                const sheetNames = await getXlsxSheets(file);
                setXlsxFile(file);
                if (sheetNames.length === 1) {
                    // Single sheet — read straight away
                    setLoading(false);
                    await processXlsxSheet(file, sheetNames[0]);
                } else {
                    // Multiple sheets — show picker
                    setSheets(sheetNames);
                    setSelectedSheet(sheetNames[0]);
                    setLoading(false);
                }
            } else {
                // CSV / plain text
                const csv = await new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result);
                    r.onerror = () => rej(new Error('Failed to read file'));
                    r.readAsText(file);
                });
                setCsvText(csv);
                setLoading(false);
            }
        } catch (ex) {
            setErr(ex.message);
            setLoading(false);
        }
    }

    function handleNext() {
        const text = csvText.trim();
        if (!text) { setErr('Upload a file or paste CSV content first.'); return; }
        const { headers, rows } = parseCSVClient(text);
        if (headers.length === 0) { setErr('Could not detect column headers.'); return; }
        if (rows.length === 0) { setErr('No data rows found.'); return; }
        onParsed(headers, rows);
    }

    const parsed = csvText ? parseCSVClient(csvText) : null;

    return (
        <div>
            {/* Module selector */}
            <div className="form-group">
                <label className="form-label">{t('data_tools_module')}</label>
                <select
                    className="form-control" style={{ maxWidth: 360 }}
                    value={importModule}
                    onChange={e => { setImportModule(e.target.value); resetState(); }}
                >
                    {IMPORT_MODULES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                {IMPORT_MODULES.find(m => m.id === importModule)?.description && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 5 }}>
                        {IMPORT_MODULES.find(m => m.id === importModule).description}
                    </div>
                )}
            </div>

            {/* File input */}
            <div className="form-group">
                <label className="form-label">{t('data_tools_fill')}</label>
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleFile} />
                {loading && <div className="text-muted" style={{ marginTop: 4 }}>Reading file…</div>}
                {fileName && !loading && parsed && (
                    <div className="text-muted" style={{ marginTop: 4 }}>
                        <strong>{fileName}</strong> — {parsed.rows.length} data rows, {parsed.headers.length} columns detected
                    </div>
                )}
            </div>

            {/* Sheet selector — shown when a multi-sheet XLSX is uploaded */}
            {sheets.length > 0 && !csvText && (
                <div style={{ background: '#f0f4ff', border: '1px solid #c5d0ef', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#1F3964' }}>
                        This workbook has {sheets.length} sheets. Which one contains your data?
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                            className="form-control" style={{ maxWidth: 280, fontSize: 13 }}
                            value={selectedSheet}
                            onChange={e => setSelectedSheet(e.target.value)}
                        >
                            {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button
                            className="btn btn-primary" style={{ fontSize: 13 }}
                            disabled={loading || !selectedSheet}
                            onClick={() => processXlsxSheet(xlsxFile, selectedSheet)}
                        >
                            {loading ? 'Reading…' : 'Use this sheet →'}
                        </button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
                        All sheets: {sheets.join(' · ')}
                    </div>
                </div>
            )}

            {/* Continuation row merge notice */}
            {mergeCount > 0 && (
                <div style={{ background: '#e6f4ea', border: '1px solid #b7dfc4', borderRadius: 7, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#1a7a3c' }}>
                    ✓ <strong>{mergeCount} continuation row{mergeCount > 1 ? 's' : ''} merged automatically.</strong>{' '}
                    Extra control rows (rows where the first columns are blank) have been folded into their parent risk
                    as Control 2, Control 3, etc. You will see these as extra columns in the mapper on the next step.
                </div>
            )}

            {/* CSV paste area — shown after file is read, or as primary entry for CSV */}
            <div className="form-group">
                <label className="form-label">
                    {t('data_tools_paste')}
                    {!csvText && <span className="text-muted"> (or paste CSV directly)</span>}
                </label>
                <textarea
                    className="form-control" rows={csvText ? 4 : 5}
                    placeholder="Paste CSV content here, or upload a file above…"
                    value={csvText}
                    onChange={e => { setCsvText(e.target.value); setMergeCount(0); }}
                />
            </div>

            {err && <div className="alert alert-error">{err}</div>}
            <button className="btn btn-primary" onClick={handleNext} disabled={!csvText.trim()}>
                Next: Map Columns →
            </button>
        </div>
    );
}

function StepMap({ importModule, parsedHeaders, parsedRows, onConfirm, onBack }) {
    const defs = FIELD_DEFS[importModule] || [];
    const [columnMap, setColumnMap] = useState(() => buildInitialMap(parsedHeaders, importModule));

    const setMapping = (ourField, clientCol) => {
        setColumnMap(prev => ({ ...prev, [ourField]: clientCol }));
    };

    const requiredUnmapped = defs.filter(d => d.required && !columnMap[d.key]);
    const mappedCount = defs.filter(d => columnMap[d.key]).length;
    const sample = parsedRows[0] || {};

    // Detect overflow: headers in client file that look like extra controls/actions
    // beyond our supported limits (control_6+, action_4+).
    const overflowWarning = (() => {
        if (importModule !== 'risk_register') return null;
        const norm = (s) => s.toLowerCase().replace(/[\s_\-\/\(\)\.]+/g, '');
        const unmapped = parsedHeaders.filter(h => !Object.values(columnMap).includes(h));
        const extraCtrl = unmapped.filter(h => /control.*[6-9]|control.*1[0-9]/i.test(h) || (() => {
            const n = norm(h);
            return (n.startsWith('control') || n.startsWith('ctrl')) && /[6-9]/.test(n);
        })());
        const extraAct = unmapped.filter(h => /action.*[4-9]|mitigation.*[4-9]/i.test(h));
        const parts = [];
        if (extraCtrl.length) parts.push(`${extraCtrl.length} control column${extraCtrl.length > 1 ? 's' : ''} beyond the 5-control limit (${extraCtrl.join(', ')})`);
        if (extraAct.length) parts.push(`${extraAct.length} action column${extraAct.length > 1 ? 's' : ''} beyond the 3-action limit (${extraAct.join(', ')})`);
        return parts.length ? parts : null;
    })();

    // Group defs by group label (for risk_register which has sections)
    const hasGroups = defs.some(d => d.group);
    const groups = hasGroups
        ? [...new Set(defs.map(d => d.group || 'Other'))]
        : [null];

    return (
        <div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 12 }}>
                We found <strong>{parsedHeaders.length} columns</strong> in your file and <strong>{parsedRows.length} data rows</strong>.
                Match each of your columns to our fields below. Auto-suggestions are shown — override any that are wrong.
                Fields marked <span style={{ color: '#c0392b' }}>*</span> are required.
            </p>

            {/* Capacity notice — always shown for risk_register */}
            {importModule === 'risk_register' && (
                <div style={{ background: '#f0f4ff', border: '1px solid #c5d0ef', borderRadius: 7, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#1F3964' }}>
                    <strong>Import limits for Risk Register (Full):</strong> maximum <strong>5 controls</strong> and <strong>3 mitigation actions</strong> per row.
                    Any controls beyond 5 or actions beyond 3 in your file will not be imported — add them manually after import if needed.
                </div>
            )}

            {/* Overflow alert — only when we detect columns beyond the limits */}
            {overflowWarning && (
                <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 7, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#7d5800' }}>
                    ⚠️ <strong>Column limit exceeded.</strong> Your file contains {overflowWarning.join(' and ')}.
                    These columns <strong>cannot be imported</strong> in this session.
                    Please add the extra controls/actions manually after the import completes, or split the file into two imports.
                </div>
            )}

            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #dde3f0', marginBottom: 16, maxHeight: 520, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: '#1F3964', position: 'sticky', top: 0, zIndex: 1 }}>
                            <th style={{ padding: '10px 14px', color: '#fff', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Our Field</th>
                            <th style={{ padding: '10px 14px', color: '#fff', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Your Column</th>
                            <th style={{ padding: '10px 14px', color: '#fff', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Sample Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(group => {
                            const groupDefs = hasGroups ? defs.filter(d => (d.group || 'Other') === group) : defs;
                            const GROUP_COLORS = { Risk: '#e8f0fe', 'Control 1': '#e8f9f0', 'Control 2': '#e8f9f0', 'Control 3': '#e8f9f0', Action: '#fff3e0' };
                            return (
                                <>
                                    {group && (
                                        <tr key={`group-${group}`}>
                                            <td colSpan={3} style={{ padding: '8px 14px', background: GROUP_COLORS[group] || '#f5f5f5', fontWeight: 700, fontSize: 11, color: '#1F3964', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid #dde3f0' }}>
                                                {group === 'Control 1' || group === 'Control 2' || group === 'Control 3' ? `${group} (optional)` : group === 'Action' ? 'Mitigation Action (optional)' : group}
                                            </td>
                                        </tr>
                                    )}
                                    {groupDefs.map((def, i) => {
                                        const mapped = columnMap[def.key] || '';
                                        const sampleVal = mapped ? (sample[mapped] ?? '') : '';
                                        const isSuggested = mapped && autoSuggest(mapped, importModule) === def.key;
                                        return (
                                            <tr key={def.key} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafc' }}>
                                                <td style={{ padding: '8px 14px', borderBottom: '1px solid #eef0f5' }}>
                                                    {def.required && <span style={{ color: '#c0392b', marginRight: 3 }}>*</span>}
                                                    <strong>{def.label}</strong>
                                                </td>
                                                <td style={{ padding: '8px 14px', borderBottom: '1px solid #eef0f5' }}>
                                                    <select
                                                        className="form-control"
                                                        style={{
                                                            fontSize: 12, padding: '4px 8px',
                                                            borderColor: def.required && !mapped ? '#e74c3c' : undefined,
                                                            background: isSuggested ? '#f0fff4' : undefined,
                                                        }}
                                                        value={mapped}
                                                        onChange={e => setMapping(def.key, e.target.value)}
                                                    >
                                                        <option value="">— Skip this field —</option>
                                                        {parsedHeaders.map(h => (
                                                            <option key={h} value={h}>{h}</option>
                                                        ))}
                                                    </select>
                                                    {isSuggested && (
                                                        <div style={{ fontSize: 10, color: '#27ae60', marginTop: 2 }}>✓ auto-matched</div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '8px 14px', borderBottom: '1px solid #eef0f5', color: 'var(--color-text-muted)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {sampleVal || <span style={{ opacity: 0.4 }}>—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {requiredUnmapped.length > 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    Required fields not yet mapped: <strong>{requiredUnmapped.map(d => d.label).join(', ')}</strong>
                </div>
            )}

            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                {mappedCount} of {defs.length} fields mapped.
                Unmapped optional fields will be left blank or use system defaults.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" onClick={onBack}>← Back</button>
                <button
                    className="btn btn-primary"
                    disabled={requiredUnmapped.length > 0}
                    onClick={() => onConfirm(columnMap)}
                >
                    Run Preview →
                </button>
            </div>
        </div>
    );
}

function StepPreview({ importModule, parsedRows, columnMap, previewResult, previewing, onConfirm, onBack, importing }) {
    const defs = FIELD_DEFS[importModule] || [];
    const mappedDefs = defs.filter(d => columnMap[d.key]);

    // Merge parsed rows with backend per-row results
    const rowResults = previewResult?.results || [];
    const resultByRow = {};
    rowResults.forEach(r => { resultByRow[r.row] = r; });

    const readyCount = previewResult?.created ?? 0;
    const errorCount = previewResult?.errors ?? 0;

    if (previewing) {
        return (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Validating {parsedRows.length} rows against the system…
            </div>
        );
    }

    return (
        <div>
            {/* Summary banner */}
            <div style={{
                display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
            }}>
                <div style={{ padding: '12px 20px', borderRadius: 8, background: '#e6f4ea', border: '1px solid #b7dfc4', flex: 1 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1a7a3c' }}>{readyCount}</div>
                    <div style={{ fontSize: 12, color: '#1a7a3c' }}>rows ready to import</div>
                </div>
                {errorCount > 0 && (
                    <div style={{ padding: '12px 20px', borderRadius: 8, background: '#fdecea', border: '1px solid #f5c6c2', flex: 1 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#c0392b' }}>{errorCount}</div>
                        <div style={{ fontSize: 12, color: '#c0392b' }}>rows have errors (will be skipped)</div>
                    </div>
                )}
                <div style={{ padding: '12px 20px', borderRadius: 8, background: '#f0f4ff', border: '1px solid #d0d9ef', flex: 1 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1F3964' }}>{parsedRows.length}</div>
                    <div style={{ fontSize: 12, color: '#1F3964' }}>total rows in file</div>
                </div>
            </div>

            {errorCount > 0 && (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                    Rows with errors will be <strong>skipped</strong> — only the {readyCount} valid rows will be imported.
                    Fix the errors in your file and re-import to bring those rows in.
                </div>
            )}

            {readyCount === 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    No rows passed validation. Please fix the errors and go back to re-upload.
                </div>
            )}

            {/* Preview table */}
            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #dde3f0', marginBottom: 16, maxHeight: 420, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        <tr style={{ background: '#1F3964', position: 'sticky', top: 0 }}>
                            <th style={{ padding: '8px 10px', color: '#fff', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', width: 50 }}>#</th>
                            <th style={{ padding: '8px 10px', color: '#fff', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', width: 80 }}>Status</th>
                            {mappedDefs.map(d => (
                                <th key={d.key} style={{ padding: '8px 10px', color: '#fff', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {d.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedRows.map((row, i) => {
                            const backendRow = resultByRow[i + 2];
                            const isError = backendRow?.status === 'error';
                            const rowBg = isError ? '#fff8f8' : i % 2 === 0 ? '#fff' : '#f9fafc';
                            return (
                                <tr key={i} style={{ background: rowBg }}>
                                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #eef0f5', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                        {i + 2}
                                    </td>
                                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #eef0f5', textAlign: 'center' }}>
                                        {isError ? (
                                            <span title={backendRow.error} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#c0392b', fontSize: 11, cursor: 'help' }}>
                                                ✗ Error
                                            </span>
                                        ) : (
                                            <span style={{ color: '#27ae60', fontSize: 11 }}>✓ Ready</span>
                                        )}
                                        {isError && (
                                            <div style={{ fontSize: 10, color: '#c0392b', maxWidth: 140, wordBreak: 'break-word' }}>{backendRow.error}</div>
                                        )}
                                    </td>
                                    {mappedDefs.map(d => (
                                        <td key={d.key} style={{
                                            padding: '7px 10px',
                                            borderBottom: '1px solid #eef0f5',
                                            color: 'var(--color-text)',
                                            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {row[columnMap[d.key]] || <span style={{ opacity: 0.3 }}>—</span>}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn btn-secondary" onClick={onBack} disabled={importing}>← Back</button>
                <button
                    className="btn btn-primary"
                    disabled={readyCount === 0 || importing}
                    onClick={onConfirm}
                >
                    {importing ? 'Importing…' : `Confirm & Import ${readyCount} row${readyCount !== 1 ? 's' : ''}`}
                </button>
                {readyCount > 0 && errorCount > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {errorCount} row{errorCount !== 1 ? 's' : ''} with errors will be skipped.
                    </span>
                )}
            </div>
        </div>
    );
}

function StepDone({ importResult, onReset }) {
    const created = importResult?.created ?? 0;
    const errors = importResult?.errors ?? 0;
    const total = importResult?.total_rows ?? 0;
    return (
        <div>
            <div className={`alert ${errors > 0 && created === 0 ? 'alert-error' : errors > 0 ? 'alert-info' : 'alert-success'}`} style={{ marginBottom: 16 }}>
                {created} of {total} row{total !== 1 ? 's' : ''} imported successfully
                {errors > 0 ? `, ${errors} row${errors !== 1 ? 's' : ''} skipped due to errors` : ''}.
            </div>
            {errors > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <strong style={{ fontSize: 13 }}>Skipped rows:</strong>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                        <thead>
                            <tr style={{ background: '#f0f4ff' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #dde3f0' }}>Row</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #dde3f0' }}>Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(importResult?.results || []).filter(r => r.status === 'error').map(r => (
                                <tr key={r.row}>
                                    <td style={{ padding: '7px 12px', borderBottom: '1px solid #eef0f5' }}>{r.row}</td>
                                    <td style={{ padding: '7px 12px', borderBottom: '1px solid #eef0f5', color: '#c0392b' }}>{r.error}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <button className="btn btn-secondary" onClick={onReset}>Import another file</button>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DataTools() {
    const { api, session } = useAuth();
    const t = useT();
    const role = session?.companies?.find(c => c.id === session.activeCompanyId)?.role;

    // Import wizard state
    const [step, setStep] = useState('upload');
    const [importModule, setImportModule] = useState('risks');
    const [parsedHeaders, setParsedHeaders] = useState([]);
    const [parsedRows, setParsedRows] = useState([]);
    const [columnMap, setColumnMap] = useState({});
    const [previewResult, setPreviewResult] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const [importError, setImportError] = useState('');

    // Export state
    const [exporting, setExporting] = useState(null);
    const [exportError, setExportError] = useState('');

    const [showSeedWizard, setShowSeedWizard] = useState(false);

    // ── Import wizard handlers ───────────────────────────────────────────────

    function handleParsed(headers, rows) {
        setParsedHeaders(headers);
        setParsedRows(rows);
        setStep('map');
    }

    async function handleMapConfirm(map) {
        setColumnMap(map);
        setPreviewing(true);
        setImportError('');
        setStep('preview');
        try {
            const csv = remapToCSV(parsedRows, map, importModule);
            const result = await api.post(`/import/${importModule}`, { csv, dry_run: true });
            setPreviewResult(result);
        } catch (e) {
            setImportError(e.message || 'Preview failed');
            setStep('map');
        } finally {
            setPreviewing(false);
        }
    }

    async function handleConfirmImport() {
        setImporting(true);
        setImportError('');
        try {
            const csv = remapToCSV(parsedRows, columnMap, importModule);
            const result = await api.post(`/import/${importModule}`, { csv });
            setImportResult(result);
            setStep('done');
        } catch (e) {
            setImportError(e.message || 'Import failed');
        } finally {
            setImporting(false);
        }
    }

    function handleReset() {
        setStep('upload');
        setParsedHeaders([]);
        setParsedRows([]);
        setColumnMap({});
        setPreviewResult(null);
        setImportResult(null);
        setImportError('');
    }

    // ── Export handler ───────────────────────────────────────────────────────

    async function handleExport(moduleId) {
        setExporting(moduleId);
        setExportError('');
        try {
            const { blob, filename } = await api.getBlob(`/export/${moduleId}`);
            downloadBlob(blob, filename);
        } catch (e) {
            setExportError(e.message || 'Export failed');
        } finally {
            setExporting(null);
        }
    }

    async function handleDownloadTemplate(moduleId) {
        setExportError('');
        try {
            const { blob, filename } = await api.getBlob(`/import/${moduleId}/template`);
            downloadBlob(blob, filename);
        } catch (e) {
            setExportError(e.message || 'Failed to download template');
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div>
            <h1 className="page-title">{t('data_tools_title')}</h1>
            <p className="page-subtitle">{t('data_tools_subtitle')}</p>

            {/* Standard Controls Seeding */}
            {role === 'Admin' && (
                <div className="card" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                        <h3 style={{ margin: 0, marginBottom: 4 }}>{t('data_tools_std_controls')}</h3>
                        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{t('data_tools_std_desc')}</p>
                    </div>
                    <button className="btn btn-primary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setShowSeedWizard(true)}>
                        {t('data_tools_seed_btn')}
                    </button>
                </div>
            )}
            {showSeedWizard && (
                <SeedControlsWizard onClose={() => setShowSeedWizard(false)} onDone={() => setShowSeedWizard(false)} />
            )}

            {/* Bulk Import */}
            <div className="card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0 }}>{t('data_tools_bulk_import')}</h3>
                    {step === 'upload' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => handleDownloadTemplate(importModule)}>
                            Download {IMPORT_MODULES.find(m => m.id === importModule)?.label} template (.csv)
                            {(importModule === 'risks' || importModule === 'risk_register') && <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.8, marginTop: 2 }}>ISO 31000 compliant</div>}
                        </button>
                    )}
                </div>

                <StepBar step={step} />

                {importError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{importError}</div>}

                {step === 'upload' && (
                    <StepUpload
                        importModule={importModule}
                        setImportModule={(m) => { setImportModule(m); handleReset(); setStep('upload'); }}
                        onParsed={handleParsed}
                        t={t}
                    />
                )}
                {step === 'map' && (
                    <StepMap
                        importModule={importModule}
                        parsedHeaders={parsedHeaders}
                        parsedRows={parsedRows}
                        onConfirm={handleMapConfirm}
                        onBack={() => setStep('upload')}
                    />
                )}
                {step === 'preview' && (
                    <StepPreview
                        importModule={importModule}
                        parsedRows={parsedRows}
                        columnMap={columnMap}
                        previewResult={previewResult}
                        previewing={previewing}
                        onConfirm={handleConfirmImport}
                        onBack={() => setStep('map')}
                        importing={importing}
                    />
                )}
                {step === 'done' && (
                    <StepDone importResult={importResult} onReset={handleReset} />
                )}
            </div>

            {/* Export */}
            <div className="card">
                <h3 style={{ marginTop: 0 }}>{t('data_tools_export_data')}</h3>
                <div className="text-muted" style={{ marginBottom: 12 }}>{t('data_tools_export_note')}</div>
                {exportError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{exportError}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {EXPORT_MODULES.map(m => (
                        <button key={m.id} type="button" className="btn btn-secondary" onClick={() => handleExport(m.id)} disabled={exporting === m.id}>
                            {exporting === m.id ? t('data_tools_exporting') : `${t('export')} ${m.label} (.csv)`}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
