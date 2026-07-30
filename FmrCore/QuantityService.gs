/**
 * Quantity summaries are derived from append-only transactions.
 *
 * Important Step 3 rule:
 * - BAG reserves material but does not independently count as locating it.
 * - A Bag & Tag action creates CONFIRM_AVAILABLE only for the portion not already available,
 *   then creates BAG for the full reserved quantity.
 */
function summarizeLineQuantities_(lineId) {
  const transactions = getSheetData_(FMR_CORE.SHEETS.TRANSACTIONS).rows
    .filter(row => normalize_(row.FMR_Line_ID) === normalize_(lineId));

  const sum = type => transactions
    .filter(row => normalizeUpper_(row.Transaction_Type) === type)
    .reduce((total, row) => total + number_(row.Quantity), 0);

  const confirmed =
    sum('CONFIRM_AVAILABLE') +
    sum('DIRECT_ISSUE') +
    sum('QUANTITY_ADJUSTMENT');

  const activeBagged =
    sum('BAG') -
    sum('RELEASE_BAG') -
    sum('ISSUE_FROM_BAG');

  const issued =
    sum('DIRECT_ISSUE') +
    sum('ISSUE_FROM_AVAILABLE') +
    sum('ISSUE_FROM_BAG') -
    sum('RETURN');

  const pendingBackorder =
    sum('BACKORDER_REQUESTED') -
    sum('BACKORDER_CONFIRMED') -
    sum('BACKORDER_REJECTED');

  const confirmedBackorder =
    sum('BACKORDER_CONFIRMED') -
    sum('BACKORDER_CLEARED');

  return {
    confirmedLocated: Math.max(0, confirmed),
    activeBagged: Math.max(0, activeBagged),
    available: Math.max(0, confirmed - issued - activeBagged),
    issued: Math.max(0, issued),
    pendingBackorder: Math.max(0, pendingBackorder),
    confirmedBackorder: Math.max(0, confirmedBackorder)
  };
}

function getLineOperationalState_(line) {
  const requested = number_(line.Qty_Requested);
  const summary = summarizeLineQuantities_(line.FMR_Line_ID);
  return {
    requested,
    ...summary,
    notYetLocated: Math.max(0, requested - summary.confirmedLocated),
    remainingRequirement: Math.max(0, requested - summary.issued),
    maximumNewBackorder: Math.max(
      0,
      requested -
        summary.confirmedLocated -
        summary.pendingBackorder -
        summary.confirmedBackorder
    )
  };
}

function calculateLineStatus_(requested, summary) {
  if (summary.issued >= requested && requested > 0) return 'Issued';
  if (summary.issued > 0) return 'Partially Issued';
  if (summary.confirmedBackorder > 0) return 'Backordered';
  if (summary.pendingBackorder > 0) return 'Pending Backorder';
  if (summary.activeBagged >= requested && requested > 0) return 'Bagged';
  if (summary.activeBagged > 0) return 'Partially Bagged';
  if (summary.confirmedLocated >= requested && requested > 0) return 'Located';
  if (summary.confirmedLocated > 0) return 'Partially Located';
  return 'Open';
}

function refreshLineSummary_(lineId) {
  const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId);
  if (!line) throw new Error(`FMR line not found: ${lineId}`);

  const state = getLineOperationalState_(line);
  const patch = {
    Qty_Confirmed_Located: state.confirmedLocated,
    Qty_Active_Bagged: state.activeBagged,
    Qty_Available: state.available,
    Qty_Issued: state.issued,
    Qty_Pending_Backorder: state.pendingBackorder,
    Qty_Confirmed_Backorder: state.confirmedBackorder,
    Qty_Not_Yet_Located: state.notYetLocated,
    Qty_Remaining_Requirement: state.remainingRequirement,
    Line_Status: calculateLineStatus_(state.requested, state),
    Updated_At: now_()
  };

  updateRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId, patch);
  return {...line, ...patch};
}

function calculateFmrStatus_(currentStatus, lines) {
  const preserved = normalize_(currentStatus);
  if (['Closed', 'Cancelled', 'On Hold'].includes(preserved)) return preserved;
  if (!lines.length) return preserved || 'Draft';

  const allIssued = lines.every(line => number_(line.Qty_Remaining_Requirement) === 0);
  const anyIssued = lines.some(line => number_(line.Qty_Issued) > 0);
  const anyBackorder = lines.some(line =>
    number_(line.Qty_Pending_Backorder) > 0 ||
    number_(line.Qty_Confirmed_Backorder) > 0
  );
  const allLocated = lines.every(line =>
    number_(line.Qty_Confirmed_Located) >= number_(line.Qty_Requested)
  );
  const anyLocated = lines.some(line => number_(line.Qty_Confirmed_Located) > 0);

  if (allIssued) return 'Issued';
  if (anyIssued) return 'Partially Issued';
  if (anyBackorder) return 'Sourcing';
  if (allLocated) return 'Located';
  if (anyLocated) return 'Partially Located';
  return preserved || 'Approved';
}

function refreshFmrHeaderSummary_(fmrId) {
  const header = findRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', fmrId);
  if (!header) throw new Error(`FMR not found: ${fmrId}`);

  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows
    .filter(row => normalize_(row.FMR_ID) === normalize_(fmrId));

  const sum = field => lines.reduce((total, row) => total + number_(row[field]), 0);
  const qtyRequested = sum('Qty_Requested');
  const qtyIssued = sum('Qty_Issued');

  const patch = {
    Current_Status: calculateFmrStatus_(header.Current_Status, lines),
    Total_Lines: lines.length,
    Qty_Requested: qtyRequested,
    Qty_Confirmed_Located: sum('Qty_Confirmed_Located'),
    Qty_Active_Bagged: sum('Qty_Active_Bagged'),
    Qty_Available: sum('Qty_Available'),
    Qty_Issued: qtyIssued,
    Qty_Pending_Backorder: sum('Qty_Pending_Backorder'),
    Qty_Confirmed_Backorder: sum('Qty_Confirmed_Backorder'),
    Qty_Remaining_Requirement: Math.max(0, qtyRequested - qtyIssued),
    Fulfillment_Pct: qtyRequested > 0 ? qtyIssued / qtyRequested : 0,
    Updated_At: now_(),
    Last_Activity_At: now_()
  };

  updateRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', fmrId, patch);
  return {...header, ...patch};
}
