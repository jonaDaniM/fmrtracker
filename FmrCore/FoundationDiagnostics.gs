/**
 * FoundationDiagnostics.gs
 *
 * Read-only database and configuration verification for FMRCore.
 *
 * This diagnostic:
 * - Opens the configured database;
 * - Confirms all required sheets exist;
 * - Confirms each required sheet has a usable header row;
 * - Reads the Configuration and Users sheets;
 * - Confirms the designated Administrator account;
 * - Compares the script, spreadsheet, and configured timezones;
 * - Confirms the release-candidate FMRCore version.
 *
 * It does not:
 * - append audit records;
 * - update spreadsheet cells;
 * - append transactions;
 * - create FMR records;
 * - create backorders;
 * - change configuration values.
 */

/**
 * Inspects the FMRCore foundation without writing to the database.
 *
 * @param {string} databaseId Spreadsheet database ID.
 * @param {string} administratorEmail Expected Administrator email.
 * @return {Object} Foundation diagnostic result.
 */
function inspectFoundationReadOnly_(
  databaseId,
  administratorEmail
) {
  const normalizedDatabaseId =
    normalize_(databaseId);

  const normalizedAdministratorEmail =
    normalize_(
      administratorEmail
    ).toLowerCase();

  if (!normalizedDatabaseId) {
    throw new Error(
      'databaseId is required.'
    );
  }

  if (!normalizedAdministratorEmail) {
    throw new Error(
      'administratorEmail is required.'
    );
  }

  setDatabaseContext_(
    normalizedDatabaseId
  );

  clearAllCaches_();

  const spreadsheet =
    database_();

  const requiredSheetNames =
    Object.values(
      FMR_CORE.SHEETS
    );

  const missingSheets = [];
  const sheetsWithoutHeaders = [];
  const sheetDiagnostics = {};

  requiredSheetNames.forEach(
    function (sheetName) {
      const sheet =
        spreadsheet.getSheetByName(
          sheetName
        );

      if (!sheet) {
        missingSheets.push(
          sheetName
        );

        sheetDiagnostics[sheetName] = {
          exists: false,
          lastRow: 0,
          lastColumn: 0,
          headers: []
        };

        return;
      }

      const lastRow =
        sheet.getLastRow();

      const lastColumn =
        sheet.getLastColumn();

      const headers =
        lastColumn > 0
          ? sheet
              .getRange(
                1,
                1,
                1,
                lastColumn
              )
              .getDisplayValues()[0]
              .map(normalize_)
          : [];

      const nonblankHeaders =
        headers.filter(Boolean);

      if (!nonblankHeaders.length) {
        sheetsWithoutHeaders.push(
          sheetName
        );
      }

      sheetDiagnostics[sheetName] = {
        exists: true,
        lastRow:
          lastRow,
        lastColumn:
          lastColumn,
        headerCount:
          nonblankHeaders.length,
        headers:
          nonblankHeaders
      };
    }
  );

  let configuration = {};
  let configurationError = '';

  if (
    !missingSheets.includes(
      FMR_CORE.SHEETS.CONFIG
    ) &&
    !sheetsWithoutHeaders.includes(
      FMR_CORE.SHEETS.CONFIG
    )
  ) {
    try {
      configuration =
        getConfiguration_();
    } catch (error) {
      configurationError =
        error &&
        error.message
          ? error.message
          : String(error);
    }
  } else {
    configurationError =
      'Configuration sheet is missing or has no usable header row.';
  }

  let administratorRecord = null;
  let usersReadError = '';

  if (
    !missingSheets.includes(
      FMR_CORE.SHEETS.USERS
    ) &&
    !sheetsWithoutHeaders.includes(
      FMR_CORE.SHEETS.USERS
    )
  ) {
    try {
      administratorRecord =
        getSheetData_(
          FMR_CORE.SHEETS.USERS
        ).rows.find(
          function (row) {
            return (
              normalize_(
                row.Email
              ).toLowerCase() ===
              normalizedAdministratorEmail
            );
          }
        ) || null;
    } catch (error) {
      usersReadError =
        error &&
        error.message
          ? error.message
          : String(error);
    }
  } else {
    usersReadError =
      'Users sheet is missing or has no usable header row.';
  }

  let authorizedAdministrator = null;
  let authorizationError = '';

  if (administratorRecord) {
    try {
      authorizedAdministrator =
        getAuthorizedUser_(
          normalizedAdministratorEmail,
          [
            FMR_CORE.ROLES.ADMIN
          ],
          'FOUNDATION_DIAGNOSTIC'
        );
    } catch (error) {
      authorizationError =
        error &&
        error.message
          ? error.message
          : String(error);
    }
  } else {
    authorizationError =
      'Administrator record was not found.';
  }

  const targetTimezone =
    'America/Indiana/Indianapolis';

  const configuredTimezone =
    normalize_(
      configuration.TIMEZONE
    );

  const spreadsheetTimezone =
    normalize_(
      spreadsheet.getSpreadsheetTimeZone()
    );

  const scriptTimezone =
    normalize_(
      Session.getScriptTimeZone()
    );

  const administratorActive =
    administratorRecord
      ? normalizeUpper_(
          administratorRecord.Active
        ) === 'YES'
      : false;

  const administratorRole =
    administratorRecord
      ? normalize_(
          administratorRecord.Role
        )
      : '';

  const checks = {
    databaseOpened:
      spreadsheet.getId() ===
      normalizedDatabaseId,

    allRequiredSheetsPresent:
      missingSheets.length === 0,

    allRequiredSheetsHaveHeaders:
      sheetsWithoutHeaders.length === 0,

    configurationReadable:
      configurationError === '',

    configurationHasValues:
      Object.keys(
        configuration
      ).length > 0,

    configurationHasTimezone:
      configuredTimezone.length > 0,

    configuredTimezoneMatchesTarget:
      configuredTimezone ===
      targetTimezone,

    spreadsheetTimezoneMatchesTarget:
      spreadsheetTimezone ===
      targetTimezone,

    scriptTimezoneMatchesTarget:
      scriptTimezone ===
      targetTimezone,

    usersSheetReadable:
      usersReadError === '',

    administratorRecordFound:
      administratorRecord !== null,

    administratorActive:
      administratorActive,

    administratorRoleCorrect:
      administratorRole ===
      FMR_CORE.ROLES.ADMIN,

    administratorAuthorizationSuccessful:
      authorizedAdministrator !== null &&
      authorizationError === '',

    coreVersionCorrect:
      FMR_CORE.VERSION ===
      '2.3.1'
  };

  const failedChecks =
    Object.keys(
      checks
    ).filter(
      function (checkName) {
        return checks[checkName] !== true;
      }
    );

  const result = {
    passed:
      failedChecks.length === 0,

    failedChecks:
      failedChecks,

    checks:
      checks,

    database: {
      requestedDatabaseId:
        normalizedDatabaseId,

      openedDatabaseId:
        spreadsheet.getId(),

      spreadsheetName:
        spreadsheet.getName(),

      requiredSheetCount:
        requiredSheetNames.length,

      missingSheets:
        missingSheets,

      sheetsWithoutHeaders:
        sheetsWithoutHeaders,

      sheets:
        sheetDiagnostics
    },

    configuration: {
      coreVersion:
        FMR_CORE.VERSION,

      configurationKeys:
        Object.keys(
          configuration
        ).sort(),

      configurationError:
        configurationError,

      targetTimezone:
        targetTimezone,

      configuredTimezone:
        configuredTimezone,

      spreadsheetTimezone:
        spreadsheetTimezone,

      scriptTimezone:
        scriptTimezone
    },

    administrator: {
      requestedEmail:
        normalizedAdministratorEmail,

      recordFound:
        administratorRecord !== null,

      userId:
        administratorRecord
          ? normalize_(
              administratorRecord.User_ID
            )
          : '',

      displayName:
        administratorRecord
          ? normalize_(
              administratorRecord.Display_Name
            )
          : '',

      role:
        administratorRole,

      active:
        administratorActive,

      authorizationSuccessful:
        authorizedAdministrator !== null,

      authorizationError:
        authorizationError,

      usersReadError:
        usersReadError
    }
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}

/**
 * Temporary runner for the current FMR Database Master.
 *
 * This function is read-only.
 */
function runReadOnlyFoundationVerification() {
  return inspectFoundationReadOnly_(
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U',
    'jonathanmura05@gmail.com'
  );
}