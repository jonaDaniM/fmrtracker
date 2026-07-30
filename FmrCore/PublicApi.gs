//PublicApi.gs
function getCoreVersion() {
  return FMR_CORE.VERSION;
}

function validateFoundation(databaseId, userEmail) {
  setDatabaseContext_(databaseId);
  return validateFoundation_(userEmail);
}

function getPortalBootstrap(databaseId, userEmail, view) {
  setDatabaseContext_(databaseId);
  return getPortalBootstrap_(userEmail, view);
}

function getIssueHandlers(databaseId, userEmail) {
  setDatabaseContext_(databaseId);
  getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER
  ], 'FIELD');
  return getIssueHandlers_();
}

function searchByLineAndSheet(databaseId, userEmail, lineNumber, sheetNumber, sourceInterface) {
  setDatabaseContext_(databaseId);
  return searchByLineAndSheet_(
    userEmail,
    lineNumber,
    sheetNumber,
    sourceInterface || 'FIELD',
    true
  );
}

function getFieldPortalData(databaseId, userEmail, lineNumber, sheetNumber, auditSearch) {
  setDatabaseContext_(databaseId);
  return getFieldPortalData_(
    userEmail,
    lineNumber,
    sheetNumber,
    auditSearch !== false
  );
}

function performFieldAction(databaseId, userEmail, request) {
  setDatabaseContext_(databaseId);
  return performFieldAction_(userEmail, request || {});
}

function migrateExistingQuantityBaselines(databaseId, userEmail) {
  setDatabaseContext_(databaseId);
  return migrateExistingQuantityBaselines_(userEmail);
}

function getFmrDetail(databaseId, userEmail, fmrId, sourceInterface) {
  setDatabaseContext_(databaseId);
  getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT,
    FMR_CORE.ROLES.LEADERSHIP,
    FMR_CORE.ROLES.AUDITOR
  ], sourceInterface || 'ADMIN');

  const header = findRecord_(FMR_CORE.SHEETS.HEADERS, 'FMR_ID', fmrId);
  if (!header) throw new Error(`FMR not found: ${fmrId}`);
  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows
    .filter(row => normalize_(row.FMR_ID) === normalize_(fmrId));
  return {
    header: serializeHeader_(header),
    lines: lines.map(serializeMaterialLine_)
  };
}

function getAdminPortalData(databaseId, userEmail, filters) {
  setDatabaseContext_(databaseId);
  return getAdminPortalData_(userEmail, filters || {});
}

function reviewBackorder(databaseId, userEmail, request) {
  setDatabaseContext_(databaseId);
  return reviewBackorder_(userEmail, request || {});
}
