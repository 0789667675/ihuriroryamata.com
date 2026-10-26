'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Building2, Milk, Users } from 'lucide-react';
import { BrandLockup } from '@/components/brand-lockup';
import { TypingDisplay } from '@/components/ui/typing-display';
import { usePublicLanguage } from '@/hooks/use-public-language';
import type { PublicLanguage } from '@/lib/i18n/public-copy';

export default function WelcomePage({ copyrightYear }: { copyrightYear: number }) {
  const { language, setLanguage, t } = usePublicLanguage();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion ? false : { opacity: 0, y: 14 };

  // Short, distinct taglines that complement the headline without repeating copy
  const taglines = [
    t('welcomeTagline1'),
    t('welcomeTagline2'),
    t('welcomeTagline3'),
  ];

  const features = [
    { icon: Users, title: t('welcomeFeatureFarmersTitle'), body: t('welcomeFeatureFarmersBody') },
    { icon: Milk, title: t('welcomeFeatureMilkTitle'), body: t('welcomeFeatureMilkBody') },
    { icon: Building2, title: t('welcomeFeatureBusinessTitle'), body: t('welcomeFeatureBusinessBody') },
  ];

  const chooseLanguage = (nextLanguage: PublicLanguage) => setLanguage(nextLanguage);

  return (
    <main className="welcome-page">
      <motion.header
        className="welcome-header"
        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.2, 0, 0, 1] }}
      >
        <BrandLockup className="welcome-brand" imageSize={50} />
        <nav className="welcome-actions" aria-label={t('languageLabel')}>
          <div className="language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-pressed={language === 'rw'} onClick={() => chooseLanguage('rw')}>RW</button>
            <button type="button" aria-pressed={language === 'en'} onClick={() => chooseLanguage('en')}>EN</button>
          </div>
          <Link
            className={`welcome-login-link${pendingHref === '/login' ? ' is-navigating' : ''}`}
            href="/login"
            aria-busy={pendingHref === '/login'}
            onClick={() => setPendingHref('/login')}
          >
            {t('login')}
          </Link>
          <Link
            className={`button button-primary welcome-nav-cta${pendingHref === '/register' ? ' is-navigating' : ''}`}
            href="/register"
            aria-busy={pendingHref === '/register'}
            onClick={() => setPendingHref('/register')}
          >
            {t('register')}
          </Link>
        </nav>
      </motion.header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <motion.div
          className="welcome-copy"
          initial={reveal}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.2, 0, 0, 1] }}
        >
          <div className="welcome-tagline-kicker">
            <span className="eyebrow">{t('welcomeEyebrow')}</span>
            <span className="welcome-kicker-dot" aria-hidden="true">·</span>
            <TypingDisplay
              phrases={taglines}
              className="welcome-headline-typing"
              pauseDuration={3000}
              typingSpeed={40}
              eraseSpeed={20}
            />
          </div>
          <h1 id="welcome-title">{t('welcomeTitle')}</h1>
          <p className="welcome-description">{t('welcomeDescription')}</p>
          <div className="welcome-hero-actions">
            <Link
              className={`button button-primary welcome-main-cta${pendingHref === '/register' ? ' is-navigating' : ''}`}
              href="/register"
              aria-busy={pendingHref === '/register'}
              onClick={() => setPendingHref('/register')}
            >
              {t('welcomePrimary')}<ArrowRight size={18} />
            </Link>
            <Link
              className={`button button-secondary welcome-secondary-cta${pendingHref === '/login' ? ' is-navigating' : ''}`}
              href="/login"
              aria-busy={pendingHref === '/login'}
              onClick={() => setPendingHref('/login')}
            >
              {t('welcomeSecondary')}
            </Link>
          </div>
        </motion.div>
        <motion.div
          className="welcome-art"
          initial={reveal}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.08, ease: [0.2, 0, 0, 1] }}
        >
          <Image src="/brand-logo.png" width={1254} height={1254} sizes="(max-width: 680px) 72vw, (max-width: 1024px) 40vw, 440px" priority alt="" aria-hidden="true" />
        </motion.div>
      </section>

      <section className="welcome-features" aria-labelledby="welcome-features-title">
        <motion.h2
          id="welcome-features-title"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.2, 0, 0, 1] }}
        >
          {t('welcomeSectionTitle')}
        </motion.h2>
        <div className="welcome-feature-list">
          {features.map(({ icon: Icon, title, body }, index) => (
            <motion.article
              key={title}
              className="welcome-feature"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : index * 0.04 }}
            >
              <span className="welcome-feature-icon"><Icon size={21} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="welcome-roles" aria-labelledby="welcome-roles-title">
        <motion.h2
          id="welcome-roles-title"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.2, 0, 0, 1] }}
        >
          {t('welcomeRoleSectionTitle')}
        </motion.h2>
        <div className="welcome-role-grid">
          <motion.article
            className="welcome-role-card"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: reduceMotion ? 0 : 0.32 }}
          >
            <div className="welcome-role-header">
              <span className="welcome-role-badge">{t('collector')}</span>
              <h3>{t('welcomeRoleCollectorTitle')}</h3>
            </div>
            <p>{t('welcomeRoleCollectorBody')}</p>
            <Link className="welcome-role-action" href="/register">
              <span>{t('welcomePrimary')}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </motion.article>

          <motion.article
            className="welcome-role-card"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : 0.06 }}
          >
            <div className="welcome-role-header">
              <span className="welcome-role-badge">{t('collectionCenter')}</span>
              <h3>{t('welcomeRoleCenterTitle')}</h3>
            </div>
            <p>{t('welcomeRoleCenterBody')}</p>
            <Link className="welcome-role-action" href="/register">
              <span>{t('welcomePrimary')}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </motion.article>
        </div>
      </section>

      <motion.footer
        className="welcome-footer"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.2, 0, 0, 1] }}
      >
        <BrandLockup className="welcome-footer-brand" imageSize={36} />
        <p>{t('welcomeFooter')}</p>
        <div className="welcome-contact">
          <span>{t('copyright').replace('{year}', String(copyrightYear))}</span>
          <a href="mailto:snemeyimana@gmail.com">{t('contactLabel')}: snemeyimana@gmail.com</a>
        </div>
      </motion.footer>
    </main>
  );
}