/**
 * Phase4_VisionRuntimeConfig.gs
 *
 * BOUND SPREADSHEET PROJECT ONLY.
 *
 * Stores and validates workbook-specific Cloud Vision runtime settings.
 * This file must not be placed in FMRCore.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Store the Google Cloud project ID and Cloud Storage bucket.
 * - Store the Drive input folder used by this workbook.
 * - Store input/output object prefixes.
 * - Store the active source-document type: ISO or FMR.
 * - Store the downstream PIPE mode.
 * - Store batch, polling, cleanup, and file-limit settings.
 * - Expose phase4VisionGetRuntimeConfig_() to the job controller.
 *
 * NON-RESPONSIBILITIES
 * --------------------
 * - No menus, prompts, alerts, or onOpen().
 * - No Cloud Vision requests or Cloud Storage uploads.
 * - No parsing or material validation.
 * - No active-run or continuation-trigger state. The job controller owns
 *   those separately.
 *
 * Required FMRCore public functions:
 * - getVisionDefaultPipeMode()
 * - normalizeVisionPipeMode(mode)
 */

const PHASE4_VISION_RUNTIME_CONFIG = Object.freeze({
  schemaVersion: '1.0.0',

  properties: Object.freeze({
    schemaVersion: 'FMR_VISION_RUNTIME_SCHEMA_VERSION',
    projectId: 'FMR_VISION_PROJECT_ID',
    bucket: 'FMR_VISION_BUCKET',
    folderId: 'FMR_VISION_DRIVE_FOLDER_ID',
    inputPrefix: 'FMR_VISION_INPUT_PREFIX',
    outputPrefix: 'FMR_VISION_OUTPUT_PREFIX',
    sourceDocumentType: 'FMR_VISION_SOURCE_DOCUMENT_TYPE',
    pipeMode: 'FMR_VISION_PIPE_MODE',
    maximumFilesPerStart: 'FMR_VISION_MAXIMUM_FILES_PER_START',
    batchSize: 'FMR_VISION_BATCH_SIZE',
    pollingMinutes: 'FMR_VISION_POLLING_MINUTES',
    cleanupCloudObjects: 'FMR_VISION_CLEANUP_CLOUD_OBJECTS',
    operationOutputGracePolls: 'FMR_VISION_OUTPUT_GRACE_POLLS'
  }),

  defaults: Object.freeze({
    projectId: '',
    bucket: '',
    folderId: '',
    inputPrefix: 'fmr-vision/input',
    outputPrefix: 'fmr-vision/output',
    sourceDocumentType: 'ISO',
    pipeMode: 'INCLUDE_PIPE',
    maximumFilesPerStart: 25,
    batchSize: 20,
    pollingMinutes: 1,
    cleanupCloudObjects: false,
    operationOutputGracePolls: 3
  }),

  documentTypes: Object.freeze({
    ISO: 'ISO',
    FMR: 'FMR'
  }),

  allowedPollingMinutes: Object.freeze([
    1,
    5,
    10,
    15,
    30
  ]),

  limits: Object.freeze({
    maximumFilesMinimum: 1,
    maximumFilesMaximum: 250,
    batchSizeMinimum: 1,
    batchSizeMaximum: 100,
    gracePollsMinimum: 1,
    gracePollsMaximum: 10
  })
});

/* ========================================================================== */
/* CONTROLLER CONTRACT                                                        */
/* ========================================================================== */

/**
 * Returns the normalized workbook-specific runtime configuration.
 *
 * This is the exact private function required by
 * Phase4_VisionJobController.gs.
 *
 * @return {{
 *   projectId:string,
 *   bucket:string,
 *   folderId:string,
 *   inputPrefix:string,
 *   outputPrefix:string,
 *   sourceDocumentType:string,
 *   pipeMode:string,
 *   maximumFilesPerStart:number,
 *   batchSize:number,
 *   pollingMinutes:number,
 *   cleanupCloudObjects:boolean,
 *   operationOutputGracePolls:number
 * }}
 */
function phase4VisionGetRuntimeConfig_() {
  const properties = phase4VisionRuntimeDocumentProperties_();
  const keys = PHASE4_VISION_RUNTIME_CONFIG.properties;

  return phase4VisionNormalizeRuntimeValues_({
    projectId: properties.getProperty(keys.projectId),
    bucket: properties.getProperty(keys.bucket),
    folderId: properties.getProperty(keys.folderId),
    inputPrefix: properties.getProperty(keys.inputPrefix),
    outputPrefix: properties.getProperty(keys.outputPrefix),
    sourceDocumentType: properties.getProperty(keys.sourceDocumentType),
    pipeMode: properties.getProperty(keys.pipeMode),
    maximumFilesPerStart:
      properties.getProperty(keys.maximumFilesPerStart),
    batchSize: properties.getProperty(keys.batchSize),
    pollingMinutes: properties.getProperty(keys.pollingMinutes),
    cleanupCloudObjects:
      properties.getProperty(keys.cleanupCloudObjects),
    operationOutputGracePolls:
      properties.getProperty(keys.operationOutputGracePolls)
  });
}

/**
 * Merges and stores runtime settings in this spreadsheet's document
 * properties.
 *
 * Omitted fields preserve their existing values.
 *
 * @param {Object} updates
 * @return {Object} normalized saved configuration
 */
function phase4VisionSaveRuntimeConfig_(updates) {
  const current = phase4VisionGetRuntimeConfig_();
  const source = updates || {};
  const merged = Object.assign({}, current);

  Object.keys(source).forEach(key => {
    if (source[key] !== undefined) {
      merged[key] = source[key];
    }
  });

  const normalized = phase4VisionNormalizeRuntimeValues_(merged);
  phase4VisionValidateRuntimeValuesForStorage_(normalized);

  const properties = phase4VisionRuntimeDocumentProperties_();
  const keys = PHASE4_VISION_RUNTIME_CONFIG.properties;

  const values = {};
  values[keys.schemaVersion] =
    PHASE4_VISION_RUNTIME_CONFIG.schemaVersion;
  values[keys.projectId] = normalized.projectId;
  values[keys.bucket] = normalized.bucket;
  values[keys.folderId] = normalized.folderId;
  values[keys.inputPrefix] = normalized.inputPrefix;
  values[keys.outputPrefix] = normalized.outputPrefix;
  values[keys.sourceDocumentType] = normalized.sourceDocumentType;
  values[keys.pipeMode] = normalized.pipeMode;
  values[keys.maximumFilesPerStart] =
    String(normalized.maximumFilesPerStart);
  values[keys.batchSize] = String(normalized.batchSize);
  values[keys.pollingMinutes] = String(normalized.pollingMinutes);
  values[keys.cleanupCloudObjects] =
    String(normalized.cleanupCloudObjects);
  values[keys.operationOutputGracePolls] =
    String(normalized.operationOutputGracePolls);

  properties.setProperties(values, false);
  return normalized;
}

/* ========================================================================== */
/* PUBLIC SETUP FUNCTIONS FOR THE UPCOMING ADAPTER                            */
/* ========================================================================== */

/**
 * Saves the Google Cloud project and Cloud Storage bucket.
 *
 * @param {string} projectId
 * @param {string} bucket
 * @return {Object}
 */
function phase4VisionSaveCloudSettings(projectId, bucket) {
  return phase4VisionSaveRuntimeConfig_({
    projectId,
    bucket
  });
}

/**
 * Saves and verifies the Drive input folder.
 *
 * Accepts either a folder URL or raw folder ID.
 *
 * @param {string} folderReference
 * @return {{folderId:string,folderName:string,config:Object}}
 */
function phase4VisionSaveDriveFolder(folderReference) {
  const folderId = phase4VisionRuntimeNormalizeFolderId_(folderReference);

  if (!folderId) {
    throw new Error('A valid Drive folder URL or folder ID is required.');
  }

  const folder = DriveApp.getFolderById(folderId);
  const config = phase4VisionSaveRuntimeConfig_({ folderId });

  return {
    folderId,
    folderName: folder.getName(),
    config
  };
}

/**
 * Saves the downstream PIPE mode.
 *
 * Extraction still preserves every valid BOM row. This setting controls only
 * downstream selection or FMR generation.
 *
 * @param {string} mode
 * @return {Object}
 */
function phase4VisionSavePipeMode(mode) {
  return phase4VisionSaveRuntimeConfig_({
    pipeMode: phase4VisionRuntimeNormalizePipeMode_(mode)
  });
}

/**
 * Saves the source-document type.
 *
 * ISO is currently operational. FMR becomes operational after
 * FMRCore.parseVisionFmrPage() is added.
 *
 * @param {string} documentType ISO or FMR
 * @return {Object}
 */
function phase4VisionSaveSourceDocumentType(documentType) {
  return phase4VisionSaveRuntimeConfig_({
    sourceDocumentType:
      phase4VisionRuntimeNormalizeDocumentType_(documentType)
  });
}

/**
 * Saves advanced execution settings.
 *
 * Supported fields:
 * - inputPrefix
 * - outputPrefix
 * - maximumFilesPerStart
 * - batchSize
 * - pollingMinutes
 * - cleanupCloudObjects
 * - operationOutputGracePolls
 *
 * @param {Object} options
 * @return {Object}
 */
function phase4VisionSaveProcessingSettings(options) {
  const source = options || {};
  const allowed = [
    'inputPrefix',
    'outputPrefix',
    'maximumFilesPerStart',
    'batchSize',
    'pollingMinutes',
    'cleanupCloudObjects',
    'operationOutputGracePolls'
  ];

  const updates = {};

  allowed.forEach(key => {
    if (source[key] !== undefined) {
      updates[key] = source[key];
    }
  });

  return phase4VisionSaveRuntimeConfig_(updates);
}

/**
 * Returns a setup/status object suitable for menus and troubleshooting.
 *
 * No credentials or secrets are stored in this configuration.
 *
 * @return {{
 *   readyForIso:boolean,
 *   readyForSelectedDocumentType:boolean,
 *   missing:string[],
 *   warnings:string[],
 *   fmrParserInstalled:boolean,
 *   folderName:string,
 *   config:Object
 * }}
 */
function phase4VisionGetRuntimeStatus() {
  const config = phase4VisionGetRuntimeConfig_();
  const missing = [];
  const warnings = [];
  let folderName = '';

  if (!config.projectId) {
    missing.push('Google Cloud project ID');
  }

  if (!config.bucket) {
    missing.push('Cloud Storage bucket');
  }

  if (!config.folderId) {
    missing.push('Drive input folder');
  } else {
    try {
      folderName = DriveApp.getFolderById(config.folderId).getName();
    } catch (error) {
      missing.push('Accessible Drive input folder');
      warnings.push(
        `The saved Drive folder could not be opened: ${error.message}`
      );
    }
  }

  const fmrParserInstalled =
    typeof FMRCore !== 'undefined' &&
    typeof FMRCore.parseVisionFmrPage === 'function';

  if (
    config.sourceDocumentType ===
      PHASE4_VISION_RUNTIME_CONFIG.documentTypes.FMR &&
    !fmrParserInstalled
  ) {
    warnings.push(
      'FMR is selected, but FMRCore.parseVisionFmrPage() is not installed yet.'
    );
  }

  return {
    readyForIso: missing.length === 0,
    readyForSelectedDocumentType:
      missing.length === 0 &&
      (
        config.sourceDocumentType !==
          PHASE4_VISION_RUNTIME_CONFIG.documentTypes.FMR ||
        fmrParserInstalled
      ),
    missing,
    warnings,
    fmrParserInstalled,
    folderName,
    config
  };
}

/**
 * Clears only saved runtime configuration values.
 *
 * This does not delete the controller's active-run state or trigger. Do not
 * use this while a Vision run is active.
 *
 * @return {Object} default configuration after clearing
 */
function phase4VisionClearRuntimeConfig() {
  const properties = phase4VisionRuntimeDocumentProperties_();
  const keys = PHASE4_VISION_RUNTIME_CONFIG.properties;

  Object.keys(keys).forEach(key => {
    properties.deleteProperty(keys[key]);
  });

  return phase4VisionGetRuntimeConfig_();
}

/* ========================================================================== */
/* NORMALIZATION                                                              */
/* ========================================================================== */

function phase4VisionNormalizeRuntimeValues_(config) {
  const source = config || {};
  const defaults = PHASE4_VISION_RUNTIME_CONFIG.defaults;

  return {
    projectId: phase4VisionRuntimeNormalizeProjectId_(
      source.projectId !== undefined
        ? source.projectId
        : defaults.projectId
    ),

    bucket: phase4VisionRuntimeNormalizeBucket_(
      source.bucket !== undefined
        ? source.bucket
        : defaults.bucket
    ),

    folderId: phase4VisionRuntimeNormalizeFolderId_(
      source.folderId !== undefined
        ? source.folderId
        : defaults.folderId
    ),

    inputPrefix: phase4VisionRuntimeNormalizeObjectPrefix_(
      source.inputPrefix || defaults.inputPrefix
    ),

    outputPrefix: phase4VisionRuntimeNormalizeObjectPrefix_(
      source.outputPrefix || defaults.outputPrefix
    ),

    sourceDocumentType:
      phase4VisionRuntimeNormalizeDocumentType_(
        source.sourceDocumentType || defaults.sourceDocumentType
      ),

    pipeMode: phase4VisionRuntimeNormalizePipeMode_(
      source.pipeMode || phase4VisionRuntimeDefaultPipeMode_()
    ),

    maximumFilesPerStart: phase4VisionRuntimeInteger_(
      source.maximumFilesPerStart,
      defaults.maximumFilesPerStart,
      PHASE4_VISION_RUNTIME_CONFIG.limits.maximumFilesMinimum,
      PHASE4_VISION_RUNTIME_CONFIG.limits.maximumFilesMaximum,
      'maximumFilesPerStart'
    ),

    batchSize: phase4VisionRuntimeInteger_(
      source.batchSize,
      defaults.batchSize,
      PHASE4_VISION_RUNTIME_CONFIG.limits.batchSizeMinimum,
      PHASE4_VISION_RUNTIME_CONFIG.limits.batchSizeMaximum,
      'batchSize'
    ),

    pollingMinutes: phase4VisionRuntimeNormalizePollingMinutes_(
      source.pollingMinutes,
      defaults.pollingMinutes
    ),

    cleanupCloudObjects: phase4VisionRuntimeBoolean_(
      source.cleanupCloudObjects,
      defaults.cleanupCloudObjects
    ),

    operationOutputGracePolls: phase4VisionRuntimeInteger_(
      source.operationOutputGracePolls,
      defaults.operationOutputGracePolls,
      PHASE4_VISION_RUNTIME_CONFIG.limits.gracePollsMinimum,
      PHASE4_VISION_RUNTIME_CONFIG.limits.gracePollsMaximum,
      'operationOutputGracePolls'
    )
  };
}

function phase4VisionRuntimeNormalizeProjectId_(value) {
  return String(value || '')
    .trim()
    .replace(/^projects\//i, '')
    .replace(/\/+$/, '');
}

function phase4VisionRuntimeNormalizeBucket_(value) {
  return String(value || '')
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/^https?:\/\/storage\.googleapis\.com\//i, '')
    .replace(/\/+$/, '');
}

function phase4VisionRuntimeNormalizeFolderId_(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  const urlMatch = text.match(
    /\/folders\/([A-Za-z0-9_-]{10,})/
  );

  const id = urlMatch ? urlMatch[1] : text;

  return /^[A-Za-z0-9_-]{10,}$/.test(id)
    ? id
    : '';
}

function phase4VisionRuntimeNormalizeObjectPrefix_(value) {
  return String(value || '')
    .trim()
    .replace(/^gs:\/\/[^/]+\/?/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

function phase4VisionRuntimeNormalizeDocumentType_(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();

  const allowed = Object.keys(
    PHASE4_VISION_RUNTIME_CONFIG.documentTypes
  ).map(key => PHASE4_VISION_RUNTIME_CONFIG.documentTypes[key]);

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid source document type "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function phase4VisionRuntimeNormalizePipeMode_(value) {
  if (
    typeof FMRCore !== 'undefined' &&
    typeof FMRCore.normalizeVisionPipeMode === 'function'
  ) {
    return FMRCore.normalizeVisionPipeMode(value);
  }

  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  const allowed = ['NORMAL', 'INCLUDE_PIPE', 'PIPE_ONLY'];

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid pipe mode "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}

function phase4VisionRuntimeDefaultPipeMode_() {
  if (
    typeof FMRCore !== 'undefined' &&
    typeof FMRCore.getVisionDefaultPipeMode === 'function'
  ) {
    return FMRCore.getVisionDefaultPipeMode();
  }

  return PHASE4_VISION_RUNTIME_CONFIG.defaults.pipeMode;
}

function phase4VisionRuntimeNormalizePollingMinutes_(value, fallback) {
  const isBlank =
    value === undefined ||
    value === null ||
    String(value).trim() === '';

  const parsed = isBlank
    ? Number(fallback)
    : Number(value);

  const candidate = Number.isFinite(parsed)
    ? Math.floor(parsed)
    : Number(fallback);

  if (
    PHASE4_VISION_RUNTIME_CONFIG.allowedPollingMinutes.indexOf(candidate) === -1
  ) {
    throw new Error(
      'pollingMinutes must be one of: ' +
      PHASE4_VISION_RUNTIME_CONFIG.allowedPollingMinutes.join(', ')
    );
  }

  return candidate;
}

function phase4VisionRuntimeInteger_(
  value,
  fallback,
  minimum,
  maximum,
  fieldName
) {
  const isBlank =
    value === undefined ||
    value === null ||
    String(value).trim() === '';

  const parsed = isBlank
    ? Number(fallback)
    : Number(value);

  const candidate = Number.isFinite(parsed)
    ? Math.floor(parsed)
    : Number(fallback);

  if (!Number.isFinite(candidate)) {
    throw new Error(`${fieldName} must be a number.`);
  }

  if (candidate < minimum || candidate > maximum) {
    throw new Error(
      `${fieldName} must be between ${minimum} and ${maximum}.`
    );
  }

  return candidate;
}

function phase4VisionRuntimeBoolean_(value, fallback) {
  if (value === true || value === false) {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }

  const normalized = String(value).trim().toUpperCase();

  if (['TRUE', 'YES', 'Y', '1', 'ON'].indexOf(normalized) !== -1) {
    return true;
  }

  if (['FALSE', 'NO', 'N', '0', 'OFF'].indexOf(normalized) !== -1) {
    return false;
  }

  throw new Error(
    `Invalid boolean value "${value}". Use true or false.`
  );
}

/* ========================================================================== */
/* STORAGE VALIDATION + PROPERTIES                                            */
/* ========================================================================== */

function phase4VisionValidateRuntimeValuesForStorage_(config) {
  if (config.projectId && /[\s/]/.test(config.projectId)) {
    throw new Error(
      'The Google Cloud project ID must not contain spaces or a URL path.'
    );
  }

  if (config.bucket && /[\s/]/.test(config.bucket)) {
    throw new Error(
      'The Cloud Storage bucket must be the bucket name only, without ' +
      'gs://, spaces, or an object path.'
    );
  }

  if (!config.inputPrefix) {
    throw new Error('The Cloud Storage input prefix cannot be blank.');
  }

  if (!config.outputPrefix) {
    throw new Error('The Cloud Storage output prefix cannot be blank.');
  }

  if (config.inputPrefix === config.outputPrefix) {
    throw new Error(
      'The Cloud Storage input and output prefixes must be different.'
    );
  }
}

function phase4VisionRuntimeDocumentProperties_() {
  const properties = PropertiesService.getDocumentProperties();

  if (!properties) {
    throw new Error(
      'Document properties are unavailable. ' +
      'Phase4_VisionRuntimeConfig.gs must run from the spreadsheet-bound ' +
      'Apps Script project.'
    );
  }

  return properties;
}
