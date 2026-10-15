'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity, ArrowRight, Bell, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff,
  ArrowDown, ArrowUp, ArrowUpDown, CircleDollarSign, ClipboardList, FileBarChart2, LogOut, Milk, Plus, Search, Settings, Shield,
  UserRound, Users, X, ArrowUpRight, Wallet, CalendarDays, BookOpen, Truck,
} from 'lucide-react';
import { flushOfflineWrites, getOfflineWrites, queueOfflineWrite } from '@/lib/offline-queue';
import { buildFarmerListQuery } from '@/lib/farmer-list-query';
import { BrandLockup } from '@/components/brand-lockup';
import { Modal } from '@/components/ui/modal';
import { usePublicLanguage } from '@/hooks/use-public-language';
import { formatDateLabel, getMonthNames } from '@/lib/i18n/date-format';

type User = { id: number; name: string; email: string; role: string; accountType: string };
type AccountProfile = { id: number; name: string; email: string; phone: string | null; nationalId: string | null; accountNumber: string | null; profilePicture: string | null; role: string; accountType: string; accountStatus: string; emailVerified: boolean };
type Farmer = { id: number; name: string; location: string | null; phone: string | null; nationalId: string | null; accountNumber: string | null; collectionCenter: string | null; cowType: string | null; collectorUserId?: number | null };
type Center = { id: number; name: string; owner_user_id?: number; pricePerLiter: number; transportRatePerLiter: number; morning_start: string; morning_end: string; evening_start: string; evening_end: string };
type Page<T> = { data: T[]; nextCursor: string | null; hasMore: boolean; pageSize: number };
type DailyRow = { farmerId: number; farmerName: string; phone?: string; nationalId?: string; collectionCenter?: string | null; recordId?: number; volumeMorning: number; volumeEvening: number; totalVolume: number; volumeLiters?: number; amount: number; status?: string; abacundaCount?: number; presentCount?: number };
type CollectorMilkEntry = { id: number; date: string; volumeLiters: number; pricePerLiter: number; status: string; effectiveVolumeLiters: number };
type CollectorMilkPrice = { id: number; pricePerLiter: number; effectiveDate: string };
type OwnerIfishiEntry = { id: number | null; date: string; volumeMorning: number; volumeEvening: number; volumeLiters: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; pricePerLiter: number | null; grossAmount: number | null; assignedFarmerLiters: number; surplusLiters: number; status: string; adjustmentReason: string | null; adjustedAt: string | null };
type OwnerIfishiHistory = { owner: { name: string }; startDate: string; endDate: string; entries: OwnerIfishiEntry[]; totals: { originalVolumeLiters: number; ownerVolumeLiters: number; lostVolumeLiters: number; ownerMilkGross: number | null; ownerMilkValueComplete: boolean; assignedFarmerLiters: number; surplusLiters: number } };
type MilkRecord = { id: number; farmer_id: number; owner_user_id: number; date: string; volumeMorning: number; volumeEvening: number; volume: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; originalAmount: number; validAmount: number; amount: number; pricePerLiter: number; status: string; adjustmentReason: string | null; adjustedBy: number | null; adjustedAt: string | null; collectionCenter?: string | null };
type Notice = { id: number; title: string; message: string; notification_type: string; isRead: boolean; createdAt: string };
type ReportFarmerRow = { farmerId: number; farmerName: string; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; originalVolume?: number; lostVolume?: number; pricePerLiter?: number; grossAmount: number; totalTransport: number | null; transportIsComplete?: boolean; totalDeductions: number; ifishiTotalDeductions?: number; ifishiNetAmount?: number | null; netAmount: number | null };
type ReportOwnerRow = { farmerId: null; farmerName: string; name: string; isOwner: true; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; pricePerLiter: number | null; grossAmount: number | null; totalTransport: number | null; totalDeductions: number; farmerPayable?: number; netAmount: number | null };
type CollectorSettlementFields = { collectorFarmerMilkValue?: number | null; collectorFarmerPayable?: number | null; collectorAccountingComplete?: boolean | null; collectorAccountingMissingInputs?: string[] };
type SettlementAccounting = { farmerGross: number | null; expectedFarmerPayable: number; saccoEligiblePayable: number; saccoDistributionInstruction: number; saccoConfirmedAmount: number; retainedUnpaidAmount: number; cashApprovedAmount: number; cashConfirmedAmount: number; debtRepaymentAmount: number; outstandingDebt: number | null; legacyUnallocatedDebtRepayments: number; debtBalancesComplete: boolean; unexplainedDiscrepancy: number; ownerGrossReconciliation: { ownerGross: number | null; farmerGross: number | null; surplus: number | null; discrepancy: number | null }; farmers: Array<ReportFarmerRow & { settlement: { saccoEligible: boolean; saccoDistributionInstruction: number; cashApprovedAmount: number; cashConfirmedAmount: number; debtRepaymentAmount: number; outstandingDebt: number | null; retainedUnpaidAmount: number; unexplainedDiscrepancy: number | null } }> };
type Report = { totalFarmers: number; totalVolume: number; totalMorning: number; totalEvening: number; totalRevenueMonth: number; ownerGeneratedGross?: number | null; ownerGeneratedVolume?: number; totalDeductionsMonth: number; totalTransportFeesMonth: number; netRevenueMonth: number; todayTotal: number; todayMorning: number; todayEvening: number; rangeStart: string; rangeEnd: string; collectorPayable: number | null; collectorGross?: number | null; collectorActualVolume?: number; collectorOriginalVolume?: number; collectorLostVolume?: number; collectorFarmersValidLiters?: number; collectorTotalFarmersPayable?: number; collectorFarmerDeductions?: number; collectorFarmerTransport?: number; collectorSurplusAmount?: number | null; collectorPayableFromBreakdown?: number | null; collectorIsReconciled?: boolean | null; collectorProfile?: { name: string } | null; collectorEntries?: Array<{ id: number; date: string; status: string; volumeLiters: number; effectiveVolumeLiters: number; farmerLostLiters: number; voidReason?: string | null; voidedBy?: number | null; voidedAt?: string | null }>; milkLossRecords?: Array<{ id: number; farmerId: number; farmerName: string; date: string; status: string; originalVolume: number; validVolume: number; lostVolume: number; reason: string | null; adjustedBy: number | null; adjustedAt: string | null }>; collectorSettlementRows?: any[]; ownerSettlementRow?: ReportOwnerRow | null; farmerPayments: ReportFarmerRow[]; settlementAccounting?: SettlementAccounting | null; settlementAccountingStatus?: 'AVAILABLE' | 'MIGRATION_REQUIRED' | null };
type Account = { user_id: number; account_name: string; account_email: string; account_type: string; account_status: string; effective_status: string; farmer_count: number; center_count: number };
type AdminAccountDetails = { account: { id: number; name: string; email: string; account_type: string; account_status: string; email_verified: boolean; phone: string | null; created_at: string }; subscription: { status: string; plan_id: number | null; current_price: number | string | null; currency: string | null; tier_code: string | null; access_started_at: string | null; payment_due_at: string | null; subscription_started_at: string | null; subscription_ends_at: string | null } | null; counts: { centers: number; farmers: number; milk_records: number; deductions: number; payments: number; notifications: number } };
type AdminPaymentSummary = { successfulCount: number; successfulAmount: number; pendingCount: number; failedCount: number; cancelledCount: number; expiredCount: number };
type AdminSummary = { accounts: { total_accounts: number; without_subscription: number; not_approved: number; pending: number; active: number; suspended: number; expired: number }; registrations_last_30_days: number };
type SystemHealth = { ok: boolean; service: string; database: { configured: boolean; provider: string; connected: boolean }; supabase: { configured: boolean; url: string | null }; migrated: boolean };
type SubscriptionPlan = { id: number; code: string; name: string; price: number | string; currency: string; billing_period: string; min_volume_liters: number | string | null; max_volume_liters: number | string | null; is_active: boolean };
type CollectorTierEdit = { name: string; price: string; minVolumeLiters: string; maxVolumeLiters: string; isActive: boolean };
type SubscriptionPolicy = { initial_access_days: number; grace_period_days: number; enforcement_time: string; time_zone: string };
type RegistrationConfiguration = { plans: SubscriptionPlan[]; policy: SubscriptionPolicy };
type PaymentConfiguration = { provider: string; paymentMethod: string; displayName: string; currency: string; payerAccount: string; payerPhoneSource: string; realPaymentsEnabled: boolean; credentialsConfigured: boolean; apiConfigured: boolean; callbackConfigured: boolean; ready: boolean };
type AdminPayment = { id: number; account_name: string; account_email: string; subscription_status: string; plan_name: string | null; plan_code: string | null; amount: number; currency: string; status: string; payment_method: string; provider: string | null; billing_period: string; provider_reference: string; provider_transaction_id: string | null; mobile_money_phone: string | null; created_at: string; completed_at: string | null };
type CollectorAssignment = { id: number; collector_user_id: number; collector_name: string; collector_account_number: string | null; collector_national_id: string | null; collector_phone: string | null; abacunda_count: number };
type AbacundaIfishiEntry = { date: string; morningLiters: number; eveningLiters: number; originalLiters: number; validLiters: number; lostLiters: number; status: string; reason: string | null };
type AbacundaIfishiHistory = { startDate: string; endDate: string; entries: AbacundaIfishiEntry[]; totals: Omit<AbacundaIfishiEntry, 'date' | 'status' | 'reason'>; collector: { id: number; name: string } };

type Tab = 'dashboard' | 'farmers' | 'centers' | 'milk' | 'deductions' | 'transport' | 'ukwezi' | 'settlements' | 'reports' | 'billing' | 'notifications' | 'settings' | 'accounts' | 'audit' | 'config' | 'system-health' | 'notifications-admin';
type SettlementRecord = { id: number; settlementId?: number; farmer_id?: number; farmerId?: number; farmer_name?: string; farmerName?: string; amount: number; status: string; period_start?: string; period_end?: string; periodStart?: string; periodEnd?: string; payment_method?: string; paymentMethod?: string };
type SettlementData = { ok: boolean; periodStart: string; periodEnd: string; summary?: { retainedCount: number; retainedAmount: number; approvedCount: number }; retained?: Array<ReportFarmerRow & { retainedAmount: number }>; records?: SettlementRecord[]; data?: SettlementRecord[] };

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.message || `Request failed (${response.status})`), { status: response.status });
  }
  return body as T;
};
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const MtnMoMoBrand = ({ compact = false }: { compact?: boolean }) => <span className={`mtn-momo-brand${compact ? ' compact' : ''}`} role="img" aria-label="MTN MoMo Rwanda">
  <span className="mtn-momo-mark" aria-hidden="true">MTN</span>
  <span className="mtn-momo-wordmark"><b>MoMo</b><small>Rwanda</small></span>
</span>;
const today = () => new Date().toISOString().slice(0, 10);
const getMonthBounds = (monthValue: string) => {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(year, month, 0).getDate();
  return { startDate: `${yearText}-${monthText}-01`, endDate: `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}` };
};
const getSettlementPeriodBounds = (monthValue: string, half: 'first-half' | 'second-half') => {
  const monthBounds = getMonthBounds(monthValue);
  return half === 'first-half'
    ? { startDate: monthBounds.startDate, endDate: `${monthValue}-15` }
    : { startDate: `${monthValue}-16`, endDate: monthBounds.endDate };
};
const money = (value: number | null | undefined) => value === null || value === undefined
  ? '—'
  : new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 0 }).format(Number(value || 0));
const liters = (value: number) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 2 }).format(Number(value || 0));
const isCollectorTier = (plan: SubscriptionPlan) => plan.code.startsWith('USAGE_');

const collectorTabs: Array<{ id: Tab; label: string; icon: typeof Milk }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'farmers', label: 'Farmers', icon: Users },
  { id: 'milk', label: 'Milk', icon: Milk },
  { id: 'deductions', label: 'Deductions', icon: CircleDollarSign },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'ukwezi', label: 'Ukwezi', icon: Wallet },
  { id: 'settlements', label: 'Settlements', icon: CircleDollarSign },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const dairyTabs: Array<{ id: Tab; label: string; icon: typeof Milk }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'farmers', label: 'Abacunda', icon: Users },
  { id: 'milk', label: 'Milk', icon: Milk },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'ukwezi', label: 'Ukwezi', icon: Wallet },
  { id: 'settlements', label: 'Settlements', icon: CircleDollarSign },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const navigationCopy = {
  dashboard: 'navDashboard', farmers: 'navFarmers', centers: 'navCenters', milk: 'navMilk',
  deductions: 'navDeductions', transport: 'navTransport', ukwezi: 'navUkwezi', settlements: 'navSettlements', reports: 'navReports', billing: 'navSubscription', notifications: 'navAlerts', settings: 'navSettings',
  accounts: 'navAccounts', audit: 'navAudit', config: 'navPricing', subscriptions: 'navSubscriptions', 'system-health': 'systemHealth', 'notifications-admin': 'navAdminAlerts',
} as const;

const accountStatusCopy = {
  not_approved: 'statusNotApproved',
  pending: 'statusPending',
  active: 'statusActive',
  suspended: 'statusSuspended',
  expired: 'statusExpired',
  none: 'statusNone',
} as const;
const subscriptionStatusCopy = {
  pending: 'statusPending',
  trial: 'statusPending',
  active: 'statusActive',
  suspended: 'statusSuspended',
  expired: 'statusExpired',
  cancelled: 'statusExpired',
} as const;

type PublicLanguageState = ReturnType<typeof usePublicLanguage>;

function Login({ onLogin, language, setLanguage, t }: { onLogin: (user: User) => void } & PublicLanguageState) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forgotPassword = pathname === '/forgot-password';
  const registering = pathname === '/register' || searchParams?.get('mode') === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('COLLECTOR');
  const [registrationPlans, setRegistrationPlans] = useState<SubscriptionPlan[]>([]);
  const [registrationAccessDays, setRegistrationAccessDays] = useState(15);
  const [registrationPlansLoading, setRegistrationPlansLoading] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState('');
  const [resetStep, setResetStep] = useState<'request' | 'verify' | 'password' | 'complete'>('request');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!registering || accountType !== 'COLLECTOR') return;
    let mounted = true;
    setRegistrationPlansLoading(true);
    api<RegistrationConfiguration>('/api/subscription/plans', { cache: 'no-store' }).then((config) => {
      if (mounted) {
        setRegistrationPlans(config.plans);
        setRegistrationAccessDays(config.policy.initial_access_days);
      }
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : 'Subscription pricing is unavailable.');
    }).finally(() => {
      if (mounted) setRegistrationPlansLoading(false);
    });
    return () => { mounted = false; };
  }, [registering, accountType]);

  const requestResetCode = async () => {
    setBusy(true);
    setError('');
    setResetMessage('');
    try {
      await api('/api/auth/password-reset/request', json('POST', { email, language }));
      setResetStep('verify');
      setResetMessage(t('resetEmailInstructions'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('resetUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  const submitResetRequest = (event: React.FormEvent) => {
    event.preventDefault();
    void requestResetCode();
  };

  const submitResetCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResetMessage('');
    try {
      await api('/api/auth/password-reset/verify', json('POST', { email, code: resetCode }));
      setResetStep('password');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('resetCodeInvalid'));
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    setBusy(true);
    setError('');
    setResetMessage('');
    try {
      await api('/api/auth/password-reset', json('POST', { password: newPassword }));
      setResetStep('complete');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('resetUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (registering) {
        await api('/api/auth/register', json('POST', { name, email, password, accountType, selectedPlanCode, language }));
      }
      const result = await api<{ user: User }>('/api/auth/login', json('POST', { email, password }));
      onLogin(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <BrandLockup className="auth-brand-lockup" imageSize={72} />
        <p className="eyebrow">{forgotPassword ? t('forgotEyebrow') : t('loginEyebrow')}</p>
        <h1>{forgotPassword ? t('forgotTitle') : registering ? t('createTitle') : t('loginTitle')}</h1>
        <p className="auth-subtitle">{forgotPassword ? t('forgotDescription') : registering ? t('registerDescription') : t('loginDescription')}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-topbar">
          <Link className="auth-back-link auth-top-back-link" href="/">{t('backToWelcome')}</Link>
          <div className="public-language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-label={t('languageKinyarwanda')} aria-pressed={language === 'rw'} onClick={() => setLanguage('rw')}>RW</button>
            <button type="button" aria-label={t('languageEnglish')} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">{forgotPassword ? t('forgotEyebrow') : registering ? t('register') : t('login')}</span>
          <h2>{forgotPassword ? t('forgotTitle') : registering ? t('createTitle') : t('loginTitle')}</h2>
        </div>
        {forgotPassword ? <>
          {resetStep === 'request' ? <form onSubmit={submitResetRequest} className="form-stack auth-reset-form">
            <label>{t('email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button button-primary button-wide" disabled={busy}>{busy ? t('wait') : t('requestResetCode')}<ArrowRight size={17} /></button>
          </form> : null}
          {resetStep === 'verify' ? <form onSubmit={submitResetCode} className="form-stack auth-reset-form">
            <label>{t('email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
            <p className="auth-feedback auth-success" role="status">{resetMessage}</p>
            <label>{t('resetCodeLabel')}<input className="auth-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="auth-reset-actions"><button className="button button-primary button-wide" disabled={busy || resetCode.length !== 6}>{busy ? t('wait') : t('verifyResetCode')}<ArrowRight size={17} /></button><button type="button" className="text-button" onClick={() => void requestResetCode()} disabled={busy}>{t('resendResetCode')}</button><button type="button" className="text-button" onClick={() => { setResetStep('request'); setError(''); setResetMessage(''); }} disabled={busy}>{t('backToEmail')}</button></div>
          </form> : null}
          {resetStep === 'password' ? <form onSubmit={submitNewPassword} className="form-stack auth-reset-form">
            <label>{t('newPassword')}<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} /></label>
            <label>{t('confirmPassword')}<input type="password" autoComplete="new-password" minLength={8} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} disabled={busy} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button button-primary button-wide" disabled={busy}>{busy ? t('wait') : t('updatePassword')}<ArrowRight size={17} /></button>
          </form> : null}
          {resetStep === 'complete' ? <div className="form-stack"><strong>{t('resetSuccessTitle')}</strong><p className="auth-feedback auth-success" role="status">{t('resetSuccessDescription')}</p><Link className="button button-primary button-wide" href="/login">{t('returnToLogin')}<ArrowRight size={17} /></Link></div> : null}
          <div className="auth-navigation"><Link className="text-button auth-switch" href="/login">{t('returnToLogin')}</Link></div>
        </> : <>
        <form onSubmit={submit} className="form-stack">
          {registering ? <label>{t('fullName')}<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
          <label>{t('email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t('password')}<span className="password-field"><input type={passwordVisible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={passwordVisible ? t('hidePassword') : t('showPassword')} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          {!registering ? <Link className="auth-forgot-link" href="/forgot-password">{t('forgotPassword')}</Link> : null}
          {registering ? <label>{t('accountType')}<select value={accountType} onChange={(event) => { setAccountType(event.target.value); setSelectedPlanCode(''); }}><option value="COLLECTOR">{t('collector')}</option>{process.env.NODE_ENV !== 'production' ? <option value="COLLECTION_CENTER">{t('collectionCenter')}</option> : null}</select></label> : null}
          {registering && accountType === 'COLLECTOR' ? <>
            <fieldset className="registration-tier-options">
              <legend>{t('subscriptionSelectTier')}</legend>
              {registrationPlansLoading ? <p>{t('dashboardLoading')}</p> : registrationPlans.map((plan) => <label className="registration-tier-option" key={plan.id}>
                <input type="radio" name="registration-tier" value={plan.code} checked={selectedPlanCode === plan.code} onChange={() => setSelectedPlanCode(plan.code)} />
                <span><b>{plan.name}</b><small>{Number(plan.min_volume_liters).toLocaleString()}–{plan.max_volume_liters === null ? '∞' : Number(plan.max_volume_liters).toLocaleString()} L / {t('billingMonthly')}</small></span>
                <strong>{money(Number(plan.price))} {plan.currency}</strong>
              </label>)}
              {!registrationPlansLoading && !registrationPlans.length ? <p role="status">{t('subscriptionUnavailable')}</p> : null}
            </fieldset>
            <p className="subscription-registration-period">{t('initialAccessDisclosure').replace('{days}', String(registrationAccessDays))}</p>
          </> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" disabled={busy || (registering && accountType === 'COLLECTOR' && (!selectedPlanCode || registrationPlansLoading))}>{busy ? t('wait') : registering ? t('createAccount') : t('signIn')}<ArrowRight size={17} /></button>
        </form>
        <div className="auth-navigation">
          <Link className="text-button auth-switch" href={registering ? '/login' : '/register'}>
            {registering ? t('alreadyHaveAccount') : t('newToSystem')}
          </Link>
        </div>
        </>}
      </section>
    </main>
  );
}

export default function Workspace() {
  const publicLanguage = usePublicLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [online, setOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [ifishiOpen, setIfishiOpen] = useState(false);
  const [ownerIfishiOpen, setOwnerIfishiOpen] = useState(false);
  const [ownerIfishiHistoryOpen, setOwnerIfishiHistoryOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [centers, setCenters] = useState<Center[]>([]);
  const [farmers, setFarmers] = useState<Page<Farmer> | null>(null);
  const [farmerQuery, setFarmerQuery] = useState('');
  const [farmerSearch, setFarmerSearch] = useState('');
  const [farmerCenter, setFarmerCenter] = useState('');
  const [farmerCollectorFilter, setFarmerCollectorFilter] = useState('');
  const [farmerSortBy, setFarmerSortBy] = useState<'' | 'name' | 'nationalId' | 'collectionCenter'>('');
  const [farmerSortDirection, setFarmerSortDirection] = useState<'asc' | 'desc'>('asc');
  const [farmerForm, setFarmerForm] = useState({ name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [farmerCreateOpen, setFarmerCreateOpen] = useState(false);
  const [farmerCreateError, setFarmerCreateError] = useState('');
  const farmerCreateSubmittingRef = useRef(false);
  const [editingFarmer, setEditingFarmer] = useState<Farmer | null>(null);
  const [farmerEdit, setFarmerEdit] = useState({ name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [collectorAssignments, setCollectorAssignments] = useState<CollectorAssignment[]>([]);
  const [collectorAssignmentSortDirection, setCollectorAssignmentSortDirection] = useState<'asc' | 'desc'>('asc');
  const [collectorAssignmentsLoading, setCollectorAssignmentsLoading] = useState(false);
  const [collectorAssignmentsError, setCollectorAssignmentsError] = useState('');
  const [collectorLinkId, setCollectorLinkId] = useState('');
  const [collectorLinkOpen, setCollectorLinkOpen] = useState(false);
  const [collectorLinkError, setCollectorLinkError] = useState('');
  const collectorLinkSubmittingRef = useRef(false);
  const [abacundaIfishiCollector, setAbacundaIfishiCollector] = useState<CollectorAssignment | null>(null);
  const [abacundaIfishiHistory, setAbacundaIfishiHistory] = useState<AbacundaIfishiHistory | null>(null);
  const [abacundaIfishiMonth, setAbacundaIfishiMonth] = useState(today().slice(0, 7));
  const [abacundaIfishiLoading, setAbacundaIfishiLoading] = useState(false);
  const [abacundaIfishiError, setAbacundaIfishiError] = useState('');
  const [centerForm, setCenterForm] = useState({ name: '', pricePerLiter: '', transportRatePerLiter: '0', morningStart: '06:30', morningEnd: '09:00', eveningStart: '17:30', eveningEnd: '19:00' });
  const [centerEdits, setCenterEdits] = useState<Record<number, Partial<Center> & { morningStart?: string; morningEnd?: string; eveningStart?: string; eveningEnd?: string }>>({});
  const [selectedCenter, setSelectedCenter] = useState('');
  const [dailyCenter, setDailyCenter] = useState<string | null>(null);
  const [dailyCenters, setDailyCenters] = useState<string[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [collectionDate, setCollectionDate] = useState(today());
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [collectorMilkEntry, setCollectorMilkEntry] = useState<CollectorMilkEntry | null>(null);
  const [dailyCursor, setDailyCursor] = useState<string | null>(null);
  const [dailyHasMore, setDailyHasMore] = useState(false);
  const [dailySearch, setDailySearch] = useState('');
  const [debouncedDailySearch, setDebouncedDailySearch] = useState('');
  const [dailySession, setDailySession] = useState<'all' | 'morning' | 'evening'>('all');
  const [dailySortBy, setDailySortBy] = useState<'' | 'farmerName' | 'totalVolume'>('');
  const [dailySortDirection, setDailySortDirection] = useState<'asc' | 'desc'>('asc');
  const [dailyPageSize, setDailyPageSize] = useState(50);
  const dailyFilterState = [debouncedDailySearch, dailySession, dailyPageSize];
  const dailyRequestRef = useRef(0);
  const [dailySummary, setDailySummary] = useState({
    totalFarmers: 0,
    presentCount: 0,
    totalMorning: 0,
    totalEvening: 0,
    totalVolume: 0,
    totalAmount: 0,
    pricePerLiter: 0,
    transportRate: 0,
  });
  const [volumes, setVolumes] = useState<Record<number, { morning: string; evening: string }>>({});
  const [deductionRows, setDeductionRows] = useState<Page<any> | null>(null);
  const [deductionSearchQuery, setDeductionSearchQuery] = useState('');
  const [deductionSearch, setDeductionSearch] = useState('');
  const [deductionTypeFilter, setDeductionTypeFilter] = useState('');
  const [deductionStatusFilter, setDeductionStatusFilter] = useState('');
  const [deductionSortBy, setDeductionSortBy] = useState<'date' | 'farmerName' | 'amount'>('date');
  const [deductionSortDirection, setDeductionSortDirection] = useState<'asc' | 'desc'>('desc');
  const [deductionForm, setDeductionForm] = useState({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
  const [deductionCreateOpen, setDeductionCreateOpen] = useState(false);
  const [deductionCreateError, setDeductionCreateError] = useState('');
  const deductionSubmittingRef = useRef(false);
  const [deductionFarmerSearch, setDeductionFarmerSearch] = useState('');
  const [deductionFarmers, setDeductionFarmers] = useState<Farmer[]>([]);
const [report, setReport] = useState<Report | null>(null);
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [settlementMonth, setSettlementMonth] = useState(today().slice(0, 7));
  const [settlementHalf, setSettlementHalf] = useState<'first-half' | 'second-half'>('first-half');
  const [settlementData, setSettlementData] = useState<SettlementData | null>(null);
  const [settlementDebts, setSettlementDebts] = useState<any[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementError, setSettlementError] = useState('');
  const [settlementAmounts, setSettlementAmounts] = useState<Record<number, string>>({});
  const settlementRequestKeys = useRef<Record<string, string>>({});
  const [debtForm, setDebtForm] = useState({ farmerId: '', amount: '', reason: '' });
  const [debtRepaymentAmounts, setDebtRepaymentAmounts] = useState<Record<number, string>>({});
  const [ifishiMonth, setIfishiMonth] = useState(today().slice(0, 7));
  const [ifishiFarmerSearch, setIfishiFarmerSearch] = useState('');
  const [ifishiFarmers, setIfishiFarmers] = useState<Farmer[]>([]);
  const [ifishiFarmerId, setIfishiFarmerId] = useState('');
  const [ifishiDate, setIfishiDate] = useState(today());
  const [ifishiRecordSession, setIfishiRecordSession] = useState<'all' | 'morning' | 'evening'>('all');
  const [ifishiRecordSortBy, setIfishiRecordSortBy] = useState<'date' | 'volume' | 'amount'>('date');
  const [ifishiRecordSortDirection, setIfishiRecordSortDirection] = useState<'asc' | 'desc'>('desc');
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [ifishiMorning, setIfishiMorning] = useState('');
  const [ifishiEvening, setIfishiEvening] = useState('');
  const [ifishiRecords, setIfishiRecords] = useState<MilkRecord[]>([]);
  const [ifishiSaveError, setIfishiSaveError] = useState('');
  const [ifishiSaveStatus, setIfishiSaveStatus] = useState('');
  const [ownerIfishiHistory, setOwnerIfishiHistory] = useState<OwnerIfishiHistory | null>(null);
  const [ownerIfishiReport, setOwnerIfishiReport] = useState<Report | null>(null);
  const [ownerIfishiReportError, setOwnerIfishiReportError] = useState('');
  const [ownerIfishiPeriod, setOwnerIfishiPeriod] = useState<'first-half' | 'second-half'>('first-half');
  const [ownerIfishiMorning, setOwnerIfishiMorning] = useState('');
  const [ownerIfishiEvening, setOwnerIfishiEvening] = useState('');
  const [ownerIfishiLoading, setOwnerIfishiLoading] = useState(false);
  const [ownerIfishiError, setOwnerIfishiError] = useState('');
  const [ownerIfishiSaveError, setOwnerIfishiSaveError] = useState('');
  const [ownerIfishiSaveStatus, setOwnerIfishiSaveStatus] = useState('');
  const [ukweziMonth, setUkweziMonth] = useState(today().slice(5, 7));
  const [ukweziYear, setUkweziYear] = useState(today().slice(0, 4));
  const [ukweziPeriod, setUkweziPeriod] = useState<'first-half' | 'second-half'>('first-half');
  const [ukweziSortBy, setUkweziSortBy] = useState<'name' | 'volume' | 'payable'>('name');
  const [ukweziSortDirection, setUkweziSortDirection] = useState<'asc' | 'desc'>('asc');
  const [ukweziReport, setUkweziReport] = useState<Report | null>(null);
  const [ukweziPdfLoading, setUkweziPdfLoading] = useState(false);
  const [ukweziPdfError, setUkweziPdfError] = useState('');
  const [ukweziPdfStatus, setUkweziPdfStatus] = useState('');
  const ukweziPdfRequestRef = useRef(false);
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [notificationSearchQuery, setNotificationSearchQuery] = useState('');
  const [notificationSearch, setNotificationSearch] = useState('');
  const [notificationStatusFilter, setNotificationStatusFilter] = useState('');
  const [notificationPriorityFilter, setNotificationPriorityFilter] = useState('');
  const [notificationTypeFilter, setNotificationTypeFilter] = useState('');
  const [notificationSortBy, setNotificationSortBy] = useState<'date' | 'type'>('date');
  const [notificationSortDirection, setNotificationSortDirection] = useState<'asc' | 'desc'>('desc');
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [accounts, setAccounts] = useState<{ accounts: Account[]; total: number; page: number; limit: number } | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [adminAccountDetailsOpen, setAdminAccountDetailsOpen] = useState(false);
  const [adminAccountDetails, setAdminAccountDetails] = useState<AdminAccountDetails | null>(null);
  const [adminAccountDetailsTargetId, setAdminAccountDetailsTargetId] = useState<number | null>(null);
  const [adminAccountDetailsLoading, setAdminAccountDetailsLoading] = useState(false);
  const [adminAccountDetailsError, setAdminAccountDetailsError] = useState('');
  const adminAccountDetailsRequestRef = useRef(0);
  const [billing, setBilling] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [customerPaymentStatus, setCustomerPaymentStatus] = useState('');
  const [customerPaymentSortBy, setCustomerPaymentSortBy] = useState<'date' | 'amount'>('date');
  const [customerPaymentSortDirection, setCustomerPaymentSortDirection] = useState<'asc' | 'desc'>('desc');
  const billingPeriod = 'monthly';
  const [selectedSubscriptionPlanCode, setSelectedSubscriptionPlanCode] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [collectorPrices, setCollectorPrices] = useState<CollectorMilkPrice[]>([]);
  const [collectorPriceForm, setCollectorPriceForm] = useState({ pricePerLiter: '', effectiveDate: today() });
  const [auditRows, setAuditRows] = useState<any>(null);
  const [centerPricing, setCenterPricing] = useState<any>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [adminConfigLoading, setAdminConfigLoading] = useState(false);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [collectorTierEdits, setCollectorTierEdits] = useState<Record<string, CollectorTierEdit>>({});
  const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy | null>(null);
  const [paymentConfiguration, setPaymentConfiguration] = useState<PaymentConfiguration | null>(null);
  const [adminPayments, setAdminPayments] = useState<AdminPayment[]>([]);
  const [adminPaymentTotal, setAdminPaymentTotal] = useState(0);
  const [adminPaymentSummary, setAdminPaymentSummary] = useState<AdminPaymentSummary | null>(null);
  const [adminPaymentPage, setAdminPaymentPage] = useState(1);
  const [adminPaymentStatus, setAdminPaymentStatus] = useState('');
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountSettingsTab, setAccountSettingsTab] = useState<'personal' | 'management'>('personal');
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', nationalId: '', accountNumber: '', profilePicture: '' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [confirmAccountPassword, setConfirmAccountPassword] = useState('');
  const [accountPasswordVisibility, setAccountPasswordVisibility] = useState({ current: false, next: false, confirm: false });
  const [accountEmailChangePending, setAccountEmailChangePending] = useState(false);
  const [accountPendingEmail, setAccountPendingEmail] = useState('');
  const [accountAvatarError, setAccountAvatarError] = useState('');

  const isAdmin = user?.role === 'super_admin';
  const isCollector = !!user && user.role !== 'super_admin' && user.accountType === 'COLLECTOR';
  const isDairy = !!user && user.role !== 'super_admin' && user.accountType === 'COLLECTION_CENTER';
  const subscriptionStatusLabel = (status?: string | null) => status
    ? publicLanguage.t(subscriptionStatusCopy[status.toLowerCase() as keyof typeof subscriptionStatusCopy] || 'statusPending')
    : publicLanguage.t('subscriptionNoAccount');
  const accountCopy = (collectorKey: Parameters<PublicLanguageState['t']>[0], centerKey: Parameters<PublicLanguageState['t']>[0]) => publicLanguage.t(isDairy ? centerKey : collectorKey);
  const collectorOwnedCenters = centers.filter((center) => Number(center.owner_user_id) === Number(user?.id));
const visibleTabs = (isAdmin
    ? [
        { id: 'dashboard' as Tab, label: publicLanguage.t('navAdminOverview'), icon: Activity },
        { id: 'accounts' as Tab, label: publicLanguage.t('navAccounts'), icon: Users },
        { id: 'audit' as Tab, label: publicLanguage.t('navAudit'), icon: Shield },
        { id: 'config' as Tab, label: publicLanguage.t('navPricing'), icon: CircleDollarSign },
        { id: 'settings' as Tab, label: publicLanguage.t('navAdminSettings'), icon: Settings },
        { id: 'system-health' as Tab, label: publicLanguage.t('systemHealth'), icon: Building2 },
        { id: 'notifications-admin' as Tab, label: publicLanguage.t('navAdminAlerts'), icon: Bell },
      ]
    : (isCollector ? collectorTabs : isDairy ? dairyTabs : collectorTabs)).map((item) => {
      const labelKey = item.id === 'dashboard' && isAdmin
        ? 'navAdminOverview'
        : item.id === 'settings' && isAdmin
          ? 'navAdminSettings'
        : item.id in navigationCopy
          ? navigationCopy[item.id as keyof typeof navigationCopy]
          : null;
      return { ...item, label: labelKey ? publicLanguage.t(labelKey) : item.label };
    });
  const mobilePrimaryTabs = visibleTabs.slice(0, 4);
  const mobileMoreTabs = visibleTabs.slice(4);

  useEffect(() => {
    if (!mobileMoreOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMoreOpen]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const storedUser = sessionStorage.getItem('milk-session-user');
    api<{ user: User }>('/api/auth/me', { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setUser(result.user);
        setTab('dashboard');
        sessionStorage.setItem('milk-session-user', JSON.stringify(result.user));
      })
      .catch((reason) => {
        if (!active) return;
        if (!navigator.onLine && storedUser) {
          try { setUser(JSON.parse(storedUser) as User); } catch { sessionStorage.removeItem('milk-session-user'); }
        } else if (!(reason instanceof Error && 'status' in reason && reason.status === 401)) {
          setAuthError('Unable to start Milk System. Check your connection or try again.');
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [authAttempt]);

  useEffect(() => {
    if (!user) return undefined;
    const refreshConnection = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      try {
        const result = await api<{ user: User }>('/api/auth/me');
        setUser(result.user);
        sessionStorage.setItem('milk-session-user', JSON.stringify(result.user));
      } catch (reason) {
        const status = reason instanceof Error && 'status' in reason ? reason.status : null;
        if (status === 401) {
          setUser(null);
          sessionStorage.removeItem('milk-session-user');
        }
        return;
      }
      const synced = await flushOfflineWrites(user.id).catch(() => ({ synced: 0, remaining: pendingWrites }));
      setPendingWrites(synced.remaining);
      if (synced.synced > 0) setNotice(`${synced.synced} offline milk entr${synced.synced === 1 ? 'y' : 'ies'} synced.`);
    };
    const handleOnline = () => { void refreshConnection(); };
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    getOfflineWrites().then((writes) => setPendingWrites(writes.filter((write) => write.ownerId === user.id).length)).catch(() => setPendingWrites(0));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user?.id]);

  const clearMessages = () => { setError(''); setNotice(''); };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    clearMessages();
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.'); }
    finally { setBusy(false); }
  };
  const runSettlement = async (operation: () => Promise<void>) => {
    setBusy(true);
    clearMessages();
    try { await operation(); } catch { setError(publicLanguage.t('settlementsActionError')); }
    finally { setBusy(false); }
  };

  const loadCenters = async () => {
    const data = await api<Center[]>('/api/collection-centers');
    setCenters(data);
    setSelectedCenter((current) => {
      if (!data.length) return '';
      const currentCenterStillExists = current && data.some((center) => String(center.id) === String(current));
      return currentCenterStillExists ? current : String(data[0].id);
    });
  };

  const loadCollectorAssignments = async (sortDirection = collectorAssignmentSortDirection) => {
    setCollectorAssignmentsLoading(true);
    setCollectorAssignmentsError('');
    const params = new URLSearchParams();
    if (user?.accountType === 'COLLECTION_CENTER' && selectedCenter) params.set('centerId', selectedCenter);
    params.set('sortDirection', sortDirection);
    try {
      const result = await api<CollectorAssignment[]>(`/api/collector-assignments${params.size ? `?${params}` : ''}`);
      setCollectorAssignments(result);
      if (farmerCollectorFilter && !result.some((assignment) => String(assignment.collector_user_id) === farmerCollectorFilter)) {
        setFarmerCollectorFilter('');
      }
    } catch (reason) {
      setCollectorAssignmentsError(reason instanceof Error ? reason.message : 'Failed to load collector assignments.');
      throw reason;
    } finally {
      setCollectorAssignmentsLoading(false);
    }
  };

  const getFarmerCollectorName = (collectorUserId?: number | null) => {
    if (!collectorUserId) return publicLanguage.t('noCollector');
    const matched = collectorAssignments.find((assignment) => assignment.collector_user_id === collectorUserId);
    return matched ? matched.collector_name : `Collector #${collectorUserId}`;
  };

  const loadFarmers = async (cursor?: string | null, append = false) => {
    const activeCenter = centers.find((center) => String(center.id) === selectedCenter)?.name || '';
    const scopedFarmerCenter = isDairy ? activeCenter : farmerCenter;
    const params = buildFarmerListQuery({
      userAccountType: user?.accountType || '',
      userId: user?.id || 0,
      selectedCollectorId: farmerCollectorFilter,
      farmerSearch,
      farmerCenter: scopedFarmerCenter,
      sortBy: farmerSortBy || undefined,
      sortDirection: farmerSortBy ? farmerSortDirection : undefined,
      cursor: cursor || undefined,
      limit: 50,
    });
    const cacheKey = `milk-farmers-${user?.id}-${user?.accountType}-${scopedFarmerCenter}-${farmerSearch}-${farmerCollectorFilter}-${farmerSortBy}-${farmerSortDirection}`;
    try {
      const result = await api<Page<Farmer>>(`/api/farmers?${params}`, { cache: 'no-store' });
      setFarmers((previous) => append && previous ? { ...result, data: [...previous.data, ...result.data] } : result);
      if (!append && !cursor) localStorage.setItem(cacheKey, JSON.stringify(result));
    } catch (reason) {
      const cached = !append && !cursor ? localStorage.getItem(cacheKey) : null;
      if (!cached) throw reason;
      setFarmers(JSON.parse(cached) as Page<Farmer>);
    }
  };

  const loadIfishiFarmers = async (search = '') => {
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('search', search.trim());
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    if (selectedCenter) {
      const centerName = centers.find((center) => String(center.id) === selectedCenter)?.name;
      if (centerName) params.set('center', centerName);
    }
    const result = await api<Page<Farmer>>(`/api/farmers?${params}`, { cache: 'no-store' });
    setIfishiFarmers(result.data.length ? result.data : ifishiFarmers.filter((farmer) => String(farmer.id) === ifishiFarmerId));
    if (!ifishiFarmerId && result.data.length) setIfishiFarmerId(String(result.data[0].id));
  };

  const loadIfishiRecords = async () => {
    if (!ifishiFarmerId) return;
    const { startDate, endDate } = getMonthBounds(ifishiMonth);
    const params = new URLSearchParams({ farmerId: ifishiFarmerId, startDate, endDate, limit: '100', sortBy: ifishiRecordSortBy, sortDirection: ifishiRecordSortDirection });
    if (ifishiRecordSession !== 'all') params.set('session', ifishiRecordSession);
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    const result = await api<Page<MilkRecord>>(`/api/milk?${params}`, { cache: 'no-store' });
    setIfishiRecords(result.data);
    const selectedRecord = result.data.find((record) => String(record.date).slice(0, 10) === ifishiDate);
    setIfishiMorning(selectedRecord && selectedRecord.volumeMorning > 0 ? String(selectedRecord.volumeMorning) : '');
    setIfishiEvening(selectedRecord && selectedRecord.volumeEvening > 0 ? String(selectedRecord.volumeEvening) : '');
  };

  const loadOwnerIfishiHistory = async () => {
    setOwnerIfishiLoading(true);
    setOwnerIfishiError('');
    setOwnerIfishiReport(null);
    setOwnerIfishiReportError('');
    try {
      const [year, month] = ifishiMonth.split('-');
      const params = new URLSearchParams({ month, year, periodType: ownerIfishiPeriod });
      const history = await api<OwnerIfishiHistory>(`/api/ifishi/owner?${params}`, { cache: 'no-store' });
      setOwnerIfishiHistory(history);
      setError((current) => current === 'Failed to load Owner Ifishi history.' ? '' : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Failed to load Owner Ifishi history.';
      setOwnerIfishiError(message);
      throw reason;
    } finally {
      setOwnerIfishiLoading(false);
    }
  };

  const loadAbacundaIfishi = async (collectorUserId: number, monthValue = abacundaIfishiMonth) => {
    const { startDate, endDate } = getMonthBounds(monthValue);
    const params = new URLSearchParams({ collectorUserId: String(collectorUserId), centerId: selectedCenter, startDate, endDate });
    setAbacundaIfishiLoading(true);
    setAbacundaIfishiError('');
    try {
      setAbacundaIfishiHistory(await api<AbacundaIfishiHistory>(`/api/ifishi/abacunda?${params}`, { cache: 'no-store' }));
    } catch (reason) {
      setAbacundaIfishiError(reason instanceof Error ? reason.message : 'Failed to load Abacunda Ifishi.');
    } finally {
      setAbacundaIfishiLoading(false);
    }
  };

  const loadDaily = async (cursor?: string | null, append = false) => {
    const requestId = ++dailyRequestRef.current;
    setDailyLoading(true);
    setDailyError('');
    if (isDairy && !selectedCenter) {
      setDailyError('No collection center selected. Please choose an active center.');
      setDailyLoading(false);
      return;
    }
    if (!append) {
      setDailyCursor(null);
      setDailyHasMore(false);
    }
    const milkEntryView = tab === 'milk';
    const search = milkEntryView ? debouncedDailySearch : '';
    const session = milkEntryView ? dailySession : 'all';
    const limit = milkEntryView ? dailyPageSize : 50;
    const params = new URLSearchParams({ date: collectionDate, limit: String(limit) });
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    if (selectedCenter) params.set('centerId', selectedCenter);
    if (search) params.set('search', search);
    if (session !== 'all') params.set('session', session);
    if (milkEntryView && dailySortBy) {
      params.set('sortBy', dailySortBy);
      params.set('sortDirection', dailySortDirection);
    }
    if (cursor) params.set('cursor', cursor);
    try {
      const result = await api<{ farmers: DailyRow[]; summary: typeof dailySummary; farmerPagination: { nextCursor: string | null; hasMore: boolean }; center?: string | null; centers?: string[]; collectorMilk?: CollectorMilkEntry[] }>(`/api/milk/daily?${params}`, { cache: 'no-store' });
      if (requestId !== dailyRequestRef.current) return;
      setDailyCenter(result.center || null);
      setDailyCenters(result.centers || (result.center ? [result.center] : []));
      const collectorEntry = result.collectorMilk?.[0] || null;
      setCollectorMilkEntry(collectorEntry);
      setDaily((previous) => append ? [...previous, ...result.farmers] : result.farmers);
      setDailyCursor(result.farmerPagination.nextCursor);
      setDailyHasMore(result.farmerPagination.hasMore);
      setDailySummary(result.summary);
      setVolumes((previous) => ({ ...previous, ...Object.fromEntries(result.farmers.map((row) => [row.farmerId, { morning: row.volumeMorning ? String(row.volumeMorning) : '', evening: row.volumeEvening ? String(row.volumeEvening) : '' }])) }));
    } catch (reason) {
      if (requestId === dailyRequestRef.current) {
        setDailyError(reason instanceof Error ? reason.message : 'Failed to load daily milk.');
        throw reason;
      }
    } finally {
      if (requestId === dailyRequestRef.current) setDailyLoading(false);
    }
  };

  const loadDeductions = async (cursor?: string | null, append = false, overrides: { search?: string; type?: string; status?: string; sortBy?: typeof deductionSortBy; sortDirection?: typeof deductionSortDirection } = {}) => {
    const params = new URLSearchParams({ limit: '50' });
    const filters = {
      search: overrides.search ?? deductionSearch,
      type: overrides.type ?? deductionTypeFilter,
      status: overrides.status ?? deductionStatusFilter,
      sortBy: overrides.sortBy ?? deductionSortBy,
      sortDirection: overrides.sortDirection ?? deductionSortDirection,
    };
    if (filters.search) params.set('search', filters.search);
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    params.set('sortBy', filters.sortBy);
    params.set('sortDirection', filters.sortDirection);
    if (cursor) params.set('cursor', cursor);
    const result = await api<Page<any>>(`/api/deductions?${params}`);
    setDeductionRows((previous) => append && previous ? { ...result, data: [...previous.data, ...result.data] } : result);
  };

  const loadDeductionFarmers = async (search = '') => {
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('search', search.trim());
    const result = await api<Page<Farmer>>(`/api/farmers?${params}`);
    setDeductionFarmers(result.data);
  };

  const loadReport = async (periodType = 'monthly') => {
    if (periodType === 'current-half') {
      const params = new URLSearchParams({ periodType: 'current-half' });
      if (selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
      setReport(await api<Report>(`/api/reports/summary?${params}`));
      return;
    }
    const [year, month] = reportMonth.split('-');
    const params = new URLSearchParams({ periodType: 'monthly', month, year });
    if (selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
    setReport(await api<Report>(`/api/reports/summary?${params}`));
  };

  const loadUkwezi = async (sortOverrides: { sortBy?: typeof ukweziSortBy; sortDirection?: typeof ukweziSortDirection } = {}) => {
    const params = new URLSearchParams({ periodType: ukweziPeriod, month: ukweziMonth, year: ukweziYear });
    params.set('sortBy', sortOverrides.sortBy || ukweziSortBy);
    params.set('sortDirection', sortOverrides.sortDirection || ukweziSortDirection);
    if (isDairy && selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
    setUkweziReport(await api<Report>(`/api/reports/summary?${params}`, { cache: 'no-store' }));
  };

  const loadSettlementData = async () => {
    const { startDate, endDate } = getSettlementPeriodBounds(settlementMonth, settlementHalf);
    setSettlementLoading(true);
    try {
      if (isDairy) {
        const params = new URLSearchParams({ action: 'summary', periodStart: startDate, periodEnd: endDate });
        const [summary, debts] = await Promise.all([
          api<SettlementData>(`/api/farmer-settlements?${params}`, { cache: 'no-store' }),
          api<{ data: any[] }>('/api/farmer-settlements?action=debts', { cache: 'no-store' }),
        ]);
        setSettlementData(summary);
        setSettlementDebts(debts.data);
      } else {
        const params = new URLSearchParams({ action: 'confirmations', periodStart: startDate, periodEnd: endDate });
        setSettlementData(await api<SettlementData>(`/api/farmer-settlements?${params}`, { cache: 'no-store' }));
        setSettlementDebts([]);
      }
      setSettlementError('');
    } catch {
      setSettlementData(null);
      setSettlementDebts([]);
      setSettlementError('settlementsLoadError');
    } finally {
      setSettlementLoading(false);
    }
  };

  const downloadUkweziPdf = async (params: URLSearchParams) => {
    if (ukweziPdfRequestRef.current) return;
    ukweziPdfRequestRef.current = true;
    setUkweziPdfLoading(true);
    setUkweziPdfError('');
    setUkweziPdfStatus('');
    try {
      params.set('language', publicLanguage.language);
      const response = await fetch(`/api/ukwezi/pdf?${params}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || publicLanguage.t('ukweziPdfError'));
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
        throw new Error(publicLanguage.t('ukweziPdfInvalid'));
      }
      const blob = await response.blob();
      const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      if (signature.length !== 5 || String.fromCharCode(...signature) !== '%PDF-') {
        throw new Error(publicLanguage.t('ukweziPdfInvalid'));
      }
      const disposition = response.headers.get('content-disposition') || '';
      const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || `Ukwezi-${ukweziYear}-${ukweziMonth}-${ukweziPeriod}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      setUkweziPdfStatus(publicLanguage.t('ukweziPdfReady'));
    } catch (reason) {
      setUkweziPdfError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : publicLanguage.t('ukweziPdfError'));
    } finally {
      ukweziPdfRequestRef.current = false;
      setUkweziPdfLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    const result = await api<{ data: { unreadCount: number } }>('/api/notifications/unread-count');
    setUnreadCount(result.data.unreadCount);
  };

  const loadNotifications = async (overrides: { search?: string; status?: string; priority?: string; type?: string; sortBy?: typeof notificationSortBy; sortDirection?: typeof notificationSortDirection } = {}) => {
    const filters = {
      search: overrides.search ?? notificationSearch,
      status: overrides.status ?? notificationStatusFilter,
      priority: overrides.priority ?? notificationPriorityFilter,
      type: overrides.type ?? notificationTypeFilter,
      sortBy: overrides.sortBy ?? notificationSortBy,
      sortDirection: overrides.sortDirection ?? notificationSortDirection,
    };
    const hasCustomFilters = Boolean(filters.search || filters.status || filters.priority || filters.type || filters.sortBy !== 'date' || filters.sortDirection !== 'desc' || (isDairy && selectedCenter));
    const result = hasCustomFilters
      ? await api<{ data: Notice[] }>(`/api/notifications?${new URLSearchParams({
          limit: '50',
          sortBy: filters.sortBy,
          sortDirection: filters.sortDirection,
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.priority ? { priority: filters.priority } : {}),
          ...(filters.type ? { type: filters.type } : {}),
          ...(isDairy && selectedCenter ? { center: centers.find((center) => String(center.id) === selectedCenter)?.name || '' } : {}),
        })}`)
      : await api<{ data: Notice[] }>('/api/notifications?limit=50');
    setNotifications(result.data);
    await loadUnreadCount();
  };

  const renderNotificationFilters = () => {
    const reset = () => {
      setNotificationSearchQuery(''); setNotificationSearch(''); setNotificationStatusFilter(''); setNotificationPriorityFilter(''); setNotificationTypeFilter(''); setNotificationSortBy('date'); setNotificationSortDirection('desc');
      void loadNotifications({ search: '', status: '', priority: '', type: '', sortBy: 'date', sortDirection: 'desc' }).catch((reason) => setError(reason.message));
    };
    const applySort = (value: string) => {
      const [field, direction] = value.split(':');
      if (['date', 'type'].includes(field) && ['asc', 'desc'].includes(direction)) {
        setNotificationSortBy(field as typeof notificationSortBy);
        setNotificationSortDirection(direction as typeof notificationSortDirection);
        void loadNotifications({ sortBy: field as typeof notificationSortBy, sortDirection: direction as typeof notificationSortDirection }).catch((reason) => setError(reason.message));
      }
    };
    return <div className="toolbar notification-list-controls">
      <form className={['search', 'form'].join('-')} onSubmit={(event) => { event.preventDefault(); const search = notificationSearchQuery.trim(); setNotificationSearch(search); void loadNotifications({ search }).catch((reason) => setError(reason.message)); }}><Search size={17} aria-hidden="true" /><input aria-label={publicLanguage.t('milkSearchLabel')} placeholder={publicLanguage.t('search')} value={notificationSearchQuery} onChange={(event) => setNotificationSearchQuery(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form>
      <label>{publicLanguage.t('status')}<select value={notificationStatusFilter} onChange={(event) => { const status = event.target.value; setNotificationStatusFilter(status); void loadNotifications({ status }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option><option value="unread">{publicLanguage.t('notificationsUnread')}</option><option value="read">{publicLanguage.t('notificationsRead')}</option></select></label>
      <label>{publicLanguage.t('notificationPriority')}<select value={notificationPriorityFilter} onChange={(event) => { const priority = event.target.value; setNotificationPriorityFilter(priority); void loadNotifications({ priority }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option>{['high', 'warning', 'info', 'success'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
      <label>{publicLanguage.t('notificationType')}<select value={notificationTypeFilter} onChange={(event) => { const type = event.target.value; setNotificationTypeFilter(type); void loadNotifications({ type }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option>{Array.from(new Set(notifications.map((item) => item.notification_type))).map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
      <label>{publicLanguage.t('sort')}<select value={`${notificationSortBy}:${notificationSortDirection}`} onChange={(event) => applySort(event.target.value)}><option value="date:desc">{publicLanguage.t('when')} ↓</option><option value="date:asc">{publicLanguage.t('when')} ↑</option><option value="type:asc">{publicLanguage.t('notificationType')} ↑</option><option value="type:desc">{publicLanguage.t('notificationType')} ↓</option></select></label>
      {notificationSearch || notificationStatusFilter || notificationPriorityFilter || notificationTypeFilter || notificationSortBy !== 'date' || notificationSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={reset}>{publicLanguage.t('milkClearSearch')}</button> : null}
    </div>;
  };

  const loadAccounts = async () => {
    const params = new URLSearchParams({ page: '1', limit: '50' });
    if (accountSearch) params.set('search', accountSearch);
    if (accountStatus) params.set('status', accountStatus);
    setAccounts(await api(`/api/admin/accounts?${params}`));
  };

  const loadAdminAccountDetails = async (userId: number) => {
    const requestId = ++adminAccountDetailsRequestRef.current;
    setAdminAccountDetailsOpen(true);
    setAdminAccountDetailsTargetId(userId);
    setAdminAccountDetails(null);
    setAdminAccountDetailsError('');
    setAdminAccountDetailsLoading(true);
    try {
      const details = await api<AdminAccountDetails>(`/api/admin/accounts/${userId}`);
      if (requestId === adminAccountDetailsRequestRef.current) setAdminAccountDetails(details);
    } catch (reason) {
      if (requestId === adminAccountDetailsRequestRef.current) {
        setAdminAccountDetailsError(reason instanceof Error ? reason.message : 'Failed to load account details.');
      }
    } finally {
      if (requestId === adminAccountDetailsRequestRef.current) setAdminAccountDetailsLoading(false);
    }
  };

  const closeAdminAccountDetails = () => {
    adminAccountDetailsRequestRef.current += 1;
    setAdminAccountDetailsOpen(false);
    setAdminAccountDetails(null);
    setAdminAccountDetailsTargetId(null);
    setAdminAccountDetailsError('');
  };

  const loadAudit = async () => {
    const result = await api<{ data: { items: any[]; total: number } }>('/api/audit-logs?limit=50');
    setAuditRows(result.data);
  };

  const loadAdminSummary = async () => {
    setAdminSummary(await api<AdminSummary>('/api/admin/accounts/summary'));
  };

  const loadBilling = async (planCode = selectedSubscriptionPlanCode, paymentOverrides: { status?: string; sortBy?: typeof customerPaymentSortBy; sortDirection?: typeof customerPaymentSortDirection } = {}) => {
    setBillingLoading(true);
    setBillingError('');
    try {
      const params = new URLSearchParams({ billingPeriod });
      if (planCode) params.set('planCode', planCode);
      if (paymentOverrides.status !== undefined ? paymentOverrides.status : customerPaymentStatus) params.set('paymentStatus', paymentOverrides.status !== undefined ? paymentOverrides.status : customerPaymentStatus);
      params.set('paymentSortBy', paymentOverrides.sortBy || customerPaymentSortBy);
      params.set('paymentSortDirection', paymentOverrides.sortDirection || customerPaymentSortDirection);
      const data = await api<any>(`/api/subscription?${params}`, { cache: 'no-store' });
      setBilling(data);
      setPaymentPhone(data.account?.phone || '');
      if (data.pricing?.planCode) setSelectedSubscriptionPlanCode(data.pricing.planCode);
    } catch (reason) {
      setBillingError(reason instanceof Error ? reason.message : 'Failed to load subscription.');
      throw reason;
    } finally {
      setBillingLoading(false);
    }
  };

  const loadAdminPayments = async (page = adminPaymentPage, status = adminPaymentStatus) => {
    const limit = 20;
    const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
    if (status) params.set('status', status);
    const result = await api<{ payments: AdminPayment[]; total: number; summary: AdminPaymentSummary }>(`/api/admin/payments?${params}`, { cache: 'no-store' });
    setAdminPayments(result.payments);
    setAdminPaymentTotal(result.total);
    setAdminPaymentSummary(result.summary);
    setAdminPaymentPage(page);
    setAdminPaymentStatus(status);
  };

  const loadCollectorPrices = async () => {
    setCollectorPrices(await api<CollectorMilkPrice[]>('/api/collector-milk-prices'));
  };

  const loadAccountProfile = async () => {
    const result = await api<{ user: AccountProfile }>('/api/auth/profile');
    setAccountProfile(result.user);
    setAccountForm({
      name: result.user.name || '',
      email: result.user.email || '',
      phone: result.user.phone || '',
      nationalId: result.user.nationalId || '',
      accountNumber: result.user.accountNumber || '',
      profilePicture: result.user.profilePicture || '',
    });
  };

  useEffect(() => {
    if (!user) return;
    loadCenters().catch((reason) => setError(reason.message));
    loadUnreadCount().catch((reason) => setError(reason.message));
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDailySearch(dailySearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [dailySearch]);

  useEffect(() => {
    if (!user) return;
    clearMessages();
    if (isAdmin) {
      if (tab === 'dashboard') loadAdminSummary().catch((reason) => setError(reason.message));
      if (tab === 'accounts') loadAccounts().catch((reason) => setError(reason.message));
      if (tab === 'audit') loadAudit().catch((reason) => setError(reason.message));
      if (tab === 'config') {
        setAdminConfigLoading(true);
        Promise.all([
          api('/api/admin/config/collection-center'),
          api<SubscriptionPlan[]>('/api/admin/config/plans', { cache: 'no-store' }),
          api<SubscriptionPolicy>('/api/admin/config/subscription', { cache: 'no-store' }),
          api<PaymentConfiguration>('/api/admin/config/payments'),
          loadAdminPayments(),
        ]).then(([center, plans, policy, payments]) => {
          setCenterPricing(center);
          const collectorPlans = plans.filter(isCollectorTier);
          setSubscriptionPlans(collectorPlans);
          setCollectorTierEdits(Object.fromEntries(collectorPlans.map((plan) => [String(plan.id), {
            name: plan.name,
            price: String(plan.price),
            minVolumeLiters: String(plan.min_volume_liters ?? 0),
            maxVolumeLiters: plan.max_volume_liters === null ? '' : String(plan.max_volume_liters),
            isActive: plan.is_active,
          }])));
          setSubscriptionPolicy(policy);
          setPaymentConfiguration(payments);
        }).catch((reason) => setError(reason.message)).finally(() => setAdminConfigLoading(false));
      }
      if (tab === 'settings') loadAccountProfile().catch((reason) => setError(reason.message));
      if (tab === 'system-health') fetch('/api/health').then(async (response) => {
        setSystemHealth(await response.json());
      }).catch((reason) => setError(reason.message));
      if (tab === 'notifications-admin') api<{ success: boolean; data: Notice[] }>('/api/notifications').then((result) => {
        setNotifications(result.data);
      }).catch((reason) => setError(reason.message));
      return;
    }
    if (tab === 'settings') {
      loadAccountProfile().catch((reason) => setError(reason.message));
      if (!isAdmin) loadBilling().catch((reason) => setError(reason.message));
      if (isCollector) loadCollectorPrices().catch((reason) => setError(reason.message));
      return;
    }
    if (tab === 'dashboard') {
      setDashboardLoading(true);
      const requests = [loadReport('current-half'), loadUnreadCount(), loadBilling()];
      if (isCollector || selectedCenter) requests.push(loadDaily());
      Promise.all(requests).catch((reason) => setError(reason.message)).finally(() => setDashboardLoading(false));
      return;
    }
    if (tab === 'centers') loadCenters().catch((reason) => setError(reason.message));
    if (tab === 'deductions') {
      loadDeductions().catch((reason) => setError(reason.message));
      loadDeductionFarmers().catch((reason) => setError(reason.message));
    }
    if (tab === 'billing') loadBilling().catch((reason) => setError(reason.message));
    if (tab === 'notifications') loadNotifications().catch((reason) => setError(reason.message));
  }, [user, tab, selectedCenter]);

  useEffect(() => {
    if (user && tab === 'dashboard' && !isCollector && selectedCenter) {
      loadDaily().catch((reason) => setError(reason.message));
    }
  }, [selectedCenter]);

  useEffect(() => {
    if (user && tab === 'farmers') loadFarmers().catch((reason) => setError(reason.message));
  }, [user, tab, farmerSearch, farmerCenter, farmerCollectorFilter, farmerSortBy, farmerSortDirection, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'milk' && (!isDairy || selectedCenter)) loadDaily().catch((reason) => setError(reason.message));
  }, [user, tab, isDairy, selectedCenter, collectionDate, ...dailyFilterState, dailySortBy, dailySortDirection]);
  useEffect(() => {
    if (user && tab === 'milk' && ifishiOpen) loadIfishiFarmers(ifishiFarmerSearch).catch((reason) => setError(reason.message));
  }, [user, tab, ifishiOpen, ifishiFarmerSearch, selectedCenter]);
  useEffect(() => {
    if (!user || tab !== 'milk' || !ifishiOpen) return;
    const { startDate, endDate } = getMonthBounds(ifishiMonth);
    if (ifishiDate < startDate || ifishiDate > endDate) setIfishiDate(startDate);
  }, [user, tab, ifishiOpen, ifishiMonth, ifishiDate]);
  useEffect(() => {
    if (!isCollector || tab !== 'milk' || !ownerIfishiOpen) return;
    const entry = ownerIfishiHistory?.entries.find((row) => row.date === ifishiDate && row.id !== null);
    setOwnerIfishiMorning(entry?.volumeMorning ? String(entry.volumeMorning) : '');
    setOwnerIfishiEvening(entry?.volumeEvening ? String(entry.volumeEvening) : '');
  }, [isCollector, tab, ownerIfishiOpen, ownerIfishiHistory, ifishiDate]);
  useEffect(() => {
    if (!user || tab !== 'milk' || (!ownerIfishiOpen && !ownerIfishiHistoryOpen)) return;
    const startDate = `${ifishiMonth}-${ownerIfishiPeriod === 'first-half' ? '01' : '16'}`;
    const endDate = ownerIfishiPeriod === 'first-half'
      ? `${ifishiMonth}-15`
      : `${ifishiMonth}-${String(new Date(Number(ifishiMonth.slice(0, 4)), Number(ifishiMonth.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
    if (ifishiDate < startDate || ifishiDate > endDate) setIfishiDate(startDate);
  }, [user, tab, ownerIfishiOpen, ifishiMonth, ownerIfishiPeriod, ifishiDate]);
  useEffect(() => {
    if (user && tab === 'milk' && ifishiOpen && ifishiFarmerId) loadIfishiRecords().catch((reason) => setError(reason.message));
  }, [user, tab, ifishiOpen, ifishiFarmerId, ifishiMonth, ifishiDate, ifishiRecordSession, ifishiRecordSortBy, ifishiRecordSortDirection]);
  useEffect(() => {
    if (user && isCollector && tab === 'milk' && (ownerIfishiOpen || ownerIfishiHistoryOpen)) loadOwnerIfishiHistory().catch(() => undefined);
  }, [user, isCollector, tab, ownerIfishiOpen, ownerIfishiHistoryOpen, ifishiMonth, ownerIfishiPeriod]);
  useEffect(() => {
    if (user && (tab === 'ukwezi' || tab === 'transport')) loadUkwezi().catch((reason) => setError(reason.message));
  }, [user, tab, ukweziMonth, ukweziYear, ukweziPeriod, ukweziSortBy, ukweziSortDirection, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'reports') loadReport().catch((reason) => setError(reason.message));
  }, [user, tab, reportMonth, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'settlements') loadSettlementData().catch((reason) => setError(reason.message));
  }, [user, tab, settlementMonth, settlementHalf, isDairy]);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
    sessionStorage.removeItem('milk-session-user');
    setUser(null);
  };

  if (authLoading) return <main className="boot-screen"><BrandLockup imageSize={44} /><small className="boot-company">Milk System Technologies Ltd.</small><div className="loading-status" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true" />{publicLanguage.t('loading')}</div></main>;
  if (authError) return <main className="boot-screen boot-screen-error"><BrandLockup imageSize={44} /><small className="boot-company">Milk System Technologies Ltd.</small><section className="boot-error-panel" role="alert"><h1>Unable to start Milk System.</h1><p>Please check your connection and try again.</p><button type="button" className="button button-primary" onClick={() => { setAuthError(''); setAuthLoading(true); setAuthAttempt((attempt) => attempt + 1); }}>Retry</button></section></main>;
  if (!user) return <Login {...publicLanguage} onLogin={(signedIn) => { sessionStorage.setItem('milk-session-user', JSON.stringify(signedIn)); setTab('dashboard'); setUser(signedIn); }} />;

  const openIfishiForFarmer = (farmerId: number | null, farmerName?: string, farmerDetails?: Farmer) => {
    if (!farmerId) return;
    setTab('milk');
    setOwnerIfishiOpen(false);
    setIfishiOpen(true);
    setIfishiFarmerId(String(farmerId));
    setIfishiDate(today());
    if (farmerName) {
      setIfishiFarmerSearch(farmerName);
      const dailyFarmer = daily.find((farmer) => farmer.farmerId === farmerId);
      const selectedFarmer = farmerDetails
        || farmers?.data.find((farmer) => farmer.id === farmerId)
        || ifishiFarmers.find((farmer) => farmer.id === farmerId)
        || {
          id: farmerId,
          name: farmerName,
          location: dailyFarmer?.collectionCenter || null,
          phone: dailyFarmer?.phone || null,
          nationalId: dailyFarmer?.nationalId || null,
          accountNumber: null,
          collectionCenter: dailyFarmer?.collectionCenter || null,
          cowType: null,
          collectorUserId: isCollector ? user?.id : null,
        };
      setIfishiFarmers([selectedFarmer]);
    }
  };

  const selectOwnerIfishiDate = (date: string) => {
    if (!date) return;
    const day = Number(date.slice(8, 10));
    setIfishiDate(date);
    setIfishiMonth(date.slice(0, 7));
    setOwnerIfishiPeriod(day <= 15 ? 'first-half' : 'second-half');
    const entry = ownerIfishiHistory?.entries.find((row) => row.date === date && row.id !== null);
    setOwnerIfishiMorning(entry?.volumeMorning ? String(entry.volumeMorning) : '');
    setOwnerIfishiEvening(entry?.volumeEvening ? String(entry.volumeEvening) : '');
  };

  const openOwnerIfishiEntry = (date = today()) => {
    selectOwnerIfishiDate(date);
    setOwnerIfishiSaveError('');
    setOwnerIfishiSaveStatus('');
    setOwnerIfishiOpen(true);
  };

  const createFarmer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (farmerCreateSubmittingRef.current) return;
    farmerCreateSubmittingRef.current = true;
    setBusy(true);
    setFarmerCreateError('');
    try {
      const payload: any = { ...farmerForm };
      if (isDairy && selectedCenter) payload.collectionCenterId = Number(selectedCenter);
      if (payload.collectionCenterId) {
        const center = centers.find((candidate) => String(candidate.id) === String(payload.collectionCenterId));
        payload.collectionCenter = center?.name;
        payload.collectionCenterId = Number(payload.collectionCenterId);
      }
      const created = await api<Farmer>('/api/farmers', json('POST', payload));
      const params = buildFarmerListQuery({
        userAccountType: user.accountType,
        userId: user.id,
        selectedCollectorId: farmerCollectorFilter,
        farmerSearch,
        farmerCenter: isDairy && selectedCenter ? centers.find((center) => String(center.id) === selectedCenter)?.name || '' : farmerCenter,
        limit: 50,
      });
      const refreshed = await api<Page<Farmer>>(`/api/farmers?${params}`, { cache: 'no-store' });
      if (!refreshed.data.some((farmer) => farmer.id === created.id)) {
        throw new Error('Farmer was saved, but the refreshed farmer list did not return it.');
      }
      setFarmerSearch('');
      setFarmerQuery('');
      setFarmerCenter('');
      setFarmers(refreshed);
      setFarmerForm({ name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
      setFarmerCreateOpen(false);
    } catch (reason) {
      setFarmerCreateError(reason instanceof Error ? reason.message : 'Failed to save farmer.');
    } finally {
      farmerCreateSubmittingRef.current = false;
      setBusy(false);
    }
  };

  const linkCollector = async (event: React.FormEvent) => {
    event.preventDefault();
    if (collectorLinkSubmittingRef.current) return;
    collectorLinkSubmittingRef.current = true;
    setBusy(true);
    setCollectorLinkError('');
    try {
      await api('/api/collector-assignments', json('POST', { collectorUserId: Number(collectorLinkId) }));
      await loadCollectorAssignments();
      setCollectorLinkId('');
      setCollectorLinkOpen(false);
    } catch (reason) {
      setCollectorLinkError(reason instanceof Error ? reason.message : 'Failed to add Umucunda.');
    } finally {
      collectorLinkSubmittingRef.current = false;
      setBusy(false);
    }
  };
  const unlinkCollector = async (collectorId: number) => run(async () => {
    await api(`/api/collector-assignments/${collectorId}`, { method: 'DELETE' });
    await loadCollectorAssignments();
    await loadFarmers();
    setNotice('Collector unlinked; farmer assignments were cleared.');
  });

  const editFarmerStart = (farmer: Farmer) => {
    setEditingFarmer(farmer);
    const currentCenterName = String(farmer.collectionCenter || '').trim().toLocaleLowerCase();
    const currentCenter = collectorOwnedCenters.find((center) => center.name.trim().toLocaleLowerCase() === currentCenterName);
    setFarmerEdit({ name: farmer.name, collectionCenterId: currentCenter ? String(currentCenter.id) : '', phone: farmer.phone || '', nationalId: farmer.nationalId || '', accountNumber: farmer.accountNumber || '', cowType: farmer.cowType || '', collectorUserId: farmer.collectorUserId ? String(farmer.collectorUserId) : '' });
  };
  const saveFarmer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFarmer) return;
    await run(async () => {
      const payload: any = { ...farmerEdit };
      if (isDairy && selectedCenter) payload.collectionCenterId = Number(selectedCenter);
      if (payload.collectionCenterId) {
        const center = centers.find((candidate) => String(candidate.id) === String(payload.collectionCenterId));
        payload.collectionCenter = center?.name;
        payload.collectionCenterId = Number(payload.collectionCenterId);
      }
      await api(`/api/farmers/${editingFarmer.id}`, json('PUT', payload));
      setEditingFarmer(null);
      await loadFarmers();
      openIfishiForFarmer(editingFarmer.id, editingFarmer.name);
      setNotice('Farmer details saved.');
    });
  };

  const deleteFarmer = async (farmer: Farmer) => {
    if (!window.confirm(`Delete ${farmer.name}? This also removes linked milk history.`)) return;
    await run(async () => {
      await api(`/api/farmers/${farmer.id}`, { method: 'DELETE' });
      await loadFarmers();
      setNotice('Farmer deleted.');
    });
  };

  const createCenter = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api('/api/collection-centers', json('POST', {
        ...centerForm,
        pricePerLiter: Number(centerForm.pricePerLiter || 0),
        transportRatePerLiter: Number(centerForm.transportRatePerLiter || 0),
      }));
      setCenterForm({ name: '', pricePerLiter: '', transportRatePerLiter: '0', morningStart: '06:30', morningEnd: '09:00', eveningStart: '17:30', eveningEnd: '19:00' });
      await loadCenters();
      setNotice('Collection center added.');
    });
  };
  const saveCenter = async (center: Center) => run(async () => {
    await api(`/api/collection-centers/${center.id}`, json('PUT', centerEdits[center.id] || {}));
    setCenterEdits((current) => { const next = { ...current }; delete next[center.id]; return next; });
    await loadCenters();
    setNotice('Center settings saved.');
  });

  const saveMilk = async (row: DailyRow) => run(async () => {
    const value = volumes[row.farmerId] || { morning: '', evening: '' };
    const payload = { farmerId: row.farmerId, date: collectionDate, volumeMorning: Number(value.morning || 0), volumeEvening: Number(value.evening || 0) };
    let result: unknown;
    try {
      result = await api('/api/milk', json('POST', payload));
    } catch (reason) {
      if (navigator.onLine && !(reason instanceof TypeError)) throw reason;
      await queueOfflineWrite({ ownerId: user!.id, url: '/api/milk', method: 'POST', body: payload });
      setPendingWrites((count) => count + 1);
      setNotice(`Entry queued offline for ${row.farmerName}.`);
      return;
    }
    setNotice(`Saved ${row.farmerName}'s collection.`);
    if (result) await loadDaily();
  });
  const saveIfishiEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setIfishiSaveError('');
    setIfishiSaveStatus('');
    try {
      await api('/api/milk', json('POST', {
        farmerId: Number(ifishiFarmerId),
        date: ifishiDate,
        volumeMorning: Number(ifishiMorning || 0),
        volumeEvening: Number(ifishiEvening || 0),
      }));
      setIfishiSaveStatus(publicLanguage.t('ifishiSaved'));
      try {
        await loadIfishiRecords();
        await loadDaily();
      } catch (reason) {
        setIfishiSaveError(reason instanceof Error ? reason.message : 'Milk was saved, but the list could not be refreshed.');
      }
    } catch (reason) {
      setIfishiSaveError(reason instanceof Error ? reason.message : 'Failed to save Ifishi entry.');
    } finally {
      setBusy(false);
    }
  };
  const saveOwnerIfishiEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    const existing = ownerIfishiHistory?.entries.find((entry) => entry.date === ifishiDate && entry.id !== null);
    const path = existing ? `/api/ifishi/owner/${existing.id}` : '/api/ifishi/owner';
    setBusy(true);
    setOwnerIfishiSaveError('');
    setOwnerIfishiSaveStatus('');
    try {
      const saved = await api<OwnerIfishiEntry>(path, json(existing ? 'PUT' : 'POST', {
        date: ifishiDate,
        volumeMorning: Number(ownerIfishiMorning || 0),
        volumeEvening: Number(ownerIfishiEvening || 0),
      }));
      if (!saved?.id) throw new Error('The server did not return the saved Owner Ifishi record.');
      setOwnerIfishiSaveStatus(publicLanguage.t(existing ? 'ownerIfishiCorrected' : 'ownerIfishiSaved'));
      try {
        await loadOwnerIfishiHistory();
      } catch (reason) {
        setOwnerIfishiSaveError(reason instanceof Error ? reason.message : publicLanguage.t('ownerIfishiLoadError'));
      }
    } catch (reason) {
      setOwnerIfishiSaveError(reason instanceof Error ? reason.message : 'Failed to save Owner Ifishi entry.');
    } finally {
      setBusy(false);
    }
  };
  const createDeduction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (deductionSubmittingRef.current) return;
    deductionSubmittingRef.current = true;
    setBusy(true);
    setDeductionCreateError('');
    try {
      await api('/api/deductions', json('POST', { ...deductionForm, farmerId: Number(deductionForm.farmerId), amount: Number(deductionForm.amount) }));
      setDeductionCreateOpen(false);
      setDeductionForm({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
      setDeductionFarmerSearch('');
      setNotice(publicLanguage.t('deductionsSaved'));
      try {
        await Promise.all([loadDeductions(), loadReport()]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Deduction was saved, but the accounting view could not be refreshed.');
      }
    } catch (reason) {
      setDeductionCreateError(reason instanceof Error ? reason.message : 'Failed to record deduction.');
    } finally {
      deductionSubmittingRef.current = false;
      setBusy(false);
    }
  };

  const paySubscription = async () => run(async () => {
    if (!billing?.pricing) throw new Error(publicLanguage.t('subscriptionUnavailable'));
    const result = await api<any>('/api/subscription/payments', json('POST', { billingPeriod, planCode: selectedSubscriptionPlanCode }));
    setNotice(result.message || 'Payment request submitted.');
    await loadBilling().catch(() => undefined);
  });

  const checkCustomerPayment = async (paymentId: number) => run(async () => {
    const result = await api<{ status: string }>(`/api/subscription/payments/${paymentId}`);
    await loadBilling();
    setNotice(`Payment status: ${result.status}.`);
  });

  const checkAdminPayment = async (paymentId: number) => run(async () => {
    await api(`/api/admin/payments/${paymentId}`, { method: 'POST' });
    await loadAdminPayments();
    setNotice('Payment status refreshed.');
  });

  const saveCollectorPrice = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api('/api/collector-milk-prices', json('POST', {
        pricePerLiter: Number(collectorPriceForm.pricePerLiter),
        effectiveDate: collectorPriceForm.effectiveDate,
      }));
      setCollectorPriceForm((form) => ({ ...form, pricePerLiter: '' }));
      await loadCollectorPrices();
      setNotice(publicLanguage.t('collectorPriceSaved'));
    });
  };

  const saveAdminCollectorPrices = async () => run(async () => {
    const tiers = subscriptionPlans.filter(isCollectorTier).map((plan, sortOrder) => {
      const edit = collectorTierEdits[String(plan.id)];
      const maximum = edit?.maxVolumeLiters ?? (plan.max_volume_liters === null ? '' : String(plan.max_volume_liters));
      return {
        id: plan.id > 0 ? plan.id : null,
        name: edit?.name ?? plan.name,
        price: Number(edit?.price ?? plan.price),
        minVolumeLiters: Number(edit?.minVolumeLiters ?? plan.min_volume_liters ?? 0),
        maxVolumeLiters: maximum.trim() === '' ? null : Number(maximum),
        isActive: edit?.isActive ?? plan.is_active,
        sortOrder,
      };
    });
    const plans = await api<SubscriptionPlan[]>('/api/admin/config/plans', json('PUT', { tiers }));
    const savedCollectorPlans = plans.filter(isCollectorTier);
    setSubscriptionPlans(savedCollectorPlans);
    setCollectorTierEdits(Object.fromEntries(savedCollectorPlans.map((plan) => [String(plan.id), {
      name: plan.name,
      price: String(plan.price),
      minVolumeLiters: String(plan.min_volume_liters ?? 0),
      maxVolumeLiters: plan.max_volume_liters === null ? '' : String(plan.max_volume_liters),
      isActive: plan.is_active,
    }])));
    setNotice(publicLanguage.t('pricingSaved'));
  });

  const saveSubscriptionPolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      if (!subscriptionPolicy) return;
      const saved = await api<SubscriptionPolicy>('/api/admin/config/subscription', json('PUT', {
        initialAccessDays: Number(subscriptionPolicy.initial_access_days),
        gracePeriodDays: Number(subscriptionPolicy.grace_period_days),
        enforcementTime: subscriptionPolicy.enforcement_time.slice(0, 5),
        timeZone: subscriptionPolicy.time_zone,
      }));
      setSubscriptionPolicy(saved);
      setNotice(publicLanguage.t('subscriptionPolicySaved'));
    });
  };

  const saveAccountSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const requestedEmail = accountForm.email;
      const result = await api<{ user: AccountProfile; emailChangePending: boolean; pendingEmail: string | null }>('/api/auth/profile', json('PUT', { ...accountForm, language: publicLanguage.language }));
      setAccountProfile(result.user);
      setAccountForm((form) => ({ ...form, name: result.user.name, email: result.emailChangePending ? requestedEmail : result.user.email, phone: result.user.phone || '', nationalId: result.user.nationalId || '', accountNumber: result.user.accountNumber || '', profilePicture: result.user.profilePicture || '' }));
      setPaymentPhone(result.user.phone || '');
      const updatedUser = { ...user!, name: result.user.name, email: result.user.email };
      sessionStorage.setItem('milk-session-user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setAccountEmailChangePending(result.emailChangePending);
      setAccountPendingEmail(result.pendingEmail || '');
      setNotice(result.emailChangePending ? publicLanguage.t('accountEmailChangePending') : publicLanguage.t('accountSaved'));
    });
  };

  const changeAccountPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newAccountPassword !== confirmAccountPassword) {
      setError(publicLanguage.t('passwordMismatch'));
      return;
    }
    await run(async () => {
      await api('/api/auth/change-password', json('POST', { currentPassword, newPassword: newAccountPassword }));
      setCurrentPassword('');
      setNewAccountPassword('');
      setConfirmAccountPassword('');
      setAccountPasswordVisibility({ current: false, next: false, confirm: false });
      setNotice(publicLanguage.t('accountPasswordChanged'));
    });
  };

  const updateAccountAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setAccountAvatarError(publicLanguage.t('accountAvatarInvalid'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAccountAvatarError(publicLanguage.t('accountAvatarTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAccountForm((form) => ({ ...form, profilePicture: String(reader.result || '') }));
      setAccountAvatarError('');
    };
    reader.readAsDataURL(file);
  };

  const markRead = async (notification: Notice) => run(async () => {
    await api(`/api/notifications/${notification.id}/read`, { method: 'PATCH' });
    await loadNotifications();
  });

  const markAllNotificationsRead = async () => run(async () => {
    await api('/api/notifications/read-all', { method: 'PATCH' });
    await loadNotifications();
  });

  const toggleNotificationPanel = () => {
    const open = !notificationPanelOpen;
    setNotificationPanelOpen(open);
    if (open) loadNotifications().catch((reason) => setError(reason.message));
  };

  const adminAction = async (account: Account, action: string) => run(async () => {
    await api(`/api/admin/accounts/${account.user_id}/${action}`, json('POST', {}));
    await loadAccounts();
    setNotice(`Account ${action} complete.`);
  });

  const openAbacundaIfishi = (assignment: CollectorAssignment) => {
    setAbacundaIfishiCollector(assignment);
    setAbacundaIfishiHistory(null);
    setAbacundaIfishiMonth(today().slice(0, 7));
    void loadAbacundaIfishi(assignment.collector_user_id, today().slice(0, 7));
  };

  const renderAbacundaDirectory = () => {
    const activeCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name || '—';
    const assignedAbacundaCount = collectorAssignments.reduce((total, assignment) => total + Number(assignment.abacunda_count || 0), 0);
    return <>
      <section className="panel panel-wide abacunda-directory">
        <div className="panel-heading"><div><span className="eyebrow">Active Ikigo</span><h2>{activeCenterName}</h2></div><Building2 size={19} aria-hidden="true" /></div>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('directory')}</span><h2>{publicLanguage.t('navAbacunda')}</h2></div><div className="panel-heading-actions"><span className="count-label">{assignedAbacundaCount}</span><label className="collector-sort-mobile">{publicLanguage.t('sort')}<select value={collectorAssignmentSortDirection} onChange={(event) => { const direction = event.target.value as typeof collectorAssignmentSortDirection; setCollectorAssignmentSortDirection(direction); void loadCollectorAssignments(direction).catch((reason) => setError(reason.message)); }}><option value="asc">{publicLanguage.t('milkFarmer')} ↑</option><option value="desc">{publicLanguage.t('milkFarmer')} ↓</option></select></label></div></div>
        {collectorAssignmentsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />Loading assigned Abacunda…</div>
          : collectorAssignmentsError ? <div className="workspace-empty" role="alert"><b>{collectorAssignmentsError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadCollectorAssignments().catch(() => undefined)}>Retry</button></div>
          : !selectedCenter ? <div className="workspace-empty" role="status"><b>No active Ikigo is available for this account.</b></div>
          : collectorAssignments.length ? <>
          <div className="table-scroll abacunda-desktop-list"><table><thead><tr><th aria-sort={collectorAssignmentSortDirection === 'asc' ? 'ascending' : 'descending'}><button type="button" className="farmer-sort-button" onClick={() => { const direction = collectorAssignmentSortDirection === 'asc' ? 'desc' : 'asc'; setCollectorAssignmentSortDirection(direction); void loadCollectorAssignments(direction).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('assignedCollectors')}{collectorAssignmentSortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button></th><th>{publicLanguage.t('accountNationalId')}</th><th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{publicLanguage.t('navAbacunda')}</th><th>{publicLanguage.t('navIfishi')}</th></tr></thead><tbody>{collectorAssignments.map((assignment) => <tr key={assignment.collector_user_id}><td className="strong-cell">{assignment.collector_name}</td><td>{assignment.collector_national_id || '—'}</td><td>{[assignment.collector_phone, assignment.collector_account_number].filter(Boolean).join(' / ') || '—'}</td><td>{assignment.abacunda_count}</td><td><button type="button" className="text-button" onClick={() => openAbacundaIfishi(assignment)}>{publicLanguage.t('navIfishi')}</button></td></tr>)}</tbody></table></div>
          <div className="abacunda-mobile-list">{collectorAssignments.map((assignment) => <article className="abacunda-mobile-card" key={assignment.collector_user_id}><header><b>{assignment.collector_name}</b><span>{assignment.abacunda_count} {publicLanguage.t('navAbacunda').toLowerCase()}</span></header><p>{[assignment.collector_phone, assignment.collector_account_number].filter(Boolean).join(' / ') || '—'}</p><button type="button" className="button button-secondary small-button" onClick={() => openAbacundaIfishi(assignment)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button></article>)}</div>
        </> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Users size={21} aria-hidden="true" /></span><b>{publicLanguage.t('noCollectorsLinked')}</b></div>}
      </section>
      {abacundaIfishiCollector ? <Modal ariaLabel={`${abacundaIfishiCollector.collector_name} · ${publicLanguage.t('navIfishi')}`} className="abacunda-ifishi-panel modal-panel-wide" onClose={() => setAbacundaIfishiCollector(null)} dismissible={!abacundaIfishiLoading}>
        <div className="panel-heading"><div><span className="eyebrow">{activeCenterName}</span><h2 id="abacunda-ifishi-title">{abacundaIfishiCollector.collector_name} · {publicLanguage.t('navIfishi')}</h2></div><button type="button" className="icon-button" onClick={() => setAbacundaIfishiCollector(null)} disabled={abacundaIfishiLoading} aria-label={publicLanguage.t('cancel')}><X size={18} /></button></div>
          <div className="toolbar abacunda-ifishi-toolbar"><label>{publicLanguage.t('ifishiMonth')}<input type="month" max={today().slice(0, 7)} value={abacundaIfishiMonth} onChange={(event) => { if (!event.target.value) return; setAbacundaIfishiMonth(event.target.value); void loadAbacundaIfishi(abacundaIfishiCollector.collector_user_id, event.target.value); }} /></label></div>
        {abacundaIfishiLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}
        {abacundaIfishiError ? <div className="workspace-empty" role="alert"><b>{abacundaIfishiError}</b></div> : null}
        {abacundaIfishiHistory ? <>
          <p className="muted-note">{abacundaIfishiHistory.startDate} – {abacundaIfishiHistory.endDate}</p>
          <div className="metric-strip abacunda-ifishi-summary"><div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(abacundaIfishiHistory.totals.morningLiters)} L</b></div><div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(abacundaIfishiHistory.totals.eveningLiters)} L</b></div><div><span>{publicLanguage.t('ifishiValid')}</span><b>{liters(abacundaIfishiHistory.totals.validLiters)} L</b></div><div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(abacundaIfishiHistory.totals.lostLiters)} L</b></div></div>
          {abacundaIfishiHistory.entries.length ? <><div className="table-scroll abacunda-ifishi-desktop-list"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th><th>{publicLanguage.t('milkTotal')} · L</th><th>{publicLanguage.t('ifishiLost')} · L</th><th>{publicLanguage.t('ifishiReason')}</th></tr></thead><tbody>{abacundaIfishiHistory.entries.map((entry) => <tr key={entry.date}><td>{entry.date}</td><td>{liters(entry.morningLiters)}</td><td>{liters(entry.eveningLiters)}</td><td>{liters(entry.validLiters)}</td><td>{liters(entry.lostLiters)}</td><td>{entry.reason || entry.status}</td></tr>)}</tbody></table></div><div className="abacunda-ifishi-mobile-list">{abacundaIfishiHistory.entries.map((entry) => <article className="owner-ifishi-day" key={entry.date}><header><b>{entry.date}</b><span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span></header><dl><div><dt>{publicLanguage.t('dashboardMorning')}</dt><dd>{liters(entry.morningLiters)} L</dd></div><div><dt>{publicLanguage.t('dashboardEvening')}</dt><dd>{liters(entry.eveningLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiValid')}</dt><dd>{liters(entry.validLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostLiters)} L</dd></div></dl>{entry.reason ? <p>{entry.reason}</p> : null}</article>)}</div></> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('ownerIfishiEmpty')}</b></div>}
        </> : null}
      </Modal> : null}
    </>;
  };

  const renderFarmers = () => (
    <div className="screen-grid farmers-view">
      {isDairy && !centers.length ? <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('configuration')}</span><h2>{publicLanguage.t('centerName')}</h2></div><Building2 size={19} aria-hidden="true" /></div>
        <form className="toolbar" onSubmit={createCenter}>
          <label>{publicLanguage.t('centerName')}<input required maxLength={100} value={centerForm.name} onChange={(event) => setCenterForm({ ...centerForm, name: event.target.value })} /></label>
          <label>{publicLanguage.t('milkPrice')} · RWF/L<input required type="number" min="1" step="0.01" value={centerForm.pricePerLiter} onChange={(event) => setCenterForm({ ...centerForm, pricePerLiter: event.target.value })} /></label>
          <button className="button button-primary" disabled={busy || !centerForm.name.trim() || !centerForm.pricePerLiter}><Plus size={16} />{publicLanguage.t('addCenter')}</button>
        </form>
      </section> : null}
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{isDairy ? publicLanguage.t('dashboardCenter') : publicLanguage.t('directory')}</span><h2>{publicLanguage.t('navFarmers')}</h2></div><div className="panel-heading-actions"><span className="count-label">{farmers ? `${farmers.data.length} ${publicLanguage.t('farmersLoaded')}` : '…'}{isDairy && selectedCenter ? ` · ${centers.find((center) => String(center.id) === selectedCenter)?.name || ''}` : !isDairy ? ` · ${publicLanguage.t('pageSize')}` : ''}</span><button type="button" className="button button-primary small-button" onClick={() => { setFarmerCreateError(''); setFarmerCreateOpen(true); }} disabled={Boolean((isCollector || isDairy) && !selectedCenter)}><Plus size={15} aria-hidden="true" />{publicLanguage.t('farmersAdd')}</button></div></div>
        <div className="toolbar farmers-toolbar">
          <form className={['search', 'form'].join('-')} onSubmit={(event) => { event.preventDefault(); setFarmerSearch(farmerQuery.trim()); }}><Search size={17} /><input aria-label={publicLanguage.t('farmersSearchPlaceholder')} placeholder={publicLanguage.t('farmersSearchPlaceholder')} value={farmerQuery} onChange={(event) => setFarmerQuery(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form>
          {isDairy ? centers.length > 1 ? <select aria-label="Active Ikigo" value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select> : null : <select aria-label={publicLanguage.t('allCenters')} value={farmerCenter} onChange={(event) => setFarmerCenter(event.target.value)}><option value="">{publicLanguage.t('allCenters')}</option>{centers.map((center) => <option key={center.id} value={center.name}>{center.name}</option>)}</select>}
          {!isDairy && user?.accountType === 'COLLECTION_CENTER' ? <select aria-label={publicLanguage.t('assignedCollector')} value={farmerCollectorFilter} onChange={(event) => setFarmerCollectorFilter(event.target.value)}><option value="">{publicLanguage.t('allCollectors')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={String(assignment.collector_user_id)}>{assignment.collector_name}</option>)}</select> : null}
          <select className="farmer-sort-mobile" aria-label={publicLanguage.t('sort')} value={farmerSortBy ? `${farmerSortBy}:${farmerSortDirection}` : ''} onChange={(event) => {
            const [field, direction] = event.target.value.split(':');
            if (['name', 'nationalId', 'collectionCenter'].includes(field) && ['asc', 'desc'].includes(direction)) {
              setFarmerSortBy(field as typeof farmerSortBy);
              setFarmerSortDirection(direction as typeof farmerSortDirection);
            }
          }}>
            <option value="">{publicLanguage.t('sort')}</option>
            <option value="name:asc">{publicLanguage.t('columnName')} ↑</option>
            <option value="name:desc">{publicLanguage.t('columnName')} ↓</option>
            <option value="nationalId:asc">{publicLanguage.t('accountNationalId')} ↑</option>
            <option value="nationalId:desc">{publicLanguage.t('accountNationalId')} ↓</option>
            <option value="collectionCenter:asc">{publicLanguage.t('columnCenter')} ↑</option>
            <option value="collectionCenter:desc">{publicLanguage.t('columnCenter')} ↓</option>
          </select>
        </div>
        {!isCollector && !isDairy ? <div className="assignment-tool">
          <div><span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span><h3>{publicLanguage.t('assignedCollectors')}</h3></div>
          <button type="button" className="button button-secondary" onClick={() => { setCollectorLinkError(''); setCollectorLinkOpen(true); }}><Plus size={15} aria-hidden="true" />{publicLanguage.t('collectorAdd')}</button>
          <div className="assignment-list">{collectorAssignments.map((assignment) => <div className="assignment-chip" key={assignment.collector_user_id}><span><b>{assignment.collector_name}</b><small>{assignment.collector_account_number || assignment.collector_user_id} · {assignment.abacunda_count} {accountCopy('navFarmers', 'abacundaLabel').toLowerCase()}</small></span><button className="text-button danger-text" onClick={() => unlinkCollector(assignment.collector_user_id)}>{publicLanguage.t('delete')}</button></div>)}{!collectorAssignments.length ? <span className="muted-note">{publicLanguage.t('noCollectorsLinked')}</span> : null}</div>
          {collectorLinkOpen ? <Modal ariaLabel={publicLanguage.t('linkCollector')} onClose={() => setCollectorLinkOpen(false)} dismissible={!busy}>
            <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span><h2>{publicLanguage.t('collectorAdd')}</h2></div><button type="button" className="icon-button" onClick={() => setCollectorLinkOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
            <form className="form-stack" onSubmit={linkCollector}>
              <label>{publicLanguage.t('collectorAccountId')}<input type="number" min="1" step="1" required value={collectorLinkId} onChange={(event) => setCollectorLinkId(event.target.value)} /></label>
              {collectorLinkError ? <p className="form-error" role="alert">{collectorLinkError}</p> : null}
              <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setCollectorLinkOpen(false)} disabled={busy}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy || !collectorLinkId}>{busy ? publicLanguage.t('wait') : publicLanguage.t('linkCollector')}</button></div>
            </form>
          </Modal> : null}
        </div> : null}
        <div className="table-scroll farmers-desktop-table"><table><thead><tr>
          {([
            ['name', publicLanguage.t('columnName')],
            ['location', publicLanguage.t('columnLocation')],
            ['phone', publicLanguage.t('columnPhone')],
            ['nationalId', publicLanguage.t('accountNationalId')],
            ['collectionCenter', publicLanguage.t('columnCenter')],
          ] as const).map(([field, label]) => {
            const sortable = field === 'name' || field === 'nationalId' || field === 'collectionCenter';
            const active = farmerSortBy === field;
            const SortIcon = active ? farmerSortDirection === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
            return <th key={field} aria-sort={active ? farmerSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
              {sortable ? <button type="button" className="farmer-sort-button" onClick={() => {
                if (farmerSortBy === field) setFarmerSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
                else { setFarmerSortBy(field); setFarmerSortDirection('asc'); }
              }}>{label}<SortIcon size={13} aria-hidden="true" /></button> : label}
            </th>;
          })}
          <th>{publicLanguage.t('actions')}</th>
        </tr></thead><tbody>
          {(farmers?.data || []).map((farmer) => <tr key={farmer.id}><td className="strong-cell">{farmer.name}</td><td>{farmer.location || '—'}</td><td>{farmer.phone || '—'}</td><td>{farmer.nationalId || '—'}</td><td>{farmer.collectionCenter || '—'}</td><td className="actions-cell"><button className="text-button" onClick={() => editFarmerStart(farmer)}>{publicLanguage.t('edit')}</button><button className="text-button danger-text" onClick={() => deleteFarmer(farmer)}>{publicLanguage.t('delete')}</button></td></tr>)}
        </tbody></table></div>
        {farmers ? farmers.data.length ? <div className="farmer-mobile-list">{farmers.data.map((farmer) => <article className="farmer-mobile-card" key={farmer.id}><header><b>{farmer.name}</b><span>{farmer.collectionCenter || farmer.location || '—'}</span></header><dl><div><dt>{publicLanguage.t('columnLocation')}</dt><dd>{farmer.location || '—'}</dd></div><div><dt>{publicLanguage.t('columnPhone')}</dt><dd>{farmer.phone || '—'}</dd></div><div><dt>{publicLanguage.t('columnNationalId')}</dt><dd>{farmer.nationalId || '—'}</dd></div><div><dt>{publicLanguage.t('columnCenter')}</dt><dd>{farmer.collectionCenter || '—'}</dd></div>{!isDairy ? <div><dt>{publicLanguage.t('assignedCollector')}</dt><dd>{getFarmerCollectorName(farmer.collectorUserId)}</dd></div> : null}</dl><footer><button type="button" className="button button-secondary small-button" onClick={() => openIfishiForFarmer(farmer.id, farmer.name)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button><button className="button button-secondary small-button" onClick={() => editFarmerStart(farmer)}>{publicLanguage.t('edit')}</button><button className="button button-secondary small-button danger-text" onClick={() => deleteFarmer(farmer)}>{publicLanguage.t('delete')}</button></footer></article>)}</div> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Users size={21} aria-hidden="true" /></span><div><b>{publicLanguage.t('farmersEmptyTitle')}</b><p>{publicLanguage.t('farmersEmptyBody')}</p></div>{farmerSearch || farmerCenter || farmerCollectorFilter ? <button type="button" className="button button-secondary small-button" onClick={() => { setFarmerSearch(''); setFarmerQuery(''); setFarmerCenter(''); setFarmerCollectorFilter(''); }}>{publicLanguage.t('milkClearSearch')}</button> : <button type="button" className="button button-primary small-button" onClick={() => { setFarmerCreateError(''); setFarmerCreateOpen(true); }}><Plus size={15} />{publicLanguage.t('farmersAdd')}</button>}</div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
        {farmers?.hasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => loadFarmers(farmers.nextCursor, true)}>{publicLanguage.t('milkLoadMore')} <ChevronDown size={16} /></button></div> : null}
      </section>
      {farmerCreateOpen ? <Modal ariaLabel={publicLanguage.t('farmersAdd')} onClose={() => setFarmerCreateOpen(false)} dismissible={!busy}>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('newRecord')}</span><h2>{publicLanguage.t('farmersAdd')}</h2></div><button type="button" className="icon-button" onClick={() => setFarmerCreateOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack compact" onSubmit={createFarmer}>
          <label>{publicLanguage.t('fullName')}<input id="new-farmer-name" autoComplete="name" required value={farmerForm.name} onChange={(event) => setFarmerForm({ ...farmerForm, name: event.target.value })} /></label>
          {isCollector ? <>
            <label>{publicLanguage.t('columnLocation')}<select aria-label={publicLanguage.t('columnLocation')} value={farmerForm.collectionCenterId} onChange={(event) => setFarmerForm({ ...farmerForm, collectionCenterId: event.target.value })} required disabled={!collectorOwnedCenters.length}><option value="">{publicLanguage.t('selectCenter')}</option>{collectorOwnedCenters.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>
            {!collectorOwnedCenters.length ? <p className="muted-note" role="status">{publicLanguage.t('farmerNoCenters')}</p> : null}
          </> : isDairy ? <><label>Active Ikigo<input readOnly value={centers.find((center) => String(center.id) === selectedCenter)?.name || ''} required /></label>{!centers.length ? <p className="muted-note" role="status">{publicLanguage.t('farmerNoCenters')}</p> : null}</> : <label>{publicLanguage.t('columnCenter')}<select value={farmerForm.collectionCenterId} onChange={(event) => setFarmerForm({ ...farmerForm, collectionCenterId: event.target.value })} required><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>}
          <label>{publicLanguage.t('columnPhone')}<input type="tel" inputMode="tel" autoComplete="tel" maxLength={50} value={farmerForm.phone} onChange={(event) => setFarmerForm({ ...farmerForm, phone: event.target.value })} /></label>
          <label>{publicLanguage.t('columnNationalId')}<input value={farmerForm.nationalId} onChange={(event) => setFarmerForm({ ...farmerForm, nationalId: event.target.value })} /></label>
          <label>{publicLanguage.t('accountNumber')}<input value={farmerForm.accountNumber} onChange={(event) => setFarmerForm({ ...farmerForm, accountNumber: event.target.value })} /></label>
          <label>{publicLanguage.t('cowType')}<input value={farmerForm.cowType} onChange={(event) => setFarmerForm({ ...farmerForm, cowType: event.target.value })} /></label>
          {!isCollector && !isDairy ? <label>{publicLanguage.t('assignedCollector')}<select value={farmerForm.collectorUserId} onChange={(event) => setFarmerForm({ ...farmerForm, collectorUserId: event.target.value })}><option value="">{publicLanguage.t('noCollector')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={assignment.collector_user_id}>{assignment.collector_name}</option>)}</select></label> : null}
          {farmerCreateError ? <p className="form-error" role="alert">{farmerCreateError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setFarmerCreateOpen(false)} disabled={busy}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy || ((isCollector || isDairy) && !selectedCenter)}><Plus size={16} aria-hidden="true" />{busy ? publicLanguage.t('wait') : publicLanguage.t('farmersAdd')}</button></div>
        </form>
      </Modal> : null}
      {editingFarmer ? <Modal ariaLabel={`${publicLanguage.t('edit')} ${editingFarmer.name}`} onClose={() => setEditingFarmer(null)} dismissible={!busy}><div className="panel-heading"><h2 id="edit-farmer-title">{publicLanguage.t('edit')} {editingFarmer.name}</h2><button type="button" className="icon-button" onClick={() => setEditingFarmer(null)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} /></button></div><form className="form-stack" onSubmit={saveFarmer}>
        <label>{publicLanguage.t('fullName')}<input required value={farmerEdit.name} onChange={(event) => setFarmerEdit({ ...farmerEdit, name: event.target.value })} /></label>
        {isCollector ? <>
          <label>{publicLanguage.t('columnLocation')}<select aria-label={publicLanguage.t('columnLocation')} value={farmerEdit.collectionCenterId} onChange={(event) => setFarmerEdit({ ...farmerEdit, collectionCenterId: event.target.value })} disabled={!collectorOwnedCenters.length}><option value="">{publicLanguage.t('selectCenter')}</option>{collectorOwnedCenters.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>
        </> : isDairy ? <><label>Active Ikigo<input readOnly value={centers.find((center) => String(center.id) === selectedCenter)?.name || ''} required /></label></> : <label>{publicLanguage.t('columnCenter')}<select value={farmerEdit.collectionCenterId} onChange={(event) => setFarmerEdit({ ...farmerEdit, collectionCenterId: event.target.value })} required><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>}
        <label>{publicLanguage.t('columnPhone')}<input inputMode="tel" value={farmerEdit.phone} onChange={(event) => setFarmerEdit({ ...farmerEdit, phone: event.target.value })} /></label>
        <label>{publicLanguage.t('columnNationalId')}<input value={farmerEdit.nationalId} onChange={(event) => setFarmerEdit({ ...farmerEdit, nationalId: event.target.value })} /></label>
        <label>{publicLanguage.t('accountNumber')}<input value={farmerEdit.accountNumber} onChange={(event) => setFarmerEdit({ ...farmerEdit, accountNumber: event.target.value })} /></label>
        <label>{publicLanguage.t('cowType')}<input value={farmerEdit.cowType} onChange={(event) => setFarmerEdit({ ...farmerEdit, cowType: event.target.value })} /></label>
        {!isCollector && !isDairy ? <label>{publicLanguage.t('assignedCollector')}<select value={farmerEdit.collectorUserId} onChange={(event) => setFarmerEdit({ ...farmerEdit, collectorUserId: event.target.value })}><option value="">{publicLanguage.t('noCollector')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={assignment.collector_user_id}>{assignment.collector_name}</option>)}</select></label> : null}
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditingFarmer(null)}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy}>{publicLanguage.t('saveChanges')}</button></div>
      </form></Modal> : null}
    </div>
  );

  const renderCenters = () => {
    const ownedCenters = centers.filter((center) => Number(center.owner_user_id) === Number(user?.id));
    return (
    <div className="screen-grid">
      <section className="panel panel-wide"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('configuration')}</span><h2>{publicLanguage.t('navCenters')}</h2></div><span className="count-label">{ownedCenters.length} {publicLanguage.t('centersConfigured')}</span></div>
        {ownedCenters.map((center) => { const edits = centerEdits[center.id] || {}; return <div className="center-config-row" key={center.id}><div><label>{publicLanguage.t('centerName')}<input maxLength={100} value={edits.name ?? center.name} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, name: event.target.value } })} /></label><p>{money(center.pricePerLiter)} RWF/L · transport {money(center.transportRatePerLiter)} RWF/L</p></div><div className="center-edit-grid">
          <label>{publicLanguage.t('milkPrice')}<input type="number" min="1" step="0.01" value={edits.pricePerLiter ?? center.pricePerLiter} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, pricePerLiter: Number(event.target.value) } })} /></label>
          <label>{publicLanguage.t('transportPerLiter')}<input type="number" min="0" step="0.01" value={edits.transportRatePerLiter ?? center.transportRatePerLiter} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, transportRatePerLiter: Number(event.target.value) } })} /></label>
          <label>{publicLanguage.t('morningStart')}<input type="time" value={String(edits.morningStart ?? center.morning_start).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, morningStart: event.target.value } })} /></label>
          <label>{publicLanguage.t('morningEnd')}<input type="time" value={String(edits.morningEnd ?? center.morning_end).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, morningEnd: event.target.value } })} /></label>
          <label>{publicLanguage.t('eveningStart')}<input type="time" value={String(edits.eveningStart ?? center.evening_start).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, eveningStart: event.target.value } })} /></label>
          <label>{publicLanguage.t('eveningEnd')}<input type="time" value={String(edits.eveningEnd ?? center.evening_end).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, eveningEnd: event.target.value } })} /></label>
          <button className="button button-secondary" onClick={() => saveCenter(center)}><Check size={15} /> {publicLanguage.t('saveSettings')}</button>
        </div></div>; })}
        {!ownedCenters.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Building2 size={21} aria-hidden="true" /></span><div><b>{publicLanguage.t('centersEmptyTitle')}</b></div><button type="button" className="button button-primary small-button" onClick={() => document.getElementById('new-center-name')?.focus()}><Plus size={15} />{publicLanguage.t('centersAdd')}</button></div> : null}
      </section>
      {user.accountType !== 'COLLECTION_CENTER' ? <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('newSite')}</span><h2>{publicLanguage.t('addCenter')}</h2></div><Building2 size={19} /></div><form className="form-stack compact" onSubmit={createCenter}>
        <label>{publicLanguage.t('centerName')}<input id="new-center-name" required value={centerForm.name} onChange={(event) => setCenterForm({ ...centerForm, name: event.target.value })} /></label>
        <label>{publicLanguage.t('milkPrice')} / L<input type="number" min="1" step="0.01" required value={centerForm.pricePerLiter} onChange={(event) => setCenterForm({ ...centerForm, pricePerLiter: event.target.value })} /></label>
        <label>{publicLanguage.t('transportPerLiter')}<input type="number" min="0" step="0.01" value={centerForm.transportRatePerLiter} onChange={(event) => setCenterForm({ ...centerForm, transportRatePerLiter: event.target.value })} /></label>
        <label>{publicLanguage.t('morningStart')}<input type="time" value={centerForm.morningStart} onChange={(event) => setCenterForm({ ...centerForm, morningStart: event.target.value })} /></label>
        <label>{publicLanguage.t('morningEnd')}<input type="time" value={centerForm.morningEnd} onChange={(event) => setCenterForm({ ...centerForm, morningEnd: event.target.value })} /></label>
        <label>{publicLanguage.t('eveningStart')}<input type="time" value={centerForm.eveningStart} onChange={(event) => setCenterForm({ ...centerForm, eveningStart: event.target.value })} /></label>
        <label>{publicLanguage.t('eveningEnd')}<input type="time" value={centerForm.eveningEnd} onChange={(event) => setCenterForm({ ...centerForm, eveningEnd: event.target.value })} /></label>
        <button className="button button-primary" disabled={busy}><Plus size={16} /> {publicLanguage.t('addCenter')}</button>
      </form></section> : null}
    </div>
    );
  };

  const renderMilk = () => {
    const currentDay = collectionDate ? Number(new Date(`${collectionDate}T00:00:00Z`).getUTCDate()) : 1;
    const currentPeriod = currentDay <= 15 ? publicLanguage.t('milkUkweziFirstHalf') : publicLanguage.t('milkUkweziSecondHalf');
    const visibleRows = daily;
    const hasDailyFilter = Boolean(debouncedDailySearch) || dailySession !== 'all';
    const clearDailyFilters = () => { setDailySearch(''); setDailySession('all'); };
    const updateVolume = (farmerId: number, period: 'morning' | 'evening', value: string) => setVolumes((current) => ({
      ...current,
      [farmerId]: { ...(current[farmerId] || { morning: '', evening: '' }), [period]: value },
    }));
    const volumeInput = (row: DailyRow, period: 'morning' | 'evening') => <input
      className="table-input"
      type="number"
      min="0"
      step="0.01"
      aria-label={`${row.farmerName} ${publicLanguage.t(period === 'morning' ? 'dashboardMorning' : 'dashboardEvening').toLocaleLowerCase()} volume`}
      value={volumes[row.farmerId]?.[period] ?? ''}
      onChange={(event) => updateVolume(row.farmerId, period, event.target.value)}
    />;
    const entryState = (row: DailyRow) => {
      const volume = volumes[row.farmerId] || { morning: '', evening: '' };
      const unchanged = Number(volume.morning || 0) === Number(row.volumeMorning || 0)
        && Number(volume.evening || 0) === Number(row.volumeEvening || 0);
      return row.recordId && unchanged ? 'saved' : 'unsaved';
    };
    const emptyState = <div className="milk-empty-state">
      <span className="milk-empty-icon"><Milk size={22} aria-hidden="true" /></span>
      <div><b>{hasDailyFilter ? publicLanguage.t('milkSearchNoResultsTitle') : accountCopy('milkNoAssignedTitle', 'milkNoAssignedAbacundaTitle')}</b><p>{hasDailyFilter ? publicLanguage.t('milkSearchNoResultsBody') : accountCopy('milkNoAssignedBody', 'milkNoAssignedAbacundaBody')}</p></div>
      {hasDailyFilter ? <button type="button" className="button button-secondary small-button" onClick={clearDailyFilters}><X size={15} aria-hidden="true" />{publicLanguage.t('milkClearSearch')}</button> : <button type="button" className="button button-secondary small-button" onClick={() => setTab('farmers')}>{accountCopy('milkOpenFarmers', 'milkOpenAbacunda')} <ArrowRight size={15} /></button>}
    </div>;

    return <>
      <section className="panel milk-workspace">
      <div className="milk-workspace-header">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navMilk')}</span><h2>{publicLanguage.t('milkEntries')}</h2></div><span className="milk-period-badge"><CalendarDays size={15} aria-hidden="true" />{currentPeriod}</span></div>
      </div>
      {isCollector ? <section className="panel owner-account-panel">
        <div className="panel-heading"><div><span className="eyebrow">OWNER / ACCOUNT</span><h2>{user?.name || user?.email}</h2></div><UserRound size={19} aria-hidden="true" /></div>
        <div className="metric-strip milk-summary owner-account-summary"><div><span>{publicLanguage.t('ownerIfishiOwnerMilk')}</span><b>{collectorMilkEntry ? `${liters(Number(collectorMilkEntry.effectiveVolumeLiters ?? collectorMilkEntry.volumeLiters))} L` : '—'}</b></div></div>
        <div className="owner-ifishi-actions">
          <button type="button" className="button button-primary small-button owner-ifishi-action" aria-haspopup="dialog" aria-expanded={ownerIfishiOpen} onClick={() => { setIfishiOpen(false); openOwnerIfishiEntry(); }}><Plus size={15} aria-hidden="true" />{publicLanguage.t('ownerIfishiTitle')}</button>
          <button type="button" className="text-button owner-ifishi-history-toggle" aria-expanded={ownerIfishiHistoryOpen} onClick={() => setOwnerIfishiHistoryOpen((open) => !open)}>{publicLanguage.t(ownerIfishiHistoryOpen ? 'ownerIfishiHideHistory' : 'ownerIfishiViewHistory')}<ChevronDown size={15} aria-hidden="true" /></button>
        </div>
      </section> : null}
      {isCollector && ownerIfishiHistoryOpen ? renderOwnerIfishiHistory() : null}
      {isCollector && ownerIfishiOpen ? <Modal ariaLabel={publicLanguage.t('ownerIfishiTitle')} className="owner-ifishi-entry-modal" onClose={() => setOwnerIfishiOpen(false)} dismissible={!busy}>{renderOwnerIfishiEntry()}</Modal> : null}
      <div className="milk-entry-controls">
        <div className="milk-toolbar">
          <label><span>{publicLanguage.t('milkCollectionDate')}</span><input type="date" value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} /></label>
          {centers.length ? <label><span>{isDairy ? 'Active Ikigo' : publicLanguage.t('dashboardCenter')}</span><select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
        </div>
        <div className="milk-session-context"><span>{publicLanguage.t('milkCollectionWindow')}</span><b>{publicLanguage.t('dashboardMorning')} <i /> {publicLanguage.t('dashboardEvening')}</b></div>
      </div>
      <div className="milk-record-tools">
        <label className="milk-search-field"><span>{publicLanguage.t('milkSearchLabel')}</span><span className="milk-search-control"><Search size={16} aria-hidden="true" /><input type="search" aria-label={publicLanguage.t('milkSearchLabel')} placeholder={publicLanguage.t('milkSearchPlaceholder')} value={dailySearch} onChange={(event) => setDailySearch(event.target.value)} />{dailySearch ? <button type="button" className="icon-button milk-search-clear" aria-label={publicLanguage.t('milkClearSearch')} title={publicLanguage.t('milkClearSearch')} onClick={() => setDailySearch('')}><X size={16} aria-hidden="true" /></button> : null}</span></label>
        <label><span>{publicLanguage.t('milkSessionFilter')}</span><select value={dailySession} onChange={(event) => setDailySession(event.target.value as typeof dailySession)}><option value="all">{publicLanguage.t('milkSessionAll')}</option><option value="morning">{publicLanguage.t('milkSessionMorning')}</option><option value="evening">{publicLanguage.t('milkSessionEvening')}</option></select></label>
        <label className="milk-sort-mobile"><span>{publicLanguage.t('sort')}</span><select value={dailySortBy ? `${dailySortBy}:${dailySortDirection}` : ''} onChange={(event) => {
          const [field, direction] = event.target.value.split(':');
          if (['farmerName', 'totalVolume'].includes(field) && ['asc', 'desc'].includes(direction)) {
            setDailySortBy(field as typeof dailySortBy);
            setDailySortDirection(direction as typeof dailySortDirection);
          } else if (!field) setDailySortBy('');
        }}>
          <option value="">{publicLanguage.t('sort')}</option>
          <option value="farmerName:asc">{accountCopy('milkFarmer', 'milkAbacunda')} ↑</option>
          <option value="farmerName:desc">{accountCopy('milkFarmer', 'milkAbacunda')} ↓</option>
          <option value="totalVolume:asc">{publicLanguage.t('milkTotal')} ↑</option>
          <option value="totalVolume:desc">{publicLanguage.t('milkTotal')} ↓</option>
        </select></label>
        <label><span>{publicLanguage.t('milkPageSize')}</span><select value={dailyPageSize} onChange={(event) => setDailyPageSize(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
      <div className="metric-strip milk-summary"><div><span>{accountCopy('dashboardFarmers', 'dashboardAbacundaToday')}</span><b>{dailySummary.presentCount} / {dailySummary.totalFarmers}</b></div><div><span>{publicLanguage.t('dashboardCollected')}</span><b>{liters(dailySummary.totalVolume)} L</b></div><div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(dailySummary.totalMorning)} L</b></div><div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(dailySummary.totalEvening)} L</b></div></div>
      <div className="panel-heading"><div><span className="eyebrow">{isCollector ? 'ABOROZI' : 'ACTIVE IKIGO'}</span><h2>{publicLanguage.t('navFarmers')}</h2></div><span className="count-label">{publicLanguage.t('milkResultsCount')}: {visibleRows.length} / {dailySummary.totalFarmers}</span></div>
      {isDairy && !selectedCenter ? (
        centers.length ? (
          <div className="workspace-empty" role="status">
            <b>{publicLanguage.t('selectCenterToView')}</b>
            <p>{publicLanguage.t('selectCenterToViewHint')}</p>
          </div>
        ) : (
          <div className="workspace-empty" role="status"><b>No active Ikigo is available for this account.</b></div>
        )
      ) : dailyLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />Loading daily milk…</div>
        : dailyError ? <div className="workspace-empty" role="alert"><b>{dailyError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadDaily().catch(() => undefined)}>Retry</button></div>
        : visibleRows.length ? <>
        <div className="table-scroll milk-desktop-list"><table><thead><tr>
          <th aria-sort={dailySortBy === 'farmerName' ? dailySortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => { if (dailySortBy === 'farmerName') setDailySortDirection((direction) => direction === 'asc' ? 'desc' : 'asc'); else { setDailySortBy('farmerName'); setDailySortDirection('asc'); } }}>{accountCopy('milkFarmer', 'milkAbacunda')}{dailySortBy === 'farmerName' ? dailySortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowUpDown size={13} />}</button></th>
          <th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th>
          <th aria-sort={dailySortBy === 'totalVolume' ? dailySortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => { if (dailySortBy === 'totalVolume') setDailySortDirection((direction) => direction === 'asc' ? 'desc' : 'asc'); else { setDailySortBy('totalVolume'); setDailySortDirection('asc'); } }}>{publicLanguage.t('milkTotal')}{dailySortBy === 'totalVolume' ? dailySortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowUpDown size={13} />}</button></th>
          <th>{publicLanguage.t('navIfishi')}</th><th>{publicLanguage.t('milkAction')}</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.farmerId}><td className="strong-cell">{row.farmerName}{isDairy ? <small>{row.presentCount || 0} / {row.abacundaCount || 0} Abacunda</small> : null}</td><td>{isCollector ? volumeInput(row, 'morning') : liters(row.volumeMorning)}</td><td>{isCollector ? volumeInput(row, 'evening') : liters(row.volumeEvening)}</td><td>{liters(row.totalVolume)}</td><td><button type="button" className="text-button" onClick={() => openIfishiForFarmer(row.farmerId, row.farmerName)}>{publicLanguage.t('navIfishi')}</button></td><td className="milk-table-action">{isCollector ? <><span className={`milk-entry-state ${entryState(row)}`}>{publicLanguage.t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span><button className="button button-secondary small-button" onClick={() => saveMilk(row)} disabled={busy}>{publicLanguage.t('milkSave')}</button></> : null}</td></tr>)}</tbody></table></div>
        <div className="milk-mobile-list">{visibleRows.map((row) => <article className="milk-entry-card" key={row.farmerId}>
          <header><div><b>{row.farmerName}</b><small>{isDairy ? `${row.presentCount || 0} / ${row.abacundaCount || 0} Abacunda` : row.collectionCenter || dailyCenter || ''}</small></div>{isCollector ? <span className={`milk-entry-state ${entryState(row)}`}>{publicLanguage.t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span> : null}</header>
          <div className="milk-entry-inputs"><label><span>{publicLanguage.t('dashboardMorning')} · L</span>{isCollector ? volumeInput(row, 'morning') : liters(row.volumeMorning)}</label><label><span>{publicLanguage.t('dashboardEvening')} · L</span>{isCollector ? volumeInput(row, 'evening') : liters(row.volumeEvening)}</label></div>
          <footer><span>{publicLanguage.t('dashboardCollected')} <b>{liters(row.totalVolume)} L</b></span>{isCollector ? <><button type="button" className="button button-secondary small-button" onClick={() => openIfishiForFarmer(row.farmerId, row.farmerName)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button><button className="button button-secondary small-button" onClick={() => saveMilk(row)} disabled={busy}>{publicLanguage.t('milkSave')}</button></> : <button type="button" className="button button-secondary small-button" onClick={() => openIfishiForFarmer(row.farmerId, row.farmerName)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button>}</footer>
        </article>)}</div>
      </> : emptyState}
      {dailyHasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => dailyCursor && loadDaily(dailyCursor, true)}>{publicLanguage.t('milkLoadMore')} <ChevronDown size={16} /></button></div> : null}
      </section>
      {ifishiOpen ? <Modal ariaLabel={publicLanguage.t('navIfishi')} className="modal-panel-wide ifishi-modal" onClose={() => setIfishiOpen(false)} dismissible={!busy}>{renderIfishi()}</Modal> : null}
    </>;
  };

  const renderOwnerIfishiEntry = () => {
    const selectedEntry = ownerIfishiHistory?.entries.find((entry) => entry.date === ifishiDate && entry.id !== null);
    const selectedPeriod = ownerIfishiPeriod === 'first-half' ? '1–15' : `16–${new Date(Number(ifishiMonth.slice(0, 4)), Number(ifishiMonth.slice(5, 7)), 0).getDate()}`;
    return <>
      <div className="panel-heading"><div><span className="eyebrow">{selectedEntry?.id ? publicLanguage.t('ownerIfishiCorrection') : publicLanguage.t('ownerIfishiMissed')}</span><h2>{publicLanguage.t('ownerIfishiDailyEntry')}</h2></div><button type="button" className="icon-button" onClick={() => setOwnerIfishiOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
      <p className="muted-note owner-ifishi-entry-period">{ifishiMonth} · {selectedPeriod}</p>
      <form className="form-stack compact owner-ifishi-entry-form" onSubmit={saveOwnerIfishiEntry}>
        <label>{publicLanguage.t('milkCollectionDate')}<input type="date" max={today()} value={ifishiDate} onChange={(event) => selectOwnerIfishiDate(event.target.value)} required /></label>
        <label>Mu gitondo (Morning) · 06:30–09:00 · L<input type="number" min="0" step="0.01" value={ownerIfishiMorning} onChange={(event) => setOwnerIfishiMorning(event.target.value)} /></label>
        <label>Nimugoroba (Evening) · 17:30–19:00 · L<input type="number" min="0" step="0.01" value={ownerIfishiEvening} onChange={(event) => setOwnerIfishiEvening(event.target.value)} /></label>
        <p className="muted-note">Daily total: {liters((Number(ownerIfishiMorning) || 0) + (Number(ownerIfishiEvening) || 0))} L</p>
        {ownerIfishiLoading ? <p className="muted-note" role="status">{publicLanguage.t('ownerIfishiLoading')}</p> : null}
        {selectedEntry?.id && selectedEntry.status !== 'valid' ? <p className="form-error" role="status">{publicLanguage.t('ownerIfishiLocked')}</p> : null}
        {selectedEntry?.id && selectedEntry.status === 'valid' ? <p className="muted-note">{publicLanguage.t('ownerIfishiCorrectionAudit')}</p> : null}
        {ownerIfishiSaveError ? <p className="form-error" role="alert">{ownerIfishiSaveError}</p> : null}
        {ownerIfishiSaveStatus ? <p className="form-success" role="status">{ownerIfishiSaveStatus}</p> : null}
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setOwnerIfishiOpen(false)} disabled={busy}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy || ownerIfishiLoading || !ifishiDate || Boolean(selectedEntry?.id && selectedEntry.status !== 'valid')}><Check size={16} aria-hidden="true" />{busy ? publicLanguage.t('wait') : publicLanguage.t(selectedEntry?.id ? 'ownerIfishiCorrect' : 'ownerIfishiSave')}</button></div>
      </form>
    </>;
  };

  const renderOwnerIfishiHistory = () => {
    const accountingRows: Array<Record<string, any>> = [
      ...(ownerIfishiReport?.farmerPayments || []).map((row) => ({ ...row, isOwner: false })),
      ...(ownerIfishiReport?.ownerSettlementRow ? [{
        ...ownerIfishiReport.ownerSettlementRow,
        farmerName: ownerIfishiReport.ownerSettlementRow.farmerName,
        totalTransport: ownerIfishiReport.collectorFarmerTransport ?? null,
        totalDeductions: ownerIfishiReport.collectorFarmerDeductions || 0,
        netAmount: ownerIfishiReport.collectorPayable,
        isOwner: true,
      }] : []),
    ];
    const moveMonth = (offset: number) => {
      const date = new Date(`${ifishiMonth}-01T00:00:00`);
      date.setMonth(date.getMonth() + offset);
      setIfishiMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    };

    return <div className="screen-grid owner-ifishi-view">
      <section className="panel panel-wide owner-ifishi-context">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ownerIfishiHistory')}</span><h2>{user?.name || user?.email}</h2></div><span className="count-label">{ownerIfishiHistory?.entries.length || 0} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        <p className="muted-note">{publicLanguage.t('ownerIfishiContext')}</p>
        <div className="owner-ifishi-period">
          <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label={publicLanguage.t('ownerIfishiPreviousMonth')} title={publicLanguage.t('ownerIfishiPreviousMonth')}><ChevronLeft size={17} /></button>
          <label>{publicLanguage.t('ifishiMonth')}<input type="month" max={today().slice(0, 7)} value={ifishiMonth} onChange={(event) => setIfishiMonth(event.target.value)} /></label>
          <label>{publicLanguage.t('ukweziPeriod')}<select value={ownerIfishiPeriod} onChange={(event) => setOwnerIfishiPeriod(event.target.value as typeof ownerIfishiPeriod)}><option value="first-half">1–15</option><option value="second-half">16–{new Date(Number(ifishiMonth.slice(0, 4)), Number(ifishiMonth.slice(5, 7)), 0).getDate()}</option></select></label>
          <button type="button" className="icon-button" onClick={() => moveMonth(1)} disabled={ifishiMonth >= today().slice(0, 7)} aria-label={publicLanguage.t('ownerIfishiNextMonth')} title={publicLanguage.t('ownerIfishiNextMonth')}><ChevronRight size={17} /></button>
        </div>
      </section>

      <section className="panel panel-wide owner-ifishi-history">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ownerIfishiHistory')}</span><h2>{ownerIfishiHistory ? `${ownerIfishiHistory.startDate} – ${ownerIfishiHistory.endDate}` : ifishiMonth}</h2></div><span className="count-label">{ownerIfishiHistory?.entries.length || 0} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        {ownerIfishiLoading && !ownerIfishiHistory ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('ownerIfishiLoading')}</div> : null}
        {ownerIfishiError ? <div className="workspace-empty" role="alert"><b>{publicLanguage.t('ownerIfishiLoadError')}</b><span>{ownerIfishiError}</span><button type="button" className="button button-secondary small-button" onClick={() => loadOwnerIfishiHistory().catch(() => undefined)}>{publicLanguage.t('reportsRefresh')}</button></div> : null}
        {!ownerIfishiLoading && !ownerIfishiError && ownerIfishiHistory ? <>
          <div className="metric-strip owner-ifishi-summary">
            <div><span>{publicLanguage.t('ifishiOriginal')}</span><b>{liters(ownerIfishiHistory.totals.originalVolumeLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiOwnerMilk')}</span><b>{liters(ownerIfishiHistory.totals.ownerVolumeLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiGross')}</span><b>{ownerIfishiHistory.totals.ownerMilkGross == null ? '—' : `${money(ownerIfishiHistory.totals.ownerMilkGross)} RWF`}</b></div>
            <div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(ownerIfishiHistory.totals.lostVolumeLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiAssigned')}</span><b>{liters(ownerIfishiHistory.totals.assignedFarmerLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiSurplus')}</span><b>{liters(ownerIfishiHistory.totals.surplusLiters)} L</b></div>
          </div>
          {!ownerIfishiHistory.totals.ownerMilkValueComplete ? <p className="muted-note">{publicLanguage.t('collectorPriceMissing')}</p> : null}
          {ownerIfishiReportError ? <div className="workspace-empty" role="alert"><b>{ownerIfishiReportError}</b></div> : null}
          {ownerIfishiReport ? <>
            <div className="metric-strip owner-ifishi-accounting-summary">
              <div><span>{publicLanguage.t('reportsGross')}</span><b>{ownerIfishiReport.ownerGeneratedGross == null ? '—' : `${money(ownerIfishiReport.ownerGeneratedGross)} RWF`}</b></div>
              <div><span>{publicLanguage.t('dashboardDeductions')}</span><b>{money(ownerIfishiReport.collectorFarmerDeductions || 0)} RWF</b></div>
              <div><span>{publicLanguage.t('reportsTransport')}</span><b>{ownerIfishiReport.collectorFarmerTransport == null ? '—' : `${money(ownerIfishiReport.collectorFarmerTransport)} RWF`}</b></div>
              <div><span>{publicLanguage.t('reportsNet')}</span><b>{ownerIfishiReport.collectorPayable == null ? '—' : `${money(ownerIfishiReport.collectorPayable)} RWF`}</b></div>
            </div>
            <section className="settlement-reconciliation" role="status"><b>{ownerIfishiReport.collectorIsReconciled ? publicLanguage.t('ukweziReconciled') : publicLanguage.t('ukweziReconciliationPending')}</b><span>{ownerIfishiReport.collectorPayableFromBreakdown == null ? publicLanguage.t('collectorPriceMissing') : `${publicLanguage.t('ukweziBreakdown')}: ${money(ownerIfishiReport.collectorSurplusAmount || 0)} + ${money(ownerIfishiReport.collectorFarmerDeductions || 0)} + ${money(ownerIfishiReport.collectorFarmerTransport || 0)} = ${money(ownerIfishiReport.collectorPayableFromBreakdown)} RWF`}</span></section>
            {accountingRows.length ? <div className="table-scroll owner-ifishi-accounting-table"><table><thead><tr><th>No</th><th>{publicLanguage.t('milkFarmer')}</th><th>{publicLanguage.t('accountNationalId')}</th><th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{publicLanguage.t('reportsVolume')}</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('reportsGross')}</th><th>{publicLanguage.t('reportsTransport')}</th><th>{publicLanguage.t('dashboardDeductions')}</th><th>{publicLanguage.t('reportsNet')}</th></tr></thead><tbody>{accountingRows.map((row, index) => <tr key={`${row.isOwner ? 'owner' : row.farmerId}-${index}`} className={row.isOwner ? 'owner-settlement-row' : undefined}><td>{index + 1}</td><td>{row.farmerName || row.name}</td><td>{row.nationalId || row.idNumber || '—'}</td><td>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(row.totalVolume)} L</td><td>{row.pricePerLiter == null ? '—' : `${money(row.pricePerLiter)} RWF`}</td><td>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</td><td>{money(row.totalTransport || 0)} RWF</td><td>{money(row.totalDeductions || 0)} RWF</td><td>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</td></tr>)}</tbody><tfoot><tr className="owner-settlement-row"><td></td><td colSpan={3}><b>{publicLanguage.t('ukweziOwnerTotal')}</b></td><td>{liters(ownerIfishiReport.ownerGeneratedVolume || 0)} L</td><td>{ownerIfishiReport.ownerSettlementRow?.pricePerLiter == null ? '—' : `${money(ownerIfishiReport.ownerSettlementRow.pricePerLiter)} RWF`}</td><td>{ownerIfishiReport.ownerGeneratedGross == null ? '—' : `${money(ownerIfishiReport.ownerGeneratedGross)} RWF`}</td><td>{money(ownerIfishiReport.collectorFarmerTransport || 0)} RWF</td><td>{money(ownerIfishiReport.collectorFarmerDeductions || 0)} RWF</td><td>{ownerIfishiReport.collectorPayable == null ? '—' : `${money(ownerIfishiReport.collectorPayable)} RWF`}</td></tr></tfoot></table></div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('reportsEmptyTitle')}</b></div>}
          </> : null}
          {ownerIfishiHistory.entries.length ? <>
            <div className="table-scroll owner-ifishi-desktop-list"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('ifishiOriginal')} · L</th><th>{publicLanguage.t('ownerIfishiOwnerMilk')} · L</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('ownerIfishiGross')}</th><th>{publicLanguage.t('ownerIfishiAssigned')} · L</th><th>{publicLanguage.t('ownerIfishiSurplus')} · L</th><th>{publicLanguage.t('ifishiLost')} · L</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th><th /></tr></thead><tbody>{ownerIfishiHistory.entries.map((entry) => <tr key={`${entry.date}-${entry.id || 'assigned'}`}>
              <td><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.date}</button></td>
              <td>{liters(entry.originalVolumeLiters)} L</td><td>{liters(entry.validVolumeLiters)} L</td><td>{entry.pricePerLiter == null ? '—' : `${money(entry.pricePerLiter)} RWF`}</td><td>{entry.grossAmount == null ? '—' : `${money(entry.grossAmount)} RWF`}</td><td>{liters(entry.assignedFarmerLiters)} L</td><td>{liters(entry.surplusLiters)} L</td><td>{liters(entry.lostVolumeLiters)} L</td>
              <td>{entry.status}</td><td>{entry.adjustmentReason || '—'}</td>
              <td><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.id && entry.status === 'valid' ? publicLanguage.t('ownerIfishiCorrect') : entry.id ? publicLanguage.t('ownerIfishiVoidedShort') : publicLanguage.t('ownerIfishiEnter')}</button></td>
            </tr>)}</tbody></table></div>
            <div className="owner-ifishi-mobile-list">{ownerIfishiHistory.entries.map((entry) => <article className="owner-ifishi-day" key={`${entry.date}-${entry.id || 'assigned'}`}>
              <header><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.date}</button><span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span></header>
              <dl><div><dt>{publicLanguage.t('ifishiOriginal')}</dt><dd>{liters(entry.originalVolumeLiters)} L</dd></div><div><dt>{publicLanguage.t('ownerIfishiOwnerMilk')}</dt><dd>{liters(entry.validVolumeLiters)} L</dd></div><div><dt>{publicLanguage.t('milkPrice')} / L</dt><dd>{entry.pricePerLiter == null ? '—' : `${money(entry.pricePerLiter)} RWF`}</dd></div><div><dt>{publicLanguage.t('ownerIfishiGross')}</dt><dd>{entry.grossAmount == null ? '—' : `${money(entry.grossAmount)} RWF`}</dd></div><div><dt>{publicLanguage.t('ownerIfishiAssigned')}</dt><dd>{liters(entry.assignedFarmerLiters)} L</dd></div><div><dt>{publicLanguage.t('ownerIfishiSurplus')}</dt><dd>{liters(entry.surplusLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostVolumeLiters)} L</dd></div></dl>
              {entry.adjustmentReason ? <p>{entry.adjustmentReason}</p> : null}
              <footer><button type="button" className="button button-secondary small-button" onClick={() => openOwnerIfishiEntry(entry.date)} disabled={Boolean(entry.id && entry.status !== 'valid')}>{entry.id ? publicLanguage.t('ownerIfishiCorrect') : publicLanguage.t('ownerIfishiEnter')}</button></footer>
            </article>)}</div>
          </> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Milk size={21} aria-hidden="true" /></span><b>{publicLanguage.t('ownerIfishiEmpty')}</b></div>}
        </> : null}
      </section>
    </div>;
  };

  const renderIfishi = () => {
    const { startDate, endDate } = getMonthBounds(ifishiMonth);
    const selectedFarmer = ifishiFarmers.find((farmer) => String(farmer.id) === ifishiFarmerId);
    const selectedCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name || 'Active Ikigo';
    const monthlyRows = ifishiRecords.filter((record) => String(record.date).slice(0, 10) >= startDate && String(record.date).slice(0, 10) <= endDate
      && (ifishiRecordSession === 'all' || (ifishiRecordSession === 'morning' ? Number(record.volumeMorning) > 0 : Number(record.volumeEvening) > 0)));
    const totalMorning = monthlyRows.reduce((sum, record) => sum + Number(record.volumeMorning || 0), 0);
    const totalEvening = monthlyRows.reduce((sum, record) => sum + Number(record.volumeEvening || 0), 0);
    const totalVolume = totalMorning + totalEvening;
    const validVolume = monthlyRows.reduce((sum, record) => sum + Number(record.validVolumeLiters || (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))), 0);
    const lostVolume = monthlyRows.reduce((sum, record) => sum + Number(record.lostVolumeLiters || 0), 0);
    return <div className="screen-grid ifishi-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('milkCollectionWindow')}</span><h2>{publicLanguage.t('navIfishi')}</h2></div><button type="button" className="icon-button" onClick={() => setIfishiOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <div className="form-stack compact">
          <label>{publicLanguage.t('ifishiMonth')}<input type="month" value={ifishiMonth} onChange={(event) => setIfishiMonth(event.target.value)} /></label>
          <label>{accountCopy('milkFarmerSearch', 'milkAbacundaSearch')}<input type="search" value={ifishiFarmerSearch} onChange={(event) => setIfishiFarmerSearch(event.target.value)} /></label>
          <label>{accountCopy('milkFarmer', 'milkAbacunda')}<select required value={ifishiFarmerId} onChange={(event) => setIfishiFarmerId(event.target.value)}><option value="">{accountCopy('deductionsFarmer', 'milkAbacunda')}</option>{ifishiFarmers.map((farmer) => <option key={farmer.id} value={String(farmer.id)}>{farmer.name} · {farmer.collectionCenter || farmer.location || '—'}</option>)}</select></label>
          <label>{publicLanguage.t('milkCollectionDate')}<input type="date" min={startDate} max={endDate} value={ifishiDate} onChange={(event) => setIfishiDate(event.target.value)} /></label>
          <label>{publicLanguage.t('milkSessionFilter')}<select value={ifishiRecordSession} onChange={(event) => setIfishiRecordSession(event.target.value as typeof ifishiRecordSession)}><option value="all">{publicLanguage.t('milkSessionAll')}</option><option value="morning">{publicLanguage.t('milkSessionMorning')}</option><option value="evening">{publicLanguage.t('milkSessionEvening')}</option></select></label>
          <label>{publicLanguage.t('sort')}<select value={`${ifishiRecordSortBy}:${ifishiRecordSortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); if (['date', 'volume', 'amount'].includes(field) && ['asc', 'desc'].includes(direction)) { setIfishiRecordSortBy(field as typeof ifishiRecordSortBy); setIfishiRecordSortDirection(direction as typeof ifishiRecordSortDirection); } }}>
            <option value="date:desc">{publicLanguage.t('milkCollectionDate')} ↓</option><option value="date:asc">{publicLanguage.t('milkCollectionDate')} ↑</option>
            <option value="volume:asc">{publicLanguage.t('reportsVolume')} ↑</option><option value="volume:desc">{publicLanguage.t('reportsVolume')} ↓</option>
            <option value="amount:asc">{publicLanguage.t('milkTotal')} ↑</option><option value="amount:desc">{publicLanguage.t('milkTotal')} ↓</option>
          </select></label>
          {ifishiRecordSession !== 'all' || ifishiRecordSortBy !== 'date' || ifishiRecordSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={() => { setIfishiRecordSession('all'); setIfishiRecordSortBy('date'); setIfishiRecordSortDirection('desc'); }}>{publicLanguage.t('milkClearSearch')}</button> : null}
          {selectedFarmer ? <p className="muted-note">{selectedCenterName} · {selectedFarmer.name} · {selectedFarmer.collectionCenter || selectedFarmer.location || '—'}</p> : null}
          {!ifishiFarmers.length ? <div className="workspace-empty" role="status"><b>{publicLanguage.t('ifishiNoPeople')}</b></div> : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{ifishiDate}</span><h2>{publicLanguage.t('ifishiDailyEntry')}</h2></div><Milk size={19} aria-hidden="true" /></div>
        <form className="form-stack compact" onSubmit={saveIfishiEntry}>
          <label>{publicLanguage.t('dashboardMorning')} · 06:30–09:00<input type="number" min="0" step="0.01" value={ifishiMorning} onChange={(event) => setIfishiMorning(event.target.value)} /></label>
          <label>{publicLanguage.t('dashboardEvening')} · 17:30–19:00<input type="number" min="0" step="0.01" value={ifishiEvening} onChange={(event) => setIfishiEvening(event.target.value)} /></label>
          <div className="metric-strip"><div><span>{publicLanguage.t('milkTotal')}</span><b>{liters(Number(ifishiMorning || 0) + Number(ifishiEvening || 0))} L</b></div></div>
          {ifishiSaveError ? <p className="form-error" role="alert">{ifishiSaveError}</p> : null}
          {ifishiSaveStatus ? <p className="form-success" role="status">{ifishiSaveStatus}</p> : null}
          <button className="button button-primary" disabled={busy || !ifishiFarmerId}>{busy ? publicLanguage.t('wait') : publicLanguage.t('milkSave')}</button>
        </form>
      </section>
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiPersistedRecords')}</span><h2>{ifishiMonth}</h2></div></div>
        <div className="metric-strip ifishi-summary-strip">
          <div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(totalMorning)} L</b></div>
          <div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(totalEvening)} L</b></div>
          <div><span>{publicLanguage.t('milkTotal')}</span><b>{liters(totalVolume)} L</b></div>
          <div><span>{publicLanguage.t('ifishiValid')}</span><b>{liters(validVolume)} L</b></div>
          <div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(lostVolume)} L</b></div>
        </div>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiPersistedRecords')}</span><h2>{selectedFarmer?.name || ifishiMonth}</h2></div><span className="count-label">{monthlyRows.length} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        {monthlyRows.length ? <div className="table-scroll"><table><thead><tr>
          {([
            ['date', publicLanguage.t('milkCollectionDate')],
            ['farmerName', accountCopy('milkFarmer', 'milkAbacunda')],
            ['volume', publicLanguage.t('reportsVolume')],
            ['amount', publicLanguage.t('milkTotal')],
          ] as const).map(([field, label]) => {
            const numericSort = field === 'volume' || field === 'amount';
            const sortField = field === 'date' ? 'date' : field === 'amount' ? 'amount' : 'volume';
            const active = field === 'farmerName' ? false : ifishiRecordSortBy === sortField;
            const SortIcon = active ? ifishiRecordSortDirection === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
            return <th key={field} aria-sort={active ? ifishiRecordSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>
              {field === 'farmerName' ? label : <button type="button" className="farmer-sort-button" onClick={() => {
                if (ifishiRecordSortBy === sortField) setIfishiRecordSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
                else { setIfishiRecordSortBy(sortField); setIfishiRecordSortDirection(numericSort ? 'asc' : 'desc'); }
              }}>{label}<SortIcon size={13} aria-hidden="true" /></button>}
            </th>;
          })}
          <th>{publicLanguage.t('dashboardMorning')}</th><th>{publicLanguage.t('dashboardEvening')}</th><th>{publicLanguage.t('ifishiOriginal')}</th><th>{publicLanguage.t('ifishiValid')}</th><th>{publicLanguage.t('ifishiLost')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th>
        </tr></thead><tbody>{monthlyRows.map((record) => <tr key={record.id}><td>{String(record.date).slice(0, 10)}</td><td>{selectedFarmer?.name || '—'}</td><td>{liters(Number(record.validVolumeLiters ?? (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))))} L</td><td>{money(record.validAmount ?? record.amount)} RWF</td><td>{liters(Number(record.volumeMorning || 0))} L</td><td>{liters(Number(record.volumeEvening || 0))} L</td><td>{liters(Number(record.originalVolumeLiters ?? (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))))} L</td><td>{liters(Number(record.validVolumeLiters ?? (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))))} L</td><td>{liters(Number(record.lostVolumeLiters || 0))} L</td><td>{record.status}</td><td>{record.adjustmentReason || '—'}</td></tr>)}</tbody></table></div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('ifishiNoPersistedRecords')}</b></div>}
      </section>
    </div>;
  };

  const renderDashboard = () => {
    const currentDate = new Date(`${collectionDate}T00:00:00`);
    const dateLabel = formatDateLabel(currentDate, publicLanguage.language, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const periodStart = report?.rangeStart?.slice(8, 10);
    const periodEnd = report?.rangeEnd?.slice(8, 10);
    const periodMonth = report?.rangeStart
      ? formatDateLabel(report.rangeStart, publicLanguage.language, { month: 'long', year: 'numeric' })
      : null;
    const centerNames = dailyCenters.length ? dailyCenters : dailyCenter ? [dailyCenter] : [];
    const centerLabel = centerNames.length ? centerNames.join(', ') : publicLanguage.t('dashboardNoCenter');
    const recentRows = daily.filter((row) => row.recordId && row.totalVolume > 0).slice(0, 6);
    const quickActions = [
      { id: 'milk' as Tab, label: publicLanguage.t('dashboardEnterMilk'), icon: Milk },
      { id: 'farmers' as Tab, label: publicLanguage.t('navFarmers'), icon: Users },
      { id: 'deductions' as Tab, label: publicLanguage.t('navDeductions'), icon: CircleDollarSign },
      { id: 'reports' as Tab, label: publicLanguage.t('navReports'), icon: FileBarChart2 },
      { id: 'notifications' as Tab, label: publicLanguage.t('navAlerts'), icon: Bell },
    ].filter((action) => visibleTabs.some((item) => item.id === action.id));

    return <div className="dashboard-view">
      <section className="dashboard-overview">
        <div className="dashboard-today">
          <div className="dashboard-today-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardToday')}</span><h2>{dateLabel}</h2></div><CalendarDays size={20} aria-hidden="true" /></div>
          <div className="dashboard-volume"><strong>{dashboardLoading ? '…' : liters(dailySummary.totalVolume)}</strong><span>L</span></div>
          <div className="dashboard-split"><div><span>{publicLanguage.t('dashboardMorning')}</span><b>{dashboardLoading ? '…' : `${liters(dailySummary.totalMorning)} L`}</b></div><div><span>{publicLanguage.t('dashboardEvening')}</span><b>{dashboardLoading ? '…' : `${liters(dailySummary.totalEvening)} L`}</b></div></div>
        </div>
        <div className="dashboard-quick panel">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardActions')}</span><h2>{publicLanguage.t('dashboardEnterMilk')}</h2></div><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className="dashboard-action-list">{quickActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} onClick={() => setTab(action.id)}><Icon size={17} aria-hidden="true" /><span>{action.label}</span><ArrowRight size={15} aria-hidden="true" /></button>; })}</div>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label={publicLanguage.t('dashboardToday')}>
        <div><span>{accountCopy('dashboardFarmers', 'dashboardAbacundaToday')}</span><b>{dashboardLoading ? '…' : `${dailySummary.presentCount} / ${dailySummary.totalFarmers}`}</b></div>
        <div><span>{publicLanguage.t('dashboardCenter')}</span><b>{dashboardLoading ? '…' : centerLabel}</b></div>
        <div><span>{publicLanguage.t('dashboardPeriod')}</span><b>{dashboardLoading ? '…' : periodStart && periodEnd && periodMonth ? `${publicLanguage.t('dashboardUkwezi')} ${Number(periodStart)}–${Number(periodEnd)} · ${periodMonth}` : '—'}</b></div>
        <button type="button" onClick={() => setTab('notifications')}><span>{publicLanguage.t('dashboardUnread')}</span><b>{unreadCount === null ? '…' : unreadCount}</b><Bell size={17} aria-hidden="true" /></button>
      </section>

      <section className="dashboard-lower">
        <div className="panel dashboard-activity">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardToday')}</span><h2>{publicLanguage.t('dashboardRecent')}</h2></div><button type="button" className="dashboard-text-link" onClick={() => setTab('milk')}>{publicLanguage.t('navMilk')} <ArrowRight size={14} /></button></div>
          {dashboardLoading ? <p className="dashboard-state">{publicLanguage.t('dashboardLoading')}</p> : recentRows.length ? <div className="dashboard-activity-list">{recentRows.map((row) => <div className="dashboard-activity-row" key={row.recordId}><span className="dashboard-activity-icon"><Milk size={16} aria-hidden="true" /></span><div><b>{row.farmerName}</b><small>{row.collectionCenter || dailyCenter || ''}</small></div><strong>{liters(row.totalVolume)} L</strong></div>)}</div> : <p className="dashboard-state">{publicLanguage.t('dashboardNoActivity')}</p>}
        </div>
        <div className="dashboard-side">
          <section className="panel dashboard-accounting"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardPeriod')}</span><h2>{publicLanguage.t('dashboardAccounting')}</h2></div><Wallet size={19} aria-hidden="true" /></div><dl><div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{dashboardLoading || !report ? '…' : `${money(report.totalDeductionsMonth)} RWF`}</dd></div><div><dt>{publicLanguage.t('dashboardNet')}</dt><dd>{dashboardLoading || !report ? '…' : `${money(report.netRevenueMonth)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('dashboardPayable')}</dt><dd>{dashboardLoading || !report || report.collectorPayable === null ? '—' : `${money(report.collectorPayable)} RWF`}</dd></div> : null}</dl></section>
          <button type="button" className="panel dashboard-subscription" onClick={() => setTab('billing')}><span><span className="eyebrow">{publicLanguage.t('dashboardSubscription')}</span><b>{subscriptionStatusLabel(billing?.subscription?.effective_status || billing?.subscription?.status)}</b></span><ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      </section>
    </div>;
  };

  const renderDeductions = () => {
    const deductionData = deductionRows?.data || [];
    const resetDeductionList = () => {
      setDeductionSearchQuery('');
      setDeductionSearch('');
      setDeductionTypeFilter('');
      setDeductionStatusFilter('');
      setDeductionSortBy('date');
      setDeductionSortDirection('desc');
      void loadDeductions(null, false, { search: '', type: '', status: '', sortBy: 'date', sortDirection: 'desc' }).catch((reason) => setError(reason.message));
    };
    const sortableHeader = (field: typeof deductionSortBy, label: string) => {
      const active = deductionSortBy === field;
      const SortIcon = active ? deductionSortDirection === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
      return <button type="button" className="farmer-sort-button" aria-sort={active ? deductionSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => {
        const direction = active ? deductionSortDirection === 'asc' ? 'desc' : 'asc' : field === 'date' ? 'desc' : 'asc';
        setDeductionSortBy(field);
        setDeductionSortDirection(direction);
        void loadDeductions(null, false, { sortBy: field, sortDirection: direction }).catch((reason) => setError(reason.message));
      }}>{label}<SortIcon size={13} aria-hidden="true" /></button>;
    };
    return <div className="screen-grid deductions-view">
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardToday')}</span><h2>{publicLanguage.t('deductionsRecent')}</h2></div><button type="button" className="button button-primary small-button" onClick={() => { setDeductionCreateError(''); setDeductionCreateOpen(true); }}><Plus size={15} aria-hidden="true" />{publicLanguage.t('deductionsAdd')}</button></div>
        <div className="toolbar deduction-list-controls">
          <form className={['search', 'form'].join('-')} onSubmit={(event) => { event.preventDefault(); const search = deductionSearchQuery.trim(); setDeductionSearch(search); void loadDeductions(null, false, { search }).catch((reason) => setError(reason.message)); }}><Search size={17} aria-hidden="true" /><input aria-label={publicLanguage.t('milkSearchLabel')} placeholder={accountCopy('deductionsSearch', 'milkFarmerSearch')} value={deductionSearchQuery} onChange={(event) => setDeductionSearchQuery(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form>
          <label>{publicLanguage.t('deductionsType')}<select value={deductionTypeFilter} onChange={(event) => { const type = event.target.value; setDeductionTypeFilter(type); void loadDeductions(null, false, { type }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option>{['Advance', 'Umwenda', 'Other'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>{publicLanguage.t('deductionsStatus')}<select value={deductionStatusFilter} onChange={(event) => { const status = event.target.value; setDeductionStatusFilter(status); void loadDeductions(null, false, { status }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option><option value="Active">Active</option><option value="Cleared">Cleared</option></select></label>
          {deductionSearch || deductionTypeFilter || deductionStatusFilter || deductionSortBy !== 'date' || deductionSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={resetDeductionList}>{publicLanguage.t('milkClearSearch')}</button> : null}
        </div>
        {deductionRows ? deductionData.length ? <>
          <div className="table-scroll deductions-desktop-table"><table><thead><tr><th>{sortableHeader('date', publicLanguage.t('deductionsDate'))}</th><th>{sortableHeader('farmerName', accountCopy('deductionsFarmer', 'milkAbacunda'))}</th><th>{publicLanguage.t('deductionsType')}</th><th>{publicLanguage.t('deductionsReason')}</th><th>{sortableHeader('amount', publicLanguage.t('deductionsAmount'))}</th><th>{publicLanguage.t('deductionsStatus')}</th></tr></thead><tbody>{deductionData.map((row) => <tr key={row.id}><td>{String(row.date).slice(0, 10)}</td><td>{row.farmerName || row.farmer_name || row.farmerId}</td><td>{row.type}</td><td>{row.reason || '—'}</td><td>{money(row.amount)}</td><td>{row.status}</td></tr>)}</tbody></table></div>
          <div className="deduction-mobile-list">{deductionData.map((row) => <article className="deduction-mobile-card" key={row.id}><header><div><b>{row.farmerName || row.farmer_name || row.farmerId}</b><small>{String(row.date).slice(0, 10)} · {row.type}</small></div><strong>{money(row.amount)} RWF</strong></header><p>{row.reason || '—'}</p><span className="milk-entry-state saved">{row.status}</span></article>)}</div>
        </> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><CircleDollarSign size={21} aria-hidden="true" /></span><b>{publicLanguage.t('deductionsEmptyTitle')}</b></div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
        {deductionRows?.hasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => loadDeductions(deductionRows.nextCursor, true)}>{publicLanguage.t('deductionsLoadOlder')} <ChevronDown size={16} /></button></div> : null}
      </section>
      {deductionCreateOpen ? <Modal ariaLabel={publicLanguage.t('deductionsAdd')} onClose={() => setDeductionCreateOpen(false)} dismissible={!busy}>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('deductionsAdd')}</h2></div><button type="button" className="icon-button" onClick={() => setDeductionCreateOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack compact" onSubmit={createDeduction}>
          <label>{accountCopy('deductionsSearch', 'milkAbacundaSearch')}<input type="search" placeholder={accountCopy('deductionsSearch', 'milkAbacundaSearch')} value={deductionFarmerSearch} onChange={(event) => { const search = event.target.value; setDeductionFarmerSearch(search); loadDeductionFarmers(search).catch((reason) => setDeductionCreateError(reason instanceof Error ? reason.message : 'Failed to search farmers.')); }} /></label>
          <label>{accountCopy('deductionsFarmer', 'milkAbacunda')}<select required value={deductionForm.farmerId} onChange={(event) => setDeductionForm({ ...deductionForm, farmerId: event.target.value })}><option value="">{accountCopy('deductionsFarmer', 'milkAbacunda')}</option>{deductionFarmers.map((farmer) => <option key={farmer.id} value={farmer.id}>{farmer.name}</option>)}</select></label>
          <label>{publicLanguage.t('deductionsAmount')}<input required type="number" min="0.01" step="0.01" value={deductionForm.amount} onChange={(event) => setDeductionForm({ ...deductionForm, amount: event.target.value })} /></label>
          <label>{publicLanguage.t('deductionsType')}<select value={deductionForm.type} onChange={(event) => setDeductionForm({ ...deductionForm, type: event.target.value })}><option>Advance</option><option>Umwenda</option><option>Other</option></select></label>
          <label>{publicLanguage.t('deductionsDate')}<input type="date" required value={deductionForm.date} onChange={(event) => setDeductionForm({ ...deductionForm, date: event.target.value })} /></label>
          <label>{publicLanguage.t('deductionsReason')}<input value={deductionForm.reason} onChange={(event) => setDeductionForm({ ...deductionForm, reason: event.target.value })} /></label>
          <label>{publicLanguage.t('deductionsNotes')}<textarea rows={3} value={deductionForm.notes} onChange={(event) => setDeductionForm({ ...deductionForm, notes: event.target.value })} /></label>
          {deductionCreateError ? <p className="form-error" role="alert">{deductionCreateError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setDeductionCreateOpen(false)} disabled={busy}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy || !deductionForm.farmerId || !deductionForm.amount}>{busy ? publicLanguage.t('wait') : publicLanguage.t('deductionsAdd')}</button></div>
        </form>
      </Modal> : null}
    </div>;
  };

  const renderSettlements = () => {
    const { startDate, endDate } = getSettlementPeriodBounds(settlementMonth, settlementHalf);
    const confirmableRows = settlementData?.data || [];
    const retainedRows = settlementData?.retained || [];
    const settlementRecords = settlementData?.records || [];
    const settlementNumber = new Intl.NumberFormat(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { maximumFractionDigits: 0 });
    const settlementMoney = (value: number | null | undefined) => value === null || value === undefined ? '—' : settlementNumber.format(Number(value || 0));
    const settlementDate = (value?: string) => value
      ? formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const settlementStatus = (status: string) => {
      const statusKeys: Record<string, Parameters<PublicLanguageState['t']>[0]> = {
        PENDING: 'settlementsStatusPending',
        APPROVED: 'settlementsStatusApproved',
        CONFIRMED: 'settlementsStatusConfirmed',
        REJECTED: 'settlementsStatusRejected',
        PARTIALLY_SETTLED: 'settlementsStatusPartiallySettled',
        SETTLED: 'settlementsStatusSettled',
      };
      return statusKeys[status] ? publicLanguage.t(statusKeys[status]) : status;
    };
    const requestKey = (scope: string) => {
      settlementRequestKeys.current[scope] ||= globalThis.crypto?.randomUUID?.() || `${user?.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return settlementRequestKeys.current[scope];
    };

    const approveCashPayment = async (farmerId: number, amount: number) => {
      const keyScope = `cash-${farmerId}-${startDate}`;
      await api('/api/farmer-settlements', json('POST', {
        action: 'cash', farmerId, amount, periodStart: startDate, periodEnd: endDate, requestKey: requestKey(keyScope),
      }));
      setNotice(publicLanguage.t('settlementsCashApproved'));
      await loadSettlementData();
      delete settlementRequestKeys.current[keyScope];
    };

    const addFarmerDebt = async (event: React.FormEvent) => {
      event.preventDefault();
      const keyScope = `debt-${debtForm.farmerId}-${startDate}`;
      await api('/api/farmer-settlements', json('POST', {
        action: 'debt', farmerId: Number(debtForm.farmerId), openingBalance: Number(debtForm.amount),
        periodStart: startDate, periodEnd: endDate, requestKey: requestKey(keyScope), reason: debtForm.reason || 'DEBT',
      }));
      setNotice(publicLanguage.t('settlementsDebtRecorded'));
      await loadSettlementData();
      delete settlementRequestKeys.current[keyScope];
      setDebtForm({ farmerId: '', amount: '', reason: '' });
    };

    const repayFarmerDebt = async (debtId: number) => {
      const keyScope = `repay-${debtId}`;
      await api('/api/farmer-settlements', json('POST', {
        action: 'debt-repayment', debtId, amount: Number(debtRepaymentAmounts[debtId] || 0), requestKey: requestKey(keyScope),
      }));
      setNotice(publicLanguage.t('settlementsRepaymentRecorded'));
      await loadSettlementData();
      delete settlementRequestKeys.current[keyScope];
      setDebtRepaymentAmounts((current) => ({ ...current, [debtId]: '' }));
    };

    const confirmCashPayment = async (row: SettlementRecord) => {
      await api('/api/farmer-settlements', json('POST', {
        action: 'confirm', settlementId: row.settlementId, farmerId: row.farmerId,
        periodStart: row.periodStart, periodEnd: row.periodEnd,
      }));
      setNotice(publicLanguage.t('settlementsPaymentConfirmed'));
      await loadSettlementData();
    };

    return <div className="ukwezi-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardPeriod')}</span><h2>{publicLanguage.t('settlementsTitle')}</h2></div><Wallet size={20} aria-hidden="true" /></div>
        <div className="toolbar"><label>{publicLanguage.t('ukweziMonth')}<input type="month" value={settlementMonth} onChange={(event) => setSettlementMonth(event.target.value)} /></label><label>{publicLanguage.t('ukweziPeriod')}<select value={settlementHalf} onChange={(event) => setSettlementHalf(event.target.value as typeof settlementHalf)}><option value="first-half">1–15</option><option value="second-half">16–{getMonthBounds(settlementMonth).endDate.slice(-2)}</option></select></label><button type="button" className="button button-secondary" onClick={() => run(() => loadSettlementData())} disabled={busy || settlementLoading}>{publicLanguage.t('reportsRefresh')}</button></div>
        <p role="note">{publicLanguage.t('settlementsNote')}</p>
        {settlementError ? <div className="workspace-empty" role="alert"><b>{publicLanguage.t('settlementsLoadError')}</b><button type="button" className="button button-secondary small-button" onClick={() => loadSettlementData()} disabled={settlementLoading}>{publicLanguage.t('settlementsRetry')}</button></div> : null}
        {settlementLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}

        {isDairy ? <>
          <div className="metric-strip"><div><span>{publicLanguage.t('settlementsRetainedFarmers')}</span><b>{settlementNumber.format(settlementData?.summary?.retainedCount ?? 0)}</b></div><div><span>{publicLanguage.t('settlementsRetainedPayable')}</span><b>{settlementMoney(settlementData?.summary?.retainedAmount)} RWF</b></div><div><span>{publicLanguage.t('settlementsAwaitingConfirmation')}</span><b>{settlementNumber.format(settlementData?.summary?.approvedCount ?? 0)}</b></div></div>
          <div className="table-wrap"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsRetainedBalance')}</th><th>{publicLanguage.t('settlementsCashPayment')}</th><th /></tr></thead><tbody>
            {retainedRows.map((farmer) => <tr key={farmer.farmerId}><td>{farmer.farmerName}</td><td>{farmer.netAmount === null ? publicLanguage.t('settlementsIncompleteAccounting') : `${settlementMoney(farmer.retainedAmount)} RWF`}</td><td><input aria-label={`${publicLanguage.t('settlementsCashAmount')} · ${farmer.farmerName}`} type="number" min="0.01" max={farmer.retainedAmount} step="0.01" value={settlementAmounts[farmer.farmerId] ?? String(farmer.retainedAmount)} onChange={(event) => setSettlementAmounts((current) => ({ ...current, [farmer.farmerId]: event.target.value }))} /></td><td><button type="button" className="button button-secondary" disabled={busy || farmer.netAmount === null || farmer.retainedAmount <= 0} onClick={() => runSettlement(() => approveCashPayment(farmer.farmerId, Number(settlementAmounts[farmer.farmerId] ?? farmer.retainedAmount)))}>{publicLanguage.t('settlementsApproveCash')}</button></td></tr>)}
            {!retainedRows.length ? <tr><td colSpan={4}>{publicLanguage.t('settlementsEmptyRetained')}</td></tr> : null}
          </tbody></table></div>
          <div className="table-wrap"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsCashAmount')}</th><th>{publicLanguage.t('settlementsPeriod')}</th><th>{publicLanguage.t('settlementsStatus')}</th></tr></thead><tbody>
            {settlementRecords.map((record) => <tr key={record.id}><td>{record.farmer_name}</td><td>{settlementMoney(record.amount)} RWF</td><td>{settlementDate(record.period_start)} – {settlementDate(record.period_end)}</td><td>{settlementStatus(record.status)}</td></tr>)}
            {!settlementRecords.length ? <tr><td colSpan={4}>{publicLanguage.t('settlementsEmptyRecords')}</td></tr> : null}
          </tbody></table></div>
          <form className="panel-footer settlement-debt-form" onSubmit={(event) => runSettlement(() => addFarmerDebt(event))}>
            <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('settlementsFarmerDebt')}</span><h3>{publicLanguage.t('settlementsRecordDebt')}</h3></div></div>
            <div className="toolbar"><label>{publicLanguage.t('settlementsFarmerId')}<input type="number" min="1" required value={debtForm.farmerId} onChange={(event) => setDebtForm((current) => ({ ...current, farmerId: event.target.value }))} /></label><label>{publicLanguage.t('settlementsAmount')}<input type="number" min="0.01" step="0.01" required value={debtForm.amount} onChange={(event) => setDebtForm((current) => ({ ...current, amount: event.target.value }))} /></label><label>{publicLanguage.t('settlementsReason')}<input value={debtForm.reason} onChange={(event) => setDebtForm((current) => ({ ...current, reason: event.target.value }))} /></label><button type="submit" className="button button-primary" disabled={busy}>{publicLanguage.t('settlementsRecordDebt')}</button></div>
          </form>
          <div className="table-wrap"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsOriginalDebt')}</th><th>{publicLanguage.t('settlementsOutstanding')}</th><th>{publicLanguage.t('settlementsRepayment')}</th><th /></tr></thead><tbody>
            {settlementDebts.map((debt) => <tr key={debt.id}><td>{debt.farmer_name}</td><td>{settlementMoney(Number(debt.opening_balance))} RWF</td><td>{settlementMoney(Number(debt.remaining_balance))} RWF</td><td><input aria-label={`${publicLanguage.t('settlementsRepayment')} · ${debt.farmer_name}`} type="number" min="0.01" step="0.01" max={Number(debt.remaining_balance)} value={debtRepaymentAmounts[debt.id] || ''} onChange={(event) => setDebtRepaymentAmounts((current) => ({ ...current, [debt.id]: event.target.value }))} /></td><td><button type="button" className="button button-secondary" disabled={busy || !debtRepaymentAmounts[debt.id]} onClick={() => runSettlement(() => repayFarmerDebt(Number(debt.id)))}>{publicLanguage.t('settlementsRecordRepayment')}</button></td></tr>)}
            {!settlementDebts.length ? <tr><td colSpan={5}>{publicLanguage.t('settlementsEmptyDebts')}</td></tr> : null}
          </tbody></table></div>
        </> : <div className="table-wrap"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsApprovedPayment')}</th><th>{publicLanguage.t('settlementsPeriod')}</th><th>{publicLanguage.t('settlementsAction')}</th></tr></thead><tbody>
          {confirmableRows.map((record) => <tr key={record.settlementId}><td>{record.farmerName}</td><td>{settlementMoney(record.amount)} RWF</td><td>{settlementDate(record.periodStart)} – {settlementDate(record.periodEnd)}</td><td><button type="button" className="button button-secondary" disabled={busy} onClick={() => runSettlement(() => confirmCashPayment(record))}>{publicLanguage.t('settlementsConfirmReceived')}</button></td></tr>)}
          {!confirmableRows.length ? <tr><td colSpan={4}>{publicLanguage.t('settlementsEmptyApproved')}</td></tr> : null}
        </tbody></table></div>}
      </section>
    </div>;
  };

  const renderReports = () => {
    const reportRows = report?.farmerPayments || [];
    const dairyCollectorRows = report?.collectorSettlementRows || [];
    return <section className="panel reports-view">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardPeriod')}</span><h2>{publicLanguage.t('navReports')}</h2></div><div className="toolbar">{centers.length ? <label>{isDairy ? 'Active Ikigo' : publicLanguage.t('dashboardCenter')}<select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}<input type="month" aria-label={publicLanguage.t('dashboardPeriod')} value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /><button className="button button-secondary" onClick={() => run(loadReport)}>{publicLanguage.t('reportsRefresh')}</button></div></div>
      {report ? <>
        <div className="metric-strip report-summary"><div><span>{publicLanguage.t('reportsVolume')}</span><b>{liters(isCollector ? report.ownerGeneratedVolume ?? report.totalVolume : report.totalVolume)} L</b></div><div><span>{publicLanguage.t('reportsRevenue')}</span><b>{isCollector && report.ownerGeneratedGross == null ? publicLanguage.t('collectorPriceMissing') : `${money(isCollector ? report.ownerGeneratedGross ?? report.totalRevenueMonth : report.totalRevenueMonth)} RWF`}</b></div><div><span>{publicLanguage.t('reportsTransport')}</span><b>{money(report.totalTransportFeesMonth)} RWF</b></div><div><span>{publicLanguage.t('dashboardDeductions')}</span><b>{money(report.totalDeductionsMonth)} RWF</b></div><div><span>{publicLanguage.t('reportsNet')}</span><b>{isCollector && report.collectorPayable == null ? publicLanguage.t('collectorPriceMissing') : `${money(isCollector ? report.collectorPayable ?? 0 : report.netRevenueMonth)} RWF`}</b></div></div>
        <div className="report-summary-panels">
          <article className="panel compact-panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h3>{publicLanguage.t('navReports')}</h3></div></div><dl className="summary-grid"><div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(isCollector ? report.ownerGeneratedVolume ?? report.totalVolume : report.totalVolume)} L</dd></div><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{money(isCollector ? report.ownerGeneratedGross ?? report.totalRevenueMonth : report.totalRevenueMonth)} RWF</dd></div><div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(report.totalDeductionsMonth)} RWF</dd></div><div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(report.totalTransportFeesMonth)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{money(isCollector ? report.collectorPayable ?? 0 : report.netRevenueMonth)} RWF</dd></div></dl></article>
          {isDairy ? <article className="panel compact-panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardSummary')}</span><h3>{publicLanguage.t('navAbacunda')}</h3></div></div><dl className="summary-grid"><div><dt>{publicLanguage.t('navAbacunda')}</dt><dd>{dairyCollectorRows.length}</dd></div><div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(dairyCollectorRows.reduce((sum, row) => sum + Number(row.totalVolume || 0), 0))} L</dd></div><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{money(dairyCollectorRows.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0))} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{money(dairyCollectorRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0))} RWF</dd></div></dl></article> : null}
          {!isDairy && reportRows.length ? <article className="panel compact-panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('account')}</span><h3>{publicLanguage.t('reportSummary')}</h3></div></div><dl className="summary-grid"><div><dt>{publicLanguage.t('account')}</dt><dd>{reportRows.length}</dd></div><div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(reportRows.reduce((sum, row) => sum + Number(row.totalVolume || 0), 0))} L</dd></div><div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(reportRows.reduce((sum, row) => sum + Number(row.totalDeductions || 0), 0))} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{money(reportRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0))} RWF</dd></div></dl></article> : null}
        </div>
        {(!isDairy && !reportRows.length) || (isDairy && !dairyCollectorRows.length) ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><FileBarChart2 size={21} aria-hidden="true" /></span><b>{publicLanguage.t('reportsEmptyTitle')}</b></div> : null}
      </> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
    </section>;
  };

  const renderUkwezi = () => {
    const collectorReport = ukweziReport as (Report & CollectorSettlementFields) | null;
    const settlementRows = isDairy ? ukweziReport?.collectorSettlementRows || [] : ukweziReport?.farmerPayments || [];
    const ownerRow = ukweziReport?.ownerSettlementRow || null;
    const actualVolume = ukweziReport?.ownerGeneratedVolume ?? ukweziReport?.totalVolume ?? 0;
    const ownerGross = isCollector
      ? ukweziReport?.ownerGeneratedGross ?? null
      : ukweziReport?.totalRevenueMonth ?? 0;
    const assignedVolume = ukweziReport?.collectorFarmersValidLiters ?? ukweziReport?.totalVolume ?? 0;
    const payable = isCollector ? ukweziReport?.collectorPayable : ukweziReport?.netRevenueMonth;
    const missingInputs = collectorReport?.collectorAccountingMissingInputs || [];
    const missingInputMessages = [
      missingInputs.includes('owner_historical_price') ? publicLanguage.t('collectorPriceMissing') : null,
      missingInputs.includes('farmer_historical_price') ? publicLanguage.t('farmerPriceMissing') : null,
      missingInputs.includes('farmer_transport_snapshot') ? publicLanguage.t('transportHistoryUnavailable') : null,
    ].filter(Boolean);
    const sortableUkweziHeader = (field: typeof ukweziSortBy, label: string) => {
      const active = ukweziSortBy === field;
      const SortIcon = active ? ukweziSortDirection === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
      return <button type="button" className="farmer-sort-button" aria-sort={active ? ukweziSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => {
        if (active) setUkweziSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        else { setUkweziSortBy(field); setUkweziSortDirection(field === 'name' ? 'asc' : 'desc'); }
      }}>{label}<SortIcon size={13} aria-hidden="true" /></button>;
    };
    const lossRows = [
      ...(ukweziReport?.milkLossRecords || []).map((row) => ({
        key: `farmer-${row.id}`,
        date: row.date,
        source: row.farmerName,
        original: row.originalVolume,
        valid: row.validVolume,
        lost: row.lostVolume,
        status: row.status,
        reason: row.reason,
        actor: row.adjustedBy,
        when: row.adjustedAt,
      })),
      ...(ukweziReport?.collectorEntries || []).filter((entry) => entry.status === 'cancelled' || entry.farmerLostLiters > 0).map((entry) => ({
        key: `collector-${entry.id}`,
        date: entry.date,
        source: ukweziReport?.collectorProfile?.name || publicLanguage.t('collectorMilkSource'),
        original: entry.volumeLiters,
        valid: entry.effectiveVolumeLiters,
        lost: entry.status === 'cancelled' ? entry.volumeLiters : entry.farmerLostLiters,
        status: entry.status,
        reason: entry.voidReason || null,
        actor: entry.voidedBy || null,
        when: entry.voidedAt || null,
      })),
    ];
    const years = Array.from({ length: new Date().getFullYear() - 1999 }, (_, index) => String(new Date().getFullYear() - index));
    const monthNames = getMonthNames(publicLanguage.language);
    const ukweziPdfParams = new URLSearchParams({ month: ukweziMonth, year: ukweziYear, periodType: ukweziPeriod });
    ukweziPdfParams.set('language', publicLanguage.language);
    const activeCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name;
    if (isDairy && activeCenterName) ukweziPdfParams.set('collectionCenter', activeCenterName);

    return <div className="ukwezi-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navUkwezi')}</span><h2>{publicLanguage.t(user?.accountType === 'COLLECTION_CENTER' ? 'dairyUkweziHeading' : 'collectorUkweziHeading')}</h2></div><Wallet size={20} aria-hidden="true" /></div>
        <div className="toolbar ukwezi-period-controls">
          {isDairy && centers.length ? <label>Active Ikigo<select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
          <label>{publicLanguage.t('ukweziMonth')}<select value={ukweziMonth} onChange={(event) => setUkweziMonth(event.target.value)}>{monthNames.map((name, index) => <option key={index + 1} value={String(index + 1).padStart(2, '0')}>{name}</option>)}</select></label>
          <label>{publicLanguage.t('ukweziYear')}<select value={ukweziYear} onChange={(event) => setUkweziYear(event.target.value)}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label>{publicLanguage.t('ukweziPeriod')}<select value={ukweziPeriod} onChange={(event) => setUkweziPeriod(event.target.value as 'first-half' | 'second-half')}><option value="first-half">1–15</option><option value="second-half">16–{new Date(Number(ukweziYear), Number(ukweziMonth), 0).getDate()}</option></select></label>
          <label className="ukwezi-sort-mobile">{publicLanguage.t('sort')}<select value={`${ukweziSortBy}:${ukweziSortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); if (['name', 'volume', 'payable'].includes(field) && ['asc', 'desc'].includes(direction)) { setUkweziSortBy(field as typeof ukweziSortBy); setUkweziSortDirection(direction as typeof ukweziSortDirection); } }}>
            <option value="name:asc">{publicLanguage.t('milkFarmer')} ↑</option><option value="name:desc">{publicLanguage.t('milkFarmer')} ↓</option>
            <option value="volume:asc">{publicLanguage.t('reportsVolume')} ↑</option><option value="volume:desc">{publicLanguage.t('reportsVolume')} ↓</option>
            <option value="payable:asc">{publicLanguage.t('reportsNet')} ↑</option><option value="payable:desc">{publicLanguage.t('reportsNet')} ↓</option>
          </select></label>
          <button type="button" className="button button-secondary" onClick={() => run(loadUkwezi)}>{publicLanguage.t('reportsRefresh')}</button>
          <button type="button" className="button button-secondary" onClick={() => { void downloadUkweziPdf(ukweziPdfParams); }} disabled={ukweziPdfLoading} aria-busy={ukweziPdfLoading} aria-label={publicLanguage.t('ukweziDownloadPdf')}><FileBarChart2 size={16} aria-hidden="true" />{publicLanguage.t(ukweziPdfLoading ? 'ukweziPdfPreparing' : 'ukweziDownloadPdf')}</button>
        </div>
        {ukweziPdfError ? <p className="form-error" role="alert">{ukweziPdfError}</p> : null}
        {ukweziPdfStatus ? <p className="form-success" role="status">{ukweziPdfStatus}</p> : null}
        {ukweziReport ? <>
          <p className="muted-note">{ukweziReport.rangeStart} – {ukweziReport.rangeEnd}</p>
          <div className="metric-strip ukwezi-totals">
            <div><span>{publicLanguage.t('ukweziOwnerTotal')}</span><b>{liters(actualVolume)} L</b><small>{ownerGross === null ? '—' : `${money(ownerGross)} RWF`}</small></div>
            <div><span>{publicLanguage.t(user?.accountType === 'COLLECTION_CENTER' ? 'navAbacunda' : 'ukweziAllocated')}</span><b>{liters(assignedVolume)} L</b><small>{isCollector ? money(collectorReport?.collectorFarmerMilkValue) : money(ukweziReport.totalRevenueMonth)} RWF</small></div>
            <div><span>{publicLanguage.t('dashboardDeductions')}</span><b>{money(ukweziReport.totalDeductionsMonth)} RWF</b></div>
            {isCollector ? <div><span>{publicLanguage.t('reportsTransport')}</span><b>{ukweziReport.collectorFarmerTransport == null ? '—' : `${money(ukweziReport.collectorFarmerTransport)} RWF`}</b></div> : null}
            {isCollector ? <div><span>{publicLanguage.t('collectorFarmerPayable')}</span><b>{collectorReport?.collectorFarmerPayable == null ? '—' : `${money(collectorReport.collectorFarmerPayable)} RWF`}</b></div> : null}
            <div><span>{publicLanguage.t('ukweziPayable')}</span><b>{payable === null || payable === undefined ? '—' : `${money(payable)} RWF`}</b></div>
          </div>
          {isCollector ? <section className="settlement-reconciliation" role="status">
            <b>{ukweziReport.settlementAccountingStatus === 'MIGRATION_REQUIRED'
              ? publicLanguage.t('ukweziReconciliationUnavailable')
              : ukweziReport.collectorIsReconciled ? publicLanguage.t('ukweziReconciled') : publicLanguage.t('ukweziReconciliationPending')}</b>
            {ukweziReport.settlementAccountingStatus === 'MIGRATION_REQUIRED'
              ? <span>{publicLanguage.t('ukweziReconciliationUnavailableDetail')}</span>
              : ukweziReport.collectorIsReconciled === null
                ? <span>{missingInputMessages.length ? missingInputMessages.join(' · ') : publicLanguage.t('ukweziReconciliationPending')}</span>
                : ukweziReport.collectorSurplusAmount == null || ukweziReport.collectorFarmerDeductions == null || ukweziReport.collectorFarmerTransport == null || ukweziReport.collectorPayableFromBreakdown == null
                  ? <span>{publicLanguage.t('ukweziBreakdownUnavailable')}</span>
                  : <span>{publicLanguage.t('ukweziBreakdown')}: {money(ukweziReport.collectorSurplusAmount)} + {money(ukweziReport.collectorFarmerDeductions)} + {money(ukweziReport.collectorFarmerTransport)} = {money(ukweziReport.collectorPayableFromBreakdown)} RWF</span>}
          </section> : null}
          {ukweziReport.settlementAccountingStatus === 'MIGRATION_REQUIRED' && !ukweziReport.settlementAccounting ? <p className="form-error" role="alert">{publicLanguage.t('ukweziReconciliationUnavailableDetail')}</p> : null}
          {ukweziReport.settlementAccounting ? <section className="ukwezi-loss-reconciliation">
            <div className="panel-heading"><div><span className="eyebrow">Settlement and debt</span><h3>Period payment reconciliation</h3></div></div>
            <div className="metric-strip report-summary">
              <div><span>Farmer gross</span><b>{money(ukweziReport.settlementAccounting.farmerGross)} RWF</b></div>
              <div><span>Farmer payable</span><b>{money(ukweziReport.settlementAccounting.expectedFarmerPayable)} RWF</b></div>
              <div><span>SACCO instruction</span><b>{money(ukweziReport.settlementAccounting.saccoDistributionInstruction)} RWF</b></div>
              <div><span>Cash approved / received</span><b>{money(ukweziReport.settlementAccounting.cashApprovedAmount)} / {money(ukweziReport.settlementAccounting.cashConfirmedAmount)} RWF</b></div>
              <div><span>Debt repaid / outstanding</span><b>{money(ukweziReport.settlementAccounting.debtRepaymentAmount)} / {ukweziReport.settlementAccounting.debtBalancesComplete ? `${money(ukweziReport.settlementAccounting.outstandingDebt)} RWF` : 'Incomplete history'}</b></div>
              <div><span>Retained unpaid</span><b>{money(ukweziReport.settlementAccounting.retainedUnpaidAmount)} RWF</b></div>
              <div><span>Unexplained difference</span><b>{money(ukweziReport.settlementAccounting.unexplainedDiscrepancy)} RWF</b></div>
            </div>
            <p className="muted-note">Owner gross check: {money(ukweziReport.settlementAccounting.ownerGrossReconciliation.ownerGross)} - {money(ukweziReport.settlementAccounting.ownerGrossReconciliation.farmerGross)} - {money(ukweziReport.settlementAccounting.ownerGrossReconciliation.surplus)} = {money(ukweziReport.settlementAccounting.ownerGrossReconciliation.discrepancy)} RWF</p>
            {!ukweziReport.settlementAccounting.debtBalancesComplete ? <p className="form-error" role="status">Legacy debt repayments have no reliable period dates; outstanding debt is incomplete.</p> : null}
            <div className="table-scroll"><table><thead><tr><th>Farmer</th><th>Milk gross</th><th>Payable</th><th>SACCO instruction</th><th>Cash approved</th><th>Cash received</th><th>Debt repaid</th><th>Debt outstanding</th><th>Retained unpaid</th><th>Difference</th></tr></thead><tbody>
              {ukweziReport.settlementAccounting.farmers.map((farmer) => <tr key={`settlement-${farmer.farmerId}`}><td>{farmer.farmerName}</td><td>{money(farmer.grossAmount)} RWF</td><td>{money(farmer.netAmount)} RWF</td><td>{money(farmer.settlement.saccoDistributionInstruction)} RWF</td><td>{money(farmer.settlement.cashApprovedAmount)} RWF</td><td>{money(farmer.settlement.cashConfirmedAmount)} RWF</td><td>{money(farmer.settlement.debtRepaymentAmount)} RWF</td><td>{farmer.settlement.outstandingDebt === null ? 'Incomplete history' : `${money(farmer.settlement.outstandingDebt)} RWF`}</td><td>{money(farmer.settlement.retainedUnpaidAmount)} RWF</td><td>{farmer.settlement.unexplainedDiscrepancy === null ? '—' : `${money(farmer.settlement.unexplainedDiscrepancy)} RWF`}</td></tr>)}
              {!ukweziReport.settlementAccounting.farmers.length ? <tr><td colSpan={10}>No farmer milk activity for this period.</td></tr> : null}
            </tbody></table></div>
          </section> : null}
          {settlementRows.length || ownerRow ? <><div className="table-scroll ukwezi-settlement-table"><table><thead><tr><th>No</th><th>{sortableUkweziHeader('name', publicLanguage.t(isDairy ? 'assignedCollectors' : 'milkFarmer'))}</th>{isDairy ? <th>{publicLanguage.t('navAbacunda')}</th> : <th>{publicLanguage.t('accountNationalId')}</th>}<th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{sortableUkweziHeader('volume', publicLanguage.t('reportsVolume'))}</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('reportsGross')}</th>{isCollector ? <th>{publicLanguage.t('reportsTransport')}</th> : null}<th>{publicLanguage.t('dashboardDeductions')}</th><th>{sortableUkweziHeader('payable', publicLanguage.t('reportsNet'))}</th></tr></thead><tbody>
            {settlementRows.map((row: any, index: number) => <tr key={`${isDairy ? 'collector' : 'farmer'}-${isDairy ? row.collectorUserId : row.farmerId}`}><td>{index + 1}</td><td>{isDairy ? row.name : row.farmerName}</td>{isDairy ? <td>{row.assignedFarmerCount}</td> : <td>{row.nationalId || row.idNumber || '—'}</td>}<td>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(row.totalVolume)} L</td><td>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</td><td>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</td>{isCollector ? <td>{money(row.totalTransport)} RWF</td> : null}<td>{money(row.totalDeductions)} RWF</td><td>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</td></tr>)}
            {ownerRow ? <tr className="owner-settlement-row"><td>{settlementRows.length + 1}</td><td><b>{ownerRow.farmerName}</b><small className="block-muted">{publicLanguage.t('ukweziOwnerRow')}</small></td><td>{ownerRow.nationalId || ownerRow.idNumber || '—'}</td><td>{[ownerRow.phone, ownerRow.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(ownerRow.totalVolume)} L</td><td>{ownerRow.pricePerLiter == null ? '—' : `${money(ownerRow.pricePerLiter)} RWF`}</td><td>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</td>{isCollector ? <td>{money(ownerRow.totalTransport)} RWF</td> : null}<td>{money(ownerRow.totalDeductions)} RWF</td><td>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</td></tr> : null}
          </tbody></table></div><div className="ukwezi-mobile-list">{settlementRows.map((row: any) => <article className="ukwezi-mobile-card" key={`mobile-${isDairy ? row.collectorUserId : row.farmerId}`}><header><b>{isDairy ? row.name : row.farmerName}</b><strong>{liters(row.totalVolume)} L</strong></header><dl>{isDairy ? <div><dt>{publicLanguage.t('navAbacunda')}</dt><dd>{row.assignedFarmerCount}</dd></div> : <div><dt>{publicLanguage.t('accountNationalId')}</dt><dd>{row.nationalId || row.idNumber || '—'}</dd></div>}<div><dt>{publicLanguage.t('milkPrice')} / L</dt><dd>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</dd></div><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(row.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(row.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</dd></div></dl><p>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</p></article>)}{ownerRow ? <article className="ukwezi-mobile-card owner-settlement-row"><header><b>{ownerRow.farmerName} · {publicLanguage.t('ukweziOwnerRow')}</b><strong>{liters(ownerRow.totalVolume)} L</strong></header><dl><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(ownerRow.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(ownerRow.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</dd></div></dl></article> : null}</div></> : null}
          {lossRows.length ? <section className="ukwezi-loss-reconciliation"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiLost')}</span><h3>{publicLanguage.t('ukweziLossReconciliation')}</h3></div></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('ifishiOriginal')}</th><th>{publicLanguage.t('ifishiValid')}</th><th>{publicLanguage.t('ifishiLost')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('when')}</th></tr></thead><tbody>{lossRows.map((row) => <tr key={row.key}><td>{row.date}</td><td>{row.source}</td><td>{liters(row.original)} L</td><td>{liters(row.valid)} L</td><td>{liters(row.lost)} L</td><td>{row.status}</td><td>{row.reason || '—'}</td><td>{row.actor || '—'}</td><td>{row.when ? formatDateLabel(row.when, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td></tr>)}</tbody></table></div></section> : null}
        </> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
      </section>
    </div>;
  };

  const renderTransport = () => <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navTransport')}</span><h2>{publicLanguage.t('collectorTransportTitle')}</h2></div><Truck size={20} aria-hidden="true" /></div>
    <div className="toolbar ukwezi-period-controls">
      <label>{publicLanguage.t('ukweziMonth')}<select value={ukweziMonth} onChange={(event) => setUkweziMonth(event.target.value)}>{getMonthNames(publicLanguage.language).map((name, index) => <option key={index + 1} value={String(index + 1).padStart(2, '0')}>{name}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziYear')}<select value={ukweziYear} onChange={(event) => setUkweziYear(event.target.value)}>{Array.from({ length: new Date().getFullYear() - 1999 }, (_, index) => String(new Date().getFullYear() - index)).map((year) => <option key={year}>{year}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziPeriod')}<select value={ukweziPeriod} onChange={(event) => setUkweziPeriod(event.target.value as 'first-half' | 'second-half')}><option value="first-half">1–15</option><option value="second-half">16–{new Date(Number(ukweziYear), Number(ukweziMonth), 0).getDate()}</option></select></label>
    </div>
    {ukweziReport ? <div className="metric-strip"><div><span>{publicLanguage.t('collectorTransportPayable')}</span><b>{ukweziReport.collectorFarmerTransport == null ? '—' : `${money(ukweziReport.collectorFarmerTransport)} RWF`}</b></div><div><span>{publicLanguage.t('ukweziOwnerTotal')}</span><b>{ukweziReport.ownerGeneratedGross == null ? '—' : `${money(ukweziReport.ownerGeneratedGross)} RWF`}</b></div></div> : null}
    <p className="muted-note">{publicLanguage.t('collectorTransportRule')}</p>
  </section>;

  const renderAccountSettings = () => {
    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      let nextTab: 'personal' | 'management' | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextTab = accountSettingsTab === 'personal' ? 'management' : 'personal';
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextTab = accountSettingsTab === 'personal' ? 'management' : 'personal';
      if (event.key === 'Home') nextTab = 'personal';
      if (event.key === 'End') nextTab = 'management';
      if (!nextTab) return;
      event.preventDefault();
      setAccountSettingsTab(nextTab);
      document.getElementById(`account-settings-tab-${nextTab}`)?.focus();
    };

    return <div className="account-settings-view">
      <div className="account-settings-tabs" role="tablist" aria-label={publicLanguage.t('accountSettings')}>
        <button type="button" id="account-settings-tab-personal" className="account-settings-tab" role="tab" aria-selected={accountSettingsTab === 'personal'} aria-controls="account-settings-panel-personal" tabIndex={accountSettingsTab === 'personal' ? 0 : -1} onClick={() => setAccountSettingsTab('personal')} onKeyDown={handleTabKeyDown}>
          <UserRound size={17} aria-hidden="true" />{publicLanguage.t('myAccount')}
        </button>
        <button type="button" id="account-settings-tab-management" className="account-settings-tab" role="tab" aria-selected={accountSettingsTab === 'management'} aria-controls="account-settings-panel-management" tabIndex={accountSettingsTab === 'management' ? 0 : -1} onClick={() => setAccountSettingsTab('management')} onKeyDown={handleTabKeyDown}>
          <Building2 size={17} aria-hidden="true" />{publicLanguage.t('accountManagement')}
        </button>
      </div>

      <section className="account-settings-panel" id="account-settings-panel-personal" role="tabpanel" aria-labelledby="account-settings-tab-personal" tabIndex={0} hidden={accountSettingsTab !== 'personal'}>
        <section className="panel panel-wide account-settings-profile">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('myAccount')}</span><h2>{publicLanguage.t('accountProfileDescription')}</h2></div><UserRound size={20} aria-hidden="true" /></div>
          {accountProfile ? <form className="form-stack account-settings-form" onSubmit={saveAccountSettings}>
            <div className="account-avatar-row">
              <div className="account-avatar-preview">{accountForm.profilePicture ? <img src={accountForm.profilePicture} alt="" /> : <span>{accountForm.name.trim().slice(0, 1).toUpperCase() || '?'}</span>}</div>
              <div><label className="button button-secondary account-avatar-upload">{publicLanguage.t('accountAvatarUpload')}<input type="file" accept="image/*" onChange={updateAccountAvatar} /></label>
                {accountForm.profilePicture ? <button type="button" className="text-button" onClick={() => setAccountForm((form) => ({ ...form, profilePicture: '' }))}>{publicLanguage.t('accountAvatarRemove')}</button> : null}
                {accountAvatarError ? <p className="form-error" role="alert">{accountAvatarError}</p> : null}
              </div>
            </div>
            <div className="account-settings-fields">
              <label>{publicLanguage.t('accountName')}<input autoComplete="name" required maxLength={255} value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} /></label>
              <label>{publicLanguage.t('email')}<input type="email" autoComplete="email" required maxLength={255} readOnly={accountProfile.role === 'super_admin'} value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} />{accountEmailChangePending ? <small role="status">{publicLanguage.t('accountEmailChangeTarget').replace('{email}', accountPendingEmail)}</small> : null}</label>
              <label>{publicLanguage.t('accountPhone')}<input type="tel" inputMode="tel" autoComplete="tel" value={accountForm.phone} onChange={(event) => setAccountForm({ ...accountForm, phone: event.target.value })} /></label>
              {accountProfile.role !== 'super_admin' ? <>
                <label>{publicLanguage.t('accountNationalId')}<input value={accountForm.nationalId} maxLength={50} onChange={(event) => setAccountForm({ ...accountForm, nationalId: event.target.value })} /></label>
                <label>{publicLanguage.t('accountNumber')}<input value={accountForm.accountNumber} maxLength={255} onChange={(event) => setAccountForm({ ...accountForm, accountNumber: event.target.value })} /></label>
              </> : null}
            </div>
            <button className="button button-primary" disabled={busy}><Check size={16} aria-hidden="true" />{publicLanguage.t('saveAccountProfile')}</button>
          </form> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('accountLoading')}</div>}
        </section>

        <section className="panel account-settings-preferences">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountLanguage')}</span><h2>{publicLanguage.t('languageLabel')}</h2></div></div>
          <div className="account-settings-quick-actions">
            <div className="language-setting"><span>{publicLanguage.t('accountLanguage')}</span><div className="public-language-switch" role="group" aria-label={publicLanguage.t('languageLabel')}>
              <button type="button" aria-label={publicLanguage.t('languageKinyarwanda')} aria-pressed={publicLanguage.language === 'rw'} onClick={() => publicLanguage.setLanguage('rw')}>RW</button>
              <button type="button" aria-label={publicLanguage.t('languageEnglish')} aria-pressed={publicLanguage.language === 'en'} onClick={() => publicLanguage.setLanguage('en')}>EN</button>
            </div></div>
          </div>
        </section>

        <section className="panel account-settings-security">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountSecurity')}</span><h2>{publicLanguage.t('accountChangePassword')}</h2></div><Shield size={20} aria-hidden="true" /></div>
          <form className="form-stack compact" onSubmit={changeAccountPassword}>
            <label>{publicLanguage.t('accountCurrentPassword')}<span className="password-field"><input type={accountPasswordVisibility.current ? 'text' : 'password'} autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisibility.current ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisibility.current} onClick={() => setAccountPasswordVisibility((visibility) => ({ ...visibility, current: !visibility.current }))}>{accountPasswordVisibility.current ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
            <label>{publicLanguage.t('accountNewPassword')}<span className="password-field"><input type={accountPasswordVisibility.next ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisibility.next ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisibility.next} onClick={() => setAccountPasswordVisibility((visibility) => ({ ...visibility, next: !visibility.next }))}>{accountPasswordVisibility.next ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
            <label>{publicLanguage.t('accountConfirmPassword')}<span className="password-field"><input type={accountPasswordVisibility.confirm ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={confirmAccountPassword} onChange={(event) => setConfirmAccountPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisibility.confirm ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisibility.confirm} onClick={() => setAccountPasswordVisibility((visibility) => ({ ...visibility, confirm: !visibility.confirm }))}>{accountPasswordVisibility.confirm ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
            <button className="button button-primary" disabled={busy}>{publicLanguage.t('accountChangePassword')}<ArrowRight size={16} aria-hidden="true" /></button>
          </form>
        </section>
      </section>
      <section className="account-settings-panel" id="account-settings-panel-management" role="tabpanel" aria-labelledby="account-settings-tab-management" tabIndex={0} hidden={accountSettingsTab !== 'management'}>
        <section className="panel account-settings-overview">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountManagement')}</span><h2>{publicLanguage.t('accountSettings')}</h2></div><Building2 size={20} aria-hidden="true" /></div>
          {accountProfile ? <div className="account-settings-summary">
            <div><span>{publicLanguage.t('accountTypeLabel')}</span><strong>{accountProfile.accountType === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : accountProfile.role === 'super_admin' ? publicLanguage.t('platformAdmin') : publicLanguage.t('collector')}</strong></div>
            <div><span>{publicLanguage.t('accountStatusLabel')}</span><strong className={`status-text status-${accountProfile.accountStatus}`}>{publicLanguage.t(accountStatusCopy[accountProfile.accountStatus as keyof typeof accountStatusCopy] || 'statusNone')}</strong></div>
            <div><span>{publicLanguage.t('emailVerificationStatus')}</span><strong>{accountProfile.emailVerified ? publicLanguage.t('emailVerifiedValue') : publicLanguage.t('emailNotVerifiedValue')}</strong></div>
            {billing?.subscription ? <div><span>{publicLanguage.t('navSubscription')}</span><strong>{subscriptionStatusLabel(billing.subscription.effective_status || billing.subscription.status)}</strong></div> : null}
          </div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('accountLoading')}</div>}
        </section>

        {isCollector ? <section className="panel panel-wide">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('collectorPriceTitle')}</h2></div><CircleDollarSign size={20} aria-hidden="true" /></div>
          <p className="muted-note">{publicLanguage.t('collectorPriceSubtitle')}</p>
          <form className="toolbar" onSubmit={saveCollectorPrice}>
            <label>{publicLanguage.t('collectorPriceLabel')}<input type="number" min="0.01" step="0.01" required value={collectorPriceForm.pricePerLiter} onChange={(event) => setCollectorPriceForm({ ...collectorPriceForm, pricePerLiter: event.target.value })} /></label>
            <label>{publicLanguage.t('collectorPriceDate')}<input type="date" required value={collectorPriceForm.effectiveDate} onChange={(event) => setCollectorPriceForm({ ...collectorPriceForm, effectiveDate: event.target.value })} /></label>
            <button className="button button-primary" disabled={busy}>{publicLanguage.t('collectorPriceSave')}</button>
          </form>
          {collectorPrices.length ? <ul className="notice-list">{collectorPrices.map((price) => <li className="notice-row" key={price.id}><b>{String(price.effectiveDate).slice(0, 10)}</b><span>{money(price.pricePerLiter)} RWF/L</span></li>)}</ul> : <p className="muted-note">{publicLanguage.t('collectorPriceEmpty')}</p>}
        </section> : null}
        {isCollector ? renderCenters() : null}
        {!isAdmin ? renderBilling() : null}
      </section>
    </div>;
  };

  const renderBilling = () => {
    const isCollectionCenterAccount = billing?.account?.accountType === 'COLLECTION_CENTER';
    const pricing = billing?.pricing;
    const payment = billing?.paymentConfiguration as PaymentConfiguration | undefined;
    const paymentPhoneValid = /^(?:\+?250|0)(?:78|79)\d{7}$/.test(paymentPhone.replace(/[\s-]/g, ''));
    const paymentStatusLabel = (status: string) => {
      switch (status) {
        case 'SUCCESS': return publicLanguage.t('paymentSuccessful');
        case 'PENDING': return publicLanguage.t('paymentPending');
        case 'FAILED': return publicLanguage.t('paymentFailed');
        case 'CANCELLED': return publicLanguage.t('paymentCancelled');
        case 'EXPIRED': return publicLanguage.t('paymentExpired');
        default: return status;
      }
    };
    const paymentMethodLabel = (item: any) => item.payment_method === 'MTN_MOMO_RWA' || item.provider === 'mtn_momo'
      ? <MtnMoMoBrand compact />
      : item.payment_method || item.provider || '—';
    const paymentDateLabel = (value: string | null) => value
      ? formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })
      : '—';
    const policyDateLabel = (value: string | null | undefined) => value
      ? formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })
      : '—';
    const selectedTier = billing?.plans?.find((plan: SubscriptionPlan) => plan.code === selectedSubscriptionPlanCode);
    const currentTier = billing?.usage?.currentTier;
    const recommendedTier = billing?.usage?.recommendedTier;
    return <div className="subscription-layout account-settings-subscription">
      <section className="panel subscription-overview" id="account-subscription-status">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountStatus')}</span><h2>{publicLanguage.t('navSubscription')}</h2></div><ClipboardList size={20} aria-hidden="true" /></div>
        {billingError ? <div className="form-error" role="alert">{billingError}<button type="button" className="text-button" onClick={() => loadBilling().catch(() => undefined)}>{publicLanguage.t('reportsRefresh')}</button></div> : null}
        {billingError && !billing ? null : billingLoading && !billing ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : <div className="subscription-state"><span className={`status-dot status-${billing?.subscription?.effective_status || billing?.subscription?.status || 'pending'}`} />{subscriptionStatusLabel(billing?.subscription?.effective_status || billing?.subscription?.status)}</div>}
        {billing?.subscription?.effective_status === 'suspended' || billing?.subscription?.effective_status === 'expired' ? <p className="form-error subscription-overdue" role="status">{publicLanguage.t('subscriptionOverdue')}</p> : null}
        {billing?.subscription ? <dl className="subscription-period-details">
          <div><dt>{publicLanguage.t('initialAccessStarted')}</dt><dd>{policyDateLabel(billing.subscription.access_started_at)}</dd></div>
          <div><dt>{publicLanguage.t('paymentDeadline')}</dt><dd>{policyDateLabel(billing.subscription.payment_due_at)}</dd></div>
          <div><dt>{publicLanguage.t('subscriptionStatus')}</dt><dd>{billing.payments?.[0] ? paymentStatusLabel(billing.payments[0].status) : publicLanguage.t('paymentPending')}</dd></div>
          {billing.subscription.subscription_ends_at ? <div><dt>{publicLanguage.t('nextRenewalDate')}</dt><dd>{policyDateLabel(billing.subscription.subscription_ends_at)}</dd></div> : null}
          {billing.subscription.next_period_started_at ? <div><dt>{publicLanguage.t('tierEffectiveDate')}</dt><dd>{policyDateLabel(billing.subscription.next_period_started_at)}</dd></div> : null}
        </dl> : null}
        {!isCollectionCenterAccount && billing?.usage ? <div className="subscription-usage"><div><span>{publicLanguage.t('subscriptionActualUsage')}</span><b>{liters(billing.usage.actualLiters)} L</b></div><div><span>{publicLanguage.t('subscriptionCurrentTier')}</span><b>{currentTier?.name || '—'}</b></div></div> : null}
        {!isCollectionCenterAccount && billing?.usage?.limitExceeded ? <div className="subscription-tier-warning" role="status">
          <strong>{publicLanguage.t('subscriptionTierExceeded')}</strong>
          <p>{liters(billing.usage.actualLiters)} L · {publicLanguage.t('subscriptionCurrentTier')}: {currentTier?.name} · {publicLanguage.t('subscriptionSuggestedTier')}: {recommendedTier?.name}</p>
          <p>{Number(recommendedTier?.min_volume_liters || 0).toLocaleString()}–{recommendedTier?.max_volume_liters == null ? '∞' : Number(recommendedTier.max_volume_liters).toLocaleString()} L · {money(Number(recommendedTier?.price))} {recommendedTier?.currency} / {publicLanguage.t('billingMonthly')}</p>
          <p>{publicLanguage.t('subscriptionUpgradeConsent')} {policyDateLabel(billing.subscription?.subscription_ends_at)}</p>
        </div> : null}
        <div className="subscription-calculated">
          <span className="eyebrow">{publicLanguage.t(isCollectionCenterAccount ? 'subscriptionFixedMonthly' : 'subscriptionCalculatedAmount')}</span>
          {pricing ? <><strong>{money(pricing.amount)} <small>{pricing.currency} / {publicLanguage.t('billingMonthly')}</small></strong><span>{pricing.planName}</span>{!isCollectionCenterAccount ? <small>{Number(pricing.minVolumeLiters || 0).toLocaleString()}–{pricing.maxVolumeLiters == null ? '∞' : Number(pricing.maxVolumeLiters).toLocaleString()} L</small> : null}</> : billingLoading ? <p>{publicLanguage.t('dashboardLoading')}</p> : billingError ? null : <p>{publicLanguage.t('subscriptionUnavailable')}</p>}
        </div>
        {!isCollectionCenterAccount ? <label className="field-block">{publicLanguage.t('subscriptionSelectTier')}<select value={selectedSubscriptionPlanCode} onChange={(event) => {
          const code = event.target.value;
          setSelectedSubscriptionPlanCode(code);
          loadBilling(code).catch((reason) => setError(reason.message));
        }}>{(billing?.plans || []).map((plan: SubscriptionPlan) => <option key={plan.id} value={plan.code}>{plan.name} · {Number(plan.min_volume_liters || 0).toLocaleString()}–{plan.max_volume_liters == null ? '∞' : Number(plan.max_volume_liters).toLocaleString()} L · {money(Number(plan.price))} {plan.currency} / {publicLanguage.t('billingMonthly')}</option>)}</select></label> : null}
        <label className="field-block">{publicLanguage.t('subscriptionSavedPhone')}<input inputMode="tel" value={paymentPhone} readOnly aria-readonly="true" /></label>
        <div className="payment-method-details">
          <div><span>{publicLanguage.t('billingPaymentProvider')}</span><div className="payment-provider-inline"><MtnMoMoBrand compact /><small>{payment?.paymentMethod || 'MTN_MOMO_RWA'} · RWF</small></div></div>
          <div><span>{publicLanguage.t('billingPaymentPayer')}:</span>{' '}<b>{billing?.account?.name || accountProfile?.name || user.name || user.email}</b></div>
          <p className="muted-note">{publicLanguage.t('billingPaymentInstruction')}</p>
          {payment && !payment.ready ? <p className="form-error" role="status">{publicLanguage.t('billingPaymentUnavailable')}</p> : null}
        </div>
        <button type="button" className="dashboard-text-link billing-phone-settings" onClick={() => setTab('settings')}>{publicLanguage.t('accountSettings')} <ArrowRight size={14} aria-hidden="true" /></button>
        {billing && !paymentPhoneValid ? <p className="form-error" role="status">{publicLanguage.t('billingPhoneMissing')}</p> : null}
        <button type="button" className="button button-primary subscription-pay" onClick={() => paySubscription()} disabled={busy || billingLoading || !pricing || !payment?.ready || !paymentPhoneValid || Boolean(billing?.subscription?.next_period_started_at)}>{publicLanguage.t('subscriptionPay')} <ArrowRight size={17} aria-hidden="true" /></button>
      </section>
      <section className="panel panel-wide subscription-history">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('subscriptionPaymentHistory')}</h2></div></div>
        <div className="toolbar payment-history-controls">
          <label>{publicLanguage.t('paymentStatus')}<select value={customerPaymentStatus} onChange={(event) => { const status = event.target.value; setCustomerPaymentStatus(status); void loadBilling(selectedSubscriptionPlanCode, { status }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option><option value="SUCCESS">{publicLanguage.t('paymentSuccessful')}</option><option value="PENDING">{publicLanguage.t('paymentPending')}</option><option value="FAILED">{publicLanguage.t('paymentFailed')}</option><option value="CANCELLED">{publicLanguage.t('paymentCancelled')}</option><option value="EXPIRED">{publicLanguage.t('paymentExpired')}</option></select></label>
          <label>{publicLanguage.t('sort')}<select value={`${customerPaymentSortBy}:${customerPaymentSortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); if (['date', 'amount'].includes(field) && ['asc', 'desc'].includes(direction)) { setCustomerPaymentSortBy(field as typeof customerPaymentSortBy); setCustomerPaymentSortDirection(direction as typeof customerPaymentSortDirection); void loadBilling(selectedSubscriptionPlanCode, { sortBy: field as typeof customerPaymentSortBy, sortDirection: direction as typeof customerPaymentSortDirection }).catch((reason) => setError(reason.message)); } }}><option value="date:desc">{publicLanguage.t('paymentDate')} ↓</option><option value="date:asc">{publicLanguage.t('paymentDate')} ↑</option><option value="amount:asc">{publicLanguage.t('deductionsAmount')} ↑</option><option value="amount:desc">{publicLanguage.t('deductionsAmount')} ↓</option></select></label>
          {customerPaymentStatus || customerPaymentSortBy !== 'date' || customerPaymentSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={() => { setCustomerPaymentStatus(''); setCustomerPaymentSortBy('date'); setCustomerPaymentSortDirection('desc'); void loadBilling(selectedSubscriptionPlanCode, { status: '', sortBy: 'date', sortDirection: 'desc' }).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('milkClearSearch')}</button> : null}
        </div>
        {billing?.payments?.length ? <>
          <div className="table-scroll subscription-payment-desktop"><table><thead><tr><th>{publicLanguage.t('paymentDate')}</th><th>{publicLanguage.t('paymentPlan')}</th><th>{publicLanguage.t('billingPaymentProvider')}</th><th>{publicLanguage.t('paymentReference')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('paymentStatus')}</th><th /></tr></thead><tbody>{billing.payments.map((item: any) => <tr key={item.id}><td>{paymentDateLabel(item.created_at)}</td><td>{item.plan_name || item.plan_code || '—'}<small className="block-muted">{item.billing_period || '—'}</small></td><td>{paymentMethodLabel(item)}</td><td className="payment-reference-cell"><b>{item.provider_reference || '—'}</b>{item.provider_transaction_id ? <small className="block-muted">{item.provider_transaction_id}</small> : null}</td><td>{money(item.amount)} {item.currency || 'RWF'}</td><td><span className={`payment-status-badge payment-status-${String(item.status).toLowerCase()}`}>{paymentStatusLabel(item.status)}</span></td><td>{item.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkCustomerPayment(item.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</td></tr>)}</tbody></table></div>
          <div className="subscription-payment-mobile-list">{billing.payments.map((item: any) => <article className="subscription-payment-card" key={`mobile-${item.id}`}>
            <header><div><b>{item.plan_name || item.plan_code || '—'}</b><small>{item.billing_period || '—'}</small></div><span className={`payment-status-badge payment-status-${String(item.status).toLowerCase()}`}>{paymentStatusLabel(item.status)}</span></header>
            <strong className="subscription-payment-amount">{money(item.amount)} {item.currency || 'RWF'}</strong>
            <dl>
              <div><dt>{publicLanguage.t('paymentDate')}</dt><dd>{paymentDateLabel(item.created_at)}</dd></div>
              <div><dt>{publicLanguage.t('billingPaymentProvider')}</dt><dd>{paymentMethodLabel(item)}</dd></div>
              <div className="subscription-payment-reference"><dt>{publicLanguage.t('paymentReference')}</dt><dd><b>{item.provider_reference || '—'}</b>{item.provider_transaction_id ? <small>{item.provider_transaction_id}</small> : null}</dd></div>
              {item.completed_at ? <div><dt>{publicLanguage.t('paymentConfirmationDate')}</dt><dd>{paymentDateLabel(item.completed_at)}</dd></div> : null}
              {item.failure_reason ? <div className="subscription-payment-reference"><dt>{publicLanguage.t('details')}</dt><dd>{item.failure_reason}</dd></div> : null}
            </dl>
            {item.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkCustomerPayment(item.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}
          </article>)}</div>
        </> : billing ? <div className="subscription-history-empty"><ClipboardList size={20} aria-hidden="true" /><p>{publicLanguage.t('subscriptionNoHistory')}</p></div> : billingLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}
      </section>
    </div>;
  };

const renderNotifications = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('alertsInbox')}</span><h2>{publicLanguage.t('navAlerts')}</h2></div><button className="button button-secondary" onClick={() => run(async () => { await api('/api/notifications/read-all', { method: 'PATCH' }); await loadNotifications(); })}>{publicLanguage.t('markAllRead')}</button></div><div className="notice-list">{notifications.map((item) => <article className={`notice-row${item.isRead ? '' : ' unread'}`} key={item.id}><div><span className="eyebrow">{item.notification_type.replaceAll('_', ' ')}</span><h3>{item.title}</h3><p>{item.message}</p><small>{formatDateLabel(item.createdAt, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</small></div>{!item.isRead ? <button className="button button-secondary small-button" onClick={() => markRead(item)}>{publicLanguage.t('markRead')}</button> : <Check size={17} />}</article>)}{!notifications.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Bell size={21} aria-hidden="true" /></span><b>{publicLanguage.t('notificationsEmptyTitle')}</b></div> : null}</div></section>;

  const renderAdminAccounts = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('platform')}</span><h2>{publicLanguage.t('customerAccounts')}</h2></div><span className="count-label">{accounts ? `${accounts.total} ${publicLanguage.t('accountsCount')} ` : '…'}</span></div><div className="toolbar"><form className="search-form" onSubmit={(event) => { event.preventDefault(); loadAccounts(); }}><Search size={17} /><input placeholder={publicLanguage.t('searchNameEmail')} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form><select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}><option value="">{publicLanguage.t('allStatuses')}</option>{Object.keys(accountStatusCopy).map((status) => <option key={status} value={status}>{publicLanguage.t(accountStatusCopy[status as keyof typeof accountStatusCopy])}</option>)}</select></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('accountType')}</th><th>{publicLanguage.t('status')}</th><th>{publicLanguage.t('farmers')}</th><th>{publicLanguage.t('navCenters')}</th><th>{publicLanguage.t('actions')}</th></tr></thead><tbody>{accounts?.accounts.map((account) => <tr key={account.user_id}><td><b>{account.account_name}</b><small className="block-muted">{account.account_email}</small></td><td>{account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}</td><td>{publicLanguage.t(accountStatusCopy[(account.effective_status || account.account_status) as keyof typeof accountStatusCopy] || 'statusActive')}</td><td>{account.farmer_count}</td><td>{account.center_count}</td><td className="actions-cell"><button type="button" className="text-button" onClick={() => { void loadAdminAccountDetails(account.user_id); }}>{publicLanguage.t('adminViewAccount')}</button><button className="text-button" onClick={() => adminAction(account, account.account_status === 'suspended' ? 'reactivate' : 'suspend')}>{publicLanguage.t(account.account_status === 'suspended' ? 'reactivate' : 'suspend')}</button></td></tr>)}</tbody></table></div></section>;

  const renderAdminAccountDetailsModal = () => (
    <Modal ariaLabel={publicLanguage.t('customerAccounts')} onClose={closeAdminAccountDetails}>
      <div className="panel-heading">
        <div><span className="eyebrow">{publicLanguage.t('platform')}</span><h2>{adminAccountDetails?.account?.name || publicLanguage.t('customerAccounts')}</h2></div>
        <button type="button" className="icon-button" onClick={closeAdminAccountDetails} aria-label="Close"><X size={18} /></button>
      </div>
      {adminAccountDetailsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : adminAccountDetailsError ? <div className="form-error" role="alert">{adminAccountDetailsError}</div> : adminAccountDetails ? <div className="admin-account-details">
        <dl className="payment-readiness-list">
          <div><dt>{publicLanguage.t('email')}</dt><dd>{adminAccountDetails.account.email}</dd></div>
          <div><dt>{publicLanguage.t('accountType')}</dt><dd>{adminAccountDetails.account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}</dd></div>
          <div><dt>{publicLanguage.t('status')}</dt><dd>{publicLanguage.t(accountStatusCopy[(adminAccountDetails.account.account_status || 'active') as keyof typeof accountStatusCopy] || 'statusActive')}</dd></div>
          <div><dt>{publicLanguage.t('accountPhone')}</dt><dd>{adminAccountDetails.account.phone || '—'}</dd></div>
          <div><dt>Created</dt><dd>{formatDateLabel(adminAccountDetails.account.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</dd></div>
          <div><dt>{publicLanguage.t('navSubscription')}</dt><dd>{adminAccountDetails.subscription ? `${adminAccountDetails.subscription.status || 'unknown'} · ${typeof adminAccountDetails.subscription.current_price === 'number' ? money(adminAccountDetails.subscription.current_price) : (adminAccountDetails.subscription.current_price || '—')} ${adminAccountDetails.subscription.currency || 'RWF'}` : publicLanguage.t('subscriptionNoAccount')}</dd></div>
        </dl>
        <div className="admin-account-stat-grid">
          <div><span>{publicLanguage.t('navCenters')}</span><b>{adminAccountDetails.counts.centers}</b></div>
          <div><span>{publicLanguage.t('farmers')}</span><b>{adminAccountDetails.counts.farmers}</b></div>
          <div><span>{publicLanguage.t('navMilk')}</span><b>{adminAccountDetails.counts.milk_records}</b></div>
          <div><span>{publicLanguage.t('navDeductions')}</span><b>{adminAccountDetails.counts.deductions}</b></div>
          <div><span>Payments</span><b>{adminAccountDetails.counts.payments}</b></div>
          <div><span>{publicLanguage.t('navAlerts')}</span><b>{adminAccountDetails.counts.notifications}</b></div>
        </div>
      </div> : null}
    </Modal>
  );

  const renderAdminAudit = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('auditSecurity')}</span><h2>{publicLanguage.t('auditLog')}</h2></div><span className="count-label">{auditRows?.total ?? '…'} {publicLanguage.t('events')}</span></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('when')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('entity')}</th><th>{publicLanguage.t('actions')}</th><th>{publicLanguage.t('details')}</th></tr></thead><tbody>{(auditRows?.items || []).map((row: any) => <tr key={row.id}><td>{formatDateLabel(row.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</td><td>{row.actor_name || row.changed_by || 'System'}</td><td>{row.entity_type} #{row.entity_id}</td><td>{row.action}</td><td><code>{JSON.stringify(row.details || {})}</code></td></tr>)}</tbody></table></div></section>;

  const renderAdminConfig = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('centerPlan')}</h2></div><CircleDollarSign size={20} /></div><div className="config-callout">{adminConfigLoading ? publicLanguage.t('dashboardLoading') : `${centerPricing?.plan?.name || 'Collection Center Monthly'} · ${money(centerPricing?.plan?.price || centerPricing?.config?.monthly_amount || 0)} RWF`}</div><form key={centerPricing?.config?.updated_at || 'collection-center-pricing-loading'} className="form-stack compact config-form" onSubmit={(event) => { event.preventDefault(); run(async () => { const formData = new FormData(event.currentTarget); await api('/api/admin/config/collection-center', json('PUT', { monthlyAmount: Number(formData.get('amount')), firstVolumeBoundaryLiters: Number(formData.get('boundary')) })); const updated = await api('/api/admin/config/collection-center'); setCenterPricing(updated); setNotice(publicLanguage.t('pricingSaved')); }); }}><label>{publicLanguage.t('monthlyAmount')}<input name="amount" type="number" min="0" disabled={adminConfigLoading} defaultValue={centerPricing?.config?.monthly_amount || centerPricing?.plan?.price || 30000} /></label><label>{publicLanguage.t('firstVolumeBoundary')}<input name="boundary" type="number" min="0" disabled={adminConfigLoading} defaultValue={centerPricing?.config?.first_volume_boundary_liters || 50000} /></label><button className="button button-primary" disabled={busy || adminConfigLoading}>{publicLanguage.t('savePricing')}</button></form></section>;

  const renderAdminSubscriptionPolicy = () => <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('subscriptionPolicyTitle')}</h2></div><CalendarDays size={20} aria-hidden="true" /></div>
    {subscriptionPolicy ? <form className="form-stack compact config-form" onSubmit={saveSubscriptionPolicy}>
      <label>{publicLanguage.t('initialAccessDays')}<input type="number" min="1" max="90" step="1" required value={subscriptionPolicy.initial_access_days} onChange={(event) => setSubscriptionPolicy({ ...subscriptionPolicy, initial_access_days: Number(event.target.value) })} /></label>
      <label>{publicLanguage.t('gracePeriodDays')}<input type="number" min="0" max="90" step="1" required value={subscriptionPolicy.grace_period_days} onChange={(event) => setSubscriptionPolicy({ ...subscriptionPolicy, grace_period_days: Number(event.target.value) })} /></label>
      <label>{publicLanguage.t('enforcementTime')}<input type="time" required value={subscriptionPolicy.enforcement_time.slice(0, 5)} onChange={(event) => setSubscriptionPolicy({ ...subscriptionPolicy, enforcement_time: event.target.value })} /></label>
      <div className="config-callout">{publicLanguage.t('subscriptionPolicyTimezone')}: {subscriptionPolicy.time_zone}</div>
      <button className="button button-primary" disabled={busy || adminConfigLoading}>{publicLanguage.t('savePricing')}</button>
    </form> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('dashboardLoading')}</b></div>}
  </section>;

  const activeTabs = visibleTabs;
  const renderAdminDashboard = () => {
    const stats = adminSummary?.accounts;
    const metrics = [
      { label: publicLanguage.t('adminTotalAccounts'), value: stats?.total_accounts },
      { label: publicLanguage.t('adminNoSubscription'), value: stats?.without_subscription },
      { label: publicLanguage.t('adminActiveAccounts'), value: stats?.active },
      { label: publicLanguage.t('adminInitialAccessAccounts'), value: stats?.pending },
      { label: publicLanguage.t('adminSuspendedAccounts'), value: stats?.suspended },
      { label: publicLanguage.t('adminExpiredAccounts'), value: stats?.expired },
    ];

    return <div className="dashboard-view admin-dashboard">
      <section className="dashboard-metrics" aria-label={publicLanguage.t('adminAccountsOverview')}>
        {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value ?? '…'}</b></div>)}
        <div><span>{publicLanguage.t('adminRegistrations')}</span><b>{adminSummary?.registrations_last_30_days ?? '…'}</b></div>
      </section>
      <section className="dashboard-quick panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('platformAdmin')}</span><h2>{publicLanguage.t('adminGovernanceActions')}</h2></div><Shield size={20} aria-hidden="true" /></div>
        <div className="dashboard-action-list">
          <button type="button" onClick={() => setTab('accounts')}><Users size={17} aria-hidden="true" /><span>{publicLanguage.t('navAccounts')}</span><ArrowRight size={15} /></button>
          <button type="button" onClick={() => setTab('audit')}><Shield size={17} aria-hidden="true" /><span>{publicLanguage.t('navAudit')}</span><ArrowRight size={15} /></button>
          <button type="button" onClick={() => setTab('config')}><CircleDollarSign size={17} aria-hidden="true" /><span>{publicLanguage.t('navPricing')}</span><ArrowRight size={15} /></button>
        </div>
      </section>
    </div>;
  };
  const renderAdminPaymentConfiguration = () => {
    const settingBadge = (enabled: boolean | undefined) => {
      if (enabled === undefined) return '…';
      return <span className={`config-status-badge ${enabled ? 'is-active' : 'is-inactive'}`}>{publicLanguage.t(enabled ? 'statusActive' : 'statusSuspended')}</span>;
    };
    return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('adminPaymentSettings')}</h2></div><Wallet size={20} aria-hidden="true" /></div>
    <div className="payment-provider-card">
      <MtnMoMoBrand />
      <div className="payment-provider-copy"><strong>{adminConfigLoading ? publicLanguage.t('dashboardLoading') : paymentConfiguration?.paymentMethod || 'MTN_MOMO_RWA'}</strong><span>{paymentConfiguration?.currency || 'RWF'}</span></div>
      {paymentConfiguration ? <span className={`payment-status-badge ${paymentConfiguration.ready ? 'payment-status-success' : 'payment-status-pending'}`}>{publicLanguage.t(paymentConfiguration.ready ? 'adminPaymentReady' : 'adminPaymentNotReady')}</span> : null}
    </div>
    <dl className="payment-readiness-list">
      <div><dt>{publicLanguage.t('adminPaymentEnabled')}</dt><dd>{settingBadge(paymentConfiguration?.realPaymentsEnabled)}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentCredentials')}</dt><dd>{settingBadge(paymentConfiguration?.credentialsConfigured)}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentApi')}</dt><dd>{settingBadge(paymentConfiguration?.apiConfigured)}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentCallback')}</dt><dd>{settingBadge(paymentConfiguration?.callbackConfigured)}</dd></div>
    </dl>
    <details className="payment-config-notes">
      <summary>{publicLanguage.t('adminPaymentDetails')}</summary>
      <p>{publicLanguage.t('adminPaymentUserPayer')}</p>
      <p>{publicLanguage.t('adminPaymentSettlement')}</p>
      <p>{publicLanguage.t('adminPaymentSecrets')}</p>
    </details>
    </section>;
  };

  const renderAdminPayments = () => {
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(adminPaymentTotal / pageSize));
    const statusLabel = (status: string) => {
      switch (status) {
        case 'SUCCESS': return publicLanguage.t('paymentSuccessful');
        case 'PENDING': return publicLanguage.t('paymentPending');
        case 'FAILED': return publicLanguage.t('paymentFailed');
        case 'CANCELLED': return publicLanguage.t('paymentCancelled');
        case 'EXPIRED': return publicLanguage.t('paymentExpired');
        default: return status;
      }
    };
    const paymentMethod = (payment: AdminPayment) => payment.payment_method === 'MTN_MOMO_RWA' || payment.provider === 'mtn_momo'
      ? <MtnMoMoBrand compact />
      : payment.payment_method || '—';
    return <section className="panel panel-wide admin-payment-history">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('adminPaymentHistory')}</h2></div><div className="admin-payment-controls"><label>{publicLanguage.t('paymentStatus')}<select value={adminPaymentStatus} onChange={(event) => loadAdminPayments(1, event.target.value).catch((reason) => setError(reason.message))}><option value="">All</option><option value="SUCCESS">Successful</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option><option value="EXPIRED">Expired</option></select></label><button type="button" className="button button-secondary" onClick={() => loadAdminPayments().catch((reason) => setError(reason.message))}>{publicLanguage.t('reportsRefresh')}</button></div></div>
      {adminPaymentSummary ? <div className="admin-payment-summary">
        <div><span>{publicLanguage.t('adminVerifiedPayments')}</span><b>{adminPaymentSummary.successfulCount}</b></div>
        <div><span>{publicLanguage.t('adminVerifiedPaymentAmount')}</span><b>{money(adminPaymentSummary.successfulAmount)} RWF</b></div>
        <div><span>{publicLanguage.t('paymentPending')}</span><b>{adminPaymentSummary.pendingCount}</b></div>
        <div><span>{publicLanguage.t('paymentFailed')}</span><b>{adminPaymentSummary.failedCount}</b></div>
        <div><span>{publicLanguage.t('paymentCancelled')}</span><b>{adminPaymentSummary.cancelledCount}</b></div>
        <div><span>{publicLanguage.t('paymentExpired')}</span><b>{adminPaymentSummary.expiredCount}</b></div>
      </div> : null}
      {adminConfigLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : adminPayments.length ? <>
        <div className="table-scroll admin-payment-table"><table><thead><tr><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('paymentPlan')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('billingPaymentProvider')}</th><th>{publicLanguage.t('accountPhone')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('paymentReference')}</th><th>{publicLanguage.t('paymentDate')}</th><th>{publicLanguage.t('paymentConfirmationDate')}</th><th /></tr></thead><tbody>{adminPayments.map((payment) => <tr key={payment.id}><td><b>{payment.account_name || '—'}</b><small className="block-muted">{payment.account_email}</small></td><td>{payment.plan_name || payment.plan_code || '—'}<small className="block-muted">{payment.billing_period}</small></td><td>{money(payment.amount)} {payment.currency}</td><td>{paymentMethod(payment)}</td><td>{payment.mobile_money_phone || '—'}</td><td><span className={`payment-status-badge payment-status-${payment.status.toLowerCase()}`}>{statusLabel(payment.status)}</span></td><td><b>{payment.provider_reference || '—'}</b>{payment.provider_transaction_id ? <small className="block-muted">{payment.provider_transaction_id}</small> : null}</td><td>{payment.created_at ? formatDateLabel(payment.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td><td>{payment.completed_at ? formatDateLabel(payment.completed_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td><td>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkAdminPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</td></tr>)}</tbody></table></div>
        <div className="admin-payment-mobile-list">{adminPayments.map((payment) => <article className="admin-payment-card" key={`mobile-${payment.id}`}><header><div><b>{payment.account_name || '—'}</b><small>{payment.account_email}</small></div><span className={`payment-status-badge payment-status-${payment.status.toLowerCase()}`}>{statusLabel(payment.status)}</span></header><dl><div><dt>{publicLanguage.t('paymentPlan')}</dt><dd>{payment.plan_name || payment.plan_code || '—'} · {payment.billing_period}</dd></div><div><dt>{publicLanguage.t('deductionsAmount')}</dt><dd>{money(payment.amount)} {payment.currency}</dd></div><div><dt>{publicLanguage.t('billingPaymentProvider')}</dt><dd>{paymentMethod(payment)}</dd></div><div><dt>{publicLanguage.t('accountPhone')}</dt><dd>{payment.mobile_money_phone || '—'}</dd></div><div><dt>{publicLanguage.t('paymentReference')}</dt><dd>{payment.provider_reference || '—'}{payment.provider_transaction_id ? <small>{payment.provider_transaction_id}</small> : null}</dd></div><div><dt>{publicLanguage.t('paymentDate')}</dt><dd>{payment.created_at ? formatDateLabel(payment.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</dd></div><div><dt>{publicLanguage.t('paymentConfirmationDate')}</dt><dd>{payment.completed_at ? formatDateLabel(payment.completed_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</dd></div></dl>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkAdminPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</article>)}</div>
        <div className="panel-footer admin-payment-pagination"><span>{adminPaymentTotal} · {adminPaymentPage} / {totalPages}</span><div><button type="button" className="button button-secondary small-button" disabled={adminPaymentPage <= 1} onClick={() => loadAdminPayments(adminPaymentPage - 1).catch((reason) => setError(reason.message))}>{publicLanguage.t('previousPage')}</button><button type="button" className="button button-secondary small-button" disabled={adminPaymentPage >= totalPages} onClick={() => loadAdminPayments(adminPaymentPage + 1).catch((reason) => setError(reason.message))}>{publicLanguage.t('nextPage')}</button></div></div>
      </> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('subscriptionNoHistory')}</b></div>}
    </section>;
  };

  const renderAdminCollectorPricing = () => {
    const collectorPlans = subscriptionPlans.filter(isCollectorTier);
    const editTier = (id: number, changes: Partial<CollectorTierEdit>) => setCollectorTierEdits((current) => ({
      ...current,
      [String(id)]: { ...current[String(id)], ...changes },
    }));
    const addTier = () => {
      const id = -Date.now();
      const last = collectorPlans.filter((plan) => plan.is_active).at(-1);
      const minimum = Number(last?.min_volume_liters || 0);
      const name = publicLanguage.t('newTierName');
      setSubscriptionPlans((plans) => [...plans, {
        id,
        code: `USAGE_NEW_${Math.abs(id)}`,
        name,
        price: 1,
        currency: 'RWF',
        billing_period: 'monthly',
        min_volume_liters: minimum,
        max_volume_liters: null,
        is_active: true,
      }]);
      setCollectorTierEdits((current) => ({
        ...current,
        [String(id)]: { name, price: '1', minVolumeLiters: String(minimum), maxVolumeLiters: '', isActive: true },
      }));
    };
    return <section className="panel panel-wide">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('adminCollectorPricing')}</h2></div><div><button type="button" className="button button-secondary" onClick={addTier}><Plus size={16} aria-hidden="true" />{publicLanguage.t('adminAddTier')}</button><CircleDollarSign size={20} aria-hidden="true" /></div></div>
      <p className="muted-note">{publicLanguage.t('adminPriceContractNote')}</p>
      {adminConfigLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : collectorPlans.length ? <><div className="tier-pricing-list">{collectorPlans.map((plan) => {
        const edit = collectorTierEdits[String(plan.id)];
        const name = edit?.name ?? plan.name;
        const minimum = edit?.minVolumeLiters ?? String(plan.min_volume_liters ?? 0);
        const maximum = edit?.maxVolumeLiters ?? (plan.max_volume_liters === null ? '' : String(plan.max_volume_liters));
        const price = edit?.price ?? String(plan.price);
        const openEnded = maximum.trim() === '';
        return <div className="tier-pricing-row" key={plan.id}>
          <div className="tier-range-group">
            <label className="tier-name-group"><span>{publicLanguage.t('adminTierLabel')}</span><input maxLength={255} required value={name} onChange={(event) => editTier(plan.id, { name: event.target.value })} /></label>
            <div className="tier-range-inputs">
              <label><span>{publicLanguage.t('adminTierMinimum')}</span><span className="tier-volume-input"><input aria-label={`${name} ${publicLanguage.t('adminTierMinimum')}`} type="number" min="0" step="1" required value={minimum} onChange={(event) => editTier(plan.id, { minVolumeLiters: event.target.value })} /><span>L</span></span></label>
              <span className="tier-range-separator">{publicLanguage.t('adminRangeTo')}</span>
              <label><span>{publicLanguage.t('adminTierMaximum')}</span><span className="tier-volume-input"><input aria-label={`${name} ${publicLanguage.t('adminTierMaximum')}`} type="number" min="0" step="1" required={!openEnded} placeholder={openEnded ? publicLanguage.t('adminOpenEnded') : undefined} value={maximum} onChange={(event) => editTier(plan.id, { maxVolumeLiters: event.target.value })} />{!openEnded ? <span>L</span> : null}</span></label>
            </div>
          </div>
          <label className="tier-price-group"><span>{publicLanguage.t('adminMonthlyPrice')}</span><span className="tier-price-input"><input aria-label={`${name} ${publicLanguage.t('adminMonthlyPrice')}`} type="number" min="1" step="1" required value={price} onChange={(event) => editTier(plan.id, { price: event.target.value })} /><span>{plan.currency}</span></span></label>
          <label className="tier-status-group"><span>{publicLanguage.t('adminPlanStatus')}</span><input type="checkbox" checked={edit?.isActive ?? plan.is_active} onChange={(event) => editTier(plan.id, { isActive: event.target.checked })} />{publicLanguage.t((edit?.isActive ?? plan.is_active) ? 'statusActive' : 'statusSuspended')}</label>
        </div>;
      })}</div><div className="panel-footer"><button type="button" className="button button-primary" onClick={() => { void saveAdminCollectorPrices(); }} disabled={busy} aria-busy={busy}>{busy ? publicLanguage.t('wait') : publicLanguage.t('adminSaveCollectorPrices')}</button></div></> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('adminPlansMissing')}</b></div>}
      </section>;
  };

  const renderSystemHealth = () => {
    const connected = systemHealth?.database.connected;
    const migrated = systemHealth?.migrated;
    const healthy = systemHealth?.ok;
    return <section className="panel panel-wide">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('systemHealth')}</span><h2>{publicLanguage.t('systemOverview')}</h2></div><Building2 size={20} aria-hidden="true" /></div>
      <div className="metric-strip">
        <div><span>{publicLanguage.t('databaseStatus')}</span><b>{connected === undefined ? '…' : publicLanguage.t(connected ? 'healthConnected' : 'healthUnavailable')}</b></div>
        <div><span>{publicLanguage.t('databaseMigrations')}</span><b>{migrated === undefined ? '…' : publicLanguage.t(migrated ? 'healthApplied' : 'healthIncomplete')}</b></div>
        <div><span>{publicLanguage.t('apiHealth')}</span><b>{healthy === undefined ? '…' : publicLanguage.t(healthy ? 'healthHealthy' : 'healthNeedsAttention')}</b></div>
      </div>
    </section>;
  };

  const activeTab = activeTabs.find((item) => item.id === tab) || activeTabs[0];
  const activeTabLabel = tab === 'billing'
    ? publicLanguage.t('navSubscription')
    : tab === 'transport' ? publicLanguage.t('navTransport') : activeTab?.label || 'Workspace';

  return (
    <main className="workspace-shell">
      <header className="topbar"><BrandLockup className="topbar-brand" imageSize={34} /><div className="topbar-right"><span className={`account-tag${online ? '' : ' offline-tag'}`}><span className={`status-dot${online ? '' : ' offline-dot'}`} />{online ? isAdmin ? publicLanguage.t('platformAdmin') : user.accountType.replace('_', ' ') : `Offline · ${pendingWrites} queued`}</span><div className="notification-menu"><button type="button" className="icon-button notification-trigger" aria-label={`${publicLanguage.t('navAlerts')}: ${unreadCount ?? 0}`} aria-expanded={notificationPanelOpen} onClick={toggleNotificationPanel}><Bell size={19} aria-hidden="true" />{unreadCount ? <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</button>{notificationPanelOpen ? <section className="notification-dropdown" aria-label={publicLanguage.t('navAlerts')}><div className="notification-dropdown-heading"><b>{publicLanguage.t('navAlerts')}</b><button type="button" className="text-button" onClick={() => markAllNotificationsRead()}>{publicLanguage.t('markAllRead')}</button></div><div className="notification-dropdown-list">{notifications.slice(0, 8).map((item) => <article className={`notification-dropdown-item${item.isRead ? '' : ' unread'}`} key={item.id}><span className="eyebrow">{item.notification_type.replaceAll('_', ' ')}</span><b>{item.title}</b><p>{item.message}</p><small>{formatDateLabel(item.createdAt, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</small>{!item.isRead ? <button type="button" className="text-button" onClick={() => markRead(item)}>{publicLanguage.t('markRead')}</button> : null}</article>)}{!notifications.length ? <p className="notification-dropdown-empty">{publicLanguage.t('notificationsEmptyTitle')}</p> : null}</div><button type="button" className="notification-dropdown-all" onClick={() => { setNotificationPanelOpen(false); setTab('notifications'); }}>{publicLanguage.t('alertsInbox')} <ArrowRight size={15} aria-hidden="true" /></button></section> : null}</div><button type="button" className="user-name user-settings-shortcut" onClick={() => setTab('settings')} title={publicLanguage.t('accountSettings')} aria-label={`${publicLanguage.t('accountSettings')}: ${user.name || user.email}`}><UserRound size={16} aria-hidden="true" /><span>{user.name || user.email}</span></button><button className="icon-button" onClick={logout} aria-label={publicLanguage.t('signOut')} title={publicLanguage.t('signOut')}><LogOut size={18} /></button></div></header>
      <div className="workspace-body"><aside className="sidebar"><div className="sidebar-label">{publicLanguage.t('workspace')}</div><nav aria-label={publicLanguage.t('workspaceNavigation')}>{activeTabs.map((item) => { const Icon = item.icon; return <button className={`nav-item${tab === item.id ? ' active' : ''}`} key={item.id} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{tab === item.id ? <span className="nav-mark" /> : null}</button>; })}</nav><div className="sidebar-foot"><Activity size={15} aria-hidden="true" /><span>{publicLanguage.t('systemOnline')}</span></div></aside>
      <section className="content-area"><div className="content-heading"><div><span className="eyebrow">{isAdmin ? publicLanguage.t('platformAdmin') : 'MILK SYSTEM'}</span><h1>{activeTabLabel}</h1></div><span className="date-stamp">{formatDateLabel(new Date(), publicLanguage.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
        {error ? <div className="toast toast-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        {notice ? <div className="toast toast-success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        {tab === 'dashboard' && isAdmin ? renderAdminDashboard() : null}
        {tab === 'dashboard' && !isAdmin ? renderDashboard() : null}
        {tab === 'farmers' && !isAdmin ? renderFarmers() : null}
        {tab === 'centers' && !isAdmin ? renderCenters() : null}
        {tab === 'milk' && !isAdmin ? renderMilk() : null}
        {tab === 'deductions' && !isAdmin ? renderDeductions() : null}
        {tab === 'transport' && !isAdmin && isCollector ? renderTransport() : null}
        {tab === 'ukwezi' && !isAdmin ? renderUkwezi() : null}
        {tab === 'settlements' && !isAdmin ? renderSettlements() : null}
        {tab === 'reports' && !isAdmin ? renderReports() : null}
        {tab === 'billing' && !isAdmin ? renderBilling() : null}
        {tab === 'notifications' && !isAdmin ? <>{renderNotificationFilters()}{renderNotifications()}</> : null}
        {tab === 'settings' ? renderAccountSettings() : null}
        {tab === 'notifications-admin' && isAdmin ? renderNotifications() : null}
        {tab === 'accounts' && isAdmin ? renderAdminAccounts() : null}
        {tab === 'audit' && isAdmin ? renderAdminAudit() : null}
        {tab === 'config' && isAdmin ? <div className="admin-pricing-layout">{renderAdminCollectorPricing()}{renderAdminConfig()}{renderAdminSubscriptionPolicy()}{renderAdminPaymentConfiguration()}{renderAdminPayments()}</div> : null}
        {tab === 'system-health' && isAdmin ? renderSystemHealth() : null}
        {adminAccountDetailsOpen ? renderAdminAccountDetailsModal() : null}
      </section></div>
      <nav className="mobile-nav" aria-label={publicLanguage.t('workspaceNavigation')}>
        {mobilePrimaryTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></button>; })}
        {mobileMoreTabs.length ? <button type="button" className={`mobile-more-trigger${mobileMoreTabs.some((item) => item.id === tab) ? ' active' : ''}`} aria-controls="mobile-more-menu" aria-expanded={mobileMoreOpen} aria-label={publicLanguage.t('more')} onClick={() => setMobileMoreOpen((open) => !open)}><ChevronDown size={18} /><span>{publicLanguage.t('more')}</span></button> : null}
      </nav>
      {mobileMoreOpen && mobileMoreTabs.length ? <div className="mobile-more-menu" id="mobile-more-menu" aria-label={publicLanguage.t('more')}>
        {mobileMoreTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setMobileMoreOpen(false); }}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></button>; })}
      </div> : null}
    </main>
  );
}
