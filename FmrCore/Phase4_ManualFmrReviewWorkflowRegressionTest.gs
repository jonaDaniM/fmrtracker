/**
 * Phase4_ManualFmrReviewWorkflowRegressionTests.gs
 *
 * THIS FILE BELONGS IN FMRCORE.
 */

function runManualFmrReviewWorkflowRegressionTests() {
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

  function assertEqual(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(
        `${label}: expected ${expected}, received ${actual}`
      );
    }
  }

  function assertThrows(callback, expectedText) {
    let thrown = null;

    try {
      callback();
    } catch (error) {
      thrown = error;
    }

    if (!thrown) {
      throw new Error('Expected an error, but none was thrown.');
    }

    if (
      expectedText &&
      String(thrown.message || thrown)
        .indexOf(expectedText) === -1
    ) {
      throw new Error(
        `Expected error containing "${expectedText}", received ` +
        `"${thrown.message || thrown}".`
      );
    }
  }

  test(
    'blank review row is excluded from queue',
    function () {
      assertEqual(
        isManualFmrReviewQueueRecord_({}),
        false,
        'queue record'
      );
    }
  );

  test(
    'checkbox-only review row is excluded from queue',
    function () {
      assertEqual(
        isManualFmrReviewQueueRecord_({
          Is_Pipe: false
        }),
        false,
        'queue record'
      );
    }
  );

  test(
    'valid review row is included in queue',
    function () {
      assertEqual(
        isManualFmrReviewQueueRecord_({
          Review_ID: 'FMRREVIEW-1',
          Entry_Row_ID: 'FMRENTRY-1',
          Batch_ID: 'FMRBATCH-1',
          Is_Pipe: false
        }),
        true,
        'queue record'
      );
    }
  );

  test(
    'batch creator cannot review the batch',
    function () {
      assertThrows(
        function () {
          assertManualFmrSeparationOfDuties_(
            {
              Entry_Row_ID: 'FMRENTRY-1',
              Entered_By: 'entry@example.com'
            },
            {
              Review_ID: 'FMRREVIEW-1',
              Submitted_By: 'submitter@example.com'
            },
            {
              Email: 'creator@example.com'
            },
            {
              Created_By: 'creator@example.com'
            }
          );
        },
        'batch creator'
      );
    }
  );

  test(
    'entry creator cannot review their own row',
    function () {
      assertThrows(
        function () {
          assertManualFmrSeparationOfDuties_(
            {
              Entry_Row_ID: 'FMRENTRY-1',
              Entered_By: 'entry@example.com'
            },
            {
              Review_ID: 'FMRREVIEW-1',
              Submitted_By: 'submitter@example.com'
            },
            {
              Email: 'entry@example.com'
            },
            {
              Created_By: 'creator@example.com'
            }
          );
        },
        'staging entry creator'
      );
    }
  );

  test(
    'review submitter cannot review their own submission',
    function () {
      assertThrows(
        function () {
          assertManualFmrSeparationOfDuties_(
            {
              Entry_Row_ID: 'FMRENTRY-1',
              Entered_By: 'entry@example.com'
            },
            {
              Review_ID: 'FMRREVIEW-1',
              Submitted_By: 'submitter@example.com'
            },
            {
              Email: 'submitter@example.com'
            },
            {
              Created_By: 'creator@example.com'
            }
          );
        },
        'review submitter'
      );
    }
  );

  test(
    'independent reviewer passes separation of duties',
    function () {
      assertEqual(
        assertManualFmrSeparationOfDuties_(
          {
            Entry_Row_ID: 'FMRENTRY-1',
            Entered_By: 'entry@example.com'
          },
          {
            Review_ID: 'FMRREVIEW-1',
            Submitted_By: 'submitter@example.com'
          },
          {
            Email: 'reviewer@example.com'
          },
          {
            Created_By: 'creator@example.com'
          }
        ),
        true,
        'separation result'
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
      'Manual FMR review workflow regression tests failed.'
    );
  }

  return report;
}
