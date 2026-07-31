//Security.gs
function getAuthorizedUser_(email, allowedRoles, sourceInterface) {
  const normalizedEmail = normalize_(email).toLowerCase();
  if (!normalizedEmail) throw new Error('Authenticated Google account email is unavailable.');

  const record = getSheetData_(FMR_CORE.SHEETS.USERS).rows.find(row =>
    normalize_(row.Email).toLowerCase() === normalizedEmail &&
    normalizeUpper_(row.Active) === 'YES'
  );

  if (!record) throw new Error(`Unauthorized user: ${email}`);
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(normalize_(record.Role))) {
    throw new Error(`Role ${record.Role} is not authorized for this action.`);
  }

  return {
    id: normalize_(record.User_ID),
    email: normalizedEmail,
    name: normalize_(record.Display_Name),
    role: normalize_(record.Role),
    sourceInterface: sourceInterface || ''
  };
}

function fieldTransactionRoles_() {
  return [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER
  ];
}

function canPerformFieldTransactions_(role) {
  return fieldTransactionRoles_().includes(normalize_(role));
}

// Add share backorder authorization helpers

/**
 * Returns the roles authorized to review and decide Planning backorders.
 *
 * This is the single source of truth for:
 * - Portal bootstrap permissions;
 * - Admin Portal action visibility;
 * - server-side reviewBackorder_ authorization.
 */
function backorderReviewRoles_() {
  return [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL
  ];
}

/**
 * Returns true when the supplied role may review Planning backorders.
 *
 * @param {*} role User role from the Users sheet.
 * @return {boolean}
 */
function canReviewBackorders_(role) {
  return backorderReviewRoles_().includes(
    normalize_(role)
  );
}

function getSelectableUsers_(capabilityField) {
  return getSheetData_(FMR_CORE.SHEETS.USERS).rows
    .filter(row =>
      normalizeUpper_(row.Active) === 'YES' &&
      normalizeUpper_(row[capabilityField]) === 'YES'
    )
    .map(row => ({
      userId: normalize_(row.User_ID),
      name: normalize_(row.Display_Name),
      email: normalize_(row.Email).toLowerCase()
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
}

function getSelectedWorker_(userId, capabilityField, label) {
  const id = normalize_(userId);
  if (!id) throw new Error(`${label || 'Selected user'} is required.`);

  const row = getSheetData_(FMR_CORE.SHEETS.USERS).rows.find(record =>
    normalize_(record.User_ID) === id &&
    normalizeUpper_(record.Active) === 'YES' &&
    normalizeUpper_(record[capabilityField]) === 'YES'
  );

  if (!row) throw new Error(`${label || 'Selected user'} is not authorized for this action.`);

  return {
    id: normalize_(row.User_ID),
    name: normalize_(row.Display_Name),
    email: normalize_(row.Email).toLowerCase()
  };
}

function getFieldPersonnelOptions_() {
  return {
    issueHandlers: getSelectableUsers_('Can_Issue'),
    bagHandlers: getSelectableUsers_('Can_Bag'),
    backorderReporters: getSelectableUsers_('Can_Request_Backorder')
  };
}

function getIssueHandlers_() {
  return getSelectableUsers_('Can_Issue');
}
