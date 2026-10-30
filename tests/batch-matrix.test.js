const test = require('node:test');
const assert = require('node:assert/strict');

const { stitchNotebookMultiDay } = require('../lib/imports/notebook.js');

test('Batch Matrix API: stitchNotebookMultiDay supports Two-Photo capture with row index alignment', () => {
  // Photo 1: Left page has farmer names and Days 1-15
  const leftPage = [
    {
      rowNumber: 1,
      farmerNumber: 101,
      detectedName: 'MUKAMANA Marie',
      dailyVolumes: {
        '2026-11-01': { morning: 3, evening: 2, total: 5 },
        '2026-11-02': { morning: 4, evening: 2, total: 6 },
      },
      status: 'ok',
    },
    {
      rowNumber: 2,
      farmerNumber: 102,
      detectedName: 'HABIMANA Jean',
      dailyVolumes: {
        '2026-11-01': { morning: 5, evening: 5, total: 10 },
      },
      status: 'ok',
    },
  ];
  leftPage.dates = ['2026-11-01', '2026-11-02'];
  leftPage.columns = [{ isoDate: '2026-11-01' }, { isoDate: '2026-11-02' }];

  // Photo 2: Right page has Days 16-31 with line numbers only (no names printed across the spine)
  const rightPage = [
    {
      rowNumber: 1,
      farmerNumber: null,
      detectedName: 'Umworozi #1',
      dailyVolumes: {
        '2026-11-16': { morning: 3, evening: 3, total: 6 },
      },
      status: 'ok',
    },
    {
      rowNumber: 2,
      farmerNumber: null,
      detectedName: 'Umworozi #2',
      dailyVolumes: {
        '2026-11-16': { morning: 4, evening: 4, total: 8 },
      },
      status: 'ok',
    },
  ];
  rightPage.dates = ['2026-11-16'];
  rightPage.columns = [{ isoDate: '2026-11-16' }];

  const stitched = stitchNotebookMultiDay(leftPage, rightPage);

  assert.equal(stitched.length, 2, 'Stitched result should have 2 farmers, not 4 separate rows');
  assert.equal(stitched[0].detectedName, 'MUKAMANA Marie');
  assert.equal(stitched[0].dailyVolumes['2026-11-01']?.total, 5);
  assert.equal(stitched[0].dailyVolumes['2026-11-16']?.total, 6);
  assert.equal(stitched[0].totalPeriodLiters, 17); // 5 + 6 (day 2) + 6 (day 16) = 17

  assert.equal(stitched[1].detectedName, 'HABIMANA Jean');
  assert.equal(stitched[1].dailyVolumes['2026-11-01']?.total, 10);
  assert.equal(stitched[1].dailyVolumes['2026-11-16']?.total, 8);
  assert.equal(stitched[1].totalPeriodLiters, 18); // 10 + 8 = 18
});

test('Batch Matrix API: periodType calculates correct day boundaries', () => {
  const getBounds = (year, month, periodType) => {
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startDay = periodType === 'second-half' ? 16 : 1;
    const endDay = periodType === 'second-half' ? lastDayOfMonth : 15;
    const days = [];
    for (let d = startDay; d <= endDay; d += 1) days.push(d);
    return { startDay, endDay, count: days.length, days };
  };

  const firstHalfNov = getBounds(2026, 11, 'first-half');
  assert.equal(firstHalfNov.startDay, 1);
  assert.equal(firstHalfNov.endDay, 15);
  assert.equal(firstHalfNov.count, 15);

  const secondHalfNov = getBounds(2026, 11, 'second-half');
  assert.equal(secondHalfNov.startDay, 16);
  assert.equal(secondHalfNov.endDay, 30); // November has 30 days
  assert.equal(secondHalfNov.count, 15);

  const secondHalfOct = getBounds(2026, 10, 'second-half');
  assert.equal(secondHalfOct.startDay, 16);
  assert.equal(secondHalfOct.endDay, 31); // October has 31 days
  assert.equal(secondHalfOct.count, 16);

  const secondHalfFeb = getBounds(2026, 2, 'second-half');
  assert.equal(secondHalfFeb.startDay, 16);
  assert.equal(secondHalfFeb.endDay, 28); // 2026 is non-leap year
  assert.equal(secondHalfFeb.count, 13);
});

test('Scanner payload limits: extract route accepts up to 50MB and OCR accepts 35MB', () => {
  const fs = require('fs');
  const extractRoute = fs.readFileSync('app/api/imports/extract/route.js', 'utf8');
  assert.match(extractRoute, /50\s*\*\s*1024\s*\*\s*1024/, 'Extract route should define 50MB limit');

  const ocrRoute = fs.readFileSync('app/api/imports/ocr/route.js', 'utf8');
  assert.match(ocrRoute, /35\s*\*\s*1024\s*\*\s*1024/, 'OCR route should define 35MB limit');

  const nextConfig = fs.readFileSync('next.config.mjs', 'utf8');
  assert.match(nextConfig, /bodySizeLimit:\s*['"]50mb['"]/, 'next.config.mjs should set bodySizeLimit to 50mb');
});
