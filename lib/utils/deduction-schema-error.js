const SETUP_MESSAGE = 'Deduction setup is incomplete. Apply migration 031_deduction_period_batch_management.sql and its prerequisites using the approved database migration process.';

const isMissingDeductionSetup = (error) => {
  const message = String(error?.message || '');
  if (error?.code === '42P01') {
    return /\b(?:public\.)?(?:deduction_configurations|deduction_batch_items)\b/i.test(message);
  }
  if (error?.code === '42703') {
    return /\b(?:configuration_id|accounting_period_start|accounting_period_end|debt_ledger_id)\b/i.test(message);
  }
  return false;
};

module.exports = { SETUP_MESSAGE, isMissingDeductionSetup };
