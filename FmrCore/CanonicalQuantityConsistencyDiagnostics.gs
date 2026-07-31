/**
 * CanonicalQuantityConsistencyDiagnostics.gs
 *
 * READ-ONLY.
 *
 * Confirms that the quantity summary fields stored in FMR_Line_Items agree
 * with the quantities derived from append-only Material_Transactions.
 *
 * Run this before changing Field Portal reads to use canonical line summaries
 * instead of recalculating every line from the transaction sheet.
 */

function runCanonicalQuantityConsistencyDiagnostics() {
  const databaseId =
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U';

  setDatabaseContext_(
    databaseId
  );

  clearAllCaches_();

  const lines =
    getSheetData_(
      FMR_CORE.SHEETS.LINES
    ).rows;

  const comparisons = [
    {
      canonicalField:
        'Qty_Confirmed_Located',
      derivedField:
        'confirmedLocated'
    },
    {
      canonicalField:
        'Qty_Active_Bagged',
      derivedField:
        'activeBagged'
    },
    {
      canonicalField:
        'Qty_Available',
      derivedField:
        'available'
    },
    {
      canonicalField:
        'Qty_Issued',
      derivedField:
        'issued'
    },
    {
      canonicalField:
        'Qty_Pending_Backorder',
      derivedField:
        'pendingBackorder'
    },
    {
      canonicalField:
        'Qty_Confirmed_Backorder',
      derivedField:
        'confirmedBackorder'
    },
    {
      canonicalField:
        'Qty_Remaining_Requirement',
      derivedField:
        'remainingRequirement'
    },
    {
      canonicalField:
        'Qty_Not_Yet_Located',
      derivedField:
        'notYetLocated'
    }
  ];

  const mismatches = [];
  let comparedFieldCount = 0;

  lines.forEach(
    function (line) {
      const lineId =
        normalize_(
          line.FMR_Line_ID
        );

      if (!lineId) {
        return;
      }

      const derived =
        getLineOperationalState_(
          line
        );

      comparisons.forEach(
        function (comparison) {
          const canonicalValue =
            number_(
              line[
                comparison.canonicalField
              ]
            );

          const derivedValue =
            number_(
              derived[
                comparison.derivedField
              ]
            );

          comparedFieldCount += 1;

          if (
            Math.abs(
              canonicalValue -
              derivedValue
            ) >
            0.000001
          ) {
            mismatches.push({
              fmrNumber:
                normalize_(
                  line.FMR_Number
                ),

              fmrLineId:
                lineId,

              isoLineNumber:
                normalize_(
                  line.ISO_Line_Number
                ),

              isoSheet:
                normalize_(
                  line.ISO_Sheet
                ),

              field:
                comparison.canonicalField,

              canonicalValue:
                canonicalValue,

              derivedValue:
                derivedValue,

              difference:
                canonicalValue -
                derivedValue
            });
          }
        }
      );
    }
  );

  const result = {
    passed:
      mismatches.length === 0,

    readOnly:
      true,

    databaseId:
      databaseId,

    coreVersion:
      FMR_CORE.VERSION,

    canonicalLineCount:
      lines.length,

    comparedFieldCount:
      comparedFieldCount,

    mismatchCount:
      mismatches.length,

    mismatches:
      mismatches,

    conclusion:
      mismatches.length === 0
        ? 'Canonical FMR line quantity summaries match transaction-derived quantities.'
        : 'Do not switch Field reads to canonical summaries until the mismatches are reconciled.'
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
      'Canonical quantity consistency failed with ' +
      mismatches.length +
      ' mismatch(es).'
    );
  }

  return result;
}
