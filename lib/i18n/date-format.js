const MONTH_NAMES = {
  rw: ['Mutarama', 'Gashyantare', 'Werurwe', 'Mata', 'Gicurasi', 'Kamena', 'Nyakanga', 'Kanama', 'Nzeri', 'Ukwakira', 'Ugushyingo', 'Ukuboza'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const WEEKDAY_NAMES = {
  rw: ['Ku cyumweru', 'Ku wa mbere', 'Ku wa kabiri', 'Ku wa gatatu', 'Ku wa kane', 'Ku wa gatanu', 'Ku wa gatandatu'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const DEFAULT_LOCALES = {
  rw: 'rw-RW',
  en: 'en-GB',
};

const normalizeLanguage = (language) => (language === 'en' ? 'en' : 'rw');

const getLanguageDateLocale = (language) => DEFAULT_LOCALES[normalizeLanguage(language)] || DEFAULT_LOCALES.en;

const getMonthNames = (language) => [...MONTH_NAMES[normalizeLanguage(language)]];

const formatMonthName = (language, monthNumber) => {
  const normalized = Number(monthNumber);
  const monthIndex = Number.isInteger(normalized) ? normalized - 1 : 0;
  const monthNames = getMonthNames(language);
  return monthNames[(monthIndex + 12) % 12] || monthNames[0];
};

const parseDateValue = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value).trim();
  if (!text) return null;
  const dateValue = new Date(text.includes('T') || text.includes(' ') ? text : `${text}T00:00:00Z`);
  if (!Number.isNaN(dateValue.getTime())) return dateValue;
  return null;
};

const dayName = (value, language) => {
  const date = parseDateValue(value);
  if (!date) return '';
  const normalized = normalizeLanguage(language);
  return WEEKDAY_NAMES[normalized][date.getUTCDay()] || WEEKDAY_NAMES[normalized][0];
};

const formatTimeLabel = (date, language, { showTime = false } = {}) => {
  if (!showTime) return '';
  const formatter = new Intl.DateTimeFormat(getLanguageDateLocale(language), {
    timeZone: 'Africa/Kigali',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
};

const formatDateLabel = (value, language, options = {}) => {
  const date = parseDateValue(value);
  if (!date) return '';
  const normalized = normalizeLanguage(language);
  const formatConfig = { ...options };
  const tokens = [];
  if (formatConfig.weekday) tokens.push(dayName(date, normalized));
  if (formatConfig.day) tokens.push(String(date.getUTCDate()));
  if (formatConfig.month) tokens.push(formatMonthName(normalized, date.getUTCMonth() + 1));
  if (formatConfig.year) tokens.push(String(date.getUTCFullYear()));

  const timeValue = formatTimeLabel(date, normalized, { showTime: Boolean(formatConfig.time) || Boolean(formatConfig.timeStyle) });
  if (timeValue) tokens.push(timeValue);

  if (!tokens.length) {
    return new Intl.DateTimeFormat(getLanguageDateLocale(normalized), {
      timeZone: 'Africa/Kigali',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  }

  return tokens.join(' ');
};

module.exports = {
  DEFAULT_LOCALES,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  normalizeLanguage,
  getLanguageDateLocale,
  getMonthNames,
  formatMonthName,
  dayName,
  parseDateValue,
  formatDateLabel,
};
