/**
 * Phase4_ManualFmrSheetService.gs
 *
 * Reusable Google Sheets setup and formatting service for manual FMR intake.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Verify that the existing canonical FMR_Header and FMR_Line_Items sheets
 *   match the contracts defined in Phase4_ManualFmrConfig.gs.
 * - Create and format:
 *     FMR_Manual_Entry
 *     FMR_Manual_Review
 *     FMR_Manual_Batches
 * - Apply data validation, date/quantity formats, filters, header notes, and
 *   status-based conditional formatting.
 * - Return read-only status counts for the manual-intake workflow.
 *
 * NON-RESPONSIBILITIES
 * --------------------
 * - No menus, prompts, alerts, or onOpen().
 * - No PropertiesService.
 * - No Drive-file discovery.
 * - No approval into canonical records.
 * - No edits to existing canonical FMR_Header or FMR_Line_Items data.
 *
 * DEPENDS ON
 * ----------
 * - Phase4_ManualFmrConfig.gs
 */

/* ========================================================================== */
/* PUBLIC ENTRY POINTS                                                        */
/* ========================================================================== */

/**
 * Creates and formats the manual FMR intake sheets.
 *
 * Existing populated manual-intake sheets are not silently remapped. When a
 * populated managed sheet has a mismatched header contract, setup stops with
 * a clear error.
 *
 * The canonical Phase 1-3 sheets are validated but never rewritten.
 *
 * @param {string} spreadsheetId
 * @return {{
 *   entry:string,
 *   review:string,
 *   batches:string,
 *   canonicalHeader:string,
 *   canonicalLines:string,
 *   canonicalContractsValid:boolean
 * }}
 */
function setupManualFmrIntakeSheets(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Manual FMR intake setup is already running. ' +
      'Try again after the current operation completes.'
    );
  }

  try {
    return setupManualFmrIntakeSheetsUnlocked_(normalizedId);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Internal setup implementation for callers that already hold the script
 * lock. This prevents a service method from trying to acquire the same
 * non-reentrant lock twice.
 *
 * @param {string} spreadsheetId
 * @return {Object}
 */
function setupManualFmrIntakeSheetsUnlocked_(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  validateManualFmrCanonicalContracts_(spreadsheet);

  const entrySheet = ensureManualFmrManagedSheet_(
    spreadsheet,
    FMR_MANUAL_CONFIG.sheets.entry,
    FMR_MANUAL_CONFIG.entryHeaders
  );

  const reviewSheet = ensureManualFmrManagedSheet_(
    spreadsheet,
    FMR_MANUAL_CONFIG.sheets.review,
    FMR_MANUAL_CONFIG.reviewHeaders
  );

  const batchSheet = ensureManualFmrManagedSheet_(
    spreadsheet,
    FMR_MANUAL_CONFIG.sheets.batches,
    FMR_MANUAL_CONFIG.batchHeaders
  );

  formatManualFmrEntrySheet_(entrySheet);
  formatManualFmrReviewSheet_(reviewSheet);
  formatManualFmrBatchSheet_(batchSheet);

  SpreadsheetApp.flush();

  return {
    entry: entrySheet.getName(),
    review: reviewSheet.getName(),
    batches: batchSheet.getName(),
    canonicalHeader: FMR_MANUAL_CONFIG.sheets.canonicalHeader,
    canonicalLines: FMR_MANUAL_CONFIG.sheets.canonicalLines,
    canonicalContractsValid: true
  };
}

/**
 * Reapplies formatting and validation without changing sheet data.
 *
 * @param {string} spreadsheetId
 * @return {Object}
 */
function refreshManualFmrIntakeFormatting(spreadsheetId) {
  return setupManualFmrIntakeSheets(spreadsheetId);
}

/**
 * Validates the current manual-intake and canonical sheet contracts without
 * creating missing manual sheets.
 *
 * @param {string} spreadsheetId
 * @return {{
 *   valid:boolean,
 *   missingSheets:string[],
 *   headerMismatches:string[],
 *   canonicalContractsValid:boolean
 * }}
 */
function validateManualFmrIntakeFoundation(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  const missingSheets = [];
  const headerMismatches = [];

  const managedContracts = [
    {
      name: FMR_MANUAL_CONFIG.sheets.entry,
      headers: FMR_MANUAL_CONFIG.entryHeaders
    },
    {
      name: FMR_MANUAL_CONFIG.sheets.review,
      headers: FMR_MANUAL_CONFIG.reviewHeaders
    },
    {
      name: FMR_MANUAL_CONFIG.sheets.batches,
      headers: FMR_MANUAL_CONFIG.batchHeaders
    },
    {
      name: FMR_MANUAL_CONFIG.sheets.canonicalHeader,
      headers: FMR_MANUAL_CONFIG.canonicalHeaderFields
    },
    {
      name: FMR_MANUAL_CONFIG.sheets.canonicalLines,
      headers: FMR_MANUAL_CONFIG.canonicalLineFields
    }
  ];

  managedContracts.forEach(function (contract) {
    const sheet = spreadsheet.getSheetByName(contract.name);

    if (!sheet) {
      missingSheets.push(contract.name);
      return;
    }

    const mismatch = getManualFmrHeaderMismatch_(
      sheet,
      contract.headers
    );

    if (mismatch) {
      headerMismatches.push(
        `${contract.name}: ${mismatch}`
      );
    }
  });

  const canonicalContractsValid =
    missingSheets.indexOf(
      FMR_MANUAL_CONFIG.sheets.canonicalHeader
    ) === -1 &&
    missingSheets.indexOf(
      FMR_MANUAL_CONFIG.sheets.canonicalLines
    ) === -1 &&
    !headerMismatches.some(function (message) {
      return (
        message.indexOf(
          `${FMR_MANUAL_CONFIG.sheets.canonicalHeader}:`
        ) === 0 ||
        message.indexOf(
          `${FMR_MANUAL_CONFIG.sheets.canonicalLines}:`
        ) === 0
      );
    });

  return {
    valid:
      missingSheets.length === 0 &&
      headerMismatches.length === 0,
    missingSheets,
    headerMismatches,
    canonicalContractsValid
  };
}

/**
 * Returns current manual-intake row and status counts.
 *
 * @param {string} spreadsheetId
 * @return {{
 *   entryRows:number,
 *   draftRows:number,
 *   readyForReviewRows:number,
 *   needsClarificationRows:number,
 *   approvedRows:number,
 *   rejectedRows:number,
 *   rowsWithValidationErrors:number,
 *   reviewRows:number,
 *   pendingReviewRows:number,
 *   approvedReviewRows:number,
 *   batchRows:number,
 *   openBatches:number,
 *   completedBatches:number,
 *   canonicalFmrRows:number,
 *   canonicalLineRows:number
 * }}
 */
function getManualFmrIntakeSheetStatus(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  validateManualFmrCanonicalContracts_(spreadsheet);

  const entrySheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.entry
  );
  const reviewSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.review
  );
  const batchSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.batches
  );

  const entryRows = entrySheet
    ? readManualFmrSheetObjects_(
        entrySheet,
        FMR_MANUAL_CONFIG.entryHeaders
      )
    : [];

  const reviewRows = reviewSheet
    ? readManualFmrSheetObjects_(
        reviewSheet,
        FMR_MANUAL_CONFIG.reviewHeaders
      )
    : [];

  const batchRows = batchSheet
    ? readManualFmrSheetObjects_(
        batchSheet,
        FMR_MANUAL_CONFIG.batchHeaders
      )
    : [];

  const canonicalHeaderSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.canonicalHeader
  );
  const canonicalLineSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.canonicalLines
  );

  return {
    entryRows: entryRows.length,

    draftRows: countManualFmrObjectsByValue_(
      entryRows,
      'Entry_Status',
      FMR_MANUAL_CONFIG.entryStatuses.DRAFT
    ),

    readyForReviewRows: countManualFmrObjectsByValue_(
      entryRows,
      'Entry_Status',
      FMR_MANUAL_CONFIG.entryStatuses.READY_FOR_REVIEW
    ),

    needsClarificationRows: countManualFmrObjectsByValue_(
      entryRows,
      'Entry_Status',
      FMR_MANUAL_CONFIG.entryStatuses.NEEDS_CLARIFICATION
    ),

    approvedRows: countManualFmrObjectsByValue_(
      entryRows,
      'Entry_Status',
      FMR_MANUAL_CONFIG.entryStatuses.APPROVED
    ),

    rejectedRows: countManualFmrObjectsByValue_(
      entryRows,
      'Entry_Status',
      FMR_MANUAL_CONFIG.entryStatuses.REJECTED
    ),

    rowsWithValidationErrors: entryRows.filter(function (row) {
      return Boolean(
        normalizeManualFmrText_(row.Validation_Errors)
      );
    }).length,

    reviewRows: reviewRows.length,

    pendingReviewRows: reviewRows.filter(function (row) {
      return !normalizeManualFmrText_(
        row.Review_Decision
      );
    }).length,

    approvedReviewRows: countManualFmrObjectsByValue_(
      reviewRows,
      'Review_Decision',
      FMR_MANUAL_CONFIG.reviewDecisions.APPROVE
    ),

    batchRows: batchRows.length,

    openBatches: countManualFmrObjectsByValue_(
      batchRows,
      'Batch_Status',
      FMR_MANUAL_CONFIG.batchStatuses.OPEN
    ),

    completedBatches:
      countManualFmrObjectsByValue_(
        batchRows,
        'Batch_Status',
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED
      ) +
      countManualFmrObjectsByValue_(
        batchRows,
        'Batch_Status',
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED_WITH_ERRORS
      ),

    canonicalFmrRows: countManualFmrDataRows_(
      canonicalHeaderSheet
    ),

    canonicalLineRows: countManualFmrDataRows_(
      canonicalLineSheet
    )
  };
}

/* ========================================================================== */
/* CANONICAL CONTRACT SAFETY                                                  */
/* ========================================================================== */

function validateManualFmrCanonicalContracts_(spreadsheet) {
  const contracts = [
    {
      name: FMR_MANUAL_CONFIG.sheets.canonicalHeader,
      headers: FMR_MANUAL_CONFIG.canonicalHeaderFields
    },
    {
      name: FMR_MANUAL_CONFIG.sheets.canonicalLines,
      headers: FMR_MANUAL_CONFIG.canonicalLineFields
    }
  ];

  contracts.forEach(function (contract) {
    const sheet = spreadsheet.getSheetByName(contract.name);

    if (!sheet) {
      throw new Error(
        `Required canonical sheet "${contract.name}" is missing. ` +
        'Run the Phase 1 database foundation setup before manual intake.'
      );
    }

    const mismatch = getManualFmrHeaderMismatch_(
      sheet,
      contract.headers
    );

    if (mismatch) {
      throw new Error(
        `Canonical sheet "${contract.name}" does not match the ` +
        `expected Phase 1-3 contract: ${mismatch}. ` +
        'The manual intake service will not rewrite this sheet.'
      );
    }
  });

  return true;
}

/* ========================================================================== */
/* MANAGED SHEET CREATION                                                     */
/* ========================================================================== */

function ensureManualFmrManagedSheet_(
  spreadsheet,
  sheetName,
  headers
) {
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }

  const mismatch = getManualFmrHeaderMismatch_(
    sheet,
    headers
  );

  const hasHeaderContent = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0]
    .some(Boolean);

  const hasData = countManualFmrDataRows_(sheet) > 0;

  if (mismatch && hasHeaderContent && hasData) {
    throw new Error(
      `Sheet "${sheetName}" contains data but its headers do not ` +
      'match the current manual FMR contract. Back up or rename the ' +
      'sheet before running setup again.'
    );
  }

  if (mismatch) {
    sheet
      .getRange(1, 1, 1, headers.length)
      .setValues([Array.from(headers)]);
  }

  sheet.setFrozenRows(1);

  const headerRange = sheet.getRange(
    1,
    1,
    1,
    headers.length
  );

  headerRange
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setRowHeight(1, 42);

  ensureManualFmrFilter_(sheet, headers.length);

  return sheet;
}

function getManualFmrHeaderMismatch_(sheet, expectedHeaders) {
  if (!sheet) {
    return 'sheet missing';
  }

  if (sheet.getMaxColumns() < expectedHeaders.length) {
    return (
      `expected at least ${expectedHeaders.length} columns, ` +
      `found ${sheet.getMaxColumns()}`
    );
  }

  const actual = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });

  for (
    let index = 0;
    index < expectedHeaders.length;
    index++
  ) {
    if (actual[index] !== expectedHeaders[index]) {
      return (
        `column ${index + 1} expected ` +
        `"${expectedHeaders[index]}", found "${actual[index] || ''}"`
      );
    }
  }

  return '';
}

/* ========================================================================== */
/* ENTRY SHEET FORMATTING                                                     */
/* ========================================================================== */

function formatManualFmrEntrySheet_(sheet) {
  const headers = FMR_MANUAL_CONFIG.entryHeaders;

  applyManualFmrColumnWidths_(sheet, [
    230, 220, 150, 220, 280, 320, 210, 90, 210, 125,
    125, 190, 220, 100, 190, 120, 120, 105, 190, 90,
    240, 115, 190, 105, 420, 85, 110, 90, 115, 165,
    220, 155, 220, 155, 360, 420, 320
  ]);

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Source_Document_Type',
    Object.keys(FMR_MANUAL_CONFIG.sourceDocumentTypes).map(
      function (key) {
        return FMR_MANUAL_CONFIG.sourceDocumentTypes[key];
      }
    )
  );

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Priority',
    FMR_MANUAL_CONFIG.priorities
  );

  applyManualFmrValidationList_(
    sheet,
    headers,
    'UOM',
    FMR_MANUAL_CONFIG.uoms
  );

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Entry_Method',
    Object.keys(FMR_MANUAL_CONFIG.entryMethods).map(
      function (key) {
        return FMR_MANUAL_CONFIG.entryMethods[key];
      }
    )
  );

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Entry_Status',
    Object.keys(FMR_MANUAL_CONFIG.entryStatuses).map(
      function (key) {
        return FMR_MANUAL_CONFIG.entryStatuses[key];
      }
    )
  );

  applyManualFmrCheckbox_(
    sheet,
    headers,
    'Is_Pipe'
  );

  applyManualFmrDateFormat_(
    sheet,
    headers,
    [
      'Request_Date',
      'Date_Required'
    ],
    'yyyy-mm-dd'
  );

  applyManualFmrDateFormat_(
    sheet,
    headers,
    [
      'Entered_At',
      'Reviewed_At'
    ],
    'yyyy-mm-dd hh:mm:ss'
  );

  applyManualFmrNumberFormat_(
    sheet,
    headers,
    'Qty_Requested',
    '0.###'
  );

  applyManualFmrHeaderNotes_(
    sheet,
    headers,
    getManualFmrEntryHeaderNotes_()
  );

  setManualFmrEntryConditionalFormatting_(
    sheet,
    headers
  );

  setManualFmrTextWrapping_(
    sheet,
    headers,
    [
      'Source_File_Name',
      'Material_Description',
      'Review_Notes',
      'Validation_Errors'
    ]
  );

  setManualFmrTechnicalColumnsStyle_(
    sheet,
    headers,
    [
      'Entry_Row_ID',
      'Row_Content_Hash',
      'Validation_Errors'
    ]
  );
}

/* ========================================================================== */
/* REVIEW SHEET FORMATTING                                                    */
/* ========================================================================== */

function formatManualFmrReviewSheet_(sheet) {
  const headers = FMR_MANUAL_CONFIG.reviewHeaders;

  applyManualFmrColumnWidths_(sheet, [
    230, 230, 220, 220, 280, 320, 210, 90, 210, 115,
    190, 105, 420, 85, 110, 90, 220, 155, 420, 230,
    220, 155, 420, 230, 250, 320
  ]);

  const decisionColumn =
    headers.indexOf(
      'Review_Decision'
    ) + 1;

  if (decisionColumn > 0) {
    sheet
      .getRange(
        2,
        decisionColumn,
        Math.max(
          1,
          sheet.getMaxRows() - 1
        ),
        1
      )
      .clearDataValidations();
  }

  applyManualFmrCheckbox_(
    sheet,
    headers,
    'Is_Pipe'
  );

  applyManualFmrDateFormat_(
    sheet,
    headers,
    [
      'Submitted_At',
      'Reviewed_At'
    ],
    'yyyy-mm-dd hh:mm:ss'
  );

  applyManualFmrNumberFormat_(
    sheet,
    headers,
    'Qty_Requested',
    '0.###'
  );

  applyManualFmrHeaderNotes_(
    sheet,
    headers,
    getManualFmrReviewHeaderNotes_()
  );

  setManualFmrReviewConditionalFormatting_(
    sheet,
    headers
  );

  setManualFmrTextWrapping_(
    sheet,
    headers,
    [
      'Source_File_Name',
      'Material_Description',
      'Validation_Errors',
      'Reviewer_Notes'
    ]
  );

  setManualFmrTechnicalColumnsStyle_(
    sheet,
    headers,
    [
      'Review_ID',
      'Entry_Row_ID',
      'Review_Content_Hash'
    ]
  );
}

/* ========================================================================== */
/* BATCH SHEET FORMATTING                                                     */
/* ========================================================================== */

function formatManualFmrBatchSheet_(sheet) {
  const headers = FMR_MANUAL_CONFIG.batchHeaders;

  applyManualFmrColumnWidths_(sheet, [
    230, 260, 150, 220, 320, 220, 220, 220, 190, 120,
    120, 120, 120, 120, 120, 120, 220, 155, 155, 420
  ]);

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Source_Document_Type',
    Object.keys(FMR_MANUAL_CONFIG.sourceDocumentTypes).map(
      function (key) {
        return FMR_MANUAL_CONFIG.sourceDocumentTypes[key];
      }
    )
  );

  applyManualFmrValidationList_(
    sheet,
    headers,
    'Batch_Status',
    Object.keys(FMR_MANUAL_CONFIG.batchStatuses).map(
      function (key) {
        return FMR_MANUAL_CONFIG.batchStatuses[key];
      }
    )
  );

  applyManualFmrDateFormat_(
    sheet,
    headers,
    [
      'Created_At',
      'Updated_At'
    ],
    'yyyy-mm-dd hh:mm:ss'
  );

  [
    'Expected_FMR_Count',
    'Expected_Line_Count',
    'Entered_FMR_Count',
    'Entered_Line_Count',
    'Approved_FMR_Count',
    'Approved_Line_Count',
    'Rejected_Line_Count'
  ].forEach(function (header) {
    applyManualFmrNumberFormat_(
      sheet,
      headers,
      header,
      '0'
    );
  });

  applyManualFmrHeaderNotes_(
    sheet,
    headers,
    getManualFmrBatchHeaderNotes_()
  );

  setManualFmrBatchConditionalFormatting_(
    sheet,
    headers
  );

  setManualFmrTextWrapping_(
    sheet,
    headers,
    [
      'Batch_Name',
      'Source_Folder_URL',
      'Notes'
    ]
  );

  setManualFmrTechnicalColumnsStyle_(
    sheet,
    headers,
    ['Batch_ID']
  );
}

/* ========================================================================== */
/* DATA VALIDATION + FORMATTING HELPERS                                       */
/* ========================================================================== */

function applyManualFmrValidationList_(
  sheet,
  headers,
  targetHeader,
  allowedValues,
  allowBlank
) {
  const column = headers.indexOf(targetHeader) + 1;

  if (column <= 0 || !allowedValues || !allowedValues.length) {
    return;
  }

  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  const validation = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(
      Array.from(allowedValues),
      true
    )
    .setAllowInvalid(false)
    .setHelpText(
      `Select one of: ${allowedValues.join(', ')}`
    )
    .build();

  const range = sheet.getRange(
    2,
    column,
    rowCount,
    1
  );

  range.setDataValidation(validation);

  if (allowBlank) {
    /*
     * Google Sheets list validation already permits an empty cell until a
     * reviewer selects a decision.
     */
  }
}

function applyManualFmrCheckbox_(
  sheet,
  headers,
  targetHeader
) {
  const column = headers.indexOf(targetHeader) + 1;

  if (column <= 0) {
    return;
  }

  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  const validation = SpreadsheetApp
    .newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(2, column, rowCount, 1)
    .setDataValidation(validation)
    .setHorizontalAlignment('center');
}

function applyManualFmrDateFormat_(
  sheet,
  headers,
  targetHeaders,
  numberFormat
) {
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  targetHeaders.forEach(function (targetHeader) {
    const column = headers.indexOf(targetHeader) + 1;

    if (column <= 0) {
      return;
    }

    sheet
      .getRange(2, column, rowCount, 1)
      .setNumberFormat(numberFormat);
  });
}

function applyManualFmrNumberFormat_(
  sheet,
  headers,
  targetHeader,
  numberFormat
) {
  const column = headers.indexOf(targetHeader) + 1;

  if (column <= 0) {
    return;
  }

  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  sheet
    .getRange(2, column, rowCount, 1)
    .setNumberFormat(numberFormat);
}

function applyManualFmrColumnWidths_(
  sheet,
  widths
) {
  widths.forEach(function (width, index) {
    if (index + 1 <= sheet.getMaxColumns()) {
      sheet.setColumnWidth(index + 1, width);
    }
  });
}

function setManualFmrTextWrapping_(
  sheet,
  headers,
  targetHeaders
) {
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  targetHeaders.forEach(function (targetHeader) {
    const column = headers.indexOf(targetHeader) + 1;

    if (column <= 0) {
      return;
    }

    sheet
      .getRange(2, column, rowCount, 1)
      .setWrap(true)
      .setVerticalAlignment('top');
  });
}

function setManualFmrTechnicalColumnsStyle_(
  sheet,
  headers,
  targetHeaders
) {
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);

  targetHeaders.forEach(function (targetHeader) {
    const column = headers.indexOf(targetHeader) + 1;

    if (column <= 0) {
      return;
    }

    sheet
      .getRange(2, column, rowCount, 1)
      .setFontFamily('Roboto Mono')
      .setFontSize(9)
      .setFontColor('#5F6368');
  });
}

function ensureManualFmrFilter_(
  sheet,
  headerCount
) {
  const existingFilter = sheet.getFilter();

  if (existingFilter) {
    const range = existingFilter.getRange();

    const correct =
      range.getRow() === 1 &&
      range.getColumn() === 1 &&
      range.getNumColumns() === headerCount &&
      range.getNumRows() === sheet.getMaxRows();

    if (correct) {
      return;
    }

    existingFilter.remove();
  }

  sheet
    .getRange(
      1,
      1,
      sheet.getMaxRows(),
      headerCount
    )
    .createFilter();
}

/* ========================================================================== */
/* CONDITIONAL FORMATTING                                                     */
/* ========================================================================== */

function setManualFmrEntryConditionalFormatting_(
  sheet,
  headers
) {
  const statusColumn = headers.indexOf('Entry_Status') + 1;
  const errorsColumn = headers.indexOf('Validation_Errors') + 1;
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);
  const rules = [];

  if (statusColumn > 0) {
    const statusRange = sheet.getRange(
      2,
      statusColumn,
      rowCount,
      1
    );

    rules.push(
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.DRAFT,
        '#E8EAED',
        '#3C4043'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.READY_FOR_REVIEW,
        '#FFF2CC',
        '#7F6000'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.NEEDS_CLARIFICATION,
        '#FCE8B2',
        '#B06000'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.APPROVED,
        '#D9EAD3',
        '#274E13'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.REJECTED,
        '#F4CCCC',
        '#990000'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.SUPERSEDED,
        '#D9EAF7',
        '#134F5C'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.entryStatuses.VOIDED,
        '#D9D2E9',
        '#351C75'
      )
    );
  }

  if (errorsColumn > 0) {
    const errorsRange = sheet.getRange(
      2,
      errorsColumn,
      rowCount,
      1
    );

    rules.push(
      SpreadsheetApp
        .newConditionalFormatRule()
        .whenCellNotEmpty()
        .setBackground('#F4CCCC')
        .setFontColor('#990000')
        .setRanges([errorsRange])
        .build()
    );
  }

  sheet.setConditionalFormatRules(rules);
}

function setManualFmrReviewConditionalFormatting_(
  sheet,
  headers
) {
  const decisionColumn =
    headers.indexOf('Review_Decision') + 1;
  const errorsColumn =
    headers.indexOf('Validation_Errors') + 1;
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);
  const rules = [];

  if (decisionColumn > 0) {
    const decisionRange = sheet.getRange(
      2,
      decisionColumn,
      rowCount,
      1
    );

    rules.push(
      manualFmrTextRule_(
        decisionRange,
        FMR_MANUAL_CONFIG.reviewDecisions.APPROVE,
        '#D9EAD3',
        '#274E13'
      ),
      manualFmrTextRule_(
        decisionRange,
        FMR_MANUAL_CONFIG.reviewDecisions.RETURN_FOR_CLARIFICATION,
        '#FCE8B2',
        '#B06000'
      ),
      manualFmrTextRule_(
        decisionRange,
        FMR_MANUAL_CONFIG.reviewDecisions.REJECT,
        '#F4CCCC',
        '#990000'
      )
    );
  }

  if (errorsColumn > 0) {
    const errorsRange = sheet.getRange(
      2,
      errorsColumn,
      rowCount,
      1
    );

    rules.push(
      SpreadsheetApp
        .newConditionalFormatRule()
        .whenCellNotEmpty()
        .setBackground('#F4CCCC')
        .setFontColor('#990000')
        .setRanges([errorsRange])
        .build()
    );
  }

  sheet.setConditionalFormatRules(rules);
}

function setManualFmrBatchConditionalFormatting_(
  sheet,
  headers
) {
  const statusColumn = headers.indexOf('Batch_Status') + 1;
  const rowCount = Math.max(1, sheet.getMaxRows() - 1);
  const rules = [];

  if (statusColumn > 0) {
    const statusRange = sheet.getRange(
      2,
      statusColumn,
      rowCount,
      1
    );

    rules.push(
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.OPEN,
        '#E8EAED',
        '#3C4043'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.READY_FOR_REVIEW,
        '#FFF2CC',
        '#7F6000'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.IN_REVIEW,
        '#D9EAF7',
        '#134F5C'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED,
        '#D9EAD3',
        '#274E13'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED_WITH_ERRORS,
        '#FCE8B2',
        '#B06000'
      ),
      manualFmrTextRule_(
        statusRange,
        FMR_MANUAL_CONFIG.batchStatuses.CANCELLED,
        '#F4CCCC',
        '#990000'
      )
    );
  }

  sheet.setConditionalFormatRules(rules);
}

function manualFmrTextRule_(
  range,
  text,
  background,
  fontColor
) {
  return SpreadsheetApp
    .newConditionalFormatRule()
    .whenTextEqualTo(text)
    .setBackground(background)
    .setFontColor(fontColor)
    .setRanges([range])
    .build();
}

/* ========================================================================== */
/* HEADER NOTES                                                               */
/* ========================================================================== */

function applyManualFmrHeaderNotes_(
  sheet,
  headers,
  notesByHeader
) {
  headers.forEach(function (header, index) {
    const note = notesByHeader[header] || '';

    sheet
      .getRange(1, index + 1)
      .setNote(note);
  });
}

function getManualFmrEntryHeaderNotes_() {
  return {
    Entry_Row_ID:
      'System-generated immutable identifier for this staging row.',
    Batch_ID:
      'Required batch assignment from FMR_Manual_Batches.',
    Source_Document_Type:
      'Use FMR for planner-created Field Material Request documents.',
    Source_File_ID:
      'Google Drive file ID for the source FMR. A source ID or URL is required.',
    Source_File_URL:
      'Link to the source FMR document used for entry and review.',
    FMR_Number:
      'FMR number exactly as shown on the source document.',
    Revision:
      'Source FMR revision. Do not overwrite earlier revisions.',
    IWP_Number:
      'Installation Work Package number associated with the request.',
    FMR_Line_Number:
      'Material line number within the FMR. Use positive integers.',
    Commodity_Code:
      'Commodity or catalog code exactly as shown on the FMR.',
    Size:
      'Nominal material size exactly as shown on the FMR.',
    Material_Description:
      'Preserve the source description. Do not silently rewrite material data.',
    Qty_Requested:
      'Planner-requested quantity. This does not mean received or available.',
    Is_Pipe:
      'True only when the description begins with PIPE. The service validates this flag.',
    Entry_Status:
      'DRAFT rows may be incomplete. READY_FOR_REVIEW rows must pass validation.',
    Entered_By:
      'Authenticated email of the person who entered the row.',
    Reviewer_Email:
      'Assigned reviewer. The reviewer should not be the person who entered the row.',
    Validation_Errors:
      'System-generated reason codes. Rows with errors cannot be approved.',
    Row_Content_Hash:
      'System-generated SHA-256 hash used for duplicate and conflict detection.'
  };
}

function getManualFmrReviewHeaderNotes_() {
  return {
    Review_ID:
      'System-generated immutable review identifier.',
    Entry_Row_ID:
      'Staging-row identifier copied from FMR_Manual_Entry.',
    Review_Decision:
      'System-controlled final result. Do not type in this column. Select review rows and use menu options 13, 14, or 15.',
    Reviewer_Email:
      'Authenticated reviewer who made the decision.',
    Reviewer_Notes:
      'Required explanation when returning or rejecting a row.',
    Canonical_FMR_ID:
      'Assigned after approved rows are committed to FMR_Header.',
    Canonical_FMR_Line_ID:
      'Assigned after the material row is committed to FMR_Line_Items.',
    Review_Content_Hash:
      'Hash of the submitted review snapshot for audit traceability.'
  };
}

function getManualFmrBatchHeaderNotes_() {
  return {
    Batch_ID:
      'System-generated identifier shared by all staging rows in this work batch.',
    Batch_Name:
      'Human-readable name such as Week 1 Backlog or Area 100 FMR Entry.',
    Source_Folder_ID:
      'Optional Drive folder containing the source FMR documents.',
    Assigned_Entry_User_1:
      'Primary data-entry user email.',
    Assigned_Entry_User_2:
      'Second data-entry user email.',
    Assigned_Reviewer:
      'Reviewer email responsible for quality control.',
    Batch_Status:
      'Tracks the batch from OPEN through completion.',
    Expected_FMR_Count:
      'Estimated number of distinct FMR documents in the batch.',
    Expected_Line_Count:
      'Estimated number of material lines in the batch.',
    Entered_FMR_Count:
      'System-calculated distinct FMRs entered.',
    Entered_Line_Count:
      'System-calculated staging rows entered.',
    Approved_FMR_Count:
      'System-calculated distinct FMRs approved.',
    Approved_Line_Count:
      'System-calculated lines approved into canonical tables.',
    Rejected_Line_Count:
      'System-calculated review rejections.',
    Notes:
      'Batch instructions, exceptions, or source-scope notes.'
  };
}

/* ========================================================================== */
/* GENERIC READ + COUNT HELPERS                                               */
/* ========================================================================== */

function readManualFmrSheetObjects_(
  sheet,
  headers
) {
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  const values = sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      headers.length
    )
    .getValues();

  return values
    .filter(function (row) {
      return row.some(function (value) {
        return value !== '' && value !== null;
      });
    })
    .map(function (row) {
      const record = {};

      headers.forEach(function (header, index) {
        record[header] = row[index];
      });

      return record;
    });
}

function countManualFmrObjectsByValue_(
  objects,
  field,
  expectedValue
) {
  const expected = normalizeManualFmrUpper_(
    expectedValue
  );

  return (objects || []).filter(function (object) {
    return (
      normalizeManualFmrUpper_(object[field]) ===
      expected
    );
  }).length;
}

function countManualFmrDataRows_(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) {
    return 0;
  }

  return sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      sheet.getLastColumn()
    )
    .getValues()
    .filter(function (row) {
      return row.some(function (value) {
        return value !== '' && value !== null;
      });
    })
    .length;
}

/* ========================================================================== */
/* SMALL HELPERS                                                              */
/* ========================================================================== */

function normalizeManualFmrSpreadsheetId_(spreadsheetId) {
  const value = String(spreadsheetId || '').trim();

  if (!value) {
    throw new Error('A spreadsheet ID or URL is required.');
  }

  const urlMatch = value.match(
    /\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/
  );

  const normalized = urlMatch ? urlMatch[1] : value;

  if (!/^[A-Za-z0-9_-]{15,}$/.test(normalized)) {
    throw new Error(
      'The supplied spreadsheet ID or URL is invalid.'
    );
  }

  return normalized;
}
