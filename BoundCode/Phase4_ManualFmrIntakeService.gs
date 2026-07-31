/**
 * Phase4_ManualFmrIntakeService.gs
 *
 * Reusable batch, draft-entry, validation, duplicate-detection, and
 * review-submission service for manual FMR intake.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * DATA FLOW
 * ---------
 * 1. createManualFmrBatch()
 * 2. createManualFmrDraft()
 * 3. Data-entry users complete FMR_Manual_Entry
 * 4. validateManualFmrBatch()
 * 5. submitManualFmrBatchForReview()
 * 6. A later review/approval service commits approved records to:
 *      FMR_Header
 *      FMR_Line_Items
 *
 * RESPONSIBILITIES
 * ----------------
 * - Create controlled data-entry batches.
 * - Pre-create one staging row per FMR material line.
 * - Generate immutable batch, entry-row, and review identifiers.
 * - Apply defaults and authenticated user metadata.
 * - Validate rows deterministically.
 * - Detect duplicate staging rows.
 * - Detect duplicate/conflicting canonical records.
 * - Detect inconsistent repeated FMR header data.
 * - Create idempotent snapshots in FMR_Manual_Review.
 * - Update batch counters and workflow status.
 *
 * NON-RESPONSIBILITIES
 * --------------------
 * - No menus, prompts, alerts, or onOpen().
 * - No PropertiesService.
 * - No Cloud Vision, Cloud Storage, or paid services.
 * - No automatic approval into canonical FMR records.
 * - No silent correction of commodity codes, quantities, or descriptions.
 *
 * DEPENDS ON
 * ----------
 * - Phase4_ManualFmrConfig.gs
 * - Phase4_ManualFmrSheetService.gs
 */

/* ========================================================================== */
/* PUBLIC SERVICE INFORMATION                                                 */
/* ========================================================================== */

function getManualFmrIntakeServiceVersion() {
  return {
    schemaVersion: FMR_MANUAL_CONFIG.schemaVersion,
    serviceVersion: FMR_MANUAL_CONFIG.serviceVersion,
    component: 'manual-fmr-intake-service-v1'
  };
}

/* ========================================================================== */
/* BATCH CREATION                                                             */
/* ========================================================================== */

/**
 * Creates one controlled manual-entry batch.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {Object=} request
 * Supported request fields:
 * - batchName
 * - sourceFolderId
 * - sourceFolderUrl
 * - assignedEntryUser1
 * - assignedEntryUser2
 * - assignedReviewer
 * - expectedFmrCount
 * - expectedLineCount
 * - notes
 *
 * @return {Object}
 */
function createManualFmrBatch(
  spreadsheetId,
  callerEmail,
  request
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const payload = request || {};
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR intake operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheets(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(normalizedId);
    const batchSheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );

    const now = new Date();
    const batchId = createManualFmrBatchId_();

    const batch = normalizeManualFmrBatchRecord_({
      Batch_ID: batchId,
      Batch_Name:
        payload.batchName ||
        `Manual FMR Batch ${Utilities.formatDate(
          now,
          Session.getScriptTimeZone(),
          'yyyy-MM-dd HH:mm'
        )}`,
      Source_Document_Type:
        FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR,
      Source_Folder_ID:
        extractManualFmrDriveId_(
          payload.sourceFolderId ||
          payload.sourceFolderUrl
        ),
      Source_Folder_URL:
        normalizeManualFmrText_(payload.sourceFolderUrl),
      Assigned_Entry_User_1:
        payload.assignedEntryUser1 || actor,
      Assigned_Entry_User_2:
        payload.assignedEntryUser2 || '',
      Assigned_Reviewer:
        payload.assignedReviewer || '',
      Batch_Status:
        FMR_MANUAL_CONFIG.batchStatuses.OPEN,
      Expected_FMR_Count:
        normalizeManualFmrWholeNumber_(
          payload.expectedFmrCount,
          0
        ),
      Expected_Line_Count:
        normalizeManualFmrWholeNumber_(
          payload.expectedLineCount,
          0
        ),
      Entered_FMR_Count: 0,
      Entered_Line_Count: 0,
      Approved_FMR_Count: 0,
      Approved_Line_Count: 0,
      Rejected_Line_Count: 0,
      Created_By: actor,
      Created_At: now,
      Updated_At: now,
      Notes: payload.notes || ''
    });

    appendManualFmrObjects_(
      batchSheet,
      FMR_MANUAL_CONFIG.batchHeaders,
      [batch]
    );

    SpreadsheetApp.flush();

    return Object.assign({}, batch, {
      spreadsheetId: normalizedId
    });
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* FMR DRAFT CREATION                                                         */
/* ========================================================================== */

/**
 * Pre-creates one staging row per requested material line for a single FMR.
 *
 * Data-entry users then fill the line-specific material fields directly in
 * FMR_Manual_Entry.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {Object} request
 * Required:
 * - batchId
 * - fmrNumber
 * - iwpNumber
 * - requestedBy
 * - lineCount
 *
 * Strongly recommended:
 * - sourceFileId or sourceFileUrl
 * - sourceFileName
 * - assigned reviewer already present on the batch
 *
 * Optional:
 * - revision
 * - requestDate
 * - dateRequired
 * - requestedByEmail
 * - craft
 * - deliverTo
 * - destination
 * - warehouse
 * - priority
 * - isoLineNumber
 * - isoSheet
 * - isoDrawingNumber
 * - defaultUom
 *
 * @return {{
 *   batchId:string,
 *   fmrNumber:string,
 *   revision:string,
 *   rowsCreated:number,
 *   entryRowIds:string[]
 * }}
 */
function createManualFmrDraft(
  spreadsheetId,
  callerEmail,
  request
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const payload = request || {};
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR intake operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheets(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(normalizedId);
    const entrySheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.entry
    );
    const batchSheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );

    const batchId = normalizeManualFmrText_(
      payload.batchId
    );

    if (!batchId) {
      throw new Error('A Batch_ID is required.');
    }

    const batchRecord = findManualFmrBatchRecord_(
      batchSheet,
      batchId
    );

    if (!batchRecord) {
      throw new Error(
        `Manual FMR batch "${batchId}" was not found.`
      );
    }

    if (
      normalizeManualFmrUpper_(batchRecord.Batch_Status) ===
        FMR_MANUAL_CONFIG.batchStatuses.CANCELLED ||
      normalizeManualFmrUpper_(batchRecord.Batch_Status) ===
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED
    ) {
      throw new Error(
        `Batch "${batchId}" is ${batchRecord.Batch_Status} and ` +
        'cannot accept additional draft rows.'
      );
    }

    const lineCount = normalizeManualFmrWholeNumber_(
      payload.lineCount,
      0
    );

    if (lineCount < 1 || lineCount > 1000) {
      throw new Error(
        'lineCount must be a whole number from 1 through 1000.'
      );
    }

    const fmrNumber = normalizeManualFmrText_(
      payload.fmrNumber
    );
    const revision = normalizeManualFmrText_(
      payload.revision ||
      FMR_MANUAL_CONFIG.defaults.revision
    );
    const iwpNumber = normalizeManualFmrText_(
      payload.iwpNumber
    );
    const requestedBy = normalizeManualFmrText_(
      payload.requestedBy
    );

    if (!fmrNumber) {
      throw new Error('An FMR number is required.');
    }

    if (!iwpNumber) {
      throw new Error('An IWP number is required.');
    }

    if (!requestedBy) {
      throw new Error('Requested By is required.');
    }

    const existingEntryRows = readManualFmrSheetObjectsWithRows_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders
    );

    const sameFmrRevision = existingEntryRows.filter(
      function (item) {
        return (
          normalizeManualFmrUpper_(item.record.FMR_Number) ===
            normalizeManualFmrUpper_(fmrNumber) &&
          normalizeManualFmrUpper_(item.record.Revision) ===
            normalizeManualFmrUpper_(revision) &&
          !isManualFmrInactiveEntryStatus_(
            item.record.Entry_Status
          )
        );
      }
    );

    if (sameFmrRevision.length > 0) {
      throw new Error(
        `FMR "${fmrNumber}" revision "${revision}" already has ` +
        `${sameFmrRevision.length} active staging row(s). ` +
        'Use those rows or void them before creating another draft.'
      );
    }

    const now = new Date();
    const reviewer = normalizeManualFmrEmail_(
      payload.reviewerEmail ||
      batchRecord.Assigned_Reviewer
    );
    const sourceFileId = extractManualFmrDriveId_(
      payload.sourceFileId ||
      payload.sourceFileUrl
    );
    const sourceFileUrl = normalizeManualFmrText_(
      payload.sourceFileUrl
    );

    const rows = [];
    const entryRowIds = [];

    for (
      let lineNumber = 1;
      lineNumber <= lineCount;
      lineNumber++
    ) {
      const entryRowId = createManualFmrEntryRowId_();
      entryRowIds.push(entryRowId);

      const row = normalizeManualFmrEntryRow({
        Entry_Row_ID: entryRowId,
        Batch_ID: batchId,
        Source_Document_Type:
          FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR,
        Source_File_ID: sourceFileId,
        Source_File_Name:
          payload.sourceFileName || '',
        Source_File_URL: sourceFileUrl,
        FMR_Number: fmrNumber,
        Revision: revision,
        IWP_Number: iwpNumber,
        Request_Date:
          payload.requestDate || now,
        Date_Required:
          payload.dateRequired || '',
        Requested_By: requestedBy,
        Requested_By_Email:
          payload.requestedByEmail || '',
        Craft:
          payload.craft ||
          FMR_MANUAL_CONFIG.defaults.craft,
        Deliver_To:
          payload.deliverTo ||
          FMR_MANUAL_CONFIG.defaults.deliverTo,
        Destination:
          payload.destination ||
          FMR_MANUAL_CONFIG.defaults.destination,
        Warehouse:
          payload.warehouse ||
          FMR_MANUAL_CONFIG.defaults.warehouse,
        Priority:
          payload.priority ||
          FMR_MANUAL_CONFIG.defaults.priority,
        ISO_Line_Number:
          payload.isoLineNumber || '',
        ISO_Sheet:
          payload.isoSheet || '',
        ISO_Drawing_Number:
          payload.isoDrawingNumber || '',
        FMR_Line_Number: String(lineNumber),
        Commodity_Code: '',
        Size: '',
        Material_Description: '',
        UOM:
          payload.defaultUom ||
          FMR_MANUAL_CONFIG.defaults.uom,
        Qty_Requested: '',
        Is_Pipe: false,
        Entry_Method:
          FMR_MANUAL_CONFIG.entryMethods.MANUAL,
        Entry_Status:
          FMR_MANUAL_CONFIG.entryStatuses.DRAFT,
        Entered_By: actor,
        Entered_At: now,
        Reviewer_Email: reviewer,
        Reviewed_At: '',
        Review_Notes: '',
        Validation_Errors: '',
        Row_Content_Hash: ''
      });

      rows.push(row);
    }

    appendManualFmrObjects_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders,
      rows
    );

    recalculateManualFmrBatchMetrics_(
      spreadsheet,
      batchId,
      actor
    );

    SpreadsheetApp.flush();

    return {
      batchId,
      fmrNumber,
      revision,
      rowsCreated: rows.length,
      entryRowIds
    };
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* BATCH VALIDATION                                                           */
/* ========================================================================== */

/**
 * Validates all active staging rows in one batch.
 *
 * This function fills missing system-owned metadata, recalculates Is_Pipe,
 * writes Validation_Errors, and detects staging/canonical conflicts.
 *
 * It does not submit rows to the review queue.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @return {Object}
 */
function validateManualFmrBatch(
  spreadsheetId,
  callerEmail,
  batchId
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(
    batchId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR intake operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheets(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(normalizedId);

    const result = validateManualFmrBatchInternal_(
      spreadsheet,
      actor,
      normalizedBatchId,
      {
        setInvalidRowsToClarification: false
      }
    );

    recalculateManualFmrBatchMetrics_(
      spreadsheet,
      normalizedBatchId,
      actor
    );

    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* REVIEW SUBMISSION                                                          */
/* ========================================================================== */

/**
 * Validates a batch and submits every valid active staging row to the review
 * queue as an immutable snapshot.
 *
 * Idempotency:
 * - The same Entry_Row_ID + Row_Content_Hash is never submitted twice.
 * - A changed row receives a new review snapshot with a new hash.
 *
 * Invalid rows are set to NEEDS_CLARIFICATION and are not submitted.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @return {{
 *   batchId:string,
 *   rowsConsidered:number,
 *   submittedRows:number,
 *   alreadySubmittedRows:number,
 *   clarificationRows:number,
 *   skippedInactiveRows:number,
 *   reviewIds:string[],
 *   errorsByEntryRow:Object
 * }}
 */
function submitManualFmrBatchForReview(
  spreadsheetId,
  callerEmail,
  batchId
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(
    batchId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR intake operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheets(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(normalizedId);
    const entrySheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.entry
    );
    const reviewSheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.review
    );
    const batchSheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );

    const batchRecord = findManualFmrBatchRecord_(
      batchSheet,
      normalizedBatchId
    );

    if (!batchRecord) {
      throw new Error(
        `Manual FMR batch "${normalizedBatchId}" was not found.`
      );
    }

    const validation = validateManualFmrBatchInternal_(
      spreadsheet,
      actor,
      normalizedBatchId,
      {
        setInvalidRowsToClarification: true
      }
    );

    const entryRows = readManualFmrSheetObjectsWithRows_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders
    ).filter(function (item) {
      return (
        normalizeManualFmrText_(item.record.Batch_ID) ===
        normalizedBatchId
      );
    });

    const existingReviews = readManualFmrSheetObjects_(
      reviewSheet,
      FMR_MANUAL_CONFIG.reviewHeaders
    );

    const existingSnapshotKeys = {};

    existingReviews.forEach(function (review) {
      existingSnapshotKeys[
        buildManualFmrReviewSnapshotKey_(
          review.Entry_Row_ID,
          review.Review_Content_Hash
        )
      ] = true;
    });

    const reviewObjects = [];
    const reviewIds = [];
    const entryUpdates = [];
    let alreadySubmittedRows = 0;
    let clarificationRows = 0;
    let skippedInactiveRows = 0;

    entryRows.forEach(function (item) {
      const record = normalizeManualFmrEntryRow(
        item.record
      );
      const status = normalizeManualFmrUpper_(
        record.Entry_Status
      );

      if (
        status ===
          FMR_MANUAL_CONFIG.entryStatuses.APPROVED ||
        status ===
          FMR_MANUAL_CONFIG.entryStatuses.SUPERSEDED ||
        status ===
          FMR_MANUAL_CONFIG.entryStatuses.VOIDED ||
        status ===
          FMR_MANUAL_CONFIG.entryStatuses.REJECTED
      ) {
        skippedInactiveRows++;
        return;
      }

      const rowErrors = normalizeManualFmrReasonList_(
        record.Validation_Errors
      );

      if (rowErrors.length > 0) {
        record.Entry_Status =
          FMR_MANUAL_CONFIG.entryStatuses.NEEDS_CLARIFICATION;
        record.Review_Notes =
          appendManualFmrNote_(
            record.Review_Notes,
            'Validation failed before review submission.'
          );

        clarificationRows++;
        entryUpdates.push({
          rowNumber: item.rowNumber,
          record
        });
        return;
      }

      record.Entry_Status =
        FMR_MANUAL_CONFIG.entryStatuses.READY_FOR_REVIEW;
      record.Row_Content_Hash =
        hashManualFmrEntryRow_(record);

      const review = buildManualFmrReviewSnapshot_(
        record,
        actor,
        new Date()
      );

      const snapshotKey =
        buildManualFmrReviewSnapshotKey_(
          review.Entry_Row_ID,
          review.Review_Content_Hash
        );

      if (existingSnapshotKeys[snapshotKey]) {
        alreadySubmittedRows++;
      } else {
        existingSnapshotKeys[snapshotKey] = true;
        reviewObjects.push(review);
        reviewIds.push(review.Review_ID);
      }

      entryUpdates.push({
        rowNumber: item.rowNumber,
        record
      });
    });

    updateManualFmrEntryRows_(
      entrySheet,
      entryUpdates
    );

    appendManualFmrObjects_(
      reviewSheet,
      FMR_MANUAL_CONFIG.reviewHeaders,
      reviewObjects
    );

    const submittedRows = reviewObjects.length;

    if (submittedRows > 0) {
      updateManualFmrBatchStatus_(
        batchSheet,
        normalizedBatchId,
        FMR_MANUAL_CONFIG.batchStatuses.READY_FOR_REVIEW,
        actor
      );
    } else if (clarificationRows > 0) {
      updateManualFmrBatchStatus_(
        batchSheet,
        normalizedBatchId,
        FMR_MANUAL_CONFIG.batchStatuses.COMPLETED_WITH_ERRORS,
        actor
      );
    }

    recalculateManualFmrBatchMetrics_(
      spreadsheet,
      normalizedBatchId,
      actor
    );

    SpreadsheetApp.flush();

    return {
      batchId: normalizedBatchId,
      rowsConsidered: entryRows.length,
      submittedRows,
      alreadySubmittedRows,
      clarificationRows,
      skippedInactiveRows,
      reviewIds,
      errorsByEntryRow: validation.errorsByEntryRow
    };
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* BATCH SUMMARY                                                              */
/* ========================================================================== */

/**
 * Returns a read-only summary for one batch.
 *
 * @param {string} spreadsheetId
 * @param {string} batchId
 * @return {Object}
 */
function getManualFmrBatchSummary(
  spreadsheetId,
  batchId
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const normalizedBatchId = normalizeManualFmrText_(
    batchId
  );
  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  setupManualFmrIntakeSheets(normalizedId);

  const batchSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.batches
  );
  const entrySheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.entry
  );
  const reviewSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.review
  );

  const batch = findManualFmrBatchRecord_(
    batchSheet,
    normalizedBatchId
  );

  if (!batch) {
    throw new Error(
      `Manual FMR batch "${normalizedBatchId}" was not found.`
    );
  }

  const entries = readManualFmrSheetObjects_(
    entrySheet,
    FMR_MANUAL_CONFIG.entryHeaders
  ).filter(function (record) {
    return (
      normalizeManualFmrText_(record.Batch_ID) ===
      normalizedBatchId
    );
  });

  const reviews = readManualFmrSheetObjects_(
    reviewSheet,
    FMR_MANUAL_CONFIG.reviewHeaders
  ).filter(function (record) {
    return (
      normalizeManualFmrText_(record.Batch_ID) ===
      normalizedBatchId
    );
  });

  const distinctFmrs = getDistinctManualFmrCount_(
    entries
  );

  return {
    batch: normalizeManualFmrBatchRecord_(batch),
    distinctFmrCount: distinctFmrs,
    entryLineCount: entries.length,
    statusCounts: countManualFmrValues_(
      entries,
      'Entry_Status'
    ),
    validationErrorRows: entries.filter(function (record) {
      return Boolean(
        normalizeManualFmrText_(record.Validation_Errors)
      );
    }).length,
    reviewRows: reviews.length,
    pendingReviewRows: reviews.filter(function (record) {
      return !normalizeManualFmrText_(
        record.Review_Decision
      );
    }).length,
    reviewDecisionCounts: countManualFmrValues_(
      reviews,
      'Review_Decision'
    )
  };
}

/**
 * Recalculates one batch's counters.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @return {Object}
 */
function refreshManualFmrBatchMetrics(
  spreadsheetId,
  callerEmail,
  batchId
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(
    batchId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR intake operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheets(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(normalizedId);
    const result = recalculateManualFmrBatchMetrics_(
      spreadsheet,
      normalizedBatchId,
      actor
    );

    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* INTERNAL VALIDATION                                                        */
/* ========================================================================== */

function validateManualFmrBatchInternal_(
  spreadsheet,
  actor,
  batchId,
  options
) {
  const settings = options || {};

  if (!batchId) {
    throw new Error('A Batch_ID is required.');
  }

  const entrySheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.entry
  );
  const batchSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.batches
  );

  const batchRecord = findManualFmrBatchRecord_(
    batchSheet,
    batchId
  );

  if (!batchRecord) {
    throw new Error(
      `Manual FMR batch "${batchId}" was not found.`
    );
  }

  const allEntryRows = readManualFmrSheetObjectsWithRows_(
    entrySheet,
    FMR_MANUAL_CONFIG.entryHeaders
  );

  const batchRows = allEntryRows.filter(function (item) {
    return (
      normalizeManualFmrText_(item.record.Batch_ID) ===
      batchId
    );
  });

  if (batchRows.length === 0) {
    throw new Error(
      `Batch "${batchId}" contains no staging rows.`
    );
  }

  const canonicalContext =
    buildManualFmrCanonicalContext_(spreadsheet);

  const prepared = batchRows.map(function (item) {
    const record = applyManualFmrSystemDefaults_(
      item.record,
      actor,
      batchRecord
    );

    const validation = validateManualFmrEntryRow(record);

    return {
      rowNumber: item.rowNumber,
      record: validation.normalized,
      errors: validation.errors.slice(),
      warnings: validation.warnings.slice()
    };
  });

  applyManualFmrBatchConflictRules_(
    prepared,
    canonicalContext
  );

  const updates = [];
  const errorsByEntryRow = {};
  let validRows = 0;
  let invalidRows = 0;
  let inactiveRows = 0;

  prepared.forEach(function (item) {
    const status = normalizeManualFmrUpper_(
      item.record.Entry_Status
    );

    if (isManualFmrInactiveEntryStatus_(status)) {
      inactiveRows++;
      updates.push({
        rowNumber: item.rowNumber,
        record: item.record
      });
      return;
    }

    item.errors = Array.from(
      new Set(item.errors.filter(Boolean))
    );

    item.record.Validation_Errors =
      item.errors.join(';');

    item.record.Row_Content_Hash =
      hashManualFmrEntryRow_(item.record);

    if (item.errors.length > 0) {
      invalidRows++;

      if (settings.setInvalidRowsToClarification) {
        item.record.Entry_Status =
          FMR_MANUAL_CONFIG
            .entryStatuses
            .NEEDS_CLARIFICATION;
      }

      errorsByEntryRow[
        item.record.Entry_Row_ID
      ] = item.errors.slice();
    } else {
      validRows++;
    }

    updates.push({
      rowNumber: item.rowNumber,
      record: item.record
    });
  });

  updateManualFmrEntryRows_(
    entrySheet,
    updates
  );

  return {
    batchId,
    totalRows: prepared.length,
    activeRows: prepared.length - inactiveRows,
    validRows,
    invalidRows,
    inactiveRows,
    errorsByEntryRow
  };
}

function applyManualFmrSystemDefaults_(
  sourceRecord,
  actor,
  batchRecord
) {
  const source = Object.assign({}, sourceRecord || {});
  const now = new Date();

  if (!normalizeManualFmrText_(source.Entry_Row_ID)) {
    source.Entry_Row_ID = createManualFmrEntryRowId_();
  }

  source.Source_Document_Type =
    source.Source_Document_Type ||
    FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR;

  source.Revision =
    source.Revision ||
    FMR_MANUAL_CONFIG.defaults.revision;

  source.Craft =
    source.Craft ||
    FMR_MANUAL_CONFIG.defaults.craft;

  source.Deliver_To =
    source.Deliver_To ||
    FMR_MANUAL_CONFIG.defaults.deliverTo;

  source.Destination =
    source.Destination ||
    FMR_MANUAL_CONFIG.defaults.destination;

  source.Warehouse =
    source.Warehouse ||
    FMR_MANUAL_CONFIG.defaults.warehouse;

  source.Priority =
    source.Priority ||
    FMR_MANUAL_CONFIG.defaults.priority;

  source.UOM =
    source.UOM ||
    FMR_MANUAL_CONFIG.defaults.uom;

  source.Entry_Method =
    source.Entry_Method ||
    FMR_MANUAL_CONFIG.entryMethods.MANUAL;

  source.Entry_Status =
    source.Entry_Status ||
    FMR_MANUAL_CONFIG.entryStatuses.DRAFT;

  source.Entered_By =
    source.Entered_By ||
    actor;

  source.Entered_At =
    source.Entered_At ||
    now;

  source.Reviewer_Email =
    source.Reviewer_Email ||
    batchRecord.Assigned_Reviewer ||
    '';

  source.Source_File_ID =
    extractManualFmrDriveId_(
      source.Source_File_ID ||
      source.Source_File_URL
    );

  source.Is_Pipe = isManualFmrPipeStock_(
    source.Material_Description
  );

  return normalizeManualFmrEntryRow(source);
}

/* ========================================================================== */
/* DUPLICATE + CONFLICT RULES                                                 */
/* ========================================================================== */

function applyManualFmrBatchConflictRules_(
  preparedRows,
  canonicalContext
) {
  const reasons =
    FMR_MANUAL_CONFIG.validationReasons;

  const activeRows = preparedRows.filter(function (item) {
    return !isManualFmrInactiveEntryStatus_(
      item.record.Entry_Status
    );
  });

  const byDuplicateKey = {};
  const byFmrRevision = {};

  activeRows.forEach(function (item) {
    const duplicateKey =
      buildManualFmrDuplicateKey_(
        item.record
      );

    if (!byDuplicateKey[duplicateKey]) {
      byDuplicateKey[duplicateKey] = [];
    }

    byDuplicateKey[duplicateKey].push(item);

    const fmrRevisionKey =
      buildManualFmrRevisionKey_(
        item.record.FMR_Number,
        item.record.Revision
      );

    if (!byFmrRevision[fmrRevisionKey]) {
      byFmrRevision[fmrRevisionKey] = [];
    }

    byFmrRevision[fmrRevisionKey].push(item);
  });

  Object.keys(byDuplicateKey).forEach(function (key) {
    const duplicates = byDuplicateKey[key];

    if (duplicates.length > 1) {
      duplicates.forEach(function (item) {
        item.errors.push(
          reasons.DUPLICATE_STAGING_LINE
        );
      });
    }
  });

  Object.keys(byFmrRevision).forEach(function (key) {
    const rows = byFmrRevision[key];
    const headerKeys = Array.from(
      new Set(
        rows.map(function (item) {
          return buildManualFmrHeaderConsistencyKey_(
            item.record
          );
        })
      )
    );

    if (headerKeys.length > 1) {
      rows.forEach(function (item) {
        item.errors.push(
          reasons.CONFLICTING_FMR_HEADER
        );
      });
    }

    const canonicalHeader =
      canonicalContext.headersByFmrRevision[key];

    if (canonicalHeader) {
      rows.forEach(function (item) {
        if (
          !manualFmrHeaderMatchesCanonical_(
            item.record,
            canonicalHeader
          )
        ) {
          item.errors.push(
            reasons.CONFLICTING_FMR_HEADER
          );
        }
      });
    }
  });

  activeRows.forEach(function (item) {
    const record = item.record;
    const duplicateKey =
      buildManualFmrDuplicateKey_(record);

    if (canonicalContext.lineKeys[duplicateKey]) {
      item.errors.push(
        reasons.DUPLICATE_CANONICAL_LINE
      );
    }

    const lineNumberKey =
      buildManualFmrCanonicalLineNumberKey_(
        record.FMR_Number,
        record.Revision,
        record.FMR_Line_Number
      );

    const canonicalLineHashes =
      canonicalContext
        .lineHashesByFmrRevisionLine[
          lineNumberKey
        ] || [];

    if (
      canonicalLineHashes.length > 0 &&
      canonicalLineHashes.indexOf(
        hashManualFmrEntryRow_(record)
      ) === -1
    ) {
      item.errors.push(
        reasons.SOURCE_REVISION_CONFLICT
      );
    }
  });
}

function buildManualFmrCanonicalContext_(
  spreadsheet
) {
  const headerSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.canonicalHeader
  );
  const lineSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.canonicalLines
  );

  const headers = readManualFmrSheetObjects_(
    headerSheet,
    FMR_MANUAL_CONFIG.canonicalHeaderFields
  );

  const lines = readManualFmrSheetObjects_(
    lineSheet,
    FMR_MANUAL_CONFIG.canonicalLineFields
  );

  const headerById = {};
  const headersByFmrRevision = {};

  headers.forEach(function (header) {
    const fmrId = normalizeManualFmrText_(
      header.FMR_ID
    );

    if (fmrId) {
      headerById[fmrId] = header;
    }

    const key = buildManualFmrRevisionKey_(
      header.FMR_Number,
      header.Revision
    );

    if (normalizeManualFmrText_(header.FMR_Number)) {
      headersByFmrRevision[key] = header;
    }
  });

  const lineKeys = {};
  const lineHashesByFmrRevisionLine = {};

  lines.forEach(function (line) {
    const header =
      headerById[
        normalizeManualFmrText_(line.FMR_ID)
      ] || {};

    const revision =
      header.Revision ||
      FMR_MANUAL_CONFIG.defaults.revision;

    const pseudoEntry = normalizeManualFmrEntryRow({
      Entry_Row_ID: 'CANONICAL',
      Batch_ID: 'CANONICAL',
      Source_Document_Type:
        FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR,
      Source_File_ID:
        header.PDF_File_ID ||
        header.Sheet_File_ID ||
        'CANONICAL',
      Source_File_Name: '',
      Source_File_URL:
        header.PDF_URL ||
        header.Sheet_URL ||
        '',
      FMR_Number:
        line.FMR_Number ||
        header.FMR_Number,
      Revision: revision,
      IWP_Number:
        line.IWP_Number ||
        header.IWP_Number,
      Request_Date:
        header.Date_Created || '',
      Date_Required:
        header.Date_Required || '',
      Requested_By:
        header.Requested_By || '',
      Requested_By_Email:
        header.Requested_By_Email || '',
      Craft:
        header.Craft ||
        FMR_MANUAL_CONFIG.defaults.craft,
      Deliver_To:
        header.Deliver_To ||
        FMR_MANUAL_CONFIG.defaults.deliverTo,
      Destination:
        header.Destination ||
        FMR_MANUAL_CONFIG.defaults.destination,
      Warehouse:
        header.Warehouse ||
        FMR_MANUAL_CONFIG.defaults.warehouse,
      Priority:
        header.Priority ||
        FMR_MANUAL_CONFIG.defaults.priority,
      ISO_Line_Number:
        line.ISO_Line_Number || '',
      ISO_Sheet:
        line.ISO_Sheet || '',
      ISO_Drawing_Number:
        line.ISO_Drawing_Number || '',
      FMR_Line_Number:
        line.FMR_Line_Number,
      Commodity_Code:
        line.Commodity_Code,
      Size:
        line.Size,
      Material_Description:
        line.Material_Description,
      UOM:
        line.UOM ||
        FMR_MANUAL_CONFIG.defaults.uom,
      Qty_Requested:
        line.Qty_Requested,
      Is_Pipe:
        isManualFmrPipeStock_(
          line.Material_Description
        ),
      Entry_Method:
        FMR_MANUAL_CONFIG.entryMethods.SYSTEM,
      Entry_Status:
        FMR_MANUAL_CONFIG.entryStatuses.APPROVED,
      Entered_By:
        header.Created_By ||
        line.Created_By ||
        'system@example.invalid',
      Entered_At:
        line.Created_At ||
        header.Date_Created ||
        new Date(),
      Reviewer_Email: '',
      Reviewed_At: '',
      Review_Notes: '',
      Validation_Errors: '',
      Row_Content_Hash: ''
    });

    const duplicateKey =
      buildManualFmrDuplicateKey_(
        pseudoEntry
      );

    lineKeys[duplicateKey] = true;

    const lineNumberKey =
      buildManualFmrCanonicalLineNumberKey_(
        pseudoEntry.FMR_Number,
        pseudoEntry.Revision,
        pseudoEntry.FMR_Line_Number
      );

    if (
      !lineHashesByFmrRevisionLine[
        lineNumberKey
      ]
    ) {
      lineHashesByFmrRevisionLine[
        lineNumberKey
      ] = [];
    }

    lineHashesByFmrRevisionLine[
      lineNumberKey
    ].push(
      hashManualFmrEntryRow_(pseudoEntry)
    );
  });

  return {
    headersByFmrRevision,
    lineKeys,
    lineHashesByFmrRevisionLine
  };
}

function manualFmrHeaderMatchesCanonical_(
  entry,
  canonical
) {
  const comparisons = [
    [
      normalizeManualFmrUpper_(entry.IWP_Number),
      normalizeManualFmrUpper_(canonical.IWP_Number)
    ],
    [
      normalizeManualFmrUpper_(entry.Requested_By),
      normalizeManualFmrUpper_(canonical.Requested_By)
    ],
    [
      normalizeManualFmrUpper_(entry.Craft),
      normalizeManualFmrUpper_(canonical.Craft)
    ],
    [
      normalizeManualFmrUpper_(entry.Deliver_To),
      normalizeManualFmrUpper_(canonical.Deliver_To)
    ],
    [
      normalizeManualFmrUpper_(entry.Destination),
      normalizeManualFmrUpper_(canonical.Destination)
    ],
    [
      normalizeManualFmrUpper_(entry.Warehouse),
      normalizeManualFmrUpper_(canonical.Warehouse)
    ]
  ];

  return comparisons.every(function (pair) {
    /*
     * Blank legacy canonical values do not create a false conflict.
     */
    return !pair[1] || pair[0] === pair[1];
  });
}

/* ========================================================================== */
/* REVIEW SNAPSHOT                                                            */
/* ========================================================================== */

function buildManualFmrReviewSnapshot_(
  entryRecord,
  submittedBy,
  submittedAt
) {
  const review = {
    Review_ID: createManualFmrReviewId_(),
    Entry_Row_ID: entryRecord.Entry_Row_ID,
    Batch_ID: entryRecord.Batch_ID,
    Source_File_ID: entryRecord.Source_File_ID,
    Source_File_Name: entryRecord.Source_File_Name,
    Source_File_URL: entryRecord.Source_File_URL,
    FMR_Number: entryRecord.FMR_Number,
    Revision: entryRecord.Revision,
    IWP_Number: entryRecord.IWP_Number,
    FMR_Line_Number: entryRecord.FMR_Line_Number,
    Commodity_Code: entryRecord.Commodity_Code,
    Size: entryRecord.Size,
    Material_Description:
      entryRecord.Material_Description,
    UOM: entryRecord.UOM,
    Qty_Requested: entryRecord.Qty_Requested,
    Is_Pipe: Boolean(entryRecord.Is_Pipe),
    Submitted_By: submittedBy,
    Submitted_At: submittedAt,
    Validation_Errors:
      entryRecord.Validation_Errors,
    Review_Decision: '',
    Reviewer_Email:
      entryRecord.Reviewer_Email,
    Reviewed_At: '',
    Reviewer_Notes: '',
    Canonical_FMR_ID: '',
    Canonical_FMR_Line_ID: '',
    Review_Content_Hash: ''
  };

  review.Review_Content_Hash =
    hashManualFmrReviewSnapshot_(review);

  return normalizeManualFmrReviewSnapshot_(
    review
  );
}

function normalizeManualFmrReviewSnapshot_(
  review
) {
  const source = review || {};
  const normalized = {};

  FMR_MANUAL_CONFIG.reviewHeaders.forEach(
    function (header) {
      normalized[header] =
        source[header] === undefined ||
        source[header] === null
          ? ''
          : source[header];
    }
  );

  normalized.Review_ID =
    normalizeManualFmrText_(
      normalized.Review_ID
    );
  normalized.Entry_Row_ID =
    normalizeManualFmrText_(
      normalized.Entry_Row_ID
    );
  normalized.Batch_ID =
    normalizeManualFmrText_(
      normalized.Batch_ID
    );
  normalized.Source_File_ID =
    normalizeManualFmrText_(
      normalized.Source_File_ID
    );
  normalized.Source_File_Name =
    normalizeManualFmrText_(
      normalized.Source_File_Name
    );
  normalized.Source_File_URL =
    normalizeManualFmrText_(
      normalized.Source_File_URL
    );
  normalized.FMR_Number =
    normalizeManualFmrText_(
      normalized.FMR_Number
    );
  normalized.Revision =
    normalizeManualFmrText_(
      normalized.Revision
    );
  normalized.IWP_Number =
    normalizeManualFmrText_(
      normalized.IWP_Number
    );
  normalized.FMR_Line_Number =
    normalizeManualFmrText_(
      normalized.FMR_Line_Number
    );
  normalized.Commodity_Code =
    normalizeManualFmrText_(
      normalized.Commodity_Code
    );
  normalized.Size =
    normalizeManualFmrText_(
      normalized.Size
    );
  normalized.Material_Description =
    normalizeManualFmrText_(
      normalized.Material_Description
    );
  normalized.UOM =
    normalizeManualFmrUpper_(
      normalized.UOM
    );
  normalized.Qty_Requested =
    normalizeManualFmrQuantity_(
      normalized.Qty_Requested
    );
  normalized.Is_Pipe =
    normalizeManualFmrBoolean_(
      normalized.Is_Pipe
    );
  normalized.Submitted_By =
    normalizeManualFmrEmail_(
      normalized.Submitted_By
    );
  normalized.Submitted_At =
    normalizeManualFmrDate_(
      normalized.Submitted_At
    );
  normalized.Validation_Errors =
    normalizeManualFmrText_(
      normalized.Validation_Errors
    );
  normalized.Review_Decision =
    normalizeManualFmrUpper_(
      normalized.Review_Decision
    );
  normalized.Reviewer_Email =
    normalizeManualFmrEmail_(
      normalized.Reviewer_Email
    );
  normalized.Reviewed_At =
    normalizeManualFmrDate_(
      normalized.Reviewed_At
    );
  normalized.Reviewer_Notes =
    normalizeManualFmrText_(
      normalized.Reviewer_Notes
    );
  normalized.Canonical_FMR_ID =
    normalizeManualFmrText_(
      normalized.Canonical_FMR_ID
    );
  normalized.Canonical_FMR_Line_ID =
    normalizeManualFmrText_(
      normalized.Canonical_FMR_Line_ID
    );
  normalized.Review_Content_Hash =
    normalizeManualFmrText_(
      normalized.Review_Content_Hash
    ) ||
    hashManualFmrReviewSnapshot_(
      normalized
    );

  return normalized;
}

function hashManualFmrReviewSnapshot_(
  review
) {
  const content = [
    normalizeManualFmrText_(
      review.Entry_Row_ID
    ),
    normalizeManualFmrText_(
      review.Batch_ID
    ),
    normalizeManualFmrUpper_(
      review.FMR_Number
    ),
    normalizeManualFmrUpper_(
      review.Revision
    ),
    normalizeManualFmrUpper_(
      review.IWP_Number
    ),
    normalizeManualFmrUpper_(
      review.FMR_Line_Number
    ),
    normalizeManualFmrUpper_(
      review.Commodity_Code
    ),
    normalizeManualFmrUpper_(
      review.Size
    ),
    normalizeManualFmrText_(
      review.Material_Description
    ),
    normalizeManualFmrUpper_(
      review.UOM
    ),
    String(review.Qty_Requested),
    String(Boolean(review.Is_Pipe)),
    normalizeManualFmrText_(
      review.Validation_Errors
    )
  ].join('|');

  return computeManualFmrSha256_(content);
}

/* ========================================================================== */
/* BATCH METRICS                                                              */
/* ========================================================================== */

function recalculateManualFmrBatchMetrics_(
  spreadsheet,
  batchId,
  actor
) {
  const batchSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.batches
  );
  const entrySheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.entry
  );
  const reviewSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.review
  );

  const batchRows = readManualFmrSheetObjectsWithRows_(
    batchSheet,
    FMR_MANUAL_CONFIG.batchHeaders
  );

  const batchItem = batchRows.find(function (item) {
    return (
      normalizeManualFmrText_(
        item.record.Batch_ID
      ) === batchId
    );
  });

  if (!batchItem) {
    throw new Error(
      `Manual FMR batch "${batchId}" was not found.`
    );
  }

  const entries = readManualFmrSheetObjects_(
    entrySheet,
    FMR_MANUAL_CONFIG.entryHeaders
  ).filter(function (record) {
    return (
      normalizeManualFmrText_(record.Batch_ID) ===
      batchId
    );
  });

  const reviews = readManualFmrSheetObjects_(
    reviewSheet,
    FMR_MANUAL_CONFIG.reviewHeaders
  ).filter(function (record) {
    return (
      normalizeManualFmrText_(record.Batch_ID) ===
      batchId
    );
  });

  const approvedEntryRows = entries.filter(
    function (record) {
      return (
        normalizeManualFmrUpper_(
          record.Entry_Status
        ) ===
        FMR_MANUAL_CONFIG.entryStatuses.APPROVED
      );
    }
  );

  const rejectedReviewRows = reviews.filter(
    function (record) {
      return (
        normalizeManualFmrUpper_(
          record.Review_Decision
        ) ===
        FMR_MANUAL_CONFIG.reviewDecisions.REJECT
      );
    }
  );

  const batch = normalizeManualFmrBatchRecord_(
    batchItem.record
  );

  batch.Entered_FMR_Count =
    getDistinctManualFmrCount_(entries);
  batch.Entered_Line_Count =
    entries.length;
  batch.Approved_FMR_Count =
    getDistinctManualFmrCount_(
      approvedEntryRows
    );
  batch.Approved_Line_Count =
    approvedEntryRows.length;
  batch.Rejected_Line_Count =
    rejectedReviewRows.length;
  batch.Updated_At = new Date();

  if (!batch.Created_By) {
    batch.Created_By = actor;
  }

  updateManualFmrObjectRow_(
    batchSheet,
    FMR_MANUAL_CONFIG.batchHeaders,
    batchItem.rowNumber,
    batch
  );

  return Object.assign({}, batch);
}

function updateManualFmrBatchStatus_(
  batchSheet,
  batchId,
  newStatus,
  actor
) {
  const rows = readManualFmrSheetObjectsWithRows_(
    batchSheet,
    FMR_MANUAL_CONFIG.batchHeaders
  );

  const item = rows.find(function (candidate) {
    return (
      normalizeManualFmrText_(
        candidate.record.Batch_ID
      ) === batchId
    );
  });

  if (!item) {
    throw new Error(
      `Manual FMR batch "${batchId}" was not found.`
    );
  }

  const record = normalizeManualFmrBatchRecord_(
    item.record
  );

  record.Batch_Status =
    normalizeManualFmrUpper_(newStatus);
  record.Updated_At = new Date();

  if (!record.Created_By) {
    record.Created_By = actor;
  }

  updateManualFmrObjectRow_(
    batchSheet,
    FMR_MANUAL_CONFIG.batchHeaders,
    item.rowNumber,
    record
  );

  return record;
}

/* ========================================================================== */
/* SHEET READ + WRITE                                                         */
/* ========================================================================== */

function readManualFmrSheetObjectsWithRows_(
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

  const output = [];

  values.forEach(function (row, index) {
    const hasData = row.some(function (value) {
      return value !== '' && value !== null;
    });

    if (!hasData) {
      return;
    }

    const record = {};

    headers.forEach(function (header, column) {
      record[header] = row[column];
    });

    output.push({
      rowNumber: index + 2,
      record
    });
  });

  return output;
}

function appendManualFmrObjects_(
  sheet,
  headers,
  objects
) {
  if (!objects || objects.length === 0) {
    return 0;
  }

  const values = objects.map(function (object) {
    return manualFmrObjectToRow_(
      object,
      headers
    );
  });

  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      values.length,
      headers.length
    )
    .setValues(values);

  return values.length;
}

function updateManualFmrEntryRows_(
  sheet,
  updates
) {
  (updates || []).forEach(function (update) {
    updateManualFmrObjectRow_(
      sheet,
      FMR_MANUAL_CONFIG.entryHeaders,
      update.rowNumber,
      update.record
    );
  });
}

function updateManualFmrObjectRow_(
  sheet,
  headers,
  rowNumber,
  object
) {
  sheet
    .getRange(
      rowNumber,
      1,
      1,
      headers.length
    )
    .setValues([
      manualFmrObjectToRow_(
        object,
        headers
      )
    ]);
}

function manualFmrObjectToRow_(
  object,
  headers
) {
  return headers.map(function (header) {
    return protectManualFmrCellValue_(
      object[header]
    );
  });
}

function protectManualFmrCellValue_(
  value
) {
  if (typeof value !== 'string') {
    return value;
  }

  if (/^[=+@]/.test(value)) {
    return `'${value}`;
  }

  return value;
}

/* ========================================================================== */
/* NORMALIZATION + LOOKUPS                                                    */
/* ========================================================================== */

function normalizeManualFmrBatchRecord_(
  batch
) {
  const source = batch || {};
  const normalized = {};

  FMR_MANUAL_CONFIG.batchHeaders.forEach(
    function (header) {
      normalized[header] =
        source[header] === undefined ||
        source[header] === null
          ? ''
          : source[header];
    }
  );

  normalized.Batch_ID =
    normalizeManualFmrText_(
      normalized.Batch_ID
    );
  normalized.Batch_Name =
    normalizeManualFmrText_(
      normalized.Batch_Name
    );
  normalized.Source_Document_Type =
    normalizeManualFmrUpper_(
      normalized.Source_Document_Type ||
      FMR_MANUAL_CONFIG.sourceDocumentTypes.FMR
    );
  normalized.Source_Folder_ID =
    extractManualFmrDriveId_(
      normalized.Source_Folder_ID ||
      normalized.Source_Folder_URL
    );
  normalized.Source_Folder_URL =
    normalizeManualFmrText_(
      normalized.Source_Folder_URL
    );
  normalized.Assigned_Entry_User_1 =
    normalizeManualFmrEmail_(
      normalized.Assigned_Entry_User_1
    );
  normalized.Assigned_Entry_User_2 =
    normalizeManualFmrEmail_(
      normalized.Assigned_Entry_User_2
    );
  normalized.Assigned_Reviewer =
    normalizeManualFmrEmail_(
      normalized.Assigned_Reviewer
    );
  normalized.Batch_Status =
    normalizeManualFmrUpper_(
      normalized.Batch_Status ||
      FMR_MANUAL_CONFIG.batchStatuses.OPEN
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
    normalized[header] =
      normalizeManualFmrWholeNumber_(
        normalized[header],
        0
      );
  });

  normalized.Created_By =
    normalizeManualFmrEmail_(
      normalized.Created_By
    );
  normalized.Created_At =
    normalizeManualFmrDate_(
      normalized.Created_At
    );
  normalized.Updated_At =
    normalizeManualFmrDate_(
      normalized.Updated_At
    );
  normalized.Notes =
    normalizeManualFmrText_(
      normalized.Notes
    );

  return normalized;
}

function findManualFmrBatchRecord_(
  batchSheet,
  batchId
) {
  const normalizedBatchId =
    normalizeManualFmrText_(batchId);

  const records = readManualFmrSheetObjects_(
    batchSheet,
    FMR_MANUAL_CONFIG.batchHeaders
  );

  const match = records.find(function (record) {
    return (
      normalizeManualFmrText_(
        record.Batch_ID
      ) === normalizedBatchId
    );
  });

  return match
    ? normalizeManualFmrBatchRecord_(match)
    : null;
}

function assertManualFmrCaller_(
  callerEmail
) {
  const actor = normalizeManualFmrEmail_(
    callerEmail
  );

  if (!actor) {
    throw new Error(
      'The authenticated caller email is required.'
    );
  }

  if (!FMR_MANUAL_CONFIG.regex.email.test(actor)) {
    throw new Error(
      `The caller email "${callerEmail}" is invalid.`
    );
  }

  return actor;
}

function extractManualFmrDriveId_(
  value
) {
  const text = normalizeManualFmrText_(
    value
  );

  if (!text) {
    return '';
  }

  if (
    FMR_MANUAL_CONFIG.regex.safeIdentifier.test(
      text
    )
  ) {
    return text;
  }

  const patterns = [
    /\/folders\/([A-Za-z0-9_-]{15,})/,
    /\/file\/d\/([A-Za-z0-9_-]{15,})/,
    /\/document\/d\/([A-Za-z0-9_-]{15,})/,
    /\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/,
    /[?&]id=([A-Za-z0-9_-]{15,})/
  ];

  for (
    let index = 0;
    index < patterns.length;
    index++
  ) {
    const match = text.match(patterns[index]);

    if (match) {
      return match[1];
    }
  }

  return '';
}

function normalizeManualFmrWholeNumber_(
  value,
  fallback
) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return Number(fallback || 0);
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(
      `Expected a nonnegative whole number, received "${value}".`
    );
  }

  return number;
}

function normalizeManualFmrReasonList_(
  value
) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(';');

  return Array.from(
    new Set(
      values
        .map(function (reason) {
          return normalizeManualFmrText_(
            reason
          );
        })
        .filter(Boolean)
    )
  );
}

function isManualFmrInactiveEntryStatus_(
  status
) {
  const normalized = normalizeManualFmrUpper_(
    status
  );

  return [
    FMR_MANUAL_CONFIG.entryStatuses.APPROVED,
    FMR_MANUAL_CONFIG.entryStatuses.REJECTED,
    FMR_MANUAL_CONFIG.entryStatuses.SUPERSEDED,
    FMR_MANUAL_CONFIG.entryStatuses.VOIDED
  ].indexOf(normalized) !== -1;
}

function buildManualFmrRevisionKey_(
  fmrNumber,
  revision
) {
  return [
    normalizeManualFmrUpper_(fmrNumber),
    normalizeManualFmrUpper_(
      revision ||
      FMR_MANUAL_CONFIG.defaults.revision
    )
  ].join('|');
}

function buildManualFmrCanonicalLineNumberKey_(
  fmrNumber,
  revision,
  lineNumber
) {
  return [
    normalizeManualFmrUpper_(fmrNumber),
    normalizeManualFmrUpper_(
      revision ||
      FMR_MANUAL_CONFIG.defaults.revision
    ),
    normalizeManualFmrUpper_(lineNumber)
  ].join('|');
}

function buildManualFmrReviewSnapshotKey_(
  entryRowId,
  reviewContentHash
) {
  return [
    normalizeManualFmrText_(entryRowId),
    normalizeManualFmrText_(
      reviewContentHash
    )
  ].join('|');
}

function getDistinctManualFmrCount_(
  records
) {
  const keys = {};

  (records || []).forEach(function (record) {
    const fmrNumber = normalizeManualFmrText_(
      record.FMR_Number
    );

    if (!fmrNumber) {
      return;
    }

    keys[
      buildManualFmrRevisionKey_(
        fmrNumber,
        record.Revision
      )
    ] = true;
  });

  return Object.keys(keys).length;
}

function countManualFmrValues_(
  records,
  field
) {
  const counts = {};

  (records || []).forEach(function (record) {
    const value = normalizeManualFmrUpper_(
      record[field]
    ) || '(BLANK)';

    counts[value] = (counts[value] || 0) + 1;
  });

  return counts;
}

function appendManualFmrNote_(
  existing,
  note
) {
  const current = normalizeManualFmrText_(
    existing
  );
  const addition = normalizeManualFmrText_(
    note
  );

  if (!current) {
    return addition;
  }

  if (!addition || current.indexOf(addition) !== -1) {
    return current;
  }

  return `${current} | ${addition}`;
}

function computeManualFmrSha256_(
  value
) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function (byte) {
      const normalized = (byte + 256) % 256;
      return (`0${normalized.toString(16)}`).slice(-2);
    })
    .join('');
}
