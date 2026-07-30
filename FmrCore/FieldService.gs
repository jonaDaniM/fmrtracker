/**
 * Field and Admin portal services, serializers, and field transaction actions.
 */

function getPortalBootstrap_(userEmail, view) {
  const requestedView = normalizeLower_(view) || 'field';
  const roles = [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT,
    FMR_CORE.ROLES.LEADERSHIP,
    FMR_CORE.ROLES.AUDITOR
  ];

  const sourceInterface =
    requestedView === 'admin' ? 'ADMIN' :
    requestedView === 'import' ? 'IMPORT' :
    'FIELD';

  const user = getAuthorizedUser_(userEmail, roles, sourceInterface);

  return {
    displayName: user.name,
    userEmail: user.email,
    role: user.role,
    coreVersion: FMR_CORE.VERSION,
    view: requestedView,
    canPerformFieldTransactions: user.canPerformFieldTransactions,
    canReviewBackorders: user.canReviewBackorders
  };
}

function getIssueHandlers_() {
  return listHandlerUsers_('Can_Issue');
}

function getFieldPortalData_(userEmail, lineNumber, sheetNumber, auditSearch) {
  const cards = searchByLineAndSheet_(
    userEmail,
    lineNumber,
    sheetNumber,
    'FIELD',
    auditSearch !== false
  );

  const user = getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT,
    FMR_CORE.ROLES.LEADERSHIP,
    FMR_CORE.ROLES.AUDITOR
  ], 'FIELD');

  const enrichedCards = cards.map(card => {
    const materials = (card.materials || []).map(material => {
      const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', material.fmrLineId);
      return line ? serializeMaterialLine_(line) : material;
    });
    return {
      ...card,
      materials,
      totals: totalMaterials_(materials)
    };
  });

  return {
    cards: enrichedCards,
    resultCount: enrichedCards.length,
    generatedAt: formatTimestamp_(now_()),
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      canTransact: user.canTransact
    },
    options: {
      issueHandlers: listHandlerUsers_('Can_Issue'),
      bagHandlers: listHandlerUsers_('Can_Bag'),
      backorderReporters: listHandlerUsers_('Can_Request_Backorder'),
      backorderReasons: getListValues_(FMR_CORE.LIST_FIELDS.BACKORDER_REASON)
    }
  };
}

function getAdminPortalData_(userEmail, filters) {
  const user = getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT,
    FMR_CORE.ROLES.LEADERSHIP,
    FMR_CORE.ROLES.AUDITOR
  ], 'ADMIN');

  const source = filters || {};
  const filterFmr = normalizeUpper_(source.fmrNumber);
  const filterIwp = normalizeUpper_(source.iwpNumber);
  const filterIsoLine = normalizeUpper_(source.isoLineNumber);
  const filterIsoSheet = normalizeUpper_(source.isoSheet);
  const filterStatus = normalizeUpper_(source.status);
  const filterCommodity = normalizeUpper_(source.commodityCode);

  const headers = getSheetData_(FMR_CORE.SHEETS.HEADERS).rows;
  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows;
  const linesByFmr = groupBy_(lines, 'FMR_ID');

  const allStatuses = uniqueSorted_(headers.map(row => row.Current_Status));
  const allIwps = uniqueSorted_(headers.map(row => row.IWP_Number));

  let fmrs = headers
    .map(header => {
      const fmrId = normalize_(header.FMR_ID);
      const materialRows = linesByFmr[fmrId] || [];
      const materials = materialRows.map(serializeMaterialLine_);
      return {
        fmrId,
        fmrNumber: normalize_(header.FMR_Number),
        iwpNumber: normalize_(header.IWP_Number),
        status: normalize_(header.Current_Status),
        priority: normalize_(header.Priority),
        requestedBy: normalize_(header.Requested_By),
        isoLineNumber: materials[0] ? materials[0].isoLineNumber : '',
        isoSheet: materials[0] ? materials[0].isoSheet : '',
        materials,
        totals: totalMaterials_(materials),
        _header: header,
        _lines: materialRows
      };
    })
    .filter(card => {
      if (filterFmr && !normalizeUpper_(card.fmrNumber).includes(filterFmr)) return false;
      if (filterIwp && !normalizeUpper_(card.iwpNumber).includes(filterIwp)) return false;
      if (filterStatus && normalizeUpper_(card.status) !== filterStatus) return false;
      if (filterIsoLine || filterIsoSheet || filterCommodity) {
        const matched = card._lines.some(line => {
          if (filterIsoLine && normalizeUpper_(line.ISO_Line_Number) !== filterIsoLine) {
            return false;
          }
          if (filterIsoSheet && normalizeUpper_(line.ISO_Sheet) !== filterIsoSheet) {
            return false;
          }
          if (
            filterCommodity &&
            !normalizeUpper_(line.Commodity_Code).includes(filterCommodity)
          ) {
            return false;
          }
          return true;
        });
        if (!matched) return false;
      }
      return true;
    })
    .sort((a, b) =>
      a.fmrNumber.localeCompare(b.fmrNumber, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    );

  const truncated = fmrs.length > 200;
  fmrs = fmrs.slice(0, 200).map(card => {
    const clone = {...card};
    delete clone._header;
    delete clone._lines;
    return clone;
  });

  const pendingBackorders = getPendingBackorderQueue_();
  const activeBagTags = getActiveBagTagQueue_();

  const openStatuses = new Set([
    'APPROVED',
    'SOURCING',
    'PARTIALLY LOCATED',
    'LOCATED',
    'PARTIALLY ISSUED',
    'SUBMITTED',
    'UNDER REVIEW',
    'ON HOLD'
  ]);

  const summarySource = headers;
  const summary = {
    totalFmrs: summarySource.length,
    openFmrs: summarySource.filter(row =>
      openStatuses.has(normalizeUpper_(row.Current_Status))
    ).length,
    pendingBackorders: pendingBackorders.length,
    activeTags: activeBagTags.length,
    qtyRequested: sumField_(summarySource, 'Qty_Requested'),
    qtyLocated: sumField_(summarySource, 'Qty_Confirmed_Located'),
    qtyAvailable: sumField_(summarySource, 'Qty_Available'),
    qtyBagged: sumField_(summarySource, 'Qty_Active_Bagged'),
    qtyIssued: sumField_(summarySource, 'Qty_Issued'),
    qtyConfirmedBackorder: sumField_(summarySource, 'Qty_Confirmed_Backorder')
  };

  return {
    summary,
    filters: {
      statuses: allStatuses,
      iwps: allIwps
    },
    fmrs,
    pendingBackorders,
    activeBagTags,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      canReviewBackorders: user.canReviewBackorders
    },
    generatedAt: formatTimestamp_(now_()),
    resultCount: truncated ? 200 : fmrs.length,
    truncated
  };
}

function performFieldAction_(userEmail, request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    clearAllCaches_();

    const user = getAuthorizedUser_(userEmail, [
      FMR_CORE.ROLES.ADMIN,
      FMR_CORE.ROLES.PLANNER,
      FMR_CORE.ROLES.MATERIAL_CONTROL,
      FMR_CORE.ROLES.FIELD_HANDLER
    ], 'FIELD');

    if (!user.canTransact) {
      throw new Error(
        'Read-only access. A Material Control or Field Material Handler role is required to submit actions.'
      );
    }

    const source = request || {};
    const action = normalizeUpper_(source.action);
    const fmrLineId = normalize_(source.fmrLineId);
    const quantity = number_(source.quantity);

    if (!fmrLineId) throw new Error('FMR line ID is required.');
    if (quantity <= 0) throw new Error('Quantity must be greater than zero.');

    const line = findRecord_(FMR_CORE.SHEETS.LINES, 'FMR_Line_ID', fmrLineId);
    if (!line) throw new Error(`FMR line not found: ${fmrLineId}`);

    const header = findRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', line.FMR_ID);
    if (!header) throw new Error(`FMR not found: ${line.FMR_ID}`);

    const selectedUser = resolveSelectedUser_(source.selectedUserId);
    const notes = normalize_(source.notes);
    const storageLocation = normalize_(source.storageLocation);
    const issuedToName = normalize_(source.issuedToName);
    const correlationId = uuid_('CORR');
    const timestamp = now_();
    const limits = actionLimitsForLine_(line);

    let message = '';
    let transactionType = action;
    let bagTagId = normalize_(source.bagTagId);
    let bagTagItemId = normalize_(source.bagTagItemId);
    let backorderRequestId = '';

    if (action === 'CONFIRM_AVAILABLE') {
      if (quantity > limits.confirmAvailable) {
        throw new Error(`Quantity exceeds remaining unlocated amount (${limits.confirmAvailable}).`);
      }
      if (!user.canBag && !user.canIssue) {
        throw new Error('User is not authorized to confirm available material.');
      }
      message = `Confirmed ${quantity} available for ${normalize_(line.Commodity_Code)}.`;
    } else if (action === 'BAG') {
      if (quantity > limits.bag) {
        throw new Error(`Quantity exceeds available amount (${limits.bag}).`);
      }
      if (!user.canBag) throw new Error('User is not authorized to bag material.');
      const tagResult = upsertBagTagForLine_(line, header, {
        bagTagId,
        quantity,
        storageLocation,
        selectedUser,
        timestamp,
        notes
      });
      bagTagId = tagResult.bagTagId;
      bagTagItemId = tagResult.bagTagItemId;
      message = `Bagged ${quantity} under tag ${tagResult.tagNumber}.`;
    } else if (action === 'DIRECT_ISSUE') {
      if (quantity > limits.directIssue) {
        throw new Error(`Quantity exceeds remaining unlocated amount (${limits.directIssue}).`);
      }
      if (!user.canIssue) throw new Error('User is not authorized to issue material.');
      if (!issuedToName) throw new Error('Issued To is required.');
      message = `Located and issued ${quantity} of ${normalize_(line.Commodity_Code)} to ${issuedToName}.`;
    } else if (action === 'ISSUE_FROM_AVAILABLE') {
      if (quantity > limits.issueAvailable) {
        throw new Error(`Quantity exceeds available amount (${limits.issueAvailable}).`);
      }
      if (!user.canIssue) throw new Error('User is not authorized to issue material.');
      if (!issuedToName) throw new Error('Issued To is required.');
      message = `Issued ${quantity} available material to ${issuedToName}.`;
    } else if (action === 'ISSUE_FROM_BAG') {
      if (!user.canIssue) throw new Error('User is not authorized to issue material.');
      if (!issuedToName) throw new Error('Issued To is required.');
      if (!bagTagItemId) throw new Error('A bag / tag item is required.');

      const bagItem = findRecord_(
        FMR_CORE.SHEETS.BAG_TAG_ITEMS,
        'Bag_Tag_Item_ID',
        bagTagItemId
      );
      if (!bagItem) throw new Error(`Bag tag item not found: ${bagTagItemId}`);
      if (normalize_(bagItem.FMR_Line_ID) !== fmrLineId) {
        throw new Error('Selected bag item does not belong to this material line.');
      }

      const remaining = number_(bagItem.Qty_Remaining_In_Bag);
      if (quantity > remaining) {
        throw new Error(`Quantity exceeds remaining bag quantity (${remaining}).`);
      }

      updateRecord_(FMR_CORE.SHEETS.BAG_TAG_ITEMS, 'Bag_Tag_Item_ID', bagTagItemId, {
        Qty_Remaining_In_Bag: roundQty_(remaining - quantity),
        Status: remaining - quantity <= 0 ? 'DEPLETED' : 'ACTIVE',
        Updated_At: timestamp
      });

      bagTagId = normalize_(bagItem.Bag_Tag_ID);
      message = `Issued ${quantity} from bag to ${issuedToName}.`;
    } else if (action === 'BACKORDER_REQUESTED') {
      if (quantity > limits.backorder) {
        throw new Error(`Quantity exceeds remaining unlocated amount (${limits.backorder}).`);
      }
      if (!user.canRequestBackorder) {
        throw new Error('User is not authorized to request backorders.');
      }

      const reason = normalize_(source.reason);
      if (!reason) throw new Error('Backorder reason is required.');

      const requestId = uuid_('BO');
      backorderRequestId = requestId;
      appendRecord_(FMR_CORE.SHEETS.BACKORDERS, {
        Backorder_Request_ID: requestId,
        FMR_ID: line.FMR_ID,
        FMR_Number: line.FMR_Number || header.FMR_Number,
        FMR_Line_ID: fmrLineId,
        IWP_Number: line.IWP_Number || header.IWP_Number,
        ISO_Line_Number: line.ISO_Line_Number,
        ISO_Sheet: line.ISO_Sheet,
        Commodity_Code: line.Commodity_Code,
        Qty_Requested_Backorder: quantity,
        Qty_Confirmed_Backorder: 0,
        Status: 'Pending Planning Confirmation',
        Reason: reason,
        Expected_Date: normalize_(source.expectedDate),
        Reported_By_Name: selectedUser.name,
        Reported_By_Email: selectedUser.email,
        Reported_At: timestamp,
        Field_Notes: notes,
        Authenticated_Email: user.email
      });

      message = `Submitted backorder request ${requestId} for ${quantity}.`;
    } else {
      throw new Error(`Unsupported field action: ${action}`);
    }

    const transactionId = uuid_('TXN');
    appendRecord_(FMR_CORE.SHEETS.TRANSACTIONS, {
      Transaction_ID: transactionId,
      Correlation_ID: correlationId,
      FMR_ID: line.FMR_ID,
      FMR_Number: line.FMR_Number || header.FMR_Number,
      FMR_Line_ID: fmrLineId,
      Transaction_Type: transactionType,
      Quantity: quantity,
      UOM: line.UOM,
      Authenticated_Email: user.email,
      Performed_By_Name: selectedUser.name,
      Performed_By_Email: selectedUser.email,
      Issued_To_Name: issuedToName,
      Storage_Location: storageLocation,
      Bag_Tag_ID: bagTagId,
      Bag_Tag_Item_ID: bagTagItemId,
      Backorder_Request_ID: backorderRequestId,
      Timestamp: timestamp,
      Notes: notes
    });

    SpreadsheetApp.flush();
    clearAllCaches_();

    const refreshedLine = refreshLineSummary_(fmrLineId);
    clearAllCaches_();
    refreshFmrHeaderSummary_(line.FMR_ID);

    writeAudit_(
      'FMR_LINE',
      fmrLineId,
      action,
      user,
      correlationId,
      {
        transactionId,
        quantity,
        selectedUserId: selectedUser.userId,
        storageLocation,
        issuedToName,
        bagTagId,
        bagTagItemId,
        lineStatus: refreshedLine.Line_Status
      }
    );

    return {
      success: true,
      message,
      transactionId,
      correlationId,
      line: serializeMaterialLine_(refreshedLine)
    };
  } finally {
    clearAllCaches_();
    lock.releaseLock();
  }
}

function serializeHeader_(header) {
  const row = header || {};
  return {
    fmrId: normalize_(row.FMR_ID),
    fmrNumber: normalize_(row.FMR_Number),
    iwpNumber: normalize_(row.IWP_Number),
    status: normalize_(row.Current_Status),
    priority: normalize_(row.Priority),
    requestedBy: normalize_(row.Requested_By),
    qtyRequested: number_(row.Qty_Requested),
    qtyConfirmedLocated: number_(row.Qty_Confirmed_Located),
    qtyActiveBagged: number_(row.Qty_Active_Bagged),
    qtyAvailable: number_(row.Qty_Available),
    qtyIssued: number_(row.Qty_Issued),
    qtyPendingBackorder: number_(row.Qty_Pending_Backorder),
    qtyConfirmedBackorder: number_(row.Qty_Confirmed_Backorder)
  };
}

function serializeMaterialLine_(line) {
  const row = line || {};
  const activeBags = getActiveBagsForLine_(row);
  const eligibleExistingTags = getEligibleTagsForLine_(row);

  return {
    fmrLineId: normalize_(row.FMR_Line_ID),
    fmrId: normalize_(row.FMR_ID),
    fmrNumber: normalize_(row.FMR_Number),
    commodityCode: normalize_(row.Commodity_Code),
    size: normalize_(row.Size),
    description: normalize_(row.Material_Description),
    uom: normalize_(row.UOM),
    qtyRequested: number_(row.Qty_Requested),
    qtyConfirmedLocated: number_(row.Qty_Confirmed_Located),
    qtyActiveBagged: number_(row.Qty_Active_Bagged),
    qtyAvailable: number_(row.Qty_Available),
    qtyIssued: number_(row.Qty_Issued),
    qtyPendingBackorder: number_(row.Qty_Pending_Backorder),
    qtyConfirmedBackorder: number_(row.Qty_Confirmed_Backorder),
    lineStatus: normalize_(row.Line_Status),
    isoLineNumber: normalize_(row.ISO_Line_Number),
    isoSheet: normalize_(row.ISO_Sheet),
    storageLocation: normalize_(row.Storage_Location),
    actionLimits: actionLimitsForLine_(row),
    activeBags,
    eligibleExistingTags
  };
}

function getActiveBagsForLine_(line) {
  const lineId = normalize_(line.FMR_Line_ID);
  const tagsById = Object.fromEntries(
    getSheetData_(FMR_CORE.SHEETS.BAG_TAGS).rows.map(tag => [
      normalize_(tag.Bag_Tag_ID),
      tag
    ])
  );

  return getSheetData_(FMR_CORE.SHEETS.BAG_TAG_ITEMS).rows
    .filter(item =>
      normalize_(item.FMR_Line_ID) === lineId &&
      number_(item.Qty_Remaining_In_Bag) > 0 &&
      normalizeUpper_(item.Status || 'ACTIVE') === 'ACTIVE'
    )
    .map(item => {
      const tag = tagsById[normalize_(item.Bag_Tag_ID)] || {};
      return {
        bagTagItemId: normalize_(item.Bag_Tag_Item_ID),
        bagTagId: normalize_(item.Bag_Tag_ID),
        tagNumber: normalize_(tag.Tag_Number || item.Tag_Number),
        qtyRemaining: number_(item.Qty_Remaining_In_Bag),
        uom: normalize_(item.UOM || line.UOM),
        storageLocation: normalize_(tag.Storage_Location || item.Storage_Location)
      };
    });
}

function getEligibleTagsForLine_(line) {
  const fmrId = normalize_(line.FMR_ID);
  const isoLine = normalizeUpper_(line.ISO_Line_Number);
  const isoSheet = normalizeUpper_(line.ISO_Sheet);

  return getSheetData_(FMR_CORE.SHEETS.BAG_TAGS).rows
    .filter(tag =>
      normalize_(tag.FMR_ID) === fmrId &&
      normalizeUpper_(tag.ISO_Line_Number) === isoLine &&
      normalizeUpper_(tag.ISO_Sheet) === isoSheet &&
      normalizeUpper_(tag.Status || 'ACTIVE') === 'ACTIVE'
    )
    .map(tag => ({
      bagTagId: normalize_(tag.Bag_Tag_ID),
      tagNumber: normalize_(tag.Tag_Number),
      storageLocation: normalize_(tag.Storage_Location)
    }));
}

function upsertBagTagForLine_(line, header, options) {
  const source = options || {};
  let bagTagId = normalize_(source.bagTagId);
  let tagNumber = '';
  let storageLocation = normalize_(source.storageLocation);

  if (bagTagId) {
    const existing = findRecord_(FMR_CORE.SHEETS.BAG_TAGS, 'Bag_Tag_ID', bagTagId);
    if (!existing) throw new Error(`Bag tag not found: ${bagTagId}`);
    if (normalize_(existing.FMR_ID) !== normalize_(line.FMR_ID)) {
      throw new Error('Existing tag belongs to a different FMR.');
    }
    if (
      normalizeUpper_(existing.ISO_Line_Number) !== normalizeUpper_(line.ISO_Line_Number) ||
      normalizeUpper_(existing.ISO_Sheet) !== normalizeUpper_(line.ISO_Sheet)
    ) {
      throw new Error('Existing tag is limited to a different ISO line/sheet.');
    }
    tagNumber = normalize_(existing.Tag_Number);
    storageLocation = storageLocation || normalize_(existing.Storage_Location);
  } else {
    bagTagId = uuid_('TAG');
    tagNumber = buildTagNumber_(line, header);
    if (!storageLocation) {
      throw new Error('Storage location is required when creating a new tag.');
    }

    appendRecord_(FMR_CORE.SHEETS.BAG_TAGS, {
      Bag_Tag_ID: bagTagId,
      Tag_Number: tagNumber,
      FMR_ID: line.FMR_ID,
      FMR_Number: line.FMR_Number || header.FMR_Number,
      IWP_Number: line.IWP_Number || header.IWP_Number,
      ISO_Line_Number: line.ISO_Line_Number,
      ISO_Sheet: line.ISO_Sheet,
      Storage_Location: storageLocation,
      Status: 'ACTIVE',
      Bagged_By_Name: source.selectedUser.name,
      Bagged_By_Email: source.selectedUser.email,
      Bagged_At: source.timestamp,
      Created_At: source.timestamp,
      Updated_At: source.timestamp,
      Notes: source.notes || ''
    });
  }

  const bagTagItemId = uuid_('TAGITEM');
  appendRecord_(FMR_CORE.SHEETS.BAG_TAG_ITEMS, {
    Bag_Tag_Item_ID: bagTagItemId,
    Bag_Tag_ID: bagTagId,
    Tag_Number: tagNumber,
    FMR_ID: line.FMR_ID,
    FMR_Line_ID: line.FMR_Line_ID,
    Commodity_Code: line.Commodity_Code,
    Size: line.Size,
    UOM: line.UOM,
    Qty_Bagged: source.quantity,
    Qty_Remaining_In_Bag: source.quantity,
    Status: 'ACTIVE',
    Storage_Location: storageLocation,
    Created_At: source.timestamp,
    Updated_At: source.timestamp
  });

  return {bagTagId, bagTagItemId, tagNumber};
}

function buildTagNumber_(line, header) {
  const project = normalize_(getConfiguration_().PROJECT_CODE) || 'FMR';
  const fmr = normalize_(line.FMR_Number || header.FMR_Number).replace(/\s+/g, '');
  const stamp = Utilities.formatDate(
    now_(),
    Session.getScriptTimeZone() || 'America/Chicago',
    'HHmmss'
  );
  return `${project}-${fmr || 'TAG'}-${stamp}`;
}

function getPendingBackorderQueue_() {
  return getSheetData_(FMR_CORE.SHEETS.BACKORDERS).rows
    .filter(row => isActionableBackorderStatus_(row.Status))
    .map(row => {
      const requested = number_(row.Qty_Requested_Backorder);
      const confirmed = number_(row.Qty_Confirmed_Backorder);
      return {
        requestId: normalize_(row.Backorder_Request_ID),
        fmrNumber: normalize_(row.FMR_Number),
        commodityCode: normalize_(row.Commodity_Code),
        iwpNumber: normalize_(row.IWP_Number),
        isoLineNumber: normalize_(row.ISO_Line_Number),
        isoSheet: normalize_(row.ISO_Sheet),
        qtyPending: roundQty_(Math.max(0, requested - confirmed)),
        qtyRequestedBackorder: requested,
        reason: normalize_(row.Reason),
        reportedBy: normalize_(row.Reported_By_Name),
        reportedAt: formatTimestamp_(row.Reported_At),
        fieldNotes: normalize_(row.Field_Notes)
      };
    })
    .sort((a, b) =>
      String(a.reportedAt).localeCompare(String(b.reportedAt))
    );
}

function getActiveBagTagQueue_() {
  const itemsByTag = groupBy_(
    getSheetData_(FMR_CORE.SHEETS.BAG_TAG_ITEMS).rows.filter(item =>
      number_(item.Qty_Remaining_In_Bag) > 0 &&
      normalizeUpper_(item.Status || 'ACTIVE') === 'ACTIVE'
    ),
    'Bag_Tag_ID'
  );

  return getSheetData_(FMR_CORE.SHEETS.BAG_TAGS).rows
    .filter(tag => {
      const tagId = normalize_(tag.Bag_Tag_ID);
      return (
        normalizeUpper_(tag.Status || 'ACTIVE') === 'ACTIVE' &&
        (itemsByTag[tagId] || []).length > 0
      );
    })
    .map(tag => {
      const tagId = normalize_(tag.Bag_Tag_ID);
      return {
        tagNumber: normalize_(tag.Tag_Number),
        fmrNumber: normalize_(tag.FMR_Number),
        iwpNumber: normalize_(tag.IWP_Number),
        isoLineNumber: normalize_(tag.ISO_Line_Number),
        isoSheet: normalize_(tag.ISO_Sheet),
        storageLocation: normalize_(tag.Storage_Location),
        baggedBy: normalize_(tag.Bagged_By_Name),
        baggedAt: formatTimestamp_(tag.Bagged_At),
        items: (itemsByTag[tagId] || []).map(item => ({
          commodityCode: normalize_(item.Commodity_Code),
          size: normalize_(item.Size),
          qtyRemainingInBag: number_(item.Qty_Remaining_In_Bag),
          uom: normalize_(item.UOM)
        }))
      };
    });
}

function sumField_(rows, field) {
  return roundQty_((rows || []).reduce((sum, row) => sum + number_(row[field]), 0));
}

function normalizeLower_(value) {
  return normalize_(value).toLowerCase();
}
