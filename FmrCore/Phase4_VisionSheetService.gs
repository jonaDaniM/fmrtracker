//Phase4_VisionSheetService.gs
function setupVisionExtractionSheets(spreadsheetId) {
  const normalizedSpreadsheetId =
    normalizeVisionSpreadsheetId_(spreadsheetId);

  const spreadsheet =
    SpreadsheetApp.openById(normalizedSpreadsheetId);

  const jobsSheet = ensureVisionSheet_(
    spreadsheet,
    FMR_VISION_CONFIG.sheets.jobs,
    FMR_VISION_CONFIG.jobHeaders
  );

  const referenceSheet = ensureVisionSheet_(
    spreadsheet,
    FMR_VISION_CONFIG.sheets.isoBomReference,
    FMR_VISION_CONFIG.bomHeaders
  );

  const reviewSheet = ensureVisionSheet_(
    spreadsheet,
    FMR_VISION_CONFIG.sheets.review,
    FMR_VISION_CONFIG.reviewHeaders
  );

  const summarySheet = ensureVisionSheet_(
    spreadsheet,
    FMR_VISION_CONFIG.sheets.summary,
    FMR_VISION_CONFIG.summaryHeaders
  );

  formatVisionJobsSheet_(jobsSheet);
  formatVisionReferenceSheet_(referenceSheet);
  formatVisionReviewSheet_(reviewSheet);
  formatVisionSummarySheet_(summarySheet);

  return {
    jobs: jobsSheet.getName(),
    isoBomReference: referenceSheet.getName(),
    review: reviewSheet.getName(),
    summary: summarySheet.getName()
  };
}

/**
 * Reconciles accepted parser records with the existing ISO reference table,
 * then appends new review records.
 *
 * This is the public method the bound spreadsheet job controller should call.
 *
 * The method is idempotent:
 * - Reprocessing the same source file/page does not duplicate reference rows.
 * - Exact duplicate documents are counted and omitted after the first copy.
 * - A newly received higher numeric revision marks lower revisions
 *   SUPERSEDED.
 *
 * @param {string} spreadsheetId
 * @param {Object[]=} records Accepted parser records.
 * @param {Object[]=} reviews Parser-generated review records.
 * @return {{
 *   receivedRecords:number,
 *   acceptedRows:number,
 *   supersededRows:number,
 *   referenceRows:number,
 *   newReviewRows:number,
 *   quarantinedRows:number,
 *   duplicateRows:number,
 *   duplicateDocuments:number,
 *   invalidInputRows:number
 * }}
 */
function appendVisionExtractionResults(
  spreadsheetId,
  records,
  reviews
) {
  const normalizedSpreadsheetId =
    normalizeVisionSpreadsheetId_(spreadsheetId);

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Vision extraction results are already being written. ' +
      'Try again after the current write completes.'
    );
  }

  try {
    setupVisionExtractionSheets(
      normalizedSpreadsheetId
    );

    const spreadsheet =
      SpreadsheetApp.openById(
        normalizedSpreadsheetId
      );

    const referenceSheet =
      spreadsheet.getSheetByName(
        FMR_VISION_CONFIG
          .sheets
          .isoBomReference
      );

    const reviewSheet =
      spreadsheet.getSheetByName(
        FMR_VISION_CONFIG
          .sheets
          .review
      );

    const existingRecords =
      readVisionObjectsFromSheet_(
        referenceSheet,
        FMR_VISION_CONFIG.bomHeaders
      );

    const normalizedExisting =
      normalizeVisionInputRecords_(
        existingRecords
      );

    const normalizedInput =
      normalizeVisionInputRecords_(
        Array.isArray(records)
          ? records
          : []
      );

    const combinedRecords =
      normalizedExisting.validRecords.concat(
        normalizedInput.validRecords
      );

    const resolution =
      resolveVisionReferenceRecords_(
        combinedRecords
      );

    replaceVisionSheetObjects_(
      referenceSheet,
      FMR_VISION_CONFIG.bomHeaders,
      resolution.referenceRecords
    );

    const incomingReviews =
      normalizeVisionReviewRecords_(
        Array.isArray(reviews)
          ? reviews
          : []
      );

    const allCandidateReviews =
      incomingReviews
        .concat(
          normalizedExisting.invalidReviews
        )
        .concat(
          normalizedInput.invalidReviews
        )
        .concat(
          resolution.reviews
        );

    const reviewWriteResult =
      appendUniqueVisionReviews_(
        reviewSheet,
        allCandidateReviews
      );

    formatVisionReferenceSheet_(
      referenceSheet
    );

    formatVisionReviewSheet_(
      reviewSheet
    );

    SpreadsheetApp.flush();

    return {
      receivedRecords:
        Array.isArray(records)
          ? records.length
          : 0,

      acceptedRows:
        resolution.referenceRecords
          .filter(record =>
            record.status ===
              FMR_VISION_CONFIG
                .recordStatuses
                .ACCEPTED
          )
          .length,

      supersededRows:
        resolution.referenceRecords
          .filter(record =>
            record.status ===
              FMR_VISION_CONFIG
                .recordStatuses
                .SUPERSEDED
          )
          .length,

      referenceRows:
        resolution.referenceRecords.length,

      newReviewRows:
        reviewWriteResult.appended,

      quarantinedRows:
        allCandidateReviews.length,

      duplicateRows:
        resolution.duplicateRows,

      duplicateDocuments:
        resolution.duplicateDocuments,

      invalidInputRows:
        normalizedExisting.invalidReviews.length +
        normalizedInput.invalidReviews.length
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Re-runs revision and duplicate reconciliation using the records currently
 * stored in ISO_BOM_Reference.
 *
 * This is useful after a code update or a controlled manual correction.
 *
 * @param {string} spreadsheetId
 * @return {Object}
 */
function rebuildVisionReferenceIndex(
  spreadsheetId
) {
  return appendVisionExtractionResults(
    spreadsheetId,
    [],
    []
  );
}

/**
 * Ensures the extraction sheets exist, then returns current row counts.
 *
 * @param {string} spreadsheetId
 * @return {{
 *   referenceRows:number,
 *   acceptedRows:number,
 *   supersededRows:number,
 *   pipeRows:number,
 *   reviewRows:number,
 *   jobRows:number,
 *   summaryRows:number
 * }}
 */
function getVisionExtractionSheetStatus(
  spreadsheetId
) {
  const normalizedSpreadsheetId =
    normalizeVisionSpreadsheetId_(spreadsheetId);

  setupVisionExtractionSheets(
    normalizedSpreadsheetId
  );

  const spreadsheet =
    SpreadsheetApp.openById(
      normalizedSpreadsheetId
    );

  const referenceRecords =
    readVisionObjectsFromSheet_(
      spreadsheet.getSheetByName(
        FMR_VISION_CONFIG
          .sheets
          .isoBomReference
      ),
      FMR_VISION_CONFIG.bomHeaders
    );

  return {
    referenceRows:
      referenceRecords.length,

    acceptedRows:
      referenceRecords.filter(record =>
        record.status ===
          FMR_VISION_CONFIG
            .recordStatuses
            .ACCEPTED
      ).length,

    supersededRows:
      referenceRecords.filter(record =>
        record.status ===
          FMR_VISION_CONFIG
            .recordStatuses
            .SUPERSEDED
      ).length,

    pipeRows:
      referenceRecords.filter(record =>
        normalizeVisionBoolean_(
          record.is_pipe
        )
      ).length,

    reviewRows:
      countVisionDataRows_(
        spreadsheet.getSheetByName(
          FMR_VISION_CONFIG
            .sheets
            .review
        )
      ),

    jobRows:
      countVisionDataRows_(
        spreadsheet.getSheetByName(
          FMR_VISION_CONFIG
            .sheets
            .jobs
        )
      ),

    summaryRows:
      countVisionDataRows_(
        spreadsheet.getSheetByName(
          FMR_VISION_CONFIG
            .sheets
            .summary
        )
      )
  };
}

/**
 * Temporary internal compatibility wrapper for the original package.
 *
 * The corrected bound job controller should call:
 * FMRCore.appendVisionExtractionResults(...)
 *
 * @param {string} spreadsheetId
 * @param {Object[]} records
 * @param {Object[]} reviews
 * @return {Object}
 */
function appendVisionRecords_(
  spreadsheetId,
  records,
  reviews
) {
  return appendVisionExtractionResults(
    spreadsheetId,
    records,
    reviews
  );
}

/* ========================================================================== */
/* SHEET CREATION + HEADER SAFETY                                             */
/* ========================================================================== */

function ensureVisionSheet_(
  spreadsheet,
  sheetName,
  headers
) {
  let sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {
    sheet =
      spreadsheet.insertSheet(
        sheetName
      );
  }

  const requiredColumnCount =
    headers.length;

  if (
    sheet.getMaxColumns() <
    requiredColumnCount
  ) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumnCount -
        sheet.getMaxColumns()
    );
  }

  const existingHeaders =
    sheet.getRange(
      1,
      1,
      1,
      requiredColumnCount
    )
    .getDisplayValues()[0]
    .map(value =>
      String(value || '').trim()
    );

  const hasExistingHeader =
    existingHeaders.some(Boolean);

  const headersMatch =
    headers.every(
      (header, index) =>
        existingHeaders[index] ===
        header
    );

  const hasData =
    sheet.getLastRow() > 1 &&
    countVisionDataRows_(sheet) > 0;

  if (
    hasExistingHeader &&
    !headersMatch &&
    hasData
  ) {
    throw new Error(
      `Sheet "${sheetName}" contains data but its headers do not match ` +
      'the current Phase 4 data contract. Back up or rename the sheet ' +
      'before running setup again.'
    );
  }

  if (!headersMatch) {
    sheet.getRange(
      1,
      1,
      1,
      requiredColumnCount
    ).setValues([
      Array.from(headers)
    ]);
  }

  sheet.setFrozenRows(1);

  sheet.getRange(
    1,
    1,
    1,
    requiredColumnCount
  )
  .setBackground('#1F4E78')
  .setFontColor('#FFFFFF')
  .setFontWeight('bold')
  .setHorizontalAlignment('center')
  .setVerticalAlignment('middle')
  .setWrap(true);

  sheet.setRowHeight(1, 38);

  return sheet;
}

function formatVisionJobsSheet_(sheet) {
  applyVisionColumnWidths_(
    sheet,
    [
      190, 180, 280, 150, 320, 320,
      320, 150, 155, 155, 360
    ]
  );

  applyVisionDateFormatByHeader_(
    sheet,
    FMR_VISION_CONFIG.jobHeaders,
    [
      'submitted_at',
      'completed_at'
    ]
  );

  applyVisionListValidationByHeader_(
    sheet,
    FMR_VISION_CONFIG.jobHeaders,
    'status',
    Object.keys(
      FMR_VISION_CONFIG.jobStatuses
    ).map(key =>
      FMR_VISION_CONFIG
        .jobStatuses[key]
    )
  );

  ensureVisionFilter_(sheet);
}

function formatVisionReferenceSheet_(sheet) {
  applyVisionColumnWidths_(
    sheet,
    [
      190, 180, 280, 95, 190, 240,
      90, 95, 420, 110, 190, 100,
      90, 500, 95, 95, 95, 95,
      110, 250, 140, 300, 320
    ]
  );

  applyVisionListValidationByHeader_(
    sheet,
    FMR_VISION_CONFIG.bomHeaders,
    'status',
    Object.keys(
      FMR_VISION_CONFIG.recordStatuses
    ).map(key =>
      FMR_VISION_CONFIG
        .recordStatuses[key]
    )
  );

  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const isPipeColumn =
      FMR_VISION_CONFIG
        .bomHeaders
        .indexOf('is_pipe') + 1;

    const ocrColumn =
      FMR_VISION_CONFIG
        .bomHeaders
        .indexOf('ocr_derived') + 1;

    sheet.getRange(
      2,
      isPipeColumn,
      lastRow - 1,
      1
    ).setHorizontalAlignment(
      'center'
    );

    sheet.getRange(
      2,
      ocrColumn,
      lastRow - 1,
      1
    ).setHorizontalAlignment(
      'center'
    );
  }

  ensureVisionFilter_(sheet);
}

function formatVisionReviewSheet_(sheet) {
  applyVisionColumnWidths_(
    sheet,
    [
      190, 180, 280, 95, 190, 240,
      90, 95, 520, 95, 95, 95,
      95, 360, 190, 110, 155
    ]
  );

  applyVisionDateFormatByHeader_(
    sheet,
    FMR_VISION_CONFIG.reviewHeaders,
    ['created_at']
  );

  ensureVisionFilter_(sheet);
}

function formatVisionSummarySheet_(sheet) {
  applyVisionColumnWidths_(
    sheet,
    [
      190, 155, 155, 160, 140, 110,
      110, 110, 120, 140, 110, 120,
      180, 360
    ]
  );

  applyVisionDateFormatByHeader_(
    sheet,
    FMR_VISION_CONFIG.summaryHeaders,
    [
      'started_at',
      'completed_at'
    ]
  );

  applyVisionListValidationByHeader_(
    sheet,
    FMR_VISION_CONFIG.summaryHeaders,
    'status',
    Object.keys(
      FMR_VISION_CONFIG.runStatuses
    ).map(key =>
      FMR_VISION_CONFIG
        .runStatuses[key]
    )
  );

  ensureVisionFilter_(sheet);
}

function applyVisionColumnWidths_(
  sheet,
  widths
) {
  widths.forEach(
    (width, index) => {
      if (
        index + 1 <=
        sheet.getMaxColumns()
      ) {
        sheet.setColumnWidth(
          index + 1,
          width
        );
      }
    }
  );
}

function applyVisionDateFormatByHeader_(
  sheet,
  headers,
  dateHeaders
) {
  const lastRow =
    sheet.getLastRow();

  if (lastRow <= 1) {
    return;
  }

  dateHeaders.forEach(header => {
    const column =
      headers.indexOf(header) + 1;

    if (column <= 0) {
      return;
    }

    sheet.getRange(
      2,
      column,
      lastRow - 1,
      1
    ).setNumberFormat(
      'yyyy-mm-dd hh:mm:ss'
    );
  });
}

function applyVisionListValidationByHeader_(
  sheet,
  headers,
  targetHeader,
  allowedValues
) {
  const lastRow =
    sheet.getLastRow();

  if (
    lastRow <= 1 ||
    !allowedValues.length
  ) {
    return;
  }

  const column =
    headers.indexOf(
      targetHeader
    ) + 1;

  if (column <= 0) {
    return;
  }

  const validation =
    SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        allowedValues,
        true
      )
      .setAllowInvalid(false)
      .build();

  sheet.getRange(
    2,
    column,
    lastRow - 1,
    1
  ).setDataValidation(
    validation
  );
}

function ensureVisionFilter_(sheet) {
  if (sheet.getLastColumn() === 0) {
    return;
  }

  const existingFilter =
    sheet.getFilter();

  if (existingFilter) {
    const range =
      existingFilter.getRange();

    const alreadyCoversGrid =
      range.getRow() === 1 &&
      range.getColumn() === 1 &&
      range.getNumRows() >=
        sheet.getMaxRows() &&
      range.getNumColumns() >=
        sheet.getLastColumn();

    if (alreadyCoversGrid) {
      return;
    }

    existingFilter.remove();
  }

  sheet.getRange(
    1,
    1,
    sheet.getMaxRows(),
    sheet.getLastColumn()
  ).createFilter();
}

/* ========================================================================== */
/* INPUT NORMALIZATION                                                        */
/* ========================================================================== */

function normalizeVisionInputRecords_(
  records
) {
  const validRecords = [];
  const invalidReviews = [];

  (records || []).forEach(record => {
    const normalized =
      normalizeVisionBomRecord_(
        record
      );

    const missingFields =
      getMissingVisionBomFields_(
        normalized
      );

    if (missingFields.length > 0) {
      invalidReviews.push(
        reviewFromVisionRecord_(
          normalized,
          (
            'sheet_service_missing_required_fields:' +
            missingFields.join(',')
          )
        )
      );

      return;
    }

    validRecords.push(
      normalized
    );
  });

  return {
    validRecords,
    invalidReviews
  };
}

function normalizeVisionBomRecord_(
  record
) {
  const source =
    record || {};

  const normalized = {};

  FMR_VISION_CONFIG
    .bomHeaders
    .forEach(header => {
      normalized[header] =
        source[header] === undefined ||
        source[header] === null
          ? ''
          : source[header];
    });

  normalized.run_id =
    String(
      normalized.run_id || ''
    ).trim();

  normalized.source_file_id =
    String(
      normalized.source_file_id || ''
    ).trim();

  normalized.source_pdf =
    String(
      normalized.source_pdf || ''
    ).trim();

  normalized.drawing_number =
    normalizeVisionWhitespace_(
      normalized.drawing_number
    );

  normalized.revision =
    normalizeVisionWhitespace_(
      normalized.revision
    );

  normalized.point_number =
    normalizeVisionPointValue_(
      normalized.point_number
    );

  normalized.description =
    normalizeVisionWhitespace_(
      normalized.description
    );

  normalized.nominal_size =
    normalizeVisionSize_(
      normalized.nominal_size
    );

  normalized.commodity_code =
    normalizeVisionWhitespace_(
      normalized.commodity_code
    );

  normalized.quantity =
    normalizeVisionWhitespace_(
      normalized.quantity
    );

  normalized.is_pipe =
    normalized.is_pipe === '' ||
    normalized.is_pipe === null
      ? isVisionPipeStock_(
          normalized.description
        )
      : normalizeVisionBoolean_(
          normalized.is_pipe
        );

  normalized.ocr_derived =
    normalizeVisionBoolean_(
      normalized.ocr_derived
    );

  normalized.structural_notes =
    normalizeVisionWhitespace_(
      normalized.structural_notes
    );

  normalized.review_reasons =
    normalizeVisionWhitespace_(
      normalized.review_reasons
    );

  normalized.status =
    FMR_VISION_CONFIG
      .recordStatuses
      .ACCEPTED;

  normalized.content_hash =
    normalizeVisionWhitespace_(
      normalized.content_hash
    ) ||
    hashVisionCanonicalRow_(
      normalized
    );

  return normalized;
}

function getMissingVisionBomFields_(
  record
) {
  const requiredFields = [
    'run_id',
    'source_file_id',
    'source_pdf',
    'source_page',
    'drawing_number',
    'revision',
    'point_number',
    'description',
    'nominal_size',
    'commodity_code',
    'quantity',
    'content_hash'
  ];

  return requiredFields.filter(
    field => {
      const value =
        record[field];

      return (
        value === '' ||
        value === null ||
        value === undefined
      );
    }
  );
}

function normalizeVisionReviewRecords_(
  reviews
) {
  return (reviews || [])
    .map(review =>
      normalizeVisionReviewRecord_(
        review
      )
    )
    .filter(review =>
      review.reason_codes ||
      review.raw_row_text
    );
}

function normalizeVisionReviewRecord_(
  review
) {
  const source =
    review || {};

  const normalized = {};

  FMR_VISION_CONFIG
    .reviewHeaders
    .forEach(header => {
      normalized[header] =
        source[header] === undefined ||
        source[header] === null
          ? ''
          : source[header];
    });

  normalized.run_id =
    String(
      normalized.run_id || ''
    ).trim();

  normalized.source_file_id =
    String(
      normalized.source_file_id || ''
    ).trim();

  normalized.source_pdf =
    String(
      normalized.source_pdf || ''
    ).trim();

  normalized.drawing_number =
    normalizeVisionWhitespace_(
      normalized.drawing_number
    );

  normalized.revision =
    normalizeVisionWhitespace_(
      normalized.revision
    );

  normalized.point_number =
    normalized.point_number === ''
      ? ''
      : normalizeVisionPointValue_(
          normalized.point_number
        );

  normalized.raw_row_text =
    normalizeVisionWhitespace_(
      normalized.raw_row_text
    );

  normalized.reason_codes =
    normalizeVisionReasonCodesForSheet_(
      normalized.reason_codes
    );

  normalized.page_class =
    normalizeVisionWhitespace_(
      normalized.page_class
    );

  normalized.ocr_derived =
    normalizeVisionBoolean_(
      normalized.ocr_derived
    );

  normalized.created_at =
    normalized.created_at instanceof Date
      ? normalized.created_at
      : new Date();

  return normalized;
}

/* ========================================================================== */
/* REVISION + DUPLICATE RESOLUTION                                            */
/* ========================================================================== */

/**
 * Resolves records at the source-document/page level.
 *
 * A document occurrence is:
 * source_file_id + source_page + drawing_number + revision
 *
 * The occurrence hash is based on the ordered BOM points, not on one row.
 * This is essential because different BOM points naturally have different
 * row-level content hashes.
 *
 * @param {Object[]} records
 * @return {{
 *   referenceRecords:Object[],
 *   reviews:Object[],
 *   duplicateRows:number,
 *   duplicateDocuments:number
 * }}
 */
function resolveVisionReferenceRecords_(
  records
) {
  const rowDeduplication =
    deduplicateVisionRowsBySource_(
      records || []
    );

  const occurrenceBuild =
    buildVisionOccurrences_(
      rowDeduplication.records
    );

  const validOccurrences =
    occurrenceBuild.occurrences;

  const reviews =
    occurrenceBuild.reviews.slice();

  let duplicateRows =
    rowDeduplication.duplicateRows;

  let duplicateDocuments = 0;

  const byDrawing = {};

  validOccurrences.forEach(
    occurrence => {
      if (
        !byDrawing[
          occurrence.drawingNumber
        ]
      ) {
        byDrawing[
          occurrence.drawingNumber
        ] = [];
      }

      byDrawing[
        occurrence.drawingNumber
      ].push(
        occurrence
      );
    }
  );

  const referenceRecords = [];

  Object.keys(byDrawing)
    .sort()
    .forEach(drawingNumber => {
      const drawingOccurrences =
        byDrawing[drawingNumber];

      const revisions =
        Array.from(
          new Set(
            drawingOccurrences.map(
              occurrence =>
                occurrence.revisionKey
            )
          )
        );

      const numericRevisions =
        revisions.filter(
          revision =>
            /^\d+$/.test(
              revision
            )
        );

      const nonnumericRevisions =
        revisions.filter(
          revision =>
            !/^\d+$/.test(
              revision
            )
        );

      let activeRevision = '';

      if (
        numericRevisions.length ===
          revisions.length &&
        numericRevisions.length > 0
      ) {
        activeRevision =
          numericRevisions
            .map(Number)
            .sort(
              (first, second) =>
                second - first
            )[0]
            .toString();
      } else if (
        nonnumericRevisions.length === 1 &&
        numericRevisions.length === 0
      ) {
        activeRevision =
          nonnumericRevisions[0];
      } else {
        drawingOccurrences.forEach(
          occurrence => {
            occurrence.records.forEach(
              record => {
                reviews.push(
                  reviewFromVisionRecord_(
                    record,
                    (
                      FMR_VISION_CONFIG
                        .reviewReasons
                        .UNORDERABLE_MULTIPLE_REVISIONS +
                      ':' +
                      revisions.join(',')
                    )
                  )
                );
              }
            );
          }
        );

        return;
      }

      const byRevision = {};

      drawingOccurrences.forEach(
        occurrence => {
          if (
            !byRevision[
              occurrence.revisionKey
            ]
          ) {
            byRevision[
              occurrence.revisionKey
            ] = [];
          }

          byRevision[
            occurrence.revisionKey
          ].push(
            occurrence
          );
        }
      );

      Object.keys(byRevision)
        .sort(
          compareVisionRevisionValues_
        )
        .forEach(revision => {
          const revisionOccurrences =
            byRevision[revision];

          const byOccurrenceHash = {};

          revisionOccurrences.forEach(
            occurrence => {
              if (
                !byOccurrenceHash[
                  occurrence.contentHash
                ]
              ) {
                byOccurrenceHash[
                  occurrence.contentHash
                ] = [];
              }

              byOccurrenceHash[
                occurrence.contentHash
              ].push(
                occurrence
              );
            }
          );

          const hashes =
            Object.keys(
              byOccurrenceHash
            );

          if (hashes.length > 1) {
            revisionOccurrences.forEach(
              occurrence => {
                occurrence.records.forEach(
                  record => {
                    reviews.push(
                      reviewFromVisionRecord_(
                        record,
                        FMR_VISION_CONFIG
                          .reviewReasons
                          .DUPLICATE_REVISION_CONFLICT
                      )
                    );
                  }
                );
              }
            );

            return;
          }

          const identicalOccurrences =
            byOccurrenceHash[
              hashes[0]
            ]
            .slice()
            .sort(
              compareVisionOccurrences_
            );

          const retainedOccurrence =
            identicalOccurrences[0];

          identicalOccurrences
            .slice(1)
            .forEach(
              duplicateOccurrence => {
                duplicateDocuments++;

                duplicateRows +=
                  duplicateOccurrence
                    .records
                    .length;
              }
            );

          const isActiveRevision =
            revision ===
            activeRevision;

          retainedOccurrence.records
            .forEach(record => {
              const output =
                Object.assign(
                  {},
                  record
                );

              output.status =
                isActiveRevision
                  ? FMR_VISION_CONFIG
                      .recordStatuses
                      .ACCEPTED
                  : FMR_VISION_CONFIG
                      .recordStatuses
                      .SUPERSEDED;

              output.review_reasons = '';

              if (!isActiveRevision) {
                output.structural_notes =
                  appendVisionStructuralNote_(
                    output.structural_notes,
                    (
                      'superseded_by_revision:' +
                      activeRevision
                    )
                  );
              }

              referenceRecords.push(
                output
              );
            });
        });
    });

  referenceRecords.sort(
    compareVisionReferenceRecords_
  );

  return {
    referenceRecords,
    reviews,
    duplicateRows,
    duplicateDocuments
  };
}

function deduplicateVisionRowsBySource_(
  records
) {
  const seen = {};
  const output = [];
  let duplicateRows = 0;

  (records || []).forEach(record => {
    const key = [
      record.source_file_id,
      record.source_page,
      normalizeVisionText_(
        record.drawing_number
      ),
      normalizeVisionText_(
        record.revision
      ),
      record.point_number,
      record.content_hash
    ].join('|');

    if (seen[key]) {
      duplicateRows++;
      return;
    }

    seen[key] = true;
    output.push(
      normalizeVisionBomRecord_(
        record
      )
    );
  });

  return {
    records: output,
    duplicateRows
  };
}

function buildVisionOccurrences_(
  records
) {
  const byOccurrence = {};
  const reviews = [];

  (records || []).forEach(record => {
    const key =
      buildVisionOccurrenceKey_(
        record
      );

    if (!byOccurrence[key]) {
      byOccurrence[key] = {
        key,

        drawingNumber:
          record.drawing_number,

        revision:
          String(
            record.revision
          ),

        revisionKey:
          canonicalVisionRevisionKey_(
            record.revision
          ),

        sourceFileId:
          record.source_file_id,

        sourcePage:
          record.source_page,

        sourcePdf:
          record.source_pdf,

        records: []
      };
    }

    byOccurrence[key]
      .records
      .push(record);
  });

  const occurrences = [];

  Object.keys(byOccurrence)
    .forEach(key => {
      const occurrence =
        byOccurrence[key];

      occurrence.records.sort(
        compareVisionReferenceRecords_
      );

      const pointHashes = {};

      occurrence.records.forEach(
        record => {
          const point =
            String(
              record.point_number
            );

          if (!pointHashes[point]) {
            pointHashes[point] = [];
          }

          pointHashes[point].push(
            record.content_hash
          );
        }
      );

      const conflictingPoints =
        Object.keys(pointHashes)
          .filter(point =>
            Array.from(
              new Set(
                pointHashes[point]
              )
            ).length > 1
          );

      if (
        conflictingPoints.length > 0
      ) {
        occurrence.records.forEach(
          record => {
            reviews.push(
              reviewFromVisionRecord_(
                record,
                (
                  FMR_VISION_CONFIG
                    .reviewReasons
                    .DUPLICATE_RETAINED_BOM_POINTS +
                  ':' +
                  conflictingPoints.join(',')
                )
              )
            );
          }
        );

        return;
      }

      occurrence.contentHash =
        hashVisionOccurrence_(
          occurrence
        );

      occurrences.push(
        occurrence
      );
    });

  return {
    occurrences,
    reviews
  };
}

function buildVisionOccurrenceKey_(
  record
) {
  return [
    record.source_file_id,
    record.source_page,
    normalizeVisionText_(
      record.drawing_number
    ),
    normalizeVisionText_(
      record.revision
    )
  ].join('|');
}

function hashVisionOccurrence_(
  occurrence
) {
  const orderedRows =
    occurrence.records
      .slice()
      .sort(
        compareVisionReferenceRecords_
      )
      .map(record =>
        [
          record.point_number,

          normalizeVisionWhitespace_(
            record.description
          ),

          normalizeVisionSize_(
            record.nominal_size
          ),

          normalizeVisionWhitespace_(
            record.commodity_code
          ).toUpperCase(),

          normalizeVisionWhitespace_(
            record.quantity
          )
        ].join('|')
      )
      .join('\n');

  const content = [
    normalizeVisionText_(
      occurrence.drawingNumber
    ),

    normalizeVisionText_(
      occurrence.revision
    ),

    orderedRows
  ].join('\n');

  return computeVisionSha256_(
    content
  );
}

function canonicalVisionRevisionKey_(
  revision
) {
  const normalized =
    normalizeVisionWhitespace_(
      revision
    ).toUpperCase();

  if (/^\d+$/.test(normalized)) {
    return String(
      Number(normalized)
    );
  }

  return normalized;
}

function compareVisionRevisionValues_(
  first,
  second
) {
  const firstNumeric =
    /^\d+$/.test(first);

  const secondNumeric =
    /^\d+$/.test(second);

  if (
    firstNumeric &&
    secondNumeric
  ) {
    return (
      Number(first) -
      Number(second)
    );
  }

  return String(first).localeCompare(
    String(second)
  );
}

function compareVisionOccurrences_(
  first,
  second
) {
  const fileComparison =
    String(
      first.sourceFileId
    ).localeCompare(
      String(
        second.sourceFileId
      )
    );

  if (fileComparison !== 0) {
    return fileComparison;
  }

  const firstPage =
    Number(
      first.sourcePage
    );

  const secondPage =
    Number(
      second.sourcePage
    );

  if (
    Number.isFinite(firstPage) &&
    Number.isFinite(secondPage) &&
    firstPage !== secondPage
  ) {
    return (
      firstPage -
      secondPage
    );
  }

  return String(
    first.sourcePdf
  ).localeCompare(
    String(
      second.sourcePdf
    )
  );
}

function compareVisionReferenceRecords_(
  first,
  second
) {
  const drawingComparison =
    String(
      first.drawing_number
    ).localeCompare(
      String(
        second.drawing_number
      )
    );

  if (drawingComparison !== 0) {
    return drawingComparison;
  }

  const revisionComparison =
    compareVisionRevisionValues_(
      String(
        first.revision
      ),
      String(
        second.revision
      )
    );

  if (revisionComparison !== 0) {
    return revisionComparison;
  }

  const firstPoint =
    Number(
      first.point_number
    );

  const secondPoint =
    Number(
      second.point_number
    );

  if (
    Number.isFinite(firstPoint) &&
    Number.isFinite(secondPoint) &&
    firstPoint !== secondPoint
  ) {
    return (
      firstPoint -
      secondPoint
    );
  }

  return String(
    first.point_number
  ).localeCompare(
    String(
      second.point_number
    )
  );
}

/* ========================================================================== */
/* REVIEW STORAGE                                                             */
/* ========================================================================== */

function reviewFromVisionRecord_(
  record,
  reason
) {
  return normalizeVisionReviewRecord_({
    run_id:
      record.run_id,

    source_file_id:
      record.source_file_id,

    source_pdf:
      record.source_pdf,

    source_page:
      record.source_page,

    iwp_number:
      record.iwp_number,

    drawing_number:
      record.drawing_number,

    revision:
      record.revision,

    point_number:
      record.point_number,

    raw_row_text:
      record.raw_row_text,

    bbox_x0:
      record.bbox_x0,

    bbox_y0:
      record.bbox_y0,

    bbox_x1:
      record.bbox_x1,

    bbox_y1:
      record.bbox_y1,

    reason_codes:
      reason,

    page_class:
      FMR_VISION_CONFIG
        .pageClasses
        .ISO,

    ocr_derived:
      record.ocr_derived,

    created_at:
      new Date()
  });
}

function appendUniqueVisionReviews_(
  reviewSheet,
  reviews
) {
  if (
    !reviews ||
    reviews.length === 0
  ) {
    return {
      appended: 0,
      skipped: 0
    };
  }

  const existingReviews =
    readVisionObjectsFromSheet_(
      reviewSheet,
      FMR_VISION_CONFIG.reviewHeaders
    );

  const existingKeys = {};

  existingReviews.forEach(review => {
    existingKeys[
      buildVisionReviewKey_(
        review
      )
    ] = true;
  });

  const rowsToAppend = [];
  let skipped = 0;

  reviews
    .map(review =>
      normalizeVisionReviewRecord_(
        review
      )
    )
    .forEach(review => {
      const key =
        buildVisionReviewKey_(
          review
        );

      if (existingKeys[key]) {
        skipped++;
        return;
      }

      existingKeys[key] = true;

      rowsToAppend.push(
        visionObjectToRow_(
          review,
          FMR_VISION_CONFIG.reviewHeaders
        )
      );
    });

  if (rowsToAppend.length > 0) {
    reviewSheet.getRange(
      reviewSheet.getLastRow() + 1,
      1,
      rowsToAppend.length,
      FMR_VISION_CONFIG
        .reviewHeaders
        .length
    ).setValues(
      rowsToAppend
    );
  }

  return {
    appended:
      rowsToAppend.length,

    skipped
  };
}

function buildVisionReviewKey_(
  review
) {
  return computeVisionSha256_(
    [
      review.source_file_id,
      review.source_page,

      normalizeVisionText_(
        review.drawing_number
      ),

      normalizeVisionText_(
        review.revision
      ),

      review.point_number,

      normalizeVisionWhitespace_(
        review.reason_codes
      ),

      normalizeVisionWhitespace_(
        review.raw_row_text
      )
    ].join('|')
  );
}

/* ========================================================================== */
/* GENERIC SHEET READ + WRITE HELPERS                                         */
/* ========================================================================== */

function readVisionObjectsFromSheet_(
  sheet,
  headers
) {
  if (
    !sheet ||
    sheet.getLastRow() <= 1
  ) {
    return [];
  }

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      headers.length
    ).getValues();

  return values
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row => {
      const record = {};

      headers.forEach(
        (header, index) => {
          record[header] =
            row[index];
        }
      );

      return record;
    });
}

function replaceVisionSheetObjects_(
  sheet,
  headers,
  objects
) {
  const currentDataRows =
    Math.max(
      0,
      sheet.getLastRow() - 1
    );

  if (currentDataRows > 0) {
    sheet.getRange(
      2,
      1,
      currentDataRows,
      headers.length
    )
    .clearContent()
    .clearDataValidations();
  }

  if (
    !objects ||
    objects.length === 0
  ) {
    return;
  }

  const values =
    objects.map(object =>
      visionObjectToRow_(
        object,
        headers
      )
    );

  sheet.getRange(
    2,
    1,
    values.length,
    headers.length
  ).setValues(values);
}

function visionObjectToRow_(
  object,
  headers
) {
  return headers.map(header =>
    protectVisionCellValue_(
      object[header]
    )
  );
}

function protectVisionCellValue_(
  value
) {
  if (
    typeof value !== 'string'
  ) {
    return value;
  }

  /*
   * Prevent OCR-derived text from being interpreted as a formula.
   * The leading apostrophe is not displayed by Google Sheets.
   */
  if (/^[=+@-]/.test(value)) {
    return `'${value}`;
  }

  return value;
}

function countVisionDataRows_(
  sheet
) {
  if (
    !sheet ||
    sheet.getLastRow() <= 1
  ) {
    return 0;
  }

  return sheet.getRange(
    2,
    1,
    sheet.getLastRow() - 1,
    sheet.getLastColumn()
  )
  .getValues()
  .filter(row =>
    row.some(value =>
      value !== '' &&
      value !== null
    )
  )
  .length;
}

/* ========================================================================== */
/* HASHING + SMALL HELPERS                                                    */
/* ========================================================================== */

function hashVisionCanonicalRow_(
  record
) {
  return computeVisionSha256_(
    [
      normalizeVisionText_(
        record.drawing_number
      ),

      normalizeVisionText_(
        record.revision
      ),

      String(
        record.point_number
      ),

      normalizeVisionWhitespace_(
        record.description
      ),

      normalizeVisionSize_(
        record.nominal_size
      ),

      normalizeVisionWhitespace_(
        record.commodity_code
      ).toUpperCase(),

      normalizeVisionWhitespace_(
        record.quantity
      )
    ].join('|')
  );
}

function computeVisionSha256_(
  value
) {
  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ''),
      Utilities.Charset.UTF_8
    );

  return digest
    .map(byte => {
      const normalized =
        (byte + 256) % 256;

      return (
        `0${normalized.toString(16)}`
      ).slice(-2);
    })
    .join('');
}

function normalizeVisionSpreadsheetId_(
  spreadsheetId
) {
  const value =
    String(
      spreadsheetId || ''
    ).trim();

  if (!value) {
    throw new Error(
      'A spreadsheet ID is required.'
    );
  }

  const urlMatch =
    value.match(
      /\/spreadsheets\/d\/([A-Za-z0-9_-]{15,})/
    );

  const normalized =
    urlMatch
      ? urlMatch[1]
      : value;

  if (
    !/^[A-Za-z0-9_-]{15,}$/
      .test(normalized)
  ) {
    throw new Error(
      'The supplied spreadsheet ID or URL is invalid.'
    );
  }

  return normalized;
}

function normalizeVisionBoolean_(
  value
) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  const normalized =
    String(
      value || ''
    )
    .trim()
    .toUpperCase();

  return (
    normalized === 'TRUE' ||
    normalized === 'YES' ||
    normalized === 'Y' ||
    normalized === '1'
  );
}

function normalizeVisionPointValue_(
  value
) {
  const text =
    String(
      value === undefined ||
      value === null
        ? ''
        : value
    ).trim();

  if (
    FMR_VISION_CONFIG
      .regex
      .point
      .test(text)
  ) {
    return Number(text);
  }

  return text;
}

function normalizeVisionReasonCodesForSheet_(
  value
) {
  const source =
    Array.isArray(value)
      ? value
      : String(
          value || ''
        ).split(';');

  return Array.from(
    new Set(
      source
        .map(reason =>
          String(
            reason || ''
          ).trim()
        )
        .filter(Boolean)
    )
  ).join(';');
}

function appendVisionStructuralNote_(
  existing,
  note
) {
  const values =
    String(
      existing || ''
    )
    .split(';')
    .map(value =>
      value.trim()
    )
    .filter(Boolean);

  if (
    values.indexOf(note) === -1
  ) {
    values.push(note);
  }

  return values.join(';');
}