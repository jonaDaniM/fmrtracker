/**
 * Phase4_ManualFmrReviewService.gs
 *
 * Reviewer decision and canonical-commit service for manual FMR intake.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * DATA FLOW
 * ---------
 * FMR_Manual_Review
 *   -> reviewer decision
 *   -> separation-of-duties and snapshot validation
 *   -> FMR_Header / FMR_Line_Items
 *   -> Audit_Log
 *
 * RESPONSIBILITIES
 * ----------------
 * - Read pending review snapshots.
 * - Verify the caller is an active authorized reviewer.
 * - Prevent a data-entry user from approving their own row.
 * - Confirm the review snapshot still matches the staging row.
 * - Process APPROVE, RETURN_FOR_CLARIFICATION, and REJECT decisions.
 * - Create missing IWP_Master and ISO_Master reference records safely.
 * - Create or reuse canonical FMR_Header and FMR_Line_Items records.
 * - Recover idempotently when a canonical line was written before the
 *   corresponding review row was updated.
 * - Recalculate canonical FMR quantities from canonical material lines.
 * - Update staging, review, and batch workflow statuses.
 * - Append a detailed Audit_Log record for every reviewer action.
 *
 * NON-RESPONSIBILITIES
 * --------------------
 * - No menus, prompts, alerts, or onOpen().
 * - No PropertiesService.
 * - No Cloud Vision, Cloud Storage, or paid services.
 * - No receiving, bagging, issuing, or backorder transactions.
 * - No silent material substitutions or quantity corrections.
 *
 * DEPENDS ON
 * ----------
 * - Phase4_ManualFmrConfig.gs
 * - Phase4_ManualFmrSheetService.gs
 * - Phase4_ManualFmrIntakeService.gs
 */

const FMR_MANUAL_REVIEW_SUPPORT = Object.freeze({
  componentVersion: 'manual-fmr-review-service-v1',

  sheets: Object.freeze({
    configuration: 'Configuration',
    users: 'Users',
    iwpMaster: 'IWP_Master',
    isoMaster: 'ISO_Master'
  }),

  configurationHeaders: Object.freeze([
    'Setting',
    'Value',
    'Description',
    'Editable'
  ]),

  userHeaders: Object.freeze([
    'User_ID',
    'Email',
    'Display_Name',
    'Role',
    'Can_Issue',
    'Can_Bag',
    'Can_Request_Backorder',
    'Can_Approve_Backorder',
    'Active',
    'Created_At',
    'Notes'
  ]),

  iwpHeaders: Object.freeze([
    'IWP_ID',
    'IWP_Number',
    'Area',
    'Description',
    'Planner_Email',
    'Superintendent_Email',
    'Foreman_Email',
    'Package_Status',
    'Planned_Start',
    'Planned_Finish',
    'Drive_Folder_ID',
    'Drive_Folder_URL',
    'Active',
    'Created_At',
    'Updated_At'
  ]),

  isoHeaders: Object.freeze([
    'ISO_ID',
    'ISO_Line_Number',
    'ISO_Sheet',
    'ISO_Drawing_Number',
    'IWP_ID',
    'IWP_Number',
    'Revision',
    'Service_Code',
    'Line_Description',
    'Drawing_File_ID',
    'Drawing_URL',
    'Active',
    'Created_At',
    'Updated_At'
  ]),

  auditHeaders: Object.freeze([
    'Audit_ID',
    'Entity_Type',
    'Entity_ID',
    'Action',
    'Field_Name',
    'Old_Value',
    'New_Value',
    'User_Email',
    'User_Name',
    'Timestamp',
    'Source_Interface',
    'Correlation_ID'
  ]),

  elevatedReviewerRoles: Object.freeze([
    'ADMINISTRATOR',
    'PLANNER',
    'MATERIAL CONTROL'
  ]),

  terminalEntryStatuses: Object.freeze([
    'APPROVED',
    'REJECTED',
    'SUPERSEDED',
    'VOIDED'
  ]),

  fmrStatusOrder: Object.freeze([
    'DRAFT',
    'SUBMITTED',
    'UNDER REVIEW',
    'APPROVED',
    'SOURCING',
    'PARTIALLY LOCATED',
    'LOCATED',
    'PARTIALLY ISSUED',
    'ISSUED',
    'CLOSED',
    'CANCELLED',
    'ON HOLD'
  ])
});

/* ========================================================================== */
/* PUBLIC SERVICE INFORMATION                                                 */
/* ========================================================================== */

function getManualFmrReviewServiceVersion() {
  return {
    schemaVersion: FMR_MANUAL_CONFIG.schemaVersion,
    serviceVersion: FMR_MANUAL_CONFIG.serviceVersion,
    component:
      FMR_MANUAL_REVIEW_SUPPORT.componentVersion
  };
}

/* ========================================================================== */
/* REVIEW QUEUE READ                                                          */
/* ========================================================================== */

/**
 * Returns review queue rows visible to the caller.
 *
 * Elevated reviewers can see every pending review. Other active users only
 * see reviews explicitly assigned to their email.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {Object=} filters
 * Supported:
 * - batchId
 * - fmrNumber
 * - includeProcessed
 * - maximumRows (1-1000)
 *
 * @return {{
 *   reviewer:Object,
 *   rows:Object[],
 *   totalReturned:number
 * }}
 */
function getManualFmrReviewQueue(
  spreadsheetId,
  callerEmail,
  filters
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const settings = filters || {};
  const spreadsheet = SpreadsheetApp.openById(
    normalizedId
  );

  setupManualFmrIntakeSheets(normalizedId);

  const reviewer = getManualFmrReviewerIdentity_(
    spreadsheet,
    actor
  );

  const reviewSheet = spreadsheet.getSheetByName(
    FMR_MANUAL_CONFIG.sheets.review
  );

  let rows = readManualFmrSheetObjects_(
    reviewSheet,
    FMR_MANUAL_CONFIG.reviewHeaders
  );

  if (!isManualFmrElevatedReviewer_(reviewer)) {
    rows = rows.filter(function (row) {
      return (
        normalizeManualFmrEmail_(
          row.Reviewer_Email
        ) === actor
      );
    });
  }

  const batchId = normalizeManualFmrText_(
    settings.batchId
  );
  const fmrNumber = normalizeManualFmrUpper_(
    settings.fmrNumber
  );
  const includeProcessed = Boolean(
    settings.includeProcessed
  );

  if (batchId) {
    rows = rows.filter(function (row) {
      return (
        normalizeManualFmrText_(row.Batch_ID) ===
        batchId
      );
    });
  }

  if (fmrNumber) {
    rows = rows.filter(function (row) {
      return (
        normalizeManualFmrUpper_(row.FMR_Number) ===
        fmrNumber
      );
    });
  }

  if (!includeProcessed) {
    rows = rows.filter(function (row) {
      return !normalizeManualFmrText_(
        row.Review_Decision
      );
    });
  }

  const maximumRows =
    normalizeManualFmrReviewLimit_(
      settings.maximumRows,
      250
    );

  rows.sort(function (left, right) {
    const leftDate = new Date(
      left.Submitted_At || 0
    ).getTime();
    const rightDate = new Date(
      right.Submitted_At || 0
    ).getTime();

    return leftDate - rightDate;
  });

  return {
    reviewer: {
      email: reviewer.Email,
      displayName: reviewer.Display_Name,
      role: reviewer.Role,
      elevated:
        isManualFmrElevatedReviewer_(reviewer)
    },
    rows: rows.slice(0, maximumRows),
    totalReturned: Math.min(
      rows.length,
      maximumRows
    )
  };
}

/* ========================================================================== */
/* REVIEW DECISION ENTRY POINT                                                */
/* ========================================================================== */

/**
 * Processes one reviewer decision across one or more review rows.
 *
 * @param {string} spreadsheetId
 * @param {string} callerEmail
 * @param {Object} request
 * Required:
 * - reviewIds: string[]
 * - decision:
 *     APPROVE
 *     RETURN_FOR_CLARIFICATION
 *     REJECT
 *
 * Required for RETURN_FOR_CLARIFICATION and REJECT:
 * - reviewerNotes
 *
 * @return {{
 *   correlationId:string,
 *   decision:string,
 *   requestedReviews:number,
 *   processedReviews:number,
 *   alreadyProcessedReviews:number,
 *   approvedReviews:number,
 *   clarificationReviews:number,
 *   rejectedReviews:number,
 *   canonicalFmrsCreated:number,
 *   canonicalLinesCreated:number,
 *   recoveredCanonicalLines:number,
 *   affectedBatches:string[],
 *   affectedFmrs:string[],
 *   results:Object[]
 * }}
 */
function reviewManualFmrRows(
  spreadsheetId,
  callerEmail,
  request
) {
  const normalizedId = normalizeManualFmrSpreadsheetId_(
    spreadsheetId
  );
  const actor = assertManualFmrCaller_(callerEmail);
  const payload = request || {};
  const decision =
    normalizeManualFmrReviewDecision_(
      payload.decision
    );
  const reviewerNotes =
    normalizeManualFmrText_(
      payload.reviewerNotes
    );
  const reviewIds =
    normalizeManualFmrReviewIds_(
      payload.reviewIds
    );

  if (reviewIds.length === 0) {
    throw new Error(
      'At least one Review_ID is required.'
    );
  }

  if (
    decision !==
      FMR_MANUAL_CONFIG.reviewDecisions.APPROVE &&
    !reviewerNotes
  ) {
    throw new Error(
      'Reviewer notes are required when returning or rejecting a row.'
    );
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Another manual FMR review operation is running. ' +
      'Try again after it completes.'
    );
  }

  try {
    setupManualFmrIntakeSheetsUnlocked_(normalizedId);

    const spreadsheet = SpreadsheetApp.openById(
      normalizedId
    );

    validateManualFmrReviewSupportContracts_(
      spreadsheet
    );

    const reviewer = getManualFmrReviewerIdentity_(
      spreadsheet,
      actor
    );

    const context =
      buildManualFmrReviewContext_(
        spreadsheet
      );

    const requestedItems =
      reviewIds.map(function (reviewId) {
        const item =
          context.reviewById[reviewId];

        if (!item) {
          throw new Error(
            `Review_ID "${reviewId}" was not found.`
          );
        }

        return item;
      });

    requestedItems.forEach(function (item) {
      assertManualFmrReviewAssignment_(
        item.record,
        reviewer,
        context.batchById[
          normalizeManualFmrText_(
            item.record.Batch_ID
          )
        ]
      );
    });

    const correlationId =
      createManualFmrReviewCorrelationId_();

    const response = {
      correlationId,
      decision,
      requestedReviews: reviewIds.length,
      processedReviews: 0,
      alreadyProcessedReviews: 0,
      approvedReviews: 0,
      clarificationReviews: 0,
      rejectedReviews: 0,
      canonicalFmrsCreated: 0,
      canonicalLinesCreated: 0,
      recoveredCanonicalLines: 0,
      affectedBatches: [],
      affectedFmrs: [],
      results: []
    };

    const affectedBatches = {};
    const affectedFmrIds = {};

    requestedItems.forEach(function (reviewItem) {
      const result =
        processManualFmrReviewItem_(
          spreadsheet,
          context,
          reviewItem,
          reviewer,
          decision,
          reviewerNotes,
          correlationId
        );

      response.results.push(result);

      if (result.alreadyProcessed) {
        response.alreadyProcessedReviews++;
      } else {
        response.processedReviews++;
      }

      if (!result.alreadyProcessed) {
        if (result.decision === 'APPROVE') {
          response.approvedReviews++;
        } else if (
          result.decision ===
          'RETURN_FOR_CLARIFICATION'
        ) {
          response.clarificationReviews++;
        } else if (
          result.decision === 'REJECT'
        ) {
          response.rejectedReviews++;
        }
      }

      if (result.canonicalFmrCreated) {
        response.canonicalFmrsCreated++;
      }

      if (result.canonicalLineCreated) {
        response.canonicalLinesCreated++;
      }

      if (result.recoveredCanonicalLine) {
        response.recoveredCanonicalLines++;
      }

      if (result.batchId) {
        affectedBatches[result.batchId] = true;
      }

      if (result.canonicalFmrId) {
        affectedFmrIds[
          result.canonicalFmrId
        ] = true;
      }
    });

    Object.keys(affectedFmrIds).forEach(
      function (fmrId) {
        recalculateManualFmrCanonicalHeader_(
          spreadsheet,
          context,
          fmrId,
          reviewer.Email
        );
      }
    );

    Object.keys(affectedBatches).forEach(
      function (batchId) {
        recalculateManualFmrBatchMetrics_(
          spreadsheet,
          batchId,
          reviewer.Email
        );

        refreshManualFmrBatchWorkflowStatus_(
          spreadsheet,
          batchId,
          reviewer.Email
        );
      }
    );

    response.affectedBatches =
      Object.keys(affectedBatches);
    response.affectedFmrs =
      Object.keys(affectedFmrIds);

    SpreadsheetApp.flush();

    return response;
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* CONVENIENCE WRAPPERS                                                       */
/* ========================================================================== */

function approveManualFmrReviews(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  return reviewManualFmrRows(
    spreadsheetId,
    callerEmail,
    {
      reviewIds,
      decision:
        FMR_MANUAL_CONFIG
          .reviewDecisions
          .APPROVE,
      reviewerNotes:
        reviewerNotes || ''
    }
  );
}

function returnManualFmrReviewsForClarification(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  return reviewManualFmrRows(
    spreadsheetId,
    callerEmail,
    {
      reviewIds,
      decision:
        FMR_MANUAL_CONFIG
          .reviewDecisions
          .RETURN_FOR_CLARIFICATION,
      reviewerNotes
    }
  );
}

function rejectManualFmrReviews(
  spreadsheetId,
  callerEmail,
  reviewIds,
  reviewerNotes
) {
  return reviewManualFmrRows(
    spreadsheetId,
    callerEmail,
    {
      reviewIds,
      decision:
        FMR_MANUAL_CONFIG
          .reviewDecisions
          .REJECT,
      reviewerNotes
    }
  );
}

function isManualFmrReviewFinalized_(
  review
) {
  const value =
    review || {};

  return Boolean(
    normalizeManualFmrText_(
      value.Reviewed_At
    ) ||
    normalizeManualFmrText_(
      value.Canonical_FMR_ID
    ) ||
    normalizeManualFmrText_(
      value.Canonical_FMR_Line_ID
    )
  );
}

/* ========================================================================== */
/* ONE REVIEW ITEM                                                            */
/* ========================================================================== */

function processManualFmrReviewItem_(
  spreadsheet,
  context,
  reviewItem,
  reviewer,
  decision,
  reviewerNotes,
  correlationId
) {
  const review =
    normalizeManualFmrReviewSnapshot_(
      reviewItem.record
    );

  const existingDecision =
    normalizeManualFmrUpper_(
      review.Review_Decision
    );

  const reviewFinalized =
    isManualFmrReviewFinalized_(
      review
    );

  /*
   * Review_Decision is a final system result, not a proposed human input.
   * A manually typed decision without Reviewed_At or canonical IDs must not
   * suppress the actual menu-driven review action.
   */
  if (reviewFinalized) {
    if (!existingDecision) {
      throw new Error(
        `Review "${review.Review_ID}" has completion evidence but no final decision.`
      );
    }

    if (existingDecision !== decision) {
      throw new Error(
        `Review "${review.Review_ID}" is already ` +
        `${existingDecision} and cannot be changed to ${decision}.`
      );
    }

    return {
      reviewId: review.Review_ID,
      entryRowId: review.Entry_Row_ID,
      batchId: review.Batch_ID,
      fmrNumber: review.FMR_Number,
      decision: existingDecision,
      alreadyProcessed: true,
      canonicalFmrId:
        review.Canonical_FMR_ID || '',
      canonicalFmrLineId:
        review.Canonical_FMR_Line_ID || '',
      canonicalFmrCreated: false,
      canonicalLineCreated: false,
      recoveredCanonicalLine: false
    };
  }

  const entryItem =
    context.entryById[
      normalizeManualFmrText_(
        review.Entry_Row_ID
      )
    ];

  if (!entryItem) {
    throw new Error(
      `The staging row "${review.Entry_Row_ID}" ` +
      `for review "${review.Review_ID}" was not found.`
    );
  }

  const entry = normalizeManualFmrEntryRow(
    entryItem.record
  );

  assertManualFmrSeparationOfDuties_(
    entry,
    review,
    reviewer
  );

  if (
    decision ===
    FMR_MANUAL_CONFIG
      .reviewDecisions
      .APPROVE
  ) {
    return approveManualFmrReviewItem_(
      spreadsheet,
      context,
      reviewItem,
      entryItem,
      review,
      entry,
      reviewer,
      reviewerNotes,
      correlationId
    );
  }

  return resolveManualFmrNonApproval_(
    spreadsheet,
    context,
    reviewItem,
    entryItem,
    review,
    entry,
    reviewer,
    decision,
    reviewerNotes,
    correlationId
  );
}

/* ========================================================================== */
/* APPROVAL                                                                   */
/* ========================================================================== */

function approveManualFmrReviewItem_(
  spreadsheet,
  context,
  reviewItem,
  entryItem,
  review,
  entry,
  reviewer,
  reviewerNotes,
  correlationId
) {
  const approvalValidation =
    validateManualFmrReviewApproval_(
      context,
      review,
      entry
    );

  if (!approvalValidation.valid) {
    throw new Error(
      `Review "${review.Review_ID}" cannot be approved:\n- ` +
      approvalValidation.errors.join('\n- ')
    );
  }

  const now = new Date();

  const batch =
    context.batchById[
      normalizeManualFmrText_(
        review.Batch_ID
      )
    ] || {};

  const iwpResult =
    resolveOrCreateManualFmrIwp_(
      spreadsheet,
      context,
      entry,
      batch,
      reviewer,
      now,
      correlationId
    );

  const fmrResult =
    resolveOrCreateManualFmrHeader_(
      spreadsheet,
      context,
      entry,
      review,
      iwpResult,
      batch,
      reviewer,
      now,
      correlationId
    );

  const isoResult =
    resolveOrCreateManualFmrIso_(
      spreadsheet,
      context,
      entry,
      iwpResult,
      reviewer,
      now,
      correlationId
    );

  const lineResult =
    resolveOrCreateManualFmrLine_(
      spreadsheet,
      context,
      entry,
      review,
      fmrResult,
      iwpResult,
      isoResult,
      reviewer,
      now,
      correlationId
    );

  review.Review_Decision =
    FMR_MANUAL_CONFIG
      .reviewDecisions
      .APPROVE;
  review.Reviewer_Email =
    reviewer.Email;
  review.Reviewed_At = now;
  review.Reviewer_Notes =
    reviewerNotes;
  review.Canonical_FMR_ID =
    fmrResult.record.FMR_ID;
  review.Canonical_FMR_Line_ID =
    lineResult.record.FMR_Line_ID;

  entry.Entry_Status =
    FMR_MANUAL_CONFIG
      .entryStatuses
      .APPROVED;
  entry.Reviewer_Email =
    reviewer.Email;
  entry.Reviewed_At = now;
  entry.Review_Notes =
    reviewerNotes;
  entry.Validation_Errors = '';

  updateManualFmrObjectRow_(
    context.reviewSheet,
    FMR_MANUAL_CONFIG.reviewHeaders,
    reviewItem.rowNumber,
    normalizeManualFmrReviewSnapshot_(
      review
    )
  );

  updateManualFmrObjectRow_(
    context.entrySheet,
    FMR_MANUAL_CONFIG.entryHeaders,
    entryItem.rowNumber,
    normalizeManualFmrEntryRow(
      entry
    )
  );

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'FMR_REVIEW',
      entityId: review.Review_ID,
      action: 'APPROVE',
      oldValue: '',
      newValue: {
        entryRowId: review.Entry_Row_ID,
        batchId: review.Batch_ID,
        fmrNumber: review.FMR_Number,
        revision: review.Revision,
        canonicalFmrId:
          fmrResult.record.FMR_ID,
        canonicalFmrLineId:
          lineResult.record.FMR_Line_ID,
        reviewerNotes
      },
      reviewer,
      correlationId
    }
  );

  return {
    reviewId: review.Review_ID,
    entryRowId: review.Entry_Row_ID,
    batchId: review.Batch_ID,
    fmrNumber: review.FMR_Number,
    decision:
      FMR_MANUAL_CONFIG
        .reviewDecisions
        .APPROVE,
    alreadyProcessed: false,
    canonicalFmrId:
      fmrResult.record.FMR_ID,
    canonicalFmrLineId:
      lineResult.record.FMR_Line_ID,
    canonicalFmrCreated:
      fmrResult.created,
    canonicalLineCreated:
      lineResult.created,
    recoveredCanonicalLine:
      lineResult.recovered
  };
}

function validateManualFmrReviewApproval_(
  context,
  review,
  entry
) {
  const errors = [];

  const validation =
    validateManualFmrEntryRow(entry);

  validation.errors.forEach(function (error) {
    errors.push(error);
  });

  if (
    normalizeManualFmrUpper_(
      entry.Entry_Status
    ) !==
    FMR_MANUAL_CONFIG
      .entryStatuses
      .READY_FOR_REVIEW
  ) {
    errors.push(
      'entry_not_ready_for_review'
    );
  }

  if (
    normalizeManualFmrText_(
      entry.Validation_Errors
    )
  ) {
    errors.push(
      'entry_has_validation_errors'
    );
  }

  if (
    !manualFmrReviewSnapshotMatchesEntry_(
      review,
      entry
    )
  ) {
    errors.push(
      'review_snapshot_no_longer_matches_entry'
    );
  }

  const duplicateKey =
    buildManualFmrDuplicateKey_(entry);

  const activeStagingMatches =
    context.entryItems.filter(function (item) {
      const candidate =
        normalizeManualFmrEntryRow(
          item.record
        );

      return (
        !isManualFmrInactiveEntryStatus_(
          candidate.Entry_Status
        ) &&
        buildManualFmrDuplicateKey_(
          candidate
        ) === duplicateKey
      );
    });

  if (activeStagingMatches.length > 1) {
    errors.push(
      FMR_MANUAL_CONFIG
        .validationReasons
        .DUPLICATE_STAGING_LINE
    );
  }

  const fmrRevisionKey =
    buildManualFmrRevisionKey_(
      entry.FMR_Number,
      entry.Revision
    );

  const sameFmrRows =
    context.entryItems.filter(function (item) {
      const candidate =
        normalizeManualFmrEntryRow(
          item.record
        );

      return (
        ![
          FMR_MANUAL_CONFIG
            .entryStatuses
            .VOIDED,
          FMR_MANUAL_CONFIG
            .entryStatuses
            .SUPERSEDED
        ].includes(
          normalizeManualFmrUpper_(
            candidate.Entry_Status
          )
        ) &&
        buildManualFmrRevisionKey_(
          candidate.FMR_Number,
          candidate.Revision
        ) === fmrRevisionKey
      );
    });

  const headerKeys = Array.from(
    new Set(
      sameFmrRows.map(function (item) {
        return buildManualFmrHeaderConsistencyKey_(
          item.record
        );
      })
    )
  );

  if (headerKeys.length > 1) {
    errors.push(
      FMR_MANUAL_CONFIG
        .validationReasons
        .CONFLICTING_FMR_HEADER
    );
  }

  const canonicalHeaderItem =
    context.canonicalHeaderByRevision[
      fmrRevisionKey
    ];

  if (
    canonicalHeaderItem &&
    !manualFmrHeaderMatchesCanonical_(
      entry,
      canonicalHeaderItem.record
    )
  ) {
    errors.push(
      FMR_MANUAL_CONFIG
        .validationReasons
        .CONFLICTING_FMR_HEADER
    );
  }

  const canonicalExact =
    context.canonicalLineByDuplicateKey[
      duplicateKey
    ];

  const lineNumberKey =
    buildManualFmrCanonicalLineNumberKey_(
      entry.FMR_Number,
      entry.Revision,
      entry.FMR_Line_Number
    );

  const canonicalSameLine =
    context.canonicalLinesByNumber[
      lineNumberKey
    ] || [];

  if (
    !canonicalExact &&
    canonicalSameLine.length > 0
  ) {
    errors.push(
      FMR_MANUAL_CONFIG
        .validationReasons
        .SOURCE_REVISION_CONFLICT
    );
  }

  return {
    valid:
      Array.from(new Set(errors))
        .length === 0,
    errors:
      Array.from(new Set(errors))
  };
}

function manualFmrReviewSnapshotMatchesEntry_(
  review,
  entry
) {
  const candidate =
    buildManualFmrReviewSnapshot_(
      entry,
      review.Submitted_By,
      review.Submitted_At
    );

  return (
    normalizeManualFmrText_(
      candidate.Review_Content_Hash
    ) ===
    normalizeManualFmrText_(
      review.Review_Content_Hash
    )
  );
}

/* ========================================================================== */
/* RETURN / REJECT                                                            */
/* ========================================================================== */

function resolveManualFmrNonApproval_(
  spreadsheet,
  context,
  reviewItem,
  entryItem,
  review,
  entry,
  reviewer,
  decision,
  reviewerNotes,
  correlationId
) {
  const now = new Date();

  review.Review_Decision = decision;
  review.Reviewer_Email =
    reviewer.Email;
  review.Reviewed_At = now;
  review.Reviewer_Notes =
    reviewerNotes;

  entry.Entry_Status =
    decision ===
      FMR_MANUAL_CONFIG
        .reviewDecisions
        .RETURN_FOR_CLARIFICATION
      ? FMR_MANUAL_CONFIG
          .entryStatuses
          .NEEDS_CLARIFICATION
      : FMR_MANUAL_CONFIG
          .entryStatuses
          .REJECTED;

  entry.Reviewer_Email =
    reviewer.Email;
  entry.Reviewed_At = now;
  entry.Review_Notes =
    reviewerNotes;

  updateManualFmrObjectRow_(
    context.reviewSheet,
    FMR_MANUAL_CONFIG.reviewHeaders,
    reviewItem.rowNumber,
    normalizeManualFmrReviewSnapshot_(
      review
    )
  );

  updateManualFmrObjectRow_(
    context.entrySheet,
    FMR_MANUAL_CONFIG.entryHeaders,
    entryItem.rowNumber,
    normalizeManualFmrEntryRow(entry)
  );

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'FMR_REVIEW',
      entityId: review.Review_ID,
      action: decision,
      oldValue: '',
      newValue: {
        entryRowId: review.Entry_Row_ID,
        batchId: review.Batch_ID,
        fmrNumber: review.FMR_Number,
        revision: review.Revision,
        reviewerNotes
      },
      reviewer,
      correlationId
    }
  );

  return {
    reviewId: review.Review_ID,
    entryRowId: review.Entry_Row_ID,
    batchId: review.Batch_ID,
    fmrNumber: review.FMR_Number,
    decision,
    alreadyProcessed: false,
    canonicalFmrId: '',
    canonicalFmrLineId: '',
    canonicalFmrCreated: false,
    canonicalLineCreated: false,
    recoveredCanonicalLine: false
  };
}

/* ========================================================================== */
/* IWP RESOLUTION                                                             */
/* ========================================================================== */

function resolveOrCreateManualFmrIwp_(
  spreadsheet,
  context,
  entry,
  batch,
  reviewer,
  now,
  correlationId
) {
  const key =
    normalizeManualFmrUpper_(
      entry.IWP_Number
    );

  const existing =
    context.iwpByNumber[key];

  if (existing) {
    return {
      record: existing.record,
      created: false
    };
  }

  const record = {
    IWP_ID:
      createManualFmrIwpId_(),
    IWP_Number:
      entry.IWP_Number,
    Area: '',
    Description:
      'Created by manual FMR intake.',
    Planner_Email:
      entry.Requested_By_Email || '',
    Superintendent_Email: '',
    Foreman_Email: '',
    Package_Status: 'Active',
    Planned_Start: '',
    Planned_Finish: '',
    Drive_Folder_ID:
      batch.Source_Folder_ID || '',
    Drive_Folder_URL:
      batch.Source_Folder_URL || '',
    Active: 'Yes',
    Created_At: now,
    Updated_At: now
  };

  appendManualFmrObjects_(
    context.iwpSheet,
    FMR_MANUAL_REVIEW_SUPPORT.iwpHeaders,
    [record]
  );

  const item = {
    rowNumber:
      context.iwpSheet.getLastRow(),
    record
  };

  context.iwpItems.push(item);
  context.iwpByNumber[key] = item;

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'IWP',
      entityId: record.IWP_ID,
      action: 'CREATE_FROM_MANUAL_FMR',
      oldValue: '',
      newValue: record,
      reviewer,
      correlationId
    }
  );

  return {
    record,
    created: true
  };
}

/* ========================================================================== */
/* ISO RESOLUTION                                                             */
/* ========================================================================== */

function resolveOrCreateManualFmrIso_(
  spreadsheet,
  context,
  entry,
  iwpResult,
  reviewer,
  now,
  correlationId
) {
  if (
    !normalizeManualFmrText_(
      entry.ISO_Line_Number
    )
  ) {
    return {
      record: {
        ISO_ID: '',
        ISO_Line_Number: '',
        ISO_Sheet: '',
        ISO_Drawing_Number: ''
      },
      created: false
    };
  }

  const key =
    buildManualFmrIsoKey_(
      entry.IWP_Number,
      entry.ISO_Line_Number,
      entry.ISO_Sheet,
      entry.ISO_Drawing_Number
    );

  const existing =
    context.isoByKey[key];

  if (existing) {
    return {
      record: existing.record,
      created: false
    };
  }

  const record = {
    ISO_ID:
      createManualFmrIsoId_(),
    ISO_Line_Number:
      entry.ISO_Line_Number,
    ISO_Sheet:
      entry.ISO_Sheet,
    ISO_Drawing_Number:
      entry.ISO_Drawing_Number,
    IWP_ID:
      iwpResult.record.IWP_ID,
    IWP_Number:
      entry.IWP_Number,
    Revision: '',
    Service_Code: '',
    Line_Description: '',
    Drawing_File_ID: '',
    Drawing_URL: '',
    Active: 'Yes',
    Created_At: now,
    Updated_At: now
  };

  appendManualFmrObjects_(
    context.isoSheet,
    FMR_MANUAL_REVIEW_SUPPORT.isoHeaders,
    [record]
  );

  const item = {
    rowNumber:
      context.isoSheet.getLastRow(),
    record
  };

  context.isoItems.push(item);
  context.isoByKey[key] = item;

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'ISO',
      entityId: record.ISO_ID,
      action: 'CREATE_FROM_MANUAL_FMR',
      oldValue: '',
      newValue: record,
      reviewer,
      correlationId
    }
  );

  return {
    record,
    created: true
  };
}

/* ========================================================================== */
/* FMR HEADER RESOLUTION                                                      */
/* ========================================================================== */

function resolveOrCreateManualFmrHeader_(
  spreadsheet,
  context,
  entry,
  review,
  iwpResult,
  batch,
  reviewer,
  now,
  correlationId
) {
  const key =
    buildManualFmrRevisionKey_(
      entry.FMR_Number,
      entry.Revision
    );

  const existing =
    context.canonicalHeaderByRevision[
      key
    ];

  if (existing) {
    if (
      !manualFmrHeaderMatchesCanonical_(
        entry,
        existing.record
      )
    ) {
      throw new Error(
        `FMR "${entry.FMR_Number}" revision ` +
        `"${entry.Revision}" conflicts with the existing canonical header.`
      );
    }

    return {
      record: existing.record,
      rowNumber: existing.rowNumber,
      created: false
    };
  }

  const configuration =
    context.configuration;

  const record = {
    FMR_ID:
      createManualFmrCanonicalFmrId_(),
    FMR_Number:
      entry.FMR_Number,
    Revision:
      entry.Revision,
    Current_Status:
      FMR_MANUAL_CONFIG
        .defaults
        .canonicalFmrStatus === 'Draft'
        ? 'Approved'
        : FMR_MANUAL_CONFIG
            .defaults
            .canonicalFmrStatus,
    Priority:
      entry.Priority,
    Project_Code:
      configuration.PROJECT_CODE || '',
    Area:
      iwpResult.record.Area || '',
    IWP_ID:
      iwpResult.record.IWP_ID,
    IWP_Number:
      entry.IWP_Number,
    Requested_By:
      entry.Requested_By,
    Requested_By_Email:
      entry.Requested_By_Email,
    Craft:
      entry.Craft,
    Deliver_To:
      entry.Deliver_To,
    Destination:
      entry.Destination,
    Warehouse:
      entry.Warehouse,
    Date_Created:
      entry.Request_Date || now,
    Date_Required:
      entry.Date_Required || '',
    Date_Submitted:
      review.Submitted_At || now,
    Date_Approved: now,
    Date_Closed: '',
    Reason_Code: '',
    Reason_Detail: '',
    Total_Lines: 0,
    Qty_Requested: 0,
    Qty_Confirmed_Located: 0,
    Qty_Active_Bagged: 0,
    Qty_Available: 0,
    Qty_Issued: 0,
    Qty_Pending_Backorder: 0,
    Qty_Confirmed_Backorder: 0,
    Qty_Remaining_Requirement: 0,
    Fulfillment_Pct: 0,
    Age_Days:
      calculateManualFmrAgeDays_(
        entry.Request_Date || now,
        now
      ),
    Risk_Flag:
      calculateManualFmrRiskFlag_(
        entry.Date_Required,
        now
      ),
    Assigned_To_Email:
      reviewer.Email,
    Folder_ID:
      batch.Source_Folder_ID || '',
    Folder_URL:
      batch.Source_Folder_URL || '',
    Sheet_File_ID: '',
    Sheet_URL: '',
    PDF_File_ID:
      entry.Source_File_ID || '',
    PDF_URL:
      entry.Source_File_URL || '',
    Created_By:
      entry.Entered_By ||
      reviewer.Email,
    Updated_At: now,
    Last_Activity_At: now,
    Notes:
      `Approved through manual FMR intake. ` +
      `Batch: ${entry.Batch_ID}. Review: ${review.Review_ID}.`
  };

  appendManualFmrObjects_(
    context.canonicalHeaderSheet,
    FMR_MANUAL_CONFIG
      .canonicalHeaderFields,
    [record]
  );

  const item = {
    rowNumber:
      context.canonicalHeaderSheet
        .getLastRow(),
    record
  };

  context.canonicalHeaderItems.push(
    item
  );
  context.canonicalHeaderByRevision[
    key
  ] = item;
  context.canonicalHeaderById[
    record.FMR_ID
  ] = item;

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'FMR',
      entityId: record.FMR_ID,
      action: 'CREATE_FROM_MANUAL_REVIEW',
      oldValue: '',
      newValue: record,
      reviewer,
      correlationId
    }
  );

  return {
    record,
    rowNumber: item.rowNumber,
    created: true
  };
}

/* ========================================================================== */
/* FMR LINE RESOLUTION                                                        */
/* ========================================================================== */

function resolveOrCreateManualFmrLine_(
  spreadsheet,
  context,
  entry,
  review,
  fmrResult,
  iwpResult,
  isoResult,
  reviewer,
  now,
  correlationId
) {
  const duplicateKey =
    buildManualFmrDuplicateKey_(
      entry
    );

  const existing =
    context.canonicalLineByDuplicateKey[
      duplicateKey
    ];

  if (existing) {
    const existingPseudoEntry =
      buildManualFmrEntryFromCanonicalLine_(
        existing.record,
        fmrResult.record
      );

    if (
      hashManualFmrEntryRow_(
        existingPseudoEntry
      ) !==
      hashManualFmrEntryRow_(entry)
    ) {
      throw new Error(
        `The canonical line matching review "${review.Review_ID}" ` +
        'exists but its material content is different.'
      );
    }

    return {
      record: existing.record,
      rowNumber: existing.rowNumber,
      created: false,
      recovered: true
    };
  }

  const lineNumberKey =
    buildManualFmrCanonicalLineNumberKey_(
      entry.FMR_Number,
      entry.Revision,
      entry.FMR_Line_Number
    );

  const sameLineNumber =
    context.canonicalLinesByNumber[
      lineNumberKey
    ] || [];

  if (sameLineNumber.length > 0) {
    throw new Error(
      `FMR "${entry.FMR_Number}" revision "${entry.Revision}" ` +
      `already contains line number "${entry.FMR_Line_Number}" ` +
      'with different material content.'
    );
  }

  const requestedQuantity =
    Number(entry.Qty_Requested);

  const record = {
    FMR_Line_ID:
      createManualFmrCanonicalLineId_(),
    FMR_ID:
      fmrResult.record.FMR_ID,
    FMR_Number:
      entry.FMR_Number,
    FMR_Line_Number:
      entry.FMR_Line_Number,
    IWP_ID:
      iwpResult.record.IWP_ID,
    IWP_Number:
      entry.IWP_Number,
    ISO_ID:
      isoResult.record.ISO_ID || '',
    ISO_Line_Number:
      entry.ISO_Line_Number,
    ISO_Sheet:
      entry.ISO_Sheet,
    ISO_Drawing_Number:
      entry.ISO_Drawing_Number,
    Commodity_Code:
      entry.Commodity_Code,
    Size:
      entry.Size,
    Material_Description:
      entry.Material_Description,
    UOM:
      entry.UOM,
    Qty_Requested:
      requestedQuantity,
    Qty_Confirmed_Located: 0,
    Qty_Active_Bagged: 0,
    Qty_Available: 0,
    Qty_Issued: 0,
    Qty_Pending_Backorder: 0,
    Qty_Confirmed_Backorder: 0,
    Qty_Not_Yet_Located:
      requestedQuantity,
    Qty_Remaining_Requirement:
      requestedQuantity,
    Line_Status:
      FMR_MANUAL_CONFIG
        .defaults
        .canonicalLineStatus,
    Storage_Location: '',
    Date_First_Located: '',
    Date_First_Bagged: '',
    Date_First_Issued: '',
    Created_By:
      entry.Entered_By ||
      reviewer.Email,
    Created_At:
      entry.Entered_At || now,
    Updated_At: now,
    Notes:
      `Approved through manual FMR intake. ` +
      `Entry: ${entry.Entry_Row_ID}. Review: ${review.Review_ID}.`
  };

  appendManualFmrObjects_(
    context.canonicalLineSheet,
    FMR_MANUAL_CONFIG
      .canonicalLineFields,
    [record]
  );

  const item = {
    rowNumber:
      context.canonicalLineSheet
        .getLastRow(),
    record
  };

  context.canonicalLineItems.push(
    item
  );
  context.canonicalLineByDuplicateKey[
    duplicateKey
  ] = item;

  if (
    !context.canonicalLinesByNumber[
      lineNumberKey
    ]
  ) {
    context.canonicalLinesByNumber[
      lineNumberKey
    ] = [];
  }

  context.canonicalLinesByNumber[
    lineNumberKey
  ].push(item);

  appendManualFmrReviewAudit_(
    context.auditSheet,
    {
      entityType: 'FMR_LINE',
      entityId:
        record.FMR_Line_ID,
      action: 'CREATE_FROM_MANUAL_REVIEW',
      oldValue: '',
      newValue: record,
      reviewer,
      correlationId
    }
  );

  return {
    record,
    rowNumber: item.rowNumber,
    created: true,
    recovered: false
  };
}

/* ========================================================================== */
/* CANONICAL HEADER RECALCULATION                                             */
/* ========================================================================== */

function recalculateManualFmrCanonicalHeader_(
  spreadsheet,
  context,
  fmrId,
  actor
) {
  const headerItem =
    context.canonicalHeaderById[
      fmrId
    ];

  if (!headerItem) {
    throw new Error(
      `Canonical FMR_ID "${fmrId}" was not found.`
    );
  }

  const lines =
    context.canonicalLineItems.filter(
      function (item) {
        return (
          normalizeManualFmrText_(
            item.record.FMR_ID
          ) === fmrId
        );
      }
    );

  const header =
    Object.assign({}, headerItem.record);

  header.Total_Lines =
    lines.length;
  header.Qty_Requested =
    sumManualFmrField_(
      lines,
      'Qty_Requested'
    );
  header.Qty_Confirmed_Located =
    sumManualFmrField_(
      lines,
      'Qty_Confirmed_Located'
    );
  header.Qty_Active_Bagged =
    sumManualFmrField_(
      lines,
      'Qty_Active_Bagged'
    );
  header.Qty_Available =
    sumManualFmrField_(
      lines,
      'Qty_Available'
    );
  header.Qty_Issued =
    sumManualFmrField_(
      lines,
      'Qty_Issued'
    );
  header.Qty_Pending_Backorder =
    sumManualFmrField_(
      lines,
      'Qty_Pending_Backorder'
    );
  header.Qty_Confirmed_Backorder =
    sumManualFmrField_(
      lines,
      'Qty_Confirmed_Backorder'
    );
  header.Qty_Remaining_Requirement =
    sumManualFmrField_(
      lines,
      'Qty_Remaining_Requirement'
    );

  header.Fulfillment_Pct =
    header.Qty_Requested > 0
      ? header.Qty_Issued /
        header.Qty_Requested
      : 0;

  header.Age_Days =
    calculateManualFmrAgeDays_(
      header.Date_Created,
      new Date()
    );

  header.Risk_Flag =
    calculateManualFmrRiskFlag_(
      header.Date_Required,
      new Date()
    );

  header.Current_Status =
    chooseManualFmrStatusWithoutDowngrade_(
      header.Current_Status,
      'Approved'
    );

  if (!header.Date_Approved) {
    header.Date_Approved = new Date();
  }

  header.Updated_At =
    new Date();
  header.Last_Activity_At =
    new Date();

  updateManualFmrObjectRow_(
    context.canonicalHeaderSheet,
    FMR_MANUAL_CONFIG
      .canonicalHeaderFields,
    headerItem.rowNumber,
    header
  );

  headerItem.record = header;

  return header;
}

/* ========================================================================== */
/* BATCH WORKFLOW STATUS                                                      */
/* ========================================================================== */

function refreshManualFmrBatchWorkflowStatus_(
  spreadsheet,
  batchId,
  actor
) {
  const entrySheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.entry
    );
  const batchSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );

  const entries =
    readManualFmrSheetObjects_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders
    ).filter(function (record) {
      return (
        normalizeManualFmrText_(
          record.Batch_ID
        ) === batchId
      );
    });

  const statuses =
    entries.map(function (record) {
      return normalizeManualFmrUpper_(
        record.Entry_Status
      );
    });

  let batchStatus =
    FMR_MANUAL_CONFIG
      .batchStatuses
      .OPEN;

  const allTerminal =
    statuses.length > 0 &&
    statuses.every(function (status) {
      return (
        FMR_MANUAL_REVIEW_SUPPORT
          .terminalEntryStatuses
          .indexOf(status) !== -1
      );
    });

  if (allTerminal) {
    batchStatus = statuses.some(
      function (status) {
        return (
          status ===
          FMR_MANUAL_CONFIG
            .entryStatuses
            .REJECTED
        );
      }
    )
      ? FMR_MANUAL_CONFIG
          .batchStatuses
          .COMPLETED_WITH_ERRORS
      : FMR_MANUAL_CONFIG
          .batchStatuses
          .COMPLETED;
  } else if (
    statuses.some(function (status) {
      return (
        status ===
        FMR_MANUAL_CONFIG
          .entryStatuses
          .READY_FOR_REVIEW
      );
    })
  ) {
    batchStatus =
      FMR_MANUAL_CONFIG
        .batchStatuses
        .IN_REVIEW;
  }

  return updateManualFmrBatchStatus_(
    batchSheet,
    batchId,
    batchStatus,
    actor
  );
}

/* ========================================================================== */
/* REVIEW AUTHORIZATION                                                       */
/* ========================================================================== */

function getManualFmrReviewerIdentity_(
  spreadsheet,
  callerEmail
) {
  const userSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_REVIEW_SUPPORT
        .sheets
        .users
    );

  const users =
    readManualFmrSheetObjects_(
      userSheet,
      FMR_MANUAL_REVIEW_SUPPORT
        .userHeaders
    );

  const actor =
    normalizeManualFmrEmail_(
      callerEmail
    );

  const user =
    users.find(function (candidate) {
      return (
        normalizeManualFmrEmail_(
          candidate.Email
        ) === actor
      );
    });

  if (!user) {
    throw new Error(
      `The user "${actor}" is not registered on the Users sheet.`
    );
  }

  if (
    !normalizeManualFmrYesNo_(
      user.Active
    )
  ) {
    throw new Error(
      `The user "${actor}" is inactive.`
    );
  }

  return {
    User_ID:
      normalizeManualFmrText_(
        user.User_ID
      ),
    Email: actor,
    Display_Name:
      normalizeManualFmrText_(
        user.Display_Name
      ) || actor,
    Role:
      normalizeManualFmrText_(
        user.Role
      )
  };
}

function assertManualFmrReviewAssignment_(
  review,
  reviewer,
  batch
) {
  if (
    isManualFmrElevatedReviewer_(
      reviewer
    )
  ) {
    return true;
  }

  const assignedReviewEmail =
    normalizeManualFmrEmail_(
      review.Reviewer_Email
    );

  const assignedBatchEmail =
    normalizeManualFmrEmail_(
      batch &&
      batch.Assigned_Reviewer
    );

  if (
    reviewer.Email !==
      assignedReviewEmail &&
    reviewer.Email !==
      assignedBatchEmail
  ) {
    throw new Error(
      `Review "${review.Review_ID}" is not assigned to ${reviewer.Email}.`
    );
  }

  return true;
}

function assertManualFmrSeparationOfDuties_(
  entry,
  review,
  reviewer
) {
  const entryEmail =
    normalizeManualFmrEmail_(
      entry.Entered_By
    );
  const submittedBy =
    normalizeManualFmrEmail_(
      review.Submitted_By
    );

  if (
    reviewer.Email === entryEmail ||
    reviewer.Email === submittedBy
  ) {
    throw new Error(
      `Reviewer "${reviewer.Email}" cannot approve, return, or reject ` +
      `their own staging row "${entry.Entry_Row_ID}".`
    );
  }

  return true;
}

function isManualFmrElevatedReviewer_(
  reviewer
) {
  return (
    FMR_MANUAL_REVIEW_SUPPORT
      .elevatedReviewerRoles
      .indexOf(
        normalizeManualFmrUpper_(
          reviewer.Role
        )
      ) !== -1
  );
}

/* ========================================================================== */
/* CONTEXT BUILDING                                                           */
/* ========================================================================== */

function buildManualFmrReviewContext_(
  spreadsheet
) {
  const entrySheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.entry
    );
  const reviewSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.review
    );
  const batchSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG.sheets.batches
    );
  const canonicalHeaderSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG
        .sheets
        .canonicalHeader
    );
  const canonicalLineSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG
        .sheets
        .canonicalLines
    );
  const auditSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_CONFIG
        .sheets
        .auditLog
    );
  const iwpSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_REVIEW_SUPPORT
        .sheets
        .iwpMaster
    );
  const isoSheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_REVIEW_SUPPORT
        .sheets
        .isoMaster
    );

  const entryItems =
    readManualFmrSheetObjectsWithRows_(
      entrySheet,
      FMR_MANUAL_CONFIG.entryHeaders
    );
  const reviewItems =
    readManualFmrSheetObjectsWithRows_(
      reviewSheet,
      FMR_MANUAL_CONFIG.reviewHeaders
    );
  const batchItems =
    readManualFmrSheetObjectsWithRows_(
      batchSheet,
      FMR_MANUAL_CONFIG.batchHeaders
    );
  const canonicalHeaderItems =
    readManualFmrSheetObjectsWithRows_(
      canonicalHeaderSheet,
      FMR_MANUAL_CONFIG
        .canonicalHeaderFields
    );
  const canonicalLineItems =
    readManualFmrSheetObjectsWithRows_(
      canonicalLineSheet,
      FMR_MANUAL_CONFIG
        .canonicalLineFields
    );
  const iwpItems =
    readManualFmrSheetObjectsWithRows_(
      iwpSheet,
      FMR_MANUAL_REVIEW_SUPPORT
        .iwpHeaders
    );
  const isoItems =
    readManualFmrSheetObjectsWithRows_(
      isoSheet,
      FMR_MANUAL_REVIEW_SUPPORT
        .isoHeaders
    );

  const entryById = {};
  const reviewById = {};
  const batchById = {};
  const canonicalHeaderById = {};
  const canonicalHeaderByRevision = {};
  const iwpByNumber = {};
  const isoByKey = {};
  const canonicalLineByDuplicateKey = {};
  const canonicalLinesByNumber = {};

  entryItems.forEach(function (item) {
    entryById[
      normalizeManualFmrText_(
        item.record.Entry_Row_ID
      )
    ] = item;
  });

  reviewItems.forEach(function (item) {
    reviewById[
      normalizeManualFmrText_(
        item.record.Review_ID
      )
    ] = item;
  });

  batchItems.forEach(function (item) {
    batchById[
      normalizeManualFmrText_(
        item.record.Batch_ID
      )
    ] = normalizeManualFmrBatchRecord_(
      item.record
    );
  });

  canonicalHeaderItems.forEach(
    function (item) {
      const fmrId =
        normalizeManualFmrText_(
          item.record.FMR_ID
        );

      if (fmrId) {
        canonicalHeaderById[
          fmrId
        ] = item;
      }

      const key =
        buildManualFmrRevisionKey_(
          item.record.FMR_Number,
          item.record.Revision
        );

      if (
        normalizeManualFmrText_(
          item.record.FMR_Number
        )
      ) {
        canonicalHeaderByRevision[
          key
        ] = item;
      }
    }
  );

  iwpItems.forEach(function (item) {
    const key =
      normalizeManualFmrUpper_(
        item.record.IWP_Number
      );

    if (key) {
      iwpByNumber[key] = item;
    }
  });

  isoItems.forEach(function (item) {
    const key =
      buildManualFmrIsoKey_(
        item.record.IWP_Number,
        item.record.ISO_Line_Number,
        item.record.ISO_Sheet,
        item.record.ISO_Drawing_Number
      );

    if (
      normalizeManualFmrText_(
        item.record.ISO_Line_Number
      )
    ) {
      isoByKey[key] = item;
    }
  });

  canonicalLineItems.forEach(
    function (item) {
      const header =
        canonicalHeaderById[
          normalizeManualFmrText_(
            item.record.FMR_ID
          )
        ];

      const pseudoEntry =
        buildManualFmrEntryFromCanonicalLine_(
          item.record,
          header ? header.record : {}
        );

      const duplicateKey =
        buildManualFmrDuplicateKey_(
          pseudoEntry
        );

      canonicalLineByDuplicateKey[
        duplicateKey
      ] = item;

      const lineNumberKey =
        buildManualFmrCanonicalLineNumberKey_(
          pseudoEntry.FMR_Number,
          pseudoEntry.Revision,
          pseudoEntry.FMR_Line_Number
        );

      if (
        !canonicalLinesByNumber[
          lineNumberKey
        ]
      ) {
        canonicalLinesByNumber[
          lineNumberKey
        ] = [];
      }

      canonicalLinesByNumber[
        lineNumberKey
      ].push(item);
    }
  );

  return {
    spreadsheet,
    entrySheet,
    reviewSheet,
    batchSheet,
    canonicalHeaderSheet,
    canonicalLineSheet,
    auditSheet,
    iwpSheet,
    isoSheet,
    entryItems,
    reviewItems,
    batchItems,
    canonicalHeaderItems,
    canonicalLineItems,
    iwpItems,
    isoItems,
    entryById,
    reviewById,
    batchById,
    canonicalHeaderById,
    canonicalHeaderByRevision,
    canonicalLineByDuplicateKey,
    canonicalLinesByNumber,
    iwpByNumber,
    isoByKey,
    configuration:
      readManualFmrConfiguration_(
        spreadsheet
      )
  };
}

/* ========================================================================== */
/* SUPPORT CONTRACT VALIDATION                                                */
/* ========================================================================== */

function validateManualFmrReviewSupportContracts_(
  spreadsheet
) {
  const contracts = [
    {
      name:
        FMR_MANUAL_REVIEW_SUPPORT
          .sheets
          .configuration,
      headers:
        FMR_MANUAL_REVIEW_SUPPORT
          .configurationHeaders
    },
    {
      name:
        FMR_MANUAL_REVIEW_SUPPORT
          .sheets
          .users,
      headers:
        FMR_MANUAL_REVIEW_SUPPORT
          .userHeaders
    },
    {
      name:
        FMR_MANUAL_REVIEW_SUPPORT
          .sheets
          .iwpMaster,
      headers:
        FMR_MANUAL_REVIEW_SUPPORT
          .iwpHeaders
    },
    {
      name:
        FMR_MANUAL_REVIEW_SUPPORT
          .sheets
          .isoMaster,
      headers:
        FMR_MANUAL_REVIEW_SUPPORT
          .isoHeaders
    },
    {
      name:
        FMR_MANUAL_CONFIG
          .sheets
          .auditLog,
      headers:
        FMR_MANUAL_REVIEW_SUPPORT
          .auditHeaders
    }
  ];

  contracts.forEach(function (contract) {
    const sheet =
      spreadsheet.getSheetByName(
        contract.name
      );

    if (!sheet) {
      throw new Error(
        `Required sheet "${contract.name}" is missing.`
      );
    }

    const mismatch =
      getManualFmrHeaderMismatch_(
        sheet,
        contract.headers
      );

    if (mismatch) {
      throw new Error(
        `Sheet "${contract.name}" does not match its expected contract: ` +
        mismatch
      );
    }
  });

  return true;
}

/* ========================================================================== */
/* CANONICAL PSEUDO-ENTRY                                                     */
/* ========================================================================== */

function buildManualFmrEntryFromCanonicalLine_(
  line,
  header
) {
  return normalizeManualFmrEntryRow({
    Entry_Row_ID: 'CANONICAL',
    Batch_ID: 'CANONICAL',
    Source_Document_Type:
      FMR_MANUAL_CONFIG
        .sourceDocumentTypes
        .FMR,
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
    Revision:
      header.Revision ||
      FMR_MANUAL_CONFIG
        .defaults
        .revision,
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
      FMR_MANUAL_CONFIG
        .defaults
        .craft,
    Deliver_To:
      header.Deliver_To ||
      FMR_MANUAL_CONFIG
        .defaults
        .deliverTo,
    Destination:
      header.Destination ||
      FMR_MANUAL_CONFIG
        .defaults
        .destination,
    Warehouse:
      header.Warehouse ||
      FMR_MANUAL_CONFIG
        .defaults
        .warehouse,
    Priority:
      header.Priority ||
      FMR_MANUAL_CONFIG
        .defaults
        .priority,
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
      FMR_MANUAL_CONFIG
        .defaults
        .uom,
    Qty_Requested:
      line.Qty_Requested,
    Is_Pipe:
      isManualFmrPipeStock_(
        line.Material_Description
      ),
    Entry_Method:
      FMR_MANUAL_CONFIG
        .entryMethods
        .SYSTEM,
    Entry_Status:
      FMR_MANUAL_CONFIG
        .entryStatuses
        .APPROVED,
    Entered_By:
      line.Created_By ||
      header.Created_By ||
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
}

/* ========================================================================== */
/* AUDIT                                                                      */
/* ========================================================================== */

function appendManualFmrReviewAudit_(
  auditSheet,
  event
) {
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
      event.reviewer.Email,
    User_Name:
      event.reviewer.Display_Name,
    Timestamp:
      new Date(),
    Source_Interface:
      'MANUAL_FMR_REVIEW',
    Correlation_ID:
      event.correlationId
  };

  appendManualFmrObjects_(
    auditSheet,
    FMR_MANUAL_REVIEW_SUPPORT
      .auditHeaders,
    [record]
  );

  return record;
}

function serializeManualFmrAuditValue_(
  value
) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

/* ========================================================================== */
/* CONFIGURATION                                                              */
/* ========================================================================== */

function readManualFmrConfiguration_(
  spreadsheet
) {
  const sheet =
    spreadsheet.getSheetByName(
      FMR_MANUAL_REVIEW_SUPPORT
        .sheets
        .configuration
    );

  const rows =
    readManualFmrSheetObjects_(
      sheet,
      FMR_MANUAL_REVIEW_SUPPORT
        .configurationHeaders
    );

  const values = {};

  rows.forEach(function (row) {
    const key =
      normalizeManualFmrUpper_(
        row.Setting
      );

    if (key) {
      values[key] = row.Value;
    }
  });

  return values;
}

/* ========================================================================== */
/* GENERAL HELPERS                                                            */
/* ========================================================================== */

function normalizeManualFmrReviewDecision_(
  value
) {
  const decision =
    normalizeManualFmrUpper_(value);

  const allowed =
    Object.keys(
      FMR_MANUAL_CONFIG.reviewDecisions
    ).map(function (key) {
      return FMR_MANUAL_CONFIG
        .reviewDecisions[key];
    });

  if (allowed.indexOf(decision) === -1) {
    throw new Error(
      `Invalid review decision "${value}". ` +
      `Allowed values: ${allowed.join(', ')}`
    );
  }

  return decision;
}

function normalizeManualFmrReviewIds_(
  value
) {
  const values =
    Array.isArray(value)
      ? value
      : [value];

  return Array.from(
    new Set(
      values
        .map(function (reviewId) {
          return normalizeManualFmrText_(
            reviewId
          );
        })
        .filter(Boolean)
    )
  );
}

function normalizeManualFmrReviewLimit_(
  value,
  fallback
) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 1000
  ) {
    throw new Error(
      'maximumRows must be a whole number from 1 through 1000.'
    );
  }

  return number;
}

function normalizeManualFmrYesNo_(
  value
) {
  return [
    'YES',
    'Y',
    'TRUE',
    '1',
    'ACTIVE'
  ].indexOf(
    normalizeManualFmrUpper_(value)
  ) !== -1;
}

function buildManualFmrIsoKey_(
  iwpNumber,
  isoLineNumber,
  isoSheet,
  isoDrawingNumber
) {
  return [
    normalizeManualFmrUpper_(iwpNumber),
    normalizeManualFmrUpper_(
      isoLineNumber
    ),
    normalizeManualFmrUpper_(isoSheet),
    normalizeManualFmrUpper_(
      isoDrawingNumber
    )
  ].join('|');
}

function createManualFmrCanonicalFmrId_() {
  return `FMR-${Utilities.getUuid()}`;
}

function createManualFmrCanonicalLineId_() {
  return `FMRLINE-${Utilities.getUuid()}`;
}

function createManualFmrIwpId_() {
  return `IWP-${Utilities.getUuid()}`;
}

function createManualFmrIsoId_() {
  return `ISO-${Utilities.getUuid()}`;
}

function createManualFmrAuditId_() {
  return `AUDIT-${Utilities.getUuid()}`;
}

function createManualFmrReviewCorrelationId_() {
  return `MANUAL-FMR-${Utilities.getUuid()}`;
}

function sumManualFmrField_(
  items,
  field
) {
  return (items || []).reduce(
    function (total, item) {
      const number = Number(
        item.record[field] || 0
      );

      return total + (
        Number.isFinite(number)
          ? number
          : 0
      );
    },
    0
  );
}

function calculateManualFmrAgeDays_(
  createdAt,
  now
) {
  const created =
    createdAt instanceof Date
      ? createdAt
      : new Date(createdAt);

  const current =
    now instanceof Date
      ? now
      : new Date(now);

  if (
    isNaN(created.getTime()) ||
    isNaN(current.getTime())
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (
        current.getTime() -
        created.getTime()
      ) /
      86400000
    )
  );
}

function calculateManualFmrRiskFlag_(
  requiredDate,
  now
) {
  if (!requiredDate) {
    return 'No Required Date';
  }

  const required =
    requiredDate instanceof Date
      ? requiredDate
      : new Date(requiredDate);

  const current =
    now instanceof Date
      ? now
      : new Date(now);

  if (
    isNaN(required.getTime()) ||
    isNaN(current.getTime())
  ) {
    return 'Invalid Required Date';
  }

  const days =
    Math.ceil(
      (
        required.getTime() -
        current.getTime()
      ) /
      86400000
    );

  if (days < 0) {
    return 'Overdue';
  }

  if (days <= 7) {
    return 'Due Soon';
  }

  return 'On Track';
}

function chooseManualFmrStatusWithoutDowngrade_(
  currentStatus,
  proposedStatus
) {
  const current =
    normalizeManualFmrUpper_(
      currentStatus
    );
  const proposed =
    normalizeManualFmrUpper_(
      proposedStatus
    );

  const order =
    FMR_MANUAL_REVIEW_SUPPORT
      .fmrStatusOrder;

  const currentIndex =
    order.indexOf(current);
  const proposedIndex =
    order.indexOf(proposed);

  if (currentIndex === -1) {
    return proposedStatus;
  }

  if (proposedIndex === -1) {
    return currentStatus;
  }

  return currentIndex >= proposedIndex
    ? currentStatus
    : proposedStatus;
}
