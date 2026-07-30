/**
 * Quantity rollups and baseline migration for FMR line/header balances.
 */

function totalMaterials_(materials) {
  const total = field =>
    (materials || []).reduce((sum, item) => sum + number_(item[field]), 0);

  return {
    requested: total('qtyRequested'),
    located: total('qtyConfirmedLocated'),
    bagged: total('qtyActiveBagged'),
    available: total('qtyAvailable'),
    issued: total('qtyIssued'),
    pendingBackorder: total('qtyPendingBackorder'),
    confirmedBackorder: total('qtyConfirmedBackorder')
  };
}

function deriveLineBalances_(line, transactions, bagItems) {
  const requested = number_(line.Qty_Requested);
  let located = 0;
  let available = 0;
  let bagged = 0;
  let issued = 0;
  let pendingBackorder = 0;
  let confirmedBackorder = 0;
  let dateFirstLocated = '';
  let dateFirstBagged = '';
  let dateFirstIssued = '';
  let storageLocation = normalize_(line.Storage_Location);

  (transactions || []).forEach(tx => {
    const type = normalizeUpper_(tx.Transaction_Type);
    const qty = number_(tx.Quantity);
    const stamp = tx.Timestamp || '';

    if (type === 'CONFIRM_AVAILABLE' || type === 'AVAILABLE_CONFIRMED') {
      located += qty;
      available += qty;
      if (!dateFirstLocated) dateFirstLocated = stamp;
      if (normalize_(tx.Storage_Location)) {
        storageLocation = normalize_(tx.Storage_Location);
      }
    } else if (type === 'BAG' || type === 'BAGGED') {
      available = Math.max(0, available - qty);
      bagged += qty;
      if (!dateFirstBagged) dateFirstBagged = stamp;
      if (normalize_(tx.Storage_Location)) {
        storageLocation = normalize_(tx.Storage_Location);
      }
    } else if (type === 'DIRECT_ISSUE' || type === 'LOCATE_AND_ISSUE') {
      located += qty;
      issued += qty;
      if (!dateFirstLocated) dateFirstLocated = stamp;
      if (!dateFirstIssued) dateFirstIssued = stamp;
      if (normalize_(tx.Storage_Location)) {
        storageLocation = normalize_(tx.Storage_Location);
      }
    } else if (type === 'ISSUE_FROM_AVAILABLE' || type === 'ISSUE_AVAILABLE') {
      available = Math.max(0, available - qty);
      issued += qty;
      if (!dateFirstIssued) dateFirstIssued = stamp;
    } else if (type === 'ISSUE_FROM_BAG') {
      bagged = Math.max(0, bagged - qty);
      issued += qty;
      if (!dateFirstIssued) dateFirstIssued = stamp;
    } else if (type === 'BACKORDER_REQUESTED') {
      pendingBackorder += qty;
    } else if (type === 'BACKORDER_CONFIRMED') {
      pendingBackorder = Math.max(0, pendingBackorder - qty);
      confirmedBackorder += qty;
    } else if (type === 'BACKORDER_REJECTED') {
      pendingBackorder = Math.max(0, pendingBackorder - qty);
    }
  });

  const activeBagQty = (bagItems || [])
    .filter(item =>
      normalize_(item.FMR_Line_ID) === normalize_(line.FMR_Line_ID) &&
      number_(item.Qty_Remaining_In_Bag) > 0 &&
      normalizeUpper_(item.Status || 'ACTIVE') === 'ACTIVE'
    )
    .reduce((sum, item) => sum + number_(item.Qty_Remaining_In_Bag), 0);

  if (activeBagQty > 0 || (bagItems || []).length) {
    bagged = activeBagQty;
  }

  const notYetLocated = Math.max(
    0,
    requested - located - pendingBackorder - confirmedBackorder
  );
  const remainingRequirement = Math.max(
    0,
    requested - issued - confirmedBackorder
  );

  return {
    Qty_Confirmed_Located: roundQty_(located),
    Qty_Active_Bagged: roundQty_(bagged),
    Qty_Available: roundQty_(Math.max(0, available)),
    Qty_Issued: roundQty_(issued),
    Qty_Pending_Backorder: roundQty_(pendingBackorder),
    Qty_Confirmed_Backorder: roundQty_(confirmedBackorder),
    Qty_Not_Yet_Located: roundQty_(notYetLocated),
    Qty_Remaining_Requirement: roundQty_(remainingRequirement),
    Line_Status: deriveLineStatus_({
      requested,
      located,
      available: Math.max(0, available),
      bagged,
      issued,
      pendingBackorder,
      confirmedBackorder,
      notYetLocated,
      remainingRequirement
    }),
    Storage_Location: storageLocation,
    Date_First_Located: dateFirstLocated || line.Date_First_Located || '',
    Date_First_Bagged: dateFirstBagged || line.Date_First_Bagged || '',
    Date_First_Issued: dateFirstIssued || line.Date_First_Issued || ''
  };
}

function deriveLineStatus_(balances) {
  if (balances.requested <= 0) return 'Open';
  if (balances.remainingRequirement <= 0) {
    return balances.confirmedBackorder > 0 ? 'Closed With Backorder' : 'Issued';
  }
  if (balances.issued > 0) return 'Partially Issued';
  if (balances.bagged > 0 && balances.available > 0) return 'Partially Located';
  if (balances.bagged > 0) return 'Bagged';
  if (balances.available > 0 || balances.located > 0) return 'Located';
  if (balances.pendingBackorder > 0) return 'Pending Backorder';
  return 'Open';
}

function deriveHeaderStatus_(currentStatus, lines) {
  const statuses = (lines || []).map(line => normalizeUpper_(line.Line_Status));
  if (!statuses.length) return normalize_(currentStatus) || 'Approved';

  if (statuses.every(status => status === 'ISSUED' || status === 'CLOSED WITH BACKORDER')) {
    return 'Issued';
  }
  if (statuses.some(status => status.includes('ISSUED'))) return 'Partially Issued';
  if (statuses.every(status =>
    ['LOCATED', 'BAGGED', 'PARTIALLY LOCATED'].includes(status)
  )) {
    return 'Located';
  }
  if (statuses.some(status =>
    ['LOCATED', 'BAGGED', 'PARTIALLY LOCATED', 'PENDING BACKORDER'].includes(status)
  )) {
    return 'Partially Located';
  }
  if (statuses.some(status => status === 'PENDING BACKORDER')) {
    return 'Sourcing';
  }

  const preserved = normalize_(currentStatus);
  return preserved || 'Approved';
}

function refreshLineSummary_(fmrLineId) {
  const lineId = normalize_(fmrLineId);
  if (!lineId) throw new Error('FMR line ID is required.');

  const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId);
  if (!line) throw new Error(`FMR line not found: ${lineId}`);

  const transactions = getSheetData_(FMR_CORE.SHEETS.TRANSACTIONS).rows.filter(
    row => normalize_(row.FMR_Line_ID) === lineId
  );
  const bagItems = getSheetData_(FMR_CORE.SHEETS.BAG_TAG_ITEMS).rows.filter(
    row => normalize_(row.FMR_Line_ID) === lineId
  );

  const patch = deriveLineBalances_(line, transactions, bagItems);
  patch.Updated_At = now_();

  updateRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId, patch);
  return findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId);
}

function refreshFmrHeaderSummary_(fmrId) {
  const id = normalize_(fmrId);
  if (!id) throw new Error('FMR ID is required.');

  const header = findRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', id);
  if (!header) throw new Error(`FMR not found: ${id}`);

  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows.filter(
    row => normalize_(row.FMR_ID) === id
  );

  const sum = field =>
    lines.reduce((total, row) => total + number_(row[field]), 0);

  const qtyRequested = sum('Qty_Requested');
  const qtyIssued = sum('Qty_Issued');
  const patch = {
    Total_Lines: lines.length,
    Qty_Requested: roundQty_(qtyRequested),
    Qty_Confirmed_Located: roundQty_(sum('Qty_Confirmed_Located')),
    Qty_Active_Bagged: roundQty_(sum('Qty_Active_Bagged')),
    Qty_Available: roundQty_(sum('Qty_Available')),
    Qty_Issued: roundQty_(qtyIssued),
    Qty_Pending_Backorder: roundQty_(sum('Qty_Pending_Backorder')),
    Qty_Confirmed_Backorder: roundQty_(sum('Qty_Confirmed_Backorder')),
    Qty_Remaining_Requirement: roundQty_(sum('Qty_Remaining_Requirement')),
    Fulfillment_Pct: qtyRequested > 0 ? qtyIssued / qtyRequested : 0,
    Current_Status: deriveHeaderStatus_(header.Current_Status, lines),
    Updated_At: now_(),
    Last_Activity_At: now_()
  };

  updateRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', id, patch);
  return findRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', id);
}

function migrateExistingQuantityBaselines_(userEmail) {
  const user = getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL
  ], 'ADMIN');

  clearAllCaches_();

  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows;
  const transactionsByLine = groupBy_(
    getSheetData_(FMR_CORE.SHEETS.TRANSACTIONS).rows,
    'FMR_Line_ID'
  );
  const bagItemsByLine = groupBy_(
    getSheetData_(FMR_CORE.SHEETS.BAG_TAG_ITEMS).rows,
    'FMR_Line_ID'
  );

  let migratedLines = 0;
  let skippedLines = 0;
  const affected = {};

  lines.forEach(line => {
    const lineId = normalize_(line.FMR_Line_ID);
    if (!lineId) {
      skippedLines += 1;
      return;
    }

    const next = deriveLineBalances_(
      line,
      transactionsByLine[lineId] || [],
      bagItemsByLine[lineId] || []
    );

    const changed = Object.keys(next).some(
      key => normalize_(line[key]) !== normalize_(next[key]) &&
        number_(line[key]) !== number_(next[key])
    );

    if (!changed) {
      skippedLines += 1;
      return;
    }

    next.Updated_At = now_();
    updateRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId, next);
    affected[normalize_(line.FMR_ID)] = true;
    migratedLines += 1;
  });

  Object.keys(affected).forEach(fmrId => {
    if (fmrId) refreshFmrHeaderSummary_(fmrId);
  });

  writeAudit_(
    'SYSTEM',
    database_().getId(),
    'MIGRATE_QUANTITY_BASELINES',
    user,
    '',
    {
      migratedLines,
      skippedLines,
      affectedFmrs: Object.keys(affected).filter(Boolean).length
    }
  );

  return {
    migratedLines,
    skippedLines,
    affectedFmrs: Object.keys(affected).filter(Boolean).length
  };
}

function actionLimitsForLine_(line) {
  const requested = number_(line.Qty_Requested);
  const located = number_(line.Qty_Confirmed_Located);
  const available = number_(line.Qty_Available);
  const pending = number_(line.Qty_Pending_Backorder);
  const confirmed = number_(line.Qty_Confirmed_Backorder);
  const notYetLocated = Math.max(
    0,
    number_(line.Qty_Not_Yet_Located) ||
      (requested - located - pending - confirmed)
  );

  return {
    confirmAvailable: roundQty_(notYetLocated),
    bag: roundQty_(available),
    directIssue: roundQty_(notYetLocated),
    issueAvailable: roundQty_(available),
    backorder: roundQty_(notYetLocated)
  };
}

function roundQty_(value) {
  const number = number_(value);
  return Math.round(number * 1000) / 1000;
}

function groupBy_(rows, field) {
  return (rows || []).reduce((map, row) => {
    const key = normalize_(row[field]);
    if (!key) return map;
    if (!map[key]) map[key] = [];
    map[key].push(row);
    return map;
  }, {});
}
