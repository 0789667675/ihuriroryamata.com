const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SUBSCRIPTION_TIME_ZONE,
  localDateAt,
  getInitialAccessDeadline,
  isBeforeDeadline,
  addMonthlyPeriod,
} = require('../lib/utils/subscription-time.js');

test('initial access deadline is midnight on Day 16 in Africa/Kigali', () => {
  const deadline = getInitialAccessDeadline({ activatedAt: '2026-10-12T12:00:00.000Z' });
  assert.equal(DEFAULT_SUBSCRIPTION_TIME_ZONE, 'Africa/Kigali');
  assert.equal(deadline.toISOString(), '2026-10-26T22:00:00.000Z');
  assert.equal(localDateAt(deadline, DEFAULT_SUBSCRIPTION_TIME_ZONE), '2026-10-27');
  assert.equal(isBeforeDeadline('2026-10-26T21:59:59.999Z', deadline), true);
  assert.equal(isBeforeDeadline(deadline, deadline), false);
});

test('initial access deadline anchors the activated local calendar date, not the UTC date', () => {
  const deadline = getInitialAccessDeadline({ activatedAt: '2026-10-11T22:30:00.000Z' });
  assert.equal(localDateAt(new Date('2026-10-11T22:30:00.000Z')), '2026-10-12');
  assert.equal(deadline.toISOString(), '2026-10-26T22:00:00.000Z');
});

test('policy timing validates days and accepts a configured zero-grace period', () => {
  const deadline = getInitialAccessDeadline({
    activatedAt: '2026-12-31T22:30:00.000Z',
    initialAccessDays: 15,
    gracePeriodDays: 0,
    enforcementTime: '00:00',
  });
  assert.equal(localDateAt(deadline), '2027-01-16');
  assert.equal(addMonthlyPeriod('2027-01-31T12:30:00.000Z').toISOString(), '2027-02-28T12:30:00.000Z');
  assert.throws(() => getInitialAccessDeadline({ activatedAt: new Date(), initialAccessDays: 0 }), /Initial access days/);
  assert.throws(() => getInitialAccessDeadline({ activatedAt: new Date(), gracePeriodDays: -1 }), /Grace period days/);
});

test('Kigali deadline remains stable across daylight-saving transitions elsewhere', () => {
  const spring = getInitialAccessDeadline({ activatedAt: '2026-03-08T12:00:00.000Z' });
  const autumn = getInitialAccessDeadline({ activatedAt: '2026-10-25T12:00:00.000Z' });
  assert.equal(spring.toISOString(), '2026-03-22T22:00:00.000Z');
  assert.equal(autumn.toISOString(), '2026-11-08T22:00:00.000Z');
});