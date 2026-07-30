/**
 * Phase4_FmrImportRegressionTests.gs
 *
 * Pure regression tests for the import configuration and Turner FMR parser.
 *
 * THIS FILE BELONGS IN FMRCORE.
 */

function runFmrImportRegressionTests() {
  const tests = [];

  function test(name, callback) {
    const started = Date.now();

    try {
      callback();

      tests.push({
        name,
        status: 'PASS',
        durationMs: Date.now() - started
      });
    } catch (error) {
      tests.push({
        name,
        status: 'FAIL',
        durationMs: Date.now() - started,
        message: error.message || String(error)
      });
    }
  }

  function assertTrue(value, message) {
    if (!value) {
      throw new Error(message || 'Expected true.');
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message || 'Values differ.') +
        ` Expected "${expected}", received "${actual}".`
      );
    }
  }

  test('import config exposes queue sheet', function () {
    assertEqual(
      FMR_IMPORT_CONFIG.sheets.queue,
      'FMR_Import_Queue'
    );
  });

  test('import config supports PDF Google Sheets and XLSX', function () {
    assertTrue(
      FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
        FMR_IMPORT_CONFIG.mimeTypes.PDF
      ) !== -1
    );

    assertTrue(
      FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
        FMR_IMPORT_CONFIG.mimeTypes.GOOGLE_SHEET
      ) !== -1
    );

    assertTrue(
      FMR_IMPORT_CONFIG.supportedMimeTypes.indexOf(
        FMR_IMPORT_CONFIG.mimeTypes.XLSX
      ) !== -1
    );
  });

  test('known FMR text template is detected', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertEqual(
      result.detectedTemplate,
      FMR_IMPORT_CONFIG.templates.TURNER_FMR_V1
    );
  });

  test('known FMR text parses IWP line and revision', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertEqual(
      result.header.iwpNumber,
      'SMM30R101MMPP-K477'
    );

    assertEqual(
      result.header.isoLineNumber,
      'LP131-CIPS-171045-04'
    );

    assertEqual(
      result.header.revision,
      '1'
    );
  });

  test('known FMR text parses four material lines', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertEqual(
      result.materialLines.length,
      4
    );

    assertEqual(
      result.materialLines[0].commodityCode,
      '002954'
    );

    assertEqual(
      result.materialLines[1].quantity,
      3
    );

    assertEqual(
      result.materialLines[3].commodityCode,
      '5UGSP-02-50'
    );
  });

  test('missing quantity is preserved for human verification', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertEqual(
      result.materialLines[0].quantity,
      ''
    );

    assertTrue(
      result.warnings.indexOf(
        FMR_IMPORT_CONFIG.warningCodes.QUANTITY_MISSING
      ) !== -1
    );
  });

  test('wrapped material description is joined', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertTrue(
      result.materialLines[2].materialDescription.indexOf(
        'SUPPORT CRADLE'
      ) !== -1
    );
  });

  test('pipe classification only matches descriptions beginning with PIPE', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName: 'TESTFMR.pdf'
      }
    );

    assertEqual(result.materialLines[0].isPipe, true);
    assertEqual(result.materialLines[1].isPipe, false);
  });

  test('filename fallback derives a missing FMR number', function () {
    const result = parseKnownFmrText(
      sampleFmrImportText_(),
      {
        sourceFileName:
          'SMM30R101MMPP-K477_FMR - SMM30R101MMPP-K477(01).pdf'
      }
    );

    assertEqual(result.header.fmrNumber, '01');

    assertTrue(
      result.warnings.indexOf(
        FMR_IMPORT_CONFIG.warningCodes.FMR_NUMBER_FROM_FILENAME
      ) !== -1
    );
  });

  test('matrix parser reads material columns', function () {
    const result = parseKnownFmrMatrix(
      sampleFmrImportMatrix_(),
      {
        sourceFileName: 'FMR-TEST-01.xlsx'
      }
    );

    assertEqual(result.materialLines.length, 2);
    assertEqual(result.materialLines[0].commodityCode, 'TEST-001');
    assertEqual(result.materialLines[1].quantity, 4);
  });

  const passedCount = tests.filter(function (item) {
    return item.status === 'PASS';
  }).length;

  const failedCount = tests.filter(function (item) {
    return item.status === 'FAIL';
  }).length;

  const result = {
    passed: failedCount === 0,
    total: tests.length,
    passedCount,
    failedCount,
    skippedCount: 0,
    results: tests
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function sampleFmrImportText_() {
  return [
    'FIELD MATERIAL REQUEST / RETURN (FMR)',
    'DESTINATION:',
    'Field',
    'WAREHOUSE: Turner',
    'REQUESTED BY:',
    'CRAFT:',
    'PIPE',
    'IWP:',
    'SMM30R101MMPP-K477',
    'FMR NO.',
    'DELIVER TO: DATE REQUIRED: LINE NO:',
    'LP131-CIPS-171045-04',
    'SHT: REV:',
    '1',
    'Commodity Code Size Quantity Material Description Issued Back Ordered Action Taken',
    '002954 2 PIPE SCH 10S ERW 316/316L SS A312',
    '5450706 2 3 ELL 90 LR SCH 10S 316/316L SS A403-W',
    '5CH-02-50 2 5',
    '5CH, SUPPORT CRADLE HOT SERVICE 2" PIPE, 1/2"',
    'INS',
    '5UGSP-02-50 2 2 5UGSP, U-BOLT GUIDE FOR INSULATED LINES 2" PIPE W/ 1/2" INSUL',
    'REASON REQUIRED'
  ].join('\n');
}

function sampleFmrImportMatrix_() {
  return [
    ['FIELD MATERIAL REQUEST / RETURN (FMR)', '', '', ''],
    ['DESTINATION:', 'Field', 'WAREHOUSE:', 'Turner'],
    ['REQUESTED BY:', 'Test Requester', 'CRAFT:', 'PIPE'],
    ['IWP:', 'TEST-IWP-001', 'FMR NO.:', 'FMR-TEST-01'],
    ['LINE NO.:', 'TEST-LINE-01', 'SHT:', '2', 'REV:', '1'],
    ['Commodity Code', 'Size', 'Quantity', 'Material Description'],
    ['TEST-001', '4"', '2', 'PIPE 4" SCH 10S - TEST'],
    ['TEST-002', '2"', '4', 'ELL 90 DEG 2" - TEST'],
    ['', '', '', ''],
    ['', '', '', ''],
    ['REASON REQUIRED', '', '', '']
  ];
}
function runFmrImportFoundationSmokeTestAndLog() {
  const spreadsheetId =
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U';

  const callerEmail =
    'jonathanmura05@gmail.com';

  const setup =
    setupFmrImportQueueSheet(
      spreadsheetId,
      callerEmail
    );

  const validation =
    validateFmrImportServiceFoundation(
      spreadsheetId
    );

  const result = {
    setup,
    validation
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!validation.valid) {
    throw new Error(
      validation.issues.join('\n')
    );
  }

  return result;
}