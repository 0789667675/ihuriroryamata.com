const normalizeAmount = (value) => Number(Number(value || 0).toFixed(2));
const normalizeText = (value) => String(value ?? '').trim();

const hasValidSaccoAccount = (farmer) => {
  const accountNumber = normalizeText(farmer?.accountNumber ?? farmer?.account_number);
  return Boolean(accountNumber) && accountNumber !== 'N/A' && accountNumber !== 'NA' && accountNumber.length >= 4;
};

const buildSaccoDistributionList = ({ farmers = [], amountKey = 'netAmount', paymentType = 'SACCO' }) => {
  return (farmers || [])
    .filter((farmer) => hasValidSaccoAccount(farmer))
    .map((farmer) => ({
      ...farmer,
      amount: normalizeAmount(farmer[amountKey] ?? farmer.netAmount ?? 0),
      retainedAmount: 0,
      remainingRetainedAmount: 0,
      settledAmount: 0,
      saccoEligible: true,
      isOwnerProfit: false,
      reason: null,
      paymentType,
    }));
};

const buildRetainedSettlementList = ({ farmers = [], amountKey = 'netAmount', reason = 'NO_SACCO_ACCOUNT' }) => {
  return (farmers || [])
    .filter((farmer) => !hasValidSaccoAccount(farmer))
    .map((farmer) => {
      const amount = normalizeAmount(farmer[amountKey] ?? farmer.netAmount ?? 0);
      return {
        ...farmer,
        amount,
        retainedAmount: amount,
        settledAmount: 0,
        remainingRetainedAmount: amount,
        status: 'PENDING',
        isOwnerProfit: false,
        reason,
        saccoEligible: false,
      };
    });
};

const applyRetainedSettlementPayment = ({ retainedRecord, paymentAmount, paymentDate = new Date().toISOString() }) => {
  const amount = normalizeAmount(paymentAmount);
  const currentRemaining = normalizeAmount(retainedRecord?.remainingRetainedAmount ?? retainedRecord?.retainedAmount ?? 0);
  const applied = Math.min(amount, currentRemaining);
  const remaining = Math.max(0, currentRemaining - applied);
  const status = remaining > 0 ? 'PARTIALLY_SETTLED' : 'SETTLED';

  return {
    ...retainedRecord,
    paymentAmount: applied,
    retainedAmount: currentRemaining,
    settledAmount: normalizeAmount((retainedRecord?.settledAmount ?? 0) + applied),
    remainingRetainedAmount: remaining,
    status,
    lastPaymentDate: paymentDate,
    isOwnerProfit: false,
  };
};

const createSettlementRecord = async ({ repo, farmerId, ownerUserId, amount, paymentMethod, paymentType, paymentDate, periodStart, periodEnd, status = 'APPROVED', approvalStatus = 'APPROVED', approvedBy, reason, notes, paymentReference, periodType = 'monthly', auditContext = {} }) => {
  const normalizedAmount = normalizeAmount(amount);
  if (normalizedAmount <= 0) throw new Error('Payment amount must be positive.');
  if (!approvedBy) throw new Error('Owner approval is required before a cash payment can be confirmed.');

  const record = {
    id: repo?.nextSettlementId ? repo.nextSettlementId() : (repo?.records?.length || 0) + 1,
    farmerId,
    ownerUserId,
    amount: normalizedAmount,
    settledAmount: 0,
    remainingAmount: normalizedAmount,
    paymentMethod: paymentMethod || 'CASH',
    paymentType: paymentType || 'CASH',
    paymentDate: paymentDate || new Date().toISOString(),
    actualPaymentDate: null,
    periodType,
    periodStart,
    periodEnd,
    status,
    approvalStatus,
    approvalStatusText: approvalStatus,
    approvedBy,
    approvedAt: new Date().toISOString(),
    reason,
    notes,
    paymentReference: paymentReference || `settlement-${farmerId}-${periodStart}-${Date.now()}`,
    auditContext,
  };

  let savedRecord = record;
  if (repo?.createSettlementRecord) {
    savedRecord = await repo.createSettlementRecord(record);
  } else {
    repo.records = repo?.records || [];
    repo.records.push(record);
  }

  if (repo?.createAuditLog && !repo?.handlesSettlementAudit) {
    await repo.createAuditLog({
      entityType: 'farmer_settlement_record',
      entityId: savedRecord.id,
      action: 'cash_payment_approved',
      details: { farmerId, amount: normalizedAmount, paymentMethod: savedRecord.paymentMethod, periodStart, periodEnd, approvedBy },
      ownerUserId,
      actorId: approvedBy,
    });
  }

  return {
    ...savedRecord,
    actualPaymentDate: savedRecord.actualPaymentDate ?? null,
    paymentMethod: savedRecord.paymentMethod || 'CASH',
    paymentType: savedRecord.paymentType || 'CASH',
    status: savedRecord.status || 'APPROVED',
    approvalStatus: savedRecord.approvalStatus || 'APPROVED',
    approvedBy: savedRecord.approvedBy ?? approvedBy,
  };
};

const recordCashSettlement = async ({ repo, farmerId, ownerUserId, amount, paymentDate, periodStart, periodEnd, paymentMethod = 'CASH', reason = 'NO_SACCO_ACCOUNT', approvedBy, notes }) => {
  return createSettlementRecord({
    repo,
    farmerId,
    ownerUserId,
    amount,
    paymentMethod,
    paymentType: 'CASH',
    paymentDate,
    periodStart,
    periodEnd,
    reason,
    notes,
    approvedBy,
    status: 'APPROVED',
    approvalStatus: 'APPROVED',
    paymentReference: `cash-${farmerId}-${periodStart}-${Date.now()}`,
    auditContext: { paymentMethod, reason, approvalStatus: 'APPROVED' },
  });
};

const confirmSettlement = async ({ repo, settlementId, collectorUserId, farmerId, ownerUserId, periodStart, periodEnd, confirmedAt = new Date().toISOString() }) => {
  if (!settlementId) throw new Error('Settlement id is required.');

  let record;
  if (repo?.getSettlementRecord) {
    record = await repo.getSettlementRecord({ settlementId, farmerId, ownerUserId });
  } else {
    record = (repo?.records || []).find((entry) => Number(entry.id) === Number(settlementId));
  }

  if (!record) throw new Error('Settlement record not found.');
  if (Number(record.farmerId) !== Number(farmerId)) throw new Error('Settlement farmer mismatch.');
  if (Number(record.ownerUserId) !== Number(ownerUserId)) throw new Error('Settlement owner mismatch.');
  if (record.periodStart !== periodStart || record.periodEnd !== periodEnd) {
    throw new Error('Payment confirmation period does not match the settlement period.');
  }
  if (record.status === 'CONFIRMED') throw new Error('Settlement already confirmed.');

  const confirmed = {
    ...record,
    status: 'CONFIRMED',
    confirmationStatus: 'CONFIRMED',
    confirmedBy: collectorUserId,
    confirmedAt,
    updatedAt: new Date().toISOString(),
  };

  if (repo?.confirmSettlementRecord) {
    const updated = await repo.confirmSettlementRecord({ settlementId, collectorUserId, confirmedAt, periodStart, periodEnd, farmerId, ownerUserId });
    if (updated) return updated;
    throw new Error('Settlement is no longer pending confirmation.');
  } else {
    const index = (repo?.records || []).findIndex((entry) => Number(entry.id) === Number(settlementId));
    if (index >= 0) (repo.records)[index] = confirmed;
  }

  if (repo?.createAuditLog && !repo?.handlesSettlementAudit) {
    await repo.createAuditLog({
      entityType: 'farmer_settlement_record',
      entityId: settlementId,
      action: 'collector_confirmed_payment',
      details: { farmerId, collectorUserId, periodStart, periodEnd, confirmedAt },
      ownerUserId,
      actorId: collectorUserId,
    });
  }

  return confirmed;
};

const createDebtLedgerEntry = ({ farmerId, ownerUserId, openingBalance, periodStart, periodEnd, reason = 'DEBT', status = 'OPEN', createdBy, notes }) => {
  const balance = normalizeAmount(openingBalance);
  return {
    id: `debt-${farmerId}-${periodStart}-${Date.now()}`,
    farmerId,
    ownerUserId,
    openingBalance: balance,
    remainingBalance: balance,
    outstandingBalance: balance,
    totalRepaid: 0,
    periodStart,
    periodEnd,
    reason,
    status,
    createdBy,
    notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

const applyDebtRepayment = ({ debt, payableAmount, reason = 'PARTIAL_RECOVERY', periodStart, periodEnd, actorId }) => {
  const debtBalance = normalizeAmount(debt?.remainingBalance ?? debt?.outstandingBalance ?? debt?.openingBalance ?? 0);
  const available = normalizeAmount(payableAmount);
  const repaymentAmount = Math.min(available, debtBalance);
  const remainingDebt = Math.max(0, debtBalance - repaymentAmount);
  const updatedDebt = {
    ...debt,
    remainingBalance: remainingDebt,
    outstandingBalance: remainingDebt,
    totalRepaid: normalizeAmount((debt?.totalRepaid ?? 0) + repaymentAmount),
    periodStart: debt?.periodStart || periodStart,
    periodEnd: debt?.periodEnd || periodEnd,
    reason: debt?.reason || reason,
    status: remainingDebt > 0 ? 'PARTIALLY_SETTLED' : 'SETTLED',
    updatedAt: new Date().toISOString(),
    lastActorId: actorId,
  };

  return {
    repaymentAmount,
    remainingDebt,
    status: updatedDebt.status,
    transactionType: 'DEBT_REPAYMENT',
    ledger: updatedDebt,
    paidAgainstDebt: repaymentAmount,
  };
};

module.exports = {
  hasValidSaccoAccount,
  buildSaccoDistributionList,
  buildRetainedSettlementList,
  applyRetainedSettlementPayment,
  createSettlementRecord,
  recordCashSettlement,
  confirmSettlement,
  createDebtLedgerEntry,
  applyDebtRepayment,
};
