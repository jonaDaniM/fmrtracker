/**
 * AdminPortalDataService.gs
 *
 * FMRCore v2.3.1 Admin portal read service.
 *
 * Responsibilities:
 * - Build the Admin Portal dashboard response.
 * - Search valid canonical FMR headers and material lines.
 * - Calculate Admin summary metrics.
 * - Return actionable Planning backorders.
 * - Return active Bag & Tag records.
 *
 * Depends on:
 * - PortalService.gs
 * - SerializationService.gs
 * - Repository.gs
 * - Security.gs
 * - BackorderService.gs
 *
 * This service performs no backorder decision writes.
 */

function getAdminPortalData_(
  userEmail,
  filters
) {
  const user =
    getAuthorizedUser_(
      userEmail,
      [
        FMR_CORE.ROLES.ADMIN,
        FMR_CORE.ROLES.PLANNER,
        FMR_CORE.ROLES.MATERIAL_CONTROL,
        FMR_CORE.ROLES.SUPERINTENDENT,
        FMR_CORE.ROLES.LEADERSHIP,
        FMR_CORE.ROLES.AUDITOR
      ],
      'ADMIN'
    );

  /*
   * Read each source sheet once for this request. All response sections use
   * the same in-memory snapshot, which prevents count/card discrepancies and
   * reduces repeated Spreadsheet service reads.
   */
  const snapshot =
    getAdminDataSnapshot_();

  const normalizedFilters =
    normalizeAdminFilters_(
      filters
    );

  const search =
    searchAdminFmrs_(
      normalizedFilters,
      snapshot
    );

  return {
    generatedAt:
      formatDateTime_(
        now_()
      ),

    user: {
      displayName:
        user.name,
      role:
        user.role,
      canReviewBackorders:
        canReviewBackorders_(
          user.role
        )
    },

    summary:
      getAdminSummary_(
        snapshot
      ),

    filters:
      getAdminFilterOptions_(
        snapshot
      ),

    resultCount:
      search.resultCount,

    truncated:
      search.truncated,

    fmrs:
      search.fmrs,

    pendingBackorders:
      getPendingBackorders_(
        snapshot
      ),

    activeBagTags:
      getActiveBagTags_(
        snapshot
      )
  };
}

function getAdminDataSnapshot_() {
  return {
    headers:
      getSheetData_(
        FMR_CORE.SHEETS.HEADERS
      ).rows,

    lines:
      getSheetData_(
        FMR_CORE.SHEETS.LINES
      ).rows,

    backorders:
      getSheetData_(
        FMR_CORE.SHEETS.BACKORDERS
      ).rows,

    bagHeaders:
      getSheetData_(
        FMR_CORE.SHEETS.BAG_HEADERS
      ).rows,

    bagItems:
      getSheetData_(
        FMR_CORE.SHEETS.BAG_ITEMS
      ).rows
  };
}

function normalizeAdminFilters_(
  filters
) {
  const source =
    filters || {};

  return {
    fmrNumber:
      normalize_(
        source.fmrNumber
      ),
    iwpNumber:
      normalize_(
        source.iwpNumber
      ),
    isoLineNumber:
      normalize_(
        source.isoLineNumber
      ),
    isoSheet:
      normalize_(
        source.isoSheet
      ),
    status:
      normalize_(
        source.status
      ),
    commodityCode:
      normalize_(
        source.commodityCode
      )
  };
}

function searchAdminFmrs_(
  filters,
  snapshot
) {
  const source =
    snapshot ||
    getAdminDataSnapshot_();

  const headers =
    source.headers
      .filter(
        isValidAdminHeader_
      );

  const lines =
    source.lines
      .filter(
        isValidAdminLine_
      );

  const headersById =
    Object.fromEntries(
      headers.map(
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

  const grouped = {};

  lines.forEach(
    function (materialLine) {
      const fmrId =
        normalize_(
          materialLine.FMR_ID
        );

      const header =
        headersById[
          fmrId
        ];

      /*
       * Do not create a card without a real canonical header. This removes
       * the blank "Sourcing" card and ensures resultCount represents actual
       * FMRs.
       */
      if (!header) {
        return;
      }

      const fmrNumber =
        normalize_(
          materialLine.FMR_Number ||
          header.FMR_Number
        );

      if (!fmrNumber) {
        return;
      }

      const matches =
        includesNormalized_(
          fmrNumber,
          filters.fmrNumber
        ) &&
        includesNormalized_(
          materialLine.IWP_Number ||
          header.IWP_Number,
          filters.iwpNumber
        ) &&
        includesNormalized_(
          materialLine.ISO_Line_Number,
          filters.isoLineNumber
        ) &&
        (
          !filters.isoSheet ||
          normalizeUpper_(
            materialLine.ISO_Sheet
          ) ===
          normalizeUpper_(
            filters.isoSheet
          )
        ) &&
        (
          !filters.status ||
          normalizeUpper_(
            header.Current_Status
          ) ===
          normalizeUpper_(
            filters.status
          )
        ) &&
        includesNormalized_(
          materialLine.Commodity_Code,
          filters.commodityCode
        );

      if (!matches) {
        return;
      }

      if (!grouped[fmrId]) {
        grouped[fmrId] = {
          fmrId,
          fmrNumber,
          iwpNumber:
            normalize_(
              materialLine.IWP_Number ||
              header.IWP_Number
            ),
          status:
            normalize_(
              header.Current_Status
            ),
          priority:
            normalize_(
              header.Priority
            ),
          requestedBy:
            normalize_(
              header.Requested_By
            ),
          dateRequired:
            formatDateTime_(
              header.Date_Required
            ),
          lastActivityAt:
            formatDateTime_(
              header.Last_Activity_At ||
              header.Updated_At
            ),
          materials: []
        };
      }

      grouped[fmrId]
        .materials
        .push(
          serializeMaterialLine_(
            materialLine
          )
        );
    }
  );

  const results =
    Object.values(
      grouped
    )
      .filter(
        function (card) {
          return Boolean(
            card.fmrId &&
            card.fmrNumber &&
            Array.isArray(
              card.materials
            ) &&
            card.materials.length > 0
          );
        }
      )
      .map(
        function (card) {
          return {
            ...card,
            totals:
              totalMaterials_(
                card.materials
              )
          };
        }
      )
      .sort(
        function (left, right) {
          return left.fmrNumber.localeCompare(
            right.fmrNumber,
            undefined,
            {
              numeric: true
            }
          );
        }
      );

  const limit =
    Math.max(
      1,
      number_(
        FMR_CORE.ADMIN_RESULT_LIMIT
      ) || 250
    );

  return {
    resultCount:
      results.length,
    truncated:
      results.length > limit,
    fmrs:
      results.slice(
        0,
        limit
      )
  };
}

function isValidAdminHeader_(
  row
) {
  return Boolean(
    normalize_(
      row && row.FMR_ID
    ) &&
    normalize_(
      row && row.FMR_Number
    )
  );
}

function isValidAdminLine_(
  row
) {
  return Boolean(
    normalize_(
      row && row.FMR_Line_ID
    ) &&
    normalize_(
      row && row.FMR_ID
    )
  );
}

function getAdminSummary_(
  snapshot
) {
  const source =
    snapshot ||
    getAdminDataSnapshot_();

  const headers =
    source.headers.filter(
      isValidAdminHeader_
    );

  const lines =
    source.lines.filter(
      isValidAdminLine_
    );

  const backorders =
    source.backorders.filter(
      isValidBackorderQueueRecord_
    );

  const bagHeaders =
    source.bagHeaders;

  const total =
    function (field) {
      return lines.reduce(
        function (sum, row) {
          return (
            sum +
            number_(
              row[field]
            )
          );
        },
        0
      );
    };

  const openHeaders =
    headers.filter(
      function (row) {
        return ![
          'CLOSED',
          'CANCELLED'
        ].includes(
          normalizeUpper_(
            row.Current_Status
          )
        );
      }
    );

  return {
    totalFmrs:
      headers.length,

    openFmrs:
      openHeaders.length,

    /*
     * Returned for Clarification is no longer a Planning-pending decision.
     * It should be corrected by the Field workflow before resubmission.
     */
    pendingBackorders:
      backorders.filter(
        function (row) {
          return isActionableBackorderStatus_(
            row.Status
          );
        }
      ).length,

    activeTags:
      bagHeaders.filter(
        function (row) {
          return [
            'ACTIVE',
            'PARTIALLY ISSUED'
          ].includes(
            normalizeUpper_(
              row.Status
            )
          );
        }
      ).length,

    qtyRequested:
      total('Qty_Requested'),
    qtyLocated:
      total('Qty_Confirmed_Located'),
    qtyBagged:
      total('Qty_Active_Bagged'),
    qtyAvailable:
      total('Qty_Available'),
    qtyIssued:
      total('Qty_Issued'),
    qtyConfirmedBackorder:
      total('Qty_Confirmed_Backorder')
  };
}

function getAdminFilterOptions_(
  snapshot
) {
  const source =
    snapshot ||
    getAdminDataSnapshot_();

  const headers =
    source.headers.filter(
      isValidAdminHeader_
    );

  const lines =
    source.lines.filter(
      isValidAdminLine_
    );

  return {
    statuses:
      uniqueSorted_(
        headers.map(
          function (row) {
            return row.Current_Status;
          }
        )
      ),

    iwps:
      uniqueSorted_(
        [
          ...headers.map(
            function (row) {
              return row.IWP_Number;
            }
          ),
          ...lines.map(
            function (row) {
              return row.IWP_Number;
            }
          )
        ]
      )
  };
}

function getPendingBackorders_(
  snapshot
) {
  const source =
    snapshot ||
    getAdminDataSnapshot_();

  const requests =
    source.backorders
      .filter(
        isValidBackorderQueueRecord_
      )
      .filter(
        function (row) {
          return isActionableBackorderStatus_(
            row.Status
          );
        }
      );

  const linesById =
    Object.fromEntries(
      source.lines
        .filter(
          isValidAdminLine_
        )
        .map(
          function (row) {
            return [
              normalize_(
                row.FMR_Line_ID
              ),
              row
            ];
          }
        )
    );

  return requests
    .map(
      function (request) {
        const line =
          linesById[
            normalize_(
              request.FMR_Line_ID
            )
          ];

        if (!line) {
          return null;
        }

        const qtyRequested =
          number_(
            request.Qty_Requested_Backorder
          );

        const qtyConfirmed =
          number_(
            request.Qty_Confirmed_Backorder
          );

        return {
          requestId:
            normalize_(
              request.Backorder_Request_ID
            ),
          fmrId:
            normalize_(
              request.FMR_ID
            ),
          fmrNumber:
            normalize_(
              request.FMR_Number
            ),
          fmrLineId:
            normalize_(
              request.FMR_Line_ID
            ),
          iwpNumber:
            normalize_(
              line.IWP_Number
            ),
          isoLineNumber:
            normalize_(
              line.ISO_Line_Number
            ),
          isoSheet:
            normalize_(
              line.ISO_Sheet
            ),
          commodityCode:
            normalize_(
              request.Commodity_Code ||
              line.Commodity_Code
            ),
          description:
            normalize_(
              line.Material_Description
            ),
          qtyRequestedBackorder:
            qtyRequested,
          qtyConfirmedBackorder:
            qtyConfirmed,
          qtyPending:
            Math.max(
              0,
              qtyRequested -
              qtyConfirmed
            ),
          reason:
            normalize_(
              request.Reason
            ),
          fieldNotes:
            normalize_(
              request.Field_Notes
            ),
          reportedBy:
            normalize_(
              request.Reported_By_Name
            ),
          reportedAt:
            formatDateTime_(
              request.Reported_At
            ),
          status:
            normalize_(
              request.Status
            ),
          planningNotes:
            normalize_(
              request.Planning_Notes
            )
        };
      }
    )
    .filter(Boolean)
    .filter(
      function (item) {
        return (
          item.requestId &&
          item.fmrId &&
          item.fmrNumber &&
          item.fmrLineId &&
          item.qtyPending > 0
        );
      }
    )
    .sort(
      function (left, right) {
        return left.reportedAt.localeCompare(
          right.reportedAt
        );
      }
    );
}

function isValidBackorderQueueRecord_(
  row
) {
  return Boolean(
    normalize_(
      row &&
      row.Backorder_Request_ID
    ) &&
    normalize_(
      row &&
      row.FMR_ID
    ) &&
    normalize_(
      row &&
      row.FMR_Line_ID
    ) &&
    number_(
      row &&
      row.Qty_Requested_Backorder
    ) > 0
  );
}

function getActiveBagTags_(
  snapshot
) {
  const source =
    snapshot ||
    getAdminDataSnapshot_();

  const headers =
    source.bagHeaders.filter(
      function (row) {
        return [
          'ACTIVE',
          'PARTIALLY ISSUED'
        ].includes(
          normalizeUpper_(
            row.Status
          )
        );
      }
    );

  const items =
    source.bagItems;

  const itemsByBag = {};

  items.forEach(
    function (item) {
      const bagId =
        normalize_(
          item.Bag_Tag_ID
        );

      if (!bagId) {
        return;
      }

      if (!itemsByBag[bagId]) {
        itemsByBag[bagId] = [];
      }

      itemsByBag[bagId].push({
        commodityCode:
          normalize_(
            item.Commodity_Code
          ),
        size:
          normalize_(
            item.Size
          ),
        description:
          normalize_(
            item.Material_Description
          ),
        qtyBagged:
          number_(
            item.Qty_Bagged
          ),
        qtyIssuedFromBag:
          number_(
            item.Qty_Issued_From_Bag
          ),
        qtyRemainingInBag:
          number_(
            item.Qty_Remaining_In_Bag
          ),
        uom:
          normalize_(
            item.UOM
          )
      });
    }
  );

  return headers
    .filter(
      function (header) {
        return Boolean(
          normalize_(
            header.Bag_Tag_ID
          ) &&
          normalize_(
            header.FMR_ID
          ) &&
          normalize_(
            header.FMR_Number
          )
        );
      }
    )
    .map(
      function (header) {
        return {
          bagTagId:
            normalize_(
              header.Bag_Tag_ID
            ),
          tagNumber:
            normalize_(
              header.Tag_Number
            ),
          fmrId:
            normalize_(
              header.FMR_ID
            ),
          fmrNumber:
            normalize_(
              header.FMR_Number
            ),
          iwpNumber:
            normalize_(
              header.IWP_Number
            ),
          isoLineNumber:
            normalize_(
              header.ISO_Line_Number
            ),
          isoSheet:
            normalize_(
              header.ISO_Sheet
            ),
          storageLocation:
            normalize_(
              header.Storage_Location
            ),
          baggedBy:
            normalize_(
              header.Bagged_By_Name
            ),
          baggedAt:
            formatDateTime_(
              header.Bagged_At
            ),
          status:
            normalize_(
              header.Status
            ),
          items:
            itemsByBag[
              normalize_(
                header.Bag_Tag_ID
              )
            ] || []
        };
      }
    )
    .sort(
      function (left, right) {
        return left.tagNumber.localeCompare(
          right.tagNumber,
          undefined,
          {
            numeric: true
          }
        );
      }
    );
}
