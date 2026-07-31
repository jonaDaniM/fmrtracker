/**
 * Phase4_VisionJobController.gs
 *
 * BOUND SPREADSHEET PROJECT ONLY.
 *
 * Replaces the old Phase4_VisionJobService.gs that was previously placed in
 * FMRCore. This controller owns Drive discovery, Cloud Storage uploads,
 * asynchronous Cloud Vision jobs, triggers, run state, and job summaries.
 *
 * Coordinate parsing and material validation remain in FMRCore.
 *
 * Required bound-project file:
 * - Phase4_VisionRuntimeConfig.gs
 *   Must expose phase4VisionGetRuntimeConfig_().
 *
 * Required FMRCore public functions:
 * - getVisionRequiredScopes()
 * - getVisionDefaultPipeMode()
 * - normalizeVisionPipeMode(mode)
 * - getVisionSheetNames()
 * - getVisionHeaderDefinitions()
 * - setupVisionExtractionSheets(spreadsheetId)
 * - parseVisionIsoPage(context, response)
 * - appendVisionExtractionResults(spreadsheetId, records, reviews)
 * - getVisionExtractionSheetStatus(spreadsheetId)
 */

const PHASE4_VISION_CONTROLLER = Object.freeze({
  activeRunProperty: 'FMR_VISION_ACTIVE_RUN_STATE',
  triggerProperty: 'FMR_VISION_CONTINUATION_TRIGGER_ID',
  triggerHandler: 'phase4VisionContinueJobs',

  documentTypes: Object.freeze({
    ISO: 'ISO',
    FMR: 'FMR'
  }),

  jobStatuses: Object.freeze({
    PENDING_UPLOAD: 'PENDING_UPLOAD',
    SUBMITTED: 'SUBMITTED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
  }),

  runStatuses: Object.freeze({
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
    FAILED: 'FAILED'
  }),

  defaults: Object.freeze({
    maximumFilesPerStart: 25,
    batchSize: 20,
    pollingMinutes: 1,
    inputPrefix: 'fmr-vision/input',
    outputPrefix: 'fmr-vision/output',
    cleanupCloudObjects: false,
    operationOutputGracePolls: 3,
    maximumMessageLength: 4000
  })
});

/* ========================================================================== */
/* PUBLIC ENTRY POINTS                                                        */
/* ========================================================================== */

/**
 * Starts one asynchronous extraction run.
 *
 * @param {string} spreadsheetId
 * @param {string=} driveFolderId
 * @param {{
 *   sourceDocumentType:(string|undefined),
 *   maximumFiles:(number|undefined),
 *   pipeMode:(string|undefined),
 *   iwpNumber:(string|undefined)
 * }=} options
 * @return {Object}
 */
function phase4VisionStartExtractionRun(
  spreadsheetId,
  driveFolderId,
  options
) {
  const lock = phase4VisionGetControllerLock_();

  if (!lock.tryLock(30000)) {
    throw new Error('Another Vision controller action is already running.');
  }

  try {
    const existingRun = phase4VisionReadActiveRunState_();

    if (existingRun && existingRun.runId) {
      throw new Error(
        `Vision run ${existingRun.runId} is still active. ` +
        'Complete or cancel it before starting another run.'
      );
    }

    const spreadsheetKey =
      phase4VisionNormalizeSpreadsheetId_(spreadsheetId);
    const settings = options || {};
    const runtime = phase4VisionNormalizeRuntimeConfig_(
      phase4VisionGetRuntimeConfig_()
    );

    const folderId = phase4VisionNormalizeDriveFolderId_(
      driveFolderId || runtime.folderId
    );
    const documentType = phase4VisionNormalizeDocumentType_(
      settings.sourceDocumentType ||
      runtime.sourceDocumentType ||
      PHASE4_VISION_CONTROLLER.documentTypes.ISO
    );
    const maximumFiles = phase4VisionPositiveInteger_(
      settings.maximumFiles || runtime.maximumFilesPerStart,
      PHASE4_VISION_CONTROLLER.defaults.maximumFilesPerStart,
      1,
      250
    );
    const pipeMode = FMRCore.normalizeVisionPipeMode(
      settings.pipeMode ||
      runtime.pipeMode ||
      FMRCore.getVisionDefaultPipeMode()
    );
    const iwpNumber = String(settings.iwpNumber || '').trim();

    phase4VisionValidateRuntime_(runtime, folderId);

    ScriptApp.requireScopes(
      ScriptApp.AuthMode.FULL,
      FMRCore.getVisionRequiredScopes()
    );

    FMRCore.setupVisionExtractionSheets(spreadsheetKey);

    const runId = phase4VisionCreateRunId_();
    const files = phase4VisionListPdfFiles_(folderId, maximumFiles);
    const jobs = [];
    let submittedFiles = 0;
    let failedFiles = 0;

    files.forEach(file => {
      const job = {
        run_id: runId,
        source_file_id: file.getId(),
        source_pdf: file.getName(),
        source_document_type: documentType,
        gcs_input_uri: '',
        gcs_output_uri: '',
        vision_operation_name: '',
        status: PHASE4_VISION_CONTROLLER.jobStatuses.PENDING_UPLOAD,
        submitted_at: new Date(),
        completed_at: '',
        message: ''
      };

      try {
        const inputObject = phase4VisionJoinObjectPath_(
          runtime.inputPrefix,
          phase4VisionCreateObjectName_(
            runId,
            file.getId(),
            file.getName()
          )
        );
        const outputObject = phase4VisionJoinObjectPath_(
          runtime.outputPrefix,
          runId,
          file.getId()
        ) + '/';

        phase4VisionUploadPdf_(
          runtime,
          inputObject,
          file.getBlob()
        );

        job.gcs_input_uri =
          `gs://${runtime.bucket}/${inputObject}`;
        job.gcs_output_uri =
          `gs://${runtime.bucket}/${outputObject}`;
        job.vision_operation_name =
          phase4VisionSubmitPdf_(
            runtime,
            job.gcs_input_uri,
            job.gcs_output_uri
          );
        job.status =
          PHASE4_VISION_CONTROLLER.jobStatuses.SUBMITTED;
        submittedFiles++;
      } catch (error) {
        job.status =
          PHASE4_VISION_CONTROLLER.jobStatuses.FAILED;
        job.completed_at = new Date();
        job.message = phase4VisionLimitMessage_(
          error.message || String(error)
        );
        failedFiles++;
      }

      jobs.push(job);
    });

    phase4VisionWriteJobs_(spreadsheetKey, jobs);

    phase4VisionWriteRunSummary_(spreadsheetKey, {
      run_id: runId,
      started_at: new Date(),
      completed_at: submittedFiles ? '' : new Date(),
      source_document_type: documentType,
      pipe_mode: pipeMode,
      source_files: files.length,
      pages_seen: 0,
      iso_pages: 0,
      accepted_rows: 0,
      quarantined_rows: 0,
      pipe_rows: 0,
      duplicate_rows: 0,
      status: submittedFiles
        ? PHASE4_VISION_CONTROLLER.runStatuses.RUNNING
        : PHASE4_VISION_CONTROLLER.runStatuses.FAILED,
      message: failedFiles
        ? `${failedFiles} file(s) failed during submission.`
        : ''
    });

    if (submittedFiles) {
      phase4VisionWriteActiveRunState_({
        runId,
        spreadsheetId: spreadsheetKey,
        sourceDocumentType: documentType,
        pipeMode,
        iwpNumber,
        startedAt: new Date().toISOString(),
        outputGracePollCounts: {}
      });

      phase4VisionEnsureTrigger_(runtime.pollingMinutes);
    }

    return {
      runId,
      sourceDocumentType: documentType,
      discoveredFiles: files.length,
      submittedFiles,
      failedFiles,
      pipeMode,
      active: submittedFiles > 0
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Installable trigger handler and manual continuation function.
 *
 * @return {Object}
 */
function phase4VisionContinueJobs() {
  const lock = phase4VisionGetControllerLock_();

  if (!lock.tryLock(30000)) {
    return phase4VisionControllerResult_(
      true,
      '',
      'Another Vision continuation is already running.'
    );
  }

  try {
    const activeRun = phase4VisionReadActiveRunState_();

    if (!activeRun || !activeRun.runId || !activeRun.spreadsheetId) {
      phase4VisionRemoveTrigger_();
      return phase4VisionControllerResult_(
        false,
        '',
        'No active Vision extraction run.'
      );
    }

    const runtime = phase4VisionNormalizeRuntimeConfig_(
      phase4VisionGetRuntimeConfig_()
    );

    phase4VisionValidateRuntime_(runtime, '', { folderOptional: true });

    const pending = phase4VisionReadJobs_(
      activeRun.spreadsheetId,
      activeRun.runId
    ).filter(job =>
      job.status === PHASE4_VISION_CONTROLLER.jobStatuses.SUBMITTED ||
      job.status === PHASE4_VISION_CONTROLLER.jobStatuses.RUNNING
    );

    const totals = {
      completed: 0,
      failed: 0,
      pagesSeen: 0,
      isoPages: 0,
      acceptedRows: 0,
      quarantinedRows: 0,
      pipeRows: 0,
      duplicateRows: 0
    };

    pending.forEach(job => {
      phase4VisionProcessPendingJob_(
        runtime,
        activeRun,
        job,
        totals
      );
    });

    phase4VisionWriteActiveRunState_(activeRun);

    const refreshedJobs = phase4VisionReadJobs_(
      activeRun.spreadsheetId,
      activeRun.runId
    );
    const remaining = refreshedJobs.filter(job =>
      job.status === PHASE4_VISION_CONTROLLER.jobStatuses.SUBMITTED ||
      job.status === PHASE4_VISION_CONTROLLER.jobStatuses.RUNNING
    ).length;
    const totalFailed = refreshedJobs.filter(job =>
      job.status === PHASE4_VISION_CONTROLLER.jobStatuses.FAILED
    ).length;

    const runStatus = remaining
      ? PHASE4_VISION_CONTROLLER.runStatuses.RUNNING
      : totalFailed
        ? PHASE4_VISION_CONTROLLER.runStatuses.COMPLETED_WITH_ERRORS
        : PHASE4_VISION_CONTROLLER.runStatuses.COMPLETED;

    phase4VisionIncrementRunSummary_(
      activeRun.spreadsheetId,
      activeRun.runId,
      {
        pages_seen: totals.pagesSeen,
        iso_pages: totals.isoPages,
        accepted_rows: totals.acceptedRows,
        quarantined_rows: totals.quarantinedRows,
        pipe_rows: totals.pipeRows,
        duplicate_rows: totals.duplicateRows,
        status: runStatus,
        completed_at: remaining ? '' : new Date(),
        message:
          !remaining && totalFailed
            ? `${totalFailed} job(s) failed.`
            : ''
      }
    );

    if (!remaining) {
      phase4VisionClearActiveRunState_();
      phase4VisionRemoveTrigger_();
    }

    return {
      active: remaining > 0,
      runId: activeRun.runId,
      completed: totals.completed,
      failed: totals.failed,
      remaining,
      pagesSeen: totals.pagesSeen,
      acceptedRows: totals.acceptedRows,
      quarantinedRows: totals.quarantinedRows,
      duplicateRows: totals.duplicateRows,
      message: remaining
        ? `${remaining} Vision job(s) remain active.`
        : totalFailed
          ? 'Vision run completed with errors.'
          : 'Vision run completed successfully.'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Stops local polling. Already-submitted Cloud Vision operations may still
 * finish in Google Cloud.
 *
 * @return {{cancelled:boolean,runId:string}}
 */
function phase4VisionCancelActiveRun() {
  const activeRun = phase4VisionReadActiveRunState_();
  const runId = activeRun && activeRun.runId
    ? activeRun.runId
    : '';

  phase4VisionClearActiveRunState_();
  phase4VisionRemoveTrigger_();

  return {
    cancelled: Boolean(runId),
    runId
  };
}

/**
 * Returns current controller state.
 *
 * @return {{activeRun:Object|null,triggerInstalled:boolean}}
 */
function phase4VisionGetControllerStatus() {
  return {
    activeRun: phase4VisionReadActiveRunState_(),
    triggerInstalled: Boolean(phase4VisionGetTriggerId_())
  };
}

/* ========================================================================== */
/* JOB PROCESSING                                                             */
/* ========================================================================== */

function phase4VisionProcessPendingJob_(
  runtime,
  activeRun,
  job,
  totals
) {
  let operation;

  try {
    operation = phase4VisionGetOperation_(
      runtime,
      job.vision_operation_name
    );
  } catch (error) {
    totals.failed++;
    phase4VisionUpdateJobStatus_(
      activeRun.spreadsheetId,
      job,
      PHASE4_VISION_CONTROLLER.jobStatuses.FAILED,
      error.message || String(error)
    );
    return;
  }

  if (!operation.done) {
    phase4VisionUpdateJobStatus_(
      activeRun.spreadsheetId,
      job,
      PHASE4_VISION_CONTROLLER.jobStatuses.RUNNING,
      ''
    );
    return;
  }

  if (operation.error) {
    totals.failed++;
    phase4VisionUpdateJobStatus_(
      activeRun.spreadsheetId,
      job,
      PHASE4_VISION_CONTROLLER.jobStatuses.FAILED,
      JSON.stringify(operation.error)
    );
    return;
  }

  try {
    const outputs = phase4VisionReadOutputs_(
      runtime,
      job.gcs_output_uri
    );

    if (!outputs.length) {
      const gracePoll = phase4VisionIncrementGracePoll_(
        activeRun,
        job.source_file_id
      );

      if (gracePoll <= runtime.operationOutputGracePolls) {
        phase4VisionUpdateJobStatus_(
          activeRun.spreadsheetId,
          job,
          PHASE4_VISION_CONTROLLER.jobStatuses.RUNNING,
          'Vision completed, but output JSON is not visible yet. ' +
          `Grace poll ${gracePoll} of ` +
          `${runtime.operationOutputGracePolls}.`
        );
        return;
      }

      throw new Error(
        'Cloud Vision completed but no output JSON files were found.'
      );
    }

    const parsedRecords = [];
    const parsedReviews = [];
    let fallbackPageNumber = 0;
    let jobPagesSeen = 0;
    let jobIsoPages = 0;

    outputs.forEach(output => {
      const responses = Array.isArray(output.responses)
        ? output.responses
        : [];

      responses.forEach(response => {
        fallbackPageNumber++;
        jobPagesSeen++;

        const pageNumber =
          response &&
          response.context &&
          response.context.pageNumber
            ? response.context.pageNumber
            : fallbackPageNumber;

        const result = phase4VisionDispatchParser_(
          activeRun,
          job,
          response,
          pageNumber
        );

        if (
          result.pageSummary &&
          result.pageSummary.pageClass === 'ISO'
        ) {
          jobIsoPages++;
        }

        Array.prototype.push.apply(
          parsedRecords,
          result.records || []
        );
        Array.prototype.push.apply(
          parsedReviews,
          result.reviews || []
        );
      });
    });

    const before = FMRCore.getVisionExtractionSheetStatus(
      activeRun.spreadsheetId
    );
    const writeResult = FMRCore.appendVisionExtractionResults(
      activeRun.spreadsheetId,
      parsedRecords,
      parsedReviews
    );
    const after = FMRCore.getVisionExtractionSheetStatus(
      activeRun.spreadsheetId
    );

    const newReferenceRows = Math.max(
      0,
      after.referenceRows - before.referenceRows
    );
    const newPipeRows = Math.max(
      0,
      after.pipeRows - before.pipeRows
    );
    const conflictReviewRows = Math.max(
      0,
      writeResult.newReviewRows - parsedReviews.length
    );
    const estimatedDuplicates = Math.max(
      0,
      parsedRecords.length -
      newReferenceRows -
      conflictReviewRows
    );

    totals.completed++;
    totals.pagesSeen += jobPagesSeen;
    totals.isoPages += jobIsoPages;
    totals.acceptedRows += newReferenceRows;
    totals.quarantinedRows += writeResult.newReviewRows;
    totals.pipeRows += newPipeRows;
    totals.duplicateRows += estimatedDuplicates;

    phase4VisionUpdateJobStatus_(
      activeRun.spreadsheetId,
      job,
      PHASE4_VISION_CONTROLLER.jobStatuses.COMPLETED,
      [
        `Pages: ${jobPagesSeen}`,
        `Stored rows: ${newReferenceRows}`,
        `Review rows: ${writeResult.newReviewRows}`,
        `Duplicate rows: ${estimatedDuplicates}`
      ].join('; ')
    );

    phase4VisionClearGracePoll_(
      activeRun,
      job.source_file_id
    );

    if (runtime.cleanupCloudObjects) {
      phase4VisionCleanupJobObjects_(runtime, job);
    }
  } catch (error) {
    totals.failed++;
    phase4VisionUpdateJobStatus_(
      activeRun.spreadsheetId,
      job,
      PHASE4_VISION_CONTROLLER.jobStatuses.FAILED,
      error.message || String(error)
    );
  }
}

function phase4VisionDispatchParser_(
  activeRun,
  job,
  response,
  pageNumber
) {
  const context = {
    runId: activeRun.runId,
    sourceFileId: job.source_file_id,
    sourcePdf: job.source_pdf,
    sourcePage: pageNumber,
    iwpNumber: activeRun.iwpNumber || ''
  };

  const documentType = phase4VisionNormalizeDocumentType_(
    job.source_document_type ||
    activeRun.sourceDocumentType
  );

  if (documentType === PHASE4_VISION_CONTROLLER.documentTypes.ISO) {
    return FMRCore.parseVisionIsoPage(context, response);
  }

  if (documentType === PHASE4_VISION_CONTROLLER.documentTypes.FMR) {
    if (typeof FMRCore.parseVisionFmrPage === 'function') {
      return FMRCore.parseVisionFmrPage(context, response);
    }

    throw new Error(
      'FMR PDF parsing is not installed in the current FMRCore version.'
    );
  }

  throw new Error(`Unsupported source document type: ${documentType}`);
}

/* ========================================================================== */
/* CLOUD VISION + CLOUD STORAGE                                               */
/* ========================================================================== */

function phase4VisionSubmitPdf_(runtime, inputUri, outputUri) {
  const response = phase4VisionAuthorizedFetch_(
    'https://vision.googleapis.com/v1/files:asyncBatchAnnotate',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        requests: [{
          inputConfig: {
            gcsSource: { uri: inputUri },
            mimeType: 'application/pdf'
          },
          features: [{
            type: 'DOCUMENT_TEXT_DETECTION'
          }],
          outputConfig: {
            gcsDestination: { uri: outputUri },
            batchSize: runtime.batchSize
          }
        }]
      }),
      muteHttpExceptions: true
    }
  );

  const body = phase4VisionParseHttpResponse_(
    response,
    'Cloud Vision submission failed'
  );

  if (!body.name) {
    throw new Error('Cloud Vision did not return an operation name.');
  }

  return body.name;
}

function phase4VisionGetOperation_(runtime, operationName) {
  const name = String(operationName || '').trim();

  if (!name) {
    throw new Error('The Vision operation name is missing.');
  }

  const response = phase4VisionAuthorizedFetch_(
    'https://vision.googleapis.com/v1/' +
    name.replace(/^\/+/, ''),
    {
      method: 'get',
      muteHttpExceptions: true
    }
  );

  return phase4VisionParseHttpResponse_(
    response,
    'Cloud Vision operation polling failed'
  );
}

function phase4VisionUploadPdf_(runtime, objectName, blob) {
  const object = String(objectName || '').replace(/^\/+/, '');

  if (!object) {
    throw new Error('A Cloud Storage object name is required.');
  }

  const response = phase4VisionAuthorizedFetch_(
    'https://storage.googleapis.com/upload/storage/v1/b/' +
    `${encodeURIComponent(runtime.bucket)}/o` +
    '?uploadType=media' +
    `&name=${encodeURIComponent(object)}`,
    {
      method: 'post',
      contentType: 'application/pdf',
      payload: blob.getBytes(),
      muteHttpExceptions: true
    }
  );

  phase4VisionParseHttpResponse_(
    response,
    'Cloud Storage PDF upload failed'
  );
}

function phase4VisionReadOutputs_(runtime, gcsOutputUri) {
  const parsed = phase4VisionParseGsUri_(gcsOutputUri);
  const items = phase4VisionListStorageObjects_(
    parsed.bucket,
    parsed.object
  )
    .filter(item => item.name && /\.json$/i.test(item.name))
    .sort(phase4VisionCompareOutputObjects_);

  return items.map(item => {
    const response = phase4VisionAuthorizedFetch_(
      'https://storage.googleapis.com/download/storage/v1/b/' +
      `${encodeURIComponent(parsed.bucket)}/o/` +
      `${encodeURIComponent(item.name)}?alt=media`,
      {
        method: 'get',
        muteHttpExceptions: true
      }
    );

    return phase4VisionParseHttpResponse_(
      response,
      `Could not download Vision output ${item.name}`
    );
  });
}

function phase4VisionListStorageObjects_(bucket, prefix) {
  const items = [];
  let pageToken = '';

  do {
    let url =
      'https://storage.googleapis.com/storage/v1/b/' +
      `${encodeURIComponent(bucket)}/o` +
      `?prefix=${encodeURIComponent(prefix || '')}`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const response = phase4VisionAuthorizedFetch_(url, {
      method: 'get',
      muteHttpExceptions: true
    });
    const body = phase4VisionParseHttpResponse_(
      response,
      'Cloud Storage object listing failed'
    );

    Array.prototype.push.apply(items, body.items || []);
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  return items;
}

function phase4VisionAuthorizedFetch_(url, options) {
  const request = Object.assign({}, options || {});

  request.headers = Object.assign(
    {},
    request.headers || {},
    {
      Authorization: `Bearer ${ScriptApp.getOAuthToken()}`
    }
  );

  return UrlFetchApp.fetch(url, request);
}

function phase4VisionParseHttpResponse_(response, prefix) {
  const status = response.getResponseCode();
  const text = response.getContentText();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }

  if (status < 200 || status >= 300) {
    throw new Error(
      phase4VisionLimitMessage_(
        `${prefix}: HTTP ${status} ${text}`
      )
    );
  }

  return body;
}

function phase4VisionParseGsUri_(uri) {
  const match = String(uri || '').match(/^gs:\/\/([^/]+)\/?(.*)$/);

  if (!match) {
    throw new Error(`Invalid Cloud Storage URI: ${uri}`);
  }

  return {
    bucket: match[1],
    object: match[2]
  };
}

function phase4VisionCompareOutputObjects_(first, second) {
  const firstPage = phase4VisionOutputStartPage_(first.name);
  const secondPage = phase4VisionOutputStartPage_(second.name);

  return firstPage !== secondPage
    ? firstPage - secondPage
    : String(first.name).localeCompare(String(second.name));
}

function phase4VisionOutputStartPage_(name) {
  const match = String(name || '').match(
    /(?:^|\/)output-(\d+)-to-\d+\.json$/i
  );

  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function phase4VisionCleanupJobObjects_(runtime, job) {
  try {
    if (job.gcs_input_uri) {
      phase4VisionDeleteGsObject_(job.gcs_input_uri);
    }

    if (job.gcs_output_uri) {
      const output = phase4VisionParseGsUri_(job.gcs_output_uri);
      phase4VisionListStorageObjects_(
        output.bucket,
        output.object
      ).forEach(item => {
        phase4VisionDeleteGsObject_(
          `gs://${output.bucket}/${item.name}`
        );
      });
    }
  } catch (error) {
    console.warn('Cloud cleanup failed:', error);
  }
}

function phase4VisionDeleteGsObject_(uri) {
  const parsed = phase4VisionParseGsUri_(uri);
  const response = phase4VisionAuthorizedFetch_(
    'https://storage.googleapis.com/storage/v1/b/' +
    `${encodeURIComponent(parsed.bucket)}/o/` +
    `${encodeURIComponent(parsed.object)}`,
    {
      method: 'delete',
      muteHttpExceptions: true
    }
  );
  const status = response.getResponseCode();

  if (status !== 204 && status !== 404) {
    phase4VisionParseHttpResponse_(
      response,
      'Cloud Storage object deletion failed'
    );
  }
}

/* ========================================================================== */
/* JOB + SUMMARY SHEETS                                                       */
/* ========================================================================== */

function phase4VisionWriteJobs_(spreadsheetId, jobs) {
  if (!jobs.length) {
    return;
  }

  const definition = phase4VisionSheetDefinition_();
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName(definition.names.jobs);

  if (!sheet) {
    throw new Error(`Required sheet "${definition.names.jobs}" was not found.`);
  }

  const values = jobs.map(job =>
    definition.headers.jobs.map(header =>
      phase4VisionProtectCellValue_(job[header])
    )
  );

  sheet.getRange(
    sheet.getLastRow() + 1,
    1,
    values.length,
    definition.headers.jobs.length
  ).setValues(values);
}

function phase4VisionReadJobs_(spreadsheetId, runId) {
  const definition = phase4VisionSheetDefinition_();
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName(definition.names.jobs);

  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  return sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    definition.headers.jobs.length
  ).getValues()
    .map((row, index) => {
      const job = { _sheetRow: index + 2 };

      definition.headers.jobs.forEach((header, column) => {
        job[header] = row[column];
      });

      return job;
    })
    .filter(job => job.run_id === runId);
}

function phase4VisionUpdateJobStatus_(
  spreadsheetId,
  job,
  status,
  message
) {
  const definition = phase4VisionSheetDefinition_();
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName(definition.names.jobs);

  const statusColumn =
    definition.headers.jobs.indexOf('status') + 1;
  const completedColumn =
    definition.headers.jobs.indexOf('completed_at') + 1;
  const messageColumn =
    definition.headers.jobs.indexOf('message') + 1;

  sheet.getRange(job._sheetRow, statusColumn).setValue(status);
  sheet.getRange(job._sheetRow, messageColumn).setValue(
    phase4VisionProtectCellValue_(
      phase4VisionLimitMessage_(message || '')
    )
  );

  if (
    status === PHASE4_VISION_CONTROLLER.jobStatuses.COMPLETED ||
    status === PHASE4_VISION_CONTROLLER.jobStatuses.FAILED
  ) {
    sheet.getRange(job._sheetRow, completedColumn).setValue(new Date());
  }
}

function phase4VisionWriteRunSummary_(spreadsheetId, summary) {
  const definition = phase4VisionSheetDefinition_();
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName(definition.names.summary);

  if (!sheet) {
    throw new Error(
      `Required sheet "${definition.names.summary}" was not found.`
    );
  }

  const row = definition.headers.summary.map(header =>
    phase4VisionProtectCellValue_(summary[header])
  );

  sheet.getRange(
    sheet.getLastRow() + 1,
    1,
    1,
    row.length
  ).setValues([row]);
}

function phase4VisionIncrementRunSummary_(
  spreadsheetId,
  runId,
  changes
) {
  const definition = phase4VisionSheetDefinition_();
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName(definition.names.summary);

  if (!sheet || sheet.getLastRow() <= 1) {
    return;
  }

  const values = sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    definition.headers.summary.length
  ).getValues();
  const runColumn = definition.headers.summary.indexOf('run_id');
  const rowIndex = values.findIndex(row => row[runColumn] === runId);

  if (rowIndex === -1) {
    return;
  }

  Object.keys(changes).forEach(header => {
    const column = definition.headers.summary.indexOf(header);

    if (column === -1) {
      return;
    }

    const cell = sheet.getRange(rowIndex + 2, column + 1);
    const next = changes[header];

    if (typeof next === 'number' && Number.isFinite(next)) {
      const current = Number(cell.getValue() || 0);
      cell.setValue((Number.isFinite(current) ? current : 0) + next);
    } else if (next !== '' && next !== null && next !== undefined) {
      cell.setValue(phase4VisionProtectCellValue_(next));
    }
  });
}

function phase4VisionSheetDefinition_() {
  return {
    names: FMRCore.getVisionSheetNames(),
    headers: FMRCore.getVisionHeaderDefinitions()
  };
}

/* ========================================================================== */
/* ACTIVE RUN + TRIGGER STATE                                                 */
/* ========================================================================== */

function phase4VisionReadActiveRunState_() {
  const raw = phase4VisionDocumentProperties_().getProperty(
    PHASE4_VISION_CONTROLLER.activeRunProperty
  );

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('The stored Vision active-run state is invalid JSON.');
  }
}

function phase4VisionWriteActiveRunState_(state) {
  phase4VisionDocumentProperties_().setProperty(
    PHASE4_VISION_CONTROLLER.activeRunProperty,
    JSON.stringify(state || {})
  );
}

function phase4VisionClearActiveRunState_() {
  phase4VisionDocumentProperties_().deleteProperty(
    PHASE4_VISION_CONTROLLER.activeRunProperty
  );
}

function phase4VisionEnsureTrigger_(pollingMinutes) {
  const existingId = phase4VisionGetTriggerId_();
  const existing = ScriptApp.getProjectTriggers().find(trigger =>
    trigger.getUniqueId() === existingId &&
    trigger.getHandlerFunction() ===
      PHASE4_VISION_CONTROLLER.triggerHandler
  );

  if (existing) {
    return existing;
  }

  phase4VisionRemoveTrigger_();

  const allowed = [1, 5, 10, 15, 30];
  const minutes = allowed.indexOf(Number(pollingMinutes)) !== -1
    ? Number(pollingMinutes)
    : PHASE4_VISION_CONTROLLER.defaults.pollingMinutes;

  const trigger = ScriptApp.newTrigger(
    PHASE4_VISION_CONTROLLER.triggerHandler
  )
    .timeBased()
    .everyMinutes(minutes)
    .create();

  phase4VisionDocumentProperties_().setProperty(
    PHASE4_VISION_CONTROLLER.triggerProperty,
    trigger.getUniqueId()
  );

  return trigger;
}

function phase4VisionRemoveTrigger_() {
  const triggerId = phase4VisionGetTriggerId_();

  ScriptApp.getProjectTriggers().forEach(trigger => {
    const matchingId =
      !triggerId || trigger.getUniqueId() === triggerId;
    const matchingHandler =
      trigger.getHandlerFunction() ===
      PHASE4_VISION_CONTROLLER.triggerHandler;

    if (matchingId && matchingHandler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  phase4VisionDocumentProperties_().deleteProperty(
    PHASE4_VISION_CONTROLLER.triggerProperty
  );
}

function phase4VisionGetTriggerId_() {
  return phase4VisionDocumentProperties_().getProperty(
    PHASE4_VISION_CONTROLLER.triggerProperty
  ) || '';
}

function phase4VisionDocumentProperties_() {
  const properties = PropertiesService.getDocumentProperties();

  if (!properties) {
    throw new Error(
      'Document properties are unavailable. ' +
      'This controller must run from the bound spreadsheet project.'
    );
  }

  return properties;
}

function phase4VisionIncrementGracePoll_(activeRun, fileId) {
  activeRun.outputGracePollCounts =
    activeRun.outputGracePollCounts || {};

  const next = Number(
    activeRun.outputGracePollCounts[fileId] || 0
  ) + 1;

  activeRun.outputGracePollCounts[fileId] = next;
  return next;
}

function phase4VisionClearGracePoll_(activeRun, fileId) {
  if (activeRun.outputGracePollCounts) {
    delete activeRun.outputGracePollCounts[fileId];
  }
}

/* ========================================================================== */
/* RUNTIME CONFIG NORMALIZATION                                               */
/* ========================================================================== */

function phase4VisionNormalizeRuntimeConfig_(config) {
  const source = config || {};

  return {
    projectId: String(source.projectId || '').trim(),
    bucket: String(source.bucket || '')
      .trim()
      .replace(/^gs:\/\//i, '')
      .replace(/\/+$/, ''),
    folderId: String(source.folderId || '').trim(),
    inputPrefix: phase4VisionNormalizeObjectPrefix_(
      source.inputPrefix ||
      PHASE4_VISION_CONTROLLER.defaults.inputPrefix
    ),
    outputPrefix: phase4VisionNormalizeObjectPrefix_(
      source.outputPrefix ||
      PHASE4_VISION_CONTROLLER.defaults.outputPrefix
    ),
    sourceDocumentType: String(
      source.sourceDocumentType ||
      PHASE4_VISION_CONTROLLER.documentTypes.ISO
    ).trim().toUpperCase(),
    pipeMode: String(
      source.pipeMode ||
      FMRCore.getVisionDefaultPipeMode()
    ).trim().toUpperCase(),
    maximumFilesPerStart: phase4VisionPositiveInteger_(
      source.maximumFilesPerStart,
      PHASE4_VISION_CONTROLLER.defaults.maximumFilesPerStart,
      1,
      250
    ),
    batchSize: phase4VisionPositiveInteger_(
      source.batchSize,
      PHASE4_VISION_CONTROLLER.defaults.batchSize,
      1,
      100
    ),
    pollingMinutes: phase4VisionPositiveInteger_(
      source.pollingMinutes,
      PHASE4_VISION_CONTROLLER.defaults.pollingMinutes,
      1,
      30
    ),
    cleanupCloudObjects: phase4VisionBoolean_(
      source.cleanupCloudObjects,
      PHASE4_VISION_CONTROLLER.defaults.cleanupCloudObjects
    ),
    operationOutputGracePolls: phase4VisionPositiveInteger_(
      source.operationOutputGracePolls,
      PHASE4_VISION_CONTROLLER.defaults.operationOutputGracePolls,
      1,
      10
    )
  };
}

function phase4VisionValidateRuntime_(
  runtime,
  folderId,
  options
) {
  const settings = options || {};
  const missing = [];

  if (!runtime.projectId) {
    missing.push('Google Cloud project ID');
  }

  if (!runtime.bucket) {
    missing.push('Cloud Storage bucket');
  } else if (runtime.bucket.indexOf('/') !== -1) {
    throw new Error(
      'The Cloud Storage bucket must be the bucket name only, ' +
      'without gs:// or an object path.'
    );
  }

  if (!settings.folderOptional && !folderId) {
    missing.push('Drive input folder ID');
  }

  if (missing.length) {
    throw new Error(
      'Vision runtime configuration is incomplete: ' +
      missing.join(', ')
    );
  }
}

function phase4VisionNormalizeDocumentType_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const allowed = Object.keys(
    PHASE4_VISION_CONTROLLER.documentTypes
  ).map(key => PHASE4_VISION_CONTROLLER.documentTypes[key]);

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid source document type "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function phase4VisionNormalizeSpreadsheetId_(value) {
  const text = String(value || '').trim();
  const match = text.match(
    /\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/
  );
  const id = match ? match[1] : text;

  if (!/^[A-Za-z0-9_-]{15,}$/.test(id)) {
    throw new Error('A valid spreadsheet ID or URL is required.');
  }

  return id;
}

function phase4VisionNormalizeDriveFolderId_(value) {
  const text = String(value || '').trim();
  const match = text.match(/\/folders\/([A-Za-z0-9_-]{15,})/);
  const id = match ? match[1] : text;

  if (!/^[A-Za-z0-9_-]{15,}$/.test(id)) {
    throw new Error(
      'A valid Drive folder ID or folder URL is required.'
    );
  }

  return id;
}

function phase4VisionNormalizeObjectPrefix_(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

function phase4VisionJoinObjectPath_() {
  return Array.from(arguments)
    .map(phase4VisionNormalizeObjectPrefix_)
    .filter(Boolean)
    .join('/');
}

function phase4VisionPositiveInteger_(
  value,
  fallback,
  minimum,
  maximum
) {
  const number = Number(value);
  const candidate = Number.isFinite(number)
    ? Math.floor(number)
    : fallback;

  return Math.max(minimum, Math.min(maximum, candidate));
}

function phase4VisionBoolean_(value, fallback) {
  if (value === true || value === false) {
    return value;
  }

  const normalized = String(value || '').trim().toUpperCase();

  if (['TRUE', 'YES', 'Y', '1'].indexOf(normalized) !== -1) {
    return true;
  }

  if (['FALSE', 'NO', 'N', '0'].indexOf(normalized) !== -1) {
    return false;
  }

  return Boolean(fallback);
}

/* ========================================================================== */
/* DRIVE + SMALL HELPERS                                                      */
/* ========================================================================== */

function phase4VisionListPdfFiles_(folderId, maximumFiles) {
  const iterator = DriveApp
    .getFolderById(folderId)
    .getFilesByType(MimeType.PDF);
  const files = [];

  while (iterator.hasNext()) {
    files.push(iterator.next());
  }

  files.sort((first, second) => {
    const byName = String(first.getName()).localeCompare(
      String(second.getName())
    );

    return byName !== 0
      ? byName
      : String(first.getId()).localeCompare(String(second.getId()));
  });

  return files.slice(0, maximumFiles);
}

function phase4VisionCreateObjectName_(runId, fileId, fileName) {
  const safeName = String(fileName || 'source.pdf')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return phase4VisionJoinObjectPath_(
    runId,
    `${fileId}-${safeName || 'source.pdf'}`
  );
}

function phase4VisionCreateRunId_() {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  return `${timestamp}-${Utilities.getUuid().slice(0, 8)}`;
}

function phase4VisionGetControllerLock_() {
  return LockService.getDocumentLock() || LockService.getScriptLock();
}

function phase4VisionProtectCellValue_(value) {
  if (typeof value === 'string' && /^[=+@-]/.test(value)) {
    return `'${value}`;
  }

  return value === undefined ? '' : value;
}

function phase4VisionLimitMessage_(value) {
  const text = String(value || '');
  const maximum =
    PHASE4_VISION_CONTROLLER.defaults.maximumMessageLength;

  return text.length <= maximum
    ? text
    : text.slice(0, maximum - 3) + '...';
}

function phase4VisionControllerResult_(active, runId, message) {
  return {
    active,
    runId,
    completed: 0,
    failed: 0,
    remaining: 0,
    pagesSeen: 0,
    acceptedRows: 0,
    quarantinedRows: 0,
    duplicateRows: 0,
    message
  };
}
