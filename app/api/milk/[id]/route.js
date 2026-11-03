import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const { requireAccountType } = require('@/lib/security/account-access.js');
const { requireActiveSubscription } = require('@/lib/security/subscription-access.js');
const Milk = require('@/lib/services/milk-service.js');
const Notifications = require('@/lib/services/notification-service.js');

export const runtime = 'nodejs';

const respondWithError = (error, fallback) => NextResponse.json({
  message: error.statusCode && error.statusCode < 500 ? error.message : fallback,
  ...(error.code ? { code: error.code } : {}),
}, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

const notifyMilkActivity = async ({ type, record, reference, ownerUserId }) => {
  try {
    await Notifications.createBusinessActivityNotification({
      type,
      ownerUserId: Number(record?.ownerUserId ?? ownerUserId),
      farmerId: record?.farmerId ?? record?.farmer_id,
      farmerName: record?.farmerName ?? record?.farmer_name,
      center: record?.collectionCenter ?? record?.collection_center,
      date: record?.date,
      amount: record?.amount,
      reference,
    });
  } catch (error) {
    const code = error?.code ? String(error.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) : 'NOTIFICATION_WRITE_FAILED';
    console.error('[milk] Milk activity notification failed.', { code, recordId: Number(record?.id) || null, type });
  }
};

export async function GET(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    const record = await Milk.getMilkRecord({ id: params.id, ownerUserId: user.id, collectorUserId: user.id });
    if (!record) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return respondWithError(error, 'Failed to load milk record.');
  }
}

export async function PUT(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const previous = await Milk.getMilkRecord({ id: params.id, ownerUserId: user.id, collectorUserId: user.id });
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ message: 'A valid JSON object is required.' }, { status: 400 });
    }
    const record = await Milk.updateMilkRecord({
      id: params.id,
      ownerUserId: user.id,
      collectorUserId: user.id,
      actorId: user.id,
      date: input.date,
      volumeMorning: input.volumeMorning,
      volumeEvening: input.volumeEvening,
      reason: input.reason,
    });
    if (!record) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    const savedRecord = record.record || record;
    const isNewVoid = record.alreadyVoided === false;
    const changed = isNewVoid || Boolean(previous && (
      String(previous.date).slice(0, 10) !== String(savedRecord.date).slice(0, 10)
      || Number(previous.volumeMorning) !== Number(savedRecord.volumeMorning)
      || Number(previous.volumeEvening) !== Number(savedRecord.volumeEvening)
    ));
    if (changed) {
      await notifyMilkActivity({
        type: isNewVoid ? 'milk_record_voided' : 'milk_record_corrected',
        record: savedRecord,
        ownerUserId: user.id,
        reference: isNewVoid ? `milk-record-void:${savedRecord.id}` : `milk-record-correction:${savedRecord.id}:${savedRecord.updated_at || savedRecord.updatedAt}`,
      });
    }
    return NextResponse.json(record);
  } catch (error) {
    return respondWithError(error, 'Failed to update milk record.');
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    requireAccountType(user, 'COLLECTOR');
    await requireActiveSubscription(user);
    const input = await request.json().catch(() => ({}));
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ message: 'A valid JSON object is required.' }, { status: 400 });
    }
    const voided = await Milk.voidMilkRecord({ id: params.id, ownerUserId: user.id, collectorUserId: user.id, actorId: user.id, reason: input.reason });
    if (!voided) return NextResponse.json({ message: 'Milk record not found.' }, { status: 404 });
    if (!voided.alreadyVoided) {
      await notifyMilkActivity({ type: 'milk_record_voided', record: voided.record, ownerUserId: user.id, reference: `milk-record-void:${voided.record.id}` });
    }
    return NextResponse.json(voided);
  } catch (error) {
    return respondWithError(error, 'Failed to void milk record.');
  }
}
