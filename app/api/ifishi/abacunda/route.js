import { NextResponse } from 'next/server';

const { getAuthenticatedUser } = require('@/lib/security/authenticate.js');
const Assignments = require('@/lib/services/collector-assignment-service.js');
const Milk = require('@/lib/services/milk-service.js');

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: 'Not authenticated.' }, { status: 401 });
    if (user.role !== 'user' || user.accountType !== 'COLLECTION_CENTER') {
      return NextResponse.json({ message: 'Abacunda Ifishi is available to Collection Center accounts.' }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const collectorUserId = Number(params.get('collectorUserId'));
    const centerId = Number(params.get('centerId'));
    const assignments = await Assignments.listAssignments({ dairyUserId: user.id, centerId });
    const assignment = assignments.find((row) => Number(row.collector_user_id) === collectorUserId);
    if (!assignment) return NextResponse.json({ message: 'Abacunda is not assigned to the active Ikigo.' }, { status: 404 });

    const history = await Milk.getAbacundaIfishiHistory({
      dairyUserId: user.id,
      collectorUserId,
      centerId,
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
    });
    return NextResponse.json({ collector: { id: collectorUserId, name: assignment.collector_name }, ...history });
  } catch (error) {
    return NextResponse.json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to load Abacunda Ifishi.' }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}