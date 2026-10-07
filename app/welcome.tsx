'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Building2, Milk, Users } from 'lucide-react';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';
import type { PublicLanguage } from '@/lib/i18n/public-copy';

export default function WelcomePage({ copyrightYear }: { copyrightYear: number }) {
  const { language, setLanguage, t } = usePublicLanguage();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const navigationStarted = useRef(false);
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion ? false : { opacity: 0, y: 14 };
  const features = [
    { icon: Users, title: t('welcomeFeatureFarmersTitle'), body: t('welcomeFeatureFarmersBody') },
    { icon: Milk, title: t('welcomeFeatureMilkTitle'), body: t('welcomeFeatureMilkBody') },
    { icon: Building2, title: t('welcomeFeatureBusinessTitle'), body: t('welcomeFeatureBusinessBody') },
  ];

  const chooseLanguage = (nextLanguage: PublicLanguage) => setLanguage(nextLanguage);
  const navigate = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (navigationStarted.current) {
      event.preventDefault();
      return;
    }
    navigationStarted.current = true;
    setPendingHref(href);
  };

  return (
    <main className="welcome-page">
      <header className="welcome-header">
        <BrandLockup className="welcome-brand" imageSize={50} />
        <nav className="welcome-actions" aria-label={t('languageLabel')}>
          <div className="language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-pressed={language === 'rw'} onClick={() => chooseLanguage('rw')}>RW</button>
            <button type="button" aria-pressed={language === 'en'} onClick={() => chooseLanguage('en')}>EN</button>
          </div>
          <Link className={`welcome-login-link${pendingHref === '/login' ? ' is-navigating' : ''}`} href="/login" aria-busy={pendingHref === '/login'} onClick={navigate('/login')}>{t('login')}</Link>
          <Link className={`button button-primary welcome-nav-cta${pendingHref === '/register' ? ' is-navigating' : ''}`} href="/register" aria-busy={pendingHref === '/register'} onClick={navigate('/register')}>{t('register')}</Link>
        </nav>
      </header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <motion.div className="welcome-copy" initial={reveal} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.2, 0, 0, 1] }}>
          <p className="eyebrow">{t('welcomeEyebrow')}</p>
          <h1 id="welcome-title">{t('welcomeTitle')}</h1>
          <p className="welcome-description">{t('welcomeDescription')}</p>
          <div className="welcome-hero-actions">
            <Link className={`button button-primary welcome-main-cta${pendingHref === '/register' ? ' is-navigating' : ''}`} href="/register" aria-busy={pendingHref === '/register'} onClick={navigate('/register')}>{t('welcomePrimary')}<ArrowRight size={18} /></Link>
            <Link className={`button button-secondary welcome-secondary-cta${pendingHref === '/login' ? ' is-navigating' : ''}`} href="/login" aria-busy={pendingHref === '/login'} onClick={navigate('/login')}>{t('welcomeSecondary')}</Link>
          </div>
        </motion.div>
        <motion.div className="welcome-art" initial={reveal} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.08, ease: [0.2, 0, 0, 1] }}>
          <Image src="/brand-logo.png" width={1254} height={1254} sizes="(max-width: 680px) 72vw, (max-width: 1024px) 40vw, 440px" priority alt="" aria-hidden="true" />
        </motion.div>
      </section>

      <section className="welcome-features" aria-labelledby="welcome-features-title">
        <h2 id="welcome-features-title">{t('welcomeSectionTitle')}</h2>
        <div className="welcome-feature-list">
          {features.map(({ icon: Icon, title, body }, index) => (
            <motion.article key={title} className="welcome-feature" initial={reduceMotion ? false : { opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : index * 0.04 }}>
              <span className="welcome-feature-icon"><Icon size={21} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <footer className="welcome-footer">
        <BrandLockup className="welcome-footer-brand" imageSize={36} />
        <p>{t('welcomeFooter')}</p>
        <div className="welcome-contact"><span>{t('copyright').replace('{year}', String(copyrightYear))}</span><a href="mailto:snemeyimana@gmail.com">{t('contactLabel')}: snemeyimana@gmail.com</a></div>
      </footer>
    </main>
  );
}