'use client';

import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = usePublicLanguage();
  return (
    <main className="status-page">
      <BrandLockup imageSize={46} />
      <section className="status-panel status-panel-error" role="alert">
        <p className="eyebrow">{t('errorTitle')}</p>
        <h1>{t('errorTitle')}</h1>
        <p className="status-description">{error.message}</p>
        <button type="button" className="button button-primary" onClick={() => reset()}>{t('tryAgain')}</button>
      </section>
    </main>
  );
}
