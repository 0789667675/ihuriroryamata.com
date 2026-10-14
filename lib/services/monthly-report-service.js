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
    sortBy: ['name', 'volume', 'payable'].includes(query.sortBy) ? query.sortBy : null,
    sortDirection: query.sortDirection === 'asc' ? 'asc' : 'desc',
    startDate: query.startDate || null,
    endDate: query.endDate || null,
  };
};

const sortAccountingRows = (rows, sortBy, sortDirection) => {
  if (!sortBy) return rows;
  const multiplier = sortDirection === 'asc' ? 1 : -1;
  const numericValue = (row) => sortBy === 'volume' ? Number(row.totalVolume ?? row.actualVolume ?? 0) : Number(row.netAmount ?? row.collectorPayable ?? 0);
  return [...rows].sort((left, right) => {
    if (sortBy === 'name') {
      const leftName = String(left.farmerName || left.name || '').trim().toLocaleLowerCase();
      const rightName = String(right.farmerName || right.name || '').trim().toLocaleLowerCase();
      return leftName.localeCompare(rightName) * multiplier || Number(left.farmerId || left.collectorUserId || 0) - Number(right.farmerId || right.collectorUserId || 0);
    }
    const leftValue = numericValue(left);
    const rightValue = numericValue(right);
    return (leftValue - rightValue) * multiplier || Number(left.farmerId || left.collectorUserId || 0) - Number(right.farmerId || right.collectorUserId || 0);
  });
};

const calculateCollectorBalanceSheet = async ({ collectorUserId, farmerOwnerUserId = collectorUserId, farmerCollectorUserId, centerFilter = null, rangeStart, rangeEnd, farmerTotals, defaultPricePerLiter = 0, repository }) => {
  const farmerCollectorFilter = farmerCollectorUserId === undefined ? collectorUserId : farmerCollectorUserId;
  const eligibleFarmerTotals = (farmerTotals || []).filter((farmer) => Number(farmer.totalVolume || 0) > 0);
  const entries = await repository.getCollectorEntries({ ownerUserId: collectorUserId, startDate: rangeStart, endDate: rangeEnd });
  const dailyEntries = [...new Map(entries.map((entry) => [String(entry.date).slice(0, 10), entry])).values()];
  const pricedEntries = await Promise.all(dailyEntries.map(async (entry) => {
    const savedPrice = Number(entry.pricePerLiter || 0);
    const historic = entry.priceResolved || savedPrice > 0
      ? savedPrice
      : Number((await repository.getCollectorPriceAtDate({ ownerUserId: collectorUserId, date: entry.date }))?.pricePerLiter || 0);
    const effectiveLiters = entry.status === 'cancelled'
      ? 0
      : Number(entry.validVolumeLiters ?? entry.effectiveVolumeLiters ?? entry.volumeLiters ?? 0);
    const hasPrice = Number.isFinite(historic) && historic > 0;
    return {
      ...entry,
      effectiveLiters,
      pricePerLiter: hasPrice ? historic : null,
      grossAmount: effectiveLiters <= 0 ? 0 : hasPrice ? roundAmount(effectiveLiters * historic) : null,
    };
  }));
  const farmerRows = eligibleFarmerTotals.length
    ? eligibleFarmerTotals
    : (farmerTotals || []).filter((farmer) => Number(farmer.totalVolume || 0) > 0) || await repository.getFarmerTotals({
      ownerUserId: farmerOwnerUserId,
      rangeStart,
      rangeEnd,
      centerFilter: null,
      farmerId: null,
      collectorUserId: farmerCollectorFilter,
      defaultPricePerLiter,
    });
  const farmerMilkValueIsComplete = farmerRows.every((farmer) => farmer.milkValueComplete !== false);
  const farmerMilkValue = farmerMilkValueIsComplete
    ? roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.grossAmount || 0), 0))
    : null;
  const collectorFarmerDeductions = roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.totalDeductions || 0), 0));
  const collectorTransportIsComplete = farmerRows.every((farmer) => farmer.transportIsComplete !== false);
  const collectorFarmerTransport = collectorTransportIsComplete
    ? roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(farmer.totalTransport || 0), 0))
    : null;
  const collectorFarmerPayable = farmerMilkValueIsComplete && collectorTransportIsComplete
    ? roundAmount(farmerRows.reduce((sum, farmer) => sum + Number(
      farmer.netAmount ?? (Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0) - Number(farmer.totalTransport || 0))
    ), 0))
    : null;
  const validByDate = await repository.getFarmerValidLitersByDate({ ownerUserId: farmerOwnerUserId, collectorUserId: farmerCollectorFilter, centerFilter, rangeStart, rangeEnd });
  const farmerTotalsByDate = repository.getFarmerValidTotalsByDate
    ? await repository.getFarmerValidTotalsByDate({ ownerUserId: farmerOwnerUserId, collectorUserId: farmerCollectorFilter, centerFilter, rangeStart, rangeEnd })
    : new Map([...validByDate].map(([date, validLiters]) => [date, { validLiters, originalLiters: validLiters, lostLiters: 0 }]));
  let collectorOriginalLiters = 0;
  let collectorLostLiters = 0;
  let collectorEffectiveLiters = 0;
  let collectorGrossAmount = 0;
  let collectorFarmersValidLiters = 0;
  let collectorSurplusLiters = 0;
  let collectorPriceIsComplete = true;
  const ownerEntriesByDate = new Map(pricedEntries.map((entry) => [String(entry.date).slice(0, 10), entry]));
  const accountingDates = new Set([...ownerEntriesByDate.keys(), ...farmerTotalsByDate.keys()]);
  for (const date of accountingDates) {
    const entry = ownerEntriesByDate.get(date);
    const farmerDay = farmerTotalsByDate.get(date) || {};
    const ownerLiters = Number(entry?.effectiveLiters || 0);
    const farmerLiters = Number(validByDate.get(date) ?? farmerDay.validLiters ?? 0);
    collectorOriginalLiters += Number(entry?.originalVolumeLiters ?? entry?.volumeLiters ?? 0);
    collectorLostLiters += Number(entry?.status === 'cancelled'
      ? entry.originalVolumeLiters ?? entry.volumeLiters ?? 0
      : entry?.lostVolumeLiters || 0) + Number(farmerDay.lostLiters || 0);
    collectorEffectiveLiters += ownerLiters;
    collectorFarmersValidLiters += farmerLiters;
    collectorSurplusLiters += Math.max(0, ownerLiters - farmerLiters);
    if (ownerLiters > 0 && entry?.grossAmount == null) collectorPriceIsComplete = false;
    else collectorGrossAmount += Number(entry?.grossAmount || 0);
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
  const collectorSurplusAmount = hasCollectorPrice && farmerMilkValueIsComplete
    ? roundAmount(collectorGrossAmount - farmerMilkValue)
    : null;
  const collectorPayableFromBreakdown = collectorSurplusAmount !== null && collectorTransportIsComplete
    ? roundAmount(collectorSurplusAmount + collectorFarmerDeductions + collectorFarmerTransport)
    : null;
  const collectorPayable = collectorPayableFromBreakdown;
  const settlementTotal = collectorFarmerPayable !== null && collectorPayable !== null
    ? roundAmount(collectorFarmerPayable + collectorPayable)
    : null;
  const accountingMissingInputs = [];
  if (!hasCollectorPrice) accountingMissingInputs.push('owner_historical_price');
  if (!farmerMilkValueIsComplete) accountingMissingInputs.push('farmer_historical_price');
  if (!collectorTransportIsComplete) accountingMissingInputs.push('farmer_transport_snapshot');
  const isReconciled = collectorGross !== null && settlementTotal !== null
    ? Math.abs(collectorGross - settlementTotal) <= 0.01
    : null;

  return {
    collectorUserId,
    rangeStart,
    rangeEnd,
    farmerTotals: farmerRows,
    entries: pricedEntries,
    hasCollectorPrice,
    accountingComplete: accountingMissingInputs.length === 0,
    accountingMissingInputs,
    collectorOriginalLiters,
    collectorLostLiters,
    collectorEffectiveLiters,
    collectorGross,
    collectorPricePerLiter,
    collectorFarmersValidLiters,
    collectorSurplusLiters,
    collectorSurplusAmount,
    collectorFarmerMilkValue: farmerMilkValue,
    collectorTotalFarmersPayable: collectorFarmerPayable,
    collectorFarmerPayable,
    collectorFarmerDeductions,
    collectorFarmerTransport,
    collectorTransportIsComplete,
    collectorPayable,
    collectorPayableFromBreakdown,
    settlementTotal,
    isReconciled,
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
  collectorFarmerMilkValue: sheet.collectorFarmerMilkValue,
  collectorTotalFarmersPayable: sheet.collectorFarmerPayable,
  collectorFarmerPayable: sheet.collectorFarmerPayable,
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
    const grossAmount = row.milkValueComplete === false || row.grossAmount === null
      ? null
      : roundAmount(Number(row.grossAmount || 0));
    return {
      ...row,
      collectorUserId: Number(row.collectorUserId),
      role: 'collector',
      totalVolume: roundAmount(Number(row.totalVolume || 0)),
      grossAmount,
      totalTransport: 0,
      totalDeductions: grossAmount,
      netAmount: grossAmount,
      isReconciled: grossAmount === null ? null : true,
    };
  });
};

const getSummary = async ({ ownerUserId, actorId = ownerUserId, query: rawQuery = {}, repository = defaultRepository, settlementRepository = null, now = new Date() }) => {
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
  const farmerTotals = sortAccountingRows(loadedFarmerTotals
    .filter((farmer) => Number(farmer.totalVolume || 0) > 0)
    .map((farmer) => {
      const base = {
        ...farmer,
        milkValueComplete: farmer.milkValueComplete !== false,
        transportIsComplete: farmer.transportIsComplete !== false,
        totalDeductions: Number(farmer.totalDeductions || 0),
        ifishiTotalDeductions: roundAmount(Number(farmer.totalDeductions || 0)),
        ifishiNetAmount: farmer.transportIsComplete === false || farmer.milkValueComplete === false ? null : roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalTransport || 0) - Number(farmer.totalDeductions || 0)),
        netAmount: farmer.transportIsComplete === false || farmer.milkValueComplete === false ? null : roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalTransport || 0) - Number(farmer.totalDeductions || 0)),
      };
      if (isDairy) {
        return {
          ...base,
          transportIsComplete: true,
          totalTransport: 0,
          netAmount: farmer.milkValueComplete === false ? null : roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0)),
          ifishiNetAmount: farmer.milkValueComplete === false ? null : roundAmount(Number(farmer.grossAmount || 0) - Number(farmer.totalDeductions || 0)),
        };
      }
      return base;
    }), filters.sortBy, filters.sortDirection);
  const milkLossRecords = repository.getMilkLossRecords
    ? await repository.getMilkLossRecords({ ownerUserId: farmerOwnerId, rangeStart, rangeEnd, centerFilter, farmerId: filters.farmerId, collectorUserId: farmerCollectorUserId })
    : [];
  const transportIsComplete = !isCollector || farmerTotals.every((farmer) => farmer.transportIsComplete !== false);
  const totalTransport = isCollector
    ? transportIsComplete ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.totalTransport || 0), 0)) : null
    : 0;
  const farmerMilkValueIsComplete = farmerTotals.every((farmer) => farmer.milkValueComplete !== false);
  const grossAmount = farmerMilkValueIsComplete
    ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.grossAmount || 0), 0))
    : null;
  let netAmount = isCollector
    ? transportIsComplete ? roundAmount(farmerTotals.reduce((sum, farmer) => sum + Number(farmer.netAmount || 0), 0)) : null
    : grossAmount === null ? null : roundAmount(grossAmount - Number(totalDeductions || 0));
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
  if (isCollector && ownSheet) totalDeductions = Number(ownSheet.collectorFarmerDeductions || 0);
  if (isDairy) {
    totalDeductions = dairyFarmerDeductions;
    netAmount = grossAmount === null ? null : roundAmount(grossAmount - dairyFarmerDeductions);
  }
  const collectorSettlementRow = collectorSettlementRows[0] || null;
  const paymentView = isCollector ? ownSheet : null;
  const collectorEntries = ownSheet?.entries || [];
  const totalVolume = Number(periodTotals.totalVolume || 0);
  const totalAmount = Number(periodTotals.totalAmount || 0);
  const ownerIfishiEntries = isCollector && repository.getOwnerIfishiHistory
    ? await repository.getOwnerIfishiHistory({ ownerUserId: ownerId, startDate: rangeStart, endDate: rangeEnd })
    : [];
  const parsedOwnerIfishiEntries = ownerIfishiEntries.map((entry) => {
    const validVolume = Number(entry.validVolumeLiters ?? entry.volumeLiters ?? entry.volume_liters ?? 0);
    const recordedPrice = Number(entry.pricePerLiter ?? entry.price_per_liter ?? 0);
    const grossAmountValue = entry.grossAmount === null || entry.grossAmount === undefined
      ? validVolume > 0 && recordedPrice > 0 ? roundAmount(validVolume * recordedPrice) : null
      : Number(entry.grossAmount || 0);
    return { validVolume, grossAmountValue, recordedPrice };
  });
  const ownerIfishiVolume = parsedOwnerIfishiEntries.reduce((sum, entry) => sum + entry.validVolume, 0);
  const ownerIfishiGross = parsedOwnerIfishiEntries.some((entry) => entry.validVolume > 0 && entry.grossAmountValue === null)
    ? null
    : roundAmount(parsedOwnerIfishiEntries.reduce((sum, entry) => sum + Number(entry.grossAmountValue || 0), 0));
  const ownerGeneratedGross = isCollector ? (parsedOwnerIfishiEntries.length ? ownerIfishiGross : ownSheet?.collectorGross ?? null) : grossAmount;
  const ownerGeneratedVolume = isCollector ? (parsedOwnerIfishiEntries.length ? ownerIfishiVolume : Number(ownSheet?.collectorEffectiveLiters ?? totalVolume)) : totalVolume;
  const ownerRowNetAmount = isCollector && ownSheet
    ? (ownerGeneratedGross === null || ownSheet.collectorFarmerMilkValue === null || ownSheet.collectorTransportIsComplete === false
      ? null
      : roundAmount(ownerGeneratedGross - Number(ownSheet.collectorFarmerMilkValue || 0) + Number(ownSheet.collectorFarmerTransport || 0) + Number(ownSheet.collectorFarmerDeductions || 0)))
    : isDairy
      ? (ownerGeneratedGross === null ? null : roundAmount(ownerGeneratedGross - Number(totalDeductions || 0)))
      : null;
  const ownerSettlementRow = isCollector ? {
    isOwner: true,
    farmerId: null,
    name: profile.name,
    farmerName: profile.name,
    nationalId: profile.nationalId || profile.national_id || null,
    phone: profile.phone || null,
    accountNumber: profile.accountNumber || profile.account_number || null,
    totalVolume: ownerGeneratedVolume,
    pricePerLiter: parsedOwnerIfishiEntries.length ? (ownerIfishiGross === null ? null : roundAmount(ownerIfishiGross / Math.max(ownerIfishiVolume, 1))) : (ownSheet?.collectorPricePerLiter ?? null),
    grossAmount: ownerGeneratedGross,
    totalTransport: ownSheet ? (ownSheet.collectorTransportIsComplete === false ? null : 0) : 0,
    totalDeductions: ownSheet?.collectorFarmerMilkValue ?? null,
    otherDeductions: ownSheet?.collectorFarmerDeductions ?? null,
    farmerPayable: ownSheet?.collectorFarmerPayable ?? null,
    netAmount: ownerRowNetAmount,
  } : isDairy ? {
    isOwner: true,
    farmerId: null,
    name: profile.name,
    farmerName: profile.name,
    nationalId: profile.nationalId || profile.national_id || null,
    phone: profile.phone || null,
    accountNumber: profile.accountNumber || profile.account_number || null,
    totalVolume,
    pricePerLiter: grossAmount === null || totalVolume <= 0 ? null : Number((grossAmount / totalVolume).toFixed(2)),
    grossAmount,
    totalTransport: 0,
    otherDeductions: 0,
    totalDeductions: Number(totalDeductions || 0),
    netAmount,
  } : null;
  let settlementAccounting = null;
  let settlementAccountingStatus = null;
  let reportFarmerTotals = farmerTotals;
  if (settlementRepository?.getPeriodFinancials && settlementAllowed && isUkweziHalfMonth && (isCollector || isDairy)) {
    try {
      settlementAccountingStatus = 'AVAILABLE';
    const settlementData = await settlementRepository.getPeriodFinancials({
      ownerUserId: farmerOwnerId,
      collectorUserId: farmerCollectorUserId,
      rangeStart,
      rangeEnd,
    });
    const settlementByFarmer = new Map();
    const getFarmerSettlement = (farmerId) => {
      const id = Number(farmerId);
      if (!settlementByFarmer.has(id)) settlementByFarmer.set(id, {
        saccoEligible: false,
        saccoEligiblePayable: 0,
        saccoDistributionInstruction: 0,
        saccoConfirmedAmount: 0,
        retainedUnpaidAmount: 0,
        cashApprovedAmount: 0,
        cashConfirmedAmount: 0,
        debtRepaymentAmount: 0,
        outstandingDebt: 0,
        debtBalanceComplete: true,
        legacyUnallocatedDebtRepayments: 0,
      });
      return settlementByFarmer.get(id);
    };
    for (const settlement of settlementData.settlements || []) {
      const entry = getFarmerSettlement(settlement.farmer_id);
      const amount = Number(settlement.amount || 0);
      const confirmed = settlement.status === 'CONFIRMED';
      if (settlement.payment_type === 'CASH') {
        if (settlement.status === 'APPROVED' || confirmed) entry.cashApprovedAmount += amount;
        if (confirmed) entry.cashConfirmedAmount += Number(settlement.settled_amount || amount);
      } else if (settlement.payment_type === 'SACCO' && confirmed) {
        entry.saccoConfirmedAmount += Number(settlement.settled_amount || amount);
      }
    }
    for (const repayment of settlementData.repayments || []) {
      getFarmerSettlement(repayment.farmer_id).debtRepaymentAmount += Number(repayment.amount || 0);
    }
    for (const debt of settlementData.debts || []) {
      const entry = getFarmerSettlement(debt.farmer_id);
      const unallocated = Number(debt.legacy_unallocated_repayments || 0);
      entry.legacyUnallocatedDebtRepayments += unallocated;
      if (unallocated > 0) entry.debtBalanceComplete = false;
      else entry.outstandingDebt += Math.max(0, Number(debt.opening_balance || 0) - Number(debt.repaid_through_end || 0));
    }
    let expectedFarmerPayable = 0;
    let saccoEligiblePayable = 0;
    let saccoDistributionInstruction = 0;
    let saccoConfirmedAmount = 0;
    let retainedUnpaidAmount = 0;
    let cashApprovedAmount = 0;
    let cashConfirmedAmount = 0;
    let debtRepaymentAmount = 0;
    let outstandingDebt = 0;
    let legacyUnallocatedDebtRepayments = 0;
    let debtBalancesComplete = true;
    let unexplainedDiscrepancy = 0;
    reportFarmerTotals = farmerTotals.map((farmer) => {
      const details = getFarmerSettlement(farmer.farmerId);
      const payable = farmer.netAmount == null ? null : Number(farmer.netAmount);
      const availableAfterDebtRecovery = payable === null ? null : Math.max(0, payable - details.debtRepaymentAmount);
      details.saccoEligible = Boolean(farmer.accountNumber && String(farmer.accountNumber).trim() && !['N/A', 'NA'].includes(String(farmer.accountNumber).trim().toUpperCase()) && String(farmer.accountNumber).trim().length >= 4);
      details.saccoEligiblePayable = details.saccoEligible ? Number(payable || 0) : 0;
      details.availableAfterDebtRecovery = availableAfterDebtRecovery;
      details.saccoDistributionInstruction = details.saccoEligible && availableAfterDebtRecovery !== null ? Math.max(0, availableAfterDebtRecovery - details.saccoConfirmedAmount) : 0;
      details.retainedUnpaidAmount = !details.saccoEligible && availableAfterDebtRecovery !== null ? Math.max(0, availableAfterDebtRecovery - details.cashConfirmedAmount) : 0;
      const saccoUnpaidAmount = details.saccoEligible && availableAfterDebtRecovery !== null ? Math.max(0, availableAfterDebtRecovery - details.saccoConfirmedAmount) : 0;
      const paidOverage = details.cashConfirmedAmount + details.saccoConfirmedAmount + details.debtRepaymentAmount - Number(payable || 0);
      details.unexplainedDiscrepancy = payable === null ? null : roundAmount(paidOverage > 0 ? -paidOverage : 0);
      if (payable !== null) {
        expectedFarmerPayable += payable;
        unexplainedDiscrepancy += Number(details.unexplainedDiscrepancy || 0);
      }
      saccoEligiblePayable += details.saccoEligiblePayable;
      saccoDistributionInstruction += details.saccoDistributionInstruction;
      saccoConfirmedAmount += details.saccoConfirmedAmount;
      retainedUnpaidAmount += details.retainedUnpaidAmount;
      cashApprovedAmount += details.cashApprovedAmount;
      cashConfirmedAmount += details.cashConfirmedAmount;
      debtRepaymentAmount += details.debtRepaymentAmount;
      if (details.debtBalanceComplete) outstandingDebt += details.outstandingDebt;
      else debtBalancesComplete = false;
      legacyUnallocatedDebtRepayments += details.legacyUnallocatedDebtRepayments;
      return { ...farmer, settlement: { ...details, outstandingDebt: details.debtBalanceComplete ? roundAmount(details.outstandingDebt) : null } };
    });
    const settlementBreakdown = reportFarmerTotals.reduce((sum, farmer) => {
      if (farmer.netAmount == null) return sum;
      const details = farmer.settlement;
      const saccoUnpaid = details.saccoEligible ? Math.max(0, Number(farmer.netAmount) - details.debtRepaymentAmount - details.saccoConfirmedAmount) : 0;
      return sum + Number(farmer.netAmount) - details.debtRepaymentAmount - details.cashConfirmedAmount - details.saccoConfirmedAmount
        - details.retainedUnpaidAmount - saccoUnpaid - Number(details.unexplainedDiscrepancy || 0);
    }, 0);
    const farmerGross = farmerMilkValueIsComplete ? grossAmount : null;
    const ownerGrossValue = isCollector ? ownerGeneratedGross ?? null : grossAmount;
    const ownerGrossDiscrepancy = isCollector
      ? ownerGrossValue === null || ownSheet?.collectorFarmerMilkValue === null || ownSheet?.collectorSurplusAmount === null
        ? null
        : roundAmount(ownerGrossValue - ownSheet.collectorFarmerMilkValue - ownSheet.collectorSurplusAmount)
      : ownerGrossValue === null || farmerGross === null ? null : roundAmount(ownerGrossValue - farmerGross);
    settlementAccounting = {
      rangeStart,
      rangeEnd,
      farmerGross,
      expectedFarmerPayable: roundAmount(expectedFarmerPayable),
      saccoEligiblePayable: roundAmount(saccoEligiblePayable),
      saccoDistributionInstruction: roundAmount(saccoDistributionInstruction),
      saccoConfirmedAmount: roundAmount(saccoConfirmedAmount),
      retainedUnpaidAmount: roundAmount(retainedUnpaidAmount),
      cashApprovedAmount: roundAmount(cashApprovedAmount),
      cashConfirmedAmount: roundAmount(cashConfirmedAmount),
      debtRepaymentAmount: roundAmount(debtRepaymentAmount),
      outstandingDebt: debtBalancesComplete ? roundAmount(outstandingDebt) : null,
      legacyUnallocatedDebtRepayments: roundAmount(legacyUnallocatedDebtRepayments),
      debtBalancesComplete,
      unexplainedDiscrepancy: roundAmount(unexplainedDiscrepancy + settlementBreakdown),
      ownerGrossReconciliation: {
        ownerGross: ownerGrossValue,
        farmerGross: isCollector ? ownSheet?.collectorFarmerMilkValue ?? null : farmerGross,
        surplus: isCollector ? ownSheet?.collectorSurplusAmount ?? null : 0,
        discrepancy: ownerGrossDiscrepancy,
      },
      farmers: reportFarmerTotals,
    };
    } catch (error) {
      if (error.code !== '42P01') throw error;
      settlementAccountingStatus = 'MIGRATION_REQUIRED';
    }
  }
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
        ? grossAmount === null ? null : roundAmount(grossAmount - dairyFarmerDeductions)
        : netAmount,
    todayMorning: Number(todayTotals.todayMorning || 0),
    todayEvening: Number(todayTotals.todayEvening || 0),
    todayTotal: Number(todayTotals.todayTotal || 0),
    todayAmount: Number(todayTotals.todayAmount || 0),
    expectedAmount: Number(todayTotals.todayAmount || 0),
    farmerPayments: reportFarmerTotals,
    monthlyFarmerTotals: reportFarmerTotals,
    settlementAccounting,
    milkLossRecords,
    collectorActualVolume: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorEffectiveVolume: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorEffectiveLiters: ownSheet?.collectorEffectiveLiters ?? 0,
    collectorOriginalVolume: ownSheet?.collectorOriginalLiters ?? 0,
    collectorLostVolume: ownSheet?.collectorLostLiters ?? 0,
    collectorGross: ownSheet?.collectorGross ?? null,
    collectorFarmerMilkValue: ownSheet?.collectorFarmerMilkValue ?? null,
    collectorTotalFarmersPayable: ownSheet?.collectorFarmerPayable ?? null,
    collectorFarmerPayable: ownSheet?.collectorFarmerPayable ?? null,
    collectorFarmerDeductions: ownSheet?.collectorFarmerDeductions ?? 0,
    collectorFarmerTransport: isCollector ? (ownSheet ? ownSheet.collectorFarmerTransport : 0) : 0,
    collectorTransportIsComplete: isCollector ? (ownSheet?.collectorTransportIsComplete ?? true) : true,
    collectorFarmersValidLiters: ownSheet?.collectorFarmersValidLiters ?? 0,
    collectorSurplusLiters: ownSheet?.collectorSurplusLiters ?? 0,
    collectorSurplusAmount: ownSheet?.collectorSurplusAmount ?? null,
    collectorPayable: paymentView?.collectorPayable ?? null,
    collectorPayableFromBreakdown: paymentView?.collectorPayableFromBreakdown ?? null,
    collectorIsReconciled: paymentView?.isReconciled ?? null,
    collectorAccountingComplete: ownSheet?.accountingComplete ?? null,
    collectorAccountingMissingInputs: ownSheet?.accountingMissingInputs ?? [],
    collectorSettlementTotal: paymentView?.settlementTotal ?? null,
    collectorSettlementRow,
    collectorSettlementRows: sortAccountingRows(collectorSettlementRows, filters.sortBy, filters.sortDirection),
    ownerSettlementRow,
    settlementAccountingStatus,
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

module.exports = { formatDate, getPeriodRange, normalizeFilters, sortAccountingRows, calculateCollectorBalanceSheet, projectSettlementRow, buildDairyCollectorSettlementRows, getSummary };
