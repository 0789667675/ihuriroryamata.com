const { query } = require('../postgres.js');
const { mapDeduction } = require('./deductionRepository.js');
const { mapRow: mapCollectorRow } = require('./collectorMilkRepository.js');

const formatDateKey = (value) => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (part) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const buildFarmerTotalsQuery = ({ ownerUserId, rangeStart, rangeEnd, centerFilter = null, farmerId = null, collectorUserId = null }) => {
  const values = [ownerUserId, rangeStart, rangeEnd];
  const farmerConditions = ['f.owner_user_id = $1'];
  if (farmerId) {
    values.push(farmerId);
    farmerConditions.push(`f.id = $${values.length}`);
  }
  if (centerFilter) {
    values.push(centerFilter);
    farmerConditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    farmerConditions.push(`f.collector_user_id = $${values.length}`);
  }
  const sql = `SELECT f.id AS "farmerId", f.name AS "farmerName", f.location AS village,
      f.phone, f.national_id AS "nationalId", f.account_number AS "accountNumber",
      f.collection_center AS "collectionCenter",
      COALESCE(m.total_morning, 0) AS "totalMorning",
      COALESCE(m.total_evening, 0) AS "totalEvening",
      COALESCE(m.total_volume, 0) AS "totalVolume",
      COALESCE(m.original_volume, 0) AS "originalVolume",
      COALESCE(m.lost_volume, 0) AS "lostVolume",
      COALESCE(m.gross_amount, 0) AS "grossAmount",
      COALESCE(m.priced_volume_amount, 0) AS "pricedVolumeAmount",
      COALESCE(m.total_transport, 0) AS "totalTransport",
      COALESCE(d.total_deductions, 0) AS "totalDeductions",
      COALESCE(d.total_other, 0) AS "totalOther",
      COALESCE(d.total_advance, 0) AS "totalAdvance",
      COALESCE(d.total_umwenda, 0) AS "totalUmwenda"
    FROM farmers f
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(mr.valid_volume_morning, mr.volume_morning)) AS total_morning,
        SUM(COALESCE(mr.valid_volume_evening, mr.volume_evening)) AS total_evening,
        SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters)) AS total_volume,
        SUM(COALESCE(mr.original_volume_liters, mr.volume_liters)) AS original_volume,
        SUM(COALESCE(mr.lost_volume_liters, 0)) AS lost_volume,
        SUM(COALESCE(mr.valid_amount, CASE WHEN mr.amount > 0 THEN mr.amount ELSE mr.volume_liters * COALESCE(NULLIF(mr.price_per_liter, 0), cp.price_per_liter, c.price_per_liter, 0) END)) AS gross_amount,
        SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters) * COALESCE(c.transport_rate_per_liter, 0)) AS total_transport,
        SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters) * COALESCE(NULLIF(mr.price_per_liter, 0), cp.price_per_liter, c.price_per_liter, 0)) AS priced_volume_amount
      FROM milk_records mr
      LEFT JOIN collection_centers c ON c.owner_user_id = f.owner_user_id
        AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
      LEFT JOIN LATERAL (
        SELECT prices.price_per_liter FROM collection_center_prices prices
        WHERE prices.collection_center_id = c.id AND prices.owner_user_id = f.owner_user_id
          AND prices.effective_date <= mr.date
        ORDER BY prices.effective_date DESC, prices.id DESC LIMIT 1
      ) cp ON TRUE
      WHERE mr.farmer_id = f.id AND mr.owner_user_id = f.owner_user_id
        AND mr.date BETWEEN $2 AND $3 AND COALESCE(mr.status, 'valid') <> 'cancelled'
    ) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(d.amount) AS total_deductions,
        SUM(CASE WHEN LOWER(BTRIM(d.type)) = 'other' THEN d.amount ELSE 0 END) AS total_other,
        SUM(CASE WHEN LOWER(BTRIM(d.type)) = 'advance' THEN d.amount ELSE 0 END) AS total_advance,
        SUM(CASE WHEN LOWER(BTRIM(d.type)) = 'umwenda' THEN d.amount ELSE 0 END) AS total_umwenda
      FROM deductions d
      WHERE d.farmer_id = f.id AND d.owner_user_id = f.owner_user_id
        AND d.status = 'Active' AND d.date BETWEEN $2 AND $3
        AND LOWER(BTRIM(d.type)) IN ('other', 'advance', 'umwenda')
    ) d ON TRUE
    WHERE ${farmerConditions.join(' AND ')}
    ORDER BY COALESCE(m.total_volume, 0) DESC, f.id ASC`;
  return { text: sql, values };
};

const mapFarmerRow = (row, defaultPricePerLiter = 0) => {
  const totalVolume = Number(row.totalVolume || 0);
  const historicalGross = Number(row.pricedVolumeAmount || 0);
  const storedGross = Number(row.grossAmount || 0);
  const grossAmount = storedGross > 0 ? storedGross : historicalGross;
  const totalTransport = Number(row.totalTransport || 0);
  const totalDeductions = Number(row.totalDeductions || 0);
  return {
    farmerId: Number(row.farmerId),
    farmerName: row.farmerName,
    name: row.farmerName,
    village: row.village,
    phone: row.phone,
    nationalId: row.nationalId,
    idNumber: row.nationalId,
    accountNumber: row.accountNumber,
    collectionCenter: row.collectionCenter || row.village || null,
    totalMorning: Number(row.totalMorning || 0),
    totalEvening: Number(row.totalEvening || 0),
    totalVolume,
    originalVolume: Number(row.originalVolume ?? totalVolume),
    lostVolume: Number(row.lostVolume || 0),
    pricePerLiter: totalVolume > 0 ? Number((historicalGross / totalVolume).toFixed(2)) : Number(defaultPricePerLiter || 0),
    grossAmount,
    totalTransport,
    totalDeductions,
    otherDeductions: Number(row.totalOther || 0),
    advanceDeductions: Number(row.totalAdvance || 0),
    umwendaDeductions: Number(row.totalUmwenda || 0),
    ifishiTotalDeductions: Number(totalDeductions.toFixed(2)),
    ifishiNetAmount: Number((grossAmount - totalTransport - totalDeductions).toFixed(2)),
    netAmount: Number((grossAmount - totalTransport - totalDeductions).toFixed(2)),
  };
};

const getFarmerTotals = async (filters) => {
  const { text, values } = buildFarmerTotalsQuery(filters);
  const { rows } = await query(text, values);
  return rows.map((row) => mapFarmerRow(row, filters.defaultPricePerLiter));
};

const buildMilkLossRecordsQuery = ({ ownerUserId, rangeStart, rangeEnd, centerFilter = null, farmerId = null, collectorUserId = null }) => {
  const values = [ownerUserId, rangeStart, rangeEnd];
  const conditions = [
    'mr.owner_user_id = $1',
    'f.owner_user_id = mr.owner_user_id',
    'mr.date BETWEEN $2 AND $3',
    "(COALESCE(mr.lost_volume_liters, 0) > 0 OR COALESCE(mr.status, 'valid') = 'cancelled')",
  ];
  if (farmerId) {
    values.push(farmerId);
    conditions.push(`f.id = $${values.length}`);
  }
  if (centerFilter) {
    values.push(centerFilter);
    conditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  return {
    text: `SELECT mr.id, mr.farmer_id AS "farmerId", f.name AS "farmerName", mr.owner_user_id AS "ownerUserId",
        mr.date, mr.status, mr.volume_liters AS "originalVolume", mr.valid_volume_liters AS "validVolume",
        mr.lost_volume_liters AS "lostVolume", mr.adjustment_reason AS reason,
        mr.adjusted_by AS "adjustedBy", mr.adjusted_at AS "adjustedAt"
      FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY mr.date DESC, mr.id DESC`,
    values,
  };
};

const getMilkLossRecords = async (filters) => {
  const { text, values } = buildMilkLossRecordsQuery(filters);
  const { rows } = await query(text, values);
  return rows.map((row) => ({
    ...row,
    date: String(row.date).slice(0, 10),
    originalVolume: Number(row.originalVolume ?? 0),
    validVolume: Number(row.status === 'cancelled' ? 0 : row.validVolume ?? row.originalVolume ?? 0),
    lostVolume: Number(row.status === 'cancelled' ? row.originalVolume ?? 0 : row.lostVolume ?? 0),
  }));
};

const getTotalFarmers = async ({ ownerUserId, centerFilter, collectorUserId = null }) => {
  const values = [ownerUserId];
  let where = 'owner_user_id = $1';
  if (centerFilter) {
    values.push(centerFilter);
    where += ` AND LOWER(BTRIM(COALESCE(NULLIF(collection_center, ''), location))) = LOWER(BTRIM($${values.length}))`;
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    where += ` AND collector_user_id = $${values.length}`;
  }
  const { rows } = await query(`SELECT COUNT(*)::integer AS total FROM farmers WHERE ${where}`, values);
  return Number(rows[0]?.total || 0);
};

const buildMilkFilter = ({ ownerUserId, rangeStart, rangeEnd, centerFilter, farmerId, collectorUserId }) => {
  const values = [ownerUserId, rangeStart, rangeEnd];
  const conditions = [
    'mr.owner_user_id = $1',
    'f.owner_user_id = mr.owner_user_id',
    'mr.date BETWEEN $2 AND $3',
    "COALESCE(mr.status, 'valid') <> 'cancelled'",
  ];
  if (farmerId) {
    values.push(farmerId);
    conditions.push(`mr.farmer_id = $${values.length}`);
  }
  if (centerFilter) {
    values.push(centerFilter);
    conditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  return { values, conditions };
};

const getPeriodTotals = async (filters) => {
  const { values, conditions } = buildMilkFilter(filters);
  const { rows } = await query(
    `SELECT COALESCE(SUM(COALESCE(mr.valid_volume_morning, mr.volume_morning)), 0) AS "totalMorning",
       COALESCE(SUM(COALESCE(mr.valid_volume_evening, mr.volume_evening)), 0) AS "totalEvening",
       COALESCE(SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters)), 0) AS "totalVolume",
       COALESCE(SUM(COALESCE(mr.valid_amount, mr.amount)), 0) AS "totalAmount"
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id WHERE ${conditions.join(' AND ')}`,
    values
  );
  return rows[0] || {};
};

const getTodayTotals = async ({ ownerUserId, date, centerFilter, collectorUserId = null }) => {
  const values = [ownerUserId, date];
  const conditions = ['mr.owner_user_id = $1', 'mr.date = $2', 'f.owner_user_id = mr.owner_user_id', "COALESCE(mr.status, 'valid') <> 'cancelled'"];
  if (centerFilter) {
    values.push(centerFilter);
    conditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  const { rows } = await query(
    `SELECT COALESCE(SUM(COALESCE(mr.valid_volume_morning, mr.volume_morning)), 0) AS "todayMorning",
       COALESCE(SUM(COALESCE(mr.valid_volume_evening, mr.volume_evening)), 0) AS "todayEvening",
       COALESCE(SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters)), 0) AS "todayTotal",
       COALESCE(SUM(COALESCE(mr.valid_amount, mr.amount)), 0) AS "todayAmount"
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id WHERE ${conditions.join(' AND ')}`,
    values
  );
  return rows[0] || {};
};

const buildTotalDeductionsQuery = ({ ownerUserId, rangeStart, rangeEnd, centerFilter = null, farmerId = null, collectorUserId = null }) => {
  const values = [ownerUserId, rangeStart, rangeEnd];
  const conditions = ['d.owner_user_id = $1', 'f.owner_user_id = d.owner_user_id', "d.status = 'Active'", 'd.date BETWEEN $2 AND $3', "LOWER(BTRIM(d.type)) IN ('other', 'advance', 'umwenda')"];
  if (farmerId) {
    values.push(farmerId);
    conditions.push(`d.farmer_id = $${values.length}`);
  }
  if (centerFilter) {
    values.push(centerFilter);
    conditions.push(`LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    conditions.push(`f.collector_user_id = $${values.length}`);
  }
  return {
    text: `SELECT COALESCE(SUM(d.amount), 0) AS total FROM deductions d
      JOIN farmers f ON f.id = d.farmer_id WHERE ${conditions.join(' AND ')}`,
    values,
  };
};

const getTotalDeductions = async (filters) => {
  const { text, values } = buildTotalDeductionsQuery(filters);
  const { rows } = await query(text, values);
  return Number(rows[0]?.total || 0);
};

const getCurrentCenterPrice = async ({ ownerUserId, centerName, date }) => {
  const { rows } = await query(
    `SELECT c.id, c.name,
       COALESCE(price.price_per_liter, c.price_per_liter) AS "pricePerLiter"
     FROM collection_centers c
     LEFT JOIN LATERAL (
       SELECT p.price_per_liter FROM collection_center_prices p
       WHERE p.collection_center_id = c.id AND p.owner_user_id = c.owner_user_id AND p.effective_date <= $3
       ORDER BY p.effective_date DESC, p.id DESC LIMIT 1
     ) price ON TRUE
     WHERE c.owner_user_id = $1 AND LOWER(BTRIM(c.name)) = LOWER(BTRIM($2)) LIMIT 1`,
    [ownerUserId, centerName, date]
  );
  return rows[0] || null;
};

const buildCollectorEntriesQuery = ({ ownerUserId, startDate, endDate }) => ({
  text: `SELECT cm.id, cm.owner_user_id, cm.date AS collection_date,
       cm.volume_liters, cm.price_per_liter, cm.status, cm.valid_volume_liters,
       cm.adjusted_by AS voided_by, cm.adjusted_at AS voided_at,
       cm.adjustment_reason AS void_reason,
       COALESCE(NULLIF(cm.price_per_liter, 0), price.price_per_liter, 0) AS applicable_price_per_liter,
       COALESCE(losses.farmer_lost_liters, 0) AS farmer_lost_liters
     FROM milk_records cm
     LEFT JOIN LATERAL (
       SELECT p.price_per_liter FROM collector_milk_prices p
       WHERE p.owner_user_id = cm.owner_user_id AND p.effective_date <= cm.date
       ORDER BY p.effective_date DESC, p.id DESC LIMIT 1
     ) price ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(mr.lost_volume_liters) AS farmer_lost_liters
       FROM milk_records mr WHERE mr.owner_user_id = cm.owner_user_id AND mr.date = cm.date
         AND mr.farmer_id IS NOT NULL AND mr.is_owner_milk = FALSE
     ) losses ON TRUE
     WHERE cm.owner_user_id = $1 AND cm.is_owner_milk = TRUE AND cm.date BETWEEN $2 AND $3
     ORDER BY cm.date ASC`,
  values: [ownerUserId, startDate, endDate],
});

const getCollectorEntries = async (filters) => {
  const { text, values } = buildCollectorEntriesQuery(filters);
  const { rows } = await query(text, values);
  return rows.map((row) => ({
    ...mapCollectorRow(row),
    pricePerLiter: Number(row.applicable_price_per_liter || 0),
    priceResolved: true,
  }));
};

const getCollectorPriceAtDate = async ({ ownerUserId, date }) => {
  const { rows } = await query(
    `SELECT price_per_liter AS "pricePerLiter" FROM collector_milk_prices
     WHERE owner_user_id = $1 AND effective_date <= $2 ORDER BY effective_date DESC, id DESC LIMIT 1`,
    [ownerUserId, date]
  );
  return rows[0] || null;
};

const getFarmerValidLitersByDate = async ({ ownerUserId, collectorUserId = null, centerFilter = null, rangeStart, rangeEnd, runQuery = query }) => {
  const values = [rangeStart, rangeEnd, ownerUserId];
  const filters = [];
  if (centerFilter) {
    values.push(centerFilter);
    filters.push(`AND LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    filters.push(`AND f.collector_user_id = $${values.length}`);
  }
  const { rows } = await runQuery(
    `SELECT mr.date, COALESCE(SUM(COALESCE(mr.valid_volume_liters, mr.volume_liters)), 0) AS valid_liters
     FROM milk_records mr JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     WHERE mr.date BETWEEN $1 AND $2 AND mr.owner_user_id = $3
       AND COALESCE(mr.status, 'valid') <> 'cancelled' ${filters.join(' ')}
     GROUP BY mr.date`,
    values
  );
  return new Map(rows.map((row) => [formatDateKey(row.date), Number(row.valid_liters || 0)]));
};

const getFarmerValidTotalsByDate = async ({ ownerUserId, collectorUserId = null, centerFilter = null, rangeStart, rangeEnd, runQuery = query }) => {
  const values = [Number(ownerUserId), rangeStart, rangeEnd];
  const filters = [];
  if (centerFilter) {
    values.push(centerFilter);
    filters.push(`AND LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`);
  }
  if (collectorUserId) {
    values.push(Number(collectorUserId));
    filters.push(`AND f.collector_user_id = $${values.length}`);
  }
  const { rows } = await runQuery(
    `SELECT mr.date,
       SUM(CASE WHEN mr.status = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END) AS valid_liters,
       SUM(COALESCE(mr.original_volume_liters, mr.volume_liters, 0)) AS original_liters,
       SUM(CASE WHEN mr.status = 'cancelled' THEN COALESCE(mr.original_volume_liters, mr.volume_liters, 0) ELSE COALESCE(mr.lost_volume_liters, 0) END) AS lost_liters,
       SUM(CASE WHEN mr.status = 'cancelled' THEN 0 ELSE COALESCE(mr.valid_amount,
         COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) * COALESCE(NULLIF(mr.price_per_liter, 0), cp.price_per_liter, c.price_per_liter, 0)) END) AS gross_amount
     FROM milk_records mr
     JOIN farmers f ON f.id = mr.farmer_id AND f.owner_user_id = mr.owner_user_id
     LEFT JOIN collection_centers c ON c.owner_user_id = f.owner_user_id
       AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
     LEFT JOIN LATERAL (
       SELECT prices.price_per_liter FROM collection_center_prices prices
       WHERE prices.collection_center_id = c.id AND prices.owner_user_id = f.owner_user_id
         AND prices.effective_date <= mr.date
       ORDER BY prices.effective_date DESC, prices.id DESC LIMIT 1
     ) cp ON TRUE
     WHERE mr.owner_user_id = $1 AND mr.date BETWEEN $2 AND $3
      AND mr.is_owner_milk = FALSE ${filters.join(' ')}
     GROUP BY mr.date ORDER BY mr.date ASC`,
    values
  );
  return new Map(rows.map((row) => [formatDateKey(row.date), {
    validLiters: Number(row.valid_liters || 0),
    originalLiters: Number(row.original_liters || 0),
    lostLiters: Number(row.lost_liters || 0),
    grossAmount: Number(row.gross_amount || 0),
  }]));
};

const buildDairyCollectorTotalsQuery = ({ ownerUserId, rangeStart, rangeEnd, centerFilter = null }) => {
  const values = [Number(ownerUserId), rangeStart, rangeEnd];
  let centerCondition = '';
  if (centerFilter) {
    values.push(centerFilter);
    centerCondition = `AND LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))) = LOWER(BTRIM($${values.length}))`;
  }
  return {
    text: `SELECT u.id AS "collectorUserId", u.name,
       COUNT(DISTINCT f.id)::integer AS "assignedFarmerCount",
       COALESCE(SUM(CASE WHEN mr.id IS NULL OR mr.status = 'cancelled' THEN 0
         ELSE COALESCE(mr.valid_volume_liters, mr.volume_liters, 0) END), 0) AS "totalVolume",
       COALESCE(SUM(CASE WHEN mr.id IS NULL OR mr.status = 'cancelled' THEN 0
         ELSE COALESCE(mr.valid_amount, COALESCE(mr.valid_volume_liters, mr.volume_liters, 0)
           * COALESCE(NULLIF(mr.price_per_liter, 0), cp.price_per_liter, c.price_per_liter, 0)) END), 0) AS "grossAmount"
     FROM collector_assignments ca
     JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
     JOIN users u ON u.id = ca.collector_user_id AND u.account_type = 'COLLECTOR'
     JOIN collection_centers c ON c.owner_user_id = f.owner_user_id
       AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location)))
     LEFT JOIN milk_records mr ON mr.farmer_id = f.id AND mr.owner_user_id = f.owner_user_id
       AND mr.date BETWEEN $2 AND $3 AND mr.is_owner_milk = FALSE
     LEFT JOIN LATERAL (
       SELECT prices.price_per_liter FROM collection_center_prices prices
       WHERE prices.collection_center_id = c.id AND prices.owner_user_id = f.owner_user_id
         AND prices.effective_date <= mr.date
       ORDER BY prices.effective_date DESC, prices.id DESC LIMIT 1
     ) cp ON TRUE
     WHERE ca.dairy_user_id = $1 ${centerCondition}
     GROUP BY u.id, u.name ORDER BY u.name ASC, u.id ASC`,
    values,
  };
};

const getDairyCollectorTotals = async ({ runQuery = query, ...filters }) => {
  const { text, values } = buildDairyCollectorTotalsQuery(filters);
  const { rows } = await runQuery(text, values);
  return rows.map((row) => ({
    ...row,
    collectorUserId: Number(row.collectorUserId),
    assignedFarmerCount: Number(row.assignedFarmerCount || 0),
    totalVolume: Number(row.totalVolume || 0),
    grossAmount: Number(row.grossAmount || 0),
  }));
};

const getUserProfile = async (id) => {
  const { rows } = await query(
    `SELECT id, name, email, role, account_type AS "accountType",
       national_id AS "nationalId", account_number AS "accountNumber", phone
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

const getCollectorDairyOwnerId = async (collectorUserId) => {
  const { rows } = await query(
    'SELECT dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 ORDER BY dairy_user_id ASC LIMIT 1',
    [Number(collectorUserId)]
  );
  return rows[0] ? Number(rows[0].dairy_user_id) : null;
};

const getDairyCollectorLinks = async (dairyUserId) => {
  const { rows } = await query(
    `SELECT f.id AS "farmerId", f.name AS "farmerName", f.account_number AS "accountNumber",
       f.collector_user_id AS "collectorUserId"
     FROM farmers f JOIN collector_assignments ca
       ON ca.dairy_user_id = f.owner_user_id AND ca.collector_user_id = f.collector_user_id
     WHERE f.owner_user_id = $1 AND f.collector_user_id IS NOT NULL ORDER BY f.id ASC`,
    [dairyUserId]
  );
  return rows;
};

const getAllowedCollectorIds = async (dairyUserId) => {
  const { rows } = await query(
    `SELECT DISTINCT ca.collector_user_id AS id FROM collector_assignments ca
     JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
     WHERE ca.dairy_user_id = $1 ORDER BY ca.collector_user_id`,
    [dairyUserId]
  );
  return rows.map((row) => Number(row.id));
};

const getCollectorProfiles = async (ids) => {
  if (!ids.length) return new Map();
  const { rows } = await query(
    `SELECT id, name, national_id AS "nationalId", account_number AS "accountNumber", phone, account_type AS "accountType"
     FROM users WHERE id = ANY($1::bigint[]) AND account_type = 'COLLECTOR'`,
    [ids]
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
};

module.exports = {
  buildFarmerTotalsQuery,
  buildTotalDeductionsQuery,
  buildMilkLossRecordsQuery,
  mapFarmerRow,
  getFarmerTotals,
  getTotalFarmers,
  getPeriodTotals,
  getTodayTotals,
  getTotalDeductions,
  getMilkLossRecords,
  getCurrentCenterPrice,
  getCollectorEntries,
  buildCollectorEntriesQuery,
  getCollectorPriceAtDate,
  getFarmerValidLitersByDate,
  getFarmerValidTotalsByDate,
  buildDairyCollectorTotalsQuery,
  getDairyCollectorTotals,
  getUserProfile,
  getCollectorDairyOwnerId,
  getDairyCollectorLinks,
  getAllowedCollectorIds,
  getCollectorProfiles,
};
