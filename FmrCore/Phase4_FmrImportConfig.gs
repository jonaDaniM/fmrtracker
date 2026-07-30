//Phase4_FmrImportConfig.gs
const FMR_IMPORT_CONFIG = Object.freeze({
  schemaVersion: '1.0.0',
  serviceVersion: 'fmr-document-import-v1',

  sheets: Object.freeze({
    queue: 'FMR_Import_Queue',
    entry: 'FMR_Manual_Entry',
    batches: 'FMR_Manual_Batches',
    users: 'Users',
    auditLog: 'Audit_Log'
  }),

  statuses: Object.freeze({
    DISCOVERED: 'DISCOVERED',
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    STAGED_NEEDS_VERIFICATION: 'STAGED_NEEDS_VERIFICATION',
    SKIPPED_DUPLICATE: 'SKIPPED_DUPLICATE',
    NEEDS_MANUAL_ENTRY: 'NEEDS_MANUAL_ENTRY',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
  }),

  methods: Object.freeze({
    PDF_TO_DOC_OCR: 'PDF_TO_DOC_OCR',
    GOOGLE_SHEET: 'GOOGLE_SHEET',
    XLSX_TO_GOOGLE_SHEET: 'XLSX_TO_GOOGLE_SHEET'
  }),

  templates: Object.freeze({
    TURNER_FMR_V1: 'TURNER_FMR_V1',
    UNKNOWN: 'UNKNOWN'
  }),

  mimeTypes: Object.freeze({
    PDF: 'application/pdf',
    GOOGLE_SHEET: 'application/vnd.google-apps.spreadsheet',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }),

  supportedMimeTypes: Object.freeze([
    'application/pdf',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),

  defaults: Object.freeze({
    discoveryPageSize: 100,
    processingChunkSize: 5,
    maximumFilesPerBatch: 5000,
    maximumRuntimeMs: 240000,
    ocrLanguage: 'en',
    confidenceThreshold: 75,
    defaultUom: 'EA',
    filenameFmrFallback: true,
    deleteTemporaryConversions: true
  }),

  queueHeaders: Object.freeze([
    'Import_ID',
    'Batch_ID',
    'Source_File_ID',
    'Source_File_Name',
    'Source_File_URL',
    'Source_Mime_Type',
    'Source_Modified_At',
    'Import_Status',
    'Import_Method',
    'Detected_Template',
    'FMR_Number',
    'Revision',
    'IWP_Number',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'Requested_By',
    'Date_Required',
    'Material_Line_Count',
    'Confidence_Pct',
    'Warnings',
    'Error_Message',
    'Staged_Entry_Row_Count',
    'Started_At',
    'Completed_At',
    'Imported_By',
    'Updated_At',
    'Source_Content_Hash',
    'Temporary_File_ID',
    'Notes'
  ]),

  warningCodes: Object.freeze({
    FMR_NUMBER_MISSING: 'fmr_number_missing',
    FMR_NUMBER_FROM_FILENAME: 'fmr_number_derived_from_filename',
    IWP_MISSING: 'iwp_missing',
    REQUESTED_BY_MISSING: 'requested_by_missing',
    DATE_REQUIRED_MISSING: 'date_required_missing',
    ISO_LINE_MISSING: 'iso_line_missing',
    ISO_SHEET_AMBIGUOUS: 'iso_sheet_ambiguous',
    REVISION_AMBIGUOUS: 'revision_ambiguous',
    MATERIAL_LINES_MISSING: 'material_lines_missing',
    QUANTITY_MISSING: 'quantity_missing',
    DESCRIPTION_WRAPPED: 'description_wrapped',
    TEMPLATE_LOW_CONFIDENCE: 'template_low_confidence',
    SOURCE_IS_FOLDER: 'source_is_folder',
    UNSUPPORTED_MIME_TYPE: 'unsupported_mime_type',
    DUPLICATE_SOURCE: 'duplicate_source',
    POSSIBLE_ISO_DOCUMENT: 'possible_iso_document'
  }),

  regex: Object.freeze({
    driveId: /^[A-Za-z0-9_-]{10,}$/,
    fmrTitle: /FIELD\s+MATERIAL\s+REQUEST\s*\/\s*RETURN\s*\(FMR\)/i,
    probableIsoTitle: /\bISOMETRIC\b|\bPIPING\s+ISOMETRIC\b/i,
    commodityCode: /^[A-Za-z0-9][A-Za-z0-9._\/-]{1,99}$/,
    numericQuantity: /^\d+(?:\.\d+)?$/,
    probableSize: /^[0-9]+(?:\.[0-9]+)?(?:\/[0-9]+)?["']?$|^[0-9]+\/[0-9]+["']?$/i,
    fmrNumber: /^[A-Za-z0-9][A-Za-z0-9._()\/-]{1,79}$/,
    revision: /^[A-Za-z0-9._-]{1,20}$/
  })
});


function getFmrImportConfig() {
  return JSON.parse(JSON.stringify(FMR_IMPORT_CONFIG));
}

function getFmrImportQueueHeaders() {
  return Array.from(FMR_IMPORT_CONFIG.queueHeaders);
}

function getFmrImportStatusOptions() {
  return Object.keys(FMR_IMPORT_CONFIG.statuses).map(function (key) {
    return FMR_IMPORT_CONFIG.statuses[key];
  });
}

function getFmrImportMethodOptions() {
  return Object.keys(FMR_IMPORT_CONFIG.methods).map(function (key) {
    return FMR_IMPORT_CONFIG.methods[key];
  });
}

function getFmrImportSupportedMimeTypes() {
  return Array.from(FMR_IMPORT_CONFIG.supportedMimeTypes);
}

function normalizeFmrImportQueueRecord(record) {
  const source = record || {};
  const output = {};

  FMR_IMPORT_CONFIG.queueHeaders.forEach(function (header) {
    output[header] =
      source[header] === undefined || source[header] === null
        ? ''
        : source[header];
  });

  [
    'Import_ID',
    'Batch_ID',
    'Source_File_ID',
    'Source_File_Name',
    'Source_File_URL',
    'Source_Mime_Type',
    'Import_Status',
    'Import_Method',
    'Detected_Template',
    'FMR_Number',
    'Revision',
    'IWP_Number',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'Requested_By',
    'Warnings',
    'Error_Message',
    'Imported_By',
    'Source_Content_Hash',
    'Temporary_File_ID',
    'Notes'
  ].forEach(function (header) {
    output[header] = normalizeFmrImportText_(output[header]);
  });

  output.Import_Status = normalizeFmrImportUpper_(
    output.Import_Status || FMR_IMPORT_CONFIG.statuses.QUEUED
  );

  output.Import_Method = normalizeFmrImportUpper_(
    output.Import_Method
  );

  output.Detected_Template = normalizeFmrImportUpper_(
    output.Detected_Template || FMR_IMPORT_CONFIG.templates.UNKNOWN
  );

  output.Material_Line_Count = normalizeFmrImportWholeNumber_(
    output.Material_Line_Count,
    0
  );

  output.Confidence_Pct = normalizeFmrImportNumber_(
    output.Confidence_Pct,
    0
  );

  output.Staged_Entry_Row_Count = normalizeFmrImportWholeNumber_(
    output.Staged_Entry_Row_Count,
    0
  );

  return output;
}

function validateFmrImportQueueRecord(record) {
  const normalized = normalizeFmrImportQueueRecord(record);
  const errors = [];

  if (!normalized.Import_ID) {
    errors.push('missing_import_id');
  }

  if (!normalized.Batch_ID) {
    errors.push('missing_batch_id');
  }

  if (!normalized.Source_File_ID) {
    errors.push('missing_source_file_id');
  }

  if (
    normalized.Source_File_ID &&
    !FMR_IMPORT_CONFIG.regex.driveId.test(normalized.Source_File_ID)
  ) {
    errors.push('invalid_source_file_id');
  }

  if (!normalized.Source_File_Name) {
    errors.push('missing_source_file_name');
  }

  if (
    normalized.Source_Mime_Type &&
    FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
      normalized.Source_Mime_Type
    ) === -1
  ) {
    errors.push(FMR_IMPORT_CONFIG.warningCodes.UNSUPPORTED_MIME_TYPE);
  }

  if (
    getFmrImportStatusOptions().indexOf(normalized.Import_Status) === -1
  ) {
    errors.push('invalid_import_status');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized
  };
}

function normalizeFmrImportText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function normalizeFmrImportUpper_(value) {
  return normalizeFmrImportText_(value).toUpperCase();
}

function normalizeFmrImportWholeNumber_(value, fallback) {
  const text = normalizeFmrImportText_(value);

  if (!text) {
    return fallback;
  }

  const number = Number(text.replace(/,/g, ''));

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function normalizeFmrImportNumber_(value, fallback) {
  const text = normalizeFmrImportText_(value);

  if (!text) {
    return fallback;
  }

  const number = Number(text.replace(/,/g, ''));

  return Number.isFinite(number) ? number : fallback;
}
