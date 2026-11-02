/** @typedef {{ farmerId: number, farmerName: string, amount: number }} SettlementBatchRecord */
/** @typedef {SettlementBatchRecord & { reason: string, retryable: boolean }} SettlementBatchFailure */
/** @typedef {{ selectedCount: number, processedCount: number, confirmedCount: number, failures: SettlementBatchFailure[], complete: boolean }} SettlementBatchState */

const getFailure = (record, error) => {
  const status = Number(error?.status ?? error?.statusCode ?? 0) || null;
  return {
    ...record,
    reason: error instanceof Error && error.message ? error.message : 'Settlement confirmation failed.',
    retryable: status === null || status === 408 || status === 429 || status >= 500,
  };
};

/**
 * @param {SettlementBatchRecord[]} records
 * @param {(record: SettlementBatchRecord) => Promise<unknown>} processRecord
 * @param {(state: SettlementBatchState) => void} [onProgress]
 * @returns {Promise<SettlementBatchState>}
 */
const confirmSettlementBatch = async (records, processRecord, onProgress = () => undefined) => {
  const result = {
    selectedCount: records.length,
    processedCount: 0,
    confirmedCount: 0,
    failures: [],
    complete: false,
  };
  const publish = () => onProgress({ ...result, failures: [...result.failures] });
  publish();

  for (const record of records) {
    try {
      await processRecord(record);
      result.confirmedCount += 1;
    } catch (error) {
      result.failures.push(getFailure(record, error));
    }
    result.processedCount += 1;
    publish();
  }

  result.complete = true;
  publish();
  return { ...result, failures: [...result.failures] };
};

module.exports = { confirmSettlementBatch };