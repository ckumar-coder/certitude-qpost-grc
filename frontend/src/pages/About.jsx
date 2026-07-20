import { useEffect, useState } from 'react';
import { useT } from '../contexts/LanguageContext';

export default function About() {
    const t = useT();
    const [version, setVersion] = useState('');

    useEffect(() => {
        fetch('/api/version')
            .then((r) => r.json())
            .then((d) => setVersion(d.version || ''))
            .catch(() => {});
    }, []);

    return (
        <div className="card" style={{ maxWidth: 640, width: '100%' }}>
            <h2 style={{ marginTop: 0 }}>{t('about_title')}</h2>
            {version && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: -8 }}>
                    {t('about_version_label')} {version}
                </p>
            )}

            <p>{t('about_description')}</p>

            <h3>{t('about_built_heading')}</h3>
            <p>{t('about_built_body')}</p>

            <h3>{t('about_tech_heading')}</h3>
            <p>{t('about_tech_body')}</p>

            <hr style={{ margin: '24px 0', borderColor: 'var(--color-border)' }} />

            <h3 style={{ marginTop: 0 }}>{t('about_disclaimer_heading')}</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                {t('about_disclaimer_body')}
            </p>
        </div>
    );
}
