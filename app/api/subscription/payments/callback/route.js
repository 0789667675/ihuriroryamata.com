import { NextResponse } from 'next/server';

const { handleProviderCallback } = require('@/lib/services/subscription-service.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const rawText = await request.text();
    const body = (() => {
      if (!rawText) return {};
      if (contentType.includes('application/json')) {
        try { return JSON.parse(rawText); } catch { return {}; }
      }
      try {
        return JSON.parse(rawText);
      } catch {
        return Object.fromEntries(new URLSearchParams(rawText));
      }
    })();
    const result = await handleProviderCallback({ body });
    return NextResponse.json({ status: true, message: 'Callback received and processed.', data: result });
  } catch (error) {
    return NextResponse.json({
      status: false,
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Failed to process payment callback.',
      ...(error.currentStatus ? { status: error.currentStatus } : {}),
    }, {
      status: error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500),
    });
  }
}
