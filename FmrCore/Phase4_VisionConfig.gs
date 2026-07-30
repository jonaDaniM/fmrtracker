//Phase4_VisionConfig.gs

const FMR_VISION_CONFIG = Object.freeze({
  schemaVersion: '1.0.0',
  parserVersion: 'coordinate-bom-v1',
  sheets: Object.freeze({
    jobs: 'Document_Extraction_Jobs',
    isoBomReference: 'ISO_BOM_Reference',
    review: 'Document_Extraction_Review',
    summary: 'Document_Run_Summary'
  }),


  defaults: Object.freeze({
    pipeMode: 'INCLUDE_PIPE',

    lineTolerance: 5,
    headerVerticalBand: 22,
    ptVerticalTolerance: 30,
    pointHorizontalTolerance: 20,
    headerRowOffset: 1,
    finalRowMaxHeight: 85,
    finalRowGap: 32,
    pointDescriptionAllowance: 12,
    commodityFarNumericDistance: 45,
    commodityLineWinnerGap: 35,
    quantityMaxDistance: 20,
    quantityWinnerGap: 8,

    /**
     * An 8-point median word height represents a coordinate scale of 1.0.
     */
    referenceWordHeight: 8,
    minimumCoordinateScale: 0.5,
    maximumCoordinateScale: 3
  }),

  pipeModes: Object.freeze({
    NORMAL: 'NORMAL',
    INCLUDE_PIPE: 'INCLUDE_PIPE',
    PIPE_ONLY: 'PIPE_ONLY'
  }),

  documentTypes: Object.freeze({
    ISO: 'ISO',
    FMR: 'FMR',
    UNKNOWN: 'UNKNOWN'
  }),

  pageClasses: Object.freeze({
    ISO: 'ISO',
    PARTIAL_ISO: 'PARTIAL_ISO_STRUCTURE',
    WELD_LOG: 'WELD_LOG',
    PIPE_SUPPORT_ATTACHMENT: 'PIPE_SUPPORT_ATTACHMENT',
    EXISTING_FMR: 'EXISTING_FMR',
    LOGISTICS: 'LOGISTICS_PAGE',
    WORKFLOW_INDEX: 'WORKFLOW_INDEX',
    OTHER: 'OTHER'
  }),

  recordStatuses: Object.freeze({
    ACCEPTED: 'ACCEPTED',
    QUARANTINED: 'QUARANTINED',
    DUPLICATE: 'DUPLICATE',
    SUPERSEDED: 'SUPERSEDED',
    FILTERED: 'FILTERED'
  }),

  jobStatuses: Object.freeze({
    PENDING_UPLOAD: 'PENDING_UPLOAD',
    SUBMITTED: 'SUBMITTED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
  }),

  runStatuses: Object.freeze({
    CREATED: 'CREATED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
    FAILED: 'FAILED'
  }),

  reviewReasons: Object.freeze({
    PARTIAL_ISO_STRUCTURE: 'partial_iso_structure',
    MISSING_FULL_TEXT_ANNOTATION:
      'missing_full_text_annotation',
    MISSING_DRAWING_NUMBER:
      'missing_drawing_number',
    MISSING_REVISION:
      'missing_revision',
    ISOMETRIC_HEADER_MISSING:
      'isometric_header_missing',
    REV_TOKEN_MISSING:
      'rev_token_missing',
    BOM_HEADER_MISSING:
      'bom_header_missing',
    BOM_COLUMNS_OUT_OF_ORDER:
      'bom_columns_out_of_order',
    DUPLICATE_RETAINED_BOM_POINTS:
      'duplicate_retained_bom_points',
    MISSING_DESCRIPTION:
      'missing_description',
    MISSING_NOMINAL_SIZE:
      'missing_nominal_size',
    INVALID_NOMINAL_SIZE:
      'invalid_nominal_size',
    MISSING_COMMODITY_CODE:
      'missing_commodity_code',
    MULTIPLE_COMMODITY_CODE_CANDIDATES:
      'multiple_commodity_code_candidates',
    MISSING_QUANTITY:
      'missing_quantity',
    QUANTITY_CANDIDATE_TOO_FAR:
      'quantity_candidate_too_far',
    MULTIPLE_QUANTITY_CANDIDATES:
      'multiple_quantity_candidates',
    IGNORED_NUMERIC_ANNOTATION:
      'ignored_numeric_annotation',
    UNORDERABLE_MULTIPLE_REVISIONS:
      'unorderable_multiple_revisions',
    DUPLICATE_REVISION_CONFLICT:
      'duplicate_revision_conflict',
    FILTERED_BY_PIPE_MODE:
      'filtered_by_pipe_mode'
  }),

  regex: Object.freeze({
    /**
     * Point 0 is intentionally invalid because it commonly belongs to
     * revision history rather than the BOM.
     */
    point: /^[1-9]\d{0,2}$/,

    number: /^\d+(?:\.\d+)?$/,

    quantity: /^\d+(?:\.\d+)?(?:['′])?$/,

    code: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,

    /**
     * Examples:
     * 1
     * 3/4
     * 1 1/2
     * 2X1
     * 1 1/2X1 1/2
     */
    size:
      /^(?:\d+(?:\s+\d+\/\d+)?|\d+\/\d+)(?:X(?:\d+(?:\s+\d+\/\d+)?|\d+\/\d+))?$/,

    revision: /^[A-Za-z0-9]+$/,

    /**
     * PIPE SCH 80 is pipe stock.
     * PIPET is not pipe stock.
     */
    pipe: /^\s*PIPE(?:\s|$)/i,

    /**
     * Support descriptions commonly begin with codes such as:
     * 5CI,
     * 5UG,
     * 5MS15-15,
     */
    supportDescription: /^5[A-Z0-9-]+,/i,

    /**
     * Exact page markers used for deterministic page classification.
     */
    isoTitleMarker:
      /ISOMETRIC\s+DRAWING\s+NUMBER/i,

    bomMarker:
      /BILL\s+OF\s+MATERIALS/i,

    issuedForConstruction:
      /ISSUED\s+FOR\s+CONSTRUCTION/i
  }),

  /**
   * Accepted ISO BOM record contract.
   *
   * One row represents one retained ISO BOM point.
   * PIPE rows remain in this table and are identified using is_pipe.
   */
  bomHeaders: Object.freeze([
    'run_id',
    'source_file_id',
    'source_pdf',
    'source_page',
    'iwp_number',
    'drawing_number',
    'revision',
    'point_number',
    'description',
    'nominal_size',
    'commodity_code',
    'quantity',
    'is_pipe',
    'raw_row_text',
    'bbox_x0',
    'bbox_y0',
    'bbox_x1',
    'bbox_y1',
    'ocr_derived',
    'structural_notes',
    'status',
    'review_reasons',
    'content_hash'
  ]),

  /**
   * Quarantined page or row contract.
   */
  reviewHeaders: Object.freeze([
    'run_id',
    'source_file_id',
    'source_pdf',
    'source_page',
    'iwp_number',
    'drawing_number',
    'revision',
    'point_number',
    'raw_row_text',
    'bbox_x0',
    'bbox_y0',
    'bbox_x1',
    'bbox_y1',
    'reason_codes',
    'page_class',
    'ocr_derived',
    'created_at'
  ]),

  /**
   * Asynchronous Cloud Vision job contract.
   *
   * The runtime job controller will be implemented in the bound spreadsheet
   * project, but both projects must use this same column contract.
   */
  jobHeaders: Object.freeze([
    'run_id',
    'source_file_id',
    'source_pdf',
    'source_document_type',
    'gcs_input_uri',
    'gcs_output_uri',
    'vision_operation_name',
    'status',
    'submitted_at',
    'completed_at',
    'message'
  ]),

  /**
   * Extraction-run summary contract.
   */
  summaryHeaders: Object.freeze([
    'run_id',
    'started_at',
    'completed_at',
    'source_document_type',
    'pipe_mode',
    'source_files',
    'pages_seen',
    'iso_pages',
    'accepted_rows',
    'quarantined_rows',
    'pipe_rows',
    'duplicate_rows',
    'status',
    'message'
  ])
});

/**
 * OAuth scopes required by the complete host workflow.
 *
 * The bound spreadsheet project must declare these scopes in its
 * appsscript.json manifest.
 *
 * FMRCore exposes this list as a convenience but does not request, store, or
 * manage authorization itself.
 */
const FMR_VISION_REQUIRED_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.container.ui'
]);

/* ========================================================================== */
/* PUBLIC, DEPLOYMENT-NEUTRAL ACCESSORS                                       */
/* ========================================================================== */

/**
 * Returns the OAuth scopes the bound spreadsheet project must declare.
 *
 * @return {string[]}
 */
function getVisionRequiredScopes() {
  return Array.from(FMR_VISION_REQUIRED_SCOPES);
}

function getVisionPipeModes() {
  return Object.assign(
    {},
    FMR_VISION_CONFIG.pipeModes
  );
}

function getVisionDefaultPipeMode() {
  return FMR_VISION_CONFIG.defaults.pipeMode;
}

function normalizeVisionPipeMode(mode) {
  const normalized = String(mode || '')
    .trim()
    .toUpperCase();

  const allowed = Object.keys(
    FMR_VISION_CONFIG.pipeModes
  ).map(key =>
    FMR_VISION_CONFIG.pipeModes[key]
  );

  if (allowed.indexOf(normalized) === -1) {
    throw new Error(
      `Invalid pipe mode "${mode}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return normalized;
}


function getVisionSheetNames() {
  return Object.assign(
    {},
    FMR_VISION_CONFIG.sheets
  );
}

function getVisionHeaderDefinitions() {
  return {
    bom: Array.from(
      FMR_VISION_CONFIG.bomHeaders
    ),

    review: Array.from(
      FMR_VISION_CONFIG.reviewHeaders
    ),

    jobs: Array.from(
      FMR_VISION_CONFIG.jobHeaders
    ),

    summary: Array.from(
      FMR_VISION_CONFIG.summaryHeaders
    )
  };
}

/**
 * Returns parser and schema version information.
 *
 * @return {{
 *   schemaVersion:string,
 *   parserVersion:string
 * }}
 */
function getVisionVersionInfo() {
  return {
    schemaVersion:
      FMR_VISION_CONFIG.schemaVersion,

    parserVersion:
      FMR_VISION_CONFIG.parserVersion
  };
}


function createVisionRunId_() {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  return (
    `${timestamp}-` +
    Utilities.getUuid().slice(0, 8)
  );
}

/**
 * Normalizes text for page classification and exact marker checks.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeVisionText_(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes whitespace while preserving original letter case.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeVisionWhitespace_(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function normalizeVisionSize_(value) {
  return normalizeVisionWhitespace_(value)
    .replace(/[×x]/g, 'X')
    .replace(/⁄/g, '/')
    .replace(/½/g, ' 1/2')
    .replace(/¼/g, ' 1/4')
    .replace(/¾/g, ' 3/4')
    .replace(/\s*X\s*/g, 'X')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVisionPipeStock_(description) {
  return FMR_VISION_CONFIG.regex.pipe.test(
    String(description || '')
  );
}

/**
 * Escapes literal text before placing it inside a regular expression.
 *
 * @param {*} value
 * @return {string}
 */
function escapeVisionRegex_(value) {
  return String(value || '').replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}