'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, CheckCircle2, CircleAlert } from 'lucide-react';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

type VerificationState = 'checking' | 'success' | 'error';
type VerificationError = 'invalid' | 'unavailable' | 'missing';

export function EmailVerification() {
  const pathname = usePathname();
  const publicLanguage = usePublicLanguage();
  const [state, setState] = useState<VerificationState>('checking');
  const [errorKind, setErrorKind] = useState<VerificationError>('invalid');
  const attempted = useRef(false);
  const emailChange = pathname === '/verify-email-change';
  const title = emailChange
    ? publicLanguage.t('accountEmailVerificationTitle')
    : publicLanguage.t('registrationVerificationTitle');
  const message = state === 'success'
    ? (emailChange ? publicLanguage.t('accountEmailVerificationSuccess') : publicLanguage.t('registrationVerificationSuccess'))
    : state === 'checking'
      ? publicLanguage.t('verificationChecking')
      : errorKind === 'missing'
        ? publicLanguage.t('verificationMissingToken')
        : errorKind === 'unavailable'
          ? publicLanguage.t('resetUnavailable')
          : (emailChange ? publicLanguage.t('accountEmailVerificationInvalid') : publicLanguage.t('registrationVerificationInvalid'));

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const token = window.location.hash.replace(/^#/, '');
    if (!token) {
      setErrorKind('missing');
      setState('error');
      return;
    }
    const endpoint = emailChange ? '/api/auth/verify-email-change' : '/api/auth/email-verification/verify';
    void fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        setErrorKind(response.status >= 500 ? 'unavailable' : 'invalid');
        setState('error');
        return;
      }
      window.history.replaceState(null, '', pathname);
      setState('success');
    }).catch(() => {
      setErrorKind('unavailable');
      setState('error');
    });
    // This effect must run once for the token in the URL. Language changes only re-render the copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailChange, pathname]);

  return <main className="auth-layout">
    <section className="auth-brand">
      <BrandLockup className="auth-brand-lockup" imageSize={72} />
      <p className="eyebrow">{publicLanguage.t('registrationVerificationTitle')}</p>
      <h1>{title}</h1>
      <p className="auth-subtitle">{publicLanguage.t('registrationVerificationSuccess')}</p>
    </section>
    <section className="auth-panel">
      <div className="auth-panel-topbar">
        <Link className="auth-back-link auth-top-back-link" href="/">{publicLanguage.t('backToWelcome')}</Link>
        <div className="public-language-switch" role="group" aria-label={publicLanguage.t('languageLabel')}>
          <button type="button" aria-label={publicLanguage.t('languageKinyarwanda')} aria-pressed={publicLanguage.language === 'rw'} onClick={() => publicLanguage.setLanguage('rw')}>RW</button>
          <button type="button" aria-label={publicLanguage.t('languageEnglish')} aria-pressed={publicLanguage.language === 'en'} onClick={() => publicLanguage.setLanguage('en')}>EN</button>
        </div>
      </div>
      <div className="auth-heading">
        <span className="eyebrow">{emailChange ? publicLanguage.t('accountEmailVerificationTitle') : publicLanguage.t('registrationVerificationTitle')}</span>
        <h2>{title}</h2>
      </div>
      <div className={`verification-result verification-result-${state}`} role="status" aria-live="polite">
        {state === 'checking' ? <span className="loading-indicator" aria-hidden="true" /> : null}
        {state === 'success' ? <CheckCircle2 size={34} aria-hidden="true" /> : null}
        {state === 'error' ? <CircleAlert size={34} aria-hidden="true" /> : null}
        <p>{message}</p>
      </div>
      <div className="auth-navigation">
        {state === 'success' ? <Link className="button button-primary button-wide" href="/dashboard">{publicLanguage.t('goToDashboard')}<ArrowRight size={17} /></Link> : null}
        <Link className="text-button auth-switch" href="/login">{publicLanguage.t('returnToLogin')}</Link>
      </div>
    </section>
  </main>;
}
