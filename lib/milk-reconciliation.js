function calculateMilkDifference(ownerLiters, farmerLiters) {
  if (ownerLiters === null || ownerLiters === undefined || farmerLiters === null || farmerLiters === undefined) return null;
  const owner = Number(ownerLiters);
  const farmers = Number(farmerLiters);
  if (!Number.isFinite(owner) || !Number.isFinite(farmers)) return null;
  const difference = Number((owner - farmers).toFixed(2));
  return {
    difference,
    higherSide: difference > 0 ? 'owner' : difference < 0 ? 'farmers' : 'equal',
  };
}

function projectOwnerMilkEntry(entries, date) {
  const entry = Array.isArray(entries)
    ? entries.find((row) => row.date === date && row.id !== null)
    : null;
  if (!entry) return null;
  const volumeMorning = Number(entry.volumeMorning);
  const volumeEvening = Number(entry.volumeEvening);
  const validVolumeLiters = Number(entry.validVolumeLiters);
  if (![volumeMorning, volumeEvening, validVolumeLiters].every(Number.isFinite)) return null;
  return { volumeMorning, volumeEvening, validVolumeLiters };
}

module.exports = { calculateMilkDifference, projectOwnerMilkEntry };