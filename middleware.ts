import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/middleware';

const collectors = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1,
  dairy_user_id: 77,
  collector_user_id: 900 + index,
  collector_name: `Abacunda ${String(index + 1).padStart(3, '0')}`,
  collector_account_number: `A-${900 + index}`,
  collector_national_id: `ID-${900 + index}`,
  collector_phone: '0788000000',
  abacunda_count: 300 - index,
}));

const farmers = Array.from({ length: 300 }, (_, index) => ({
  id: 1000 + index,
  name: `Umworozi ${String(index + 1).padStart(3, '0')}`,
  location: 'Umudugudu A',
  phone: '0788000000',
  nationalId: `ID-${1000 + index}`,
  accountNumber: `F-${1000 + index}`,
  collectionCenter: 'North Ikigo',
  cowType: 'Inka',
  collectorUserId: 42,
}));

const ownerEntries = Array.from({ length: 12 }, (_, index) => ({
  id: 500 + index,
  date: `2026-10-${String(index + 1).padStart(2, '0')}`,
  volumeLiters: 100,
  originalVolumeLiters: 100,
  validVolumeLiters: 92,
  lostVolumeLiters: 8,
  assignedFarmerLiters: 70,
  surplusLiters: 22,
  status: 'valid',
  adjustmentReason: null,
  adjustedAt: null,
}));

const json = (body: unknown) => NextResponse.json(body);

const mockApi = (request: NextRequest) => {
  const path = request.nextUrl.pathname;
  const accountType = request.cookies.get('ui-review-account')?.value || 'COLLECTOR';
  const isDairy = accountType === 'COLLECTION_CENTER';
  const ownerId = isDairy ? 77 : 42;
  const dailyRows = isDairy ? [] : farmers.slice(0, 50).map((farmer, index) => ({
    farmerId: farmer.id,
    farmerName: farmer.name,
    phone: farmer.phone,
    nationalId: farmer.nationalId,
    collectionCenter: farmer.collectionCenter,
    recordId: index + 1,
    volumeMorning: 6,
    volumeEvening: 5,
    totalVolume: 11,
    amount: 4400,
    status: 'valid',
  }));

  if (path === '/api/auth/me') return json({ user: { id: ownerId, name: isDairy ? 'Ikigo cy’Amajyaruguru' : 'Nyirubucuruzi', email: 'ui-review@example.invalid', role: 'user', accountType } });
  if (path === '/api/collection-centers') return json([{ id: 8, name: 'North Ikigo', pricePerLiter: 400, transportRatePerLiter: 0, morning_start: '06:30', morning_end: '09:00', evening_start: '17:30', evening_end: '19:00' }]);
  if (path === '/api/collector-assignments') return json(collectors);
  if (path === '/api/farmers') {
    const params = request.nextUrl.searchParams;
    const search = params.get('search')?.toLowerCase() || '';
    const matching = farmers.filter((farmer) => !search || farmer.name.toLowerCase().includes(search));
    const offset = Number(params.get('cursor') || 0);
    const data = matching.slice(offset, offset + 50);
    return json({ data, nextCursor: offset + 50 < matching.length ? String(offset + 50) : null, hasMore: offset + 50 < matching.length, pageSize: 50 });
  }
  if (path === '/api/milk/daily') return json({
    farmers: dailyRows,
    summary: { totalFarmers: isDairy ? 300 : 300, presentCount: dailyRows.length, totalMorning: dailyRows.length * 6, totalEvening: dailyRows.length * 5, totalVolume: dailyRows.length * 11, totalAmount: dailyRows.length * 4400, pricePerLiter: 400, transportRate: 0 },
    farmerPagination: { nextCursor: dailyRows.length ? '1049' : null, hasMore: dailyRows.length > 0 },
    center: 'North Ikigo',
    centers: ['North Ikigo'],
    collectorMilk: isDairy ? [] : [{ id: 800, date: '2026-10-06', volumeLiters: 100, effectiveVolumeLiters: 92, pricePerLiter: 400, status: 'valid' }],
  });
  if (path === '/api/milk') {
    const farmerId = Number(request.nextUrl.searchParams.get('farmerId'));
    const farmer = farmers.find((row) => row.id === farmerId);
    const data = farmer ? [{ id: 1, farmer_id: farmer.id, owner_user_id: ownerId, date: '2026-10-06', volumeMorning: 6, volumeEvening: 5, volume: 11, originalVolumeLiters: 11, validVolumeLiters: 11, lostVolumeLiters: 0, amount: 4400, pricePerLiter: 400, status: 'valid', collectionCenter: 'North Ikigo' }] : [];
    return json({ data, nextCursor: null, hasMore: false, pageSize: 100 });
  }
  if (path === '/api/reports/summary') return json({ totalFarmers: 300, totalVolume: 550, totalMorning: 300, totalEvening: 250, totalRevenueMonth: 220000, ownerGeneratedGross: 40000, ownerGeneratedVolume: 100, totalDeductionsMonth: 0, totalTransportFeesMonth: 0, netRevenueMonth: 0, todayTotal: 550, todayMorning: 300, todayEvening: 250, rangeStart: '2026-10-01', rangeEnd: '2026-10-15', collectorPayable: 0, collectorFarmerTransport: 0, collectorFarmersValidLiters: 550, collectorIsReconciled: true, collectorSettlementRows: collectors, farmerPayments: [], ownerSettlementRow: null });
  if (path === '/api/ifishi/owner') return json({ owner: { name: 'Nyirubucuruzi' }, startDate: '2026-10-01', endDate: '2026-10-31', entries: ownerEntries, totals: { ownerVolumeLiters: 1104, assignedFarmerLiters: 840, surplusLiters: 264 } });
  if (path === '/api/ifishi/abacunda') return json({ collector: { id: 900, name: 'Abacunda 001' }, startDate: '2026-10-01', endDate: '2026-10-31', entries: [{ date: '2026-10-06', morningLiters: 6, eveningLiters: 5, originalLiters: 11, validLiters: 10, lostLiters: 1, status: 'adjusted', reason: 'Lost milk' }], totals: { morningLiters: 6, eveningLiters: 5, originalLiters: 11, validLiters: 10, lostLiters: 1 } });
  if (path === '/api/notifications/unread-count') return json({ data: { unreadCount: 0 } });
  if (path === '/api/subscription') return json({ subscription: { status: 'active', effective_status: 'active' }, plans: [], payments: [], account: {} });
  if (path === '/api/deductions') return json({ data: [], nextCursor: null, hasMore: false, pageSize: 50 });
  return json({});
};

export async function middleware(request: NextRequest) {
  return createClient(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};