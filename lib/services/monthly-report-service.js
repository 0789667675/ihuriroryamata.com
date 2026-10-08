const defaultRepository = require('../repositories/reportRepository.js');
const { isIsoDate } = require('./milk-service.js');

const roundAmount = (value) => Number(Number(value || 0).toFixed(2));
const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const getPeriodRange = ({ periodType, month, year, startDate, endDate, now = new Date() }) => {
  const effectiveMonth = month || now.getMonth() + 1;
  const effectiveYear = year || now.getFullYear();
  const isHalfMonth = ['first-half', 'firsthalf', 'fifteen', 'second-half', 'secondhalf'].includes(periodType);
  if (startDate && endDate && !isHalfMonth) return [startDate, endDate];
  if (periodType === 'daily') {
    const today = formatDate(now);
    return [today, today];
  }
  if (['first-half', 'firsthalf', 'fifteen'].includes(periodType)) {
    if (month && year) return [formatDate(new Date(effectiveYear, effectiveMonth - 1, 1)), formatDate(new Date(effectiveYear, effectiveMonth - 1, 15))];
    if (now.getDate() <= 15) return [formatDate(new Date(effectiveYear, effectiveMonth - 1, 1)), formatDate(new Date(effectiveYear, effectiveMonth - 1, 15))];
    return [formatDate(new Date(effectiveYear, effectiveMonth - 1, 16)), formatDate(new Date(effectiveYear, effectiveMonth, 0))];
  }
  if (['second-half', 'secondhalf'].includes(periodType)) {
    return [formatDate(new Date(effectiveYear, effectiveMonth - 1, 16)), formatDate(new Date(effectiveYear, effectiveMonth, 0))];
  }
  if (['current-half', 'currenthalf', 'current'].includes(periodType) || (!periodType && !month && !year)) {
    const firstHalf = now.getDate() <= 15;
    return [
      formatDate(new Date(effectiveYear, effectiveMonth - 1, firstHalf ? 1 : 16)),
      formatDate(new Date(effectiveYear, effectiveMonth - (firstHalf ? 1 : 0), firstHalf ? 15 : 0)),
    ];
  }
  if (periodType === 'yearly') return [formatDate(new Date(effectiveYear, 0, 1)), formatDate(new Date(effectiveYear, 11, 31))];
  return [formatDate(new Date(effectiveYear, effectiveMonth - 1, 1)), formatDate(new Date(effectiveYear, effectiveMonth, 0))];
};

const normalizeFilters = (query = {}) => {
  const monthValue = Number(query.month) || null;
  const yearValue = Number(query.year) || null;
  const farmerId = query.farmerId ? Number(query.farmerId) : null;
  const month = monthValue && (monthValue < 1 || monthValue > 12) ? null : monthValue;
  const year = yearValue && (yearValue < 2000 || yearValue > 2100) ? null : yearValue;
  if (query.farmerId && (!Number.isSafeInteger(farmerId) || farmerId <= 0)) throw badRequest('Invalid farmerId.');
  const collectionCenter = query.collectionCenter || query.center || null;
  return {
    month,
    year,
    farmerId,
    collectionCenter: typeof collectionCenter === 'string' ? collectionCenter.trim() : null,
    periodType: String(query.periodType || query.type || 'monthly').trim().toLowerCase(),
    startDate: query.startDate || null,
    endDate: query.endDate || null,
  };
};

const calculateCollectorBalanceSheet = async ({ collectorUserId, farmerOwnerUserId = collectorUserId, farmerCollectorUserId, centerFilter = null, rangeStart, rangeEnd, farmerTotals, defaultPricePerLiter = 0, repository }) => {
  const farmerCollectorFilter = farmerCollectorUserId === undefined ? collectorUserId : farmerCollectorUserId;
  const entries = await repository.getCollectorEntries({ ownerUserId: collectorUserId, startDate: rangeStart, endDate: rangeEnd });
  const byDate = new Map(entries.map((entry) => [String(entry.date).slice(0, 10), entry]));
  const dailyEntries = [...byDate.values()];
  let pricedEntries = await Promise.all(dailyEntries.map(async (entry) => {
    const historic = entry.priceResolved
      ? Number(entry.pricePerLiter || 0)
      : Number(entry.pricePerLiter || 0) || Number((await repository.getCollectorPriceAtDate({ ownerUserId: collectorUserId, date: entry.date }))?.pricePerLiter || 0);
    const effectiveLiters = Number(entry.effectiveVolumeLiters ?? entry.volumeLiters ?? 0);
    return { ...entry, effectiveLiters, pricePerLiter: historic, grossAmount: roundAmount(effectiveLiters * historic) };
  }));
  const farmerRows = farmerTotals || await repository.getFarmerTotals({
    ownerUserId: farmerOwnerUserId,
    rangeStart,
    rangeEnd,
    centerFilter: null,
    farmerId: null,
    collectorUserId: farmerCollectorFilter,
    defaultPricePerLiter,
  });
  const farmersGross = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.grossAmount || 0), 0));
  const collectorTotalFarmersPayable = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.grossAmount || 0), 0));
  const collectorFarmerDeductions = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.totalDeductions || 0), 0));
  const collectorFarmerTransport = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.totalTransport || 0), 0));
  const validByDate = await repository.getFarmerValidLitersByDate({ ownerUserId: farmerOwnerUserId, collectorUserId: farmerCollectorFilter, centerFilter, rangeStart, rangeEnd });
  const farmerTotalsByDate = repository.getFarmerValidTotalsByDate
    ? await repository.getFarmerValidTotalsByDate({ ownerUserId: farmerOwnerUserId, collectorUserId: farmerCollectorFilter, centerFilter, rangeStart, rangeEnd })
    : new Map([...validByDate].map(([date, validLiters]) => [date, {
      validLiters,
      grossAmount: 0,
      originalLiters: validLiters,
      lostLiters: Number(pricedEntries.find((entry) => String(entry.date).slice(0, 10) === date)?.farmerLostLiters || 0),
    }]));
  const farmerLossByDate = new Map([...farmerTotalsByDate].map(([date, totals]) => [date, Number(totals.lostLiters || 0)]));
  pricedEntries = pricedEntries.map((entry) => {
    const date = String(entry.date).slice(0, 10);
    const validBeforeFarmerLoss = entry.status === 'cancelled'
      ? 0
      : Number(entry.validVolumeLiters ?? entry.volumeLiters ?? 0);
    const effectiveLiters = roundAmount(Math.max(0, validBeforeFarmerLoss - Number(farmerLossByDate.get(date) || 0)));
    return { ...entry, farmerLostLiters: Number(farmerLossByDate.get(date) || 0), effectiveLiters, grossAmount: roundAmount(effectiveLiters * entry.pricePerLiter) };
  });
  const ownerEntriesByDate = new Map(pricedEntries.map((entry) => [String(entry.date).slice(0, 10), entry]));
  const accountingDates = new Set([...ownerEntriesByDate.keys(), ...farmerTotalsByDate.keys()]);
  let collectorOriginalLiters = 0;
  let collectorLostLiters = 0;
  let collectorEffectiveLiters = 0;
  let collectorGrossAmount = 0;
  let collectorSurplusLiters = 0;
  let collectorFarmersValidLiters = 0;
  let collectorPriceIsComplete = true;
  for (const date of accountingDates) {
    const entry = ownerEntriesByDate.get(date);
    const farmerDay = farmerTotalsByDate.get(date) || {};
    const farmerLiters = Number(validByDate.get(date) ?? farmerDay.validLiters ?? 0);
    const ownerLiters = Number(entry?.effectiveLiters || 0);
    const validLiters = Math.max(ownerLiters, farmerLiters);
    const ownerValue = Number(entry?.grossAmount || 0);
    const farmerValue = Number(farmerDay.grossAmount || 0);
    const grossValue = entry && ownerLiters >= farmerLiters ? ownerValue : farmerValue;
    collectorOriginalLiters += Math.max(Number(entry?.volumeLiters || 0), Number(farmerDay.originalLiters ?? farmerLiters));
    collectorLostLiters += Math.max(
      entry?.status === 'cancelled' ? Number(entry.volumeLiters || 0) : Number(entry?.farmerLostLiters || 0),
      Number(farmerDay.lostLiters || 0)
    );
    collectorEffectiveLiters += validLiters;
    collectorGrossAmount += grossValue;
    collectorFarmersValidLiters += farmerLiters;
    collectorSurplusLiters += Math.max(0, ownerLiters - farmerLiters);
    if (validLiters > 0 && grossValue <= 0) collectorPriceIsComplete = false;
  }
  if (!pricedEntries.length) {
    const farmerValidTotal = farmerRows.reduce((sum, farmer) => sum + Number(farmer.totalVolume || 0), 0);
    collectorOriginalLiters = farmerRows.reduce((sum, farmer) => sum + Number(farmer.originalVolume ?? farmer.totalVolume ?? 0), 0);
    collectorLostLiters = farmerRows.reduce((sum, farmer) => sum + Number(farmer.lostVolume || 0), 0);
    collectorEffectiveLiters = farmerValidTotal;
    collectorFarmersValidLiters = farmerValidTotal;
    collectorGrossAmount = farmersGross;
    collectorSurplusLiters = 0;
    collectorPriceIsComplete = farmerValidTotal === 0 || farmersGross > 0;
  }
  collectorOriginalLiters = roundAmount(collectorOriginalLiters);
  collectorLostLiters = roundAmount(collectorLostLiters);
  collectorEffectiveLiters = roundAmount(collectorEffectiveLiters);
  collectorGrossAmount = roundAmount(collectorGrossAmount);
  collectorFarmersValidLiters = roundAmount(collectorFarmersValidLiters);
  collectorSurplusLiters = roundAmount(collectorSurplusLiters);
  const hasCollectorPrice = collectorPriceIsComplete;
  const calculatedCollectorPrice = collectorEffectiveLiters > 0
    ? Number((collectorGrossAmount / collectorEffectiveLiters).toFixed(2))
    : Number(pricedEntries[pricedEntries.length - 1]?.pricePerLiter || 0);
  const collectorGross = hasCollectorPrice ? collectorGrossAmount : null;
  const collectorPricePerLiter = hasCollectorPrice ? calculatedCollectorPrice : null;
  const collectorSurplusAmount = hasCollectorPrice ? roundAmount(collectorGrossAmount - farmersGross) : null;
  const collectorPayableFromBreakdown = hasCollectorPrice
    ? roundAmount(collectorSurplusAmount + collectorFarmerDeductions + collectorFarmerTransport)
    : null;
  const collectorPayable = collectorPayableFromBreakdown;
  const farmerNetPayable = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(
    farmer.netAmount ?? (Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0) - Number(farmer.totalTransport || 0))
  ), 0));
  const settlementTotal = hasCollectorPrice ? roundAmount(farmerNetPayable + collectorPayable) : null;
  const balance = {
    collectorPayable,
    collectorPayableFromBreakdown,
    isReconciled: hasCollectorPrice
      ? Math.abs(collectorPayable - collectorPayableFromBreakdown) <= 0.01
        && Math.abs(collectorGrossAmount - settlementTotal) <= 0.01
      : null,
    settlementTotal,
  };

  return {
    collectorUserId,
    rangeStart,
    rangeEnd,
    farmerTotals: farmerRows,
    entries: pricedEntries,
    hasCollectorPrice,
    collectorOriginalLiters,
    collectorLostLiters,
    collectorEffectiveLiters,
    collectorGross,
    collectorPricePerLiter,
    collectorFarmersValidLiters,
    collectorSurplusLiters,
    collectorSurplusAmount,
    collectorTotalFarmersPayable,
    collectorFarmerDeductions,
    collectorFarmerTransport,
    ...balance,
  };
};

const projectSettlementRow = ({ sheet, profile }) => ({
  name: profile.name,
  role: 'collector',
  nationalId: profile.nationalId || profile.national_id || null,
  accountNumber: profile.accountNumber || profile.account_number || null,
  phone: profile.phone || null,
  actualVolume: sheet.collectorEffectiveLiters,
  originalVolume: sheet.collectorOriginalLiters,
  lostVolume: sheet.collectorLostLiters,
  pricePerLiter: sheet.collectorPricePerLiter,
  farmersValidLiters: sheet.collectorFarmersValidLiters,
  grossAmount: sheet.collectorGross,
  collectorGross: sheet.collectorGross,
  collectorEffectiveLiters: sheet.collectorEffectiveLiters,
  collectorTotalFarmersPayable: sheet.collectorTotalFarmersPayable,
  collectorFarmerPayable: sheet.collectorTotalFarmersPayable,
  collectorFarmerDeductions: sheet.collectorFarmerDeductions,
  collectorFarmerTransport: sheet.collectorFarmerTransport,
  collectorSurplusLiters: sheet.collectorSurplusLiters,
  collectorSurplusAmount: sheet.collectorSurplusAmount,
  collectorPayable: sheet.collectorPayable,
  collectorPayableFromBreakdown: sheet.collectorPayableFromBreakdown,
  isReconciled: sheet.isReconciled,
  settlementTotal: sheet.settlementTotal,
  farmerDeductions: sheet.collectorFarmerDeductions,
  farmerTransport: sheet.collectorFarmerTransport,
});

const buildDairyCollectorSettlementRows = async ({ dairyUserId, rangeStart, rangeEnd, centerFilter = null, repository }) => {
  const rows = await repository.getDairyCollectorTotals({ ownerUserId: dairyUserId, rangeStart, rangeEnd, centerFilter });
  return rows.map((row) => {
    const grossAmount = roundAmount(Number(row.grossAmount || 0));
    return {
      ...row,
      collectorUserId: Number(row.collectorUserId),
      role: 'collector',
      totalVolume: roundAmount(Number(row.totalVolume || 0)),
      grossAmount,
      totalTransport: 0,
      totalDeductions: grossAmount,
      netAmount: grossAmount,
      isReconciled: true,
    };
  });
};

const getSummary = async ({ ownerUserId, actorId = ownerUserId, query: rawQuery = {}, repository = defaultRepository, now = new Date() }) => {
  const filters = normalizeFilters(rawQuery);
  if ((filters.startDate && !filters.endDate) || (!filters.startDate && filters.endDate)) throw badRequest('Both startDate and endDate are required for a custom range.');
  if (filters.startDate && !isIsoDate(filters.startDate)) throw badRequest('Invalid startDate. Expected YYYY-MM-DD.');
  if (filters.endDate && !isIsoDate(filters.endDate)) throw badRequest('Invalid endDate. Expected YYYY-MM-DD.');
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw badRequest('startDate must be on or before endDate.');
  const [rangeStart, rangeEnd] = getPeriodRange({ ...filters, now });
  const centerFilter = filters.collectionCenter ? filters.collectionCenter.toLowerCase() : null;
  const ownerId = Number(ownerUserId);
  const profile = await repository.getUserProfile(ownerId);
  const isCollector = profile?.accountType === 'COLLECTOR';
  const isDairy = profile?.accountType === 'COLLECTION_CENTER';
  if (isDairy && filters.farmerId) throw badRequest('Farmer filters are not available for Collection Center accounting.');
  const farmerOwnerId = isCollector && repository.getCollectorDairyOwnerId
    ? (await repository.getCollectorDairyOwnerId(ownerId)) || ownerId
    : ownerId;
  const farmerCollectorUserId = isCollector && farmerOwnerId !== ownerId ? ownerId : null;
  const [totalFarmers, periodTotals, todayTotals, loadedDeductions] = await Promise.all([
    repository.getTotalFarmers({ ownerUserId: farmerOwnerId, centerFilter, collectorUserId: farmerCollectorUserId }),
    repository.getPeriodTotals({ ownerUserId: farmerOwnerId, rangeStart, rangeEnd, centerFilter, farmerId: filters.farmerId, collectorUserId: farmerCollectorUserId }),
    repository.getTodayTotals({ ownerUserId: farmerOwnerId, date: formatDate(now), centerFilter, collectorUserId: farmerCollectorUserId }),
    isDairy ? Promise.resolve(0) : repository.getTotalDeductions({ ownerUserId: farmerOwnerId, rangeStart, rangeEnd, centerFilter, farmerId: filters.farmerId, collectorUserId: farmerCollectorUserId }),
  ]);
  let totalDeductions = Number(loadedDeductions || 0);
  const centerPrice = filters.collectionCenter
    ? await repository.getCurrentCenterPrice({ ownerUserId: farmerOwnerId, centerName: filters.collectionCenter, date: formatDate(now) })
    : null;
  const pricePerLiter = Number(centerPrice?.pricePerLiter || 0);
  const loadedFarmerTotals = await repository.getFarmerTotals({
    ownerUserId: farmerOwnerId,
    rangeStart,
    rangeEnd,
    centerFilter,
    farmerId: filters.farmerId,
    collectorUserId: farmerCollectorUserId,
    defaultPricePerLiter: pricePerLiter,
  });
  const farmerTotals = loadedFarmerTotals.map((farmer) => {
    const base = {
      ...farmer,
      totalDeductions: Number(farmer.totalDeductions || 0),
      ifishiTotalDeductions: roundAmount(Number(farmer.totalDeductions || 0)),
      ifishiNetAmount: roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalTransport || 0) - Number(farmer.totalDeductions || 0)),
      netAmount: roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalTransport || 0) - Number(farmer.totalDeductions || 0)),
    };
    if (isDairy) {
      return {
        ...base,
        totalTransport: 0,
        netAmount: roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0)),
        ifishiNetAmount: roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0)),
      };
    }
    return base;
  });
  const milkLossRecords = repository.getMilkLossRecords
    ? await repository.getMilkLossRecords({ ownerUserId: farmerOwnerId, rangeStart, rangeEnd, centerFilter, farmerId: filters.farmerId, collectorUserId: farmerCollectorUserId })
    : [];
  const totalTransport = isCollector ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.totalTransport || 0), 0)) : 0;
  const grossAmount = roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.grossAmount || 0), 0));
  let netAmount = isCollector
    ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.netAmount || 0), 0))
    : roundAmount(grossAmount - Number(totalDeductions || 0));
  const isUkweziHalfMonth = ['first-half', 'firsthalf', 'fifteen', 'second-half', 'secondhalf'].includes(filters.periodType);
  const settlementAllowed = !filters.farmerId && (!centerFilter || isUkweziHalfMonth);
  let ownSheet = null;
  let collectorSettlementRows = [];
  if (settlementAllowed && isCollector) {
    ownSheet = await calculateCollectorBalanceSheet({
      collectorUserId: ownerId,
      farmerOwnerUserId: farmerOwnerId,
      farmerCollectorUserId,
      centerFilter,
      rangeStart,
      rangeEnd,
      farmerTotals,
      defaultPricePerLiter: pricePerLiter,
      repository,
    });
    collectorSettlementRows = [projectSettlementRow({ sheet: ownSheet, profile })];
  }
  const dairyFarmerDeductions = isDairy
    ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.totalDeductions || 0), 0))
    : 0;
  if (isCollector && ownSheet) totalDeductions = Number(ownSheet.collectorTotalFarmersPayable || 0);
  if (isDairy) {
    totalDeductions = dairyFarmerDeductions;
    netAmount = roundAmount(grossAmount - dairyFarmerDeductions);
  }
  const collectorSettlementRow = collectorSettlementRows[0] || null;
  const paymentView = isCollector ? ownSheet : null;
  const collectorEntries = ownSheet?.entries || [];
  const totalVolume = Number(periodTotals.totalVolume || 0);
  const totalAmount = Number(periodTotals.totalAmount || 0);
  const ownerGeneratedGross = isCollector ? ownSheet?.collectorGross ?? null : grossAmount;
  const ownerGeneratedVolume = isCollector ? Number(ownSheet?.collectorEffectiveLiters ?? totalVolume) : totalVolume;
  const ownerSettlementRow = isCollector ? {
    isOwner: true,
    farmerId: null,
    name: profile.name,
    farmerName: profile.name,
    nationalId: profile.nationalId || profile.national_id || null,
    phone: profile.phone || null,
    accountNumber: profile.accountNumber || profile.account_number || null,
    totalVolume: ownerGeneratedVolume,
    pricePerLiter: ownSheet?.collectorPricePerLiter ?? null,
    grossAmount: ownerGeneratedGross,
    totalTransport: 0,
    otherDeductions: 0,
    totalDeductions: ownSheet?.collectorTotalFarmersPayable ?? 0,
    netAmount: ownSheet?.collectorPayable ?? null,
  } : isDairy ? {
    isOwner: true,
    farmerId: null,
    name: profile.name,
    farmerName: profile.name,
    nationalId: profile.nationalId || profile.national_id || null,
    phone: profile.phone || null,
    accountNumber: profile.accountNumber || profile.account_number || null,
    totalVolume,
    pricePerLiter: totalVolume > 0 ? Number((grossAmount / totalVolume).toFixed(2)) : null,
    grossAmount,
    totalTransport: 0,
    otherDeductions: 0,
    totalDeductions: Number(totalDeductions || 0),
    netAmount,
  } : null;
  return {
    periodType: filters.periodType,
    rangeStart,
    rangeEnd,
    collectionCenter: filters.collectionCenter || null,
    pricePerLiter: filters.collectionCenter ? pricePerLiter : null,
    totalFarmers: Number(totalFarmers || 0),
    totalVolume,
    totalAmount,
    totalMorning: Number(periodTotals.totalMorning || 0),
    totalEvening: Number(periodTotals.totalEvening || 0),
    totalDeductions: Number(totalDeductions || 0),
    totalAdvance: 0,
    totalUmwenda: 0,
    totalDebt: 0,
    totalOther: isDairy ? 0 : Number(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.otherDeductions || 0), 0).toFixed(2)),
    totalTransport,
    netAmount,
    totalMilkMonth: totalVolume,
    totalRevenueMonth: isCollector && ownSheet ? ownSheet.collectorGross : grossAmount,
    ownerGeneratedGross,
    ownerGeneratedVolume,
    totalTransportFeesMonth: isCollector ? totalTransport : 0,
    totalDeductionsMonth: Number(totalDeductions || 0),
    netRevenueMonth: isCollector && ownSheet
      ? ownSheet.collectorPayable
      : isDairy
        ? roundAmount(grossAmount - dairyFarmerDeductions)
        : netAmount,
    todayMorning: Number(todayTotals.todayMorning || 0),
    todayEvening: Number(todayTotals.todayEvening || 0),
    todayTotal: Number(todayTotals.todayTotal || 0),
    todayAmount: Number(todayTotals.todayAmount || 0),
    expectedAmount: Number(todayTotals.todayAmount || 0),
    farmerPayments: farmerTotals,
    monthlyFarmerTotals: farmerTotals,
    milkLossRecords,
    collectorActualVolume: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorEffectiveVolume: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorEffectiveLiters: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorOriginalVolume: ownSheet?.collectorOriginalLiters ?? 0,
    collectorLostVolume: ownSheet?.collectorLostLiters ?? 0,
    collectorGross: ownSheet?.collectorGross ?? null,
    collectorTotalFarmersPayable: ownSheet?.collectorTotalFarmersPayable ?? 0,
    collectorFarmerPayable: ownSheet?.collectorTotalFarmersPayable ?? 0,
    collectorFarmerDeductions: ownSheet?.collectorFarmerDeductions ?? 0,
    collectorFarmerTransport: isCollector ? (ownSheet?.collectorFarmerTransport ?? 0) : 0,
    collectorFarmersValidLiters: ownSheet?.collectorFarmersValidLiters ?? 0,
    collectorSurplusLiters: ownSheet?.collectorSurplusLiters ?? 0,
    collectorSurplusAmount: ownSheet?.collectorSurplusAmount ?? null,
    collectorPayable: paymentView?.collectorPayable ?? null,
    collectorPayableFromBreakdown: paymentView?.collectorPayableFromBreakdown ?? null,
    collectorIsReconciled: paymentView?.isReconciled ?? null,
    collectorSettlementTotal: paymentView?.settlementTotal ?? null,
    collectorSettlementRow,
    collectorSettlementRows,
    ownerSettlementRow,
    collectorEntries,
    collectorProfile: (isCollector || isDairy) ? {
      name: profile.name,
      nationalId: profile.nationalId || null,
      accountNumber: profile.accountNumber || null,
      phone: profile.phone || null,
    } : null,
    summaries: { farmerCount: farmerTotals.length, collectorRowCount: collectorSettlementRows.length },
  };
};

module.exports = { formatDate, getPeriodRange, normalizeFilters, calculateCollectorBalanceSheet, projectSettlementRow, buildDairyCollectorSettlementRows, getSummary };
