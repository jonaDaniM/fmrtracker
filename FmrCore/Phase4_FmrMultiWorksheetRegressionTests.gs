/**
 * Phase4_FmrMultiWorksheetRegressionTests.gs
 *
 * Regression tests for structured Turner workbooks containing one FMR per
 * worksheet.
 *
 * THIS FILE BELONGS IN FMRCORE.
 */

function runFmrMultiWorksheetRegressionTests() {
  const results = [];

  function run(name, callback) {
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
          error.message ||
          String(error)
      });
    }
  }

  function equal(
    actual,
    expected,
    message
  ) {
    if (actual !== expected) {
      throw new Error(
        (message || 'Values differ.') +
        ` Expected "${expected}", received "${actual}".`
      );
    }
  }

  function truthy(
    value,
    message
  ) {
    if (!value) {
      throw new Error(
        message ||
        'Expected a truthy value.'
      );
    }
  }

  run(
    'matrix labels remain inside their merged header cells',
    function () {
      const parsed =
        parseKnownFmrMatrix(
          sampleFmrWorksheetMatrix_(),
          {
            sourceFileName:
              'SMM30R101MMPP-K477(02)'
          }
        );

      equal(
        parsed.header.destination,
        'Field'
      );

      equal(
        parsed.header.warehouse,
        'Turner'
      );

      equal(
        parsed.header.requestedBy,
        ''
      );

      equal(
        parsed.header.iwpNumber,
        'SMM30R101MMPP-K477'
      );

      equal(
        parsed.header.isoLineNumber,
        'LP131-CIPS-171047-07'
      );

      equal(
        parsed.header.revision,
        '1'
      );
    }
  );

  run(
    'blank FMR field falls back to worksheet name',
    function () {
      const parsed =
        parseKnownFmrMatrix(
          sampleFmrWorksheetMatrix_(),
          {
            sourceFileName:
              'SMM30R101MMPP-K477(02)'
          }
        );

      equal(
        parsed.header.fmrNumber,
        'SMM30R101MMPP-K477(02)'
      );
    }
  );

  run(
    'table headers do not become FMR header values',
    function () {
      const parsed =
        parseKnownFmrMatrix(
          sampleFmrWorksheetMatrix_(),
          {
            sourceFileName:
              'SMM30R101MMPP-K477(02)'
          }
        );

      truthy(
        parsed.header.fmrNumber !==
          'Back Ordered'
      );

      truthy(
        parsed.header.requestedBy !==
          'Commodity Code'
      );
    }
  );

  run(
    'structured worksheet parses ten material lines',
    function () {
      const parsed =
        parseKnownFmrMatrix(
          sampleFmrWorksheetMatrix_(),
          {
            sourceFileName:
              'SMM30R101MMPP-K477(02)'
          }
        );

      equal(
        parsed.materialLines.length,
        10
      );

      equal(
        parsed.materialLines[0]
          .commodityCode,
        '5537081'
      );

      equal(
        parsed.materialLines[9]
          .commodityCode,
        '5CH-02-50'
      );
    }
  );

  run(
    'structured import priority precedes PDF OCR',
    function () {
      truthy(
        getFmrImportMethodPriority_(
          FMR_IMPORT_CONFIG.methods
            .XLSX_TO_GOOGLE_SHEET
        ) <
        getFmrImportMethodPriority_(
          FMR_IMPORT_CONFIG.methods
            .PDF_TO_DOC_OCR
        )
      );
    }
  );

  const passedCount =
    results.filter(function (item) {
      return item.status === 'PASS';
    }).length;

  const failedCount =
    results.filter(function (item) {
      return item.status === 'FAIL';
    }).length;

  const output = {
    passed:
      failedCount === 0,
    total:
      results.length,
    passedCount,
    failedCount,
    results
  };

  console.log(
    JSON.stringify(
      output,
      null,
      2
    )
  );

  if (!output.passed) {
    throw new Error(
      results
        .filter(function (item) {
          return item.status ===
            'FAIL';
        })
        .map(function (item) {
          return (
            item.name +
            ': ' +
            item.error
          );
        })
        .join('\n')
    );
  }

  return output;
}

function sampleFmrWorksheetMatrix_() {
  return [
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['', 'FIELD MATERIAL REQUEST / RETURN (FMR)', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['', 'DESTINATION: Field', '', '', '', '', 'WAREHOUSE: Turner', '', '', '', ''],
    ['', 'REQUESTED BY:', '', '', 'CRAFT: PIPE', '', 'IWP: SMM30R101MMPP-K477', '', 'FMR NO.', '', ''],
    ['', 'DELIVER TO:', '', '', 'DATE REQUIRED:', '', '', 'LINE NO: LP131-CIPS-171047-07', '', 'SHT:', 'REV: 1'],
    ['', 'Commodity Code', 'Size', 'Quantity', 'Material Description', '', '', '', 'Issued', 'Back Ordered', 'Action Taken'],
    ['', '5537081', '2X3/4', '1', 'PIPET 10S X 3000# SW 316/316L SS', '', '', '', '', '', ''],
    ['', '5450706', '2', '2', 'ELL 90 LR SCH 10S 316/316L SS A403-W', '', '', '', '', '', ''],
    ['', '5540491', '3/4', '1', 'NIPPLE SCH 10S 316/316L SS PBE 3" LONG', '', '', '', '', '', ''],
    ['', '5608148', '3/4', '1', 'FLG SW 150# RF 316/316L SS 10S BORE', '', '', '', '', '', ''],
    ['', '5669399L', '3/4', '2', 'GASKET 150# PTFE RING 1/8" THK LOW STRESS', '', '', '', '', '', ''],
    ['', '5676576L', '1/2', '8', 'STUD-BOLT A193 GR B8M W/A194 GR 8M NUTS - 2.75 in. Length', '', '', '', '', '', ''],
    ['', '5352193L2', '3/4', '1', 'BALL 150# RF 316SS TFE FP EXTD STEM, HNDL OP', '', '', '', '', '', ''],
    ['', '5616520', '3/4', '1', 'FLG BLIND 150# RF 316/316L SS', '', '', '', '', '', ''],
    ['', '5HR2T', '2', '2', '5HR2T, TRAPEZE HANGER ROD W/ TURNBUCKLE, 10" AND SMALLER PIPE', '', '', '', '', '', ''],
    ['', '5CH-02-50', '2', '2', '5CH, SUPPORT CRADLE HOT SERVICE 2" PIPE, 1/2" INS', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['', 'REASON REQUIRED', '', '', '', '', '', '', '', '', '']
  ];
}
