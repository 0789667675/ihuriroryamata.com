'use client';

import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Milk,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { ScrollReveal } from '@/components/ui/scroll-reveal';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
import type { PublicCopyKey } from '@/lib/i18n/public-copy';

type DashboardStatus = 'loading' | 'error' | 'unavailable' | 'available';

type DashboardAction = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type DashboardViewProps = {
  t: (key: PublicCopyKey) => string;
  dateLabel: string;
  isCollector: boolean;
  isDairy: boolean;
  canRecordMilk: boolean;
  farmersLabel: string;
  actions: DashboardAction[];
  onNavigate: (tab: string) => void;
  onOpenOwnerIfishi: () => void;
  onRetryDaily: () => void;
  onRetryOwnerMilk: () => void;
  onRetryReport: () => void;
  onRetryUnread: () => void;
  onRetrySubscription: () => void;
  daily: {
    status: DashboardStatus;
    error: string;
    totalVolume: number;
    totalMorning: number;
    totalEvening: number;
    presentCount: number;
    totalFarmers: number;
    centerLabel: string;
    periodLabel: string;
    recentRows: Array<{ id: number; farmerName: string; center: string; totalVolume: number }>;
  };
  ownerMilk: {
    status: 'loading' | 'available' | 'missing' | 'error';
    volumeMorning: number;
    volumeEvening: number;
    validVolumeLiters: number;
  };
  milkDifference: { difference: number; higherSide: string } | null;
  accounting: {
    status: DashboardStatus;
    error: string;
    gross: number | null;
    deductions: number | null;
    net: number | null;
    payable: number | null;
  };
  alerts: { status: DashboardStatus; count: number | null };
  subscription: { status: DashboardStatus; label: string };
  formatLiters: (value: number) => string;
  formatMoney: (value: number) => string;
};

const renderState = (
  status: DashboardStatus,
  loadingLabel: string,
  unavailableLabel: string,
  error?: string,
  retryLabel?: string,
  onRetry?: () => void,
) => {
  if (status === 'loading') {
    return <p className="dashboard-state" role="status"><span className="loading-indicator" />{loadingLabel}</p>;
  }
  if (status === 'error') {
    return <div className="dashboard-state dashboard-state-error" role="alert">
      <span>{error || unavailableLabel}</span>
      {onRetry ? <button type="button" className="button button-secondary small-button" onClick={onRetry}>{retryLabel}</button> : null}
    </div>;
  }
  if (status === 'unavailable') return <p className="dashboard-state">{unavailableLabel}</p>;
  return null;
};

export function DashboardView({
  t,
  dateLabel,
  isCollector,
  isDairy,
  canRecordMilk,
  farmersLabel,
  actions,
  onNavigate,
  onOpenOwnerIfishi,
  onRetryDaily,
  onRetryOwnerMilk,
  onRetryReport,
  onRetryUnread,
  onRetrySubscription,
  daily,
  ownerMilk,
  milkDifference,
  accounting,
  alerts,
  subscription,
  formatLiters,
  formatMoney,
}: DashboardViewProps) {
  const amountValue = (value: number | null) => value === null
    ? '—'
    : <><AnimatedCounter value={value} formatter={formatMoney} className="tabular-nums" /> RWF</>;
  const primaryAction = canRecordMilk ? (
    <button type="button" className="button button-primary small-button" onClick={() => onNavigate('milk')}>
      <Milk size={15} aria-hidden="true" />
      {t('dashboardEnterMilk')}
    </button>
  ) : undefined;

  return (
    <div className="dashboard-view">
      <WorkspacePageHeader
        eyebrow={t('dashboardToday')}
        title={t('navDashboard')}
        description={dateLabel}
        primaryAction={primaryAction}
        secondaryActions={isDairy ? [
          <button type="button" className="button button-secondary small-button" onClick={onOpenOwnerIfishi}>
            <BookOpen size={15} aria-hidden="true" />
            {t('ownerIfishiEnter')}
          </button>,
        ] : []}
      />

      <section className="dashboard-overview">
        <article className="dashboard-today" aria-labelledby="dashboard-milk-title">
          <div className="dashboard-today-heading">
            <div><span className="eyebrow">{t('dashboardToday')}</span><h2 id="dashboard-milk-title">{t('navMilk')}</h2></div>
            <Milk size={20} aria-hidden="true" />
          </div>
          {daily.status === 'available' ? <>
            <div className="dashboard-volume"><strong><AnimatedCounter value={daily.totalVolume} formatter={formatLiters} className="tabular-nums" /></strong><span>L</span></div>
            <div className="dashboard-split">
              <div><span>{t('dashboardMorning')}</span><b><AnimatedCounter value={daily.totalMorning} formatter={formatLiters} className="tabular-nums" /> L</b></div>
              <div><span>{t('dashboardEvening')}</span><b><AnimatedCounter value={daily.totalEvening} formatter={formatLiters} className="tabular-nums" /> L</b></div>
            </div>
          </> : renderState(daily.status, t('dashboardLoading'), daily.error || t('dashboardNoCenter'), daily.error, t('tryAgain'), onRetryDaily)}

          {isCollector && daily.status === 'available' ? <div className="dashboard-milk-reconciliation">
            <h3>{t('dashboardMilkComparison')}</h3>
            {ownerMilk.status === 'loading' ? <p role="status">{t('dashboardComparisonLoading')}</p> : <>
              <div><span>{t('dashboardFarmerMilk')}</span><b><AnimatedCounter value={daily.totalVolume} formatter={formatLiters} className="tabular-nums" /> L</b></div>
              <div><span>{t('dashboardOwnerMilk')}</span><b>{ownerMilk.status === 'available' ? <><AnimatedCounter value={ownerMilk.validVolumeLiters} formatter={formatLiters} className="tabular-nums" /> L</> : '—'}</b></div>
              <div><span>{t('dashboardMilkDifference')}</span><b>{milkDifference ? `${milkDifference.difference > 0 ? '+' : ''}${formatLiters(milkDifference.difference)} L` : '—'}</b></div>
              {ownerMilk.status === 'available' && milkDifference ? <small>{t(milkDifference.higherSide === 'owner' ? 'dashboardOwnerHigher' : milkDifference.higherSide === 'farmers' ? 'dashboardFarmersHigher' : 'dashboardMilkEqual')} · {t('dashboardMorning')} {formatLiters(ownerMilk.volumeMorning)} L · {t('dashboardEvening')} {formatLiters(ownerMilk.volumeEvening)} L</small> : null}
              {ownerMilk.status === 'missing' ? <p>{t('dashboardOwnerMilkMissing')}</p> : null}
              {ownerMilk.status === 'error' ? <div className="dashboard-reconciliation-error" role="alert"><p>{t('dashboardComparisonError')}</p><button type="button" className="button button-secondary small-button" onClick={onRetryOwnerMilk}>{t('tryAgain')}</button></div> : null}
            </>}</div> : null}
        </article>

        <section className="dashboard-quick panel" aria-labelledby="dashboard-actions-title">
          <div className="panel-heading"><h2 id="dashboard-actions-title">{t('dashboardActions')}</h2><ArrowUpRight size={19} aria-hidden="true" /></div>
          {actions.length ? <div className="dashboard-action-list">{actions.map((action) => {
            const Icon = action.icon;
            return <button type="button" key={action.id} onClick={() => onNavigate(action.id)}><Icon size={17} aria-hidden="true" /><span>{action.label}</span><ArrowRight size={15} aria-hidden="true" /></button>;
          })}</div> : <p className="dashboard-state">{t('dashboardNoActions')}</p>}
        </section>
      </section>

      <section className="dashboard-metrics" aria-label={t('dashboardToday')}>
        <button type="button" onClick={() => onNavigate('farmers')} disabled={daily.status !== 'available'}>
          <span>{farmersLabel}</span>
          <b>{daily.status === 'available' ? <span className="tabular-nums"><AnimatedCounter value={daily.presentCount} /> / <AnimatedCounter value={daily.totalFarmers} /></span> : daily.status === 'loading' ? t('dashboardLoading') : '—'}</b>
          <Users size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onNavigate('notifications')} disabled={alerts.status !== 'available'}>
          <span>{t('dashboardUnread')}</span>
          <b>{alerts.status === 'available' ? <AnimatedCounter value={alerts.count} fallback="—" className="tabular-nums" /> : alerts.status === 'loading' ? t('dashboardLoading') : '—'}</b>
          <Bell size={17} aria-hidden="true" />
        </button>
      </section>
      <div className="dashboard-context-row">
        {daily.centerLabel ? <span><b>{t('dashboardCenter')}</b>{daily.centerLabel}</span> : null}
        {daily.periodLabel ? <span><b>{t('dashboardPeriod')}</b>{daily.periodLabel}</span> : null}
      </div>

      <section className="dashboard-lower">
        <ScrollReveal className="dashboard-reveal">
          <section className="panel dashboard-activity" aria-labelledby="dashboard-recent-title">
            <div className="panel-heading"><div><span className="eyebrow">{t('dashboardToday')}</span><h2 id="dashboard-recent-title">{t('dashboardRecent')}</h2></div><button type="button" className="dashboard-text-link" onClick={() => onNavigate('milk')}>{t('navMilk')} <ArrowRight size={14} /></button></div>
            {daily.status !== 'available' ? renderState(daily.status, t('dashboardLoading'), daily.error || t('dashboardNoCenter'), daily.error, t('tryAgain'), onRetryDaily)
              : daily.recentRows.length ? <div className="dashboard-activity-list">{daily.recentRows.map((row) => <div className="dashboard-activity-row" key={row.id}><span className="dashboard-activity-icon"><Milk size={16} aria-hidden="true" /></span><div><b>{row.farmerName}</b><small>{row.center}</small></div><strong>{formatLiters(row.totalVolume)} L</strong></div>)}</div>
                : <div className="dashboard-empty-state"><Milk size={18} aria-hidden="true" /><p>{t('dashboardNoActivity')}</p></div>}
          </section>
        </ScrollReveal>

        <div className="dashboard-side">
          <ScrollReveal className="dashboard-reveal">
            <section className="panel dashboard-accounting" aria-labelledby="dashboard-accounting-title">
              <div className="panel-heading"><div><span className="eyebrow">{t('dashboardPeriod')}</span><h2 id="dashboard-accounting-title">{t('dashboardAccounting')}</h2></div><Wallet size={19} aria-hidden="true" /></div>
              {accounting.status !== 'available' ? renderState(accounting.status, t('dashboardLoading'), t('dashboardUnavailable'), accounting.error || t('dashboardUnavailable'), t('tryAgain'), onRetryReport) : <dl>
                <div><dt>{t('reportsGross')}</dt><dd>{amountValue(accounting.gross)}</dd></div>
                <div><dt>{t('dashboardDeductions')}</dt><dd>{amountValue(accounting.deductions)}</dd></div>
                <div><dt>{t('dashboardNet')}</dt><dd>{amountValue(accounting.net)}</dd></div>
                {isCollector ? <div><dt>{t('dashboardPayable')}</dt><dd>{accounting.payable === null ? '—' : <><AnimatedCounter value={accounting.payable} formatter={formatMoney} className="tabular-nums" /> RWF</>}</dd></div> : null}
              </dl>}
            </section>
          </ScrollReveal>

          <ScrollReveal className="dashboard-reveal">
            <section className="panel dashboard-attention" aria-labelledby="dashboard-attention-title">
              <div className="panel-heading"><div><span className="eyebrow">{t('dashboardAttention')}</span><h2 id="dashboard-attention-title">{t('dashboardUnread')}</h2></div><Bell size={19} aria-hidden="true" /></div>
              {alerts.status === 'loading' ? renderState('loading', t('dashboardLoading'), t('dashboardUnavailable'))
                : alerts.status === 'error' ? renderState('error', t('dashboardLoading'), t('dashboardUnavailable'), t('dashboardUnavailable'), t('tryAgain'), onRetryUnread)
                  : alerts.count ? <div className="dashboard-attention-summary"><b><AnimatedCounter value={alerts.count} className="tabular-nums" /></b><span>{t('dashboardUnreadSummary')}</span><button type="button" className="button button-secondary small-button" onClick={() => onNavigate('notifications')}>{t('dashboardOpenAlerts')} <ArrowRight size={14} aria-hidden="true" /></button></div>
                    : <div className="dashboard-empty-state"><span className="dashboard-attention-clear"><Bell size={16} aria-hidden="true" /></span><p>{t('dashboardNoUnread')}</p></div>}
            </section>
          </ScrollReveal>

          <ScrollReveal className="dashboard-reveal">
            {subscription.status === 'available' ? <button type="button" className="panel dashboard-subscription" onClick={() => onNavigate('billing')}>
              <span><span className="eyebrow">{t('dashboardSubscription')}</span><b>{subscription.label}</b></span><ArrowRight size={17} aria-hidden="true" />
            </button> : <div className="panel dashboard-subscription dashboard-subscription-state">
              <span><span className="eyebrow">{t('dashboardSubscription')}</span><small>{subscription.status === 'loading' ? t('dashboardLoading') : t('dashboardUnavailable')}</small></span>
              {subscription.status === 'error' ? <button type="button" className="button button-secondary small-button" onClick={onRetrySubscription}>{t('tryAgain')}</button> : null}
            </div>}
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}