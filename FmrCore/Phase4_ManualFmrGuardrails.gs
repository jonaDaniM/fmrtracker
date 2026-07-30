/**
 * Phase4_ManualFmrGuardrails.gs
 *
 * Authorization, preflight, protection, and approval-preview guardrails for
 * the manual FMR intake workflow.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Enforce role- and assignment-based permissions through secure wrappers.
 * - Verify active users and reviewer separation before live testing.
 * - Apply warning-only protections to system-controlled spreadsheet columns.
 * - Hide selected technical columns without hiding operational error fields.
 * - Produce a non-destructive approval preview before canonical writes.
 * - Report preflight and protection status.
 *
 * NON-RESPONSIBILITIES
 * --------------------
 * - No menus, prompts, alerts, or onOpen().
 * - No PropertiesService.
 * - No Cloud Vision, Cloud Storage, or paid services.
 * - No changes to source material values during preview.
 *
 * DEPENDS ON
 * ----------
 * - Phase4_ManualFmrConfig.gs
 * - Phase4_ManualFmrSheetService.gs
 * - Phase4_ManualFmrIntakeService.gs
 * - Phase4_ManualFmrReviewService.gs
 */

const FMR_MANUAL_GUARDRAILS = Object.freeze({
  componentVersion: 'manual-fmr-guardrails-v1',
  protectionPrefix: 'Manual FMR Guardrail',

  actions: Object.freeze({
    SETUP: 'SETUP',
    CREATE_BATCH: 'CREATE_BATCH',
    DATA_ENTRY: 'DATA_ENTRY',
    VALIDATE_BATCH: 'VALIDATE_BATCH',
    SUBMIT_BATCH: 'SUBMIT_BATCH',
    REVIEW: 'REVIEW',
    APPLY_PROTECTIONS: 'APPLY_PROTECTIONS'
  }),

  elevatedRoles: Object.freeze([
    'ADMINISTRATOR',
    'PLANNER',
    'MATERIAL CONTROL'
  ]),

  batchCreatorRoles: Object.freeze([
    'ADMINISTRATOR',
    'PLANNER',
    'MATERIAL CONTROL'
  ]),

  entryRoles: Object.freeze([
    'ADMINISTRATOR',
    'PLANNER',
    'MATERIAL CONTROL',
    'FIELD MATERIAL HANDLER'
  ]),

  protectionColumns: Object.freeze({
    FMR_Manual_Entry: Object.freeze({
      protect: Object.freeze([
        'Entry_Row_ID',
        'Batch_ID',
        'Source_Document_Type',
        'Source_File_ID',
        'Entry_Method',
        'Entry_Status',
        'Entered_By',
        'Entered_At',
        'Reviewer_Email',
        'Reviewed_At',
        'Validation_Errors',
        'Row_Content_Hash'
      ]),
      hide: Object.freeze([
        'Entry_Row_ID',
        'Source_Document_Type',
        'Source_File_ID',
        'Entry_Method',
        'Entered_By',
        'Entered_At',
        'Reviewer_Email',
        'Reviewed_At',
        'Row_Content_Hash'
      ])
    }),

    FMR_Manual_Review: Object.freeze({
      protect: Object.freeze([
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
        'Canonical_FMR_ID',
        'Canonical_FMR_Line_ID',
        'Review_Content_Hash'
      ]),
      hide: Object.freeze([
        'Entry_Row_ID',
        'Source_File_ID',
        'Submitted_By',
        'Submitted_At',
        'Reviewer_Email',
        'Reviewed_At',
        'Canonical_FMR_ID',
        'Canonical_FMR_Line_ID',
        'Review_Content_Hash'
      ])
    }),

    FMR_Manual_Batches: Object.freeze({
      protect: Object.freeze([
        'Batch_ID',
        'Source_Document_Type',
        'Batch_Status',
        'Entered_FMR_Count',
        'Entered_Line_Count',
        'Approved_FMR_Count',
        'Approved_Line_Count',
        'Rejected_Line_Count',
        'Created_By',
        'Created_At',
        'Updated_At'
      ]),
      hide: Object.freeze([
        'Source_Document_Type',
        'Created_By',
        'Created_At',
        'Updated_At'
      ])
    })
  })
});

/* ========================================================================== */
/* PUBLIC INFORMATION                                                        */
/* ========================================================================== */

function getManualFmrGuardrailVersion() {
  return {
    schemaVersion: FMR_MANUAL_CONFIG.schemaVersion,
    serviceVersion: FMR_MANUAL_CONFIG.serviceVersion,
    component: FMR_MANUAL_GUARDRAILS.componentVersion
  };
}

function getManualFmrPermissionMatrix() {
  return {
    actions: Object.assign({}, FMR_MANUAL_GUARDRAILS.actions),
    elevatedRoles: Array.from(FMR_MANUAL_GUARDRAILS.elevatedRoles),
    batchCreatorRoles: Array.from(FMR_MANUAL_GUARDRAILS.batchCreatorRoles),
    entryRoles: Array.from(FMR_MANUAL_GUARDRAILS.entryRoles)
  };
}

/* ========================================================================== */
/* PREFLIGHT                                                                  */
/* ========================================================================== */

/**
 * Performs a non-destructive readiness check.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {Object=} options
 * Supported:
 * - action
 * - batchId
 * - reviewerEmail
 * - reviewIds
 *
 * @return {Object}
 */
function runManualFmrPreflight(
  spreadsheetId,
  callerEmail,
  options
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const settings = options || {};
  const action = normalizeManualFmrGuardrailAction_(
    settings.action || FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY
  );

  const report = {
    passed: true,
    spreadsheetId: normalizedId,
    action,
    caller: null,
    reviewer: null,
    batch: null,
    contracts: {
      canonical: false,
      support: false,
      manualFoundation: false
    },
    protections: null,
    issues: [],
    warnings: []
  };

  let spreadsheet;

  try {
    spreadsheet = SpreadsheetApp.openById(normalizedId);
  } catch (error) {
    report.issues.push(
      `Unable to open the spreadsheet: ${error.message || error}`
    );
    report.passed = false;
    return report;
  }

  try {
    validateManualFmrCanonicalContracts_(spreadsheet);
    report.contracts.canonical = true;
  } catch (error) {
    report.issues.push(error.message || String(error));
  }

  try {
    validateManualFmrReviewSupportContracts_(spreadsheet);
    report.contracts.support = true;
  } catch (error) {
    report.issues.push(error.message || String(error));
  }

  try {
    const foundation = validateManualFmrIntakeFoundation(normalizedId);
    report.contracts.manualFoundation = foundation.valid;

    if (!foundation.valid) {
      foundation.missingSheets.forEach(function (sheetName) {
        report.issues.push(`Missing manual-intake sheet: ${sheetName}`);
      });

      foundation.headerMismatches.forEach(function (message) {
        report.issues.push(`Header mismatch: ${message}`);
      });
    }
  } catch (error) {
    report.issues.push(error.message || String(error));
  }

  try {
    const user = getManualFmrReviewerIdentity_(spreadsheet, actor);

    report.caller = {
      userId: user.User_ID,
      email: user.Email,
      displayName: user.Display_Name,
      role: user.Role
    };

    authorizeManualFmrGuardrailAction_(
      spreadsheet,
      user,
      action,
      settings
    );
  } catch (error) {
    report.issues.push(error.message || String(error));
  }

  const reviewerEmail = normalizeManualFmrEmail_(
    settings.reviewerEmail
  );

  if (reviewerEmail) {
    try {
      const reviewer = getManualFmrReviewerIdentity_(
        spreadsheet,
        reviewerEmail
      );

      report.reviewer = {
        userId: reviewer.User_ID,
        email: reviewer.Email,
        displayName: reviewer.Display_Name,
        role: reviewer.Role
      };

      if (reviewer.Email === actor) {
        report.issues.push(
          'The reviewer must be different from the data-entry user.'
        );
      }
    } catch (error) {
      report.issues.push(
        `Reviewer validation failed: ${error.message || error}`
      );
    }
  }

  const batchId = normalizeManualFmrText_(settings.batchId);

  if (batchId) {
    try {
      const batchSheet = spreadsheet.getSheetByName(
        FMR_MANUAL_CONFIG.sheets.batches
      );

      const batch = findManualFmrBatchRecord_(batchSheet, batchId);

      if (!batch) {
        report.issues.push(`Batch "${batchId}" was not found.`);
      } else {
        report.batch = batch;

        if (
          report.caller &&
          !isManualFmrGuardrailElevatedRole_(report.caller.role) &&
          !isManualFmrAssignedEntryUser_(batch, actor) &&
          normalizeManualFmrEmail_(batch.Assigned_Reviewer) !== actor
        ) {
          report.issues.push(
            `The caller is not assigned to batch "${batchId}".`
          );
        }

        if (
          normalizeManualFmrUpper_(batch.Batch_Status) ===
          FMR_MANUAL_CONFIG.batchStatuses.CANCELLED
        ) {
          report.issues.push(`Batch "${batchId}" is cancelled.`);
        }
      }
    } catch (error) {
      report.issues.push(error.message || String(error));
    }
  }

  try {
    report.protections = getManualFmrProtectionStatus(normalizedId);

    if (!report.protections.complete) {
      report.warnings.push(
        'Manual FMR system-column protections have not been fully applied.'
      );
    }
  } catch (error) {
    report.warnings.push(
      `Protection status could not be read: ${error.message || error}`
    );
  }

  report.passed = report.issues.length === 0;
  return report;
}

/* ========================================================================== */
/* SECURE INTAKE WRAPPERS                                                     */
/* ========================================================================== */

function createAuthorizedManualFmrBatch(
  spreadsheetId,
  callerEmail,
  request
) {
  const context = authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.CREATE_BATCH,
    request || {}
  );

  return createManualFmrBatch(
    context.spreadsheetId,
    context.user.Email,
    request || {}
  );
}

function createAuthorizedManualFmrDraft(
  spreadsheetId,
  callerEmail,
  request
) {
  const payload = request || {};

  const context = authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY,
    {
      batchId: payload.batchId
    }
  );

  return createManualFmrDraft(
    context.spreadsheetId,
    context.user.Email,
    payload
  );
}

function validateAuthorizedManualFmrBatch(
  spreadsheetId,
  callerEmail,
  batchId
) {
  const context = authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.VALIDATE_BATCH,
    { batchId }
  );

  return validateManualFmrBatch(
    context.spreadsheetId,
    context.user.Email,
    batchId
  );
}

function submitAuthorizedManualFmrBatchForReview(
  spreadsheetId,
  callerEmail,
  batchId
) {
  const context = authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.SUBMIT_BATCH,
    { batchId }
  );

  return submitManualFmrBatchForReview(
    context.spreadsheetId,
    context.user.Email,
    batchId
  );
}

function approveAuthorizedManualFmrReviews(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.REVIEW,
    { reviewIds }
  );

  return approveManualFmrReviews(
    spreadsheetId,
    callerEmail,
    reviewIds,
    reviewerNotes || ''
  );
}

function returnAuthorizedManualFmrReviewsForClarification(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.REVIEW,
    { reviewIds }
  );

  return returnManualFmrReviewsForClarification(
    spreadsheetId,
    callerEmail,
    reviewIds,
    reviewerNotes
  );
}

function rejectAuthorizedManualFmrReviews(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  authorizeManualFmrGuardrailRequest_(
    spreadsheetId,
    callerEmail,
    FMR_MANUAL_GUARDRAILS.actions.REVIEW,
    { reviewIds }
  );

  return rejectManualFmrReviews(
    spreadsheetId,
    callerEmail,
    reviewIds,
    reviewerNotes
  );
}

/* ========================================================================== */
/* APPROVAL PREVIEW                                                           */
/* ========================================================================== */

/**
 * Performs the approval checks and reports planned canonical actions without
 * writing any data.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {string[]} reviewIds
 * @return {Object}
 */
function previewManualFmrApprovals(
  spreadsheetId,
  callerEmail,
  reviewIds
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const normalizedReviewIds = normalizeManualFmrReviewIds_(reviewIds);

  if (normalizedReviewIds.length === 0) {
    throw new Error('At least one Review_ID is required.');
  }

  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  validateManualFmrCanonicalContracts_(spreadsheet);
  validateManualFmrReviewSupportContracts_(spreadsheet);

  const reviewer = getManualFmrReviewerIdentity_(spreadsheet, actor);
  const context = buildManualFmrReviewContext_(spreadsheet);

  const report = {
    passed: true,
    reviewer: {
      email: reviewer.Email,
      displayName: reviewer.Display_Name,
      role: reviewer.Role
    },
    requestedReviews: normalizedReviewIds.length,
    approvableReviews: 0,
    blockedReviews: 0,
    alreadyProcessedReviews: 0,
    canonicalFmrsToCreate: 0,
    canonicalFmrsToReuse: 0,
    canonicalLinesToCreate: 0,
    canonicalLinesToReuse: 0,
    iwpsToCreate: 0,
    isosToCreate: 0,
    rows: [],
    issues: []
  };

  const plannedFmrKeys = {};
  const plannedIwpKeys = {};
  const plannedIsoKeys = {};
  const plannedLineKeys = {};

  normalizedReviewIds.forEach(function (reviewId) {
    const reviewItem = context.reviewById[reviewId];

    if (!reviewItem) {
      const missing = {
        reviewId,
        status: 'BLOCKED',
        issues: ['review_not_found']
      };

      report.rows.push(missing);
      report.issues.push(`${reviewId}: review_not_found`);
      report.blockedReviews++;
      return;
    }

    const review = normalizeManualFmrReviewSnapshot_(reviewItem.record);
    const rowReport = {
      reviewId,
      entryRowId: review.Entry_Row_ID,
      batchId: review.Batch_ID,
      fmrNumber: review.FMR_Number,
      revision: review.Revision,
      lineNumber: review.FMR_Line_Number,
      commodityCode: review.Commodity_Code,
      status: 'APPROVABLE',
      actions: [],
      issues: []
    };

    if (
      isManualFmrReviewFinalized_(
        review
      )
    ) {
      rowReport.status = 'ALREADY_PROCESSED';
      rowReport.issues.push(
        `already_${normalizeManualFmrUpper_(review.Review_Decision).toLowerCase()}`
      );
      report.rows.push(rowReport);
      report.alreadyProcessedReviews++;
      return;
    }

    if (
      normalizeManualFmrText_(
        review.Review_Decision
      )
    ) {
      rowReport.actions.push(
        'IGNORE_UNFINALIZED_DECISION_CELL'
      );
    }

    try {
      assertManualFmrReviewAssignment_(
        review,
        reviewer,
        context.batchById[normalizeManualFmrText_(review.Batch_ID)]
      );

      const entryItem = context.entryById[
        normalizeManualFmrText_(review.Entry_Row_ID)
      ];

      if (!entryItem) {
        throw new Error('staging_entry_not_found');
      }

      const entry = normalizeManualFmrEntryRow(entryItem.record);

      assertManualFmrSeparationOfDuties_(
        entry,
        review,
        reviewer
      );

      const validation = validateManualFmrReviewApproval_(
        context,
        review,
        entry
      );

      if (!validation.valid) {
        validation.errors.forEach(function (error) {
          rowReport.issues.push(error);
        });
      }

      const iwpKey = normalizeManualFmrUpper_(entry.IWP_Number);

      if (!context.iwpByNumber[iwpKey] && !plannedIwpKeys[iwpKey]) {
        rowReport.actions.push('CREATE_IWP');
        plannedIwpKeys[iwpKey] = true;
        report.iwpsToCreate++;
      } else {
        rowReport.actions.push('REUSE_IWP');
      }

      const fmrKey = buildManualFmrRevisionKey_(
        entry.FMR_Number,
        entry.Revision
      );

      if (
        !context.canonicalHeaderByRevision[fmrKey] &&
        !plannedFmrKeys[fmrKey]
      ) {
        rowReport.actions.push('CREATE_FMR_HEADER');
        plannedFmrKeys[fmrKey] = true;
        report.canonicalFmrsToCreate++;
      } else {
        rowReport.actions.push('REUSE_FMR_HEADER');
        if (!plannedFmrKeys[fmrKey]) {
          report.canonicalFmrsToReuse++;
          plannedFmrKeys[fmrKey] = true;
        }
      }

      if (normalizeManualFmrText_(entry.ISO_Line_Number)) {
        const isoKey = buildManualFmrIsoKey_(
          entry.IWP_Number,
          entry.ISO_Line_Number,
          entry.ISO_Sheet,
          entry.ISO_Drawing_Number
        );

        if (!context.isoByKey[isoKey] && !plannedIsoKeys[isoKey]) {
          rowReport.actions.push('CREATE_ISO_REFERENCE');
          plannedIsoKeys[isoKey] = true;
          report.isosToCreate++;
        } else {
          rowReport.actions.push('REUSE_ISO_REFERENCE');
        }
      } else {
        rowReport.actions.push('NO_ISO_REFERENCE');
      }

      const duplicateKey = buildManualFmrDuplicateKey_(entry);

      if (
        context.canonicalLineByDuplicateKey[duplicateKey] ||
        plannedLineKeys[duplicateKey]
      ) {
        rowReport.actions.push('REUSE_CANONICAL_LINE');
        report.canonicalLinesToReuse++;
      } else {
        rowReport.actions.push('CREATE_CANONICAL_LINE');
        plannedLineKeys[duplicateKey] = true;
        report.canonicalLinesToCreate++;
      }
    } catch (error) {
      rowReport.issues.push(error.message || String(error));
    }

    if (rowReport.issues.length > 0) {
      rowReport.status = 'BLOCKED';
      report.blockedReviews++;
      rowReport.issues.forEach(function (issue) {
        report.issues.push(`${reviewId}: ${issue}`);
      });
    } else {
      report.approvableReviews++;
    }

    report.rows.push(rowReport);
  });

  report.passed = report.blockedReviews === 0;
  return report;
}

/* ========================================================================== */
/* SHEET PROTECTIONS                                                          */
/* ========================================================================== */

/**
 * Applies warning-only protections to system-controlled columns. Warning-only
 * mode avoids blocking the bound script while still warning human editors.
 *
 * Only an active Administrator can apply or refresh protections.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @return {Object}
 */
function applyManualFmrSheetProtections(
  spreadsheetId,
  callerEmail
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const user = getManualFmrReviewerIdentity_(spreadsheet, actor);

  if (normalizeManualFmrUpper_(user.Role) !== 'ADMINISTRATOR') {
    throw new Error(
      'Only an active Administrator can apply Manual FMR sheet protections.'
    );
  }

  setupManualFmrIntakeSheets(normalizedId);

  const results = [];

  Object.keys(FMR_MANUAL_GUARDRAILS.protectionColumns).forEach(
    function (sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      const settings =
        FMR_MANUAL_GUARDRAILS.protectionColumns[sheetName];

      if (!sheet) {
        throw new Error(`Required sheet "${sheetName}" is missing.`);
      }

      const headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getDisplayValues()[0]
        .map(function (value) {
          return normalizeManualFmrText_(value);
        });

      removeManualFmrGuardrailProtections_(sheet);

      const protectedColumns = [];

      settings.protect.forEach(function (header) {
        const column = headers.indexOf(header) + 1;

        if (column <= 0) {
          throw new Error(
            `Column "${header}" was not found on "${sheetName}".`
          );
        }

        const range = sheet.getRange(
          2,
          column,
          Math.max(1, sheet.getMaxRows() - 1),
          1
        );

        const protection = range.protect();

        protection
          .setDescription(
            `${FMR_MANUAL_GUARDRAILS.protectionPrefix}: ` +
            `${sheetName}.${header}`
          )
          .setWarningOnly(true);

        protectedColumns.push(header);
      });

      const hiddenColumns = [];

      settings.hide.forEach(function (header) {
        const column = headers.indexOf(header) + 1;

        if (column > 0) {
          sheet.hideColumns(column);
          hiddenColumns.push(header);
        }
      });

      results.push({
        sheetName,
        protectedColumns,
        hiddenColumns
      });
    }
  );

  SpreadsheetApp.flush();

  return {
    applied: true,
    appliedBy: user.Email,
    warningOnly: true,
    sheets: results
  };
}

function getManualFmrProtectionStatus(spreadsheetId) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);
  const sheets = [];
  let complete = true;

  Object.keys(FMR_MANUAL_GUARDRAILS.protectionColumns).forEach(
    function (sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      const expected =
        FMR_MANUAL_GUARDRAILS.protectionColumns[sheetName].protect;

      if (!sheet) {
        complete = false;
        sheets.push({
          sheetName,
          exists: false,
          expectedProtections: expected.length,
          activeProtections: 0,
          complete: false
        });
        return;
      }

      const protections = sheet
        .getProtections(SpreadsheetApp.ProtectionType.RANGE)
        .filter(function (protection) {
          return normalizeManualFmrText_(
            protection.getDescription()
          ).indexOf(FMR_MANUAL_GUARDRAILS.protectionPrefix) === 0;
        });

      const sheetComplete = protections.length === expected.length;

      if (!sheetComplete) {
        complete = false;
      }

      sheets.push({
        sheetName,
        exists: true,
        expectedProtections: expected.length,
        activeProtections: protections.length,
        complete: sheetComplete
      });
    }
  );

  return {
    complete,
    warningOnly: true,
    sheets
  };
}

/* ========================================================================== */
/* AUTHORIZATION HELPERS                                                      */
/* ========================================================================== */

function authorizeManualFmrGuardrailRequest_(
  spreadsheetId,
  callerEmail,
  action,
  options
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(spreadsheetId);
  const actor = assertManualFmrCaller_(callerEmail);
  const spreadsheet = SpreadsheetApp.openById(normalizedId);

  validateManualFmrCanonicalContracts_(spreadsheet);
  validateManualFmrReviewSupportContracts_(spreadsheet);

  const foundation = validateManualFmrIntakeFoundation(normalizedId);

  if (!foundation.valid) {
    throw new Error(
      [
        'The manual FMR intake foundation is not valid.',
        ...foundation.missingSheets.map(function (name) {
          return `Missing sheet: ${name}`;
        }),
        ...foundation.headerMismatches.map(function (message) {
          return `Header mismatch: ${message}`;
        })
      ].join('\n')
    );
  }

  const user = getManualFmrReviewerIdentity_(spreadsheet, actor);

  authorizeManualFmrGuardrailAction_(
    spreadsheet,
    user,
    normalizeManualFmrGuardrailAction_(action),
    options || {}
  );

  return {
    spreadsheetId: normalizedId,
    spreadsheet,
    user
  };
}

function authorizeManualFmrGuardrailAction_(
  spreadsheet,
  user,
  action,
  options
) {
  const role = normalizeManualFmrUpper_(user.Role);
  const settings = options || {};

  if (action === FMR_MANUAL_GUARDRAILS.actions.SETUP) {
    if (!isManualFmrGuardrailElevatedRole_(role)) {
      throw new Error(
        `Role "${user.Role}" is not authorized to initialize manual FMR intake.`
      );
    }

    return true;
  }

  if (
    action === FMR_MANUAL_GUARDRAILS.actions.CREATE_BATCH ||
    action === FMR_MANUAL_GUARDRAILS.actions.APPLY_PROTECTIONS
  ) {
    if (
      FMR_MANUAL_GUARDRAILS.batchCreatorRoles.indexOf(role) === -1
    ) {
      throw new Error(
        `Role "${user.Role}" is not authorized to create entry batches.`
      );
    }

    return true;
  }

  if (
    action === FMR_MANUAL_GUARDRAILS.actions.DATA_ENTRY ||
    action === FMR_MANUAL_GUARDRAILS.actions.VALIDATE_BATCH ||
    action === FMR_MANUAL_GUARDRAILS.actions.SUBMIT_BATCH
  ) {
    if (FMR_MANUAL_GUARDRAILS.entryRoles.indexOf(role) === -1) {
      throw new Error(
        `Role "${user.Role}" is not authorized for manual FMR data entry.`
      );
    }

    const batchId = normalizeManualFmrText_(settings.batchId);

    if (!batchId) {
      throw new Error('A Batch_ID is required for this action.');
    }

    const batchSheet = spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );
    const batch = findManualFmrBatchRecord_(batchSheet, batchId);

    if (!batch) {
      throw new Error(`Batch "${batchId}" was not found.`);
    }

    if (
      !isManualFmrGuardrailElevatedRole_(role) &&
      !isManualFmrAssignedEntryUser_(batch, user.Email)
    ) {
      throw new Error(
        `User "${user.Email}" is not assigned as a data-entry user ` +
        `for batch "${batchId}".`
      );
    }

    if (
      normalizeManualFmrUpper_(batch.Batch_Status) ===
      FMR_MANUAL_CONFIG.batchStatuses.CANCELLED
    ) {
      throw new Error(`Batch "${batchId}" is cancelled.`);
    }

    return true;
  }

  if (action === FMR_MANUAL_GUARDRAILS.actions.REVIEW) {
    const reviewIds = normalizeManualFmrReviewIds_(settings.reviewIds);

    if (reviewIds.length === 0) {
      throw new Error('At least one Review_ID is required.');
    }

    const context = buildManualFmrReviewContext_(spreadsheet);

    reviewIds.forEach(function (reviewId) {
      const reviewItem = context.reviewById[reviewId];

      if (!reviewItem) {
        throw new Error(`Review_ID "${reviewId}" was not found.`);
      }

      assertManualFmrReviewAssignment_(
        reviewItem.record,
        user,
        context.batchById[
          normalizeManualFmrText_(reviewItem.record.Batch_ID)
        ]
      );
    });

    return true;
  }

  throw new Error(`Unsupported guardrail action "${action}".`);
}

function normalizeManualFmrGuardrailAction_(value) {
  const action = normalizeManualFmrUpper_(value);
  const allowed = Object.keys(FMR_MANUAL_GUARDRAILS.actions).map(
    function (key) {
      return FMR_MANUAL_GUARDRAILS.actions[key];
    }
  );

  if (allowed.indexOf(action) === -1) {
    throw new Error(
      `Invalid guardrail action "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return action;
}

function isManualFmrGuardrailElevatedRole_(role) {
  return (
    FMR_MANUAL_GUARDRAILS.elevatedRoles.indexOf(
      normalizeManualFmrUpper_(role)
    ) !== -1
  );
}

function isManualFmrAssignedEntryUser_(batch, email) {
  const actor = normalizeManualFmrEmail_(email);

  return [
    normalizeManualFmrEmail_(batch.Assigned_Entry_User_1),
    normalizeManualFmrEmail_(batch.Assigned_Entry_User_2)
  ].indexOf(actor) !== -1;
}

/* ========================================================================== */
/* PROTECTION HELPERS                                                         */
/* ========================================================================== */

function removeManualFmrGuardrailProtections_(sheet) {
  sheet
    .getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .forEach(function (protection) {
      const description = normalizeManualFmrText_(
        protection.getDescription()
      );

      if (
        description.indexOf(
          FMR_MANUAL_GUARDRAILS.protectionPrefix
        ) === 0
      ) {
        protection.remove();
      }
    });
}
