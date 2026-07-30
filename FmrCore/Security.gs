/**
 * Authorization helpers for FMRCore.
 * Resolves Users-sheet membership and role/capability gates.
 */

function getAuthorizedUser_(userEmail, allowedRoles, sourceInterface) {
  const email = normalizeUpper_(userEmail);
  if (!email) throw new Error('Authenticated user email is required.');

  const users = getSheetData_(FMR_CORE.SHEETS.USERS).rows;
  const row = users.find(user => normalizeUpper_(user.Email) === email);

  if (!row) {
    throw new Error(
      `The user "${normalize_(userEmail)}" is not registered on the Users sheet.`
    );
  }

  if (!truthyFlag_(row.Active !== '' && row.Active != null ? row.Active : true)) {
    throw new Error(`The user "${normalize_(userEmail)}" is inactive.`);
  }

  const role = normalize_(row.Role);
  const roleUpper = normalizeUpper_(role);
  const allowed = (allowedRoles || []).map(normalizeUpper_);

  if (allowed.length && !allowed.includes(roleUpper)) {
    throw new Error(
      `Role "${role || 'blank'}" is not authorized for this action.`
    );
  }

  const canIssue = truthyFlag_(row.Can_Issue);
  const canBag = truthyFlag_(row.Can_Bag);
  const canRequestBackorder = truthyFlag_(row.Can_Request_Backorder);
  const canApproveBackorder = truthyFlag_(row.Can_Approve_Backorder);

  const isFieldActor = [
    normalizeUpper_(FMR_CORE.ROLES.ADMIN),
    normalizeUpper_(FMR_CORE.ROLES.PLANNER),
    normalizeUpper_(FMR_CORE.ROLES.MATERIAL_CONTROL),
    normalizeUpper_(FMR_CORE.ROLES.FIELD_HANDLER)
  ].includes(roleUpper);

  const canPerformFieldTransactions =
    isFieldActor && (canIssue || canBag || canRequestBackorder);

  const canReviewBackorders =
    [
      normalizeUpper_(FMR_CORE.ROLES.ADMIN),
      normalizeUpper_(FMR_CORE.ROLES.PLANNER),
      normalizeUpper_(FMR_CORE.ROLES.MATERIAL_CONTROL)
    ].includes(roleUpper) &&
    (canApproveBackorder ||
      roleUpper === normalizeUpper_(FMR_CORE.ROLES.ADMIN) ||
      roleUpper === normalizeUpper_(FMR_CORE.ROLES.PLANNER));

  return {
    userId: normalize_(row.User_ID),
    email: normalize_(row.Email),
    name: normalize_(row.Display_Name) || normalize_(row.Email),
    role,
    active: true,
    canIssue,
    canBag,
    canRequestBackorder,
    canApproveBackorder,
    canPerformFieldTransactions,
    canTransact: canPerformFieldTransactions,
    canReviewBackorders,
    sourceInterface: normalize_(sourceInterface) || ''
  };
}

function listHandlerUsers_(capabilityField) {
  return getSheetData_(FMR_CORE.SHEETS.USERS).rows
    .filter(row => {
      if (!truthyFlag_(row.Active !== '' && row.Active != null ? row.Active : true)) {
        return false;
      }
      if (!capabilityField) return true;
      return truthyFlag_(row[capabilityField]);
    })
    .map(row => ({
      userId: normalize_(row.User_ID),
      name: normalize_(row.Display_Name) || normalize_(row.Email),
      email: normalize_(row.Email),
      role: normalize_(row.Role)
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})
    );
}

function resolveSelectedUser_(selectedUserId) {
  const userId = normalize_(selectedUserId);
  if (!userId) throw new Error('A selected user is required.');

  const row = findRecord_(FMR_CORE.SHEETS.USERS, 'User_ID', userId);
  if (!row) throw new Error(`Selected user was not found: ${userId}`);
  if (!truthyFlag_(row.Active !== '' && row.Active != null ? row.Active : true)) {
    throw new Error(`Selected user is inactive: ${userId}`);
  }

  return {
    userId: normalize_(row.User_ID),
    email: normalize_(row.Email),
    name: normalize_(row.Display_Name) || normalize_(row.Email),
    role: normalize_(row.Role)
  };
}
