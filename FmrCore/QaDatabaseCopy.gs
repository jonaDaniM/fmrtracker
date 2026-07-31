/**
 * QaDatabaseCopy.gs
 *
 * Creates a disposable QA copy of the current FMR database.
 *
 * The source spreadsheet is not modified.
 * All controlled write tests must use the returned QA database ID.
 */
function createFmrQaDatabaseCopy() {
  const sourceDatabaseId =
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U';

  const targetTimezone =
    'America/Indiana/Indianapolis';

  const timestamp =
    Utilities.formatDate(
      new Date(),
      targetTimezone,
      'yyyyMMdd-HHmmss'
    );

  const qaName =
    'FMR Database QA v2.3.1 - ' +
    timestamp;

  const sourceFile =
    DriveApp.getFileById(
      sourceDatabaseId
    );

  const qaFile =
    sourceFile.makeCopy(
      qaName
    );

  const qaDatabaseId =
    qaFile.getId();

  const qaSpreadsheet =
    SpreadsheetApp.openById(
      qaDatabaseId
    );

  qaSpreadsheet.setSpreadsheetTimeZone(
    targetTimezone
  );

  SpreadsheetApp.flush();

  const requiredSheets = [
    FMR_CORE.SHEETS.CONFIG,
    FMR_CORE.SHEETS.LISTS,
    FMR_CORE.SHEETS.USERS,
    FMR_CORE.SHEETS.IWP,
    FMR_CORE.SHEETS.ISO,
    FMR_CORE.SHEETS.HEADERS,
    FMR_CORE.SHEETS.LINKS,
    FMR_CORE.SHEETS.LINES,
    FMR_CORE.SHEETS.TRANSACTIONS,
    FMR_CORE.SHEETS.BAG_HEADERS,
    FMR_CORE.SHEETS.BAG_ITEMS,
    FMR_CORE.SHEETS.BACKORDERS,
    FMR_CORE.SHEETS.AUDIT,
    FMR_CORE.SHEETS.SEARCH_INDEX,

    'FMR_Import_Queue',
    'FMR_Manual_Entry',
    'FMR_Manual_Review',
    'FMR_Manual_Batches',
    'Admin_Dashboard',
    'Field_View_Config'
  ];

  const missingSheets =
    requiredSheets.filter(
      function (sheetName) {
        return !qaSpreadsheet
          .getSheetByName(
            sheetName
          );
      }
    );

  const sheetRowCounts =
    Object.fromEntries(
      requiredSheets.map(
        function (sheetName) {
          const sheet =
            qaSpreadsheet.getSheetByName(
              sheetName
            );

          return [
            sheetName,
            sheet
              ? sheet.getLastRow()
              : null
          ];
        }
      )
    );

  const result = {
    passed:
      qaDatabaseId !==
        sourceDatabaseId &&
      missingSheets.length === 0 &&
      qaSpreadsheet
        .getSpreadsheetTimeZone() ===
        targetTimezone,

    sourceDatabaseId:
      sourceDatabaseId,

    qaDatabaseId:
      qaDatabaseId,

    qaSpreadsheetName:
      qaSpreadsheet.getName(),

    qaSpreadsheetUrl:
      qaSpreadsheet.getUrl(),

    sourceAndQaIdsDifferent:
      qaDatabaseId !==
      sourceDatabaseId,

    timezone:
      qaSpreadsheet
        .getSpreadsheetTimeZone(),

    requiredSheetCount:
      requiredSheets.length,

    missingSheets:
      missingSheets,

    sheetRowCounts:
      sheetRowCounts,

    warning:
      'Use qaDatabaseId for all controlled write tests. Do not use the source database ID.'
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!result.passed) {
    throw new Error(
      'QA database creation verification failed.'
    );
  }

  return result;
}