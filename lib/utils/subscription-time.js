const DEFAULT_SUBSCRIPTION_TIME_ZONE = 'Africa/Kigali';

const zonedParts = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
);

const localDateAt = (value, timeZone = DEFAULT_SUBSCRIPTION_TIME_ZONE) => {
  const parts = zonedParts(new Date(value), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const addLocalDays = (date, days) => {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + Number(days)));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
};

const localDateTimeToUtc = ({ date, time = '00:00', timeZone = DEFAULT_SUBSCRIPTION_TIME_ZONE }) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const difference = target - represented;
    if (difference === 0) break;
    candidate += difference;
  }
  return new Date(candidate);
};

const getInitialAccessDeadline = ({
  activatedAt,
  initialAccessDays = 15,
  gracePeriodDays = 0,
  enforcementTime = '00:00',
  timeZone = DEFAULT_SUBSCRIPTION_TIME_ZONE,
}) => {
  const activation = new Date(activatedAt);
  if (Number.isNaN(activation.getTime())) throw new Error('A valid activation timestamp is required.');
  if (!Number.isSafeInteger(initialAccessDays) || initialAccessDays < 1 || initialAccessDays > 90) {
    throw new Error('Initial access days must be an integer from 1 to 90.');
  }
  if (!Number.isSafeInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 90) {
    throw new Error('Grace period days must be an integer from 0 to 90.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(enforcementTime)) throw new Error('Enforcement time must use HH:MM.');
  const deadlineDate = addLocalDays(localDateAt(activation, timeZone), initialAccessDays + gracePeriodDays);
  return localDateTimeToUtc({ date: deadlineDate, time: enforcementTime, timeZone });
};

const isBeforeDeadline = (paymentConfirmedAt, deadline) => {
  const confirmed = new Date(paymentConfirmedAt).getTime();
  const due = new Date(deadline).getTime();
  return Number.isFinite(confirmed) && Number.isFinite(due) && confirmed < due;
};

const addMonthlyPeriod = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('A valid period start timestamp is required.');
  const targetMonth = date.getUTCMonth() + 1;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
};

module.exports = {
  DEFAULT_SUBSCRIPTION_TIME_ZONE,
  localDateAt,
  localDateTimeToUtc,
  getInitialAccessDeadline,
  isBeforeDeadline,
  addMonthlyPeriod,
};