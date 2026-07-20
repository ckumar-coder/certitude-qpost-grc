import { useState } from 'react';
import PptxGenJS from 'pptxgenjs';
import { useAuth } from '../AuthContext';
import { useT } from '../contexts/LanguageContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

// pptxgenjs wants hex colors without the leading '#'.
function hex(c) {
    return (c || '1B3A6B').replace('#', '');
}

// Shared branded slide master — logo/company top-left, thin accent bar, footer
// with confidential/report-name text, and a real auto-incrementing slide number
// (native to the PPTX format, unlike page numbers in browser-printed HTML).
function addQpMaster(pptx, { primary, logoUrl, company, footerLabel }) {
    const p = hex(primary);
    const objects = [
        { rect: { x: 0, y: 0, w: '100%', h: 0.08, fill: { color: p } } },
        { line: { x: 0.4, y: 7.1, w: 12.53, h: 0, line: { color: 'CBD5E1', width: 0.75 } } },
        { text: { text: `CONFIDENTIAL — ${company}`, options: { x: 0.4, y: 7.18, w: 4.5, h: 0.28, fontSize: 8, color: '94A3B8' } } },
        { text: { text: footerLabel, options: { x: 4.9, y: 7.18, w: 4.5, h: 0.28, fontSize: 8, color: '94A3B8', align: 'center' } } },
    ];
    if (logoUrl) {
        objects.push({ image: { path: logoUrl, x: 0.4, y: 0.3, w: 1.5, h: 0.5, sizing: { type: 'contain', w: 1.5, h: 0.5 } } });
    } else {
        objects.push({ text: { text: company, options: { x: 0.4, y: 0.3, w: 5, h: 0.5, fontSize: 16, bold: true, color: p } } });
    }
    pptx.defineSlideMaster({
        title: 'QP_MASTER',
        background: { color: 'FFFFFF' },
        objects,
        slideNumber: { x: 12.4, y: 7.18, fontSize: 8, color: '94A3B8' },
    });
}

// KPI "stat card" — thin colored top bar + light card body, mirroring the HTML
// report's .border-top-3px styling using two stacked shapes (pptxgenjs rects
// don't support per-side borders).
function addStatCard(slide, { x, y, w, h, value, label, color }) {
    slide.addShape('rect', { x, y, w, h: 0.045, fill: { color } });
    slide.addShape('rect', { x, y: y + 0.045, w, h: h - 0.045, fill: { color: 'F8FAFC' } });
    slide.addText(String(value), { x: x + 0.12, y: y + 0.12, w: w - 0.24, h: h * 0.55, fontSize: 24, bold: true, color, fontFace: 'Arial' });
    slide.addText(label.toUpperCase(), { x: x + 0.12, y: y + h * 0.6, w: w - 0.24, h: h * 0.3, fontSize: 8, color: '64748B', fontFace: 'Arial' });
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-CA');
}

function fmtDateLong(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function scoreLabel(score) {
    if (!score) return '—';
    const n = parseInt(score, 10);
    if (n >= 15) return `${n} — Extreme`;
    if (n >= 10) return `${n} — High`;
    if (n >= 5)  return `${n} — Medium`;
    return `${n} — Low`;
}

function scoreColor(score) {
    const n = parseInt(score, 10);
    if (n >= 15) return '#7f1d1d';
    if (n >= 10) return '#c2410c';
    if (n >= 5)  return '#b45309';
    return '#166534';
}

// Default date range: start of current quarter → today
function defaultFrom() {
    const now = new Date();
    const q   = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
}
function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

// ── Print window generator ────────────────────────────────────────────────────

function buildPrintHtml({ risks, commentary, perRisk, from, to, branding, generatedBy }) {
    const primary = branding?.branding_primary_color || '#1B3A6B';
    const logoUrl = branding?.branding_logo_url || '';
    const companyName = branding?.name || 'Company';
    const totalRisks = risks.length;

    const riskRows = risks.map((r, i) => {
        const notes = [r.cro_notes, perRisk[r.id]].filter(Boolean).join(' — ');
        return `
        <tr style="page-break-inside:avoid">
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${primary};font-family:monospace;font-size:11px;white-space:nowrap">${r.risk_uid || `R-${String(i+1).padStart(3,'0')}`}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:13px">${r.title}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569">${r.risk_category || '—'}${r.sub_category ? ` / ${r.sub_category}` : ''}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#92400e;font-weight:600;font-size:11px">${r.inherent_score || '—'}</span>
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#dcfce7;color:#166534;font-weight:600;font-size:11px">${r.residual_score || '—'}</span>
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;white-space:nowrap">${fmtDateLong(r.cro_actioned_at)}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151">${notes || '—'}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>Accepted Risk Report — ${fmtDateLong(from)} to ${fmtDateLong(to)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #fff; padding: 48px 56px; }
        @media print {
            body { padding: 24px 32px; }
            @page { margin: 20mm 18mm; size: A4 landscape; }
        }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${primary}; padding-bottom: 20px; margin-bottom: 28px; }
        .logo { max-height: 56px; max-width: 200px; object-fit: contain; }
        .company-name { font-size: 22px; font-weight: 800; color: ${primary}; }
        .report-meta { text-align: right; }
        .report-title { font-size: 18px; font-weight: 700; color: ${primary}; margin-bottom: 4px; }
        .report-period { font-size: 13px; color: #64748b; }
        .section { margin-bottom: 28px; }
        .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: ${primary}; margin-bottom: 8px; }
        .commentary-box { background: #f8fafc; border-left: 3px solid ${primary}; padding: 14px 18px; border-radius: 0 6px 6px 0; font-size: 13px; line-height: 1.7; color: #374151; white-space: pre-wrap; }
        .stats { display: flex; gap: 24px; margin-bottom: 28px; }
        .stat { background: #f8fafc; border-radius: 8px; padding: 12px 20px; min-width: 120px; }
        .stat-value { font-size: 24px; font-weight: 800; color: ${primary}; }
        .stat-label { font-size: 11px; color: #64748b; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead tr { background: ${primary}; color: #fff; }
        thead th { padding: 10px 8px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
        .signature-block { margin-top: 48px; display: flex; gap: 64px; }
        .signature-line { border-top: 1px solid #94a3b8; padding-top: 8px; min-width: 220px; font-size: 12px; color: #475569; }
        .signature-name { font-weight: 700; color: #1e293b; margin-top: 4px; }
    </style>
</head>
<body>
    <!-- Letterhead -->
    <div class="header">
        <div>
            ${logoUrl ? `<img src="${logoUrl}" class="logo" alt="${companyName}" />` : `<div class="company-name">${companyName}</div>`}
        </div>
        <div class="report-meta">
            <div class="report-title">Accepted Risk Register</div>
            <div class="report-period">For the period ${fmtDateLong(from)} to ${fmtDateLong(to)}</div>
            <div class="report-period" style="margin-top:4px">Prepared by: ${generatedBy} &nbsp;|&nbsp; Generated: ${fmtDateLong(new Date().toISOString())}</div>
        </div>
    </div>

    <!-- Stats -->
    <div class="stats">
        <div class="stat">
            <div class="stat-value">${totalRisks}</div>
            <div class="stat-label">Risks Accepted</div>
        </div>
        <div class="stat">
            <div class="stat-value">${risks.filter(r => parseInt(r.residual_score) >= 15).length}</div>
            <div class="stat-label">Extreme Residual</div>
        </div>
        <div class="stat">
            <div class="stat-value">${risks.filter(r => parseInt(r.residual_score) >= 10 && parseInt(r.residual_score) < 15).length}</div>
            <div class="stat-label">High Residual</div>
        </div>
    </div>

    <!-- Covering statement -->
    ${commentary ? `
    <div class="section">
        <div class="section-label">CRO Covering Statement</div>
        <div class="commentary-box">${commentary}</div>
    </div>` : ''}

    <!-- Risk table -->
    <div class="section">
        <div class="section-label">Accepted Risks</div>
        <table>
            <thead>
                <tr>
                    <th>Risk ID</th>
                    <th>Risk Title</th>
                    <th>Category</th>
                    <th style="text-align:center">Inherent Score</th>
                    <th style="text-align:center">Residual Score</th>
                    <th>Date Accepted</th>
                    <th>Notes & Commentary</th>
                </tr>
            </thead>
            <tbody>
                ${riskRows || `<tr><td colspan="7" style="padding:24px;text-align:center;color:#94a3b8">No accepted risks in this period.</td></tr>`}
            </tbody>
        </table>
    </div>

    <!-- Signature block -->
    <div class="signature-block">
        <div>
            <div class="signature-line">
                Signature
                <div class="signature-name">${generatedBy}</div>
                <div style="color:#94a3b8;font-size:11px">Chief Risk Officer</div>
            </div>
        </div>
        <div>
            <div class="signature-line">
                Date
                <div class="signature-name">&nbsp;</div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <div class="footer">
        <span>CONFIDENTIAL — ${companyName}</span>
        <span>Accepted Risk Register &nbsp;|&nbsp; ${fmtDateLong(from)} – ${fmtDateLong(to)}</span>
        <span>Generated: ${fmtDateLong(new Date().toISOString())}</span>
    </div>

    <script>window.onload = () => window.print();</script>
</body>
</html>`;
}

// ── Accepted Risk Report PPTX builder ─────────────────────────────────────────

async function buildAcceptedRiskPptx({ risks, commentary, perRisk, from, to, branding, generatedBy }) {
    const primary     = branding?.branding_primary_color || '#1B3A6B';
    const logoUrl      = branding?.branding_logo_url || '';
    const companyName  = branding?.name || 'Company';
    const p            = hex(primary);
    const totalRisks   = risks.length;

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'QP_WIDE', width: 13.333, height: 7.5 });
    pptx.layout = 'QP_WIDE';
    addQpMaster(pptx, { primary, logoUrl, company: companyName, footerLabel: `Accepted Risk Register | ${fmtDateLong(from)} – ${fmtDateLong(to)}` });

    const sectionTitle = (slide, title) => {
        slide.addShape('rect', { x: 0.4, y: 1.02, w: 0.05, h: 0.32, fill: { color: p } });
        slide.addText(title.toUpperCase(), { x: 0.56, y: 0.98, w: 10, h: 0.4, fontSize: 15, bold: true, color: p, fontFace: 'Arial' });
    };

    // ── Slide 1 — Cover ──────────────────────────────────────────────────────
    let slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    slide.addText('Accepted Risk Register', { x: 0.6, y: 2.7, w: 12, h: 0.9, fontSize: 36, bold: true, color: p, fontFace: 'Arial' });
    slide.addText(`For the period ${fmtDateLong(from)} to ${fmtDateLong(to)}`, { x: 0.6, y: 3.55, w: 12, h: 0.4, fontSize: 15, color: '64748B', fontFace: 'Arial' });
    slide.addText(`Prepared by: ${generatedBy}  |  Generated: ${fmtDateLong(new Date().toISOString())}`, { x: 0.6, y: 3.95, w: 12, h: 0.4, fontSize: 13, color: '64748B', fontFace: 'Arial' });

    // ── Slide 2 — Stats + Covering Statement ─────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Summary');
    const stats = [
        { label: 'Risks Accepted',    value: totalRisks, color: p },
        { label: 'Extreme Residual',  value: risks.filter(r => parseInt(r.residual_score) >= 15).length, color: '7F1D1D' },
        { label: 'High Residual',     value: risks.filter(r => parseInt(r.residual_score) >= 10 && parseInt(r.residual_score) < 15).length, color: 'C2410C' },
    ];
    stats.forEach((s, i) => addStatCard(slide, { x: 0.4 + i * 2.5, y: 1.6, w: 2.3, h: 1.2, value: s.value, label: s.label, color: s.color }));

    if (commentary) {
        slide.addShape('rect', { x: 0.4, y: 3.1, w: 0.05, h: 2.4, fill: { color: p } });
        slide.addText('CRO Covering Statement', { x: 0.56, y: 3.05, w: 8, h: 0.3, fontSize: 10, bold: true, color: p, fontFace: 'Arial' });
        slide.addText(commentary, { x: 0.56, y: 3.4, w: 11.5, h: 2.1, fontSize: 12, color: '374151', fontFace: 'Arial', valign: 'top' });
    }

    // ── Slide 3+ — Accepted Risks table (auto-paginates) ─────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Accepted Risks');
    const head = ['Risk ID', 'Risk Title', 'Category', 'Inherent', 'Residual', 'Date Accepted', 'Notes & Commentary'].map(t => ({
        text: t, options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9 },
    }));
    const rows = risks.map((r, i) => {
        const notes = [r.cro_notes, perRisk[r.id]].filter(Boolean).join(' — ');
        return [
            { text: r.risk_uid || `R-${String(i + 1).padStart(3, '0')}`, options: { fontSize: 9, bold: true, color: p } },
            { text: r.title || '—', options: { fontSize: 9, bold: true } },
            { text: `${r.risk_category || '—'}${r.sub_category ? ` / ${r.sub_category}` : ''}`, options: { fontSize: 8, color: '475569' } },
            { text: String(r.inherent_score || '—'), options: { fontSize: 9, align: 'center', color: '92400E', fill: { color: 'FEF3C7' } } },
            { text: String(r.residual_score || '—'), options: { fontSize: 9, align: 'center', color: '166534', fill: { color: 'DCFCE7' } } },
            { text: fmtDateLong(r.cro_actioned_at), options: { fontSize: 8, color: '475569' } },
            { text: notes || '—', options: { fontSize: 8, color: '374151' } },
        ];
    });
    slide.addTable([head, ...(rows.length ? rows : [[{ text: 'No accepted risks in this period.', options: { colspan: 7, align: 'center', color: '94A3B8', fontSize: 10 } }]])], {
        x: 0.4, y: 1.6, w: 12.53, colW: [1.1, 2.3, 1.6, 0.9, 0.9, 1.3, 4.43],
        border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
        autoPage: true, autoPageSlideStartY: 1.2, masterName: 'QP_MASTER',
    });

    // ── Final slide — Signature block ────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Sign-off');
    slide.addShape('line', { x: 0.6, y: 2.6, w: 3.2, h: 0, line: { color: '94A3B8', width: 1 } });
    slide.addText('Signature', { x: 0.6, y: 2.68, w: 3.2, h: 0.3, fontSize: 11, color: '475569', fontFace: 'Arial' });
    slide.addText(generatedBy, { x: 0.6, y: 3.0, w: 3.2, h: 0.3, fontSize: 12, bold: true, color: '1E293B', fontFace: 'Arial' });
    slide.addText('Chief Risk Officer', { x: 0.6, y: 3.3, w: 3.2, h: 0.3, fontSize: 10, color: '94A3B8', fontFace: 'Arial' });

    slide.addShape('line', { x: 4.6, y: 2.6, w: 3.2, h: 0, line: { color: '94A3B8', width: 1 } });
    slide.addText('Date', { x: 4.6, y: 2.68, w: 3.2, h: 0.3, fontSize: 11, color: '475569', fontFace: 'Arial' });

    await pptx.writeFile({ fileName: `Accepted Risk Register — ${companyName} — ${fmtDateLong(from)} to ${fmtDateLong(to)}.pptx` });
}

// ── Accepted Risk Report panel ────────────────────────────────────────────────

function AcceptedRiskReport({ onBack }) {
    const { api, session } = useAuth();
    const t = useT();
    const [from, setFrom]               = useState(defaultFrom);
    const [to, setTo]                   = useState(defaultTo);
    const [risks, setRisks]             = useState([]);
    const [fetched, setFetched]         = useState(false);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState('');
    const [commentary, setCommentary]   = useState('');
    const [perRisk, setPerRisk]         = useState({});   // { [risk.id]: string }

    async function fetchRisks() {
        if (!from || !to) return setError('Please select a date range.');
        setLoading(true);
        setError('');
        try {
            const data = await api.get(`/forms/accepted-risks?from=${from}&to=${to}`);
            setRisks(Array.isArray(data) ? data : []);
            setFetched(true);
            setPerRisk({});
        } catch (e) {
            setError(e.message || 'Failed to load accepted risks.');
        } finally {
            setLoading(false);
        }
    }

    const [pptxLoading, setPptxLoading] = useState(false);

    async function handlePrint() {
        const branding = await api.get('/companies/current/branding').catch(() => ({}));
        const activeCompany = session?.companies?.find(c => c.id === session.activeCompanyId);
        const user = session?.user;
        const generatedBy = user?.full_name || user?.email || 'CRO';

        const html = buildPrintHtml({ risks, commentary, perRisk, from, to, branding, generatedBy });
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
    }

    async function handleExportPptx() {
        setPptxLoading(true);
        setError('');
        try {
            const branding = await api.get('/companies/current/branding').catch(() => ({}));
            const activeCompany = session?.companies?.find(c => c.id === session.activeCompanyId);
            const user = session?.user;
            const generatedBy = user?.full_name || user?.email || 'CRO';
            await buildAcceptedRiskPptx({ risks, commentary, perRisk, from, to, branding: branding?.name ? branding : activeCompany, generatedBy });
        } catch (e) {
            setError(e.message || 'Failed to export PowerPoint');
        } finally {
            setPptxLoading(false);
        }
    }

    return (
        <div>
            {/* Back + title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}>{t('forms_back')}</button>
                <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{t('forms_accepted_risk_report')}</h2>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {t('forms_report_subtitle')}
                    </p>
                </div>
            </div>

            {/* Step 1 — Date range */}
            <div className="card" style={{ marginBottom: 20 }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700 }}>{t('forms_step1')}</h3>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>{t('forms_from')}</label>
                        <input type="date" className="form-control" value={from} onChange={e => { setFrom(e.target.value); setFetched(false); }} style={{ width: 180 }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>{t('forms_to')}</label>
                        <input type="date" className="form-control" value={to} onChange={e => { setTo(e.target.value); setFetched(false); }} style={{ width: 180 }} />
                    </div>
                    <button className="btn btn-secondary" onClick={fetchRisks} disabled={loading}>
                        {loading ? t('forms_fetching') : t('forms_fetch')}
                    </button>
                </div>
                {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}
            </div>

            {/* Step 2 — Results + commentary */}
            {fetched && (
                <>
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                                {t('forms_step2')}
                                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                                    {risks.length} {t('forms_risks_accepted')}
                                </span>
                            </h3>
                        </div>

                        {risks.length === 0 ? (
                            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                {t('forms_no_risks')}
                            </div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>{t('forms_col_risk_id')}</th>
                                        <th>{t('forms_col_title')}</th>
                                        <th>{t('forms_col_category')}</th>
                                        <th>{t('forms_col_inherent')}</th>
                                        <th>{t('forms_col_residual')}</th>
                                        <th>{t('forms_col_date_accepted')}</th>
                                        <th>{t('forms_col_cro_notes')}</th>
                                        <th>{t('forms_col_commentary')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {risks.map(r => (
                                        <tr key={r.id}>
                                            <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>{r.risk_uid}</td>
                                            <td style={{ fontWeight: 600 }}>{r.title}</td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.risk_category || '—'}</td>
                                            <td>
                                                <span style={{ fontWeight: 700, fontSize: 12, color: scoreColor(r.inherent_score) }}>{r.inherent_score || '—'}</span>
                                            </td>
                                            <td>
                                                <span style={{ fontWeight: 700, fontSize: 12, color: scoreColor(r.residual_score) }}>{r.residual_score || '—'}</span>
                                            </td>
                                            <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(r.cro_actioned_at)}</td>
                                            <td style={{ fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 180 }}>{r.cro_notes || '—'}</td>
                                            <td>
                                                <textarea
                                                    rows={2}
                                                    className="form-control"
                                                    style={{ fontSize: 12, minWidth: 200, resize: 'vertical' }}
                                                    placeholder={t('forms_commentary_ph')}
                                                    value={perRisk[r.id] || ''}
                                                    onChange={e => setPerRisk(prev => ({ ...prev, [r.id]: e.target.value }))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Step 3 — Covering statement + generate */}
                    <div className="card">
                        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>{t('forms_step3')}</h3>
                        <div className="form-group">
                            <label>{t('forms_covering_stmt')}</label>
                            <textarea
                                className="form-control"
                                rows={5}
                                placeholder={`e.g. During the period ${fmtDateLong(from)} to ${fmtDateLong(to)}, the following ${risks.length} risk(s) were formally reviewed and accepted by the Board. Each risk was assessed against the company's risk appetite and deemed acceptable given current controls and mitigating factors.`}
                                value={commentary}
                                onChange={e => setCommentary(e.target.value)}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                            <button className="btn btn-secondary" onClick={handleExportPptx} disabled={pptxLoading}>
                                {pptxLoading ? '⏳ Exporting…' : '📽 Export as PowerPoint'}
                            </button>
                            <button className="btn btn-primary" onClick={handlePrint}>
                                {t('forms_print')}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Management Pack print builder ────────────────────────────────────────────

function buildManagementPackHtml({ data, branding, generatedBy }) {
    const primary   = branding?.branding_primary_color || '#1B3A6B';
    const logoUrl   = branding?.branding_logo_url || '';
    const company   = branding?.name || 'Company';
    const today     = fmtDateLong(new Date().toISOString());

    const {
        top_risks = [], kri_summary = {}, issues_summary = {},
        compliance_summary = {}, risk_heatmap = [],
        risk_distribution_by_dept = [], appetite_breaches = [],
        tolerance_breaches = [],
    } = data;

    const totalRisks   = top_risks.length;
    const openIssues   = issues_summary.open_count || 0;
    const compliancePct = (() => {
        const total = compliance_summary.overall?.total || 0;
        const comp  = compliance_summary.overall?.Compliant || 0;
        return total ? Math.round((comp / total) * 100) : null;
    })();
    const appetiteCount = (appetite_breaches?.length || 0) + (tolerance_breaches?.length || 0);

    const bandColor = (score) => {
        const n = parseInt(score, 10);
        if (n >= 15) return '#7f1d1d';
        if (n >= 10) return '#c2410c';
        if (n >= 5)  return '#b45309';
        return '#166534';
    };
    const bandBg = (score) => {
        const n = parseInt(score, 10);
        if (n >= 15) return '#fee2e2';
        if (n >= 10) return '#ffedd5';
        if (n >= 5)  return '#fef9c3';
        return '#dcfce7';
    };
    const cellBg = (score) => {
        if (score >= 15) return '#7f1d1d';
        if (score >= 10) return '#c2410c';
        if (score >= 5)  return '#b45309';
        return '#166534';
    };

    // Build 5×5 heatmap grid (impact 5→1 rows, likelihood 1→5 cols)
    const heatmapRows = [];
    for (let impact = 5; impact >= 1; impact--) {
        const cells = [];
        for (let likelihood = 1; likelihood <= 5; likelihood++) {
            const cell = risk_heatmap.find(c => c.likelihood === likelihood && c.impact === impact) || { count: 0, score: likelihood * impact };
            cells.push(cell);
        }
        heatmapRows.push({ impact, cells });
    }

    const heatmapHtml = `
    <table style="border-collapse:collapse;width:100%;table-layout:fixed">
        <thead>
            <tr>
                <th style="padding:6px;font-size:10px;color:#64748b;text-align:center;width:80px">Impact ↓ / Likelihood →</th>
                ${[1,2,3,4,5].map(l => `<th style="padding:6px;text-align:center;font-size:11px;font-weight:600;color:#475569">${l}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${heatmapRows.map(row => `
            <tr>
                <td style="padding:6px;text-align:center;font-size:11px;font-weight:600;color:#475569">${row.impact}</td>
                ${row.cells.map(cell => `
                <td style="padding:10px 4px;text-align:center;background:${cellBg(cell.score)};color:#fff;font-weight:700;font-size:14px;border:2px solid #fff;border-radius:4px">
                    ${cell.count > 0 ? cell.count : ''}
                </td>`).join('')}
            </tr>`).join('')}
        </tbody>
    </table>`;

    const topRisksHtml = top_risks.slice(0, 10).map((r, i) => `
    <tr style="page-break-inside:avoid">
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${primary};font-size:11px;white-space:nowrap">${r.risk_uid || `R-${String(i+1).padStart(3,'0')}`}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${r.risk_detail || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569">${r.department || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569">${r.risk_owner || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${bandBg(r.residual_score)};color:${bandColor(r.residual_score)};font-weight:700;font-size:11px">${r.residual_score || '—'}</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:14px">${r.directional_trend === 'Increasing' ? '↑' : r.directional_trend === 'Decreasing' ? '↓' : '→'}</td>
    </tr>`).join('');

    const deptHtml = risk_distribution_by_dept.slice(0, 12).map(d => `
    <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600">${d.department}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.inherent.extreme || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.inherent.high || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.inherent.moderate || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.residual.extreme || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.residual.high || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${d.residual.moderate || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;font-size:12px">${d.residual.total || 0}</td>
    </tr>`).join('');

    const kriRedHtml = (kri_summary.red_items || []).map(k => `
    <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#C0152A;font-size:11px">${k.kri_uid}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-size:12px">${k.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px">${k.current_value ?? '—'}</td>
    </tr>`).join('');

    const header = (title) => `
    <div style="display:flex;align-items:center;gap:12px;margin:32px 0 14px">
        <div style="width:4px;height:22px;background:${primary};border-radius:2px;flex-shrink:0"></div>
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${primary}">${title}</div>
        <div style="flex:1;height:1px;background:#e2e8f0"></div>
    </div>`;

    // Branded letterhead — sits in the outer <thead>, so browsers repeat it on
    // every printed page (the standard trick for running headers with window.print(),
    // since @page margin boxes like @top-center aren't supported by Chrome/Safari).
    const letterhead = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${primary};padding-bottom:14px;margin-bottom:18px">
        <div>
            ${logoUrl ? `<img src="${logoUrl}" style="max-height:44px;max-width:170px;object-fit:contain" alt="${company}"/>` : `<div style="font-size:18px;font-weight:800;color:${primary}">${company}</div>`}
        </div>
        <div style="text-align:right">
            <div style="font-size:16px;font-weight:800;color:${primary}">Risk Management Pack</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">Prepared by: ${generatedBy} &nbsp;|&nbsp; Generated: ${today}</div>
        </div>
    </div>`;

    // Branded footer — sits in the outer <tfoot>, so it repeats on every page too.
    // No fabricated "Page X" text here — real page counts aren't reliably available
    // to page-level CSS/JS in Chrome/Safari print (see note left for future readers).
    const letterfoot = `
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8">
        <span>CONFIDENTIAL — ${company}</span>
        <span>Risk Management Pack</span>
        <span>Generated: ${today}</span>
    </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Risk Management Pack — ${company} — ${today}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:'Segoe UI',Arial,sans-serif; color:#1e293b; background:#fff; padding:28px 32px; }
@media print {
    body { padding:10px 14px; }
    /* Landscape gives a wider page for the heatmap/tables — the standard
       orientation for a board-style risk pack. */
    @page { margin:12mm 12mm; size:A4 landscape; }
    .no-break { page-break-inside:avoid; }
    .page-break { page-break-before:always; }
}
table { width:100%; border-collapse:collapse; }
thead tr { background:${primary}; color:#fff; }
thead th { padding:9px 8px; text-align:left; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
tbody tr:nth-child(even) { background:#f8fafc; }
.footer { margin-top:32px; padding-top:14px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:10px; color:#94a3b8; }
/* Outer page-wrap table: its <thead>/<tfoot> are what browsers repeat on every
   printed page — this is how the letterhead and footer follow the report across
   pages instead of only appearing once at the very top/bottom. Reset the generic
   thead/tbody styling above (meant for the data tables) so it doesn't paint the
   letterhead/footer navy as well. */
.page-wrap { border-collapse:collapse; }
.page-wrap > thead > tr, .page-wrap > tfoot > tr, .page-wrap > tbody > tr { background:transparent; color:inherit; }
.page-wrap > thead > tr > td, .page-wrap > tfoot > tr > td, .page-wrap > tbody > tr > td { padding:0; background:transparent; }
</style>
</head>
<body>

<table class="page-wrap">
<thead><tr><td>${letterhead}</td></tr></thead>
<tfoot><tr><td>${letterfoot}</td></tr></tfoot>
<tbody><tr><td>

<!-- ── Executive Summary ─────────────────────────────────────────────────── -->
${header('Executive Summary')}
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:8px" class="no-break">
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-top:3px solid ${primary}">
        <div style="font-size:26px;font-weight:800;color:${primary}">${totalRisks}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Risks Tracked</div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-top:3px solid ${(kri_summary.red || 0) > 0 ? '#C0152A' : '#127A47'}">
        <div style="font-size:26px;font-weight:800;color:${(kri_summary.red || 0) > 0 ? '#C0152A' : '#127A47'}">${kri_summary.red || 0}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Red KRIs</div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-top:3px solid ${openIssues > 0 ? '#D9500A' : '#127A47'}">
        <div style="font-size:26px;font-weight:800;color:${openIssues > 0 ? '#D9500A' : '#127A47'}">${openIssues}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Open Issues</div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-top:3px solid ${compliancePct === null ? '#64748b' : compliancePct >= 80 ? '#127A47' : compliancePct >= 60 ? '#C07D0A' : '#C0152A'}">
        <div style="font-size:26px;font-weight:800;color:${compliancePct === null ? '#64748b' : compliancePct >= 80 ? '#127A47' : '#C0152A'}">${compliancePct !== null ? compliancePct + '%' : '—'}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Compliance Rate</div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-top:3px solid ${appetiteCount > 0 ? '#C0152A' : '#127A47'}">
        <div style="font-size:26px;font-weight:800;color:${appetiteCount > 0 ? '#C0152A' : '#127A47'}">${appetiteCount}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Appetite Breaches</div>
    </div>
</div>

<!-- ── Risk Heatmap ──────────────────────────────────────────────────────── -->
${header('Risk Heatmap (Residual)')}
<div class="no-break" style="max-width:480px">
    ${heatmapHtml}
    <div style="display:flex;gap:16px;margin-top:10px;font-size:10px;color:#64748b">
        <span><span style="display:inline-block;width:12px;height:12px;background:#166534;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Low (1–4)</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#b45309;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Medium (5–9)</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#c2410c;border-radius:2px;vertical-align:middle;margin-right:4px"></span>High (10–14)</span>
        <span><span style="display:inline-block;width:12px;height:12px;background:#7f1d1d;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Extreme (15–25)</span>
    </div>
</div>

<!-- ── Top Risks ─────────────────────────────────────────────────────────── -->
${header('Top 10 Risks by Residual Score')}
<table class="no-break">
    <thead><tr>
        <th style="width:80px">Risk ID</th>
        <th>Risk Description</th>
        <th style="width:120px">Department</th>
        <th style="width:110px">Owner</th>
        <th style="width:80px;text-align:center">Residual</th>
        <th style="width:50px;text-align:center">Trend</th>
    </tr></thead>
    <tbody>
        ${topRisksHtml || `<tr><td colspan="6" style="padding:20px;text-align:center;color:#94a3b8">No risks recorded.</td></tr>`}
    </tbody>
</table>

<!-- ── Department Risk Distribution ─────────────────────────────────────── -->
${header('Risk Distribution by Department')}
<table class="no-break">
    <thead><tr>
        <th>Department</th>
        <th style="text-align:center" colspan="3">Inherent</th>
        <th style="text-align:center" colspan="3">Residual</th>
        <th style="text-align:center">Total</th>
    </tr>
    <tr style="background:${primary}cc">
        <th></th>
        <th style="text-align:center;font-size:9px">Extreme</th>
        <th style="text-align:center;font-size:9px">High</th>
        <th style="text-align:center;font-size:9px">Medium</th>
        <th style="text-align:center;font-size:9px">Extreme</th>
        <th style="text-align:center;font-size:9px">High</th>
        <th style="text-align:center;font-size:9px">Medium</th>
        <th style="text-align:center;font-size:9px">Risks</th>
    </tr></thead>
    <tbody>
        ${deptHtml || `<tr><td colspan="8" style="padding:20px;text-align:center;color:#94a3b8">No department data.</td></tr>`}
    </tbody>
</table>

<!-- ── KRI Status ────────────────────────────────────────────────────────── -->
${header('Key Risk Indicators (KRI) Status')}
<div style="display:flex;gap:16px;margin-bottom:16px" class="no-break">
    <div style="flex:1;background:#dcfce7;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:#127A47">${kri_summary.green || 0}</div>
        <div style="font-size:10px;color:#166534;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">🟢 Green</div>
    </div>
    <div style="flex:1;background:#fef9c3;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:#b45309">${kri_summary.amber || 0}</div>
        <div style="font-size:10px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">🟡 Amber</div>
    </div>
    <div style="flex:1;background:#fee2e2;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:#C0152A">${kri_summary.red || 0}</div>
        <div style="font-size:10px;color:#7f1d1d;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">🔴 Red</div>
    </div>
    <div style="flex:1;background:#f1f5f9;border-radius:8px;padding:14px 16px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:#64748b">${kri_summary.none || 0}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">⚪ No Data</div>
    </div>
</div>
${(kri_summary.red_items || []).length > 0 ? `
<table class="no-break">
    <thead><tr><th style="width:90px">KRI ID</th><th>Indicator Name</th><th style="width:100px;text-align:center">Current Value</th></tr></thead>
    <tbody>${kriRedHtml}</tbody>
</table>` : `<div style="padding:14px;background:#f8fafc;border-radius:6px;font-size:12px;color:#64748b">✅ No KRIs currently in breach.</div>`}

<!-- ── Issues Summary ────────────────────────────────────────────────────── -->
${header('Issues Summary')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px" class="no-break">
    ${['Critical','High','Medium','Low'].map(p => {
        const count = (issues_summary.by_priority || {})[p] || 0;
        const colors = { Critical:'#C0152A', High:'#c2410c', Medium:'#b45309', Low:'#127A47' };
        return `<div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border-left:4px solid ${colors[p]}">
            <div style="font-size:24px;font-weight:800;color:${colors[p]}">${count}</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px;text-transform:uppercase">${p}</div>
        </div>`;
    }).join('')}
</div>

</td></tr></tbody>
</table>

<script>window.onload = () => window.print();</script>
</body>
</html>`;
}

// ── Management Pack PPTX builder ──────────────────────────────────────────────

async function buildManagementPackPptx({ data, branding, generatedBy }) {
    const primary = branding?.branding_primary_color || '#1B3A6B';
    const logoUrl = branding?.branding_logo_url || '';
    const company = branding?.name || 'Company';
    const today   = fmtDateLong(new Date().toISOString());
    const p       = hex(primary);

    const {
        top_risks = [], kri_summary = {}, issues_summary = {},
        compliance_summary = {}, risk_heatmap = [],
        risk_distribution_by_dept = [],
        appetite_breaches = [], tolerance_breaches = [],
    } = data;

    const totalRisks    = top_risks.length;
    const openIssues    = issues_summary.open_count || 0;
    const compliancePct = (() => {
        const total = compliance_summary.overall?.total || 0;
        const comp  = compliance_summary.overall?.Compliant || 0;
        return total ? Math.round((comp / total) * 100) : null;
    })();
    const appetiteCount = (appetite_breaches?.length || 0) + (tolerance_breaches?.length || 0);

    const bandColorHex = (score) => {
        const n = parseInt(score, 10);
        if (n >= 15) return '7F1D1D';
        if (n >= 10) return 'C2410C';
        if (n >= 5)  return 'B45309';
        return '166534';
    };
    const bandBgHex = (score) => {
        const n = parseInt(score, 10);
        if (n >= 15) return 'FEE2E2';
        if (n >= 10) return 'FFEDD5';
        if (n >= 5)  return 'FEF9C3';
        return 'DCFCE7';
    };
    const cellBgHex = (score) => {
        if (score >= 15) return '7F1D1D';
        if (score >= 10) return 'C2410C';
        if (score >= 5)  return 'B45309';
        return '166534';
    };

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'QP_WIDE', width: 13.333, height: 7.5 });
    pptx.layout = 'QP_WIDE';
    addQpMaster(pptx, { primary, logoUrl, company, footerLabel: 'Risk Management Pack' });

    const sectionTitle = (slide, title) => {
        slide.addShape('rect', { x: 0.4, y: 1.02, w: 0.05, h: 0.32, fill: { color: p } });
        slide.addText(title.toUpperCase(), { x: 0.56, y: 0.98, w: 10, h: 0.4, fontSize: 15, bold: true, color: p, fontFace: 'Arial' });
    };

    // ── Slide 1 — Cover ──────────────────────────────────────────────────────
    let slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    slide.addText('Risk Management Pack', { x: 0.6, y: 2.9, w: 12, h: 0.9, fontSize: 40, bold: true, color: p, fontFace: 'Arial' });
    slide.addText(`Prepared by: ${generatedBy}`, { x: 0.6, y: 3.8, w: 12, h: 0.4, fontSize: 15, color: '64748B', fontFace: 'Arial' });
    slide.addText(`Generated: ${today}`, { x: 0.6, y: 4.15, w: 12, h: 0.4, fontSize: 15, color: '64748B', fontFace: 'Arial' });

    // ── Slide 2 — Executive Summary ──────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Executive Summary');
    const kpis = [
        { label: 'Risks Tracked',     value: totalRisks,                                   color: p },
        { label: 'Red KRIs',          value: kri_summary.red || 0,                         color: (kri_summary.red || 0) > 0 ? 'C0152A' : '127A47' },
        { label: 'Open Issues',       value: openIssues,                                   color: openIssues > 0 ? 'D9500A' : '127A47' },
        { label: 'Compliance Rate',   value: compliancePct !== null ? `${compliancePct}%` : '—', color: compliancePct === null ? '64748B' : compliancePct >= 80 ? '127A47' : compliancePct >= 60 ? 'C07D0A' : 'C0152A' },
        { label: 'Appetite Breaches', value: appetiteCount,                                color: appetiteCount > 0 ? 'C0152A' : '127A47' },
    ];
    const kpiW = 2.32, kpiGap = 0.2;
    kpis.forEach((k, i) => addStatCard(slide, { x: 0.4 + i * (kpiW + kpiGap), y: 1.6, w: kpiW, h: 1.3, value: k.value, label: k.label, color: k.color }));

    // ── Slide 3 — Risk Heatmap ───────────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Risk Heatmap (Residual)');
    const heatRows = [];
    const headerRow = [{ text: 'Impact ↓ / Likelihood →', options: { fill: { color: 'FFFFFF' }, fontSize: 8, color: '64748B' } }];
    [1, 2, 3, 4, 5].forEach(l => headerRow.push({ text: String(l), options: { fill: { color: 'FFFFFF' }, fontSize: 9, bold: true, color: '475569', align: 'center' } }));
    heatRows.push(headerRow);
    for (let impact = 5; impact >= 1; impact--) {
        const row = [{ text: String(impact), options: { fill: { color: 'FFFFFF' }, fontSize: 9, bold: true, color: '475569', align: 'center' } }];
        for (let likelihood = 1; likelihood <= 5; likelihood++) {
            const cell = risk_heatmap.find(c => c.likelihood === likelihood && c.impact === impact) || { count: 0, score: likelihood * impact };
            row.push({
                text: cell.count > 0 ? String(cell.count) : '',
                options: { fill: { color: cellBgHex(cell.score) }, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center' },
            });
        }
        heatRows.push(row);
    }
    slide.addTable(heatRows, { x: 0.4, y: 1.6, w: 6.5, h: 3.2, colW: [1.3, 1.04, 1.04, 1.04, 1.04, 1.04], border: { type: 'solid', color: 'FFFFFF', pt: 2 } });
    const legend = [['Low (1–4)', '166534'], ['Medium (5–9)', 'B45309'], ['High (10–14)', 'C2410C'], ['Extreme (15–25)', '7F1D1D']];
    legend.forEach(([label, color], i) => {
        slide.addShape('rect', { x: 0.4 + i * 1.9, y: 5.05, w: 0.16, h: 0.16, fill: { color } });
        slide.addText(label, { x: 0.62 + i * 1.9, y: 5.0, w: 1.7, h: 0.25, fontSize: 9, color: '64748B', fontFace: 'Arial' });
    });

    // ── Slide 4 — Top 10 Risks ───────────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Top 10 Risks by Residual Score');
    const topHead = ['Risk ID', 'Risk Description', 'Department', 'Owner', 'Residual', 'Trend'].map(t => ({
        text: t, options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9 },
    }));
    const topRows = top_risks.slice(0, 10).map((r, i) => ([
        { text: r.risk_uid || `R-${String(i + 1).padStart(3, '0')}`, options: { fontSize: 9, bold: true, color: p } },
        { text: r.risk_detail || '—', options: { fontSize: 9 } },
        { text: r.department || '—', options: { fontSize: 9, color: '475569' } },
        { text: r.risk_owner || '—', options: { fontSize: 9, color: '475569' } },
        { text: String(r.residual_score || '—'), options: { fontSize: 9, bold: true, color: bandColorHex(r.residual_score), fill: { color: bandBgHex(r.residual_score) }, align: 'center' } },
        { text: r.directional_trend === 'Increasing' ? '↑' : r.directional_trend === 'Decreasing' ? '↓' : '→', options: { fontSize: 11, align: 'center' } },
    ]));
    slide.addTable([topHead, ...(topRows.length ? topRows : [[{ text: 'No risks recorded.', options: { colspan: 6, align: 'center', color: '94A3B8', fontSize: 10 } }]])], {
        x: 0.4, y: 1.6, w: 12.53, colW: [1.1, 5.83, 1.9, 1.7, 1.0, 1.0],
        border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
        autoPage: true, autoPageSlideStartY: 1.2, masterName: 'QP_MASTER',
    });

    // ── Slide — Risk Distribution by Department ──────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Risk Distribution by Department');
    const deptHead1 = [
        { text: 'Department', options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9, rowspan: 2 } },
        { text: 'Inherent', options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9, colspan: 3, align: 'center' } },
        { text: 'Residual', options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9, colspan: 3, align: 'center' } },
        { text: 'Total', options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9, rowspan: 2, align: 'center' } },
    ];
    const deptHead2 = ['Extreme', 'High', 'Medium', 'Extreme', 'High', 'Medium'].map(t => ({
        text: t, options: { fill: { color: p, transparency: 20 }, color: 'FFFFFF', fontSize: 8, align: 'center' },
    }));
    const deptRows = risk_distribution_by_dept.slice(0, 12).map(d => ([
        { text: d.department, options: { fontSize: 9, bold: true } },
        { text: String(d.inherent.extreme || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.inherent.high || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.inherent.moderate || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.residual.extreme || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.residual.high || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.residual.moderate || 0), options: { fontSize: 9, align: 'center' } },
        { text: String(d.residual.total || 0), options: { fontSize: 9, bold: true, align: 'center' } },
    ]));
    slide.addTable([deptHead1, deptHead2, ...(deptRows.length ? deptRows : [[{ text: 'No department data.', options: { colspan: 8, align: 'center', color: '94A3B8', fontSize: 10 } }]])], {
        x: 0.4, y: 1.6, w: 12.53, colW: [2.53, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.6],
        border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
        autoPage: true, autoPageSlideStartY: 1.2, masterName: 'QP_MASTER',
    });

    // ── Slide — KRI Status ────────────────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Key Risk Indicators (KRI) Status');
    const kriStats = [
        { label: 'Green',   value: kri_summary.green || 0, color: '127A47' },
        { label: 'Amber',   value: kri_summary.amber || 0, color: 'B45309' },
        { label: 'Red',     value: kri_summary.red || 0,   color: 'C0152A' },
        { label: 'No Data', value: kri_summary.none || 0,  color: '64748B' },
    ];
    kriStats.forEach((k, i) => addStatCard(slide, { x: 0.4 + i * (kpiW + kpiGap), y: 1.6, w: kpiW, h: 1.1, value: k.value, label: k.label, color: k.color }));
    const redItems = kri_summary.red_items || [];
    if (redItems.length) {
        const kriHead = ['KRI ID', 'Indicator Name', 'Current Value'].map(t => ({ text: t, options: { fill: { color: p }, color: 'FFFFFF', bold: true, fontSize: 9 } }));
        const kriRows = redItems.map(k => ([
            { text: k.kri_uid, options: { fontSize: 9, bold: true, color: 'C0152A' } },
            { text: k.name, options: { fontSize: 9 } },
            { text: String(k.current_value ?? '—'), options: { fontSize: 9, align: 'center' } },
        ]));
        slide.addTable([kriHead, ...kriRows], { x: 0.4, y: 3.1, w: 8, colW: [1.3, 5.2, 1.5], border: { type: 'solid', color: 'E2E8F0', pt: 0.5 } });
    } else {
        slide.addText('✅ No KRIs currently in breach.', { x: 0.4, y: 3.1, w: 8, h: 0.4, fontSize: 11, color: '64748B', fontFace: 'Arial' });
    }

    // ── Slide — Issues Summary ────────────────────────────────────────────────
    slide = pptx.addSlide({ masterName: 'QP_MASTER' });
    sectionTitle(slide, 'Issues Summary');
    const issueColors = { Critical: 'C0152A', High: 'C2410C', Medium: 'B45309', Low: '127A47' };
    ['Critical', 'High', 'Medium', 'Low'].forEach((label, i) => {
        const count = (issues_summary.by_priority || {})[label] || 0;
        addStatCard(slide, { x: 0.4 + i * (kpiW + kpiGap), y: 1.6, w: kpiW, h: 1.2, value: count, label, color: issueColors[label] });
    });

    await pptx.writeFile({ fileName: `Risk Management Pack — ${company} — ${new Date().toISOString().slice(0, 10)}.pptx` });
}

// ── Management Pack component ─────────────────────────────────────────────────

function ManagementPack({ onBack }) {
    const { api, session } = useAuth();
    const [loading, setLoading]       = useState(false);
    const [pptxLoading, setPptxLoading] = useState(false);
    const [error, setError]           = useState('');

    const activeCompany = session?.companies?.find(c => c.id === session.activeCompanyId);
    const generatedBy   = session?.user?.full_name || session?.user?.email || 'Administrator';

    async function loadPackData() {
        const data     = await api.get('/dashboard/management-summary');
        const branding = await api.get('/companies/current/branding').catch(() => activeCompany);
        return { data, branding: branding || activeCompany };
    }

    async function handleGenerate() {
        setLoading(true);
        setError('');
        try {
            const { data, branding } = await loadPackData();
            const html = buildManagementPackHtml({ data, branding, generatedBy });
            const win  = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
        } catch (e) {
            setError(e.message || 'Failed to generate Management Pack');
        } finally {
            setLoading(false);
        }
    }

    async function handleExportPptx() {
        setPptxLoading(true);
        setError('');
        try {
            const { data, branding } = await loadPackData();
            await buildManagementPackPptx({ data, branding, generatedBy });
        } catch (e) {
            setError(e.message || 'Failed to export PowerPoint');
        } finally {
            setPptxLoading(false);
        }
    }

    return (
        <div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={onBack}>← Back</button>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>📊 Risk Management Pack</h2>
                </div>
                <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    Generates a Management Pack with the current dashboard data — Risk Heatmap, Top Risks, KRI Status, Issues Summary, and Department Risk Distribution — formatted on company letterhead. Available as a print-ready page or a PowerPoint deck you can drop straight into a board presentation.
                </p>
                {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || pptxLoading}>
                        {loading ? '⏳ Generating…' : '🖨 Generate & Print Management Pack'}
                    </button>
                    <button className="btn btn-secondary" onClick={handleExportPptx} disabled={loading || pptxLoading}>
                        {pptxLoading ? '⏳ Exporting…' : '📽 Export as PowerPoint'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({ icon, title, description, badge, onClick }) {
    return (
        <div
            onClick={onClick}
            style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 12, padding: '24px 28px', cursor: 'pointer',
                transition: 'box-shadow 0.15s, border-color 0.15s',
                display: 'flex', gap: 20, alignItems: 'flex-start',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
            <div style={{ fontSize: 32, flexShrink: 0, lineHeight: 1 }}>{icon}</div>
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
                    {badge && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--color-primary)', color: '#fff', borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{badge}</span>
                    )}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{description}</p>
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 18, flexShrink: 0, alignSelf: 'center' }}>→</div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FormsTemplates() {
    const [active, setActive] = useState(null);
    const t = useT();

    if (active === 'accepted-risks') {
        return (
            <div>
                <div className="topbar">
                    <div>
                        <h1 className="page-title">{t('forms_title')}</h1>
                        <p className="page-subtitle">{t('forms_subtitle')}</p>
                    </div>
                </div>
                <AcceptedRiskReport onBack={() => setActive(null)} />
            </div>
        );
    }

    if (active === 'management-pack') {
        return (
            <div>
                <div className="topbar">
                    <div>
                        <h1 className="page-title">{t('forms_title')}</h1>
                        <p className="page-subtitle">{t('forms_subtitle')}</p>
                    </div>
                </div>
                <ManagementPack onBack={() => setActive(null)} />
            </div>
        );
    }

    return (
        <div>
            <div className="topbar">
                <div>
                    <h1 className="page-title">{t('forms_title')}</h1>
                    <p className="page-subtitle">{t('forms_subtitle')}</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
                <TemplateCard
                    icon="📋"
                    title={t('forms_accepted_risk_report')}
                    description={t('forms_accepted_risk_desc')}
                    badge={t('forms_available')}
                    onClick={() => setActive('accepted-risks')}
                />
                <TemplateCard
                    icon="📊"
                    title="Management Pack"
                    description="One-click printable Management Pack — Risk Heatmap, Top 10 Risks, KRI Status, Issues, and Compliance Summary on company letterhead."
                    badge="Demo"
                    onClick={() => setActive('management-pack')}
                />
                <TemplateCard
                    icon="⚠️"
                    title={t('forms_risk_exception')}
                    description={t('forms_risk_exception_desc')}
                    badge={t('forms_coming_soon')}
                    onClick={null}
                />
                <TemplateCard
                    icon="📝"
                    title={t('forms_appetite_stmt')}
                    description={t('forms_appetite_desc')}
                    badge={t('forms_coming_soon')}
                    onClick={null}
                />
            </div>
        </div>
    );
}
