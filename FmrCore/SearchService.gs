/** Returns separate matching FMR cards; quantities are never combined across FMRs.  SearchService.gs*/
function searchByLineAndSheet_(userEmail, lineNumber, sheetNumber, sourceInterface, auditSearch) {
  const user = getAuthorizedUser_(userEmail, [
    FMR_CORE.ROLES.ADMIN,
    FMR_CORE.ROLES.PLANNER,
    FMR_CORE.ROLES.MATERIAL_CONTROL,
    FMR_CORE.ROLES.FIELD_HANDLER,
    FMR_CORE.ROLES.FOREMAN,
    FMR_CORE.ROLES.SUPERINTENDENT,
    FMR_CORE.ROLES.LEADERSHIP,
    FMR_CORE.ROLES.AUDITOR
  ], sourceInterface);

  const line = normalizeUpper_(lineNumber);
  const sheet = normalizeUpper_(sheetNumber);
  lineSheetKey_(line, sheet);

  const lines = getSheetData_(FMR_CORE.SHEETS.LINES).rows.filter(row =>
    normalizeUpper_(row.ISO_Line_Number) === line &&
    normalizeUpper_(row.ISO_Sheet) === sheet
  );

  const headersById = Object.fromEntries(
    getSheetData_(FMR_CORE.SHEETS.HEADERS).rows.map(row => [normalize_(row.FMR_ID), row])
  );

  const grouped = {};
  lines.forEach(materialLine => {
    const fmrId = normalize_(materialLine.FMR_ID);
    if (!grouped[fmrId]) {
      const header = headersById[fmrId] || {};
      grouped[fmrId] = {
        fmrId,
        fmrNumber: normalize_(materialLine.FMR_Number || header.FMR_Number),
        iwpNumber: normalize_(materialLine.IWP_Number || header.IWP_Number),
        status: normalize_(header.Current_Status),
        priority: normalize_(header.Priority),
        requestedBy: normalize_(header.Requested_By),
        isoLineNumber: normalize_(materialLine.ISO_Line_Number),
        isoSheet: normalize_(materialLine.ISO_Sheet),
        materials: []
      };
    }

    grouped[fmrId].materials.push(serializeMaterialLine_(materialLine));
  });

  if (auditSearch !== false) {
    writeAudit_(
      'SEARCH',
      lineSheetKey_(line, sheet),
      'SEARCH_LINE_SHEET',
      user,
      '',
      {resultCount: Object.keys(grouped).length}
    );
  }

  return Object.values(grouped)
    .map(card => ({...card, totals: totalMaterials_(card.materials)}))
    .sort((a, b) =>
      a.fmrNumber.localeCompare(b.fmrNumber, undefined, {numeric: true, sensitivity: 'base'})
    );
}
