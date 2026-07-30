//Phase4_VisionRegressionTests.gs
function runVisionRegressionTests(fixtures) {
  const suppliedFixtures =
    fixtures && typeof fixtures === 'object'
      ? fixtures
      : {};

  const results = [
    assertVisionConfigContract_(),
    assertVisionPipeRule_(),
    assertVisionPipeModes_(),
    assertVisionPointZeroRule_(),
    assertVisionQuantityRule_(),
    assertVisionFractionalSizeRule_(),
    assertVisionSizeNormalization_(),
    assertVisionPageClassification_(),
    assertVisionRevisionTextRule_(),
    assertVisionDuplicatePointRule_(),
    assertVisionHashDeterminism_(),
    assertVisionHeaderContracts_(),
    assertVisionArbitraryDrawingPrefixFixture_()
  ];

  const fixtureExpectations =
    getVisionFixtureExpectations_();

  fixtureExpectations.forEach(expectation => {
    results.push(
      runVisionCoordinateFixture_(
        expectation,
        suppliedFixtures
      )
    );
  });

  const failures = results.filter(
    result => !result.passed
  );

  const summary = {
    passed: failures.length === 0,
    total: results.length,
    passedCount: results.filter(
      result => result.passed && !result.skipped
    ).length,
    failedCount: failures.length,
    skippedCount: results.filter(
      result => result.skipped
    ).length,
    results
  };

  if (failures.length > 0) {
    throw new Error(
      [
        'Phase 4 Vision regression failures:',
        failures
          .map(
            failure =>
              `- ${failure.name}: ${failure.message}`
          )
          .join('\n')
      ].join('\n')
    );
  }

  return summary;
}

/**
 * Returns the expected external fixture cases.
 *
 * @return {Object[]}
 */
function getVisionRegressionFixtureRequirements() {
  return getVisionFixtureExpectations_().map(
    expectation => Object.assign({}, expectation)
  );
}

/* ========================================================================== */
/* BUILT-IN UNIT TESTS                                                        */
/* ========================================================================== */

function assertVisionConfigContract_() {
  const passed =
    Boolean(FMR_VISION_CONFIG) &&
    FMR_VISION_CONFIG.sheets.jobs ===
      'Document_Extraction_Jobs' &&
    FMR_VISION_CONFIG.sheets.isoBomReference ===
      'ISO_BOM_Reference' &&
    FMR_VISION_CONFIG.sheets.review ===
      'Document_Extraction_Review' &&
    FMR_VISION_CONFIG.sheets.summary ===
      'Document_Run_Summary' &&
    !Object.prototype.hasOwnProperty.call(
      FMR_VISION_CONFIG,
      'properties'
    );

  return createVisionTestResult_(
    'Configuration contract',
    passed,
    (
      'VisionConfig must use the generalized document sheet names, expose ' +
      'ISO_BOM_Reference, and contain no deployment-specific properties.'
    )
  );
}

function assertVisionPipeRule_() {
  const passed =
    isVisionPipeStock_('PIPE SCH 80') &&
    isVisionPipeStock_('  PIPE  SCH 10S') &&
    !isVisionPipeStock_('PIPET 10S') &&
    !isVisionPipeStock_('5CI, ISOLATION CRADLE');

  return createVisionTestResult_(
    'PIPE stock classification',
    passed,
    'PIPE rows must be recognized without classifying PIPET or supports.'
  );
}

function assertVisionPipeModes_() {
  const source = [
    { point_number: 1, is_pipe: true },
    { point_number: 2, is_pipe: false },
    { point_number: 3, is_pipe: true }
  ];

  const includeAll =
    filterVisionBomRecordsByPipeMode(
      source,
      'INCLUDE_PIPE'
    );

  const normal =
    filterVisionBomRecordsByPipeMode(
      source,
      'NORMAL'
    );

  const pipeOnly =
    filterVisionBomRecordsByPipeMode(
      source,
      'PIPE_ONLY'
    );

  const passed =
    includeAll.length === 3 &&
    normal.length === 1 &&
    normal[0].point_number === 2 &&
    pipeOnly.length === 2 &&
    pipeOnly.every(record => record.is_pipe);

  return createVisionTestResult_(
    'Downstream PIPE modes',
    passed,
    (
      'INCLUDE_PIPE must retain every row, NORMAL must retain non-pipe rows, ' +
      'and PIPE_ONLY must retain only pipe-stock rows.'
    )
  );
}

function assertVisionPointZeroRule_() {
  const passed =
    !FMR_VISION_CONFIG.regex.point.test('0') &&
    FMR_VISION_CONFIG.regex.point.test('1') &&
    FMR_VISION_CONFIG.regex.point.test('25') &&
    FMR_VISION_CONFIG.regex.point.test('999') &&
    !FMR_VISION_CONFIG.regex.point.test('1000');

  return createVisionTestResult_(
    'BOM point-number rule',
    passed,
    'Point 0 must be rejected and valid BOM points must be limited to 1-999.'
  );
}

function assertVisionQuantityRule_() {
  const quantityRegex =
    FMR_VISION_CONFIG.regex.quantity;

  const passed =
    quantityRegex.test('1') &&
    quantityRegex.test('13.6') &&
    quantityRegex.test("13.6'") &&
    quantityRegex.test('13.6′') &&
    !quantityRegex.test('1 EA') &&
    !quantityRegex.test('-1');

  return createVisionTestResult_(
    'Quantity rule',
    passed,
    'Quantity validation must accept numeric and pipe-length values only.'
  );
}

function assertVisionFractionalSizeRule_() {
  const sizeRegex =
    FMR_VISION_CONFIG.regex.size;

  const passed =
    sizeRegex.test('1') &&
    sizeRegex.test('3/4') &&
    sizeRegex.test('1 1/2') &&
    sizeRegex.test('2X1') &&
    sizeRegex.test('1 1/2X1 1/2');

  return createVisionTestResult_(
    'Fractional NPD rule',
    passed,
    'Fractional and reducing sizes must remain entirely in the NPD field.'
  );
}

function assertVisionSizeNormalization_() {
  const passed =
    normalizeVisionSize_('1 1⁄2 x 3⁄4') ===
      '1 1/2X3/4' &&
    normalizeVisionSize_('1½ × 1½') ===
      '1 1/2X1 1/2';

  return createVisionTestResult_(
    'NPD normalization',
    passed,
    'Unicode fractions and multiplication symbols must normalize correctly.'
  );
}

function assertVisionPageClassification_() {
  const isoText =
    'ISOMETRIC DRAWING NUMBER BILL OF MATERIALS';

  const partialText =
    'ISOMETRIC DRAWING NUMBER';

  const fmrText =
    'FIELD MATERIAL REQUEST';

  const passed =
    classifyVisionPage_(isoText) ===
      FMR_VISION_CONFIG.pageClasses.ISO &&
    classifyVisionPage_(partialText) ===
      FMR_VISION_CONFIG.pageClasses.PARTIAL_ISO &&
    classifyVisionPage_(fmrText) ===
      FMR_VISION_CONFIG.pageClasses.EXISTING_FMR;

  return createVisionTestResult_(
    'Page classification',
    passed,
    'ISO, partial ISO, and existing FMR pages must classify deterministically.'
  );
}

function assertVisionRevisionTextRule_() {
  const text =
    '0 ISSUED FOR CONSTRUCTION';

  const passed =
    FMR_VISION_CONFIG.regex.issuedForConstruction.test(
      normalizeVisionText_(text)
    );

  return createVisionTestResult_(
    'Revision-history exclusion',
    passed,
    'Revision rows such as 0 ISSUED FOR CONSTRUCTION must be detectable.'
  );
}

function assertVisionDuplicatePointRule_() {
  const duplicates =
    findDuplicateVisionPoints_([
      { pointNumber: 1 },
      { pointNumber: 2 },
      { pointNumber: 2 },
      { pointNumber: 25 }
    ]);

  const passed =
    duplicates.length === 1 &&
    duplicates[0] === 2;

  return createVisionTestResult_(
    'Duplicate BOM points',
    passed,
    'Duplicate retained BOM point numbers must quarantine the ISO page.'
  );
}

function assertVisionHashDeterminism_() {
  const first = {
    drawing_number: 'ABC-X1-123456-01',
    revision: '0',
    point_number: 1,
    description: 'PIPE SCH 80',
    nominal_size: '1 1/2',
    commodity_code: 'CODE-01',
    quantity: "12.5'"
  };

  const second = {
    drawing_number: 'abc-x1-123456-01',
    revision: '0',
    point_number: 1,
    description: 'PIPE   SCH 80',
    nominal_size: '1 1⁄2',
    commodity_code: 'code-01',
    quantity: "12.5'"
  };

  const passed =
    hashVisionCanonicalRow_(first) ===
    hashVisionCanonicalRow_(second);

  return createVisionTestResult_(
    'Canonical row hash',
    passed,
    'Equivalent normalized material rows must produce the same SHA-256 hash.'
  );
}

function assertVisionHeaderContracts_() {
  const bomHeaders =
    Array.from(FMR_VISION_CONFIG.bomHeaders);

  const jobHeaders =
    Array.from(FMR_VISION_CONFIG.jobHeaders);

  const summaryHeaders =
    Array.from(FMR_VISION_CONFIG.summaryHeaders);

  const passed =
    bomHeaders.indexOf('is_pipe') !== -1 &&
    bomHeaders.indexOf('content_hash') !== -1 &&
    jobHeaders.indexOf('source_document_type') !== -1 &&
    summaryHeaders.indexOf('source_document_type') !== -1;

  return createVisionTestResult_(
    'Sheet header contracts',
    passed,
    (
      'BOM rows must preserve is_pipe/content_hash and job/summary records ' +
      'must include source_document_type.'
    )
  );
}

/**
 * Confirms that the parser's drawing-identity logic has no LP131 dependency.
 * This synthetic test exercises the coordinate window directly.
 *
 * @return {Object}
 */
function assertVisionArbitraryDrawingPrefixFixture_() {
  const words = [
    makeVisionTestWord_('ISOMETRIC', 100, 100, 170, 110),
    makeVisionTestWord_('DRAWING', 175, 100, 230, 110),
    makeVisionTestWord_('NUMBER', 235, 100, 285, 110),
    makeVisionTestWord_('REV', 500, 100, 525, 110),

    makeVisionTestWord_(
      'ZZ_TOP-UTILITY-WATER-9876543210-99',
      100,
      116,
      450,
      126
    ),

    makeVisionTestWord_('A', 505, 116, 515, 126)
  ];

  const lines =
    groupVisionWordsIntoLines_(words, 5);

  const identity =
    detectVisionDrawingIdentity_(
      lines,
      words,
      1
    );

  const passed =
    identity.drawingNumber ===
      'ZZ_TOP-UTILITY-WATER-9876543210-99' &&
    identity.revision === 'A';

  return createVisionTestResult_(
    'Arbitrary drawing prefix',
    passed,
    (
      'Drawing identity must be coordinate-based and must not require LP131, ' +
      'LP1Y, or any other fixed prefix.'
    )
  );
}

/* ========================================================================== */
/* OPTIONAL COORDINATE FIXTURE TESTS                                          */
/* ========================================================================== */

function getVisionFixtureExpectations_() {
  return [
    {
      drawing: 'LP131-PV-180025-05',
      expectation: 'drawing_retained'
    },
    {
      drawing: 'LP131-PV-280025-03',
      expectation: 'drawing_retained'
    },
    {
      drawing: 'LP131-PVAC-281020-05',
      expectation: 'separate_drawing'
    },
    {
      drawing: 'LP131-TWRP-825029-03',
      point: 25,
      commodity: '5UG-02'
    },
    {
      drawing: 'LP131-EMR-386002-04',
      point: 29,
      commodity: '5UG-01'
    },
    {
      drawing: 'LP131-SOLV-750049-09',
      point: 25,
      commodity: '5CI-75'
    },
    {
      drawing: 'LP131-SOLV-753049-09',
      commodity: '5CI-01'
    }
  ];
}

function runVisionCoordinateFixture_(
  expectation,
  fixtures
) {
  const fixture =
    fixtures[expectation.drawing];

  if (!fixture) {
    return {
      name:
        `Coordinate fixture: ${expectation.drawing}`,
      passed: true,
      skipped: true,
      message:
        'Fixture not supplied; external coordinate case skipped.'
    };
  }

  if (
    !fixture.context ||
    !fixture.response
  ) {
    return createVisionTestResult_(
      `Coordinate fixture: ${expectation.drawing}`,
      false,
      'Fixture must contain context and response objects.'
    );
  }

  const result =
    parseVisionIsoPage(
      fixture.context,
      fixture.response
    );

  if (
    expectation.point !== undefined &&
    expectation.point !== null
  ) {
    const record =
      result.records.find(
        item =>
          Number(item.point_number) ===
          Number(expectation.point)
      );

    const passed =
      Boolean(record) &&
      (
        !expectation.commodity ||
        record.commodity_code ===
          expectation.commodity
      );

    return createVisionTestResult_(
      `Coordinate fixture: ${expectation.drawing} point ${expectation.point}`,
      passed,
      (
        `Expected point ${expectation.point}` +
        (
          expectation.commodity
            ? ` with commodity ${expectation.commodity}.`
            : '.'
        )
      )
    );
  }

  const matchingRecords =
    result.records.filter(
      item =>
        item.drawing_number ===
        expectation.drawing
    );

  const commodityPassed =
    !expectation.commodity ||
    matchingRecords.some(
      record =>
        record.commodity_code ===
        expectation.commodity
    );

  return createVisionTestResult_(
    `Coordinate fixture: ${expectation.drawing}`,
    matchingRecords.length > 0 &&
      commodityPassed,
    (
      `Drawing ${expectation.drawing} was not retained with the expected ` +
      'coordinate-derived material output.'
    )
  );
}

/* ========================================================================== */
/* TEST HELPERS                                                               */
/* ========================================================================== */

function createVisionTestResult_(
  name,
  passed,
  message
) {
  return {
    name,
    passed: Boolean(passed),
    skipped: false,
    message
  };
}

function makeVisionTestWord_(
  text,
  x0,
  y0,
  x1,
  y1
) {
  return {
    text,
    x0,
    y0,
    x1,
    y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    width: x1 - x0,
    height: y1 - y0,
    confidence: 1,
    sourceVertices: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 }
    ]
  };
}
function runVisionRegressionTestsWithLog() {
  const result = runVisionRegressionTests();

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}
