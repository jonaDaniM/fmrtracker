/**
 * Phase4_FmrLiveOcrRegressionTests.gs
 */

function runFmrLiveOcrRegressionTests() {
  const results = [];

  function run(name, callback) {
    try {
      callback();
      results.push({ name, status: 'PASS' });
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
    if (!value) {
      throw new Error(message || 'Expected a truthy value.');
    }
  }

  run('IWP OCR gap is normalized to a hyphen', function () {
    const parsed = parseKnownFmrText(
      [
        'FIELD MATERIAL REQUEST / RETURN (FMR)',
        'IWP:',
        'SMM30R101MMPP K477',
        'SHT: REV:',
        '1',
        'Commodity Code Size Quantity Material Description',
        'ABC-001 2 1 PIPE TEST',
        'REASON REQUIRED'
      ].join('\n'),
      { sourceFileName: 'TESTFMR.pdf' }
    );

    equal(
      parsed.header.iwpNumber,
      'SMM30R101MMPP-K477'
    );
  });

  run('revision parser does not consume the material header', function () {
    const parsed = parseKnownFmrText(
      [
        'FIELD MATERIAL REQUEST / RETURN (FMR)',
        'IWP:',
        'TEST-IWP-001',
        'SHT: REV:',
        '1',
        'Commodity Code Size Quantity Material Description Issued Back',
        'ABC-001 2 1 PIPE TEST',
        'REASON REQUIRED'
      ].join('\n'),
      { sourceFileName: 'TESTFMR.pdf' }
    );

    equal(parsed.header.revision, '1');
  });

  run('short filename sequence is combined with IWP', function () {
    const parsed = parseKnownFmrText(
      [
        'FIELD MATERIAL REQUEST / RETURN (FMR)',
        'IWP:',
        'SMM30R101MMPP-K477',
        'SHT: REV:',
        '1',
        'Commodity Code Size Quantity Material Description',
        'ABC-001 2 1 PIPE TEST',
        'REASON REQUIRED'
      ].join('\n'),
      {
        sourceFileName:
          'SMM30R101MMPP-K477_FMR - SMM30R101MMPP-K477(01).pdf'
      }
    );

    equal(
      parsed.header.fmrNumber,
      'SMM30R101MMPP-K477(01)'
    );
  });

  run('concatenated OCR quantity is recovered', function () {
    const parsed = normalizeParsedFmrImportResult_({
      header: {},
      materialLines: [
        {
          fmrLineNumber: '1',
          commodityCode: '5CH-02-50',
          size: '2',
          quantity: '',
          materialDescription:
            '55CH, SUPPORT CRADLE HOT SERVICE',
          uom: 'EA',
          warnings: []
        }
      ],
      warnings: [],
      errors: [],
      confidencePct: 50
    });

    equal(parsed.materialLines[0].quantity, 5);
    equal(
      parsed.materialLines[0].materialDescription,
      '5CH, SUPPORT CRADLE HOT SERVICE'
    );
  });

  run('leading-zero commodity remains a string in normalization', function () {
    const parsed = normalizeParsedFmrImportResult_({
      header: {},
      materialLines: [
        {
          fmrLineNumber: '1',
          commodityCode: '002954',
          size: '2',
          quantity: '',
          materialDescription: 'PIPE TEST',
          uom: 'EA',
          warnings: []
        }
      ],
      warnings: [],
      errors: [],
      confidencePct: 50
    });

    equal(
      parsed.materialLines[0].commodityCode,
      '002954'
    );

    truthy(
      typeof parsed.materialLines[0].commodityCode ===
        'string'
    );
  });

  const passedCount = results.filter(function (item) {
    return item.status === 'PASS';
  }).length;

  const failedCount = results.filter(function (item) {
    return item.status === 'FAIL';
  }).length;

  const output = {
    passed: failedCount === 0,
    total: results.length,
    passedCount,
    failedCount,
    results
  };

  console.log(JSON.stringify(output, null, 2));

  if (!output.passed) {
    throw new Error(
      results
        .filter(function (item) {
          return item.status === 'FAIL';
        })
        .map(function (item) {
          return `${item.name}: ${item.error}`;
        })
        .join('\n')
    );
  }

  return output;
}
