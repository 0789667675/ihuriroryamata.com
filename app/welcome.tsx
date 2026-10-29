'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, FileBarChart2, Milk, Sparkles, Users } from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { usePublicLanguage } from '@/hooks/use-public-language';
import type { PublicLanguage } from '@/lib/i18n/public-copy';

export default function WelcomePage({ copyrightYear }: { copyrightYear: number }) {
  const { language, setLanguage, t } = usePublicLanguage();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion ? false : { opacity: 0, y: 14 };

  const chooseLanguage = (nextLanguage: PublicLanguage) => setLanguage(nextLanguage);

  return (
    <main className="welcome-page">
      {/* Top Navbar: Single Sleek Row (Zero Wrapping) */}
      <motion.header
        className="welcome-header welcome-nav"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
      >
        <Link href="/" className="welcome-brand-link">
          <Image
            src="/brand-logo.png"
            width={34}
            height={34}
            className="welcome-brand-logo"
            alt="IHURIRO RY'AMATA"
            priority
            style={{ borderRadius: '50%', objectFit: 'cover' }}
          />
          <span className="welcome-brand-title">
            IHURIRO RY&apos;AMATA
          </span>
        </Link>
        <nav className="welcome-nav-actions welcome-actions" aria-label={t('languageLabel')}>
          <div className="language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-pressed={language === 'rw'} onClick={() => chooseLanguage('rw')}>RW</button>
            <button type="button" aria-pressed={language === 'en'} onClick={() => chooseLanguage('en')}>EN</button>
          </div>
          <Link
            className={`welcome-login-link button button-secondary${pendingHref === '/login' ? ' is-navigating' : ''}`}
            href="/login"
            aria-busy={pendingHref === '/login'}
            onClick={() => setPendingHref('/login')}
          >
            {language === 'en' ? 'Sign In' : 'Injira'}
          </Link>
          <Link
            className={`button button-primary welcome-nav-cta${pendingHref === '/register' ? ' is-navigating' : ''}`}
            href="/register"
            aria-busy={pendingHref === '/register'}
            onClick={() => setPendingHref('/register')}
          >
            {language === 'en' ? 'Open Account' : 'Fungura Konti'}
          </Link>
        </nav>
      </motion.header>

      {/* Hero Section: Text First, Side-by-Side on Desktop, Below Buttons on Mobile */}
      <section className="welcome-hero" aria-labelledby="welcome-title">
        <motion.div
          className="welcome-copy"
          initial={reveal}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.2, 0, 0, 1] }}
        >
          {/* Eyebrow badge */}
          <div className="welcome-hero-pill-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(22, 129, 171, 0.08)', border: '1px solid rgba(22, 129, 171, 0.2)', color: '#1681ab', fontSize: '0.8125rem', fontWeight: 600, marginBottom: 14 }}>
            <Sparkles size={14} aria-hidden="true" />
            <span>{language === 'en' ? "Rwanda's Trusted Milk Collection System" : "Sisitemu Yizewe y'Ikusanyirizo ry'Amata mu Rwanda"}</span>
          </div>

          <h1 id="welcome-title" className="welcome-headline">
            {language === 'en' ? 'Balanced Monthly Accounting, Zero Loss.' : 'Ibaruramari ry’Ukwezi Rihuye, Nta Rihombo.'}
          </h1>

          <p className="welcome-description">
            {language === 'en'
              ? "Unify farmers, daily milk collections, and accounting for collectors and collection centers in one seamless, trusted platform."
              : "Huza aborozi, ikusanya ry'amata rya buri munsi, n'ibaruramari ry'abacunda n'ibigo by'ikusanyirizo ahantu hamwe ku buryo bworoshye kandi bwizewe."}
          </p>

          <div className="welcome-hero-actions">
            <Link
              className={`button button-primary welcome-main-cta${pendingHref === '/register' ? ' is-navigating' : ''}`}
              href="/register"
              aria-busy={pendingHref === '/register'}
              onClick={() => setPendingHref('/register')}
            >
              <span>{language === 'en' ? 'Start Free Trial' : "Fungura Konti y'Ubuntu"}</span>
              <ArrowRight size={17} />
            </Link>
            <Link
              className={`button button-secondary welcome-secondary-cta${pendingHref === '/login' ? ' is-navigating' : ''}`}
              href="/login"
              aria-busy={pendingHref === '/login'}
              onClick={() => setPendingHref('/login')}
            >
              <span>{language === 'en' ? 'Sign In to Your Account' : 'Injira muri Konti'}</span>
            </Link>
          </div>

          {/* Cow illustration on Mobile (Hidden on mobile via CSS so buttons connect directly to metrics) */}
          <div className="welcome-mobile-cow-badge welcome-hero-illustration welcome-illustration-card hero-visual" aria-hidden="true">
            <Image
              src="/brand-logo.png"
              width={140}
              height={140}
              alt=""
              className="welcome-mobile-cow-img"
            />
          </div>

          {/* Compact Proof Metrics Strip */}
          <div className="welcome-hero-metrics metrics-strip welcome-metrics">
            <div className="welcome-metric-item">
              <span className="welcome-metric-number">
                <AnimatedCounter value={1200} />+
              </span>
              <span className="welcome-metric-label">{language === 'en' ? 'Active Farmers' : 'Aborozi Banditswe'}</span>
            </div>
            <div className="welcome-metric-item">
              <span className="welcome-metric-number">
                <AnimatedCounter value={850000} formatter={(n) => n.toLocaleString()} />+
              </span>
              <span className="welcome-metric-label">{language === 'en' ? 'Liters Handled' : "Litiro z'Amata"}</span>
            </div>
            <div className="welcome-metric-item">
              <span className="welcome-metric-number">100%</span>
              <span className="welcome-metric-label">{language === 'en' ? 'Audit Accuracy' : "Igenzura ry'Imibare"}</span>
            </div>
            <div className="welcome-metric-item">
              <span className="welcome-metric-number">99.9%</span>
              <span className="welcome-metric-label">{language === 'en' ? 'System Reliability' : 'Ubwizerwe bwa Sisitemu'}</span>
            </div>
          </div>
        </motion.div>

        {/* Desktop Side-by-Side Cow Illustration */}
        <motion.div
          className="welcome-art desktop-hero-art"
          initial={reveal}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.08, ease: [0.2, 0, 0, 1] }}
        >
          <Image
            src="/brand-logo.png"
            width={440}
            height={440}
            sizes="(max-width: 1024px) 40vw, 440px"
            priority
            alt="Milk System Logo"
            aria-hidden="true"
            className="welcome-art-img"
          />
        </motion.div>
      </section>

      {/* Feature Highlights Grid - Compact 3 Modern Floating Cards */}
      <section className="welcome-features" aria-labelledby="welcome-features-title">
        <div className="welcome-features-header">
          <span className="welcome-features-subtitle">
            {language === 'en' ? 'CORE SERVICES' : "SERIVISI Z'INGENZI"}
          </span>
          <h2 id="welcome-features-title" className="welcome-features-title">
            {language === 'en' ? 'Daily Operations in One Unified Hub' : "Ibikorwa bya buri munsi, ahantu hamwe"}
          </h2>
        </div>
        <div className="welcome-feature-list">
          <motion.article
            className="welcome-feature-card"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: reduceMotion ? 0 : 0.32 }}
          >
            <div className="welcome-feature-icon-box">
              <Users size={20} aria-hidden="true" />
            </div>
            <h3>{language === 'en' ? 'Farmers & Collection Centers' : "Aborozi n'ibigo by'ikusanyirizo"}</h3>
            <p>
              {language === 'en'
                ? "Manage verified farmer profiles, operational collection sites, and linked collection centers with ease."
                : "Genzura amakuru y'aborozi, aho bakorera n'ibigo by'ikusanyirizo bahuzwa na byo mu buryo bwizewe."}
            </p>
          </motion.article>

          <motion.article
            className="welcome-feature-card"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : 0.05 }}
          >
            <div className="welcome-feature-icon-box">
              <Milk size={20} aria-hidden="true" />
            </div>
            <h3>{language === 'en' ? 'Daily Milk Collection' : "Ikusanya ry'amata"}</h3>
            <p>
              {language === 'en'
                ? "Record morning and evening milk intake instantly via OCR notebook scanning or smart fast entry."
                : "Andika ikusanya ry'amata ryo mu gitondo na nimugoroba, ukoresheje ikoranabuhanga rya OCR cyangwa intoki."}
            </p>
          </motion.article>

          <motion.article
            className="welcome-feature-card"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : 0.1 }}
          >
            <div className="welcome-feature-icon-box">
              <FileBarChart2 size={20} aria-hidden="true" />
            </div>
            <h3>{language === 'en' ? 'Reports & Accounting' : "Raporo n'ibaruramari"}</h3>
            <p>
              {language === 'en'
                ? "Review balanced monthly reports, transport deductions, net farmer balances, and bank-ready exports."
                : "Reba raporo, ibaruramari ry'ukwezi rihuye, ubwikorezi, ibyakuweho, n'ubwishyu bwa banki mu buryo bworoshye."}
            </p>
          </motion.article>
        </div>
      </section>

      {/* 15-Day Free Trial Showcase Banner */}
      <section className="welcome-trial-banner" aria-labelledby="welcome-trial-title">
        <motion.div
          className="welcome-trial-card"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: reduceMotion ? 0 : 0.35 }}
        >
          <div className="welcome-trial-eyebrow">
            <span role="img" aria-label="gift">🎁</span>
            <span>{language === 'en' ? '15 Days Free Trial' : "Iminsi 15 y'Ubuntu"}</span>
          </div>
          <h2 id="welcome-trial-title" className="welcome-trial-headline">
            {language === 'en'
              ? 'Start Using Milk System for Free'
              : 'Tangira Gukoresha Milk System ku Buntu'}
          </h2>
          <p className="welcome-trial-subtitle">
            {language === 'en'
              ? 'Use the system for the first 15 days at zero cost. During these 15 days, the system measures your actual milk intake, and on day 16 recommends your exact subscription tier based on real production.'
              : 'Koresha sisitemu mu minsi 15 ya mbere nta kiguzi. Mu gihe cy’iminsi 15, sisitemu izagenda ibara litiro z’amata wakiriye, maze ku munsi wa 16 ikwereke igipimo nyacyo cy’ifatabuguzi rikubereye ukurikije umusaruro wawe.'}
          </p>
          <div className="welcome-trial-actions">
            <Link
              href="/register"
              className="button button-primary welcome-trial-cta"
            >
              <span>{language === 'en' ? 'Start Free Trial' : "Fungura Konti y'Ubuntu"}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* User Personas Section */}
      <section className="welcome-roles" aria-labelledby="welcome-roles-title">
        <motion.h2
          id="welcome-roles-title"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.2, 0, 0, 1] }}
        >
          {language === 'en' ? 'How the System Empowers Users' : "Icyo sisitemu ifasha abakoresha bayo"}
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
              <span className="welcome-role-badge">{language === 'en' ? 'For Collectors' : 'Ku Bacunda'}</span>
              <h3>{t('welcomeRoleCollectorTitle')}</h3>
            </div>
            <p>{t('welcomeRoleCollectorBody')}</p>
            <Link className="welcome-role-action button button-secondary" href="/register?type=COLLECTOR">
              <span>{language === 'en' ? 'Open Account' : 'Fungura konti'}</span>
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
              <span className="welcome-role-badge">{language === 'en' ? 'For Collection Centers' : "Ku Bigo by’Ikusanyirizo"}</span>
              <h3>{t('welcomeRoleCenterTitle')}</h3>
            </div>
            <p>{t('welcomeRoleCenterBody')}</p>
            <Link className="welcome-role-action button button-primary" href="/register?type=COLLECTION_CENTER">
              <span>{language === 'en' ? 'Open Center' : 'Fungura ikigo'}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </motion.article>
        </div>
      </section>

      {/* Minimalist Footer */}
      <motion.footer
        className="welcome-footer"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.2, 0, 0, 1] }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
          <Image src="/brand-logo.png" width={32} height={32} alt="" aria-hidden="true" style={{ borderRadius: '50%', objectFit: 'cover' }} />
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#112430' }}>
            IHURIRO RY&apos;AMATA (Milk System)
          </h3>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: '0.875rem', color: '#637782' }}>
          {language === 'en'
            ? "Milk collection management and collector accounting."
            : "Gucunga ikusanya ry'amata n'ibaruramari ry'abacunda."}
        </p>
        <div className="welcome-contact">
          <span>© {copyrightYear} Milk System Technologies Ltd.</span>
          <a href="mailto:snemeyimana@gmail.com" className="welcome-contact-email">
            Twandikire: snemeyimana@gmail.com
          </a>
        </div>
      </motion.footer>
    </main>
  );
}
