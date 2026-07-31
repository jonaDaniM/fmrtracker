/**
 * CoreContractDiagnostics.gs
 *
 * Read-only runtime contract verification for FMRCore.
 *
 * This diagnostic confirms that required services and shared helpers are
 * loaded as functions before database-backed portal or workflow tests begin.
 *
 * It does not:
 * - initialize a database context;
 * - open the spreadsheet;
 * - update records;
 * - append transactions;
 * - create audit entries.
 */

/**
 * Runs the FMRCore runtime contract diagnostic.
 *
 * @return {Object} Diagnostic summary.
 */
function runCoreContractDiagnostics() {
  const functionTypes = {
    // Portal service
    getPortalBootstrap_:
      typeof getPortalBootstrap_,

    normalizePortalView_:
      typeof normalizePortalView_,

    portalReadRoles_:
      typeof portalReadRoles_,

    portalSourceInterface_:
      typeof portalSourceInterface_,

    // Serialization service
    serializeDateTime_:
      typeof serializeDateTime_,

    serializeHeader_:
      typeof serializeHeader_,

    serializeMaterialLine_:
      typeof serializeMaterialLine_,

    totalMaterials_:
      typeof totalMaterials_,

    // Security service
    getAuthorizedUser_:
      typeof getAuthorizedUser_,

    canPerformFieldTransactions_:
      typeof canPerformFieldTransactions_,

    backorderReviewRoles_:
      typeof backorderReviewRoles_,

    canReviewBackorders_:
      typeof canReviewBackorders_,

    // Repository service
    setDatabaseContext_:
      typeof setDatabaseContext_,

    getSheetData_:
      typeof getSheetData_,

    updateRecord_:
      typeof updateRecord_,

    clearAllCaches_:
      typeof clearAllCaches_,

    // Search, Field, and quantity services
    searchByLineAndSheet_:
      typeof searchByLineAndSheet_,

    getFieldPortalData_:
      typeof getFieldPortalData_,

    performFieldAction_:
      typeof performFieldAction_,

    refreshLineSummary_:
      typeof refreshLineSummary_,

    refreshFmrHeaderSummary_:
      typeof refreshFmrHeaderSummary_,

    // Admin Portal service
    getAdminPortalData_:
      typeof getAdminPortalData_,

    searchAdminFmrs_:
      typeof searchAdminFmrs_,

    getAdminSummary_:
      typeof getAdminSummary_,

    getPendingBackorders_:
      typeof getPendingBackorders_,

    getActiveBagTags_:
      typeof getActiveBagTags_,

    // Backorder decision service
    reviewBackorder_:
      typeof reviewBackorder_,

    isActionableBackorderStatus_:
      typeof isActionableBackorderStatus_
  };

  const missingFunctions =
    Object.keys(functionTypes).filter(
      function (functionName) {
        return (
          functionTypes[functionName] !==
          'function'
        );
      }
    );

  const coreObjectDefined =
    typeof FMR_CORE !== 'undefined' &&
    FMR_CORE !== null &&
    typeof FMR_CORE === 'object';

  const coreVersion =
    coreObjectDefined
      ? String(
          FMR_CORE.VERSION || ''
        ).trim()
      : '';

  const configuredSheets =
    (
      coreObjectDefined &&
      FMR_CORE.SHEETS &&
      typeof FMR_CORE.SHEETS === 'object'
    )
      ? Object.assign(
          {},
          FMR_CORE.SHEETS
        )
      : {};

  const configuredRoles =
    (
      coreObjectDefined &&
      FMR_CORE.ROLES &&
      typeof FMR_CORE.ROLES === 'object'
    )
      ? Object.assign(
          {},
          FMR_CORE.ROLES
        )
      : {};

  const scriptTimezone =
    Session.getScriptTimeZone() || '';

  const backorderRoles =
    functionTypes.backorderReviewRoles_ ===
    'function'
      ? backorderReviewRoles_()
      : [];

  const expectedBackorderRoles =
    coreObjectDefined
      ? [
          FMR_CORE.ROLES.ADMIN,
          FMR_CORE.ROLES.PLANNER,
          FMR_CORE.ROLES.MATERIAL_CONTROL
        ]
      : [];

  const checks = {
    allRequiredFunctionsDefined:
      missingFunctions.length === 0,

    coreObjectDefined:
      coreObjectDefined,

    coreVersionPresent:
      coreVersion.length > 0,

    sheetConfigurationPresent:
      Object.keys(
        configuredSheets
      ).length > 0,

    roleConfigurationPresent:
      Object.keys(
        configuredRoles
      ).length > 0,

    scriptTimezonePresent:
      scriptTimezone.length > 0,

    backorderRolesReturnsArray:
      Array.isArray(
        backorderRoles
      ),

    backorderRolesExactlyThree:
      Array.isArray(
        backorderRoles
      ) &&
      backorderRoles.length === 3,

    backorderRoleSetCorrect:
      expectedBackorderRoles.length === 3 &&
      expectedBackorderRoles.every(
        function (role) {
          return backorderRoles.includes(
            role
          );
        }
      ),

    backorderRolesHaveNoDuplicates:
      Array.isArray(
        backorderRoles
      ) &&
      new Set(
        backorderRoles
      ).size ===
      backorderRoles.length,

    everyBackorderRoleAuthorized:
      functionTypes.canReviewBackorders_ ===
        'function' &&
      Array.isArray(
        backorderRoles
      ) &&
      backorderRoles.every(
        function (role) {
          return canReviewBackorders_(
            role
          );
        }
      )
  };

  const failedChecks =
    Object.keys(checks).filter(
      function (checkName) {
        return checks[checkName] !== true;
      }
    );

  const result = {
    passed:
      missingFunctions.length === 0 &&
      failedChecks.length === 0,

    requiredFunctionCount:
      Object.keys(
        functionTypes
      ).length,

    loadedFunctionCount:
      Object.keys(
        functionTypes
      ).length -
      missingFunctions.length,

    missingFunctions:
      missingFunctions,

    failedChecks:
      failedChecks,

    functionTypes:
      functionTypes,

    configuration: {
      coreVersion:
        coreVersion,

      scriptTimezone:
        scriptTimezone,

      adminResultLimit:
        coreObjectDefined
          ? FMR_CORE.ADMIN_RESULT_LIMIT
          : '',

      sheets:
        configuredSheets,

      roles:
        configuredRoles
    },

    securityContract: {
      backorderReviewRoles:
        backorderRoles
    },

    checks:
      checks
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!result.passed) {
    const details = [];

    if (missingFunctions.length) {
      details.push(
        'Missing functions: ' +
        missingFunctions.join(', ')
      );
    }

    if (failedChecks.length) {
      details.push(
        'Failed checks: ' +
        failedChecks.join(', ')
      );
    }

    throw new Error(
      'FMRCore contract diagnostic failed. ' +
      details.join(' | ')
    );
  }

  return result;
}