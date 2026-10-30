import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const { getPool, query } = require('@/lib/postgres.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = Number(searchParams.get('year')) || now.getUTCFullYear();
    const month = Number(searchParams.get('month')) || (now.getUTCMonth() + 1);
    const periodType = searchParams.get('periodType') === 'second-half' ? 'second-half' : 'first-half';
    const centerParam = searchParams.get('collectionCenterId');

    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startDay = periodType === 'second-half' ? 16 : 1;
    const endDay = periodType === 'second-half' ? lastDayOfMonth : 15;

    const days = [];
    for (let d = startDay; d <= endDay; d += 1) {
      days.push(d);
    }

    // Resolve collection center
    let center = null;
    if (centerParam) {
      const { rows: centerRows } = await query(
        `SELECT id, name, price_per_liter AS "pricePerLiter", transport_rate_per_liter AS "transportRatePerLiter"
         FROM collection_centers
         WHERE id = $1 AND (owner_user_id = $2 OR EXISTS (
           SELECT 1 FROM collector_assignments ca WHERE ca.collector_user_id = $2 AND ca.dairy_user_id = collection_centers.owner_user_id AND ca.revoked_at IS NULL
         ))
         LIMIT 1`,
        [Number(centerParam), user.id]
      );
      center = centerRows[0] || null;
    }

    if (!center) {
      const { rows: defaultCenterRows } = await query(
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

    // Fetch active farmers
    const { rows: farmers } = await query(
      `SELECT id, name, farmer_number AS "farmerNumber", phone, collection_center AS "collectionCenter"
       FROM farmers
       WHERE owner_user_id = $1 AND is_active = true
       ORDER BY farmer_number ASC NULLS LAST, name ASC`,
      [user.id]
    );

    // Fetch existing milk records for the range
    const { rows: records } = await query(
      `SELECT id, farmer_id AS "farmerId", day,
              volume_morning AS "volumeMorning",
              volume_evening AS "volumeEvening",
              volume_liters AS "volumeLiters",
              status
       FROM milk_records
       WHERE owner_user_id = $1
         AND year = $2
         AND month = $3
         AND day >= $4
         AND day <= $5
         AND status != 'cancelled'`,
      [user.id, year, month, startDay, endDay]
    );

    const recordsByFarmer = new Map();
    for (const rec of records) {
      const fid = Number(rec.farmerId);
      if (!recordsByFarmer.has(fid)) {
        recordsByFarmer.set(fid, new Map());
      }
      recordsByFarmer.get(fid).set(Number(rec.day), rec);
    }

    let grandTotalLiters = 0;
    let activeFarmerCount = 0;

    const farmerEntries = farmers.map((f) => {
      const fid = Number(f.id);
      const farmerRecs = recordsByFarmer.get(fid);
      const dayMap = {};
      let rowTotal = 0;

      for (let d = startDay; d <= endDay; d += 1) {
        const rec = farmerRecs?.get(d);
        if (rec) {
          const morning = Number(rec.volumeMorning || 0);
          const evening = Number(rec.volumeEvening || 0);
          const total = Number(rec.volumeLiters ?? (morning + evening));
          dayMap[String(d)] = {
            morning: morning > 0 ? String(morning) : '',
            evening: evening > 0 ? String(evening) : '',
            total,
            recordId: rec.id,
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
        farmerId: fid,
        farmerNumber: f.farmerNumber ? Number(f.farmerNumber) : null,
        farmerName: f.name,
        phone: f.phone || null,
        collectionCenter: f.collectionCenter || center.name,
        days: dayMap,
        totalLiters: rowTotal,
        expectedTotal: rowTotal > 0 ? rowTotal : null,
      };
    });

    grandTotalLiters = Math.round(grandTotalLiters * 100) / 100;
    const grandValue = Math.round(grandTotalLiters * pricePerLiter);

    return NextResponse.json({
      year,
      month,
      periodType,
      days,
      center: {
        id: center.id,
        name: center.name,
        pricePerLiter,
        transportRatePerLiter: Number(center.transportRatePerLiter || 0),
      },
      farmers: farmerEntries,
      summary: {
        totalActiveFarmers: activeFarmerCount,
        totalFarmers: farmers.length,
        totalPeriodLiters: grandTotalLiters,
        grandValue,
      },
    });
  } catch (error) {
    return respondWithError(error, 'Failed to fetch batch matrix data.');
  }
}

export async function POST(request) {
  let client = null;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, ['COLLECTOR', 'COLLECTION_CENTER']);
    await requireActiveSubscription(user);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ message: 'Invalid payload.' }, { status: 400 });
    }

    const year = Number(body.year);
    const month = Number(body.month);
    const periodType = body.periodType === 'second-half' ? 'second-half' : 'first-half';
    const centerId = Number(body.collectionCenterId) || 1;
    const entries = Array.isArray(body.entries) ? body.entries : [];

    if (!Number.isSafeInteger(year) || year < 2020 || year > 2050) {
      return NextResponse.json({ message: 'A valid year (2020-2050) is required.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ message: 'A valid month (1-12) is required.' }, { status: 400 });
    }

    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startDay = periodType === 'second-half' ? 16 : 1;
    const endDay = periodType === 'second-half' ? lastDayOfMonth : 15;

    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    // Advisory transaction lock per collector, center, year, month, and period
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('batch_matrix_' || $1 || '_' || $2 || '_' || $3 || '_' || $4 || '_' || $5))`,
      [user.id, centerId, year, month, periodType]
    );

    // Resolve center & price
    const { rows: centerRows } = await client.query(
      `SELECT id, name, price_per_liter AS "pricePerLiter", transport_rate_per_liter AS "transportRatePerLiter"
       FROM collection_centers
       WHERE id = $1 AND (owner_user_id = $2 OR EXISTS (
         SELECT 1 FROM collector_assignments ca WHERE ca.collector_user_id = $2 AND ca.dairy_user_id = collection_centers.owner_user_id AND ca.revoked_at IS NULL
       ))
       LIMIT 1`,
      [centerId, user.id]
    );

    const center = centerRows[0] || { id: centerId, pricePerLiter: 400, transportRatePerLiter: 0 };
    const pricePerLiter = Number(center.pricePerLiter || 400);
    const transportRatePerLiter = Number(center.transportRatePerLiter || 0);

    // Map sessions needed for each date
    const sessionCache = new Map();
    const getSessionId = async (dateStr) => {
      if (sessionCache.has(dateStr)) return sessionCache.get(dateStr);
      const { rows } = await client.query(
        `INSERT INTO collection_sessions
           (owner_user_id, collector_user_id, collection_date, period, collection_center_id)
         VALUES ($1, $2, $3, 'daily', $4)
         ON CONFLICT (owner_user_id, collection_date, period, collection_center_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [user.id, user.id, dateStr, center.id]
      );
      const sId = rows[0]?.id || 1;
      sessionCache.set(dateStr, sId);
      return sId;
    };

    let savedCount = 0;
    let grandVolume = 0;

    for (const entry of entries) {
      const farmerId = Number(entry.farmerId);
      if (!Number.isSafeInteger(farmerId) || farmerId <= 0) continue;
      const days = entry.days;
      if (!days || typeof days !== 'object') continue;

      for (let day = startDay; day <= endDay; day += 1) {
        const dayStr = String(day);
        const dayData = days[dayStr];
        if (!dayData) continue;

        const morning = Math.round((Number(dayData.morning) || 0) * 100) / 100;
        const evening = Math.round((Number(dayData.evening) || 0) * 100) / 100;
        const totalVolume = Math.round((morning + evening) * 100) / 100;

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const sessionId = await getSessionId(dateStr);
        const amount = Math.round(totalVolume * pricePerLiter * 100) / 100;

        // Upsert into milk_records
        const res = await client.query(
          `INSERT INTO milk_records
             (farmer_id, owner_user_id, collection_session_id, date, month, year, day,
              volume_liters, volume_morning, volume_evening, price_per_liter, amount,
              status, valid_volume_liters, valid_volume_morning, valid_volume_evening,
              valid_amount, lost_volume_liters, transport_rate_per_liter)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              'valid', $8, $9, $10, $12, 0, $13)
           ON CONFLICT (farmer_id, month, year, day)
           DO UPDATE SET
              volume_liters = EXCLUDED.volume_liters,
              volume_morning = EXCLUDED.volume_morning,
              volume_evening = EXCLUDED.volume_evening,
              valid_volume_liters = EXCLUDED.volume_liters,
              valid_volume_morning = EXCLUDED.volume_morning,
              valid_volume_evening = EXCLUDED.volume_evening,
              price_per_liter = EXCLUDED.price_per_liter,
              amount = EXCLUDED.amount,
              valid_amount = EXCLUDED.amount,
              transport_rate_per_liter = EXCLUDED.transport_rate_per_liter,
              status = 'valid',
              updated_at = NOW()
           RETURNING id`,
          [farmerId, user.id, sessionId, dateStr, month, year, day, totalVolume, morning, evening, pricePerLiter, amount, transportRatePerLiter]
        );

        if (res.rows[0]) {
          savedCount += 1;
          grandVolume += totalVolume;
        }
      }
    }

    // Write audit log
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
       VALUES ('milk_matrix_batch', $1, 'batch_matrix_save', $2::jsonb, $3, $4)`,
      [center.id, JSON.stringify({ year, month, periodType, savedCount, grandVolume }), user.id, user.id]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      savedCount,
      totalVolume: Math.round(grandVolume * 100) / 100,
      year,
      month,
      periodType,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    return respondWithError(error, 'Failed to save batch matrix milk records.');
  } finally {
    if (client) {
      try {
        client.release();
      } catch {}
    }
  }
}
