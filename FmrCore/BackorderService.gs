/**
 * BackorderService.gs
 *
 * FMRCore v2.3.1 Planning backorder decision service.
 *
 * Responsibilities:
 * - Authorize Planning backorder reviewers through Security.gs.
 * - Allow decisions only for genuinely actionable request statuses.
 * - Reconcile prior confirmation and rejection transactions.
 * - Persist and verify Backorder_Requests before appending transactions.
 * - Prevent duplicate confirmation and rejection transactions.
 * - Refresh canonical FMR line and header quantity summaries.
 * - Return the verified persisted decision state.
 *
 * Depends on:
 * - Security.gs
 * - Repository.gs
 * - QuantityService.gs
 * - SerializationService.gs
 */

function reviewBackorder_(userEmail, request) {
  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    clearAllCaches_();

    const user =
      getAuthorizedUser_(
        userEmail,
        backorderReviewRoles_(),
        'ADMIN'
      );

    const source =
      request || {};

    const requestId =
      normalize_(
        source.requestId
      );

    const decision =
      normalizeUpper_(
        source.decision
      );

    const planningNotes =
      normalize_(
        source.planningNotes
      );

    if (!requestId) {
      throw new Error(
        'Backorder request ID is required.'
      );
    }

    const record =
      findRecord_(
        FMR_CORE.SHEETS.BACKORDERS,
        'Backorder_Request_ID',
        requestId
      );

    if (!record) {
      throw new Error(
        `Backorder request not found: ${requestId}`
      );
    }

    const currentStatus =
      normalize_(
        record.Status
      );

    if (
      !isActionableBackorderStatus_(
        currentStatus
      )
    ) {
      throw new Error(
        `Backorder request is not actionable because its current status is ` +
        `"${currentStatus || 'blank'}".`
      );
    }

    const line =
      findRecord_(
        FMR_CORE.SHEETS.LINES,
        'FMR_Line_ID',
        record.FMR_Line_ID
      );

    if (!line) {
      throw new Error(
        `FMR line not found: ${record.FMR_Line_ID}`
      );
    }

    const requestedQty =
      number_(
        record.Qty_Requested_Backorder
      );

    if (requestedQty <= 0) {
      throw new Error(
        'Backorder requested quantity must be greater than zero.'
      );
    }

    const ledger =
      getBackorderDecisionLedgerState_(
        requestId
      );

    if (ledger.rejectedQty > 0) {
      throw new Error(
        `Backorder request ${requestId} already has a rejection transaction ` +
        `and requires administrative cleanup before another decision.`
      );
    }

    if (
      ledger.confirmedQty >
      requestedQty
    ) {
      throw new Error(
        `Backorder request ${requestId} has ${ledger.confirmedQty} confirmed ` +
        `in the transaction ledger against ${requestedQty} requested. ` +
        `Remove or reconcile the duplicate test transactions before continuing.`
      );
    }

    const storedConfirmed =
      number_(
        record.Qty_Confirmed_Backorder
      );

    const alreadyConfirmed =
      Math.max(
        storedConfirmed,
        ledger.confirmedQty
      );

    const remainingQty =
      Math.max(
        0,
        requestedQty -
        alreadyConfirmed
      );

    if (
      alreadyConfirmed >=
      requestedQty
    ) {
      throw new Error(
        `Backorder request ${requestId} is already fully confirmed.`
      );
    }

    const correlationId =
      uuid_('CORR');

    const reviewedAt =
      now_();

    let transactionType = '';
    let transactionQty = 0;
    let nextStatus = currentStatus;
    let totalConfirmed = alreadyConfirmed;

    if (decision === 'CONFIRM') {
      if (remainingQty <= 0) {
        throw new Error(
          'No pending backorder quantity remains.'
        );
      }

      transactionType =
        'BACKORDER_CONFIRMED';

      transactionQty =
        remainingQty;

      totalConfirmed =
        requestedQty;

      nextStatus =
        'Confirmed';

    } else if (
      decision ===
      'PARTIAL_CONFIRM'
    ) {
      transactionQty =
        number_(
          source.confirmedQty
        );

      if (
        transactionQty <= 0 ||
        transactionQty >
        remainingQty
      ) {
        throw new Error(
          `Confirmed quantity must be greater than 0 and no more than ` +
          `${remainingQty}.`
        );
      }

      transactionType =
        'BACKORDER_CONFIRMED';

      totalConfirmed =
        alreadyConfirmed +
        transactionQty;

      nextStatus =
        totalConfirmed >= requestedQty
          ? 'Confirmed'
          : 'Partially Confirmed';

    } else if (
      decision === 'REJECT'
    ) {
      if (remainingQty <= 0) {
        throw new Error(
          'No pending quantity remains to reject.'
        );
      }

      transactionType =
        'BACKORDER_REJECTED';

      transactionQty =
        remainingQty;

      nextStatus =
        'Rejected';

    } else if (
      decision === 'RETURN'
    ) {
      nextStatus =
        'Returned for Clarification';

    } else {
      throw new Error(
        `Unsupported backorder decision: ${decision}`
      );
    }

    /*
     * Persist the request state first and verify it before recording a
     * transaction. This prevents a silent update failure from producing
     * another append-only transaction while the request remains actionable.
     */
    updateRecord_(
      FMR_CORE.SHEETS.BACKORDERS,
      'Backorder_Request_ID',
      requestId,
      {
        Qty_Confirmed_Backorder:
          totalConfirmed,

        Status:
          nextStatus,

        Reviewed_By_Name:
          user.name,

        Reviewed_By_Email:
          user.email,

        Reviewed_At:
          reviewedAt,

        Planning_Notes:
          planningNotes
      }
    );

    SpreadsheetApp.flush();
    clearAllCaches_();

    const persistedRequest =
      findRecord_(
        FMR_CORE.SHEETS.BACKORDERS,
        'Backorder_Request_ID',
        requestId
      );

    assertPersistedBackorderDecision_(
      persistedRequest,
      {
        requestId,
        nextStatus,
        totalConfirmed,
        reviewerEmail:
          user.email
      }
    );

    let transactionId = '';

    if (transactionType) {
      transactionId =
        uuid_('TXN');

      appendRecord_(
        FMR_CORE.SHEETS.TRANSACTIONS,
        {
          Transaction_ID:
            transactionId,

          Correlation_ID:
            correlationId,

          FMR_ID:
            record.FMR_ID,

          FMR_Number:
            record.FMR_Number,

          FMR_Line_ID:
            record.FMR_Line_ID,

          Transaction_Type:
            transactionType,

          Quantity:
            transactionQty,

          UOM:
            line.UOM,

          Authenticated_Email:
            user.email,

          Performed_By_Name:
            user.name,

          Backorder_Request_ID:
            requestId,

          Timestamp:
            reviewedAt,

          Notes:
            planningNotes
        }
      );

      SpreadsheetApp.flush();
      clearAllCaches_();

      const persistedTransaction =
        findRecord_(
          FMR_CORE.SHEETS.TRANSACTIONS,
          'Transaction_ID',
          transactionId
        );

      if (!persistedTransaction) {
        throw new Error(
          `Backorder request ${requestId} was updated, but transaction ` +
          `${transactionId} could not be verified. Stop testing and inspect ` +
          `Material_Transactions before retrying.`
        );
      }
    }

    clearAllCaches_();

    const refreshedLine =
      refreshLineSummary_(
        record.FMR_Line_ID
      );

    clearAllCaches_();

    const refreshedHeader =
      refreshFmrHeaderSummary_(
        record.FMR_ID
      );

    SpreadsheetApp.flush();
    clearAllCaches_();

    const finalRequest =
      findRecord_(
        FMR_CORE.SHEETS.BACKORDERS,
        'Backorder_Request_ID',
        requestId
      );

    assertPersistedBackorderDecision_(
      finalRequest,
      {
        requestId,
        nextStatus,
        totalConfirmed,
        reviewerEmail:
          user.email
      }
    );

    writeAudit_(
      'BACKORDER',
      requestId,
      `BACKORDER_${decision}`,
      user,
      correlationId,
      {
        transactionId,
        transactionQty,
        totalConfirmed,
        pendingQty:
          Math.max(
            0,
            requestedQty -
            totalConfirmed
          ),
        nextStatus,
        planningNotes
      }
    );

    SpreadsheetApp.flush();
    clearAllCaches_();

    return {
      success: true,
      requestId,
      correlationId,
      transactionId,
      nextStatus,
      transactionQty,
      requestedQty,
      totalConfirmed,
      pendingQty:
        Math.max(
          0,
          requestedQty -
          totalConfirmed
        ),
      line:
        serializeMaterialLine_(
          refreshedLine
        ),
      fmrStatus:
        refreshedHeader
          .Current_Status
    };

  } finally {
    clearAllCaches_();
    lock.releaseLock();
  }
}

function isActionableBackorderStatus_(
  status
) {
  return [
    'PENDING PLANNING CONFIRMATION',
    'PARTIALLY CONFIRMED'
  ].includes(
    normalizeUpper_(
      status
    )
  );
}

function getBackorderDecisionLedgerState_(
  requestId
) {
  const normalizedRequestId =
    normalize_(
      requestId
    );

  const transactions =
    getSheetData_(
      FMR_CORE.SHEETS.TRANSACTIONS
    )
      .rows
      .filter(function (row) {
        return (
          normalize_(
            row.Backorder_Request_ID
          ) ===
          normalizedRequestId
        );
      });

  return transactions.reduce(
    function (state, row) {
      const transactionType =
        normalizeUpper_(
          row.Transaction_Type
        );

      const quantity =
        number_(
          row.Quantity
        );

      if (
        transactionType ===
        'BACKORDER_CONFIRMED'
      ) {
        state.confirmedQty +=
          quantity;
      }

      if (
        transactionType ===
        'BACKORDER_REJECTED'
      ) {
        state.rejectedQty +=
          quantity;
      }

      return state;
    },
    {
      confirmedQty: 0,
      rejectedQty: 0
    }
  );
}

function assertPersistedBackorderDecision_(
  record,
  expected
) {
  if (!record) {
    throw new Error(
      `Backorder request ${expected.requestId} was not found after update.`
    );
  }

  const actualStatus =
    normalizeUpper_(
      record.Status
    );

  const expectedStatus =
    normalizeUpper_(
      expected.nextStatus
    );

  const actualConfirmed =
    number_(
      record.Qty_Confirmed_Backorder
    );

  const actualReviewer =
    normalizeUpper_(
      record.Reviewed_By_Email
    );

  const expectedReviewer =
    normalizeUpper_(
      expected.reviewerEmail
    );

  const issues = [];

  if (
    actualStatus !==
    expectedStatus
  ) {
    issues.push(
      `status remained "${record.Status || 'blank'}"`
    );
  }

  if (
    actualConfirmed !==
    number_(
      expected.totalConfirmed
    )
  ) {
    issues.push(
      `confirmed quantity is ${actualConfirmed}, expected ` +
      `${expected.totalConfirmed}`
    );
  }

  if (
    actualReviewer !==
    expectedReviewer
  ) {
    issues.push(
      `reviewer email is "${record.Reviewed_By_Email || 'blank'}"`
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Backorder request ${expected.requestId} did not persist correctly: ` +
      issues.join('; ') +
      '. No additional transaction should be attempted.'
    );
  }

  return true;
}
