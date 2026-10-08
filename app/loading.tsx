'use client';

import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

export default function LoadingState() {
  const { t } = usePublicLanguage();
  return (
    <main className="boot-screen">
      <BrandLockup imageSize={52} />
      <small className="boot-company">Milk System Technologies Ltd.</small>
      <div className="loading-status" role="status" aria-live="polite">
        <span className="loading-indicator" aria-hidden="true" />
        <span>{t('loading')}</span>
      </div>
    </main>
  );
}
