/**
 * Phase4_FmrImportService.gs
 *
 * Bulk discovery, extraction, parsing, and staging service for completed FMR
 * documents.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * DATA FLOW
 * ---------
 * FMR_Manual_Batches.Source_Folder_ID
 *   -> discover direct child FMR files
 *   -> FMR_Import_Queue
 *   -> extract PDF / Google Sheet / XLSX
 *   -> parseKnownFmrText() or parseKnownFmrMatrix()
 *   -> populated FMR_Manual_Entry DRAFT rows
 *   -> human verification
 *   -> existing manual validation and review workflow
 *
 * IMPORTANT BOUNDARIES
 * --------------------
 * - This service does not scan ISO folders to generate material demand.
 * - This service does not submit or approve FMRs.
 * - Imported rows always remain DRAFT and require human verification.
 * - Folder discovery is non-recursive and only inspects direct children.
 * - PDF conversion uses Google Drive import/OCR, not Cloud Vision.
 * - Processing is resumable and intentionally chunked for Apps Script limits.
 *
 * REQUIRED FILES IN FMRCORE
 * -------------------------
 * - Phase4_FmrImportConfig.gs
 * - Phase4_FmrTemplateParser.gs
 * - Phase4_ManualFmrConfig.gs
 * - Phase4_ManualFmrSheetService.gs
 * - Phase4_ManualFmrIntakeService.gs
 * - Phase4_ManualFmrReviewService.gs
 * - Phase4_ManualFmrGuardrails.gs
 *
 * REQUIRED ADVANCED SERVICE
 * -------------------------
 * Google Drive API v3 with user symbol: Drive
 */

const FMR_IMPORT_SERVICE = Object.freeze({
  componentVersion: 'fmr-import-service-v1.0.3-multi-fmr-workbook',

  googleMimeTypes: Object.freeze({
    FOLDER: 'application/vnd.google-apps.folder',
    DOCUMENT: 'application/vnd.google-apps.document',
    SPREADSHEET: 'application/vnd.google-apps.spreadsheet'
  }),

  processingStatuses: Object.freeze([
    'QUEUED',
    'PROCESSING'
  ]),

  retryableStatuses: Object.freeze([
    'FAILED',
    'NEEDS_MANUAL_ENTRY'
  ]),

  terminalStatuses: Object.freeze([
    'STAGED_NEEDS_VERIFICATION',
    'SKIPPED_DUPLICATE',
    'CANCELLED'
  ]),

  staleProcessingMinutes: 30,

  maximumSpreadsheetRows: 500,
  maximumSpreadsheetColumns: 100,

  sourceInterface: 'FMR_IMPORT',

  queueWidths: Object.freeze({
    Import_ID: 260,
    Batch_ID: 245,
    Source_File_ID: 250,
    Source_File_Name: 280,
    Source_File_URL: 330,
    Source_Mime_Type: 220,
    Source_Modified_At: 145,
    Import_Status: 210,
    Import_Method: 205,
    Detected_Template: 180,
    FMR_Number: 170,
    Revision: 85,
    IWP_Number: 220,
    ISO_Line_Number: 220,
    ISO_Sheet: 90,
    ISO_Drawing_Number: 220,
    Requested_By: 180,
    Date_Required: 125,
    Material_Line_Count: 125,
    Confidence_Pct: 115,
    Warnings: 360,
    Error_Message: 420,
    Staged_Entry_Row_Count: 145,
    Started_At: 145,
    Completed_At: 145,
    Imported_By: 245,
    Updated_At: 145,
    Source_Content_Hash: 290,
    Temporary_File_ID: 250,
    Notes: 360
  })
});

/* ========================================================================== */
/* PUBLIC SERVICE INFORMATION                                                 */
/* ========================================================================== */

function getFmrImportServiceVersion() {
  return {
    schemaVersion: FMR_IMPORT_CONFIG.schemaVersion,
    importConfigVersion: FMR_IMPORT_CONFIG.serviceVersion,
    parserVersion: FMR_TEMPLATE_PARSER.componentVersion,
    component: FMR_IMPORT_SERVICE.componentVersion
  };
}

/**
 * Verifies queue, staging, batch, user, and audit contracts.
 *
 * @param {string} spreadsheetId
 * @return {Object}
 */
function validateFmrImportServiceFoundation(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const issues = [];

  try {
    validateManualFmrCanonicalContracts_(spreadsheet);
  } catch (error) {
    issues.push(error.message || String(error));
  }

  try {
    validateManualFmrReviewSupportContracts_(spreadsheet);
  } catch (error) {
    issues.push(error.message || String(error));
  }

  try {
    const foundation = validateManualFmrIntakeFoundation(normalizedId);

    if (!foundation.valid) {
      foundation.missingSheets.forEach(function (name) {
        issues.push(`Missing manual FMR sheet: ${name}`);
      });

      foundation.headerMismatches.forEach(function (message) {
        issues.push(`Manual FMR header mismatch: ${message}`);
      });
    }
  } catch (error) {
    issues.push(error.message || String(error));
  }

  try {
    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );

    if (!queueSheet) {
      issues.push(
        `Missing import queue sheet: ${FMR_IMPORT_CONFIG.sheets.queue}`
      );
    } else {
      assertFmrImportHeaders_(
        queueSheet,
        FMR_IMPORT_CONFIG.queueHeaders
      );
    }
  } catch (error) {
    issues.push(error.message || String(error));
  }

  if (
    typeof Drive === 'undefined' ||
    !Drive.Files ||
    typeof Drive.Files.list !== 'function' ||
    typeof Drive.Files.create !== 'function'
  ) {
    issues.push(
      'Google Drive advanced service v3 is not enabled with identifier Drive.'
    );
  }

  return {
    valid: issues.length === 0,
    spreadsheetId: normalizedId,
    queueSheet: FMR_IMPORT_CONFIG.sheets.queue,
    issues
  };
}

/* ========================================================================== */
/* QUEUE SHEET SETUP                                                          */
/* ========================================================================== */

/**
 * Creates or verifies FMR_Import_Queue.
 *
 * Only an active Administrator, Planner, or Material Control user can invoke
 * the public setup operation. Assigned entry users can still use discovery and
 * processing; those operations initialize the queue internally after their
 * batch authorization succeeds.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @return {Object}
 */
function setupFmrImportQueueSheet(
  spreadsheetId,
  callerEmail
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const identity = getManualFmrReviewerIdentity_(spreadsheet, actor);
  const role = normalizeManualFmrUpper_(identity.Role);

  if (
    [
      'ADMINISTRATOR',
      'PLANNER',
      'MATERIAL CONTROL'
    ].indexOf(role) === -1
  ) {
    throw new Error(
      `Role "${identity.Role}" is not authorized to set up the FMR import queue.`
    );
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR setup or import operation is running. Try again shortly.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(normalizedId);
    const result = setupFmrImportQueueSheetUnlocked_(spreadsheet);

    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function setupFmrImportQueueSheetUnlocked_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(
    FMR_IMPORT_CONFIG.sheets.queue
  );

  let created = false;

  if (!sheet) {
    sheet = spreadsheet.insertSheet(
      FMR_IMPORT_CONFIG.sheets.queue
    );
    created = true;
  }

  ensureFmrImportSheetSize_(
    sheet,
    1000,
    FMR_IMPORT_CONFIG.queueHeaders.length
  );

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        FMR_IMPORT_CONFIG.queueHeaders.length
      )
      .setValues([
        Array.from(FMR_IMPORT_CONFIG.queueHeaders)
      ]);
  }

  assertFmrImportHeaders_(
    sheet,
    FMR_IMPORT_CONFIG.queueHeaders
  );

  formatFmrImportQueueSheet_(sheet);

  return {
    created,
    sheetName: sheet.getName(),
    headers: FMR_IMPORT_CONFIG.queueHeaders.length,
    url:
      spreadsheet.getUrl() +
      '#gid=' +
      sheet.getSheetId()
  };
}

/* ========================================================================== */
/* DISCOVERY                                                                  */
/* ========================================================================== */

/**
 * Discovers supported completed-FMR files directly inside the batch folder.
 *
 * This operation is non-recursive. Subfolders and unsupported files are
 * counted but not queued.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @param {Object=} options
 * Supported:
 * - maximumFiles
 * - fileNameContains
 * - includeExistingQueueRecords
 *
 * @return {Object}
 */
function discoverFmrFilesForBatch(
  spreadsheetId,
  callerEmail,
  batchId,
  options
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(batchId);
  const settings = options || {};

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: normalizedBatchId }
  );

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const batchSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.batches
  );
  const batch = findManualFmrBatchRecord_(
    batchSheet,
    normalizedBatchId
  );

  if (!batch) {
    throw new Error(
      `Batch "${normalizedBatchId}" was not found.`
    );
  }

  const folderId = extractManualFmrDriveId_(
    batch.Source_Folder_ID ||
    batch.Source_Folder_URL
  );

  if (!folderId) {
    throw new Error(
      `Batch "${normalizedBatchId}" does not have a valid Source_Folder_ID or Source_Folder_URL.`
    );
  }

  const folderMetadata = getFmrImportDriveMetadata_(folderId);

  if (
    folderMetadata.mimeType !==
    FMR_IMPORT_SERVICE.googleMimeTypes.FOLDER
  ) {
    throw new Error(
      `Batch source "${folderMetadata.name || folderId}" is not a Google Drive folder.`
    );
  }

  const maximumFiles = Math.min(
    Math.max(
      1,
      normalizeFmrImportWholeNumber_(
        settings.maximumFiles,
        FMR_IMPORT_CONFIG.defaults.maximumFilesPerBatch
      )
    ),
    FMR_IMPORT_CONFIG.defaults.maximumFilesPerBatch
  );

  const fileNameContains = normalizeFmrImportText_(
    settings.fileNameContains
  ).toLowerCase();

  const discovered = listDirectFmrImportFiles_(
    folderId,
    maximumFiles
  );

  const supportedFiles = [];
  let ignoredFolders = 0;
  let ignoredUnsupported = 0;
  let ignoredNameFilter = 0;

  discovered.forEach(function (file) {
    if (
      file.mimeType ===
      FMR_IMPORT_SERVICE.googleMimeTypes.FOLDER
    ) {
      ignoredFolders++;
      return;
    }

    if (
      FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
        file.mimeType
      ) === -1
    ) {
      ignoredUnsupported++;
      return;
    }

    if (
      fileNameContains &&
      normalizeFmrImportText_(file.name)
        .toLowerCase()
        .indexOf(fileNameContains) === -1
    ) {
      ignoredNameFilter++;
      return;
    }

    supportedFiles.push(file);
  });

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR discovery or import operation is running. Try again shortly.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(normalizedId);
    const queueSetup = setupFmrImportQueueSheetUnlocked_(
      spreadsheet
    );
    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );

    const existing = readFmrImportQueueObjectsWithRows_(
      queueSheet
    );

    const existingBySource = {};

    existing.forEach(function (item) {
      const record = normalizeFmrImportQueueRecord(
        item.record
      );

      const key = buildFmrImportSourceKey_(
        record.Batch_ID,
        record.Source_File_ID
      );

      if (key) {
        existingBySource[key] = item;
      }
    });

    const queueRows = [];
    const existingRecords = [];
    const now = new Date();

    supportedFiles.forEach(function (file) {
      const key = buildFmrImportSourceKey_(
        normalizedBatchId,
        file.id
      );

      if (
        existingBySource[key] &&
        settings.includeExistingQueueRecords !== true
      ) {
        existingRecords.push(
          normalizeFmrImportQueueRecord(
            existingBySource[key].record
          )
        );
        return;
      }

      const method = getFmrImportMethodForMimeType_(
        file.mimeType
      );

      queueRows.push(
        normalizeFmrImportQueueRecord({
          Import_ID: createFmrImportId_(),
          Batch_ID: normalizedBatchId,
          Source_File_ID: file.id,
          Source_File_Name: file.name,
          Source_File_URL:
            file.webViewLink ||
            buildFmrImportFileUrl_(file.id),
          Source_Mime_Type: file.mimeType,
          Source_Modified_At:
            parseFmrImportDate_(file.modifiedTime),
          Import_Status:
            FMR_IMPORT_CONFIG.statuses.QUEUED,
          Import_Method: method,
          Detected_Template:
            FMR_IMPORT_CONFIG.templates.UNKNOWN,
          FMR_Number: '',
          Revision: '',
          IWP_Number: '',
          ISO_Line_Number: '',
          ISO_Sheet: '',
          ISO_Drawing_Number: '',
          Requested_By: '',
          Date_Required: '',
          Material_Line_Count: 0,
          Confidence_Pct: 0,
          Warnings: '',
          Error_Message: '',
          Staged_Entry_Row_Count: 0,
          Started_At: '',
          Completed_At: '',
          Imported_By: actor,
          Updated_At: now,
          Source_Content_Hash:
            createFmrImportSourceMetadataHash_(file),
          Temporary_File_ID: '',
          Notes:
            `Discovered as a direct child of batch folder "${folderMetadata.name}".`
        })
      );
    });

    appendFmrImportQueueObjects_(
      queueSheet,
      queueRows
    );

    const identity = getManualFmrReviewerIdentity_(
      spreadsheet,
      actor
    );

    if (queueRows.length > 0) {
      appendFmrImportAudit_(
        spreadsheet,
        identity,
        {
          entityType: 'FMR_IMPORT_BATCH',
          entityId: normalizedBatchId,
          action: 'DISCOVER_FILES',
          newValue: {
            folderId,
            folderName: folderMetadata.name,
            queuedFiles: queueRows.length,
            existingFiles: existingRecords.length,
            ignoredFolders,
            ignoredUnsupported,
            ignoredNameFilter
          },
          correlationId:
            createFmrImportCorrelationId_()
        }
      );
    }

    SpreadsheetApp.flush();

    return {
      batchId: normalizedBatchId,
      folderId,
      folderName: folderMetadata.name,
      queueSheet: queueSetup.sheetName,
      directChildrenScanned: discovered.length,
      supportedFilesFound: supportedFiles.length,
      newlyQueued: queueRows.length,
      alreadyQueued: existingRecords.length,
      ignoredFolders,
      ignoredUnsupported,
      ignoredNameFilter,
      truncated:
        discovered.length >= maximumFiles,
      queuedImportIds: queueRows.map(function (row) {
        return row.Import_ID;
      })
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Queues one explicitly selected FMR file.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @param {string} sourceFileIdOrUrl
 * @return {Object}
 */
function enqueueSingleFmrFile(
  spreadsheetId,
  callerEmail,
  batchId,
  sourceFileIdOrUrl
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(batchId);
  const sourceFileId = extractManualFmrDriveId_(
    sourceFileIdOrUrl
  );

  if (!sourceFileId) {
    throw new Error(
      'A valid individual FMR file ID or URL is required.'
    );
  }

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: normalizedBatchId }
  );

  const metadata = getFmrImportDriveMetadata_(
    sourceFileId
  );

  if (
    metadata.mimeType ===
    FMR_IMPORT_SERVICE.googleMimeTypes.FOLDER
  ) {
    throw new Error(
      'A folder was supplied where an individual FMR file was required.'
    );
  }

  if (
    FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
      metadata.mimeType
    ) === -1
  ) {
    throw new Error(
      `Unsupported FMR source type "${metadata.mimeType}". ` +
      'Supported formats are PDF, Google Sheets, and XLSX.'
    );
  }

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR queue operation is running. Try again shortly.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(normalizedId);
    setupFmrImportQueueSheetUnlocked_(spreadsheet);

    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );

    const existing = findFmrImportQueueBySource_(
      queueSheet,
      normalizedBatchId,
      sourceFileId
    );

    if (existing) {
      return {
        created: false,
        alreadyQueued: true,
        record:
          normalizeFmrImportQueueRecord(
            existing.record
          )
      };
    }

    const now = new Date();

    const record = normalizeFmrImportQueueRecord({
      Import_ID: createFmrImportId_(),
      Batch_ID: normalizedBatchId,
      Source_File_ID: metadata.id,
      Source_File_Name: metadata.name,
      Source_File_URL:
        metadata.webViewLink ||
        buildFmrImportFileUrl_(metadata.id),
      Source_Mime_Type: metadata.mimeType,
      Source_Modified_At:
        parseFmrImportDate_(metadata.modifiedTime),
      Import_Status:
        FMR_IMPORT_CONFIG.statuses.QUEUED,
      Import_Method:
        getFmrImportMethodForMimeType_(
          metadata.mimeType
        ),
      Detected_Template:
        FMR_IMPORT_CONFIG.templates.UNKNOWN,
      Imported_By: actor,
      Updated_At: now,
      Source_Content_Hash:
        createFmrImportSourceMetadataHash_(metadata),
      Notes: 'Explicitly queued by file ID or URL.'
    });

    appendFmrImportQueueObjects_(
      queueSheet,
      [record]
    );

    SpreadsheetApp.flush();

    return {
      created: true,
      alreadyQueued: false,
      record
    };
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* CHUNK PROCESSING                                                           */
/* ========================================================================== */

/**
 * Processes the next queued FMR files for one batch.
 *
 * One queue record is claimed at a time under a short lock. PDF conversion
 * and parsing occur outside the lock. Staging and queue finalization occur
 * under another short lock so manual spreadsheet use is not blocked during
 * OCR/conversion.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string} batchId
 * @param {Object=} options
 * Supported:
 * - chunkSize (1-20)
 * - maximumRuntimeMs
 *
 * @return {Object}
 */
function processNextFmrImportChunk(
  spreadsheetId,
  callerEmail,
  batchId,
  options
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(batchId);
  const settings = options || {};

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: normalizedBatchId }
  );

  const chunkSize = Math.min(
    20,
    Math.max(
      1,
      normalizeFmrImportWholeNumber_(
        settings.chunkSize,
        FMR_IMPORT_CONFIG.defaults.processingChunkSize
      )
    )
  );

  const maximumRuntimeMs = Math.min(
    300000,
    Math.max(
      30000,
      normalizeFmrImportWholeNumber_(
        settings.maximumRuntimeMs,
        FMR_IMPORT_CONFIG.defaults.maximumRuntimeMs
      )
    )
  );

  ensureFmrImportQueueFoundation_(
    normalizedId,
    actor,
    normalizedBatchId
  );

  const startedAt = Date.now();
  const processed = [];

  while (
    processed.length < chunkSize &&
    Date.now() - startedAt < maximumRuntimeMs
  ) {
    const claimed = claimNextFmrImportRecord_(
      normalizedId,
      normalizedBatchId,
      actor
    );

    if (!claimed) {
      break;
    }

    let extraction = null;

    try {
      extraction = extractAndParseFmrImportSource_(
        claimed.record
      );

      const finalized = finalizeFmrImportRecord_(
        normalizedId,
        actor,
        claimed.record.Import_ID,
        extraction
      );

      processed.push(finalized);
    } catch (error) {
      const failed = failFmrImportRecord_(
        normalizedId,
        actor,
        claimed.record.Import_ID,
        error,
        extraction
      );

      processed.push(failed);
    }
  }

  const summary = getFmrImportBatchSummary(
    normalizedId,
    actor,
    normalizedBatchId,
    {
      maximumItems: 25,
      includeItems: false
    }
  );

  return {
    batchId: normalizedBatchId,
    requestedChunkSize: chunkSize,
    processedCount: processed.length,
    elapsedMs: Date.now() - startedAt,
    processed,
    remainingQueued:
      summary.statusCounts.QUEUED || 0,
    currentlyProcessing:
      summary.statusCounts.PROCESSING || 0,
    stagedNeedsVerification:
      summary.statusCounts.STAGED_NEEDS_VERIFICATION || 0,
    needsManualEntry:
      summary.statusCounts.NEEDS_MANUAL_ENTRY || 0,
    failed:
      summary.statusCounts.FAILED || 0,
    complete:
      (summary.statusCounts.QUEUED || 0) === 0 &&
      (summary.statusCounts.PROCESSING || 0) === 0
  };
}

/**
 * Processes specific import IDs. Useful for a selected-row UI.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string[]} importIds
 * @param {Object=} options
 * @return {Object}
 */
function processSelectedFmrImports(
  spreadsheetId,
  callerEmail,
  importIds,
  options
) {
  const normalizedIds = normalizeFmrImportIds_(importIds);

  if (normalizedIds.length === 0) {
    throw new Error(
      'At least one Import_ID is required.'
    );
  }

  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const settings = options || {};
  const maximumRuntimeMs = Math.min(
    300000,
    Math.max(
      30000,
      normalizeFmrImportWholeNumber_(
        settings.maximumRuntimeMs,
        FMR_IMPORT_CONFIG.defaults.maximumRuntimeMs
      )
    )
  );

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const queueSheet = spreadsheet.getSheetByName(
    FMR_IMPORT_CONFIG.sheets.queue
  );

  if (!queueSheet) {
    throw new Error(
      `${FMR_IMPORT_CONFIG.sheets.queue} has not been set up.`
    );
  }

  const queueItems = readFmrImportQueueObjectsWithRows_(
    queueSheet
  );
  const byId = {};

  queueItems.forEach(function (item) {
    const record = normalizeFmrImportQueueRecord(
      item.record
    );
    byId[record.Import_ID] = {
      rowNumber: item.rowNumber,
      record
    };
  });

  const batchIds = Array.from(
    new Set(
      normalizedIds.map(function (importId) {
        if (!byId[importId]) {
          throw new Error(
            `Import_ID "${importId}" was not found.`
          );
        }

        return byId[importId].record.Batch_ID;
      })
    )
  );

  batchIds.forEach(function (batchId) {
    authorizeManualFmrGuardrailRequest_(
      normalizedId,
      actor,
      FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
      { batchId }
    );
  });

  const startedAt = Date.now();
  const processed = [];

  for (
    let index = 0;
    index < normalizedIds.length;
    index++
  ) {
    if (Date.now() - startedAt >= maximumRuntimeMs) {
      break;
    }

    const importId = normalizedIds[index];

    const claimed = claimSpecificFmrImportRecord_(
      normalizedId,
      importId,
      actor
    );

    if (!claimed) {
      processed.push({
        importId,
        status: 'NOT_QUEUED',
        message:
          'The import is not currently in QUEUED status.'
      });
      continue;
    }

    let extraction = null;

    try {
      extraction = extractAndParseFmrImportSource_(
        claimed.record
      );

      processed.push(
        finalizeFmrImportRecord_(
          normalizedId,
          actor,
          importId,
          extraction
        )
      );
    } catch (error) {
      processed.push(
        failFmrImportRecord_(
          normalizedId,
          actor,
          importId,
          error,
          extraction
        )
      );
    }
  }

  return {
    requested: normalizedIds.length,
    processedCount: processed.length,
    elapsedMs: Date.now() - startedAt,
    processed
  };
}

/* ========================================================================== */
/* RETRY + CANCEL                                                             */
/* ========================================================================== */

function retryFailedFmrImports(
  spreadsheetId,
  callerEmail,
  batchId,
  importIds
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(batchId);
  const normalizedIds = normalizeFmrImportIds_(importIds);

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: normalizedBatchId }
  );

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR queue operation is running. Try again shortly.'
    );
  }

  try {
    setupFmrImportQueueSheetUnlocked_(spreadsheet);

    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );
    const items = readFmrImportQueueObjectsWithRows_(
      queueSheet
    );

    const updated = [];
    const skipped = [];
    const now = new Date();

    items.forEach(function (item) {
      const record = normalizeFmrImportQueueRecord(
        item.record
      );

      if (record.Batch_ID !== normalizedBatchId) {
        return;
      }

      if (
        normalizedIds.length > 0 &&
        normalizedIds.indexOf(record.Import_ID) === -1
      ) {
        return;
      }

      if (
        FMR_IMPORT_SERVICE.retryableStatuses.indexOf(
          record.Import_Status
        ) === -1
      ) {
        skipped.push({
          importId: record.Import_ID,
          status: record.Import_Status
        });
        return;
      }

      record.Import_Status =
        FMR_IMPORT_CONFIG.statuses.QUEUED;
      record.Error_Message = '';
      record.Started_At = '';
      record.Completed_At = '';
      record.Imported_By = actor;
      record.Updated_At = now;
      record.Notes = appendFmrImportNote_(
        record.Notes,
        `Retry requested by ${actor}.`
      );

      updateFmrImportQueueObjectRow_(
        queueSheet,
        item.rowNumber,
        record
      );

      updated.push(record.Import_ID);
    });

    SpreadsheetApp.flush();

    return {
      batchId: normalizedBatchId,
      retried: updated.length,
      skipped: skipped.length,
      retriedImportIds: updated,
      skippedItems: skipped
    };
  } finally {
    lock.releaseLock();
  }
}

function cancelFmrImport(
  spreadsheetId,
  callerEmail,
  importId,
  reason
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedImportId = normalizeFmrImportText_(importId);

  if (!normalizedImportId) {
    throw new Error('An Import_ID is required.');
  }

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const queueSheet = spreadsheet.getSheetByName(
    FMR_IMPORT_CONFIG.sheets.queue
  );

  if (!queueSheet) {
    throw new Error(
      `${FMR_IMPORT_CONFIG.sheets.queue} has not been set up.`
    );
  }

  const item = findFmrImportQueueById_(
    queueSheet,
    normalizedImportId
  );

  if (!item) {
    throw new Error(
      `Import_ID "${normalizedImportId}" was not found.`
    );
  }

  const record = normalizeFmrImportQueueRecord(
    item.record
  );

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: record.Batch_ID }
  );

  if (
    record.Import_Status ===
    FMR_IMPORT_CONFIG.statuses.STAGED_NEEDS_VERIFICATION
  ) {
    throw new Error(
      'This import already created staging rows. Void or supersede those staging rows instead of cancelling the import record.'
    );
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR queue operation is running. Try again shortly.'
    );
  }

  try {
    const current = findFmrImportQueueById_(
      queueSheet,
      normalizedImportId
    );

    if (!current) {
      throw new Error(
        `Import_ID "${normalizedImportId}" was not found.`
      );
    }

    const updated = normalizeFmrImportQueueRecord(
      current.record
    );

    updated.Import_Status =
      FMR_IMPORT_CONFIG.statuses.CANCELLED;
    updated.Error_Message = '';
    updated.Completed_At = new Date();
    updated.Imported_By = actor;
    updated.Updated_At = new Date();
    updated.Notes = appendFmrImportNote_(
      updated.Notes,
      `Cancelled by ${actor}: ${
        normalizeFmrImportText_(reason) ||
        'No reason supplied.'
      }`
    );

    updateFmrImportQueueObjectRow_(
      queueSheet,
      current.rowNumber,
      updated
    );

    SpreadsheetApp.flush();

    return updated;
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* SUMMARY                                                                    */
/* ========================================================================== */

function getFmrImportBatchSummary(
  spreadsheetId,
  callerEmail,
  batchId,
  options
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedBatchId = normalizeManualFmrText_(batchId);
  const settings = options || {};

  authorizeManualFmrGuardrailRequest_(
    normalizedId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId: normalizedBatchId }
  );

  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const queueSheet = spreadsheet.getSheetByName(
    FMR_IMPORT_CONFIG.sheets.queue
  );

  if (!queueSheet) {
    return {
      batchId: normalizedBatchId,
      queueExists: false,
      totalImports: 0,
      totalStagedRows: 0,
      statusCounts: {},
      items: []
    };
  }

  const maximumItems = Math.min(
    250,
    Math.max(
      1,
      normalizeFmrImportWholeNumber_(
        settings.maximumItems,
        50
      )
    )
  );

  const records = readFmrImportQueueObjectsWithRows_(
    queueSheet
  )
    .map(function (item) {
      return normalizeFmrImportQueueRecord(
        item.record
      );
    })
    .filter(function (record) {
      return record.Batch_ID === normalizedBatchId;
    });

  const statusCounts = {};
  let totalStagedRows = 0;
  let totalDetectedLines = 0;

  records.forEach(function (record) {
    statusCounts[record.Import_Status] =
      (statusCounts[record.Import_Status] || 0) + 1;

    totalStagedRows +=
      Number(record.Staged_Entry_Row_Count) || 0;

    totalDetectedLines +=
      Number(record.Material_Line_Count) || 0;
  });

  const ordered = records
    .slice()
    .sort(function (left, right) {
      const leftTime = new Date(
        left.Updated_At || 0
      ).getTime();

      const rightTime = new Date(
        right.Updated_At || 0
      ).getTime();

      return rightTime - leftTime;
    });

  return {
    batchId: normalizedBatchId,
    queueExists: true,
    totalImports: records.length,
    totalDetectedLines,
    totalStagedRows,
    statusCounts,
    items:
      settings.includeItems === false
        ? []
        : ordered.slice(0, maximumItems)
  };
}

/* ========================================================================== */
/* QUEUE CLAIMING                                                             */
/* ========================================================================== */

function ensureFmrImportQueueFoundation_(
  spreadsheetId,
  actor,
  batchId
) {
  authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    actor,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    { batchId }
  );

  const spreadsheet = SpreadsheetApp.openById(
    spreadsheetId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR setup operation is running. Try again shortly.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(
      spreadsheetId
    );
    setupFmrImportQueueSheetUnlocked_(
      spreadsheet
    );
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function claimNextFmrImportRecord_(
  spreadsheetId,
  batchId,
  actor
) {
  return claimFmrImportRecord_(
    spreadsheetId,
    actor,
    function (record) {
      return (
        record.Batch_ID === batchId &&
        record.Import_Status ===
          FMR_IMPORT_CONFIG.statuses.QUEUED
      );
    }
  );
}

function claimSpecificFmrImportRecord_(
  spreadsheetId,
  importId,
  actor
) {
  return claimFmrImportRecord_(
    spreadsheetId,
    actor,
    function (record) {
      return (
        record.Import_ID === importId &&
        record.Import_Status ===
          FMR_IMPORT_CONFIG.statuses.QUEUED
      );
    }
  );
}

function claimFmrImportRecord_(
  spreadsheetId,
  actor,
  predicate
) {
  const spreadsheet = SpreadsheetApp.openById(
    spreadsheetId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR import is claiming a queue item. Try again shortly.'
    );
  }

  try {
    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );

    if (!queueSheet) {
      return null;
    }

    recoverStaleFmrImportClaims_(
      queueSheet
    );

    const items = readFmrImportQueueObjectsWithRows_(
      queueSheet
    ).sort(function (left, right) {
      const leftRecord =
        normalizeFmrImportQueueRecord(
          left.record
        );

      const rightRecord =
        normalizeFmrImportQueueRecord(
          right.record
        );

      return (
        getFmrImportMethodPriority_(
          leftRecord.Import_Method
        ) -
        getFmrImportMethodPriority_(
          rightRecord.Import_Method
        )
      );
    });

    for (
      let index = 0;
      index < items.length;
      index++
    ) {
      const record = normalizeFmrImportQueueRecord(
        items[index].record
      );

      if (!predicate(record)) {
        continue;
      }

      const now = new Date();

      record.Import_Status =
        FMR_IMPORT_CONFIG.statuses.PROCESSING;
      record.Started_At = now;
      record.Completed_At = '';
      record.Imported_By = actor;
      record.Updated_At = now;
      record.Error_Message = '';

      updateFmrImportQueueObjectRow_(
        queueSheet,
        items[index].rowNumber,
        record
      );

      SpreadsheetApp.flush();

      return {
        rowNumber: items[index].rowNumber,
        record
      };
    }

    return null;
  } finally {
    lock.releaseLock();
  }
}

function getFmrImportMethodPriority_(
  importMethod
) {
  const method =
    normalizeFmrImportUpper_(
      importMethod
    );

  if (
    method ===
    FMR_IMPORT_CONFIG.methods
      .GOOGLE_SHEET
  ) {
    return 1;
  }

  if (
    method ===
    FMR_IMPORT_CONFIG.methods
      .XLSX_TO_GOOGLE_SHEET
  ) {
    return 2;
  }

  if (
    method ===
    FMR_IMPORT_CONFIG.methods
      .PDF_TO_DOC_OCR
  ) {
    return 3;
  }

  return 99;
}

function recoverStaleFmrImportClaims_(
  queueSheet
) {
  const items = readFmrImportQueueObjectsWithRows_(
    queueSheet
  );
  const threshold =
    Date.now() -
    FMR_IMPORT_SERVICE.staleProcessingMinutes *
      60 *
      1000;

  items.forEach(function (item) {
    const record = normalizeFmrImportQueueRecord(
      item.record
    );

    if (
      record.Import_Status !==
      FMR_IMPORT_CONFIG.statuses.PROCESSING
    ) {
      return;
    }

    const started = new Date(
      record.Started_At || 0
    ).getTime();

    if (!started || started >= threshold) {
      return;
    }

    record.Import_Status =
      FMR_IMPORT_CONFIG.statuses.QUEUED;
    record.Error_Message = '';
    record.Started_At = '';
    record.Updated_At = new Date();
    record.Notes = appendFmrImportNote_(
      record.Notes,
      'Recovered from a stale PROCESSING claim.'
    );

    updateFmrImportQueueObjectRow_(
      queueSheet,
      item.rowNumber,
      record
    );
  });
}

/* ========================================================================== */
/* EXTRACTION                                                                 */
/* ========================================================================== */

function extractAndParseFmrImportSource_(
  queueRecord
) {
  const record =
    normalizeFmrImportQueueRecord(
      queueRecord
    );

  const metadata =
    getFmrImportDriveMetadata_(
      record.Source_File_ID
    );

  if (
    metadata.mimeType ===
    FMR_IMPORT_SERVICE.googleMimeTypes.FOLDER
  ) {
    throw new Error(
      'The queued source is a folder, not an individual FMR file.'
    );
  }

  if (
    FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
      metadata.mimeType
    ) === -1
  ) {
    throw new Error(
      `Unsupported source MIME type "${metadata.mimeType}".`
    );
  }

  let temporaryFileId = '';
  let parsedItems = [];
  let extractionMethod = '';

  try {
    if (
      metadata.mimeType ===
      FMR_IMPORT_CONFIG.mimeTypes.PDF
    ) {
      extractionMethod =
        FMR_IMPORT_CONFIG.methods.PDF_TO_DOC_OCR;

      const result =
        extractFmrPdfText_(
          metadata
        );

      temporaryFileId =
        result.temporaryFileId;

      parsedItems = [
        {
          sheetName: '',
          parsed:
            parseKnownFmrText(
              result.text,
              {
                sourceFileId:
                  metadata.id,
                sourceFileName:
                  metadata.name,
                sourceFileUrl:
                  metadata.webViewLink ||
                  buildFmrImportFileUrl_(
                    metadata.id
                  ),
                allowFilenameFmrFallback:
                  true
              }
            )
        }
      ];
    } else if (
      metadata.mimeType ===
      FMR_IMPORT_CONFIG.mimeTypes.GOOGLE_SHEET
    ) {
      extractionMethod =
        FMR_IMPORT_CONFIG.methods.GOOGLE_SHEET;

      parsedItems =
        extractAllFmrSpreadsheetParses_(
          metadata.id,
          {
            sourceFileId:
              metadata.id,
            sourceFileName:
              metadata.name,
            sourceFileUrl:
              metadata.webViewLink ||
              buildFmrImportFileUrl_(
                metadata.id
              ),
            allowFilenameFmrFallback:
              true
          }
        );
    } else if (
      metadata.mimeType ===
      FMR_IMPORT_CONFIG.mimeTypes.XLSX
    ) {
      extractionMethod =
        FMR_IMPORT_CONFIG.methods.XLSX_TO_GOOGLE_SHEET;

      const result =
        extractFmrXlsxMatrices_(
          metadata
        );

      temporaryFileId =
        result.temporaryFileId;

      parsedItems =
        result.parsedItems;
    }

    parsedItems = (
      parsedItems || []
    )
      .map(function (item) {
        return {
          sheetName:
            normalizeFmrImportText_(
              item.sheetName
            ),
          parsed:
            normalizeParsedFmrImportResult_(
              item.parsed
            )
        };
      })
      .filter(function (item) {
        return (
          item.parsed &&
          (
            item.parsed.detectedTemplate ===
              FMR_IMPORT_CONFIG.templates
                .TURNER_FMR_V1 ||
            (
              item.parsed.materialLines &&
              item.parsed.materialLines.length > 0
            )
          )
        );
      });

    if (parsedItems.length === 0) {
      throw new Error(
        'The FMR source did not contain any readable FMR document or worksheet.'
      );
    }

    return {
      metadata,
      parsedItems,
      parsed:
        parsedItems.length === 1
          ? parsedItems[0].parsed
          : null,
      extractionMethod,
      selectedSheetName:
        parsedItems.length === 1
          ? parsedItems[0].sheetName
          : '',
      temporaryFileId,
      sourceContentHash:
        createFmrImportSourceContentHash_(
          metadata
        )
    };
  } finally {
    if (
      temporaryFileId &&
      FMR_IMPORT_CONFIG.defaults
        .deleteTemporaryConversions
    ) {
      trashFmrImportTemporaryFile_(
        temporaryFileId
      );
    }
  }
}

function extractFmrPdfText_(
  metadata
) {
  assertFmrImportAdvancedDrive_();

  const sourceFile = DriveApp.getFileById(
    metadata.id
  );
  const blob = sourceFile.getBlob();
  let temporary = null;

  try {
    temporary = Drive.Files.create(
      {
        name:
          `[TEMP FMR OCR] ${metadata.name}`,
        mimeType:
          FMR_IMPORT_SERVICE.googleMimeTypes.DOCUMENT
      },
      blob,
      {
        ocrLanguage:
          FMR_IMPORT_CONFIG.defaults.ocrLanguage,
        fields:
          'id,name,mimeType,trashed'
      }
    );

    const text = waitForFmrImportDocText_(
      temporary.id
    );

    if (!normalizeFmrImportText_(text)) {
      throw new Error(
        `PDF "${metadata.name}" converted successfully but produced no readable text.`
      );
    }

    return {
      text,
      temporaryFileId: temporary.id
    };
  } catch (error) {
    if (
      temporary &&
      temporary.id &&
      FMR_IMPORT_CONFIG.defaults.deleteTemporaryConversions
    ) {
      trashFmrImportTemporaryFile_(
        temporary.id
      );
    }

    throw error;
  }
}

function waitForFmrImportDocText_(
  googleDocId
) {
  const exportUrl =
    'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(googleDocId) +
    '/export?mimeType=' +
    encodeURIComponent('text/plain') +
    '&alt=media';

  let lastError = null;

  for (
    let attempt = 0;
    attempt < 6;
    attempt++
  ) {
    try {
      const response =
        UrlFetchApp.fetch(
          exportUrl,
          {
            method: 'get',
            headers: {
              Authorization:
                'Bearer ' +
                ScriptApp.getOAuthToken()
            },
            followRedirects: true,
            muteHttpExceptions: true
          }
        );

      const responseCode =
        response.getResponseCode();

      if (
        responseCode >= 200 &&
        responseCode < 300
      ) {
        const text =
          response.getContentText(
            'UTF-8'
          );

        if (
          normalizeFmrImportText_(text)
        ) {
          return text;
        }

        lastError = new Error(
          'The converted Google Doc exported successfully but contained no readable text.'
        );
      } else {
        const responseBody =
          normalizeFmrImportText_(
            response.getContentText(
              'UTF-8'
            )
          ).substring(0, 700);

        lastError = new Error(
          'Drive export returned HTTP ' +
          responseCode +
          (
            responseBody
              ? ': ' + responseBody
              : ''
          )
        );
      }
    } catch (error) {
      lastError = error;
    }

    Utilities.sleep(
      1000 + attempt * 500
    );
  }

  if (lastError) {
    throw new Error(
      'Unable to read converted FMR PDF text: ' +
      (
        lastError.message ||
        lastError
      )
    );
  }

  return '';
}

function extractFmrXlsxMatrices_(
  metadata
) {
  assertFmrImportAdvancedDrive_();

  const sourceFile =
    DriveApp.getFileById(
      metadata.id
    );

  const blob =
    sourceFile.getBlob();

  let temporary = null;

  try {
    temporary =
      Drive.Files.create(
        {
          name:
            `[TEMP FMR XLSX] ${metadata.name}`,
          mimeType:
            FMR_IMPORT_SERVICE
              .googleMimeTypes
              .SPREADSHEET
        },
        blob,
        {
          fields:
            'id,name,mimeType,trashed'
        }
      );

    const parsedItems =
      extractAllFmrSpreadsheetParses_(
        temporary.id,
        {
          sourceFileId:
            metadata.id,
          sourceFileName:
            metadata.name,
          sourceFileUrl:
            metadata.webViewLink ||
            buildFmrImportFileUrl_(
              metadata.id
            ),
          allowFilenameFmrFallback:
            true
        }
      );

    return {
      parsedItems,
      temporaryFileId:
        temporary.id
    };
  } catch (error) {
    if (
      temporary &&
      temporary.id &&
      FMR_IMPORT_CONFIG.defaults
        .deleteTemporaryConversions
    ) {
      trashFmrImportTemporaryFile_(
        temporary.id
      );
    }

    throw error;
  }
}

/*
 * Backward-compatible alias for callers that still use the singular name.
 */
function extractFmrXlsxMatrix_(
  metadata
) {
  const result =
    extractFmrXlsxMatrices_(
      metadata
    );

  return {
    parsedItems:
      result.parsedItems,
    parsed:
      result.parsedItems.length === 1
        ? result.parsedItems[0].parsed
        : null,
    sheetName:
      result.parsedItems.length === 1
        ? result.parsedItems[0].sheetName
        : '',
    temporaryFileId:
      result.temporaryFileId
  };
}

function extractAllFmrSpreadsheetParses_(
  spreadsheetId,
  context
) {
  let workbook = null;
  let lastError = null;

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    try {
      workbook =
        SpreadsheetApp.openById(
          spreadsheetId
        );
      break;
    } catch (error) {
      lastError = error;
      Utilities.sleep(
        750 + attempt * 500
      );
    }
  }

  if (!workbook) {
    throw new Error(
      `Unable to open converted FMR spreadsheet: ${
        lastError
          ? lastError.message || lastError
          : 'Unknown error'
      }`
    );
  }

  const candidates = [];

  workbook
    .getSheets()
    .forEach(function (sheet) {
      const lastRow =
        Math.min(
          Math.max(
            1,
            sheet.getLastRow()
          ),
          FMR_IMPORT_SERVICE
            .maximumSpreadsheetRows
        );

      const lastColumn =
        Math.min(
          Math.max(
            1,
            sheet.getLastColumn()
          ),
          FMR_IMPORT_SERVICE
            .maximumSpreadsheetColumns
        );

      const matrix =
        sheet
          .getRange(
            1,
            1,
            lastRow,
            lastColumn
          )
          .getDisplayValues();

      /*
       * Historical package workbooks use one completed FMR per worksheet.
       * The worksheet name is the authoritative provisional FMR identifier
       * when the visible FMR NO. field is blank.
       */
      const sheetContext =
        Object.assign(
          {},
          context || {},
          {
            sourceFileName:
              sheet.getName()
          }
        );

      const parsed =
        parseKnownFmrMatrix(
          matrix,
          sheetContext
        );

      parsed.selectedSheetName =
        sheet.getName();

      if (
        parsed.detectedTemplate !==
          FMR_IMPORT_CONFIG.templates
            .TURNER_FMR_V1 &&
        (
          !parsed.materialLines ||
          parsed.materialLines.length === 0
        )
      ) {
        return;
      }

      candidates.push({
        sheetName:
          sheet.getName(),
        parsed,
        score:
          scoreFmrSpreadsheetParse_(
            parsed
          )
      });
    });

  if (candidates.length === 0) {
    throw new Error(
      'The FMR spreadsheet has no readable FMR worksheets.'
    );
  }

  return candidates;
}

/*
 * Backward-compatible helper. A multi-FMR workbook returns its highest-scoring
 * worksheet, but the production import path now uses all worksheets.
 */
function extractBestFmrSpreadsheetParse_(
  spreadsheetId,
  context
) {
  const candidates =
    extractAllFmrSpreadsheetParses_(
      spreadsheetId,
      context
    );

  return candidates
    .slice()
    .sort(function (left, right) {
      return right.score - left.score;
    })[0];
}

function scoreFmrSpreadsheetParse_(
  parsed
) {
  const completeLines =
    (parsed.materialLines || []).filter(
      function (line) {
        return (
          line.commodityCode &&
          line.size &&
          line.quantity !== '' &&
          line.materialDescription
        );
      }
    ).length;

  return (
    (Number(parsed.confidencePct) || 0) *
      10000 +
    completeLines *
      1000 +
    (parsed.materialLines || []).length *
      100 +
    (parsed.header &&
    parsed.header.fmrNumber
      ? 10
      : 0) +
    (parsed.header &&
    parsed.header.iwpNumber
      ? 5
      : 0)
  );
}

/* ========================================================================== */
/* PARSE NORMALIZATION                                                        */
/* ========================================================================== */

function normalizeParsedFmrImportResult_(
  parsed
) {
  const result = parsed || {};

  result.header =
    result.header || {};
  result.materialLines =
    Array.isArray(result.materialLines)
      ? result.materialLines
      : [];
  result.warnings =
    Array.isArray(result.warnings)
      ? Array.from(
          new Set(
            result.warnings
              .map(normalizeFmrImportText_)
              .filter(Boolean)
          )
        )
      : [];
  result.errors =
    Array.isArray(result.errors)
      ? Array.from(
          new Set(
            result.errors
              .map(normalizeFmrImportText_)
              .filter(Boolean)
          )
        )
      : [];

  /*
   * Many historical files have a blank FMR NO. field and carry only a short
   * sequence such as (01) in the filename. A bare value such as "01" is not
   * globally unique across hundreds of IWPs and conflicts with the canonical
   * duplicate key. When the parser explicitly used a filename fallback,
   * synthesize a provisional traceable number from IWP + sequence. The user
   * must still verify it before submission.
   */
  if (
    result.warnings.indexOf(
      FMR_IMPORT_CONFIG.warningCodes.FMR_NUMBER_FROM_FILENAME
    ) !== -1 &&
    /^\d{1,3}$/.test(
      normalizeFmrImportText_(result.header.fmrNumber)
    ) &&
    normalizeFmrImportText_(result.header.iwpNumber)
  ) {
    result.header.fmrNumber =
      normalizeFmrImportText_(result.header.iwpNumber) +
      '(' +
      normalizeFmrImportText_(result.header.fmrNumber) +
      ')';

    if (
      result.warnings.indexOf(
        'fmr_number_synthesized_from_iwp_and_filename_sequence'
      ) === -1
    ) {
      result.warnings.push(
        'fmr_number_synthesized_from_iwp_and_filename_sequence'
      );
    }
  }

  result.materialLines =
    result.materialLines.map(
      function (line, index) {
        const normalized = Object.assign(
          {},
          line
        );

        normalized.fmrLineNumber =
          normalizeFmrImportText_(
            normalized.fmrLineNumber ||
            String(index + 1)
          );

        normalized.commodityCode =
          normalizeFmrImportText_(
            normalized.commodityCode
          );

        normalized.size =
          normalizeFmrImportText_(
            normalized.size
          );

        normalized.materialDescription =
          normalizeFmrImportText_(
            normalized.materialDescription
          );

        normalized.uom =
          normalizeFmrImportUpper_(
            normalized.uom ||
            FMR_IMPORT_CONFIG.defaults.defaultUom
          );

        /*
         * OCR sometimes returns a short material row as:
         *   commodity size quantity
         * followed by the wrapped description on the next line.
         *
         * The pure parser preserves the leading numeric token in the
         * description when there are exactly three tokens. Correct that
         * representation here without inventing a quantity.
         */
        if (
          (
            normalized.quantity === '' ||
            normalized.quantity === null ||
            normalized.quantity === undefined
          ) &&
          /^\d+(?:\.\d+)?(?:\s+|$)/.test(
            normalized.materialDescription
          )
        ) {
          const match =
            normalized.materialDescription.match(
              /^(\d+(?:\.\d+)?)(?:\s+([\s\S]*))?$/
            );

          if (match) {
            normalized.quantity =
              Number(match[1]);
            normalized.materialDescription =
              normalizeFmrImportText_(
                match[2] || ''
              );

            normalized.warnings =
              Array.from(
                new Set(
                  (
                    Array.isArray(
                      normalized.warnings
                    )
                      ? normalized.warnings
                      : []
                  )
                    .filter(function (warning) {
                      return (
                        warning !==
                        FMR_IMPORT_CONFIG.warningCodes.QUANTITY_MISSING
                      );
                    })
                    .concat([
                      'quantity_recovered_from_wrapped_ocr_row'
                    ])
                )
              );

            normalized.confidencePct =
              Math.min(
                100,
                (Number(normalized.confidencePct) || 70) + 30
              );
          }
        }

        if (
          (
            normalized.quantity === '' ||
            normalized.quantity === null ||
            normalized.quantity === undefined
          ) &&
          normalized.materialDescription &&
          normalized.commodityCode
        ) {
          const commodityFamily =
            normalizeFmrImportUpper_(
              normalized.commodityCode
            )
              .split('-')[0]
              .replace(/[^A-Z0-9]/g, '');

          const compactDescription =
            normalizeFmrImportText_(
              normalized.materialDescription
            );

          for (
            let prefixLength = 1;
            prefixLength <= 3;
            prefixLength++
          ) {
            const numericPrefix =
              compactDescription.substring(
                0,
                prefixLength
              );

            const remainder =
              compactDescription.substring(
                prefixLength
              );

            if (
              !/^\d+$/.test(numericPrefix) ||
              !remainder
            ) {
              continue;
            }

            if (
              commodityFamily &&
              normalizeFmrImportUpper_(
                remainder
              )
                .replace(/[^A-Z0-9]/g, '')
                .indexOf(commodityFamily) === 0
            ) {
              normalized.quantity =
                Number(numericPrefix);

              normalized.materialDescription =
                normalizeFmrImportText_(
                  remainder
                );

              normalized.warnings =
                Array.from(
                  new Set(
                    (
                      Array.isArray(
                        normalized.warnings
                      )
                        ? normalized.warnings
                        : []
                    )
                      .filter(function (warning) {
                        return (
                          warning !==
                          FMR_IMPORT_CONFIG.warningCodes
                            .QUANTITY_MISSING
                        );
                      })
                      .concat([
                        'quantity_recovered_from_concatenated_ocr_description'
                      ])
                  )
                );

              break;
            }
          }
        }

        if (
          normalized.quantity !== '' &&
          normalized.quantity !== null &&
          normalized.quantity !== undefined
        ) {
          const quantity =
            Number(normalized.quantity);

          normalized.quantity =
            Number.isFinite(quantity)
              ? quantity
              : '';
        }

        normalized.isPipe =
          /^\s*PIPE(?:\s|$)/i.test(
            normalized.materialDescription
          );

        return normalized;
      }
    );

  return result;
}

/* ========================================================================== */
/* FINALIZATION + STAGING                                                     */
/* ========================================================================== */

function finalizeFmrImportRecord_(
  spreadsheetId,
  actor,
  importId,
  extraction
) {
  const spreadsheet =
    SpreadsheetApp.openById(
      spreadsheetId
    );

  const lock =
    LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another FMR import is finalizing a source. Try again shortly.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(
      spreadsheetId
    );

    setupFmrImportQueueSheetUnlocked_(
      spreadsheet
    );

    const queueSheet =
      spreadsheet.getSheetByName(
        FMR_IMPORT_CONFIG.sheets.queue
      );

    const entrySheet =
      spreadsheet.getSheetByName(
        FMR_MANUAL_CONFIG.sheets.entry
      );

    const batchSheet =
      spreadsheet.getSheetByName(
        FMR_MANUAL_CONFIG.sheets.batches
      );

    const current =
      findFmrImportQueueById_(
        queueSheet,
        importId
      );

    if (!current) {
      throw new Error(
        `Import_ID "${importId}" was not found during finalization.`
      );
    }

    const queueRecord =
      normalizeFmrImportQueueRecord(
        current.record
      );

    if (
      queueRecord.Import_Status !==
      FMR_IMPORT_CONFIG.statuses.PROCESSING
    ) {
      throw new Error(
        `Import "${importId}" is ${queueRecord.Import_Status}, not PROCESSING.`
      );
    }

    const metadata =
      extraction.metadata;

    const parsedItems =
      (
        extraction.parsedItems &&
        extraction.parsedItems.length
          ? extraction.parsedItems
          : [
              {
                sheetName:
                  extraction.selectedSheetName || '',
                parsed:
                  extraction.parsed
              }
            ]
      )
        .map(function (item) {
          return {
            sheetName:
              normalizeFmrImportText_(
                item.sheetName
              ),
            parsed:
              normalizeParsedFmrImportResult_(
                item.parsed
              )
          };
        })
        .filter(function (item) {
          return (
            item.parsed &&
            item.parsed.materialLines
          );
        });

    const allWarnings =
      Array.from(
        new Set(
          parsedItems.reduce(
            function (warnings, item) {
              return warnings
                .concat(
                  item.parsed.warnings || []
                )
                .concat(
                  item.parsed.errors || []
                );
            },
            []
          ).filter(Boolean)
        )
      );

    const fmrNumbers =
      parsedItems
        .map(function (item) {
          return normalizeFmrImportText_(
            item.parsed.header.fmrNumber
          );
        })
        .filter(Boolean);

    const uniqueIwpNumbers =
      Array.from(
        new Set(
          parsedItems
            .map(function (item) {
              return normalizeFmrImportText_(
                item.parsed.header.iwpNumber
              );
            })
            .filter(Boolean)
        )
      );

    const totalMaterialLines =
      parsedItems.reduce(
        function (total, item) {
          return (
            total +
            item.parsed.materialLines.length
          );
        },
        0
      );

    const confidenceValues =
      parsedItems
        .map(function (item) {
          return Number(
            item.parsed.confidencePct
          ) || 0;
        });

    queueRecord.Source_File_ID =
      metadata.id;

    queueRecord.Source_File_Name =
      metadata.name;

    queueRecord.Source_File_URL =
      metadata.webViewLink ||
      buildFmrImportFileUrl_(
        metadata.id
      );

    queueRecord.Source_Mime_Type =
      metadata.mimeType;

    queueRecord.Source_Modified_At =
      parseFmrImportDate_(
        metadata.modifiedTime
      );

    queueRecord.Import_Method =
      extraction.extractionMethod;

    queueRecord.Detected_Template =
      parsedItems.length === 1
        ? (
            parsedItems[0].parsed
              .detectedTemplate ||
            FMR_IMPORT_CONFIG.templates.UNKNOWN
          )
        : 'MULTI_FMR_WORKBOOK';

    queueRecord.FMR_Number =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.fmrNumber
          )
        : `MULTI_FMR_WORKBOOK:${parsedItems.length}`;

    queueRecord.Revision =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.revision ||
            FMR_MANUAL_CONFIG.defaults
              .revision
          )
        : 'MULTI';

    queueRecord.IWP_Number =
      uniqueIwpNumbers.length === 1
        ? uniqueIwpNumbers[0]
        : (
            uniqueIwpNumbers.length > 1
              ? 'MULTI'
              : ''
          );

    queueRecord.ISO_Line_Number =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.isoLineNumber
          )
        : 'MULTI';

    queueRecord.ISO_Sheet =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.isoSheet
          )
        : '';

    queueRecord.ISO_Drawing_Number =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.isoDrawingNumber
          )
        : '';

    queueRecord.Requested_By =
      parsedItems.length === 1
        ? normalizeFmrImportText_(
            parsedItems[0].parsed
              .header.requestedBy
          )
        : '';

    queueRecord.Date_Required =
      parsedItems.length === 1
        ? parseFmrImportDate_(
            parsedItems[0].parsed
              .header.dateRequired
          )
        : '';

    queueRecord.Material_Line_Count =
      totalMaterialLines;

    queueRecord.Confidence_Pct =
      confidenceValues.length
        ? Math.min.apply(
            null,
            confidenceValues
          )
        : 0;

    queueRecord.Warnings =
      allWarnings.join(';');

    queueRecord.Error_Message = '';

    queueRecord.Source_Content_Hash =
      extraction.sourceContentHash ||
      queueRecord.Source_Content_Hash;

    queueRecord.Temporary_File_ID =
      extraction.temporaryFileId || '';

    queueRecord.Updated_At =
      new Date();

    queueRecord.Notes =
      appendFmrImportNote_(
        queueRecord.Notes,
        parsedItems.length === 1
          ? (
              parsedItems[0].sheetName
                ? `Parsed worksheet "${parsedItems[0].sheetName}".`
                : 'Parsed one FMR document.'
            )
          : (
              `Parsed ${parsedItems.length} FMR worksheets: ` +
              parsedItems
                .map(function (item) {
                  return (
                    `${item.sheetName || '(unnamed)'} => ` +
                    `${
                      item.parsed.header.fmrNumber ||
                      '(missing FMR number)'
                    }`
                  );
                })
                .join(', ') +
              '.'
            )
      );

    const invalidItems =
      parsedItems.filter(function (item) {
        return (
          !normalizeFmrImportText_(
            item.parsed.header.fmrNumber
          ) ||
          item.parsed.materialLines.length === 0
        );
      });

    if (invalidItems.length > 0) {
      queueRecord.Import_Status =
        FMR_IMPORT_CONFIG.statuses
          .NEEDS_MANUAL_ENTRY;

      queueRecord.Completed_At =
        new Date();

      queueRecord.Staged_Entry_Row_Count =
        0;

      queueRecord.Error_Message =
        'One or more FMR worksheets are missing a usable FMR number or material table: ' +
        invalidItems
          .map(function (item) {
            return (
              item.sheetName ||
              '(unnamed worksheet)'
            );
          })
          .join(', ');

      updateFmrImportQueueObjectRow_(
        queueSheet,
        current.rowNumber,
        queueRecord
      );

      SpreadsheetApp.flush();

      return buildMultiFmrImportSummary_(
        queueRecord,
        parsedItems,
        []
      );
    }

    const batch =
      findManualFmrBatchRecord_(
        batchSheet,
        queueRecord.Batch_ID
      );

    if (!batch) {
      throw new Error(
        `Batch "${queueRecord.Batch_ID}" was not found during staging.`
      );
    }

    const existingEntries =
      readManualFmrSheetObjectsWithRows_(
        entrySheet,
        FMR_MANUAL_CONFIG.entryHeaders
      );

    const sameSourceRows =
      existingEntries.filter(function (item) {
        return (
          normalizeManualFmrText_(
            item.record.Source_File_ID
          ) ===
            queueRecord.Source_File_ID &&
          !isManualFmrInactiveEntryStatus_(
            item.record.Entry_Status
          )
        );
      });

    if (sameSourceRows.length > 0) {
      queueRecord.Import_Status =
        FMR_IMPORT_CONFIG.statuses
          .SKIPPED_DUPLICATE;

      queueRecord.Completed_At =
        new Date();

      queueRecord.Staged_Entry_Row_Count =
        sameSourceRows.length;

      queueRecord.Error_Message =
        `The source file already has ${sameSourceRows.length} active staging row(s).`;

      updateFmrImportQueueObjectRow_(
        queueSheet,
        current.rowNumber,
        queueRecord
      );

      SpreadsheetApp.flush();

      return buildMultiFmrImportSummary_(
        queueRecord,
        parsedItems,
        fmrNumbers
      );
    }

    const duplicateFmrNumbers = [];

    const stageableItems =
      parsedItems.filter(function (item) {
        const fmrNumber =
          normalizeManualFmrUpper_(
            item.parsed.header.fmrNumber
          );

        const revision =
          normalizeManualFmrUpper_(
            item.parsed.header.revision ||
            FMR_MANUAL_CONFIG.defaults
              .revision
          );

        const duplicate =
          existingEntries.some(function (
            existingItem
          ) {
            return (
              normalizeManualFmrUpper_(
                existingItem.record
                  .FMR_Number
              ) === fmrNumber &&
              normalizeManualFmrUpper_(
                existingItem.record
                  .Revision
              ) === revision &&
              !isManualFmrInactiveEntryStatus_(
                existingItem.record
                  .Entry_Status
              )
            );
          });

        if (duplicate) {
          duplicateFmrNumbers.push(
            item.parsed.header.fmrNumber
          );
        }

        return !duplicate;
      });

    if (stageableItems.length === 0) {
      queueRecord.Import_Status =
        FMR_IMPORT_CONFIG.statuses
          .SKIPPED_DUPLICATE;

      queueRecord.Completed_At =
        new Date();

      queueRecord.Staged_Entry_Row_Count =
        0;

      queueRecord.Error_Message =
        'Every FMR represented by this source already has active staging rows.';

      queueRecord.Notes =
        appendFmrImportNote_(
          queueRecord.Notes,
          `Duplicate FMRs: ${
            duplicateFmrNumbers.join(', ')
          }.`
        );

      updateFmrImportQueueObjectRow_(
        queueSheet,
        current.rowNumber,
        queueRecord
      );

      SpreadsheetApp.flush();

      return buildMultiFmrImportSummary_(
        queueRecord,
        parsedItems,
        duplicateFmrNumbers
      );
    }

    const identity =
      getManualFmrReviewerIdentity_(
        spreadsheet,
        actor
      );

    const entryRows =
      stageableItems.reduce(
        function (rows, item) {
          return rows.concat(
            buildFmrImportStagingRows_(
              queueRecord,
              batch,
              item.parsed,
              actor,
              item.sheetName
            )
          );
        },
        []
      );

    prepareFmrImportEntryDestination_(
      entrySheet,
      entryRows.length
    );

    appendManualFmrObjects_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders,
      entryRows
    );

    queueRecord.Import_Status =
      FMR_IMPORT_CONFIG.statuses
        .STAGED_NEEDS_VERIFICATION;

    queueRecord.Completed_At =
      new Date();

    queueRecord.Staged_Entry_Row_Count =
      entryRows.length;

    queueRecord.Imported_By =
      actor;

    queueRecord.Updated_At =
      new Date();

    queueRecord.Notes =
      appendFmrImportNote_(
        queueRecord.Notes,
        `Populated DRAFT rows were staged for ${stageableItems.length} FMR(s). Human verification is required before validation and submission.`
      );

    if (duplicateFmrNumbers.length > 0) {
      queueRecord.Notes =
        appendFmrImportNote_(
          queueRecord.Notes,
          `Skipped duplicate FMRs: ${duplicateFmrNumbers.join(', ')}.`
        );
    }

    updateFmrImportQueueObjectRow_(
      queueSheet,
      current.rowNumber,
      queueRecord
    );

    recalculateManualFmrBatchMetrics_(
      spreadsheet,
      queueRecord.Batch_ID,
      actor
    );

    appendFmrImportAudit_(
      spreadsheet,
      identity,
      {
        entityType:
          'FMR_IMPORT',
        entityId:
          queueRecord.Import_ID,
        action:
          'STAGE_IMPORTED_FMR_WORKBOOK',
        newValue: {
          batchId:
            queueRecord.Batch_ID,
          sourceFileId:
            queueRecord.Source_File_ID,
          sourceFileName:
            queueRecord.Source_File_Name,
          detectedFmrCount:
            parsedItems.length,
          stagedFmrCount:
            stageableItems.length,
          fmrNumbers:
            stageableItems.map(
              function (item) {
                return item.parsed
                  .header.fmrNumber;
              }
            ),
          duplicateFmrNumbers,
          materialLines:
            entryRows.length,
          confidencePct:
            queueRecord.Confidence_Pct,
          warnings:
            allWarnings
        },
        correlationId:
          createFmrImportCorrelationId_()
      }
    );

    SpreadsheetApp.flush();

    return buildMultiFmrImportSummary_(
      queueRecord,
      parsedItems,
      duplicateFmrNumbers
    );
  } finally {
    lock.releaseLock();
  }
}

function buildFmrImportStagingRows_(
  queueRecord,
  batch,
  parsed,
  actor,
  sourceWorksheetName
) {
  const now =
    new Date();

  const reviewer =
    normalizeManualFmrEmail_(
      batch.Assigned_Reviewer
    );

  const worksheetName =
    normalizeFmrImportText_(
      sourceWorksheetName
    );

  const itemWarnings =
    Array.from(
      new Set(
        []
          .concat(
            parsed.warnings || []
          )
          .concat(
            parsed.errors || []
          )
          .filter(Boolean)
      )
    );

  const importNotes = [
    `Imported from ${queueRecord.Import_Method}.`,
    worksheetName
      ? `Source worksheet: ${worksheetName}.`
      : '',
    'Verify every field against the linked source FMR before validation.'
  ].filter(Boolean);

  if (itemWarnings.length > 0) {
    importNotes.push(
      `Import warnings: ${itemWarnings.join(';')}`
    );
  }

  const fmrNumber =
    normalizeFmrImportText_(
      parsed.header.fmrNumber
    );

  const revision =
    normalizeFmrImportText_(
      parsed.header.revision ||
      FMR_MANUAL_CONFIG.defaults
        .revision
    );

  const iwpNumber =
    normalizeFmrImportText_(
      parsed.header.iwpNumber
    );

  const sourceFileName =
    worksheetName
      ? (
          `${queueRecord.Source_File_Name} :: ` +
          worksheetName
        )
      : queueRecord.Source_File_Name;

  return parsed.materialLines.map(
    function (material, index) {
      let row =
        normalizeManualFmrEntryRow({
          Entry_Row_ID:
            createManualFmrEntryRowId_(),
          Batch_ID:
            queueRecord.Batch_ID,
          Source_Document_Type:
            FMR_MANUAL_CONFIG
              .sourceDocumentTypes.FMR,
          Source_File_ID:
            queueRecord.Source_File_ID,
          Source_File_Name:
            sourceFileName,
          Source_File_URL:
            queueRecord.Source_File_URL,
          FMR_Number:
            fmrNumber,
          Revision:
            revision,
          IWP_Number:
            iwpNumber,
          Request_Date:
            parseFmrImportDate_(
              parsed.header.requestDate
            ),
          Date_Required:
            parseFmrImportDate_(
              parsed.header.dateRequired
            ),
          Requested_By:
            normalizeFmrImportText_(
              parsed.header.requestedBy
            ),
          Requested_By_Email:
            normalizeManualFmrEmail_(
              parsed.header
                .requestedByEmail
            ),
          Craft:
            normalizeFmrImportText_(
              parsed.header.craft
            ) ||
            FMR_MANUAL_CONFIG.defaults
              .craft,
          Deliver_To:
            normalizeFmrImportText_(
              parsed.header.deliverTo
            ) ||
            FMR_MANUAL_CONFIG.defaults
              .deliverTo,
          Destination:
            normalizeFmrImportText_(
              parsed.header.destination
            ) ||
            FMR_MANUAL_CONFIG.defaults
              .destination,
          Warehouse:
            normalizeFmrImportText_(
              parsed.header.warehouse
            ) ||
            FMR_MANUAL_CONFIG.defaults
              .warehouse,
          Priority:
            FMR_MANUAL_CONFIG.defaults
              .priority,
          ISO_Line_Number:
            normalizeFmrImportText_(
              parsed.header.isoLineNumber
            ),
          ISO_Sheet:
            normalizeFmrImportText_(
              parsed.header.isoSheet
            ),
          ISO_Drawing_Number:
            normalizeFmrImportText_(
              parsed.header
                .isoDrawingNumber
            ),
          FMR_Line_Number:
            normalizeFmrImportText_(
              material.fmrLineNumber ||
              String(index + 1)
            ),
          Commodity_Code:
            normalizeFmrImportText_(
              material.commodityCode
            ),
          Size:
            normalizeFmrImportText_(
              material.size
            ),
          Material_Description:
            normalizeFmrImportText_(
              material
                .materialDescription
            ),
          UOM:
            normalizeFmrImportUpper_(
              material.uom ||
              FMR_IMPORT_CONFIG.defaults
                .defaultUom
            ),
          Qty_Requested:
            material.quantity ===
                undefined ||
            material.quantity === null
              ? ''
              : material.quantity,
          Is_Pipe:
            Boolean(
              material.isPipe
            ),
          Entry_Method:
            queueRecord.Import_Method ===
              FMR_IMPORT_CONFIG.methods
                .PDF_TO_DOC_OCR
              ? FMR_MANUAL_CONFIG
                  .entryMethods.OCR
              : FMR_MANUAL_CONFIG
                  .entryMethods.CSV_IMPORT,
          Entry_Status:
            FMR_MANUAL_CONFIG
              .entryStatuses.DRAFT,
          Entered_By:
            actor,
          Entered_At:
            now,
          Reviewer_Email:
            reviewer,
          Reviewed_At:
            '',
          Review_Notes:
            importNotes.join(' '),
          Validation_Errors:
            '',
          Row_Content_Hash:
            ''
        });

      const validation =
        validateManualFmrEntryRow(
          row
        );

      row =
        validation.normalized;

      row.Validation_Errors =
        validation.errors.join(';');

      row.Review_Notes =
        appendFmrImportNote_(
          row.Review_Notes,
          material.warnings &&
          material.warnings.length
            ? `Line warnings: ${material.warnings.join(';')}`
            : ''
        );

      row.Row_Content_Hash =
        hashManualFmrEntryRow_(
          row
        );

      return row;
    }
  );
}

function buildMultiFmrImportSummary_(
  queueRecord,
  parsedItems,
  duplicateFmrNumbers
) {
  const summary =
    summarizeFmrImportResult_(
      queueRecord
    );

  summary.fmrCount =
    parsedItems.length;

  summary.fmrNumbers =
    parsedItems.map(function (item) {
      return item.parsed
        .header.fmrNumber;
    });

  summary.duplicateFmrNumbers =
    duplicateFmrNumbers || [];

  return summary;
}

function prepareFmrImportEntryDestination_(
  entrySheet,
  rowCount
) {
  if (!entrySheet || rowCount <= 0) {
    return;
  }

  const startRow =
    entrySheet.getLastRow() + 1;

  const requiredLastRow =
    startRow + rowCount - 1;

  if (
    entrySheet.getMaxRows() <
    requiredLastRow
  ) {
    entrySheet.insertRowsAfter(
      entrySheet.getMaxRows(),
      requiredLastRow -
        entrySheet.getMaxRows()
    );
  }

  const textHeaders = [
    'Entry_Row_ID',
    'Batch_ID',
    'Source_Document_Type',
    'Source_File_ID',
    'Source_File_Name',
    'Source_File_URL',
    'FMR_Number',
    'Revision',
    'IWP_Number',
    'Requested_By_Email',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'FMR_Line_Number',
    'Commodity_Code',
    'Size',
    'UOM',
    'Entry_Method',
    'Entry_Status',
    'Entered_By',
    'Reviewer_Email',
    'Row_Content_Hash'
  ];

  textHeaders.forEach(function (header) {
    const column =
      FMR_MANUAL_CONFIG.entryHeaders.indexOf(
        header
      ) + 1;

    if (column <= 0) {
      return;
    }

    entrySheet
      .getRange(
        startRow,
        column,
        rowCount,
        1
      )
      .setNumberFormat('@');
  });
}

/* ========================================================================== */
/* FAILURE HANDLING                                                           */
/* ========================================================================== */

function failFmrImportRecord_(
  spreadsheetId,
  actor,
  importId,
  error,
  extraction
) {
  const spreadsheet = SpreadsheetApp.openById(
    spreadsheetId
  );
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    return {
      importId,
      status: FMR_IMPORT_CONFIG.statuses.FAILED,
      error:
        error && error.message
          ? error.message
          : String(error),
      queueUpdateFailed: true
    };
  }

  try {
    const queueSheet = spreadsheet.getSheetByName(
      FMR_IMPORT_CONFIG.sheets.queue
    );

    if (!queueSheet) {
      return {
        importId,
        status:
          FMR_IMPORT_CONFIG.statuses.FAILED,
        error:
          error && error.message
            ? error.message
            : String(error),
        queueUpdateFailed: true
      };
    }

    const current = findFmrImportQueueById_(
      queueSheet,
      importId
    );

    if (!current) {
      return {
        importId,
        status:
          FMR_IMPORT_CONFIG.statuses.FAILED,
        error:
          error && error.message
            ? error.message
            : String(error),
        queueUpdateFailed: true
      };
    }

    const record =
      normalizeFmrImportQueueRecord(
        current.record
      );

    record.Import_Status =
      FMR_IMPORT_CONFIG.statuses.FAILED;
    record.Error_Message =
      error && error.message
        ? error.message
        : String(error);
    record.Completed_At =
      new Date();
    record.Imported_By =
      actor;
    record.Updated_At =
      new Date();

    if (
      extraction &&
      extraction.temporaryFileId
    ) {
      record.Temporary_File_ID =
        extraction.temporaryFileId;
    }

    updateFmrImportQueueObjectRow_(
      queueSheet,
      current.rowNumber,
      record
    );

    SpreadsheetApp.flush();

    return summarizeFmrImportResult_(
      record
    );
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* DRIVE HELPERS                                                              */
/* ========================================================================== */

function assertFmrImportAdvancedDrive_() {
  if (
    typeof Drive === 'undefined' ||
    !Drive.Files ||
    typeof Drive.Files.create !== 'function'
  ) {
    throw new Error(
      'Google Drive advanced service v3 is required. Enable it with identifier Drive.'
    );
  }
}

function getFmrImportDriveMetadata_(
  fileId
) {
  assertFmrImportAdvancedDrive_();

  try {
    return Drive.Files.get(
      fileId,
      {
        fields:
          'id,name,mimeType,modifiedTime,createdTime,md5Checksum,size,webViewLink,trashed,parents,driveId',
        supportsAllDrives: true
      }
    );
  } catch (error) {
    throw new Error(
      `Unable to access Drive item "${fileId}": ${
        error.message || error
      }`
    );
  }
}

function listDirectFmrImportFiles_(
  folderId,
  maximumFiles
) {
  assertFmrImportAdvancedDrive_();

  const files = [];
  let pageToken = null;

  do {
    const listOptions = {
      q:
        `'${folderId}' in parents and trashed = false`,
      pageSize:
        Math.min(
          100,
          maximumFiles - files.length
        ),
      fields:
        'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,md5Checksum,size,webViewLink,trashed,parents,driveId)',
      orderBy:
        'name',
      includeItemsFromAllDrives:
        true,
      supportsAllDrives:
        true
    };

    if (pageToken) {
      listOptions.pageToken = pageToken;
    }

    const response = Drive.Files.list(
      listOptions
    );

    (response.files || []).forEach(
      function (file) {
        files.push(file);
      }
    );

    pageToken =
      response.nextPageToken || null;
  } while (
    pageToken &&
    files.length < maximumFiles
  );

  return files.slice(0, maximumFiles);
}

function getFmrImportMethodForMimeType_(
  mimeType
) {
  if (
    mimeType ===
    FMR_IMPORT_CONFIG.mimeTypes.PDF
  ) {
    return FMR_IMPORT_CONFIG.methods.PDF_TO_DOC_OCR;
  }

  if (
    mimeType ===
    FMR_IMPORT_CONFIG.mimeTypes.GOOGLE_SHEET
  ) {
    return FMR_IMPORT_CONFIG.methods.GOOGLE_SHEET;
  }

  if (
    mimeType ===
    FMR_IMPORT_CONFIG.mimeTypes.XLSX
  ) {
    return FMR_IMPORT_CONFIG.methods.XLSX_TO_GOOGLE_SHEET;
  }

  return '';
}

function trashFmrImportTemporaryFile_(
  fileId
) {
  try {
    DriveApp
      .getFileById(fileId)
      .setTrashed(true);
  } catch (error) {
    console.warn(
      `Unable to trash temporary import file "${fileId}": ${
        error.message || error
      }`
    );
  }
}

function createFmrImportSourceContentHash_(
  metadata
) {
  if (
    metadata &&
    metadata.md5Checksum
  ) {
    return metadata.md5Checksum;
  }

  return hashFmrImportText_(
    [
      metadata.id || '',
      metadata.name || '',
      metadata.mimeType || '',
      metadata.modifiedTime || '',
      metadata.size || ''
    ].join('|')
  );
}

function createFmrImportSourceMetadataHash_(
  metadata
) {
  return hashFmrImportText_(
    [
      metadata.id || '',
      metadata.name || '',
      metadata.mimeType || '',
      metadata.modifiedTime || '',
      metadata.md5Checksum || '',
      metadata.size || ''
    ].join('|')
  );
}

function buildFmrImportFileUrl_(
  fileId
) {
  return (
    'https://drive.google.com/open?id=' +
    encodeURIComponent(fileId)
  );
}

/* ========================================================================== */
/* QUEUE READ / WRITE                                                         */
/* ========================================================================== */

function readFmrImportQueueObjectsWithRows_(
  sheet
) {
  if (
    !sheet ||
    sheet.getLastRow() <= 1
  ) {
    return [];
  }

  const headers =
    Array.from(
      FMR_IMPORT_CONFIG.queueHeaders
    );

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
    const importId =
      normalizeFmrImportText_(row[0]);

    /*
     * Primary-ID filtering prevents formatted/checkbox-only blank rows from
     * being treated as queue records.
     */
    if (!importId) {
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

function appendFmrImportQueueObjects_(
  sheet,
  objects
) {
  if (!objects || objects.length === 0) {
    return 0;
  }

  const values = objects.map(
    function (object) {
      return FMR_IMPORT_CONFIG.queueHeaders.map(
        function (header) {
          return protectManualFmrCellValue_(
            object[header]
          );
        }
      );
    }
  );

  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      values.length,
      FMR_IMPORT_CONFIG.queueHeaders.length
    )
    .setValues(values);

  return values.length;
}

function updateFmrImportQueueObjectRow_(
  sheet,
  rowNumber,
  object
) {
  const normalized =
    normalizeFmrImportQueueRecord(
      object
    );

  sheet
    .getRange(
      rowNumber,
      1,
      1,
      FMR_IMPORT_CONFIG.queueHeaders.length
    )
    .setValues([
      FMR_IMPORT_CONFIG.queueHeaders.map(
        function (header) {
          return protectManualFmrCellValue_(
            normalized[header]
          );
        }
      )
    ]);
}

function findFmrImportQueueById_(
  queueSheet,
  importId
) {
  const normalizedId =
    normalizeFmrImportText_(importId);

  return (
    readFmrImportQueueObjectsWithRows_(
      queueSheet
    ).find(function (item) {
      return (
        normalizeFmrImportText_(
          item.record.Import_ID
        ) === normalizedId
      );
    }) || null
  );
}

function findFmrImportQueueBySource_(
  queueSheet,
  batchId,
  sourceFileId
) {
  const key =
    buildFmrImportSourceKey_(
      batchId,
      sourceFileId
    );

  return (
    readFmrImportQueueObjectsWithRows_(
      queueSheet
    ).find(function (item) {
      return (
        buildFmrImportSourceKey_(
          item.record.Batch_ID,
          item.record.Source_File_ID
        ) === key
      );
    }) || null
  );
}

function buildFmrImportSourceKey_(
  batchId,
  sourceFileId
) {
  const normalizedBatchId =
    normalizeFmrImportText_(batchId);
  const normalizedFileId =
    normalizeFmrImportText_(sourceFileId);

  if (
    !normalizedBatchId ||
    !normalizedFileId
  ) {
    return '';
  }

  return (
    normalizeFmrImportUpper_(
      normalizedBatchId
    ) +
    '|' +
    normalizedFileId
  );
}

/* ========================================================================== */
/* QUEUE SHEET FORMATTING                                                     */
/* ========================================================================== */

function ensureFmrImportSheetSize_(
  sheet,
  minimumRows,
  minimumColumns
) {
  if (sheet.getMaxRows() < minimumRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      minimumRows - sheet.getMaxRows()
    );
  }

  if (
    sheet.getMaxColumns() <
    minimumColumns
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      minimumColumns -
        sheet.getMaxColumns()
    );
  }
}

function assertFmrImportHeaders_(
  sheet,
  expectedHeaders
) {
  const actual = sheet
    .getRange(
      1,
      1,
      1,
      expectedHeaders.length
    )
    .getDisplayValues()[0]
    .map(normalizeFmrImportText_);

  const differences = [];

  expectedHeaders.forEach(
    function (header, index) {
      if (actual[index] !== header) {
        differences.push(
          `${columnNumberToFmrImportLetter_(
            index + 1
          )}1 expected "${header}", found "${actual[index] || '(blank)'}"`
        );
      }
    }
  );

  if (differences.length > 0) {
    throw new Error(
      `Header mismatch on "${sheet.getName()}":\n` +
      differences.join('\n')
    );
  }

  return true;
}

function formatFmrImportQueueSheet_(
  sheet
) {
  const headers =
    Array.from(
      FMR_IMPORT_CONFIG.queueHeaders
    );

  sheet.setFrozenRows(1);

  const headerRange = sheet.getRange(
    1,
    1,
    1,
    headers.length
  );

  headerRange
    .setFontWeight('bold')
    .setWrap(true)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  headers.forEach(function (header, index) {
    const width =
      FMR_IMPORT_SERVICE.queueWidths[header];

    if (width) {
      sheet.setColumnWidth(
        index + 1,
        width
      );
    }
  });

  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  sheet
    .getRange(
      1,
      1,
      Math.max(2, sheet.getLastRow()),
      headers.length
    )
    .createFilter();

  const statusColumn =
    headers.indexOf('Import_Status') + 1;

  const statusValidation =
    SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        getFmrImportStatusOptions(),
        true
      )
      .setAllowInvalid(false)
      .build();

  sheet
    .getRange(
      2,
      statusColumn,
      Math.max(1, sheet.getMaxRows() - 1),
      1
    )
    .setDataValidation(
      statusValidation
    );

  [
    'Source_Modified_At',
    'Date_Required',
    'Started_At',
    'Completed_At',
    'Updated_At'
  ].forEach(function (header) {
    const column =
      headers.indexOf(header) + 1;

    if (column > 0) {
      sheet
        .getRange(
          2,
          column,
          Math.max(1, sheet.getMaxRows() - 1),
          1
        )
        .setNumberFormat(
          header === 'Date_Required'
            ? 'yyyy-mm-dd'
            : 'yyyy-mm-dd hh:mm:ss'
        );
    }
  });

  const confidenceColumn =
    headers.indexOf('Confidence_Pct') + 1;

  sheet
    .getRange(
      2,
      confidenceColumn,
      Math.max(1, sheet.getMaxRows() - 1),
      1
    )
    .setNumberFormat('0.0');

  sheet
    .getRange(
      2,
      1,
      Math.max(1, sheet.getMaxRows() - 1),
      headers.length
    )
    .setVerticalAlignment('top');
}

/* ========================================================================== */
/* AUDIT                                                                      */
/* ========================================================================== */

function appendFmrImportAudit_(
  spreadsheet,
  identity,
  event
) {
  const auditSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.auditLog
  );

  if (!auditSheet) {
    throw new Error(
      `Required audit sheet "${FMR_MANUAL_CONFIG.sheets.auditLog}" is missing.`
    );
  }

  const record = {
    Audit_ID:
      createManualFmrAuditId_(),
    Entity_Type:
      event.entityType,
    Entity_ID:
      event.entityId,
    Action:
      event.action,
    Field_Name:
      event.fieldName || '',
    Old_Value:
      serializeManualFmrAuditValue_(
        event.oldValue
      ),
    New_Value:
      serializeManualFmrAuditValue_(
        event.newValue
      ),
    User_Email:
      identity.Email,
    User_Name:
      identity.Display_Name,
    Timestamp:
      new Date(),
    Source_Interface:
      FMR_IMPORT_SERVICE.sourceInterface,
    Correlation_ID:
      event.correlationId ||
      createFmrImportCorrelationId_()
  };

  appendManualFmrObjects_(
    auditSheet,
    FMR_MANUAL_REVIEW_SUPPORT.auditHeaders,
    [record]
  );

  return record;
}

/* ========================================================================== */
/* GENERAL HELPERS                                                            */
/* ========================================================================== */

function summarizeFmrImportResult_(
  record
) {
  const normalized =
    normalizeFmrImportQueueRecord(
      record
    );

  return {
    importId:
      normalized.Import_ID,
    batchId:
      normalized.Batch_ID,
    sourceFileId:
      normalized.Source_File_ID,
    sourceFileName:
      normalized.Source_File_Name,
    status:
      normalized.Import_Status,
    fmrNumber:
      normalized.FMR_Number,
    revision:
      normalized.Revision,
    iwpNumber:
      normalized.IWP_Number,
    materialLineCount:
      normalized.Material_Line_Count,
    stagedEntryRowCount:
      normalized.Staged_Entry_Row_Count,
    confidencePct:
      normalized.Confidence_Pct,
    warnings:
      normalized.Warnings,
    error:
      normalized.Error_Message
  };
}

function normalizeFmrImportIds_(
  importIds
) {
  const values =
    Array.isArray(importIds)
      ? importIds
      : normalizeFmrImportText_(
          importIds
        ).split(/[\n,;]+/);

  return Array.from(
    new Set(
      values
        .map(normalizeFmrImportText_)
        .filter(Boolean)
    )
  );
}

function createFmrImportId_() {
  return `FMRIMPORT-${Utilities.getUuid()}`;
}

function createFmrImportCorrelationId_() {
  return `FMR-IMPORT-${Utilities.getUuid()}`;
}

function appendFmrImportNote_(
  existing,
  note
) {
  const left =
    normalizeFmrImportText_(existing);
  const right =
    normalizeFmrImportText_(note);

  if (!right) {
    return left;
  }

  if (!left) {
    return right;
  }

  return `${left} ${right}`;
}

function parseFmrImportDate_(
  value
) {
  if (!value) {
    return '';
  }

  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return new Date(
      value.getTime()
    );
  }

  const text =
    normalizeFmrImportText_(value);

  if (!text) {
    return '';
  }

  let match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/
  );

  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12,
      0,
      0
    );

    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  match = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/
  );

  if (match) {
    const year =
      Number(match[3]) < 100
        ? 2000 + Number(match[3])
        : Number(match[3]);

    const date = new Date(
      year,
      Number(match[1]) - 1,
      Number(match[2]),
      12,
      0,
      0
    );

    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  const parsed = new Date(text);

  return isNaN(parsed.getTime())
    ? ''
    : parsed;
}

function hashFmrImportText_(
  value
) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function (byte) {
      const normalized =
        (byte + 256) % 256;

      return (
        `0${normalized.toString(16)}`
      ).slice(-2);
    })
    .join('');
}

function columnNumberToFmrImportLetter_(
  column
) {
  let value = column;
  let output = '';

  while (value > 0) {
    const remainder =
      (value - 1) % 26;

    output =
      String.fromCharCode(
        65 + remainder
      ) +
      output;

    value =
      Math.floor(
        (value - 1) / 26
      );
  }

  return output;
}
