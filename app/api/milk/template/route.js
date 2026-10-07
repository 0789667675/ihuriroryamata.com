import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Milk = require('@/lib/services/milk-service.js');
const Farmers = require('@/lib/services/farmer-service.js');

export const runtime = 'nodejs';

const respond = (error, fallback) => NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : fallback }, {
  status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
});

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const farmerId = params.get('farmerId');
    const month = params.get('month');
    const year = params.get('year');
    const rows = await Milk.getMilkTemplate({ ownerUserId: user.id, farmerId, month, year });
    if (!rows) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json({ farmerId: Number(farmerId), month: Number(month) || new Date().getMonth() + 1, year: Number(year) || new Date().getFullYear(), rows });
  } catch (error) {
    return respond(error, 'Failed to load milk template.');
  }
}

export async function PUT(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    const input = await request.json();
    const farmerId = input.farmerId;
    if (!farmerId) return NextResponse.json({ message: 'farmerId is required.' }, { status: 400 });
    const rows = await Milk.saveMilkTemplate({
      ownerUserId: user.id,
      actorId: user.id,
      collectorUserId: user.accountType === 'COLLECTOR' ? user.id : undefined,
      farmerId,
      month: input.month,
      year: input.year,
      rows: input.rows,
    });
    if (!rows) return NextResponse.json({ message: 'Farmer not found.' }, { status: 404 });
    return NextResponse.json({ farmerId: Number(farmerId), month: Number(input.month), year: Number(input.year), rows });
  } catch (error) {
    return respond(error, 'Failed to save milk template.');
  }
}
