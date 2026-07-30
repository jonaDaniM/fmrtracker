/**
 * Shared foundation for FMRCore.
 * Owns sheet names, roles, database context, caches, and common helpers.
 */

const FMR_CORE = Object.freeze({
  VERSION: '2.3.0',

  SHEETS: Object.freeze({
    CONFIG: 'Configuration',
    LISTS: 'Lists',
    USERS: 'Users',
    HEADERS: 'FMR_Header',
    LINES: 'FMR_Line_Items',
    BACKORDERS: 'Backorder_Requests',
    TRANSACTIONS: 'Material_Transactions',
    AUDIT: 'Audit_Log',
    BAG_TAGS: 'Bag_Tags',
    BAG_TAG_ITEMS: 'Bag_Tag_Items'
  }),

  ROLES: Object.freeze({
    ADMIN: 'ADMINISTRATOR',
    PLANNER: 'PLANNER',
    MATERIAL_CONTROL: 'MATERIAL CONTROL',
    FIELD_HANDLER: 'FIELD MATERIAL HANDLER',
    FOREMAN: 'FOREMAN',
    SUPERINTENDENT: 'SUPERINTENDENT',
    LEADERSHIP: 'LEADERSHIP',
    AUDITOR: 'AUDITOR'
  }),

  LIST_FIELDS: Object.freeze({
    BACKORDER_REASON: 'Backorder_Reason'
  })
});

var SHEET_CACHE_ = {};
var CONFIG_CACHE_ = null;
var ACTIVE_DATABASE_ID_ = '';
var ACTIVE_DATABASE_ = null;

function setDatabaseContext_(databaseId) {
  const id = normalize_(databaseId);
  if (!id) throw new Error('Database spreadsheet ID is required.');

  if (ACTIVE_DATABASE_ID_ !== id) {
    ACTIVE_DATABASE_ID_ = id;
    ACTIVE_DATABASE_ = SpreadsheetApp.openById(id);
    clearAllCaches_();
  }

  if (!ACTIVE_DATABASE_) {
    ACTIVE_DATABASE_ = SpreadsheetApp.openById(id);
  }
}

function database_() {
  if (ACTIVE_DATABASE_) return ACTIVE_DATABASE_;
  if (ACTIVE_DATABASE_ID_) {
    ACTIVE_DATABASE_ = SpreadsheetApp.openById(ACTIVE_DATABASE_ID_);
    return ACTIVE_DATABASE_;
  }
  throw new Error('Database context has not been set.');
}

function normalize_(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeUpper_(value) {
  return normalize_(value).toUpperCase();
}

function number_(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = normalize_(value).replace(/,/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uuid_(prefix) {
  const stamp = Utilities.getUuid().replace(/-/g, '').toUpperCase();
  return `${normalize_(prefix) || 'ID'}_${stamp}`;
}

function now_() {
  return new Date();
}

function uniqueSorted_(values) {
  const seen = {};
  const result = [];
  (values || []).forEach(value => {
    const normalized = normalize_(value);
    if (!normalized) return;
    const key = normalizeUpper_(normalized);
    if (seen[key]) return;
    seen[key] = true;
    result.push(normalized);
  });
  return result.sort((a, b) =>
    a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'})
  );
}

function lineSheetKey_(lineNumber, sheetNumber) {
  const line = normalizeUpper_(lineNumber);
  const sheet = normalizeUpper_(sheetNumber);
  if (!line) throw new Error('ISO line number is required.');
  if (!sheet) throw new Error('ISO sheet number is required.');
  return `${line}|${sheet}`;
}

function formatTimestamp_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return normalize_(value);
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone() || 'America/Chicago',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function truthyFlag_(value) {
  if (value === true || value === 1) return true;
  const normalized = normalizeUpper_(value);
  return ['TRUE', 'YES', 'Y', '1', 'ACTIVE'].includes(normalized);
}
