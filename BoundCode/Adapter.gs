/**
 * Thin company-owned adapter.
 * Business rules, quantity validation, locks, tag generation, and transaction logic remain in FMRCore.
 */
function databaseId_() {
  return SpreadsheetApp.getActive().getId();
}

function callerEmail_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('Authenticated Google account email is unavailable.');
  return email;
}

function verifyFmrFoundation() {
  const result = FMRCore.validateFoundation(databaseId_(), callerEmail_());
  SpreadsheetApp.getUi().alert(result.valid
    ? `FMRCore ${result.version} is connected and the database foundation is valid.`
    : `Foundation validation failed. Missing: ${result.missingSheets.join(', ')}`
  );
  return result;
}

function verifyStep2AdminPortal() {
  const data = FMRCore.getAdminPortalData(databaseId_(), callerEmail_(), {});
  SpreadsheetApp.getUi().alert(
    `Step 2 is connected.\n` +
    `FMRCore: ${FMRCore.getCoreVersion()}\n` +
    `FMRs visible: ${data.resultCount}\n` +
    `Pending backorders: ${data.pendingBackorders.length}\n` +
    `Active tags: ${data.activeBagTags.length}`
  );
  return data;
}

function migrateStep3QuantityBaselines() {
  const result = FMRCore.migrateExistingQuantityBaselines(
    databaseId_(),
    callerEmail_()
  );
  SpreadsheetApp.getUi().alert(
    `Step 3 baseline migration completed.\n` +
    `Lines migrated: ${result.migratedLines}\n` +
    `Lines skipped: ${result.skippedLines}\n` +
    `FMRs refreshed: ${result.affectedFmrs}`
  );
  return result;
}

function verifyStep3FieldTransactions() {
  const sample = FMRCore.getFieldPortalData(
    databaseId_(),
    callerEmail_(),
    'FG-70912_001',
    '3',
    false
  );
  SpreadsheetApp.getUi().alert(
    `Step 3 is connected.\n` +
    `FMRCore: ${FMRCore.getCoreVersion()}\n` +
    `Sample FMRs visible: ${sample.resultCount}\n` +
    `Can transact: ${sample.user.canTransact}\n` +
    `Issue handlers: ${sample.options.issueHandlers.length}\n` +
    `Bag handlers: ${sample.options.bagHandlers.length}\n` +
    `Backorder reporters: ${sample.options.backorderReporters.length}`
  );
  return sample;
}

function searchFmrByLineAndSheet(lineNumber, sheetNumber, sourceInterface) {
  return FMRCore.searchByLineAndSheet(
    databaseId_(),
    callerEmail_(),
    lineNumber,
    sheetNumber,
    sourceInterface || 'FIELD'
  );
}

function getFieldPortalData(lineNumber, sheetNumber, auditSearch) {
  return FMRCore.getFieldPortalData(
    databaseId_(),
    callerEmail_(),
    lineNumber,
    sheetNumber,
    auditSearch !== false
  );
}

function performFieldAction(request) {
  return FMRCore.performFieldAction(
    databaseId_(),
    callerEmail_(),
    request || {}
  );
}

function getIssueHandlers() {
  return FMRCore.getIssueHandlers(databaseId_(), callerEmail_());
}

function getFmrDetail(fmrId, sourceInterface) {
  return FMRCore.getFmrDetail(
    databaseId_(),
    callerEmail_(),
    fmrId,
    sourceInterface || 'ADMIN'
  );
}

function getAdminPortalData(filters) {
  return FMRCore.getAdminPortalData(
    databaseId_(),
    callerEmail_(),
    filters || {}
  );
}

function reviewBackorder(request) {
  return FMRCore.reviewBackorder(
    databaseId_(),
    callerEmail_(),
    request || {}
  );
}

function getPortalBootstrap(view) {
  return FMRCore.getPortalBootstrap(
    databaseId_(),
    callerEmail_(),
    view || 'field'
  );
}

function onOpen(e) {
  const ui = SpreadsheetApp.getUi();

  try {
    addFmrDatabaseMenuStatic_(ui);
  } catch(error) {
    console.error('FMR Database menu failed: ' + (error.stack || error));
  }

  try {
    addPhase4ManualFmrMenu_(ui);
  } catch(error) {
    console.error (
      'Manual FMR Intake menu failed: ' + (error.stack || error)
    );
  }
}

function addFmrDatabaseMenuStatic_(ui) {
  ui.createMenu('FMR Database')
    .addItem(
      'Validate Database Foundation',
      'verifyFmrFoundation'
    )
    .addItem(
      'Validate Step 2 Admin Portal',
      'verifyStep2AdminPortal'
    )
    .addSeparator()
    .addItem(
      'Migrate Existing Quantity Baselines',
      'migrateStep3QuantityBaselines'
    )
    .addItem(
      'Validate Step 3 Field 3 Transactions',
      'verifyStep3FieldTransactions'
    )
    .addToUi();
}

