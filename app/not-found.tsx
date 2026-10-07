'use client';

import Link from 'next/link';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

export default function NotFoundPage() {
  const { t } = usePublicLanguage();
  return (
    <main className="status-page">
      <BrandLockup imageSize={46} />
      <section className="status-panel">
        <p className="eyebrow">404</p>
        <h1>{t('pageNotFound')}</h1>
        <p className="status-description">{t('pageNotFoundDescription')}</p>
        <Link href="/" className="button button-primary">{t('returnHome')}</Link>
      </section>
    </main>
  );
}
