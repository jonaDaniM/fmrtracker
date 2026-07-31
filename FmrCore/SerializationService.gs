/**
 * SerializationService.gs
 *
 * Shared read-only serialization functions for FMRCore.
 *
 * Responsibilities:
 * - Convert canonical FMR header records into client-safe objects.
 * - Convert canonical FMR material-line records into the shared material DTO.
 * - Aggregate serialized material quantities for Field and Admin cards.
 *
 * This service performs no spreadsheet reads, writes, authorization, or
 * quantity recalculation.
 */

/**
 * Converts a canonical FMR_Header row into a client-safe object.
 *
 * The canonical header field names are intentionally preserved because
 * PublicApi.getFmrDetail() may expose the complete header record.
 *
 * Internal repository metadata such as _rowNumber is excluded.
 * Date values are converted to strings so they can cross the Apps Script
 * library and web-app boundary safely.
 *
 * @param {Object} header Canonical FMR_Header row.
 * @return {Object} Serialized header record.
 */
/**
 * Converts a Date into a client-safe display string without reading the
 * database Configuration sheet.
 *
 * Serializers must remain usable before a database context is initialized.
 *
 * @param {Date} value Valid Date object.
 * @return {string} Formatted date/time.
 */
function serializeDateTime_(value) {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    return '';
  }

  const timezone =
    Session.getScriptTimeZone() ||
    'America/Indiana/Indianapolis';

  return Utilities.formatDate(
    value,
    timezone,
    'yyyy-MM-dd HH:mm'
  );
}

function serializeHeader_(header) {
  const source =
    header || {};

  const serialized = {};

  Object.keys(source).forEach(
    function (key) {
      if (key === '_rowNumber') {
        return;
      }

      const value =
        source[key];

      if (
        value instanceof Date &&
        !Number.isNaN(value.getTime())
      ) {
        serialized[key] =
          serializeDateTime_(value);

        return;
      }

      serialized[key] =
        value;
    }
  );

  return serialized;
}

/**
 * Converts a canonical FMR_Line_Items row into the shared material contract.
 *
 * This function intentionally returns only base material information.
 * FieldService.gs later enriches this object with:
 * - actionLimits;
 * - activeBags;
 * - eligibleExistingTags.
 *
 * @param {Object} line Canonical FMR_Line_Items row.
 * @return {Object} Serialized material record.
 */
function serializeMaterialLine_(line) {
  const source =
    line || {};

  return {
    fmrLineId:
      normalize_(
        source.FMR_Line_ID
      ),

    isoLineNumber:
      normalize_(
        source.ISO_Line_Number
      ),

    isoSheet:
      normalize_(
        source.ISO_Sheet
      ),

    commodityCode:
      normalize_(
        source.Commodity_Code
      ),

    size:
      normalize_(
        source.Size
      ),

    description:
      normalize_(
        source.Material_Description
      ),

    uom:
      normalize_(
        source.UOM
      ),

    qtyRequested:
      number_(
        source.Qty_Requested
      ),

    qtyConfirmedLocated:
      number_(
        source.Qty_Confirmed_Located
      ),

    qtyActiveBagged:
      number_(
        source.Qty_Active_Bagged
      ),

    qtyAvailable:
      number_(
        source.Qty_Available
      ),

    qtyIssued:
      number_(
        source.Qty_Issued
      ),

    qtyPendingBackorder:
      number_(
        source.Qty_Pending_Backorder
      ),

    qtyConfirmedBackorder:
      number_(
        source.Qty_Confirmed_Backorder
      ),

    qtyRemainingRequirement:
      number_(
        source.Qty_Remaining_Requirement
      ),

    lineStatus:
      normalize_(
        source.Line_Status
      ),

    storageLocation:
      normalize_(
        source.Storage_Location
      )
  };
}

/**
 * Aggregates the quantity fields from serialized material records.
 *
 * Invalid, blank, or missing quantity values are treated as zero through
 * the shared number_() helper.
 *
 * @param {Object[]} materials Serialized material records.
 * @return {Object} Aggregated material quantities.
 */
function totalMaterials_(materials) {
  const source =
    Array.isArray(materials)
      ? materials
      : [];

  const total =
    function (field) {
      return source.reduce(
        function (sum, material) {
          return (
            sum +
            number_(
              material &&
              material[field]
            )
          );
        },
        0
      );
    };

  return {
    requested:
      total('qtyRequested'),

    located:
      total('qtyConfirmedLocated'),

    bagged:
      total('qtyActiveBagged'),

    available:
      total('qtyAvailable'),

    issued:
      total('qtyIssued'),

    pendingBackorder:
      total('qtyPendingBackorder'),

    confirmedBackorder:
      total('qtyConfirmedBackorder'),

    remaining:
      total('qtyRemainingRequirement')
  };
}