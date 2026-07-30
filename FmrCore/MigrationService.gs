// MigrationService.gs
function migrateExistingQuantityBaselines_(userEmail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    clearAllCaches_();
    const user = getAuthorizedUser_(userEmail, [FMR_CORE.ROLES.ADMIN], 'ADMIN');
    const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows;
    const existingTransactions = getSheetData_(FMR_CORE.SHEETS.TRANSACTIONS).rows;
    const linesWithTransactions = new Set(
      existingTransactions.map(row => normalize_(row.FMR_Line_ID)).filter(Boolean)
    );

    let migratedLines = 0;
    let skippedLines = 0;
    const affectedFmrs = new Set();

    lines.forEach(line => {
      const lineId = normalize_(line.FMR_Line_ID);
      if (!lineId || linesWithTransactions.has(lineId)) {
        skippedLines += 1;
        return;
      }

      const confirmed = number_(line.Qty_Confirmed_Located);
      const bagged = number_(line.Qty_Active_Bagged);
      const issued = number_(line.Qty_Issued);
      const pendingBackorder = number_(line.Qty_Pending_Backorder);
      const confirmedBackorder = number_(line.Qty_Confirmed_Backorder);

      if (
        confirmed <= 0 &&
        bagged <= 0 &&
        issued <= 0 &&
        pendingBackorder <= 0 &&
        confirmedBackorder <= 0
      ) {
        skippedLines += 1;
        return;
      }

      const correlationId = uuid_('MIGRATION');
      if (confirmed > 0) {
        appendMaterialTransaction_(
          line,
          'CONFIRM_AVAILABLE',
          confirmed,
          user,
          {
            correlationId,
            performedByName: 'Step 3 Baseline Migration',
            storageLocation: normalize_(line.Storage_Location),
            notes: 'Migrated from pre-transaction summary quantity.'
          }
        );
      }

      if (bagged > 0) {
        const bagTagId = uuid_('BAG');
        const tagNumber = nextTagNumber_();
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
          Storage_Location: normalize_(line.Storage_Location) || 'Migrated Location',
          Bagged_By_Name: 'Step 3 Baseline Migration',
          Authenticated_Email: user.email,
          Bagged_At: now_(),
          Status: 'Active',
          Notes: 'Migrated from pre-transaction bagged quantity.'
        });
        appendRecord_(FMR_CORE.SHEETS.BAG_ITEMS, {
          Bag_Tag_Item_ID: uuid_('BAGITEM'),
          Bag_Tag_ID: bagTagId,
          Tag_Number: tagNumber,
          FMR_Line_ID: line.FMR_Line_ID,
          Commodity_Code: line.Commodity_Code,
          Size: line.Size,
          Material_Description: line.Material_Description,
          Qty_Bagged: bagged,
          Qty_Issued_From_Bag: 0,
          Qty_Remaining_In_Bag: bagged,
          UOM: line.UOM,
          Created_At: now_(),
          Updated_At: now_()
        });
        appendMaterialTransaction_(
          line,
          'BAG',
          bagged,
          user,
          {
            correlationId,
            performedByName: 'Step 3 Baseline Migration',
            targetBagTagId: bagTagId,
            storageLocation: normalize_(line.Storage_Location) || 'Migrated Location',
            notes: 'Migrated from pre-transaction bagged quantity.'
          }
        );
      }

      if (issued > 0) {
        appendMaterialTransaction_(
          line,
          'ISSUE_FROM_AVAILABLE',
          issued,
          user,
          {
            correlationId,
            performedByName: 'Step 3 Baseline Migration',
            issuedToName: 'Historical Issue',
            notes: 'Migrated from pre-transaction issued quantity.'
          }
        );
      }

      if (pendingBackorder > 0) {
        const requestId = uuid_('BACKORDER');
        appendRecord_(FMR_CORE.SHEETS.BACKORDERS, {
          Backorder_Request_ID: requestId,
          FMR_ID: line.FMR_ID,
          FMR_Number: line.FMR_Number,
          FMR_Line_ID: line.FMR_Line_ID,
          Commodity_Code: line.Commodity_Code,
          Qty_Requested_Backorder: pendingBackorder,
          Qty_Confirmed_Backorder: 0,
          Reason: 'Other',
          Field_Notes: 'Migrated pending backorder.',
          Reported_By_Name: 'Step 3 Baseline Migration',
          Authenticated_Email: user.email,
          Reported_At: now_(),
          Status: 'Pending Planning Confirmation'
        });
        appendMaterialTransaction_(
          line,
          'BACKORDER_REQUESTED',
          pendingBackorder,
          user,
          {
            correlationId,
            performedByName: 'Step 3 Baseline Migration',
            backorderRequestId: requestId,
            notes: 'Migrated pending backorder.'
          }
        );
      }

      if (confirmedBackorder > 0) {
        const requestId = uuid_('BACKORDER');
        appendRecord_(FMR_CORE.SHEETS.BACKORDERS, {
          Backorder_Request_ID: requestId,
          FMR_ID: line.FMR_ID,
          FMR_Number: line.FMR_Number,
          FMR_Line_ID: line.FMR_Line_ID,
          Commodity_Code: line.Commodity_Code,
          Qty_Requested_Backorder: confirmedBackorder,
          Qty_Confirmed_Backorder: confirmedBackorder,
          Reason: 'Other',
          Field_Notes: 'Migrated confirmed backorder.',
          Reported_By_Name: 'Step 3 Baseline Migration',
          Authenticated_Email: user.email,
          Reported_At: now_(),
          Status: 'Confirmed',
          Reviewed_By_Name: 'Step 3 Baseline Migration',
          Reviewed_By_Email: user.email,
          Reviewed_At: now_(),
          Planning_Notes: 'Migrated confirmed backorder.'
        });
        appendMaterialTransaction_(
          line,
          'BACKORDER_CONFIRMED',
          confirmedBackorder,
          user,
          {
            correlationId,
            performedByName: 'Step 3 Baseline Migration',
            backorderRequestId: requestId,
            notes: 'Migrated confirmed backorder.'
          }
        );
      }

      refreshLineSummary_(lineId);
      affectedFmrs.add(normalize_(line.FMR_ID));
      migratedLines += 1;
    });

    affectedFmrs.forEach(fmrId => {
      if (fmrId) refreshFmrHeaderSummary_(fmrId);
    });

    const result = {
      success: true,
      migratedLines,
      skippedLines,
      affectedFmrs: affectedFmrs.size
    };

    writeAudit_(
      'SYSTEM',
      database_().getId(),
      'MIGRATE_STEP3_BASELINES',
      user,
      '',
      result
    );
    return result;
  } finally {
    lock.releaseLock();
  }
}
