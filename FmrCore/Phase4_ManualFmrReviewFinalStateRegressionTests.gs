/**
 * Phase4_ManualFmrReviewFinalStateRegressionTests.gs
 *
 * THIS FILE BELONGS IN FMRCORE.
 */

function runManualFmrReviewFinalStateRegressionTests() {
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
          error &&
          error.message
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

  test(
    'typed decision without completion evidence is not finalized',
    function () {
      assertEqual(
        isManualFmrReviewFinalized_({
          Review_Decision: 'APPROVE',
          Reviewed_At: '',
          Canonical_FMR_ID: '',
          Canonical_FMR_Line_ID: ''
        }),
        false,
        'finalized'
      );
    }
  );

  test(
    'reviewed timestamp finalizes a return or rejection',
    function () {
      assertEqual(
        isManualFmrReviewFinalized_({
          Review_Decision:
            'RETURN_FOR_CLARIFICATION',
          Reviewed_At:
            new Date(),
          Canonical_FMR_ID: '',
          Canonical_FMR_Line_ID: ''
        }),
        true,
        'finalized'
      );
    }
  );

  test(
    'canonical FMR ID is completion evidence',
    function () {
      assertEqual(
        isManualFmrReviewFinalized_({
          Review_Decision: 'APPROVE',
          Reviewed_At: '',
          Canonical_FMR_ID:
            'FMR-TEST-1',
          Canonical_FMR_Line_ID: ''
        }),
        true,
        'finalized'
      );
    }
  );

  test(
    'canonical line ID is completion evidence',
    function () {
      assertEqual(
        isManualFmrReviewFinalized_({
          Review_Decision: 'APPROVE',
          Reviewed_At: '',
          Canonical_FMR_ID: '',
          Canonical_FMR_Line_ID:
            'FMRLINE-TEST-1'
        }),
        true,
        'finalized'
      );
    }
  );

  const passedCount =
    results.filter(function (result) {
      return result.status === 'PASS';
    }).length;

  const report = {
    passed:
      passedCount ===
      results.length,
    total:
      results.length,
    passedCount,
    failedCount:
      results.length -
      passedCount,
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
      'Manual FMR review final-state regression tests failed.'
    );
  }

  return report;
}
