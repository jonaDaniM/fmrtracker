/**
 * CanonicalLineIntegrityDiagnostics.gs
 *
 * READ-ONLY.
 *
 * Explains the difference between repository row count and valid canonical
 * FMR line count before Field-read performance changes are introduced.
 */

function runCanonicalLineIntegrityDiagnostics() {
  const databaseId =
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U';

  setDatabaseContext_(
    databaseId
  );

  clearAllCaches_();

  const table =
    getSheetData_(
      FMR_CORE.SHEETS.LINES
    );

  const requiredIdentityFields = [
    'FMR_Line_ID',
    'FMR_ID',
    'FMR_Number',
    'ISO_Line_Number',
    'ISO_Sheet'
  ];

  const validRows = [];
  const invalidRows = [];

  table.rows.forEach(
    function (row) {
      const missingFields =
        requiredIdentityFields.filter(
          function (fieldName) {
            return !normalize_(
              row[fieldName]
            );
          }
        );

      if (!missingFields.length) {
        validRows.push({
          physicalRow:
            row._rowNumber,

          fmrLineId:
            normalize_(
              row.FMR_Line_ID
            ),

          fmrId:
            normalize_(
              row.FMR_ID
            ),

          fmrNumber:
            normalize_(
              row.FMR_Number
            ),

          isoLineNumber:
            normalize_(
              row.ISO_Line_Number
            ),

          isoSheet:
            normalize_(
              row.ISO_Sheet
            )
        });

        return;
      }

      const populatedFields = {};

      table.headers.forEach(
        function (header) {
          const value =
            row[header];

          if (
            value !== '' &&
            value !== null &&
            value !== undefined
          ) {
            populatedFields[header] =
              value;
          }
        }
      );

      invalidRows.push({
        physicalRow:
          row._rowNumber,

        missingIdentityFields:
          missingFields,

        populatedFields:
          populatedFields
      });
    }
  );

  const result = {
    passed:
      invalidRows.length === 0,

    readOnly:
      true,

    databaseId:
      databaseId,

    coreVersion:
      FMR_CORE.VERSION,

    repositoryRowCount:
      table.rows.length,

    validCanonicalLineCount:
      validRows.length,

    invalidRepositoryRowCount:
      invalidRows.length,

    expectedQuantityComparisonCount:
      validRows.length * 8,

    validRows:
      validRows,

    invalidRows:
      invalidRows,

    conclusion:
      invalidRows.length === 0
        ? 'Every nonblank repository row is a valid canonical FMR line.'
        : 'Some nonblank sheet rows are not valid canonical FMR line records. Review them before optimizing Field reads.'
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
