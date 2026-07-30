/**
 * Planning backorder review.
 * Field requests remain pending until an Administrator or Planner reviews them.
 */
function reviewBackorder_(userEmail, request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    clearAllCaches_();
    const user = getAuthorizedUser_(userEmail, [
      FMR_CORE.ROLES.ADMIN,
      FMR_CORE.ROLES.PLANNER,
      FMR_CORE.ROLES.MATERIAL_CONTROL
    ], 'ADMIN');

    const requestId = normalize_(request.requestId);
    const decision = normalizeUpper_(request.decision);
    const planningNotes = normalize_(request.planningNotes);
    if (!requestId) throw new Error('Backorder request ID is required.');

    const record = findRecord_(FMR_CORE.SHEETS.BACKORDERS, 'Backorder_Request_ID', requestId);
    if (!record) throw new Error(`Backorder request not found: ${requestId}`);

    const currentStatus = normalize_(record.Status);
    if (['Confirmed', 'Rejected', 'Cleared', 'Cancelled'].includes(currentStatus)) {
      throw new Error(`Backorder request is already ${currentStatus}.`);
    }

    const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', record.FMR_Line_ID);
    if (!line) throw new Error(`FMR line not found: ${record.FMR_Line_ID}`);

    const requestedQty = number_(record.Qty_Requested_Backorder);
    const alreadyConfirmed = number_(record.Qty_Confirmed_Backorder);
    const remainingQty = Math.max(0, requestedQty - alreadyConfirmed);
    const correlationId = uuid_('CORR');

    let transactionType = '';
    let transactionQty = 0;
    let nextStatus = currentStatus;
    let totalConfirmed = alreadyConfirmed;

    if (decision === 'CONFIRM') {
      if (remainingQty <= 0) throw new Error('No pending backorder quantity remains.');
      transactionType = 'BACKORDER_CONFIRMED';
      transactionQty = remainingQty;
      totalConfirmed = requestedQty;
      nextStatus = 'Confirmed';
    } else if (decision === 'PARTIAL_CONFIRM') {
      transactionQty = number_(request.confirmedQty);
      if (transactionQty <= 0 || transactionQty > remainingQty) {
        throw new Error(`Confirmed quantity must be greater than 0 and no more than ${remainingQty}.`);
      }
      transactionType = 'BACKORDER_CONFIRMED';
      totalConfirmed = alreadyConfirmed + transactionQty;
      nextStatus = totalConfirmed >= requestedQty ? 'Confirmed' : 'Partially Confirmed';
    } else if (decision === 'REJECT') {
      if (remainingQty <= 0) throw new Error('No pending quantity remains to reject.');
      transactionType = 'BACKORDER_REJECTED';
      transactionQty = remainingQty;
      nextStatus = 'Rejected';
    } else if (decision === 'RETURN') {
      nextStatus = 'Returned for Clarification';
    } else {
      throw new Error(`Unsupported backorder decision: ${decision}`);
    }

    if (transactionType) {
      appendRecord_(FMR_CORE.SHEETS.TRANSACTIONS, {
        Transaction_ID: uuid_('TXN'),
        Correlation_ID: correlationId,
        FMR_ID: record.FMR_ID,
        FMR_Number: record.FMR_Number,
        FMR_Line_ID: record.FMR_Line_ID,
        Transaction_Type: transactionType,
        Quantity: transactionQty,
        UOM: line.UOM,
        Authenticated_Email: user.email,
        Performed_By_Name: user.name,
        Backorder_Request_ID: requestId,
        Timestamp: now_(),
        Notes: planningNotes
      });
    }

    updateRecord_(FMR_CORE.SHEETS.BACKORDERS, 'Backorder_Request_ID', requestId, {
      Qty_Confirmed_Backorder: totalConfirmed,
      Status: nextStatus,
      Reviewed_By_Name: user.name,
      Reviewed_By_Email: user.email,
      Reviewed_At: now_(),
      Planning_Notes: planningNotes
    });

    const refreshedLine = refreshLineSummary_(record.FMR_Line_ID);
    const refreshedHeader = refreshFmrHeaderSummary_(record.FMR_ID);

    writeAudit_(
      'BACKORDER',
      requestId,
      `BACKORDER_${decision}`,
      user,
      correlationId,
      {
        transactionQty,
        totalConfirmed,
        nextStatus,
        planningNotes
      }
    );

    return {
      success: true,
      requestId,
      nextStatus,
      transactionQty,
      totalConfirmed,
      line: serializeMaterialLine_(refreshedLine),
      fmrStatus: refreshedHeader.Current_Status
    };
  } finally {
    lock.releaseLock();
  }
}
