//Phase4_ManualFmrRegressionTests.gs
function runManualFmrRegressionTests(spreadsheetId) {
  const results = [];
  const liveSpreadsheetId = normalizeManualFmrTestSpreadsheetId_(
    spreadsheetId
  );

  manualFmrTest_(
    results,
    'config exposes expected manual sheets',
    function () {
      const names = getManualFmrSheetNames();

      manualFmrAssertEqual_(
        names.entry,
        'FMR_Manual_Entry'
      );
      manualFmrAssertEqual_(
        names.review,
        'FMR_Manual_Review'
      );
      manualFmrAssertEqual_(
        names.batches,
        'FMR_Manual_Batches'
      );
      manualFmrAssertEqual_(
        names.canonicalHeader,
        'FMR_Header'
      );
      manualFmrAssertEqual_(
        names.canonicalLines,
        'FMR_Line_Items'
      );
    }
  );

  manualFmrTest_(
    results,
    'header definitions preserve existing canonical contracts',
    function () {
      const definitions =
        getManualFmrHeaderDefinitions();

      manualFmrAssertEqual_(
        definitions.canonicalHeader[0],
        'FMR_ID'
      );
      manualFmrAssertEqual_(
        definitions.canonicalHeader[
          definitions.canonicalHeader.length - 1
        ],
        'Notes'
      );
      manualFmrAssertEqual_(
        definitions.canonicalLines[0],
        'FMR_Line_ID'
      );
      manualFmrAssertEqual_(
        definitions.canonicalLines[
          definitions.canonicalLines.length - 1
        ],
        'Notes'
      );
      manualFmrAssertTrue_(
        definitions.entry.indexOf(
          'Validation_Errors'
        ) !== -1
      );
      manualFmrAssertTrue_(
        definitions.review.indexOf(
          'Review_Content_Hash'
        ) !== -1
      );
    }
  );

  manualFmrTest_(
    results,
    'status options contain required workflow values',
    function () {
      const options =
        getManualFmrStatusOptions();

      manualFmrAssertIncludes_(
        options.entryStatuses,
        'DRAFT'
      );
      manualFmrAssertIncludes_(
        options.entryStatuses,
        'READY_FOR_REVIEW'
      );
      manualFmrAssertIncludes_(
        options.entryStatuses,
        'APPROVED'
      );
      manualFmrAssertIncludes_(
        options.reviewDecisions,
        'RETURN_FOR_CLARIFICATION'
      );
      manualFmrAssertIncludes_(
        options.batchStatuses,
        'COMPLETED_WITH_ERRORS'
      );
    }
  );

  manualFmrTest_(
    results,
    'text normalization collapses whitespace',
    function () {
      manualFmrAssertEqual_(
        normalizeManualFmrText_(
          '  PIPE\t  SCH 10S\n '
        ),
        'PIPE SCH 10S'
      );
    }
  );

  manualFmrTest_(
    results,
    'email normalization lowercases and trims',
    function () {
      manualFmrAssertEqual_(
        normalizeManualFmrEmail_(
          '  USER@TURNER-INDUSTRIES.COM '
        ),
        'user@turner-industries.com'
      );
    }
  );

  manualFmrTest_(
    results,
    'boolean normalization recognizes supported true values',
    function () {
      manualFmrAssertTrue_(
        normalizeManualFmrBoolean_('Yes')
      );
      manualFmrAssertTrue_(
        normalizeManualFmrBoolean_('1')
      );
      manualFmrAssertFalse_(
        normalizeManualFmrBoolean_('No')
      );
    }
  );

  manualFmrTest_(
    results,
    'quantity normalization handles commas and decimals',
    function () {
      manualFmrAssertEqual_(
        normalizeManualFmrQuantity_('1,250.5'),
        1250.5
      );
    }
  );

  manualFmrTest_(
    results,
    'PIPE classifier accepts a PIPE material description',
    function () {
      manualFmrAssertTrue_(
        isManualFmrPipeStock_(
          'PIPE 4" SCH 10S'
        )
      );
    }
  );

  manualFmrTest_(
    results,
    'PIPE classifier rejects lookalike words',
    function () {
      manualFmrAssertFalse_(
        isManualFmrPipeStock_(
          'PIPET SUPPORT'
        )
      );
    }
  );

  manualFmrTest_(
    results,
    'complete entry row passes validation',
    function () {
      const result =
        validateManualFmrEntryRow(
          buildValidManualFmrTestEntry_()
        );

      manualFmrAssertTrue_(result.valid);
      manualFmrAssertEqual_(
        result.errors.length,
        0
      );
    }
  );

  manualFmrTest_(
    results,
    'missing source reference fails validation',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      row.Source_File_ID = '';
      row.Source_File_URL = '';

      const result =
        validateManualFmrEntryRow(row);

      manualFmrAssertIncludes_(
        result.errors,
        'missing_source_file_reference'
      );
    }
  );

  manualFmrTest_(
    results,
    'zero requested quantity fails validation',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      row.Qty_Requested = 0;

      const result =
        validateManualFmrEntryRow(row);

      manualFmrAssertIncludes_(
        result.errors,
        'nonpositive_quantity'
      );
    }
  );

  manualFmrTest_(
    results,
    'unsupported UOM fails validation',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      row.UOM = 'TON';

      const result =
        validateManualFmrEntryRow(row);

      manualFmrAssertIncludes_(
        result.errors,
        'invalid_uom'
      );
    }
  );

  manualFmrTest_(
    results,
    'entry defaults are applied deterministically',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      row.Revision = '';
      row.Priority = '';
      row.Craft = '';
      row.Deliver_To = '';
      row.Destination = '';
      row.Warehouse = '';
      row.UOM = '';
      row.Entry_Method = '';
      row.Entry_Status = '';

      const normalized =
        normalizeManualFmrEntryRow(row);

      manualFmrAssertEqual_(
        normalized.Revision,
        '0'
      );
      manualFmrAssertEqual_(
        normalized.Priority,
        'Routine'
      );
      manualFmrAssertEqual_(
        normalized.Craft,
        'PIPE'
      );
      manualFmrAssertEqual_(
        normalized.Deliver_To,
        'Cedric Labassiere'
      );
      manualFmrAssertEqual_(
        normalized.Destination,
        'Field'
      );
      manualFmrAssertEqual_(
        normalized.Warehouse,
        'Turner'
      );
      manualFmrAssertEqual_(
        normalized.UOM,
        'EA'
      );
      manualFmrAssertEqual_(
        normalized.Entry_Method,
        'MANUAL'
      );
      manualFmrAssertEqual_(
        normalized.Entry_Status,
        'DRAFT'
      );
    }
  );

  manualFmrTest_(
    results,
    'PIPE flag disagreement produces a warning',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      row.Material_Description =
        'PIPE 6" SCH 40';
      row.Is_Pipe = false;

      const result =
        validateManualFmrEntryRow(row);

      manualFmrAssertIncludes_(
        result.warnings,
        'pipe_flag_mismatch'
      );
    }
  );

  manualFmrTest_(
    results,
    'duplicate key is case-insensitive',
    function () {
      const first =
        buildValidManualFmrTestEntry_();
      const second =
        buildValidManualFmrTestEntry_();

      second.FMR_Number =
        first.FMR_Number.toLowerCase();
      second.Commodity_Code =
        first.Commodity_Code.toLowerCase();
      second.Size =
        first.Size.toLowerCase();

      manualFmrAssertEqual_(
        buildManualFmrDuplicateKey_(first),
        buildManualFmrDuplicateKey_(second)
      );
    }
  );

  manualFmrTest_(
    results,
    'header consistency key changes with IWP',
    function () {
      const first =
        buildValidManualFmrTestEntry_();
      const second =
        buildValidManualFmrTestEntry_();

      second.IWP_Number =
        'S1601A-4.1-999-99';

      manualFmrAssertNotEqual_(
        buildManualFmrHeaderConsistencyKey_(first),
        buildManualFmrHeaderConsistencyKey_(second)
      );
    }
  );

  manualFmrTest_(
    results,
    'entry content hash is deterministic',
    function () {
      const row =
        buildValidManualFmrTestEntry_();

      manualFmrAssertEqual_(
        hashManualFmrEntryRow_(row),
        hashManualFmrEntryRow_(row)
      );
    }
  );

  manualFmrTest_(
    results,
    'entry content hash changes with requested quantity',
    function () {
      const first =
        buildValidManualFmrTestEntry_();
      const second =
        buildValidManualFmrTestEntry_();

      second.Qty_Requested =
        Number(first.Qty_Requested) + 1;

      manualFmrAssertNotEqual_(
        hashManualFmrEntryRow_(first),
        hashManualFmrEntryRow_(second)
      );
    }
  );

  manualFmrTest_(
    results,
    'review snapshot hash is deterministic',
    function () {
      const entry =
        normalizeManualFmrEntryRow(
          buildValidManualFmrTestEntry_()
        );

      const submittedAt =
        new Date('2026-07-26T04:00:00Z');

      const first =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          submittedAt
        );

      const second =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          submittedAt
        );

      manualFmrAssertEqual_(
        first.Review_Content_Hash,
        second.Review_Content_Hash
      );
    }
  );

  manualFmrTest_(
    results,
    'review snapshot matches unchanged staging entry',
    function () {
      const entry =
        normalizeManualFmrEntryRow(
          buildValidManualFmrTestEntry_()
        );

      const review =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          new Date('2026-07-26T04:00:00Z')
        );

      manualFmrAssertTrue_(
        manualFmrReviewSnapshotMatchesEntry_(
          review,
          entry
        )
      );
    }
  );

  manualFmrTest_(
    results,
    'review snapshot rejects changed material quantity',
    function () {
      const entry =
        normalizeManualFmrEntryRow(
          buildValidManualFmrTestEntry_()
        );

      const review =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          new Date('2026-07-26T04:00:00Z')
        );

      const changed =
        Object.assign({}, entry, {
          Qty_Requested:
            Number(entry.Qty_Requested) + 1
        });

      manualFmrAssertFalse_(
        manualFmrReviewSnapshotMatchesEntry_(
          review,
          changed
        )
      );
    }
  );

  manualFmrTest_(
    results,
    'review decision normalization accepts lowercase input',
    function () {
      manualFmrAssertEqual_(
        normalizeManualFmrReviewDecision_(
          'approve'
        ),
        'APPROVE'
      );
    }
  );

  manualFmrTest_(
    results,
    'invalid review decision throws',
    function () {
      manualFmrAssertThrows_(
        function () {
          normalizeManualFmrReviewDecision_(
            'DEFER'
          );
        },
        'Invalid review decision'
      );
    }
  );

  manualFmrTest_(
    results,
    'review IDs are normalized and deduplicated',
    function () {
      const ids =
        normalizeManualFmrReviewIds_([
          ' REVIEW-1 ',
          'REVIEW-1',
          'REVIEW-2'
        ]);

      manualFmrAssertEqual_(
        ids.length,
        2
      );
      manualFmrAssertEqual_(
        ids[0],
        'REVIEW-1'
      );
    }
  );

  manualFmrTest_(
    results,
    'formula-like manual text is protected before sheet writes',
    function () {
      manualFmrAssertEqual_(
        protectManualFmrCellValue_(
          '=IMPORTXML("example")'
        ),
        '\'=IMPORTXML("example")'
      );
    }
  );

  manualFmrTest_(
    results,
    'Drive ID parser accepts a raw ID',
    function () {
      const id =
        '1PcNpcuZnvTfv065aO7d8vRXJB4ValOFL';

      manualFmrAssertEqual_(
        extractManualFmrDriveId_(id),
        id
      );
    }
  );

  manualFmrTest_(
    results,
    'Drive ID parser extracts an ID from a URL',
    function () {
      const id =
        '1PcNpcuZnvTfv065aO7d8vRXJB4ValOFL';

      manualFmrAssertEqual_(
        extractManualFmrDriveId_(
          `https://drive.google.com/drive/folders/${id}`
        ),
        id
      );
    }
  );

  manualFmrTest_(
    results,
    'status selection does not downgrade an issued FMR',
    function () {
      manualFmrAssertEqual_(
        chooseManualFmrStatusWithoutDowngrade_(
          'Issued',
          'Approved'
        ),
        'Issued'
      );
    }
  );

  manualFmrTest_(
    results,
    'status selection upgrades a draft FMR',
    function () {
      manualFmrAssertEqual_(
        chooseManualFmrStatusWithoutDowngrade_(
          'Draft',
          'Approved'
        ),
        'Approved'
      );
    }
  );

  manualFmrTest_(
    results,
    'age calculation returns whole elapsed days',
    function () {
      manualFmrAssertEqual_(
        calculateManualFmrAgeDays_(
          new Date('2026-07-20T00:00:00Z'),
          new Date('2026-07-26T12:00:00Z')
        ),
        6
      );
    }
  );

  manualFmrTest_(
    results,
    'risk flag recognizes missing required date',
    function () {
      manualFmrAssertEqual_(
        calculateManualFmrRiskFlag_(
          '',
          new Date('2026-07-26T00:00:00Z')
        ),
        'No Required Date'
      );
    }
  );

  manualFmrTest_(
    results,
    'risk flag recognizes an overdue date',
    function () {
      manualFmrAssertEqual_(
        calculateManualFmrRiskFlag_(
          new Date('2026-07-20T00:00:00Z'),
          new Date('2026-07-26T00:00:00Z')
        ),
        'Overdue'
      );
    }
  );

  manualFmrTest_(
    results,
    'active-user normalization recognizes Yes',
    function () {
      manualFmrAssertTrue_(
        normalizeManualFmrYesNo_('Yes')
      );
      manualFmrAssertFalse_(
        normalizeManualFmrYesNo_('No')
      );
    }
  );

  manualFmrTest_(
    results,
    'reviewer cannot review their own staging row',
    function () {
      const entry =
        buildValidManualFmrTestEntry_();

      entry.Entered_By =
        'same@example.com';

      const review =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          new Date('2026-07-26T04:00:00Z')
        );

      manualFmrAssertThrows_(
        function () {
          assertManualFmrSeparationOfDuties_(
            entry,
            review,
            {
              Email: 'same@example.com'
            }
          );
        },
        'cannot approve, return, or reject'
      );
    }
  );

  manualFmrTest_(
    results,
    'different reviewer passes separation of duties',
    function () {
      const entry =
        buildValidManualFmrTestEntry_();

      entry.Entered_By =
        'entry@example.com';

      const review =
        buildManualFmrReviewSnapshot_(
          entry,
          'submitter@example.com',
          new Date('2026-07-26T04:00:00Z')
        );

      manualFmrAssertTrue_(
        assertManualFmrSeparationOfDuties_(
          entry,
          review,
          {
            Email: 'reviewer@example.com'
          }
        )
      );
    }
  );

  manualFmrTest_(
    results,
    'batch normalization applies defaults and numeric counters',
    function () {
      const batch =
        normalizeManualFmrBatchRecord_({
          Batch_ID: ' BATCH-1 ',
          Batch_Name: ' Test Batch ',
          Assigned_Entry_User_1:
            'USER@EXAMPLE.COM',
          Batch_Status: '',
          Expected_FMR_Count: '3',
          Expected_Line_Count: '12'
        });

      manualFmrAssertEqual_(
        batch.Batch_ID,
        'BATCH-1'
      );
      manualFmrAssertEqual_(
        batch.Assigned_Entry_User_1,
        'user@example.com'
      );
      manualFmrAssertEqual_(
        batch.Batch_Status,
        'OPEN'
      );
      manualFmrAssertEqual_(
        batch.Expected_FMR_Count,
        3
      );
      manualFmrAssertEqual_(
        batch.Expected_Line_Count,
        12
      );
    }
  );

  manualFmrTest_(
    results,
    'negative whole-number input throws',
    function () {
      manualFmrAssertThrows_(
        function () {
          normalizeManualFmrWholeNumber_(
            -1,
            0
          );
        },
        'nonnegative whole number'
      );
    }
  );

  manualFmrTest_(
    results,
    'audit serialization preserves strings and objects',
    function () {
      manualFmrAssertEqual_(
        serializeManualFmrAuditValue_(
          'APPROVE'
        ),
        'APPROVE'
      );

      manualFmrAssertEqual_(
        serializeManualFmrAuditValue_({
          decision: 'APPROVE'
        }),
        '{"decision":"APPROVE"}'
      );
    }
  );

  manualFmrLiveTest_(
    results,
    liveSpreadsheetId,
    'live canonical FMR contracts are valid',
    function (id) {
      const spreadsheet =
        SpreadsheetApp.openById(id);

      manualFmrAssertTrue_(
        validateManualFmrCanonicalContracts_(
          spreadsheet
        )
      );
    }
  );

  manualFmrLiveTest_(
    results,
    liveSpreadsheetId,
    'live review support contracts are valid',
    function (id) {
      const spreadsheet =
        SpreadsheetApp.openById(id);

      manualFmrAssertTrue_(
        validateManualFmrReviewSupportContracts_(
          spreadsheet
        )
      );
    }
  );

  manualFmrLiveTest_(
    results,
    liveSpreadsheetId,
    'live manual intake foundation is valid when installed',
    function (id) {
      const result =
        validateManualFmrIntakeFoundation(
          id
        );

      if (
        result.missingSheets.indexOf(
          'FMR_Manual_Entry'
        ) !== -1 ||
        result.missingSheets.indexOf(
          'FMR_Manual_Review'
        ) !== -1 ||
        result.missingSheets.indexOf(
          'FMR_Manual_Batches'
        ) !== -1
      ) {
        throw new ManualFmrTestSkip_(
          'Manual intake sheets have not been created yet.'
        );
      }

      manualFmrAssertTrue_(result.valid);
    }
  );

  const passedCount =
    results.filter(function (result) {
      return result.status === 'PASS';
    }).length;

  const failedCount =
    results.filter(function (result) {
      return result.status === 'FAIL';
    }).length;

  const skippedCount =
    results.filter(function (result) {
      return result.status === 'SKIP';
    }).length;

  return {
    passed: failedCount === 0,
    total: results.length,
    passedCount,
    failedCount,
    skippedCount,
    results
  };
}

/**
 * Editor-friendly wrapper. Run this function directly inside FMRCore.
 * It logs the complete test result and performs no workbook writes.
 *
 * @return {Object}
 */
function runManualFmrRegressionTestsAndLog() {
  const result = runManualFmrRegressionTests();

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

/* ========================================================================== */
/* TEST FIXTURE                                                               */
/* ========================================================================== */

function buildValidManualFmrTestEntry_() {
  return {
    Entry_Row_ID:
      'FMRENTRY-TEST-0001',
    Batch_ID:
      'FMRBATCH-TEST-0001',
    Source_Document_Type:
      'FMR',
    Source_File_ID:
      '1PcNpcuZnvTfv065aO7d8vRXJB4ValOFL',
    Source_File_Name:
      'FMR-TEST-0001.pdf',
    Source_File_URL:
      'https://drive.google.com/file/d/1PcNpcuZnvTfv065aO7d8vRXJB4ValOFL/view',
    FMR_Number:
      'FMR-2026-TEST-0001',
    Revision:
      '0',
    IWP_Number:
      'S1601A-4.1-001-01',
    Request_Date:
      new Date('2026-07-25T12:00:00Z'),
    Date_Required:
      new Date('2026-08-01T12:00:00Z'),
    Requested_By:
      'Brandon Whitten',
    Requested_By_Email:
      'brandon@example.com',
    Craft:
      'PIPE',
    Deliver_To:
      'Cedric Labassiere',
    Destination:
      'Field',
    Warehouse:
      'Turner',
    Priority:
      'Routine',
    ISO_Line_Number:
      'FG-70912_001',
    ISO_Sheet:
      '3',
    ISO_Drawing_Number:
      'LP131-TEST-0001',
    FMR_Line_Number:
      '1',
    Commodity_Code:
      'GSWAZ1DZZASG5501',
    Size:
      '4"',
    Material_Description:
      'PIPE 4" SCH 10S',
    UOM:
      'EA',
    Qty_Requested:
      2,
    Is_Pipe:
      true,
    Entry_Method:
      'MANUAL',
    Entry_Status:
      'READY_FOR_REVIEW',
    Entered_By:
      'entry@example.com',
    Entered_At:
      new Date('2026-07-25T13:00:00Z'),
    Reviewer_Email:
      'reviewer@example.com',
    Reviewed_At:
      '',
    Review_Notes:
      '',
    Validation_Errors:
      '',
    Row_Content_Hash:
      ''
  };
}

/* ========================================================================== */
/* TEST HARNESS                                                               */
/* ========================================================================== */

function manualFmrTest_(
  results,
  name,
  callback
) {
  const started = new Date();

  try {
    callback();

    results.push({
      name,
      status: 'PASS',
      durationMs:
        new Date().getTime() -
        started.getTime()
    });
  } catch (error) {
    if (
      error &&
      error.name ===
        'ManualFmrTestSkip'
    ) {
      results.push({
        name,
        status: 'SKIP',
        message:
          error.message || 'Skipped',
        durationMs:
          new Date().getTime() -
          started.getTime()
      });
      return;
    }

    results.push({
      name,
      status: 'FAIL',
      message:
        error && error.message
          ? error.message
          : String(error),
      stack:
        error && error.stack
          ? error.stack
          : '',
      durationMs:
        new Date().getTime() -
        started.getTime()
    });
  }
}

function manualFmrLiveTest_(
  results,
  spreadsheetId,
  name,
  callback
) {
  if (!spreadsheetId) {
    results.push({
      name,
      status: 'SKIP',
      message:
        'No spreadsheet ID or URL supplied.'
    });
    return;
  }

  manualFmrTest_(
    results,
    name,
    function () {
      callback(spreadsheetId);
    }
  );
}

function ManualFmrTestSkip_(message) {
  this.name = 'ManualFmrTestSkip';
  this.message =
    message || 'Skipped';
}

ManualFmrTestSkip_.prototype =
  Object.create(Error.prototype);

ManualFmrTestSkip_.prototype.constructor =
  ManualFmrTestSkip_;

function manualFmrAssertTrue_(value) {
  if (value !== true) {
    throw new Error(
      `Expected true, received ${JSON.stringify(value)}.`
    );
  }
}

function manualFmrAssertFalse_(value) {
  if (value !== false) {
    throw new Error(
      `Expected false, received ${JSON.stringify(value)}.`
    );
  }
}

function manualFmrAssertEqual_(
  actual,
  expected
) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, ` +
      `received ${JSON.stringify(actual)}.`
    );
  }
}

function manualFmrAssertNotEqual_(
  actual,
  expected
) {
  if (actual === expected) {
    throw new Error(
      `Expected values to differ, but both were ` +
      `${JSON.stringify(actual)}.`
    );
  }
}

function manualFmrAssertIncludes_(
  values,
  expected
) {
  if (
    !Array.isArray(values) ||
    values.indexOf(expected) === -1
  ) {
    throw new Error(
      `Expected ${JSON.stringify(values)} to include ` +
      `${JSON.stringify(expected)}.`
    );
  }
}

function manualFmrAssertThrows_(
  callback,
  expectedMessage
) {
  let thrown = null;

  try {
    callback();
  } catch (error) {
    thrown = error;
  }

  if (!thrown) {
    throw new Error(
      'Expected the function to throw.'
    );
  }

  if (
    expectedMessage &&
    String(
      thrown.message || thrown
    ).indexOf(expectedMessage) === -1
  ) {
    throw new Error(
      `Expected error message to contain ` +
      `"${expectedMessage}", received ` +
      `"${thrown.message || thrown}".`
    );
  }
}

function normalizeManualFmrTestSpreadsheetId_(
  spreadsheetId
) {
  const value =
    String(spreadsheetId || '')
      .trim();

  if (!value) {
    return '';
  }

  return normalizeManualFmrSpreadsheetId_(
    value
  );
}
function diagnoseManualFmrIntakeServiceAndLog() {
  const checks = {
    buildManualFmrReviewSnapshot_:
      typeof buildManualFmrReviewSnapshot_,

    protectManualFmrCellValue_:
      typeof protectManualFmrCellValue_,

    extractManualFmrDriveId_:
      typeof extractManualFmrDriveId_,

    normalizeManualFmrBatchRecord_:
      typeof normalizeManualFmrBatchRecord_,

    normalizeManualFmrWholeNumber_:
      typeof normalizeManualFmrWholeNumber_
  };

  console.log(
    JSON.stringify(checks, null, 2)
  );

  const missing = Object.keys(checks).filter(
    function (name) {
      return checks[name] !== 'function';
    }
  );

  if (missing.length > 0) {
    throw new Error(
      'Missing Manual FMR Intake Service functions: ' +
      missing.join(', ')
    );
  }

  return checks;
}