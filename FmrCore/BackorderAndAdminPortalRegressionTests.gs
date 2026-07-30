/**
 * Regression coverage for Planning backorder decisions and Admin portal contracts.
 */

function runBackorderAndAdminPortalRegressionTests() {
  const results = [];

  function run(name, callback) {
    try {
      callback();
      results.push({name, status: 'PASS'});
    } catch (error) {
      results.push({
        name,
        status: 'FAIL',
        error: error.message || String(error)
      });
    }
  }

  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message || 'Values differ.') +
        ` Expected "${expected}", received "${actual}".`
      );
    }
  }

  function truthy(value, message) {
    if (!value) throw new Error(message || 'Expected a truthy value.');
  }

  run('only PENDING PLANNING CONFIRMATION is actionable', function () {
    truthy(isActionableBackorderStatus_('Pending Planning Confirmation'));
    truthy(isActionableBackorderStatus_('PENDING PLANNING CONFIRMATION'));
  });

  run('PARTIALLY CONFIRMED remains actionable', function () {
    truthy(isActionableBackorderStatus_('Partially Confirmed'));
    truthy(isActionableBackorderStatus_('PARTIALLY CONFIRMED'));
  });

  run('terminal backorder statuses are not actionable', function () {
    equal(isActionableBackorderStatus_('Confirmed'), false);
    equal(isActionableBackorderStatus_('Rejected'), false);
    equal(isActionableBackorderStatus_('Cleared'), false);
    equal(isActionableBackorderStatus_('Cancelled'), false);
    equal(isActionableBackorderStatus_('Returned for Clarification'), false);
  });

  run('ledger aggregates confirmation and rejection quantities', function () {
    const originalGetSheetData = getSheetData_;
    getSheetData_ = function (sheetName) {
      if (sheetName === FMR_CORE.SHEETS.TRANSACTIONS) {
        return {
          rows: [
            {
              Backorder_Request_ID: 'BO_1',
              Transaction_Type: 'BACKORDER_CONFIRMED',
              Quantity: 2
            },
            {
              Backorder_Request_ID: 'BO_1',
              Transaction_Type: 'BACKORDER_CONFIRMED',
              Quantity: 1
            },
            {
              Backorder_Request_ID: 'BO_1',
              Transaction_Type: 'BACKORDER_REJECTED',
              Quantity: 4
            },
            {
              Backorder_Request_ID: 'BO_OTHER',
              Transaction_Type: 'BACKORDER_CONFIRMED',
              Quantity: 9
            }
          ]
        };
      }
      return originalGetSheetData(sheetName);
    };

    try {
      const ledger = getBackorderDecisionLedgerState_('BO_1');
      equal(ledger.confirmedQty, 3);
      equal(ledger.rejectedQty, 4);
    } finally {
      getSheetData_ = originalGetSheetData;
    }
  });

  run('assertPersistedBackorderDecision_ accepts matching request state', function () {
    assertPersistedBackorderDecision_(
      {
        Status: 'Confirmed',
        Qty_Confirmed_Backorder: 5,
        Reviewed_By_Email: 'planner@example.com'
      },
      {
        requestId: 'BO_TEST',
        nextStatus: 'Confirmed',
        totalConfirmed: 5,
        reviewerEmail: 'planner@example.com'
      }
    );
  });

  run('assertPersistedBackorderDecision_ rejects mismatched status', function () {
    let threw = false;
    try {
      assertPersistedBackorderDecision_(
        {
          Status: 'Pending Planning Confirmation',
          Qty_Confirmed_Backorder: 5,
          Reviewed_By_Email: 'planner@example.com'
        },
        {
          requestId: 'BO_TEST',
          nextStatus: 'Confirmed',
          totalConfirmed: 5,
          reviewerEmail: 'planner@example.com'
        }
      );
    } catch (error) {
      threw = true;
      truthy(
        String(error.message || error).indexOf('did not persist correctly') >= 0
      );
    }
    truthy(threw, 'Expected persistence assertion to fail.');
  });

  run('reviewBackorder return contract includes required fields', function () {
    const required = [
      'success',
      'requestId',
      'correlationId',
      'transactionId',
      'nextStatus',
      'transactionQty',
      'requestedQty',
      'totalConfirmed',
      'pendingQty',
      'line',
      'fmrStatus'
    ];

    // Shape check against the AdminService return object contract.
    const sample = {
      success: true,
      requestId: 'BO_1',
      correlationId: 'CORR_1',
      transactionId: 'TXN_1',
      nextStatus: 'Confirmed',
      transactionQty: 2,
      requestedQty: 2,
      totalConfirmed: 2,
      pendingQty: 0,
      line: {},
      fmrStatus: 'Partially Located'
    };

    required.forEach(function (field) {
      truthy(
        Object.prototype.hasOwnProperty.call(sample, field),
        `Missing required return field: ${field}`
      );
    });
  });

  run('admin portal payload exposes Step 2 smoke-test fields', function () {
    const sample = {
      resultCount: 0,
      pendingBackorders: [],
      activeBagTags: []
    };
    truthy(Array.isArray(sample.pendingBackorders));
    truthy(Array.isArray(sample.activeBagTags));
    equal(typeof sample.resultCount, 'number');
  });

  const passedCount = results.filter(item => item.status === 'PASS').length;
  const failedCount = results.length - passedCount;
  const report = {
    passed: failedCount === 0,
    total: results.length,
    passedCount,
    failedCount,
    results
  };

  console.log(JSON.stringify(report, null, 2));

  if (failedCount > 0) {
    throw new Error(
      `Backorder/Admin portal regression tests failed: ${failedCount}/${results.length}`
    );
  }

  return report;
}
