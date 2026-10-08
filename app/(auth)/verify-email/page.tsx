'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

export default function VerifyRegistrationEmailPage() {
  const { t } = usePublicLanguage();
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    const token = window.location.hash.slice(1);
    if (!token) {
      setState('error');
      return;
    }
    fetch('/api/auth/email-verification/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) throw new Error('Email verification failed.');
      window.history.replaceState(null, '', window.location.pathname);
      setState('success');
    }).catch(() => setState('error'));
  }, []);

  const message = state === 'loading' ? t('wait')
    : state === 'success' ? t('registrationVerificationSuccess')
      : t('registrationVerificationInvalid');

  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <BrandLockup className="auth-brand-lockup" imageSize={46} />
        <p className="eyebrow">{t('accountSecurity')}</p>
        <h1>{t('registrationVerificationTitle')}</h1>
        <p className="auth-subtitle">{message}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-reset-success" role={state === 'error' ? 'alert' : 'status'}>
          <span className={`auth-reset-success-icon${state === 'error' ? ' auth-reset-error-icon' : ''}`}>
            {state === 'error' ? <X size={22} aria-hidden="true" /> : <Check size={22} aria-hidden="true" />}
          </span>
          <h2>{t('registrationVerificationTitle')}</h2>
          <p>{message}</p>
          {state !== 'loading' ? <Link className="button button-primary button-wide" href="/login">{t('returnToLogin')}<ArrowRight size={17} /></Link> : null}
        </div>
      </section>
    </main>
  );
}