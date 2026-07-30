/**
 * FMRCore v2.2.0 — contractor-controlled library configuration.
 * Step 3 adds controlled Field Portal transactions and shared-iPad attribution.
 */
const FMR_CORE = Object.freeze({
  VERSION: '2.2.0-step3-field',
  SHEETS: Object.freeze({
    CONFIG: 'Configuration',
    LISTS: 'Lists',
    USERS: 'Users',
    IWP: 'IWP_Master',
    ISO: 'ISO_Master',
    HEADERS: 'FMR_Header',
    LINKS: 'FMR_ISO_Link',
    LINES: 'FMR_Line_Items',
    TRANSACTIONS: 'Material_Transactions',
    BAG_HEADERS: 'Bag_Tag_Header',
    BAG_ITEMS: 'Bag_Tag_Items',
    BACKORDERS: 'Backorder_Requests',
    AUDIT: 'Audit_Log',
    SEARCH_INDEX: 'Search_Index'
  }),
  ROLES: Object.freeze({
    ADMIN: 'Administrator',
    PLANNER: 'Planner',
    MATERIAL_CONTROL: 'Material Control',
    FIELD_HANDLER: 'Field Material Handler',
    FOREMAN: 'Foreman',
    SUPERINTENDENT: 'Superintendent',
    LEADERSHIP: 'Leadership',
    AUDITOR: 'Auditor'
  }),
  ACTIONS: Object.freeze({
    CONFIRM_AVAILABLE: 'CONFIRM_AVAILABLE',
    BAG: 'BAG',
    DIRECT_ISSUE: 'DIRECT_ISSUE',
    ISSUE_FROM_AVAILABLE: 'ISSUE_FROM_AVAILABLE',
    ISSUE_FROM_BAG: 'ISSUE_FROM_BAG',
    BACKORDER_REQUESTED: 'BACKORDER_REQUESTED'
  }),
  ADMIN_RESULT_LIMIT: 200
});

let DATABASE_ID_ = '';
let SHEET_CACHE_ = {};
let CONFIG_CACHE_ = null;

function setDatabaseContext_(databaseId) {
  if (!databaseId) throw new Error('databaseId is required.');
  const nextId = String(databaseId);
  if (DATABASE_ID_ !== nextId) {
    DATABASE_ID_ = nextId;
    SHEET_CACHE_ = {};
    CONFIG_CACHE_ = null;
  }
}

function database_() {
  if (!DATABASE_ID_) throw new Error('Database context has not been initialized.');
  return SpreadsheetApp.openById(DATABASE_ID_);
}

function now_() {
  return new Date();
}

function uuid_(prefix) {
  return `${prefix}-${Utilities.getUuid().toUpperCase()}`;
}

function normalize_(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeUpper_(value) {
  return normalize_(value).toUpperCase();
}

function lineSheetKey_(lineNumber, sheetNumber) {
  const line = normalizeUpper_(lineNumber);
  const sheet = normalizeUpper_(sheetNumber);
  if (!line || !sheet) throw new Error('ISO Line Number and ISO Sheet are required.');
  return `${line}|${sheet}`;
}

function number_(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber_(value, label) {
  const parsed = number_(value);
  if (parsed <= 0) throw new Error(`${label || 'Quantity'} must be greater than zero.`);
  return parsed;
}

function formatDateTime_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return normalize_(value);
  const timezone = normalize_(getConfiguration_().TIMEZONE) || Session.getScriptTimeZone();
  return Utilities.formatDate(date, timezone, 'yyyy-MM-dd HH:mm');
}

function parseOptionalDate_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function uniqueSorted_(values) {
  return [...new Set(values.map(normalize_).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
}

function includesNormalized_(value, searchValue) {
  const search = normalizeUpper_(searchValue);
  return !search || normalizeUpper_(value).includes(search);
}
