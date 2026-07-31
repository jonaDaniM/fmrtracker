/**
 * BackorderAndAdminPortalRegressionTests.gs
 *
 * FMRCORE ONLY.
 *
 * These tests validate the pure guard/helper behavior. They do not write to
 * the spreadsheet.
 */

function runBackorderAndAdminPortalRegressionTests() {
  const results = [];

  function test(name, callback) {
    try {
      callback();

      results.push({
        name,
        status: 'PASS'
      });
    } catch (error) {
      results.push({
        name,
        status: 'FAIL',
        error:
          error && error.message
            ? error.message
            : String(error)
      });
    }
  }

  function equal(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(
        `${label}: expected ${expected}, received ${actual}`
      );
    }
  }

  test(
    'pending status is actionable',
    function () {
      equal(
        isActionableBackorderStatus_(
          'Pending Planning Confirmation'
        ),
        true,
        'actionable'
      );
    }
  );

  test(
    'partial status is actionable',
    function () {
      equal(
        isActionableBackorderStatus_(
          'Partially Confirmed'
        ),
        true,
        'actionable'
      );
    }
  );

  test(
    'returned status is not a Planning action',
    function () {
      equal(
        isActionableBackorderStatus_(
          'Returned for Clarification'
        ),
        false,
        'actionable'
      );
    }
  );

  test(
    'confirmed status is finalized',
    function () {
      equal(
        isActionableBackorderStatus_(
          'Confirmed'
        ),
        false,
        'actionable'
      );
    }
  );

  test(
    'blank FMR header is invalid',
    function () {
      equal(
        isValidAdminHeader_({
          FMR_ID: '',
          FMR_Number: ''
        }),
        false,
        'valid header'
      );
    }
  );

  test(
    'valid canonical FMR header is accepted',
    function () {
      equal(
        isValidAdminHeader_({
          FMR_ID: 'FMR-1',
          FMR_Number: 'TEST-FMR-1'
        }),
        true,
        'valid header'
      );
    }
  );

  test(
    'blank material line is invalid',
    function () {
      equal(
        isValidAdminLine_({
          FMR_Line_ID: '',
          FMR_ID: ''
        }),
        false,
        'valid line'
      );
    }
  );

  test(
    'valid material line is accepted',
    function () {
      equal(
        isValidAdminLine_({
          FMR_Line_ID: 'FMRLINE-1',
          FMR_ID: 'FMR-1'
        }),
        true,
        'valid line'
      );
    }
  );

  test(
    'backorder queue record requires IDs and positive quantity',
    function () {
      equal(
        isValidBackorderQueueRecord_({
          Backorder_Request_ID: 'BO-1',
          FMR_ID: 'FMR-1',
          FMR_Line_ID: 'LINE-1',
          Qty_Requested_Backorder: 5
        }),
        true,
        'valid backorder'
      );
    }
  );

  test(
    'zero quantity backorder is excluded',
    function () {
      equal(
        isValidBackorderQueueRecord_({
          Backorder_Request_ID: 'BO-1',
          FMR_ID: 'FMR-1',
          FMR_Line_ID: 'LINE-1',
          Qty_Requested_Backorder: 0
        }),
        false,
        'valid backorder'
      );
    }
  );

  const passedCount =
    results.filter(function (result) {
      return result.status === 'PASS';
    }).length;

  const report = {
    passed:
      passedCount === results.length,
    total:
      results.length,
    passedCount,
    failedCount:
      results.length - passedCount,
    results
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  if (!report.passed) {
    throw new Error(
      'Backorder/Admin regression tests failed.'
    );
  }

  return report;
}
