/**
 * Canonical farmer-field definitions shared by normal farmer registration and
 * farmer import.
 *
 * These definitions describe the fields the application actually supports for
 * a farmer record. They are intentionally stable: they describe the UI contract
 * and validation rules, not dynamic database columns. The underlying
 * `farmers` table schema is unchanged by this module.
 *
 * Field keys map 1:1 to `farmers` columns:
 *   name, phone, national_id, account_number, location, collection_center,
 *   cow_type. `farmerNumber` is the permanent system-assigned owner-scoped
 *   number (No.) and is never a user-provided import field.
 */

const MAX_LENGTHS = {
  name: 255,
  phone: 50,
  nationalId: 50,
  accountNumber: 255,
  collectionCenter: 100,
  cowType: 255,
};

/**
 * Every field the farmer registration workflow and the importer may present.
 * Order is the default display order; `sortOrder` lets administrators change
 * the presentation without touching the database schema.
 */
const CANONICAL_FARMER_FIELDS = [
  {
    key: 'name',
    label: { rw: 'Amazina y\'umworozi', en: 'Farmer full name' },
    column: 'name',
    system: false,
    defaultEnabled: true,
    defaultRequired: true,
    sortOrder: 1,
  },
  {
    key: 'nationalId',
    label: { rw: 'Nomero y\'indangamuntu', en: 'National ID' },
    column: 'national_id',
    system: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 2,
  },
  {
    key: 'phone',
    label: { rw: 'Telefone', en: 'Phone number' },
    column: 'phone',
    system: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 3,
  },
  {
    key: 'accountNumber',
    label: { rw: 'Nomero ya konti', en: 'Account number' },
    column: 'account_number',
    system: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 4,
  },
  {
    key: 'collectionCenter',
    label: { rw: 'Ikigo cy\'ikusanyirizo', en: 'Collection center' },
    column: 'collection_center',
    system: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 5,
  },
  {
    key: 'cowType',
    label: { rw: 'Ubwoko bw\'inka', en: 'Cow type' },
    column: 'cow_type',
    system: false,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 6,
  },
  {
    key: 'farmerNumber',
    label: { rw: 'Nambara y\'umworozi', en: 'Farmer number (No.)' },
    column: 'farmer_number',
    system: true,
    defaultEnabled: true,
    defaultRequired: false,
    sortOrder: 0,
    note: {
      rw: 'Nambara yisabwa na sisitemu (No.). Ntabwo umwe mfasha kugiriza mu murongo wa kwinjiza.',
      en: 'Permanent system-assigned number (No.). It is not a value provided during import.',
    },
  },
];

const FIELD_BY_KEY = new Map(CANONICAL_FARMER_FIELDS.map((field) => [field.key, field]));

/**
 * Default field configuration. Administrators/organizations can override
 * enabled, required and sortOrder per owner through the field-config API.
 * Until an override is saved, these defaults apply everywhere.
 */
const defaultFieldConfig = () =>
  CANONICAL_FARMER_FIELDS.map((field) => ({
    key: field.key,
    enabled: field.defaultEnabled,
    required: field.defaultRequired && field.defaultEnabled,
    sortOrder: field.sortOrder,
    system: field.system,
  }));

/**
 * Resolve the effective configuration for one owner. `stored` is the array of
 * { key, enabled, required, sortOrder } overrides returned by the API. Missing
 * keys fall back to the canonical defaults; system fields are never disabled
 * or reordered by configuration.
 */
const resolveFieldConfig = (stored = []) => {
  const overrides = new Map();
  for (const item of Array.isArray(stored) ? stored : []) {
    if (item && (item.fieldKey || item.key)) overrides.set(String(item.fieldKey || item.key), item);
  }
  return CANONICAL_FARMER_FIELDS.map((field) => {
    if (field.system) {
      return { ...field, enabled: true, required: false, sortOrder: field.sortOrder, system: true };
    }
    const override = overrides.get(field.key);
    return {
      key: field.key,
      label: field.label,
      column: field.column,
      enabled: override === undefined ? field.defaultEnabled : Boolean(override.enabled),
      required: override === undefined
        ? field.defaultRequired
        : Boolean(override.required) && Boolean(override.enabled),
      sortOrder: override === undefined || !Number.isFinite(Number(override.sortOrder))
        ? field.sortOrder
        : Number(override.sortOrder),
      system: false,
    };
  });
};

const enabledFields = (config) => config.filter((field) => field.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
const requiredFields = (config) => enabledFields(config).filter((field) => field.required);
const fieldConfigForKeys = (config, keys) => {
  const byKey = new Map(config.map((field) => [field.key, field]));
  return (Array.isArray(keys) ? keys : []).map((key) => byKey.get(key)).filter(Boolean);
};

/**
 * Field limits shared with validation (max lengths mirror the database columns).
 */
const fieldLimit = (key) => {
  const field = FIELD_BY_KEY.get(String(key));
  return field ? MAX_LENGTHS[field.key] : null;
};

/**
 * Rwanda phone-number sanity: digits only (optional leading +250), 9 digits
 * after normalization. Used to flag values that plainly are not phone numbers.
 */
const phoneDigits = (value) => String(value ?? '').replace(/\D/g, '');
const isLikelyPhone = (value) => {
  const digits = phoneDigits(value);
  return digits.length >= 9 && digits.length <= 13;
};

/**
 * Rwandan national IDs are numeric (commonly 16 digits). Flag values that look
 * like phones/names instead.
 */
const idDigits = (value) => String(value ?? '').replace(/\D/g, '');
const isLikelyNationalId = (value) => {
  const digits = idDigits(value);
  return digits.length >= 6 && digits.length <= 20;
};

const isAllDigits = (value) => /\d[\d\s]*\d|\d/.test(String(value)) && !/[a-zA-Z]/.test(String(value));
const isLikelyName = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (/^\d+$/.test(text)) return false; // obvious numeric garbage is not a name
  return /[a-zA-Z]/.test(text);
};

const isLikelyAccount = (value) => /[A-Za-z0-9][A-Za-z0-9\s\-/]{2,}/.test(String(value ?? ''));

/**
 * Assess how well a value fits a canonical field. Never throws; returns
 * structured warnings so the importer can flag for review instead of silently
 * accepting or rejecting.
 */
const assessFieldValue = (key, value) => {
  const text = String(value ?? '').trim();
  const warnings = [];
  let fit = 'good';

  if (!text) return { key, fit: 'empty', warnings: [] };

  const field = FIELD_BY_KEY.get(String(key));

  if (key === 'name') {
    if (/^\d+$/.test(text)) {
      fit = 'suspect';
      warnings.push({ code: 'VALUE_LOOKS_NUMERIC', message: 'This looks like a number, not a farmer name.' });
    } else if (isLikelyPhone(text)) {
      fit = 'suspect';
      warnings.push({ code: 'VALUE_LOOKS_PHONE', message: 'This looks like a phone number, not a farmer name.' });
    } else if (isLikelyNationalId(text)) {
      fit = 'suspect';
      warnings.push({ code: 'VALUE_LOOKS_ID', message: 'This looks like a national ID, not a farmer name.' });
    }
  } else if (key === 'phone') {
    if (!isLikelyPhone(text)) {
      fit = isLikelyName(text) ? 'suspect' : 'poor';
      warnings.push({
        code: 'VALUE_NOT_PHONE',
        message: isLikelyName(text) ? 'This looks like a farmer name, not a phone number.' : 'This does not look like a valid phone number.',
      });
    }
  } else if (key === 'nationalId') {
    if (!isLikelyNationalId(text)) {
      fit = isLikelyPhone(text) ? 'suspect' : 'poor';
      warnings.push({
        code: 'VALUE_NOT_NATIONAL_ID',
        message: isLikelyPhone(text) ? 'This looks like a phone number, not a national ID.' : 'This does not look like a valid national ID.',
      });
    }
  } else if (key === 'accountNumber') {
    if (!isLikelyAccount(text)) {
      fit = 'poor';
      warnings.push({ code: 'VALUE_NOT_ACCOUNT', message: 'This does not look like a valid account number.' });
    }
  }

  if (field && text.length > fieldLimit(key)) {
    fit = 'poor';
    warnings.push({ code: 'VALUE_TOO_LONG', message: `This is longer than the ${fieldLimit(key)} character limit.` });
  }

  return { key, fit, warnings, value: text || null };
};

module.exports = {
  CANONICAL_FARMER_FIELDS,
  FIELD_BY_KEY,
  defaultFieldConfig,
  resolveFieldConfig,
  enabledFields,
  requiredFields,
  fieldConfigForKeys,
  fieldLimit,
  assessFieldValue,
  isLikelyPhone,
  isLikelyNationalId,
  isLikelyName,
  MAX_LENGTHS,
};
