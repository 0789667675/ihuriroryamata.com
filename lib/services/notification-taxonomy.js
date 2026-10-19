// Shared notification vocabulary. Pure constants only: no database access.
// The server, repositories, and the workspace UI all agree on these values.

const OPERATIONAL_NOTIFICATION_TYPES = [
  'missed_delivery',
  'farmer_missed_delivery',
  'low_delivery',
  'farmer_missing_center',
  'farmer_missing_collector',
  'no_collection',
  'low_collection',
  'farmer_milk_spike',
  'collection_milk_spike',
  'owner_farmer_difference_drop',
  'farmer_milk_missing',
  'no_farmer_milk_recorded',
  'owner_milk_missing',
];

// The original generation rules remain readable/resolvable after this upgrade.
const LEGACY_OPERATIONAL_NOTIFICATION_TYPES = [
  'morning_missed',
  'evening_missed',
  'farmer_morning_missed',
  'farmer_evening_missed',
  'repeatedly_missed',
];

const ACTIVITY_NOTIFICATION_TYPES = ['farmer_created', 'farmer_updated'];

const ALL_OPERATIONAL_NOTIFICATION_TYPES = [
  ...OPERATIONAL_NOTIFICATION_TYPES,
  ...LEGACY_OPERATIONAL_NOTIFICATION_TYPES,
];

const MISSED_DELIVERY_NOTIFICATION_TYPES = [
  'missed_delivery',
  'farmer_missed_delivery',
  'morning_missed',
  'evening_missed',
  'farmer_morning_missed',
  'farmer_evening_missed',
  'repeatedly_missed',
];

const LOW_DELIVERY_NOTIFICATION_TYPES = ['low_delivery', 'low_collection'];
const DATA_QUALITY_NOTIFICATION_TYPES = [
  'farmer_missing_center',
  'farmer_missing_collector',
  'farmer_milk_missing',
  'no_farmer_milk_recorded',
  'owner_milk_missing',
];
const ANOMALY_NOTIFICATION_TYPES = ['farmer_milk_spike', 'collection_milk_spike', 'owner_farmer_difference_drop'];
const SUBSCRIPTION_NOTIFICATION_TYPES = ['subscription_expiring'];

const ALERT_TYPE_GROUPS = {
  missed: MISSED_DELIVERY_NOTIFICATION_TYPES,
  low: LOW_DELIVERY_NOTIFICATION_TYPES,
  quality: DATA_QUALITY_NOTIFICATION_TYPES,
  anomaly: ANOMALY_NOTIFICATION_TYPES,
};

const MANUAL_RESOLUTION_CODES = ['farmer_absent', 'no_milk', 'reported_other', 'pending_verification', 'dismissed'];
const SYSTEM_RESOLUTION_CODES = ['delivery_recorded', 'volume_corrected', 'issue_cleared'];
const RESOLUTION_CODES = [...MANUAL_RESOLUTION_CODES, ...SYSTEM_RESOLUTION_CODES];

const ALERT_STATUSES = ['open', 'resolved'];
const ALERT_STATES = ['all', 'open', 'resolved', 'action'];
const ALERT_CATEGORIES = ['all', 'operational', 'activity', 'payment'];

const isOperationalNotificationType = (type) => ALL_OPERATIONAL_NOTIFICATION_TYPES.includes(String(type || ''));

const buildAlertDedupeKey = ({ type, farmerId = null, center, date, period = null, reference = null }) => [
  type,
  farmerId ?? 'group',
  center ?? 'all',
  date || 'unknown-date',
  period || 'all',
  reference ?? 'default',
].join('|');

module.exports = {
  OPERATIONAL_NOTIFICATION_TYPES,
  LEGACY_OPERATIONAL_NOTIFICATION_TYPES,
  ALL_OPERATIONAL_NOTIFICATION_TYPES,
  ACTIVITY_NOTIFICATION_TYPES,
  MISSED_DELIVERY_NOTIFICATION_TYPES,
  LOW_DELIVERY_NOTIFICATION_TYPES,
  DATA_QUALITY_NOTIFICATION_TYPES,
  ANOMALY_NOTIFICATION_TYPES,
  SUBSCRIPTION_NOTIFICATION_TYPES,
  ALERT_TYPE_GROUPS,
  MANUAL_RESOLUTION_CODES,
  SYSTEM_RESOLUTION_CODES,
  RESOLUTION_CODES,
  ALERT_STATUSES,
  ALERT_STATES,
  ALERT_CATEGORIES,
  isOperationalNotificationType,
  buildAlertDedupeKey,
};
