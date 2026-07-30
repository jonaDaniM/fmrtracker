// Field Service gs
function getFieldPortalData_(userEmail, lineNumber, sheetNumber, auditSearch) {
  const user = getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT
  ], 'FIELD');

  const cards = searchByLineAndSheet_(
    userEmail,
    lineNumber,
    sheetNumber,
    'FIELD',
    auditSearch !== false
  );

  const activeTagData = getActiveBagDataByLine_();
  const enrichedCards = cards.map(card => ({
    ...card,
    materials: card.materials.map(material => {
      const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', material.fmrLineId);
      const state = line ? getLineOperationalState_(line) : {
        requested: material.qtyRequested,
        confirmedLocated: material.qtyConfirmedLocated,
        activeBagged: material.qtyActiveBagged,
        available: material.qtyAvailable,
        issued: material.qtyIssued,
        pendingBackorder: material.qtyPendingBackorder,
        confirmedBackorder: material.qtyConfirmedBackorder,
        notYetLocated: Math.max(0, material.qtyRequested - material.qtyConfirmedLocated),
        remainingRequirement: Math.max(0, material.qtyRequested - material.qtyIssued),
        maximumNewBackorder: 0
      };
      const bagData = activeTagData[material.fmrLineId] || [];

      return {
        ...material,
        qtyConfirmedLocated: state.confirmedLocated,
        qtyActiveBagged: state.activeBagged,
        qtyAvailable: state.available,
        qtyIssued: state.issued,
        qtyPendingBackorder: state.pendingBackorder,
        qtyConfirmedBackorder: state.confirmedBackorder,
        qtyRemainingRequirement: state.remainingRequirement,
        actionLimits: {
          confirmAvailable: state.notYetLocated,
          bag: Math.max(0, state.available + state.notYetLocated),
          directIssue: state.notYetLocated,
          issueAvailable: state.available,
          backorder: state.maximumNewBackorder
        },
        activeBags: bagData,
        eligibleExistingTags: uniqueEligibleTags_(bagData)
      };
    })
  }));

  return {
    generatedAt: formatDateTime_(now_()),
    user: {
      userEmail: user.email,
      displayName: user.name,
      role: user.role,
      canTransact: canPerformFieldTransactions_(user.role)
    },
    options: {
      ...getFieldPersonnelOptions_(),
      backorderReasons: getListValues_('Backorder_Reason')
    },
    resultCount: enrichedCards.length,
    cards: enrichedCards
  };
}

function uniqueEligibleTags_(bagData) {
  const byId = {};
  bagData
    .filter(item => normalize_(item.status) === 'Active')
    .forEach(item => {
      if (!byId[item.bagTagId]) {
        byId[item.bagTagId] = {
          bagTagId: item.bagTagId,
          tagNumber: item.tagNumber,
          storageLocation: item.storageLocation
        };
      }
    });
  return Object.values(byId);
}

function getActiveBagDataByLine_() {
  const headers = getSheetData_(FMR_CORE.SHEETS.BAG_HEADERS).rows
    .filter(row => ['Active', 'Partially Issued'].includes(normalize_(row.Status)));
  const headersById = Object.fromEntries(
    headers.map(row => [normalize_(row.Bag_Tag_ID), row])
  );

  const result = {};
  getSheetData_(FMR_CORE.SHEETS.BAG_ITEMS).rows.forEach(item => {
    const header = headersById[normalize_(item.Bag_Tag_ID)];
    const remaining = number_(item.Qty_Remaining_In_Bag);
    if (!header || remaining <= 0) return;

    const lineId = normalize_(item.FMR_Line_ID);
    if (!result[lineId]) result[lineId] = [];
    result[lineId].push({
      bagTagItemId: normalize_(item.Bag_Tag_Item_ID),
      bagTagId: normalize_(item.Bag_Tag_ID),
      tagNumber: normalize_(item.Tag_Number || header.Tag_Number),
      storageLocation: normalize_(header.Storage_Location),
      qtyRemaining: remaining,
      uom: normalize_(item.UOM),
      status: normalize_(header.Status)
    });
  });

  Object.values(result).forEach(items => items.sort((a, b) =>
    a.tagNumber.localeCompare(b.tagNumber, undefined, {numeric: true})
  ));
  return result;
}

function performFieldAction_(userEmail, request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    clearAllCaches_();
    const user = getAuthorizedUser_(
      userEmail,
      fieldTransactionRoles_(),
      'FIELD'
    );

    const action = normalizeUpper_(request.action);
    switch (action) {
      case FMR_CORE.ACTIONS.CONFIRM_AVAILABLE:
        return confirmAvailable_(user, request);
      case FMR_CORE.ACTIONS.BAG:
        return bagMaterial_(user, request);
      case FMR_CORE.ACTIONS.DIRECT_ISSUE:
        return directIssue_(user, request);
      case FMR_CORE.ACTIONS.ISSUE_FROM_AVAILABLE:
        return issueAvailable_(user, request);
      case FMR_CORE.ACTIONS.ISSUE_FROM_BAG:
        return issueFromBag_(user, request);
      case FMR_CORE.ACTIONS.BACKORDER_REQUESTED:
        return submitBackorder_(user, request);
      default:
        throw new Error(`Unsupported field action: ${action}`);
    }
  } finally {
    lock.releaseLock();
  }
}

function getFieldLine_(request) {
  const lineId = normalize_(request.fmrLineId);
  if (!lineId) throw new Error('FMR line ID is required.');
  const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', lineId);
  if (!line) throw new Error(`FMR line not found: ${lineId}`);
  return line;
}

function appendMaterialTransaction_(line, transactionType, quantity, user, details) {
  const data = details || {};
  const transactionId = uuid_('TXN');
  appendRecord_(FMR_CORE.SHEETS.TRANSACTIONS, {
    Transaction_ID: transactionId,
    Correlation_ID: data.correlationId || '',
    FMR_ID: line.FMR_ID,
    FMR_Number: line.FMR_Number,
    FMR_Line_ID: line.FMR_Line_ID,
    Transaction_Type: transactionType,
    Quantity: quantity,
    UOM: line.UOM,
    Authenticated_Email: user.email,
    Performed_By_Name: data.performedByName || user.name,
    Issued_To_Name: data.issuedToName || '',
    Source_Bag_Tag_ID: data.sourceBagTagId || '',
    Target_Bag_Tag_ID: data.targetBagTagId || '',
    Storage_Location: data.storageLocation || '',
    Backorder_Request_ID: data.backorderRequestId || '',
    Timestamp: now_(),
    Notes: data.notes || ''
  });
  return transactionId;
}

function finishFieldAction_(line, user, action, correlationId, details) {
  const refreshedLine = refreshLineSummary_(line.FMR_Line_ID);
  const refreshedHeader = refreshFmrHeaderSummary_(line.FMR_ID);

  writeAudit_(
    'FMR_LINE',
    line.FMR_Line_ID,
    action,
    user,
    correlationId,
    details
  );

  return {
    success: true,
    action,
    correlationId,
    message: details.message || `${action} completed.`,
    line: serializeMaterialLine_(refreshedLine),
    fmrStatus: normalize_(refreshedHeader.Current_Status)
  };
}

function confirmAvailable_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Confirmed quantity');
  const handler = getSelectedWorker_(request.selectedUserId, 'Can_Bag', 'Handled By');
  const state = getLineOperationalState_(line);

  if (quantity > state.notYetLocated) {
    throw new Error(`Only ${state.notYetLocated} can be newly confirmed for this item.`);
  }

  const correlationId = uuid_('CORR');
  appendMaterialTransaction_(
    line,
    'CONFIRM_AVAILABLE',
    quantity,
    user,
    {
      correlationId,
      performedByName: handler.name,
      storageLocation: normalize_(request.storageLocation),
      notes: normalize_(request.notes)
    }
  );

  if (normalize_(request.storageLocation)) {
    updateRecord_(
      FMR_CORE.SHEETS.LINES,
      'FMR_Line_ID',
      line.FMR_Line_ID,
      {Storage_Location: normalize_(request.storageLocation)}
    );
  }

  return finishFieldAction_(
    line,
    user,
    'CONFIRM_AVAILABLE',
    correlationId,
    {
      quantity,
      handledBy: handler.name,
      message: `${quantity} ${normalize_(line.UOM)} confirmed available.`
    }
  );
}

function nextTagNumber_() {
  const config = getConfiguration_();
  const prefix = normalize_(config.TAG_PREFIX) || 'BT';
  const year = normalize_(config.CURRENT_YEAR) || String(now_().getFullYear());
  const digits = Math.max(1, number_(config.TAG_DIGITS) || 5);
  const sequence = Math.max(1, number_(config.NEXT_TAG_SEQUENCE) || 1);
  const tagNumber = `${prefix}-${year}-${String(sequence).padStart(digits, '0')}`;
  setConfigurationValue_('NEXT_TAG_SEQUENCE', sequence + 1);
  return tagNumber;
}

function bagMaterial_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Bag quantity');
  const handler = getSelectedWorker_(request.selectedUserId, 'Can_Bag', 'Bagged By');
  const state = getLineOperationalState_(line);
  const maximum = state.available + state.notYetLocated;

  if (quantity > maximum) {
    throw new Error(`Only ${maximum} can be bagged for this item.`);
  }

  const correlationId = uuid_('CORR');
  const newlyLocated = Math.max(0, quantity - state.available);
  if (newlyLocated > 0) {
    appendMaterialTransaction_(
      line,
      'CONFIRM_AVAILABLE',
      newlyLocated,
      user,
      {
        correlationId,
        performedByName: handler.name,
        storageLocation: normalize_(request.storageLocation),
        notes: `Located during Bag & Tag. ${normalize_(request.notes)}`
      }
    );
  }

  let bagHeader = null;
  let bagTagId = normalize_(request.bagTagId);
  let tagNumber = '';
  let storageLocation = normalize_(request.storageLocation);

  if (bagTagId) {
    bagHeader = findRecord_(FMR_CORE.SHEETS.BAG_HEADERS, 'Bag_Tag_ID', bagTagId);
    if (!bagHeader) throw new Error(`Bag tag not found: ${bagTagId}`);
    if (normalize_(bagHeader.Status) !== 'Active') {
      throw new Error('Only an active tag can receive additional material.');
    }
    if (
      normalize_(bagHeader.FMR_ID) !== normalize_(line.FMR_ID) ||
      normalizeUpper_(bagHeader.ISO_Line_Number) !== normalizeUpper_(line.ISO_Line_Number) ||
      normalizeUpper_(bagHeader.ISO_Sheet) !== normalizeUpper_(line.ISO_Sheet)
    ) {
      throw new Error('The selected tag belongs to a different FMR, ISO line, or sheet.');
    }
    tagNumber = normalize_(bagHeader.Tag_Number);
    storageLocation = normalize_(bagHeader.Storage_Location);
  } else {
    if (!storageLocation) throw new Error('Storage location is required for a new tag.');
    bagTagId = uuid_('BAG');
    tagNumber = nextTagNumber_();
    appendRecord_(FMR_CORE.SHEETS.BAG_HEADERS, {
      Bag_Tag_ID: bagTagId,
      Tag_Number: tagNumber,
      FMR_ID: line.FMR_ID,
      FMR_Number: line.FMR_Number,
      IWP_ID: line.IWP_ID,
      IWP_Number: line.IWP_Number,
      ISO_ID: line.ISO_ID,
      ISO_Line_Number: line.ISO_Line_Number,
      ISO_Sheet: line.ISO_Sheet,
      Storage_Location: storageLocation,
      Bagged_By_Name: handler.name,
      Authenticated_Email: user.email,
      Bagged_At: now_(),
      Status: 'Active',
      Notes: normalize_(request.notes)
    });
  }

  const existingItem = getSheetData_(FMR_CORE.SHEETS.BAG_ITEMS).rows.find(item =>
    normalize_(item.Bag_Tag_ID) === bagTagId &&
    normalize_(item.FMR_Line_ID) === normalize_(line.FMR_Line_ID)
  );

  if (existingItem) {
    updateRecord_(
      FMR_CORE.SHEETS.BAG_ITEMS,
      'Bag_Tag_Item_ID',
      existingItem.Bag_Tag_Item_ID,
      {
        Qty_Bagged: number_(existingItem.Qty_Bagged) + quantity,
        Qty_Remaining_In_Bag: number_(existingItem.Qty_Remaining_In_Bag) + quantity,
        Updated_At: now_()
      }
    );
  } else {
    appendRecord_(FMR_CORE.SHEETS.BAG_ITEMS, {
      Bag_Tag_Item_ID: uuid_('BAGITEM'),
      Bag_Tag_ID: bagTagId,
      Tag_Number: tagNumber,
      FMR_Line_ID: line.FMR_Line_ID,
      Commodity_Code: line.Commodity_Code,
      Size: line.Size,
      Material_Description: line.Material_Description,
      Qty_Bagged: quantity,
      Qty_Issued_From_Bag: 0,
      Qty_Remaining_In_Bag: quantity,
      UOM: line.UOM,
      Created_At: now_(),
      Updated_At: now_()
    });
  }

  appendMaterialTransaction_(
    line,
    'BAG',
    quantity,
    user,
    {
      correlationId,
      performedByName: handler.name,
      targetBagTagId: bagTagId,
      storageLocation,
      notes: normalize_(request.notes)
    }
  );

  return finishFieldAction_(
    line,
    user,
    'BAG',
    correlationId,
    {
      quantity,
      newlyLocated,
      bagTagId,
      tagNumber,
      storageLocation,
      baggedBy: handler.name,
      message: `${quantity} ${normalize_(line.UOM)} reserved under ${tagNumber}.`
    }
  );
}

function requireIssueData_(request) {
  const issuedTo = normalize_(request.issuedToName);
  if (!issuedTo) throw new Error('Issued To is required.');
  const handler = getSelectedWorker_(request.selectedUserId, 'Can_Issue', 'Issued By');
  return {issuedTo, handler};
}

function directIssue_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Issue quantity');
  const issue = requireIssueData_(request);
  const state = getLineOperationalState_(line);

  if (quantity > state.notYetLocated) {
    throw new Error(`Only ${state.notYetLocated} can be located and issued directly.`);
  }

  const correlationId = uuid_('CORR');
  appendMaterialTransaction_(
    line,
    'DIRECT_ISSUE',
    quantity,
    user,
    {
      correlationId,
      performedByName: issue.handler.name,
      issuedToName: issue.issuedTo,
      storageLocation: normalize_(request.storageLocation),
      notes: normalize_(request.notes)
    }
  );

  return finishFieldAction_(
    line,
    user,
    'DIRECT_ISSUE',
    correlationId,
    {
      quantity,
      issuedTo: issue.issuedTo,
      issuedBy: issue.handler.name,
      message: `${quantity} ${normalize_(line.UOM)} located and issued to ${issue.issuedTo}.`
    }
  );
}

function issueAvailable_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Issue quantity');
  const issue = requireIssueData_(request);
  const state = getLineOperationalState_(line);

  if (quantity > state.available) {
    throw new Error(`Only ${state.available} is currently available to issue.`);
  }

  const correlationId = uuid_('CORR');
  appendMaterialTransaction_(
    line,
    'ISSUE_FROM_AVAILABLE',
    quantity,
    user,
    {
      correlationId,
      performedByName: issue.handler.name,
      issuedToName: issue.issuedTo,
      notes: normalize_(request.notes)
    }
  );

  return finishFieldAction_(
    line,
    user,
    'ISSUE_FROM_AVAILABLE',
    correlationId,
    {
      quantity,
      issuedTo: issue.issuedTo,
      issuedBy: issue.handler.name,
      message: `${quantity} ${normalize_(line.UOM)} issued to ${issue.issuedTo}.`
    }
  );
}

function issueFromBag_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Issue quantity');
  const issue = requireIssueData_(request);
  const bagItemId = normalize_(request.bagTagItemId);
  if (!bagItemId) throw new Error('A bag/tag item must be selected.');

  const bagItem = findRecord_(FMR_CORE.SHEETS.BAG_ITEMS, 'Bag_Tag_Item_ID', bagItemId);
  if (!bagItem) throw new Error(`Bag/tag item not found: ${bagItemId}`);
  if (normalize_(bagItem.FMR_Line_ID) !== normalize_(line.FMR_Line_ID)) {
    throw new Error('The selected bag item belongs to a different FMR material line.');
  }

  const bagHeader = findRecord_(
    FMR_CORE.SHEETS.BAG_HEADERS,
    'Bag_Tag_ID',
    bagItem.Bag_Tag_ID
  );
  if (!bagHeader || !['Active', 'Partially Issued'].includes(normalize_(bagHeader.Status))) {
    throw new Error('The selected bag/tag is not active.');
  }

  const remaining = number_(bagItem.Qty_Remaining_In_Bag);
  if (quantity > remaining) {
    throw new Error(`Only ${remaining} remains under tag ${bagHeader.Tag_Number}.`);
  }

  const correlationId = uuid_('CORR');
  appendMaterialTransaction_(
    line,
    'ISSUE_FROM_BAG',
    quantity,
    user,
    {
      correlationId,
      performedByName: issue.handler.name,
      issuedToName: issue.issuedTo,
      sourceBagTagId: bagHeader.Bag_Tag_ID,
      storageLocation: bagHeader.Storage_Location,
      notes: normalize_(request.notes)
    }
  );

  updateRecord_(
    FMR_CORE.SHEETS.BAG_ITEMS,
    'Bag_Tag_Item_ID',
    bagItemId,
    {
      Qty_Issued_From_Bag: number_(bagItem.Qty_Issued_From_Bag) + quantity,
      Qty_Remaining_In_Bag: remaining - quantity,
      Updated_At: now_()
    }
  );

  clearAllCaches_();
  const allItems = findRecords_(
    FMR_CORE.SHEETS.BAG_ITEMS,
    'Bag_Tag_ID',
    bagHeader.Bag_Tag_ID
  );
  const allIssued = allItems.every(item => number_(item.Qty_Remaining_In_Bag) <= 0);
  const anyIssued = allItems.some(item => number_(item.Qty_Issued_From_Bag) > 0);

  updateRecord_(
    FMR_CORE.SHEETS.BAG_HEADERS,
    'Bag_Tag_ID',
    bagHeader.Bag_Tag_ID,
    {
      Status: allIssued ? 'Issued' : (anyIssued ? 'Partially Issued' : 'Active')
    }
  );

  return finishFieldAction_(
    line,
    user,
    'ISSUE_FROM_BAG',
    correlationId,
    {
      quantity,
      bagTagId: normalize_(bagHeader.Bag_Tag_ID),
      tagNumber: normalize_(bagHeader.Tag_Number),
      issuedTo: issue.issuedTo,
      issuedBy: issue.handler.name,
      message: `${quantity} ${normalize_(line.UOM)} issued from ${bagHeader.Tag_Number} to ${issue.issuedTo}.`
    }
  );
}

function submitBackorder_(user, request) {
  const line = getFieldLine_(request);
  const quantity = positiveNumber_(request.quantity, 'Backorder quantity');
  const reporter = getSelectedWorker_(
    request.selectedUserId,
    'Can_Request_Backorder',
    'Reported By'
  );
  const state = getLineOperationalState_(line);

  if (quantity > state.maximumNewBackorder) {
    throw new Error(`Only ${state.maximumNewBackorder} can be submitted as a new backorder.`);
  }

  const reason = normalize_(request.reason);
  const allowedReasons = getListValues_('Backorder_Reason');
  if (!reason || !allowedReasons.includes(reason)) {
    throw new Error('A valid backorder reason is required.');
  }

  const requestId = uuid_('BACKORDER');
  const correlationId = uuid_('CORR');
  appendRecord_(FMR_CORE.SHEETS.BACKORDERS, {
    Backorder_Request_ID: requestId,
    FMR_ID: line.FMR_ID,
    FMR_Number: line.FMR_Number,
    FMR_Line_ID: line.FMR_Line_ID,
    Commodity_Code: line.Commodity_Code,
    Qty_Requested_Backorder: quantity,
    Qty_Confirmed_Backorder: 0,
    Reason: reason,
    Expected_Date: parseOptionalDate_(request.expectedDate),
    Field_Notes: normalize_(request.notes),
    Reported_By_Name: reporter.name,
    Authenticated_Email: user.email,
    Reported_At: now_(),
    Status: 'Pending Planning Confirmation'
  });

  appendMaterialTransaction_(
    line,
    'BACKORDER_REQUESTED',
    quantity,
    user,
    {
      correlationId,
      performedByName: reporter.name,
      backorderRequestId: requestId,
      notes: `${reason}. ${normalize_(request.notes)}`
    }
  );

  return finishFieldAction_(
    line,
    user,
    'BACKORDER_REQUESTED',
    correlationId,
    {
      quantity,
      requestId,
      reason,
      reportedBy: reporter.name,
      message: `${quantity} ${normalize_(line.UOM)} submitted for Planning backorder review.`
    }
  );
}
