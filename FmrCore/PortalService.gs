/**
 * PortalService.gs
 *
 * Provides the private portal-bootstrap implementation used by PublicApi.gs.
 *
 * Responsibilities:
 * - Normalize the requested portal view.
 * - Authorize the signed-in user for that view.
 * - Return a stable identity and capability contract to the Bound web app.
 *
 * This service is read-only. It does not update spreadsheet records.
 */

/**
 * Normalizes a requested portal view.
 *
 * Supported views:
 * - field
 * - admin
 * - import
 *
 * Blank or unsupported values safely default to "field".
 *
 * @param {*} value Requested portal view.
 * @return {string} Normalized portal view.
 */
function normalizePortalView_(value) {
  const normalizedView =
    normalize_(value).toLowerCase();

  if (
    normalizedView === 'field' ||
    normalizedView === 'admin' ||
    normalizedView === 'import'
  ) {
    return normalizedView;
  }

  return 'field';
}

/**
 * Returns the roles that may load the requested portal shell.
 *
 * This controls only whether the user may load the portal bootstrap.
 * Individual services continue to enforce their own action permissions.
 *
 * For example:
 * - Field actions are still controlled by canPerformFieldTransactions_().
 * - Backorder decisions are still controlled by canReviewBackorders_().
 * - Import batch access remains controlled by the Phase 4 Import services.
 *
 * @param {string} view Normalized portal view.
 * @return {string[]} Authorized role names.
 */
function portalReadRoles_(view) {
  switch (normalizePortalView_(view)) {
    case 'admin':
      return [
        FMR_CORE.ROLES.ADMIN,
        FMR_CORE.ROLES.PLANNER,
        FMR_CORE.ROLES.MATERIAL_CONTROL,
        FMR_CORE.ROLES.SUPERINTENDENT,
        FMR_CORE.ROLES.LEADERSHIP,
        FMR_CORE.ROLES.AUDITOR
      ];

    case 'import':
      /*
       * Import services perform their own batch-assignment and action
       * authorization. The generic portal bootstrap requires only that the
       * account be an active registered FMR user.
       */
      return [
        FMR_CORE.ROLES.ADMIN,
        FMR_CORE.ROLES.PLANNER,
        FMR_CORE.ROLES.MATERIAL_CONTROL,
        FMR_CORE.ROLES.FIELD_HANDLER,
        FMR_CORE.ROLES.FOREMAN,
        FMR_CORE.ROLES.SUPERINTENDENT,
        FMR_CORE.ROLES.LEADERSHIP,
        FMR_CORE.ROLES.AUDITOR
      ];

    case 'field':
    default:
      return [
        FMR_CORE.ROLES.ADMIN,
        FMR_CORE.ROLES.PLANNER,
        FMR_CORE.ROLES.MATERIAL_CONTROL,
        FMR_CORE.ROLES.FIELD_HANDLER,
        FMR_CORE.ROLES.FOREMAN,
        FMR_CORE.ROLES.SUPERINTENDENT
      ];
  }
}

/**
 * Returns the audit/source-interface label corresponding to a portal view.
 *
 * @param {string} view Normalized portal view.
 * @return {string} FIELD, ADMIN, or IMPORT.
 */
function portalSourceInterface_(view) {
  switch (normalizePortalView_(view)) {
    case 'admin':
      return 'ADMIN';

    case 'import':
      return 'IMPORT';

    case 'field':
    default:
      return 'FIELD';
  }
}

/**
 * Builds the identity and permission payload used when the web portal loads.
 *
 * PublicApi.gs initializes the database context before calling this function.
 *
 * @param {string} userEmail Authenticated Google account email.
 * @param {*} view Requested portal view.
 * @return {Object} Portal bootstrap payload.
 */
function getPortalBootstrap_(userEmail, view) {
  const normalizedView =
    normalizePortalView_(view);

  const user =
    getAuthorizedUser_(
      userEmail,
      portalReadRoles_(
        normalizedView
      ),
      portalSourceInterface_(
        normalizedView
      )
    );

  const configuration =
    getConfiguration_();

  const pollSeconds =
    Math.max(
      10,
      Math.floor(
        number_(
          configuration.POLL_SECONDS
        ) || 15
      )
    );

  return {
    view:
      normalizedView,

    userEmail:
      user.email,

    displayName:
      user.name,

    role:
      user.role,

    canPerformFieldTransactions:
      canPerformFieldTransactions_(
        user.role
      ),

    canReviewBackorders:
      canReviewBackorders_(
        user.role
      ),

    pollSeconds:
      pollSeconds,

    coreVersion:
      FMR_CORE.VERSION
  };
}