/**
 * FieldSearchPerformanceDiagnostics.gs
 *
 * READ-ONLY performance diagnostics for the current FMRCore Field search.
 *
 * This file belongs in the FMRCore project.
 *
 * It does not:
 * - append audit records;
 * - update canonical FMR records;
 * - create transactions;
 * - create bag/tag records;
 * - create backorders;
 * - change configuration values.
 *
 * The diagnostic intentionally calls getFieldPortalData_() with
 * auditSearch=false.
 */

const FMR_FIELD_PERF_DEFAULTS = Object.freeze({
  databaseId:
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U',

  userEmail:
    'jonathanmura05@gmail.com',

  lineNumber:
    'TEST-FIELD-LINE-001',

  sheetNumber:
    '1',

  sampleRuns:
    3
});

/**
 * Runs the standard production-safe Field search benchmark.
 *
 * @return {Object} Compact performance report.
 */
function runFieldSearchPerformanceDiagnostics() {
  return benchmarkFieldSearchPerformance_(
    FMR_FIELD_PERF_DEFAULTS
  );
}

/**
 * Runs a read-only benchmark for any valid line and sheet.
 *
 * Example:
 * benchmarkFieldSearchPerformance_({
 *   databaseId: '...',
 *   userEmail: '...',
 *   lineNumber: 'FG-70912_001',
 *   sheetNumber: '3',
 *   sampleRuns: 3
 * });
 *
 * @param {Object} options
 * @return {Object}
 */
function benchmarkFieldSearchPerformance_(options) {
  const settings =
    Object.assign(
      {},
      FMR_FIELD_PERF_DEFAULTS,
      options || {}
    );

  const sampleRuns =
    Math.max(
      1,
      Math.min(
        10,
        Math.floor(
          Number(settings.sampleRuns) || 3
        )
      )
    );

  const lineNumber =
    normalizeUpper_(
      settings.lineNumber
    );

  const sheetNumber =
    normalizeUpper_(
      settings.sheetNumber
    );

  lineSheetKey_(
    lineNumber,
    sheetNumber
  );

  setDatabaseContext_(
    settings.databaseId
  );

  const serviceSamples = [];

  /*
   * Each cache-cleared sample starts with the FMRCore in-memory sheet cache
   * empty. The same-execution sample immediately repeats the request without
   * clearing that cache.
   */
  for (
    let runNumber = 1;
    runNumber <= sampleRuns;
    runNumber += 1
  ) {
    clearAllCaches_();

    const cacheCleared =
      measureFieldPerformancePhase_(
        'cacheClearedService',
        function () {
          return getFieldPortalData_(
            settings.userEmail,
            lineNumber,
            sheetNumber,
            false
          );
        }
      );

    const sameExecutionWarm =
      measureFieldPerformancePhase_(
        'sameExecutionWarmService',
        function () {
          return getFieldPortalData_(
            settings.userEmail,
            lineNumber,
            sheetNumber,
            false
          );
        }
      );

    serviceSamples.push({
      runNumber:
        runNumber,

      cacheClearedMs:
        cacheCleared.ms,

      sameExecutionWarmMs:
        sameExecutionWarm.ms,

      resultCount:
        Number(
          cacheCleared.value &&
          cacheCleared.value.resultCount
        ) || 0,

      materialLineCount:
        countFieldMaterials_(
          cacheCleared.value
        )
    });
  }

  clearAllCaches_();

  const detailed =
    buildFieldSearchDetailedProfile_(
      settings.userEmail,
      lineNumber,
      sheetNumber
    );

  const cacheClearedValues =
    serviceSamples.map(
      function (sample) {
        return sample.cacheClearedMs;
      }
    );

  const warmValues =
    serviceSamples.map(
      function (sample) {
        return sample.sameExecutionWarmMs;
      }
    );

  const result = {
    passed: true,
    readOnly: true,

    databaseId:
      settings.databaseId,

    coreVersion:
      FMR_CORE.VERSION,

    query: {
      userEmail:
        String(
          settings.userEmail || ''
        ).toLowerCase(),

      lineNumber:
        lineNumber,

      sheetNumber:
        sheetNumber,

      lineSheetKey:
        lineSheetKey_(
          lineNumber,
          sheetNumber
        )
    },

    sampleRuns:
      sampleRuns,

    serviceSamples:
      serviceSamples,

    serviceSummary: {
      cacheClearedAverageMs:
        averageFieldPerformance_(
          cacheClearedValues
        ),

      cacheClearedMinimumMs:
        minimumFieldPerformance_(
          cacheClearedValues
        ),

      cacheClearedMaximumMs:
        maximumFieldPerformance_(
          cacheClearedValues
        ),

      sameExecutionWarmAverageMs:
        averageFieldPerformance_(
          warmValues
        ),

      sameExecutionWarmMinimumMs:
        minimumFieldPerformance_(
          warmValues
        ),

      sameExecutionWarmMaximumMs:
        maximumFieldPerformance_(
          warmValues
        )
    },

    detailedProfile:
      detailed,

    interpretation: {
      cacheCleared:
        'FMRCore in-memory sheet caches were cleared before the request.',

      sameExecutionWarm:
        'The request was repeated immediately in the same execution without clearing FMRCore caches.',

      noAuditWrite:
        true
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
 * Builds one detailed, read-only profile of the current Field request path.
 *
 * @param {string} userEmail
 * @param {string} lineNumber
 * @param {string} sheetNumber
 * @return {Object}
 */
function buildFieldSearchDetailedProfile_(
  userEmail,
  lineNumber,
  sheetNumber
) {
  const phases = {};

  const authorization =
    measureFieldPerformancePhase_(
      'authorization',
      function () {
        return getAuthorizedUser_(
          userEmail,
          [
            FMR_CORE.ROLES.ADMIN,
            FMR_CORE.ROLES.PLANNER,
            FMR_CORE.ROLES.MATERIAL_CONTROL,
            FMR_CORE.ROLES.FIELD_HANDLER,
            FMR_CORE.ROLES.FOREMAN,
            FMR_CORE.ROLES.SUPERINTENDENT
          ],
          'FIELD'
        );
      }
    );

  phases.authorizationMs =
    authorization.ms;

  const lineTablePhase =
    measureFieldPerformancePhase_(
      'loadAllCanonicalLines',
      function () {
        return getSheetData_(
          FMR_CORE.SHEETS.LINES
        );
      }
    );

  phases.loadAllCanonicalLinesMs =
    lineTablePhase.ms;

  const allLines =
    lineTablePhase.value.rows;

  const lineFilterPhase =
    measureFieldPerformancePhase_(
      'filterMatchingCanonicalLines',
      function () {
        return allLines.filter(
          function (row) {
            return (
              normalizeUpper_(
                row.ISO_Line_Number
              ) === lineNumber &&
              normalizeUpper_(
                row.ISO_Sheet
              ) === sheetNumber
            );
          }
        );
      }
    );

  phases.filterMatchingCanonicalLinesMs =
    lineFilterPhase.ms;

  const matchingLines =
    lineFilterPhase.value;

  const matchingLineIds =
    new Set(
      matchingLines.map(
        function (row) {
          return normalize_(
            row.FMR_Line_ID
          );
        }
      )
    );

  const matchingFmrIds =
    new Set(
      matchingLines.map(
        function (row) {
          return normalize_(
            row.FMR_ID
          );
        }
      )
    );

  const headerTablePhase =
    measureFieldPerformancePhase_(
      'loadAllCanonicalHeaders',
      function () {
        return getSheetData_(
          FMR_CORE.SHEETS.HEADERS
        );
      }
    );

  phases.loadAllCanonicalHeadersMs =
    headerTablePhase.ms;

  const headerMapPhase =
    measureFieldPerformancePhase_(
      'buildHeaderLookup',
      function () {
        return Object.fromEntries(
          headerTablePhase.value.rows.map(
            function (row) {
              return [
                normalize_(
                  row.FMR_ID
                ),
                row
              ];
            }
          )
        );
      }
    );

  phases.buildHeaderLookupMs =
    headerMapPhase.ms;

  const transactionTablePhase =
    measureFieldPerformancePhase_(
      'loadAllTransactions',
      function () {
        return getSheetData_(
          FMR_CORE.SHEETS.TRANSACTIONS
        );
      }
    );

  phases.loadAllTransactionsMs =
    transactionTablePhase.ms;

  const allTransactions =
    transactionTablePhase.value.rows;

  /*
   * Measures the current implementation:
   * getLineOperationalState_() calls summarizeLineQuantities_(), which filters
   * the complete in-memory transaction collection once for each matching line.
   */
  const currentQuantityPhase =
    measureFieldPerformancePhase_(
      'currentPerLineQuantitySummaries',
      function () {
        return matchingLines.map(
          function (line) {
            return getLineOperationalState_(
              line
            );
          }
        );
      }
    );

  phases.currentPerLineQuantitySummariesMs =
    currentQuantityPhase.ms;

  /*
   * Read-only comparison implementation:
   * scans all transactions once and aggregates only the matching line IDs.
   * This does not replace production logic; it quantifies the potential gain.
   */
  const onePassQuantityPhase =
    measureFieldPerformancePhase_(
      'comparisonOnePassQuantityAggregation',
      function () {
        return aggregateMatchingTransactionsOnePass_(
          allTransactions,
          matchingLineIds
        );
      }
    );

  phases.comparisonOnePassQuantityAggregationMs =
    onePassQuantityPhase.ms;

  const bagHeaderPhase =
    measureFieldPerformancePhase_(
      'loadAllBagHeaders',
      function () {
        return getSheetData_(
          FMR_CORE.SHEETS.BAG_HEADERS
        );
      }
    );

  phases.loadAllBagHeadersMs =
    bagHeaderPhase.ms;

  const bagItemPhase =
    measureFieldPerformancePhase_(
      'loadAllBagItems',
      function () {
        return getSheetData_(
          FMR_CORE.SHEETS.BAG_ITEMS
        );
      }
    );

  phases.loadAllBagItemsMs =
    bagItemPhase.ms;

  const currentBagAssemblyPhase =
    measureFieldPerformancePhase_(
      'currentGlobalActiveBagAssembly',
      function () {
        return getActiveBagDataByLine_();
      }
    );

  phases.currentGlobalActiveBagAssemblyMs =
    currentBagAssemblyPhase.ms;

  const matchingBagCount =
    Array.from(
      matchingLineIds
    ).reduce(
      function (total, lineId) {
        return (
          total +
          (
            currentBagAssemblyPhase.value[
              lineId
            ] || []
          ).length
        );
      },
      0
    );

  const personnelPhase =
    measureFieldPerformancePhase_(
      'loadPersonnelOptions',
      function () {
        return getFieldPersonnelOptions_();
      }
    );

  phases.loadPersonnelOptionsMs =
    personnelPhase.ms;

  const reasonsPhase =
    measureFieldPerformancePhase_(
      'loadBackorderReasons',
      function () {
        return getListValues_(
          'Backorder_Reason'
        );
      }
    );

  phases.loadBackorderReasonsMs =
    reasonsPhase.ms;

  const configurationPhase =
    measureFieldPerformancePhase_(
      'loadConfiguration',
      function () {
        return getConfiguration_();
      }
    );

  phases.loadConfigurationMs =
    configurationPhase.ms;

  const sortedPhaseDurations =
    Object.keys(
      phases
    )
      .map(
        function (name) {
          return {
            phase:
              name,
            ms:
              phases[name]
          };
        }
      )
      .sort(
        function (left, right) {
          return right.ms - left.ms;
        }
      );

  return {
    rowCounts: {
      canonicalLines:
        allLines.length,

      matchingCanonicalLines:
        matchingLines.length,

      matchingFmrs:
        matchingFmrIds.size,

      canonicalHeaders:
        headerTablePhase.value.rows.length,

      transactions:
        allTransactions.length,

      bagHeaders:
        bagHeaderPhase.value.rows.length,

      bagItems:
        bagItemPhase.value.rows.length,

      users:
        getSheetData_(
          FMR_CORE.SHEETS.USERS
        ).rows.length,

      listRows:
        getSheetData_(
          FMR_CORE.SHEETS.LISTS
        ).rows.length,

      matchingActiveBagEntries:
        matchingBagCount
    },

    phases:
      phases,

    phasesSlowestFirst:
      sortedPhaseDurations,

    quantityComparison: {
      currentPerLineMs:
        currentQuantityPhase.ms,

      onePassComparisonMs:
        onePassQuantityPhase.ms,

      matchingLineCount:
        matchingLines.length,

      totalTransactionCount:
        allTransactions.length
    },

    responseShape: {
      authorizedRole:
        authorization.value.role,

      issueHandlerCount:
        personnelPhase.value
          .issueHandlers
          .length,

      bagHandlerCount:
        personnelPhase.value
          .bagHandlers
          .length,

      backorderReporterCount:
        personnelPhase.value
          .backorderReporters
          .length,

      backorderReasonCount:
        reasonsPhase.value.length
    }
  };
}

/**
 * Read-only comparison aggregator for matching transaction line IDs.
 *
 * @param {Object[]} transactions
 * @param {Set<string>} matchingLineIds
 * @return {Object}
 */
function aggregateMatchingTransactionsOnePass_(
  transactions,
  matchingLineIds
) {
  const totalsByLine = {};

  matchingLineIds.forEach(
    function (lineId) {
      totalsByLine[lineId] = {
        CONFIRM_AVAILABLE: 0,
        DIRECT_ISSUE: 0,
        QUANTITY_ADJUSTMENT: 0,
        BAG: 0,
        RELEASE_BAG: 0,
        ISSUE_FROM_BAG: 0,
        ISSUE_FROM_AVAILABLE: 0,
        RETURN: 0,
        BACKORDER_REQUESTED: 0,
        BACKORDER_CONFIRMED: 0,
        BACKORDER_REJECTED: 0,
        BACKORDER_CLEARED: 0
      };
    }
  );

  transactions.forEach(
    function (row) {
      const lineId =
        normalize_(
          row.FMR_Line_ID
        );

      if (
        !lineId ||
        !matchingLineIds.has(
          lineId
        )
      ) {
        return;
      }

      const type =
        normalizeUpper_(
          row.Transaction_Type
        );

      if (
        Object.prototype.hasOwnProperty.call(
          totalsByLine[lineId],
          type
        )
      ) {
        totalsByLine[lineId][type] +=
          number_(
            row.Quantity
          );
      }
    }
  );

  return totalsByLine;
}

/**
 * Measures one synchronous Apps Script phase.
 *
 * @param {string} name
 * @param {Function} callback
 * @return {{name:string, ms:number, value:*}}
 */
function measureFieldPerformancePhase_(
  name,
  callback
) {
  const startedAt =
    Date.now();

  const value =
    callback();

  return {
    name:
      name,

    ms:
      Date.now() -
      startedAt,

    value:
      value
  };
}

/**
 * Counts material lines in a Field response.
 *
 * @param {Object} response
 * @return {number}
 */
function countFieldMaterials_(
  response
) {
  const cards =
    response &&
    Array.isArray(
      response.cards
    )
      ? response.cards
      : [];

  return cards.reduce(
    function (total, card) {
      return (
        total +
        (
          card &&
          Array.isArray(
            card.materials
          )
            ? card.materials.length
            : 0
        )
      );
    },
    0
  );
}

function averageFieldPerformance_(
  values
) {
  if (
    !values ||
    !values.length
  ) {
    return 0;
  }

  return Math.round(
    values.reduce(
      function (sum, value) {
        return sum + value;
      },
      0
    ) /
    values.length
  );
}

function minimumFieldPerformance_(
  values
) {
  return values && values.length
    ? Math.min.apply(
        null,
        values
      )
    : 0;
}

function maximumFieldPerformance_(
  values
) {
  return values && values.length
    ? Math.max.apply(
        null,
        values
      )
    : 0;
}
