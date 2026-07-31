/**
 * Phase4_ManualFmrAdapter.gs
 *
 * Bound-spreadsheet UI adapter for the FMRCore manual FMR intake workflow.
 *
 * THIS FILE BELONGS IN THE SPREADSHEET-BOUND APPS SCRIPT PROJECT.
 *
 * It must NOT be added to FMRCore.
 *
 * DEPENDS ON PUBLIC FMRCORE FUNCTIONS
 * -----------------------------------
 * Configuration / setup / diagnostics:
 * - getManualFmrConfig
 * - getManualFmrSheetNames
 * - getManualFmrHeaderDefinitions
 * - getManualFmrStatusOptions
 * - setupManualFmrIntakeSheets
 * - refreshManualFmrIntakeFormatting
 * - validateManualFmrIntakeFoundation
 * - getManualFmrIntakeSheetStatus
 * - getManualFmrIntakeServiceVersion
 * - getManualFmrReviewServiceVersion
 * - runManualFmrRegressionTests
 *
 * Intake / review reads:
 * - getManualFmrBatchSummary
 * - refreshManualFmrBatchMetrics
 * - getManualFmrReviewQueue
 *
 * Guardrail service:
 * - getManualFmrGuardrailVersion
 * - getManualFmrPermissionMatrix
 * - runManualFmrPreflight
 * - applyManualFmrSheetProtections
 * - getManualFmrProtectionStatus
 * - previewManualFmrApprovals
 * - createAuthorizedManualFmrBatch
 * - createAuthorizedManualFmrDraft
 * - validateAuthorizedManualFmrBatch
 * - submitAuthorizedManualFmrBatchForReview
 * - approveAuthorizedManualFmrReviews
 * - returnAuthorizedManualFmrReviewsForClarification
 * - rejectAuthorizedManualFmrReviews
 */

const PHASE4_MANUAL_ADAPTER = Object.freeze({
  menuName: 'Manual FMR Intake',

  sheets: Object.freeze({
    entry: 'FMR_Manual_Entry',
    review: 'FMR_Manual_Review',
    batches: 'FMR_Manual_Batches'
  }),

  requiredCoreFunctions: Object.freeze([
    'getManualFmrConfig',
    'getManualFmrSheetNames',
    'getManualFmrHeaderDefinitions',
    'getManualFmrStatusOptions',
    'setupManualFmrIntakeSheets',
    'refreshManualFmrIntakeFormatting',
    'validateManualFmrIntakeFoundation',
    'getManualFmrIntakeSheetStatus',
    'getManualFmrIntakeServiceVersion',
    'getManualFmrBatchSummary',
    'refreshManualFmrBatchMetrics',
    'getManualFmrReviewServiceVersion',
    'getManualFmrReviewQueue',
    'runManualFmrRegressionTests',
    'getManualFmrGuardrailVersion',
    'getManualFmrPermissionMatrix',
    'runManualFmrPreflight',
    'applyManualFmrSheetProtections',
    'getManualFmrProtectionStatus',
    'previewManualFmrApprovals',
    'createAuthorizedManualFmrBatch',
    'createAuthorizedManualFmrDraft',
    'validateAuthorizedManualFmrBatch',
    'submitAuthorizedManualFmrBatchForReview',
    'approveAuthorizedManualFmrReviews',
    'returnAuthorizedManualFmrReviewsForClarification',
    'rejectAuthorizedManualFmrReviews'
  ])
});

/* ========================================================================== */
/* MENU                                                                       */
/* ========================================================================== */

/**
 * Call this from the bound project's existing onOpen().
 *
 * @param {GoogleAppsScript.Base.Ui=} ui
 */
function addPhase4ManualFmrMenu_(ui) {
  const targetUi = ui || SpreadsheetApp.getUi();

  targetUi
    .createMenu(PHASE4_MANUAL_ADAPTER.menuName)
    .addItem('1. Verify FMRCore Contract', 'phase4ManualVerifyCoreContract')
    .addItem('2. Setup Manual Intake Sheets', 'phase4ManualSetupSheets')
    .addItem('3. Run Live Regression Tests', 'phase4ManualRunLiveRegressionTests')
    .addSeparator()
    .addItem('4. Run Guardrail Preflight', 'phase4ManualRunPreflight')
    .addItem('5. Apply System Column Protections', 'phase4ManualApplyProtections')
    .addItem('6. Show Protection Status', 'phase4ManualShowProtectionStatus')
    .addSeparator()
    .addItem('7. Create Entry Batch', 'phase4ManualCreateBatch')
    .addItem('8. Create FMR Draft Rows', 'phase4ManualCreateDraft')
    .addItem('9. Validate Batch', 'phase4ManualValidateBatch')
    .addItem('10. Submit Batch for Review', 'phase4ManualSubmitBatchForReview')
    .addSeparator()
    .addItem('11. Show My Review Queue', 'phase4ManualShowReviewQueue')
    .addItem('12. Preview Selected Approvals', 'phase4ManualPreviewSelectedApprovals')
    .addItem('13. Approve Selected Review Rows', 'phase4ManualApproveSelectedReviews')
    .addItem('14. Return Selected Rows for Clarification', 'phase4ManualReturnSelectedReviews')
    .addItem('15. Reject Selected Review Rows', 'phase4ManualRejectSelectedReviews')
    .addSeparator()
    .addItem('16. Show Intake Status', 'phase4ManualShowStatus')
    .addItem('17. Refresh Batch Metrics', 'phase4ManualRefreshBatchMetrics')
    .addItem('18. Refresh Sheet Formatting', 'phase4ManualRefreshFormatting')
    .addToUi();
}

/* ========================================================================== */
/* CONTRACT + SETUP                                                           */
/* ========================================================================== */

function phase4ManualVerifyCoreContract() {
  phase4ManualRunUiAction_(
    'Verify FMRCore Contract',
    function () {
      const report = phase4ManualGetCoreContractReport_();

      if (!report.valid) {
        throw new Error(
          'The bound project is missing these FMRCore functions:\n\n' +
          report.missing.join('\n')
        );
      }

      const intakeVersion = FMRCore.getManualFmrIntakeServiceVersion();
      const reviewVersion = FMRCore.getManualFmrReviewServiceVersion();
      const guardrailVersion = FMRCore.getManualFmrGuardrailVersion();

      return {
        title: 'FMRCore contract verified',
        message: [
          'All required public functions are available.',
          '',
          `Schema: ${intakeVersion.schemaVersion}`,
          `Intake: ${intakeVersion.component}`,
          `Review: ${reviewVersion.component}`,
          `Guardrails: ${guardrailVersion.component}`
        ].join('\n')
      };
    }
  );
}

function phase4ManualSetupSheets() {
  phase4ManualRunUiAction_(
    'Setup Manual Intake Sheets',
    function () {
      const spreadsheetId = SpreadsheetApp.getActive().getId();
      const callerEmail = phase4ManualCallerEmail_();

      phase4ManualAssertSetupRole_(spreadsheetId, callerEmail);

      const result = FMRCore.setupManualFmrIntakeSheets(spreadsheetId);

      phase4ManualActivateSheet_(PHASE4_MANUAL_ADAPTER.sheets.batches);

      return {
        title: 'Manual intake sheets ready',
        message: [
          `Created or verified: ${result.batches}`,
          `Created or verified: ${result.entry}`,
          `Created or verified: ${result.review}`,
          '',
          `Canonical header: ${result.canonicalHeader}`,
          `Canonical lines: ${result.canonicalLines}`
        ].join('\n')
      };
    }
  );
}

function phase4ManualRunLiveRegressionTests() {
  phase4ManualRunUiAction_(
    'Run Live Regression Tests',
    function () {
      const spreadsheetId =
        SpreadsheetApp.getActive().getId();

      const result =
        FMRCore.runManualFmrRegressionTests(
          spreadsheetId
        );

      console.log(
        JSON.stringify(result, null, 2)
      );

      if (!result.passed) {
        const failures =
          result.results
            .filter(function (test) {
              return test.status === 'FAIL';
            })
            .map(function (test) {
              return (
                `${test.name}: ` +
                `${test.message || 'Failed'}`
              );
            });

        throw new Error(
          [
            `${result.failedCount} regression test(s) failed.`,
            '',
            failures.join('\n')
          ].join('\n')
        );
      }

      return {
        title: 'Live regression tests passed',
        message: [
          `Total: ${result.total}`,
          `Passed: ${result.passedCount}`,
          `Failed: ${result.failedCount}`,
          `Skipped: ${result.skippedCount}`
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* GUARDRAIL PREFLIGHT + PROTECTIONS                                          */
/* ========================================================================== */

function phase4ManualRunPreflight() {
  phase4ManualRunUiAction_(
    'Run Guardrail Preflight',
    function () {
      const ui = SpreadsheetApp.getUi();
      const spreadsheetId = SpreadsheetApp.getActive().getId();
      const callerEmail = phase4ManualCallerEmail_();

      const action = phase4ManualPromptWithDefault_(
        ui,
        'Run Guardrail Preflight',
        [
          'Enter the action to test:',
          '',
          'SETUP',
          'CREATE_BATCH',
          'DATA_ENTRY',
          'VALIDATE_BATCH',
          'SUBMIT_BATCH',
          'REVIEW',
          'APPLY_PROTECTIONS'
        ].join('\n'),
        phase4ManualDefaultPreflightAction_()
      );

      if (action === null) {
        return null;
      }

      const normalizedAction = action.trim().toUpperCase();
      const options = { action: normalizedAction };

      if (['DATA_ENTRY', 'VALIDATE_BATCH', 'SUBMIT_BATCH'].indexOf(normalizedAction) !== -1) {
        const batchId = phase4ManualResolveBatchId_(ui, 'Run Guardrail Preflight');
        if (batchId === null) {
          return null;
        }
        options.batchId = batchId;
        const summary = FMRCore.getManualFmrBatchSummary(spreadsheetId, batchId);
        options.reviewerEmail = summary.batch.Assigned_Reviewer || '';
      } else if (normalizedAction === 'REVIEW') {
        const reviewIds = phase4ManualResolveSelectedReviewIds_(ui, 'Run Guardrail Preflight');
        if (reviewIds === null) {
          return null;
        }
        options.reviewIds = reviewIds;
      } else if (normalizedAction === 'CREATE_BATCH') {
        const reviewerEmail = phase4ManualPromptOptional_(
          ui,
          'Run Guardrail Preflight',
          'Enter the planned reviewer email to validate it now.\n\nLeave blank to check only the batch creator.'
        );
        if (reviewerEmail === null) {
          return null;
        }
        options.reviewerEmail = reviewerEmail;
      }

      const report = FMRCore.runManualFmrPreflight(
        spreadsheetId,
        callerEmail,
        options
      );

      console.log(JSON.stringify(report, null, 2));

      return {
        title: report.passed
          ? 'Manual FMR preflight passed'
          : 'Manual FMR preflight found issues',
        message: phase4ManualFormatPreflightReport_(report)
      };
    }
  );
}

function phase4ManualApplyProtections() {
  phase4ManualRunUiAction_(
    'Apply System Column Protections',
    function () {
      const result = FMRCore.applyManualFmrSheetProtections(
        SpreadsheetApp.getActive().getId(),
        phase4ManualCallerEmail_()
      );

      const details = result.sheets.map(function (sheet) {
        return `${sheet.sheetName}: ${sheet.protectedColumns.length} protected, ${sheet.hiddenColumns.length} hidden`;
      });

      return {
        title: 'Manual FMR protections applied',
        message: [
          `Applied by: ${result.appliedBy}`,
          `Warning-only: ${result.warningOnly ? 'Yes' : 'No'}`,
          '',
          details.join('\n')
        ].join('\n')
      };
    }
  );
}

function phase4ManualShowProtectionStatus() {
  phase4ManualRunUiAction_(
    'Show Protection Status',
    function () {
      const result = FMRCore.getManualFmrProtectionStatus(
        SpreadsheetApp.getActive().getId()
      );

      const details = result.sheets.map(function (sheet) {
        return [
          `${sheet.sheetName}:`,
          sheet.exists
            ? `${sheet.activeProtections}/${sheet.expectedProtections} protections`
            : 'sheet missing',
          sheet.complete ? 'PASS' : 'INCOMPLETE'
        ].join(' ');
      });

      return {
        title: result.complete
          ? 'Protection status: complete'
          : 'Protection status: incomplete',
        message: [
          `Overall complete: ${result.complete ? 'Yes' : 'No'}`,
          `Warning-only: ${result.warningOnly ? 'Yes' : 'No'}`,
          '',
          details.join('\n')
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* BATCH CREATION                                                             */
/* ========================================================================== */

function phase4ManualCreateBatch() {
  phase4ManualRunUiAction_(
    'Create Entry Batch',
    function () {
      const ui = SpreadsheetApp.getUi();
      const callerEmail = phase4ManualCallerEmail_();

      const batchName = phase4ManualPromptRequired_(
        ui,
        'Create Entry Batch',
        'Enter a batch name, such as "Area 100 FMR Backlog":'
      );
      if (batchName === null) return null;

      const sourceFolder = phase4ManualPromptOptional_(
        ui,
        'Create Entry Batch',
        'Enter the Google Drive source-folder URL or ID.\n\nLeave blank when the batch does not use one shared folder.'
      );
      if (sourceFolder === null) return null;

      const primaryEntryUser = phase4ManualPromptRequired_(
        ui,
        'Create Entry Batch',
        'Enter the primary data-entry user email:'
      );
      if (primaryEntryUser === null) return null;

      const secondEntryUser = phase4ManualPromptOptional_(
        ui,
        'Create Entry Batch',
        'Enter the second data-entry user email.\n\nLeave blank when only one person is entering this batch.'
      );
      if (secondEntryUser === null) return null;

      const reviewerEmail = phase4ManualPromptRequired_(
        ui,
        'Create Entry Batch',
        'Enter the reviewer email.\n\nThe reviewer must be different from both data-entry users.'
      );
      if (reviewerEmail === null) return null;

      const primary = primaryEntryUser.trim().toLowerCase();
      const second = secondEntryUser.trim().toLowerCase();
      const reviewer = reviewerEmail.trim().toLowerCase();

      if (reviewer === primary || (second && reviewer === second)) {
        throw new Error(
          'The reviewer must be different from both assigned data-entry users.'
        );
      }

      const expectedFmrCountText = phase4ManualPromptOptional_(
        ui,
        'Create Entry Batch',
        'Expected number of FMR documents.\n\nLeave blank if unknown.'
      );
      if (expectedFmrCountText === null) return null;

      const expectedLineCountText = phase4ManualPromptOptional_(
        ui,
        'Create Entry Batch',
        'Expected number of material lines.\n\nLeave blank if unknown.'
      );
      if (expectedLineCountText === null) return null;

      const spreadsheetId = SpreadsheetApp.getActive().getId();

      const preflight = FMRCore.runManualFmrPreflight(
        spreadsheetId,
        callerEmail,
        {
          action: 'CREATE_BATCH',
          reviewerEmail
        }
      );

      if (!preflight.passed) {
        throw new Error(phase4ManualFormatPreflightReport_(preflight));
      }

      const result = FMRCore.createAuthorizedManualFmrBatch(
        spreadsheetId,
        callerEmail,
        {
          batchName,
          sourceFolderId: sourceFolder,
          sourceFolderUrl: /^https?:\/\//i.test(sourceFolder) ? sourceFolder : '',
          assignedEntryUser1: primaryEntryUser,
          assignedEntryUser2: secondEntryUser,
          assignedReviewer: reviewerEmail,
          expectedFmrCount: phase4ManualParseOptionalWholeNumber_(expectedFmrCountText),
          expectedLineCount: phase4ManualParseOptionalWholeNumber_(expectedLineCountText),
          notes: `Created from the Manual FMR Intake menu by ${callerEmail}.`
        }
      );

      phase4ManualActivateBatchRow_(result.Batch_ID);

      return {
        title: 'Entry batch created',
        message: [
          `Batch ID: ${result.Batch_ID}`,
          `Batch name: ${result.Batch_Name}`,
          `Primary entry user: ${result.Assigned_Entry_User_1}`,
          `Second entry user: ${result.Assigned_Entry_User_2 || '(none)'}`,
          `Reviewer: ${result.Assigned_Reviewer}`,
          `Created by: ${result.Created_By}`,
          `Status: ${result.Batch_Status}`
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* DRAFT CREATION                                                             */
/* ========================================================================== */

function phase4ManualCreateDraft() {
  phase4ManualRunUiAction_(
    'Create FMR Draft Rows',
    function () {
      const ui = SpreadsheetApp.getUi();
      const callerEmail =
        phase4ManualCallerEmail_();

      const batchId =
        phase4ManualResolveBatchId_(
          ui,
          'Create FMR Draft Rows'
        );

      if (batchId === null) {
        return null;
      }

      const sourceReference =
        phase4ManualPromptRequired_(
          ui,
          'Create FMR Draft Rows',
          'Enter the source FMR Google Drive file URL or file ID:'
        );

      if (sourceReference === null) {
        return null;
      }

      const sourceFileName =
        phase4ManualPromptOptional_(
          ui,
          'Create FMR Draft Rows',
          'Enter the source FMR filename.\n\nExample: FMR-2026-00123.pdf'
        );

      if (sourceFileName === null) {
        return null;
      }

      const fmrNumber =
        phase4ManualPromptRequired_(
          ui,
          'Create FMR Draft Rows',
          'Enter the FMR number exactly as shown on the source document:'
        );

      if (fmrNumber === null) {
        return null;
      }

      const revision =
        phase4ManualPromptWithDefault_(
          ui,
          'Create FMR Draft Rows',
          'Enter the FMR revision:',
          '0'
        );

      if (revision === null) {
        return null;
      }

      const iwpNumber =
        phase4ManualPromptRequired_(
          ui,
          'Create FMR Draft Rows',
          'Enter the IWP number:'
        );

      if (iwpNumber === null) {
        return null;
      }

      const requestedBy =
        phase4ManualPromptRequired_(
          ui,
          'Create FMR Draft Rows',
          'Enter the person shown in REQUESTED BY:'
        );

      if (requestedBy === null) {
        return null;
      }

      const requestedByEmail =
        phase4ManualPromptOptional_(
          ui,
          'Create FMR Draft Rows',
          'Enter the requester email.\n\nLeave blank if it is not available.'
        );

      if (requestedByEmail === null) {
        return null;
      }

      const lineCountText =
        phase4ManualPromptRequired_(
          ui,
          'Create FMR Draft Rows',
          'How many material lines are on this FMR?'
        );

      if (lineCountText === null) {
        return null;
      }

      const lineCount =
        phase4ManualParseRequiredWholeNumber_(
          lineCountText,
          1,
          1000,
          'Material-line count'
        );

      const requiredDateText =
        phase4ManualPromptOptional_(
          ui,
          'Create FMR Draft Rows',
          'Enter the required date as YYYY-MM-DD.\n\nLeave blank when the FMR has no required date.'
        );

      if (requiredDateText === null) {
        return null;
      }

      const sourceIsUrl =
        /^https?:\/\//i.test(sourceReference);

      const result =
        FMRCore.createAuthorizedManualFmrDraft(
          SpreadsheetApp.getActive().getId(),
          callerEmail,
          {
            batchId,
            sourceFileId:
              sourceIsUrl
                ? ''
                : sourceReference,
            sourceFileUrl:
              sourceIsUrl
                ? sourceReference
                : '',
            sourceFileName,
            fmrNumber,
            revision,
            iwpNumber,
            requestedBy,
            requestedByEmail,
            lineCount,
            dateRequired:
              phase4ManualParseOptionalDate_(
                requiredDateText
              )
          }
        );

      phase4ManualActivateNewestEntryRows_(
        result.rowsCreated
      );

      return {
        title: 'FMR draft rows created',
        message: [
          `Batch ID: ${result.batchId}`,
          `FMR: ${result.fmrNumber}`,
          `Revision: ${result.revision}`,
          `Rows created: ${result.rowsCreated}`,
          '',
          'Complete the material columns in FMR_Manual_Entry before validation.'
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* VALIDATION + SUBMISSION                                                    */
/* ========================================================================== */

function phase4ManualValidateBatch() {
  phase4ManualRunUiAction_(
    'Validate Batch',
    function () {
      const ui = SpreadsheetApp.getUi();
      const batchId =
        phase4ManualResolveBatchId_(
          ui,
          'Validate Batch'
        );

      if (batchId === null) {
        return null;
      }

      const result =
        FMRCore.validateAuthorizedManualFmrBatch(
          SpreadsheetApp.getActive().getId(),
          phase4ManualCallerEmail_(),
          batchId
        );

      phase4ManualActivateBatchEntryRows_(
        batchId
      );

      return {
        title:
          result.invalidRows === 0
            ? 'Batch validation passed'
            : 'Batch validation completed',
        message: [
          `Batch ID: ${result.batchId}`,
          `Total rows: ${result.totalRows}`,
          `Active rows: ${result.activeRows}`,
          `Valid rows: ${result.validRows}`,
          `Invalid rows: ${result.invalidRows}`,
          `Inactive rows: ${result.inactiveRows}`,
          '',
          result.invalidRows === 0
            ? 'The active rows are ready to submit for review.'
            : 'Correct the rows highlighted in Validation_Errors, then validate again.'
        ].join('\n')
      };
    }
  );
}

function phase4ManualSubmitBatchForReview() {
  phase4ManualRunUiAction_(
    'Submit Batch for Review',
    function () {
      const ui = SpreadsheetApp.getUi();
      const batchId =
        phase4ManualResolveBatchId_(
          ui,
          'Submit Batch for Review'
        );

      if (batchId === null) {
        return null;
      }

      const confirmation = ui.alert(
        'Submit Batch for Review',
        [
          `Submit batch "${batchId}" for reviewer action?`,
          '',
          'Valid rows will enter the review queue.',
          'Invalid rows will be returned to NEEDS_CLARIFICATION.'
        ].join('\n'),
        ui.ButtonSet.YES_NO
      );

      if (confirmation !== ui.Button.YES) {
        return null;
      }

      const result =
        FMRCore.submitAuthorizedManualFmrBatchForReview(
          SpreadsheetApp.getActive().getId(),
          phase4ManualCallerEmail_(),
          batchId
        );

      phase4ManualActivateSheet_(
        PHASE4_MANUAL_ADAPTER.sheets.review
      );

      return {
        title: 'Review submission completed',
        message: [
          `Batch ID: ${result.batchId}`,
          `Rows considered: ${result.rowsConsidered}`,
          `Submitted: ${result.submittedRows}`,
          `Already submitted: ${result.alreadySubmittedRows}`,
          `Needs clarification: ${result.clarificationRows}`,
          `Skipped inactive: ${result.skippedInactiveRows}`
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* REVIEW QUEUE                                                               */
/* ========================================================================== */

function phase4ManualShowReviewQueue() {
  phase4ManualRunUiAction_(
    'Show My Review Queue',
    function () {
      const result =
        FMRCore.getManualFmrReviewQueue(
          SpreadsheetApp.getActive().getId(),
          phase4ManualCallerEmail_(),
          {
            includeProcessed: false,
            maximumRows: 250
          }
        );

      phase4ManualActivateSheet_(
        PHASE4_MANUAL_ADAPTER.sheets.review
      );

      const preview =
        result.rows
          .slice(0, 10)
          .map(function (row) {
            return [
              row.Review_ID,
              row.FMR_Number,
              `Line ${row.FMR_Line_Number}`,
              row.Commodity_Code,
              `${row.Qty_Requested} ${row.UOM}`
            ].join(' | ');
          });

      return {
        title: 'Review queue',
        message: [
          `Reviewer: ${result.reviewer.displayName}`,
          `Role: ${result.reviewer.role}`,
          `Pending rows returned: ${result.totalReturned}`,
          '',
          preview.length
            ? preview.join('\n')
            : 'No pending reviews are currently assigned.'
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* APPROVAL PREVIEW                                                           */
/* ========================================================================== */

function phase4ManualPreviewSelectedApprovals() {
  phase4ManualRunUiAction_(
    'Preview Selected Approvals',
    function () {
      const ui = SpreadsheetApp.getUi();
      const reviewIds = phase4ManualResolveSelectedReviewIds_(
        ui,
        'Preview Selected Approvals'
      );

      if (reviewIds === null) {
        return null;
      }

      const result = FMRCore.previewManualFmrApprovals(
        SpreadsheetApp.getActive().getId(),
        phase4ManualCallerEmail_(),
        reviewIds
      );

      console.log(JSON.stringify(result, null, 2));

      const rows = result.rows.slice(0, 8).map(function (row) {
        return [
          row.reviewId,
          row.status,
          row.actions && row.actions.length
            ? row.actions.join(', ')
            : '(no actions)'
        ].join(' | ');
      });

      const issues = result.issues.slice(0, 10).map(function (issue) {
        return `- ${issue}`;
      });

      return {
        title: result.passed
          ? 'Approval preview passed'
          : 'Approval preview blocked',
        message: [
          `Requested reviews: ${result.requestedReviews}`,
          `Approvable: ${result.approvableReviews}`,
          `Blocked: ${result.blockedReviews}`,
          `Already processed: ${result.alreadyProcessedReviews}`,
          '',
          `FMR headers to create: ${result.canonicalFmrsToCreate}`,
          `FMR headers to reuse: ${result.canonicalFmrsToReuse}`,
          `Canonical lines to create: ${result.canonicalLinesToCreate}`,
          `Canonical lines to reuse: ${result.canonicalLinesToReuse}`,
          `IWPs to create: ${result.iwpsToCreate}`,
          `ISO references to create: ${result.isosToCreate}`,
          '',
          rows.length ? rows.join('\n') : 'No review rows were previewed.',
          '',
          issues.length ? `Issues:\n${issues.join('\n')}` : 'Issues: none',
          '',
          'This preview did not write any records.'
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* REVIEW ACTIONS                                                             */
/* ========================================================================== */

function phase4ManualApproveSelectedReviews() {
  phase4ManualRunReviewDecision_(
    'APPROVE'
  );
}

function phase4ManualReturnSelectedReviews() {
  phase4ManualRunReviewDecision_(
    'RETURN_FOR_CLARIFICATION'
  );
}

function phase4ManualRejectSelectedReviews() {
  phase4ManualRunReviewDecision_(
    'REJECT'
  );
}

function phase4ManualRunReviewDecision_(
  decision
) {
  const title =
    decision === 'APPROVE'
      ? 'Approve Selected Review Rows'
      : decision === 'RETURN_FOR_CLARIFICATION'
        ? 'Return Selected Rows for Clarification'
        : 'Reject Selected Review Rows';

  phase4ManualRunUiAction_(
    title,
    function () {
      const ui = SpreadsheetApp.getUi();
      const reviewIds = phase4ManualResolveSelectedReviewIds_(ui, title);

      if (reviewIds === null) {
        return null;
      }

      const spreadsheetId = SpreadsheetApp.getActive().getId();
      const callerEmail = phase4ManualCallerEmail_();

      if (decision === 'APPROVE') {
        const preview = FMRCore.previewManualFmrApprovals(
          spreadsheetId,
          callerEmail,
          reviewIds
        );

        console.log(JSON.stringify(preview, null, 2));

        if (!preview.passed) {
          throw new Error(
            [
              'Approval preview blocked this write.',
              '',
              ...preview.issues.slice(0, 15),
              '',
              'Correct the issues and run Preview Selected Approvals again.'
            ].join('\n')
          );
        }
      }

      let reviewerNotes = '';

      if (decision === 'APPROVE') {
        const notes = phase4ManualPromptOptional_(
          ui,
          title,
          'Enter optional approval notes.\n\nExample: Compared with the source FMR.'
        );
        if (notes === null) return null;
        reviewerNotes = notes;
      } else {
        const notes = phase4ManualPromptRequired_(
          ui,
          title,
          'Enter the reason for this decision:'
        );
        if (notes === null) return null;
        reviewerNotes = notes;
      }

      const confirmation = ui.alert(
        title,
        [
          `${decision} ${reviewIds.length} selected review row(s)?`,
          '',
          reviewIds.slice(0, 8).join('\n'),
          reviewIds.length > 8 ? `\n...and ${reviewIds.length - 8} more` : '',
          '',
          decision === 'APPROVE'
            ? 'The approval preview passed. This action will now write canonical records.'
            : 'This action will update the review and staging workflow.'
        ].join('\n'),
        ui.ButtonSet.YES_NO
      );

      if (confirmation !== ui.Button.YES) {
        return null;
      }

      let result;

      if (decision === 'APPROVE') {
        result = FMRCore.approveAuthorizedManualFmrReviews(
          spreadsheetId,
          callerEmail,
          reviewIds,
          reviewerNotes
        );
      } else if (decision === 'RETURN_FOR_CLARIFICATION') {
        result = FMRCore.returnAuthorizedManualFmrReviewsForClarification(
          spreadsheetId,
          callerEmail,
          reviewIds,
          reviewerNotes
        );
      } else {
        result = FMRCore.rejectAuthorizedManualFmrReviews(
          spreadsheetId,
          callerEmail,
          reviewIds,
          reviewerNotes
        );
      }

      return {
        title: 'Review action completed',
        message: [
          `Decision: ${result.decision}`,
          `Requested: ${result.requestedReviews}`,
          `Processed: ${result.processedReviews}`,
          `Already processed: ${result.alreadyProcessedReviews}`,
          `Approved: ${result.approvedReviews}`,
          `Returned: ${result.clarificationReviews}`,
          `Rejected: ${result.rejectedReviews}`,
          `Canonical FMRs created: ${result.canonicalFmrsCreated}`,
          `Canonical lines created: ${result.canonicalLinesCreated}`,
          `Recovered existing lines: ${result.recoveredCanonicalLines}`,
          `Correlation ID: ${result.correlationId}`
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* STATUS + MAINTENANCE                                                       */
/* ========================================================================== */

function phase4ManualShowStatus() {
  phase4ManualRunUiAction_(
    'Show Intake Status',
    function () {
      const result =
        FMRCore.getManualFmrIntakeSheetStatus(
          SpreadsheetApp.getActive().getId()
        );

      return {
        title: 'Manual FMR intake status',
        message: [
          `Entry rows: ${result.entryRows}`,
          `Draft: ${result.draftRows}`,
          `Ready for review: ${result.readyForReviewRows}`,
          `Needs clarification: ${result.needsClarificationRows}`,
          `Approved: ${result.approvedRows}`,
          `Rejected: ${result.rejectedRows}`,
          `Rows with errors: ${result.rowsWithValidationErrors}`,
          '',
          `Review rows: ${result.reviewRows}`,
          `Pending reviews: ${result.pendingReviewRows}`,
          `Approved reviews: ${result.approvedReviewRows}`,
          '',
          `Batches: ${result.batchRows}`,
          `Open batches: ${result.openBatches}`,
          `Completed batches: ${result.completedBatches}`,
          '',
          `Canonical FMRs: ${result.canonicalFmrRows}`,
          `Canonical material lines: ${result.canonicalLineRows}`
        ].join('\n')
      };
    }
  );
}

function phase4ManualRefreshBatchMetrics() {
  phase4ManualRunUiAction_(
    'Refresh Batch Metrics',
    function () {
      const ui = SpreadsheetApp.getUi();
      const batchId = phase4ManualResolveBatchId_(ui, 'Refresh Batch Metrics');
      if (batchId === null) return null;

      const spreadsheetId = SpreadsheetApp.getActive().getId();
      const callerEmail = phase4ManualCallerEmail_();
      const preflight = FMRCore.runManualFmrPreflight(
        spreadsheetId,
        callerEmail,
        { action: 'DATA_ENTRY', batchId }
      );

      if (!preflight.passed) {
        throw new Error(phase4ManualFormatPreflightReport_(preflight));
      }

      const result = FMRCore.refreshManualFmrBatchMetrics(
        spreadsheetId,
        callerEmail,
        batchId
      );

      phase4ManualActivateBatchRow_(batchId);

      return {
        title: 'Batch metrics refreshed',
        message: [
          `Batch ID: ${result.Batch_ID}`,
          `Status: ${result.Batch_Status}`,
          `Entered FMRs: ${result.Entered_FMR_Count}`,
          `Entered lines: ${result.Entered_Line_Count}`,
          `Approved FMRs: ${result.Approved_FMR_Count}`,
          `Approved lines: ${result.Approved_Line_Count}`,
          `Rejected lines: ${result.Rejected_Line_Count}`
        ].join('\n')
      };
    }
  );
}

function phase4ManualRefreshFormatting() {
  phase4ManualRunUiAction_(
    'Refresh Sheet Formatting',
    function () {
      const spreadsheetId = SpreadsheetApp.getActive().getId();
      const callerEmail = phase4ManualCallerEmail_();
      const preflight = FMRCore.runManualFmrPreflight(
        spreadsheetId,
        callerEmail,
        { action: 'SETUP' }
      );

      if (!preflight.passed) {
        throw new Error(phase4ManualFormatPreflightReport_(preflight));
      }

      const result = FMRCore.refreshManualFmrIntakeFormatting(spreadsheetId);

      return {
        title: 'Manual intake formatting refreshed',
        message: [
          `Refreshed: ${result.batches}`,
          `Refreshed: ${result.entry}`,
          `Refreshed: ${result.review}`
        ].join('\n')
      };
    }
  );
}

/* ========================================================================== */
/* CORE CONTRACT                                                              */
/* ========================================================================== */

function phase4ManualGetCoreContractReport_() {
  const missing = [];

  PHASE4_MANUAL_ADAPTER
    .requiredCoreFunctions
    .forEach(function (name) {
      if (
        typeof FMRCore === 'undefined' ||
        typeof FMRCore[name] !== 'function'
      ) {
        missing.push(name);
      }
    });

  return {
    valid: missing.length === 0,
    missing
  };
}

/* ========================================================================== */
/* GUARDRAIL UI HELPERS                                                       */
/* ========================================================================== */

function phase4ManualAssertSetupRole_(spreadsheetId, callerEmail) {
  const report = FMRCore.runManualFmrPreflight(
    spreadsheetId,
    callerEmail,
    { action: 'SETUP' }
  );

  if (!report.caller) {
    throw new Error(phase4ManualFormatPreflightReport_(report));
  }

  const matrix = FMRCore.getManualFmrPermissionMatrix();
  const allowed = matrix.elevatedRoles.map(function (role) {
    return String(role || '').trim().toUpperCase();
  });
  const callerRole = String(report.caller.role || '').trim().toUpperCase();

  if (allowed.indexOf(callerRole) === -1) {
    throw new Error(
      `Role "${report.caller.role}" is not authorized to set up the manual FMR intake sheets.`
    );
  }

  if (!report.contracts.canonical || !report.contracts.support) {
    throw new Error(phase4ManualFormatPreflightReport_(report));
  }

  return report;
}

function phase4ManualDefaultPreflightAction_() {
  const sheet = SpreadsheetApp.getActive().getActiveSheet();
  if (!sheet) return 'DATA_ENTRY';
  if (sheet.getName() === PHASE4_MANUAL_ADAPTER.sheets.review) return 'REVIEW';
  if (sheet.getName() === PHASE4_MANUAL_ADAPTER.sheets.batches) return 'CREATE_BATCH';
  return 'DATA_ENTRY';
}

function phase4ManualFormatPreflightReport_(report) {
  const caller = report.caller
    ? [report.caller.displayName, report.caller.email, report.caller.role].join(' | ')
    : '(not validated)';
  const reviewer = report.reviewer
    ? [report.reviewer.displayName, report.reviewer.email, report.reviewer.role].join(' | ')
    : '(not supplied or not validated)';
  const issues = (report.issues || []).slice(0, 15).map(function (item) {
    return `- ${item}`;
  });
  const warnings = (report.warnings || []).slice(0, 10).map(function (item) {
    return `- ${item}`;
  });

  return [
    `Passed: ${report.passed ? 'Yes' : 'No'}`,
    `Action: ${report.action || '(unknown)'}`,
    `Caller: ${caller}`,
    `Reviewer: ${reviewer}`,
    '',
    `Canonical contract: ${report.contracts && report.contracts.canonical ? 'PASS' : 'FAIL'}`,
    `Support contract: ${report.contracts && report.contracts.support ? 'PASS' : 'FAIL'}`,
    `Manual foundation: ${report.contracts && report.contracts.manualFoundation ? 'PASS' : 'FAIL'}`,
    `Protections: ${report.protections && report.protections.complete ? 'PASS' : 'INCOMPLETE'}`,
    '',
    issues.length ? `Issues:\n${issues.join('\n')}` : 'Issues: none',
    '',
    warnings.length ? `Warnings:\n${warnings.join('\n')}` : 'Warnings: none'
  ].join('\n');
}

/* ========================================================================== */
/* UI HELPERS                                                                 */
/* ========================================================================== */

function phase4ManualRunUiAction_(
  actionName,
  callback
) {
  const ui = SpreadsheetApp.getUi();

  try {
    const contract =
      phase4ManualGetCoreContractReport_();

    if (!contract.valid) {
      throw new Error(
        [
          'The installed FMRCore library version does not expose the full manual-intake contract.',
          '',
          'Missing:',
          contract.missing.join('\n'),
          '',
          'Publish the new FMRCore library version and update the bound project dependency.'
        ].join('\n')
      );
    }

    const result = callback();

    if (!result) {
      return;
    }

    ui.alert(
      result.title || actionName,
      result.message || 'Completed.',
      ui.ButtonSet.OK
    );
  } catch (error) {
    console.error(
      `${actionName}: ${error.stack || error}`
    );

    ui.alert(
      `${actionName} failed`,
      error && error.message
        ? error.message
        : String(error),
      ui.ButtonSet.OK
    );
  }
}

function phase4ManualPromptRequired_(
  ui,
  title,
  prompt
) {
  const response = ui.prompt(
    title,
    prompt,
    ui.ButtonSet.OK_CANCEL
  );

  if (
    response.getSelectedButton() !==
    ui.Button.OK
  ) {
    return null;
  }

  const value =
    response.getResponseText().trim();

  if (!value) {
    throw new Error(
      'A value is required.'
    );
  }

  return value;
}

function phase4ManualPromptOptional_(
  ui,
  title,
  prompt
) {
  const response = ui.prompt(
    title,
    prompt,
    ui.ButtonSet.OK_CANCEL
  );

  if (
    response.getSelectedButton() !==
    ui.Button.OK
  ) {
    return null;
  }

  return response
    .getResponseText()
    .trim();
}

function phase4ManualPromptWithDefault_(
  ui,
  title,
  prompt,
  defaultValue
) {
  const response = ui.prompt(
    title,
    `${prompt}\n\nDefault: ${defaultValue}`,
    ui.ButtonSet.OK_CANCEL
  );

  if (
    response.getSelectedButton() !==
    ui.Button.OK
  ) {
    return null;
  }

  return (
    response.getResponseText().trim() ||
    defaultValue
  );
}

function phase4ManualCallerEmail_() {
  const activeEmail =
    Session.getActiveUser()
      .getEmail()
      .trim()
      .toLowerCase();

  if (activeEmail) {
    return activeEmail;
  }

  const effectiveEmail =
    Session.getEffectiveUser()
      .getEmail()
      .trim()
      .toLowerCase();

  if (effectiveEmail) {
    return effectiveEmail;
  }

  throw new Error(
    'Google did not provide the active user email. Run this action from the spreadsheet while signed in with an authorized account.'
  );
}

function phase4ManualResolveBatchId_(
  ui,
  title
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getActiveSheet();
  const range =
    spreadsheet.getActiveRange();

  if (
    sheet &&
    range &&
    sheet.getName() ===
      PHASE4_MANUAL_ADAPTER.sheets.batches &&
    range.getRow() > 1
  ) {
    const batchId =
      String(
        sheet
          .getRange(range.getRow(), 1)
          .getDisplayValue() || ''
      ).trim();

    if (batchId) {
      return batchId;
    }
  }

  if (
    sheet &&
    range &&
    sheet.getName() ===
      PHASE4_MANUAL_ADAPTER.sheets.entry &&
    range.getRow() > 1
  ) {
    const batchId =
      String(
        sheet
          .getRange(range.getRow(), 2)
          .getDisplayValue() || ''
      ).trim();

    if (batchId) {
      return batchId;
    }
  }

  if (
    sheet &&
    range &&
    sheet.getName() ===
      PHASE4_MANUAL_ADAPTER.sheets.review &&
    range.getRow() > 1
  ) {
    const batchId =
      String(
        sheet
          .getRange(range.getRow(), 3)
          .getDisplayValue() || ''
      ).trim();

    if (batchId) {
      return batchId;
    }
  }

  return phase4ManualPromptRequired_(
    ui,
    title,
    'Enter the Batch_ID:'
  );
}

function phase4ManualResolveSelectedReviewIds_(
  ui,
  title
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getActiveSheet();
  const range =
    spreadsheet.getActiveRange();

  if (
    sheet &&
    range &&
    sheet.getName() ===
      PHASE4_MANUAL_ADAPTER.sheets.review
  ) {
    const startRow =
      Math.max(2, range.getRow());
    const endRow =
      range.getLastRow();

    if (endRow >= startRow) {
      const values =
        sheet
          .getRange(
            startRow,
            1,
            endRow - startRow + 1,
            1
          )
          .getDisplayValues()
          .flat()
          .map(function (value) {
            return String(value || '').trim();
          })
          .filter(Boolean);

      const unique =
        Array.from(new Set(values));

      if (unique.length) {
        return unique;
      }
    }
  }

  const response =
    phase4ManualPromptRequired_(
      ui,
      title,
      'Select rows on FMR_Manual_Review first, or enter Review_ID values separated by commas:'
    );

  if (response === null) {
    return null;
  }

  const ids =
    Array.from(
      new Set(
        response
          .split(/[\n,;]+/)
          .map(function (value) {
            return value.trim();
          })
          .filter(Boolean)
      )
    );

  if (!ids.length) {
    throw new Error(
      'No Review_ID values were provided.'
    );
  }

  return ids;
}

function phase4ManualParseOptionalWholeNumber_(
  value
) {
  if (!String(value || '').trim()) {
    return 0;
  }

  return phase4ManualParseRequiredWholeNumber_(
    value,
    0,
    1000000,
    'Value'
  );
}

function phase4ManualParseRequiredWholeNumber_(
  value,
  minimum,
  maximum,
  label
) {
  const text =
    String(value || '').trim();

  if (!/^\d+$/.test(text)) {
    throw new Error(
      `${label} must be a whole number.`
    );
  }

  const number = Number(text);

  if (
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `${label} must be from ${minimum} through ${maximum}.`
    );
  }

  return number;
}

function phase4ManualParseOptionalDate_(
  value
) {
  const text =
    String(value || '').trim();

  if (!text) {
    return '';
  }

  const match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    throw new Error(
      'The date must use YYYY-MM-DD.'
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date =
    new Date(
      year,
      month - 1,
      day,
      12,
      0,
      0
    );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(
      'The required date is not a valid calendar date.'
    );
  }

  return date;
}

/* ========================================================================== */
/* SHEET NAVIGATION                                                           */
/* ========================================================================== */

function phase4ManualActivateSheet_(
  sheetName
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {
    return;
  }

  spreadsheet.setActiveSheet(sheet);
}

function phase4ManualActivateBatchRow_(
  batchId
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getSheetByName(
      PHASE4_MANUAL_ADAPTER.sheets.batches
    );

  if (!sheet) {
    return;
  }

  spreadsheet.setActiveSheet(sheet);

  const row =
    phase4ManualFindValueRow_(
      sheet,
      1,
      batchId
    );

  if (row > 0) {
    sheet.setActiveRange(
      sheet.getRange(row, 1)
    );
  }
}

function phase4ManualActivateBatchEntryRows_(
  batchId
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getSheetByName(
      PHASE4_MANUAL_ADAPTER.sheets.entry
    );

  if (!sheet) {
    return;
  }

  spreadsheet.setActiveSheet(sheet);

  if (sheet.getLastRow() <= 1) {
    return;
  }

  const values =
    sheet
      .getRange(
        2,
        2,
        sheet.getLastRow() - 1,
        1
      )
      .getDisplayValues();

  const rows = [];

  values.forEach(function (row, index) {
    if (
      String(row[0] || '').trim() ===
      batchId
    ) {
      rows.push(index + 2);
    }
  });

  if (rows.length) {
    sheet.setActiveRange(
      sheet.getRange(
        rows[0],
        1,
        rows[rows.length - 1] -
          rows[0] +
          1,
        1
      )
    );
  }
}

function phase4ManualActivateNewestEntryRows_(
  rowCount
) {
  const spreadsheet =
    SpreadsheetApp.getActive();
  const sheet =
    spreadsheet.getSheetByName(
      PHASE4_MANUAL_ADAPTER.sheets.entry
    );

  if (!sheet || rowCount < 1) {
    return;
  }

  spreadsheet.setActiveSheet(sheet);

  const startRow =
    Math.max(
      2,
      sheet.getLastRow() - rowCount + 1
    );

  sheet.setActiveRange(
    sheet.getRange(
      startRow,
      1,
      rowCount,
      1
    )
  );
}

function phase4ManualFindValueRow_(
  sheet,
  column,
  expectedValue
) {
  if (
    !sheet ||
    sheet.getLastRow() <= 1
  ) {
    return 0;
  }

  const values =
    sheet
      .getRange(
        2,
        column,
        sheet.getLastRow() - 1,
        1
      )
      .getDisplayValues();

  const expected =
    String(expectedValue || '').trim();

  for (
    let index = 0;
    index < values.length;
    index++
  ) {
    if (
      String(values[index][0] || '').trim() ===
      expected
    ) {
      return index + 2;
    }
  }

  return 0;
}
