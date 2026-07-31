/**
 * RepositoryRegressionTests.gs
 *
 * FMRCORE ONLY.
 *
 * In-memory regression checks for physical spreadsheet row tracking.
 */

function runRepositoryRegressionTests() {
  const results = [];

  function run(name, callback) {
    try {
      callback();

      results.push({
        name:
          name,

        status:
          'PASS'
      });
    } catch (error) {
      results.push({
        name:
          name,

        status:
          'FAIL',

        error:
          error &&
          error.message
            ? error.message
            : String(error)
      });
    }
  }

  function equal(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(
        label +
        ': expected ' +
        expected +
        ', received ' +
        actual
      );
    }
  }

  run(
    'physical row numbers survive blank rows',
    function () {
      const values = [
        ['ID', 'Status'],
        ['A', 'OPEN'],
        ['', ''],
        ['', ''],
        ['B', 'PENDING'],
        ['', ''],
        ['C', 'DONE']
      ];

      const rows =
        buildSheetRecords_(
          values,
          values[0]
        );

      equal(
        rows.length,
        3,
        'record count'
      );

      equal(
        rows[0]._rowNumber,
        2,
        'row A'
      );

      equal(
        rows[1]._rowNumber,
        5,
        'row B'
      );

      equal(
        rows[2]._rowNumber,
        7,
        'row C'
      );

      equal(
        rows[1].ID,
        'B',
        'row B ID'
      );
    }
  );

  run(
    'checkbox false is retained as real data',
    function () {
      const values = [
        ['ID', 'Is_Pipe'],
        ['ROW-1', false]
      ];

      const rows =
        buildSheetRecords_(
          values,
          values[0]
        );

      equal(
        rows.length,
        1,
        'record count'
      );

      equal(
        rows[0]._rowNumber,
        2,
        'physical row'
      );

      equal(
        rows[0].Is_Pipe,
        false,
        'checkbox value'
      );
    }
  );

  const passedCount =
    results.filter(
      function (item) {
        return (
          item.status ===
          'PASS'
        );
      }
    ).length;

  const report = {
    passed:
      passedCount ===
      results.length,

    total:
      results.length,

    passedCount:
      passedCount,

    failedCount:
      results.length -
      passedCount,

    results:
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
      'Repository regression tests failed.'
    );
  }

  return report;
}