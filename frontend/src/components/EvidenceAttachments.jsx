/**
 * EvidenceAttachments — reusable evidence file panel.
 *
 * Props:
 *   entityType  string  'risk' | 'control' | 'issue' | 'obligation' | 'kri'
 *   entityId    string  The UID of the parent record (e.g. "RI-FIN-001", "CI-OPS-002")
 *
 * The API endpoints expected:
 *   GET    /api/evidence/:entityType/:entityId  → [{id, filename, mime_type, file_size_bytes, uploaded_by, uploaded_at}]
 *   POST   /api/evidence/:entityType/:entityId  → {id, filename, …}   body: {filename, mime_type, file_data (base64), file_size_bytes}
 *   GET    /api/evidence/download/:id           → file download (Content-Disposition: attachment)
 *   DELETE /api/evidence/:id                    → {}
 *
 * Role gating: `canWrite`/`canDelete` (below) — write is Admin, Risk
 * Manager, Risk Champion, Risk Owner, CRO (+ Consultant CRO via the
 * backend's CRO auto-expand rule); delete is Admin only. See
 * Documents/Internal/RBAC_Permissions_Engine_Scoping.docx section 3.6.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType) {
    if (!mimeType) return '📎';
    if (mimeType.startsWith('image/')) return '🖼';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    return '📎';
}

export default function EvidenceAttachments({ entityType, entityId }) {
    const { api, session } = useAuth();
    const activeCompany = session.companies.find((c) => c.id === session.activeCompanyId);
    const role = activeCompany?.role || 'Viewer';
    const canWrite = role === 'Admin' || role === 'Risk Manager' || role === 'Risk Champion' || role === 'Risk Owner' || role === 'CRO';
    const canDelete = role === 'Admin';

    const [attachments, setAttachments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadSuccess, setUploadSuccess] = useState('');
    const fileRef = useRef(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        api.get(`/evidence/${entityType}/${entityId}`)
            .then((data) => { if (active) { setAttachments(data); setLoading(false); } })
            .catch(() => { if (active) { setLoading(false); } });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entityType, entityId]);

    async function handleUpload(e) {
        e.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        if (file.size > MAX_BYTES) {
            setUploadError(`File too large — maximum is 2 MB (this file is ${formatBytes(file.size)}).`);
            return;
        }
        setUploading(true);
        setUploadError('');
        setUploadSuccess('');
        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const created = await api.post(`/evidence/${entityType}/${entityId}`, {
                filename: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_data: base64,
                file_size_bytes: file.size,
            });
            setAttachments((prev) => [...prev, created]);
            setUploadSuccess(`"${file.name}" uploaded.`);
            if (fileRef.current) fileRef.current.value = '';
        } catch (err) {
            setUploadError(err.message || 'Upload failed.');
        } finally {
            setUploading(false);
        }
    }

    async function handleDelete(id, filename) {
        if (!window.confirm(`Delete "${filename}"?`)) return;
        try {
            await api.delete(`/evidence/${id}`);
            setAttachments((prev) => prev.filter((a) => a.id !== id));
        } catch (err) {
            setError(err.message || 'Delete failed.');
        }
    }

    function handleDownload(id, filename) {
        // Trigger a download by navigating; the server sends Content-Disposition: attachment.
        const a = document.createElement('a');
        a.href = `/api/evidence/download/${id}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    return (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--color-text)' }}>
                Evidence Files
            </div>

            {error && (
                <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>
            )}

            {loading ? (
                <div className="text-muted" style={{ fontSize: 12 }}>Loading…</div>
            ) : attachments.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>No files attached yet.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {attachments.map((a) => (
                        <div
                            key={a.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                background: 'var(--color-bg)',
                                borderRadius: 6,
                                padding: '6px 10px',
                                fontSize: 12,
                            }}
                        >
                            <span style={{ fontSize: 16 }}>{fileIcon(a.mime_type)}</span>
                            <button
                                type="button"
                                className="btn-link"
                                style={{ fontWeight: 600, padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-primary)', textAlign: 'left' }}
                                onClick={() => handleDownload(a.id, a.filename)}
                            >
                                {a.filename}
                            </button>
                            <span className="text-muted">{formatBytes(a.file_size_bytes)}</span>
                            <span className="text-muted">·</span>
                            <span className="text-muted">{a.uploaded_by}</span>
                            <span className="text-muted">·</span>
                            <span className="text-muted">{new Date(a.uploaded_at).toLocaleDateString()}</span>
                            {canDelete && (
                                <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
                                    onClick={() => handleDelete(a.id, a.filename)}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {canWrite && (
                <form onSubmit={handleUpload} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input
                        ref={fileRef}
                        type="file"
                        className="form-control"
                        style={{ flex: '1 1 200px', fontSize: 12, padding: '4px 8px' }}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.txt,.zip"
                    />
                    <button
                        type="submit"
                        className="btn btn-sm btn-secondary"
                        disabled={uploading}
                        style={{ flexShrink: 0 }}
                    >
                        {uploading ? 'Uploading…' : 'Attach File'}
                    </button>
                    {uploadError && (
                        <div className="alert alert-error" style={{ width: '100%', margin: '4px 0 0', fontSize: 12 }}>
                            {uploadError}
                        </div>
                    )}
                    {uploadSuccess && (
                        <div className="alert alert-success" style={{ width: '100%', margin: '4px 0 0', fontSize: 12 }}>
                            {uploadSuccess}
                        </div>
                    )}
                </form>
            )}
        </div>
    );
}
