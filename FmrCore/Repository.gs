/** Cached repository layer. The company adapter never receives these implementations. */
function getSheetData_(sheetName) {
  if (SHEET_CACHE_[sheetName]) return SHEET_CACHE_[sheetName];

  const sheet = database_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing required sheet: ${sheetName}`);

  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error(`Sheet has no header row: ${sheetName}`);

  const headers = values[0].map(normalize_);
  const rows = values.slice(1)
    .filter(row => row.some(value => value !== '' && value != null))
    .map((row, index) => {
      const record = {_rowNumber: index + 2};
      headers.forEach((header, columnIndex) => {
        record[header] = row[columnIndex];
      });
      return record;
    });

  const result = {sheet, headers, rows};
  SHEET_CACHE_[sheetName] = result;
  return result;
}

function clearAllCaches_() {
  SHEET_CACHE_ = {};
  CONFIG_CACHE_ = null;
}

function invalidateSheetCache_(sheetName) {
  delete SHEET_CACHE_[sheetName];
  if (sheetName === FMR_CORE.SHEETS.CONFIG) CONFIG_CACHE_ = null;
}

function appendRecord_(sheetName, record) {
  const table = getSheetData_(sheetName);
  table.sheet.appendRow(table.headers.map(header => record[header] ?? ''));
  invalidateSheetCache_(sheetName);
}

function appendRecords_(sheetName, records) {
  if (!records || !records.length) return;
  const table = getSheetData_(sheetName);
  const values = records.map(record => table.headers.map(header => record[header] ?? ''));
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, values.length, table.headers.length)
    .setValues(values);
  invalidateSheetCache_(sheetName);
}

function findRecord_(sheetName, keyField, keyValue) {
  const target = normalize_(keyValue);
  return getSheetData_(sheetName).rows.find(row => normalize_(row[keyField]) === target) || null;
}

function findRecords_(sheetName, keyField, keyValue) {
  const target = normalize_(keyValue);
  return getSheetData_(sheetName).rows.filter(row => normalize_(row[keyField]) === target);
}

function updateRecord_(sheetName, keyField, keyValue, patch) {
  const table = getSheetData_(sheetName);
  const target = normalize_(keyValue);
  const row = table.rows.find(record => normalize_(record[keyField]) === target);
  if (!row) throw new Error(`${keyField} not found: ${keyValue}`);

  Object.entries(patch).forEach(([field, value]) => {
    const columnIndex = table.headers.indexOf(field);
    if (columnIndex >= 0) {
      table.sheet.getRange(row._rowNumber, columnIndex + 1).setValue(value);
    }
  });

  invalidateSheetCache_(sheetName);
}

function getConfiguration_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;

  const rows = getSheetData_(FMR_CORE.SHEETS.CONFIG).rows;
  CONFIG_CACHE_ = Object.fromEntries(
    rows.filter(row => row.Setting).map(row => [String(row.Setting), row.Value])
  );
  return CONFIG_CACHE_;
}

function setConfigurationValue_(key, value) {
  updateRecord_(FMR_CORE.SHEETS.CONFIG, 'Setting', key, {Value: value});
  CONFIG_CACHE_ = null;
}

function getListValues_(fieldName) {
  return uniqueSorted_(
    getSheetData_(FMR_CORE.SHEETS.LISTS).rows.map(row => row[fieldName])
  );
}

function writeAudit_(entityType, entityId, action, user, correlationId, details) {
  appendRecord_(FMR_CORE.SHEETS.AUDIT, {
    Audit_ID: uuid_('AUDIT'),
    Entity_Type: entityType,
    Entity_ID: entityId,
    Action: action,
    User_Email: user.email,
    User_Name: user.name,
    Timestamp: now_(),
    Source_Interface: user.sourceInterface || '',
    Correlation_ID: correlationId || '',
    New_Value: details ? JSON.stringify(details) : ''
  });
}
