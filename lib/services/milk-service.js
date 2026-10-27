const defaultRepository = require('../repositories/milkRepository.js');
const { getAccountingDate } = require('../utils/accounting-period.js');
const inputError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const normalizeDailySortCursor = (value, sortBy, sortDirection) => {
  try {
    const token = String(value);
    if (!token.startsWith('d1.')) throw new Error();
    const cursor = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    if (cursor.sortBy !== sortBy || cursor.sortDirection !== sortDirection
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0
      || (sortBy === 'totalVolume' ? !Number.isFinite(Number(cursor.value)) : typeof cursor.value !== 'string')) throw new Error();
    return { value: cursor.value, id: cursor.id };
  } catch {
    throw inputError('Invalid daily collection cursor.');
  }
};

const isIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const normalizeVolume = (value, field) => {
  if (value === undefined || value === null || value === '') return 0;
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0) throw inputError(`${field} must be a valid non-negative number.`);
  return volume;
};

const calculateMilkAmount = ({ volumeMorning, volumeEvening, pricePerLiter }) => {
  const totalVolume = volumeMorning + volumeEvening;
  return {
    totalVolume,
    amount: Number((totalVolume * pricePerLiter).toFixed(2)),
    pricePerLiter,
  };
};

const recordMilk = async ({
  ownerUserId,
  actorId = ownerUserId,
  collectorUserId,
  farmerId,
  date,
  volumeMorning,
  volumeEvening,
  strictInsert = false,
  repository = defaultRepository,
}) => {
  const parsedFarmerId = Number(farmerId);
  if (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0) throw inputError('farmerId is required.');
  if (!isIsoDate(date)) throw inputError('A valid date (YYYY-MM-DD) is required.');
  const morning = normalizeVolume(volumeMorning, 'volumeMorning');
  const evening = normalizeVolume(volumeEvening, 'volumeEvening');
  if (morning + evening <= 0) throw inputError('Total volume must be greater than zero.');

  let recordOwnerUserId = Number(ownerUserId);
  const parsedCollectorUserId = collectorUserId === undefined || collectorUserId === null ? null : Number(collectorUserId);
  if (parsedCollectorUserId !== null) {
    if (!Number.isSafeInteger(parsedCollectorUserId) || parsedCollectorUserId <= 0 || parsedCollectorUserId !== recordOwnerUserId) {
      throw Object.assign(new Error('Collector is not assigned to this account.'), { statusCode: 403 });
    }
    const scope = await repository.getCollectorFarmerScope({ collectorUserId: parsedCollectorUserId, farmerId: parsedFarmerId });
    if (!scope) {
      const error = new Error('Farmer is not assigned to this collector.');
      error.statusCode = 403;
      throw error;
    }
    recordOwnerUserId = Number(scope.ownerUserId);
  }

  const context = await repository.getMilkContext({ ownerUserId: recordOwnerUserId, farmerId: parsedFarmerId, date });
  if (!context) {
    const error = new Error('Farmer not found.');
    error.statusCode = 400;
    throw error;
  }
  if (!context.center || context.pricePerLiter === null || context.pricePerLiter === undefined) {
    const error = new Error('Farmer must belong to a configured collection center before recording milk.');
    error.statusCode = 400;
    throw error;
  }

  const pricePerLiter = Number(context.pricePerLiter);
  const calculated = calculateMilkAmount({ volumeMorning: morning, volumeEvening: evening, pricePerLiter });
  const result = await repository.upsertMilkRecord({
    ownerUserId: recordOwnerUserId,
    actorId: Number(actorId),
    collectorUserId: parsedCollectorUserId,
    farmerId: parsedFarmerId,
    date,
    collectionCenterId: Number(context.center.id),
    period: 'daily',
    collectionSession: {
      ownerUserId: recordOwnerUserId,
      collectorUserId: parsedCollectorUserId,
      date,
      period: 'daily',
      collectionCenterId: Number(context.center.id),
    },
    volumeMorning: morning,
    volumeEvening: evening,
    volume: calculated.totalVolume,
    pricePerLiter: calculated.pricePerLiter,
    amount: calculated.amount,
    transportRatePerLiter: Number(context.center.transportRatePerLiter || 0),
    strictInsert: Boolean(strictInsert),
  });

  if (result.duplicate) {
    const changed = result.conflict === 'changed';
    const error = new Error(changed
      ? 'A different milk record already exists for this farmer and date. It was not changed. Use the correction workflow if needed.'
      : 'Milk record already exists for this farmer, date, and session with identical values.');
    error.code = changed ? 'MILK_RECORD_CONFLICT' : 'DUPLICATE_MILK_RECORD';
    error.statusCode = 409;
    error.conflict = result.conflict || 'identical';
    error.existingRecordId = result.existingRecordId ?? result.record?.id;
    throw error;
  }

  return {
    record: result.record,
    statusCode: result.created ? 201 : 200,
  };
};

const getMilkRecord = async ({ id, ownerUserId, repository = defaultRepository }) => {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) throw inputError('Invalid milk record id.');
  return repository.getMilkRecord(recordId, Number(ownerUserId));
};

const decodeMilkRecordCursor = (value, sortBy, sortDirection) => {
  try {
    const token = String(value);
    if (!token.startsWith('m1.')) throw new Error();
    const cursor = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    if (cursor.sortBy !== sortBy || cursor.sortDirection !== sortDirection || !isIsoDate(cursor.date)
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0
      || (['volume', 'amount'].includes(sortBy) ? !Number.isFinite(Number(cursor.value)) : typeof cursor.value !== 'string')) throw new Error();
    return cursor;
  } catch {
    throw inputError('Invalid milk record cursor.');
  }
};

const listMilkRecords = async ({ ownerUserId, collectorUserId = null, search, farmerId, center, startDate, endDate, session, sortBy, sortDirection, cursor, limit = 50, repository = defaultRepository }) => {
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw inputError('limit must be an integer between 1 and 100.');
  if (startDate && !isIsoDate(startDate)) throw inputError('Invalid startDate. Expected YYYY-MM-DD.');
  if (endDate && !isIsoDate(endDate)) throw inputError('Invalid endDate. Expected YYYY-MM-DD.');
  if (startDate && endDate && startDate > endDate) throw inputError('startDate must be before endDate.');
  const parsedFarmerId = farmerId ? Number(farmerId) : null;
  if (parsedFarmerId !== null && (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0)) throw inputError('Invalid farmerId.');
  const parsedCollectorUserId = collectorUserId === null || collectorUserId === undefined || collectorUserId === '' ? null : Number(collectorUserId);
  if (parsedCollectorUserId !== null && (!Number.isSafeInteger(parsedCollectorUserId) || parsedCollectorUserId !== Number(ownerUserId))) {
    throw Object.assign(new Error('Collector scope must match the authenticated account.'), { statusCode: 403 });
  }
  const parsedSession = String(session || 'all').toLowerCase();
  if (!['all', 'morning', 'evening'].includes(parsedSession)) throw inputError('session must be all, morning, or evening.');
  const allowedSorts = ['date', 'farmerName', 'volume', 'amount'];
  const parsedSortBy = sortBy || 'date';
  const parsedSortDirection = String(sortDirection || 'desc').toLowerCase();
  if (!allowedSorts.includes(parsedSortBy)) throw inputError('Unsupported milk record sort field.');
  if (!['asc', 'desc'].includes(parsedSortDirection)) throw inputError('sortDirection must be asc or desc.');
  let parsedCursor = cursor ? String(cursor) : null;
  if (parsedCursor) {
    if (parsedSortBy === 'date' && !sortBy && /^\d{4}-\d{2}-\d{2}:\d+$/.test(parsedCursor)) {
      const [date, id] = parsedCursor.split(':');
      parsedCursor = { date, id: Number(id), value: date };
    } else parsedCursor = decodeMilkRecordCursor(parsedCursor, parsedSortBy, parsedSortDirection);
  }
  return repository.listMilkRecords({
    ownerUserId: Number(ownerUserId),
    collectorUserId: parsedCollectorUserId,
    search: typeof search === 'string' ? search.trim().slice(0, 100) : '',
    farmerId: parsedFarmerId,
    center: typeof center === 'string' ? center.trim() : '',
    session: parsedSession,
    sortBy: parsedSortBy,
    sortDirection: parsedSortDirection,
    startDate: startDate || null,
    endDate: endDate || null,
    cursor: parsedCursor,
    limit: pageSize,
  });
};

const getDailyCollection = async ({ ownerUserId, accountType = 'COLLECTOR', collectorUserId, date, centerId, center, cursor, limit = 50, search = '', session = 'all', deliveryStatus = 'all', sortBy, sortDirection, repository = defaultRepository }) => {
  if (!isIsoDate(date)) throw inputError('Invalid date. Expected YYYY-MM-DD.');
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw inputError('limit must be an integer between 1 and 100.');
  const parsedCenterId = centerId ? Number(centerId) : null;
  if (parsedCenterId !== null && (!Number.isSafeInteger(parsedCenterId) || parsedCenterId <= 0)) {
    throw inputError('Invalid collection center ID.');
  }
  const parsedCollectorUserId = collectorUserId === undefined || collectorUserId === null || collectorUserId === '' ? null : Number(collectorUserId);
  if (parsedCollectorUserId !== null && (!Number.isSafeInteger(parsedCollectorUserId) || parsedCollectorUserId <= 0)) {
    throw inputError('Invalid collector user id.');
  }
  const parsedSession = String(session || 'all').trim().toLowerCase();
  if (!['all', 'morning', 'evening'].includes(parsedSession)) throw inputError('session must be all, morning, or evening.');
  const parsedDeliveryStatus = String(deliveryStatus || 'all').trim().toLowerCase();
  if (!['all', 'delivered', 'missing'].includes(parsedDeliveryStatus)) throw inputError('deliveryStatus must be all, delivered, or missing.');
  const parsedSortBy = String(sortBy || 'farmerId');
  const parsedSortDirection = String(sortDirection || 'desc').toLowerCase();
  const sortOptions = sortBy ? { sortBy: parsedSortBy, sortDirection: parsedSortDirection } : {};
  if (!['farmerId', 'farmerName', 'totalVolume'].includes(parsedSortBy)) throw inputError('Unsupported daily collection sort field.');
  if (!['asc', 'desc'].includes(parsedSortDirection)) throw inputError('sortDirection must be asc or desc.');
  const parsedSearch = typeof search === 'string' ? search.trim().slice(0, 100) : '';
  const requestedCenter = typeof center === 'string' ? center.trim() : '';
  if (accountType === 'COLLECTION_CENTER') {
    if (!parsedCenterId) throw inputError('An active collection center is required.');
    let parsedCursor = cursor ? Number(cursor) : null;
    if (cursor && parsedSortBy !== 'farmerId') parsedCursor = normalizeDailySortCursor(cursor, parsedSortBy, parsedSortDirection);
    if (parsedSortBy === 'farmerId' && parsedCursor !== null && (!Number.isSafeInteger(parsedCursor) || parsedCursor <= 0)) throw inputError('Invalid collector cursor.');
    const dairyResult = await repository.getDairyDailyCollection({
      dairyUserId: Number(ownerUserId),
      date,
      centerId: parsedCenterId,
      cursor: parsedCursor,
      limit: pageSize,
      search: parsedSearch,
      session: parsedSession,
      deliveryStatus: parsedDeliveryStatus,
      collectorUserId: parsedCollectorUserId,
      ...sortOptions,
    });
    if (!dairyResult) throw Object.assign(new Error('Collection center not found.'), { statusCode: 404 });
    return {
      farmers: dairyResult.farmers.map((farmer) => ({
        ...farmer,
        collectionCenter: farmer.collectionCenter || dairyResult.center.name,
        abacundaCount: dairyResult.summary.totalFarmers,
        presentCount: farmer.deliveryStatus === 'delivered' ? 1 : 0,
        status: farmer.recordId ? farmer.status : 'missing',
        deliveryStatus: farmer.deliveryStatus || (farmer.recordId ? 'delivered' : 'missing'),
      })),
      summary: dairyResult.summary,
      farmerPagination: dairyResult.pagination,
      center: dairyResult.center.name,
      centers: [dairyResult.center.name],
      collectorMilk: [],
    };
  }
  if (!parsedCenterId && !requestedCenter && !parsedCollectorUserId) throw inputError('Collection center is not configured for this account.');
  let parsedCursor = cursor ? Number(cursor) : null;
  if (cursor && parsedSortBy !== 'farmerId') parsedCursor = normalizeDailySortCursor(cursor, parsedSortBy, parsedSortDirection);
  if (parsedSortBy === 'farmerId' && parsedCursor !== null && (!Number.isSafeInteger(parsedCursor) || parsedCursor <= 0)) throw inputError('Invalid farmer cursor.');
  const result = await repository.getDailyCollection({
    ownerUserId: Number(ownerUserId),
    collectorUserId: parsedCollectorUserId,
    date,
    centerId: parsedCenterId,
    center: requestedCenter,
    centerName: requestedCenter,
    cursor: parsedCursor,
    limit: pageSize,
    search: parsedSearch,
    session: parsedSession,
    deliveryStatus: parsedDeliveryStatus,
    ...sortOptions,
  });
  if (!result) {
    const error = new Error('Collection center not found.');
    error.statusCode = 404;
    throw error;
  }
  return result;
};

const getFarmerDeliveryHistory = async ({
  ownerUserId,
  collectorUserId = null,
  farmerId,
  startDate,
  endDate,
  session = 'all',
  today = getAccountingDate(),
  repository = defaultRepository,
}) => {
  const parsedFarmerId = Number(farmerId);
  if (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0) throw inputError('Invalid farmer id.');
  const parsedCollectorUserId = collectorUserId === undefined || collectorUserId === null || collectorUserId === ''
    ? null
    : Number(collectorUserId);
  if (parsedCollectorUserId !== null && (!Number.isSafeInteger(parsedCollectorUserId) || parsedCollectorUserId <= 0)) {
    throw inputError('Invalid collector user id.');
  }
  const parsedSession = String(session || 'all').trim().toLowerCase();
  if (!['all', 'morning', 'evening'].includes(parsedSession)) throw inputError('session must be all, morning, or evening.');
  const fallbackStart = `${today.slice(0, 7)}-01`;
  const rangeStart = startDate || fallbackStart;
  const rangeEnd = endDate || today;
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd)) throw inputError('A valid history date range is required.');
  if (rangeStart > rangeEnd) throw inputError('startDate must be before endDate.');
  return repository.getFarmerDeliveryHistory({
    ownerUserId: Number(ownerUserId),
    collectorUserId: parsedCollectorUserId,
    farmerId: parsedFarmerId,
    startDate: rangeStart,
    endDate: rangeEnd,
    session: parsedSession,
    today,
  });
};

const getAbacundaIfishiHistory = async ({ dairyUserId, collectorUserId, centerId, startDate, endDate, repository = defaultRepository }) => {
  const parsedDairyId = Number(dairyUserId);
  const parsedCollectorId = Number(collectorUserId);
  const parsedCenterId = Number(centerId);
  if (!Number.isSafeInteger(parsedDairyId) || parsedDairyId <= 0
      || !Number.isSafeInteger(parsedCollectorId) || parsedCollectorId <= 0
      || !Number.isSafeInteger(parsedCenterId) || parsedCenterId <= 0) {
    throw inputError('A valid Abacunda and active Ikigo are required.');
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw inputError('A valid Ifishi date range is required.');
  }
  const entries = await repository.getAbacundaIfishiHistory({
    dairyUserId: parsedDairyId,
    collectorUserId: parsedCollectorId,
    centerId: parsedCenterId,
    startDate,
    endDate,
  });
  return {
    startDate,
    endDate,
    entries,
    totals: entries.reduce((totals, entry) => ({
      morningLiters: totals.morningLiters + entry.morningLiters,
      eveningLiters: totals.eveningLiters + entry.eveningLiters,
      originalLiters: totals.originalLiters + entry.originalLiters,
      validLiters: totals.validLiters + entry.validLiters,
      lostLiters: totals.lostLiters + entry.lostLiters,
    }), { morningLiters: 0, eveningLiters: 0, originalLiters: 0, validLiters: 0, lostLiters: 0 }),
  };
};

const getMilkTemplate = async ({ ownerUserId, farmerId, month, year, repository = defaultRepository, now = new Date() }) => {
  const parsedFarmerId = Number(farmerId);
  const parsedMonth = month ? Number(month) : now.getMonth() + 1;
  const parsedYear = year ? Number(year) : now.getFullYear();
  if (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0
      || !Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12
      || !Number.isInteger(parsedYear) || parsedYear < 2000) {
    throw inputError('Invalid farmer, month, or year.');
  }
  return repository.getMilkTemplate({ farmerId: parsedFarmerId, ownerUserId: Number(ownerUserId), month: parsedMonth, year: parsedYear });
};

const validateTemplateRows = (rows, month, year) => {
  if (!Array.isArray(rows)) throw inputError('rows must be an array.');
  const daysInMonth = new Date(year, month, 0).getDate();
  return rows.map((row, index) => {
    const day = Number(row?.day);
    const morning = row?.volumeMorning === undefined || row.volumeMorning === null || row.volumeMorning === '' ? 0 : Number(row.volumeMorning);
    const evening = row?.volumeEvening === undefined || row.volumeEvening === null || row.volumeEvening === '' ? 0 : Number(row.volumeEvening);
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) throw inputError(`Row ${index + 1}: day must be between 1 and ${daysInMonth}.`);
    if (!Number.isFinite(morning) || morning < 0) throw inputError(`Row ${index + 1}: volumeMorning must be a non-negative number.`);
    if (!Number.isFinite(evening) || evening < 0) throw inputError(`Row ${index + 1}: volumeEvening must be a non-negative number.`);
    return { day, volumeMorning: morning, volumeEvening: evening };
  });
};

const saveMilkTemplate = async ({ ownerUserId, actorId = ownerUserId, collectorUserId, farmerId, month, year, rows, repository = defaultRepository }) => {
  const parsedFarmerId = Number(farmerId);
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isSafeInteger(parsedFarmerId) || parsedFarmerId <= 0 || !Number.isInteger(parsedMonth)
      || parsedMonth < 1 || parsedMonth > 12 || !Number.isInteger(parsedYear) || parsedYear < 2000) {
    throw inputError('Invalid template payload.');
  }
  const normalizedRows = validateTemplateRows(rows, parsedMonth, parsedYear);
  for (const row of normalizedRows) {
    if (row.volumeMorning + row.volumeEvening <= 0) continue;
    const date = `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`;
    try {
      await recordMilk({
        ownerUserId,
        actorId,
        collectorUserId,
        farmerId: parsedFarmerId,
        date,
        volumeMorning: row.volumeMorning,
        volumeEvening: row.volumeEvening,
        repository,
      });
    } catch (error) {
      if (error.code !== 'DUPLICATE_MILK_RECORD') throw error;
    }
  }
  return repository.getMilkTemplate({
    farmerId: parsedFarmerId,
    ownerUserId: Number(ownerUserId),
    month: parsedMonth,
    year: parsedYear,
  });
};

const updateMilkRecord = async ({ id, ownerUserId, actorId = ownerUserId, date, volumeMorning, volumeEvening, repository = defaultRepository }) => {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) throw inputError('Invalid milk record id.');
  if (!isIsoDate(date)) throw inputError('A valid date (YYYY-MM-DD) is required.');
  const morning = normalizeVolume(volumeMorning, 'volumeMorning');
  const evening = normalizeVolume(volumeEvening, 'volumeEvening');
  if (morning + evening <= 0) throw inputError('Total volume must be greater than zero.');

  const existing = await repository.getMilkRecord(recordId, Number(ownerUserId));
  if (!existing) return null;
  const context = await repository.getMilkContext({
    ownerUserId: Number(ownerUserId),
    farmerId: Number(existing.farmer_id ?? existing.farmerId),
    date,
  });
  if (!context || !context.center || context.pricePerLiter === null || context.pricePerLiter === undefined) {
    const error = new Error('Farmer must belong to a configured collection center before updating milk.');
    error.statusCode = 400;
    throw error;
  }
  const amount = calculateMilkAmount({
    volumeMorning: morning,
    volumeEvening: evening,
    pricePerLiter: Number(context.pricePerLiter),
  });
  try {
    const record = await repository.updateMilkRecord({
      id: recordId,
      ownerUserId: Number(ownerUserId),
      actorId: Number(actorId),
      date,
      collectionCenterId: Number(context.center.id),
      volumeMorning: morning,
      volumeEvening: evening,
      volume: amount.totalVolume,
      pricePerLiter: amount.pricePerLiter,
      amount: amount.amount,
    });
    return record;
  } catch (error) {
    if (error.code === '23505') {
      error.statusCode = 409;
      error.message = 'A milk record already exists for this farmer and date.';
    }
    throw error;
  }
};

const voidMilkRecord = async ({ id, ownerUserId, actorId = ownerUserId, reason, repository = defaultRepository }) => {
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId <= 0) throw inputError('Invalid milk record id.');
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!normalizedReason || normalizedReason.length > 500) throw inputError('A void reason of at most 500 characters is required.');
  return repository.voidMilkRecord({ id: recordId, ownerUserId: Number(ownerUserId), actorId: Number(actorId), reason: normalizedReason });
};

const IMPORT_MAX_ROWS = 100;

/**
 * Import reviewed notebook rows through the normal recordMilk path. The only
 * difference is strictInsert: an existing record is reported, never updated and
 * never duplicated. Every row is independently authorized and priced.
 */
const importMilkRecords = async ({
  ownerUserId,
  actorId = ownerUserId,
  collectorUserId,
  date,
  rows,
  repository = defaultRepository,
}) => {
  if (!isIsoDate(date)) throw inputError('A valid date (YYYY-MM-DD) is required.');
  if (!Array.isArray(rows) || !rows.length) throw inputError('Add at least one milk row to import.');
  if (rows.length > IMPORT_MAX_ROWS) throw inputError(`Import at most ${IMPORT_MAX_ROWS} milk rows at a time.`);
  const results = [];
  let created = 0;
  let duplicates = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const rowNumber = Number.isSafeInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0
      ? Number(row.rowNumber)
      : index + 1;
    try {
      const result = await recordMilk({
        ownerUserId: Number(ownerUserId),
        actorId: Number(actorId),
        collectorUserId,
        farmerId: row.farmerId,
        date,
        volumeMorning: row.volumeMorning ?? row.volume ?? 0,
        volumeEvening: row.volumeEvening ?? 0,
        strictInsert: true,
        repository,
      });
      created += 1;
      results.push({
        rowNumber,
        farmerId: Number(row.farmerId),
        status: 'created',
        recordId: result.record?.id,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_MILK_RECORD' || error.code === 'MILK_RECORD_CONFLICT') {
        duplicates += 1;
        results.push({
          rowNumber,
          farmerId: Number(row.farmerId),
          status: error.code === 'MILK_RECORD_CONFLICT' ? 'conflict' : 'duplicate',
          errorCode: error.code,
          existingRecordId: error.existingRecordId,
          message: error.message,
        });
      } else {
        failed += 1;
        const errorCode = error.code || (error.statusCode === 403
          ? 'FORBIDDEN'
          : error.statusCode === 400
            ? 'INVALID_ROW'
            : 'MILK_IMPORT_ROW_FAILED');
        results.push({
          rowNumber,
          farmerId: row.farmerId ? Number(row.farmerId) : null,
          status: 'failed',
          errorCode,
          message: error.statusCode && error.statusCode < 500 ? error.message : 'This milk row could not be saved.',
        });
      }
    }
  }

  return {
    date,
    summary: { total: rows.length, created, duplicates, failed },
    rows: results,
  };
};

module.exports = {
  isIsoDate,
  calculateMilkAmount,
  recordMilk,
  importMilkRecords,
  getMilkRecord,
  listMilkRecords,
  getDailyCollection,
  getFarmerDeliveryHistory,
  getAbacundaIfishiHistory,
  getMilkTemplate,
  saveMilkTemplate,
  updateMilkRecord,
  voidMilkRecord,
};
