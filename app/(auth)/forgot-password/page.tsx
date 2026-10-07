'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Eye, EyeOff } from 'lucide-react';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

type Stage = 'email' | 'code' | 'password' | 'success';

const postJson = async (path: string, body: Record<string, string>) => {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || ''), { code: result.code });
};

export default function ForgotPasswordPage() {
  const { language, setLanguage, t } = usePublicLanguage();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (stage === 'email') {
        await postJson('/api/auth/password-reset/request', { email, language });
        setNotice(t('resetEmailInstructions'));
        setStage('code');
      } else if (stage === 'code') {
        await postJson('/api/auth/password-reset/verify', { email, code });
        setStage('password');
      } else if (stage === 'password') {
        if (password !== confirmPassword) {
          setError(t('passwordMismatch'));
          return;
        }
        await postJson('/api/auth/password-reset', { password });
        setStage('success');
      }
    } catch (reason) {
      const failure = reason as Error & { code?: string };
      setError(failure.code === 'INVALID_RESET_CODE' ? t('resetCodeInvalid')
        : failure.code === 'INVALID_PASSWORD' ? failure.message
          : t('resetUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await postJson('/api/auth/password-reset/request', { email, language });
      setNotice(t('resetEmailInstructions'));
      setCode('');
    } catch {
      setError(t('resetUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  const stageTitle = stage === 'email' ? t('forgotTitle')
    : stage === 'code' ? t('resetCodeLabel')
      : stage === 'password' ? t('newPassword') : t('resetSuccessTitle');

  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <BrandLockup className="auth-brand-lockup" imageSize={46} />
        <p className="eyebrow">{t('forgotEyebrow')}</p>
        <h1>{t('forgotTitle')}</h1>
        <p className="auth-subtitle">{t('forgotDescription')}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-topbar">
          <Link className="auth-back-link auth-top-back-link" href="/">{t('backToWelcome')}</Link>
          <div className="public-language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-label={t('languageKinyarwanda')} aria-pressed={language === 'rw'} onClick={() => setLanguage('rw')}>RW</button>
            <button type="button" aria-label={t('languageEnglish')} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </div>
        {stage === 'success' ? (
          <div className="auth-reset-success" role="status">
            <span className="auth-reset-success-icon"><Check size={22} aria-hidden="true" /></span>
            <h2>{t('resetSuccessTitle')}</h2>
            <p>{t('resetSuccessDescription')}</p>
            <Link className="button button-primary button-wide" href="/login">{t('returnToLogin')}<ArrowRight size={17} /></Link>
          </div>
        ) : (
          <>
            <div className="auth-heading">
              <span className="eyebrow">{t('forgotEyebrow')}</span>
              <h2>{stageTitle}</h2>
            </div>
            <form onSubmit={submit} className="form-stack auth-reset-form">
              {stage === 'email' ? (
                <>
                  <p className="auth-subtitle">{t('forgotDescription')}</p>
                  <label>{t('email')}<input type="email" autoComplete="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                </>
              ) : null}
              {stage === 'code' ? (
                <>
                  <p className="auth-subtitle">{t('resetCodeDescription')}</p>
                  <label htmlFor="reset-code">{t('resetCodeLabel')}
                    <input id="reset-code" className="auth-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                  </label>
                  <div className="auth-reset-actions">
                    <button className="text-button" type="button" disabled={busy} onClick={resendCode}>{t('resendResetCode')}</button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => { setStage('email'); setError(''); setNotice(''); }}>{t('backToEmail')}</button>
                  </div>
                </>
              ) : null}
              {stage === 'password' ? (
                <>
                  <label>{t('newPassword')}<span className="password-field"><input type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={passwordVisible ? t('hidePassword') : t('showPassword')} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
                  <label>{t('confirmPassword')}<span className="password-field"><input type={confirmVisible ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={confirmVisible ? t('hidePassword') : t('showPassword')} aria-pressed={confirmVisible} onClick={() => setConfirmVisible((visible) => !visible)}>{confirmVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
                </>
              ) : null}
              <p className="auth-feedback form-error" role="alert" aria-live="polite">{error}</p>
              {notice ? <p className="auth-feedback auth-success" role="status">{notice}</p> : null}
              <button className="button button-primary button-wide" disabled={busy || (stage === 'code' && code.length !== 6)}>
                {busy ? t('wait') : stage === 'email' ? t('requestResetCode') : stage === 'code' ? t('verifyResetCode') : t('updatePassword')}
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="auth-navigation">
              <Link className="text-button auth-switch" href="/login">{t('returnToLogin')}</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}