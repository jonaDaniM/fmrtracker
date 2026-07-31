/**
 * Phase4_VisionAdapter.gs
 *
 * BOUND SPREADSHEET PROJECT ONLY.
 *
 * Replaces Phase4_CompanyAdapter.gs and exposes the menu/UI for:
 * - Phase4_VisionRuntimeConfig.gs
 * - Phase4_VisionJobController.gs
 * - the corrected FMRCore Vision library
 *
 * Do not create a second onOpen().
 * Add this line to the existing onOpen():
 *
 *   addPhase4VisionMenu_(SpreadsheetApp.getUi());
 *
 * Then remove the old call:
 *
 *   addPhase4IsoMenu_(SpreadsheetApp.getUi());
 */

const PHASE4_VISION_ADAPTER = Object.freeze({
  menuName: 'Document Vision Intake',
  recommendedFirstRunFiles: 3,

  requiredCoreFunctions: Object.freeze([
    'getVisionRequiredScopes',
    'getVisionDefaultPipeMode',
    'getVisionPipeModes',
    'normalizeVisionPipeMode',
    'setupVisionExtractionSheets',
    'getVisionExtractionSheetStatus'
  ]),

  requiredBoundFunctions: Object.freeze([
    'phase4VisionGetRuntimeStatus',
    'phase4VisionSaveCloudSettings',
    'phase4VisionSaveDriveFolder',
    'phase4VisionSavePipeMode',
    'phase4VisionSaveSourceDocumentType',
    'phase4VisionSaveProcessingSettings',
    'phase4VisionClearRuntimeConfig',
    'phase4VisionStartExtractionRun',
    'phase4VisionContinueJobs',
    'phase4VisionCancelActiveRun',
    'phase4VisionGetControllerStatus'
  ])
});

/* ========================================================================== */
/* MENU                                                                       */
/* ========================================================================== */

/**
 * Adds the Phase 4 Vision menu.
 *
 * @param {GoogleAppsScript.Base.Ui} ui
 */
function addPhase4VisionMenu_(ui) {
  ui.createMenu(PHASE4_VISION_ADAPTER.menuName)
    .addItem('1. Configure Google Cloud', 'phase4VisionMenuConfigureCloud')
    .addItem('2. Select Source PDF Folder', 'phase4VisionMenuSelectFolder')
    .addItem('3. Select Document Type', 'phase4VisionMenuSelectDocumentType')
    .addItem('4. Set PIPE Mode', 'phase4VisionMenuSetPipeMode')
    .addItem('5. Configure Processing', 'phase4VisionMenuConfigureProcessing')
    .addSeparator()
    .addItem('6. Authorize Required Services', 'phase4VisionMenuAuthorizeServices')
    .addItem('7. Test Configuration', 'phase4VisionMenuTestConfiguration')
    .addItem('8. Set Up Extraction Sheets', 'phase4VisionMenuSetupSheets')
    .addSeparator()
    .addItem('9. Start Extraction Run', 'phase4VisionMenuStartRun')
    .addItem('10. Continue Active Run Now', 'phase4VisionMenuContinueRun')
    .addItem('11. View Runtime Status', 'phase4VisionMenuShowRuntimeStatus')
    .addItem('12. View Extraction Totals', 'phase4VisionMenuShowSheetStatus')
    .addItem('13. Cancel Active Run', 'phase4VisionMenuCancelRun')
    .addSeparator()
    .addItem(
      'Reset Saved Runtime Configuration',
      'phase4VisionMenuResetRuntimeConfig'
    )
    .addToUi();
}

/* ========================================================================== */
/* CONFIGURATION                                                              */
/* ========================================================================== */

function phase4VisionMenuConfigureCloud() {
  phase4VisionAdapterRunUiAction_('Configure Google Cloud', function () {
    const ui = SpreadsheetApp.getUi();
    const current = phase4VisionGetRuntimeStatus().config;

    const projectResponse = ui.prompt(
      'Google Cloud Project ID',
      [
        'Enter the Google Cloud project ID with Cloud Vision and',
        'Cloud Storage enabled.',
        '',
        `Current value: ${current.projectId || '(not configured)'}`
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (projectResponse.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const bucketResponse = ui.prompt(
      'Cloud Storage Bucket',
      [
        'Enter the bucket name only.',
        'Do not include gs:// or an object path.',
        '',
        `Current value: ${current.bucket || '(not configured)'}`
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (bucketResponse.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const saved = phase4VisionSaveCloudSettings(
      projectResponse.getResponseText(),
      bucketResponse.getResponseText()
    );

    ui.alert(
      'Google Cloud settings saved',
      [
        `Project ID: ${saved.projectId}`,
        `Bucket: ${saved.bucket}`,
        '',
        'The workflow uses the authorized Apps Script user.',
        'No service-account key is stored in the spreadsheet.'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuSelectFolder() {
  phase4VisionAdapterRunUiAction_('Select Source PDF Folder', function () {
    const ui = SpreadsheetApp.getUi();
    const current = phase4VisionGetRuntimeStatus();

    const response = ui.prompt(
      'Source PDF Folder',
      [
        'Paste the Google Drive folder URL or raw folder ID.',
        '',
        `Current folder: ${current.folderName || '(not configured)'}`
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const result = phase4VisionSaveDriveFolder(
      response.getResponseText()
    );

    ui.alert(
      'Source folder saved',
      [
        `Folder: ${result.folderName}`,
        `Folder ID: ${result.folderId}`
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuSelectDocumentType() {
  phase4VisionAdapterRunUiAction_('Select Document Type', function () {
    const ui = SpreadsheetApp.getUi();
    const status = phase4VisionGetRuntimeStatus();

    const response = ui.prompt(
      'Source Document Type',
      [
        'Enter one value:',
        '',
        'ISO — extract engineering BOM reference rows',
        'FMR — extract planner material requests',
        '',
        `Current value: ${status.config.sourceDocumentType}`,
        '',
        status.fmrParserInstalled
          ? 'The FMR coordinate parser is installed.'
          : 'FMR extraction is not operational yet.'
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const selected = String(response.getResponseText() || '')
      .trim()
      .toUpperCase();

    if (selected === 'FMR' && !status.fmrParserInstalled) {
      ui.alert(
        'FMR parser not installed',
        [
          'FMRCore.parseVisionFmrPage() is not installed yet.',
          '',
          'Keep ISO selected until the FMR coordinate parser is added.'
        ].join('\n'),
        ui.ButtonSet.OK
      );
      return;
    }

    const saved = phase4VisionSaveSourceDocumentType(selected);

    ui.alert(
      'Document type saved',
      `Source document type: ${saved.sourceDocumentType}`,
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuSetPipeMode() {
  phase4VisionAdapterRunUiAction_('Set PIPE Mode', function () {
    const ui = SpreadsheetApp.getUi();
    const current = phase4VisionGetRuntimeStatus().config.pipeMode;

    const response = ui.prompt(
      'Downstream PIPE Mode',
      [
        'Enter one value:',
        '',
        'INCLUDE_PIPE — retain all rows downstream',
        'NORMAL — exclude pipe-stock rows downstream',
        'PIPE_ONLY — retain only pipe-stock rows downstream',
        '',
        `Current value: ${current}`,
        '',
        'Extraction always preserves PIPE rows in ISO_BOM_Reference.'
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const saved = phase4VisionSavePipeMode(
      response.getResponseText()
    );

    ui.alert(
      'PIPE mode saved',
      [
        `Downstream mode: ${saved.pipeMode}`,
        '',
        'Every valid extracted BOM row will still be preserved.'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuConfigureProcessing() {
  phase4VisionAdapterRunUiAction_('Configure Processing', function () {
    const ui = SpreadsheetApp.getUi();
    const current = phase4VisionGetRuntimeStatus().config;

    const maximumFiles = phase4VisionAdapterPromptInteger_(
      ui,
      'Maximum PDFs Per Run',
      [
        'Enter 1 through 250.',
        'Recommended first test: 3.',
        '',
        `Current value: ${current.maximumFilesPerStart}`
      ].join('\n'),
      current.maximumFilesPerStart,
      1,
      250
    );
    if (maximumFiles === null) return;

    const batchSize = phase4VisionAdapterPromptInteger_(
      ui,
      'Vision Output Batch Size',
      [
        'Enter 1 through 100.',
        '',
        `Current value: ${current.batchSize}`
      ].join('\n'),
      current.batchSize,
      1,
      100
    );
    if (batchSize === null) return;

    const pollingMinutes = phase4VisionAdapterPromptInteger_(
      ui,
      'Continuation Polling Interval',
      [
        'Allowed values: 1, 5, 10, 15, or 30 minutes.',
        '',
        `Current value: ${current.pollingMinutes}`
      ].join('\n'),
      current.pollingMinutes,
      1,
      30,
      [1, 5, 10, 15, 30]
    );
    if (pollingMinutes === null) return;

    const gracePolls = phase4VisionAdapterPromptInteger_(
      ui,
      'Output Availability Grace Polls',
      [
        'Enter 1 through 10.',
        '',
        `Current value: ${current.operationOutputGracePolls}`
      ].join('\n'),
      current.operationOutputGracePolls,
      1,
      10
    );
    if (gracePolls === null) return;

    const cleanupChoice = ui.alert(
      'Clean Up Cloud Objects?',
      [
        'YES — delete processed Cloud Storage input/output objects.',
        'NO — preserve them for troubleshooting and audit.',
        '',
        `Current value: ${current.cleanupCloudObjects}`
      ].join('\n'),
      ui.ButtonSet.YES_NO_CANCEL
    );

    if (cleanupChoice === ui.Button.CANCEL) {
      return;
    }

    const saved = phase4VisionSaveProcessingSettings({
      maximumFilesPerStart: maximumFiles,
      batchSize,
      pollingMinutes,
      cleanupCloudObjects: cleanupChoice === ui.Button.YES,
      operationOutputGracePolls: gracePolls
    });

    ui.alert(
      'Processing settings saved',
      [
        `Maximum PDFs: ${saved.maximumFilesPerStart}`,
        `Vision batch size: ${saved.batchSize}`,
        `Polling interval: ${saved.pollingMinutes} minute(s)`,
        `Output grace polls: ${saved.operationOutputGracePolls}`,
        `Clean up Cloud objects: ${saved.cleanupCloudObjects}`,
        `Input prefix: ${saved.inputPrefix}`,
        `Output prefix: ${saved.outputPrefix}`
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

/* ========================================================================== */
/* AUTHORIZATION AND SETUP                                                    */
/* ========================================================================== */

function phase4VisionMenuAuthorizeServices() {
  phase4VisionAdapterRunUiAction_(
    'Authorize Required Services',
    function () {
      const ui = SpreadsheetApp.getUi();

      phase4VisionAdapterAssertCoreContract_();

      ScriptApp.requireScopes(
        ScriptApp.AuthMode.FULL,
        FMRCore.getVisionRequiredScopes()
      );

      /*
       * Touch the host services after authorization so missing manifest
       * scopes surface before the first extraction run.
       */
      DriveApp.getRootFolder().getId();
      ScriptApp.getProjectTriggers();
      UrlFetchApp.getRequest('https://storage.googleapis.com/');

      ui.alert(
        'Required services are authorized',
        [
          'The bound project can request access to:',
          '- Google Sheets',
          '- Google Drive',
          '- Google Cloud APIs',
          '- External HTTPS requests',
          '- Installable triggers',
          '',
          'Run "Test Configuration" next.'
        ].join('\n'),
        ui.ButtonSet.OK
      );
    }
  );
}

function phase4VisionMenuTestConfiguration() {
  phase4VisionAdapterRunUiAction_('Test Configuration', function () {
    const ui = SpreadsheetApp.getUi();
    const checks = [];
    const warnings = [];

    phase4VisionAdapterAssertCoreContract_();
    checks.push('FMRCore public contract: PASS');

    phase4VisionAdapterAssertBoundContract_();
    checks.push('Bound-project contract: PASS');

    const runtime = phase4VisionGetRuntimeStatus();

    if (runtime.missing.length) {
      throw new Error(
        'Missing configuration:\n- ' +
        runtime.missing.join('\n- ')
      );
    }

    checks.push('Runtime configuration: PASS');
    checks.push(`Drive folder access: PASS (${runtime.folderName})`);

    const bucket = phase4VisionAdapterTestBucketAccess_(
      runtime.config.bucket
    );
    checks.push(`Cloud Storage access: PASS (${bucket.name})`);

    if (!runtime.readyForSelectedDocumentType) {
      throw new Error(
        'The selected document type is not operational:\n- ' +
        runtime.warnings.join('\n- ')
      );
    }

    runtime.warnings.forEach(function (warning) {
      warnings.push(warning);
    });

    const controller = phase4VisionGetControllerStatus();

    checks.push(
      controller.activeRun
        ? `Controller state: ACTIVE (${controller.activeRun.runId})`
        : 'Controller state: IDLE'
    );
    checks.push(
      controller.triggerInstalled
        ? 'Continuation trigger: INSTALLED'
        : 'Continuation trigger: NOT INSTALLED'
    );

    ui.alert(
      'Phase 4 configuration test passed',
      [
        checks.join('\n'),
        '',
        warnings.length
          ? 'Warnings:\n- ' + warnings.join('\n- ')
          : 'Warnings: none',
        '',
        'The asynchronous Cloud Vision PDF endpoint will be verified when',
        'the first extraction run is submitted.'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuSetupSheets() {
  phase4VisionAdapterRunUiAction_('Set Up Extraction Sheets', function () {
    const ui = SpreadsheetApp.getUi();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    phase4VisionAdapterAssertCoreContract_();

    const result = FMRCore.setupVisionExtractionSheets(
      spreadsheet.getId()
    );

    ui.alert(
      'Extraction sheets are ready',
      [
        `Jobs: ${result.jobs}`,
        `ISO BOM reference: ${result.isoBomReference}`,
        `Review: ${result.review}`,
        `Run summary: ${result.summary}`,
        '',
        'ISO_BOM_Reference is engineering reference data.',
        'It does not replace planner-approved FMR demand.'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

/* ========================================================================== */
/* RUN CONTROL                                                                */
/* ========================================================================== */

function phase4VisionMenuStartRun() {
  phase4VisionAdapterRunUiAction_('Start Extraction Run', function () {
    const ui = SpreadsheetApp.getUi();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    phase4VisionAdapterAssertCoreContract_();
    phase4VisionAdapterAssertBoundContract_();

    const runtime = phase4VisionGetRuntimeStatus();

    if (!runtime.readyForSelectedDocumentType) {
      const details = runtime.missing.concat(runtime.warnings);
      throw new Error(
        'The extraction runtime is not ready:\n- ' +
        details.join('\n- ')
      );
    }

    const controller = phase4VisionGetControllerStatus();

    if (controller.activeRun) {
      throw new Error(
        `Vision run ${controller.activeRun.runId} is still active. ` +
        'Continue or cancel it before starting another run.'
      );
    }

    const maximumFiles = phase4VisionAdapterPromptInteger_(
      ui,
      'Start Extraction Run',
      [
        `Document type: ${runtime.config.sourceDocumentType}`,
        `Source folder: ${runtime.folderName}`,
        `PIPE mode: ${runtime.config.pipeMode}`,
        '',
        'How many PDFs should be submitted?',
        `Recommended first test: ${PHASE4_VISION_ADAPTER.recommendedFirstRunFiles}`,
        `Saved maximum: ${runtime.config.maximumFilesPerStart}`
      ].join('\n'),
      Math.min(
        PHASE4_VISION_ADAPTER.recommendedFirstRunFiles,
        runtime.config.maximumFilesPerStart
      ),
      1,
      runtime.config.maximumFilesPerStart
    );

    if (maximumFiles === null) {
      return;
    }

    const iwpResponse = ui.prompt(
      'Optional IWP Number',
      [
        'Enter an IWP number to apply to this run, or leave blank.',
        '',
        'The future FMR parser may read this value from the source form.'
      ].join('\n'),
      ui.ButtonSet.OK_CANCEL
    );

    if (iwpResponse.getSelectedButton() !== ui.Button.OK) {
      return;
    }

    const confirmation = ui.alert(
      'Submit Vision extraction run?',
      [
        `Document type: ${runtime.config.sourceDocumentType}`,
        `PDF limit: ${maximumFiles}`,
        `Source folder: ${runtime.folderName}`,
        `Cloud bucket: ${runtime.config.bucket}`,
        `PIPE mode: ${runtime.config.pipeMode}`,
        '',
        'Cloud Vision processing is asynchronous.'
      ].join('\n'),
      ui.ButtonSet.YES_NO
    );

    if (confirmation !== ui.Button.YES) {
      return;
    }

    spreadsheet.toast(
      `Submitting up to ${maximumFiles} PDF file(s) to Cloud Vision...`,
      'Phase 4',
      10
    );

    const result = phase4VisionStartExtractionRun(
      spreadsheet.getId(),
      runtime.config.folderId,
      {
        sourceDocumentType: runtime.config.sourceDocumentType,
        maximumFiles,
        pipeMode: runtime.config.pipeMode,
        iwpNumber: iwpResponse.getResponseText()
      }
    );

    ui.alert(
      result.active
        ? 'Vision extraction run submitted'
        : 'No active Vision run was created',
      [
        `Run ID: ${result.runId}`,
        `Document type: ${result.sourceDocumentType}`,
        `PDFs discovered: ${result.discoveredFiles}`,
        `PDFs submitted: ${result.submittedFiles}`,
        `Submission failures: ${result.failedFiles}`,
        `PIPE mode: ${result.pipeMode}`,
        '',
        result.active
          ? 'The continuation trigger will poll automatically.'
          : 'Review Document_Extraction_Jobs for submission errors.'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuContinueRun() {
  phase4VisionAdapterRunUiAction_('Continue Active Run', function () {
    const ui = SpreadsheetApp.getUi();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    spreadsheet.toast(
      'Checking active Cloud Vision jobs...',
      'Phase 4',
      10
    );

    const result = phase4VisionContinueJobs();

    ui.alert(
      result.active
        ? 'Vision run is still active'
        : 'Vision continuation complete',
      [
        `Run ID: ${result.runId || '(none)'}`,
        `Completed this check: ${result.completed || 0}`,
        `Failed this check: ${result.failed || 0}`,
        `Jobs remaining: ${result.remaining || 0}`,
        `Pages seen: ${result.pagesSeen || 0}`,
        `Accepted rows: ${result.acceptedRows || 0}`,
        `Quarantined rows: ${result.quarantinedRows || 0}`,
        `Duplicate rows: ${result.duplicateRows || 0}`,
        '',
        result.message || ''
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuShowRuntimeStatus() {
  phase4VisionAdapterRunUiAction_('View Runtime Status', function () {
    const ui = SpreadsheetApp.getUi();
    const runtime = phase4VisionGetRuntimeStatus();
    const controller = phase4VisionGetControllerStatus();
    const active = controller.activeRun;

    ui.alert(
      'Phase 4 runtime status',
      [
        `Ready for ISO: ${runtime.readyForIso}`,
        `Ready for selected type: ${runtime.readyForSelectedDocumentType}`,
        `Selected document type: ${runtime.config.sourceDocumentType}`,
        `FMR parser installed: ${runtime.fmrParserInstalled}`,
        '',
        `Google Cloud project: ${runtime.config.projectId || '(not configured)'}`,
        `Cloud Storage bucket: ${runtime.config.bucket || '(not configured)'}`,
        `Source folder: ${runtime.folderName || '(not configured)'}`,
        `Source folder ID: ${runtime.config.folderId || '(not configured)'}`,
        '',
        `PIPE mode: ${runtime.config.pipeMode}`,
        `Maximum PDFs: ${runtime.config.maximumFilesPerStart}`,
        `Vision batch size: ${runtime.config.batchSize}`,
        `Polling minutes: ${runtime.config.pollingMinutes}`,
        `Cleanup Cloud objects: ${runtime.config.cleanupCloudObjects}`,
        `Output grace polls: ${runtime.config.operationOutputGracePolls}`,
        '',
        active ? `Active run: ${active.runId}` : 'Active run: none',
        active ? `Run started: ${active.startedAt || '(unknown)'}` : '',
        `Continuation trigger installed: ${controller.triggerInstalled}`,
        '',
        runtime.missing.length
          ? 'Missing:\n- ' + runtime.missing.join('\n- ')
          : 'Missing: none',
        '',
        runtime.warnings.length
          ? 'Warnings:\n- ' + runtime.warnings.join('\n- ')
          : 'Warnings: none'
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuShowSheetStatus() {
  phase4VisionAdapterRunUiAction_('View Extraction Totals', function () {
    const ui = SpreadsheetApp.getUi();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    const status = FMRCore.getVisionExtractionSheetStatus(
      spreadsheet.getId()
    );

    ui.alert(
      'Extraction totals',
      [
        `ISO reference rows: ${status.referenceRows}`,
        `Active accepted rows: ${status.acceptedRows}`,
        `Superseded rows: ${status.supersededRows}`,
        `PIPE rows preserved: ${status.pipeRows}`,
        `Review rows: ${status.reviewRows}`,
        `Job rows: ${status.jobRows}`,
        `Run summary rows: ${status.summaryRows}`
      ].join('\n'),
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuCancelRun() {
  phase4VisionAdapterRunUiAction_('Cancel Active Run', function () {
    const ui = SpreadsheetApp.getUi();
    const status = phase4VisionGetControllerStatus();

    if (!status.activeRun) {
      ui.alert('There is no active Vision run.');
      return;
    }

    const confirmation = ui.alert(
      'Cancel local Vision polling?',
      [
        `Active run: ${status.activeRun.runId}`,
        '',
        'This removes the saved run state and continuation trigger.',
        'Submitted Cloud Vision operations may still finish.',
        'Cloud Storage objects are not automatically removed.'
      ].join('\n'),
      ui.ButtonSet.YES_NO
    );

    if (confirmation !== ui.Button.YES) {
      return;
    }

    const result = phase4VisionCancelActiveRun();

    ui.alert(
      result.cancelled
        ? 'Local Vision polling cancelled'
        : 'No active run was cancelled',
      result.cancelled
        ? `Run ID: ${result.runId}`
        : 'No active run state was found.',
      ui.ButtonSet.OK
    );
  });
}

function phase4VisionMenuResetRuntimeConfig() {
  phase4VisionAdapterRunUiAction_(
    'Reset Runtime Configuration',
    function () {
      const ui = SpreadsheetApp.getUi();
      const controller = phase4VisionGetControllerStatus();

      if (controller.activeRun) {
        throw new Error(
          `Run ${controller.activeRun.runId} is active. ` +
          'Complete or cancel it before clearing configuration.'
        );
      }

      const confirmation = ui.alert(
        'Reset saved Phase 4 configuration?',
        [
          'This clears the Cloud project, bucket, source folder,',
          'document type, PIPE mode, and processing settings.',
          '',
          'It does not delete spreadsheet records or Cloud objects.'
        ].join('\n'),
        ui.ButtonSet.YES_NO
      );

      if (confirmation !== ui.Button.YES) {
        return;
      }

      const defaults = phase4VisionClearRuntimeConfig();

      ui.alert(
        'Runtime configuration reset',
        [
          `Default document type: ${defaults.sourceDocumentType}`,
          `Default PIPE mode: ${defaults.pipeMode}`,
          `Default maximum PDFs: ${defaults.maximumFilesPerStart}`,
          '',
          'Cloud and folder settings must be configured again.'
        ].join('\n'),
        ui.ButtonSet.OK
      );
    }
  );
}

/* ========================================================================== */
/* INTERNAL HELPERS                                                           */
/* ========================================================================== */

function phase4VisionAdapterAssertCoreContract_() {
  if (typeof FMRCore === 'undefined') {
    throw new Error(
      'The FMRCore library is not installed in the bound project.'
    );
  }

  const missing = PHASE4_VISION_ADAPTER.requiredCoreFunctions
    .filter(function (name) {
      return typeof FMRCore[name] !== 'function';
    });

  if (missing.length) {
    throw new Error(
      'The selected FMRCore version is missing:\n- ' +
      missing.join('\n- ') +
      '\n\nPublish the corrected FMRCore version and update the ' +
      'bound-project library dependency.'
    );
  }
}

function phase4VisionAdapterAssertBoundContract_() {
  const missing = PHASE4_VISION_ADAPTER.requiredBoundFunctions
    .filter(function (name) {
      return typeof globalThis[name] !== 'function';
    });

  if (missing.length) {
    throw new Error(
      'The bound project is missing required Phase 4 functions:\n- ' +
      missing.join('\n- ')
    );
  }
}

function phase4VisionAdapterTestBucketAccess_(bucket) {
  const normalized = String(bucket || '').trim();

  if (!normalized) {
    throw new Error('A Cloud Storage bucket is not configured.');
  }

  const response = UrlFetchApp.fetch(
    'https://storage.googleapis.com/storage/v1/b/' +
      encodeURIComponent(normalized),
    {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    }
  );

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
    const message =
      body && body.error && body.error.message
        ? body.error.message
        : text;

    throw new Error(
      `Cloud Storage bucket test failed: HTTP ${status} ${message}`
    );
  }

  return body;
}

function phase4VisionAdapterPromptInteger_(
  ui,
  title,
  message,
  defaultValue,
  minimum,
  maximum,
  allowedValues
) {
  const response = ui.prompt(
    title,
    `${message}\n\nEnter value [${defaultValue}]:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return null;
  }

  const raw = String(response.getResponseText() || '').trim();
  const value = raw === '' ? Number(defaultValue) : Number(raw);

  if (!Number.isInteger(value)) {
    throw new Error(`${title} must be a whole number.`);
  }

  if (value < minimum || value > maximum) {
    throw new Error(
      `${title} must be between ${minimum} and ${maximum}.`
    );
  }

  if (
    Array.isArray(allowedValues) &&
    allowedValues.indexOf(value) === -1
  ) {
    throw new Error(
      `${title} must be one of: ${allowedValues.join(', ')}.`
    );
  }

  return value;
}

function phase4VisionAdapterRunUiAction_(actionName, callback) {
  try {
    callback();
  } catch (error) {
    const message =
      error && error.message ? error.message : String(error);

    console.error(
      `${actionName} failed`,
      error && error.stack ? error.stack : error
    );

    SpreadsheetApp.getUi().alert(
      `${actionName} failed`,
      message,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}
