'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity, ArrowRight, Bell, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff,
  CircleDollarSign, ClipboardList, FileBarChart2, LogOut, Milk, Plus, Search, Settings, Shield,
  UserRound, Users, X, ArrowUpRight, Wallet, CalendarDays, BookOpen, Truck,
} from 'lucide-react';
import { flushOfflineWrites, getOfflineWrites, queueOfflineWrite } from '@/lib/offline-queue';
import { buildFarmerListQuery } from '@/lib/farmer-list-query';
import { BrandLockup } from '@/components/brand-lockup';
import { usePublicLanguage } from '@/hooks/use-public-language';

type User = { id: number; name: string; email: string; role: string; accountType: string };
type AccountProfile = { id: number; name: string; email: string; phone: string | null; nationalId: string | null; accountNumber: string | null; profilePicture: string | null; role: string; accountType: string; accountStatus: string; emailVerified: boolean };
type Farmer = { id: number; name: string; location: string | null; phone: string | null; nationalId: string | null; accountNumber: string | null; collectionCenter: string | null; cowType: string | null; collectorUserId?: number | null };
type Center = { id: number; name: string; pricePerLiter: number; transportRatePerLiter: number; morning_start: string; morning_end: string; evening_start: string; evening_end: string };
type Page<T> = { data: T[]; nextCursor: string | null; hasMore: boolean; pageSize: number };
type DailyRow = { farmerId: number; farmerName: string; phone?: string; nationalId?: string; collectionCenter?: string | null; recordId?: number; volumeMorning: number; volumeEvening: number; totalVolume: number; volumeLiters?: number; amount: number; status?: string };
type CollectorMilkEntry = { id: number; date: string; volumeLiters: number; pricePerLiter: number; status: string; effectiveVolumeLiters: number };
type CollectorMilkPrice = { id: number; pricePerLiter: number; effectiveDate: string };
type OwnerIfishiEntry = { id: number | null; date: string; volumeLiters: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; assignedFarmerLiters: number; surplusLiters: number; status: string; adjustmentReason: string | null; adjustedAt: string | null };
type OwnerIfishiHistory = { owner: { name: string }; startDate: string; endDate: string; entries: OwnerIfishiEntry[]; totals: { ownerVolumeLiters: number; assignedFarmerLiters: number; surplusLiters: number } };
type MilkRecord = { id: number; farmer_id: number; owner_user_id: number; date: string; volumeMorning: number; volumeEvening: number; volume: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; originalAmount: number; validAmount: number; amount: number; pricePerLiter: number; status: string; adjustmentReason: string | null; adjustedBy: number | null; adjustedAt: string | null; collectionCenter?: string | null };
type Notice = { id: number; title: string; message: string; notification_type: string; isRead: boolean; createdAt: string };
type ReportFarmerRow = { farmerId: number; farmerName: string; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; originalVolume?: number; lostVolume?: number; pricePerLiter?: number; grossAmount: number; totalTransport: number; totalDeductions: number; ifishiTotalDeductions?: number; ifishiNetAmount?: number; netAmount: number };
type ReportOwnerRow = { farmerId: null; farmerName: string; name: string; isOwner: true; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; pricePerLiter: number | null; grossAmount: number | null; totalTransport: number; totalDeductions: number; netAmount: number | null };
type Report = { totalFarmers: number; totalVolume: number; totalMorning: number; totalEvening: number; totalRevenueMonth: number; ownerGeneratedGross?: number | null; ownerGeneratedVolume?: number; totalDeductionsMonth: number; totalTransportFeesMonth: number; netRevenueMonth: number; todayTotal: number; todayMorning: number; todayEvening: number; rangeStart: string; rangeEnd: string; collectorPayable: number | null; collectorGross?: number | null; collectorActualVolume?: number; collectorOriginalVolume?: number; collectorLostVolume?: number; collectorFarmersValidLiters?: number; collectorTotalFarmersPayable?: number; collectorFarmerDeductions?: number; collectorFarmerTransport?: number; collectorSurplusAmount?: number | null; collectorPayableFromBreakdown?: number | null; collectorIsReconciled?: boolean | null; collectorProfile?: { name: string } | null; collectorEntries?: Array<{ id: number; date: string; status: string; volumeLiters: number; effectiveVolumeLiters: number; farmerLostLiters: number; voidReason?: string | null; voidedBy?: number | null; voidedAt?: string | null }>; milkLossRecords?: Array<{ id: number; farmerId: number; farmerName: string; date: string; status: string; originalVolume: number; validVolume: number; lostVolume: number; reason: string | null; adjustedBy: number | null; adjustedAt: string | null }>; collectorSettlementRows?: any[]; ownerSettlementRow?: ReportOwnerRow | null; farmerPayments: ReportFarmerRow[] };
type Account = { user_id: number; account_name: string; account_email: string; account_type: string; account_status: string; effective_status: string; farmer_count: number; center_count: number };
type AdminSummary = { accounts: { total_accounts: number; without_subscription: number; pending: number; trial: number; active: number; suspended: number; expired: number }; registrations_last_30_days: number };
type SubscriptionPlan = { id: number; code: string; name: string; price: number | string; currency: string; billing_period: string; min_volume_liters: number | string | null; max_volume_liters: number | string | null; is_active: boolean };
type PaymentConfiguration = { provider: string; paymentMethod: string; displayName: string; currency: string; payerAccount: string; payerPhoneSource: string; realPaymentsEnabled: boolean; credentialsConfigured: boolean; apiConfigured: boolean; callbackConfigured: boolean; ready: boolean };
type AdminPayment = { id: number; account_name: string; account_email: string; subscription_status: string; plan_name: string | null; amount: number; currency: string; status: string; payment_method: string; billing_period: string; provider_reference: string; provider_transaction_id: string | null; created_at: string; completed_at: string | null };
type CollectorAssignment = { id: number; collector_user_id: number; collector_name: string; collector_account_number: string | null; collector_national_id: string | null; collector_phone: string | null; abacunda_count: number };
type AbacundaIfishiEntry = { date: string; morningLiters: number; eveningLiters: number; originalLiters: number; validLiters: number; lostLiters: number; status: string; reason: string | null };
type AbacundaIfishiHistory = { startDate: string; endDate: string; entries: AbacundaIfishiEntry[]; totals: Omit<AbacundaIfishiEntry, 'date' | 'status' | 'reason'>; collector: { id: number; name: string } };

type Tab = 'dashboard' | 'farmers' | 'centers' | 'milk' | 'deductions' | 'transport' | 'ukwezi' | 'reports' | 'billing' | 'notifications' | 'settings' | 'accounts' | 'audit' | 'config';

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
  return body as T;
};
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const today = () => new Date().toISOString().slice(0, 10);
const getMonthBounds = (monthValue: string) => {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(year, month, 0).getDate();
  return { startDate: `${yearText}-${monthText}-01`, endDate: `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}` };
};
const money = (value: number) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 0 }).format(Number(value || 0));
const liters = (value: number) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 2 }).format(Number(value || 0));

const collectorTabs: Array<{ id: Tab; label: string; icon: typeof Milk }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'farmers', label: 'Farmers', icon: Users },
  { id: 'milk', label: 'Milk', icon: Milk },
  { id: 'deductions', label: 'Deductions', icon: CircleDollarSign },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'ukwezi', label: 'Ukwezi', icon: Wallet },
  { id: 'settings', label: 'Account', icon: Settings },
];

const dairyTabs: Array<{ id: Tab; label: string; icon: typeof Milk }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'farmers', label: 'Abacunda', icon: Users },
  { id: 'milk', label: 'Milk', icon: Milk },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'ukwezi', label: 'Ukwezi', icon: Wallet },
  { id: 'settings', label: 'Account', icon: Settings },
];

const navigationCopy = {
  dashboard: 'navDashboard', farmers: 'navFarmers', centers: 'navCenters', milk: 'navMilk',
  deductions: 'navDeductions', transport: 'navTransport', ukwezi: 'navUkwezi', reports: 'navReports', billing: 'navSubscription', notifications: 'navAlerts', settings: 'navSettings',
  accounts: 'navAccounts', audit: 'navAudit', config: 'navPricing',
} as const;

const accountStatusCopy = {
  not_approved: 'statusNotApproved',
  pending: 'statusPending',
  trial: 'statusTrial',
  active: 'statusActive',
  suspended: 'statusSuspended',
  expired: 'statusExpired',
  none: 'statusNone',
} as const;

type PublicLanguageState = ReturnType<typeof usePublicLanguage>;

function Login({ onLogin, language, setLanguage, t }: { onLogin: (user: User) => void } & PublicLanguageState) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const registering = pathname === '/register' || searchParams.get('mode') === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('COLLECTOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (registering) {
        await api('/api/auth/register', json('POST', { name, email, password, accountType }));
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
        <BrandLockup className="auth-brand-lockup" imageSize={46} />
        <p className="eyebrow">{t('loginEyebrow')}</p>
        <h1>{registering ? t('createTitle') : t('loginTitle')}</h1>
        <p className="auth-subtitle">{registering ? t('registerDescription') : t('loginDescription')}</p>
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
          <span className="eyebrow">{registering ? t('register') : t('login')}</span>
          <h2>{registering ? t('createTitle') : t('loginTitle')}</h2>
        </div>
        <form onSubmit={submit} className="form-stack">
          {registering ? <label>{t('fullName')}<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
          <label>{t('email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t('password')}<span className="password-field"><input type={passwordVisible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={passwordVisible ? t('hidePassword') : t('showPassword')} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          {!registering ? <Link className="auth-forgot-link" href="/forgot-password">{t('forgotPassword')}</Link> : null}
          {registering ? <label>{t('accountType')}<select value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="COLLECTOR">{t('collector')}</option><option value="COLLECTION_CENTER">{t('collectionCenter')}</option></select></label> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? t('wait') : registering ? t('createAccount') : t('signIn')}<ArrowRight size={17} /></button>
        </form>
        <div className="auth-navigation">
          <Link className="text-button auth-switch" href={registering ? '/login' : '/register'}>
            {registering ? t('alreadyHaveAccount') : t('newToSystem')}
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function Workspace() {
  const publicLanguage = usePublicLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [ifishiOpen, setIfishiOpen] = useState(false);
  const [ownerIfishiOpen, setOwnerIfishiOpen] = useState(false);
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
  const [farmerForm, setFarmerForm] = useState({ name: '', location: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [editingFarmer, setEditingFarmer] = useState<Farmer | null>(null);
  const [farmerEdit, setFarmerEdit] = useState({ name: '', location: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [collectorAssignments, setCollectorAssignments] = useState<CollectorAssignment[]>([]);
  const [collectorLinkId, setCollectorLinkId] = useState('');
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
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [collectionDate, setCollectionDate] = useState(today());
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [collectorMilkEntry, setCollectorMilkEntry] = useState<CollectorMilkEntry | null>(null);
  const [collectorMilkVolume, setCollectorMilkVolume] = useState('');
  const [dailyCursor, setDailyCursor] = useState<string | null>(null);
  const [dailyHasMore, setDailyHasMore] = useState(false);
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
  const [deductionForm, setDeductionForm] = useState({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
  const [deductionFarmerSearch, setDeductionFarmerSearch] = useState('');
  const [deductionFarmers, setDeductionFarmers] = useState<Farmer[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [ifishiMonth, setIfishiMonth] = useState(today().slice(0, 7));
  const [ifishiFarmerSearch, setIfishiFarmerSearch] = useState('');
  const [ifishiFarmers, setIfishiFarmers] = useState<Farmer[]>([]);
  const [ifishiFarmerId, setIfishiFarmerId] = useState('');
  const [ifishiDate, setIfishiDate] = useState(today());
  const [ifishiMorning, setIfishiMorning] = useState('');
  const [ifishiEvening, setIfishiEvening] = useState('');
  const [ifishiRecords, setIfishiRecords] = useState<MilkRecord[]>([]);
  const [ownerIfishiHistory, setOwnerIfishiHistory] = useState<OwnerIfishiHistory | null>(null);
  const [ownerIfishiVolume, setOwnerIfishiVolume] = useState('');
  const [ownerIfishiLoading, setOwnerIfishiLoading] = useState(false);
  const [ownerIfishiError, setOwnerIfishiError] = useState('');
  const [ukweziMonth, setUkweziMonth] = useState(today().slice(5, 7));
  const [ukweziYear, setUkweziYear] = useState(today().slice(0, 4));
  const [ukweziPeriod, setUkweziPeriod] = useState<'first-half' | 'second-half'>('first-half');
  const [ukweziReport, setUkweziReport] = useState<Report | null>(null);
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [accounts, setAccounts] = useState<{ accounts: Account[]; total: number; page: number; limit: number } | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [billing, setBilling] = useState<any>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | '6_months' | 'yearly'>('monthly');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [collectorPrices, setCollectorPrices] = useState<CollectorMilkPrice[]>([]);
  const [collectorPriceForm, setCollectorPriceForm] = useState({ pricePerLiter: '', effectiveDate: today() });
  const [auditRows, setAuditRows] = useState<any>(null);
  const [centerPricing, setCenterPricing] = useState<any>(null);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [collectorTierEdits, setCollectorTierEdits] = useState<Record<string, string>>({});
  const [paymentConfiguration, setPaymentConfiguration] = useState<PaymentConfiguration | null>(null);
  const [adminPayments, setAdminPayments] = useState<AdminPayment[]>([]);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', phone: '', nationalId: '', accountNumber: '', profilePicture: '' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [confirmAccountPassword, setConfirmAccountPassword] = useState('');
  const [accountPasswordVisible, setAccountPasswordVisible] = useState(false);
  const [accountEmailChangePending, setAccountEmailChangePending] = useState(false);
  const [accountPendingEmail, setAccountPendingEmail] = useState('');
  const [accountAvatarError, setAccountAvatarError] = useState('');

  const isAdmin = user?.role === 'super_admin';
  const isCollector = !!user && user.role !== 'super_admin' && user.accountType === 'COLLECTOR';
  const isDairy = !!user && user.role !== 'super_admin' && user.accountType === 'COLLECTION_CENTER';
  const accountCopy = (collectorKey: Parameters<PublicLanguageState['t']>[0], centerKey: Parameters<PublicLanguageState['t']>[0]) => publicLanguage.t(isDairy ? centerKey : collectorKey);
  const visibleTabs = (isAdmin
    ? [
      { id: 'dashboard' as Tab, label: publicLanguage.t('navAdminOverview'), icon: Activity },
      { id: 'accounts' as Tab, label: publicLanguage.t('navAccounts'), icon: Users },
      { id: 'audit' as Tab, label: publicLanguage.t('navAudit'), icon: Shield },
      { id: 'config' as Tab, label: publicLanguage.t('navPricing'), icon: CircleDollarSign },
      { id: 'settings' as Tab, label: publicLanguage.t('navAdminSettings'), icon: Settings },
    ]
    : (isCollector ? collectorTabs : isDairy ? dairyTabs : collectorTabs)).map((item) => {
      const labelKey = item.id === 'dashboard' && isAdmin
        ? 'navAdminOverview'
        : item.id === 'farmers' && isDairy
        ? 'navAbacunda'
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
    const storedUser = sessionStorage.getItem('milk-session-user');
    api<{ user: User }>('/api/auth/me')
      .then((result) => {
        setUser(result.user);
        setTab('dashboard');
        sessionStorage.setItem('milk-session-user', JSON.stringify(result.user));
      })
      .catch(() => {
        if (!navigator.onLine && storedUser) {
          try { setUser(JSON.parse(storedUser) as User); } catch { sessionStorage.removeItem('milk-session-user'); }
        }
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const refreshConnection = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      try {
        const result = await api<{ user: User }>('/api/auth/me');
        setUser(result.user);
        sessionStorage.setItem('milk-session-user', JSON.stringify(result.user));
      } catch {
        setUser(null);
        sessionStorage.removeItem('milk-session-user');
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

  const loadCenters = async () => {
    const data = await api<Center[]>('/api/collection-centers');
    setCenters(data);
    if (!selectedCenter && data.length) setSelectedCenter(String(data[0].id));
  };

  const loadCollectorAssignments = async () => {
    const params = new URLSearchParams();
    if (user?.accountType === 'COLLECTION_CENTER' && selectedCenter) params.set('centerId', selectedCenter);
    const result = await api<CollectorAssignment[]>(`/api/collector-assignments${params.size ? `?${params}` : ''}`);
    setCollectorAssignments(result);
    if (farmerCollectorFilter && !result.some((assignment) => String(assignment.collector_user_id) === farmerCollectorFilter)) {
      setFarmerCollectorFilter('');
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
      cursor: cursor || undefined,
      limit: 50,
    });
    const cacheKey = `milk-farmers-${user?.id}-${user?.accountType}-${scopedFarmerCenter}-${farmerSearch}-${farmerCollectorFilter}`;
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
    const params = new URLSearchParams({ farmerId: ifishiFarmerId, startDate, endDate, limit: '100' });
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    const result = await api<Page<MilkRecord>>(`/api/milk?${params}`, { cache: 'no-store' });
    setIfishiRecords(result.data);
    const selectedRecord = result.data.find((record) => String(record.date).slice(0, 10) === ifishiDate);
    setIfishiMorning(selectedRecord && selectedRecord.volumeMorning > 0 ? String(selectedRecord.volumeMorning) : '');
    setIfishiEvening(selectedRecord && selectedRecord.volumeEvening > 0 ? String(selectedRecord.volumeEvening) : '');
  };

  const loadOwnerIfishiHistory = async () => {
    const { startDate, endDate } = getMonthBounds(ifishiMonth);
    setOwnerIfishiLoading(true);
    setOwnerIfishiError('');
    try {
      const result = await api<OwnerIfishiHistory>(`/api/ifishi/owner?${new URLSearchParams({ startDate, endDate })}`, { cache: 'no-store' });
      setOwnerIfishiHistory(result);
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
    const params = new URLSearchParams({ date: collectionDate, limit: '50' });
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    if (selectedCenter) params.set('centerId', selectedCenter);
    if (cursor) params.set('cursor', cursor);
    const result = await api<{ farmers: DailyRow[]; summary: typeof dailySummary; farmerPagination: { nextCursor: string | null; hasMore: boolean }; center?: string | null; centers?: string[]; collectorMilk?: CollectorMilkEntry[] }>(`/api/milk/daily?${params}`, { cache: 'no-store' });
    setDailyCenter(result.center || null);
    setDailyCenters(result.centers || (result.center ? [result.center] : []));
    const collectorEntry = result.collectorMilk?.[0] || null;
    setCollectorMilkEntry(collectorEntry);
    setCollectorMilkVolume(collectorEntry ? String(collectorEntry.volumeLiters) : '');
    setDaily((previous) => append ? [...previous, ...result.farmers] : result.farmers);
    setDailyCursor(result.farmerPagination.nextCursor);
    setDailyHasMore(result.farmerPagination.hasMore);
    setDailySummary(result.summary);
    setVolumes((previous) => ({ ...previous, ...Object.fromEntries(result.farmers.map((row) => [row.farmerId, { morning: row.volumeMorning ? String(row.volumeMorning) : '', evening: row.volumeEvening ? String(row.volumeEvening) : '' }])) }));
  };

  const loadDeductions = async (cursor?: string | null, append = false) => {
    const params = new URLSearchParams({ limit: '50' });
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

  const loadUkwezi = async () => {
    const params = new URLSearchParams({ periodType: ukweziPeriod, month: ukweziMonth, year: ukweziYear });
    if (isDairy && selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
    setUkweziReport(await api<Report>(`/api/reports/summary?${params}`, { cache: 'no-store' }));
  };

  const loadUnreadCount = async () => {
    const result = await api<{ data: { unreadCount: number } }>('/api/notifications/unread-count');
    setUnreadCount(result.data.unreadCount);
  };

  const loadNotifications = async () => {
    const result = await api<{ data: Notice[] }>('/api/notifications?limit=50');
    setNotifications(result.data);
  };

  const loadAccounts = async () => {
    const params = new URLSearchParams({ page: '1', limit: '50' });
    if (accountSearch) params.set('search', accountSearch);
    if (accountStatus) params.set('status', accountStatus);
    setAccounts(await api(`/api/admin/accounts?${params}`));
  };

  const loadAudit = async () => {
    const result = await api<{ data: { items: any[]; total: number } }>('/api/audit-logs?limit=50');
    setAuditRows(result.data);
  };

  const loadAdminSummary = async () => {
    setAdminSummary(await api<AdminSummary>('/api/admin/accounts/summary'));
  };

  const loadBilling = async () => {
    const data = await api<any>(`/api/subscription?billingPeriod=${billingPeriod}`);
    setBilling(data);
    setPaymentPhone(data.account?.phone || data.user?.phone || '');
  };

  const loadAdminPayments = async () => {
    const result = await api<{ payments: AdminPayment[] }>('/api/admin/payments?limit=100');
    setAdminPayments(result.payments);
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
    if (user.accountType === 'COLLECTION_CENTER') loadCollectorAssignments().catch((reason) => setError(reason.message));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    clearMessages();
    if (isAdmin) {
      if (tab === 'dashboard') loadAdminSummary().catch((reason) => setError(reason.message));
      if (tab === 'accounts') loadAccounts().catch((reason) => setError(reason.message));
      if (tab === 'audit') loadAudit().catch((reason) => setError(reason.message));
      if (tab === 'config') Promise.all([
        api('/api/admin/config/collection-center'),
        api<SubscriptionPlan[]>('/api/admin/config/plans'),
        api<PaymentConfiguration>('/api/admin/config/payments'),
        loadAdminPayments(),
      ]).then(([center, plans, payments]) => {
        setCenterPricing(center);
        const collectorPlans = plans.filter((plan) => plan.code.startsWith('USAGE_') && plan.is_active);
        setSubscriptionPlans(collectorPlans);
        setCollectorTierEdits(Object.fromEntries(collectorPlans.map((plan) => [plan.code, String(plan.price)])));
        setPaymentConfiguration(payments);
      }).catch((reason) => setError(reason.message));
      if (tab === 'settings') loadAccountProfile().catch((reason) => setError(reason.message));
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
    if (tab === 'farmers' && isDairy) loadCollectorAssignments().catch((reason) => setError(reason.message));
    if (tab === 'centers') loadCenters().catch((reason) => setError(reason.message));
    if (tab === 'milk') loadDaily().catch((reason) => setError(reason.message));
    if (tab === 'deductions') {
      loadDeductions().catch((reason) => setError(reason.message));
      loadDeductionFarmers().catch((reason) => setError(reason.message));
    }
    if (tab === 'billing') loadBilling().catch((reason) => setError(reason.message));
    if (tab === 'notifications') loadNotifications().catch((reason) => setError(reason.message));
  }, [user, tab, billingPeriod, selectedCenter]);

  useEffect(() => {
    if (user && tab === 'dashboard' && !isCollector && selectedCenter) {
      loadDaily().catch((reason) => setError(reason.message));
    }
  }, [selectedCenter]);

  useEffect(() => {
    if (user && tab === 'farmers' && !isDairy) loadFarmers().catch((reason) => setError(reason.message));
  }, [user, tab, farmerSearch, farmerCenter, farmerCollectorFilter, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'milk') loadDaily().catch((reason) => setError(reason.message));
  }, [selectedCenter, collectionDate]);
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
    setOwnerIfishiVolume(entry ? String(entry.volumeLiters) : '');
  }, [isCollector, tab, ownerIfishiOpen, ownerIfishiHistory, ifishiDate]);
  useEffect(() => {
    if (user && tab === 'milk' && ifishiOpen && ifishiFarmerId) loadIfishiRecords().catch((reason) => setError(reason.message));
  }, [user, tab, ifishiOpen, ifishiFarmerId, ifishiMonth, ifishiDate]);
  useEffect(() => {
    if (user && isCollector && tab === 'milk' && ownerIfishiOpen) loadOwnerIfishiHistory().catch((reason) => setError(reason.message));
  }, [user, isCollector, tab, ownerIfishiOpen, ifishiMonth]);
  useEffect(() => {
    if (user && (tab === 'ukwezi' || tab === 'transport')) loadUkwezi().catch((reason) => setError(reason.message));
  }, [user, tab, ukweziMonth, ukweziYear, ukweziPeriod, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'reports') loadReport().catch((reason) => setError(reason.message));
  }, [user, tab, reportMonth, selectedCenter]);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
    sessionStorage.removeItem('milk-session-user');
    setUser(null);
  };

  if (authLoading) return <main className="boot-screen"><BrandLockup imageSize={48} /><span>{publicLanguage.t('loading')}</span></main>;
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

  const createFarmer = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const payload: any = { ...farmerForm };
      if (isDairy) payload.collectionCenterId = Number(selectedCenter);
      if (payload.collectionCenterId) {
        const center = centers.find((candidate) => String(candidate.id) === String(payload.collectionCenterId));
        payload.collectionCenter = center?.name;
        if (isDairy) payload.location = center?.name || payload.location;
        payload.collectionCenterId = Number(payload.collectionCenterId);
      }
      const created = await api<Farmer>('/api/farmers', json('POST', payload));
      const params = buildFarmerListQuery({
        userAccountType: user.accountType,
        userId: user.id,
        selectedCollectorId: farmerCollectorFilter,
        farmerSearch,
        farmerCenter: isDairy ? centers.find((center) => String(center.id) === selectedCenter)?.name || '' : farmerCenter,
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
      setFarmerForm({ name: '', location: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
      openIfishiForFarmer(created.id, created.name);
      setNotice('Farmer added.');
    });
  };

  const linkCollector = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api('/api/collector-assignments', json('POST', { collectorUserId: Number(collectorLinkId) }));
      setCollectorLinkId('');
      await loadCollectorAssignments();
      setNotice('Collector linked.');
    });
  };
  const unlinkCollector = async (collectorId: number) => run(async () => {
    await api(`/api/collector-assignments/${collectorId}`, { method: 'DELETE' });
    await loadCollectorAssignments();
    await loadFarmers();
    setNotice('Collector unlinked; farmer assignments were cleared.');
  });

  const editFarmerStart = (farmer: Farmer) => {
    setEditingFarmer(farmer);
    const currentCenterName = String(farmer.collectionCenter || farmer.location || '').trim().toLocaleLowerCase();
    const currentCenter = centers.find((center) => center.name.trim().toLocaleLowerCase() === currentCenterName);
    setFarmerEdit({ name: farmer.name, location: farmer.location || '', collectionCenterId: currentCenter ? String(currentCenter.id) : '', phone: farmer.phone || '', nationalId: farmer.nationalId || '', accountNumber: farmer.accountNumber || '', cowType: farmer.cowType || '', collectorUserId: farmer.collectorUserId ? String(farmer.collectorUserId) : '' });
  };
  const saveFarmer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFarmer) return;
    await run(async () => {
      const payload: any = { ...farmerEdit };
      if (isDairy) payload.collectionCenterId = Number(selectedCenter);
      if (payload.collectionCenterId) {
        const center = centers.find((candidate) => String(candidate.id) === String(payload.collectionCenterId));
        payload.collectionCenter = center?.name;
        if (isDairy) payload.location = center?.name || payload.location;
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
  const saveCollectorMilk = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const record = await api<CollectorMilkEntry>('/api/collector-milk/daily', json('PUT', {
        date: collectionDate,
        volumeLiters: Number(collectorMilkVolume || 0),
      }));
      setCollectorMilkEntry(record);
      setCollectorMilkVolume(String(record.volumeLiters));
      setNotice(publicLanguage.t('collectorMilkSaved'));
      await loadDaily();
    });
  };
  const saveIfishiEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api('/api/milk', json('POST', {
        farmerId: Number(ifishiFarmerId),
        date: ifishiDate,
        volumeMorning: Number(ifishiMorning || 0),
        volumeEvening: Number(ifishiEvening || 0),
      }));
      await loadIfishiRecords();
      await loadDaily();
      setNotice(publicLanguage.t('ifishiSaved'));
    });
  };
  const saveOwnerIfishiEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const existing = ownerIfishiHistory?.entries.find((entry) => entry.date === ifishiDate && entry.id !== null);
      const path = existing ? `/api/ifishi/owner/${existing.id}` : '/api/ifishi/owner';
      await api(path, json(existing ? 'PUT' : 'POST', {
        date: ifishiDate,
        volumeLiters: Number(ownerIfishiVolume),
      }));
      await loadOwnerIfishiHistory();
      setNotice(publicLanguage.t(existing ? 'ownerIfishiCorrected' : 'ownerIfishiSaved'));
    });
  };
  const createDeduction = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api('/api/deductions', json('POST', { ...deductionForm, farmerId: Number(deductionForm.farmerId), amount: Number(deductionForm.amount) }));
      setDeductionForm({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
      await loadDeductions();
      setNotice('Deduction recorded.');
    });
  };

  const paySubscription = async () => run(async () => {
    if (!billing?.pricing) throw new Error(publicLanguage.t('subscriptionUnavailable'));
    const result = await api<any>('/api/subscription/payments', json('POST', { billingPeriod }));
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
    const plans = await api<SubscriptionPlan[]>('/api/admin/config/plans', json('PUT', {
      tiers: subscriptionPlans.map((plan) => ({ code: plan.code, price: Number(collectorTierEdits[plan.code] ?? plan.price) })),
    }));
    const collectorPlans = plans.filter((plan) => plan.code.startsWith('USAGE_') && plan.is_active);
    setSubscriptionPlans(collectorPlans);
    setCollectorTierEdits(Object.fromEntries(collectorPlans.map((plan) => [plan.code, String(plan.price)])));
    setNotice(publicLanguage.t('pricingSaved'));
  });

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
      setAccountPasswordVisible(false);
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

  const adminAction = async (account: Account, action: string) => run(async () => {
    await api(`/api/admin/accounts/${account.user_id}/${action}`, json('POST', action === 'extend-trial' ? { days: 15, reason: 'Admin dashboard request' } : {}));
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
    return <>
      <section className="panel panel-wide abacunda-directory">
        <div className="panel-heading"><div><span className="eyebrow">Active Ikigo</span><h2>{activeCenterName}</h2></div><Building2 size={19} aria-hidden="true" /></div>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('directory')}</span><h2>{publicLanguage.t('navAbacunda')}</h2></div><span className="count-label">{collectorAssignments.length}</span></div>
        {collectorAssignments.length ? <>
          <div className="table-scroll abacunda-desktop-list"><table><thead><tr><th>{publicLanguage.t('assignedCollectors')}</th><th>{publicLanguage.t('accountNationalId')}</th><th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{publicLanguage.t('navAbacunda')}</th><th>{publicLanguage.t('navIfishi')}</th></tr></thead><tbody>{collectorAssignments.map((assignment) => <tr key={assignment.collector_user_id}><td className="strong-cell">{assignment.collector_name}</td><td>{assignment.collector_national_id || '—'}</td><td>{[assignment.collector_phone, assignment.collector_account_number].filter(Boolean).join(' / ') || '—'}</td><td>{assignment.abacunda_count}</td><td><button type="button" className="text-button" onClick={() => openAbacundaIfishi(assignment)}>{publicLanguage.t('navIfishi')}</button></td></tr>)}</tbody></table></div>
          <div className="abacunda-mobile-list">{collectorAssignments.map((assignment) => <article className="abacunda-mobile-card" key={assignment.collector_user_id}><header><b>{assignment.collector_name}</b><span>{assignment.abacunda_count} {publicLanguage.t('navAbacunda').toLowerCase()}</span></header><p>{[assignment.collector_phone, assignment.collector_account_number].filter(Boolean).join(' / ') || '—'}</p><button type="button" className="button button-secondary small-button" onClick={() => openAbacundaIfishi(assignment)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button></article>)}</div>
        </> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Users size={21} aria-hidden="true" /></span><b>{publicLanguage.t('noCollectorsLinked')}</b></div>}
      </section>
      {abacundaIfishiCollector ? <div className="modal-backdrop" role="presentation" onClick={() => setAbacundaIfishiCollector(null)}><section className="modal-panel abacunda-ifishi-panel" role="dialog" aria-modal="true" aria-labelledby="abacunda-ifishi-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading"><div><span className="eyebrow">{activeCenterName}</span><h2 id="abacunda-ifishi-title">{abacundaIfishiCollector.collector_name} · {publicLanguage.t('navIfishi')}</h2></div><button type="button" className="icon-button" onClick={() => setAbacundaIfishiCollector(null)} aria-label={publicLanguage.t('cancel')}><X size={18} /></button></div>
          <div className="toolbar abacunda-ifishi-toolbar"><label>{publicLanguage.t('ifishiMonth')}<input type="month" max={today().slice(0, 7)} value={abacundaIfishiMonth} onChange={(event) => { if (!event.target.value) return; setAbacundaIfishiMonth(event.target.value); void loadAbacundaIfishi(abacundaIfishiCollector.collector_user_id, event.target.value); }} /></label></div>
        {abacundaIfishiLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}
        {abacundaIfishiError ? <div className="workspace-empty" role="alert"><b>{abacundaIfishiError}</b></div> : null}
        {abacundaIfishiHistory ? <>
          <p className="muted-note">{abacundaIfishiHistory.startDate} – {abacundaIfishiHistory.endDate}</p>
          <div className="metric-strip abacunda-ifishi-summary"><div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(abacundaIfishiHistory.totals.morningLiters)} L</b></div><div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(abacundaIfishiHistory.totals.eveningLiters)} L</b></div><div><span>{publicLanguage.t('ifishiValid')}</span><b>{liters(abacundaIfishiHistory.totals.validLiters)} L</b></div><div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(abacundaIfishiHistory.totals.lostLiters)} L</b></div></div>
          {abacundaIfishiHistory.entries.length ? <><div className="table-scroll abacunda-ifishi-desktop-list"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th><th>{publicLanguage.t('milkTotal')} · L</th><th>{publicLanguage.t('ifishiLost')} · L</th><th>{publicLanguage.t('ifishiReason')}</th></tr></thead><tbody>{abacundaIfishiHistory.entries.map((entry) => <tr key={entry.date}><td>{entry.date}</td><td>{liters(entry.morningLiters)}</td><td>{liters(entry.eveningLiters)}</td><td>{liters(entry.validLiters)}</td><td>{liters(entry.lostLiters)}</td><td>{entry.reason || entry.status}</td></tr>)}</tbody></table></div><div className="abacunda-ifishi-mobile-list">{abacundaIfishiHistory.entries.map((entry) => <article className="owner-ifishi-day" key={entry.date}><header><b>{entry.date}</b><span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span></header><dl><div><dt>{publicLanguage.t('dashboardMorning')}</dt><dd>{liters(entry.morningLiters)} L</dd></div><div><dt>{publicLanguage.t('dashboardEvening')}</dt><dd>{liters(entry.eveningLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiValid')}</dt><dd>{liters(entry.validLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostLiters)} L</dd></div></dl>{entry.reason ? <p>{entry.reason}</p> : null}</article>)}</div></> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('ownerIfishiEmpty')}</b></div>}
        </> : null}
      </section></div> : null}
    </>;
  };

  const renderFarmers = () => (
    <div className="screen-grid">
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{isDairy ? publicLanguage.t('dashboardCenter') : publicLanguage.t('directory')}</span><h2>{isDairy ? publicLanguage.t('navAbacunda') : accountCopy('navFarmers', 'navAbacunda')}</h2></div><span className="count-label">{isDairy ? centers.find((center) => String(center.id) === selectedCenter)?.name || '—' : farmers ? `${farmers.data.length} ${accountCopy('farmersLoaded', 'abacundaLoaded')}` : '…'}{!isDairy ? ` · ${accountCopy('pageSize', 'abacundaPageSize')}` : ''}</span></div>
        {!isDairy ? <div className="toolbar">
          <form className="search-form" onSubmit={(event) => { event.preventDefault(); setFarmerSearch(farmerQuery.trim()); }}><Search size={17} /><input aria-label={publicLanguage.t('farmersSearchPlaceholder')} placeholder={publicLanguage.t('farmersSearchPlaceholder')} value={farmerQuery} onChange={(event) => setFarmerQuery(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form>
          <select aria-label={publicLanguage.t('allCenters')} value={farmerCenter} onChange={(event) => setFarmerCenter(event.target.value)}><option value="">{publicLanguage.t('allCenters')}</option>{centers.map((center) => <option key={center.id} value={center.name}>{center.name}</option>)}</select>
          {user?.accountType === 'COLLECTION_CENTER' ? <select aria-label={publicLanguage.t('assignedCollector')} value={farmerCollectorFilter} onChange={(event) => setFarmerCollectorFilter(event.target.value)}><option value="">{publicLanguage.t('allCollectors')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={String(assignment.collector_user_id)}>{assignment.collector_name}</option>)}</select> : null}
        </div> : null}
        {!isCollector && !isDairy ? <div className="assignment-tool">
          <div><span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span><h3>{publicLanguage.t('assignedCollectors')}</h3></div>
          <form className="assignment-form" onSubmit={linkCollector}><input type="number" min="1" step="1" required placeholder={publicLanguage.t('collectorAccountId')} aria-label={publicLanguage.t('collectorAccountId')} value={collectorLinkId} onChange={(event) => setCollectorLinkId(event.target.value)} /><button className="button button-secondary"><Plus size={15} /> {publicLanguage.t('linkCollector')}</button></form>
          <div className="assignment-list">{collectorAssignments.map((assignment) => <div className="assignment-chip" key={assignment.collector_user_id}><span><b>{assignment.collector_name}</b><small>{assignment.collector_account_number || assignment.collector_user_id} · {assignment.abacunda_count} {accountCopy('navFarmers', 'abacundaLabel').toLowerCase()}</small></span><button className="text-button danger-text" onClick={() => unlinkCollector(assignment.collector_user_id)}>{publicLanguage.t('delete')}</button></div>)}{!collectorAssignments.length ? <span className="muted-note">{publicLanguage.t('noCollectorsLinked')}</span> : null}</div>
        </div> : null}
        <div className="table-scroll farmers-desktop-table"><table><thead><tr><th>{publicLanguage.t('columnName')}</th><th>{publicLanguage.t('columnLocation')}</th><th>{publicLanguage.t('columnPhone')}</th><th>{publicLanguage.t('columnNationalId')}</th><th>{publicLanguage.t('columnCenter')}</th><th>{publicLanguage.t('assignedCollector')}</th><th>{publicLanguage.t('navIfishi')}</th><th /></tr></thead><tbody>
          {(farmers?.data || []).map((farmer) => <tr key={farmer.id}><td className="strong-cell">{farmer.name}</td><td>{farmer.location || '—'}</td><td>{farmer.phone || '—'}</td><td>{farmer.nationalId || '—'}</td><td>{farmer.collectionCenter || '—'}</td><td>{getFarmerCollectorName(farmer.collectorUserId)}</td><td><button type="button" className="text-button" onClick={() => openIfishiForFarmer(farmer.id, farmer.name)}>{publicLanguage.t('navIfishi')}</button></td><td className="actions-cell"><button className="text-button" onClick={() => editFarmerStart(farmer)}>{publicLanguage.t('edit')}</button><button className="text-button danger-text" onClick={() => deleteFarmer(farmer)}>{publicLanguage.t('delete')}</button></td></tr>)}
        </tbody></table></div>
        {farmers ? farmers.data.length ? <div className="farmer-mobile-list">{farmers.data.map((farmer) => <article className="farmer-mobile-card" key={farmer.id}><header><b>{farmer.name}</b><span>{farmer.collectionCenter || farmer.location || '—'}</span></header><dl><div><dt>{publicLanguage.t('columnLocation')}</dt><dd>{farmer.location || '—'}</dd></div><div><dt>{publicLanguage.t('columnPhone')}</dt><dd>{farmer.phone || '—'}</dd></div><div><dt>{publicLanguage.t('columnNationalId')}</dt><dd>{farmer.nationalId || '—'}</dd></div><div><dt>{publicLanguage.t('columnCenter')}</dt><dd>{farmer.collectionCenter || '—'}</dd></div><div><dt>{publicLanguage.t('assignedCollector')}</dt><dd>{getFarmerCollectorName(farmer.collectorUserId)}</dd></div></dl><footer><button type="button" className="button button-secondary small-button" onClick={() => openIfishiForFarmer(farmer.id, farmer.name)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button><button className="button button-secondary small-button" onClick={() => editFarmerStart(farmer)}>{publicLanguage.t('edit')}</button><button className="button button-secondary small-button danger-text" onClick={() => deleteFarmer(farmer)}>{publicLanguage.t('delete')}</button></footer></article>)}</div> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Users size={21} aria-hidden="true" /></span><div><b>{accountCopy('farmersEmptyTitle', 'abacundaEmptyTitle')}</b><p>{accountCopy('farmersEmptyBody', 'abacundaEmptyBody')}</p></div>{farmerSearch || farmerCenter || farmerCollectorFilter ? <button type="button" className="button button-secondary small-button" onClick={() => { setFarmerSearch(''); setFarmerQuery(''); setFarmerCenter(''); setFarmerCollectorFilter(''); }}>{publicLanguage.t('milkClearSearch')}</button> : <button type="button" className="button button-primary small-button" onClick={() => document.getElementById('new-farmer-name')?.focus()}><Plus size={15} />{accountCopy('farmersAdd', 'abacundaAdd')}</button>}</div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
        {farmers?.hasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => loadFarmers(farmers.nextCursor, true)}>{accountCopy('milkLoadMore', 'milkLoadMoreAbacunda')} <ChevronDown size={16} /></button></div> : null}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('newRecord')}</span><h2>{accountCopy('farmersAdd', 'abacundaAdd')}</h2></div><UserRound size={19} /></div>
        <form className="form-stack compact" onSubmit={createFarmer}>
          <label>{publicLanguage.t('fullName')}<input id="new-farmer-name" required value={farmerForm.name} onChange={(event) => setFarmerForm({ ...farmerForm, name: event.target.value })} /></label>
          {isCollector ? <>
            <label>{publicLanguage.t('columnLocation')}<select aria-label={publicLanguage.t('columnLocation')} value={farmerForm.collectionCenterId} onChange={(event) => setFarmerForm({ ...farmerForm, collectionCenterId: event.target.value })} required disabled={!centers.length}><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>
            {!centers.length ? <p className="muted-note" role="status">{publicLanguage.t('farmerNoCenters')}</p> : null}
            <label>{publicLanguage.t('farmerVillage')}<input required value={farmerForm.location} onChange={(event) => setFarmerForm({ ...farmerForm, location: event.target.value })} /></label>
          </> : isDairy ? <label>Active Ikigo<input readOnly value={centers.find((center) => String(center.id) === selectedCenter)?.name || ''} required /></label> : <label>{publicLanguage.t('columnCenter')}<select value={farmerForm.collectionCenterId} onChange={(event) => { const selectedId = event.target.value; const center = centers.find((candidate) => String(candidate.id) === selectedId); setFarmerForm({ ...farmerForm, collectionCenterId: selectedId, location: center ? center.name : '' }); }} required><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>}
          <label>{publicLanguage.t('columnPhone')}<input inputMode="tel" value={farmerForm.phone} onChange={(event) => setFarmerForm({ ...farmerForm, phone: event.target.value })} /></label>
          <label>{publicLanguage.t('columnNationalId')}<input value={farmerForm.nationalId} onChange={(event) => setFarmerForm({ ...farmerForm, nationalId: event.target.value })} /></label>
          <label>{publicLanguage.t('accountNumber')}<input value={farmerForm.accountNumber} onChange={(event) => setFarmerForm({ ...farmerForm, accountNumber: event.target.value })} /></label>
          <label>{publicLanguage.t('cowType')}<input value={farmerForm.cowType} onChange={(event) => setFarmerForm({ ...farmerForm, cowType: event.target.value })} /></label>
          {!isCollector ? <label>{publicLanguage.t('assignedCollector')}<select value={farmerForm.collectorUserId} onChange={(event) => setFarmerForm({ ...farmerForm, collectorUserId: event.target.value })}><option value="">{publicLanguage.t('noCollector')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={assignment.collector_user_id}>{assignment.collector_name}</option>)}</select></label> : null}
          <button className="button button-primary" disabled={busy || ((isCollector || isDairy) && !selectedCenter)}><Plus size={16} />{accountCopy('farmersAdd', 'abacundaAdd')}</button>
        </form>
      </section>
      {editingFarmer ? <div className="modal-backdrop" role="presentation" onClick={() => setEditingFarmer(null)}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-farmer-title" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><h2 id="edit-farmer-title">{publicLanguage.t('edit')} {editingFarmer.name}</h2><button type="button" className="icon-button" onClick={() => setEditingFarmer(null)} aria-label={publicLanguage.t('cancel')}><X size={18} /></button></div><form className="form-stack" onSubmit={saveFarmer}>
        <label>{publicLanguage.t('fullName')}<input required value={farmerEdit.name} onChange={(event) => setFarmerEdit({ ...farmerEdit, name: event.target.value })} /></label>
        {isCollector ? <>
          <label>{publicLanguage.t('columnLocation')}<select aria-label={publicLanguage.t('columnLocation')} value={farmerEdit.collectionCenterId} onChange={(event) => setFarmerEdit({ ...farmerEdit, collectionCenterId: event.target.value })} required disabled={!centers.length}><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>
          <label>{publicLanguage.t('farmerVillage')}<input required value={farmerEdit.location} onChange={(event) => setFarmerEdit({ ...farmerEdit, location: event.target.value })} /></label>
        </> : isDairy ? <label>Active Ikigo<input readOnly value={centers.find((center) => String(center.id) === selectedCenter)?.name || ''} required /></label> : <label>{publicLanguage.t('columnCenter')}<select value={farmerEdit.collectionCenterId} onChange={(event) => { const selectedId = event.target.value; const center = centers.find((candidate) => String(candidate.id) === selectedId); setFarmerEdit({ ...farmerEdit, collectionCenterId: selectedId, location: center ? center.name : '' }); }} required><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>}
        <label>{publicLanguage.t('columnPhone')}<input inputMode="tel" value={farmerEdit.phone} onChange={(event) => setFarmerEdit({ ...farmerEdit, phone: event.target.value })} /></label>
        <label>{publicLanguage.t('columnNationalId')}<input value={farmerEdit.nationalId} onChange={(event) => setFarmerEdit({ ...farmerEdit, nationalId: event.target.value })} /></label>
        <label>{publicLanguage.t('accountNumber')}<input value={farmerEdit.accountNumber} onChange={(event) => setFarmerEdit({ ...farmerEdit, accountNumber: event.target.value })} /></label>
        <label>{publicLanguage.t('cowType')}<input value={farmerEdit.cowType} onChange={(event) => setFarmerEdit({ ...farmerEdit, cowType: event.target.value })} /></label>
        {!isCollector ? <label>{publicLanguage.t('assignedCollector')}<select value={farmerEdit.collectorUserId} onChange={(event) => setFarmerEdit({ ...farmerEdit, collectorUserId: event.target.value })}><option value="">{publicLanguage.t('noCollector')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={assignment.collector_user_id}>{assignment.collector_name}</option>)}</select></label> : null}
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditingFarmer(null)}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy}>{publicLanguage.t('saveChanges')}</button></div>
      </form></section></div> : null}
    </div>
  );

  const renderCenters = () => (
    <div className="screen-grid">
      <section className="panel panel-wide"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('configuration')}</span><h2>{publicLanguage.t('navCenters')}</h2></div><span className="count-label">{centers.length} {publicLanguage.t('centersConfigured')}</span></div>
        {centers.map((center) => { const edits = centerEdits[center.id] || {}; return <div className="center-config-row" key={center.id}><div><h3>{center.name}</h3><p>{money(center.pricePerLiter)} RWF/L · transport {money(center.transportRatePerLiter)} RWF/L</p></div><div className="center-edit-grid">
          <label>{publicLanguage.t('milkPrice')}<input type="number" min="1" step="0.01" value={edits.pricePerLiter ?? center.pricePerLiter} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, pricePerLiter: Number(event.target.value) } })} /></label>
          <label>{publicLanguage.t('transportPerLiter')}<input type="number" min="0" step="0.01" value={edits.transportRatePerLiter ?? center.transportRatePerLiter} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, transportRatePerLiter: Number(event.target.value) } })} /></label>
          <label>{publicLanguage.t('morningStart')}<input type="time" value={String(edits.morningStart ?? center.morning_start).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, morningStart: event.target.value } })} /></label>
          <label>{publicLanguage.t('morningEnd')}<input type="time" value={String(edits.morningEnd ?? center.morning_end).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, morningEnd: event.target.value } })} /></label>
          <label>{publicLanguage.t('eveningStart')}<input type="time" value={String(edits.eveningStart ?? center.evening_start).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, eveningStart: event.target.value } })} /></label>
          <label>{publicLanguage.t('eveningEnd')}<input type="time" value={String(edits.eveningEnd ?? center.evening_end).slice(0, 5)} onChange={(event) => setCenterEdits({ ...centerEdits, [center.id]: { ...edits, eveningEnd: event.target.value } })} /></label>
          <button className="button button-secondary" onClick={() => saveCenter(center)}><Check size={15} /> {publicLanguage.t('saveSettings')}</button>
        </div></div>; })}
        {!centers.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Building2 size={21} aria-hidden="true" /></span><div><b>{publicLanguage.t('centersEmptyTitle')}</b></div>{user.accountType !== 'COLLECTION_CENTER' ? <button type="button" className="button button-primary small-button" onClick={() => document.getElementById('new-center-name')?.focus()}><Plus size={15} />{publicLanguage.t('centersAdd')}</button> : null}</div> : null}
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

  const renderMilk = () => {
    const currentDay = collectionDate ? Number(new Date(`${collectionDate}T00:00:00Z`).getUTCDate()) : 1;
    const currentPeriod = currentDay <= 15 ? publicLanguage.t('milkUkweziFirstHalf') : publicLanguage.t('milkUkweziSecondHalf');
    const visibleRows = daily;
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
      <div><b>{accountCopy('milkNoAssignedTitle', 'milkNoAssignedAbacundaTitle')}</b><p>{accountCopy('milkNoAssignedBody', 'milkNoAssignedAbacundaBody')}</p></div>
      <button type="button" className="button button-secondary small-button" onClick={() => setTab('farmers')}>{accountCopy('milkOpenFarmers', 'milkOpenAbacunda')} <ArrowRight size={15} /></button>
    </div>;

    return <>
      <section className="panel milk-workspace">
      <div className="milk-workspace-header">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navMilk')}</span><h2>{publicLanguage.t('milkEntries')}</h2></div><span className="milk-period-badge"><CalendarDays size={15} aria-hidden="true" />{currentPeriod}</span></div>
      </div>
      {isCollector ? <section className="panel owner-account-panel">
        <div className="panel-heading"><div><span className="eyebrow">OWNER / ACCOUNT</span><h2>{user?.name || user?.email}</h2></div><UserRound size={19} aria-hidden="true" /></div>
        <div className="metric-strip milk-summary owner-account-summary"><div><span>{publicLanguage.t('ownerIfishiOwnerMilk')}</span><b>{liters(Number(collectorMilkEntry?.effectiveVolumeLiters ?? collectorMilkEntry?.volumeLiters ?? 0))} L</b></div></div>
        <button type="button" className="button button-secondary small-button owner-ifishi-action" aria-expanded={ownerIfishiOpen} onClick={() => { setIfishiOpen(false); setOwnerIfishiOpen((open) => !open); }}><BookOpen size={15} aria-hidden="true" />{publicLanguage.t('ownerIfishiTitle')}</button>
        <form className="collector-combined-entry" onSubmit={saveCollectorMilk}>
          <div><span className="eyebrow">{publicLanguage.t('collectorActualMilk')}</span><p>{publicLanguage.t('collectorActualMilkNote')}</p></div>
          <label>{publicLanguage.t('milkTotal')} · L<input type="number" min="0" step="0.01" required value={collectorMilkVolume} onChange={(event) => setCollectorMilkVolume(event.target.value)} /></label>
          {collectorMilkEntry ? <span className="milk-entry-state saved">{publicLanguage.t('milkSaved')} · {money(collectorMilkEntry.pricePerLiter)} RWF/L</span> : <span className="milk-entry-state unsaved">{publicLanguage.t('milkUnsaved')}</span>}
          <button className="button button-secondary small-button" disabled={busy}>{publicLanguage.t('milkSave')}</button>
        </form>
      </section> : null}
      {isCollector && ownerIfishiOpen ? renderOwnerIfishi() : null}
      <div className="milk-entry-controls">
        <div className="milk-toolbar">
          <label><span>{publicLanguage.t('milkCollectionDate')}</span><input type="date" value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} /></label>
          {centers.length ? <label><span>{isDairy ? 'Active Ikigo' : publicLanguage.t('dashboardCenter')}</span><select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
        </div>
        <div className="milk-session-context"><span>{publicLanguage.t('milkCollectionWindow')}</span><b>{publicLanguage.t('dashboardMorning')} <i /> {publicLanguage.t('dashboardEvening')}</b></div>
      </div>
      <div className="metric-strip milk-summary"><div><span>{accountCopy('dashboardFarmers', 'dashboardAbacundaToday')}</span><b>{dailySummary.presentCount} / {dailySummary.totalFarmers}</b></div><div><span>{publicLanguage.t('dashboardCollected')}</span><b>{liters(dailySummary.totalVolume)} L</b></div><div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(dailySummary.totalMorning)} L</b></div><div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(dailySummary.totalEvening)} L</b></div><div><span>{publicLanguage.t('dashboardAccounting')}</span><b>{money(dailySummary.totalAmount)} RWF</b></div></div>
      <div className="panel-heading"><div><span className="eyebrow">{isCollector ? 'ABOROZI' : 'ACTIVE IKIGO'}</span><h2>{accountCopy('navFarmers', 'navAbacunda')}</h2></div><span className="count-label">{visibleRows.length} {accountCopy('navFarmers', 'navAbacunda').toLowerCase()}</span></div>
      {visibleRows.length ? <>
        <div className="table-scroll milk-desktop-list"><table><thead><tr><th>{accountCopy('milkFarmer', 'milkAbacunda')}</th><th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th><th>{publicLanguage.t('milkTotal')} · L</th><th>{publicLanguage.t('milkAmount')} · RWF</th><th>{publicLanguage.t('navIfishi')}</th><th>{publicLanguage.t('milkAction')}</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.farmerId}><td className="strong-cell">{row.farmerName}</td><td>{volumeInput(row, 'morning')}</td><td>{volumeInput(row, 'evening')}</td><td>{liters(row.totalVolume)}</td><td>{money(row.amount)}</td><td><button type="button" className="text-button" onClick={() => openIfishiForFarmer(row.farmerId, row.farmerName)}>{publicLanguage.t('navIfishi')}</button></td><td className="milk-table-action"><span className={`milk-entry-state ${entryState(row)}`}>{publicLanguage.t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span><button className="button button-secondary small-button" onClick={() => saveMilk(row)} disabled={busy}>{publicLanguage.t('milkSave')}</button></td></tr>)}</tbody></table></div>
        <div className="milk-mobile-list">{visibleRows.map((row) => <article className="milk-entry-card" key={row.farmerId}>
          <header><div><b>{row.farmerName}</b><small>{row.collectionCenter || dailyCenter || ''}</small></div><span className={`milk-entry-state ${entryState(row)}`}>{publicLanguage.t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span></header>
          <div className="milk-entry-inputs"><label><span>{publicLanguage.t('dashboardMorning')} · L</span>{volumeInput(row, 'morning')}</label><label><span>{publicLanguage.t('dashboardEvening')} · L</span>{volumeInput(row, 'evening')}</label></div>
          <footer><span>{publicLanguage.t('dashboardCollected')} <b>{liters(row.totalVolume)} L</b></span><button type="button" className="button button-secondary small-button" onClick={() => openIfishiForFarmer(row.farmerId, row.farmerName)}><BookOpen size={15} />{publicLanguage.t('navIfishi')}</button><button className="button button-secondary small-button" onClick={() => saveMilk(row)} disabled={busy}>{publicLanguage.t('milkSave')}</button></footer>
        </article>)}</div>
      </> : emptyState}
      {dailyHasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => dailyCursor && loadDaily(dailyCursor, true)}>{publicLanguage.t('milkLoadMore')} <ChevronDown size={16} /></button></div> : null}
      </section>
      {ifishiOpen ? renderIfishi() : null}
    </>;
  };

  const renderOwnerIfishi = () => {
    const { startDate, endDate } = getMonthBounds(ifishiMonth);
    const selectedEntry = ownerIfishiHistory?.entries.find((entry) => entry.date === ifishiDate);
    const maxDate = endDate > today() ? today() : endDate;
    const selectIfishiDate = (date: string) => {
      setIfishiDate(date);
      const entry = ownerIfishiHistory?.entries.find((row) => row.date === date && row.id !== null);
      setOwnerIfishiVolume(entry ? String(entry.volumeLiters) : '');
    };
    const moveMonth = (offset: number) => {
      const date = new Date(`${ifishiMonth}-01T00:00:00`);
      date.setMonth(date.getMonth() + offset);
      setIfishiMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    };

    return <div className="screen-grid owner-ifishi-view">
      <section className="panel owner-ifishi-context">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ownerIfishiTitle')}</span><h2>{user?.name || user?.email}</h2></div><BookOpen size={19} aria-hidden="true" /></div>
        <p className="muted-note">{publicLanguage.t('ownerIfishiContext')}</p>
        <div className="owner-ifishi-period">
          <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label={publicLanguage.t('ownerIfishiPreviousMonth')} title={publicLanguage.t('ownerIfishiPreviousMonth')}><ChevronLeft size={17} /></button>
          <label>{publicLanguage.t('ifishiMonth')}<input type="month" max={today().slice(0, 7)} value={ifishiMonth} onChange={(event) => setIfishiMonth(event.target.value)} /></label>
          <button type="button" className="icon-button" onClick={() => moveMonth(1)} disabled={ifishiMonth >= today().slice(0, 7)} aria-label={publicLanguage.t('ownerIfishiNextMonth')} title={publicLanguage.t('ownerIfishiNextMonth')}><ChevronRight size={17} /></button>
        </div>
      </section>

      <section className="panel owner-ifishi-entry">
        <div className="panel-heading"><div><span className="eyebrow">{selectedEntry?.id ? publicLanguage.t('ownerIfishiCorrection') : publicLanguage.t('ownerIfishiMissed')}</span><h2>{publicLanguage.t('ownerIfishiDailyEntry')}</h2></div><Milk size={19} aria-hidden="true" /></div>
        <form className="form-stack compact" onSubmit={saveOwnerIfishiEntry}>
          <label>{publicLanguage.t('milkCollectionDate')}<input type="date" min={startDate} max={maxDate} value={ifishiDate} onChange={(event) => selectIfishiDate(event.target.value)} required /></label>
          <label>{publicLanguage.t('ownerIfishiVolume')} · L<input type="number" min="0.01" step="0.01" required value={ownerIfishiVolume} onChange={(event) => setOwnerIfishiVolume(event.target.value)} /></label>
          {selectedEntry?.id && selectedEntry.status !== 'valid' ? <p className="form-error" role="status">{publicLanguage.t('ownerIfishiLocked')}</p> : null}
          {selectedEntry?.id && selectedEntry.status === 'valid' ? <p className="muted-note">{publicLanguage.t('ownerIfishiCorrectionAudit')}</p> : null}
          <button className="button button-primary" disabled={busy || !ifishiDate || Boolean(selectedEntry?.id && selectedEntry.status !== 'valid')}><Check size={16} aria-hidden="true" />{publicLanguage.t(selectedEntry?.id ? 'ownerIfishiCorrect' : 'ownerIfishiSave')}</button>
        </form>
      </section>

      <section className="panel panel-wide owner-ifishi-history">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ownerIfishiHistory')}</span><h2>{ifishiMonth}</h2></div><span className="count-label">{ownerIfishiHistory?.entries.length || 0} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        {ownerIfishiLoading && !ownerIfishiHistory ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('ownerIfishiLoading')}</div> : null}
        {ownerIfishiError ? <div className="workspace-empty" role="alert"><b>{publicLanguage.t('ownerIfishiLoadError')}</b><button type="button" className="button button-secondary small-button" onClick={() => loadOwnerIfishiHistory().catch((reason) => setError(reason.message))}>{publicLanguage.t('reportsRefresh')}</button></div> : null}
        {!ownerIfishiLoading && !ownerIfishiError && ownerIfishiHistory ? <>
          <div className="metric-strip owner-ifishi-summary">
            <div><span>{publicLanguage.t('ownerIfishiOwnerMilk')}</span><b>{liters(ownerIfishiHistory.totals.ownerVolumeLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiAssigned')}</span><b>{liters(ownerIfishiHistory.totals.assignedFarmerLiters)} L</b></div>
            <div><span>{publicLanguage.t('ownerIfishiSurplus')}</span><b>{liters(ownerIfishiHistory.totals.surplusLiters)} L</b></div>
          </div>
          {ownerIfishiHistory.entries.length ? <>
            <div className="table-scroll owner-ifishi-desktop-list"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('ownerIfishiOwnerMilk')} · L</th><th>{publicLanguage.t('ownerIfishiAssigned')} · L</th><th>{publicLanguage.t('ownerIfishiSurplus')} · L</th><th>{publicLanguage.t('ifishiLost')} · L</th><th>{publicLanguage.t('ifishiReason')}</th><th /></tr></thead><tbody>{ownerIfishiHistory.entries.map((entry) => <tr key={`${entry.date}-${entry.id || 'assigned'}`}>
              <td><button type="button" className="text-button" onClick={() => selectIfishiDate(entry.date)}>{entry.date}</button></td>
              <td>{liters(entry.validVolumeLiters)} L</td><td>{liters(entry.assignedFarmerLiters)} L</td><td>{liters(entry.surplusLiters)} L</td><td>{liters(entry.lostVolumeLiters)} L</td>
              <td>{entry.adjustmentReason || entry.status}</td>
              <td><button type="button" className="text-button" onClick={() => selectIfishiDate(entry.date)}>{entry.id && entry.status === 'valid' ? publicLanguage.t('ownerIfishiCorrect') : entry.id ? publicLanguage.t('ownerIfishiVoidedShort') : publicLanguage.t('ownerIfishiEnter')}</button></td>
            </tr>)}</tbody></table></div>
            <div className="owner-ifishi-mobile-list">{ownerIfishiHistory.entries.map((entry) => <article className="owner-ifishi-day" key={`${entry.date}-${entry.id || 'assigned'}`}>
              <header><button type="button" className="text-button" onClick={() => selectIfishiDate(entry.date)}>{entry.date}</button><span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span></header>
              <dl><div><dt>{publicLanguage.t('ownerIfishiOwnerMilk')}</dt><dd>{liters(entry.validVolumeLiters)} L</dd></div><div><dt>{publicLanguage.t('ownerIfishiAssigned')}</dt><dd>{liters(entry.assignedFarmerLiters)} L</dd></div><div><dt>{publicLanguage.t('ownerIfishiSurplus')}</dt><dd>{liters(entry.surplusLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostVolumeLiters)} L</dd></div></dl>
              {entry.adjustmentReason ? <p>{entry.adjustmentReason}</p> : null}
              <footer><button type="button" className="button button-secondary small-button" onClick={() => selectIfishiDate(entry.date)} disabled={Boolean(entry.id && entry.status !== 'valid')}>{entry.id ? publicLanguage.t('ownerIfishiCorrect') : publicLanguage.t('ownerIfishiEnter')}</button></footer>
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
    const monthlyRows = ifishiRecords.filter((record) => String(record.date).slice(0, 10) >= startDate && String(record.date).slice(0, 10) <= endDate);
    const totalMorning = monthlyRows.reduce((sum, record) => sum + Number(record.volumeMorning || 0), 0);
    const totalEvening = monthlyRows.reduce((sum, record) => sum + Number(record.volumeEvening || 0), 0);
    const totalVolume = totalMorning + totalEvening;
    const validVolume = monthlyRows.reduce((sum, record) => sum + Number(record.validVolumeLiters || (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))), 0);
    const lostVolume = monthlyRows.reduce((sum, record) => sum + Number(record.lostVolumeLiters || 0), 0);
    const pdfParams = new URLSearchParams({ farmerId: ifishiFarmerId, month: ifishiMonth.slice(5, 7), year: ifishiMonth.slice(0, 4) });

    return <div className="screen-grid ifishi-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('milkCollectionWindow')}</span><h2>{publicLanguage.t('navIfishi')}</h2></div><BookOpen size={19} aria-hidden="true" /></div>
        <div className="form-stack compact">
          <label>{publicLanguage.t('ifishiMonth')}<input type="month" value={ifishiMonth} onChange={(event) => setIfishiMonth(event.target.value)} /></label>
          <label>{accountCopy('milkFarmerSearch', 'milkAbacundaSearch')}<input type="search" value={ifishiFarmerSearch} onChange={(event) => setIfishiFarmerSearch(event.target.value)} /></label>
          <label>{accountCopy('milkFarmer', 'milkAbacunda')}<select required value={ifishiFarmerId} onChange={(event) => setIfishiFarmerId(event.target.value)}><option value="">{accountCopy('deductionsFarmer', 'milkAbacunda')}</option>{ifishiFarmers.map((farmer) => <option key={farmer.id} value={String(farmer.id)}>{farmer.name} · {farmer.collectionCenter || farmer.location || '—'}</option>)}</select></label>
          <label>{publicLanguage.t('milkCollectionDate')}<input type="date" min={startDate} max={endDate} value={ifishiDate} onChange={(event) => setIfishiDate(event.target.value)} /></label>
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
          <button className="button button-primary" disabled={busy || !ifishiFarmerId}>{publicLanguage.t('milkSave')}</button>
        </form>
      </section>
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiPersistedRecords')}</span><h2>{ifishiMonth}</h2></div><a className="button button-secondary" href={`/api/ifishi/pdf?${pdfParams}`} target="_blank" rel="noreferrer"><FileBarChart2 size={16} aria-hidden="true" />{publicLanguage.t('ifishiDownloadPdf')}</a></div>
        <div className="metric-strip ifishi-summary-strip">
          <div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(totalMorning)} L</b></div>
          <div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(totalEvening)} L</b></div>
          <div><span>{publicLanguage.t('milkTotal')}</span><b>{liters(totalVolume)} L</b></div>
          <div><span>{publicLanguage.t('ifishiValid')}</span><b>{liters(validVolume)} L</b></div>
          <div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(lostVolume)} L</b></div>
        </div>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiPersistedRecords')}</span><h2>{selectedFarmer?.name || ifishiMonth}</h2></div><span className="count-label">{monthlyRows.length} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        {monthlyRows.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('dashboardMorning')}</th><th>{publicLanguage.t('dashboardEvening')}</th><th>{publicLanguage.t('ifishiOriginal')}</th><th>{publicLanguage.t('ifishiValid')}</th><th>{publicLanguage.t('ifishiLost')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th></tr></thead><tbody>{monthlyRows.map((record) => <tr key={record.id}><td>{String(record.date).slice(0, 10)}</td><td>{liters(Number(record.volumeMorning || 0))} L</td><td>{liters(Number(record.volumeEvening || 0))} L</td><td>{liters(Number(record.originalVolumeLiters ?? (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))))} L</td><td>{liters(Number(record.validVolumeLiters ?? (Number(record.volumeMorning || 0) + Number(record.volumeEvening || 0))))} L</td><td>{liters(Number(record.lostVolumeLiters || 0))} L</td><td>{record.status}</td><td>{record.adjustmentReason || '—'}</td></tr>)}</tbody></table></div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('ifishiNoPersistedRecords')}</b></div>}
      </section>
    </div>;
  };

  const renderDashboard = () => {
    const currentDate = new Date(`${collectionDate}T00:00:00`);
    const dateLabel = currentDate.toLocaleDateString(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const periodStart = report?.rangeStart?.slice(8, 10);
    const periodEnd = report?.rangeEnd?.slice(8, 10);
    const periodMonth = report?.rangeStart
      ? new Date(`${report.rangeStart}T00:00:00`).toLocaleDateString(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { month: 'long', year: 'numeric' })
      : null;
    const centerNames = dailyCenters.length ? dailyCenters : dailyCenter ? [dailyCenter] : [];
    const centerLabel = centerNames.length ? centerNames.join(', ') : publicLanguage.t('dashboardNoCenter');
    const recentRows = daily.filter((row) => row.recordId && row.totalVolume > 0).slice(0, 6);
    const quickActions = [
      { id: 'milk' as Tab, label: publicLanguage.t('dashboardEnterMilk'), icon: Milk },
      { id: 'farmers' as Tab, label: accountCopy('navFarmers', 'navAbacunda'), icon: Users },
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
          <button type="button" className="panel dashboard-subscription" onClick={() => setTab('billing')}><span><span className="eyebrow">{publicLanguage.t('dashboardSubscription')}</span><b>{billing?.subscription?.effective_status || billing?.subscription?.status || '—'}</b></span><ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      </section>
    </div>;
  };

  const renderDeductions = () => {
    const deductionData = deductionRows?.data || [];
    return <div className="screen-grid deductions-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('deductionsRecord')}</h2></div><CircleDollarSign size={20} aria-hidden="true" /></div>
        <form className="form-stack compact" onSubmit={createDeduction}>
          <label>{accountCopy('deductionsSearch', 'milkAbacundaSearch')}<input type="search" placeholder={accountCopy('deductionsSearch', 'milkAbacundaSearch')} value={deductionFarmerSearch} onChange={(event) => { setDeductionFarmerSearch(event.target.value); loadDeductionFarmers(event.target.value).catch((reason) => setError(reason.message)); }} /></label>
          <label>{accountCopy('deductionsFarmer', 'milkAbacunda')}<select required value={deductionForm.farmerId} onChange={(event) => setDeductionForm({ ...deductionForm, farmerId: event.target.value })}><option value="">{accountCopy('deductionsFarmer', 'milkAbacunda')}</option>{deductionFarmers.map((farmer) => <option key={farmer.id} value={farmer.id}>{farmer.name}</option>)}</select></label>
          <label>{publicLanguage.t('deductionsAmount')}<input required type="number" min="0.01" step="0.01" value={deductionForm.amount} onChange={(event) => setDeductionForm({ ...deductionForm, amount: event.target.value })} /></label>
          <label>{publicLanguage.t('deductionsType')}<select value={deductionForm.type} onChange={(event) => setDeductionForm({ ...deductionForm, type: event.target.value })}><option>Advance</option><option>Umwenda</option><option>Other</option></select></label>
          <label>{publicLanguage.t('deductionsDate')}<input type="date" required value={deductionForm.date} onChange={(event) => setDeductionForm({ ...deductionForm, date: event.target.value })} /></label>
          <label>{publicLanguage.t('deductionsReason')}<input value={deductionForm.reason} onChange={(event) => setDeductionForm({ ...deductionForm, reason: event.target.value })} /></label>
          <button className="button button-primary" disabled={busy}>{publicLanguage.t('deductionsRecord')}</button>
        </form>
      </section>
      <section className="panel panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardToday')}</span><h2>{publicLanguage.t('deductionsRecent')}</h2></div></div>
        {deductionRows ? deductionData.length ? <>
          <div className="table-scroll deductions-desktop-table"><table><thead><tr><th>{publicLanguage.t('deductionsDate')}</th><th>{accountCopy('deductionsFarmer', 'milkAbacunda')}</th><th>{publicLanguage.t('deductionsType')}</th><th>{publicLanguage.t('deductionsReason')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('deductionsStatus')}</th></tr></thead><tbody>{deductionData.map((row) => <tr key={row.id}><td>{String(row.date).slice(0, 10)}</td><td>{row.farmerName || row.farmer_name || row.farmerId}</td><td>{row.type}</td><td>{row.reason || '—'}</td><td>{money(row.amount)}</td><td>{row.status}</td></tr>)}</tbody></table></div>
          <div className="deduction-mobile-list">{deductionData.map((row) => <article className="deduction-mobile-card" key={row.id}><header><div><b>{row.farmerName || row.farmer_name || row.farmerId}</b><small>{String(row.date).slice(0, 10)} · {row.type}</small></div><strong>{money(row.amount)} RWF</strong></header><p>{row.reason || '—'}</p><span className="milk-entry-state saved">{row.status}</span></article>)}</div>
        </> : <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><CircleDollarSign size={21} aria-hidden="true" /></span><b>{publicLanguage.t('deductionsEmptyTitle')}</b></div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
        {deductionRows?.hasMore ? <div className="panel-footer"><button className="button button-secondary" onClick={() => loadDeductions(deductionRows.nextCursor, true)}>{publicLanguage.t('deductionsLoadOlder')} <ChevronDown size={16} /></button></div> : null}
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
    const settlementRows = isDairy ? ukweziReport?.collectorSettlementRows || [] : ukweziReport?.farmerPayments || [];
    const ownerRow = ukweziReport?.ownerSettlementRow || null;
    const actualVolume = ukweziReport?.ownerGeneratedVolume ?? ukweziReport?.totalVolume ?? 0;
    const ownerGross = isCollector && ukweziReport?.collectorIsReconciled === null
      ? null
      : ukweziReport?.ownerGeneratedGross ?? ukweziReport?.totalRevenueMonth ?? 0;
    const assignedVolume = ukweziReport?.collectorFarmersValidLiters ?? ukweziReport?.totalVolume ?? 0;
    const payable = isCollector ? ukweziReport?.collectorPayable : ukweziReport?.netRevenueMonth;
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
    const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { month: 'long' }).format(new Date(Date.UTC(2026, index, 1))));
    const ukweziPdfParams = new URLSearchParams({ month: ukweziMonth, year: ukweziYear, periodType: ukweziPeriod });
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
          <button type="button" className="button button-secondary" onClick={() => run(loadUkwezi)}>{publicLanguage.t('reportsRefresh')}</button>
          <a className="button button-secondary" href={`/api/ukwezi/pdf?${ukweziPdfParams}`} target="_blank" rel="noreferrer" aria-label={publicLanguage.t('ukweziDownloadPdf')}><FileBarChart2 size={16} aria-hidden="true" />{publicLanguage.t('ukweziDownloadPdf')}</a>
        </div>
        {ukweziReport ? <>
          <p className="muted-note">{ukweziReport.rangeStart} – {ukweziReport.rangeEnd}</p>
          <div className="metric-strip ukwezi-totals">
            <div><span>{publicLanguage.t('ukweziOwnerTotal')}</span><b>{liters(actualVolume)} L</b><small>{ownerGross === null ? '—' : `${money(ownerGross)} RWF`}</small></div>
            <div><span>{publicLanguage.t(user?.accountType === 'COLLECTION_CENTER' ? 'navAbacunda' : 'ukweziAllocated')}</span><b>{liters(assignedVolume)} L</b><small>{money(ukweziReport.totalRevenueMonth)} RWF</small></div>
            <div><span>{publicLanguage.t('dashboardDeductions')}</span><b>{money(ukweziReport.totalDeductionsMonth)} RWF</b></div>
            {isCollector ? <div><span>{publicLanguage.t('reportsTransport')}</span><b>{money(ukweziReport.collectorFarmerTransport || 0)} RWF</b></div> : null}
            <div><span>{publicLanguage.t('ukweziPayable')}</span><b>{payable === null || payable === undefined ? '—' : `${money(payable)} RWF`}</b></div>
          </div>
          {isCollector ? <section className="settlement-reconciliation" role="status">
            <b>{ukweziReport.collectorIsReconciled ? publicLanguage.t('ukweziReconciled') : publicLanguage.t('ukweziReconciliationPending')}</b>
            {ukweziReport.collectorIsReconciled === null
              ? <span>{publicLanguage.t('collectorPriceMissing')}</span>
              : <span>{publicLanguage.t('ukweziBreakdown')}: {money(ukweziReport.collectorSurplusAmount || 0)} + {money(ukweziReport.collectorFarmerDeductions || 0)} + {money(ukweziReport.collectorFarmerTransport || 0)} = {ukweziReport.collectorPayableFromBreakdown == null ? '—' : `${money(ukweziReport.collectorPayableFromBreakdown)} RWF`}</span>}
          </section> : null}
          {settlementRows.length || ownerRow ? <><div className="table-scroll ukwezi-settlement-table"><table><thead><tr><th>No</th><th>{publicLanguage.t(isDairy ? 'assignedCollectors' : 'milkFarmer')}</th>{isDairy ? <th>{publicLanguage.t('navAbacunda')}</th> : <th>{publicLanguage.t('accountNationalId')}</th>}<th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{publicLanguage.t('reportsVolume')}</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('reportsGross')}</th>{isCollector ? <th>{publicLanguage.t('reportsTransport')}</th> : null}<th>{publicLanguage.t('dashboardDeductions')}</th><th>{publicLanguage.t('reportsNet')}</th></tr></thead><tbody>
            {settlementRows.map((row: any, index: number) => <tr key={`${isDairy ? 'collector' : 'farmer'}-${isDairy ? row.collectorUserId : row.farmerId}`}><td>{index + 1}</td><td>{isDairy ? row.name : row.farmerName}</td>{isDairy ? <td>{row.assignedFarmerCount}</td> : <td>{row.nationalId || row.idNumber || '—'}</td>}<td>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(row.totalVolume)} L</td><td>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</td><td>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</td>{isCollector ? <td>{money(row.totalTransport)} RWF</td> : null}<td>{money(row.totalDeductions)} RWF</td><td>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</td></tr>)}
            {ownerRow ? <tr className="owner-settlement-row"><td>{settlementRows.length + 1}</td><td><b>{ownerRow.farmerName}</b><small className="block-muted">{publicLanguage.t('ukweziOwnerRow')}</small></td><td>{ownerRow.nationalId || ownerRow.idNumber || '—'}</td><td>{[ownerRow.phone, ownerRow.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(ownerRow.totalVolume)} L</td><td>{ownerRow.pricePerLiter == null ? '—' : `${money(ownerRow.pricePerLiter)} RWF`}</td><td>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</td>{isCollector ? <td>{money(ownerRow.totalTransport)} RWF</td> : null}<td>{money(ownerRow.totalDeductions)} RWF</td><td>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</td></tr> : null}
          </tbody></table></div><div className="ukwezi-mobile-list">{settlementRows.map((row: any) => <article className="ukwezi-mobile-card" key={`mobile-${isDairy ? row.collectorUserId : row.farmerId}`}><header><b>{isDairy ? row.name : row.farmerName}</b><strong>{liters(row.totalVolume)} L</strong></header><dl>{isDairy ? <div><dt>{publicLanguage.t('navAbacunda')}</dt><dd>{row.assignedFarmerCount}</dd></div> : <div><dt>{publicLanguage.t('accountNationalId')}</dt><dd>{row.nationalId || row.idNumber || '—'}</dd></div>}<div><dt>{publicLanguage.t('milkPrice')} / L</dt><dd>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</dd></div><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(row.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(row.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</dd></div></dl><p>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</p></article>)}{ownerRow ? <article className="ukwezi-mobile-card owner-settlement-row"><header><b>{ownerRow.farmerName} · {publicLanguage.t('ukweziOwnerRow')}</b><strong>{liters(ownerRow.totalVolume)} L</strong></header><dl><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(ownerRow.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(ownerRow.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</dd></div></dl></article> : null}</div></> : null}
          {lossRows.length ? <section className="ukwezi-loss-reconciliation"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiLost')}</span><h3>{publicLanguage.t('ukweziLossReconciliation')}</h3></div></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('ifishiOriginal')}</th><th>{publicLanguage.t('ifishiValid')}</th><th>{publicLanguage.t('ifishiLost')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('when')}</th></tr></thead><tbody>{lossRows.map((row) => <tr key={row.key}><td>{row.date}</td><td>{row.source}</td><td>{liters(row.original)} L</td><td>{liters(row.valid)} L</td><td>{liters(row.lost)} L</td><td>{row.status}</td><td>{row.reason || '—'}</td><td>{row.actor || '—'}</td><td>{row.when ? new Date(row.when).toLocaleString() : '—'}</td></tr>)}</tbody></table></div></section> : null}
        </> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
      </section>
    </div>;
  };

  const renderTransport = () => <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navTransport')}</span><h2>{publicLanguage.t('collectorTransportTitle')}</h2></div><Truck size={20} aria-hidden="true" /></div>
    <div className="toolbar ukwezi-period-controls">
      <label>{publicLanguage.t('ukweziMonth')}<select value={ukweziMonth} onChange={(event) => setUkweziMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1).padStart(2, '0')}>{new Intl.DateTimeFormat(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { month: 'long' }).format(new Date(Date.UTC(2026, index, 1)))}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziYear')}<select value={ukweziYear} onChange={(event) => setUkweziYear(event.target.value)}>{Array.from({ length: new Date().getFullYear() - 1999 }, (_, index) => String(new Date().getFullYear() - index)).map((year) => <option key={year}>{year}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziPeriod')}<select value={ukweziPeriod} onChange={(event) => setUkweziPeriod(event.target.value as 'first-half' | 'second-half')}><option value="first-half">1–15</option><option value="second-half">16–{new Date(Number(ukweziYear), Number(ukweziMonth), 0).getDate()}</option></select></label>
    </div>
    {ukweziReport ? <div className="metric-strip"><div><span>{publicLanguage.t('collectorTransportPayable')}</span><b>{money(ukweziReport.collectorFarmerTransport || 0)} RWF</b></div><div><span>{publicLanguage.t('ukweziOwnerTotal')}</span><b>{ukweziReport.ownerGeneratedGross == null ? '—' : `${money(ukweziReport.ownerGeneratedGross)} RWF`}</b></div></div> : null}
    <p className="muted-note">{publicLanguage.t('collectorTransportRule')}</p>
  </section>;

  const renderAccountSettings = () => (
    <div className="account-settings-view">
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
      <section className="panel account-settings-overview">
        <div className="panel-heading">
          <div><span className="eyebrow">{publicLanguage.t('accountSettings')}</span><h2>{publicLanguage.t('accountProfile')}</h2></div>
          <UserRound size={20} aria-hidden="true" />
        </div>
        {accountProfile ? <div className="account-settings-summary">
          <div><span>{publicLanguage.t('accountTypeLabel')}</span><strong>{accountProfile.accountType === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : accountProfile.role === 'super_admin' ? publicLanguage.t('platformAdmin') : publicLanguage.t('collector')}</strong></div>
          <div><span>{publicLanguage.t('accountStatusLabel')}</span><strong className={`status-text status-${accountProfile.accountStatus}`}>{publicLanguage.t(accountStatusCopy[accountProfile.accountStatus as keyof typeof accountStatusCopy] || 'statusNone')}</strong></div>
          <div><span>{publicLanguage.t('email')}</span><strong>{accountProfile.email}</strong></div>
          <div><span>{publicLanguage.t('emailVerificationStatus')}</span><strong>{accountProfile.emailVerified ? publicLanguage.t('emailVerifiedValue') : publicLanguage.t('emailNotVerifiedValue')}</strong></div>
          {billing?.subscription ? <div><span>{publicLanguage.t('navSubscription')}</span><strong>{billing.subscription.effective_status || billing.subscription.status}</strong></div> : null}
        </div> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('accountLoading')}</div>}
        <div className="account-settings-quick-actions">
          <div className="language-setting"><span>{publicLanguage.t('accountLanguage')}</span><div className="public-language-switch" role="group" aria-label={publicLanguage.t('languageLabel')}>
            <button type="button" aria-label={publicLanguage.t('languageKinyarwanda')} aria-pressed={publicLanguage.language === 'rw'} onClick={() => publicLanguage.setLanguage('rw')}>RW</button>
            <button type="button" aria-label={publicLanguage.t('languageEnglish')} aria-pressed={publicLanguage.language === 'en'} onClick={() => publicLanguage.setLanguage('en')}>EN</button>
          </div></div>
          {!isAdmin ? <button type="button" className="button button-secondary" onClick={() => setTab('billing')}>{publicLanguage.t('accountOpenBilling')}<ArrowRight size={16} aria-hidden="true" /></button> : null}
        </div>
      </section>

      <section className="panel panel-wide account-settings-profile">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountProfile')}</span><h2>{publicLanguage.t('accountProfileDescription')}</h2></div></div>
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
        </form> : null}
      </section>

      <section className="panel account-settings-security">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountSecurity')}</span><h2>{publicLanguage.t('accountChangePassword')}</h2></div><Shield size={20} aria-hidden="true" /></div>
        <form className="form-stack compact" onSubmit={changeAccountPassword}>
          <label>{publicLanguage.t('accountCurrentPassword')}<span className="password-field"><input type={accountPasswordVisible ? 'text' : 'password'} autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisible ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisible} onClick={() => setAccountPasswordVisible((visible) => !visible)}>{accountPasswordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          <label>{publicLanguage.t('accountNewPassword')}<span className="password-field"><input type={accountPasswordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisible ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisible} onClick={() => setAccountPasswordVisible((visible) => !visible)}>{accountPasswordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          <label>{publicLanguage.t('accountConfirmPassword')}<span className="password-field"><input type={accountPasswordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={confirmAccountPassword} onChange={(event) => setConfirmAccountPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={accountPasswordVisible ? publicLanguage.t('hidePassword') : publicLanguage.t('showPassword')} aria-pressed={accountPasswordVisible} onClick={() => setAccountPasswordVisible((visible) => !visible)}>{accountPasswordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          <button className="button button-primary" disabled={busy}>{publicLanguage.t('accountChangePassword')}<ArrowRight size={16} aria-hidden="true" /></button>
        </form>
      </section>
    </div>
  );

  const renderBilling = () => {
    const isCollectionCenterAccount = billing?.account?.accountType === 'COLLECTION_CENTER';
    const pricing = billing?.pricing;
    const payment = billing?.paymentConfiguration as PaymentConfiguration | undefined;
    return <div className="subscription-layout">
      <section className="panel subscription-overview">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountStatus')}</span><h2>{publicLanguage.t('navSubscription')}</h2></div><ClipboardList size={20} aria-hidden="true" /></div>
        <div className="subscription-state"><span className={`status-dot status-${billing?.subscription?.effective_status || billing?.subscription?.status || 'pending'}`} />{billing?.subscription?.effective_status || billing?.subscription?.status || publicLanguage.t('subscriptionNoAccount')}</div>
        {!isCollectionCenterAccount && billing?.usage ? <div className="subscription-usage"><div><span>{publicLanguage.t('subscriptionActualUsage')}</span><b>{liters(billing.usage.actualLiters)} L</b></div><div><span>{publicLanguage.t('subscriptionEstimatedUsage')}</span><b>{liters(pricing?.estimatedMonthlyLiters ?? billing.usage.projectedMonthlyLiters)} L</b></div></div> : null}
        <div className="subscription-calculated">
          <span className="eyebrow">{publicLanguage.t(isCollectionCenterAccount ? 'subscriptionFixedMonthly' : 'subscriptionCalculatedAmount')}</span>
          {pricing ? <><strong>{money(pricing.amount)} <small>{pricing.currency}</small></strong><span>{pricing.planName}</span></> : <p>{publicLanguage.t('subscriptionUnavailable')}</p>}
        </div>
        <label className="field-block">{publicLanguage.t('subscriptionBillingPeriod')}<select value={billingPeriod} onChange={(event) => { setBilling(null); setBillingPeriod(event.target.value as typeof billingPeriod); }}><option value="monthly">{publicLanguage.t('billingMonthly')}</option><option value="6_months">{publicLanguage.t('billingSixMonths')}</option><option value="yearly">{publicLanguage.t('billingYearly')}</option></select></label>
        <label className="field-block">{publicLanguage.t('subscriptionSavedPhone')}<input inputMode="tel" value={paymentPhone} readOnly aria-readonly="true" /></label>
        <div className="payment-method-details">
          <div><span>{publicLanguage.t('billingPaymentProvider')}</span><b>{payment?.displayName || 'MTN MoMo Rwanda'} · {payment?.paymentMethod || 'MTN_MOMO_RWA'}</b></div>
          <div><span>{publicLanguage.t('billingPaymentPayer')}:</span>{' '}<b>{user.name || user.email}</b></div>
          <p className="muted-note">{publicLanguage.t('billingPaymentInstruction')}</p>
          {payment && !payment.ready ? <p className="form-error" role="status">{publicLanguage.t('billingPaymentUnavailable')}</p> : null}
        </div>
        <button type="button" className="dashboard-text-link billing-phone-settings" onClick={() => setTab('settings')}>{publicLanguage.t('accountSettings')} <ArrowRight size={14} aria-hidden="true" /></button>
        {!paymentPhone ? <p className="form-error" role="status">{publicLanguage.t('billingPhoneMissing')}</p> : null}
        <button type="button" className="button button-primary subscription-pay" onClick={() => paySubscription()} disabled={busy || !pricing || !payment?.ready || !paymentPhone}>{publicLanguage.t('subscriptionPay')} <ArrowRight size={17} aria-hidden="true" /></button>
      </section>
      <section className="panel panel-wide subscription-history">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('subscriptionPaymentHistory')}</h2></div></div>
        {billing?.payments?.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('paymentDate')}</th><th>{publicLanguage.t('paymentPlan')}</th><th>{publicLanguage.t('billingPaymentProvider')}</th><th>{publicLanguage.t('paymentReference')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('paymentStatus')}</th><th /></tr></thead><tbody>{billing.payments.map((payment: any) => <tr key={payment.id}><td>{String(payment.created_at).slice(0, 10)}</td><td>{payment.plan_name || payment.plan_code}</td><td>{payment.payment_method === 'MTN_MOMO_RWA' || payment.provider === 'mtn_momo' ? 'MTN MoMo Rwanda' : payment.payment_method}</td><td><span>{payment.provider_reference}</span>{payment.provider_transaction_id ? <small className="block-muted">{payment.provider_transaction_id}</small> : null}</td><td>{money(payment.amount)} {payment.currency}</td><td>{payment.status}</td><td>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkCustomerPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</td></tr>)}</tbody></table></div> : <div className="subscription-history-empty"><ClipboardList size={20} aria-hidden="true" /><p>{publicLanguage.t('subscriptionNoHistory')}</p></div>}
      </section>
    </div>;
  };

  const renderNotifications = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('alertsInbox')}</span><h2>{publicLanguage.t('navAlerts')}</h2></div><button className="button button-secondary" onClick={() => run(async () => { await api('/api/notifications/read-all', { method: 'PATCH' }); await loadNotifications(); })}>{publicLanguage.t('markAllRead')}</button></div><div className="notice-list">{notifications.map((item) => <article className={`notice-row${item.isRead ? '' : ' unread'}`} key={item.id}><div><span className="eyebrow">{item.notification_type.replaceAll('_', ' ')}</span><h3>{item.title}</h3><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div>{!item.isRead ? <button className="button button-secondary small-button" onClick={() => markRead(item)}>{publicLanguage.t('markRead')}</button> : <Check size={17} />}</article>)}{!notifications.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Bell size={21} aria-hidden="true" /></span><b>{publicLanguage.t('notificationsEmptyTitle')}</b></div> : null}</div></section>;

  const renderAdminAccounts = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('platform')}</span><h2>{publicLanguage.t('customerAccounts')}</h2></div><span className="count-label">{accounts ? `${accounts.total} ${publicLanguage.t('accountsCount')}` : '…'}</span></div><div className="toolbar"><form className="search-form" onSubmit={(event) => { event.preventDefault(); loadAccounts(); }}><Search size={17} /><input placeholder={publicLanguage.t('searchNameEmail')} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form><select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}><option value="">{publicLanguage.t('allStatuses')}</option>{Object.keys(accountStatusCopy).map((status) => <option key={status} value={status}>{publicLanguage.t(accountStatusCopy[status as keyof typeof accountStatusCopy])}</option>)}</select></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('accountType')}</th><th>{publicLanguage.t('status')}</th><th>{publicLanguage.t('farmers')}</th><th>{publicLanguage.t('navCenters')}</th><th>{publicLanguage.t('actions')}</th></tr></thead><tbody>{accounts?.accounts.map((account) => <tr key={account.user_id}><td><b>{account.account_name}</b><small className="block-muted">{account.account_email}</small></td><td>{account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}</td><td>{publicLanguage.t(accountStatusCopy[(account.effective_status || account.account_status) as keyof typeof accountStatusCopy] || 'statusActive')}</td><td>{account.farmer_count}</td><td>{account.center_count}</td><td className="actions-cell"><button className="text-button" onClick={() => adminAction(account, 'activate')}>{publicLanguage.t('activate')}</button><button className="text-button" onClick={() => adminAction(account, 'grant-trial')}>{publicLanguage.t('grantTrial')}</button><button className="text-button" onClick={() => adminAction(account, account.account_status === 'suspended' ? 'reactivate' : 'suspend')}>{publicLanguage.t(account.account_status === 'suspended' ? 'reactivate' : 'suspend')}</button></td></tr>)}</tbody></table></div></section>;

  const renderAdminAudit = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('auditSecurity')}</span><h2>{publicLanguage.t('auditLog')}</h2></div><span className="count-label">{auditRows?.total ?? '…'} {publicLanguage.t('events')}</span></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('when')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('entity')}</th><th>{publicLanguage.t('actions')}</th><th>{publicLanguage.t('details')}</th></tr></thead><tbody>{(auditRows?.items || []).map((row: any) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.actor_name || row.changed_by || 'System'}</td><td>{row.entity_type} #{row.entity_id}</td><td>{row.action}</td><td><code>{JSON.stringify(row.details || {})}</code></td></tr>)}</tbody></table></div></section>;

  const renderAdminConfig = () => <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('centerPlan')}</h2></div><CircleDollarSign size={20} /></div><div className="config-callout">{centerPricing?.plan?.name || 'Collection Center Monthly'} · {money(centerPricing?.plan?.price || centerPricing?.config?.monthly_amount || 0)} RWF</div><form className="form-stack compact config-form" onSubmit={(event) => { event.preventDefault(); run(async () => { const formData = new FormData(event.currentTarget); await api('/api/admin/config/collection-center', json('PUT', { monthlyAmount: Number(formData.get('amount')), firstVolumeBoundaryLiters: Number(formData.get('boundary')) })); const updated = await api('/api/admin/config/collection-center'); setCenterPricing(updated); setNotice(publicLanguage.t('pricingSaved')); }); }}><label>{publicLanguage.t('monthlyAmount')}<input name="amount" type="number" min="0" defaultValue={centerPricing?.config?.monthly_amount || centerPricing?.plan?.price || 30000} /></label><label>{publicLanguage.t('firstVolumeBoundary')}<input name="boundary" type="number" min="0" defaultValue={centerPricing?.config?.first_volume_boundary_liters || 50000} /></label><button className="button button-primary" disabled={busy}>{publicLanguage.t('savePricing')}</button></form></section>;

  const activeTabs = visibleTabs;
  const renderAdminDashboard = () => {
    const stats = adminSummary?.accounts;
    const metrics = [
      { label: publicLanguage.t('adminTotalAccounts'), value: stats?.total_accounts },
      { label: publicLanguage.t('adminNoSubscription'), value: stats?.without_subscription },
      { label: publicLanguage.t('adminActiveAccounts'), value: stats?.active },
      { label: publicLanguage.t('adminTrialAccounts'), value: stats?.trial },
      { label: publicLanguage.t('adminPendingAccounts'), value: stats?.pending },
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
  const renderAdminCollectorPricing = () => <section className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('adminCollectorPricing')}</h2></div><CircleDollarSign size={20} aria-hidden="true" /></div>
    <p className="muted-note">{publicLanguage.t('adminPriceContractNote')}</p>
    {subscriptionPlans.length ? <><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('adminCollectorVolume')}</th><th>{publicLanguage.t('adminMonthlyPrice')}</th><th>{publicLanguage.t('adminPlanStatus')}</th></tr></thead><tbody>
      {subscriptionPlans.map((plan) => {
        const minimum = Number(plan.min_volume_liters || 0);
        const range = plan.max_volume_liters === null
          ? `${liters(minimum)}+ L`
          : `${liters(minimum)}–${liters(Number(plan.max_volume_liters))} L`;
        return <tr key={plan.id}><td>{range}</td><td><input aria-label={`${plan.name} ${publicLanguage.t('adminMonthlyPrice')}`} type="number" min="1" step="1" value={collectorTierEdits[plan.code] ?? String(plan.price)} onChange={(event) => setCollectorTierEdits({ ...collectorTierEdits, [plan.code]: event.target.value })} /> {plan.currency}</td><td>{publicLanguage.t(plan.is_active ? 'statusActive' : 'statusSuspended')}</td></tr>;
      })}
    </tbody></table></div><div className="panel-footer"><button type="button" className="button button-primary" onClick={() => { void saveAdminCollectorPrices(); }} disabled={busy}>{publicLanguage.t('adminSaveCollectorPrices')}</button></div></> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('adminPlansMissing')}</b></div>}
  </section>;

  const renderAdminPaymentConfiguration = () => <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('adminPaymentSettings')}</h2></div><Wallet size={20} aria-hidden="true" /></div>
    <div className="config-callout">{paymentConfiguration?.displayName || 'MTN MoMo Rwanda'} · {paymentConfiguration?.paymentMethod || 'MTN_MOMO_RWA'} · {paymentConfiguration?.currency || 'RWF'}</div>
    <dl className="payment-readiness-list">
      <div><dt>{publicLanguage.t('adminPaymentReadiness')}</dt><dd>{paymentConfiguration?.ready ? publicLanguage.t('adminPaymentReady') : publicLanguage.t('adminPaymentNotReady')}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentEnabled')}</dt><dd>{paymentConfiguration?.realPaymentsEnabled ? publicLanguage.t('statusActive') : publicLanguage.t('statusSuspended')}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentCredentials')}</dt><dd>{paymentConfiguration?.credentialsConfigured ? publicLanguage.t('statusActive') : publicLanguage.t('statusSuspended')}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentApi')}</dt><dd>{paymentConfiguration?.apiConfigured ? publicLanguage.t('statusActive') : publicLanguage.t('statusSuspended')}</dd></div>
      <div><dt>{publicLanguage.t('adminPaymentCallback')}</dt><dd>{paymentConfiguration?.callbackConfigured ? publicLanguage.t('statusActive') : publicLanguage.t('statusSuspended')}</dd></div>
    </dl>
    <p className="muted-note">{publicLanguage.t('adminPaymentUserPayer')}</p>
    <p className="muted-note">{publicLanguage.t('adminPaymentSettlement')}</p>
    <p className="muted-note">{publicLanguage.t('adminPaymentSecrets')}</p>
  </section>;

  const renderAdminPayments = () => <section className="panel panel-wide">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('adminPaymentHistory')}</h2></div><button type="button" className="button button-secondary" onClick={() => loadAdminPayments().catch((reason) => setError(reason.message))}>{publicLanguage.t('reportsRefresh')}</button></div>
    {adminPayments.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('paymentPlan')}</th><th>{publicLanguage.t('subscriptionBillingPeriod')}</th><th>{publicLanguage.t('billingPaymentProvider')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('paymentReconciliation')}</th><th>{publicLanguage.t('paymentDate')}</th><th>{publicLanguage.t('paymentReference')}</th><th>{publicLanguage.t('paymentTransaction')}</th><th /></tr></thead><tbody>{adminPayments.map((payment) => <tr key={payment.id}><td><b>{payment.account_name}</b><small className="block-muted">{payment.account_email}</small></td><td>{payment.plan_name || '—'}</td><td>{payment.billing_period}</td><td>{payment.payment_method}</td><td>{money(payment.amount)} {payment.currency}</td><td>{payment.status} · {payment.subscription_status}</td><td>{payment.status === 'SUCCESS' && payment.provider_transaction_id ? publicLanguage.t('paymentProviderConfirmed') : payment.status === 'PENDING' ? publicLanguage.t('paymentAwaitingConfirmation') : '—'}</td><td>{String(payment.completed_at || payment.created_at).slice(0, 10)}</td><td>{payment.provider_reference}</td><td>{payment.provider_transaction_id || '—'}</td><td>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkAdminPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</td></tr>)}</tbody></table></div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('subscriptionNoHistory')}</b></div>}
  </section>;

  const activeTab = activeTabs.find((item) => item.id === tab) || activeTabs[0];
  const activeTabLabel = tab === 'transport' ? publicLanguage.t('navTransport') : activeTab?.label || 'Workspace';

  return (
    <main className="workspace-shell">
      <header className="topbar"><BrandLockup className="topbar-brand" imageSize={34} /><div className="topbar-right"><span className={`account-tag${online ? '' : ' offline-tag'}`}><span className={`status-dot${online ? '' : ' offline-dot'}`} />{online ? isAdmin ? publicLanguage.t('platformAdmin') : user.accountType.replace('_', ' ') : `Offline · ${pendingWrites} queued`}</span><button type="button" className="user-name user-settings-shortcut" onClick={() => setTab('settings')} title={publicLanguage.t('accountSettings')} aria-label={`${publicLanguage.t('accountSettings')}: ${user.name || user.email}`}><UserRound size={16} aria-hidden="true" /><span>{user.name || user.email}</span></button><button className="icon-button" onClick={logout} aria-label={publicLanguage.t('signOut')} title={publicLanguage.t('signOut')}><LogOut size={18} /></button></div></header>
      <div className="workspace-body"><aside className="sidebar"><div className="sidebar-label">{publicLanguage.t('workspace')}</div><nav>{activeTabs.map((item) => { const Icon = item.icon; return <button className={`nav-item${tab === item.id ? ' active' : ''}`} key={item.id} onClick={() => setTab(item.id)}><Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{tab === item.id ? <span className="nav-mark" /> : null}</button>; })}</nav><div className="sidebar-foot"><Activity size={15} /><span>{publicLanguage.t('systemOnline')}</span></div></aside>
      <section className="content-area"><div className="content-heading"><div><span className="eyebrow">{isAdmin ? publicLanguage.t('platformAdmin') : 'MILK SYSTEM'}</span><h1>{activeTabLabel}</h1></div><span className="date-stamp">{new Date().toLocaleDateString(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
        {error ? <div className="toast toast-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        {notice ? <div className="toast toast-success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        {tab === 'dashboard' && isAdmin ? renderAdminDashboard() : null}
        {tab === 'dashboard' && !isAdmin ? renderDashboard() : null}
        {tab === 'farmers' && !isAdmin && isDairy ? renderAbacundaDirectory() : null}
        {tab === 'farmers' && !isAdmin && !isDairy ? renderFarmers() : null}
        {tab === 'centers' && !isAdmin ? renderCenters() : null}
        {tab === 'milk' && !isAdmin ? renderMilk() : null}
        {tab === 'deductions' && !isAdmin ? renderDeductions() : null}
        {tab === 'transport' && !isAdmin && isCollector ? renderTransport() : null}
        {tab === 'ukwezi' && !isAdmin ? renderUkwezi() : null}
        {tab === 'reports' && !isAdmin ? renderReports() : null}
        {tab === 'billing' && !isAdmin ? renderBilling() : null}
        {tab === 'notifications' && !isAdmin ? renderNotifications() : null}
        {tab === 'settings' ? renderAccountSettings() : null}
        {tab === 'accounts' && isAdmin ? renderAdminAccounts() : null}
        {tab === 'audit' && isAdmin ? renderAdminAudit() : null}
        {tab === 'config' && isAdmin ? <>{renderAdminCollectorPricing()}{renderAdminPaymentConfiguration()}{renderAdminPayments()}{renderAdminConfig()}</> : null}
      </section></div>
      <nav className="mobile-nav" aria-label="Workspace navigation">
        {mobilePrimaryTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}
        {mobileMoreTabs.length ? <button type="button" className={`mobile-more-trigger${mobileMoreTabs.some((item) => item.id === tab) ? ' active' : ''}`} aria-controls="mobile-more-menu" aria-expanded={mobileMoreOpen} aria-label={publicLanguage.t('more')} onClick={() => setMobileMoreOpen((open) => !open)}><ChevronDown size={18} /><span>{publicLanguage.t('more')}</span></button> : null}
      </nav>
      {mobileMoreOpen && mobileMoreTabs.length ? <div className="mobile-more-menu" id="mobile-more-menu" aria-label="More workspace sections">
        {mobileMoreTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setMobileMoreOpen(false); }}><Icon size={18} /><span>{item.label}</span></button>; })}
      </div> : null}
    </main>
  );
}
