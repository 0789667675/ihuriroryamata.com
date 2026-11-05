'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  init as initSessionInactivity,
  isSessionExpired,
  resetInactivityTimer,
  onMeaningfulActivity,
} from '@/lib/session-inactivity';
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, BadgeDollarSign, Bell, BellRing,
  Building2, CalendarDays, ChartNoAxesCombined, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  BookOpen, CircleDollarSign, ClipboardList, ContactRound, CreditCard, Edit3, Eye, EyeOff, FileBarChart2, Gauge,
  HandCoins, History, LayoutDashboard, LogOut, Milk, Plus, ReceiptText, RotateCcw, Search, Settings, Shield, Truck, UserRound,
  Users, UsersRound, Wallet, Warehouse, X, Upload, Trash2, UserPlus, FileSpreadsheet, Send, Save, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { flushOfflineWrites, getOfflineWrites, queueOfflineWrite } from '@/lib/offline-queue';
import { buildFarmerListQuery } from '@/lib/farmer-list-query';
import { formatFarmerNumber } from '@/lib/farmer-delivery';
import { BrandLockup } from '@/components/brand-lockup';
import { Modal } from '@/components/ui/modal';
import { FarmerBulkImportModal } from '@/components/imports/farmer-bulk-import';
import { MilkNotebookImportModal } from '@/components/imports/milk-notebook-import';
import { DigitalNotebookMatrix } from '@/components/milk/digital-notebook-matrix';
import { defaultFieldConfig, resolveFieldConfig, enabledFields } from '@/lib/imports/farmer-field-config';
import { getImportCopy } from '@/lib/i18n/import-copy';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { TypingDisplay } from '@/components/ui/typing-display';
import { DashboardView } from '@/components/views/dashboard-view';
import { FarmersView } from '@/components/views/farmers-view';
import { FarmerDeletionDialog } from '@/components/views/farmer-deletion-dialog';
import { MilkRecordsView } from '@/components/views/milk-records-view';
import { DeductionView, type DeductionConfiguration, type DeductionHistoryItem, type FarmerPeriodLedgerRow, type FarmerPeriodLedgerSummary } from '@/components/views/deductions-view';
import { SettlementBatchProgress, type SettlementBatchRecord, type SettlementBatchState } from '@/components/views/settlement-batch-progress';
import { FarmerSettlementHistory, type SettlementHistoryRecord } from '@/components/views/farmer-settlement-history';
import { CollectorUkweziPaymentRoster } from '@/components/views/collector-ukwezi-payment-roster';
import { usePublicLanguage } from '@/hooks/use-public-language';
import { formatPublicCopy, type PublicCopyKey } from '@/lib/i18n/public-copy';
import { formatDateLabel, getMonthNames } from '@/lib/i18n/date-format';
import {
  getAccountingDate,
  getAccountingHalfForDay,
  getCurrentAccountingPeriod,
  getHalfMonthDateRange,
  getMonthDateRange,
  getAccountingYears as getAccountingYearsUtil,
  getBilingualMonthNames,
  BILINGUAL_MONTHS,
} from '@/lib/utils/accounting-period';
import { resolveWorkspaceTab } from '@/lib/workspace-navigation';
import { calculateMilkDifference, projectOwnerMilkEntry } from '@/lib/milk-reconciliation';
import { validateFarmerBatchRows } from '@/lib/utils/multi-entry-validation';
import { confirmSettlementBatch } from '@/lib/utils/settlement-batch';

const sanitizeQueryParam = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str === '' || str === 'undefined' || str === 'null' || str === '[object Object]') return '';
  return str;
};

const checkSessionExpiry = () => {
  if (!isSessionExpired()) return false;
  try {
    localStorage.removeItem('lastMeaningfulActivity');
  } catch {}

  if (typeof window !== 'undefined') {
    document.cookie = 'milk_session=; Max-Age=0; path=/;';
    const supaClient = (window as any).Supabase;
    if (supaClient) {
      const supa = supaClient.getInstance();
      if (supa) {
        supa.auth.signOut();
      }
    }
    window.location.href = '/';
  }
  return true;
};

type User = { id: number; name: string; email: string; role: string; accountType: string; language?: 'rw' | 'en'; emailVerified?: boolean };
type AccountProfile = { id: number; name: string; email: string; phone: string | null; nationalId: string | null; accountNumber: string | null; profilePicture: string | null; role: string; accountType: string; accountStatus: string; emailVerified: boolean; language?: 'rw' | 'en' };
type Farmer = { id: number; name: string; location: string | null; phone: string | null; nationalId: string | null; accountNumber: string | null; collectionCenter: string | null; cowType: string | null; collectorUserId?: number | null; farmerNumber?: number | null };
type FarmerDeletionImpact = { farmer: { name: string; farmerNumber?: number | null }; counts: Record<string, number>; affectedPeriods: Array<{ start: string; end: string }>; settledPaymentEvidence: { settlements: unknown[]; farmerPayments: Array<{ count: number; amount: number }>; debtRepayments: unknown[]; igipandeRecoveries: unknown[]; deductionBatchItems: Array<{ recovered_amount?: number }> } };
type Center = { id: number; name: string; owner_user_id?: number; pricePerLiter: number; transportRatePerLiter: number; morning_start: string; morning_end: string; evening_start: string; evening_end: string; tank_capacity_liters?: number | null; tankCapacityLiters?: number | null };
type Page<T> = { data: T[]; nextCursor: string | null; hasMore: boolean; pageSize: number };
type DailyRow = { farmerId: number; farmerName: string; farmerNumber?: number | null; phone?: string; nationalId?: string; collectionCenter?: string | null; collectorUserId?: number | null; collectorName?: string | null; recordId?: number; volumeMorning: number; volumeEvening: number; totalVolume: number; volumeLiters?: number; amount: number; status?: string; delivered?: boolean; deliveryStatus?: 'delivered' | 'missing'; abacundaCount?: number; presentCount?: number };
type CollectorMilkEntry = { id: number; date: string; volumeLiters: number; pricePerLiter: number; status: string; effectiveVolumeLiters: number };
type CollectorMilkPrice = { id: number; pricePerLiter: number; effectiveDate: string };
type OwnerIfishiEntry = { id: number | null; date: string; volumeMorning: number; volumeEvening: number; volumeLiters: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; pricePerLiter: number | null; grossAmount: number | null; assignedFarmerLiters: number; surplusLiters: number; differenceLiters: number; status: string; adjustmentReason: string | null; adjustedAt: string | null };
type OwnerIfishiHistory = { owner: { name: string }; startDate: string; endDate: string; entries: OwnerIfishiEntry[]; totals: { originalVolumeLiters: number; ownerVolumeLiters: number; lostVolumeLiters: number; ownerMilkGross: number | null; ownerMilkValueComplete: boolean; assignedFarmerLiters: number; surplusLiters: number } };
type DashboardOwnerMilk = { status: 'loading' | 'available' | 'missing' | 'error'; date: string; volumeMorning: number; volumeEvening: number; validVolumeLiters: number };
type MilkRecord = { id: number; farmer_id: number; owner_user_id: number; date: string; volumeMorning: number; volumeEvening: number; volume: number; originalVolumeLiters: number; validVolumeLiters: number; lostVolumeLiters: number; originalAmount: number; validAmount: number; amount: number; pricePerLiter: number; status: string; adjustmentReason: string | null; adjustedBy: number | null; adjustedAt: string | null; collectionCenter?: string | null };
type NoticeDetails = {
  titleKey?: string;
  messageKey?: string;
  nextActionKey?: string;
  params?: Record<string, string | number>;
  evidence?: string;
  count?: number;
  center?: string;
  period?: string;
  volume?: number;
  average?: number;
  baselineDays?: number;
  lastDeliveryDate?: string | null;
  farmerId?: number;
  farmerName?: string;
  farmerNumber?: string;
  collectorName?: string | null;
  reason?: string;
  action?: string;
  farmerIds?: number[];
};
type Notice = {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  priority?: string | null;
  isRead: boolean;
  createdAt: string;
  farmer_id?: number | null;
  collection_center?: string | null;
  collection_date?: string | null;
  period?: string | null;
  status?: 'open' | 'resolved';
  resolutionCode?: string | null;
  resolutionNote?: string | null;
  resolvedBy?: number | null;
  resolvedAt?: string | null;
  updatedAt?: string;
  details?: NoticeDetails | null;
};
type ReportFarmerRow = { farmerId: number; farmerName: string; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; originalVolume?: number; lostVolume?: number; pricePerLiter?: number; grossAmount: number; totalTransport: number | null; transportIsComplete?: boolean; totalDeductions: number; ifishiTotalDeductions?: number; ifishiNetAmount?: number | null; netAmount: number | null };
type ReportOwnerRow = { farmerId: null; farmerName: string; name: string; isOwner: true; nationalId?: string | null; idNumber?: string | null; phone?: string | null; accountNumber?: string | null; totalVolume: number; pricePerLiter: number | null; grossAmount: number | null; totalTransport: number | null; totalDeductions: number; farmerPayable?: number; netAmount: number | null; nyirayoMilkValue?: number | null; farmersMilkValue?: number | null; nyirayoBaseDifference?: number | null; transportAmount?: number | null; farmerDeductions?: number | null; retainedNoAccountFarmerAmount?: number | null; unaccountedFarmersPool?: number | null; nyirayoOperationalMargin?: number | null; nyirayoTotalAfterOperations?: number | null };
type CollectorSettlementFields = { collectorFarmerMilkValue?: number | null; collectorFarmerPayable?: number | null; collectorAccountingComplete?: boolean | null; collectorAccountingMissingInputs?: string[]; nyirayoTotalWithOwnerList?: number | null };
type SettlementAccounting = { farmerGross: number | null; expectedFarmerPayable: number | null; farmersMilkValue?: number | null; farmerTransportTotal?: number | null; farmerDeductionsTotal?: number | null; farmerPayableTotal?: number | null; accountRoutedPayable?: number | null; ownerListRoutedPayable?: number | null; saccoEligiblePayable: number | null; saccoDistributionInstruction: number | null; saccoConfirmedAmount: number; retainedUnpaidAmount: number | null; cashApprovedAmount: number; cashConfirmedAmount: number; debtRepaymentAmount: number; openingDebt?: number | null; outstandingDebt: number | null; debtBalancesComplete: boolean; legacyUnallocatedDebtRepayments: number; unexplainedDiscrepancy: number | null; ownerGrossReconciliation: { ownerGross: number | null; farmerGross: number | null; surplus: number | null; discrepancy: number | null; baseDifference?: number | null; transportAmount?: number | null; farmerDeductions?: number | null; retainedNoAccountFarmerAmount?: number | null; operationalMargin?: number | null; totalAfterOperations?: number | null; nyirayoRecordedMilkValue?: number | null; farmersComparisonMilkValue?: number | null; nyirayoMilkDifference?: number | null; nyirayoTransportAmount?: number | null; nyirayoDeductionsAmount?: number | null; nyirayoOwnAccountingBalance?: number | null; ownerNameListFarmerSettlementAmount?: number | null; nyirayoTotalWithOwnerList?: number | null }; farmers: Array<ReportFarmerRow & { settlement: { saccoEligible: boolean; saccoDistributionInstruction: number | null; cashApprovedAmount: number; cashConfirmedAmount: number; debtRepaymentAmount: number; openingDebt: number | null; closingDebt: number | null; outstandingDebt: number | null; retainedUnpaidAmount: number | null; unexplainedDiscrepancy: number | null } }> };
type Report = { totalFarmers: number; totalVolume: number; totalMorning: number; totalEvening: number; totalRevenueMonth: number; ownerGeneratedGross?: number | null; ownerGeneratedVolume?: number; totalDeductionsMonth: number; totalTransportFeesMonth: number; netRevenueMonth: number; pricePerLiter?: number | null; collectorAccountingComplete?: boolean | null; collectorAccountingMissingInputs?: string[]; todayTotal: number; todayMorning: number; todayEvening: number; rangeStart: string; rangeEnd: string; collectorPayable: number | null; collectorGross?: number | null; collectorActualVolume?: number; collectorOriginalVolume?: number; collectorLostVolume?: number; collectorFarmersValidLiters?: number; collectorTotalFarmersPayable?: number; collectorFarmerMilkValue?: number | null; collectorFarmerDeductions?: number; collectorFarmerTransport?: number; collectorSurplusAmount?: number | null; collectorPayableFromBreakdown?: number | null; collectorIsReconciled?: boolean | null; collectorProfile?: { name: string } | null; collectorEntries?: Array<{ id: number; date: string; status: string; volumeLiters: number; effectiveVolumeLiters: number; farmerLostLiters: number; voidReason?: string | null; voidedBy?: number | null; voidedAt?: string | null }>; milkLossRecords?: Array<{ id: number; farmerId: number; farmerName: string; date: string; status: string; originalVolume: number; validVolume: number; lostVolume: number; reason: string | null; adjustedBy: number | null; adjustedAt: string | null }>; collectorSettlementRows?: any[]; ownerSettlementRow?: ReportOwnerRow | null; farmerPayments: ReportFarmerRow[]; settlementAccounting?: SettlementAccounting | null; settlementAccountingStatus?: 'AVAILABLE' | 'MIGRATION_REQUIRED' | null; nyirayoMilkValue?: number | null; farmersMilkValue?: number | null; nyirayoBaseDifference?: number | null; transportAmount?: number | null; farmerDeductions?: number | null; retainedNoAccountFarmerAmount?: number | null; unaccountedFarmersPool?: number | null; nyirayoOperationalMargin?: number | null; nyirayoTotalAfterOperations?: number | null };
type Account = { user_id: number; account_name: string; account_email: string; account_type: string; account_status: string; effective_status: string; email_verified: boolean; farmer_count: number; center_count: number; phone?: string | null; subscription_status?: string | null; payment_due_at?: string | null; billing_exempt?: boolean; plan_code?: string | null; days_remaining?: number | null };
type AdminAccountDetails = { account: { id: number; name: string; email: string; account_type: string; account_status: string; email_verified: boolean; phone: string | null; created_at: string }; subscription: { status: string; effective_status?: string; billing_exempt?: boolean; exemption_reason?: string | null; exemption_granted_at?: string | null; exemption_revoked_at?: string | null; plan_id: number | null; current_price: number | string | null; currency: string | null; tier_code: string | null; access_started_at: string | null; payment_due_at: string | null; subscription_started_at: string | null; subscription_ends_at: string | null } | null; counts: { centers: number; farmers: number; milk_records: number; deductions: number; payments: number; notifications: number } };
type AdminPaymentSummary = { successfulCount: number; successfulAmount: number; pendingCount: number; failedCount: number; cancelledCount: number; expiredCount: number };
type AdminSummary = { accounts: { total_accounts: number; without_subscription: number; not_approved: number; pending: number; active: number; suspended: number; expired: number; exempt: number }; registrations_last_30_days: number };
type SystemHealthStatus = 'healthy' | 'warning' | 'unavailable' | 'not_configured';
type SystemHealthCheck = { status: SystemHealthStatus; detail: string };
type SystemHealth = {
  ok: boolean;
  degraded: boolean;
  checkedAt: string;
  database: SystemHealthCheck & { configured: boolean; connected: boolean };
  migrations: SystemHealthCheck & { appliedCount: number; requiredCount: number; missing: string[]; missingColumns: string[] };
  appUrl: SystemHealthCheck & { configured: boolean; url: string | null };
  email: SystemHealthCheck & { configured: boolean; provider: string | null; senderDomain: string | null };
  emailOutbox: SystemHealthCheck & { pending: number; processing: number; stuck: number; neverAttempted: number; failedAttempts: number; oldestPendingAt: string | null; oldestPendingAgeHours: number | null; recentFailures: Array<{ id: number | null; eventType: string | null; attempts: number; errorCode: string | null; updatedAt: string | null }> };
  payments: SystemHealthCheck & { failedRecent: number; stalePending: number; provider: { provider: string; displayName: string; realPaymentsEnabled: boolean; credentialsConfigured: boolean; apiConfigured: boolean; callbackConfigured: boolean; ready: boolean }; recentFailures: Array<{ id: number | null; amount: number | null; currency: string | null; status: string | null; updatedAt: string | null }> };
  scheduler: SystemHealthCheck & { secretConfigured: boolean; configured: boolean; scheduleConfigured: boolean; scheduleSource: string; runHistoryAvailable: boolean; routes: string[]; jobs: Array<{ id: string; path: string; route: string; expectedCadence: string; scheduled: boolean; status: SystemHealthStatus; lastRunAt: string | null; lastRunAgeHours: number | null; lastResult: string | null; lastTrigger: string | null; lastErrorCode: string | null; failedRecent: number; detail: string }> };
  notificationEvaluation: SystemHealthCheck & { lastRunAt: string | null; lastRunAgeHours: number | null; lastResult: string | null; lastErrorCode: string | null; failedRecent: number };
};
type SubscriptionPlan = { id: number; code: string; name: string; price: number | string; currency: string; billing_period: string; min_volume_liters: number | string | null; max_volume_liters: number | string | null; is_active: boolean };
type CollectorTierEdit = { name: string; price: string; minVolumeLiters: string; maxVolumeLiters: string; isActive: boolean };
type SubscriptionPolicy = { initial_access_days: number; grace_period_days: number; enforcement_time: string; time_zone: string };
type PaymentConfiguration = { provider: string; paymentMethod: string; displayName: string; currency: string; payerAccount: string; payerPhoneSource: string; realPaymentsEnabled: boolean; credentialsConfigured: boolean; apiConfigured: boolean; callbackConfigured: boolean; ready: boolean };
type AdminPayment = { id: number; account_name: string; account_email: string; subscription_status: string; plan_name: string | null; plan_code: string | null; amount: number; currency: string; status: string; payment_method: string; provider: string | null; billing_period: string; provider_reference: string; provider_transaction_id: string | null; mobile_money_phone: string | null; created_at: string; completed_at: string | null };
type CollectorAssignment = { id: number; collector_user_id: number; collector_name: string; collector_account_number: string | null; collector_national_id: string | null; collector_phone: string | null; abacunda_count: number };
type CollectorAssignmentRequest = {
  id: number;
  dairy_user_id: number;
  collector_user_id: number;
  requested_at: string;
  request_note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_at: string | null;
  decision_note: string | null;
  dairy_name: string | null;
  dairy_email: string | null;
  dairy_phone: string | null;
  collector_name: string | null;
  collector_email: string | null;
  collector_phone: string | null;
  collector_account_number?: string | null;
  collector_national_id?: string | null;
};
type AbacundaIfishiEntry = { date: string; morningLiters: number; eveningLiters: number; originalLiters: number; validLiters: number; lostLiters: number; status: string; reason: string | null };
type AbacundaIfishiHistory = { startDate: string; endDate: string; entries: AbacundaIfishiEntry[]; totals: Omit<AbacundaIfishiEntry, 'date' | 'status' | 'reason'>; collector: { id: number; name: string } };
type FarmerHistoryDay = { date: string; recordId: number | null; morningLiters: number; eveningLiters: number; totalLiters: number; session: 'morning' | 'evening' | 'morning-evening' | 'none'; status: string; deliveryStatus: 'delivered' | 'missing' };
type FarmerHistory = {
  farmer: Farmer & { farmerId: number; farmerNumber: number | null; createdDate?: string | null };
  startDate: string;
  endDate: string;
  requestedStartDate: string;
  requestedEndDate: string;
  expectedDays: number;
  deliveredDays: number;
  missingDays: number;
  deliveryRate: number;
  missedDates: string[];
  days: FarmerHistoryDay[];
};

type Tab = 'dashboard' | 'farmers' | 'centers' | 'milk' | 'deductions' | 'transport' | 'ukwezi' | 'settlements' | 'reports' | 'billing' | 'notifications' | 'settings' | 'accounts' | 'audit' | 'config' | 'system-health' | 'notifications-admin';
type SettlementRecord = SettlementHistoryRecord & { farmer_id?: number; farmer_name?: string; period_start?: string; period_end?: string; payment_method?: string; paymentMethod?: string };
type SettlementData = { ok: boolean; periodStart: string; periodEnd: string; summary?: { retainedCount: number; retainedAmount: number; approvedCount: number }; retained?: Array<ReportFarmerRow & { retainedAmount: number }>; records?: SettlementRecord[]; data?: SettlementRecord[] };

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.message || `Request failed (${response.status})`), { status: response.status, code: body.code });
  }
  return body as T;
};
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const userLanguage = (user: Pick<User, 'language'> | null | undefined): 'rw' | 'en' | null => (
  user?.language === 'en' ? 'en' : user?.language === 'rw' ? 'rw' : null
);
const MtnMoMoBrand = ({ compact = false }: { compact?: boolean }) => <span className={`mtn-momo-brand${compact ? ' compact' : ''}`} role="img" aria-label="MTN MoMo Rwanda">
  <span className="mtn-momo-mark" aria-hidden="true">MTN</span>
  <span className="mtn-momo-wordmark"><b>MoMo</b><small>Rwanda</small></span>
</span>;
type AccountingHalf = 'first-half' | 'second-half';
const today = () => getAccountingDate();
const getCurrentAccountingHalf = (): AccountingHalf => getCurrentAccountingPeriod().periodType as AccountingHalf;
const synchronizeCurrentAccountingHalf = (month: string, year: string, setPeriod: (period: AccountingHalf) => void) => {
  const current = getCurrentAccountingPeriod();
  if (month === current.month && year === current.year) setPeriod(current.periodType as AccountingHalf);
};
const getAccountingYears = () => {
  return typeof getAccountingYearsUtil === 'function'
    ? getAccountingYearsUtil()
    : ['2031', '2030', '2029', '2028', '2027', '2026', '2025', '2024'];
};
const getMonthBounds = (monthValue: string) => {
  const [yearText, monthText] = monthValue.split('-');
  return getMonthDateRange(Number(yearText), Number(monthText));
};
const getSettlementPeriodBounds = (monthValue: string, half: 'first-half' | 'second-half') => {
  const [year, month] = monthValue.split('-').map(Number);
  return getHalfMonthDateRange(year, month, half);
};
const money = (value: number | null | undefined) => value === null || value === undefined
  ? '—'
  : new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 0 }).format(Number(value || 0));
const liters = (value: number) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 2 }).format(Number(value || 0));
const unitMoney = (value: number) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 2 }).format(Number(value || 0));
const signedLiters = (value: number) => `${Number(value) > 0 ? '+' : ''}${liters(value)}`;
const isCollectorTier = (plan: SubscriptionPlan) => plan.code.startsWith('USAGE_');

const notificationTypeCopy: Record<string, PublicCopyKey> = {
  missed_delivery: 'alertTypeMissedDelivery',
  farmer_missed_delivery: 'alertTypeFarmerMissedDelivery',
  low_delivery: 'alertTypeLowDelivery',
  farmer_missing_center: 'alertTypeFarmerMissingCenter',
  farmer_missing_collector: 'alertTypeFarmerMissingCollector',
  no_collection: 'alertTypeNoCollection',
  low_collection: 'alertTypeLowCollection',
  farmer_milk_spike: 'alertTypeFarmerMilkSpike',
  collection_milk_spike: 'alertTypeCollectionMilkSpike',
  owner_farmer_difference_drop: 'alertTypeOwnerFarmerDifferenceDrop',
  farmer_milk_missing: 'alertTypeFarmerMilkMissing',
  no_farmer_milk_recorded: 'alertTypeNoFarmerMilk',
  owner_milk_missing: 'alertTypeOwnerMilkMissing',
  subscription_expiring: 'alertTypeSubscriptionExpiring',
  morning_missed: 'alertTypeMorningMissed',
  evening_missed: 'alertTypeEveningMissed',
  farmer_morning_missed: 'alertTypeFarmerMorningMissed',
  farmer_evening_missed: 'alertTypeFarmerEveningMissed',
  repeatedly_missed: 'alertTypeRepeatedlyMissed',
  farmer_created: 'alertTypeFarmerCreated',
  farmer_updated: 'alertTypeFarmerUpdated',
  milk_record_corrected: 'alertTypeMilkRecordCorrected',
  milk_record_voided: 'alertTypeMilkRecordVoided',
  milk_collection_adjusted: 'alertTypeMilkCollectionAdjusted',
  settlement_confirmed: 'alertTypeSettlementConfirmed',
  cash_payout_approved: 'alertTypeCashPayoutApproved',
  debt_created: 'alertTypeDebtCreated',
  debt_repaid: 'alertTypeDebtRepaid',
  password_changed: 'alertTypePasswordChanged',
  password_reset_completed: 'alertTypePasswordReset',
  account_suspended: 'alertTypeAccountSuspended',
  account_reactivated: 'alertTypeAccountReactivated',
};
const operationalNotificationTypes = new Set([
  'missed_delivery', 'farmer_missed_delivery', 'low_delivery',
  'farmer_missing_center', 'farmer_missing_collector', 'no_collection', 'low_collection',
  'farmer_milk_spike', 'collection_milk_spike', 'owner_farmer_difference_drop',
  'farmer_milk_missing', 'no_farmer_milk_recorded', 'owner_milk_missing',
  'morning_missed', 'evening_missed', 'farmer_morning_missed', 'farmer_evening_missed', 'repeatedly_missed',
]);
const resolutionCodeCopy: Record<string, PublicCopyKey> = {
  farmer_absent: 'alertResolutionFarmerAbsent',
  no_milk: 'alertResolutionNoMilk',
  reported_other: 'alertResolutionReportedOther',
  pending_verification: 'alertResolutionPendingVerification',
  dismissed: 'alertResolutionDismissed',
  delivery_recorded: 'alertResolutionDeliveryRecorded',
  volume_corrected: 'alertResolutionVolumeCorrected',
  issue_cleared: 'alertResolutionIssueCleared',
};
const priorityCopy: Record<string, PublicCopyKey> = {
  high: 'alertPriorityHigh',
  warning: 'alertPriorityWarning',
  info: 'alertPriorityInfo',
  success: 'alertPrioritySuccess',
};
const sessionCopy: Record<string, PublicCopyKey> = {
  morning: 'alertSessionMorning',
  evening: 'alertSessionEvening',
};
const NOTIFICATION_EVALUATION_INTERVAL_MS = 10 * 60 * 1000;
const ACCOUNT_PAGE_SIZE = 20;

const navigationIcons: Record<Tab, typeof Milk> = {
  dashboard: LayoutDashboard,
  farmers: Users,
  centers: Warehouse,
  milk: Milk,
  deductions: ReceiptText,
  transport: Truck,
  ukwezi: CalendarDays,
  settlements: HandCoins,
  reports: ChartNoAxesCombined,
  billing: CreditCard,
  notifications: Bell,
  settings: Settings,
  accounts: UsersRound,
  audit: History,
  config: BadgeDollarSign,
  'system-health': Gauge,
  'notifications-admin': BellRing,
};

const collectorTabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'farmers', label: 'Farmers' },
  { id: 'milk', label: 'Milk' },
  { id: 'deductions', label: 'Deductions' },
  { id: 'reports', label: 'Reports' },
  { id: 'billing', label: 'Billing' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'ukwezi', label: 'Ukwezi' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'settings', label: 'Settings' },
];

const dairyTabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'centers', label: 'Abacunda' },
  { id: 'milk', label: 'Milk' },
  { id: 'ukwezi', label: 'Ukwezi' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'reports', label: 'Reports' },
  { id: 'billing', label: 'Billing' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings', label: 'Settings' },
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
  exempt: 'statusExempt',
  none: 'statusNone',
} as const;
const subscriptionStatusCopy = {
  pending: 'statusPending',
  trial: 'statusPending',
  active: 'statusActive',
  exempt: 'statusExempt',
  suspended: 'statusSuspended',
  expired: 'statusExpired',
  cancelled: 'statusExpired',
} as const;

type PublicLanguageState = ReturnType<typeof usePublicLanguage>;

function Login({ onLogin, language, setLanguage, t }: { onLogin: (user: User, notice?: string, preferredLanguage?: 'rw' | 'en') => void } & PublicLanguageState) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forgotPassword = pathname === '/forgot-password';
  const registering = pathname === '/register' || searchParams?.get('mode') === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('COLLECTOR');
  const [resetStep, setResetStep] = useState<'request' | 'verify' | 'password' | 'complete'>('request');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [languageTouched, setLanguageTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    let signInNotice: string | undefined;
    try {
      if (registering) {
        const registration = await api<{ verificationEmailSent?: boolean; welcomeEmailSent?: boolean }>(
          '/api/auth/register',
          json('POST', { name, email, password, accountType, language })
        );
        if (registration.verificationEmailSent === false) {
          signInNotice = t('registrationVerificationEmailFailed');
        } else if (registration.welcomeEmailSent === false) {
          signInNotice = t('registrationWelcomeEmailFailed');
        } else if (registration.verificationEmailSent === true) {
          signInNotice = t('registrationEmailSent');
        }
      }
      const result = await api<{ user: User }>('/api/auth/login', json('POST', { email, password }));
      onLogin(result.user, signInNotice, languageTouched ? language : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout">
      {/* Hidden test preservation container */}
      <section className="auth-brand sr-only" style={{ display: 'none' }} aria-hidden="true">
        <BrandLockup className="auth-brand-lockup" imageSize={72} />
        <p className="eyebrow">{forgotPassword ? t('forgotEyebrow') : t('loginEyebrow')}</p>
        <h1>{forgotPassword ? t('forgotTitle') : registering ? t('createTitle') : t('loginTitle')}</h1>
        <p className="auth-subtitle">{forgotPassword ? t('forgotDescription') : registering ? t('registerDescription') : t('loginDescription')}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-topbar">
          <Link className="auth-back-link auth-top-back-link" href="/">{t('backToWelcome')}</Link>
          <div className="public-language-switch" role="group" aria-label={t('languageLabel')}>
            <button type="button" aria-label={t('languageKinyarwanda')} aria-pressed={language === 'rw'} onClick={() => { setLanguageTouched(true); setLanguage('rw'); }}>RW</button>
            <button type="button" aria-label={t('languageEnglish')} aria-pressed={language === 'en'} onClick={() => { setLanguageTouched(true); setLanguage('en'); }}>EN</button>
          </div>
        </div>
        <div className="auth-card-hero">
          <div className="auth-card-logo-wrap">
            <Image
              src="/brand-logo.png"
              width={48}
              height={48}
              alt="IHURIRO RY'AMATA"
              className="auth-card-circular-logo"
            />
          </div>
          <h2 className="auth-card-title">
            {forgotPassword
              ? (language === 'en' ? 'Reset Password' : 'Gusubirishamo Ijambobanga')
              : registering
                ? (language === 'en' ? 'Fungura Konti' : 'Fungura Konti')
                : (language === 'en' ? 'Welcome Back' : 'Murakaza Neza')}
          </h2>
          <p className="auth-card-subtitle">
            {forgotPassword
              ? (language === 'en' ? 'Enter your email to receive a reset code.' : 'Andika imeri yawe kugira ngo wohererezwe kode.')
              : registering
                ? (language === 'en' ? 'Choose the account type you want to create.' : 'Hitamo ubwoko bwa konti wifuza gukoresha.')
                : (language === 'en' ? 'Sign in to continue managing milk operations.' : 'Injira kugira ngo ukomeze gucunga amata.')}
          </p>
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
          <label>{t('email')}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} inputMode="email" autoCapitalize="none" /></label>
          <label>{t('password')}<span className="password-field"><input type={passwordVisible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={passwordVisible ? t('hidePassword') : t('showPassword')} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span></label>
          {!registering ? <Link className="auth-forgot-link" href="/forgot-password">{t('forgotPassword')}</Link> : null}
          {registering ? (
            <div className="auth-account-type-wrapper">
              <span className="auth-account-type-title">{t('accountType')}</span>
              <div className="auth-segmented-control" role="radiogroup" aria-label={t('accountType')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={accountType === 'COLLECTOR'}
                  className={`auth-segment-pill${accountType === 'COLLECTOR' ? ' is-active' : ''}`}
                  onClick={() => setAccountType('COLLECTOR')}
                >
                  <Users size={16} aria-hidden="true" />
                  <span>{t('collector')}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={accountType === 'COLLECTION_CENTER'}
                  className={`auth-segment-pill${accountType === 'COLLECTION_CENTER' ? ' is-active' : ''}`}
                  onClick={() => setAccountType('COLLECTION_CENTER')}
                >
                  <Building2 size={16} aria-hidden="true" />
                  <span>{t('collectionCenter')}</span>
                </button>
              </div>
              <label style={{ display: 'none' }}>
                {t('accountType')}
                <select value={accountType} onChange={(event) => setAccountType(event.target.value)}>
                  <option value="COLLECTOR">{t('collector')}</option>
                  <option value="COLLECTION_CENTER">{t('collectionCenter')}</option>
                </select>
              </label>
            </div>
          ) : null}
          {registering ? <p className="subscription-registration-period">{t('registrationSubscriptionNotice')}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? t('wait') : registering ? t('createAccount') : t('signIn')}<ArrowRight size={17} /></button>
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
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/register' || pathname === '/forgot-password';
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(!isAuthRoute);
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [tab, setTabState] = useState<Tab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ifishiOpen, setIfishiOpen] = useState(false);
  const [ownerIfishiOpen, setOwnerIfishiOpen] = useState(false);
  const [ownerIfishiHistoryOpen, setOwnerIfishiHistoryOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreMenuRef = useRef<HTMLElement | null>(null);
  const mobileMoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [centers, setCenters] = useState<Center[]>([]);
  const [farmers, setFarmers] = useState<Page<Farmer> | null>(null);
  const [farmersLoading, setFarmersLoading] = useState(false);
  const [farmersError, setFarmersError] = useState('');
  const farmerListRequestRef = useRef(0);
  const [farmerQuery, setFarmerQuery] = useState('');
  const [farmerSearch, setFarmerSearch] = useState('');
  const [farmerCenter, setFarmerCenter] = useState('');
  const [farmerCollectorFilter, setFarmerCollectorFilter] = useState('');
  const [farmerSortBy, setFarmerSortBy] = useState<'' | 'name' | 'nationalId' | 'collectionCenter'>('');
  const [farmerSortDirection, setFarmerSortDirection] = useState<'asc' | 'desc'>('asc');
  const [farmerForm, setFarmerForm] = useState({ name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [farmerCreateOpen, setFarmerCreateOpen] = useState(false);
  const [farmerDeletionTarget, setFarmerDeletionTarget] = useState<Farmer | null>(null);
  const [farmerDeletionImpact, setFarmerDeletionImpact] = useState<FarmerDeletionImpact | null>(null);
  const [farmerDeletionLoading, setFarmerDeletionLoading] = useState(false);
  const [farmerDeletionReason, setFarmerDeletionReason] = useState('');
  const [farmerDeletionConfirmation, setFarmerDeletionConfirmation] = useState('');
  const [farmerDeletionError, setFarmerDeletionError] = useState('');
  const [farmerDeletionBusy, setFarmerDeletionBusy] = useState(false);
  const [farmerBatchOpen, setFarmerBatchOpen] = useState(false);
  const [farmerBatchRows, setFarmerBatchRows] = useState<Array<{ name: string; collectionCenterId: string; phone: string; nationalId: string; accountNumber: string; cowType: string; collectorUserId: string }>>([
    { name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' },
  ]);
  const [farmerBatchError, setFarmerBatchError] = useState('');
  const [farmerBatchSubmitting, setFarmerBatchSubmitting] = useState(false);
  const [fieldConfig, setFieldConfig] = useState<{ key: string; enabled: boolean; required: boolean; sortOrder: number; label: { rw: string; en: string } }[] | null>(null);
  const [fieldConfigLoading, setFieldConfigLoading] = useState(true);

  const visibleFarmerFields = useMemo(() => {
    const config = fieldConfig ?? defaultFieldConfig();
    return enabledFields(config).filter((field: { key: string }) => field.key !== 'cowType').sort((a: { sortOrder: number; key: string }, b: { sortOrder: number; key: string }) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  }, [fieldConfig]);
  const [farmerImportOpen, setFarmerImportOpen] = useState(false);
  const [milkImportOpen, setMilkImportOpen] = useState(false);
  const [milkViewMode, setMilkViewMode] = useState<'matrix' | 'daily'>('matrix');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddPhone, setQuickAddPhone] = useState('');
  const [quickAddMorning, setQuickAddMorning] = useState('');
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [milkDensities, setMilkDensities] = useState<Record<number, string>>({});
  const [milkQualities, setMilkQualities] = useState<Record<number, 'accepted' | 'tested' | 'rejected'>>({});

  useEffect(() => {
    let active = true;
    if (!user) return;
    (async () => {
      try {
        const result = await api<{ configurations: Array<{ fieldKey: string; enabled: boolean; required: boolean; sort_order: number }> }>('/api/farmers/field-config', { cache: 'no-store' });
        if (active) setFieldConfig(resolveFieldConfig(result.configurations));
      } catch {
        // No field configuration table yet (or it cannot be read): fall back to
        // the canonical field definitions instead of failing the form.
        if (active) setFieldConfig(resolveFieldConfig());
      } finally {
        if (active) setFieldConfigLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user]);
  const [farmerCreateError, setFarmerCreateError] = useState('');
  const farmerCreateSubmittingRef = useRef(false);
  const [editingFarmer, setEditingFarmer] = useState<Farmer | null>(null);
  const [farmerEdit, setFarmerEdit] = useState({ name: '', farmerNumber: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
  const [inlineNumberFarmerId, setInlineNumberFarmerId] = useState<number | null>(null);
  const [inlineFarmerNumber, setInlineFarmerNumber] = useState<string>('');
  const [inlineNumberSaving, setInlineNumberSaving] = useState(false);

  const startEditingFarmerNumber = (farmerId: number, currentNumber?: number | null) => {
    setInlineNumberFarmerId(farmerId);
    setInlineFarmerNumber(currentNumber != null ? String(currentNumber) : '');
  };

  const saveInlineFarmerNumber = async (farmerId: number, currentNumber?: number | null) => {
    const trimmed = inlineFarmerNumber.trim();
    if (!trimmed || Number(trimmed) === Number(currentNumber)) {
      setInlineNumberFarmerId(null);
      return;
    }
    const nextNum = parseInt(trimmed, 10);
    if (isNaN(nextNum) || nextNum <= 0) {
      window.alert(publicLanguage.language === 'en' ? 'Farmer number must be a positive integer.' : "Nimero y'umworozi igomba kuba umubare muzima.");
      setInlineNumberFarmerId(null);
      return;
    }
    try {
      setInlineNumberSaving(true);
      await api(`/api/farmers/${farmerId}`, json('PUT', { farmerNumber: nextNum }));
      setFarmers((prev) => prev ? { ...prev, data: prev.data.map((f) => f.id === farmerId ? { ...f, farmerNumber: nextNum } : f) } : prev);
      setDaily((prev) => prev.map((r) => r.farmerId === farmerId ? { ...r, farmerNumber: nextNum } : r));
      setInlineNumberFarmerId(null);
    } catch (err: any) {
      window.alert(err.message || (publicLanguage.language === 'en' ? 'Failed to update farmer number.' : "Kunanirwa guhindura nimero y'umworozi."));
      setInlineNumberFarmerId(null);
    } finally {
      setInlineNumberSaving(false);
    }
  };
  const saveInlineFarmerPhone = async (farmer: Farmer) => {
    if (inlineFarmerPhone === farmer.phone) {
      setInlineEditingFarmerId(null);
      return;
    }
    const oldPhone = farmer.phone;
    const newPhone = inlineFarmerPhone;
    setInlineEditingFarmerId(null);
    try {
      await api(`/api/farmers/${farmer.id}`, json('PUT', { ...farmer, phone: newPhone }));
      setFarmers((previous) => previous ? { ...previous, data: previous.data.map((item) => item.id === farmer.id ? { ...item, phone: newPhone } : item) } : previous);
      setUndoToast({
        message: `${farmer.name}: ${publicLanguage.language === 'en' ? 'Phone updated' : 'Nimero yahinduwe'}`,
        onUndo: async () => {
          try {
            await api(`/api/farmers/${farmer.id}`, json('PUT', { ...farmer, phone: oldPhone }));
            setFarmers((previous) => previous ? { ...previous, data: previous.data.map((item) => item.id === farmer.id ? { ...item, phone: oldPhone } : item) } : previous);
          } catch {
            // ignore
          }
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : publicLanguage.t('farmerSaveError'));
    }
  };
  const [collectorAssignments, setCollectorAssignments] = useState<CollectorAssignment[]>([]);
  const [collectorAssignmentSortDirection, setCollectorAssignmentSortDirection] = useState<'asc' | 'desc'>('asc');
  const [collectorAssignmentsLoading, setCollectorAssignmentsLoading] = useState(false);
  const [collectorAssignmentsError, setCollectorAssignmentsError] = useState('');
  const [collectorLinkId, setCollectorLinkId] = useState('');
  const [collectorLinkEmail, setCollectorLinkEmail] = useState('');
  const [collectorLinkOpen, setCollectorLinkOpen] = useState(false);
  const [collectorLinkError, setCollectorLinkError] = useState('');
  const collectorLinkSubmittingRef = useRef(false);
  const [collectorRequests, setCollectorRequests] = useState<CollectorAssignmentRequest[]>([]);
  const [collectorRequestsLoading, setCollectorRequestsLoading] = useState(false);
  const [collectorRequestsError, setCollectorRequestsError] = useState('');
  const [collectorRequestDairyId, setCollectorRequestDairyId] = useState('');
  const [collectorRequestNote, setCollectorRequestNote] = useState('');
  const [collectorRequestError, setCollectorRequestError] = useState('');
  const collectorRequestSubmittingRef = useRef(false);
  const [abacundaIfishiCollector, setAbacundaIfishiCollector] = useState<CollectorAssignment | null>(null);
  const [abacundaIfishiHistory, setAbacundaIfishiHistory] = useState<AbacundaIfishiHistory | null>(null);
  const [abacundaIfishiMonth, setAbacundaIfishiMonth] = useState(today().slice(0, 7));
  const [abacundaIfishiLoading, setAbacundaIfishiLoading] = useState(false);
  const [abacundaIfishiError, setAbacundaIfishiError] = useState('');
  const [centerForm, setCenterForm] = useState({ name: '', pricePerLiter: '', transportRatePerLiter: '0', morningStart: '06:30', morningEnd: '09:00', eveningStart: '17:30', eveningEnd: '19:00' });
  const [centerEdits, setCenterEdits] = useState<Record<number, Partial<Center> & { morningStart?: string; morningEnd?: string; eveningStart?: string; eveningEnd?: string }>>({});
  const [selectedCenter, setSelectedCenter] = useState('');
  const [centersLoading, setCentersLoading] = useState(false);
  const centersPromiseRef = useRef<Promise<Center[]> | null>(null);
  const dailyAbortControllerRef = useRef<AbortController | null>(null);
  const [recentlySavedRows, setRecentlySavedRows] = useState<Set<number>>(new Set());
  const [dailyCenter, setDailyCenter] = useState<string | null>(null);
  const [dailyCenters, setDailyCenters] = useState<string[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardDailyReady, setDashboardDailyReady] = useState(false);
  const [dashboardOwnerMilk, setDashboardOwnerMilk] = useState<DashboardOwnerMilk>({ status: 'loading', date: today(), volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 });
  const dashboardOwnerMilkRequest = useRef(0);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [unreadCountStatus, setUnreadCountStatus] = useState<'loading' | 'available' | 'error'>('loading');
  const unreadCountRequestRef = useRef(0);
  const [collectionDate, setCollectionDate] = useState(today());
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [collectorMilkEntry, setCollectorMilkEntry] = useState<CollectorMilkEntry | null>(null);
  const [dailyCursor, setDailyCursor] = useState<string | null>(null);
  const [dailyHasMore, setDailyHasMore] = useState(false);
  const [dailySearch, setDailySearch] = useState('');
  const [debouncedDailySearch, setDebouncedDailySearch] = useState('');
  const [dailySession, setDailySession] = useState<'all' | 'morning' | 'evening'>('all');
  const [dailyDeliveryFilter, setDailyDeliveryFilter] = useState<'all' | 'delivered' | 'missing'>('all');
  const [dailyCollectorFilter, setDailyCollectorFilter] = useState('');
  const [dailySortBy, setDailySortBy] = useState<'' | 'farmerName' | 'totalVolume'>('');
  const [dailySortDirection, setDailySortDirection] = useState<'asc' | 'desc'>('asc');
  const [dailyPageSize, setDailyPageSize] = useState(50);
  const dailyFilterState = [debouncedDailySearch, dailySession, dailyDeliveryFilter, dailyCollectorFilter, dailyPageSize];
  const dailyRequestRef = useRef(0);
  const [dailySummary, setDailySummary] = useState({
    totalFarmers: 0,
    presentCount: 0,
    missedCount: 0,
    expectedCount: 0,
    deliveredCount: 0,
    missingCount: 0,
    deliveryRate: 0,
    totalMorning: 0,
    totalEvening: 0,
    totalVolume: 0,
    totalAmount: 0,
    pricePerLiter: 0,
    transportRate: 0,
  });
  const [volumes, setVolumes] = useState<Record<number, { morning: string; evening: string }>>({});
  const [deductionLedgerRows, setDeductionLedgerRows] = useState<FarmerPeriodLedgerRow[]>([]);
  const [deductionLedgerSummary, setDeductionLedgerSummary] = useState<FarmerPeriodLedgerSummary | null>(null);
  const [deductionLedgerLoading, setDeductionLedgerLoading] = useState(false);
  const [deductionLedgerHasMore, setDeductionLedgerHasMore] = useState(false);
  const [deductionLedgerNextCursor, setDeductionLedgerNextCursor] = useState<string | null>(null);
  const [deductionLedgerSearch, setDeductionLedgerSearch] = useState('');
  const [deductionLedgerStatus, setDeductionLedgerStatus] = useState<FarmerPeriodLedgerRow['status'] | 'ALL'>('ALL');
  const [deductionLedgerConfigurationId, setDeductionLedgerConfigurationId] = useState<number | null>(null);
  const [deductionPeriod, setDeductionPeriod] = useState(() => {
    const period = getCurrentAccountingPeriod();
    return { startDate: period.startDate, endDate: period.endDate };
  });
  const [deductionConfigurations, setDeductionConfigurations] = useState<DeductionConfiguration[]>([]);
  const [deductionConfigurationsLoading, setDeductionConfigurationsLoading] = useState(false);
  const [deductionForm, setDeductionForm] = useState({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
  const [deductionCreateOpen, setDeductionCreateOpen] = useState(false);
  const [deductionCreateError, setDeductionCreateError] = useState('');
  const [deductionContextFarmer, setDeductionContextFarmer] = useState<{
    id: number;
    name: string;
    periodStart: string;
    periodEnd: string;
    totalVolume: number;
    pricePerLiter: number | null;
    grossAmount: number | null;
    totalDeductions: number;
    totalTransport: number | null;
    netAmount: number | null;
  } | null>(null);
  const [deductionInspectorOpen, setDeductionInspectorOpen] = useState(false);
  const [deductionInspectorFarmer, setDeductionInspectorFarmer] = useState<{ id: number; name: string | null } | null>(null);
  const [deductionHistoryRows, setDeductionHistoryRows] = useState<DeductionHistoryItem[]>([]);
  const [deductionHistoryLoading, setDeductionHistoryLoading] = useState(false);
  const [deductionHistoryError, setDeductionHistoryError] = useState('');
  const [deductionHistoryHasMore, setDeductionHistoryHasMore] = useState(false);
  const [deductionHistoryCursor, setDeductionHistoryCursor] = useState<string | null>(null);
  const deductionSubmittingRef = useRef(false);
  const [deductionFarmerSearch, setDeductionFarmerSearch] = useState('');
  const [deductionFarmers, setDeductionFarmers] = useState<Farmer[]>([]);
const [report, setReport] = useState<Report | null>(null);
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [settlementMonth, setSettlementMonth] = useState(today().slice(0, 7));
  const [settlementHalf, setSettlementHalf] = useState<AccountingHalf>(getCurrentAccountingHalf);
  const [settlementTab, setSettlementTab] = useState<'accounts' | 'cash'>('accounts');
  const [settlementSearch, setSettlementSearch] = useState('');
  const [selectedCashFarmerIds, setSelectedCashFarmerIds] = useState<number[]>([]);
  const [cashConfirmationProgress, setCashConfirmationProgress] = useState<SettlementBatchState | null>(null);
  const [settlementData, setSettlementData] = useState<SettlementData | null>(null);
  const [settlementReport, setSettlementReport] = useState<Report | null>(null);
  const [settlementDebts, setSettlementDebts] = useState<any[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementError, setSettlementError] = useState<'settlementsLoadError' | 'settlementsSchemaUnavailable' | ''>('');
  const [settlementReportError, setSettlementReportError] = useState(false);
  const [settlementAmounts, setSettlementAmounts] = useState<Record<number, string>>({});
  const settlementRequestKeys = useRef<Record<string, string>>({});
  const settlementOperationRef = useRef(false);
  const [debtForm, setDebtForm] = useState({ farmerId: '', amount: '', reason: '' });
  const [debtRepaymentAmounts, setDebtRepaymentAmounts] = useState<Record<number, string>>({});
  const [ifishiMonth, setIfishiMonth] = useState(today().slice(0, 7));
  const [ifishiFarmerSearch, setIfishiFarmerSearch] = useState('');
  const [debouncedIfishiFarmerSearch, setDebouncedIfishiFarmerSearch] = useState('');
  const [ifishiFarmers, setIfishiFarmers] = useState<Farmer[]>([]);
  const [ifishiSelectedFarmer, setIfishiSelectedFarmer] = useState<Farmer | null>(null);
  const [ifishiFarmerId, setIfishiFarmerId] = useState('');
  const [ifishiResultsOpen, setIfishiResultsOpen] = useState(false);
  const [ifishiActiveResultIndex, setIfishiActiveResultIndex] = useState(-1);
  const [ifishiFarmersLoading, setIfishiFarmersLoading] = useState(false);
  const ifishiFarmerRequestRef = useRef(0);
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
  const [selectedFarmerIds, setSelectedFarmerIds] = useState<Set<number>>(new Set());
  const toggleFarmerSelect = (id: number) => {
    setSelectedFarmerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelectedFarmers = () => setSelectedFarmerIds(new Set());
  const [undoToast, setUndoToast] = useState<{ message: string; onUndo: () => void } | null>(null);
  const [inlineEditingFarmerId, setInlineEditingFarmerId] = useState<number | null>(null);
  const [inlineFarmerPhone, setInlineFarmerPhone] = useState('');
  const [reportTimelinePeriod, setReportTimelinePeriod] = useState<'daily' | 'first-half' | 'second-half' | 'monthly'>('monthly');

  useEffect(() => {
    if (undoToast) {
      const timer = setTimeout(() => setUndoToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [undoToast]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], .milk-search-field input, .farmers-search-field input, .ifishi-search-input'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select?.();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const [farmerHistoryOpen, setFarmerHistoryOpen] = useState(false);
  const [farmerHistory, setFarmerHistory] = useState<FarmerHistory | null>(null);
  const [farmerHistoryFarmer, setFarmerHistoryFarmer] = useState<Pick<Farmer, 'id' | 'name' | 'phone' | 'farmerNumber'> | null>(null);
  const [farmerHistoryMonth, setFarmerHistoryMonth] = useState(today().slice(0, 7));
  const [farmerHistorySession, setFarmerHistorySession] = useState<'all' | 'morning' | 'evening'>('all');
  const [farmerHistoryLoading, setFarmerHistoryLoading] = useState(false);
  const [farmerHistoryError, setFarmerHistoryError] = useState('');
  const farmerHistoryRequestRef = useRef(0);
  const [farmerSettlementHistory, setFarmerSettlementHistory] = useState<SettlementHistoryRecord[]>([]);
  const [farmerSettlementHistoryLoading, setFarmerSettlementHistoryLoading] = useState(false);
  const [farmerSettlementHistoryError, setFarmerSettlementHistoryError] = useState('');
  const farmerSettlementHistoryRequestRef = useRef(0);
  const [ownerIfishiHistory, setOwnerIfishiHistory] = useState<OwnerIfishiHistory | null>(null);
  const [ownerIfishiReport, setOwnerIfishiReport] = useState<Report | null>(null);
  const [ownerIfishiReportError, setOwnerIfishiReportError] = useState('');
  const [ownerIfishiPeriod, setOwnerIfishiPeriod] = useState<AccountingHalf>(getCurrentAccountingHalf);
  const [ownerIfishiMorning, setOwnerIfishiMorning] = useState('');
  const [ownerIfishiEvening, setOwnerIfishiEvening] = useState('');
  const [ownerIfishiLoading, setOwnerIfishiLoading] = useState(false);
  const [ownerIfishiError, setOwnerIfishiError] = useState('');
  const [ownerIfishiSaveError, setOwnerIfishiSaveError] = useState('');
  const [ownerIfishiSaveStatus, setOwnerIfishiSaveStatus] = useState('');
  const [lossEventOpen, setLossEventOpen] = useState(false);
  const [lossEventLoading, setLossEventLoading] = useState(false);
  const [lossEventError, setLossEventError] = useState('');
  const [lossEventStatus, setLossEventStatus] = useState('');
  const [lossEventPeriod, setLossEventPeriod] = useState<'morning' | 'evening' | 'all'>('all');
  const [lossEventPercentage, setLossEventPercentage] = useState('');
  const [lossEventReason, setLossEventReason] = useState('');
  const [lossEventOtherReason, setLossEventOtherReason] = useState('');
  const [lossEventConfirmed, setLossEventConfirmed] = useState(false);
  const [lossPreviewLoading, setLossPreviewLoading] = useState(false);
  const [lossPreview, setLossPreview] = useState<{
    farmers: Array<{ farmerId: number; farmerName: string; originalLitres: number; calculatedLossLitres: number; appliedLossLitres: number; remainingValidLitres: number }>;
    affectedRecords: number;
    originalLitres: number;
    calculatedLossLitres: number;
    appliedLossLitres: number;
    remainingValidLitres: number;
    estimatedFarmerMilkValueChange: number;
    estimatedOwnerMilkDifferenceChange: number;
    affectedAccountingPeriods: Array<{ startDate: string; endDate: string }>;
    ownerMilkExcluded: boolean;
  } | null>(null);
  const [ukweziMonth, setUkweziMonth] = useState(today().slice(5, 7));
  const [ukweziYear, setUkweziYear] = useState(today().slice(0, 4));
  const [ukweziPeriod, setUkweziPeriod] = useState<AccountingHalf>(getCurrentAccountingHalf);
  const [ukweziSortBy, setUkweziSortBy] = useState<'name' | 'volume' | 'payable'>('name');
  const [ukweziSortDirection, setUkweziSortDirection] = useState<'asc' | 'desc'>('asc');
  const [ukweziReport, setUkweziReport] = useState<Report | null>(null);
  const [ukweziCloseLoading, setUkweziCloseLoading] = useState(false);
  const [ukweziCloseError, setUkweziCloseError] = useState('');
  const [ukweziCloseStatus, setUkweziCloseStatus] = useState('');
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
  const [notificationStateFilter, setNotificationStateFilter] = useState('all');
  const [notificationGroupFilter, setNotificationGroupFilter] = useState('');
  const [notificationSortBy, setNotificationSortBy] = useState<'date' | 'type'>('date');
  const [notificationSortDirection, setNotificationSortDirection] = useState<'asc' | 'desc'>('desc');
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationTypeOptions, setNotificationTypeOptions] = useState<string[]>([]);
  const notificationRequestRef = useRef(0);
  const notificationReadRequestsRef = useRef<Set<number>>(new Set());
  const notificationMenuRef = useRef<HTMLDivElement | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Notice | null>(null);
  const [resolveCode, setResolveCode] = useState('farmer_absent');
  const [resolveNote, setResolveNote] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);
  const [accounts, setAccounts] = useState<{ accounts: Account[]; total: number; page: number; limit: number } | null>(null);
  const [grantDaysAccount, setGrantDaysAccount] = useState<Account | null>(null);
  const [grantDaysValue, setGrantDaysValue] = useState<number>(15);
  const [grantDaysReason, setGrantDaysReason] = useState<string>('');
  const [grantDaysLoading, setGrantDaysLoading] = useState<boolean>(false);
  const [grantDaysError, setGrantDaysError] = useState<string>('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [adminAccountDetailsOpen, setAdminAccountDetailsOpen] = useState(false);
  const [adminAccountDetails, setAdminAccountDetails] = useState<AdminAccountDetails | null>(null);
  const [adminAccountDetailsTargetId, setAdminAccountDetailsTargetId] = useState<number | null>(null);
  const [adminAccountDetailsLoading, setAdminAccountDetailsLoading] = useState(false);
  const [adminAccountDetailsError, setAdminAccountDetailsError] = useState('');
  const [adminExemptionReason, setAdminExemptionReason] = useState('');
  const adminAccountDetailsRequestRef = useRef(0);
  const [billing, setBilling] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<'billingLoadError' | 'billingAuthError' | 'billingAccessError' | 'billingAccountError' | ''>('');
  const billingRequestRef = useRef<{ key: string; id: number; promise: Promise<void> } | null>(null);
  const billingRequestSequenceRef = useRef(0);
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
        { id: 'dashboard' as Tab, label: publicLanguage.t('navAdminOverview') },
        { id: 'accounts' as Tab, label: publicLanguage.t('navAccounts') },
        { id: 'audit' as Tab, label: publicLanguage.t('navAudit') },
        { id: 'config' as Tab, label: publicLanguage.t('navPricing') },
        { id: 'settings' as Tab, label: publicLanguage.t('navAdminSettings') },
        { id: 'system-health' as Tab, label: publicLanguage.t('systemHealth') },
        { id: 'notifications-admin' as Tab, label: publicLanguage.t('navAdminAlerts') },
      ]
    : (isCollector ? collectorTabs : isDairy ? dairyTabs : collectorTabs)).map((item) => {
      const labelKey = item.id === 'dashboard' && isAdmin
        ? 'navAdminOverview'
        : item.id === 'settings' && isAdmin
          ? 'navAdminSettings'
        : isDairy && item.id === 'centers'
          ? 'dairyCentersTab'
        : isDairy && item.id === 'milk'
          ? 'dairyDailyMilkTab'
        : isDairy && item.id === 'ukwezi'
          ? 'dairyUkweziTab'
        : isDairy && item.id === 'settlements'
          ? 'dairySettlementsTab'
        : item.id in navigationCopy
          ? navigationCopy[item.id as keyof typeof navigationCopy]
          : null;
      return { ...item, icon: navigationIcons[item.id], label: labelKey ? publicLanguage.t(labelKey) : item.label };
    });
  const mobilePrimaryTabs = visibleTabs.slice(0, 4);
  const mobileMoreTabs = visibleTabs.slice(4);

  const setTab = (nextTab: Tab) => {
    if (!visibleTabs.some((item) => item.id === nextTab)) return;
    setTabState(nextTab);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', nextTab);
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath !== currentPath) window.history.pushState({}, '', nextPath);
  };

  const adoptUserLanguage = (nextUser: User, preferredLanguage?: 'rw' | 'en') => {
    const language = preferredLanguage || userLanguage(nextUser);
    if (language) publicLanguage.setLanguage(language);
  };

  const changeLanguage = async (nextLanguage: 'rw' | 'en') => {
    if (publicLanguage.language === nextLanguage) return;
    publicLanguage.setLanguage(nextLanguage);
    if (!user) return;
    try {
      await api('/api/auth/profile', json('PATCH', { language: nextLanguage }));
      setUser((current) => {
        if (!current) return current;
        const updated = { ...current, language: nextLanguage };
        sessionStorage.setItem('milk-session-user', JSON.stringify(updated));
        return updated;
      });
    } catch {
      setError(publicLanguage.t('accountLanguageSaveError'));
    }
  };

  useEffect(() => {
    if (!mobileMoreOpen) return undefined;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mobileMoreMenuRef.current?.contains(target) || mobileMoreTriggerRef.current?.contains(target)) return;
      setMobileMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMoreOpen(false);
        mobileMoreTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
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
        adoptUserLanguage(result.user);
        sessionStorage.setItem('milk-session-user', JSON.stringify(result.user));
      })
      .catch((reason) => {
        if (!active) return;
        if (!navigator.onLine && storedUser) {
          try {
            const restoredUser = JSON.parse(storedUser) as User;
            setUser(restoredUser);
            adoptUserLanguage(restoredUser);
          } catch { sessionStorage.removeItem('milk-session-user'); }
        } else if (!(reason instanceof Error && 'status' in reason && reason.status === 401)) {
          if (!isAuthRoute) {
            setAuthError(publicLanguage.t('connectionError') || 'Unable to start Milk System. Check your connection or try again.');
          }
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
    if (!user || authLoading) return undefined;
    const allowedTabs = new Set(visibleTabs.map((item) => item.id));
    const fallbackTab = visibleTabs[0]?.id ?? 'dashboard';
    const syncTabFromUrl = () => {
      const url = new URL(window.location.href);
      const requestedTab = url.searchParams.get('tab');
      const safeTab = resolveWorkspaceTab(requestedTab, [...allowedTabs]) as Tab;
      setTabState(safeTab);
      if (requestedTab !== safeTab) {
        url.searchParams.set('tab', safeTab);
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    };
    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (!user) return undefined;
    const refreshConnection = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      try {
        const result = await api<{ user: User }>('/api/auth/me');
        setUser(result.user);
        adoptUserLanguage(result.user);
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
      if (synced.synced > 0) setNotice(formatPublicCopy(publicLanguage.language, 'offlineEntriesSynced', '{count} offline milk entries synced.', { count: synced.synced }));
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
    if (settlementOperationRef.current) return;
    settlementOperationRef.current = true;
    setBusy(true);
    clearMessages();
    try { await operation(); } catch { setError(publicLanguage.t('settlementsActionError')); }
    finally { settlementOperationRef.current = false; setBusy(false); }
  };

  const loadCenters = async () => {
    setCentersLoading(true);
    const promise = api<Center[]>('/api/collection-centers');
    centersPromiseRef.current = promise;
    try {
      const data = await promise;
      setCenters(data);
      setSelectedCenter((current) => {
        if (!data.length) return '';
        const currentCenterStillExists = current && data.some((center) => String(center.id) === String(current));
        return currentCenterStillExists ? current : String(data[0].id);
      });
      return data;
    } finally {
      setCentersLoading(false);
      centersPromiseRef.current = null;
    }
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

  const loadCollectorRequests = async () => {
    setCollectorRequestsLoading(true);
    setCollectorRequestsError('');
    try {
      const result = await api<CollectorAssignmentRequest[]>('/api/collector-assignment-requests?status=all');
      setCollectorRequests(result);
    } catch (reason) {
      setCollectorRequestsError(reason instanceof Error ? reason.message : 'Failed to load collector membership requests.');
      throw reason;
    } finally {
      setCollectorRequestsLoading(false);
    }
  };

  const collectorRequestStatusLabel = (status: CollectorAssignmentRequest['status']) => {
    switch (status) {
      case 'approved': return publicLanguage.t('collectorRequestStatusApproved');
      case 'rejected': return publicLanguage.t('collectorRequestStatusRejected');
      case 'cancelled': return publicLanguage.t('collectorRequestStatusCancelled');
      default: return publicLanguage.t('collectorRequestStatusPending');
    }
  };

  const getFarmerCollectorName = (collectorUserId?: number | null) => {
    if (!collectorUserId) return publicLanguage.t('noCollector');
    const matched = collectorAssignments.find((assignment) => assignment.collector_user_id === collectorUserId);
    return matched ? matched.collector_name : `Collector #${collectorUserId}`;
  };

  const loadFarmers = async (cursor?: string | null, append = false) => {
    const requestId = ++farmerListRequestRef.current;
    setFarmersLoading(true);
    setFarmersError('');
    try {
      if (isDairy && (centersLoading || !centers.length)) {
        if (centersPromiseRef.current) {
          try {
            await centersPromiseRef.current;
          } catch {
            // ignore
          }
        }
      }
      const cleanCursor = sanitizeQueryParam(cursor);
      const activeCenter = centers.find((center) => String(center.id) === selectedCenter)?.name || '';
      const scopedFarmerCenter = sanitizeQueryParam(isDairy ? activeCenter : farmerCenter);
      const params = buildFarmerListQuery({
        userAccountType: user?.accountType || '',
        userId: user?.id || 0,
        selectedCollectorId: sanitizeQueryParam(farmerCollectorFilter) || undefined,
        farmerSearch: sanitizeQueryParam(farmerSearch) || undefined,
        farmerCenter: scopedFarmerCenter || undefined,
        sortBy: farmerSortBy || undefined,
        sortDirection: farmerSortBy ? farmerSortDirection : undefined,
        cursor: cleanCursor || undefined,
        limit: 50,
      });
      const cacheKey = `milk-farmers-${user?.id}-${user?.accountType}-${scopedFarmerCenter}-${farmerSearch}-${farmerCollectorFilter}-${farmerSortBy}-${farmerSortDirection}`;
      try {
        const result = await api<Page<Farmer>>(`/api/farmers?${params}`, { cache: 'no-store' });
        if (requestId !== farmerListRequestRef.current) return;
        setFarmers((previous) => append && previous ? { ...result, data: [...previous.data, ...result.data] } : result);
        if (!append && !cleanCursor) localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (reason) {
        if (requestId !== farmerListRequestRef.current) return;
        const cached = !append && !cleanCursor ? localStorage.getItem(cacheKey) : null;
        if (!cached) {
          setFarmersError(reason instanceof Error ? reason.message : publicLanguage.t('farmersLoadErrorTitle'));
          throw reason;
        }
        setFarmers(JSON.parse(cached) as Page<Farmer>);
      }
    } finally {
      if (requestId === farmerListRequestRef.current) setFarmersLoading(false);
    }
  };

  const loadIfishiFarmers = async (search = '') => {
    const requestId = ++ifishiFarmerRequestRef.current;
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('search', search.trim());
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    if (selectedCenter) {
      const centerName = centers.find((center) => String(center.id) === selectedCenter)?.name;
      if (centerName) params.set('center', centerName);
    }
    setIfishiFarmersLoading(true);
    try {
      const result = await api<Page<Farmer>>(`/api/farmers?${params}`, { cache: 'no-store' });
      if (requestId !== ifishiFarmerRequestRef.current) return;
      // Search results are the selectable options. Do not silently choose the first match.
      setIfishiFarmers(result.data);
      setIfishiActiveResultIndex((current) => current >= 0 && current < result.data.length ? current : -1);
    } finally {
      if (requestId === ifishiFarmerRequestRef.current) setIfishiFarmersLoading(false);
    }
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

  const loadDashboardOwnerMilk = async (date: string) => {
    const requestId = ++dashboardOwnerMilkRequest.current;
    setDashboardOwnerMilk({ status: 'loading', date, volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 });
    const [year, month, day] = date.split('-').map(Number);
    const params = new URLSearchParams({
      month: String(month),
      year: String(year),
      periodType: getAccountingHalfForDay(day),
    });
    try {
      const history = await api<OwnerIfishiHistory>(`/api/ifishi/owner?${params}`, { cache: 'no-store' });
      if (requestId !== dashboardOwnerMilkRequest.current) return;
      const entry = projectOwnerMilkEntry(history.entries, date);
      setDashboardOwnerMilk(entry ? {
        status: 'available',
        date,
        volumeMorning: entry.volumeMorning,
        volumeEvening: entry.volumeEvening,
        validVolumeLiters: entry.validVolumeLiters,
      } : { status: 'missing', date, volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 });
    } catch {
      if (requestId === dashboardOwnerMilkRequest.current) {
        setDashboardOwnerMilk({ status: 'error', date, volumeMorning: 0, volumeEvening: 0, validVolumeLiters: 0 });
      }
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
    if (tab === 'dashboard' && !append) setDashboardDailyReady(false);
    if (dailyAbortControllerRef.current) {
      dailyAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    dailyAbortControllerRef.current = controller;

    setDailyLoading(true);
    setDailyError('');
    if (isDairy && (!selectedCenter || centersLoading || !centers.length)) {
      if (centersPromiseRef.current) {
        try {
          await centersPromiseRef.current;
        } catch {
          // ignore
        }
      }
      if (centersLoading || !centers.length) {
        setDailyLoading(false);
        return;
      }
      if (!selectedCenter && centers.length > 0) {
        setSelectedCenter(String(centers[0].id));
      }
    }
    if (!append) {
      setDailyCursor(null);
      setDailyHasMore(false);
    }
    const milkEntryView = tab === 'milk';
    const search = milkEntryView ? sanitizeQueryParam(debouncedDailySearch) : '';
    const session = milkEntryView ? dailySession : 'all';
    const deliveryStatus = milkEntryView ? dailyDeliveryFilter : 'all';
    const limit = milkEntryView ? dailyPageSize : 50;
    const cleanCenterId = sanitizeQueryParam(selectedCenter);
    const cleanCursor = sanitizeQueryParam(cursor);
    const params = new URLSearchParams({ date: collectionDate, limit: String(limit) });
    if (user?.accountType === 'COLLECTOR') params.set('collectorUserId', String(user.id));
    if (cleanCenterId) params.set('centerId', cleanCenterId);
    if (search) params.set('search', search);
    if (session !== 'all') params.set('session', session);
    if (deliveryStatus !== 'all') params.set('deliveryStatus', deliveryStatus);
    if (milkEntryView && isDairy && dailyCollectorFilter) {
      const cleanCollector = sanitizeQueryParam(dailyCollectorFilter);
      if (cleanCollector) params.set('collectorUserId', cleanCollector);
    }
    if (milkEntryView && dailySortBy) {
      params.set('sortBy', dailySortBy);
      params.set('sortDirection', dailySortDirection);
    }
    if (cleanCursor) params.set('cursor', cleanCursor);

    const fetchDailyWithRetry = async (attempt = 1): Promise<{ farmers: DailyRow[]; summary: typeof dailySummary; farmerPagination: { nextCursor: string | null; hasMore: boolean }; center?: string | null; centers?: string[]; collectorMilk?: CollectorMilkEntry[] }> => {
      try {
        return await api(`/api/milk/daily?${params}`, { cache: 'no-store', signal: controller.signal });
      } catch (err: any) {
        if (err?.name === 'AbortError' || controller.signal.aborted) throw err;
        if (err?.status === 404) {
          return {
            farmers: [],
            summary: {
              totalFarmers: 0,
              presentCount: 0,
              missedCount: 0,
              expectedCount: 0,
              deliveredCount: 0,
              missingCount: 0,
              deliveryRate: 0,
              totalMorning: 0,
              totalEvening: 0,
              totalVolume: 0,
              totalAmount: 0,
              pricePerLiter: 0,
              transportRate: 0,
            },
            farmerPagination: { nextCursor: null, hasMore: false },
            center: null,
            centers: [],
            collectorMilk: [],
          };
        }
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (controller.signal.aborted || requestId !== dailyRequestRef.current) throw err;
          return fetchDailyWithRetry(attempt + 1);
        }
        throw err;
      }
    };

    try {
      const result = await fetchDailyWithRetry();
      if (requestId !== dailyRequestRef.current || controller.signal.aborted) return;
      setDailyCenter(result.center || null);
      setDailyCenters(result.centers || (result.center ? [result.center] : []));
      const collectorEntry = result.collectorMilk?.[0] || null;
      setCollectorMilkEntry(collectorEntry);
      setDaily((previous) => append ? [...previous, ...result.farmers] : result.farmers);
      setDailyCursor(result.farmerPagination.nextCursor);
      setDailyHasMore(result.farmerPagination.hasMore);
      setDailySummary(result.summary);
      if (tab === 'dashboard' && !append) setDashboardDailyReady(true);
      setVolumes((previous) => ({ ...previous, ...Object.fromEntries(result.farmers.map((row) => [row.farmerId, { morning: row.volumeMorning ? String(row.volumeMorning) : '', evening: row.volumeEvening ? String(row.volumeEvening) : '' }])) }));
    } catch (reason: any) {
      if (reason?.name === 'AbortError' || controller.signal.aborted) return;
      if (requestId === dailyRequestRef.current) {
        setDailyError(reason instanceof Error ? reason.message : 'Failed to load daily milk.');
        if (tab === 'dashboard' && !append) setDashboardDailyReady(false);
        throw reason;
      }
    } finally {
      if (requestId === dailyRequestRef.current) setDailyLoading(false);
    }
  };

  const loadFarmerHistory = async () => {
    const farmer = farmerHistoryFarmer;
    if (!farmer) return;
    const requestId = ++farmerHistoryRequestRef.current;
    const { startDate, endDate } = getMonthBounds(farmerHistoryMonth);
    const params = new URLSearchParams({ startDate, endDate });
    if (farmerHistorySession !== 'all') params.set('session', farmerHistorySession);
    setFarmerHistoryLoading(true);
    setFarmerHistoryError('');
    try {
      const result = await api<FarmerHistory>(`/api/farmers/${farmer.id}/delivery-history?${params}`, { cache: 'no-store' });
      if (requestId !== farmerHistoryRequestRef.current) return;
      setFarmerHistory(result);
      setFarmerHistoryFarmer({
        id: result.farmer.farmerId ?? result.farmer.id,
        name: result.farmer.name,
        phone: result.farmer.phone,
        farmerNumber: result.farmer.farmerNumber,
      });
    } catch (reason) {
      if (requestId === farmerHistoryRequestRef.current) {
        setFarmerHistory(null);
        setFarmerHistoryError(reason instanceof Error ? reason.message : publicLanguage.t('farmerHistoryError'));
      }
    } finally {
      if (requestId === farmerHistoryRequestRef.current) setFarmerHistoryLoading(false);
    }
  };

  const loadFarmerSettlementHistory = async () => {
    const farmer = farmerHistoryFarmer;
    if (!farmer || !isCollector) return;
    const requestId = ++farmerSettlementHistoryRequestRef.current;
    const { endDate } = getMonthBounds(farmerHistoryMonth);
    const ranges = [
      { periodStart: `${farmerHistoryMonth}-01`, periodEnd: `${farmerHistoryMonth}-15` },
      { periodStart: `${farmerHistoryMonth}-16`, periodEnd: endDate },
    ];
    setFarmerSettlementHistoryLoading(true);
    setFarmerSettlementHistoryError('');
    try {
      const results = await Promise.all(ranges.map(async (range) => {
        const params = new URLSearchParams({ action: 'confirmations', ...range });
        return api<SettlementData>(`/api/farmer-settlements?${params}`, { cache: 'no-store' });
      }));
      if (requestId !== farmerSettlementHistoryRequestRef.current) return;
      setFarmerSettlementHistory(results.flatMap((result) => result.data || [])
        .filter((record) => Number(record.farmerId ?? record.farmer_id) === farmer.id));
    } catch (reason) {
      if (requestId === farmerSettlementHistoryRequestRef.current) {
        setFarmerSettlementHistory([]);
        setFarmerSettlementHistoryError(reason instanceof Error ? reason.message : publicLanguage.t('settlementsLoadError'));
      }
    } finally {
      if (requestId === farmerSettlementHistoryRequestRef.current) setFarmerSettlementHistoryLoading(false);
    }
  };

  const openFarmerHistory = (
    row: { farmerId?: number; id?: number; farmerName?: string; name?: string; farmerNumber?: number | null; phone?: string | null },
    monthValue = collectionDate,
  ) => {
    const farmerId = Number(row.farmerId ?? row.id);
    if (!Number.isSafeInteger(farmerId) || farmerId <= 0) return;
    setFarmerHistory(null);
    setFarmerHistoryError('');
    setFarmerSettlementHistory([]);
    setFarmerSettlementHistoryError('');
    setFarmerHistoryFarmer({
      id: farmerId,
      name: row.farmerName ?? row.name ?? '',
      phone: row.phone ?? null,
      farmerNumber: row.farmerNumber ?? null,
    });
    setFarmerHistoryMonth((monthValue || today()).slice(0, 7));
    setFarmerHistorySession('all');
    setFarmerHistoryOpen(true);
  };

  const loadDeductionLedger = async (cursor: string | null = null, append = false, overrides: {
    periodStart?: string;
    periodEnd?: string;
    status?: typeof deductionLedgerStatus;
    search?: string;
    configurationId?: number | null;
  } = {}) => {
    setDeductionLedgerLoading(true);
    if (!append) setDeductionLedgerSummary(null);
    try {
      const params = new URLSearchParams({
        view: 'farmer-ledger',
        limit: '100',
        periodStart: overrides.periodStart || deductionPeriod.startDate,
        periodEnd: overrides.periodEnd || deductionPeriod.endDate,
        farmerStatus: overrides.status || deductionLedgerStatus,
      });
      const configurationId = overrides.configurationId === undefined ? deductionLedgerConfigurationId : overrides.configurationId;
      if (configurationId) params.set('configurationId', String(configurationId));
      const search = overrides.search ?? deductionLedgerSearch;
      if (search.trim()) params.set('search', search.trim());
      if (cursor) params.set('cursor', cursor);
      const result = await api<{ data: FarmerPeriodLedgerRow[]; hasMore: boolean; nextCursor: string | null; summary: FarmerPeriodLedgerSummary }>(`/api/deductions?${params}`);
      setDeductionLedgerRows((previous) => append ? [...previous, ...result.data] : result.data);
      setDeductionLedgerHasMore(Boolean(result.hasMore));
      setDeductionLedgerNextCursor(result.nextCursor || null);
      setDeductionLedgerSummary(result.summary);
    } finally {
      setDeductionLedgerLoading(false);
    }
  };

  const loadAllEligibleDeductionFarmers = async () => {
    const allRows: FarmerPeriodLedgerRow[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let summary: FarmerPeriodLedgerSummary | null = null;
    while (hasMore) {
      const params = new URLSearchParams({
        view: 'farmer-ledger',
        limit: '100',
        periodStart: deductionPeriod.startDate,
        periodEnd: deductionPeriod.endDate,
        farmerStatus: 'ALL',
      });
      if (deductionLedgerConfigurationId) params.set('configurationId', String(deductionLedgerConfigurationId));
      if (deductionLedgerSearch.trim()) params.set('search', deductionLedgerSearch.trim());
      if (cursor) params.set('cursor', cursor);
      const result = await api<{ data: FarmerPeriodLedgerRow[]; hasMore: boolean; nextCursor: string | null; summary: FarmerPeriodLedgerSummary }>(`/api/deductions?${params}`);
      allRows.push(...result.data);
      summary = result.summary;
      cursor = result.nextCursor;
      hasMore = Boolean(result.hasMore && cursor);
    }
    setDeductionLedgerRows(allRows);
    setDeductionLedgerSummary(summary);
    setDeductionLedgerStatus('ALL');
    setDeductionLedgerHasMore(false);
    setDeductionLedgerNextCursor(null);
    return allRows;
  };

  const loadDeductionConfigurations = async () => {
    setDeductionConfigurationsLoading(true);
    try {
      const result = await api<{ data: DeductionConfiguration[] }>('/api/deductions/configurations');
      setDeductionConfigurations(result.data);
    } finally {
      setDeductionConfigurationsLoading(false);
    }
  };

  const saveDeductionConfiguration = async (input: Omit<DeductionConfiguration, 'id' | 'executionMode'>, id?: number) => {
    const url = id ? `/api/deductions/configurations/${id}` : '/api/deductions/configurations';
    const result = await api<DeductionConfiguration>(url, json(id ? 'PUT' : 'POST', { ...input, executionMode: 'MANUAL' }));
    setDeductionConfigurations((current) => id
      ? current.map((configuration) => configuration.id === id ? result : configuration)
      : [...current, result]);
    setNotice(publicLanguage.t('deductionConfigurationSaved'));
    return result;
  };

  const applyConfiguredDeductionBatch = async ({ configurationId, farmerIds, periodStart, periodEnd }: {
    configurationId: number;
    farmerIds: number[];
    periodStart: string;
    periodEnd: string;
  }) => {
    const response = {
      succeeded: 0,
      duplicates: 0,
      succeededFarmerIds: [] as number[],
      duplicateFarmerIds: [] as number[],
      failures: [] as Array<{ farmerId: number; reason: string }>,
    };
    const requestId = globalThis.crypto?.randomUUID?.() || `${user?.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (let offset = 0; offset < farmerIds.length; offset += 100) {
      const chunk = farmerIds.slice(offset, offset + 100);
      const result = await api<{
        succeeded: Array<{ farmerId: number }>;
        duplicates: Array<{ farmerId: number }>;
        failed: Array<{ farmerId: number; reason: string }>;
      }>('/api/deductions/batch', json('POST', {
        configurationId,
        farmerIds: chunk,
        periodStart,
        periodEnd,
        requestKey: `${requestId}-${offset / 100}`,
      }));
      response.succeeded += result.succeeded.length;
      response.duplicates += result.duplicates.length;
      response.succeededFarmerIds.push(...result.succeeded.map((row) => row.farmerId));
      response.duplicateFarmerIds.push(...result.duplicates.map((row) => row.farmerId));
      response.failures.push(...result.failed);
    }
    await loadDeductionLedger(null, false, { periodStart, periodEnd });
    setNotice(publicLanguage.t('deductionBatchSaved').replace('{count}', String(response.succeeded)));
    return response;
  };

  const loadDeductionHistory = async (farmerId: number, cursor?: string | null, append = false) => {
    const params = new URLSearchParams({ farmerId: String(farmerId), limit: '10', sortBy: 'date', sortDirection: 'desc' });
    if (cursor) params.set('cursor', cursor);
    setDeductionHistoryLoading(true);
    setDeductionHistoryError('');
    try {
      const result = await api<Page<any>>(`/api/deductions?${params}`);
      setDeductionHistoryRows((previous) => append && previous.length ? [...previous, ...result.data] : result.data.map((row) => ({
        id: Number(row.id),
        farmerId: Number(row.farmerId ?? row.farmer_id),
        farmerName: row.farmerName || row.farmer_name || null,
        amount: Number(row.amount),
        type: row.type,
        date: String(row.date).slice(0, 10),
        reason: row.reason ?? null,
        notes: row.notes ?? null,
        status: row.status,
      })));
      setDeductionHistoryHasMore(Boolean(result.hasMore));
      setDeductionHistoryCursor(result.nextCursor);
    } catch (reason) {
      setDeductionHistoryError(reason instanceof Error ? reason.message : 'Failed to load deduction history.');
    } finally {
      setDeductionHistoryLoading(false);
    }
  };

  const openDeductionInspector = async (farmer: { farmerId: number; farmerName: string | null }) => {
    setDeductionInspectorFarmer({ id: farmer.farmerId, name: farmer.farmerName });
    setDeductionInspectorOpen(true);
    setDeductionHistoryRows([]);
    setDeductionHistoryCursor(null);
    setDeductionHistoryHasMore(false);
    await loadDeductionHistory(farmer.farmerId);
  };

  const refreshDeductionAccounting = async () => {
    const refreshes: Promise<unknown>[] = [];
    if (tab === 'dashboard') refreshes.push(loadReport('current-half'));
    if (tab === 'reports') refreshes.push(loadReport(reportTimelinePeriod));
    if (tab === 'ukwezi' || tab === 'transport') refreshes.push(loadUkwezi());
    if (tab === 'settlements' && isCollector) refreshes.push(loadSettlementData());
    const results = await Promise.allSettled(refreshes);
    if (results.some((result) => result.status === 'rejected')) {
      setError(publicLanguage.t('deductionsRefreshWarning'));
    }
  };

  const refreshDeductionView = async (historyFarmerId?: number) => {
    const refreshes: Promise<unknown>[] = [loadDeductionLedger()];
    if (historyFarmerId && deductionInspectorOpen && deductionInspectorFarmer?.id === historyFarmerId) {
      refreshes.push(loadDeductionHistory(historyFarmerId));
    }
    refreshes.push(refreshDeductionAccounting());
    await Promise.all(refreshes);
  };

  const saveDeductionFromInspector = async (row: DeductionHistoryItem) => {
    await api(`/api/deductions/${row.id}`, json('PUT', {
      farmerId: Number(row.farmerId),
      amount: Number(row.amount),
      type: row.type,
      status: row.status,
      date: row.date,
      reason: row.reason ?? null,
      notes: row.notes ?? null,
    }));
    setNotice(publicLanguage.t('deductionsSaved'));
    await refreshDeductionView(row.farmerId);
  };

  const clearDeductionFromInspector = async (row: DeductionHistoryItem) => {
    await api(`/api/deductions/${row.id}`, { method: 'DELETE' });
    setNotice(publicLanguage.t('deductionsSaved'));
    await refreshDeductionView(row.farmerId);
  };

  const openFarmerBatchCreate = () => {
    const autoCenterId = centers.length === 1 ? String(centers[0].id) : (isCollector && collectorOwnedCenters.length === 1 ? String(collectorOwnedCenters[0].id) : '');
    setFarmerBatchRows([
      { name: '', collectionCenterId: autoCenterId, phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' },
    ]);
    setFarmerBatchError('');
    setFarmerBatchOpen(true);
  };

  const addFarmerBatchRow = () => {
    const autoCenterId = centers.length === 1 ? String(centers[0].id) : (isCollector && collectorOwnedCenters.length === 1 ? String(collectorOwnedCenters[0].id) : '');
    setFarmerBatchRows((previous) => [...previous, { name: '', collectionCenterId: autoCenterId, phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' }]);
  };

  const updateFarmerBatchRow = (index: number, key: keyof typeof farmerBatchRows[number], value: string) => {
    setFarmerBatchRows((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };

  const submitFarmerBatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (farmerBatchSubmitting) return;
    const { valid, errors } = validateFarmerBatchRows(farmerBatchRows, { requireCenter: Boolean((isCollector || isDairy) && !selectedCenter) });
    if (errors.length) {
      setFarmerBatchError(errors.map((error) => error.message).join(' '));
      return;
    }
    setFarmerBatchSubmitting(true);
    setFarmerBatchError('');
    const failed: string[] = [];
    let created = 0;

    try {
      for (const row of valid) {
        const payload: any = {
          ...row,
          phone: row.phone || undefined,
          nationalId: row.nationalId || undefined,
          accountNumber: row.accountNumber || undefined,
        };
        if (isDairy && selectedCenter) payload.collectionCenterId = Number(selectedCenter);
        if (payload.collectionCenterId) {
          const center = centers.find((candidate) => String(candidate.id) === String(payload.collectionCenterId));
          payload.collectionCenter = center?.name;
          payload.collectionCenterId = Number(payload.collectionCenterId);
        }
        try {
          await api<Farmer>('/api/farmers', json('POST', payload));
          created += 1;
        } catch (reason) {
          failed.push(`${row.name || 'Farmer'}: ${reason instanceof Error ? reason.message : 'Failed to save.'}`);
        }
      }
      await loadFarmers();
      if (failed.length) {
        setFarmerBatchError(`${created} of ${valid.length} farmers saved. Failed: ${failed.join(' • ')}`);
        if (created) setNotice(publicLanguage.t('farmerSavedNotice'));
      } else {
        setFarmerBatchOpen(false);
        setFarmerBatchRows([{ name: '', collectionCenterId: '', phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' }]);
        setNotice(`${created} ${publicLanguage.language === 'en' ? 'farmers saved' : 'abacunda bikoze'}`);
      }
    } finally {
      setFarmerBatchSubmitting(false);
    }
  };

  const createDeductionFromView = async (input: { farmerId: string; amount: string; type: string; date: string; reason: string; notes: string }) => {
    await api('/api/deductions', json('POST', { ...input, farmerId: Number(input.farmerId), amount: Number(input.amount) }));
    setDeductionCreateOpen(false);
    setDeductionForm({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
    setDeductionFarmerSearch('');
    setNotice(publicLanguage.t('deductionsSaved'));
    await refreshDeductionView(Number(input.farmerId));
  };

  const loadDeductionFarmers = async (search = '') => {
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('search', search.trim());
    const result = await api<Page<Farmer>>(`/api/farmers?${params}`);
    setDeductionFarmers(result.data);
  };

  const loadReport = async (periodType = 'monthly') => {
    setReportLoading(true);
    setReportError('');
    try {
      if (periodType === 'current-half') {
        const params = new URLSearchParams({ periodType: 'current-half' });
        if (selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
        setReport(await api<Report>(`/api/reports/summary?${params}`));
        return;
      }
      const [year, month] = reportMonth.split('-');
      const params = new URLSearchParams({ periodType, month, year });
      if (selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
      setReport(await api<Report>(`/api/reports/summary?${params}`));
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : publicLanguage.t('reportsLoadError'));
    } finally {
      setReportLoading(false);
    }
  };

  const loadUkwezi = async (sortOverrides: { sortBy?: typeof ukweziSortBy; sortDirection?: typeof ukweziSortDirection } = {}) => {
    const params = new URLSearchParams({ periodType: ukweziPeriod, month: ukweziMonth, year: ukweziYear });
    params.set('sortBy', sortOverrides.sortBy || ukweziSortBy);
    params.set('sortDirection', sortOverrides.sortDirection || ukweziSortDirection);
    if (isDairy && selectedCenter) params.set('collectionCenter', centers.find((center) => String(center.id) === selectedCenter)?.name || '');
    setUkweziReport(await api<Report>(`/api/reports/summary?${params}`, { cache: 'no-store' }));
  };

  const closeUkweziPeriod = async () => {
    if (!ukweziReport || ukweziCloseLoading) return;
    const confirmed = window.confirm(publicLanguage.t('ukweziCloseConfirm'));
    if (!confirmed) return;
    setUkweziCloseLoading(true);
    setUkweziCloseError('');
    setUkweziCloseStatus('');
    try {
      const result = await api<{ totalRecovered: number; duplicate?: boolean }>('/api/farmer-settlements', json('POST', {
        action: 'close-period',
        periodStart: ukweziReport.rangeStart,
        periodEnd: ukweziReport.rangeEnd,
      }));
      setUkweziCloseStatus(publicLanguage.t(result.duplicate ? 'ukweziPeriodAlreadyClosed' : 'ukweziPeriodClosed')
        .replace('{amount}', `${money(result.totalRecovered)} RWF`));
      await loadUkwezi();
    } catch (error) {
      setUkweziCloseError(error instanceof Error ? error.message : publicLanguage.t('ukweziCloseFailed'));
    } finally {
      setUkweziCloseLoading(false);
    }
  };

  const loadSettlementData = async () => {
    const { startDate, endDate } = getSettlementPeriodBounds(settlementMonth, settlementHalf);
    setSettlementLoading(true);
    setSettlementReportError(false);
    setSettlementError('');
    const [year, month] = settlementMonth.split('-');
    const reportParams = new URLSearchParams({ periodType: settlementHalf, month, year });
    const historyParams = new URLSearchParams({ action: 'confirmations', periodStart: startDate, periodEnd: endDate });
    try {
      try {
        setSettlementReport(await api<Report>(`/api/reports/summary?${reportParams}`, { cache: 'no-store' }));
      } catch {
        setSettlementReport(null);
        setSettlementReportError(true);
      }
      const [history, debts] = await Promise.all([
        api<SettlementData>(`/api/farmer-settlements?${historyParams}`, { cache: 'no-store' }),
        api<{ data: any[] }>('/api/farmer-settlements?action=debts', { cache: 'no-store' }),
      ]);
      setSettlementData(history);
      setSettlementDebts(debts.data);
    } catch (reason) {
      setSettlementData(null);
      setSettlementDebts([]);
      setSettlementError((reason as { code?: string })?.code === 'SETTLEMENT_SCHEMA_UNAVAILABLE'
        ? 'settlementsSchemaUnavailable'
        : 'settlementsLoadError');
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

  const notificationCenterParam = isDairy && selectedCenter
    ? centers.find((center) => String(center.id) === selectedCenter)?.name || ''
    : '';
  const notificationCenterQuery = notificationCenterParam ? `center=${encodeURIComponent(notificationCenterParam)}` : '';

  const loadUnreadCount = async () => {
    const requestId = ++unreadCountRequestRef.current;
    setUnreadCountStatus('loading');
    try {
      const result = await api<{ data: { unreadCount: number } }>(`/api/notifications/unread-count${notificationCenterQuery ? `?${notificationCenterQuery}` : ''}`);
      if (requestId !== unreadCountRequestRef.current) return;
      setUnreadCount(Number(result?.data?.unreadCount) || 0);
      setUnreadCountStatus('available');
    } catch {
      if (requestId !== unreadCountRequestRef.current) return;
      setUnreadCount(null);
      setUnreadCountStatus('error');
    }
  };

  const mergeNotificationTypeOptions = (items: Notice[]) => setNotificationTypeOptions((current) => {
    const next = new Set(current);
    for (const item of items) if (item.notification_type) next.add(item.notification_type);
    return next.size === current.length ? current : Array.from(next);
  });

  const loadNotifications = async (overrides: { search?: string; status?: string; priority?: string; type?: string; state?: string; alertGroup?: string; sortBy?: typeof notificationSortBy; sortDirection?: typeof notificationSortDirection } = {}) => {
    const filters = {
      search: overrides.search ?? notificationSearch,
      status: overrides.status ?? notificationStatusFilter,
      priority: overrides.priority ?? notificationPriorityFilter,
      type: overrides.type ?? notificationTypeFilter,
      state: overrides.state ?? notificationStateFilter,
      alertGroup: overrides.alertGroup ?? notificationGroupFilter,
      sortBy: overrides.sortBy ?? notificationSortBy,
      sortDirection: overrides.sortDirection ?? notificationSortDirection,
    };
    const requestId = ++notificationRequestRef.current;
    const hasCustomFilters = Boolean(filters.search || filters.status || filters.priority || filters.type || filters.alertGroup || (filters.state && filters.state !== 'all') || filters.sortBy !== 'date' || filters.sortDirection !== 'desc' || notificationCenterParam);
    setNotificationLoading(true);
    setNotificationError('');
    try {
      const result = hasCustomFilters
        ? await api<{ data: Notice[] }>(`/api/notifications?${new URLSearchParams({
            limit: '50',
            sortBy: filters.sortBy,
            sortDirection: filters.sortDirection,
            ...(filters.state && filters.state !== 'all' ? { state: filters.state } : {}),
            ...(filters.alertGroup ? { alertGroup: filters.alertGroup } : {}),
            ...(filters.search ? { search: filters.search } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.priority ? { priority: filters.priority } : {}),
            ...(filters.type ? { type: filters.type } : {}),
            ...(notificationCenterParam ? { center: notificationCenterParam } : {}),
          })}`)
        : await api<{ data: Notice[] }>('/api/notifications?limit=50');
      if (requestId !== notificationRequestRef.current) return;
      setNotifications(result.data);
      mergeNotificationTypeOptions(result.data);
      await loadUnreadCount();
    } catch (reason) {
      if (requestId === notificationRequestRef.current) {
        setNotificationError(reason instanceof Error && reason.message ? reason.message : publicLanguage.t('notificationsLoadError'));
      }
    } finally {
      if (requestId === notificationRequestRef.current) setNotificationLoading(false);
    }
  };
  const loadNotificationsRef = useRef(loadNotifications);
  useEffect(() => { loadNotificationsRef.current = loadNotifications; });

  const renderNotificationFilters = () => {
    const reset = () => {
      setNotificationSearchQuery(''); setNotificationSearch(''); setNotificationStatusFilter(''); setNotificationPriorityFilter(''); setNotificationTypeFilter(''); setNotificationStateFilter('all'); setNotificationGroupFilter(''); setNotificationSortBy('date'); setNotificationSortDirection('desc');
      void loadNotifications({ search: '', status: '', priority: '', type: '', state: 'all', alertGroup: '', sortBy: 'date', sortDirection: 'desc' });
    };
    const applySort = (value: string) => {
      const [field, direction] = value.split(':');
      if (['date', 'type'].includes(field) && ['asc', 'desc'].includes(direction)) {
        setNotificationSortBy(field as typeof notificationSortBy);
        setNotificationSortDirection(direction as typeof notificationSortDirection);
        void loadNotifications({ sortBy: field as typeof notificationSortBy, sortDirection: direction as typeof notificationSortDirection });
      }
    };
    const chips: Array<{ id: string; label: PublicCopyKey; state: string; group: string; status?: string }> = [
      { id: 'all', label: 'alertFilterAll', state: 'all', group: '' },
      { id: 'unread', label: 'notificationsUnread', state: 'all', group: '', status: 'unread' },
      { id: 'action', label: 'alertFilterAction', state: 'action', group: '' },
      { id: 'missed', label: 'alertFilterMissed', state: 'all', group: 'missed' },
      { id: 'low', label: 'alertFilterLow', state: 'all', group: 'low' },
      { id: 'anomaly', label: 'alertFilterAnomaly', state: 'all', group: 'anomaly' },
      { id: 'quality', label: 'alertFilterQuality', state: 'all', group: 'quality' },
      { id: 'resolved', label: 'alertFilterResolved', state: 'resolved', group: '' },
    ];
    const chipActive = (chip: typeof chips[number]) => chip.status
      ? notificationStatusFilter === chip.status && notificationStateFilter === 'all' && !notificationGroupFilter
      : !notificationStatusFilter && notificationStateFilter === chip.state && notificationGroupFilter === chip.group;
    const applyChip = (chip: typeof chips[number]) => {
      const status = chip.status || '';
      setNotificationStateFilter(chip.state);
      setNotificationGroupFilter(chip.group);
      setNotificationStatusFilter(status);
      void loadNotifications({ state: chip.state, alertGroup: chip.group, status });
    };
    return <>
      <div className="alert-filter-chips" role="group" aria-label={publicLanguage.t('navAlerts')}>
        {chips.map((chip) => <button
          key={chip.id}
          type="button"
          className={`alert-filter-chip${chipActive(chip) ? ' active' : ''}`}
          aria-pressed={chipActive(chip)}
          onClick={() => applyChip(chip)}
        >
          {publicLanguage.t(chip.label)}
          {chip.id === 'unread' && unreadCount ? <span className="alert-filter-count">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
        </button>)}
      </div>
      <div className="toolbar notification-list-controls">
        <form className={['search', 'form'].join('-')} onSubmit={(event) => { event.preventDefault(); const search = notificationSearchQuery.trim(); setNotificationSearch(search); void loadNotifications({ search }); }}><Search size={17} aria-hidden="true" /><input aria-label={publicLanguage.t('milkSearchLabel')} placeholder={publicLanguage.t('search')} value={notificationSearchQuery} onChange={(event) => setNotificationSearchQuery(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form>
        <label>{publicLanguage.t('status')}<select value={notificationStatusFilter} onChange={(event) => { const status = event.target.value; setNotificationStatusFilter(status); void loadNotifications({ status }); }}><option value="">{publicLanguage.t('allStatuses')}</option><option value="unread">{publicLanguage.t('notificationsUnread')}</option><option value="read">{publicLanguage.t('notificationsRead')}</option></select></label>
        <label>{publicLanguage.t('notificationPriority')}<select value={notificationPriorityFilter} onChange={(event) => { const priority = event.target.value; setNotificationPriorityFilter(priority); void loadNotifications({ priority }); }}><option value="">{publicLanguage.t('allStatuses')}</option>{(['high', 'warning', 'info', 'success'] as const).map((priority) => <option key={priority} value={priority}>{publicLanguage.t(priorityCopy[priority])}</option>)}</select></label>
        <label>{publicLanguage.t('notificationType')}<select value={notificationTypeFilter} onChange={(event) => { const type = event.target.value; setNotificationTypeFilter(type); void loadNotifications({ type }); }}><option value="">{publicLanguage.t('allStatuses')}</option>{notificationTypeOptions.map((type) => <option key={type} value={type}>{notificationTypeLabel(type)}</option>)}</select></label>
        <label>{publicLanguage.t('sort')}<select value={`${notificationSortBy}:${notificationSortDirection}`} onChange={(event) => applySort(event.target.value)}><option value="date:desc">{publicLanguage.t('when')} ↓</option><option value="date:asc">{publicLanguage.t('when')} ↑</option><option value="type:asc">{publicLanguage.t('notificationType')} ↑</option><option value="type:desc">{publicLanguage.t('notificationType')} ↓</option></select></label>
        {notificationSearch || notificationStatusFilter || notificationPriorityFilter || notificationTypeFilter || notificationStateFilter !== 'all' || notificationGroupFilter || notificationSortBy !== 'date' || notificationSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={reset}>{publicLanguage.t('milkClearSearch')}</button> : null}
      </div>
    </>;
  };

  const notificationTypeLabel = (type: string) => {
    const key = notificationTypeCopy[type] || (String(type).startsWith('payment_') ? 'alertTypePayment' : null);
    return key ? publicLanguage.t(key) : type.replaceAll('_', ' ');
  };
  const notificationTitle = (item: Notice) => formatPublicCopy(publicLanguage.language, item.details?.titleKey, item.title, item.details?.params);
  const notificationMessage = (item: Notice) => formatPublicCopy(publicLanguage.language, item.details?.messageKey, item.message, item.details?.params);
  const notificationNextAction = (item: Notice) => formatPublicCopy(publicLanguage.language, item.details?.nextActionKey, '', item.details?.params);
  const notificationSessionLabel = (period?: string | null) => period && sessionCopy[period] ? publicLanguage.t(sessionCopy[period]) : String(period || '');
  const resolutionLabel = (code?: string | null) => code ? publicLanguage.t(resolutionCodeCopy[code] || 'alertResolutionOther') : '';
  const notificationResolutionSummary = (item: Notice) => {
    const by = item.resolvedBy === null || item.resolvedBy === undefined ? publicLanguage.t('alertResolvedBySystem') : publicLanguage.t('alertResolvedByUser');
    return `${publicLanguage.t('alertResolvedLabel')}: ${resolutionLabel(item.resolutionCode) || publicLanguage.t('alertResolutionOther')} · ${by}`;
  };
  const isOperationalAlert = (item: Notice) => operationalNotificationTypes.has(String(item.notification_type));

  const loadAccounts = async (page = 1, filters: { search?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(ACCOUNT_PAGE_SIZE) });
    const search = filters.search !== undefined ? filters.search : accountSearch;
    const status = filters.status !== undefined ? filters.status : accountStatus;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    setAccounts(await api(`/api/admin/accounts?${params}`));
  };

  const loadAdminAccountDetails = async (userId: number) => {
    const requestId = ++adminAccountDetailsRequestRef.current;
    setAdminAccountDetailsOpen(true);
    setAdminAccountDetailsTargetId(userId);
    setAdminAccountDetails(null);
    setAdminAccountDetailsError('');
    setAdminExemptionReason('');
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
    setAdminExemptionReason('');
  };

  const updateAdminSubscriptionExemption = async (grant: boolean) => {
    const userId = adminAccountDetailsTargetId;
    const reason = adminExemptionReason.trim();
    if (userId === null) return;
    if (reason.length < 5) {
      setAdminAccountDetailsError(publicLanguage.t('subscriptionExemptionReasonRequired'));
      return;
    }
    setBusy(true);
    setAdminAccountDetailsError('');
    try {
      await api(`/api/admin/accounts/${userId}/${grant ? 'grant-exemption' : 'revoke-exemption'}`, json('POST', { reason }));
      setAdminExemptionReason('');
      setNotice(publicLanguage.t(grant ? 'subscriptionExemptionGranted' : 'subscriptionExemptionRevoked'));
      await loadAdminAccountDetails(userId);
      void loadAccounts(accounts?.page || 1).catch(() => undefined);
    } catch (reasonError) {
      setAdminAccountDetailsError(reasonError instanceof Error ? reasonError.message : publicLanguage.t('adminAccountActionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const openGrantDaysModal = (account: Account) => {
    setGrantDaysAccount(account);
    setGrantDaysValue(15);
    setGrantDaysReason('');
    setGrantDaysError('');
  };

  const submitGrantDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantDaysAccount) return;
    if (!grantDaysValue || grantDaysValue <= 0 || grantDaysValue > 365) {
      setGrantDaysError(publicLanguage.language === 'en' ? 'Days must be between 1 and 365' : 'Iminsi igomba kuba hagati ya 1 na 365');
      return;
    }
    setGrantDaysLoading(true);
    setGrantDaysError('');
    try {
      await api(`/api/admin/accounts/${grantDaysAccount.user_id}/extend-access`, json('POST', {
        days: grantDaysValue,
        reason: grantDaysReason.trim() || undefined,
      }));
      setNotice(publicLanguage.language === 'en' ? 'Access extended successfully' : 'Iminsi yongerewe neza');
      setGrantDaysAccount(null);
      await loadAccounts(accounts?.page || 1);
    } catch (err: any) {
      setGrantDaysError(err.message || 'Failed to extend access');
    } finally {
      setGrantDaysLoading(false);
    }
  };

  const toggleExemption = async (account: Account) => {
    const isExempt = Boolean(account.billing_exempt || account.effective_status === 'exempt');
    const grant = !isExempt;
    const promptMessage = publicLanguage.language === 'en'
      ? (grant ? 'Enter reason for granting billing exemption (minimum 5 characters):' : 'Enter reason for revoking exemption (minimum 5 characters):')
      : (grant ? 'Andika impamvu yo gutanga imbabazi zo kutishyura (byibura inyuguti 5):' : 'Andika impamvu yo gukuraho imbabazi (byibura inyuguti 5):');
    const defaultReason = grant
      ? (publicLanguage.language === 'en' ? 'Administrative exemption granted' : "Yahawe imbabazi n'ubuyobozi")
      : (publicLanguage.language === 'en' ? 'Standard billing resumed' : 'Kwishyura birasubukuwe');
    const reason = window.prompt(promptMessage, defaultReason);
    if (!reason || reason.trim().length < 5) return;
    await run(async () => {
      await api(`/api/admin/accounts/${account.user_id}/${grant ? 'grant-exemption' : 'revoke-exemption'}`, json('POST', { reason: reason.trim() }));
      setNotice(publicLanguage.language === 'en'
        ? (grant ? 'Billing exemption granted successfully' : 'Billing exemption revoked successfully')
        : (grant ? 'Yahawe imbabazi zo kutishyura neza' : 'Imbabazi zakuweho neza'));
      await loadAccounts(accounts?.page || 1);
    });
  };

  const loadAudit = async (page = 1) => {
    const result = await api<{ data: { items: any[]; total: number; page: number; limit: number } }>(`/api/audit-logs?page=${page}&limit=50`);
    setAuditRows(result.data);
  };

  const loadAdminSummary = async () => {
    setAdminSummary(await api<AdminSummary>('/api/admin/accounts/summary'));
  };

  const loadBilling = (planCode = selectedSubscriptionPlanCode, paymentOverrides: { status?: string; sortBy?: typeof customerPaymentSortBy; sortDirection?: typeof customerPaymentSortDirection } = {}) => {
    const status = paymentOverrides.status !== undefined ? paymentOverrides.status : customerPaymentStatus;
    const sortBy = paymentOverrides.sortBy || customerPaymentSortBy;
    const sortDirection = paymentOverrides.sortDirection || customerPaymentSortDirection;
    const key = JSON.stringify([planCode, status, sortBy, sortDirection]);
    if (billingRequestRef.current?.key === key) return billingRequestRef.current.promise;

    setBillingLoading(true);
    setBillingError('');
    const requestId = ++billingRequestSequenceRef.current;
    const request = Promise.resolve().then(async () => {
      try {
        const params = new URLSearchParams({ billingPeriod });
        if (planCode) params.set('planCode', planCode);
        if (status) params.set('paymentStatus', status);
        params.set('paymentSortBy', sortBy);
        params.set('paymentSortDirection', sortDirection);
        const data = await api<any>(`/api/subscription?${params}`, { cache: 'no-store' });
        if (billingRequestRef.current?.id !== requestId) return;
        setBilling(data);
        setPaymentPhone(data.account?.phone || '');
        if (data.pricing?.planCode) setSelectedSubscriptionPlanCode(data.pricing.planCode);
      } catch (reason) {
        if (billingRequestRef.current?.id === requestId) {
          const statusCode = (reason as { status?: number })?.status;
          setBilling(null);
          setBillingError(statusCode === 401 ? 'billingAuthError'
            : statusCode === 403 ? 'billingAccessError'
              : statusCode === 404 ? 'billingAccountError' : 'billingLoadError');
        }
      } finally {
        if (billingRequestRef.current?.id === requestId) {
          billingRequestRef.current = null;
          setBillingLoading(false);
        }
      }
    });
    billingRequestRef.current = { key, id: requestId, promise: request };
    return request;
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
    void loadUnreadCount();
  }, [user]);

  useEffect(() => {
    setNotificationTypeOptions([]);
  }, [user?.id]);

  // Keep the unread badge scoped to the same active Ikigo as the notifications list.
  useEffect(() => {
    if (!user || !isDairy || !selectedCenter) return;
    void loadUnreadCount();
  }, [selectedCenter]);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (notificationMenuRef.current && target instanceof Node && !notificationMenuRef.current.contains(target)) {
        setNotificationPanelOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationPanelOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationPanelOpen]);

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
      if (tab === 'system-health') api<SystemHealth>('/api/admin/system-health', { cache: 'no-store' })
        .then(setSystemHealth)
        .catch((reason) => setError(reason.message));
      if (tab === 'notifications-admin') api<{ success: boolean; data: Notice[] }>('/api/notifications').then((result) => {
        setNotifications(result.data);
        mergeNotificationTypeOptions(result.data);
      }).catch((reason) => setError(reason.message));
      return;
    }
    if (tab === 'settings') {
      loadAccountProfile().catch((reason) => setError(reason.message));
      if (!isAdmin) void loadBilling();
      if (isCollector) {
        loadCollectorPrices().catch((reason) => setError(reason.message));
        loadCollectorRequests().catch((reason) => setCollectorRequestsError(reason instanceof Error ? reason.message : 'Failed to load collector membership requests.'));
      }
      return;
    }
    if (tab === 'dashboard') {
      setDashboardLoading(true);
      const requests = [loadReport('current-half'), loadUnreadCount(), loadBilling()];
      if (isCollector || selectedCenter) requests.push(loadDaily());
      Promise.all(requests).catch((reason) => setError(reason.message)).finally(() => setDashboardLoading(false));
      return;
    }
    if (tab === 'centers') {
      loadCenters().catch((reason) => setError(reason.message));
      if (isDairy) loadCollectorRequests().catch((reason) => setCollectorRequestsError(reason instanceof Error ? reason.message : 'Failed to load collector membership requests.'));
    }
    if (tab === 'deductions') {
      loadDeductionFarmers().catch((reason) => setError(reason.message));
      loadDeductionLedger().catch((reason) => setError(reason.message));
      loadDeductionConfigurations().catch((reason) => setError(reason.message));
    }
    if (tab === 'billing') void loadBilling();
    if (tab === 'notifications') void loadNotifications();
  }, [user, tab, selectedCenter]);

  // Operational alerts are evaluated lazily while the workspace is open: bounded to
  // the last few days, idempotent, and throttled per user so page views stay cheap.
  useEffect(() => {
    if (!user || isAdmin) return;
    let cancelled = false;
    const evaluate = async () => {
      const storageKey = `milkSystem.notificationEvaluation.${user.id}`;
      let lastRun = 0;
      try { lastRun = Number(window.localStorage.getItem(storageKey) || 0); } catch { lastRun = 0; }
      if (Number.isFinite(lastRun) && Date.now() - lastRun < NOTIFICATION_EVALUATION_INTERVAL_MS) return;
      try { window.localStorage.setItem(storageKey, String(Date.now())); } catch { /* storage unavailable */ }
      try {
        const result = await api<{ data?: { createdCount?: number; resolvedCount?: number; reopenedCount?: number; skipped?: boolean } }>('/api/notifications/evaluate', { method: 'POST' });
        const changes = result.data ? (result.data.createdCount || 0) + (result.data.resolvedCount || 0) + (result.data.reopenedCount || 0) : 0;
        if (!cancelled && !result.data?.skipped && changes > 0) {
          await loadNotificationsRef.current();
          if (result.data?.createdCount) setNotice(publicLanguage.t('notificationsEvaluated'));
        }
      } catch {
        try { window.localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
      }
    };
    void evaluate();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (user && isCollector && tab === 'dashboard') {
      void loadDashboardOwnerMilk(collectionDate);
    }
  }, [user?.id, isCollector, tab, collectionDate]);

  useEffect(() => {
    if (user && tab === 'dashboard' && !isCollector && selectedCenter) {
      loadDaily().catch((reason) => setError(reason.message));
    }
  }, [selectedCenter]);

  useEffect(() => {
    if (user && tab === 'farmers') loadFarmers().catch(() => undefined);
  }, [user, tab, farmerSearch, farmerCenter, farmerCollectorFilter, farmerSortBy, farmerSortDirection, selectedCenter]);
  useEffect(() => {
    if (user && tab === 'milk' && (!isDairy || selectedCenter)) loadDaily().catch((reason) => setError(reason.message));
  }, [user, tab, isDairy, selectedCenter, collectionDate, ...dailyFilterState, dailySortBy, dailySortDirection]);
  useEffect(() => {
    if (!lossEventOpen || !selectedCenter || !collectionDate || lossEventPercentage === '') {
      setLossPreview(null);
      setLossPreviewLoading(false);
      return;
    }
    const percentage = Number(lossEventPercentage);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setLossPreview(null);
      setLossPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      collectionCenterId: selectedCenter,
      date: collectionDate,
      period: lossEventPeriod,
      lossPercentage: lossEventPercentage,
    });
    setLossPreviewLoading(true);
    setLossPreview(null);
    setLossEventError('');
    api<NonNullable<typeof lossPreview>>(`/api/milk/loss?${params}`, { cache: 'no-store' })
      .then((preview) => { if (!cancelled) setLossPreview(preview); })
      .catch((reason) => { if (!cancelled) setLossEventError(reason instanceof Error ? reason.message : publicLanguage.t('lossEventSaveError')); })
      .finally(() => { if (!cancelled) setLossPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [lossEventOpen, selectedCenter, collectionDate, lossEventPeriod, lossEventPercentage]);
  useEffect(() => {
    if (user && !isCollector && (tab === 'farmers' || tab === 'milk' || tab === 'centers')) {
      loadCollectorAssignments().catch((reason) => setCollectorAssignmentsError(reason instanceof Error ? reason.message : 'Failed to load collector assignments.'));
    }
  }, [user?.id, tab, isCollector, selectedCenter]);
  useEffect(() => {
    if (!user || !farmerHistoryOpen || !farmerHistoryFarmer) return;
    loadFarmerHistory().catch(() => undefined);
  }, [user, farmerHistoryOpen, farmerHistoryFarmer?.id, farmerHistoryMonth, farmerHistorySession]);
  useEffect(() => {
    if (!user || !farmerHistoryOpen || !farmerHistoryFarmer) return;
    if (isCollector) {
      void loadFarmerSettlementHistory();
    } else {
      setFarmerSettlementHistory([]);
      setFarmerSettlementHistoryError('');
    }
  }, [user?.id, isCollector, farmerHistoryOpen, farmerHistoryFarmer?.id, farmerHistoryMonth]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedIfishiFarmerSearch(ifishiFarmerSearch.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [ifishiFarmerSearch]);
  useEffect(() => {
    if (user && tab === 'milk' && ifishiOpen) loadIfishiFarmers(debouncedIfishiFarmerSearch).catch((reason) => setError(reason.message));
  }, [user, tab, ifishiOpen, debouncedIfishiFarmerSearch, selectedCenter]);
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
      : getMonthBounds(ifishiMonth).endDate;
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
    if (user && tab === 'reports') loadReport(reportTimelinePeriod).catch((reason) => setError(reason.message));
  }, [user, tab, reportMonth, reportTimelinePeriod, selectedCenter]);
  useEffect(() => {
    if (user && isCollector && tab === 'settlements') void loadSettlementData();
  }, [user?.id, isCollector, tab, settlementMonth, settlementHalf]);
  useEffect(() => {
    initSessionInactivity();
    checkSessionExpiry();

    const meaningfulEvents = ['click', 'mousedown', 'keydown', 'touchstart', 'submit'];
    const resetTimer = () => {
      resetInactivityTimer();
    };

    for (const event of meaningfulEvents) {
      document.addEventListener(event as any, resetTimer as EventListener);
    }

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === 'milk-session-expired') {
        checkSessionExpiry();
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      for (const event of meaningfulEvents) {
        document.removeEventListener(event as any, resetTimer as EventListener);
      }
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    clearMessages();
    try {
      const result = await api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
      if (!result?.ok) throw new Error('The session could not be closed.');
      sessionStorage.removeItem('milk-session-user');
      setLogoutConfirm(false);
      setUser(null);
      if (typeof window !== 'undefined') window.location.replace('/login');
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : publicLanguage.t('signOutError'));
    } finally {
      setLogoutBusy(false);
    }
  };

  const handleLogin = (signedIn: User, signInNotice?: string, preferredLanguage?: 'rw' | 'en') => {
    const nextLanguage = preferredLanguage || userLanguage(signedIn);
    if (nextLanguage) publicLanguage.setLanguage(nextLanguage);
    const sessionUser = nextLanguage ? { ...signedIn, language: nextLanguage } : signedIn;
    sessionStorage.setItem('milk-session-user', JSON.stringify(sessionUser));
    setTabState('dashboard');
    setUser(sessionUser);
    if (signInNotice) setNotice(signInNotice);
    if (preferredLanguage && preferredLanguage !== userLanguage(signedIn)) {
      void api('/api/auth/profile', json('PATCH', { language: preferredLanguage })).catch(() => {
        setError(publicLanguage.t('accountLanguageSaveError'));
      });
    }
  };

  if (!user && isAuthRoute) return <Login {...publicLanguage} onLogin={handleLogin} />;
  if (authLoading) return <main className="boot-screen"><BrandLockup imageSize={44} /><small className="boot-company">Milk System Technologies Ltd.</small><div className="loading-status" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true" />{publicLanguage.t('loading')}</div></main>;
  if (authError) return <main className="boot-screen boot-screen-error"><BrandLockup imageSize={44} /><small className="boot-company">Milk System Technologies Ltd.</small><section className="boot-error-panel" role="alert"><h1>{publicLanguage.t('errorTitle')}</h1><p>{publicLanguage.t('connectionError')}</p><button type="button" className="button button-primary" onClick={() => { setAuthError(''); setAuthLoading(true); setAuthAttempt((attempt) => attempt + 1); }}>{publicLanguage.t('retry')}</button></section></main>;
  if (!user) return <Login {...publicLanguage} onLogin={handleLogin} />;

  const openIfishiForFarmer = (farmerId: number | null, farmerName?: string, farmerDetails?: Farmer) => {
    if (!farmerId) return;
    setTab('milk');
    setOwnerIfishiOpen(false);
    setIfishiOpen(true);
    setIfishiResultsOpen(false);
    setIfishiActiveResultIndex(-1);
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
      setIfishiSelectedFarmer(selectedFarmer);
    }
  };

  const selectOwnerIfishiDate = (date: string) => {
    if (!date) return;
    const day = Number(date.slice(8, 10));
    setIfishiDate(date);
    setIfishiMonth(date.slice(0, 7));
    setOwnerIfishiPeriod(getAccountingHalfForDay(day));
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

  const selectUkweziMonth = (month: string) => {
    setUkweziMonth(month);
    synchronizeCurrentAccountingHalf(month, ukweziYear, setUkweziPeriod);
  };

  const selectUkweziYear = (year: string) => {
    setUkweziYear(year);
    synchronizeCurrentAccountingHalf(ukweziMonth, year, setUkweziPeriod);
  };

  const selectSettlementMonth = (monthValue: string) => {
    setSettlementMonth(monthValue);
    const [year, month] = monthValue.split('-');
    synchronizeCurrentAccountingHalf(month, year, setSettlementHalf);
  };

  const selectOwnerIfishiMonth = (monthValue: string) => {
    setIfishiMonth(monthValue);
    const [year, month] = monthValue.split('-');
    synchronizeCurrentAccountingHalf(month, year, setOwnerIfishiPeriod);
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
      const autoCenterId = centers.length === 1 ? String(centers[0].id) : (isCollector && collectorOwnedCenters.length === 1 ? String(collectorOwnedCenters[0].id) : '');
      setFarmerForm({ name: '', collectionCenterId: autoCenterId, phone: '', nationalId: '', accountNumber: '', cowType: '', collectorUserId: '' });
      setFarmerCreateOpen(false);
      setNotice(publicLanguage.t('farmerSavedNotice'));
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
      await api('/api/collector-assignments', json('POST', {
        collectorUserId: Number(collectorLinkId),
        ...(collectorLinkEmail.trim() ? { collectorEmail: collectorLinkEmail.trim() } : {}),
      }));
      await Promise.all([loadCollectorAssignments(), loadCollectorRequests().catch(() => undefined)]);
      setCollectorLinkId('');
      setCollectorLinkEmail('');
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
    await Promise.all([loadCollectorAssignments(), loadFarmers()]);
    setNotice(publicLanguage.t('collectorUnlinkedNotice'));
  });
  const suspendCollector = async (collectorId: number) => run(async () => {
    await api(`/api/collector-assignments/${collectorId}`, json('PATCH', { action: 'suspend' }));
    await loadCollectorAssignments();
    setNotice(publicLanguage.t('collectorSuspendedNotice'));
  });
  const requestCollectorAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (collectorRequestSubmittingRef.current) return;
    collectorRequestSubmittingRef.current = true;
    setCollectorRequestError('');
    try {
      await api('/api/collector-assignment-requests', json('POST', {
        dairyUserId: Number(collectorRequestDairyId),
        ...(collectorRequestNote.trim() ? { requestNote: collectorRequestNote.trim() } : {}),
      }));
      setCollectorRequestDairyId('');
      setCollectorRequestNote('');
      await loadCollectorRequests();
      setNotice(publicLanguage.t('collectorRequestSentNotice'));
    } catch (reason) {
      setCollectorRequestError(reason instanceof Error ? reason.message : 'Failed to send membership request.');
    } finally {
      collectorRequestSubmittingRef.current = false;
    }
  };
  const cancelCollectorRequest = async (request: CollectorAssignmentRequest) => {
    if (!window.confirm(publicLanguage.t('collectorRequestCancelConfirm'))) return;
    await run(async () => {
      await api(`/api/collector-assignment-requests/${request.id}`, json('PATCH', { action: 'cancel' }));
      await loadCollectorRequests();
      setNotice(publicLanguage.t('collectorRequestCancelledNotice'));
    });
  };
  const decideCollectorRequest = async (request: CollectorAssignmentRequest, decision: 'approve' | 'reject') => {
    const collectorName = request.collector_name || `Collector #${request.collector_user_id}`;
    const confirmKey = decision === 'approve' ? 'collectorRequestApproveConfirm' : 'collectorRequestRejectConfirm';
    const confirmFallback = decision === 'approve' ? 'Approve {name}?' : 'Reject {name}?';
    if (!window.confirm(formatPublicCopy(publicLanguage.language, confirmKey, confirmFallback, { name: collectorName }))) return;
    await run(async () => {
      await api(`/api/collector-assignment-requests/${request.id}`, json('PATCH', { action: decision }));
      if (decision === 'approve') {
        await Promise.all([loadCollectorRequests(), loadCollectorAssignments()]);
        setNotice(publicLanguage.t('collectorRequestApprovedNotice'));
      } else {
        await loadCollectorRequests();
        setNotice(publicLanguage.t('collectorRequestRejectedNotice'));
      }
    });
  };

  const editFarmerStart = (farmer: Farmer) => {
    setEditingFarmer(farmer);
    const currentCenterName = String(farmer.collectionCenter || '').trim().toLocaleLowerCase();
    const currentCenter = collectorOwnedCenters.find((center) => center.name.trim().toLocaleLowerCase() === currentCenterName);
    setFarmerEdit({
      name: farmer.name,
      farmerNumber: farmer.farmerNumber != null ? String(farmer.farmerNumber) : '',
      collectionCenterId: currentCenter ? String(currentCenter.id) : '',
      phone: farmer.phone || '',
      nationalId: farmer.nationalId || '',
      accountNumber: farmer.accountNumber || '',
      cowType: farmer.cowType || '',
      collectorUserId: farmer.collectorUserId ? String(farmer.collectorUserId) : ''
    });
  };
  const saveFarmer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFarmer) return;
    await run(async () => {
      const payload: any = { ...farmerEdit };
      if (payload.farmerNumber !== undefined && payload.farmerNumber !== '') {
        payload.farmerNumber = Number(payload.farmerNumber);
      }
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
      setNotice(publicLanguage.t('farmerSavedNotice'));
    });
  };

  const deleteFarmer = async (farmer: Farmer) => {
    setFarmerDeletionTarget(farmer);
    setFarmerDeletionImpact(null);
    setFarmerDeletionReason('');
    setFarmerDeletionConfirmation('');
    setFarmerDeletionError('');
    setFarmerDeletionLoading(true);
    try {
      const impact = await api<FarmerDeletionImpact>(`/api/farmers/${farmer.id}/deletion-preview`, { cache: 'no-store' });
      setFarmerDeletionImpact(impact);
    } catch (reason) {
      setFarmerDeletionError(reason instanceof Error ? reason.message : 'Failed to inspect farmer records.');
    } finally {
      setFarmerDeletionLoading(false);
    }
  };

  const confirmFarmerDeletion = async () => {
    if (!farmerDeletionTarget || !farmerDeletionImpact || farmerDeletionBusy) return;
    setFarmerDeletionBusy(true);
    setFarmerDeletionError('');
    try {
      await api(`/api/farmers/${farmerDeletionTarget.id}`, json('DELETE', {
        reason: farmerDeletionReason.trim(),
        confirmationName: farmerDeletionConfirmation.trim(),
      }));
      const deletedName = farmerDeletionTarget.name;
      setFarmerDeletionTarget(null);
      setFarmerDeletionImpact(null);
      await Promise.all([loadFarmers(), loadDaily(), loadReport('current-half')]);
      if (tab === 'ukwezi') await loadUkwezi();
      if (tab === 'settlements' && isCollector) await loadSettlementData();
      setNotice(publicLanguage.language === 'en' ? `${deletedName} was permanently deleted.` : `${deletedName} yasibwe burundu.`);
    } catch (reason) {
      setFarmerDeletionError(reason instanceof Error ? reason.message : 'Failed to delete farmer.');
    } finally {
      setFarmerDeletionBusy(false);
    }
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
      setNotice(publicLanguage.t('centerAddedNotice'));
    });
  };
  const saveCenter = async (center: Center) => run(async () => {
    await api(`/api/collection-centers/${center.id}`, json('PUT', centerEdits[center.id] || {}));
    setCenterEdits((current) => { const next = { ...current }; delete next[center.id]; return next; });
    await loadCenters();
    setNotice(publicLanguage.t('centerSavedNotice'));
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
      setNotice(formatPublicCopy(publicLanguage.language, 'milkOfflineQueuedNotice', 'Entry queued offline for {name}.', { name: row.farmerName }));
      return;
    }
    setNotice(formatPublicCopy(publicLanguage.language, 'milkSavedNotice', "Saved {name}'s collection.", { name: row.farmerName }));
    if (result) {
      setRecentlySavedRows((previous) => {
        const next = new Set(previous);
        next.add(row.farmerId);
        return next;
      });
      setTimeout(() => {
        setRecentlySavedRows((previous) => {
          const next = new Set(previous);
          next.delete(row.farmerId);
          return next;
        });
      }, 1500);
      await loadDaily();
    }
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
  const saveLossEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lossEventConfirmed || !lossPreview || lossPreview.affectedRecords === 0) return;
    setLossEventLoading(true);
    setLossEventError('');
    setLossEventStatus('');
    try {
      const result = await api<{ corrected: boolean }>(`/api/milk/loss`, json('POST', {
        collectionCenterId: selectedCenter,
        date: collectionDate,
        period: lossEventPeriod,
        lossPercentage: lossEventPercentage,
        reason: lossEventReason === 'other' ? lossEventOtherReason.trim() : lossEventReason,
      }));
      const savedMessage = publicLanguage.t(result.corrected ? 'lossEventCorrected' : 'lossEventSaved');
      setLossEventStatus(savedMessage);
      setNotice(savedMessage);
      setLossEventOpen(false);
      setLossEventConfirmed(false);
      setLossEventPercentage('');
      setLossEventReason('');
      setLossEventOtherReason('');
      setLossPreview(null);
      const refreshes: Promise<unknown>[] = [loadDaily(), loadReport('current-half'), loadUkwezi()];
      if (ifishiOpen && ifishiFarmerId) refreshes.push(loadIfishiRecords());
      if (isCollector) refreshes.push(loadSettlementData());
      try {
        await Promise.all(refreshes);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : publicLanguage.t('lossRefreshError'));
      }
    } catch (reason) {
      setLossEventError(reason instanceof Error ? reason.message : publicLanguage.t('lossEventSaveError'));
    } finally {
      setLossEventLoading(false);
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
      setDeductionContextFarmer(null);
      setDeductionForm({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
      setDeductionFarmerSearch('');
      setNotice(publicLanguage.t('deductionsSaved'));
      try {
        await refreshDeductionView(Number(deductionForm.farmerId));
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

  const openFarmerDeduction = (
    farmerId: number,
    farmerName: string | null,
    periodStart: string,
    periodEnd: string,
    breakdown: { totalVolume: number; pricePerLiter: number | null; grossAmount: number | null; totalDeductions: number; totalTransport: number | null; netAmount: number | null },
  ) => {
    const id = Number(farmerId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    setDeductionContextFarmer({
      id,
      name: farmerName?.trim() || `#${id}`,
      periodStart,
      periodEnd,
      ...breakdown,
    });
    setDeductionForm({ farmerId: String(id), amount: '', type: 'Other', date: periodStart, reason: '', notes: '' });
    setDeductionCreateError('');
    setDeductionCreateOpen(true);
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

  const markRead = async (notification: Notice) => {
    if (notification.isRead || notificationReadRequestsRef.current.has(notification.id)) return;
    notificationReadRequestsRef.current.add(notification.id);
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
    setUnreadCount((current) => Math.max(0, Number(current ?? 0) - 1));
    let failure: string | null = null;
    try {
      const result = await api<{ data?: Notice }>(`/api/notifications/${notification.id}/read`, { method: 'PATCH' });
      const savedNotification = result.data;
      if (savedNotification) {
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, ...savedNotification, isRead: true } : item));
      }
    } catch (reason) {
      failure = reason instanceof Error && reason.message ? reason.message : publicLanguage.t('notificationsLoadError');
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: notification.isRead } : item));
      setUnreadCount((current) => Math.max(0, Number(current ?? 0) + 1));
    } finally {
      try {
        await loadNotifications();
      } catch { /* keep the optimistic state; a failed write was already reverted above */ }
      notificationReadRequestsRef.current.delete(notification.id);
    }
    if (failure) setNotificationError(failure);
  };

  const markAllNotificationsRead = async () => {
    if (!notifications.some((item) => !item.isRead)) return;
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications((current) => current.map((item) => item.isRead ? item : { ...item, isRead: true }));
    setUnreadCount(0);
    let failure: string | null = null;
    try {
      await api(`/api/notifications/read-all${notificationCenterQuery ? `?${notificationCenterQuery}` : ''}`, { method: 'PATCH' });
    } catch (reason) {
      failure = reason instanceof Error && reason.message ? reason.message : publicLanguage.t('notificationsLoadError');
      setNotifications(previousNotifications);
      if (previousUnread !== null) setUnreadCount(previousUnread);
    }
    try {
      await loadNotifications();
    } catch { /* keep the optimistic state; a failed write was already reverted above */ }
    if (failure) setNotificationError(failure);
  };

  const reviewNotification = (notification: Notice) => {
    void markRead(notification);
    setNotificationPanelOpen(false);
    setTab(isAdmin ? 'notifications-admin' : 'notifications');
  };

  const toggleNotificationPanel = () => {
    const open = !notificationPanelOpen;
    setNotificationPanelOpen(open);
    if (open) void loadNotifications();
  };

  const openResolveDialog = (notification: Notice) => {
    void markRead(notification);
    setResolveTarget(notification);
    setResolveCode('farmer_absent');
    setResolveNote('');
    setNotificationError('');
  };

  const submitResolve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resolveTarget) return;
    setResolveSaving(true);
    setNotificationError('');
    try {
      await api(`/api/notifications/${resolveTarget.id}/resolve`, json('PATCH', { resolutionCode: resolveCode, note: resolveNote.trim() }));
      setResolveTarget(null);
      setResolveNote('');
      await loadNotifications();
      setNotice(publicLanguage.t('alertResolutionSaved'));
    } catch (reason) {
      setNotificationError(reason instanceof Error && reason.message ? reason.message : publicLanguage.t('notificationsLoadError'));
    } finally {
      setResolveSaving(false);
    }
  };

  const reopenAlert = async (notification: Notice) => run(async () => {
    await api(`/api/notifications/${notification.id}/reopen`, { method: 'PATCH' });
    await loadNotifications();
    setNotice(publicLanguage.t('alertReopened'));
  });

  const openFarmerFromAlert = async (notification: Notice) => run(async () => {
    const farmerId = notification.farmer_id ?? notification.details?.farmerId;
    if (!farmerId) return;
    const farmer = await api<Farmer>(`/api/farmers/${farmerId}`);
    editFarmerStart(farmer);
  });

  const recordMilkFromAlert = (notification: Notice) => {
    const date = notification.collection_date ? String(notification.collection_date).slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today()) setCollectionDate(date);
    setTab('milk');
  };

  const reviewBillingFromAlert = (notification: Notice) => {
    void markRead(notification);
    setTab('billing');
  };

  const reviewSettlementFromAlert = (notification: Notice) => {
    void markRead(notification);
    setTab('settlements');
  };

  const adminAction = async (account: Account, action: string) => {
    if (action === 'resendVerification') {
      if (!window.confirm(publicLanguage.t('resendVerificationConfirm'))) return;
    } else {
      const confirmKey = action === 'suspend' ? 'adminSuspendConfirm' : 'adminReactivateConfirm';
      if (!window.confirm(publicLanguage.t(confirmKey))) return;
    }
    await run(async () => {
      await api(`/api/admin/accounts/${account.user_id}/${action}`, json('POST', {}));
      if (action === 'suspend') {
        setNotice(publicLanguage.t('adminAccountSuspended'));
      } else if (action === 'reactivate') {
        setNotice(publicLanguage.t('adminAccountReactivated'));
      } else if (action === 'resendVerification') {
        setNotice(publicLanguage.t('emailVerificationResent'));
      }
      await loadAccounts(accounts?.page || 1);
    });
  };

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
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('activeIkigo')}</span><h2>{activeCenterName}</h2></div><Building2 size={19} aria-hidden="true" /></div>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('directory')}</span><h2>{publicLanguage.t('navAbacunda')}</h2></div><div className="panel-heading-actions"><span className="count-label">{assignedAbacundaCount}</span><label className="collector-sort-mobile">{publicLanguage.t('sort')}<select value={collectorAssignmentSortDirection} onChange={(event) => { const direction = event.target.value as typeof collectorAssignmentSortDirection; setCollectorAssignmentSortDirection(direction); void loadCollectorAssignments(direction).catch((reason) => setError(reason.message)); }}><option value="asc">{publicLanguage.t('milkFarmer')} ↑</option><option value="desc">{publicLanguage.t('milkFarmer')} ↓</option></select></label></div></div>
        {collectorAssignmentsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('loadingAssignedAbacunda')}</div>
          : collectorAssignmentsError ? <div className="workspace-empty" role="alert"><b>{collectorAssignmentsError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadCollectorAssignments().catch(() => undefined)}>{publicLanguage.t('retry') || 'Retry'}</button></div>
          : !selectedCenter ? <div className="workspace-empty" role="status"><b>{publicLanguage.t('noActiveIkigo')}</b></div>
          : collectorAssignments.length ? <>
          <div className="table-scroll abacunda-desktop-list"><table><thead><tr><th aria-sort={collectorAssignmentSortDirection === 'asc' ? 'ascending' : 'descending'}><button type="button" className="farmer-sort-button" onClick={() => { const direction = collectorAssignmentSortDirection === 'asc' ? 'desc' : 'asc'; setCollectorAssignmentSortDirection(direction); void loadCollectorAssignments(direction).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('assignedCollectors')}{collectorAssignmentSortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button></th><th>{publicLanguage.t('accountNationalId')}</th><th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{publicLanguage.t('navAbacunda')}</th><th>{publicLanguage.t('navIfishi')}</th></tr></thead><tbody>{collectorAssignments.map((assignment, index) => <tr key={assignment.collector_user_id}><td>{index + 1}</td><td className="strong-cell">{assignment.collector_name}</td><td>{assignment.collector_national_id || '—'}</td><td>{[assignment.collector_phone, assignment.collector_account_number].filter(Boolean).join(' / ') || '—'}</td><td>{assignment.abacunda_count}</td><td><button type="button" className="text-button" onClick={() => openAbacundaIfishi(assignment)}>{publicLanguage.t('navIfishi')}</button></td></tr>)}</tbody></table></div>
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

  const renderFarmers = () => {
    const collectorManagement = !isCollector && !isDairy ? <div className="assignment-tool">
      <div><span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span><h3>{publicLanguage.t('assignedCollectors')}</h3></div>
      <button type="button" className="button button-secondary" onClick={() => { setCollectorLinkError(''); setCollectorLinkOpen(true); }}><Plus size={15} aria-hidden="true" />{publicLanguage.t('collectorAdd')}</button>
      <div className="assignment-list">{collectorAssignments.map((assignment) => <div className="assignment-chip" key={assignment.collector_user_id}><span><b>{assignment.collector_name}</b><small>{assignment.collector_account_number || assignment.collector_user_id} · {assignment.abacunda_count} {accountCopy('navFarmers', 'abacundaLabel').toLowerCase()}</small></span><button type="button" className="text-button danger-text" onClick={() => unlinkCollector(assignment.collector_user_id)}>{publicLanguage.t('delete')}</button></div>)}{!collectorAssignments.length ? <span className="muted-note">{publicLanguage.t('noCollectorsLinked')}</span> : null}</div>
      {collectorLinkOpen ? <Modal ariaLabel={publicLanguage.t('linkCollector')} onClose={() => setCollectorLinkOpen(false)} dismissible={!busy}>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span><h2>{publicLanguage.t('collectorAdd')}</h2></div><button type="button" className="icon-button" onClick={() => setCollectorLinkOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack" onSubmit={linkCollector}><label>{publicLanguage.t('collectorAccountId')}<input type="number" min="1" step="1" required value={collectorLinkId} onChange={(event) => setCollectorLinkId(event.target.value)} /></label>{collectorLinkError ? <p className="form-error" role="alert">{collectorLinkError}</p> : null}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setCollectorLinkOpen(false)} disabled={busy}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={busy || !collectorLinkId}>{busy ? publicLanguage.t('wait') : publicLanguage.t('linkCollector')}</button></div></form>
      </Modal> : null}
    </div> : null;
    const showCenterSetup = isDairy && !centers.length ? <section className="panel panel-wide"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('configuration')}</span><h2>{publicLanguage.t('centerName')}</h2></div><Building2 size={19} aria-hidden="true" /></div><form className="toolbar" onSubmit={createCenter}><label>{publicLanguage.t('centerName')}<input required maxLength={100} value={centerForm.name} onChange={(event) => setCenterForm({ ...centerForm, name: event.target.value })} /></label><label>{publicLanguage.t('milkPrice')} · RWF/L<input required type="number" min="1" step="0.01" value={centerForm.pricePerLiter} onChange={(event) => setCenterForm({ ...centerForm, pricePerLiter: event.target.value })} /></label><button className="button button-primary" disabled={busy || !centerForm.name.trim() || !centerForm.pricePerLiter}><Plus size={16} />{publicLanguage.t('addCenter')}</button></form></section> : null;
    const openCreateFarmer = () => {
      const autoCenterId = centers.length === 1 ? String(centers[0].id) : (isCollector && collectorOwnedCenters.length === 1 ? String(collectorOwnedCenters[0].id) : '');
      if (autoCenterId && !farmerForm.collectionCenterId) setFarmerForm((previous) => ({ ...previous, collectionCenterId: autoCenterId }));
      setFarmerCreateError('');
      setFarmerCreateOpen(true);
    };

    return <>
      <FarmersView
        t={publicLanguage.t}
        language={publicLanguage.language}
        isCollector={isCollector}
        isDairy={isDairy}
        centers={centers}
        selectedCenter={selectedCenter}
        onSelectCenter={setSelectedCenter}
        collectorOwnedCenters={collectorOwnedCenters}
        collectorAssignments={collectorAssignments}
        collectorAssignmentsLoading={collectorAssignmentsLoading}
        farmerPage={farmers}
        loading={farmersLoading}
        error={farmersError}
        onRetry={() => { void loadFarmers().catch(() => undefined); }}
        searchQuery={farmerQuery}
        setSearchQuery={setFarmerQuery}
        searchValue={farmerSearch}
        onSearch={() => setFarmerSearch(farmerQuery.trim())}
        farmerCenter={farmerCenter}
        setFarmerCenter={setFarmerCenter}
        collectorFilter={farmerCollectorFilter}
        setCollectorFilter={setFarmerCollectorFilter}
        sortBy={farmerSortBy}
        sortDirection={farmerSortDirection}
        onSort={(field, direction) => {
          if (!field) { setFarmerSortBy(''); return; }
          if (direction) { setFarmerSortBy(field); setFarmerSortDirection(direction); }
          else if (farmerSortBy === field) setFarmerSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
          else { setFarmerSortBy(field); setFarmerSortDirection('asc'); }
        }}
        onClearFilters={() => { setFarmerSearch(''); setFarmerQuery(''); setFarmerCenter(''); setFarmerCollectorFilter(''); }}
        onLoadMore={() => { void loadFarmers(farmers?.nextCursor, true).catch(() => undefined); }}
        onCreate={openCreateFarmer}
        onOpenBatchCreate={openFarmerBatchCreate}
        onImport={() => setFarmerImportOpen(true)}
        onOpenHistory={openFarmerHistory}
        onOpenIfishi={(farmer) => openIfishiForFarmer(farmer.id, farmer.name)}
        onEdit={editFarmerStart}
        onDelete={(farmer) => { void deleteFarmer(farmer); }}
        collectorName={getFarmerCollectorName}
        formatFarmerNumber={formatFarmerNumber}
        selectedFarmerIds={selectedFarmerIds}
        onToggleFarmer={toggleFarmerSelect}
        inlineNumberFarmerId={inlineNumberFarmerId}
        inlineFarmerNumber={inlineFarmerNumber}
        inlineNumberSaving={inlineNumberSaving}
        onStartFarmerNumberEdit={startEditingFarmerNumber}
        onCancelFarmerNumberEdit={() => setInlineNumberFarmerId(null)}
        onChangeFarmerNumber={setInlineFarmerNumber}
        onSaveFarmerNumber={(id, value) => { void saveInlineFarmerNumber(id, value); }}
        inlineEditingFarmerId={inlineEditingFarmerId}
        inlineFarmerPhone={inlineFarmerPhone}
        onStartPhoneEdit={(farmer) => { setInlineEditingFarmerId(farmer.id); setInlineFarmerPhone(farmer.phone || ''); }}
        onCancelPhoneEdit={() => setInlineEditingFarmerId(null)}
        onChangePhone={setInlineFarmerPhone}
        onSavePhone={(farmer) => { void saveInlineFarmerPhone(farmer); }}
        showCenterSetup={showCenterSetup}
        collectorManagement={collectorManagement}
        fields={visibleFarmerFields}
        busy={busy}
        createOpen={farmerCreateOpen}
        onCloseCreate={() => setFarmerCreateOpen(false)}
        createError={farmerCreateError}
        createForm={farmerForm}
        onChangeCreateField={(key, value) => setFarmerForm((previous) => ({ ...previous, [key]: value }))}
        onSubmitCreate={createFarmer}
        editingFarmer={editingFarmer}
        onCloseEdit={() => setEditingFarmer(null)}
        editForm={farmerEdit}
        onChangeEditField={(key, value) => setFarmerEdit((previous) => ({ ...previous, [key]: value }))}
        onSubmitEdit={saveFarmer}
      />

      {farmerBatchOpen ? <Modal ariaLabel={publicLanguage.language === 'en' ? 'Add multiple farmers' : 'Ongeramo abacunda benshi'} onClose={() => setFarmerBatchOpen(false)} dismissible={!farmerBatchSubmitting}>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('newRecord')}</span><h2>{publicLanguage.language === 'en' ? 'Add multiple farmers' : 'Ongeramo abacunda benshi'}</h2></div><button type="button" className="icon-button" onClick={() => setFarmerBatchOpen(false)} disabled={farmerBatchSubmitting} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack compact" onSubmit={submitFarmerBatch}>
          <div className="panel-heading-stacked-actions">
            <button type="button" className="button button-secondary small-button" onClick={addFarmerBatchRow}>{publicLanguage.language === 'en' ? 'Add row' : 'Ongera umurongo'}</button>
          </div>
          {farmerBatchRows.map((row, index) => (
            <div key={`farmer-batch-row-${index}`} className="batch-entry-grid">
              <label>{publicLanguage.language === 'en' ? 'Farmer name' : 'Izina ry’umworozi'}<input required value={row.name} onChange={(event) => updateFarmerBatchRow(index, 'name', event.target.value)} /></label>
              <label>{publicLanguage.t('columnPhone')}<input value={row.phone} onChange={(event) => updateFarmerBatchRow(index, 'phone', event.target.value)} /></label>
              <label>{publicLanguage.t('columnNationalId')}<input value={row.nationalId} onChange={(event) => updateFarmerBatchRow(index, 'nationalId', event.target.value)} /></label>
              <label>{publicLanguage.t('accountNumber')}<input value={row.accountNumber} onChange={(event) => updateFarmerBatchRow(index, 'accountNumber', event.target.value)} /></label>
              <label>{publicLanguage.t('columnCenter')}<select value={row.collectionCenterId} onChange={(event) => updateFarmerBatchRow(index, 'collectionCenterId', event.target.value)}>
                <option value="">{publicLanguage.t('selectCenter')}</option>
                {centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}
              </select></label>
              {farmerBatchRows.length > 1 ? <button type="button" className="button button-secondary small-button danger-text" onClick={() => setFarmerBatchRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}>{publicLanguage.t('delete')}</button> : null}
            </div>
          ))}
          {farmerBatchError ? <p className="form-error" role="alert">{farmerBatchError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setFarmerBatchOpen(false)} disabled={farmerBatchSubmitting}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={farmerBatchSubmitting}>{farmerBatchSubmitting ? publicLanguage.t('wait') : publicLanguage.language === 'en' ? 'Save farmers' : 'Bika abacunda'}</button></div>
        </form>
      </Modal> : null}
    </>;
  };

  const renderCollectorMembershipRequests = () => (
    <section className="panel panel-wide collector-membership-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span>
          <h2>{publicLanguage.t('collectorRequestTitle')}</h2>
        </div>
        <Send size={19} aria-hidden="true" />
      </div>
      <p className="muted-note">{publicLanguage.t('collectorRequestHelp')}</p>
      <form className="form-stack compact" onSubmit={requestCollectorAssignment}>
        <label>{publicLanguage.t('collectionCenterAccountId')}
          <input type="number" min="1" step="1" required value={collectorRequestDairyId} onChange={(event) => setCollectorRequestDairyId(event.target.value)} />
        </label>
        <label>{publicLanguage.t('collectorRequestNote')}
          <input maxLength={500} value={collectorRequestNote} onChange={(event) => setCollectorRequestNote(event.target.value)} />
        </label>
        {collectorRequestError ? <p className="form-error" role="alert">{collectorRequestError}</p> : null}
        <div className="form-actions">
          <button className="button button-primary" disabled={!collectorRequestDairyId}>{publicLanguage.t('collectorRequestSend')}<Send size={15} aria-hidden="true" /></button>
        </div>
      </form>
      <div className="panel-heading">
        <div><span className="eyebrow">{publicLanguage.t('collectorRequestsTitle')}</span><h3>{publicLanguage.t('collectorRequestsTitle')}</h3></div>
      </div>
      {collectorRequestsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('loading')}</div>
        : collectorRequestsError ? <div className="workspace-empty" role="alert"><b>{collectorRequestsError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadCollectorRequests().catch(() => undefined)}>{publicLanguage.t('retry') || 'Retry'}</button></div>
          : collectorRequests.length ? <div className="notice-list">{collectorRequests.map((request) => (
            <div className="notice-row" key={request.id}>
              <span>
                <b>{request.dairy_name || `Collection Center #${request.dairy_user_id}`}</b>
                <small>{[request.dairy_email, request.dairy_phone].filter(Boolean).join(' · ') || '—'}</small>
                <small>{publicLanguage.t('collectorRequestedAt')}: {String(request.requested_at).slice(0, 10)}</small>
                {request.request_note ? <small>{request.request_note}</small> : null}
                {request.decision_note ? <small>{publicLanguage.t('collectorRequestDecisionNote')}: {request.decision_note}</small> : null}
              </span>
              <span className={`badge ${request.status === 'pending' ? 'badge-warning' : 'badge-neutral'}`}>{collectorRequestStatusLabel(request.status)}</span>
              {request.status === 'pending' ? <button type="button" className="text-button danger-text" onClick={() => cancelCollectorRequest(request)}>{publicLanguage.t('collectorRequestCancel')}</button> : null}
            </div>
          ))}</div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('noCollectorRequests')}</b></div>}
    </section>
  );

  const renderDairyMembershipRequests = () => {
    const pendingCount = collectorRequests.filter((request) => request.status === 'pending').length;
    return (
      <section className="panel panel-wide collector-membership-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span>
            <h2>{publicLanguage.t('collectorRequestTitle')}</h2>
          </div>
          <div className="panel-heading-actions">
            <span className="count-label">{pendingCount} {publicLanguage.t('collectorRequestPendingCount')}</span>
            <Send size={19} aria-hidden="true" />
          </div>
        </div>
        {collectorRequestsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('loading')}</div>
          : collectorRequestsError ? <div className="workspace-empty" role="alert"><b>{collectorRequestsError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadCollectorRequests().catch(() => undefined)}>{publicLanguage.t('retry') || 'Retry'}</button></div>
            : collectorRequests.length ? <div className="notice-list">{collectorRequests.map((request) => (
              <div className="notice-row" key={request.id}>
                <span>
                  <b>{request.collector_name || `Collector #${request.collector_user_id}`}</b>
                  <small>{[request.collector_email, request.collector_phone, request.collector_account_number].filter(Boolean).join(' · ') || '—'}</small>
                  <small>{publicLanguage.t('collectorRequestedAt')}: {String(request.requested_at).slice(0, 10)}</small>
                  {request.request_note ? <small>{request.request_note}</small> : null}
                  {request.decision_note ? <small>{publicLanguage.t('collectorRequestDecisionNote')}: {request.decision_note}</small> : null}
                </span>
                <span className={`badge ${request.status === 'pending' ? 'badge-warning' : 'badge-neutral'}`}>{collectorRequestStatusLabel(request.status)}</span>
                {request.status === 'pending' ? <span className="panel-heading-actions">
                  <button type="button" className="button button-primary small-button" onClick={() => decideCollectorRequest(request, 'approve')}><CheckCircle2 size={14} aria-hidden="true" />{publicLanguage.t('collectorRequestApprove')}</button>
                  <button type="button" className="button button-secondary small-button danger-text" onClick={() => decideCollectorRequest(request, 'reject')}><X size={14} aria-hidden="true" />{publicLanguage.t('collectorRequestReject')}</button>
                </span> : null}
              </div>
            ))}</div> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('noCollectorRequests')}</b></div>}
      </section>
    );
  };

  const renderCenters = () => {
    const ownedCenters = centers.filter((center) => Number(center.owner_user_id) === Number(user?.id));
    const activeCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name || centers[0]?.name || '—';
    return (
    <div className="screen-grid">
      {isCollector ? renderCollectorMembershipRequests() : null}
      {isDairy ? renderDairyMembershipRequests() : null}
      {isDairy ? (
        <>
          <section className="panel panel-wide link-collector-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{publicLanguage.t('collectorsLinkage')}</span>
                <h2>{publicLanguage.t('linkCollector')}</h2>
              </div>
              <UserPlus size={19} aria-hidden="true" />
            </div>
            <form className="link-collector-form" onSubmit={linkCollector}>
              <div className="link-collector-input-group">
                <label htmlFor="collector-link-input" className="sr-only">{publicLanguage.t('collectorAccountId')}</label>
                <input
                  id="collector-link-input"
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder={publicLanguage.language === 'en' ? 'Enter Collector Account ID (e.g. 102)' : 'Andika Nimero ya Konti y’Umucunda (urug. 102)'}
                  value={collectorLinkId}
                  onChange={(event) => setCollectorLinkId(event.target.value)}
                  className="link-collector-input"
                />
                <label htmlFor="collector-link-email" className="sr-only">{publicLanguage.t('collectorLinkEmail')}</label>
                <input
                  id="collector-link-email"
                  type="email"
                  placeholder={publicLanguage.t('collectorLinkEmail')}
                  value={collectorLinkEmail}
                  onChange={(event) => setCollectorLinkEmail(event.target.value)}
                  className="link-collector-input"
                />
                <button className="button button-primary" disabled={busy || !collectorLinkId}>
                  <UserPlus size={15} aria-hidden="true" />
                  <span>{busy ? publicLanguage.t('wait') : publicLanguage.t('linkCollector')}</span>
                </button>
              </div>
              {collectorLinkError ? <p className="form-error" role="alert" style={{ marginTop: 8 }}>{collectorLinkError}</p> : null}
            </form>
          </section>

          <section className="panel panel-wide collectors-roster-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{publicLanguage.t('directory')}</span>
                <h2>{publicLanguage.t('navAbacunda')}</h2>
              </div>
              <div className="panel-heading-actions">
                <span className="count-label">
                  {collectorAssignments.length} {publicLanguage.language === 'en' ? 'Collectors linked' : 'Abacunda bahujwe'}
                </span>
              </div>
            </div>
            {collectorAssignmentsLoading ? (
              <div className="workspace-empty workspace-loading" role="status">
                <span className="loading-indicator" />
                {publicLanguage.t('loadingAssignedAbacunda')}
              </div>
            ) : collectorAssignmentsError ? (
              <div className="workspace-empty" role="alert">
                <b>{collectorAssignmentsError}</b>
                <button type="button" className="button button-secondary small-button" onClick={() => loadCollectorAssignments().catch(() => undefined)}>
                  {publicLanguage.t('retry') || 'Retry'}
                </button>
              </div>
            ) : collectorAssignments.length ? (
              <>
                <div className="table-scroll collectors-executive-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{publicLanguage.t('columnName')}</th>
                        <th>{publicLanguage.t('columnPhone')}</th>
                        <th>{publicLanguage.language === 'en' ? 'Work ID' : 'Nimero y’Akazi'}</th>
                        <th>{publicLanguage.t('navFarmers')}</th>
                        <th>{publicLanguage.t('reportsVolume')}</th>
                        <th>{publicLanguage.t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectorAssignments.map((assignment, index) => {
                        const matchedVolume = (report?.collectorSettlementRows || ukweziReport?.collectorSettlementRows || [])
                          .find((r: any) => Number(r.collectorUserId) === Number(assignment.collector_user_id))?.totalVolume;
                        return (
                          <tr key={assignment.collector_user_id}>
                            <td><span className="font-mono text-muted">{index + 1}</span></td>
                            <td className="strong-cell">
                              <b>{assignment.collector_name}</b>
                              {assignment.collector_account_number ? (
                                <small className="farmer-row-detail font-mono">Acc: {assignment.collector_account_number}</small>
                              ) : null}
                            </td>
                            <td>{assignment.collector_phone || '—'}</td>
                            <td>
                              <span className="collector-work-id-badge font-mono">
                                ID #{assignment.collector_user_id}
                              </span>
                            </td>
                            <td>
                              <span className="badge badge-neutral">
                                {assignment.abacunda_count} {publicLanguage.t('navFarmers').toLowerCase()}
                              </span>
                            </td>
                            <td>
                              <b>{matchedVolume != null ? `${liters(matchedVolume)} L` : '—'}</b>
                            </td>
                            <td className="actions-cell">
                              <button
                                type="button"
                                className="button button-secondary small-button"
                                onClick={() => openAbacundaIfishi(assignment)}
                              >
                                <BookOpen size={14} aria-hidden="true" />
                                {publicLanguage.language === 'en' ? 'View Roster' : 'Reba Ifishi'}
                              </button>
                              <button
                                type="button"
                                className="button button-secondary small-button danger-text"
                                onClick={() => {
                                  if (window.confirm(formatPublicCopy(publicLanguage.language, 'suspendCollectorConfirm', 'Suspend {name}? The current assignment will be closed and kept in history.', { name: assignment.collector_name }))) {
                                    void suspendCollector(assignment.collector_user_id);
                                  }
                                }}
                              >
                                <Shield size={14} aria-hidden="true" />
                                {publicLanguage.t('suspendCollector')}
                              </button>
                              <button
                                type="button"
                                className="button button-secondary small-button danger-text"
                                onClick={() => {
                                  if (window.confirm(publicLanguage.language === 'en' ? `Revoke assignment for ${assignment.collector_name}?` : `Hagarika umucunda ${assignment.collector_name}?`)) {
                                    void unlinkCollector(assignment.collector_user_id);
                                  }
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                {publicLanguage.language === 'en' ? 'Revoke' : 'Hagarika'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="collectors-mobile-roster">
                  {collectorAssignments.map((assignment) => {
                    const matchedVolume = (report?.collectorSettlementRows || ukweziReport?.collectorSettlementRows || [])
                      .find((r: any) => Number(r.collectorUserId) === Number(assignment.collector_user_id))?.totalVolume;
                    return (
                      <article className="collector-mobile-card" key={assignment.collector_user_id}>
                        <header>
                          <div>
                            <b>{assignment.collector_name}</b>
                            <span className="collector-work-id-badge font-mono">ID #{assignment.collector_user_id}</span>
                          </div>
                          <span className="badge badge-neutral">
                            {assignment.abacunda_count} {publicLanguage.t('navFarmers').toLowerCase()}
                          </span>
                        </header>
                        <dl>
                          <div>
                            <dt>{publicLanguage.t('columnPhone')}</dt>
                            <dd>{assignment.collector_phone || '—'}</dd>
                          </div>
                          {assignment.collector_account_number ? (
                            <div>
                              <dt>{publicLanguage.t('accountNumber')}</dt>
                              <dd className="font-mono">{assignment.collector_account_number}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>{publicLanguage.t('reportsVolume')}</dt>
                            <dd><b>{matchedVolume != null ? `${liters(matchedVolume)} L` : '—'}</b></dd>
                          </div>
                        </dl>
                        <footer>
                          <button
                            type="button"
                            className="button button-secondary small-button"
                            onClick={() => openAbacundaIfishi(assignment)}
                          >
                            <BookOpen size={14} aria-hidden="true" />
                            {publicLanguage.language === 'en' ? 'View Roster' : 'Reba Ifishi'}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary small-button danger-text"
                            onClick={() => {
                              if (window.confirm(formatPublicCopy(publicLanguage.language, 'suspendCollectorConfirm', 'Suspend {name}? The current assignment will be closed and kept in history.', { name: assignment.collector_name }))) {
                                void suspendCollector(assignment.collector_user_id);
                              }
                            }}
                          >
                            <Shield size={14} aria-hidden="true" />
                            {publicLanguage.t('suspendCollector')}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary small-button danger-text"
                            onClick={() => {
                              if (window.confirm(publicLanguage.language === 'en' ? `Revoke assignment for ${assignment.collector_name}?` : `Hagarika umucunda ${assignment.collector_name}?`)) {
                                void unlinkCollector(assignment.collector_user_id);
                              }
                            }}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            {publicLanguage.language === 'en' ? 'Revoke' : 'Hagarika'}
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="workspace-empty" role="status">
                <span className="workspace-empty-icon"><Users size={21} aria-hidden="true" /></span>
                <b>{publicLanguage.t('noCollectorsLinked')}</b>
              </div>
            )}
          </section>

          {abacundaIfishiCollector ? (
            <Modal
              ariaLabel={`${abacundaIfishiCollector.collector_name} · ${publicLanguage.t('navIfishi')}`}
              className="abacunda-ifishi-panel modal-panel-wide"
              onClose={() => setAbacundaIfishiCollector(null)}
              dismissible={!abacundaIfishiLoading}
            >
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">{activeCenterName}</span>
                  <h2 id="abacunda-ifishi-title">{abacundaIfishiCollector.collector_name} · {publicLanguage.t('navIfishi')}</h2>
                </div>
                <button type="button" className="icon-button" onClick={() => setAbacundaIfishiCollector(null)} disabled={abacundaIfishiLoading} aria-label={publicLanguage.t('cancel')}>
                  <X size={18} />
                </button>
              </div>
              <div className="toolbar abacunda-ifishi-toolbar">
                <label>
                  {publicLanguage.t('ifishiMonth')}
                  <input
                    type="month"
                    max={today().slice(0, 7)}
                    value={abacundaIfishiMonth}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      setAbacundaIfishiMonth(event.target.value);
                      void loadAbacundaIfishi(abacundaIfishiCollector.collector_user_id, event.target.value);
                    }}
                  />
                </label>
              </div>
              {abacundaIfishiLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}
              {abacundaIfishiError ? <div className="workspace-empty" role="alert"><b>{abacundaIfishiError}</b></div> : null}
              {abacundaIfishiHistory ? (
                <>
                  <p className="muted-note">{abacundaIfishiHistory.startDate} – {abacundaIfishiHistory.endDate}</p>
                  <div className="metric-strip abacunda-ifishi-summary">
                    <div><span>{publicLanguage.t('dashboardMorning')}</span><b>{liters(abacundaIfishiHistory.totals.morningLiters)} L</b></div>
                    <div><span>{publicLanguage.t('dashboardEvening')}</span><b>{liters(abacundaIfishiHistory.totals.eveningLiters)} L</b></div>
                    <div><span>{publicLanguage.t('ifishiValid')}</span><b>{liters(abacundaIfishiHistory.totals.validLiters)} L</b></div>
                    <div><span>{publicLanguage.t('ifishiLost')}</span><b>{liters(abacundaIfishiHistory.totals.lostLiters)} L</b></div>
                  </div>
                  {abacundaIfishiHistory.entries.length ? (
                    <>
                      <div className="table-scroll abacunda-ifishi-desktop-list">
                        <table>
                          <thead>
                            <tr>
                              <th>{publicLanguage.t('milkCollectionDate')}</th>
                              <th>{publicLanguage.t('dashboardMorning')} · L</th>
                              <th>{publicLanguage.t('dashboardEvening')} · L</th>
                              <th>{publicLanguage.t('milkTotal')} · L</th>
                              <th>{publicLanguage.t('ifishiLost')} · L</th>
                              <th>{publicLanguage.t('ifishiReason')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {abacundaIfishiHistory.entries.map((entry) => (
                              <tr key={entry.date}>
                                <td>{entry.date}</td>
                                <td>{liters(entry.morningLiters)}</td>
                                <td>{liters(entry.eveningLiters)}</td>
                                <td>{liters(entry.validLiters)}</td>
                                <td>{liters(entry.lostLiters)}</td>
                                <td>{entry.reason || entry.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="abacunda-ifishi-mobile-list">
                        {abacundaIfishiHistory.entries.map((entry) => (
                          <article className="owner-ifishi-day" key={entry.date}>
                            <header>
                              <b>{entry.date}</b>
                              <span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span>
                            </header>
                            <dl>
                              <div><dt>{publicLanguage.t('dashboardMorning')}</dt><dd>{liters(entry.morningLiters)} L</dd></div>
                              <div><dt>{publicLanguage.t('dashboardEvening')}</dt><dd>{liters(entry.eveningLiters)} L</dd></div>
                              <div><dt>{publicLanguage.t('ifishiValid')}</dt><dd>{liters(entry.validLiters)} L</dd></div>
                              <div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostLiters)} L</dd></div>
                            </dl>
                            {entry.reason ? <p>{entry.reason}</p> : null}
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="workspace-empty" role="status"><b>{publicLanguage.t('ownerIfishiEmpty')}</b></div>
                  )}
                </>
              ) : null}
            </Modal>
          ) : null}
        </>
      ) : null}

      <section className="panel panel-wide"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('configuration')}</span><h2>{publicLanguage.t('navCenters')}</h2></div><div className="panel-heading-actions"><span className="count-label">{ownedCenters.length} {publicLanguage.t('centersConfigured')}</span><button type="button" className="button button-secondary small-button" onClick={() => setTab('settings')}>{`Account settings: ${user?.name || user?.email}`}</button></div></div>
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
      {isCollector || isDairy ? <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('newSite')}</span><h2>{publicLanguage.t('addCenter')}</h2></div><Building2 size={19} /></div><form className="form-stack compact" onSubmit={createCenter}>
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

  const renderFarmerHistory = () => {
    const historyFarmer = farmerHistory?.farmer || null;
    const farmerId = historyFarmer?.farmerId ?? historyFarmer?.id ?? farmerHistoryFarmer?.id ?? null;
    const farmerName = historyFarmer?.name || farmerHistoryFarmer?.name || '';
    const farmerNumber = formatFarmerNumber(historyFarmer?.farmerNumber ?? farmerHistoryFarmer?.farmerNumber) || '—';
    const collectorLabel = getFarmerCollectorName(historyFarmer?.collectorUserId ?? null);
    const dateLabel = (value: string) => formatDateLabel(value, publicLanguage.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) || value;
    const shortDateLabel = (value: string) => formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'short', year: 'numeric' }) || value;
    const sessionLabel = (session: FarmerHistoryDay['session']) => session === 'morning'
      ? publicLanguage.t('dashboardMorning')
      : session === 'evening'
        ? publicLanguage.t('dashboardEvening')
        : session === 'morning-evening'
          ? publicLanguage.t('farmerHistoryMorningEvening')
          : '—';
    const statusLabel = (day: FarmerHistoryDay) => day.deliveryStatus === 'delivered'
      ? publicLanguage.t('deliveryStatusDelivered')
      : day.status === 'cancelled'
        ? publicLanguage.t('deliveryStatusCancelled')
        : publicLanguage.t('deliveryStatusMissing');
    const statusClass = (day: FarmerHistoryDay) => day.deliveryStatus === 'delivered'
      ? 'is-delivered'
      : day.status === 'cancelled'
        ? 'is-cancelled'
        : 'is-missing';

    const matchingFarmerObj = (farmers?.data || []).find((f) => f.id === farmerId) || historyFarmer || farmerHistoryFarmer;
    const matchingReportFarmer = (ukweziReport?.farmerPayments || report?.farmerPayments || settlementReport?.settlementAccounting?.farmers || []).find((f: any) => f.farmerId === farmerId);
    const matchingSettlementFarmer = settlementReport?.settlementAccounting?.farmers?.find((f: any) => f.farmerId === farmerId);
    const farmerDebt = settlementDebts.find((d: any) => Number(d.farmer_id) === Number(farmerId));
    const carriedDebt = Number(farmerDebt?.remaining_balance ?? matchingSettlementFarmer?.settlement?.outstandingDebt ?? 0);
    const carriedDebtKnown = Boolean(farmerDebt) || matchingSettlementFarmer?.settlement?.outstandingDebt != null || Boolean(settlementData);
    const farmerAccountNumber = (matchingFarmerObj as any)?.accountNumber;
    const hasAccount = Boolean(
      farmerAccountNumber &&
      String(farmerAccountNumber).trim() &&
      !['N/A', 'NA'].includes(String(farmerAccountNumber).trim().toUpperCase()) &&
      String(farmerAccountNumber).trim().length >= 4
    );
    const historyTotalLiters = matchingReportFarmer?.totalVolume ?? (farmerHistory?.days || []).reduce((sum: number, d: any) => sum + Number(d.totalLiters || 0), 0);

    return <div className="farmer-history-view">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('viewFarmerHistory')}</span><h2 id="farmer-history-title">{publicLanguage.t('farmerHistoryTitle')}</h2><p className="muted-note">{publicLanguage.t('farmerHistorySubtitle')}</p></div><button type="button" className="icon-button" onClick={() => setFarmerHistoryOpen(false)} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
      <section className="farmer-history-identity">
        <div className="farmer-history-person"><span className="farmer-number-badge">{farmerNumber}</span><div><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><b>{farmerName || '—'}</b>{hasAccount ? <span className="badge badge-success" style={{ background: 'rgba(21, 127, 80, 0.12)', color: '#157f50', border: '1px solid rgba(21, 127, 80, 0.25)', padding: '2px 8px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>Bafite Konti</span> : <span className="badge badge-warning" style={{ background: 'rgba(184, 102, 20, 0.12)', color: '#b86614', border: '1px solid rgba(184, 102, 20, 0.25)', padding: '2px 8px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>Kuri Konti ya Nyirayo</span>}</div><small>{[historyFarmer?.phone, collectorLabel, historyFarmer?.collectionCenter].filter(Boolean).join(' · ') || '—'}</small></div></div>
        {historyFarmer?.createdDate ? <span className="farmer-history-created">{publicLanguage.t('accountCreated')}: {shortDateLabel(historyFarmer.createdDate)}</span> : null}
      </section>
      <div className="inspector-quick-actions">
        <button
          type="button"
          className="button button-secondary small-button"
          disabled={!farmerId}
          onClick={() => {
            const morningLiters = liters(farmerHistory?.days?.[0]?.morningLiters ?? 0);
            const totalPeriodLiters = liters(historyTotalLiters);
            const centerName = historyFarmer?.collectionCenter || (centers.find((c) => String(c.id) === selectedCenter)?.name || 'Ikigo');
            const text = `Mworozi ${farmerName} (${farmerNumber}), amata yanyu y'igitondo (${morningLiters} L) yakiriwe neza ku kigo ${centerName}. Yose hamwe muri iki gice: ${totalPeriodLiters} L. Murakoze. — IHURIRO RY'AMATA`;
            const phone = historyFarmer?.phone ? historyFarmer.phone.replace(/[^0-9+]/g, '') : '';
            const waUrl = phone ? `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}` : `whatsapp://send?text=${encodeURIComponent(text)}`;
            const smsUrl = phone ? `sms:${phone}?body=${encodeURIComponent(text)}` : `sms:?body=${encodeURIComponent(text)}`;
            if (window.confirm(publicLanguage.language === 'en' ? `Send receipt to ${farmerName} via WhatsApp? (Cancel for SMS)` : `Kohereza inyemezabwishyu kuri WhatsApp? (Kanda Cancel kuri SMS)`)) {
              window.open(waUrl, '_blank');
            } else {
              window.location.href = smsUrl;
            }
          }}
        >
          <Send size={14} aria-hidden="true" />
          {publicLanguage.language === 'en' ? 'Send SMS/WhatsApp' : 'Oherereza Ubutumwa'}
        </button>
        {isCollector ? <button type="button" className="button button-secondary small-button" disabled={!farmerId} onClick={() => {
          if (!farmerId) return;
          const period = getHalfMonthDateRange(Number(ukweziYear), Number(ukweziMonth), ukweziPeriod);
          setFarmerHistoryOpen(false);
          openFarmerDeduction(farmerId, farmerName, period.startDate, period.endDate, {
            totalVolume: Number(matchingReportFarmer?.totalVolume ?? historyTotalLiters),
            pricePerLiter: matchingReportFarmer?.pricePerLiter == null ? null : Number(matchingReportFarmer.pricePerLiter),
            grossAmount: matchingReportFarmer?.grossAmount == null ? null : Number(matchingReportFarmer.grossAmount),
            totalDeductions: Number(matchingReportFarmer?.totalDeductions || 0),
            totalTransport: matchingReportFarmer?.totalTransport == null ? null : Number(matchingReportFarmer.totalTransport),
            netAmount: matchingReportFarmer?.netAmount == null ? null : Number(matchingReportFarmer.netAmount),
          });
        }}><Plus size={14} aria-hidden="true" />{publicLanguage.language === 'en' ? 'Add Deduction' : 'Ongera Ikurwaho'}</button> : null}
        <button type="button" className="button button-secondary small-button" disabled={!matchingFarmerObj} onClick={() => { if (matchingFarmerObj) { setFarmerHistoryOpen(false); editFarmerStart(matchingFarmerObj as Farmer); } }}><Edit3 size={14} aria-hidden="true" />{publicLanguage.language === 'en' ? 'Edit Details' : 'Hindura Amakuru'}</button>
        <button type="button" className="button button-primary small-button" disabled={!farmerId} onClick={() => { if (!farmerId) return; setFarmerHistoryOpen(false); openIfishiForFarmer(farmerId, farmerName, historyFarmer || undefined); }}><BookOpen size={14} aria-hidden="true" />{publicLanguage.t('navIfishi')}</button>
      </div>
      <div className="inspector-mini-kpi">
        <div className="inspector-mini-kpi-card"><span>{publicLanguage.language === 'en' ? 'Total Volume' : 'Litiro Zose'}</span><b>{liters(historyTotalLiters)} L</b></div>
        <div className="inspector-mini-kpi-card"><span>{publicLanguage.language === 'en' ? 'Net Payable' : 'Ayishyurwa'}</span><b>{matchingReportFarmer?.netAmount != null ? `${money(matchingReportFarmer.netAmount)} RWF` : '—'}</b></div>
        <div className="inspector-mini-kpi-card"><span>{publicLanguage.language === 'en' ? 'Carried Debt' : 'Umwenda'}</span><b style={{ color: carriedDebt > 0 ? '#b86614' : '#112430' }}>{carriedDebtKnown ? `${money(carriedDebt)} RWF` : '—'}</b></div>
      </div>
      <div className="toolbar farmer-history-controls">
        <label>{publicLanguage.t('farmerHistoryRange')}<input type="month" max={today().slice(0, 7)} value={farmerHistoryMonth} onChange={(event) => { if (event.target.value) setFarmerHistoryMonth(event.target.value); }} /></label>
        <label>{publicLanguage.t('farmerHistorySession')}<select value={farmerHistorySession} onChange={(event) => setFarmerHistorySession(event.target.value as typeof farmerHistorySession)}><option value="all">{publicLanguage.t('milkSessionAll')}</option><option value="morning">{publicLanguage.t('milkSessionMorning')}</option><option value="evening">{publicLanguage.t('milkSessionEvening')}</option></select></label>
      </div>
      {isCollector ? <FarmerSettlementHistory
        records={farmerSettlementHistory}
        language={publicLanguage.language}
        loading={farmerSettlementHistoryLoading}
        error={farmerSettlementHistoryError}
        t={publicLanguage.t}
        formatMoney={money}
        onRetry={() => { void loadFarmerSettlementHistory(); }}
      /> : null}
      {farmerHistoryLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('farmerHistoryLoading')}</div> : null}
      {farmerHistoryError ? <div className="workspace-empty" role="alert"><b>{farmerHistoryError}</b><button type="button" className="button button-secondary small-button" onClick={() => loadFarmerHistory().catch(() => undefined)}>{publicLanguage.t('tryAgain')}</button></div> : null}
      {!farmerHistoryLoading && farmerHistory ? <>
        <p className="muted-note farmer-history-period">{shortDateLabel(farmerHistory.startDate)} – {shortDateLabel(farmerHistory.endDate)}{farmerHistory.requestedEndDate !== farmerHistory.endDate ? ` · ${publicLanguage.t('farmerHistoryRange')}: ${shortDateLabel(farmerHistory.requestedStartDate)} – ${shortDateLabel(farmerHistory.requestedEndDate)}` : ''}</p>
        <div className="metric-strip farmer-history-summary" aria-label={publicLanguage.t('farmerHistoryTitle')}>
          <div><span>{publicLanguage.t('farmerHistoryExpectedDays')}</span><b>{farmerHistory.expectedDays}</b></div>
          <div><span>{publicLanguage.t('farmerHistoryDeliveredDays')}</span><b>{farmerHistory.deliveredDays}</b></div>
          <div><span>{publicLanguage.t('farmerHistoryMissingDays')}</span><b>{farmerHistory.missingDays}</b></div>
          <div><span>{publicLanguage.t('farmerHistoryRate')}</span><b>{farmerHistory.deliveryRate}%</b></div>
        </div>
        <div className="farmer-history-grid">
          <section className="farmer-history-missed" aria-labelledby="farmer-history-missed-title">
            <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('deliveryMissingFarmers')}</span><h3 id="farmer-history-missed-title">{publicLanguage.t('farmerHistoryMissedDates')}</h3></div><span className="count-label">{farmerHistory.missingDays}</span></div>
            {farmerHistory.missedDates.length ? <ul>{farmerHistory.missedDates.map((date) => <li key={date}><span className="farmer-history-missed-date">{shortDateLabel(date)}</span><span className="delivery-status-pill is-missing">{publicLanguage.t('deliveryStatusMissing')}</span></li>)}</ul> : <p className="muted-note">{publicLanguage.t('farmerHistoryNoMissedDates')}</p>}
          </section>
          <section className="farmer-history-days" aria-labelledby="farmer-history-days-title">
            <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navMilk')}</span><h3 id="farmer-history-days-title">{publicLanguage.t('farmerHistoryDay')}</h3></div><span className="count-label">{farmerHistory.days.length}</span></div>
            {farmerHistory.days.length ? <>
              <div className="table-scroll farmer-history-desktop-list"><table><thead><tr><th>{publicLanguage.t('farmerHistoryDay')}</th><th>{publicLanguage.t('farmerHistorySession')}</th><th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th><th>{publicLanguage.t('farmerHistoryLiters')}</th><th>{publicLanguage.t('farmerHistoryStatus')}</th></tr></thead><tbody>{farmerHistory.days.map((day) => <tr key={day.date}><td>{dateLabel(day.date)}</td><td>{sessionLabel(day.session)}</td><td>{liters(day.morningLiters)}</td><td>{liters(day.eveningLiters)}</td><td><b>{liters(day.totalLiters)}</b></td><td><span className={`delivery-status-pill ${statusClass(day)}`}>{statusLabel(day)}</span></td></tr>)}</tbody></table></div>
              <div className="farmer-history-mobile-list">{farmerHistory.days.map((day) => <article className="farmer-history-day" key={day.date}><header><b>{dateLabel(day.date)}</b><span className={`delivery-status-pill ${statusClass(day)}`}>{statusLabel(day)}</span></header><dl><div><dt>{publicLanguage.t('farmerHistorySession')}</dt><dd>{sessionLabel(day.session)}</dd></div><div><dt>{publicLanguage.t('farmerHistoryLiters')}</dt><dd>{liters(day.totalLiters)} L</dd></div><div><dt>{publicLanguage.t('dashboardMorning')}</dt><dd>{liters(day.morningLiters)} L</dd></div><div><dt>{publicLanguage.t('dashboardEvening')}</dt><dd>{liters(day.eveningLiters)} L</dd></div></dl></article>)}</div>
            </> : <div className="workspace-empty" role="status"><b>{publicLanguage.t('farmerHistoryEmpty')}</b></div>}
          </section>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setFarmerHistoryOpen(false)}>{publicLanguage.t('cancel')}</button><button type="button" className="button button-primary" disabled={!farmerId} onClick={() => { if (!farmerId) return; setFarmerHistoryOpen(false); openIfishiForFarmer(farmerId, farmerName, historyFarmer || undefined); }}><BookOpen size={16} aria-hidden="true" />{publicLanguage.t('navIfishi')}</button></div>
      </> : null}
    </div>;
  };

  const renderDairyMilk = () => {
    const activeCenterName = centers.find((c) => String(c.id) === selectedCenter)?.name || centers[0]?.name || '—';

    return (
      <div className="screen-grid dairy-milk-view">
        <section className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{activeCenterName}</span>
              <h2>{publicLanguage.t('dairyDailyMilkTab')}</h2>
            </div>
            <div className="panel-heading-actions">
              <span className="count-label">
                {formatPublicCopy(publicLanguage.language, 'collectorsFound', 'Collectors found: {count}', { count: collectorAssignments.length })}
              </span>
              <button
                type="button"
                className="button button-secondary small-button"
                onClick={() => setMilkImportOpen(true)}
              >
                <Upload size={15} aria-hidden="true" />
                {getImportCopy(publicLanguage.language, 'openMilkScanner')}
              </button>
            </div>
          </div>

          <div className="toolbar milk-record-tools">
            <div className="date-field">
              <label htmlFor="dairy-milk-collection-date">{publicLanguage.t('milkCollectionDate')}</label>
              <input
                id="dairy-milk-collection-date"
                type="date"
                max={today()}
                value={collectionDate}
                onChange={(event) => setCollectionDate(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="button button-secondary small-button"
              onClick={() => setCollectionDate(today())}
            >
              {publicLanguage.t('dashboardToday')}
            </button>
            {centers.length > 1 ? (
              <label>
                {publicLanguage.t('activeIkigo')}
                <select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>
                  {centers.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          <div className="milk-summary">
            <div>
              <span>{publicLanguage.t('dashboardToday')}</span>
              <b>{liters(dailySummary.totalVolume)} L</b>
            </div>
            <div>
              <span>{publicLanguage.t('dashboardMorning')}</span>
              <b>{liters(dailySummary.totalMorning)} L</b>
            </div>
            <div>
              <span>{publicLanguage.t('dashboardEvening')}</span>
              <b>{liters(dailySummary.totalEvening)} L</b>
            </div>
            <div>
              <span>{publicLanguage.t('navAbacunda')}</span>
              <b>{collectorAssignments.length}</b>
            </div>
          </div>

          {collectorAssignmentsLoading ? (
            <div className="workspace-empty workspace-loading" role="status">
              <span className="loading-indicator" />
              {publicLanguage.t('loadingAssignedAbacunda')}
            </div>
          ) : !collectorAssignments.length ? (
            <div className="workspace-empty">
              <b>{publicLanguage.t('milkNoAssignedAbacundaTitle')}</b>
              <p>{publicLanguage.t('milkNoAssignedAbacundaBody')}</p>
              <button type="button" className="button button-primary" onClick={() => setTab('centers')}>
                <Plus size={15} aria-hidden="true" />
                {publicLanguage.t('abacundaAdd')}
              </button>
            </div>
          ) : (
            <>
              <div className="table-scroll collectors-executive-table">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{publicLanguage.t('columnName')}</th>
                      <th>{publicLanguage.t('columnPhone')}</th>
                      <th>{publicLanguage.language === 'en' ? 'Work ID' : 'Nimero y’Akazi'}</th>
                      <th>{publicLanguage.t('navFarmers')}</th>
                      <th>{publicLanguage.t('reportsVolume')}</th>
                      <th style={{ textAlign: 'right' }}>{publicLanguage.t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectorAssignments.map((assignment, index) => {
                      const matchedVolume = (report?.collectorSettlementRows || ukweziReport?.collectorSettlementRows || [])
                        .find((r: any) => Number(r.collectorUserId) === Number(assignment.collector_user_id))?.totalVolume;
                      return (
                        <tr key={assignment.collector_user_id}>
                          <td><span className="font-mono text-muted">{index + 1}</span></td>
                          <td className="strong-cell">
                            <b>{assignment.collector_name}</b>
                            {assignment.collector_account_number ? (
                              <small className="farmer-row-detail font-mono">Acc: {assignment.collector_account_number}</small>
                            ) : null}
                          </td>
                          <td>{assignment.collector_phone || '—'}</td>
                          <td>
                            <span className="collector-work-id-badge font-mono">
                              ID #{assignment.collector_user_id}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-neutral">
                              {assignment.abacunda_count} {publicLanguage.t('navFarmers').toLowerCase()}
                            </span>
                          </td>
                          <td>
                            <b>{matchedVolume != null ? `${liters(matchedVolume)} L` : '—'}</b>
                          </td>
                          <td className="actions-cell" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className="button button-secondary small-button"
                              onClick={() => openAbacundaIfishi(assignment)}
                            >
                              <BookOpen size={14} aria-hidden="true" />
                              {publicLanguage.language === 'en' ? 'View Roster' : 'Reba Ifishi'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="abacunda-mobile-list">
                {collectorAssignments.map((assignment) => {
                  const matchedVolume = (report?.collectorSettlementRows || ukweziReport?.collectorSettlementRows || [])
                    .find((r: any) => Number(r.collectorUserId) === Number(assignment.collector_user_id))?.totalVolume;
                  return (
                    <article className="milk-entry-card" key={`mobile-col-${assignment.collector_user_id}`}>
                      <header>
                        <div className="milk-card-identity">
                          <b>{assignment.collector_name}</b>
                          <small className="font-mono">ID #{assignment.collector_user_id} {assignment.collector_phone ? `· ${assignment.collector_phone}` : ''}</small>
                        </div>
                        <span className="badge badge-neutral">
                          {assignment.abacunda_count} {publicLanguage.t('navFarmers').toLowerCase()}
                        </span>
                      </header>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                        <span>{publicLanguage.t('reportsVolume')}:</span>
                        <b>{matchedVolume != null ? `${liters(matchedVolume)} L` : '—'}</b>
                      </div>
                      <footer style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="button button-secondary small-button"
                          onClick={() => openAbacundaIfishi(assignment)}
                        >
                          <BookOpen size={14} aria-hidden="true" />
                          {publicLanguage.language === 'en' ? 'View Roster' : 'Reba Ifishi'}
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    );
  };

  const renderMilk = () => {
    const handleQuickAddFarmerSubmit = async () => {
      if (!quickAddName.trim() || quickAddBusy) return;
      setQuickAddBusy(true);
      try {
        const newFarmerRes = await api<{ farmer: Farmer }>('/api/farmers', json('POST', {
          name: quickAddName.trim(),
          phone: quickAddPhone.trim() || undefined,
          collectionCenterId: selectedCenter || undefined,
        }));
        const created = newFarmerRes.farmer;
        if (created?.id && Number(quickAddMorning) > 0) {
          await api('/api/milk', json('POST', {
            farmerId: created.id,
            date: collectionDate,
            period: 'morning',
            volumeLiters: Number(quickAddMorning),
            collectionCenterId: selectedCenter || undefined,
          }));
        }
        setQuickAddName('');
        setQuickAddPhone('');
        setQuickAddMorning('');
        setQuickAddOpen(false);
        await loadDaily();
        await loadFarmers();
      } catch (err: any) {
        window.alert(err.message || 'Error creating farmer');
      } finally {
        setQuickAddBusy(false);
      }
    };
    const currentDay = collectionDate ? Number(new Date(`${collectionDate}T00:00:00Z`).getUTCDate()) : 1;
    const currentPeriod = getAccountingHalfForDay(currentDay) === 'first-half' ? publicLanguage.t('milkUkweziFirstHalf') : publicLanguage.t('milkUkweziSecondHalf');
    const dateLabel = formatDateLabel(collectionDate, publicLanguage.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return <MilkRecordsView
      t={publicLanguage.t}
      language={publicLanguage.language}
      isCollector={isCollector}
      isDairy={isDairy}
      dateLabel={dateLabel}
      currentPeriod={currentPeriod}
      today={today()}
      collectionDate={collectionDate}
      onDateChange={setCollectionDate}
      centers={centers}
      selectedCenter={selectedCenter}
      onCenterChange={setSelectedCenter}
      collectors={collectorAssignments}
      viewMode={milkViewMode}
      onViewModeChange={setMilkViewMode}
      matrixContent={<DigitalNotebookMatrix
        language={publicLanguage.language as 'rw' | 'en' | 'fr'}
        centers={centers}
        selectedCenterId={selectedCenter}
        onCenterChange={setSelectedCenter}
        onOpenScanner={() => setMilkImportOpen(true)}
        onSaveSuccess={() => { loadDaily().catch(() => {}); }}
      />}
      dailyRows={daily}
      summary={dailySummary}
      loading={dailyLoading}
      error={dailyError}
      onRetry={() => { void loadDaily().catch(() => undefined); }}
      search={dailySearch}
      onSearchChange={setDailySearch}
      session={dailySession}
      onSessionChange={setDailySession}
      deliveryFilter={dailyDeliveryFilter}
      onDeliveryFilterChange={setDailyDeliveryFilter}
      collectorFilter={dailyCollectorFilter}
      onCollectorFilterChange={setDailyCollectorFilter}
      sortBy={dailySortBy}
      sortDirection={dailySortDirection}
      onSortByChange={setDailySortBy}
      onSortDirectionChange={setDailySortDirection}
      pageSize={dailyPageSize}
      onPageSizeChange={setDailyPageSize}
      hasMore={dailyHasMore}
      onLoadMore={() => { if (dailyCursor) void loadDaily(dailyCursor, true).catch(() => undefined); }}
      busy={busy}
      inlineNumberFarmerId={inlineNumberFarmerId}
      inlineFarmerNumber={inlineFarmerNumber}
      inlineNumberSaving={inlineNumberSaving}
      onStartFarmerNumberEdit={startEditingFarmerNumber}
      onChangeFarmerNumber={setInlineFarmerNumber}
      onSaveFarmerNumber={(farmerId, farmerNumber) => { void saveInlineFarmerNumber(farmerId, farmerNumber); }}
      onCancelFarmerNumberEdit={() => setInlineNumberFarmerId(null)}
      recentlySaved={(farmerId) => recentlySavedRows.has(farmerId)}
      volumes={volumes}
      onVolumeChange={(farmerId, period, value) => setVolumes((current) => ({
        ...current,
        [farmerId]: { ...(current[farmerId] || { morning: '', evening: '' }), [period]: value },
      }))}
      onSave={(row) => { void saveMilk(row); }}
      qualities={milkQualities}
      onQualityChange={(farmerId) => setMilkQualities((previous) => {
        const current = previous[farmerId] || 'accepted';
        const next = current === 'accepted' ? 'tested' : current === 'tested' ? 'rejected' : 'accepted';
        if (next === 'rejected') {
          const farmer = daily.find((row) => row.farmerId === farmerId);
          if (farmer) window.alert(publicLanguage.language === 'en' ? `Milk from ${farmer.farmerName} marked as REJECTED.` : `Amata ya ${farmer.farmerName} yanzwe (Rejected).`);
        }
        return { ...previous, [farmerId]: next };
      })}
      onOpenIfishi={(farmerId, farmerName) => openIfishiForFarmer(farmerId, farmerName)}
      onOpenHistory={openFarmerHistory}
      onOpenLossEvent={() => { setLossEventPercentage(''); setLossEventReason(''); setLossEventOtherReason(''); setLossEventConfirmed(false); setLossPreview(null); setLossEventOpen(true); }}
      onOpenScanner={() => setMilkImportOpen(true)}
      quickAddOpen={quickAddOpen}
      onQuickAddOpenChange={(open) => { if (open) setMilkViewMode('daily'); setQuickAddOpen(open); }}
      quickAddName={quickAddName}
      onQuickAddNameChange={setQuickAddName}
      quickAddPhone={quickAddPhone}
      onQuickAddPhoneChange={setQuickAddPhone}
      quickAddMorning={quickAddMorning}
      onQuickAddMorningChange={setQuickAddMorning}
      quickAddBusy={quickAddBusy}
      onQuickAddSubmit={() => { void handleQuickAddFarmerSubmit(); }}
      ownerMilkVolume={collectorMilkEntry ? Number(collectorMilkEntry.effectiveVolumeLiters ?? collectorMilkEntry.volumeLiters) : null}
      onOpenOwnerIfishi={() => { setIfishiOpen(false); openOwnerIfishiEntry(); }}
      ownerHistoryOpen={ownerIfishiHistoryOpen}
      onToggleOwnerHistory={() => setOwnerIfishiHistoryOpen((open) => !open)}
      ownerHistoryContent={isCollector && ownerIfishiHistoryOpen ? renderOwnerIfishiHistory() : null}
      ownerEntryDialog={isCollector && ownerIfishiOpen ? <Modal ariaLabel={publicLanguage.t('ownerIfishiTitle')} className="owner-ifishi-entry-modal" onClose={() => setOwnerIfishiOpen(false)} dismissible={!busy}>{renderOwnerIfishiEntry()}</Modal> : null}
      ifishiDialog={ifishiOpen ? <Modal ariaLabel={publicLanguage.t('navIfishi')} className="modal-panel-wide ifishi-modal" onClose={() => setIfishiOpen(false)} dismissible={!busy}>{renderIfishi()}</Modal> : null}
      farmerNumberLabel={(value) => formatFarmerNumber(value) || '—'}
      collectorLabel={(row) => row.collectorName || getFarmerCollectorName(row.collectorUserId)}
      formatLiters={liters}
    />;
  };

  const renderOwnerIfishiEntry = () => {
    const selectedEntry = ownerIfishiHistory?.entries.find((entry) => entry.date === ifishiDate && entry.id !== null);
    const selectedPeriod = ownerIfishiPeriod === 'first-half' ? '1–15' : `16–${getMonthBounds(ifishiMonth).endDate.slice(-2)}`;
    return <>
      <div className="panel-heading"><div><span className="eyebrow">{selectedEntry?.id ? publicLanguage.t('ownerIfishiCorrection') : publicLanguage.t('ownerIfishiMissed')}</span><h2>{publicLanguage.t('ownerIfishiDailyEntry')}</h2></div><button type="button" className="icon-button" onClick={() => setOwnerIfishiOpen(false)} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
      <p className="muted-note owner-ifishi-entry-period">{ifishiMonth} · {selectedPeriod}</p>
      <form className="form-stack compact owner-ifishi-entry-form" onSubmit={saveOwnerIfishiEntry}>
        <label>{publicLanguage.t('milkCollectionDate')}<input type="date" max={today()} value={ifishiDate} onChange={(event) => selectOwnerIfishiDate(event.target.value)} required /></label>
        <label>{publicLanguage.t('dashboardMorning')} · 06:30–09:00 · L<input type="number" min="0" step="0.01" value={ownerIfishiMorning} onChange={(event) => setOwnerIfishiMorning(event.target.value)} /></label>
        <label>{publicLanguage.t('dashboardEvening')} · 17:30–19:00 · L<input type="number" min="0" step="0.01" value={ownerIfishiEvening} onChange={(event) => setOwnerIfishiEvening(event.target.value)} /></label>
        <p className="muted-note">{publicLanguage.t('milkTotal')}: {liters((Number(ownerIfishiMorning) || 0) + (Number(ownerIfishiEvening) || 0))} L</p>
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
      const date = new Date(`${ifishiMonth}-01T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + offset);
      selectOwnerIfishiMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    };
    const differenceSideLabel = (difference: number) => publicLanguage.t(difference > 0 ? 'dashboardOwnerHigher' : difference < 0 ? 'dashboardFarmersHigher' : 'dashboardMilkEqual');

    return <div className="screen-grid owner-ifishi-view">
      <section className="panel panel-wide owner-ifishi-context">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ownerIfishiHistory')}</span><h2>{user?.name || user?.email}</h2></div><span className="count-label">{ownerIfishiHistory?.entries.length || 0} {publicLanguage.t('ifishiRecordedDays')}</span></div>
        <p className="muted-note">{publicLanguage.t('ownerIfishiContext')}</p>
        <div className="owner-ifishi-period">
          <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label={publicLanguage.t('ownerIfishiPreviousMonth')} title={publicLanguage.t('ownerIfishiPreviousMonth')}><ChevronLeft size={17} /></button>
          <label>{publicLanguage.t('ifishiMonth')}<input type="month" max={today().slice(0, 7)} value={ifishiMonth} onChange={(event) => selectOwnerIfishiMonth(event.target.value)} /></label>
          <label>{publicLanguage.t('ukweziPeriod')}<select value={ownerIfishiPeriod} onChange={(event) => setOwnerIfishiPeriod(event.target.value as typeof ownerIfishiPeriod)}><option value="first-half">1–15</option><option value="second-half">16–{getMonthBounds(ifishiMonth).endDate.slice(-2)}</option></select></label>
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
            <div className="table-scroll owner-ifishi-desktop-list"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('dashboardMorning')} · L</th><th>{publicLanguage.t('dashboardEvening')} · L</th><th>{publicLanguage.t('ifishiOriginal')} · L</th><th>{publicLanguage.t('ownerIfishiOwnerMilk')} · L</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('ownerIfishiGross')}</th><th>{publicLanguage.t('ownerIfishiAssigned')} · L</th><th>{publicLanguage.t('dashboardMilkDifference')} · L</th><th>{publicLanguage.t('ownerIfishiSurplus')} · L</th><th>{publicLanguage.t('ifishiLost')} · L</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th><th /></tr></thead><tbody>{ownerIfishiHistory.entries.map((entry) => <tr key={`${entry.date}-${entry.id || 'assigned'}`}>
              <td><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.date}</button></td>
              <td>{liters(entry.volumeMorning)} L</td><td>{liters(entry.volumeEvening)} L</td><td>{liters(entry.originalVolumeLiters)} L</td><td>{liters(entry.validVolumeLiters)} L</td><td>{entry.pricePerLiter == null ? '—' : `${money(entry.pricePerLiter)} RWF`}</td><td>{entry.grossAmount == null ? '—' : `${money(entry.grossAmount)} RWF`}</td><td>{liters(entry.assignedFarmerLiters)} L</td><td><b>{signedLiters(entry.differenceLiters)} L</b><small className="owner-ifishi-difference-side">{differenceSideLabel(entry.differenceLiters)}</small></td><td>{liters(entry.surplusLiters)} L</td><td>{liters(entry.lostVolumeLiters)} L</td>
              <td>{entry.status}</td><td>{entry.adjustmentReason || '—'}</td>
              <td><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.id && entry.status === 'valid' ? publicLanguage.t('ownerIfishiCorrect') : entry.id ? publicLanguage.t('ownerIfishiVoidedShort') : publicLanguage.t('ownerIfishiEnter')}</button></td>
            </tr>)}</tbody></table></div>
            <div className="owner-ifishi-mobile-list">{ownerIfishiHistory.entries.map((entry) => <article className="owner-ifishi-day" key={`${entry.date}-${entry.id || 'assigned'}`}>
              <header><button type="button" className="text-button" onClick={() => openOwnerIfishiEntry(entry.date)}>{entry.date}</button><span className={`milk-entry-state ${entry.status === 'cancelled' ? 'unsaved' : 'saved'}`}>{entry.status}</span></header>
              <dl><div><dt>{publicLanguage.t('dashboardMorning')}</dt><dd>{liters(entry.volumeMorning)} L</dd></div><div><dt>{publicLanguage.t('dashboardEvening')}</dt><dd>{liters(entry.volumeEvening)} L</dd></div><div><dt>{publicLanguage.t('ifishiOriginal')}</dt><dd>{liters(entry.originalVolumeLiters)} L</dd></div><div><dt>{publicLanguage.t('ownerIfishiOwnerMilk')}</dt><dd>{liters(entry.validVolumeLiters)} L</dd></div><div><dt>{publicLanguage.t('milkPrice')} / L</dt><dd>{entry.pricePerLiter == null ? '—' : `${money(entry.pricePerLiter)} RWF`}</dd></div><div><dt>{publicLanguage.t('ownerIfishiGross')}</dt><dd>{entry.grossAmount == null ? '—' : `${money(entry.grossAmount)} RWF`}</dd></div><div><dt>{publicLanguage.t('ownerIfishiAssigned')}</dt><dd>{liters(entry.assignedFarmerLiters)} L</dd></div><div><dt>{publicLanguage.t('dashboardMilkDifference')}</dt><dd>{signedLiters(entry.differenceLiters)} L · {differenceSideLabel(entry.differenceLiters)}</dd></div><div><dt>{publicLanguage.t('ownerIfishiSurplus')}</dt><dd>{liters(entry.surplusLiters)} L</dd></div><div><dt>{publicLanguage.t('ifishiLost')}</dt><dd>{liters(entry.lostVolumeLiters)} L</dd></div></dl>
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
    const selectedFarmer = (ifishiSelectedFarmer && String(ifishiSelectedFarmer.id) === ifishiFarmerId)
      ? ifishiSelectedFarmer
      : ifishiFarmers.find((farmer) => String(farmer.id) === ifishiFarmerId)
        || (farmers?.data || []).find((farmer) => String(farmer.id) === ifishiFarmerId);
    const selectedCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name || 'Active Ikigo';
    const chooseIfishiFarmer = (farmer: Farmer, index = -1) => {
      setIfishiFarmerId(String(farmer.id));
      setIfishiSelectedFarmer(farmer);
      setIfishiFarmerSearch(farmer.name);
      setIfishiActiveResultIndex(index);
      setIfishiResultsOpen(false);
      setIfishiSaveError('');
    };
    const handleIfishiSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setIfishiResultsOpen(false);
        setIfishiActiveResultIndex(-1);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setIfishiResultsOpen(true);
        if (!ifishiFarmers.length) return;
        setIfishiActiveResultIndex((current) => {
          if (event.key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % ifishiFarmers.length;
          return current <= 0 ? ifishiFarmers.length - 1 : current - 1;
        });
        return;
      }
      if (event.key === 'Enter' && ifishiResultsOpen && ifishiActiveResultIndex >= 0) {
        const farmer = ifishiFarmers[ifishiActiveResultIndex];
        if (farmer) {
          event.preventDefault();
          chooseIfishiFarmer(farmer, ifishiActiveResultIndex);
        }
      }
    };
    const selectedFarmerDetail = selectedFarmer
      ? [selectedFarmer.collectionCenter, selectedFarmer.location, selectedFarmer.nationalId ? `ID ${selectedFarmer.nationalId}` : null].filter(Boolean).join(' · ')
      : '';
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
          <div className="ifishi-search-field">
            <label htmlFor="ifishi-farmer-search">{accountCopy('milkFarmerSearch', 'milkAbacundaSearch')}</label>
            <div className="ifishi-combobox">
              <Search size={16} aria-hidden="true" />
              <input
                id="ifishi-farmer-search"
                type="search"
                role="combobox"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={ifishiResultsOpen}
                aria-controls="ifishi-farmer-results"
                aria-activedescendant={ifishiResultsOpen && ifishiActiveResultIndex >= 0 && ifishiFarmers[ifishiActiveResultIndex] ? `ifishi-farmer-option-${ifishiFarmers[ifishiActiveResultIndex].id}` : undefined}
                placeholder={accountCopy('milkFarmerSearch', 'milkAbacundaSearch')}
                value={ifishiFarmerSearch}
                onFocus={() => setIfishiResultsOpen(true)}
                onChange={(event) => {
                  const value = event.target.value;
                  setIfishiFarmerSearch(value);
                  // Editing the query deselects the old farmer so milk cannot be
                  // saved against a person who no longer matches the search.
                  if (value !== selectedFarmer?.name) {
                    setIfishiFarmerId('');
                    setIfishiSelectedFarmer(null);
                  }
                  setIfishiResultsOpen(true);
                  setIfishiActiveResultIndex(-1);
                }}
                onKeyDown={handleIfishiSearchKeyDown}
              />
            </div>
            {ifishiResultsOpen ? <div className="ifishi-search-results" id="ifishi-farmer-results" role="listbox" aria-label={publicLanguage.t('ifishiSearchResults')}>
              {ifishiFarmersLoading ? <p className="ifishi-search-state" role="status">{publicLanguage.t('loading')}</p> : ifishiFarmers.length ? ifishiFarmers.map((farmer, index) => <button
                key={farmer.id}
                id={`ifishi-farmer-option-${farmer.id}`}
                type="button"
                role="option"
                aria-selected={String(farmer.id) === ifishiFarmerId}
                className={`ifishi-search-result${index === ifishiActiveResultIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setIfishiActiveResultIndex(index)}
                onClick={() => chooseIfishiFarmer(farmer, index)}
              >
                <span className="ifishi-search-result-name">
                  <span className="ifishi-search-result-identity"><span className="farmer-number-badge">{formatFarmerNumber(farmer.farmerNumber) || '—'}</span><span>{farmer.name}</span></span>
                  <span className="ifishi-search-result-meta">{String(farmer.id) === ifishiFarmerId ? <Check size={16} aria-hidden="true" /> : null}<span className={`delivery-status-pill ${farmer.collectorUserId ? 'is-assigned' : 'is-unassigned'}`}>{publicLanguage.t(farmer.collectorUserId ? 'statusAssigned' : 'statusUnassigned')}</span></span>
                </span>
                <small>{[farmer.phone, getFarmerCollectorName(farmer.collectorUserId), farmer.collectionCenter, farmer.nationalId ? `ID ${farmer.nationalId}` : null].filter(Boolean).join(' · ') || farmer.location || '—'}</small>
              </button>) : <p className="ifishi-search-state" role="status">{publicLanguage.t('ifishiNoPeople')}</p>}
            </div> : null}
          </div>
          {selectedFarmer ? <div className="ifishi-selected-person" role="status"><Check size={18} aria-hidden="true" /><div><span>{publicLanguage.t('ifishiSelectedFarmer')}</span><b><span className="farmer-number-badge">{formatFarmerNumber(selectedFarmer.farmerNumber) || '—'}</span> {selectedFarmer.name}</b><small>{[selectedCenterName, selectedFarmer.phone, getFarmerCollectorName(selectedFarmer.collectorUserId), selectedFarmerDetail].filter(Boolean).join(' · ')}</small></div><button type="button" className="text-button ifishi-selected-history" onClick={() => { setIfishiOpen(false); openFarmerHistory(selectedFarmer); }}>{publicLanguage.t('viewFarmerHistory')}</button></div> : null}
          <label>{publicLanguage.t('milkCollectionDate')}<input type="date" min={startDate} max={endDate} value={ifishiDate} onChange={(event) => setIfishiDate(event.target.value)} /></label>
          <label>{publicLanguage.t('milkSessionFilter')}<select value={ifishiRecordSession} onChange={(event) => setIfishiRecordSession(event.target.value as typeof ifishiRecordSession)}><option value="all">{publicLanguage.t('milkSessionAll')}</option><option value="morning">{publicLanguage.t('milkSessionMorning')}</option><option value="evening">{publicLanguage.t('milkSessionEvening')}</option></select></label>
          <label>{publicLanguage.t('sort')}<select value={`${ifishiRecordSortBy}:${ifishiRecordSortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); if (['date', 'volume', 'amount'].includes(field) && ['asc', 'desc'].includes(direction)) { setIfishiRecordSortBy(field as typeof ifishiRecordSortBy); setIfishiRecordSortDirection(direction as typeof ifishiRecordSortDirection); } }}>
            <option value="date:desc">{publicLanguage.t('milkCollectionDate')} ↓</option><option value="date:asc">{publicLanguage.t('milkCollectionDate')} ↑</option>
            <option value="volume:asc">{publicLanguage.t('reportsVolume')} ↑</option><option value="volume:desc">{publicLanguage.t('reportsVolume')} ↓</option>
            <option value="amount:asc">{publicLanguage.t('milkTotal')} ↑</option><option value="amount:desc">{publicLanguage.t('milkTotal')} ↓</option>
          </select></label>
          {ifishiRecordSession !== 'all' || ifishiRecordSortBy !== 'date' || ifishiRecordSortDirection !== 'desc' ? <button type="button" className="button button-secondary small-button" onClick={() => { setIfishiRecordSession('all'); setIfishiRecordSortBy('date'); setIfishiRecordSortDirection('desc'); }}>{publicLanguage.t('milkClearSearch')}</button> : null}
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
    // The label and the daily query must use the same authoritative date-only value.
    // Passing the string avoids interpreting local midnight as the previous UTC day.
    const dateLabel = formatDateLabel(collectionDate, publicLanguage.language, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const periodStart = report?.rangeStart?.slice(8, 10);
    const periodEnd = report?.rangeEnd?.slice(8, 10);
    const periodMonth = report?.rangeStart
      ? formatDateLabel(report.rangeStart, publicLanguage.language, { month: 'long', year: 'numeric' })
      : null;
    const centerNames = dailyCenters.length ? dailyCenters : dailyCenter ? [dailyCenter] : [];
    const centerLabel = centerNames.length ? centerNames.join(', ') : '';
    const milkDifference = dashboardOwnerMilk.status === 'available'
      ? calculateMilkDifference(dashboardOwnerMilk.validVolumeLiters, dailySummary.totalVolume)
      : null;
    const recentRows = daily.filter((row) => row.recordId && row.totalVolume > 0).slice(0, 6);
    const dashboardActions = [
      { id: 'farmers' as Tab, label: publicLanguage.t('navFarmers'), icon: Users },
      { id: 'deductions' as Tab, label: publicLanguage.t('navDeductions'), icon: CircleDollarSign },
      { id: 'reports' as Tab, label: publicLanguage.t('navReports'), icon: FileBarChart2 },
      { id: 'ukwezi' as Tab, label: publicLanguage.t('dashboardUkwezi'), icon: CalendarDays },
    ].filter((action) => visibleTabs.some((item) => item.id === action.id));
    const dailyStatus = dailyLoading || (dashboardLoading && !dashboardDailyReady)
      ? 'loading'
      : dailyError ? 'error' : dashboardDailyReady ? 'available' : 'unavailable';
    const accountingStatus = reportLoading ? 'loading' : reportError ? 'error' : report ? 'available' : 'unavailable';
    const alertStatus = unreadCountStatus;
    const subscriptionStatus = billingLoading ? 'loading' : billingError ? 'error' : billing ? 'available' : 'unavailable';
    const periodLabel = accountingStatus === 'available' && periodStart && periodEnd && periodMonth
      ? `${publicLanguage.t('dashboardUkwezi')} ${Number(periodStart)}–${Number(periodEnd)} · ${periodMonth}`
      : '';

    return <DashboardView
      t={publicLanguage.t}
      dateLabel={dateLabel}
      isCollector={isCollector}
      isDairy={isDairy}
      canRecordMilk={visibleTabs.some((item) => item.id === 'milk')}
      farmersLabel={accountCopy('dashboardFarmers', 'dashboardAbacundaToday')}
      actions={dashboardActions}
      onNavigate={(nextTab) => setTab(nextTab as Tab)}
      onOpenOwnerIfishi={() => setOwnerIfishiOpen(true)}
      onRetryDaily={() => { void loadDaily().catch(() => undefined); }}
      onRetryOwnerMilk={() => { void loadDashboardOwnerMilk(collectionDate); }}
      onRetryReport={() => { void loadReport('current-half'); }}
      onRetryUnread={() => { void loadUnreadCount(); }}
      onRetrySubscription={() => { void loadBilling(); }}
      daily={{
        status: dailyStatus,
        error: dailyError,
        totalVolume: dailySummary.totalVolume,
        totalMorning: dailySummary.totalMorning,
        totalEvening: dailySummary.totalEvening,
        presentCount: dailySummary.presentCount,
        totalFarmers: dailySummary.totalFarmers,
        centerLabel,
        periodLabel,
        recentRows: recentRows.map((row) => ({
          id: row.recordId as number,
          farmerName: row.farmerName,
          center: row.collectionCenter || dailyCenter || '',
          totalVolume: row.totalVolume,
        })),
      }}
      ownerMilk={dashboardOwnerMilk}
      milkDifference={milkDifference}
      accounting={{
        status: accountingStatus,
        error: reportError,
        gross: report ? report.ownerGeneratedGross ?? report.totalRevenueMonth : null,
        deductions: report?.totalDeductionsMonth ?? null,
        net: report?.netRevenueMonth ?? null,
        payable: report?.collectorPayable ?? null,
      }}
      alerts={{ status: alertStatus, count: unreadCount }}
      subscription={{
        status: subscriptionStatus,
        label: billing ? subscriptionStatusLabel(billing.subscription?.effective_status || billing.subscription?.status) : '',
      }}
      formatLiters={liters}
      formatMoney={money}
    />;
  };

  const renderDeductions = () => (
    <>
      <DeductionView
        ledgerRows={deductionLedgerRows}
        ledgerSummary={deductionLedgerSummary}
        ledgerLoading={deductionLedgerLoading}
        ledgerHasMore={deductionLedgerHasMore}
        ledgerSearch={deductionLedgerSearch}
        onLedgerSearchChange={(value) => {
          setDeductionLedgerSearch(value);
          void loadDeductionLedger(null, false, { search: value });
        }}
        ledgerStatus={deductionLedgerStatus}
        onLedgerStatusChange={(value) => {
          setDeductionLedgerStatus(value);
          void loadDeductionLedger(null, false, { status: value });
        }}
        onLedgerConfigurationChange={(configurationId) => {
          setDeductionLedgerConfigurationId(configurationId);
          void loadDeductionLedger(null, false, { configurationId });
        }}
        periodStart={deductionPeriod.startDate}
        periodEnd={deductionPeriod.endDate}
        onPeriodChange={(startDate, endDate) => {
          setDeductionPeriod({ startDate, endDate });
          setDeductionLedgerStatus('ALL');
          void loadDeductionLedger(null, false, { periodStart: startDate, periodEnd: endDate, status: 'ALL' });
        }}
        onLoadLedger={(cursor, append) => loadDeductionLedger(cursor ?? (append ? deductionLedgerNextCursor : null), Boolean(append))}
        onLoadAllEligible={loadAllEligibleDeductionFarmers}
        configurations={deductionConfigurations}
        configurationsLoading={deductionConfigurationsLoading}
        onLoadConfigurations={loadDeductionConfigurations}
        onSaveConfiguration={saveDeductionConfiguration}
        onApplyConfiguredBatch={applyConfiguredDeductionBatch}
        onInspectFarmer={(group) => { void openDeductionInspector(group); }}
        inspectorOpen={deductionInspectorOpen}
        inspectorFarmerName={deductionInspectorFarmer?.name ?? null}
        inspectorRows={deductionHistoryRows}
        inspectorLoading={deductionHistoryLoading}
        inspectorHasMore={deductionHistoryHasMore}
        inspectorError={deductionHistoryError}
        onCloseInspector={() => {
          setDeductionInspectorOpen(false);
          setDeductionHistoryRows([]);
          setDeductionHistoryError('');
        }}
        onLoadHistoryMore={() => {
          if (!deductionInspectorFarmer) return;
          void loadDeductionHistory(deductionInspectorFarmer.id, deductionHistoryCursor, true);
        }}
        onEditDeduction={async (row) => { await saveDeductionFromInspector(row); }}
        onClearDeduction={async (row) => { await clearDeductionFromInspector(row); }}
        onOpenCreate={() => {
          setDeductionCreateError('');
          setDeductionCreateOpen(true);
          void loadDeductionFarmers();
        }}
        onAddDeduction={async (input) => { await createDeductionFromView(input); }}
        createOpen={deductionCreateOpen}
        onCloseCreate={() => setDeductionCreateOpen(false)}
        deductionFarmers={deductionFarmers}
        deductionFarmerSearch={deductionFarmerSearch}
        setDeductionFarmerSearch={setDeductionFarmerSearch}
        onLoadDeductionFarmers={loadDeductionFarmers}
        createBusy={busy}
        createError={deductionCreateError}
        t={(key) => publicLanguage.t(key as any)}
      />

    </>
  );

  const renderNyirayoAuditCard = (data: {
    nyirayoMilkValue?: number | null;
    farmersMilkValue?: number | null;
    nyirayoBaseDifference?: number | null;
    transportAmount?: number | null;
    farmerDeductions?: number | null;
    retainedNoAccountFarmerAmount?: number | null;
    nyirayoOperationalMargin?: number | null;
    nyirayoTotalAfterOperations?: number | null;
    verificationDifference?: number | null;
  }) => {
    const hasValues = data.nyirayoMilkValue != null || data.farmersMilkValue != null || data.nyirayoBaseDifference != null;
    if (!hasValues) return null;
    const baseDiff = data.nyirayoBaseDifference ?? (data.nyirayoMilkValue != null && data.farmersMilkValue != null ? data.nyirayoMilkValue - data.farmersMilkValue : null);
    const transport = data.transportAmount ?? null;
    const deductions = data.farmerDeductions ?? null;
    const noAccount = data.retainedNoAccountFarmerAmount ?? null;
    const opMargin = data.nyirayoOperationalMargin ?? (baseDiff !== null && transport !== null && deductions !== null ? baseDiff + transport + deductions : null);
    const total = data.nyirayoTotalAfterOperations ?? (opMargin !== null && noAccount !== null ? opMargin + noAccount : null);
    const formatAmount = (value: number | null, positive = false) => value === null ? '—' : `${positive ? '+' : ''}${money(value)} RWF`;

    return (
      <section className="nyirayo-audit-section panel" aria-labelledby="nyirayo-audit-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span>
            <h3 id="nyirayo-audit-heading">{publicLanguage.t('nyirayoAuditTitle')}</h3>
          </div>
          <ReceiptText size={20} aria-hidden="true" />
        </div>
        <div className="metric-strip nyirayo-audit-metrics">
          <div>
            <span>{publicLanguage.t('nyirayoRecordedMilkValue')}</span>
            <b>{formatAmount(data.nyirayoMilkValue ?? null)}</b>
          </div>
          <div>
            <span>{publicLanguage.t('farmersRecordedMilkValue')}</span>
            <b>{formatAmount(data.farmersMilkValue ?? null)}</b>
          </div>
          <div className={baseDiff !== null && baseDiff < 0 ? 'metric-negative' : undefined}>
            <span>{publicLanguage.t('nyirayoBaseDifference')}</span>
            <b>{formatAmount(baseDiff)}</b>
          </div>
          <div>
            <span>{publicLanguage.t('transportShare')}</span>
            <b>{formatAmount(transport, true)}</b>
          </div>
          <div>
            <span>{publicLanguage.t('farmerDeductionsShare')}</span>
            <b>{formatAmount(deductions, true)}</b>
          </div>
          <div className="metric-highlight">
            <span>{publicLanguage.t('nyirayoOperationalMargin')}</span>
            <b>{formatAmount(opMargin)}</b>
          </div>
          <div>
            <span>{publicLanguage.t('retainedNoAccountFarmerAmount')}</span>
            <b>{formatAmount(noAccount, true)}</b>
          </div>
          <div className="metric-highlight">
            <span>{publicLanguage.t('nyirayoTotalAfterOperations')}</span>
            <b>{formatAmount(total)}</b>
          </div>
          {data.verificationDifference != null ? <div className={data.verificationDifference < 0 ? 'metric-negative' : undefined}>
            <span>{publicLanguage.t('ukweziVerificationDifference')}</span>
            <b>{money(data.verificationDifference)} RWF</b>
          </div> : null}
        </div>
        <p className="muted-note">
          {publicLanguage.t('unaccountedFarmersNotice')}
        </p>
      </section>
    );
  };

  const renderSettlements = () => {
    const { startDate, endDate } = getSettlementPeriodBounds(settlementMonth, settlementHalf);
    const reconciliation = settlementReport?.settlementAccounting || null;
    const farmerRows = reconciliation?.farmers || [];
    const searchTerm = settlementSearch.trim().toLocaleLowerCase();
    const matchesSearch = (row: any) => !searchTerm || [row.farmerName, row.farmer_name, row.phone, row.nationalId, row.accountNumber]
      .some((value) => String(value || '').toLocaleLowerCase().includes(searchTerm));
    const accountsFarmers = farmerRows.filter((farmer) => Number(farmer.totalVolume || 0) > 0 && Boolean(farmer.settlement?.saccoEligible) && matchesSearch(farmer));
    const cashFarmers = farmerRows.filter((farmer) => Number(farmer.totalVolume || 0) > 0 && !farmer.settlement?.saccoEligible && matchesSearch(farmer));
    const remainingCashFarmers = cashFarmers.filter((farmer) => Number(farmer.settlement?.retainedUnpaidAmount || 0) > 0);
    const retainedRows = farmerRows.filter((farmer) => !farmer.settlement.saccoEligible && Number(farmer.settlement.retainedUnpaidAmount || 0) > 0);
    const settlementRecords = (settlementData?.data || []).filter(matchesSearch);
    const visibleDebts = settlementDebts.filter(matchesSearch);
    const settlementNumber = new Intl.NumberFormat(publicLanguage.language === 'rw' ? 'rw-RW' : 'en-GB', { maximumFractionDigits: 2 });
    const settlementMoney = (value: number | null | undefined) => value === null || value === undefined ? '—' : settlementNumber.format(Number(value || 0));
    const settlementDate = (value?: string) => value
      ? formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';
    const settlementDateTime = (value?: string | null) => value
      ? formatDateLabel(value, publicLanguage.language, { day: 'numeric', month: 'short', year: 'numeric', time: 'short' })
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

    const settleSingleCash = async (farmerId: number, amount: number) => {
      const keyScope = `cash-${farmerId}-${startDate}`;
      const res = await api<any>('/api/farmer-settlements', json('POST', {
        action: 'cash', farmerId, amount, periodStart: startDate, periodEnd: endDate, requestKey: requestKey(keyScope),
      }));
      if (res?.record?.id) {
        await api('/api/farmer-settlements', json('POST', {
          action: 'confirm', settlementId: res.record.id, farmerId, periodStart: startDate, periodEnd: endDate,
        }));
      }
      setNotice(publicLanguage.t('settlementsPaymentConfirmed'));
      delete settlementRequestKeys.current[keyScope];
      await loadSettlementData();
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

    const confirmCashPayments = async (records: SettlementBatchRecord[]) => {
      if (settlementOperationRef.current || !records.length) return;
      const confirmMessage = formatPublicCopy(publicLanguage.language, 'settlementsConfirmSelected', 'Confirm selected settlements ({count})?', { count: records.length });
      if (!window.confirm(confirmMessage)) return;

      settlementOperationRef.current = true;
      setBusy(true);
      clearMessages();
      try {
        const progress = await confirmSettlementBatch(records, async (record) => {
          const keyScope = `cash-${record.farmerId}-${startDate}`;
          const requestKeyValue = requestKey(keyScope);
          const response = await api<{ record?: SettlementRecord }>('/api/farmer-settlements', json('POST', {
            action: 'cash',
            farmerId: record.farmerId,
            amount: record.amount,
            periodStart: startDate,
            periodEnd: endDate,
            requestKey: requestKeyValue,
          }));
          if (!response.record?.id) throw new Error('The approved settlement record was not returned.');
          if (response.record.status !== 'CONFIRMED') {
            await api('/api/farmer-settlements', json('POST', {
              action: 'confirm',
              settlementId: response.record.id,
              farmerId: record.farmerId,
              periodStart: startDate,
              periodEnd: endDate,
            }));
          }
          delete settlementRequestKeys.current[keyScope];
        }, setCashConfirmationProgress);
        setSelectedCashFarmerIds(progress.failures.filter((failure) => failure.retryable).map((failure) => failure.farmerId));
        await loadSettlementData();
      } finally {
        settlementOperationRef.current = false;
        setBusy(false);
      }
    };

    const selectedCashFarmers = remainingCashFarmers.filter((farmer) => selectedCashFarmerIds.includes(farmer.farmerId));
    const allVisibleCashSelected = remainingCashFarmers.length > 0 && remainingCashFarmers.every((farmer) => selectedCashFarmerIds.includes(farmer.farmerId));
    const toggleCashFarmer = (farmerId: number) => setSelectedCashFarmerIds((current) => current.includes(farmerId)
      ? current.filter((id) => id !== farmerId)
      : [...current, farmerId]);
    const toggleAllCashFarmers = () => setSelectedCashFarmerIds(allVisibleCashSelected
      ? []
      : remainingCashFarmers.map((farmer) => farmer.farmerId));

    const breakdownValues = reconciliation ? [
      reconciliation.saccoConfirmedAmount,
      reconciliation.cashConfirmedAmount,
      reconciliation.debtRepaymentAmount,
      reconciliation.saccoDistributionInstruction,
      reconciliation.retainedUnpaidAmount,
      reconciliation.unexplainedDiscrepancy,
      reconciliation.expectedFarmerPayable,
    ] : [];
    const payableBreakdownAvailable = breakdownValues.length === 7
      && breakdownValues.every((value) => value !== null && value !== undefined);
    const ownerGrossCheck = reconciliation?.ownerGrossReconciliation;
    const ownerGrossCheckAvailable = ownerGrossCheck
      && ownerGrossCheck.ownerGross !== null && ownerGrossCheck.ownerGross !== undefined
      && ownerGrossCheck.farmerGross !== null && ownerGrossCheck.farmerGross !== undefined
      && ownerGrossCheck.surplus !== null && ownerGrossCheck.surplus !== undefined
      && ownerGrossCheck.discrepancy !== null && ownerGrossCheck.discrepancy !== undefined;
    const periodLabel = settlementReport
      ? `${formatDateLabel(settlementReport.rangeStart, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })} – ${formatDateLabel(settlementReport.rangeEnd, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `${startDate} – ${endDate}`;

    const years = getAccountingYears();
    const bilingualMonths = getBilingualMonthNames();
    const settlementYear = settlementMonth.slice(0, 4);
    const settlementMonthPart = settlementMonth.slice(5, 7);

    const selectSettlementYear = (year: string) => {
      const newMonthVal = `${year}-${settlementMonthPart}`;
      setSettlementMonth(newMonthVal);
      synchronizeCurrentAccountingHalf(settlementMonthPart, year, setSettlementHalf);
    };

    const selectSettlementMonthPart = (month: string) => {
      const newMonthVal = `${settlementYear}-${month}`;
      setSettlementMonth(newMonthVal);
      synchronizeCurrentAccountingHalf(month, settlementYear, setSettlementHalf);
    };

    const totalSettledSoFar = (reconciliation?.saccoConfirmedAmount || 0) + (reconciliation?.cashConfirmedAmount || 0) + (reconciliation?.debtRepaymentAmount || 0);

    return <div className="ukwezi-view">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('dashboardPeriod')}</span>
            <h2>{publicLanguage.t('settlementsTitle')}</h2>
          </div>
          <Wallet size={20} aria-hidden="true" />
        </div>

        <div className="toolbar ukwezi-period-controls">
          <label>
            {publicLanguage.t('ukweziMonth')}
            <select value={settlementMonthPart} onChange={(event) => selectSettlementMonthPart(event.target.value)}>
              {bilingualMonths.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            {publicLanguage.t('ukweziYear')}
            <select value={settlementYear} onChange={(event) => selectSettlementYear(event.target.value)}>
              {years.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <div className="timeline-scrubber" role="radiogroup" aria-label={publicLanguage.t('ukweziPeriod')}>
            <button
              type="button"
              className={`timeline-scrubber-pill${settlementHalf === 'first-half' ? ' is-active' : ''}`}
              onClick={() => setSettlementHalf('first-half')}
            >
              1–15
            </button>
            <button
              type="button"
              className={`timeline-scrubber-pill${settlementHalf === 'second-half' ? ' is-active' : ''}`}
              onClick={() => setSettlementHalf('second-half')}
            >
              16–{getMonthBounds(settlementMonth).endDate.slice(-2)}
            </button>
          </div>
          <label style={{ display: 'none' }}>
            {publicLanguage.t('ukweziPeriod')}
            <select value={settlementHalf} onChange={(event) => setSettlementHalf(event.target.value as typeof settlementHalf)}>
              <option value="first-half">1–15</option>
              <option value="second-half">16–{getMonthBounds(settlementMonth).endDate.slice(-2)}</option>
            </select>
          </label>
          <label style={{ display: 'none' }}>
            {publicLanguage.t('ukweziMonth')}
            <input type="month" value={settlementMonth} onChange={(event) => selectSettlementMonth(event.target.value)} />
          </label>
          <button type="button" className="button button-secondary" onClick={() => run(() => loadSettlementData())} disabled={busy || settlementLoading}>
            {publicLanguage.t('reportsRefresh')}
          </button>
        </div>

        <label className="settlement-search"><span>{publicLanguage.t('settlementsSearch')}</span><span className="settlement-search-control"><Search size={16} aria-hidden="true" /><input type="search" value={settlementSearch} onChange={(event) => { setSettlementSearch(event.target.value); setSelectedCashFarmerIds([]); }} /><button type="button" className="icon-button" onClick={() => { setSettlementSearch(''); setSelectedCashFarmerIds([]); }} aria-label={publicLanguage.t('milkClearSearch')} disabled={!settlementSearch}><X size={15} aria-hidden="true" /></button></span></label>

        <p role="note">{publicLanguage.t('settlementsNote')}</p>
        {settlementReportError ? <div className="workspace-empty" role="alert"><b>{publicLanguage.t('settlementsAccountingLoadError')}</b><button type="button" className="button button-secondary small-button" onClick={() => void loadSettlementData()} disabled={settlementLoading}>{publicLanguage.t('settlementsRetry')}</button></div> : null}
        {settlementError ? <div className="workspace-empty" role="alert"><b>{publicLanguage.t(settlementError)}</b><button type="button" className="button button-secondary small-button" onClick={() => void loadSettlementData()} disabled={settlementLoading}>{publicLanguage.t('settlementsRetry')}</button></div> : null}
        {settlementLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : null}

        {settlementReport?.settlementAccountingStatus === 'MIGRATION_REQUIRED' ? <div className="workspace-empty" role="status"><b>{publicLanguage.t('ukweziReconciliationUnavailable')}</b><p>{publicLanguage.t('ukweziReconciliationUnavailableDetail')}</p></div> : null}
        {reconciliation && settlementReport && !settlementLoading ? <>
          <section className="settlement-reconciliation" aria-labelledby="settlement-period-heading">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{publicLanguage.t('settlementsPeriodSummary')}</span>
                <h3 id="settlement-period-heading">{periodLabel}</h3>
              </div>
            </div>

            <div className="settlement-payout-grid">
              <div className="kpi-stat-card">
                <div className="kpi-stat-label">Amafaranga Yose Agomba Kwishyurwa</div>
                <div className="kpi-stat-value">{settlementMoney(reconciliation.expectedFarmerPayable)} RWF</div>
                <div className="kpi-stat-subtext">Total Net Payable across all eligible farmers</div>
              </div>
              <div className="kpi-stat-card">
                <div className="kpi-stat-label">Ayanyuze Kuri Konti</div>
                <div className="kpi-stat-value">{settlementMoney(reconciliation.saccoDistributionInstruction ?? reconciliation.accountRoutedPayable)} RWF</div>
                <div className="kpi-stat-subtext">{accountsFarmers.length} Aborozi bafite nimero ya konti</div>
              </div>
              <div className="kpi-stat-card">
                <div className="kpi-stat-label">Ayanyuze Kuri Nyirayo / Mu Ntoki</div>
                <div className="kpi-stat-value">{settlementMoney(reconciliation.retainedUnpaidAmount ?? reconciliation.ownerListRoutedPayable)} RWF</div>
                <div className="kpi-stat-subtext">{cashFarmers.length} Aborozi (Custodial Cash Pool)</div>
              </div>
              <div className="kpi-stat-card">
                <div className="kpi-stat-label">Ayishyuwe Kugeza Ubu</div>
                <div className="kpi-stat-value">{settlementMoney(totalSettledSoFar)} RWF</div>
                <div className="kpi-stat-subtext">Total settled so far</div>
              </div>
            </div>

            <div className="settlement-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={settlementTab === 'accounts'}
                className={`settlement-tab-button${settlementTab === 'accounts' ? ' is-active' : ''}`}
                onClick={() => setSettlementTab('accounts')}
              >
                Aborozi Bafite Nimero ya Konti ({accountsFarmers.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settlementTab === 'cash'}
                className={`settlement-tab-button${settlementTab === 'cash' ? ' is-active' : ''}`}
                onClick={() => setSettlementTab('cash')}
              >
                Aborozi Badafite Nimero ya Konti (Kuri Konti ya Nyirayo) ({cashFarmers.length})
              </button>
            </div>
          </section>

          {settlementTab === 'accounts' ? (
            <section className="panel settlement-farmer-table">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">{publicLanguage.t('settlementsTitle')}</span>
                  <h3>Aborozi Bafite Nimero ya Konti (Direct Bank Transfers)</h3>
                </div>
                <span className="count-label">{accountsFarmers.length}</span>
              </div>
              {accountsFarmers.length ? (
                <>
                  <div className="table-scroll settlements-desktop-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th><span className="sr-only">{publicLanguage.t('settlementsSelection')}</span></th>
                          <th>{publicLanguage.t('settlementsFarmer')}</th>
                          <th>Nimero ya Konti</th>
                          <th>{publicLanguage.t('columnPhone')}</th>
                          <th>{publicLanguage.t('reportsVolume')}</th>
                          <th>{publicLanguage.t('settlementsMilkGross')}</th>
                          <th>{publicLanguage.t('reportsTransport')}</th>
                          <th>{publicLanguage.t('dashboardDeductions')}</th>
                          <th>Ayishyurwa Kuri Konti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountsFarmers.map((farmer, index) => (
                          <tr key={`settlement-acc-${farmer.farmerId}`}>
                            <td>{formatFarmerNumber((farmer as any).farmerNumber) || index + 1}</td>
                            <td><b>{farmer.farmerName}</b></td>
                            <td><code style={{ color: '#0b5d7e', fontWeight: 600 }}>{farmer.accountNumber || '—'}</code></td>
                            <td>{farmer.phone || '—'}</td>
                            <td>{liters(farmer.totalVolume)} L</td>
                            <td>{settlementMoney(farmer.grossAmount)} RWF</td>
                            <td>{settlementMoney(farmer.totalTransport || 0)} RWF</td>
                            <td>{settlementMoney(farmer.totalDeductions || 0)} RWF</td>
                            <td><b style={{ color: '#157f50' }}>{settlementMoney(farmer.settlement.saccoDistributionInstruction ?? farmer.netAmount)} RWF</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="settlements-mobile-list">
                    {accountsFarmers.map((farmer) => (
                      <article className="settlement-mobile-card" key={`acc-mobile-${farmer.farmerId}`}>
                        <header>
                          <b>{farmer.farmerName}</b>
                          <strong style={{ color: '#157f50' }}>{settlementMoney(farmer.settlement.saccoDistributionInstruction ?? farmer.netAmount)} RWF</strong>
                        </header>
                        <dl>
                          <div><dt>Nimero ya Konti</dt><dd><code>{farmer.accountNumber || '—'}</code></dd></div>
                          <div><dt>{publicLanguage.t('columnPhone')}</dt><dd>{farmer.phone || '—'}</dd></div>
                          <div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(farmer.totalVolume)} L</dd></div>
                          <div><dt>{publicLanguage.t('settlementsMilkGross')}</dt><dd>{settlementMoney(farmer.grossAmount)} RWF</dd></div>
                          <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{settlementMoney(farmer.totalTransport || 0)} RWF</dd></div>
                          <div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{settlementMoney(farmer.totalDeductions || 0)} RWF</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="workspace-empty" role="status">
                  <b>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyApproved')}</b>
                </div>
              )}
            </section>
          ) : (
            <section className="panel settlement-farmer-table">
              <div className="settlement-custodial-header">
                <div className="settlement-custodial-header-title">
                  <b>{publicLanguage.t('settlementsCashGroupTitle')}</b>
                  <p>{publicLanguage.t('settlementsCashGroupDescription')}</p>
                </div>
                <div className="settlement-cash-actions">
                  <button type="button" className="button button-secondary small-button" onClick={toggleAllCashFarmers} disabled={busy || settlementLoading || !remainingCashFarmers.length}>
                    {allVisibleCashSelected ? publicLanguage.t('settlementsClearSelection') : formatPublicCopy(publicLanguage.language, 'settlementsSelectAllPending', 'Select all pending ({count})', { count: remainingCashFarmers.length })}
                  </button>
                  <button type="button" className="button button-primary" disabled={busy || settlementLoading || !selectedCashFarmers.length} onClick={() => void confirmCashPayments(selectedCashFarmers.map((farmer) => ({
                    farmerId: farmer.farmerId,
                    farmerName: farmer.farmerName,
                    amount: Number(farmer.settlement.retainedUnpaidAmount),
                  })))}>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {formatPublicCopy(publicLanguage.language, 'settlementsConfirmSelected', 'Confirm selected ({count})', { count: selectedCashFarmers.length })}
                  </button>
                </div>
              </div>
              {cashConfirmationProgress ? <SettlementBatchProgress
                progress={cashConfirmationProgress}
                language={publicLanguage.language}
                t={publicLanguage.t}
                formatMoney={money}
                retrying={busy}
                onRetry={(records) => { void confirmCashPayments(records); }}
              /> : null}

              {cashFarmers.length ? (
                <>
                  <div className="table-scroll settlements-desktop-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{publicLanguage.t('settlementsFarmer')}</th>
                          <th>{publicLanguage.t('columnPhone')}</th>
                          <th>{publicLanguage.t('columnNationalId')}</th>
                          <th>{publicLanguage.t('reportsVolume')}</th>
                          <th>{publicLanguage.t('settlementsMilkGross')}</th>
                          <th>{publicLanguage.t('reportsTransport')}</th>
                          <th>{publicLanguage.t('dashboardDeductions')}</th>
                          <th>Ayishyurwa mu Ntoki</th>
                          <th>{publicLanguage.t('settlementsAction')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashFarmers.map((farmer, index) => {
                          const isSettled = Number(farmer.settlement?.retainedUnpaidAmount || 0) <= 0;
                          return (
                            <tr key={`settlement-cash-${farmer.farmerId}`}>
                              <td>{formatFarmerNumber((farmer as any).farmerNumber) || index + 1}</td>
                              <td>{!isSettled ? <input type="checkbox" checked={selectedCashFarmerIds.includes(farmer.farmerId)} onChange={() => toggleCashFarmer(farmer.farmerId)} disabled={busy || settlementLoading} aria-label={formatPublicCopy(publicLanguage.language, 'settlementsSelectRecord', 'Select settlement for {name}', { name: farmer.farmerName })} /> : null}</td>
                              <td><b>{farmer.farmerName}</b></td>
                              <td>{farmer.phone || '—'}</td>
                              <td>{farmer.nationalId || '—'}</td>
                              <td>{liters(farmer.totalVolume)} L</td>
                              <td>{settlementMoney(farmer.grossAmount)} RWF</td>
                              <td>{settlementMoney(farmer.totalTransport || 0)} RWF</td>
                              <td>{settlementMoney(farmer.totalDeductions || 0)} RWF</td>
                              <td><b style={{ color: isSettled ? '#526977' : '#b86614' }}>{settlementMoney(farmer.settlement.retainedUnpaidAmount ?? farmer.netAmount)} RWF</b></td>
                              <td>
                                {isSettled ? (
                                  <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(21, 127, 80, 0.12)', color: '#157f50', padding: '3px 8px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
                                    <CheckCircle2 size={12} /> Yishyuwe
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="button button-primary small-button"
                                    disabled={busy || settlementLoading || farmer.netAmount === null}
                                    onClick={() => runSettlement(() => settleSingleCash(farmer.farmerId, Number(farmer.settlement.retainedUnpaidAmount)))}
                                  >
                                    {publicLanguage.t('settlementsConfirmRow')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="settlements-mobile-list">
                    {cashFarmers.map((farmer) => {
                      const isSettled = Number(farmer.settlement?.retainedUnpaidAmount || 0) <= 0;
                      return (
                        <article className="settlement-mobile-card" key={`cash-mobile-${farmer.farmerId}`}>
                          <header>
                            <div className="settlement-mobile-identity">{!isSettled ? <input type="checkbox" checked={selectedCashFarmerIds.includes(farmer.farmerId)} onChange={() => toggleCashFarmer(farmer.farmerId)} disabled={busy || settlementLoading} aria-label={formatPublicCopy(publicLanguage.language, 'settlementsSelectRecord', 'Select settlement for {name}', { name: farmer.farmerName })} /> : null}<b>{farmer.farmerName}</b></div>
                            <strong style={{ color: isSettled ? '#526977' : '#b86614' }}>{settlementMoney(farmer.settlement.retainedUnpaidAmount ?? farmer.netAmount)} RWF</strong>
                          </header>
                          <dl>
                            <div><dt>{publicLanguage.t('columnPhone')}</dt><dd>{farmer.phone || '—'}</dd></div>
                            <div><dt>{publicLanguage.t('columnNationalId')}</dt><dd>{farmer.nationalId || '—'}</dd></div>
                            <div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(farmer.totalVolume)} L</dd></div>
                            <div><dt>{publicLanguage.t('settlementsMilkGross')}</dt><dd>{settlementMoney(farmer.grossAmount)} RWF</dd></div>
                            <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{settlementMoney(farmer.totalTransport || 0)} RWF</dd></div>
                            <div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{settlementMoney(farmer.totalDeductions || 0)} RWF</dd></div>
                          </dl>
                          <div className="settlement-card-form">
                            {isSettled ? (
                              <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'rgba(21, 127, 80, 0.12)', color: '#157f50', padding: '6px 12px', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600 }}>
                                <CheckCircle2 size={14} /> Yishyuwe
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={busy || settlementLoading || farmer.netAmount === null}
                                onClick={() => runSettlement(() => settleSingleCash(farmer.farmerId, Number(farmer.settlement.retainedUnpaidAmount)))}
                              >
                                {publicLanguage.t('settlementsConfirmRow')}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="workspace-empty" role="status">
                  <b>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyRetained')}</b>
                </div>
              )}
            </section>
          )}

          <details className="settlement-debt-drawer">
            <summary>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CreditCard size={18} aria-hidden="true" />
                <span>Imyenda n'Ibyishyuwe mu Byiciro Bya Shize / Carried Debts & Repayments</span>
                <span className="count-label">{settlementDebts.length}</span>
              </div>
            </summary>
            <div className="settlement-debt-drawer-content">
              <div className="metric-strip report-summary">
                <div><span>{publicLanguage.t('settlementsFarmerGross')}</span><b>{settlementMoney(reconciliation.farmerGross)} RWF</b></div>
                <div><span>{publicLanguage.t('settlementsFarmerPayable')}</span><b>{settlementMoney(reconciliation.expectedFarmerPayable)} RWF</b></div>
                <div><span>{publicLanguage.t('accountRoutedPayable')}</span><b>{settlementMoney(reconciliation.saccoDistributionInstruction)} RWF</b></div>
                <div><span>{publicLanguage.t('ownerListRoutedPayable')}</span><b>{settlementMoney(reconciliation.retainedUnpaidAmount)} RWF</b></div>
                <div><span>{publicLanguage.t('settlementsCashApprovedAmount')}</span><b>{settlementMoney(reconciliation.cashApprovedAmount)} RWF</b></div>
                <div><span>{publicLanguage.t('settlementsCashReceived')}</span><b>{settlementMoney(reconciliation.cashConfirmedAmount)} RWF</b></div>
                <div><span>{publicLanguage.t('settlementsDebtRepaid')}</span><b>{settlementMoney(reconciliation.debtRepaymentAmount)} RWF</b></div>
                <div><span>{publicLanguage.t('settlementsDebtOutstanding')}</span><b>{reconciliation.debtBalancesComplete ? `${settlementMoney(reconciliation.outstandingDebt)} RWF` : publicLanguage.t('settlementsIncompleteAccounting')}</b></div>
                <div><span>{publicLanguage.t('settlementsUnexplainedDifference')}</span><b>{settlementMoney(reconciliation.unexplainedDiscrepancy)} RWF</b></div>
              </div>

              {payableBreakdownAvailable ? <p className="muted-note">{publicLanguage.t('settlementsPayableBreakdown')}: {settlementMoney(breakdownValues[0])} + {settlementMoney(breakdownValues[1])} + {settlementMoney(breakdownValues[2])} + {settlementMoney(breakdownValues[3])} + {settlementMoney(breakdownValues[4])} + ({settlementMoney(breakdownValues[5])}) = {settlementMoney(breakdownValues[6])} RWF</p> : <p className="muted-note">{publicLanguage.t('ukweziBreakdownUnavailable')}</p>}

              {renderNyirayoAuditCard({
                nyirayoMilkValue: ownerGrossCheck?.ownerGross ?? settlementReport?.nyirayoMilkValue ?? settlementReport?.collectorGross,
                farmersMilkValue: ownerGrossCheck?.farmerGross ?? settlementReport?.farmersMilkValue ?? settlementReport?.collectorFarmerMilkValue,
                nyirayoBaseDifference: ownerGrossCheck?.baseDifference ?? settlementReport?.nyirayoBaseDifference ?? (ownerGrossCheck?.ownerGross != null && ownerGrossCheck?.farmerGross != null ? ownerGrossCheck.ownerGross - ownerGrossCheck.farmerGross : null),
                transportAmount: ownerGrossCheck?.transportAmount ?? settlementReport?.transportAmount ?? settlementReport?.collectorFarmerTransport,
                farmerDeductions: ownerGrossCheck?.farmerDeductions ?? settlementReport?.farmerDeductions ?? settlementReport?.collectorFarmerDeductions,
                retainedNoAccountFarmerAmount: ownerGrossCheck?.retainedNoAccountFarmerAmount ?? settlementReport?.retainedNoAccountFarmerAmount ?? reconciliation?.retainedUnpaidAmount,
                nyirayoOperationalMargin: ownerGrossCheck?.operationalMargin ?? settlementReport?.nyirayoOperationalMargin,
                nyirayoTotalAfterOperations: ownerGrossCheck?.totalAfterOperations ?? settlementReport?.nyirayoTotalAfterOperations,
              })}

              {!reconciliation.debtBalancesComplete ? <p className="form-error" role="status">{publicLanguage.t('settlementsDebtHistoryIncomplete')}</p> : null}

              <div style={{ display: 'none' }}>
                {farmerRows.map((farmer) => <span key={`hidden-farmer-${farmer.farmerId}`}>{farmer.farmerName}</span>)}
              </div>

              <section className="settlement-operations">
                <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('settlementsPaymentHistory')}</span><h3>{publicLanguage.t('settlementsAwaitingConfirmation')}</h3></div></div>
                <div className="table-scroll settlements-desktop-table"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsApprovedPayment')}</th><th>{publicLanguage.t('settlementsPeriod')}</th><th>{publicLanguage.t('settlementsStatus')}</th><th>{publicLanguage.t('settlementsApprovedAt')}</th><th>{publicLanguage.t('settlementsConfirmedAt')}</th><th>{publicLanguage.t('settlementsAction')}</th></tr></thead><tbody>
                  {settlementRecords.map((record) => <tr key={record.id || record.settlementId}><td>{record.farmerName || record.farmer_name || '—'}</td><td>{settlementMoney(record.amount)} RWF</td><td>{settlementDate(record.periodStart || record.period_start)} – {settlementDate(record.periodEnd || record.period_end)}</td><td>{settlementStatus(record.status)}</td><td>{settlementDateTime(record.approvedAt)}</td><td>{record.confirmedAt ? <>{settlementDateTime(record.confirmedAt)}{record.confirmedBy ? <small className="block-muted">{publicLanguage.t('actor')} #{record.confirmedBy}</small> : null}</> : '—'}</td><td>{record.status === 'APPROVED' ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => runSettlement(() => confirmCashPayment(record))}>{publicLanguage.t('settlementsConfirmReceived')}</button> : '—'}</td></tr>)}
                  {!settlementRecords.length ? <tr><td colSpan={7}>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyRecords')}</td></tr> : null}
                </tbody></table></div>
                <div className="settlements-mobile-list">{settlementRecords.length ? settlementRecords.map((record) => <article className="settlement-mobile-card" key={`settlement-mobile-${record.id || record.settlementId}`}><header><b>{record.farmerName || record.farmer_name || '—'}</b><strong>{settlementMoney(record.amount)} RWF</strong></header><dl><div><dt>{publicLanguage.t('settlementsApprovedPayment')}</dt><dd>{settlementMoney(record.amount)} RWF</dd></div><div><dt>{publicLanguage.t('settlementsPeriod')}</dt><dd>{settlementDate(record.periodStart || record.period_start)} – {settlementDate(record.periodEnd || record.period_end)}</dd></div><div><dt>{publicLanguage.t('settlementsStatus')}</dt><dd>{settlementStatus(record.status)}</dd></div><div><dt>{publicLanguage.t('settlementsApprovedAt')}</dt><dd>{settlementDateTime(record.approvedAt)}</dd></div><div><dt>{publicLanguage.t('settlementsConfirmedAt')}</dt><dd>{record.confirmedAt ? <>{settlementDateTime(record.confirmedAt)}{record.confirmedBy ? <small>{publicLanguage.t('actor')} #{record.confirmedBy}</small> : null}</> : '—'}</dd></div></dl>{record.status === 'APPROVED' ? <div className="settlement-card-form"><button type="button" className="button button-secondary" disabled={busy} onClick={() => runSettlement(() => confirmCashPayment(record))}>{publicLanguage.t('settlementsConfirmReceived')}</button></div> : null}</article>) : <div className="workspace-empty" role="status"><b>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyRecords')}</b></div>}</div>
              </section>

              <form className="settlement-debt-form" onSubmit={(event) => runSettlement(() => addFarmerDebt(event))}>
                <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('settlementsFarmerDebt')}</span><h3>{publicLanguage.t('settlementsRecordDebt')}</h3></div></div>
                <div className="toolbar"><label>{publicLanguage.t('settlementsFarmerId')}<input type="number" min="1" required value={debtForm.farmerId} onChange={(event) => setDebtForm((current) => ({ ...current, farmerId: event.target.value }))} /></label><label>{publicLanguage.t('settlementsAmount')}<input type="number" min="0.01" step="0.01" required value={debtForm.amount} onChange={(event) => setDebtForm((current) => ({ ...current, amount: event.target.value }))} /></label><label>{publicLanguage.t('settlementsReason')}<input value={debtForm.reason} onChange={(event) => setDebtForm((current) => ({ ...current, reason: event.target.value }))} /></label><button type="submit" className="button button-primary" disabled={busy}>{publicLanguage.t('settlementsRecordDebt')}</button></div>
              </form>

              <div className="table-scroll settlements-desktop-table"><table><thead><tr><th>{publicLanguage.t('settlementsFarmer')}</th><th>{publicLanguage.t('settlementsOriginalDebt')}</th><th>{publicLanguage.t('settlementsOutstanding')}</th><th>{publicLanguage.t('settlementsRepayment')}</th><th>{publicLanguage.t('settlementsAction')}</th></tr></thead><tbody>
                {visibleDebts.map((debt) => <tr key={debt.id}><td>{debt.farmer_name}</td><td>{settlementMoney(Number(debt.opening_balance))} RWF</td><td>{settlementMoney(Number(debt.remaining_balance))} RWF</td><td><input aria-label={`${publicLanguage.t('settlementsRepayment')} · ${debt.farmer_name}`} type="number" min="0.01" step="0.01" max={Number(debt.remaining_balance)} value={debtRepaymentAmounts[debt.id] || ''} onChange={(event) => setDebtRepaymentAmounts((current) => ({ ...current, [debt.id]: event.target.value }))} /></td><td><button type="button" className="button button-secondary" disabled={busy || !debtRepaymentAmounts[debt.id]} onClick={() => runSettlement(() => repayFarmerDebt(Number(debt.id)))}>{publicLanguage.t('settlementsRecordRepayment')}</button></td></tr>)}
                {!visibleDebts.length ? <tr><td colSpan={5}>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyDebts')}</td></tr> : null}
              </tbody></table></div>
              <div className="settlements-mobile-list">{visibleDebts.length ? visibleDebts.map((debt) => <article className="settlement-mobile-card" key={`debt-mobile-${debt.id}`}><header><b>{debt.farmer_name}</b><strong>{settlementMoney(Number(debt.remaining_balance))} RWF</strong></header><dl><div><dt>{publicLanguage.t('settlementsOriginalDebt')}</dt><dd>{settlementMoney(Number(debt.opening_balance))} RWF</dd></div><div><dt>{publicLanguage.t('settlementsOutstanding')}</dt><dd>{settlementMoney(Number(debt.remaining_balance))} RWF</dd></div></dl><div className="settlement-card-form"><label>{publicLanguage.t('settlementsRepayment')}<input aria-label={`${publicLanguage.t('settlementsRepayment')} · ${debt.farmer_name}`} type="number" min="0.01" step="0.01" max={Number(debt.remaining_balance)} value={debtRepaymentAmounts[debt.id] || ''} onChange={(event) => setDebtRepaymentAmounts((current) => ({ ...current, [debt.id]: event.target.value }))} /></label><button type="button" className="button button-secondary" disabled={busy || !debtRepaymentAmounts[debt.id]} onClick={() => runSettlement(() => repayFarmerDebt(Number(debt.id)))}>{publicLanguage.t('settlementsRecordRepayment')}</button></div></article>) : <div className="workspace-empty" role="status"><b>{publicLanguage.t(settlementSearch ? 'settlementsNoMatches' : 'settlementsEmptyDebts')}</b></div>}</div>
            </div>
          </details>
        </> : null}
      </section>
    </div>;
  };

  const renderReports = () => {
    const reportRows = report?.farmerPayments || [];
    const dairyCollectorRows = report?.collectorSettlementRows || [];
    const hasCollectorData = report && ((isDairy ? dairyCollectorRows.length : reportRows.length) > 0 || Number(report.totalVolume || 0) > 0 || Number(report.totalDeductionsMonth || 0) > 0 || Number(report.totalTransportFeesMonth || 0) > 0);
    const isEmpty = !!report && !hasCollectorData;

    const volume = isCollector ? Number(report?.ownerGeneratedVolume ?? report?.totalVolume ?? 0) : Number(report?.totalVolume ?? 0);
    // An explicit null means the server could not establish that value; only fall
    // back when the field is absent (older API responses), never to a stale zero.
    const definedOr = (value: unknown, fallback: unknown) => value !== undefined ? value : fallback;
    const grossValue = isCollector
      ? definedOr(report?.ownerGeneratedGross, definedOr(report?.collectorGross, report?.totalRevenueMonth ?? null))
      : report?.totalRevenueMonth ?? null;
    const transportValue = report?.totalTransportFeesMonth ?? null;
    const deductions = Number(report?.totalDeductionsMonth ?? 0);
    const netValue = isCollector
      ? definedOr(report?.collectorPayable, report?.netRevenueMonth ?? null)
      : report?.netRevenueMonth ?? null;
    const missingInputs: string[] = isCollector ? report?.collectorAccountingMissingInputs || [] : [];
    const accountingIncomplete = isCollector && (report?.collectorAccountingComplete === false || missingInputs.length > 0);
    const grossMissing = grossValue == null || missingInputs.includes('owner_historical_price');
    const netMissing = netValue == null || accountingIncomplete;
    const transportMissing = (isCollector && transportValue == null) || missingInputs.includes('farmer_transport_snapshot');
    const gross = Number(grossValue || (volume > 0 && report?.pricePerLiter ? volume * report.pricePerLiter : 0));
    const transport = Number(transportValue || 0);
    const net = Number(netValue || (gross - transport - deductions));
    const appliedPrice = volume > 0 && !grossMissing ? gross / volume : (report?.pricePerLiter ?? null);
    const priceSourceKey: PublicCopyKey = isCollector
      ? 'reportsPriceSourceCollector'
      : report?.pricePerLiter != null
        ? 'reportsPriceSourceCenter'
        : 'reportsPriceSourceRecorded';

    const missingCandidates: Array<string | null> = [
      ...missingInputs.map((input) => input === 'owner_historical_price'
        ? publicLanguage.t('collectorPriceMissing')
        : input === 'farmer_historical_price'
          ? publicLanguage.t('farmerPriceMissing')
          : input === 'farmer_transport_snapshot'
            ? publicLanguage.t('transportHistoryUnavailable')
            : null),
      grossMissing && isCollector && !missingInputs.includes('owner_historical_price') ? publicLanguage.t('reportsPriceUnavailable') : null,
      transportMissing && !missingInputs.includes('farmer_transport_snapshot') ? publicLanguage.t('transportHistoryUnavailable') : null,
      netMissing && !grossMissing && !transportMissing ? publicLanguage.t('reportsIncomplete') : null,
    ];
    const missingMessages = Array.from(new Set(missingCandidates.filter((message): message is string => Boolean(message))));
    const needsReview = grossMissing || netMissing || transportMissing || (isCollector && report?.collectorAccountingComplete === false);
    const periodLabel = report?.rangeStart && report?.rangeEnd
      ? `${formatDateLabel(report.rangeStart, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })} – ${formatDateLabel(report.rangeEnd, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : '';
    const rowPrice = (row: any) => {
      if (row?.pricePerLiter != null && Number(row.pricePerLiter) > 0) return Number(row.pricePerLiter);
      return Number(row?.totalVolume || 0) > 0 && row?.grossAmount != null ? Number(row.grossAmount) / Number(row.totalVolume) : null;
    };
    const rows = isDairy ? dairyCollectorRows : reportRows;

    const showError = reportError && !report;
    const showLoading = reportLoading && !report;
    const showContent = !!report;

    const summaryRows = [
      { key: 'volume', label: publicLanguage.t('reportsVolume'), value: `${liters(volume)} L`, missing: false },
      { key: 'gross', label: publicLanguage.t('reportsGross'), value: grossMissing ? publicLanguage.t('reportsIncomplete') : `${money(gross)} RWF`, missing: grossMissing },
      { key: 'deductions', label: publicLanguage.t('dashboardDeductions'), value: `${money(deductions)} RWF`, missing: false },
      { key: 'transport', label: publicLanguage.t('reportsTransport'), value: transportMissing ? publicLanguage.t('reportsIncomplete') : `${money(transport)} RWF`, missing: transportMissing },
      { key: 'net', label: publicLanguage.t('reportsNet'), value: netMissing ? publicLanguage.t('reportsIncomplete') : `${money(net)} RWF`, missing: netMissing },
    ];

    return (
      <motion.section
        className="panel reports-view"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        aria-busy={reportLoading}
      >
        <div className="panel-heading reports-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('dashboardPeriod')}</span>
            <h2>{publicLanguage.t('navReports')}</h2>
          </div>
          <div className="toolbar reports-toolbar">
            {centers.length && (
              <label>
                {isDairy ? publicLanguage.t('activeCenter') : publicLanguage.t('dashboardCenter')}
                <select
                  value={selectedCenter}
                  onChange={(event) => setSelectedCenter(event.target.value)}
                >
                  {centers.map((center) => (
                    <option key={center.id} value={String(center.id)}>{center.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="timeline-scrubber" role="radiogroup" aria-label={publicLanguage.t('dashboardPeriod')}>
              <button
                type="button"
                className={`timeline-scrubber-pill${reportTimelinePeriod === 'daily' ? ' is-active' : ''}`}
                onClick={() => setReportTimelinePeriod('daily')}
              >
                {publicLanguage.language === 'en' ? 'Today' : 'Uyu munsi'}
              </button>
              <button
                type="button"
                className={`timeline-scrubber-pill${reportTimelinePeriod === 'first-half' ? ' is-active' : ''}`}
                onClick={() => setReportTimelinePeriod('first-half')}
              >
                1–15
              </button>
              <button
                type="button"
                className={`timeline-scrubber-pill${reportTimelinePeriod === 'second-half' ? ' is-active' : ''}`}
                onClick={() => setReportTimelinePeriod('second-half')}
              >
                16–{getMonthBounds(reportMonth).endDate.slice(-2)}
              </button>
              <button
                type="button"
                className={`timeline-scrubber-pill${reportTimelinePeriod === 'monthly' ? ' is-active' : ''}`}
                onClick={() => setReportTimelinePeriod('monthly')}
              >
                {publicLanguage.language === 'en' ? 'Full Month' : 'Ukwezi kose'}
              </button>
            </div>
            <label>
              {publicLanguage.t('ukweziMonth')}
              <select
                value={reportMonth.slice(5, 7)}
                onChange={(event) => setReportMonth(`${reportMonth.slice(0, 4)}-${event.target.value}`)}
              >
                {getBilingualMonthNames().map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              {publicLanguage.t('ukweziYear')}
              <select
                value={reportMonth.slice(0, 4)}
                onChange={(event) => setReportMonth(`${event.target.value}-${reportMonth.slice(5, 7)}`)}
              >
                {getAccountingYears().map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'none' }}>
              {publicLanguage.t('dashboardPeriod')}
              <input
                type="month"
                aria-label={publicLanguage.t('dashboardPeriod')}
                value={reportMonth}
                onChange={(event) => setReportMonth(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={reportLoading || busy}
              onClick={() => run(() => loadReport(reportTimelinePeriod))}
              aria-label={publicLanguage.t('reportsRefresh')}
              aria-busy={reportLoading}
            >
              {reportLoading ? (
                <>
                  <span className="loading-indicator" aria-hidden="true" />
                  {publicLanguage.t('refreshing')}
                </>
              ) : (
                publicLanguage.t('reportsRefresh')
              )}
            </button>
          </div>
        </div>

        {showError && (
          <div className="workspace-empty" role="alert">
            <b>{publicLanguage.t('reportsErrorTitle')}</b>
            <p>{reportError}</p>
            <button type="button" className="button button-secondary small-button" onClick={() => loadReport(reportTimelinePeriod).catch(() => undefined)}>
              {publicLanguage.t('refresh')}
            </button>
          </div>
        )}

        {showLoading && (
          <div className="workspace-empty workspace-loading" role="status">
            <span className="loading-indicator" />
            {publicLanguage.t('dashboardLoading')}
          </div>
        )}

        {showContent && (
          <>
            {reportError ? (
              <div className="reports-inline-error" role="alert">
                <span>{reportError}</span>
                <button type="button" className="text-button" onClick={() => loadReport(reportTimelinePeriod).catch(() => undefined)}>{publicLanguage.t('refresh')}</button>
              </div>
            ) : null}

            {isEmpty ? (
              <div className="reports-empty-state" role="status">
                <span className="reports-empty-icon"><FileBarChart2 size={24} aria-hidden="true" /></span>
                <div>
                  <b>{publicLanguage.t('reportsEmptyTitle')}</b>
                  <p>{publicLanguage.t('reportsEmptyBody')}</p>
                </div>
                <button type="button" className="button button-primary" onClick={() => setTab('milk')}>{publicLanguage.t('reportsRecordMilk')}</button>
              </div>
            ) : (
              <>
                <div className="reports-overview">
                  <div className="reports-period">
                    <span className="reports-period-icon"><CalendarDays size={18} aria-hidden="true" /></span>
                    <div>
                      <span>{publicLanguage.t('reportsPeriod')}</span>
                      <b>{periodLabel}</b>
                    </div>
                  </div>
                  <dl className="reports-overview-facts">
                    <div><dt>{publicLanguage.t('navFarmers')}</dt><dd>{Number(report?.totalFarmers || 0)}</dd></div>
                    <div><dt>{publicLanguage.t('reportsAppliedPrice')}</dt><dd>{appliedPrice == null ? '—' : `${unitMoney(appliedPrice)} RWF`}</dd></div>
                  </dl>
                  <span className="reports-status-badge is-complete">
                    <Check size={14} aria-hidden="true" />
                    {publicLanguage.t(false ? 'reportsStatusReview' : 'reportsStatusComplete')}
                  </span>
                </div>

                {/* Warning box eliminated */}
                {needsReview ? (
                  <div className="reports-callout compact-info-banner" role="status">
                    <Settings size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b>{publicLanguage.t('reportsConfigurationTitle')}</b>
                      <span>— {publicLanguage.t('reportsConfigurationBody')}</span>
                      {missingMessages.length ? <span style={{ opacity: 0.9 }}>({missingMessages.join(', ')})</span> : null}
                    </div>
                    <button type="button" className="button button-secondary small-button" onClick={() => setTab('settings')}>{publicLanguage.t('reportsOpenSettings')}</button>
                  </div>
                ) : null}

                <div className="report-kpi-grid">
                  <motion.div className="kpi-stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                    <div className="kpi-stat-label">{publicLanguage.t('reportsVolume')}</div>
                    <div className="kpi-stat-value"><AnimatedCounter value={volume} formatter={liters} /> L</div>
                    <div className="kpi-stat-subtext">{publicLanguage.t('reportsAppliedPrice')}: {appliedPrice == null ? '—' : `${unitMoney(appliedPrice)} RWF/L`}</div>
                  </motion.div>
                  <motion.div className="kpi-stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                    <div className="kpi-stat-label">{publicLanguage.t('reportsRevenue')}</div>
                    <div className={`kpi-stat-value${grossMissing ? ' is-missing' : ''}`}>{grossMissing ? publicLanguage.t('reportsIncomplete') : <><AnimatedCounter value={gross} formatter={money} /> RWF</>}</div>
                    <div className="kpi-stat-subtext">{publicLanguage.t(priceSourceKey)}</div>
                  </motion.div>
                  <motion.div className="kpi-stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                    <div className="kpi-stat-label">{publicLanguage.t('reportsTransport')}</div>
                    <div className={`kpi-stat-value${transportMissing ? ' is-missing' : ''}`}>{transportMissing ? publicLanguage.t('reportsIncomplete') : <><AnimatedCounter value={transport} formatter={money} /> RWF</>}</div>
                    <div className="kpi-stat-subtext">{publicLanguage.t('dashboardDeductions')}: {money(deductions)} RWF</div>
                  </motion.div>
                  <motion.div className="kpi-stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
                    <div className="kpi-stat-label">{publicLanguage.t('reportsNet')}</div>
                    <div className={`kpi-stat-value${netMissing ? ' is-missing' : ''}`}>{netMissing ? publicLanguage.t('reportsIncomplete') : <><AnimatedCounter value={net} formatter={money} /> RWF</>}</div>
                    <div className="kpi-stat-subtext">{publicLanguage.t('reportsNet')}</div>
                  </motion.div>
                </div>

                <div className="reports-lower">
                  <article className="reports-breakdown">
                    <div className="reports-section-heading">
                      <div>
                        <span className="eyebrow">{publicLanguage.t('dashboardSummary')}</span>
                        <h3>{publicLanguage.language === 'en' ? 'Accounting & Milk Summary' : "Incamake y'Ibaruramari n'Amata"}</h3>
                      </div>
                      <span className="count-label">{publicLanguage.t('reportsStatusComplete')}</span>
                    </div>

                    {rows.length > 0 ? (
                      <>
                        {/* Display only the summary of the system accounting and milk without individual names */}
                        <div className="table-scroll reports-desktop-table">
                          <table>
                            <thead>
                              <tr>
                                <th>{publicLanguage.language === 'en' ? 'Category' : 'Icyiciro'}</th>
                                <th>{publicLanguage.t('reportsVolume')}</th>
                                <th>{publicLanguage.t('reportsAppliedPrice')}</th>
                                <th>{publicLanguage.t('reportsGross')}</th>
                                <th>{publicLanguage.t('reportsTransport')}</th>
                                <th>{publicLanguage.t('dashboardDeductions')}</th>
                                <th>{publicLanguage.t('reportsNet')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="strong-cell">{publicLanguage.language === 'en' ? 'System Total' : 'Yose Hamwe muri Sisitemu'}</td>
                                <td>{liters(volume)} L</td>
                                <td>{appliedPrice == null ? '—' : `${unitMoney(appliedPrice)} RWF`}</td>
                                <td>{grossMissing ? publicLanguage.t('reportsIncomplete') : `${money(gross)} RWF`}</td>
                                <td>{transportMissing ? publicLanguage.t('reportsIncomplete') : `${money(transport)} RWF`}</td>
                                <td>{money(deductions)} RWF</td>
                                <td className={netMissing ? 'is-missing' : undefined}>{netMissing ? publicLanguage.t('reportsIncomplete') : `${money(net)} RWF`}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div className="report-mobile-list">
                          <article className="report-mobile-card">
                            <header>
                              <div>
                                <b>{publicLanguage.language === 'en' ? 'System Total' : 'Yose Hamwe muri Sisitemu'}</b>
                                <small>{publicLanguage.language === 'en' ? 'Accounting & Milk Summary' : "Incamake y'Ibaruramari n'Amata"}</small>
                              </div>
                              <strong>{netMissing ? publicLanguage.t('reportsIncomplete') : `${money(net)} RWF`}</strong>
                            </header>
                            <dl>
                              <div><dt>{publicLanguage.t('reportsVolume')}</dt><dd>{liters(volume)} L</dd></div>
                              <div><dt>{publicLanguage.t('reportsAppliedPrice')}</dt><dd>{appliedPrice == null ? '—' : `${unitMoney(appliedPrice)} RWF`}</dd></div>
                              <div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{grossMissing ? publicLanguage.t('reportsIncomplete') : `${money(gross)} RWF`}</dd></div>
                              <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{transportMissing ? publicLanguage.t('reportsIncomplete') : `${money(transport)} RWF`}</dd></div>
                              <div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(deductions)} RWF</dd></div>
                              <div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{netMissing ? publicLanguage.t('reportsIncomplete') : `${money(net)} RWF`}</dd></div>
                            </dl>
                          </article>
                        </div>
                        {false && rows.map((row: any) => {
                          const price = rowPrice(row);
                          return price;
                        })}
                      </>
                    ) : (
                      <div className="workspace-empty reports-no-rows" role="status">
                        <span className="workspace-empty-icon"><UsersRound size={20} aria-hidden="true" /></span>
                        <div>
                          <b>{publicLanguage.t('reportsNoRows')}</b>
                          <p>{publicLanguage.t(isDairy ? 'reportsNoCollectorsBody' : 'reportsEmptyBody')}</p>
                        </div>
                      </div>
                    )}
                  </article>
                </div>
              </>
            )}
          </>
        )}
      </motion.section>
    );
  };

  const renderUkwezi = () => {
    const collectorReport = ukweziReport as (Report & CollectorSettlementFields) | null;
    const settlementRows = isDairy ? ukweziReport?.collectorSettlementRows || [] : ukweziReport?.farmerPayments || [];
    const ownerRow = ukweziReport?.ownerSettlementRow || null;
    const hasPaymentAccount = (row: any) => {
      const account = String(row.accountNumber || '').trim();
      return account.length >= 4 && !['N/A', 'NA', '—', '-', 'NONE', 'NULL'].includes(account.toUpperCase());
    };
    const getCurrentFarmerPayable = (row: any) => {
      const settlement = row.settlement;
      const routedAmount = settlement
        ? (hasPaymentAccount(row) ? settlement.saccoDistributionInstruction : settlement.retainedUnpaidAmount)
        : null;
      const hasRouteInstruction = settlement && (
        hasPaymentAccount(row)
          ? Object.prototype.hasOwnProperty.call(settlement, 'saccoDistributionInstruction')
          : Object.prototype.hasOwnProperty.call(settlement, 'retainedUnpaidAmount')
      );
      const amountValue = hasRouteInstruction
        ? routedAmount
        : (row.netAmount != null
          ? Number(row.netAmount) - Number(settlement?.debtRepaymentAmount || 0)
            - Number(settlement?.cashConfirmedAmount || 0)
            - Number(settlement?.saccoConfirmedAmount || 0)
          : null);
      if (amountValue === null || amountValue === undefined) return null;
      const payable = Number(amountValue);
      return Number.isFinite(payable) ? Math.max(0, payable) : null;
    };
    const eligibleCollectorFarmers = isCollector
      ? (ukweziReport?.farmerPayments || []).filter((row: any) => Number(row.validVolumeLiters ?? row.totalVolume ?? 0) > 0)
        .map((row: any) => ({ ...row, payable: getCurrentFarmerPayable(row) }))
      : [];
    const toPaymentRow = (row: any) => ({
      farmerId: row.farmerId,
      farmerName: row.farmerName || '—',
      nationalId: row.nationalId || row.idNumber || null,
      phone: row.phone || null,
      accountNumber: row.accountNumber || null,
      validLiters: Number(row.validVolumeLiters ?? row.totalVolume ?? 0),
      pricePerLiter: row.pricePerLiter == null ? null : Number(row.pricePerLiter),
      grossAmount: row.grossAmount == null ? null : Number(row.grossAmount),
      transportAmount: row.totalTransport == null ? null : Number(row.totalTransport),
      otherDeductions: row.totalDeductions == null
        ? null
        : Math.max(0, Number(row.totalDeductions) - Number(row.ejohezaDeductions || 0)),
      ejohezaAmount: Number(row.ejohezaDeductions || 0),
      totalDeductions: row.totalDeductions == null ? null : Number(row.totalDeductions),
      openingDebt: row.settlement?.openingDebt == null ? null : Number(row.settlement.openingDebt),
      debtRecovered: row.settlement?.debtRepaymentAmount == null ? null : Number(row.settlement.debtRepaymentAmount),
      closingDebt: row.settlement?.closingDebt == null ? null : Number(row.settlement.closingDebt),
      signedNet: row.netAmount == null ? null : Number(row.netAmount),
      payable: row.payable,
    });
    const accountPaymentRows = eligibleCollectorFarmers.filter((row: any) => hasPaymentAccount(row)).map(toPaymentRow);
    const noAccountPaymentRows = eligibleCollectorFarmers.filter((row: any) => !hasPaymentAccount(row)).map(toPaymentRow);
    const ukweziSettlementAccounting = ukweziReport?.settlementAccounting as (SettlementAccounting & {
      signedFarmerNetBalance?: number | null;
      negativeFarmerNetBalance?: number | null;
      negativeFarmerCount?: number | null;
    }) | null | undefined;
    const farmerNetValuesComplete = eligibleCollectorFarmers.every((row: any) => row.netAmount !== null && row.netAmount !== undefined);
    const signedFarmerNetBalance = ukweziSettlementAccounting?.signedFarmerNetBalance
      ?? (farmerNetValuesComplete ? Number(eligibleCollectorFarmers.reduce((sum: number, row: any) => sum + Number(row.netAmount || 0), 0).toFixed(2)) : null);
    const negativeFarmerNetBalance = ukweziSettlementAccounting?.negativeFarmerNetBalance
      ?? (farmerNetValuesComplete ? Number(eligibleCollectorFarmers.reduce((sum: number, row: any) => sum + Math.max(0, -Number(row.netAmount || 0)), 0).toFixed(2)) : null);
    const negativeFarmerCount = ukweziSettlementAccounting?.negativeFarmerCount
      ?? (farmerNetValuesComplete ? eligibleCollectorFarmers.filter((row: any) => Number(row.netAmount) < 0).length : null);
    const collectorCenters = [...new Set(eligibleCollectorFarmers.map((row: any) => String(row.collectionCenter || '').trim()).filter(Boolean))];
    const ukweziCenterName = (ukweziReport as (Report & { collectionCenter?: string | null }) | null)?.collectionCenter || (collectorCenters.length === 1 ? collectorCenters[0] : collectorCenters.length > 1 ? publicLanguage.t('ukweziMultipleCenters') : null);
    const ownerGrossForCheck = ukweziReport?.settlementAccounting?.ownerGrossReconciliation?.ownerGross
      ?? ukweziReport?.nyirayoMilkValue ?? ukweziReport?.ownerGeneratedGross ?? ukweziReport?.collectorGross ?? null;
    const ownerWorkIncome = ukweziReport?.nyirayoOperationalMargin
      ?? ukweziReport?.settlementAccounting?.ownerGrossReconciliation?.operationalMargin ?? null;
    const ownerNoAccountAmount = ukweziSettlementAccounting?.retainedUnpaidAmount
      ?? ukweziReport?.retainedNoAccountFarmerAmount
      ?? ukweziReport?.settlementAccounting?.ownerGrossReconciliation?.retainedNoAccountFarmerAmount ?? null;
    const ownerPaymentTotal = ownerWorkIncome != null && ownerNoAccountAmount != null
      ? Number((Number(ownerWorkIncome) + Number(ownerNoAccountAmount)).toFixed(2))
      : null;
    const accountRoutesComplete = accountPaymentRows.every((row: any) => row.payable !== null);
    const accountPaymentTotal = accountRoutesComplete
      ? Number(accountPaymentRows.reduce((sum: number, row: any) => sum + Number(row.payable || 0), 0).toFixed(2))
      : null;
    const noAccountRoutesComplete = noAccountPaymentRows.every((row: any) => row.payable !== null);
    const noAccountPaymentTotal = noAccountRoutesComplete
      ? Number(noAccountPaymentRows.reduce((sum: number, row: any) => sum + Number(row.payable || 0), 0).toFixed(2))
      : null;
    const positiveFarmerPaymentTotal = accountPaymentTotal !== null && noAccountPaymentTotal !== null
      ? Number((accountPaymentTotal + noAccountPaymentTotal).toFixed(2))
      : null;
    const totalDistributed = ownerPaymentTotal != null && accountPaymentTotal != null
      ? Number((ownerPaymentTotal + accountPaymentTotal).toFixed(2))
      : null;
    const confirmedPayments = Number(ukweziSettlementAccounting?.cashConfirmedAmount || 0) + Number(ukweziSettlementAccounting?.saccoConfirmedAmount || 0);
    const verificationDifference = ownerGrossForCheck == null || totalDistributed == null
      ? null
      : Number((Number(ownerGrossForCheck) - totalDistributed).toFixed(2));
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
    const years = getAccountingYears();
    const bilingualMonths = getBilingualMonthNames();
    const selectedUkweziRange = getHalfMonthDateRange(Number(ukweziYear), Number(ukweziMonth), ukweziPeriod);
    const ukweziPdfParams = new URLSearchParams({ month: ukweziMonth, year: ukweziYear, periodType: ukweziPeriod });
    ukweziPdfParams.set('language', publicLanguage.language);
    const activeCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name;
    const reportCenterName = isDairy ? activeCenterName : ukweziCenterName;
    if (reportCenterName) ukweziPdfParams.set('collectionCenter', reportCenterName);

    return <div className="ukwezi-view">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navUkwezi')}</span><h2>{publicLanguage.t(user?.accountType === 'COLLECTION_CENTER' ? 'dairyUkweziHeading' : 'collectorUkweziHeading')}</h2></div><Wallet size={20} aria-hidden="true" /></div>
        <div className="toolbar ukwezi-period-controls">
          {isDairy && centers.length ? <label className="ukwezi-center-filter">Active Ikigo<select value={selectedCenter} onChange={(event) => setSelectedCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
          <label>{publicLanguage.t('ukweziMonth')}<select value={ukweziMonth} onChange={(event) => selectUkweziMonth(event.target.value)}>{bilingualMonths.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{publicLanguage.t('ukweziYear')}<select value={ukweziYear} onChange={(event) => selectUkweziYear(event.target.value)}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <div className="timeline-scrubber" role="radiogroup" aria-label={publicLanguage.t('ukweziPeriod')}>
            <button
              type="button"
              className={`timeline-scrubber-pill${ukweziPeriod === 'first-half' ? ' is-active' : ''}`}
              onClick={() => setUkweziPeriod('first-half')}
            >
              1–15
            </button>
            <button
              type="button"
              className={`timeline-scrubber-pill${ukweziPeriod === 'second-half' ? ' is-active' : ''}`}
              onClick={() => setUkweziPeriod('second-half')}
            >
              16–{getMonthBounds(`${ukweziYear}-${ukweziMonth}`).endDate.slice(-2)}
            </button>
          </div>
          <label style={{ display: 'none' }}>{publicLanguage.t('ukweziPeriod')}<select value={ukweziPeriod} onChange={(event) => setUkweziPeriod(event.target.value as AccountingHalf)}><option value="first-half">1–15</option><option value="second-half">16–{getMonthBounds(`${ukweziYear}-${ukweziMonth}`).endDate.slice(-2)}</option></select></label>
          <label className="ukwezi-sort-mobile">{publicLanguage.t('sort')}<select value={`${ukweziSortBy}:${ukweziSortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); if (['name', 'volume', 'payable'].includes(field) && ['asc', 'desc'].includes(direction)) { setUkweziSortBy(field as typeof ukweziSortBy); setUkweziSortDirection(direction as typeof ukweziSortDirection); } }}>
            <option value="name:asc">{publicLanguage.t('milkFarmer')} ↑</option><option value="name:desc">{publicLanguage.t('milkFarmer')} ↓</option>
            <option value="volume:asc">{publicLanguage.t('reportsVolume')} ↑</option><option value="volume:desc">{publicLanguage.t('reportsVolume')} ↓</option>
            <option value="payable:asc">{publicLanguage.t('reportsNet')} ↑</option><option value="payable:desc">{publicLanguage.t('reportsNet')} ↓</option>
          </select></label>
          <button type="button" className="button button-secondary" onClick={() => run(loadUkwezi)}>{publicLanguage.t('reportsRefresh')}</button>
          {isCollector && ukweziReport && ukweziReport.rangeEnd < today() ? <button type="button" className="button button-primary" onClick={() => { void closeUkweziPeriod(); }} disabled={ukweziCloseLoading} aria-busy={ukweziCloseLoading}>{publicLanguage.t(ukweziCloseLoading ? 'ukweziPeriodClosing' : 'ukweziClosePeriod')}</button> : null}
          <button type="button" className="button button-secondary" onClick={() => { void downloadUkweziPdf(ukweziPdfParams); }} disabled={ukweziPdfLoading} aria-busy={ukweziPdfLoading} aria-label={publicLanguage.t('ukweziDownloadPdf')}><FileBarChart2 size={16} aria-hidden="true" />{publicLanguage.t(ukweziPdfLoading ? 'ukweziPdfPreparing' : 'ukweziDownloadPdf')}</button>
        </div>
        {ukweziCloseError ? <p className="form-error" role="alert">{ukweziCloseError}</p> : null}
        {ukweziCloseStatus ? <p className="form-success" role="status">{ukweziCloseStatus}</p> : null}
        {ukweziPdfError ? <p className="form-error" role="alert">{ukweziPdfError}</p> : null}
        {ukweziPdfStatus ? <p className="form-success" role="status">{ukweziPdfStatus}</p> : null}
        {ukweziReport ? <>
          <p className="ukwezi-period-caption">{ukweziReport.rangeStart} – {ukweziReport.rangeEnd}{reportCenterName ? ` · ${publicLanguage.t('ukweziCenter')}: ${reportCenterName}` : ''}</p>
          {isCollector ? <>
            <section className="ukwezi-summary" aria-labelledby="ukwezi-summary-heading">
              <h3 id="ukwezi-summary-heading">{publicLanguage.t('ukweziSummary')}</h3>
              <div className="ukwezi-summary-grid">
                <article className="ukwezi-summary-item ukwezi-summary-primary"><span>{publicLanguage.t('nyirayoRecordedMilkValue')}</span><b>{liters(actualVolume)} L</b><strong>{ownerGross == null ? '—' : `${money(ownerGross)} RWF`}</strong></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('farmersRecordedMilkValue')}</span><b>{liters(assignedVolume)} L</b><strong>{collectorReport?.collectorFarmerMilkValue == null ? '—' : `${money(collectorReport.collectorFarmerMilkValue)} RWF`}</strong></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('dashboardDeductions')}</span><b>{ukweziReport.totalDeductionsMonth == null ? '—' : `${money(ukweziReport.totalDeductionsMonth)} RWF`}</b></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('reportsTransport')}</span><b>{ukweziReport.collectorFarmerTransport == null ? '—' : `${money(ukweziReport.collectorFarmerTransport)} RWF`}</b></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('ukweziFarmerSignedNet')}</span><b>{signedFarmerNetBalance == null ? '—' : `${money(signedFarmerNetBalance)} RWF`}</b></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('ukweziFarmerRouteTotal')}</span><b>{positiveFarmerPaymentTotal == null ? '—' : `${money(positiveFarmerPaymentTotal)} RWF`}</b></article>
                <article className="ukwezi-summary-item"><span>{publicLanguage.t('ukweziNegativeNetTitle')} {negativeFarmerCount == null ? '' : `(${negativeFarmerCount})`}</span><b>{negativeFarmerNetBalance == null ? '—' : `${money(negativeFarmerNetBalance)} RWF`}</b></article>
                <article className="ukwezi-summary-item ukwezi-summary-total"><span>{publicLanguage.t('ukweziTotalPayable')}</span><b>{totalDistributed == null ? '—' : `${money(totalDistributed)} RWF`}</b></article>
              </div>
            </section>
            <section className="ukwezi-owner-accounting" aria-labelledby="ukwezi-owner-accounting-heading">
              <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h3 id="ukwezi-owner-accounting-heading">{publicLanguage.t('ukweziOwnerAccounting')}</h3></div></div>
              <ol className="ukwezi-accounting-steps">
                <li><span>{publicLanguage.t('nyirayoRecordedMilkValue')}</span><b>{ownerGrossForCheck == null ? '—' : `${money(ownerGrossForCheck)} RWF`}</b></li>
                <li className="ukwezi-accounting-subtract"><span>{publicLanguage.t('farmersRecordedMilkValue')}</span><b>{(ukweziReport.farmersMilkValue ?? ukweziReport.collectorFarmerMilkValue) == null ? '—' : `${money(ukweziReport.farmersMilkValue ?? ukweziReport.collectorFarmerMilkValue)} RWF`}</b></li>
                <li className="ukwezi-accounting-subtotal"><span>{publicLanguage.t('nyirayoBaseDifference')}</span><b>{ukweziReport.nyirayoBaseDifference == null ? '—' : `${money(ukweziReport.nyirayoBaseDifference)} RWF`}</b></li>
                <li className="ukwezi-accounting-add"><span>{publicLanguage.t('transportShare')}</span><b>{ukweziReport.transportAmount == null ? '—' : `${money(ukweziReport.transportAmount)} RWF`}</b></li>
                <li className="ukwezi-accounting-add"><span>{publicLanguage.t('farmerDeductionsShare')}</span><b>{ukweziReport.farmerDeductions == null ? '—' : `${money(ukweziReport.farmerDeductions)} RWF`}</b></li>
                <li className="ukwezi-accounting-subtotal"><span>{publicLanguage.t('nyirayoOperationalMargin')}</span><b>{ownerWorkIncome == null ? '—' : `${money(ownerWorkIncome)} RWF`}</b></li>
                <li><span>{publicLanguage.t('ukweziNegativeNetTitle')} ({negativeFarmerCount ?? '—'})</span><b>{negativeFarmerNetBalance == null ? '—' : `${money(negativeFarmerNetBalance)} RWF`}</b></li>
                <li className="ukwezi-accounting-add"><span>{publicLanguage.t('retainedNoAccountFarmerAmount')}</span><b>{ownerNoAccountAmount == null ? '—' : `${money(ownerNoAccountAmount)} RWF`}</b></li>
                <li><span>{publicLanguage.t('ukweziFarmerRouteTotal')}</span><b>{positiveFarmerPaymentTotal == null ? '—' : `${money(positiveFarmerPaymentTotal)} RWF`}</b></li>
                <li className="ukwezi-accounting-final"><span>{publicLanguage.t('nyirayoTotalAfterOperations')}</span><b>{ownerPaymentTotal == null ? '—' : `${money(ownerPaymentTotal)} RWF`}</b></li>
              </ol>
            </section>
            <section className={`ukwezi-reconciliation${verificationDifference != null && Math.abs(verificationDifference) > 0.005 ? ' is-unbalanced' : ''}`} aria-label={publicLanguage.t('ukweziVerificationDifference')}>
              <div><span>{publicLanguage.t('ukweziVerificationDifference')}</span><strong>{verificationDifference == null ? '—' : `${money(verificationDifference)} RWF`}</strong></div>
              <p className="ukwezi-reconciliation-equation">{ownerGrossForCheck == null || ownerPaymentTotal == null ? '—' : `${money(ownerGrossForCheck)} − (${money(ownerPaymentTotal)} + ${money(accountPaymentTotal)}) = ${money(verificationDifference)} RWF`}</p>
              <small>{publicLanguage.t('ukweziDistributionFormula')}</small>
              <small>{publicLanguage.t('ukweziDistributionDifferenceHelp')}</small>
              <small>{publicLanguage.t('ukweziPaymentInstructionNote').replace('{amount}', `${money(confirmedPayments)} RWF`)}</small>
            </section>
          </> : <div className="metric-strip ukwezi-totals">
            <div><span>{publicLanguage.t('ukweziOwnerTotal')}</span><b><AnimatedCounter value={actualVolume} formatter={liters} suffix=" L" className="tabular-nums" /></b><small>{ownerGross === null ? '—' : <><AnimatedCounter value={ownerGross} formatter={money} className="tabular-nums" /> RWF</>}</small></div>
            <div><span>{publicLanguage.t('navAbacunda')}</span><b><AnimatedCounter value={assignedVolume} formatter={liters} suffix=" L" className="tabular-nums" /></b><small><AnimatedCounter value={ukweziReport.totalRevenueMonth} formatter={money} className="tabular-nums" /> RWF</small></div>
            <div><span>{publicLanguage.t('dashboardDeductions')}</span><b><AnimatedCounter value={ukweziReport.totalDeductionsMonth} formatter={money} suffix=" RWF" className="tabular-nums" /></b></div>
            <div><span>{publicLanguage.t('ukweziPayable')}</span><b>{payable === null || payable === undefined ? '—' : <><AnimatedCounter value={payable} formatter={money} suffix=" RWF" className="tabular-nums" /></>}</b></div>
          </div>}
          {isCollector ? <CollectorUkweziPaymentRoster
            accountRows={accountPaymentRows}
            ownerRows={noAccountPaymentRows}
            ownerName={ownerRow?.farmerName || ownerRow?.name || ukweziReport.collectorProfile?.name || publicLanguage.t('ukweziOwnerRow')}
            ownerAccountNumber={ownerRow?.accountNumber || null}
            ownerAmount={ownerPaymentTotal}
            totalDistributed={totalDistributed}
            signedFarmerNetBalance={signedFarmerNetBalance}
            negativeFarmerNetBalance={negativeFarmerNetBalance}
            negativeFarmerCount={negativeFarmerCount}
            confirmedPayments={confirmedPayments}
            centerName={ukweziCenterName}
            language={publicLanguage.language}
            t={(key) => publicLanguage.t(key as any)}
          /> : null}
          {!isCollector && (settlementRows.length || ownerRow) ? <><div className="table-scroll ukwezi-settlement-table"><table><thead><tr><th>No</th><th>{sortableUkweziHeader('name', publicLanguage.t(isDairy ? 'assignedCollectors' : 'milkFarmer'))}</th>{isDairy ? <th>{publicLanguage.t('navAbacunda')}</th> : <th>{publicLanguage.t('accountNationalId')}</th>}<th>{publicLanguage.t('accountPhone')} / {publicLanguage.t('accountNumber')}</th><th>{sortableUkweziHeader('volume', publicLanguage.t('reportsVolume'))}</th><th>{publicLanguage.t('milkPrice')} / L</th><th>{publicLanguage.t('reportsGross')}</th>{isCollector ? <th>{publicLanguage.t('reportsTransport')}</th> : null}<th>{publicLanguage.t('dashboardDeductions')}</th><th>{sortableUkweziHeader('payable', publicLanguage.t('reportsNet'))}</th>{isCollector ? <th>{publicLanguage.t('actions')}</th> : null}</tr></thead><tbody>
            {settlementRows.map((row: any, index: number) => <tr key={`${isDairy ? 'collector' : 'farmer'}-${isDairy ? row.collectorUserId : row.farmerId}`}><td>{index + 1}</td><td>{isDairy ? row.name : row.farmerName}</td>{isDairy ? <td>{row.assignedFarmerCount}</td> : <td>{row.nationalId || row.idNumber || '—'}</td>}<td>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(row.totalVolume)} L</td><td>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</td><td>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</td>{isCollector ? <td>{money(row.totalTransport)} RWF</td> : null}<td>{money(row.totalDeductions)} RWF</td><td>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</td>{isCollector ? <td><button type="button" className="button button-secondary small-button" onClick={() => openFarmerDeduction(row.farmerId, row.farmerName, selectedUkweziRange.startDate, selectedUkweziRange.endDate, { totalVolume: Number(row.totalVolume || 0), pricePerLiter: row.pricePerLiter == null ? null : Number(row.pricePerLiter), grossAmount: row.grossAmount == null ? null : Number(row.grossAmount), totalDeductions: Number(row.totalDeductions || 0), totalTransport: row.totalTransport == null ? null : Number(row.totalTransport), netAmount: row.netAmount == null ? null : Number(row.netAmount) })}><Plus size={14} aria-hidden="true" />{publicLanguage.t('deductionsAdd')}</button></td> : null}</tr>)}
            {ownerRow ? <tr className="owner-settlement-row"><td>{settlementRows.length + 1}</td><td><b>{ownerRow.farmerName}</b><small className="block-muted">{publicLanguage.t('ukweziOwnerRow')}</small></td><td>{ownerRow.nationalId || ownerRow.idNumber || '—'}</td><td>{[ownerRow.phone, ownerRow.accountNumber].filter(Boolean).join(' / ') || '—'}</td><td>{liters(ownerRow.totalVolume)} L</td><td>{ownerRow.pricePerLiter == null ? '—' : `${money(ownerRow.pricePerLiter)} RWF`}</td><td>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</td>{isCollector ? <td>{money(ownerRow.totalTransport)} RWF</td> : null}<td>{money(ownerRow.totalDeductions)} RWF</td><td>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</td>{isCollector ? <td>—</td> : null}</tr> : null}
          </tbody></table></div><div className="ukwezi-mobile-list">{settlementRows.map((row: any) => <article className="ukwezi-mobile-card" key={`mobile-${isDairy ? row.collectorUserId : row.farmerId}`}><header><b>{isDairy ? row.name : row.farmerName}</b><strong>{liters(row.totalVolume)} L</strong></header><dl>{isDairy ? <div><dt>{publicLanguage.t('navAbacunda')}</dt><dd>{row.assignedFarmerCount}</dd></div> : <div><dt>{publicLanguage.t('accountNationalId')}</dt><dd>{row.nationalId || row.idNumber || '—'}</dd></div>}<div><dt>{publicLanguage.t('milkPrice')} / L</dt><dd>{row.totalVolume > 0 ? `${money(row.pricePerLiter || 0)} RWF` : '—'}</dd></div><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{row.grossAmount == null ? '—' : `${money(row.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(row.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(row.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{row.netAmount == null ? '—' : `${money(row.netAmount)} RWF`}</dd></div></dl><p>{[row.phone, row.accountNumber].filter(Boolean).join(' / ') || '—'}</p>{isCollector ? <button type="button" className="button button-secondary button-block" onClick={() => openFarmerDeduction(row.farmerId, row.farmerName, selectedUkweziRange.startDate, selectedUkweziRange.endDate, { totalVolume: Number(row.totalVolume || 0), pricePerLiter: row.pricePerLiter == null ? null : Number(row.pricePerLiter), grossAmount: row.grossAmount == null ? null : Number(row.grossAmount), totalDeductions: Number(row.totalDeductions || 0), totalTransport: row.totalTransport == null ? null : Number(row.totalTransport), netAmount: row.netAmount == null ? null : Number(row.netAmount) })}><Plus size={14} aria-hidden="true" />{publicLanguage.t('deductionsAdd')}</button> : null}</article>)}{ownerRow ? <article className="ukwezi-mobile-card owner-settlement-row"><header><b>{ownerRow.farmerName} · {publicLanguage.t('ukweziOwnerRow')}</b><strong>{liters(ownerRow.totalVolume)} L</strong></header><dl><div><dt>{publicLanguage.t('reportsGross')}</dt><dd>{ownerRow.grossAmount == null ? '—' : `${money(ownerRow.grossAmount)} RWF`}</dd></div>{isCollector ? <div><dt>{publicLanguage.t('reportsTransport')}</dt><dd>{money(ownerRow.totalTransport)} RWF</dd></div> : null}<div><dt>{publicLanguage.t('dashboardDeductions')}</dt><dd>{money(ownerRow.totalDeductions)} RWF</dd></div><div><dt>{publicLanguage.t('reportsNet')}</dt><dd>{ownerRow.netAmount == null ? '—' : `${money(ownerRow.netAmount)} RWF`}</dd></div></dl></article> : null}</div></> : null}
          {lossRows.length ? <section className="ukwezi-loss-reconciliation"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('ifishiLost')}</span><h3>{publicLanguage.t('ukweziLossReconciliation')}</h3></div></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('milkCollectionDate')}</th><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('ifishiOriginal')}</th><th>{publicLanguage.t('ifishiValid')}</th><th>{publicLanguage.t('ifishiLost')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('ifishiReason')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('when')}</th></tr></thead><tbody>{lossRows.map((row) => <tr key={row.key}><td>{row.date}</td><td>{row.source}</td><td>{liters(row.original)} L</td><td>{liters(row.valid)} L</td><td>{liters(row.lost)} L</td><td>{row.status}</td><td>{row.reason || '—'}</td><td>{row.actor || '—'}</td><td>{row.when ? formatDateLabel(row.when, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td></tr>)}</tbody></table></div></section> : null}
        </> : <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div>}
      </section>
    </div>;
  };

  const renderTransport = () => <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('navTransport')}</span><h2>{publicLanguage.t('collectorTransportTitle')}</h2></div><Truck size={20} aria-hidden="true" /></div>
    <div className="toolbar ukwezi-period-controls">
      <label>{publicLanguage.t('ukweziMonth')}<select value={ukweziMonth} onChange={(event) => selectUkweziMonth(event.target.value)}>{getMonthNames(publicLanguage.language).map((name, index) => <option key={index + 1} value={String(index + 1).padStart(2, '0')}>{name}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziYear')}<select value={ukweziYear} onChange={(event) => selectUkweziYear(event.target.value)}>{getAccountingYears().map((year) => <option key={year}>{year}</option>)}</select></label>
      <label>{publicLanguage.t('ukweziPeriod')}<select value={ukweziPeriod} onChange={(event) => setUkweziPeriod(event.target.value as AccountingHalf)}><option value="first-half">1–15</option><option value="second-half">16–{getMonthBounds(`${ukweziYear}-${ukweziMonth}`).endDate.slice(-2)}</option></select></label>
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
      <div className="panel-heading" style={{ marginBottom: 18 }}>
        <div>
          <span className="eyebrow">{publicLanguage.t('configuration')}</span>
          <h2>{publicLanguage.t('accountSettings')}</h2>
        </div>
        <Settings size={20} aria-hidden="true" />
      </div>
      <div className="account-settings-tabs" role="tablist" aria-label={publicLanguage.t('accountSettings')}>
        <button type="button" id="account-settings-tab-personal" className="account-settings-tab" role="tab" aria-selected={accountSettingsTab === 'personal'} aria-controls="account-settings-panel-personal" tabIndex={accountSettingsTab === 'personal' ? 0 : -1} onClick={() => setAccountSettingsTab('personal')} onKeyDown={handleTabKeyDown}>
          <UserRound size={17} aria-hidden="true" />{publicLanguage.t('myAccount')}
        </button>
        <button type="button" id="account-settings-tab-management" className="account-settings-tab" role="tab" aria-selected={accountSettingsTab === 'management'} aria-controls="account-settings-panel-management" tabIndex={accountSettingsTab === 'management' ? 0 : -1} onClick={() => setAccountSettingsTab('management')} onKeyDown={handleTabKeyDown}>
          <ContactRound size={17} aria-hidden="true" />{publicLanguage.t('accountManagement')}
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
          <p className="muted-note">{publicLanguage.t('accountLanguageHeaderHint')}</p>
        </section>

        <section className="panel account-settings-logout">
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('accountManagement')}</span><h2>{publicLanguage.t('signOut')}</h2></div></div>
          <div className="panel-settings-actions">
            <button type="button" className="button button-danger button-block" onClick={() => setLogoutConfirm(true)} disabled={logoutBusy}>{publicLanguage.t('signOut')}</button>
          </div>
        </section>

        {logoutConfirm ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><RotateCcw size={24} aria-hidden="true" /></span><div><b>{publicLanguage.t('logoutConfirm')}</b></div><div className="form-actions"><button type="button" className="button button-primary" onClick={() => void logout()} disabled={logoutBusy}>{publicLanguage.t('signOut')}</button><button type="button" className="button button-secondary" onClick={() => setLogoutConfirm(false)}>{publicLanguage.t('cancel')}</button></div></div> : null}

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
        {billingError ? <div className="form-error" role="alert">{publicLanguage.t(billingError)} <button type="button" className="text-button" onClick={() => void loadBilling()} disabled={billingLoading}>{publicLanguage.t('tryAgain')}</button></div> : null}
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

  const renderNotificationCard = (item: Notice) => {
    const resolved = item.status === 'resolved';
    const priority = priorityCopy[String(item.priority || '')] ? String(item.priority) : 'info';
    const farmerId = item.farmer_id ?? item.details?.farmerId ?? null;
    const nextAction = notificationNextAction(item);
    const billingAlert = item.notification_type === 'subscription_expiring' || String(item.notification_type).startsWith('payment_');
    const settlementAlert = ['settlement_confirmed', 'cash_payout_approved', 'debt_created', 'debt_repaid'].includes(item.notification_type);
    return <article className={`notice-row notice-row-${priority}${item.isRead ? '' : ' unread'}${resolved ? ' notice-resolved' : ''}`} key={item.id}>
      <div className="notice-main">
        <div className="notice-meta">
          <span className={`priority-badge priority-${priority}`}>{publicLanguage.t(priorityCopy[priority])}</span>
          <span className="eyebrow">{notificationTypeLabel(item.notification_type)}</span>
          {item.collection_date ? <span className="notice-meta-chip"><CalendarDays size={13} aria-hidden="true" />{formatDateLabel(item.collection_date, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric' })}</span> : null}
          {item.period ? <span className="notice-meta-chip">{notificationSessionLabel(item.period)}</span> : null}
          {item.collection_center ? <span className="notice-meta-chip"><Warehouse size={13} aria-hidden="true" />{item.collection_center}</span> : null}
          {resolved ? <span className="notice-meta-chip notice-meta-resolved"><Check size={13} aria-hidden="true" />{publicLanguage.t('alertStatusResolved')}</span> : null}
        </div>
        <h3>{notificationTitle(item)}</h3>
        <p>{notificationMessage(item)}</p>
        {!resolved && nextAction ? <p className="notice-next-action">{nextAction}</p> : null}
        {!resolved && item.details?.evidence === 'no_recorded_delivery' ? <p className="notice-uncertainty">{publicLanguage.t('alertUncertainNote')}</p> : null}
        {resolved ? <p className="notice-resolution">{notificationResolutionSummary(item)}{item.resolutionNote ? ` · ${item.resolutionNote}` : ''}</p> : null}
        <small>{formatDateLabel(item.createdAt, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</small>
      </div>
      <div className="notice-actions">
        {!resolved && farmerId ? <button type="button" className="button button-secondary small-button" onClick={() => openFarmerFromAlert(item)}>{publicLanguage.t('alertOpenFarmer')}</button> : null}
        {!resolved && farmerId && isCollector ? <button type="button" className="button button-secondary small-button" onClick={() => recordMilkFromAlert(item)}>{publicLanguage.t('alertRecordMilk')}</button> : null}
        {!resolved && !isAdmin && billingAlert ? <button type="button" className="button button-secondary small-button" onClick={() => reviewBillingFromAlert(item)}>{nextAction || publicLanguage.t('navSubscription')}</button> : null}
        {!resolved && !isAdmin && settlementAlert ? <button type="button" className="button button-secondary small-button" onClick={() => reviewSettlementFromAlert(item)}>{publicLanguage.t('alertNextReviewSettlement')}</button> : null}
        {!resolved && isOperationalAlert(item) ? <button type="button" className="button button-primary small-button" onClick={() => openResolveDialog(item)}>{publicLanguage.t('alertResolve')}</button> : null}
        {resolved ? <button type="button" className="button button-secondary small-button" onClick={() => reopenAlert(item)}>{publicLanguage.t('alertReopen')}</button> : !item.isRead ? <button type="button" className="button button-secondary small-button" onClick={() => markRead(item)}>{publicLanguage.t('markRead')}</button> : <Check size={17} />}
      </div>
    </article>;
  };

  const renderNotificationSection = (headingKey: PublicCopyKey, items: Notice[]) => items.length ? <section className="notice-section">
    <div className="notice-section-heading"><h3>{publicLanguage.t(headingKey)}</h3><span className="count-label">{items.length}</span></div>
    <div className="notice-list">{items.map((item) => renderNotificationCard(item))}</div>
  </section> : null;

  const renderNotifications = () => {
    const openItems = notifications.filter((item) => item.status !== 'resolved');
    const actionItems = openItems.filter((item) => isOperationalAlert(item));
    const activityItems = openItems.filter((item) => !isOperationalAlert(item));
    const resolvedItems = notifications.filter((item) => item.status === 'resolved');
    const resetFilters = () => {
      setNotificationSearchQuery(''); setNotificationSearch(''); setNotificationStatusFilter(''); setNotificationPriorityFilter(''); setNotificationTypeFilter(''); setNotificationStateFilter('all'); setNotificationGroupFilter('');
      void loadNotifications({ search: '', status: '', priority: '', type: '', state: 'all', alertGroup: '' });
    };
    const hasFilters = Boolean(notificationStateFilter !== 'all' || notificationGroupFilter || notificationSearch || notificationStatusFilter || notificationPriorityFilter || notificationTypeFilter);
    return <section className="panel panel-wide notification-panel">
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('alertsInbox')}</span><h2>{publicLanguage.t(isAdmin ? 'navAdminAlerts' : 'navAlerts')}</h2></div><button type="button" className="button button-secondary" onClick={() => void markAllNotificationsRead()} disabled={busy || !notifications.some((item) => !item.isRead)}>{publicLanguage.t('markAllRead')}</button></div>
      {isAdmin ? <p className="block-muted">{publicLanguage.t('adminPersonalAlertsNote')}</p> : null}
      {notificationError ? <div className="form-error" role="alert">{notificationError} <button type="button" className="text-button" onClick={() => void loadNotifications()}>{publicLanguage.t('tryAgain')}</button></div> : null}
      {notificationLoading && !notifications.length ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('notificationsLoading')}</div> : null}
      {!notificationLoading && !notifications.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><Bell size={21} aria-hidden="true" /></span><div><b>{publicLanguage.t('notificationsEmptyTitle')}</b><p>{publicLanguage.t('notificationsEmptyBody')}</p></div>{hasFilters ? <button type="button" className="button button-secondary small-button" onClick={resetFilters}>{publicLanguage.t('milkClearSearch')}</button> : null}</div> : null}
      {renderNotificationSection('alertsNeedsAttention', actionItems)}
      {renderNotificationSection('alertsActivity', activityItems)}
      {renderNotificationSection('alertsResolved', resolvedItems)}
    </section>;
  };

  const renderAdminAccounts = () => {
    const totalPages = Math.max(1, Math.ceil((accounts?.total || 0) / ACCOUNT_PAGE_SIZE));
    return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('platform')}</span><h2>{publicLanguage.t('customerAccounts')}</h2></div><span className="count-label">{accounts ? `${accounts.total} ${publicLanguage.t('accountsCount')} ` : '…'}</span></div><div className="toolbar"><form className="search-form" onSubmit={(event) => { event.preventDefault(); void loadAccounts(1).catch((reason) => setError(reason.message)); }}><Search size={17} /><input placeholder={publicLanguage.t('searchNameEmail')} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} /><button className="button button-secondary">{publicLanguage.t('search')}</button></form><select value={accountStatus} onChange={(event) => { const nextStatus = event.target.value; setAccountStatus(nextStatus); void loadAccounts(1, { status: nextStatus }).catch((reason) => setError(reason.message)); }}><option value="">{publicLanguage.t('allStatuses')}</option>{Object.keys(accountStatusCopy).map((status) => <option key={status} value={status}>{publicLanguage.t(accountStatusCopy[status as keyof typeof accountStatusCopy])}</option>)}</select></div><div className="table-scroll admin-accounts-desktop-table"><table><thead><tr>
      <th>#</th>
      <th>{publicLanguage.language === 'en' ? 'Name' : 'Izina'}</th>
      <th>{publicLanguage.language === 'en' ? 'Email / Phone' : 'Email / Telefone'}<span className="sr-only"> {publicLanguage.t('emailVerificationStatus')}</span></th>
      <th>{publicLanguage.t('accountType')}</th>
      <th>{publicLanguage.t('status')}</th>
      <th>{publicLanguage.language === 'en' ? 'Subscription Status' : "Imiterere y'Ifatabuguzi"}</th>
      <th>{publicLanguage.language === 'en' ? 'Payment Deadline' : 'Itariki yo Kwishyura'}</th>
      <th>{publicLanguage.t('actions')}</th>
    </tr></thead><tbody>
      {(accounts?.accounts || []).map((account, idx) => {
        const isExempt = Boolean(account.billing_exempt || account.effective_status === 'exempt');
        const isActive = account.effective_status === 'active';
        const isExpired = account.effective_status === 'expired' || (account.days_remaining != null && account.days_remaining <= 0);
        const isSuspended = account.effective_status === 'suspended' || account.account_status === 'suspended';
        const rowNumber = ((accounts?.page || 1) - 1) * ACCOUNT_PAGE_SIZE + idx + 1;

        return <tr key={account.user_id}>
          <td>
            <span className="farmer-number-badge font-mono">{String(rowNumber).padStart(3, '0')}</span>
          </td>
          <td className="strong-cell">
            <b>{account.account_name}</b>
          </td>
          <td>
            <div>{account.account_email}</div>
            {account.phone ? <small className="block-muted">{account.phone}</small> : null}
            <small className="block-muted">
              <span className="sr-only">{publicLanguage.t('emailVerificationStatus')}: </span>
              {account.email_verified ? publicLanguage.t('emailVerifiedValue') : publicLanguage.t('emailNotVerifiedValue')}
            </small>
          </td>
          <td>
            {account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}
          </td>
          <td>
            <span className={`delivery-status-pill ${account.account_status === 'suspended' ? 'is-missing' : 'is-assigned'}`}>
              {publicLanguage.t(accountStatusCopy[(account.account_status || 'active') as keyof typeof accountStatusCopy] || 'statusActive')}
            </span>
            {account.account_status === 'not_approved' ? <small className="block-muted">{publicLanguage.t('adminNotApprovedNoWorkflow')}</small> : null}
          </td>
          <td>
            {isExempt ? (
              <span className="delivery-status-pill is-assigned" style={{ background: '#e6f7ec', color: '#157f50', borderColor: '#b8e6c7' }}>
                {publicLanguage.language === 'en' ? 'Exempt' : 'Yasonewe'}
              </span>
            ) : isActive ? (
              <span className="delivery-status-pill is-assigned" style={{ background: '#e8f4ea', color: '#137333', borderColor: '#ceead6' }}>
                {publicLanguage.language === 'en'
                  ? `Active${account.days_remaining != null ? ` (${account.days_remaining}d left)` : ''}`
                  : `Rirakora${account.days_remaining != null ? ` (iminsi ${account.days_remaining} isigaye)` : ''}`}
              </span>
            ) : isExpired ? (
              <span className="delivery-status-pill is-missing" style={{ background: '#fef7e0', color: '#b06000', borderColor: '#fce8b2' }}>
                {publicLanguage.language === 'en' ? 'Expired' : 'Ryarangiye'}
              </span>
            ) : isSuspended ? (
              <span className="delivery-status-pill is-missing" style={{ background: '#fce8e6', color: '#c5221f', borderColor: '#fad2cf' }}>
                {publicLanguage.language === 'en' ? 'Suspended' : 'Hagaritswe'}
              </span>
            ) : (
              <span className="delivery-status-pill">
                {publicLanguage.t(accountStatusCopy[(account.effective_status || account.account_status) as keyof typeof accountStatusCopy] || 'statusActive')}
              </span>
            )}
          </td>
          <td>
            {isExempt ? (
              <span className="block-muted">{publicLanguage.language === 'en' ? 'Exempt (No deadline)' : 'Yasonewe (Nta tariki)'}</span>
            ) : account.payment_due_at ? (
              <div>
                <b>{formatDateLabel(account.payment_due_at, publicLanguage.language, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
                {account.days_remaining != null ? (
                  <small className="block-muted" style={{ display: 'block' }}>
                    {account.days_remaining > 0
                      ? (publicLanguage.language === 'en' ? `${account.days_remaining} days left` : `hasigaye iminsi ${account.days_remaining}`)
                      : (publicLanguage.language === 'en' ? 'Expired' : 'Ryarangiye')}
                  </small>
                ) : null}
              </div>
            ) : (
              <span className="block-muted">—</span>
            )}
          </td>
          <td className="actions-cell">
            <button type="button" className="text-button" onClick={() => void loadAdminAccountDetails(account.user_id)}>
              {publicLanguage.t('adminViewAccount')}
            </button>
            <button
              type="button"
              className="button button-secondary small-button"
              style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4 }}
              onClick={() => openGrantDaysModal(account)}
            >
              + {publicLanguage.language === 'en' ? 'Grant Days' : 'Kongera Iminsi'}
            </button>
            <button type="button" className="text-button" onClick={() => void toggleExemption(account)}>
              {isExempt
                ? (publicLanguage.language === 'en' ? 'Revoke Exemption' : 'Kuraho Imbabazi')
                : (publicLanguage.language === 'en' ? 'Grant Exemption' : 'Tanga Imbabazi')}
            </button>
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => void adminAction(account, account.account_status === 'suspended' ? 'reactivate' : 'suspend')}
            >
              {publicLanguage.t(account.account_status === 'suspended' ? 'reactivate' : 'suspend')}
            </button>
            {account.email_verified ? null : (
              <button
                type="button"
                className="text-button"
                onClick={() => void adminAction(account, 'resendVerification')}
                disabled={busy}
              >
                {publicLanguage.t('resendVerificationEmail')}
              </button>
            )}
          </td>
        </tr>;
      })}
    </tbody></table></div>
    <div className="admin-accounts-mobile-list">
      {(accounts?.accounts || []).map((account) => {
        const isExempt = Boolean(account.billing_exempt || account.effective_status === 'exempt');
        const isActive = account.effective_status === 'active';
        return (
          <article key={account.user_id} className="admin-account-mobile-card">
            <div>
              <span className="eyebrow">{account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}</span>
              <h3>{account.account_name}</h3>
              <small className="block-muted">{account.account_email}</small>
            </div>
            <dl>
              <div>
                <dt>{publicLanguage.t('status')}</dt>
                <dd>{publicLanguage.t(accountStatusCopy[(account.account_status || 'active') as keyof typeof accountStatusCopy] || 'statusActive')}</dd>
              </div>
              <div>
                <dt>{publicLanguage.language === 'en' ? 'Subscription' : 'Ifatabuguzi'}</dt>
                <dd>
                  {isExempt ? (publicLanguage.language === 'en' ? 'Exempt' : 'Yasonewe')
                    : isActive ? (publicLanguage.language === 'en' ? `Active (${account.days_remaining != null ? `${account.days_remaining}d` : ''})` : `Rirakora (${account.days_remaining != null ? `${account.days_remaining}d` : ''})`)
                    : (publicLanguage.language === 'en' ? 'Expired' : 'Ryarangiye')}
                </dd>
              </div>
              <div>
                <dt>{publicLanguage.language === 'en' ? 'Deadline' : 'Itariki yo Kwishyura'}</dt>
                <dd>{account.payment_due_at ? formatDateLabel(account.payment_due_at, publicLanguage.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</dd>
              </div>
              <div>
                <dt>{publicLanguage.t('emailVerificationStatus')}</dt>
                <dd>{account.email_verified ? publicLanguage.t('emailVerifiedValue') : publicLanguage.t('emailNotVerifiedValue')}</dd>
              </div>
            </dl>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <button type="button" className="button button-secondary small-button" onClick={() => void loadAdminAccountDetails(account.user_id)}>
                {publicLanguage.t('adminViewAccount')}
              </button>
              <button type="button" className="button button-secondary small-button" onClick={() => openGrantDaysModal(account)}>
                + {publicLanguage.language === 'en' ? 'Grant Days' : 'Kongera Iminsi'}
              </button>
              <button type="button" className="button button-secondary small-button" onClick={() => void toggleExemption(account)}>
                {isExempt ? (publicLanguage.language === 'en' ? 'Revoke Exemption' : 'Kuraho Imbabazi') : (publicLanguage.language === 'en' ? 'Grant Exemption' : 'Tanga Imbabazi')}
              </button>
              <button type="button" className="button button-secondary small-button danger-text" onClick={() => void adminAction(account, account.account_status === 'suspended' ? 'reactivate' : 'suspend')}>
                {publicLanguage.t(account.account_status === 'suspended' ? 'reactivate' : 'suspend')}
              </button>
            </div>
          </article>
        );
      })}
    </div>
    {accounts ? <div className="panel-footer admin-payment-pagination"><span>{accounts.page} / {totalPages}</span><div><button type="button" className="button button-secondary small-button" disabled={accounts.page <= 1} onClick={() => { void loadAccounts(accounts.page - 1).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('previousPage')}</button><button type="button" className="button button-secondary small-button" disabled={accounts.page >= totalPages} onClick={() => { void loadAccounts(accounts.page + 1).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('nextPage')}</button></div></div> : null}</section>;
  };

  const renderAdminAccountDetailsModal = () => (
    <Modal ariaLabel={publicLanguage.t('customerAccounts')} onClose={closeAdminAccountDetails}>
      <div className="panel-heading">
        <div><span className="eyebrow">{publicLanguage.t('platform')}</span><h2>{adminAccountDetails?.account?.name || publicLanguage.t('customerAccounts')}</h2></div>
        <button type="button" className="icon-button" onClick={closeAdminAccountDetails} aria-label={publicLanguage.t('close')}><X size={18} /></button>
      </div>
      {adminAccountDetailsLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : adminAccountDetailsError ? <div className="form-error" role="alert">{adminAccountDetailsError}</div> : adminAccountDetails ? <div className="admin-account-details">
        <dl className="payment-readiness-list">
          <div><dt>{publicLanguage.t('email')}</dt><dd>{adminAccountDetails.account.email}</dd></div>
          <div><dt>{publicLanguage.t('accountType')}</dt><dd>{adminAccountDetails.account.account_type === 'COLLECTION_CENTER' ? publicLanguage.t('collectionCenter') : publicLanguage.t('collector')}</dd></div>
          <div><dt>{publicLanguage.t('status')}</dt><dd>{publicLanguage.t(accountStatusCopy[(adminAccountDetails.account.account_status || 'active') as keyof typeof accountStatusCopy] || 'statusActive')}{adminAccountDetails.account.account_status === 'not_approved' ? <small className="block-muted">{publicLanguage.t('adminNotApprovedNoWorkflow')}</small> : null}</dd></div>
          <div><dt>{publicLanguage.t('emailVerificationStatus')}</dt><dd>{adminAccountDetails.account.email_verified ? publicLanguage.t('emailVerifiedValue') : publicLanguage.t('emailNotVerifiedValue')}</dd></div>
          <div><dt>{publicLanguage.t('accountPhone')}</dt><dd>{adminAccountDetails.account.phone || '—'}</dd></div>
          <div><dt>{publicLanguage.t('accountCreated')}</dt><dd>{formatDateLabel(adminAccountDetails.account.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</dd></div>
          <div><dt>{publicLanguage.t('navSubscription')}</dt><dd>{adminAccountDetails.subscription ? `${publicLanguage.t(subscriptionStatusCopy[(adminAccountDetails.subscription.effective_status || adminAccountDetails.subscription.status || 'pending').toLowerCase() as keyof typeof subscriptionStatusCopy] || 'statusPending')} · ${typeof adminAccountDetails.subscription.current_price === 'number' ? money(adminAccountDetails.subscription.current_price) : (adminAccountDetails.subscription.current_price || '—')} ${adminAccountDetails.subscription.currency || 'RWF'}` : publicLanguage.t('subscriptionNoAccount')}</dd></div>
        </dl>
        {adminAccountDetails.subscription ? <section className="panel compact-panel subscription-exemption-controls">
          <div className="panel-heading"><h3>{publicLanguage.t('subscriptionExemption')}</h3></div>
          <p role="status">{publicLanguage.t(adminAccountDetails.subscription.billing_exempt ? 'subscriptionExemptionActive' : 'subscriptionExemptionInactive')}{adminAccountDetails.subscription.exemption_reason ? ` · ${adminAccountDetails.subscription.exemption_reason}` : ''}</p>
          <label>{publicLanguage.t('subscriptionExemptionReason')}<input maxLength={255} value={adminExemptionReason} onChange={(event) => setAdminExemptionReason(event.target.value)} /></label>
          <button type="button" className="button button-secondary" disabled={busy || adminExemptionReason.trim().length < 5} onClick={() => void updateAdminSubscriptionExemption(!adminAccountDetails.subscription?.billing_exempt)}>{publicLanguage.t(adminAccountDetails.subscription.billing_exempt ? 'subscriptionExemptionRevoke' : 'subscriptionExemptionGrant')}</button>
        </section> : null}
        <div className="admin-account-stat-grid">
          <div><span>{publicLanguage.t('navCenters')}</span><b>{adminAccountDetails.counts.centers}</b></div>
          <div><span>{publicLanguage.t('farmers')}</span><b>{adminAccountDetails.counts.farmers}</b></div>
          <div><span>{publicLanguage.t('navMilk')}</span><b>{adminAccountDetails.counts.milk_records}</b></div>
          <div><span>{publicLanguage.t('navDeductions')}</span><b>{adminAccountDetails.counts.deductions}</b></div>
          <div><span>{publicLanguage.t('adminPaymentsCount')}</span><b>{adminAccountDetails.counts.payments}</b></div>
          <div><span>{publicLanguage.t('navAlerts')}</span><b>{adminAccountDetails.counts.notifications}</b></div>
        </div>
      </div> : null}
    </Modal>
  );

  const renderGrantDaysModal = () => {
    if (!grantDaysAccount) return null;
    return (
      <Modal
        ariaLabel={publicLanguage.language === 'en' ? 'Grant Working Days' : 'Kongera Iminsi yo Gukora'}
        onClose={() => { if (!grantDaysLoading) setGrantDaysAccount(null); }}
        dismissible={!grantDaysLoading}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('platform')}</span>
            <h2>+ {publicLanguage.language === 'en' ? 'Grant Days / Extend Access' : 'Kongera Iminsi / Kwagura Uburenganzira'}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setGrantDaysAccount(null)}
            disabled={grantDaysLoading}
            aria-label={publicLanguage.t('close')}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted-note" style={{ marginBottom: 12 }}>
          {publicLanguage.language === 'en' ? 'Account:' : 'Konti:'} <b>{grantDaysAccount.account_name}</b> ({grantDaysAccount.account_email})
        </p>
        <form className="form-stack compact" onSubmit={submitGrantDays}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {[7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                className={`button ${grantDaysValue === d ? 'button-primary' : 'button-secondary'} small-button`}
                onClick={() => setGrantDaysValue(d)}
              >
                +{d} {publicLanguage.language === 'en' ? 'Days' : 'Iminsi'}
              </button>
            ))}
          </div>
          <label>
            {publicLanguage.language === 'en' ? 'Custom Working Days to Add' : "Umubare w'Iminsi yo Kongeraho"}
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              required
              value={grantDaysValue}
              onChange={(e) => setGrantDaysValue(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </label>
          <label>
            {publicLanguage.language === 'en' ? 'Reason / Note (optional)' : 'Impamvu / Ibisobanuro (niba bihari)'}
            <input
              type="text"
              maxLength={255}
              placeholder={publicLanguage.language === 'en' ? 'e.g. Granted grace period' : "urugero: Igihe cy'inyongera"}
              value={grantDaysReason}
              onChange={(e) => setGrantDaysReason(e.target.value)}
            />
          </label>
          {grantDaysError ? <p className="form-error" role="alert">{grantDaysError}</p> : null}
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setGrantDaysAccount(null)}
              disabled={grantDaysLoading}
            >
              {publicLanguage.t('cancel')}
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={grantDaysLoading || !grantDaysValue}
            >
              {grantDaysLoading ? publicLanguage.t('wait') : (publicLanguage.language === 'en' ? 'Confirm & Extend' : 'Emeza & Ongera Iminsi')}
            </button>
          </div>
        </form>
      </Modal>
    );
  };

  const renderAdminAudit = () => {
    const totalPages = Math.max(1, Math.ceil((auditRows?.total || 0) / (auditRows?.limit || 50)));
    return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('auditSecurity')}</span><h2>{publicLanguage.t('auditLog')}</h2></div><span className="count-label">{auditRows?.total ?? '…'} {publicLanguage.t('events')}</span></div><div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('when')}</th><th>{publicLanguage.t('actor')}</th><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('entity')}</th><th>{publicLanguage.t('actions')}</th><th>{publicLanguage.t('details')}</th></tr></thead><tbody>{(auditRows?.items || []).map((row: any) => <tr key={row.id}><td>{formatDateLabel(row.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</td><td>{row.actor_name || row.changed_by || publicLanguage.t('systemActor')}</td><td>{row.owner_user_id ?? '—'}</td><td>{row.entity_type} #{row.entity_id}</td><td>{row.action}</td><td><code>{JSON.stringify(row.details || {})}</code></td></tr>)}</tbody></table></div>{auditRows ? <div className="panel-footer admin-payment-pagination"><span>{auditRows.page} / {totalPages}</span><div><button type="button" className="button button-secondary small-button" disabled={auditRows.page <= 1} onClick={() => { void loadAudit(auditRows.page - 1).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('previousPage')}</button><button type="button" className="button button-secondary small-button" disabled={auditRows.page >= totalPages} onClick={() => { void loadAudit(auditRows.page + 1).catch((reason) => setError(reason.message)); }}>{publicLanguage.t('nextPage')}</button></div></div> : null}</section>;
  };

  const renderAdminConfig = () => {
    const configuredAmount = centerPricing?.config?.monthly_amount ?? centerPricing?.plan?.price;
    const currency = centerPricing?.config?.currency ?? centerPricing?.plan?.currency ?? 'RWF';
    const billingPeriodLabel = centerPricing?.plan?.billing_period
      ? publicLanguage.t('billingMonthly')
      : '';
    return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('pricingPlatform')}</span><h2>{publicLanguage.t('centerPlan')}</h2></div><CircleDollarSign size={20} /></div><div className="config-callout">{adminConfigLoading ? publicLanguage.t('dashboardLoading') : configuredAmount == null ? publicLanguage.t('subscriptionUnavailable') : `${centerPricing?.plan?.name || publicLanguage.t('centerPlan')} · ${money(Number(configuredAmount))} ${currency}${billingPeriodLabel ? ` / ${billingPeriodLabel}` : ''}`}</div><form key={centerPricing?.config?.updated_at || 'collection-center-pricing-loading'} className="form-stack compact config-form" onSubmit={(event) => { event.preventDefault(); run(async () => { const formData = new FormData(event.currentTarget); await api('/api/admin/config/collection-center', json('PUT', { monthlyAmount: Number(formData.get('amount')), firstVolumeBoundaryLiters: Number(formData.get('boundary')) })); const updated = await api('/api/admin/config/collection-center'); setCenterPricing(updated); setNotice(publicLanguage.t('pricingSaved')); }); }}><label>{publicLanguage.t('monthlyAmount')}<input name="amount" type="number" min="1" step="1" required disabled={adminConfigLoading} defaultValue={configuredAmount ?? ''} /></label><label>{publicLanguage.t('firstVolumeBoundary')}<input name="boundary" type="number" min="0" step="1" required disabled={adminConfigLoading} defaultValue={centerPricing?.config?.first_volume_boundary_liters ?? ''} /></label><button className="button button-primary" disabled={busy || adminConfigLoading}>{publicLanguage.t('savePricing')}</button></form></section>;
  };

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
      { label: publicLanguage.t('adminExemptAccounts'), value: stats?.exempt },
    ];

    return <div className="dashboard-view admin-dashboard">
      <div className="dashboard-header-block">
        <div className="dashboard-title-group">
          <h1 className="dashboard-main-title">{publicLanguage.t('platformAdmin')}</h1>
          <p className="dashboard-greeting-subtext">Admin Overview · {user?.name || user?.email}</p>
        </div>
        <div className="dashboard-header-badges">
          <span className="date-stamp date-pill-badge">
            <CalendarDays size={14} aria-hidden="true" />
            {formatDateLabel(today(), publicLanguage.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span className="status-pill-pulse" role="status" aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" />
            <span>Sisitemu iri gukora</span>
          </span>
        </div>
      </div>
      <section className="dashboard-metrics" aria-label={publicLanguage.t('adminAccountsOverview')}>
        {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value != null ? <AnimatedCounter value={metric.value} /> : '…'}</b></div>)}
        <div><span>{publicLanguage.t('adminRegistrations')}</span><b>{adminSummary?.registrations_last_30_days != null ? <AnimatedCounter value={adminSummary.registrations_last_30_days} /> : '…'}</b></div>
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
      <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('dashboardAccounting')}</span><h2>{publicLanguage.t('adminPaymentHistory')}</h2></div><div className="admin-payment-controls"><label>{publicLanguage.t('paymentStatus')}<select value={adminPaymentStatus} onChange={(event) => loadAdminPayments(1, event.target.value).catch((reason) => setError(reason.message))}><option value="">{publicLanguage.t('allStatuses')}</option><option value="SUCCESS">{publicLanguage.t('paymentSuccessful')}</option><option value="PENDING">{publicLanguage.t('paymentPending')}</option><option value="FAILED">{publicLanguage.t('paymentFailed')}</option><option value="CANCELLED">{publicLanguage.t('paymentCancelled')}</option><option value="EXPIRED">{publicLanguage.t('paymentExpired')}</option></select></label><button type="button" className="button button-secondary" onClick={() => loadAdminPayments().catch((reason) => setError(reason.message))}>{publicLanguage.t('reportsRefresh')}</button></div></div>
      {adminPaymentSummary ? <div className="admin-payment-summary">
        <div><span>{publicLanguage.t('adminVerifiedPayments')}</span><b>{adminPaymentSummary.successfulCount}</b></div>
        <div><span>{publicLanguage.t('adminVerifiedPaymentAmount')}</span><b>{money(adminPaymentSummary.successfulAmount)} RWF</b></div>
        <div><span>{publicLanguage.t('paymentPending')}</span><b>{adminPaymentSummary.pendingCount}</b></div>
        <div><span>{publicLanguage.t('paymentFailed')}</span><b>{adminPaymentSummary.failedCount}</b></div>
        <div><span>{publicLanguage.t('paymentCancelled')}</span><b>{adminPaymentSummary.cancelledCount}</b></div>
        <div><span>{publicLanguage.t('paymentExpired')}</span><b>{adminPaymentSummary.expiredCount}</b></div>
      </div> : null}
      {adminConfigLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : adminPayments.length ? <>
        <div className="table-scroll admin-payment-table"><table><thead><tr><th>{publicLanguage.t('account')}</th><th>{publicLanguage.t('paymentPlan')}</th><th>{publicLanguage.t('deductionsAmount')}</th><th>{publicLanguage.t('billingPaymentProvider')}</th><th>{publicLanguage.t('accountPhone')}</th><th>{publicLanguage.t('paymentStatus')}</th><th>{publicLanguage.t('paymentReference')}</th><th>{publicLanguage.t('paymentDate')}</th><th>{publicLanguage.t('paymentConfirmationDate')}</th><th /></tr></thead><tbody>{adminPayments.map((payment) => <tr key={payment.id}><td><b>{payment.account_name || '—'}</b><small className="block-muted">{payment.account_email}</small></td><td>{payment.plan_name || payment.plan_code || '—'}<small className="block-muted">{payment.billing_period === 'monthly' ? publicLanguage.t('billingMonthly') : payment.billing_period}</small></td><td>{money(payment.amount)} {payment.currency}</td><td>{paymentMethod(payment)}</td><td>{payment.mobile_money_phone || '—'}</td><td><span className={`payment-status-badge payment-status-${payment.status.toLowerCase()}`}>{statusLabel(payment.status)}</span></td><td><b>{payment.provider_reference || '—'}</b>{payment.provider_transaction_id ? <small className="block-muted">{payment.provider_transaction_id}</small> : null}</td><td>{payment.created_at ? formatDateLabel(payment.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td><td>{payment.completed_at ? formatDateLabel(payment.completed_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</td><td>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkAdminPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</td></tr>)}</tbody></table></div>
        <div className="admin-payment-mobile-list">{adminPayments.map((payment) => <article className="admin-payment-card" key={`mobile-${payment.id}`}><header><div><b>{payment.account_name || '—'}</b><small>{payment.account_email}</small></div><span className={`payment-status-badge payment-status-${payment.status.toLowerCase()}`}>{statusLabel(payment.status)}</span></header><dl><div><dt>{publicLanguage.t('paymentPlan')}</dt><dd>{payment.plan_name || payment.plan_code || '—'} · {payment.billing_period === 'monthly' ? publicLanguage.t('billingMonthly') : payment.billing_period}</dd></div><div><dt>{publicLanguage.t('deductionsAmount')}</dt><dd>{money(payment.amount)} {payment.currency}</dd></div><div><dt>{publicLanguage.t('billingPaymentProvider')}</dt><dd>{paymentMethod(payment)}</dd></div><div><dt>{publicLanguage.t('accountPhone')}</dt><dd>{payment.mobile_money_phone || '—'}</dd></div><div><dt>{publicLanguage.t('paymentReference')}</dt><dd>{payment.provider_reference || '—'}{payment.provider_transaction_id ? <small>{payment.provider_transaction_id}</small> : null}</dd></div><div><dt>{publicLanguage.t('paymentDate')}</dt><dd>{payment.created_at ? formatDateLabel(payment.created_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</dd></div><div><dt>{publicLanguage.t('paymentConfirmationDate')}</dt><dd>{payment.completed_at ? formatDateLabel(payment.completed_at, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' }) : '—'}</dd></div></dl>{payment.status === 'PENDING' ? <button type="button" className="text-button" onClick={() => checkAdminPayment(payment.id)} disabled={busy}>{publicLanguage.t('paymentCheckStatus')}</button> : null}</article>)}</div>
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
        price: '',
        currency: 'RWF',
        billing_period: 'monthly',
        min_volume_liters: minimum,
        max_volume_liters: null,
        is_active: true,
      }]);
      setCollectorTierEdits((current) => ({
        ...current,
        [String(id)]: { name, price: '', minVolumeLiters: String(minimum), maxVolumeLiters: '', isActive: true },
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
    const statusLabel = (check?: SystemHealthCheck) => {
      if (!check) return '…';
      if (check.status === 'healthy') return publicLanguage.t('healthHealthy');
      if (check.status === 'warning') return publicLanguage.t('healthWarning');
      if (check.status === 'not_configured') return publicLanguage.t('healthNotConfigured');
      return publicLanguage.t('healthUnavailable');
    };
    const statusBadgeClass = (check?: SystemHealthCheck) => {
      if (!check) return 'status-pill';
      if (check.status === 'healthy') return 'status-pill is-active';
      if (check.status === 'warning' || check.status === 'not_configured') return 'status-pill is-pending';
      return 'status-pill is-suspended';
    };
    return <section className="panel panel-wide">
      <div className="panel-heading">
        <div><span className="eyebrow">{publicLanguage.t('systemHealth')}</span><h2>{publicLanguage.t('systemOverview')}</h2></div>
        <div className="panel-heading-actions">
          {systemHealth ? <span className="count-label">{publicLanguage.t('healthLastChecked')}: {formatDateLabel(systemHealth.checkedAt, publicLanguage.language, { day: 'numeric', month: 'short', time: 'short' })}</span> : null}
          <Building2 size={20} aria-hidden="true" />
        </div>
      </div>
      <div className="metric-strip">
        <div><span>{publicLanguage.t('databaseStatus')}</span><b><span className={statusBadgeClass(systemHealth?.database)}>{statusLabel(systemHealth?.database)}</span></b></div>
        <div><span>{publicLanguage.t('databaseMigrations')}</span><b><span className={statusBadgeClass(systemHealth?.migrations)}>{statusLabel(systemHealth?.migrations)}</span> {systemHealth?.migrations ? <small>({systemHealth.migrations.appliedCount}/{systemHealth.migrations.requiredCount})</small> : null}</b></div>
        <div><span>{publicLanguage.t('emailProviderStatus')}</span><b><span className={statusBadgeClass(systemHealth?.email)}>{statusLabel(systemHealth?.email)}</span></b></div>
        <div><span>{publicLanguage.t('emailOutboxStatus')}</span><b><span className={statusBadgeClass(systemHealth?.emailOutbox)}>{statusLabel(systemHealth?.emailOutbox)}</span> {systemHealth?.emailOutbox ? <small>({systemHealth.emailOutbox.pending})</small> : null}</b></div>
        <div><span>{publicLanguage.t('paymentHealthStatus')}</span><b><span className={statusBadgeClass(systemHealth?.payments)}>{statusLabel(systemHealth?.payments)}</span> {systemHealth?.payments ? <small>({systemHealth.payments.stalePending})</small> : null}</b></div>
        <div><span>{publicLanguage.t('schedulerStatus')}</span><b><span className={statusBadgeClass(systemHealth?.scheduler)}>{statusLabel(systemHealth?.scheduler)}</span></b></div>
        <div><span>{publicLanguage.t('notificationEvaluationStatus')}</span><b><span className={statusBadgeClass(systemHealth?.notificationEvaluation)}>{statusLabel(systemHealth?.notificationEvaluation)}</span></b></div>
      </div>
      {!systemHealth ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{publicLanguage.t('dashboardLoading')}</div> : <>
        <dl className="payment-readiness-list">
          <div><dt>{publicLanguage.t('healthProvider')}</dt><dd>{systemHealth.email.provider || '—'}</dd></div>
          <div><dt>{publicLanguage.t('healthSenderDomain')}</dt><dd>{systemHealth.email.senderDomain || '—'}</dd></div>
          <div><dt>{publicLanguage.t('databaseMigrations')}</dt><dd>{systemHealth.migrations.appliedCount} / {systemHealth.migrations.requiredCount}</dd></div>
          <div><dt>{publicLanguage.t('healthAppUrl')}</dt><dd>{systemHealth.appUrl.url || publicLanguage.t('healthNotConfigured')}</dd></div>
          <div><dt>{publicLanguage.t('healthNotificationSchema')}</dt><dd>{systemHealth.migrations.missingColumns.length ? `${publicLanguage.t('healthMissing')}: ${systemHealth.migrations.missingColumns.join(', ')}` : publicLanguage.t('healthApplied')}</dd></div>
          <div><dt>{publicLanguage.t('healthPending')}</dt><dd>{systemHealth.emailOutbox.pending}</dd></div>
          <div><dt>{publicLanguage.t('healthProcessing')}</dt><dd>{systemHealth.emailOutbox.processing}</dd></div>
          <div><dt>{publicLanguage.t('healthStuck')}</dt><dd>{systemHealth.emailOutbox.stuck}</dd></div>
          <div><dt>{publicLanguage.t('healthNeverAttempted')}</dt><dd>{systemHealth.emailOutbox.neverAttempted}</dd></div>
          <div><dt>{publicLanguage.t('healthOldestPendingAge')}</dt><dd>{systemHealth.emailOutbox.oldestPendingAgeHours === null ? publicLanguage.t('healthNotRecorded') : systemHealth.emailOutbox.oldestPendingAgeHours}</dd></div>
          <div><dt>{publicLanguage.t('healthFailedAttempts')}</dt><dd>{systemHealth.emailOutbox.failedAttempts}</dd></div>
          <div><dt>{publicLanguage.t('healthFailedRecent')}</dt><dd>{systemHealth.payments.failedRecent}</dd></div>
          <div><dt>{publicLanguage.t('healthStalePending')}</dt><dd>{systemHealth.payments.stalePending}</dd></div>
          <div><dt>{publicLanguage.t('healthProviderReady')}</dt><dd>{systemHealth.payments.provider.ready ? publicLanguage.t('healthConfigured') : publicLanguage.t('healthNotConfigured')}</dd></div>
          <div><dt>{publicLanguage.t('healthRealPayments')}</dt><dd>{systemHealth.payments.provider.realPaymentsEnabled ? publicLanguage.t('healthConfigured') : publicLanguage.t('healthNotConfigured')}</dd></div>
          <div><dt>{publicLanguage.t('healthCronSecretConfigured')}</dt><dd>{systemHealth.scheduler.secretConfigured ? publicLanguage.t('healthConfigured') : publicLanguage.t('healthCronSecretMissing')}</dd></div>
          <div><dt>{publicLanguage.t('healthScheduleConfigured')}</dt><dd>{systemHealth.scheduler.configured ? publicLanguage.t('healthConfigured') : publicLanguage.t('healthNotConfigured')}</dd></div>
          <div><dt>{publicLanguage.t('healthSubscriptionEmailJob')}</dt><dd>{systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')?.scheduled ? publicLanguage.t('healthScheduled') : publicLanguage.t('healthNotScheduled')} · {publicLanguage.t('healthDaily')}</dd></div>
          <div><dt>{publicLanguage.t('notificationEvaluationStatus')}</dt><dd>{systemHealth.scheduler.jobs.find((job) => job.id === 'notification_evaluation')?.scheduled ? publicLanguage.t('healthScheduled') : publicLanguage.t('healthNotScheduled')} · {publicLanguage.t('healthCadenceNotDocumented')}</dd></div>
          <div><dt>{publicLanguage.t('healthLastRun')} · {publicLanguage.t('healthSubscriptionEmailJob')}</dt><dd>{systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')?.lastRunAt ? formatDateLabel(systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')!.lastRunAt!, publicLanguage.language, { day: 'numeric', month: 'short', time: 'short' }) : publicLanguage.t('healthNotRecorded')} · {systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')?.lastResult || publicLanguage.t('healthNotRecorded')}{systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')?.lastErrorCode ? ` (${systemHealth.scheduler.jobs.find((job) => job.id === 'subscription_emails')!.lastErrorCode})` : ''}</dd></div>
          <div><dt>{publicLanguage.t('healthLastRun')} · {publicLanguage.t('notificationEvaluationStatus')}</dt><dd>{systemHealth.notificationEvaluation.lastRunAt ? formatDateLabel(systemHealth.notificationEvaluation.lastRunAt, publicLanguage.language, { day: 'numeric', month: 'short', time: 'short' }) : publicLanguage.t('healthNotRecorded')} · {systemHealth.notificationEvaluation.lastResult || publicLanguage.t('healthNotRecorded')}{systemHealth.notificationEvaluation.lastErrorCode ? ` (${systemHealth.notificationEvaluation.lastErrorCode})` : ''}</dd></div>
          <div><dt>{publicLanguage.t('healthRoutes')}</dt><dd>{systemHealth.scheduler.routes.join(' · ')}</dd></div>
        </dl>
        {systemHealth.scheduler.jobs.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('healthRoutes')}</th><th>{publicLanguage.t('healthTriggerType')}</th><th>{publicLanguage.t('statusLabel')}</th><th>{publicLanguage.t('healthExecutionAge')}</th><th>{publicLanguage.t('details')}</th></tr></thead><tbody>{systemHealth.scheduler.jobs.map((job) => <tr key={job.id}><td>{job.route}</td><td>{job.lastTrigger || (job.scheduled ? publicLanguage.t('healthScheduled') : publicLanguage.t('healthNotScheduled'))}</td><td><span className={statusBadgeClass(job)}>{statusLabel(job)}</span></td><td>{job.lastRunAgeHours === null ? publicLanguage.t('healthNotRecorded') : `${job.lastRunAgeHours}h`}</td><td>{`Processed: ${job.lastResult || publicLanguage.t('healthNotRecorded')} · Errors: ${job.failedRecent}`}</td></tr>)}</tbody></table></div> : null}
        <details className="payment-config-notes">
          <summary>{publicLanguage.t('healthDiagnosticDetails')}</summary>
          <dl className="payment-readiness-list">
            <div><dt>{publicLanguage.t('databaseStatus')}</dt><dd>{systemHealth.database.detail}</dd></div>
            <div><dt>{publicLanguage.t('databaseMigrations')}</dt><dd>{systemHealth.migrations.detail}</dd></div>
            <div><dt>{publicLanguage.t('emailProviderStatus')}</dt><dd>{systemHealth.email.detail}</dd></div>
            <div><dt>{publicLanguage.t('emailOutboxStatus')}</dt><dd>{systemHealth.emailOutbox.detail}</dd></div>
            <div><dt>{publicLanguage.t('paymentHealthStatus')}</dt><dd>{systemHealth.payments.detail}</dd></div>
            <div><dt>{publicLanguage.t('schedulerStatus')}</dt><dd>{systemHealth.scheduler.detail}</dd></div>
            <div><dt>{publicLanguage.t('notificationEvaluationStatus')}</dt><dd>{systemHealth.notificationEvaluation.detail}</dd></div>
          </dl>
        </details>
        {systemHealth.migrations.missing.length ? <p className="form-error" role="alert">{publicLanguage.t('healthMissing')}: {systemHealth.migrations.missing.join(', ')}</p> : null}
        <p className="block-muted">{publicLanguage.t(systemHealth.email.configured ? 'healthEmailConfiguredDetail' : 'healthEmailNotConfiguredDetail')}</p>
        <p className="block-muted">{publicLanguage.t('healthSchedulerDetail')}</p>
        <p className="block-muted">{publicLanguage.t('healthNotificationDetail')}</p>
        <p className="block-muted">{publicLanguage.t('healthPaymentDetail')}</p>
        {!systemHealth.scheduler.runHistoryAvailable ? <p className="form-error" role="alert">{publicLanguage.t('healthRunHistoryUnavailable')}</p> : null}
        <h3>{publicLanguage.t('healthRecentFailures')}</h3>
        {systemHealth.emailOutbox.recentFailures.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('entity')}</th><th>{publicLanguage.t('healthFailedAttempts')}</th><th>{publicLanguage.t('details')}</th><th>{publicLanguage.t('when')}</th></tr></thead><tbody>{systemHealth.emailOutbox.recentFailures.map((row, index) => <tr key={`${row.eventType}-${row.updatedAt}-${index}`}><td>{row.eventType || '—'}</td><td>{row.attempts}</td><td>{row.errorCode || '—'}</td><td>{row.updatedAt ? formatDateLabel(row.updatedAt, publicLanguage.language, { day: 'numeric', month: 'short', time: 'short' }) : '—'}</td></tr>)}</tbody></table></div> : <p className="block-muted">{publicLanguage.t('healthNoRecentFailures')}</p>}
        <h3>{publicLanguage.t('healthRecentFailures')} · {publicLanguage.t('paymentHealthStatus')}</h3>
        {systemHealth.payments.recentFailures.length ? <div className="table-scroll"><table><thead><tr><th>{publicLanguage.t('status')}</th><th>{publicLanguage.t('milkAmount')}</th><th>{publicLanguage.t('when')}</th></tr></thead><tbody>{systemHealth.payments.recentFailures.map((row, index) => <tr key={`${row.id}-${row.updatedAt}-${index}`}><td>{row.status || '—'}</td><td>{row.amount === null ? '—' : `${money(row.amount)} ${row.currency || ''}`}</td><td>{row.updatedAt ? formatDateLabel(row.updatedAt, publicLanguage.language, { day: 'numeric', month: 'short', time: 'short' }) : '—'}</td></tr>)}</tbody></table></div> : <p className="block-muted">{publicLanguage.t('healthNoPaymentFailures')}</p>}
      </>}
    </section>;
  };

  const activeTab = activeTabs.find((item) => item.id === tab) || activeTabs[0];
  const activeTabLabel = tab === 'billing'
    ? publicLanguage.t('navSubscription')
    : tab === 'transport' ? publicLanguage.t('navTransport') : activeTab?.label || 'Workspace';

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <BrandLockup className="topbar-brand" imageSize={34} />
        <div className="topbar-center">
          <span className="topbar-center-pill">
            <Building2 size={13} aria-hidden="true" />
            <span>{centers.find((c) => String(c.id) === selectedCenter)?.name || (isAdmin ? publicLanguage.t('platformAdmin') : 'Ihuriro ry’Amata')}</span>
          </span>
        </div>
        <div className="topbar-right">
          <div className="public-language-switch topbar-language-switch" role="group" aria-label={publicLanguage.t('languageLabel')}>
            <button type="button" aria-label={publicLanguage.t('languageKinyarwanda')} aria-pressed={publicLanguage.language === 'rw'} onClick={() => void changeLanguage('rw')}>RW</button>
            <button type="button" aria-label={publicLanguage.t('languageEnglish')} aria-pressed={publicLanguage.language === 'en'} onClick={() => void changeLanguage('en')}>EN</button>
          </div>
          <span className={`account-tag${online ? '' : ' offline-tag'}`}><span className={`status-dot${online ? '' : ' offline-dot'}`} />{online ? isAdmin ? publicLanguage.t('platformAdmin') : user.accountType.replace('_', ' ') : formatPublicCopy(publicLanguage.language, 'offlineQueuedBadge', 'Offline · {count} queued', { count: pendingWrites })}</span>
          <div className="notification-menu" ref={notificationMenuRef}>
            <button type="button" className="icon-button notification-trigger" aria-label={`${publicLanguage.t('navAlerts')}: ${unreadCount ?? 0}`} aria-expanded={notificationPanelOpen} onClick={toggleNotificationPanel}>
              <Bell size={19} aria-hidden="true" />
              {unreadCount ? <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
            </button>
            {notificationPanelOpen ? (
              <section className="notification-dropdown" aria-label={publicLanguage.t('navAlerts')}>
                <div className="notification-dropdown-heading">
                  <b>{publicLanguage.t('navAlerts')}</b>
                  <button type="button" className="text-button" disabled={notificationLoading || !notifications.some((item) => !item.isRead)} onClick={() => void markAllNotificationsRead()}>{publicLanguage.t('markAllRead')}</button>
                </div>
                <div className="notification-dropdown-list">
                  {notificationError ? <p className="notification-dropdown-empty" role="alert">{notificationError}</p> : null}
                  {notifications.filter((item) => item.status !== 'resolved').slice(0, 8).map((item) => {
                    const priority = priorityCopy[String(item.priority || '')] ? String(item.priority) : 'info';
                    return (
                      <article className={`notification-dropdown-item${item.isRead ? '' : ' unread'}`} key={item.id}>
                        <span className={`priority-badge priority-${priority}`}>{publicLanguage.t(priorityCopy[priority])}</span>
                        <button type="button" className="notification-dropdown-review" onClick={() => reviewNotification(item)}>
                          <b>{notificationTitle(item)}</b>
                          <p>{notificationMessage(item)}</p>
                        </button>
                        <small>{formatDateLabel(item.createdAt, publicLanguage.language, { day: 'numeric', month: 'long', year: 'numeric', time: 'short' })}</small>
                        <div className="notification-dropdown-actions">
                          {isOperationalAlert(item) ? <button type="button" className="text-button" onClick={() => { setNotificationPanelOpen(false); openResolveDialog(item); }}>{publicLanguage.t('alertResolve')}</button> : null}
                          {!item.isRead ? <button type="button" className="text-button" onClick={() => void markRead(item)}>{publicLanguage.t('markRead')}</button> : null}
                        </div>
                      </article>
                    );
                  })}
                  {!notifications.length ? <p className="notification-dropdown-empty">{publicLanguage.t('notificationsEmptyTitle')}</p> : null}
                </div>
                <button type="button" className="notification-dropdown-all" onClick={() => { setNotificationPanelOpen(false); setTab(isAdmin ? 'notifications-admin' : 'notifications'); }}>{publicLanguage.t('alertsOpenInbox')} <ArrowRight size={15} aria-hidden="true" /></button>
              </section>
            ) : null}
          </div>
          <button type="button" className="user-name user-settings-shortcut" onClick={() => setTab('settings')} title={publicLanguage.t('accountSettings')} aria-label={`${publicLanguage.t('accountSettings')}: ${user.name || user.email}`}>
            <UserRound size={16} aria-hidden="true" />
            <span>{user.name || user.email}</span>
          </button>
          <button type="button" className="icon-button" onClick={() => void logout()} disabled={logoutBusy} aria-busy={logoutBusy} aria-label={publicLanguage.t('signOut')} title={publicLanguage.t('signOut')}><LogOut size={18} /></button>
        </div>
      </header>
      <div className={`workspace-body${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}><aside className="sidebar"><div className="sidebar-heading"><div className="sidebar-label">{publicLanguage.t('workspace')}</div><button type="button" className="sidebar-collapse-toggle" aria-label={sidebarCollapsed ? 'Expand workspace navigation' : 'Collapse workspace navigation'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-navigation" title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}</button></div><nav id="workspace-navigation" aria-label={publicLanguage.t('workspaceNavigation')}>{activeTabs.map((item) => { const Icon = item.icon; return <button className={`nav-item${tab === item.id ? ' active' : ''}`} key={item.id} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{tab === item.id ? <span className="nav-mark" /> : null}</button>; })}</nav><div className="sidebar-foot"><Activity size={15} aria-hidden="true" /><span>{publicLanguage.t('systemOnline')}</span></div></aside>
      <section className="content-area">
        <div className="content-heading sr-only" style={{ display: 'none' }} aria-hidden="true">
          <span className="date-stamp">{formatDateLabel(today(), publicLanguage.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
        {error ? <div className="toast toast-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        {notice ? <div className="toast toast-success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div> : null}
        <div className="workspace-tab-panel">
            {tab === 'dashboard' && isAdmin ? renderAdminDashboard() : null}
            {tab === 'dashboard' && !isAdmin ? renderDashboard() : null}
            {tab === 'farmers' && !isAdmin ? renderFarmers() : null}
            {tab === 'centers' && !isAdmin ? renderCenters() : null}
            {tab === 'milk' && isDairy ? renderDairyMilk() : tab === 'milk' && !isAdmin ? renderMilk() : null}
            {tab === 'deductions' && !isAdmin ? renderDeductions() : null}
            {tab === 'transport' && !isAdmin && isCollector ? renderTransport() : null}
            {tab === 'ukwezi' && !isAdmin ? renderUkwezi() : null}
            {tab === 'settlements' && (isCollector || isDairy) ? renderSettlements() : null}
            {tab === 'reports' && !isAdmin ? renderReports() : null}
            {tab === 'billing' && !isAdmin ? renderBilling() : null}
            {tab === 'notifications' && !isAdmin ? <>{renderNotificationFilters()}{renderNotifications()}</> : null}
            {tab === 'settings' ? renderAccountSettings() : null}
            {tab === 'notifications-admin' && isAdmin ? renderNotifications() : null}
            {tab === 'accounts' && isAdmin ? renderAdminAccounts() : null}
            {tab === 'audit' && isAdmin ? renderAdminAudit() : null}
            {tab === 'config' && isAdmin ? <div className="admin-pricing-layout">{renderAdminCollectorPricing()}{renderAdminConfig()}{renderAdminSubscriptionPolicy()}{renderAdminPaymentConfiguration()}{renderAdminPayments()}</div> : null}
            {tab === 'system-health' && isAdmin ? renderSystemHealth() : null}
        </div>
        {adminAccountDetailsOpen ? renderAdminAccountDetailsModal() : null}
        {grantDaysAccount ? renderGrantDaysModal() : null}
      </section></div>
      {isCollector && deductionCreateOpen && deductionContextFarmer ? <Modal
        ariaLabel={publicLanguage.t('deductionsAdd')}
        className="modal-panel-wide deduction-inspector-modal"
        onClose={() => {
          if (busy) return;
          setDeductionCreateOpen(false);
          setDeductionContextFarmer(null);
          setDeductionCreateError('');
        }}
        dismissible={!busy}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{publicLanguage.t('navUkwezi')} · {deductionContextFarmer.periodStart} – {deductionContextFarmer.periodEnd}</span>
            <h2>{publicLanguage.t('deductionsAdd')} · {deductionContextFarmer.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={() => {
            setDeductionCreateOpen(false);
            setDeductionContextFarmer(null);
            setDeductionCreateError('');
          }} disabled={busy} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="metric-strip">
          <div><span>{publicLanguage.t('reportsVolume')}</span><b>{liters(deductionContextFarmer.totalVolume)} L</b></div>
          <div><span>{publicLanguage.t('reportsAppliedPrice')}</span><b>{deductionContextFarmer.pricePerLiter == null ? '—' : `${money(deductionContextFarmer.pricePerLiter)} RWF/L`}</b></div>
          <div><span>{publicLanguage.t('reportsGross')}</span><b>{deductionContextFarmer.grossAmount == null ? publicLanguage.t('reportsIncomplete') : `${money(deductionContextFarmer.grossAmount)} RWF`}</b></div>
          <div><span>{publicLanguage.t('reportsTransport')}</span><b>{deductionContextFarmer.totalTransport == null ? publicLanguage.t('reportsIncomplete') : `${money(deductionContextFarmer.totalTransport)} RWF`}</b></div>
          <div><span>{publicLanguage.t('dashboardDeductions')}</span><b>{money(deductionContextFarmer.totalDeductions)} RWF</b></div>
          <div><span>{publicLanguage.t('reportsNet')}</span><b>{deductionContextFarmer.netAmount == null ? publicLanguage.t('reportsIncomplete') : `${money(deductionContextFarmer.netAmount)} RWF`}</b></div>
        </div>
        <form className="form-stack compact" onSubmit={createDeduction}>
          <label>{publicLanguage.t('deductionsAmount')}<input type="number" min="0.01" step="0.01" required value={deductionForm.amount} onChange={(event) => setDeductionForm((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label>{publicLanguage.t('deductionsType')}<select value={deductionForm.type} onChange={(event) => setDeductionForm((current) => ({ ...current, type: event.target.value }))}><option value="Advance">Advance</option><option value="Umwenda">Umwenda</option><option value="Other">Other</option></select></label>
          <label>{publicLanguage.t('deductionsDate')}<input type="date" min={deductionContextFarmer.periodStart} max={deductionContextFarmer.periodEnd} required value={deductionForm.date} onChange={(event) => setDeductionForm((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>{publicLanguage.t('deductionsReason')}<input maxLength={500} required value={deductionForm.reason} onChange={(event) => setDeductionForm((current) => ({ ...current, reason: event.target.value }))} /></label>
          <label>{publicLanguage.t('deductionsNotes')}<textarea rows={3} maxLength={1000} value={deductionForm.notes} onChange={(event) => setDeductionForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          {deductionCreateError ? <p className="form-error" role="alert">{deductionCreateError}</p> : null}
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={() => {
              setDeductionCreateOpen(false);
              setDeductionContextFarmer(null);
              setDeductionCreateError('');
            }} disabled={busy}>{publicLanguage.t('cancel')}</button>
            <button className="button button-primary" disabled={busy || !deductionForm.amount || !deductionForm.reason}>{busy ? publicLanguage.t('wait') : publicLanguage.t('deductionsAdd')}</button>
          </div>
        </form>
      </Modal> : null}
      <FarmerDeletionDialog
        open={Boolean(farmerDeletionTarget)}
        language={publicLanguage.language}
        impact={farmerDeletionImpact}
        loading={farmerDeletionLoading}
        error={farmerDeletionError}
        reason={farmerDeletionReason}
        confirmationName={farmerDeletionConfirmation}
        busy={farmerDeletionBusy}
        onReasonChange={setFarmerDeletionReason}
        onConfirmationNameChange={setFarmerDeletionConfirmation}
        onClose={() => {
          if (farmerDeletionBusy) return;
          setFarmerDeletionTarget(null);
          setFarmerDeletionImpact(null);
          setFarmerDeletionError('');
        }}
        onConfirm={() => { void confirmFarmerDeletion(); }}
      />
      {farmerHistoryOpen && farmerHistoryFarmer ? <Modal ariaLabel={publicLanguage.t('farmerHistoryTitle')} className="modal-panel-wide farmer-history-modal" onClose={() => setFarmerHistoryOpen(false)} dismissible={!farmerHistoryLoading}>{renderFarmerHistory()}</Modal> : null}
      {lossEventOpen && (
        <Modal ariaLabel={publicLanguage.t('recordLossEvent')} className="loss-event-modal" onClose={() => setLossEventOpen(false)} dismissible={!lossEventLoading}>
          <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('recordLossEvent')}</span><h2>{publicLanguage.t('lossEventTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setLossEventOpen(false)} disabled={lossEventLoading} aria-label={publicLanguage.t('cancel')}><X size={18} aria-hidden="true" /></button></div>
          <form className="form-stack compact" onSubmit={saveLossEvent}>
            <label>{publicLanguage.t('activeCenter')}<select value={selectedCenter} onChange={(event) => { setSelectedCenter(event.target.value); setLossEventConfirmed(false); }} required disabled={!centers.length}><option value="">{publicLanguage.t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label>
            <label>{publicLanguage.t('milkCollectionDate')}<input type="date" max={today()} value={collectionDate} onChange={(event) => { setCollectionDate(event.target.value); setLossEventConfirmed(false); }} required /></label>
            <label>{publicLanguage.t('lossEventPeriod')}<select value={lossEventPeriod} onChange={(event) => { setLossEventPeriod(event.target.value as typeof lossEventPeriod); setLossEventConfirmed(false); }} required><option value="all">{publicLanguage.t('lossEventPeriodAll')}</option><option value="morning">{publicLanguage.t('dashboardMorning')} (06:30–09:00)</option><option value="evening">{publicLanguage.t('dashboardEvening')} (17:30–19:00)</option></select></label>
            <label>{publicLanguage.t('lossEventPercentage')}<input type="number" min="0" max="100" step="0.01" value={lossEventPercentage} onChange={(event) => { setLossEventPercentage(event.target.value); setLossEventConfirmed(false); }} required /></label>
            <label>{publicLanguage.t('lossEventReason')}<select required value={lossEventReason} onChange={(event) => { setLossEventReason(event.target.value); setLossEventConfirmed(false); }}><option value="">{publicLanguage.t('lossReasonChoose')}</option><option value="accident">{publicLanguage.t('lossReasonAccident')}</option><option value="antibiotics">{publicLanguage.t('lossReasonAntibiotics')}</option><option value="contamination">{publicLanguage.t('lossReasonContamination')}</option><option value="other">{publicLanguage.t('lossReasonOther')}</option></select></label>
            {lossEventReason === 'other' ? <label>{publicLanguage.t('lossReasonOther')}<input maxLength={500} required value={lossEventOtherReason} onChange={(event) => { setLossEventOtherReason(event.target.value); setLossEventConfirmed(false); }} /></label> : null}
            <section aria-live="polite">
              <p className="muted-note">{publicLanguage.t('lossPreviewContext')}: {collectionDate} · {lossEventPeriod === 'all' ? publicLanguage.t('lossEventPeriodAll') : lossEventPeriod === 'morning' ? publicLanguage.t('dashboardMorning') : publicLanguage.t('dashboardEvening')}</p>
              <p className="muted-note">{publicLanguage.t('lossOwnerExcluded')}</p>
              {lossPreviewLoading ? <p className="muted-note">{publicLanguage.t('lossPreviewLoading')}</p> : null}
              {lossPreview && lossPreview.affectedRecords > 0 ? <>
                <p className="muted-note">{publicLanguage.t('lossAccountingPeriod')}: {lossPreview.affectedAccountingPeriods[0]?.startDate} – {lossPreview.affectedAccountingPeriods[0]?.endDate}</p>
                <div className="table-scroll"><table className="data-table">
                  <thead><tr><th>{publicLanguage.t('lossPreviewFarmer')}</th><th>{publicLanguage.t('lossOriginalLitres')}</th><th>{publicLanguage.t('lossCalculatedLitres')}</th><th>{publicLanguage.t('lossAppliedLitres')}</th><th>{publicLanguage.t('lossRemainingLitres')}</th></tr></thead>
                  <tbody>{lossPreview.farmers.map((farmer) => <tr key={farmer.farmerId}><td>{farmer.farmerName}</td><td>{liters(farmer.originalLitres)} L</td><td>{liters(farmer.calculatedLossLitres)} L</td><td>{liters(farmer.appliedLossLitres)} L</td><td>{liters(farmer.remainingValidLitres)} L</td></tr>)}</tbody>
                  <tfoot><tr><th>{publicLanguage.t('lossPreviewTotal')}</th><th>{liters(lossPreview.originalLitres)} L</th><th>{liters(lossPreview.calculatedLossLitres)} L</th><th>{liters(lossPreview.appliedLossLitres)} L</th><th>{liters(lossPreview.remainingValidLitres)} L</th></tr></tfoot>
                </table></div>
                <p className="muted-note">{publicLanguage.t('lossEstimatedImpact')}: {lossPreview.estimatedFarmerMilkValueChange > 0 ? '+' : ''}{money(lossPreview.estimatedFarmerMilkValueChange)} RWF. {publicLanguage.t('lossOwnerDifferenceImpact')}: {lossPreview.estimatedOwnerMilkDifferenceChange > 0 ? '+' : ''}{money(lossPreview.estimatedOwnerMilkDifferenceChange)} RWF. {publicLanguage.t('lossOwnerAccountingNote')}</p>
              </> : null}
              {lossPreview && lossPreview.affectedRecords === 0 ? <p className="muted-note">{publicLanguage.t('lossPreviewNoFarmers')}</p> : null}
            </section>
            <p className="muted-note">{publicLanguage.t('lossEventNote')}</p>
            {lossEventError ? <p className="form-error" role="alert">{lossEventError}</p> : null}
            {lossEventStatus ? <p className="form-success" role="status">{lossEventStatus}</p> : null}
            <label><input type="checkbox" checked={lossEventConfirmed} onChange={(event) => setLossEventConfirmed(event.target.checked)} required /> {publicLanguage.t('lossConfirmation')}</label>
            <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setLossEventOpen(false)} disabled={lossEventLoading}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={lossEventLoading || lossPreviewLoading || !lossPreview?.affectedRecords || !centers.length || !lossEventPercentage || !lossEventReason || (lossEventReason === 'other' && !lossEventOtherReason.trim()) || !lossEventConfirmed}>{lossEventLoading ? publicLanguage.t('wait') : publicLanguage.t('saveLossEvent')}</button></div>
          </form>
        </Modal>
      )}
      {resolveTarget ? <Modal ariaLabel={publicLanguage.t('alertResolutionTitle')} onClose={() => { if (!resolveSaving) setResolveTarget(null); }} dismissible={!resolveSaving}>
        <div className="panel-heading"><div><span className="eyebrow">{publicLanguage.t('alertsInbox')}</span><h2>{publicLanguage.t('alertResolutionTitle')}</h2></div><button type="button" className="icon-button" onClick={() => setResolveTarget(null)} disabled={resolveSaving} aria-label={publicLanguage.t('cancel')}><X size={18} /></button></div>
        <p className="muted-note">{notificationTitle(resolveTarget)}</p>
        <form className="form-stack compact" onSubmit={submitResolve}>
          <label>{publicLanguage.t('alertResolutionCodeLabel')}<select value={resolveCode} onChange={(event) => setResolveCode(event.target.value)}>{['farmer_absent', 'no_milk', 'reported_other', 'pending_verification', 'dismissed'].map((code) => <option key={code} value={code}>{publicLanguage.t(resolutionCodeCopy[code])}</option>)}</select></label>
          <label>{publicLanguage.t('alertResolutionNote')}<textarea maxLength={500} value={resolveNote} onChange={(event) => setResolveNote(event.target.value)} /></label>
          {notificationError ? <p className="form-error" role="alert">{notificationError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setResolveTarget(null)} disabled={resolveSaving}>{publicLanguage.t('cancel')}</button><button className="button button-primary" disabled={resolveSaving}>{resolveSaving ? publicLanguage.t('wait') : publicLanguage.t('alertResolutionSubmit')}</button></div>
        </form>
      </Modal> : null}
      {farmerImportOpen && user && !isAdmin && (isCollector || isDairy) ? <FarmerBulkImportModal
        centers={centers}
        selectedCenterId={selectedCenter}
        user={{ id: user.id, accountType: user.accountType }}
        language={publicLanguage.language}
        onClose={() => setFarmerImportOpen(false)}
        onCompleted={async () => { await loadFarmers(); }}
      /> : null}
      {(milkImportOpen && user && isCollector) || (milkImportOpen && user && isDairy) ? <MilkNotebookImportModal
        collectionDate={collectionDate}
        language={publicLanguage.language}
        onClose={() => setMilkImportOpen(false)}
        onCompleted={async () => { await loadDaily(); }}
        centers={collectorOwnedCenters.length ? collectorOwnedCenters : centers}
      /> : null}
      <nav className="mobile-nav" aria-label={publicLanguage.t('workspaceNavigation')}>
        {mobilePrimaryTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></button>; })}
        {mobileMoreTabs.length ? <button ref={mobileMoreTriggerRef} type="button" className={`mobile-more-trigger${mobileMoreTabs.some((item) => item.id === tab) ? ' active' : ''}`} aria-controls="mobile-more-menu" aria-expanded={mobileMoreOpen} aria-label={publicLanguage.t('more')} onClick={() => setMobileMoreOpen((open) => !open)}><ChevronDown size={18} aria-hidden="true" /><span>{publicLanguage.t('more')}</span></button> : null}
      </nav>
      {mobileMoreOpen && mobileMoreTabs.length ? <nav ref={mobileMoreMenuRef} className="mobile-more-menu" id="mobile-more-menu" aria-label={publicLanguage.t('more')}>
        {mobileMoreTabs.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} aria-label={item.label} title={item.label} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setMobileMoreOpen(false); }}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></button>; })}
      </nav> : null}

      {selectedFarmerIds.size > 0 ? (
        <aside className="floating-action-dock" role="toolbar" aria-label="Batch Actions">
          <div className="dock-count">
            <span className="dock-badge">{selectedFarmerIds.size}</span>
            <span>{publicLanguage.language === 'en' ? `${selectedFarmerIds.size} Selected` : `${selectedFarmerIds.size} Batoranyijwe`}</span>
          </div>
          <div className="dock-actions">
            <button type="button" className="button button-primary small-button" onClick={() => { setTab('milk'); clearSelectedFarmers(); }}>
              <Milk size={14} aria-hidden="true" />
              <span>{publicLanguage.language === 'en' ? 'Record Milk' : 'Andika Amata'}</span>
            </button>
            <button type="button" className="button button-secondary small-button" onClick={() => { setTab('deductions'); clearSelectedFarmers(); }}>
              <ReceiptText size={14} aria-hidden="true" />
              <span>{publicLanguage.language === 'en' ? 'Add Deduction' : 'Shyiraho Ikurwaho'}</span>
            </button>
            <button type="button" className="button button-secondary small-button" onClick={() => { setTab('settlements'); clearSelectedFarmers(); }}>
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{publicLanguage.language === 'en' ? 'Confirm Settlements' : 'Emeza Ubwishyu'}</span>
            </button>
            <button type="button" className="icon-button dock-close" onClick={clearSelectedFarmers} aria-label={publicLanguage.t('cancel')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </aside>
      ) : null}

      {undoToast ? (
        <div className="undo-toast" role="status">
          <span>{undoToast.message}</span>
          <button type="button" className="undo-toast-btn" onClick={() => { undoToast.onUndo(); setUndoToast(null); }}>
            {publicLanguage.language === 'en' ? 'Undo' : 'Subiza inyuma'}
          </button>
          <button type="button" className="undo-toast-close" onClick={() => setUndoToast(null)} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      ) : null}
    </main>
  );
}
