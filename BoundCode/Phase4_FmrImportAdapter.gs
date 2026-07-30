/**
 * Phase4_FmrImportAdapter.gs
 *
 * Restricted server-side adapter for the FMR bulk-import workflow.
 *
 * THIS FILE BELONGS IN THE PRIVATE WEB-APP SERVER PROJECT.
 *
 * DO NOT add this file to:
 * - FMRCore
 * - the shared spreadsheet-bound Apps Script project
 *
 * Deployment requirements:
 * - Web app executes as: User accessing the web app
 * - Access is restricted to signed-in users
 * - FMRCore is installed as a private library with identifier: FMRCore
 * - Google Drive advanced service v3 is enabled with identifier: Drive
 *
 * The adapter never accepts callerEmail from the browser. The signed-in
 * identity is resolved server-side for every operation.
 */

const PHASE4_FMR_IMPORT_ADAPTER = Object.freeze({
  componentVersion:
    'phase4-fmr-import-adapter-v2-batch-list',

  ownerEmail:
    'jonathanmura05@gmail.com',

  defaultMasterSpreadsheetId:
    '1NBho3heuBWbwf7QLmsHUHL-iMhnV2ZMm6kiQqciDJ9U',

  properties: Object.freeze({
    masterSpreadsheetId:
      'FMR_MASTER_SPREADSHEET_ID'
  }),

  sheets: Object.freeze({
    queue:
      'FMR_Import_Queue',
    entry:
      'FMR_Manual_Entry',
    batches:
      'FMR_Manual_Batches'
  }),

  limits: Object.freeze({
    maximumDiscoveryFiles:
      500,
    defaultDiscoveryFiles:
      250,
    maximumChunkSize:
      10,
    defaultChunkSize:
      5,
    maximumSelectedImports:
      20,
    maximumSummaryItems:
      100,
    defaultSummaryItems:
      50,
    maximumRuntimeMs:
      240000
  }),

  requiredCoreFunctions: Object.freeze([
    'getFmrImportServiceVersion',
    'getFmrImportStatusOptions',
    'validateFmrImportServiceFoundation',
    'setupFmrImportQueueSheet',
    'discoverFmrFilesForBatch',
    'processNextFmrImportChunk',
    'processSelectedFmrImports',
    'retryFailedFmrImports',
    'cancelFmrImport',
    'getFmrImportBatchSummary'
  ])
});

/* ========================================================================== */
/* PUBLIC INSTALLATION + CONTRACT                                             */
/* ========================================================================== */

/**
 * One-time installation function.
 *
 * Run manually from the private web-app server project while signed in as
 * jonathanmura05@gmail.com.
 *
 * @return {Object}
 */
function phase4ImportInstallAdapter() {
  return phase4ImportExecute_(
    'INSTALL_ADAPTER',
    function () {
      const callerEmail =
        phase4ImportCallerEmail_();

      phase4ImportAssertOwner_(
        callerEmail
      );

      const contract =
        phase4ImportGetCoreContractReport_();

      if (!contract.valid) {
        throw new Error(
          [
            'The selected FMRCore library version is missing required import functions.',
            '',
            contract.missing.join('\n')
          ].join('\n')
        );
      }

      const spreadsheetId =
        PHASE4_FMR_IMPORT_ADAPTER
          .defaultMasterSpreadsheetId;

      const setup =
        FMRCore.setupFmrImportQueueSheet(
          spreadsheetId,
          callerEmail
        );

      const foundation =
        FMRCore
          .validateFmrImportServiceFoundation(
            spreadsheetId
          );

      if (!foundation.valid) {
        throw new Error(
          foundation.issues.join('\n')
        );
      }

      PropertiesService
        .getScriptProperties()
        .setProperty(
          PHASE4_FMR_IMPORT_ADAPTER
            .properties
            .masterSpreadsheetId,
          spreadsheetId
        );

      return {
        adapterVersion:
          PHASE4_FMR_IMPORT_ADAPTER
            .componentVersion,
        spreadsheetId,
        queueSheet:
          setup.sheetName,
        foundationValid:
          foundation.valid,
        callerEmail
      };
    }
  );
}

/**
 * Owner-only function for changing the configured master spreadsheet.
 *
 * @param {Object} request
 * @return {Object}
 */
function phase4ImportConfigureMasterSpreadsheet(
  request
) {
  return phase4ImportExecute_(
    'CONFIGURE_MASTER_SPREADSHEET',
    function () {
      const callerEmail =
        phase4ImportCallerEmail_();

      phase4ImportAssertOwner_(
        callerEmail
      );

      const spreadsheetId =
        phase4ImportRequireText_(
          request &&
          request.spreadsheetId,
          'spreadsheetId'
        );

      const setup =
        FMRCore.setupFmrImportQueueSheet(
          spreadsheetId,
          callerEmail
        );

      const foundation =
        FMRCore
          .validateFmrImportServiceFoundation(
            spreadsheetId
          );

      if (!foundation.valid) {
        throw new Error(
          foundation.issues.join('\n')
        );
      }

      PropertiesService
        .getScriptProperties()
        .setProperty(
          PHASE4_FMR_IMPORT_ADAPTER
            .properties
            .masterSpreadsheetId,
          spreadsheetId
        );

      return {
        spreadsheetId,
        queueSheet:
          setup.sheetName,
        foundationValid:
          foundation.valid
      };
    }
  );
}

/**
 * Returns safe startup data for the import screen.
 *
 * @return {Object}
 */
function phase4ImportGetBootstrap() {
  return phase4ImportExecute_(
    'GET_BOOTSTRAP',
    function () {
      const spreadsheetId =
        phase4ImportMasterSpreadsheetId_();

      const callerEmail =
        phase4ImportCallerEmail_();

      const contract =
        phase4ImportGetCoreContractReport_();

      if (!contract.valid) {
        throw new Error(
          'The installed FMRCore version does not expose the complete import contract.'
        );
      }

      const foundation =
        FMRCore
          .validateFmrImportServiceFoundation(
            spreadsheetId
          );

      if (!foundation.valid) {
        throw new Error(
          foundation.issues.join('\n')
        );
      }

      return {
        adapterVersion:
          PHASE4_FMR_IMPORT_ADAPTER
            .componentVersion,

        coreVersion:
          phase4ImportSanitizeCoreVersion_(
            FMRCore
              .getFmrImportServiceVersion()
          ),

        spreadsheetId,

        callerEmail,

        foundation: {
          valid:
            foundation.valid,
          queueSheet:
            foundation.queueSheet,
          issues:
            Array.isArray(
              foundation.issues
            )
              ? foundation.issues
              : []
        },

        statusOptions:
          FMRCore
            .getFmrImportStatusOptions(),

        limits: {
          maximumDiscoveryFiles:
            PHASE4_FMR_IMPORT_ADAPTER
              .limits
              .maximumDiscoveryFiles,

          maximumChunkSize:
            PHASE4_FMR_IMPORT_ADAPTER
              .limits
              .maximumChunkSize,

          maximumSelectedImports:
            PHASE4_FMR_IMPORT_ADAPTER
              .limits
              .maximumSelectedImports
        }
      };
    }
  );
}

/**
 * Returns batches the signed-in user is assigned to.
 *
 * Owners receive every batch. Other users receive batches where they are
 * assigned as an entry user or reviewer.
 *
 * @return {Object}
 */
function phase4ImportGetAssignedBatches() {
  return phase4ImportExecute_(
    'GET_ASSIGNED_BATCHES',
    function () {
      const context =
        phase4ImportContext_();

      const spreadsheet =
        SpreadsheetApp.openById(
          context.spreadsheetId
        );

      const sheet =
        spreadsheet.getSheetByName(
          PHASE4_FMR_IMPORT_ADAPTER
            .sheets
            .batches
        );

      if (!sheet) {
        throw new Error(
          'The FMR batch sheet was not found.'
        );
      }

      const values =
        sheet.getDataRange()
          .getDisplayValues();

      if (values.length === 0) {
        return {
          batches: []
        };
      }

      const headers =
        values[0].map(function (value) {
          return String(value || '')
            .trim();
        });

      const requiredHeaders = [
        'Batch_ID',
        'Batch_Name',
        'Source_Document_Type',
        'Source_Folder_URL',
        'Assigned_Entry_User_1',
        'Assigned_Entry_User_2',
        'Assigned_Reviewer',
        'Batch_Status',
        'Expected_FMR_Count',
        'Expected_Line_Count',
        'Entered_FMR_Count',
        'Entered_Line_Count',
        'Approved_FMR_Count',
        'Approved_Line_Count',
        'Created_By',
        'Created_At',
        'Updated_At'
      ];

      const missingHeaders =
        requiredHeaders.filter(
          function (header) {
            return (
              headers.indexOf(header) ===
              -1
            );
          }
        );

      if (missingHeaders.length > 0) {
        throw new Error(
          'The FMR batch sheet is missing required columns: ' +
          missingHeaders.join(', ')
        );
      }

      const headerIndexes = {};

      headers.forEach(
        function (header, index) {
          headerIndexes[header] =
            index;
        }
      );

      const callerEmail =
        String(
          context.callerEmail || ''
        )
          .trim()
          .toLowerCase();

      const isOwner =
        callerEmail ===
        PHASE4_FMR_IMPORT_ADAPTER
          .ownerEmail;

      const batches =
        values
          .slice(1)
          .filter(function (row) {
            const batchId =
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Batch_ID'
              );

            if (!batchId) {
              return false;
            }

            if (isOwner) {
              return true;
            }

            const assignedEmails = [
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Entry_User_1'
              ),
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Entry_User_2'
              ),
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Reviewer'
              ),
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Created_By'
              )
            ]
              .map(function (email) {
                return String(email || '')
                  .trim()
                  .toLowerCase();
              })
              .filter(Boolean);

            return (
              assignedEmails.indexOf(
                callerEmail
              ) !== -1
            );
          })
          .map(function (row) {
            const entryUser1 =
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Entry_User_1'
              );

            const entryUser2 =
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Entry_User_2'
              );

            const reviewer =
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Assigned_Reviewer'
              );

            const createdBy =
              phase4ImportBatchCell_(
                row,
                headerIndexes,
                'Created_By'
              );

            const roles = [];

            if (isOwner) {
              roles.push('OWNER');
            }

            if (
              phase4ImportEmailEquals_(
                callerEmail,
                entryUser1
              ) ||
              phase4ImportEmailEquals_(
                callerEmail,
                entryUser2
              )
            ) {
              roles.push('ENTRY');
            }

            if (
              phase4ImportEmailEquals_(
                callerEmail,
                reviewer
              )
            ) {
              roles.push('REVIEWER');
            }

            if (
              phase4ImportEmailEquals_(
                callerEmail,
                createdBy
              )
            ) {
              roles.push('CREATOR');
            }

            return {
              batchId:
                phase4ImportBatchCell_(
                  row,
                  headerIndexes,
                  'Batch_ID'
                ),

              batchName:
                phase4ImportBatchCell_(
                  row,
                  headerIndexes,
                  'Batch_Name'
                ),

              sourceDocumentType:
                phase4ImportBatchCell_(
                  row,
                  headerIndexes,
                  'Source_Document_Type'
                ),

              sourceFolderUrl:
                phase4ImportBatchCell_(
                  row,
                  headerIndexes,
                  'Source_Folder_URL'
                ),

              batchStatus:
                phase4ImportBatchCell_(
                  row,
                  headerIndexes,
                  'Batch_Status'
                ),

              expectedFmrCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Expected_FMR_Count'
                  )
                ),

              expectedLineCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Expected_Line_Count'
                  )
                ),

              enteredFmrCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Entered_FMR_Count'
                  )
                ),

              enteredLineCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Entered_Line_Count'
                  )
                ),

              approvedFmrCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Approved_FMR_Count'
                  )
                ),

              approvedLineCount:
                phase4ImportSafeNumber_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Approved_Line_Count'
                  )
                ),

              roles:
                Array.from(
                  new Set(roles)
                ),

              createdAt:
                phase4ImportSafeDateValue_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Created_At'
                  )
                ),

              updatedAt:
                phase4ImportSafeDateValue_(
                  phase4ImportBatchCell_(
                    row,
                    headerIndexes,
                    'Updated_At'
                  )
                )
            };
          })
          .sort(function (left, right) {
            const leftOpen =
              String(
                left.batchStatus || ''
              ).toUpperCase() ===
              'OPEN'
                ? 1
                : 0;

            const rightOpen =
              String(
                right.batchStatus || ''
              ).toUpperCase() ===
              'OPEN'
                ? 1
                : 0;

            if (
              leftOpen !== rightOpen
            ) {
              return (
                rightOpen -
                leftOpen
              );
            }

            return (
              String(
                right.updatedAt || ''
              ).localeCompare(
                String(
                  left.updatedAt || ''
                )
              )
            );
          });

      return {
        callerEmail,
        batchCount:
          batches.length,
        batches
      };
    }
  );
}

/* ========================================================================== */
/* PUBLIC IMPORT OPERATIONS                                                   */
/* ========================================================================== */

/**
 * Creates or verifies the import queue.
 *
 * @return {Object}
 */
function phase4ImportSetupQueue() {
  return phase4ImportExecute_(
    'SETUP_QUEUE',
    function () {
      const context =
        phase4ImportContext_();

      const result =
        FMRCore
          .setupFmrImportQueueSheet(
            context.spreadsheetId,
            context.callerEmail
          );

      return {
        created:
          Boolean(result.created),

        sheetName:
          result.sheetName,

        headers:
          Number(result.headers) || 0,

        url:
          result.url || ''
      };
    }
  );
}

/**
 * Discovers supported direct child files in one authorized batch folder.
 *
 * @param {Object} request
 * - batchId
 * - maximumFiles
 * - fileNameContains
 *
 * @return {Object}
 */
function phase4ImportDiscoverBatchFiles(
  request
) {
  return phase4ImportExecute_(
    'DISCOVER_BATCH_FILES',
    function () {
      const context =
        phase4ImportContext_();

      const batchId =
        phase4ImportRequireBatchId_(
          request &&
          request.batchId
        );

      const maximumFiles =
        phase4ImportClampInteger_(
          request &&
          request.maximumFiles,
          1,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .maximumDiscoveryFiles,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .defaultDiscoveryFiles
        );

      const fileNameContains =
        phase4ImportOptionalText_(
          request &&
          request.fileNameContains
        );

      const result =
        FMRCore
          .discoverFmrFilesForBatch(
            context.spreadsheetId,
            context.callerEmail,
            batchId,
            {
              maximumFiles,
              fileNameContains,
              includeExistingQueueRecords:
                false
            }
          );

      return {
        batchId:
          result.batchId,

        folderId:
          result.folderId,

        folderName:
          result.folderName,

        directChildrenScanned:
          Number(
            result.directChildrenScanned
          ) || 0,

        supportedFilesFound:
          Number(
            result.supportedFilesFound
          ) || 0,

        newlyQueued:
          Number(
            result.newlyQueued
          ) || 0,

        alreadyQueued:
          Number(
            result.alreadyQueued
          ) || 0,

        ignoredFolders:
          Number(
            result.ignoredFolders
          ) || 0,

        ignoredUnsupported:
          Number(
            result.ignoredUnsupported
          ) || 0,

        ignoredNameFilter:
          Number(
            result.ignoredNameFilter
          ) || 0,

        truncated:
          Boolean(result.truncated),

        queuedImportIds:
          phase4ImportNormalizeIds_(
            result.queuedImportIds
          )
      };
    }
  );
}

/**
 * Returns a sanitized queue summary for one authorized batch.
 *
 * @param {Object} request
 * - batchId
 * - maximumItems
 * - includeItems
 *
 * @return {Object}
 */
function phase4ImportGetBatchSummary(
  request
) {
  return phase4ImportExecute_(
    'GET_BATCH_SUMMARY',
    function () {
      const context =
        phase4ImportContext_();

      const batchId =
        phase4ImportRequireBatchId_(
          request &&
          request.batchId
        );

      const maximumItems =
        phase4ImportClampInteger_(
          request &&
          request.maximumItems,
          1,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .maximumSummaryItems,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .defaultSummaryItems
        );

      const includeItems =
        !request ||
        request.includeItems !== false;

      const result =
        FMRCore
          .getFmrImportBatchSummary(
            context.spreadsheetId,
            context.callerEmail,
            batchId,
            {
              maximumItems,
              includeItems
            }
          );

      return phase4ImportSanitizeSummary_(
        result
      );
    }
  );
}

/**
 * Processes the next structured-priority queue chunk.
 *
 * @param {Object} request
 * - batchId
 * - chunkSize
 *
 * @return {Object}
 */
function phase4ImportProcessChunk(
  request
) {
  return phase4ImportExecute_(
    'PROCESS_CHUNK',
    function () {
      const context =
        phase4ImportContext_();

      const batchId =
        phase4ImportRequireBatchId_(
          request &&
          request.batchId
        );

      const chunkSize =
        phase4ImportClampInteger_(
          request &&
          request.chunkSize,
          1,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .maximumChunkSize,
          PHASE4_FMR_IMPORT_ADAPTER
            .limits
            .defaultChunkSize
        );

      const result =
        FMRCore
          .processNextFmrImportChunk(
            context.spreadsheetId,
            context.callerEmail,
            batchId,
            {
              chunkSize,
              maximumRuntimeMs:
                PHASE4_FMR_IMPORT_ADAPTER
                  .limits
                  .maximumRuntimeMs
            }
          );

      return phase4ImportSanitizeProcessResult_(
        result
      );
    }
  );
}

/**
 * Processes explicitly selected import records.
 *
 * @param {Object} request
 * - importIds
 *
 * @return {Object}
 */
function phase4ImportProcessSelected(
  request
) {
  return phase4ImportExecute_(
    'PROCESS_SELECTED',
    function () {
      const context =
        phase4ImportContext_();

      const importIds =
        phase4ImportRequireImportIds_(
          request &&
          request.importIds
        );

      const result =
        FMRCore
          .processSelectedFmrImports(
            context.spreadsheetId,
            context.callerEmail,
            importIds,
            {
              maximumRuntimeMs:
                PHASE4_FMR_IMPORT_ADAPTER
                  .limits
                  .maximumRuntimeMs
            }
          );

      return phase4ImportSanitizeProcessResult_(
        result
      );
    }
  );
}

/**
 * Requeues selected FAILED or NEEDS_MANUAL_ENTRY records.
 *
 * @param {Object} request
 * - batchId
 * - importIds
 *
 * @return {Object}
 */
function phase4ImportRetryFailures(
  request
) {
  return phase4ImportExecute_(
    'RETRY_FAILURES',
    function () {
      const context =
        phase4ImportContext_();

      const batchId =
        phase4ImportRequireBatchId_(
          request &&
          request.batchId
        );

      const importIds =
        phase4ImportRequireImportIds_(
          request &&
          request.importIds
        );

      const result =
        FMRCore
          .retryFailedFmrImports(
            context.spreadsheetId,
            context.callerEmail,
            batchId,
            importIds
          );

      return {
        batchId:
          result.batchId,

        retried:
          Number(result.retried) || 0,

        skipped:
          Number(result.skipped) || 0,

        retriedImportIds:
          phase4ImportNormalizeIds_(
            result.retriedImportIds
          ),

        skippedItems:
          Array.isArray(
            result.skippedItems
          )
            ? result.skippedItems.map(
                function (item) {
                  return {
                    importId:
                      item.importId || '',
                    status:
                      item.status || ''
                  };
                }
              )
            : []
      };
    }
  );
}

/**
 * Cancels one non-staged import.
 *
 * @param {Object} request
 * - importId
 * - reason
 *
 * @return {Object}
 */
function phase4ImportCancel(
  request
) {
  return phase4ImportExecute_(
    'CANCEL_IMPORT',
    function () {
      const context =
        phase4ImportContext_();

      const importId =
        phase4ImportRequireText_(
          request &&
          request.importId,
          'importId'
        );

      const reason =
        phase4ImportRequireText_(
          request &&
          request.reason,
          'reason'
        );

      const result =
        FMRCore
          .cancelFmrImport(
            context.spreadsheetId,
            context.callerEmail,
            importId,
            reason
          );

      return phase4ImportSanitizeQueueItem_(
        result
      );
    }
  );
}

/**
 * Returns safe links for opening the queue, batch list, and staging sheets.
 *
 * @param {Object} request
 * - batchId
 *
 * @return {Object}
 */
function phase4ImportGetWorkspaceLinks(
  request
) {
  return phase4ImportExecute_(
    'GET_WORKSPACE_LINKS',
    function () {
      const context =
        phase4ImportContext_();

      const batchId =
        phase4ImportRequireBatchId_(
          request &&
          request.batchId
        );

      /*
       * The summary call performs the same batch authorization used by the
       * service. Do not construct links before authorization succeeds.
       */
      FMRCore.getFmrImportBatchSummary(
        context.spreadsheetId,
        context.callerEmail,
        batchId,
        {
          maximumItems: 1,
          includeItems: false
        }
      );

      const spreadsheet =
        SpreadsheetApp.openById(
          context.spreadsheetId
        );

      return {
        spreadsheetUrl:
          spreadsheet.getUrl(),

        queueUrl:
          phase4ImportSheetUrl_(
            spreadsheet,
            PHASE4_FMR_IMPORT_ADAPTER
              .sheets
              .queue
          ),

        stagingUrl:
          phase4ImportSheetUrl_(
            spreadsheet,
            PHASE4_FMR_IMPORT_ADAPTER
              .sheets
              .entry
          ),

        batchesUrl:
          phase4ImportSheetUrl_(
            spreadsheet,
            PHASE4_FMR_IMPORT_ADAPTER
              .sheets
              .batches
          )
      };
    }
  );
}

/* ========================================================================== */
/* EXECUTION + SECURITY                                                       */
/* ========================================================================== */

function phase4ImportExecute_(
  action,
  callback
) {
  try {
    const contract =
      phase4ImportGetCoreContractReport_();

    if (!contract.valid) {
      throw new Error(
        [
          'The installed FMRCore library version is incomplete.',
          'Update the private web-app project to the current numbered FMRCore version.'
        ].join(' ')
      );
    }

    const data =
      callback();

    return {
      ok: true,
      action,
      data
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        action,
        message:
          error &&
          error.message
            ? error.message
            : String(error),
        stack:
          error &&
          error.stack
            ? error.stack
            : ''
      })
    );

    return {
      ok: false,
      action,
      error: {
        code:
          phase4ImportErrorCode_(
            error
          ),
        message:
          phase4ImportSafeErrorMessage_(
            error
          )
      }
    };
  }
}

function phase4ImportContext_() {
  return {
    spreadsheetId:
      phase4ImportMasterSpreadsheetId_(),

    callerEmail:
      phase4ImportCallerEmail_()
  };
}

function phase4ImportCallerEmail_() {
  const email =
    String(
      Session
        .getActiveUser()
        .getEmail() || ''
    )
      .trim()
      .toLowerCase();

  if (!email) {
    throw new Error(
      [
        'Google did not provide the signed-in user email.',
        'Deploy the web app as "User accessing the web app" and require users to sign in.'
      ].join(' ')
    );
  }

  return email;
}

function phase4ImportAssertOwner_(
  callerEmail
) {
  if (
    String(callerEmail)
      .trim()
      .toLowerCase() !==
    PHASE4_FMR_IMPORT_ADAPTER
      .ownerEmail
  ) {
    throw new Error(
      'Only the web-app owner can change the master spreadsheet configuration.'
    );
  }
}

function phase4ImportMasterSpreadsheetId_() {
  const spreadsheetId =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(
          PHASE4_FMR_IMPORT_ADAPTER
            .properties
            .masterSpreadsheetId
        ) || ''
    ).trim();

  if (!spreadsheetId) {
    throw new Error(
      'The import adapter is not configured. The owner must run phase4ImportInstallAdapter first.'
    );
  }

  return spreadsheetId;
}

function phase4ImportGetCoreContractReport_() {
  const missing = [];

  PHASE4_FMR_IMPORT_ADAPTER
    .requiredCoreFunctions
    .forEach(function (name) {
      if (
        typeof FMRCore ===
          'undefined' ||
        typeof FMRCore[name] !==
          'function'
      ) {
        missing.push(name);
      }
    });

  return {
    valid:
      missing.length === 0,
    missing
  };
}

function phase4ImportBatchCell_(
  row,
  headerIndexes,
  header
) {
  const index =
    headerIndexes[header];

  if (
    index === undefined ||
    index === null
  ) {
    return '';
  }

  return String(
    row[index] || ''
  ).trim();
}

function phase4ImportEmailEquals_(
  left,
  right
) {
  return (
    String(left || '')
      .trim()
      .toLowerCase() ===
    String(right || '')
      .trim()
      .toLowerCase()
  );
}

function phase4ImportSafeNumber_(
  value
) {
  const number =
    Number(
      String(value || '')
        .replace(/,/g, '')
        .trim()
    );

  return Number.isFinite(number)
    ? number
    : 0;
}

/* ========================================================================== */
/* INPUT VALIDATION                                                           */
/* ========================================================================== */

function phase4ImportRequireBatchId_(
  value
) {
  const batchId =
    phase4ImportRequireText_(
      value,
      'batchId'
    );

  if (
    !/^FMRBATCH-[A-Z0-9-]+$/i.test(
      batchId
    )
  ) {
    throw new Error(
      'The batch ID format is invalid.'
    );
  }

  return batchId;
}

function phase4ImportRequireImportIds_(
  value
) {
  const importIds =
    phase4ImportNormalizeIds_(
      value
    );

  if (importIds.length === 0) {
    throw new Error(
      'At least one Import_ID is required.'
    );
  }

  if (
    importIds.length >
    PHASE4_FMR_IMPORT_ADAPTER
      .limits
      .maximumSelectedImports
  ) {
    throw new Error(
      `No more than ${
        PHASE4_FMR_IMPORT_ADAPTER
          .limits
          .maximumSelectedImports
      } imports can be selected at one time.`
    );
  }

  const invalid =
    importIds.filter(
      function (importId) {
        return (
          !/^FMRIMPORT-[A-Z0-9-]+$/i
            .test(importId)
        );
      }
    );

  if (invalid.length > 0) {
    throw new Error(
      'One or more Import_ID values are invalid.'
    );
  }

  return importIds;
}

function phase4ImportNormalizeIds_(
  value
) {
  let values = [];

  if (Array.isArray(value)) {
    values = value;
  } else if (
    value !== undefined &&
    value !== null
  ) {
    values =
      String(value)
        .split(/[\n,;]+/);
  }

  return Array.from(
    new Set(
      values
        .map(function (item) {
          return String(item || '')
            .trim();
        })
        .filter(Boolean)
    )
  );
}

function phase4ImportRequireText_(
  value,
  fieldName
) {
  const text =
    phase4ImportOptionalText_(
      value
    );

  if (!text) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (text.length > 500) {
    throw new Error(
      `${fieldName} is too long.`
    );
  }

  return text;
}

function phase4ImportOptionalText_(
  value
) {
  return String(
    value === undefined ||
    value === null
      ? ''
      : value
  )
    .trim();
}

function phase4ImportClampInteger_(
  value,
  minimum,
  maximum,
  fallback
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.floor(number)
    )
  );
}

/* ========================================================================== */
/* RESPONSE SANITIZATION                                                      */
/* ========================================================================== */

function phase4ImportSanitizeCoreVersion_(
  value
) {
  const version =
    value || {};

  return {
    schemaVersion:
      version.schemaVersion || '',
    importConfigVersion:
      version.importConfigVersion || '',
    parserVersion:
      version.parserVersion || '',
    component:
      version.component || ''
  };
}

function phase4ImportSanitizeSummary_(
  result
) {
  const summary =
    result || {};

  return {
    batchId:
      summary.batchId || '',

    queueExists:
      Boolean(summary.queueExists),

    totalImports:
      Number(summary.totalImports) || 0,

    totalDetectedLines:
      Number(
        summary.totalDetectedLines
      ) || 0,

    totalStagedRows:
      Number(
        summary.totalStagedRows
      ) || 0,

    statusCounts:
      phase4ImportSanitizeCounts_(
        summary.statusCounts
      ),

    items:
      Array.isArray(summary.items)
        ? summary.items.map(
            phase4ImportSanitizeQueueItem_
          )
        : []
  };
}

function phase4ImportSanitizeProcessResult_(
  result
) {
  const value =
    result || {};

  return {
    batchId:
      value.batchId || '',

    requested:
      Number(value.requested) || 0,

    requestedChunkSize:
      Number(
        value.requestedChunkSize
      ) || 0,

    processedCount:
      Number(
        value.processedCount
      ) || 0,

    elapsedMs:
      Number(value.elapsedMs) || 0,

    remainingQueued:
      Number(
        value.remainingQueued
      ) || 0,

    currentlyProcessing:
      Number(
        value.currentlyProcessing
      ) || 0,

    stagedNeedsVerification:
      Number(
        value.stagedNeedsVerification
      ) || 0,

    needsManualEntry:
      Number(
        value.needsManualEntry
      ) || 0,

    failed:
      Number(value.failed) || 0,

    complete:
      Boolean(value.complete),

    processed:
      Array.isArray(
        value.processed
      )
        ? value.processed.map(
            phase4ImportSanitizeProcessedItem_
          )
        : []
  };
}

function phase4ImportSanitizeProcessedItem_(
  item
) {
  const value =
    item || {};

  return {
    importId:
      value.importId || '',

    batchId:
      value.batchId || '',

    sourceFileId:
      value.sourceFileId || '',

    sourceFileName:
      value.sourceFileName || '',

    status:
      value.status || '',

    fmrNumber:
      value.fmrNumber || '',

    revision:
      value.revision || '',

    iwpNumber:
      value.iwpNumber || '',

    materialLineCount:
      Number(
        value.materialLineCount
      ) || 0,

    stagedEntryRowCount:
      Number(
        value.stagedEntryRowCount
      ) || 0,

    confidencePct:
      Number(
        value.confidencePct
      ) || 0,

    warnings:
      phase4ImportSplitWarnings_(
        value.warnings
      ),

    message:
      phase4ImportSafeQueueMessage_(
        value.error
      ),

    fmrCount:
      Number(value.fmrCount) || 0,

    fmrNumbers:
      Array.isArray(
        value.fmrNumbers
      )
        ? value.fmrNumbers
        : [],

    duplicateFmrNumbers:
      Array.isArray(
        value.duplicateFmrNumbers
      )
        ? value.duplicateFmrNumbers
        : []
  };
}

function phase4ImportSanitizeQueueItem_(
  item
) {
  const value =
    item || {};

  return {
    importId:
      value.Import_ID ||
      value.importId ||
      '',

    batchId:
      value.Batch_ID ||
      value.batchId ||
      '',

    sourceFileId:
      value.Source_File_ID ||
      value.sourceFileId ||
      '',

    sourceFileName:
      value.Source_File_Name ||
      value.sourceFileName ||
      '',

    sourceFileUrl:
      value.Source_File_URL ||
      value.sourceFileUrl ||
      '',

    sourceMimeType:
      value.Source_Mime_Type ||
      value.sourceMimeType ||
      '',

    sourceModifiedAt:
      phase4ImportSafeDateValue_(
        value.Source_Modified_At ||
        value.sourceModifiedAt
      ),

    status:
      value.Import_Status ||
      value.status ||
      '',

    importMethod:
      value.Import_Method ||
      value.importMethod ||
      '',

    detectedTemplate:
      value.Detected_Template ||
      value.detectedTemplate ||
      '',

    fmrNumber:
      value.FMR_Number ||
      value.fmrNumber ||
      '',

    revision:
      value.Revision ||
      value.revision ||
      '',

    iwpNumber:
      value.IWP_Number ||
      value.iwpNumber ||
      '',

    isoLineNumber:
      value.ISO_Line_Number ||
      value.isoLineNumber ||
      '',

    isoSheet:
      value.ISO_Sheet ||
      value.isoSheet ||
      '',

    requestedBy:
      value.Requested_By ||
      value.requestedBy ||
      '',

    dateRequired:
      phase4ImportSafeDateValue_(
        value.Date_Required ||
        value.dateRequired
      ),

    materialLineCount:
      Number(
        value.Material_Line_Count ||
        value.materialLineCount
      ) || 0,

    confidencePct:
      Number(
        value.Confidence_Pct ||
        value.confidencePct
      ) || 0,

    warnings:
      phase4ImportSplitWarnings_(
        value.Warnings ||
        value.warnings
      ),

    message:
      phase4ImportSafeQueueMessage_(
        value.Error_Message ||
        value.error
      ),

    stagedEntryRowCount:
      Number(
        value.Staged_Entry_Row_Count ||
        value.stagedEntryRowCount
      ) || 0,

    startedAt:
      phase4ImportSafeDateValue_(
        value.Started_At ||
        value.startedAt
      ),

    completedAt:
      phase4ImportSafeDateValue_(
        value.Completed_At ||
        value.completedAt
      ),

    updatedAt:
      phase4ImportSafeDateValue_(
        value.Updated_At ||
        value.updatedAt
      )
  };
}

function phase4ImportSanitizeCounts_(
  counts
) {
  const source =
    counts || {};

  const output = {};

  Object.keys(source)
    .forEach(function (key) {
      output[key] =
        Number(source[key]) || 0;
    });

  return output;
}

function phase4ImportSplitWarnings_(
  value
) {
  if (Array.isArray(value)) {
    return value
      .map(function (item) {
        return String(item || '')
          .trim();
      })
      .filter(Boolean);
  }

  return String(value || '')
    .split(';')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function phase4ImportSafeDateValue_(
  value
) {
  if (!value) {
    return '';
  }

  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return value.toISOString();
  }

  const parsed =
    new Date(value);

  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return String(value);
}

function phase4ImportSafeQueueMessage_(
  value
) {
  const text =
    String(value || '')
      .trim();

  if (!text) {
    return '';
  }

  if (
    /already has active staging rows|already has active|already represented|duplicate/i
      .test(text)
  ) {
    return (
      'This FMR is already represented by active staging rows.'
    );
  }

  if (
    /no material lines|could not be extracted/i
      .test(text)
  ) {
    return (
      'No material lines could be extracted. Manual entry is required.'
    );
  }

  if (
    /no fmr number/i.test(text)
  ) {
    return (
      'No FMR number could be identified. Manual verification is required.'
    );
  }

  if (
    /appears to be an iso/i.test(text)
  ) {
    return (
      'The source appears to be an ISO rather than a completed FMR.'
    );
  }

  return (
    'The import requires administrator review. Check the server execution log for details.'
  );
}

function phase4ImportSafeErrorMessage_(
  error
) {
  const message =
    String(
      error &&
      error.message
        ? error.message
        : error || ''
    );

  if (
    /not authorized|role|assignment|caller|reviewer/i
      .test(message)
  ) {
    return (
      'Your account is not authorized for this batch or action.'
    );
  }

  if (
    /not configured|installadapter/i
      .test(message)
  ) {
    return (
      'The import application has not been configured by its owner.'
    );
  }

  if (
    /missing required import functions|does not expose|library version|incomplete/i
      .test(message)
  ) {
    return (
      'The import application is using an outdated FMRCore version.'
    );
  }

  if (
    /batch.*not found/i.test(message)
  ) {
    return (
      'The selected FMR batch was not found.'
    );
  }

  if (
    /another .* operation|try again shortly|lock/i
      .test(message)
  ) {
    return (
      'Another import operation is running. Try again shortly.'
    );
  }

  if (
    /required|invalid|too long|no more than/i
      .test(message)
  ) {
    return message;
  }

  if (
    /drive|permission|scope|authorization/i
      .test(message)
  ) {
    return (
      'The import server is missing a required Google Drive permission.'
    );
  }

  return (
    'The action could not be completed. An administrator can review the server execution log.'
  );
}

function phase4ImportErrorCode_(
  error
) {
  const message =
    String(
      error &&
      error.message
        ? error.message
        : error || ''
    );

  if (
    /not authorized|role|assignment|caller|reviewer/i
      .test(message)
  ) {
    return 'NOT_AUTHORIZED';
  }

  if (
    /required|invalid|too long|no more than/i
      .test(message)
  ) {
    return 'INVALID_REQUEST';
  }

  if (
    /not configured|installadapter/i
      .test(message)
  ) {
    return 'NOT_CONFIGURED';
  }

  if (
    /library version|missing required import functions|incomplete/i
      .test(message)
  ) {
    return 'CORE_VERSION_MISMATCH';
  }

  if (
    /another .* operation|try again shortly|lock/i
      .test(message)
  ) {
    return 'BUSY';
  }

  if (
    /not found/i.test(message)
  ) {
    return 'NOT_FOUND';
  }

  if (
    /drive|permission|scope|authorization/i
      .test(message)
  ) {
    return 'GOOGLE_AUTHORIZATION';
  }

  return 'INTERNAL_ERROR';
}

/* ========================================================================== */
/* LINK HELPERS                                                               */
/* ========================================================================== */

function phase4ImportSheetUrl_(
  spreadsheet,
  sheetName
) {
  const sheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (!sheet) {
    return spreadsheet.getUrl();
  }

  return (
    spreadsheet.getUrl() +
    '#gid=' +
    sheet.getSheetId()
  );
}
