import { NextResponse } from 'next/server';

const { getAuthenticatedUser, authenticate } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const { getPool, query } = require('@/lib/postgres.js');
const { saveMilkMatrixBatch } = require('@/lib/repositories/milkMatrixRepository.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const respondWithError = (error, fallback) => NextResponse.json({
  error: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  let client = null;
  try {
    const authFn = authenticate || getAuthenticatedUser;
    const user = await authFn(request);
    if (!user) {
      return NextResponse.json({ error: 'Ntabwo wemerewe kwinjira.' }, { status: 401 });
    }
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const month = parseInt(searchParams.get('month') || String(now.getUTCMonth() + 1), 10);
    const year = parseInt(searchParams.get('year') || String(now.getUTCFullYear()), 10);
    const periodType = searchParams.get('periodType') === 'second-half' ? 'second-half' : 'first-half';
    const centerIdParam = searchParams.get('centerId') || searchParams.get('collectionCenterId');
    const centerId = centerIdParam ? parseInt(centerIdParam, 10) : null;
    const collectorUserId = searchParams.get('collectorUserId') || (user.accountType === 'COLLECTOR' ? user.id : null);

    // Calculate date range
    const startDay = periodType === 'second-half' ? 16 : 1;
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDay = periodType === 'second-half' ? lastDayOfMonth : 15;

    const startDate = `${year}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    const days = [];
    for (let d = startDay; d <= endDay; d += 1) {
      days.push(d);
    }

    const pool = getPool();
    client = await pool.connect();

    // Resolve collection center
    let center = null;
    if (centerId) {
      const { rows: centerRows } = await client.query(
        `SELECT id, name, price_per_liter AS "pricePerLiter", transport_rate_per_liter AS "transportRatePerLiter"
         FROM collection_centers
         WHERE id = $1 AND (owner_user_id = $2 OR EXISTS (
           SELECT 1 FROM collector_assignments ca WHERE ca.collector_user_id = $2 AND ca.dairy_user_id = collection_centers.owner_user_id AND ca.revoked_at IS NULL
         ))
         LIMIT 1`,
        [centerId, user.id]
      );
      center = centerRows[0] || null;
    }

    if (!center) {
      const { rows: defaultCenterRows } = await client.query(
        `SELECT id, name, price_per_liter AS "pricePerLiter", transport_rate_per_liter AS "transportRatePerLiter"
         FROM collection_centers
         WHERE owner_user_id = $1 OR EXISTS (
           SELECT 1 FROM collector_assignments ca WHERE ca.collector_user_id = $1 AND ca.dairy_user_id = collection_centers.owner_user_id AND ca.revoked_at IS NULL
         )
         ORDER BY id ASC
         LIMIT 1`,
        [user.id]
      );
      center = defaultCenterRows[0] || { id: 1, name: 'Default Center', pricePerLiter: 400, transportRatePerLiter: 0 };
    }

    const pricePerLiter = Number(center.pricePerLiter || 400);
    const transportRatePerLiter = Number(center.transportRatePerLiter || 0);

    // 1. Fetch relevant farmers defensively
    let farmerQuery = `
      SELECT 
        id,
        farmer_number,
        name AS names,
        name,
        phone,
        national_id,
        account_number,
        collection_center,
        collector_user_id,
        owner_user_id
      FROM public.farmers
      WHERE 1 = 1
    `;
    const farmerParams = [];

    if (user.accountType === 'COLLECTOR') {
      farmerParams.push(user.id);
      farmerQuery += ` AND (owner_user_id = $${farmerParams.length} OR collector_user_id = $${farmerParams.length})`;
    } else if (user.accountType === 'COLLECTION_CENTER') {
      farmerParams.push(user.id);
      farmerQuery += ` AND owner_user_id = $${farmerParams.length}`;
      if (collectorUserId) {
        farmerParams.push(collectorUserId);
        farmerQuery += ` AND collector_user_id = $${farmerParams.length}`;
      }
    }

    if (centerId && center && center.name !== 'Default Center') {
      farmerParams.push(center.name);
      farmerQuery += ` AND LOWER(BTRIM(COALESCE(NULLIF(collection_center, ''), location))) = LOWER(BTRIM($${farmerParams.length}))`;
    }

    farmerQuery += ` ORDER BY farmer_number ASC NULLS LAST, name ASC`;
    const farmersRes = await client.query(farmerQuery, farmerParams);
    const farmers = farmersRes.rows;

    if (farmers.length === 0) {
      return NextResponse.json({
        period: { year, month, periodType, startDay, endDay, startDate, endDate },
        year,
        month,
        periodType,
        days,
        center: {
          id: center.id,
          name: center.name,
          pricePerLiter,
          transportRatePerLiter,
        },
        farmers: [],
        matrix: {},
        summary: {
          totalActiveFarmers: 0,
          totalFarmers: 0,
          totalPeriodLiters: 0,
          grandValue: 0,
        },
      });
    }

    const farmerIds = farmers.map((f) => f.id);

    // 2. Fetch all existing milk records for these farmers in the period
    const milkQuery = `
      SELECT 
        id,
        farmer_id,
        COALESCE(day, EXTRACT(DAY FROM date)::int) AS day,
        COALESCE(valid_volume_morning, volume_morning, 0) AS morning,
        COALESCE(valid_volume_evening, volume_evening, 0) AS evening,
        COALESCE(valid_volume_liters, volume_liters, 0) AS total,
        status
      FROM public.milk_records
      WHERE is_owner_milk = FALSE
        AND status <> 'cancelled'
        AND farmer_id = ANY($1::bigint[])
        AND date BETWEEN $2::date AND $3::date
    `;
    const milkRes = await client.query(milkQuery, [farmerIds, startDate, endDate]);

    // 3. Build lookup grid: matrix[farmerId][day] = { morning, evening, total, recordId }
    const matrix = {};
    for (const row of milkRes.rows) {
      const fid = Number(row.farmer_id);
      const d = Number(row.day);
      if (!matrix[fid]) {
        matrix[fid] = {};
      }
      matrix[fid][d] = {
        morning: Number(row.morning),
        evening: Number(row.evening),
        total: Number(row.total),
        recordId: row.id,
      };
    }

    let grandTotalLiters = 0;
    let activeFarmerCount = 0;

    const farmerEntries = farmers.map((f) => {
      const fid = Number(f.id);
      const dayMap = {};
      let rowTotal = 0;

      for (let d = startDay; d <= endDay; d += 1) {
        const rec = matrix[fid]?.[d];
        if (rec) {
          const morning = Number(rec.morning || 0);
          const evening = Number(rec.evening || 0);
          const total = Number(rec.total ?? (morning + evening));
          dayMap[String(d)] = {
            morning: morning > 0 ? String(morning) : '',
            evening: evening > 0 ? String(evening) : '',
            total,
            recordId: rec.recordId,
          };
          rowTotal += total;
        } else {
          dayMap[String(d)] = { morning: '', evening: '', total: 0 };
        }
      }

      rowTotal = Math.round(rowTotal * 100) / 100;
      if (rowTotal > 0) activeFarmerCount += 1;
      grandTotalLiters += rowTotal;

      return {
        id: fid,
        farmerId: fid,
        farmerNumber: f.farmer_number ? Number(f.farmer_number) : null,
        farmer_number: f.farmer_number ? Number(f.farmer_number) : null,
        farmerName: f.name || f.names || '',
        names: f.name || f.names || '',
        name: f.name || f.names || '',
        phone: f.phone || null,
        nationalId: f.national_id || null,
        national_id: f.national_id || null,
        accountNumber: f.account_number || null,
        account_number: f.account_number || null,
        collectionCenter: f.collection_center || center.name || null,
        collection_center: f.collection_center || center.name || null,
        days: dayMap,
        totalLiters: rowTotal,
        expectedTotal: rowTotal > 0 ? rowTotal : null,
      };
    });

    grandTotalLiters = Math.round(grandTotalLiters * 100) / 100;
    const grandValue = Math.round(grandTotalLiters * pricePerLiter);

    return NextResponse.json({
      period: { year, month, periodType, startDay, endDay, startDate, endDate },
      year,
      month,
      periodType,
      days,
      center: {
        id: center.id,
        name: center.name,
        pricePerLiter,
        transportRatePerLiter,
      },
      farmers: farmerEntries,
      matrix,
      summary: {
        totalActiveFarmers: activeFarmerCount,
        totalFarmers: farmers.length,
        totalPeriodLiters: grandTotalLiters,
        grandValue,
      },
    });
  } catch (error) {
    console.error('[Batch Matrix GET Error]:', error);
    return NextResponse.json({ 
      error: 'Ntibyakunze gufata amakuru y\'ikaye.', 
      message: 'Ntibyakunze gufata amakuru y\'ikaye.',
      details: error.message 
    }, { status: 500 });
  } finally {
    if (client) {
      try {
        client.release();
      } catch {}
    }
  }
}

export async function POST(request) {
  try {
    const authFn = authenticate || getAuthenticatedUser;
    const user = await authFn(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Invalid payload.' }, { status: 400 });
    }
    return NextResponse.json(await saveMilkMatrixBatch({ user, input: body }));
  } catch (error) {
    return respondWithError(error, 'Failed to save batch matrix milk records.');
  }
}
