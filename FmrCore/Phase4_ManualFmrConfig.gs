//Phase4_ManualFmrConfig.gs
const FMR_MANUAL_CONFIG = Object.freeze({
  schemaVersion: '1.0.0',
  serviceVersion: 'manual-fmr-intake-v1',

  sheets: Object.freeze({
    entry: 'FMR_Manual_Entry',
    review: 'FMR_Manual_Review',
    batches: 'FMR_Manual_Batches',
    canonicalHeader: 'FMR_Header',
    canonicalLines: 'FMR_Line_Items',
    canonicalIsoLink: 'FMR_ISO_Link',
    auditLog: 'Audit_Log',
    lists: 'Lists'
  }),

  defaults: Object.freeze({
    revision: '0',
    priority: 'Routine',
    craft: 'PIPE',
    deliverTo: 'Cedric Labassiere',
    destination: 'Field',
    warehouse: 'Turner',
    uom: 'EA',
    entryMethod: 'MANUAL',
    entryStatus: 'DRAFT',
    canonicalFmrStatus: 'Draft',
    canonicalLineStatus: 'Open'
  }),

  entryStatuses: Object.freeze({
    DRAFT: 'DRAFT',
    READY_FOR_REVIEW: 'READY_FOR_REVIEW',
    NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    SUPERSEDED: 'SUPERSEDED',
    VOIDED: 'VOIDED'
  }),

  reviewDecisions: Object.freeze({
    APPROVE: 'APPROVE',
    RETURN_FOR_CLARIFICATION: 'RETURN_FOR_CLARIFICATION',
    REJECT: 'REJECT'
  }),

  batchStatuses: Object.freeze({
    OPEN: 'OPEN',
    READY_FOR_REVIEW: 'READY_FOR_REVIEW',
    IN_REVIEW: 'IN_REVIEW',
    COMPLETED: 'COMPLETED',
    COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
    CANCELLED: 'CANCELLED'
  }),

  entryMethods: Object.freeze({
    MANUAL: 'MANUAL',
    OCR: 'OCR',
    CSV_IMPORT: 'CSV_IMPORT',
    SYSTEM: 'SYSTEM'
  }),

  sourceDocumentTypes: Object.freeze({
    FMR: 'FMR',
    OTHER: 'OTHER'
  }),

  canonicalFmrStatuses: Object.freeze([
    'Draft',
    'Submitted',
    'Under Review',
    'Approved',
    'Sourcing',
    'Partially Located',
    'Located',
    'Partially Issued',
    'Issued',
    'Closed',
    'Cancelled',
    'On Hold'
  ]),

  canonicalLineStatuses: Object.freeze([
    'Open',
    'Partially Located',
    'Located',
    'Partially Bagged',
    'Bagged',
    'Partially Issued',
    'Issued',
    'Pending Backorder',
    'Backordered',
    'Cancelled'
  ]),

  priorities: Object.freeze([
    'Routine',
    'High',
    'Urgent',
    'Critical'
  ]),

  uoms: Object.freeze([
    'EA',
    'FT',
    'LF',
    'IN',
    'BOX',
    'SET',
    'LOT'
  ]),

  regex: Object.freeze({
    fmrNumber: /^[A-Za-z0-9][A-Za-z0-9._()\/-]{2,79}$/,
    iwpNumber: /^[A-Za-z0-9][A-Za-z0-9._()\/-]{1,79}$/,
    revision: /^[A-Za-z0-9._-]{1,20}$/,
    fmrLineNumber: /^[1-9]\d{0,3}$/,
    isoSheet: /^[A-Za-z0-9]{1,10}$/,
    commodityCode: /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    pipe: /^\s*PIPE(?:\s|$)/i,
    positiveQuantity: /^\d+(?:\.\d+)?$/,
    safeIdentifier: /^[A-Za-z0-9_-]+$/
  }),

  entryHeaders: Object.freeze([
    'Entry_Row_ID',
    'Batch_ID',
    'Source_Document_Type',
    'Source_File_ID',
    'Source_File_Name',
    'Source_File_URL',
    'FMR_Number',
    'Revision',
    'IWP_Number',
    'Request_Date',
    'Date_Required',
    'Requested_By',
    'Requested_By_Email',
    'Craft',
    'Deliver_To',
    'Destination',
    'Warehouse',
    'Priority',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'FMR_Line_Number',
    'Commodity_Code',
    'Size',
    'Material_Description',
    'UOM',
    'Qty_Requested',
    'Is_Pipe',
    'Entry_Method',
    'Entry_Status',
    'Entered_By',
    'Entered_At',
    'Reviewer_Email',
    'Reviewed_At',
    'Review_Notes',
    'Validation_Errors',
    'Row_Content_Hash'
  ]),

  reviewHeaders: Object.freeze([
    'Review_ID',
    'Entry_Row_ID',
    'Batch_ID',
    'Source_File_ID',
    'Source_File_Name',
    'Source_File_URL',
    'FMR_Number',
    'Revision',
    'IWP_Number',
    'FMR_Line_Number',
    'Commodity_Code',
    'Size',
    'Material_Description',
    'UOM',
    'Qty_Requested',
    'Is_Pipe',
    'Submitted_By',
    'Submitted_At',
    'Validation_Errors',
    'Review_Decision',
    'Reviewer_Email',
    'Reviewed_At',
    'Reviewer_Notes',
    'Canonical_FMR_ID',
    'Canonical_FMR_Line_ID',
    'Review_Content_Hash'
  ]),

  batchHeaders: Object.freeze([
    'Batch_ID',
    'Batch_Name',
    'Source_Document_Type',
    'Source_Folder_ID',
    'Source_Folder_URL',
    'Assigned_Entry_User_1',
    'Assigned_Entry_User_2',
    'Assigned_Reviewer',
    'Batch_Status',
    'Expected_FMR_Count',
    'Expected_Line_Count',
    'Entered_FMR_Count',
    'Entered_Line_Count',
    'Approved_FMR_Count',
    'Approved_Line_Count',
    'Rejected_Line_Count',
    'Created_By',
    'Created_At',
    'Updated_At',
    'Notes'
  ]),

  canonicalHeaderFields: Object.freeze([
    'FMR_ID',
    'FMR_Number',
    'Revision',
    'Current_Status',
    'Priority',
    'Project_Code',
    'Area',
    'IWP_ID',
    'IWP_Number',
    'Requested_By',
    'Requested_By_Email',
    'Craft',
    'Deliver_To',
    'Destination',
    'Warehouse',
    'Date_Created',
    'Date_Required',
    'Date_Submitted',
    'Date_Approved',
    'Date_Closed',
    'Reason_Code',
    'Reason_Detail',
    'Total_Lines',
    'Qty_Requested',
    'Qty_Confirmed_Located',
    'Qty_Active_Bagged',
    'Qty_Available',
    'Qty_Issued',
    'Qty_Pending_Backorder',
    'Qty_Confirmed_Backorder',
    'Qty_Remaining_Requirement',
    'Fulfillment_Pct',
    'Age_Days',
    'Risk_Flag',
    'Assigned_To_Email',
    'Folder_ID',
    'Folder_URL',
    'Sheet_File_ID',
    'Sheet_URL',
    'PDF_File_ID',
    'PDF_URL',
    'Created_By',
    'Updated_At',
    'Last_Activity_At',
    'Notes'
  ]),

  canonicalLineFields: Object.freeze([
    'FMR_Line_ID',
    'FMR_ID',
    'FMR_Number',
    'FMR_Line_Number',
    'IWP_ID',
    'IWP_Number',
    'ISO_ID',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'Commodity_Code',
    'Size',
    'Material_Description',
    'UOM',
    'Qty_Requested',
    'Qty_Confirmed_Located',
    'Qty_Active_Bagged',
    'Qty_Available',
    'Qty_Issued',
    'Qty_Pending_Backorder',
    'Qty_Confirmed_Backorder',
    'Qty_Not_Yet_Located',
    'Qty_Remaining_Requirement',
    'Line_Status',
    'Storage_Location',
    'Date_First_Located',
    'Date_First_Bagged',
    'Date_First_Issued',
    'Created_By',
    'Created_At',
    'Updated_At',
    'Notes'
  ]),

  validationReasons: Object.freeze({
    MISSING_ENTRY_ROW_ID: 'missing_entry_row_id',
    MISSING_BATCH_ID: 'missing_batch_id',
    MISSING_SOURCE_FILE_REFERENCE: 'missing_source_file_reference',
    INVALID_SOURCE_FILE_ID: 'invalid_source_file_id',
    MISSING_FMR_NUMBER: 'missing_fmr_number',
    INVALID_FMR_NUMBER: 'invalid_fmr_number',
    MISSING_REVISION: 'missing_revision',
    INVALID_REVISION: 'invalid_revision',
    MISSING_IWP_NUMBER: 'missing_iwp_number',
    INVALID_IWP_NUMBER: 'invalid_iwp_number',
    MISSING_REQUESTED_BY: 'missing_requested_by',
    INVALID_REQUESTED_BY_EMAIL: 'invalid_requested_by_email',
    MISSING_FMR_LINE_NUMBER: 'missing_fmr_line_number',
    INVALID_FMR_LINE_NUMBER: 'invalid_fmr_line_number',
    MISSING_COMMODITY_CODE: 'missing_commodity_code',
    INVALID_COMMODITY_CODE: 'invalid_commodity_code',
    MISSING_SIZE: 'missing_size',
    MISSING_DESCRIPTION: 'missing_description',
    MISSING_UOM: 'missing_uom',
    INVALID_UOM: 'invalid_uom',
    MISSING_QUANTITY: 'missing_quantity',
    INVALID_QUANTITY: 'invalid_quantity',
    NONPOSITIVE_QUANTITY: 'nonpositive_quantity',
    PIPE_FLAG_MISMATCH: 'pipe_flag_mismatch',
    INVALID_ENTRY_METHOD: 'invalid_entry_method',
    INVALID_ENTRY_STATUS: 'invalid_entry_status',
    MISSING_ENTERED_BY: 'missing_entered_by',
    MISSING_ENTERED_AT: 'missing_entered_at',
    DUPLICATE_STAGING_LINE: 'duplicate_staging_line',
    DUPLICATE_CANONICAL_LINE: 'duplicate_canonical_line',
    CONFLICTING_FMR_HEADER: 'conflicting_fmr_header',
    SOURCE_REVISION_CONFLICT: 'source_revision_conflict'
  })
});

/* ========================================================================== */
/* PUBLIC ACCESSORS                                                           */
/* ========================================================================== */

function getManualFmrConfig() {
  return {
    schemaVersion: FMR_MANUAL_CONFIG.schemaVersion,
    serviceVersion: FMR_MANUAL_CONFIG.serviceVersion,
    sheets: Object.assign({}, FMR_MANUAL_CONFIG.sheets),
    defaults: Object.assign({}, FMR_MANUAL_CONFIG.defaults),
    statuses: Object.assign({}, FMR_MANUAL_CONFIG.entryStatuses),
    decisions: Object.assign({}, FMR_MANUAL_CONFIG.reviewDecisions),
    entryMethods: Object.assign({}, FMR_MANUAL_CONFIG.entryMethods)
  };
}

function getManualFmrSheetNames() {
  return Object.assign({}, FMR_MANUAL_CONFIG.sheets);
}

function getManualFmrHeaderDefinitions() {
  return {
    entry: Array.from(FMR_MANUAL_CONFIG.entryHeaders),
    review: Array.from(FMR_MANUAL_CONFIG.reviewHeaders),
    batches: Array.from(FMR_MANUAL_CONFIG.batchHeaders),
    canonicalHeader: Array.from(
      FMR_MANUAL_CONFIG.canonicalHeaderFields
    ),
    canonicalLines: Array.from(
      FMR_MANUAL_CONFIG.canonicalLineFields
    )
  };
}

function getManualFmrStatusOptions() {
  return {
    entryStatuses: Object.keys(
      FMR_MANUAL_CONFIG.entryStatuses
    ).map(function (key) {
      return FMR_MANUAL_CONFIG.entryStatuses[key];
    }),
    reviewDecisions: Object.keys(
      FMR_MANUAL_CONFIG.reviewDecisions
    ).map(function (key) {
      return FMR_MANUAL_CONFIG.reviewDecisions[key];
    }),
    batchStatuses: Object.keys(
      FMR_MANUAL_CONFIG.batchStatuses
    ).map(function (key) {
      return FMR_MANUAL_CONFIG.batchStatuses[key];
    }),
    priorities: Array.from(FMR_MANUAL_CONFIG.priorities),
    uoms: Array.from(FMR_MANUAL_CONFIG.uoms)
  };
}

/* ========================================================================== */
/* NORMALIZATION                                                              */
/* ========================================================================== */

function normalizeManualFmrText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeManualFmrUpper_(value) {
  return normalizeManualFmrText_(value).toUpperCase();
}

function normalizeManualFmrEmail_(value) {
  return normalizeManualFmrText_(value).toLowerCase();
}

function normalizeManualFmrBoolean_(value) {
  if (value === true || value === false) {
    return value;
  }

  const normalized = normalizeManualFmrUpper_(value);

  return (
    normalized === 'TRUE' ||
    normalized === 'YES' ||
    normalized === 'Y' ||
    normalized === '1'
  );
}

function normalizeManualFmrQuantity_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const text = normalizeManualFmrText_(value)
    .replace(/,/g, '')
    .replace(/[′']/g, '');

  if (!FMR_MANUAL_CONFIG.regex.positiveQuantity.test(text)) {
    return text;
  }

  return Number(text);
}

function normalizeManualFmrDate_(value) {
  if (!value) {
    return '';
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  const parsed = new Date(value);

  if (isNaN(parsed.getTime())) {
    return normalizeManualFmrText_(value);
  }

  return parsed;
}

function normalizeManualFmrEntryStatus_(value) {
  const normalized = normalizeManualFmrUpper_(
    value || FMR_MANUAL_CONFIG.defaults.entryStatus
  );

  const allowed = Object.keys(
    FMR_MANUAL_CONFIG.entryStatuses
  ).map(function (key) {
    return FMR_MANUAL_CONFIG.entryStatuses[key];
  });

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid manual FMR entry status "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function normalizeManualFmrEntryMethod_(value) {
  const normalized = normalizeManualFmrUpper_(
    value || FMR_MANUAL_CONFIG.defaults.entryMethod
  );

  const allowed = Object.keys(
    FMR_MANUAL_CONFIG.entryMethods
  ).map(function (key) {
    return FMR_MANUAL_CONFIG.entryMethods[key];
  });

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid manual FMR entry method "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function isManualFmrPipeStock_(description) {
  return FMR_MANUAL_CONFIG.regex.pipe.test(
    normalizeManualFmrText_(description)
  );
}

/* ========================================================================== */
/* ROW NORMALIZATION + VALIDATION                                             */
/* ========================================================================== */

function normalizeManualFmrEntryRow(row) {
  const source = row || {};
  const normalized = {};

  FMR_MANUAL_CONFIG.entryHeaders.forEach(function (header) {
    normalized[header] =
      source[header] === undefined || source[header] === null
        ? ''
        : source[header];
  });

  normalized.Entry_Row_ID = normalizeManualFmrText_(
    normalized.Entry_Row_ID
  );
  normalized.Batch_ID = normalizeManualFmrText_(
    normalized.Batch_ID
  );
  normalized.Source_Document_Type = normalizeManualFmrUpper_(
    normalized.Source_Document_Type ||
      FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR
  );
  normalized.Source_File_ID = normalizeManualFmrText_(
    normalized.Source_File_ID
  );
  normalized.Source_File_Name = normalizeManualFmrText_(
    normalized.Source_File_Name
  );
  normalized.Source_File_URL = normalizeManualFmrText_(
    normalized.Source_File_URL
  );
  normalized.FMR_Number = normalizeManualFmrText_(
    normalized.FMR_Number
  );
  normalized.Revision = normalizeManualFmrText_(
    normalized.Revision || FMR_MANUAL_CONFIG.defaults.revision
  );
  normalized.IWP_Number = normalizeManualFmrText_(
    normalized.IWP_Number
  );
  normalized.Request_Date = normalizeManualFmrDate_(
    normalized.Request_Date
  );
  normalized.Date_Required = normalizeManualFmrDate_(
    normalized.Date_Required
  );
  normalized.Requested_By = normalizeManualFmrText_(
    normalized.Requested_By
  );
  normalized.Requested_By_Email = normalizeManualFmrEmail_(
    normalized.Requested_By_Email
  );
  normalized.Craft = normalizeManualFmrUpper_(
    normalized.Craft || FMR_MANUAL_CONFIG.defaults.craft
  );
  normalized.Deliver_To = normalizeManualFmrText_(
    normalized.Deliver_To || FMR_MANUAL_CONFIG.defaults.deliverTo
  );
  normalized.Destination = normalizeManualFmrText_(
    normalized.Destination || FMR_MANUAL_CONFIG.defaults.destination
  );
  normalized.Warehouse = normalizeManualFmrText_(
    normalized.Warehouse || FMR_MANUAL_CONFIG.defaults.warehouse
  );
  normalized.Priority = normalizeManualFmrText_(
    normalized.Priority || FMR_MANUAL_CONFIG.defaults.priority
  );
  normalized.ISO_Line_Number = normalizeManualFmrText_(
    normalized.ISO_Line_Number
  );
  normalized.ISO_Sheet = normalizeManualFmrText_(
    normalized.ISO_Sheet
  );
  normalized.ISO_Drawing_Number = normalizeManualFmrText_(
    normalized.ISO_Drawing_Number
  );
  normalized.FMR_Line_Number = normalizeManualFmrText_(
    normalized.FMR_Line_Number
  );
  normalized.Commodity_Code = normalizeManualFmrText_(
    normalized.Commodity_Code
  );
  normalized.Size = normalizeManualFmrText_(normalized.Size);
  normalized.Material_Description = normalizeManualFmrText_(
    normalized.Material_Description
  );
  normalized.UOM = normalizeManualFmrUpper_(
    normalized.UOM || FMR_MANUAL_CONFIG.defaults.uom
  );
  normalized.Qty_Requested = normalizeManualFmrQuantity_(
    normalized.Qty_Requested
  );

  const derivedPipe = isManualFmrPipeStock_(
    normalized.Material_Description
  );

  normalized.Is_Pipe =
    normalized.Is_Pipe === ''
      ? derivedPipe
      : normalizeManualFmrBoolean_(normalized.Is_Pipe);

  normalized.Entry_Method = normalizeManualFmrEntryMethod_(
    normalized.Entry_Method
  );
  normalized.Entry_Status = normalizeManualFmrEntryStatus_(
    normalized.Entry_Status
  );
  normalized.Entered_By = normalizeManualFmrEmail_(
    normalized.Entered_By
  );
  normalized.Entered_At = normalizeManualFmrDate_(
    normalized.Entered_At
  );
  normalized.Reviewer_Email = normalizeManualFmrEmail_(
    normalized.Reviewer_Email
  );
  normalized.Reviewed_At = normalizeManualFmrDate_(
    normalized.Reviewed_At
  );
  normalized.Review_Notes = normalizeManualFmrText_(
    normalized.Review_Notes
  );
  normalized.Validation_Errors = normalizeManualFmrText_(
    normalized.Validation_Errors
  );

  normalized.Row_Content_Hash =
    normalizeManualFmrText_(normalized.Row_Content_Hash) ||
    hashManualFmrEntryRow_(normalized);

  return normalized;
}

function validateManualFmrEntryRow(row) {
  const normalized = normalizeManualFmrEntryRow(row);
  const errors = [];
  const warnings = [];
  const reasons = FMR_MANUAL_CONFIG.validationReasons;

  if (!normalized.Entry_Row_ID) {
    errors.push(reasons.MISSING_ENTRY_ROW_ID);
  }

  if (!normalized.Batch_ID) {
    errors.push(reasons.MISSING_BATCH_ID);
  }

  if (!normalized.Source_File_ID && !normalized.Source_File_URL) {
    errors.push(reasons.MISSING_SOURCE_FILE_REFERENCE);
  }

  if (
    normalized.Source_File_ID &&
    !FMR_MANUAL_CONFIG.regex.safeIdentifier.test(
      normalized.Source_File_ID
    )
  ) {
    errors.push(reasons.INVALID_SOURCE_FILE_ID);
  }

  if (!normalized.FMR_Number) {
    errors.push(reasons.MISSING_FMR_NUMBER);
  } else if (
    !FMR_MANUAL_CONFIG.regex.fmrNumber.test(normalized.FMR_Number)
  ) {
    errors.push(reasons.INVALID_FMR_NUMBER);
  }

  if (!normalized.Revision) {
    errors.push(reasons.MISSING_REVISION);
  } else if (
    !FMR_MANUAL_CONFIG.regex.revision.test(normalized.Revision)
  ) {
    errors.push(reasons.INVALID_REVISION);
  }

  if (!normalized.IWP_Number) {
    errors.push(reasons.MISSING_IWP_NUMBER);
  } else if (
    !FMR_MANUAL_CONFIG.regex.iwpNumber.test(normalized.IWP_Number)
  ) {
    errors.push(reasons.INVALID_IWP_NUMBER);
  }

  if (!normalized.Requested_By) {
    errors.push(reasons.MISSING_REQUESTED_BY);
  }

  if (
    normalized.Requested_By_Email &&
    !FMR_MANUAL_CONFIG.regex.email.test(normalized.Requested_By_Email)
  ) {
    errors.push(reasons.INVALID_REQUESTED_BY_EMAIL);
  }

  if (!normalized.FMR_Line_Number) {
    errors.push(reasons.MISSING_FMR_LINE_NUMBER);
  } else if (
    !FMR_MANUAL_CONFIG.regex.fmrLineNumber.test(
      normalized.FMR_Line_Number
    )
  ) {
    errors.push(reasons.INVALID_FMR_LINE_NUMBER);
  }

  if (!normalized.Commodity_Code) {
    errors.push(reasons.MISSING_COMMODITY_CODE);
  } else if (
    !FMR_MANUAL_CONFIG.regex.commodityCode.test(
      normalized.Commodity_Code
    )
  ) {
    errors.push(reasons.INVALID_COMMODITY_CODE);
  }

  if (!normalized.Size) {
    errors.push(reasons.MISSING_SIZE);
  }

  if (!normalized.Material_Description) {
    errors.push(reasons.MISSING_DESCRIPTION);
  }

  if (!normalized.UOM) {
    errors.push(reasons.MISSING_UOM);
  } else if (
    FMR_MANUAL_CONFIG.uoms.indexOf(normalized.UOM) === -1
  ) {
    errors.push(reasons.INVALID_UOM);
  }

  if (
    normalized.Qty_Requested === '' ||
    normalized.Qty_Requested === null ||
    normalized.Qty_Requested === undefined
  ) {
    errors.push(reasons.MISSING_QUANTITY);
  } else if (
    typeof normalized.Qty_Requested !== 'number' ||
    !Number.isFinite(normalized.Qty_Requested)
  ) {
    errors.push(reasons.INVALID_QUANTITY);
  } else if (normalized.Qty_Requested <= 0) {
    errors.push(reasons.NONPOSITIVE_QUANTITY);
  }

  const derivedPipe = isManualFmrPipeStock_(
    normalized.Material_Description
  );

  if (Boolean(normalized.Is_Pipe) !== derivedPipe) {
    warnings.push(reasons.PIPE_FLAG_MISMATCH);
  }

  if (!normalized.Entered_By) {
    errors.push(reasons.MISSING_ENTERED_BY);
  } else if (
    !FMR_MANUAL_CONFIG.regex.email.test(normalized.Entered_By)
  ) {
    errors.push(reasons.INVALID_REQUESTED_BY_EMAIL);
  }

  if (!normalized.Entered_At) {
    errors.push(reasons.MISSING_ENTERED_AT);
  }

  const uniqueErrors = Array.from(new Set(errors));
  const uniqueWarnings = Array.from(new Set(warnings));

  normalized.Validation_Errors = uniqueErrors.join(';');
  normalized.Row_Content_Hash = hashManualFmrEntryRow_(normalized);

  return {
    normalized,
    valid: uniqueErrors.length === 0,
    readyForReview: uniqueErrors.length === 0,
    readyForApproval:
      uniqueErrors.length === 0 &&
      normalized.Entry_Status ===
        FMR_MANUAL_CONFIG.entryStatuses.READY_FOR_REVIEW,
    errors: uniqueErrors,
    warnings: uniqueWarnings
  };
}

/* ========================================================================== */
/* KEYS, IDS, AND HASHES                                                      */
/* ========================================================================== */

function createManualFmrBatchId_() {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  return `FMRBATCH-${timestamp}-${Utilities.getUuid().slice(0, 8)}`;
}

function createManualFmrEntryRowId_() {
  return `FMRENTRY-${Utilities.getUuid()}`;
}

function createManualFmrReviewId_() {
  return `FMRREVIEW-${Utilities.getUuid()}`;
}

function buildManualFmrDuplicateKey_(row) {
  const normalized = normalizeManualFmrEntryRow(row);

  return [
    normalizeManualFmrUpper_(normalized.FMR_Number),
    normalizeManualFmrUpper_(normalized.Revision),
    normalizeManualFmrUpper_(normalized.FMR_Line_Number),
    normalizeManualFmrUpper_(normalized.Commodity_Code),
    normalizeManualFmrUpper_(normalized.Size)
  ].join('|');
}

function buildManualFmrHeaderConsistencyKey_(row) {
  const normalized = normalizeManualFmrEntryRow(row);

  return [
    normalizeManualFmrUpper_(normalized.FMR_Number),
    normalizeManualFmrUpper_(normalized.Revision),
    normalizeManualFmrUpper_(normalized.IWP_Number),
    normalizeManualFmrUpper_(normalized.Requested_By),
    normalizeManualFmrUpper_(normalized.Craft),
    normalizeManualFmrUpper_(normalized.Deliver_To),
    normalizeManualFmrUpper_(normalized.Destination),
    normalizeManualFmrUpper_(normalized.Warehouse)
  ].join('|');
}

function hashManualFmrEntryRow_(row) {
  const content = [
    normalizeManualFmrUpper_(row.FMR_Number),
    normalizeManualFmrUpper_(row.Revision),
    normalizeManualFmrUpper_(row.IWP_Number),
    normalizeManualFmrUpper_(row.FMR_Line_Number),
    normalizeManualFmrUpper_(row.ISO_Line_Number),
    normalizeManualFmrUpper_(row.ISO_Sheet),
    normalizeManualFmrUpper_(row.ISO_Drawing_Number),
    normalizeManualFmrUpper_(row.Commodity_Code),
    normalizeManualFmrUpper_(row.Size),
    normalizeManualFmrText_(row.Material_Description),
    normalizeManualFmrUpper_(row.UOM),
    String(row.Qty_Requested === undefined ? '' : row.Qty_Requested),
    String(Boolean(row.Is_Pipe))
  ].join('|');

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    content,
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function (byte) {
      const normalized = (byte + 256) % 256;
      return (`0${normalized.toString(16)}`).slice(-2);
    })
    .join('');
}
