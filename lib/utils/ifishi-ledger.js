const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeIfishiMilkRecord = (record = {}) => {
  const morning = toNumber(record.volumeMorning ?? record.volume_morning ?? record.morningLiters ?? record.morning_liters ?? 0);
  const evening = toNumber(record.volumeEvening ?? record.volume_evening ?? record.eveningLiters ?? record.evening_liters ?? 0);
  const total = morning + evening;
  const valid = toNumber(record.validVolumeLiters ?? record.valid_volume_liters ?? record.validVolume ?? record.valid_volume ?? total);
  const lost = toNumber(record.lostVolumeLiters ?? record.lost_volume_liters ?? record.lostVolume ?? record.lost_volume ?? 0);
  const date = String(record.date || '').slice(0, 10);
  const status = String(record.status || record.milkStatus || 'recorded').trim() || 'recorded';
  const note = String(record.adjustmentReason || record.reason || record.notes || '').trim();

  return {
    date,
    morning,
    evening,
    total,
    valid,
    lost,
    status,
    note,
  };
};

const buildIfishiVolumeRows = (records = []) => {
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => normalizeIfishiMilkRecord(record))
    .filter((record) => record.date || record.total > 0 || record.valid > 0 || record.lost > 0);
};

module.exports = {
  toNumber,
  normalizeIfishiMilkRecord,
  buildIfishiVolumeRows,
};
