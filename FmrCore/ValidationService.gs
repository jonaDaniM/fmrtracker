function validateFoundation_(userEmail) {
  const user = getAuthorizedUser_(userEmail, [FMR_CORE.ROLES.ADMIN], 'ADMIN');
  const requiredSheets = Object.values(FMR_CORE.SHEETS);
  const database = database_();
  const missing = requiredSheets.filter(name => !database.getSheetByName(name));

  const checks = {
    version: FMR_CORE.VERSION,
    databaseId: database.getId(),
    missingSheets: missing,
    configurationKeys: Object.keys(getConfiguration_()),
    authorizedUser: user,
    valid: missing.length === 0
  };

  writeAudit_('SYSTEM', database.getId(), 'VALIDATE_FOUNDATION', user, '', checks);
  return checks;
}
