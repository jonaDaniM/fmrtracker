/**
 * Phase4_FmrTemplateParser.gs
 *
 * Pure parser for the known Turner FIELD MATERIAL REQUEST / RETURN template.
 *
 * THIS FILE BELONGS IN FMRCORE.
 *
 * This file does not call Drive, Docs, Sheets, PropertiesService, or any paid
 * Google Cloud service. It parses already-extracted text or spreadsheet cells.
 */

const FMR_TEMPLATE_PARSER = Object.freeze({
  componentVersion: 'turner-fmr-template-parser-v1.0.2-matrix-header-fix',

  labels: Object.freeze({
    destination: /^DESTINATION\s*:?$/i,
    warehouse: /^WAREHOUSE\s*:?$/i,
    requestedBy: /^REQUESTED\s+BY\s*:?$/i,
    craft: /^CRAFT\s*:?$/i,
    iwp: /^IWP\s*:?$/i,
    fmrNumber: /^FMR\s+NO\.?\s*:?$/i,
    deliverTo: /^DELIVER\s+TO\s*:?$/i,
    dateRequired: /^DATE\s+REQUIRED\s*:?$/i,
    lineNumber: /^LINE\s+NO\.?\s*:?$/i,
    sheet: /^SHT\.?\s*:?$/i,
    revision: /^REV\.?\s*:?$/i
  }),

  materialHeaders: Object.freeze({
    commodityCode: /COMMODITY\s+CODE/i,
    size: /^SIZE$/i,
    quantity: /^QUANTITY$/i,
    description: /MATERIAL\s+DESCRIPTION/i
  })
});

/* ========================================================================== */
/* PUBLIC PARSER API                                                          */
/* ========================================================================== */

function getFmrTemplateParserVersion() {
  return {
    schemaVersion: FMR_IMPORT_CONFIG.schemaVersion,
    component: FMR_TEMPLATE_PARSER.componentVersion
  };
}

/**
 * Parses text produced from a completed FMR PDF.
 *
 * @param {string} text
 * @param {Object=} context
 * @return {Object}
 */
function parseKnownFmrText(text, context) {
  const sourceText = normalizeFmrParserText_(text);
  const sourceLines = sourceText
    .split(/\n+/)
    .map(normalizeFmrParserLine_)
    .filter(Boolean);

  const result = createEmptyFmrParseResult_(context);

  result.rawTextLength = sourceText.length;
  result.detectedTemplate =
    FMR_IMPORT_CONFIG.regex.fmrTitle.test(sourceText)
      ? FMR_IMPORT_CONFIG.templates.TURNER_FMR_V1
      : FMR_IMPORT_CONFIG.templates.UNKNOWN;

  if (
    FMR_IMPORT_CONFIG.regex.probableIsoTitle.test(sourceText) &&
    !FMR_IMPORT_CONFIG.regex.fmrTitle.test(sourceText)
  ) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.POSSIBLE_ISO_DOCUMENT
    );
  }

  result.header.destination = findFmrTextLabelValue_(
    sourceLines,
    ['DESTINATION']
  );

  result.header.warehouse = findFmrTextLabelValue_(
    sourceLines,
    ['WAREHOUSE']
  );

  result.header.requestedBy = findFmrTextLabelValue_(
    sourceLines,
    ['REQUESTED BY']
  );

  result.header.craft = findFmrTextLabelValue_(
    sourceLines,
    ['CRAFT']
  );

  result.header.iwpNumber = findFmrTextLabelValue_(
    sourceLines,
    ['IWP']
  );

  result.header.fmrNumber = findFmrTextLabelValue_(
    sourceLines,
    ['FMR NO.', 'FMR NO', 'FMR NUMBER']
  );

  result.header.deliverTo = findFmrTextLabelValue_(
    sourceLines,
    ['DELIVER TO']
  );

  result.header.dateRequired = findFmrTextLabelValue_(
    sourceLines,
    ['DATE REQUIRED']
  );

  result.header.isoLineNumber = findFmrTextLabelValue_(
    sourceLines,
    ['LINE NO.', 'LINE NO', 'LINE NUMBER']
  );

  parseFmrTextSheetRevision_(sourceLines, result);
  normalizeFmrParsedIdentifiers_(result);
  result.materialLines = parseFmrTextMaterialRows_(sourceLines, result);

  applyFmrParserFilenameFallback_(result, context);
  finalizeFmrParseResult_(result);

  return result;
}

/**
 * Parses a two-dimensional array read from a Google Sheet or converted XLSX.
 *
 * @param {Array<Array<*>>} matrix
 * @param {Object=} context
 * @return {Object}
 */
function parseKnownFmrMatrix(matrix, context) {
  const values = Array.isArray(matrix)
    ? matrix.map(function (row) {
        return Array.isArray(row)
          ? row.map(function (value) {
              return normalizeFmrParserLine_(value);
            })
          : [];
      })
    : [];

  const result = createEmptyFmrParseResult_(context);
  result.detectedTemplate = detectFmrMatrixTemplate_(values);

  result.header.destination = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.destination
  );

  result.header.warehouse = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.warehouse
  );

  result.header.requestedBy = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.requestedBy
  );

  result.header.craft = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.craft
  );

  result.header.iwpNumber = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.iwp
  );

  result.header.fmrNumber = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.fmrNumber
  );

  result.header.deliverTo = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.deliverTo
  );

  result.header.dateRequired = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.dateRequired
  );

  result.header.isoLineNumber = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.lineNumber
  );

  result.header.isoSheet = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.sheet
  );

  result.header.revision = findFmrMatrixLabelValue_(
    values,
    FMR_TEMPLATE_PARSER.labels.revision
  );

  normalizeFmrParsedIdentifiers_(result);

  result.materialLines = parseFmrMatrixMaterialRows_(
    values,
    result
  );

  applyFmrParserFilenameFallback_(result, context);
  finalizeFmrParseResult_(result);

  return result;
}

/* ========================================================================== */
/* RESULT MODEL                                                               */
/* ========================================================================== */

function createEmptyFmrParseResult_(context) {
  const source = context || {};

  return {
    parserVersion: FMR_TEMPLATE_PARSER.componentVersion,
    detectedTemplate: FMR_IMPORT_CONFIG.templates.UNKNOWN,
    sourceFileId: normalizeFmrParserLine_(source.sourceFileId),
    sourceFileName: normalizeFmrParserLine_(source.sourceFileName),
    sourceFileUrl: normalizeFmrParserLine_(source.sourceFileUrl),
    rawTextLength: 0,
    header: {
      fmrNumber: '',
      revision: '',
      iwpNumber: '',
      requestedBy: '',
      requestedByEmail: '',
      craft: '',
      deliverTo: '',
      destination: '',
      warehouse: '',
      requestDate: '',
      dateRequired: '',
      isoLineNumber: '',
      isoSheet: '',
      isoDrawingNumber: ''
    },
    materialLines: [],
    warnings: [],
    errors: [],
    confidencePct: 0,
    requiresVerification: true
  };
}

/* ========================================================================== */
/* TEXT LABEL PARSING                                                         */
/* ========================================================================== */

function findFmrTextLabelValue_(lines, labelVariants) {
  const knownLabels = [
    'DESTINATION',
    'WAREHOUSE',
    'REQUESTED BY',
    'CRAFT',
    'IWP',
    'FMR NO.',
    'FMR NO',
    'FMR NUMBER',
    'DELIVER TO',
    'DATE REQUIRED',
    'LINE NO.',
    'LINE NO',
    'LINE NUMBER',
    'SHT.',
    'SHT',
    'SHEET',
    'REV.',
    'REV',
    'REVISION'
  ];

  for (let index = 0; index < lines.length; index++) {
    const line = normalizeFmrParserLine_(lines[index]);

    for (
      let labelIndex = 0;
      labelIndex < labelVariants.length;
      labelIndex++
    ) {
      const variant = labelVariants[labelIndex];
      const targetRegex = new RegExp(
        '(^|\\s)' +
        escapeFmrParserRegex_(variant) +
        '\\s*:?\\s*',
        'i'
      );
      const match = targetRegex.exec(line);

      if (!match) {
        continue;
      }

      const valueStart = match.index + match[0].length;
      const remainder = line.substring(valueStart);

      let nextLabelIndex = remainder.length;

      knownLabels.forEach(function (knownLabel) {
        const knownRegex = new RegExp(
          '(^|\\s)' +
          escapeFmrParserRegex_(knownLabel) +
          '\\s*:?\\s*',
          'i'
        );
        const knownMatch = knownRegex.exec(remainder);

        if (
          knownMatch &&
          knownMatch.index < nextLabelIndex
        ) {
          nextLabelIndex = knownMatch.index;
        }
      });

      const inlineValue = normalizeFmrParserLine_(
        remainder.substring(0, nextLabelIndex)
      ).replace(/^[:.\s]+|[:.\s]+$/g, '');

      if (inlineValue) {
        return inlineValue;
      }

      const targetIsLastLabel =
        nextLabelIndex === remainder.length;

      if (targetIsLastLabel) {
        return findImmediateNextFmrTextValue_(
          lines,
          index + 1
        );
      }

      return '';
    }
  }

  return '';
}

function findImmediateNextFmrTextValue_(lines, startIndex) {
  for (
    let index = startIndex;
    index < Math.min(lines.length, startIndex + 3);
    index++
  ) {
    const candidate = normalizeFmrParserLine_(lines[index]);

    if (!candidate) {
      continue;
    }

    if (isFmrParserLabelLine_(candidate)) {
      return '';
    }

    if (
      /^(Commodity Code|Size|Quantity|Material Description|Issued|Back Ordered|Action Taken)$/i.test(
        candidate
      )
    ) {
      return '';
    }

    return candidate;
  }

  return '';
}

function findNextFmrTextValue_(lines, startIndex) {
  for (
    let index = startIndex;
    index < Math.min(lines.length, startIndex + 4);
    index++
  ) {
    const candidate = normalizeFmrParserLine_(lines[index]);

    if (!candidate) {
      continue;
    }

    if (isFmrParserLabelLine_(candidate)) {
      continue;
    }

    if (
      /^(Commodity Code|Size|Quantity|Material Description|Issued|Back Ordered|Action Taken)$/i.test(
        candidate
      )
    ) {
      continue;
    }

    return candidate;
  }

  return '';
}

function isFmrParserLabelLine_(value) {
  const line = normalizeFmrParserLabel_(value);

  return [
    'DESTINATION',
    'WAREHOUSE',
    'REQUESTED BY',
    'CRAFT',
    'IWP',
    'FMR NO',
    'FMR NUMBER',
    'DELIVER TO',
    'DATE REQUIRED',
    'LINE NO',
    'LINE NUMBER',
    'SHT',
    'REV'
  ].some(function (label) {
    return (
      line === label ||
      line.indexOf(label + ' ') === 0 ||
      line.indexOf(' ' + label) !== -1
    );
  });
}

function parseFmrTextSheetRevision_(
  lines,
  result
) {
  const labelIndex = lines.findIndex(function (line) {
    return /\bSHT\.?\s*:?\b|\bREV\.?\s*:?\b/i.test(line);
  });

  const materialHeaderIndex = lines.findIndex(function (line) {
    return /COMMODITY\s+CODE/i.test(line);
  });

  if (labelIndex === -1) {
    result.header.isoSheet = '';
    result.header.revision = '';
    return;
  }

  const boundary =
    materialHeaderIndex > labelIndex
      ? materialHeaderIndex
      : Math.min(lines.length, labelIndex + 6);

  const candidates = [];

  for (
    let index = labelIndex + 1;
    index < boundary;
    index++
  ) {
    const candidate = normalizeFmrParserLine_(lines[index]);

    if (
      !candidate ||
      isFmrParserLabelLine_(candidate) ||
      /COMMODITY\s+CODE|MATERIAL\s+DESCRIPTION|ISSUED|BACK\s+ORDERED|ACTION\s+TAKEN/i.test(
        candidate
      )
    ) {
      continue;
    }

    if (
      FMR_IMPORT_CONFIG.regex.revision.test(candidate) &&
      candidate.length <= 20
    ) {
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) {
    result.header.isoSheet = '';
    result.header.revision =
      candidates[candidates.length - 1];

    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.ISO_SHEET_AMBIGUOUS
    );

    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.REVISION_AMBIGUOUS
    );

    return;
  }

  const explicitSheet = findFmrTextLabelValue_(
    lines,
    ['SHT.', 'SHT', 'SHEET']
  );

  const explicitRevision = findFmrTextLabelValue_(
    lines,
    ['REV.', 'REV', 'REVISION']
  );

  result.header.isoSheet =
    sanitizeFmrParserShortIdentifier_(
      explicitSheet,
      20
    );

  result.header.revision =
    sanitizeFmrParserShortIdentifier_(
      explicitRevision,
      20
    );
}

/* ========================================================================== */
/* TEXT MATERIAL TABLE                                                        */
/* ========================================================================== */

function parseFmrTextMaterialRows_(lines, result) {
  const start = lines.findIndex(function (line) {
    return /COMMODITY\s+CODE/i.test(line);
  });

  if (start === -1) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.MATERIAL_LINES_MISSING
    );
    return [];
  }

  let end = lines.findIndex(function (line, index) {
    return (
      index > start &&
      /REASON\s+REQUIRED|ACTION\s+TAKEN|SIGNATURE/i.test(line)
    );
  });

  if (end === -1) {
    end = lines.length;
  }

  const rows = [];
  let current = null;

  for (let index = start + 1; index < end; index++) {
    const line = normalizeFmrParserLine_(lines[index]);

    if (
      !line ||
      /^(SIZE|QUANTITY|MATERIAL DESCRIPTION|ISSUED|BACK ORDERED|ACTION TAKEN)$/i.test(
        line
      )
    ) {
      continue;
    }

    const parsed = parseFmrTextMaterialStartLine_(line);

    if (parsed) {
      if (current) {
        rows.push(finalizeFmrMaterialLine_(current, rows.length + 1, result));
      }

      current = parsed;
      continue;
    }

    if (current) {
      current.materialDescription = normalizeFmrParserLine_(
        current.materialDescription + ' ' + line
      );
      current.descriptionWrapped = true;
    }
  }

  if (current) {
    rows.push(finalizeFmrMaterialLine_(current, rows.length + 1, result));
  }

  if (rows.length === 0) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.MATERIAL_LINES_MISSING
    );
  }

  return rows;
}

function parseFmrTextMaterialStartLine_(line) {
  const tokens = normalizeFmrParserLine_(line).split(/\s+/);

  if (tokens.length < 3) {
    return null;
  }

  const commodityCode = tokens[0];
  const size = tokens[1];

  if (
    !FMR_IMPORT_CONFIG.regex.commodityCode.test(commodityCode) ||
    !FMR_IMPORT_CONFIG.regex.probableSize.test(size)
  ) {
    return null;
  }

  let quantity = '';
  let descriptionStart = 2;

  if (
    tokens.length > 3 &&
    FMR_IMPORT_CONFIG.regex.numericQuantity.test(tokens[2])
  ) {
    quantity = Number(tokens[2]);
    descriptionStart = 3;
  }

  const materialDescription = tokens
    .slice(descriptionStart)
    .join(' ');

  return {
    commodityCode,
    size,
    quantity,
    materialDescription,
    uom: FMR_IMPORT_CONFIG.defaults.defaultUom,
    descriptionWrapped: false
  };
}

function finalizeFmrMaterialLine_(line, lineNumber, result) {
  const output = {
    fmrLineNumber: String(lineNumber),
    commodityCode: normalizeFmrParserLine_(line.commodityCode),
    size: normalizeFmrParserLine_(line.size),
    quantity:
      line.quantity === '' || line.quantity === null
        ? ''
        : Number(line.quantity),
    materialDescription: normalizeFmrParserLine_(
      line.materialDescription
    ),
    uom: normalizeFmrParserLine_(
      line.uom || FMR_IMPORT_CONFIG.defaults.defaultUom
    ).toUpperCase(),
    isPipe: /^\s*PIPE(?:\s|$)/i.test(
      normalizeFmrParserLine_(line.materialDescription)
    ),
    confidencePct: 100,
    warnings: []
  };

  if (output.quantity === '') {
    output.confidencePct -= 30;
    output.warnings.push(
      FMR_IMPORT_CONFIG.warningCodes.QUANTITY_MISSING
    );
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.QUANTITY_MISSING
    );
  }

  if (!output.materialDescription) {
    output.confidencePct -= 40;
  }

  if (line.descriptionWrapped) {
    output.warnings.push(
      FMR_IMPORT_CONFIG.warningCodes.DESCRIPTION_WRAPPED
    );
  }

  return output;
}

/* ========================================================================== */
/* MATRIX PARSING                                                             */
/* ========================================================================== */

function detectFmrMatrixTemplate_(matrix) {
  const joined = matrix
    .map(function (row) {
      return row.join(' ');
    })
    .join('\n');

  return FMR_IMPORT_CONFIG.regex.fmrTitle.test(joined)
    ? FMR_IMPORT_CONFIG.templates.TURNER_FMR_V1
    : FMR_IMPORT_CONFIG.templates.UNKNOWN;
}

function findFmrMatrixLabelValue_(
  matrix,
  labelRegex
) {
  for (
    let rowIndex = 0;
    rowIndex < matrix.length;
    rowIndex++
  ) {
    const row = matrix[rowIndex] || [];

    for (
      let columnIndex = 0;
      columnIndex < row.length;
      columnIndex++
    ) {
      const cell =
        normalizeFmrParserLine_(
          row[columnIndex]
        );

      if (!cell) {
        continue;
      }

      const colonIndex =
        cell.indexOf(':');

      const labelCandidate =
        normalizeFmrParserLine_(
          colonIndex >= 0
            ? cell.substring(0, colonIndex)
            : cell
        );

      if (!labelRegex.test(labelCandidate)) {
        continue;
      }

      /*
       * The known Turner workbook stores header labels and values inside
       * the same merged cell, frequently separated by a newline:
       *
       *   IWP: SMM30R101MMPP-K477
       *   REV:
       *   1
       *
       * By the time the matrix is normalized, that becomes "REV: 1".
       * A matched label with no trailing value is intentionally returned as
       * blank. We do not search several rows downward because that previously
       * allowed table headers such as "Commodity Code" and "Back Ordered" to
       * become FMR header values.
       */
      if (colonIndex >= 0) {
        return normalizeFmrParserLine_(
          cell.substring(colonIndex + 1)
        );
      }

      /*
       * Support a template where the label occupies one cell and the value is
       * in the immediately adjacent cell. Do not search beyond one cell.
       */
      const adjacent =
        normalizeFmrParserLine_(
          row[columnIndex + 1]
        );

      if (
        adjacent &&
        !isFmrParserLabelLine_(adjacent)
      ) {
        return adjacent;
      }

      return '';
    }
  }

  return '';
}

function parseFmrMatrixMaterialRows_(matrix, result) {
  let headerRowIndex = -1;
  let columns = null;

  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex];
    const detected = detectFmrMaterialColumns_(row);

    if (
      detected.commodityCode >= 0 &&
      detected.size >= 0 &&
      detected.quantity >= 0 &&
      detected.description >= 0
    ) {
      headerRowIndex = rowIndex;
      columns = detected;
      break;
    }
  }

  if (headerRowIndex === -1) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.MATERIAL_LINES_MISSING
    );
    return [];
  }

  const rows = [];
  let consecutiveBlankRows = 0;

  for (
    let rowIndex = headerRowIndex + 1;
    rowIndex < matrix.length;
    rowIndex++
  ) {
    const row = matrix[rowIndex] || [];
    const commodityCode = normalizeFmrParserLine_(
      row[columns.commodityCode]
    );
    const size = normalizeFmrParserLine_(row[columns.size]);
    const quantityText = normalizeFmrParserLine_(
      row[columns.quantity]
    );
    const description = normalizeFmrParserLine_(
      row[columns.description]
    );

    const joined = row.join(' ');

    if (/REASON\s+REQUIRED|ACTION\s+TAKEN|SIGNATURE/i.test(joined)) {
      break;
    }

    if (!commodityCode && !size && !quantityText && !description) {
      consecutiveBlankRows++;

      if (consecutiveBlankRows >= 2 && rows.length > 0) {
        break;
      }

      continue;
    }

    consecutiveBlankRows = 0;

    if (!commodityCode) {
      if (rows.length > 0 && description) {
        rows[rows.length - 1].materialDescription =
          normalizeFmrParserLine_(
            rows[rows.length - 1].materialDescription +
            ' ' +
            description
          );
        rows[rows.length - 1].warnings.push(
          FMR_IMPORT_CONFIG.warningCodes.DESCRIPTION_WRAPPED
        );
      }

      continue;
    }

    const quantity =
      FMR_IMPORT_CONFIG.regex.numericQuantity.test(quantityText)
        ? Number(quantityText)
        : '';

    rows.push(
      finalizeFmrMaterialLine_(
        {
          commodityCode,
          size,
          quantity,
          materialDescription: description,
          uom: FMR_IMPORT_CONFIG.defaults.defaultUom,
          descriptionWrapped: false
        },
        rows.length + 1,
        result
      )
    );
  }

  if (rows.length === 0) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.MATERIAL_LINES_MISSING
    );
  }

  return rows;
}

function detectFmrMaterialColumns_(row) {
  const output = {
    commodityCode: -1,
    size: -1,
    quantity: -1,
    description: -1
  };

  (row || []).forEach(function (value, index) {
    const cell = normalizeFmrParserLine_(value);

    if (
      output.commodityCode === -1 &&
      FMR_TEMPLATE_PARSER.materialHeaders.commodityCode.test(cell)
    ) {
      output.commodityCode = index;
    } else if (
      output.size === -1 &&
      FMR_TEMPLATE_PARSER.materialHeaders.size.test(cell)
    ) {
      output.size = index;
    } else if (
      output.quantity === -1 &&
      FMR_TEMPLATE_PARSER.materialHeaders.quantity.test(cell)
    ) {
      output.quantity = index;
    } else if (
      output.description === -1 &&
      FMR_TEMPLATE_PARSER.materialHeaders.description.test(cell)
    ) {
      output.description = index;
    }
  });

  return output;
}

/* ========================================================================== */
/* IDENTIFIER NORMALIZATION                                                   */
/* ========================================================================== */

function normalizeFmrParsedIdentifiers_(result) {
  const header = result.header || {};

  header.iwpNumber =
    normalizeFmrParserIdentifier_(
      header.iwpNumber
    );

  header.isoLineNumber =
    normalizeFmrParserIdentifier_(
      header.isoLineNumber
    );

  header.isoDrawingNumber =
    normalizeFmrParserIdentifier_(
      header.isoDrawingNumber
    );

  header.isoSheet =
    sanitizeFmrParserShortIdentifier_(
      header.isoSheet,
      20
    );

  header.revision =
    sanitizeFmrParserShortIdentifier_(
      header.revision,
      20
    );

  result.header = header;
}

function normalizeFmrParserIdentifier_(value) {
  return String(
    value === undefined || value === null
      ? ''
      : value
  )
    .replace(/[\u0000-\u001F\u007F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

function sanitizeFmrParserShortIdentifier_(
  value,
  maximumLength
) {
  const normalized =
    normalizeFmrParserLine_(value);

  if (
    !normalized ||
    normalized.length > maximumLength ||
    /COMMODITY\s+CODE|MATERIAL\s+DESCRIPTION|ISSUED|BACK\s+ORDERED|ACTION\s+TAKEN/i.test(
      normalized
    )
  ) {
    return '';
  }

  return normalized;
}

/* ========================================================================== */
/* FINALIZATION                                                               */
/* ========================================================================== */

function applyFmrParserFilenameFallback_(result, context) {
  const settings = context || {};

  if (result.header.fmrNumber) {
    return;
  }

  addFmrParserWarning_(
    result,
    FMR_IMPORT_CONFIG.warningCodes.FMR_NUMBER_MISSING
  );

  if (
    settings.allowFilenameFmrFallback === false ||
    !FMR_IMPORT_CONFIG.defaults.filenameFmrFallback
  ) {
    return;
  }

  let fallback = deriveFmrNumberFromFilename_(
    settings.sourceFileName || result.sourceFileName
  );

  if (
    fallback &&
    /^\d{1,6}$/.test(fallback) &&
    result.header.iwpNumber
  ) {
    fallback =
      result.header.iwpNumber +
      '(' +
      fallback +
      ')';
  }

  if (fallback) {
    result.header.fmrNumber = fallback;
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.FMR_NUMBER_FROM_FILENAME
    );
  }
}

function deriveFmrNumberFromFilename_(fileName) {
  let value = normalizeFmrParserLine_(fileName);

  if (!value) {
    return '';
  }

  value = value
    .replace(/\.(pdf|xlsx|xls)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parenthetical = value.match(/\(([^()]{1,30})\)\s*$/);

  if (parenthetical) {
    const candidate = normalizeFmrParserLine_(parenthetical[1]);

    if (FMR_IMPORT_CONFIG.regex.fmrNumber.test(candidate)) {
      return candidate;
    }
  }

  const explicit = value.match(
    /\bFMR[\s_-]*(?:NO[\s_.-]*)?([A-Za-z0-9][A-Za-z0-9._()\/-]{1,79})/i
  );

  if (explicit && explicit[1]) {
    return normalizeFmrParserLine_(explicit[1]);
  }

  if (
    value.length >= 2 &&
    value.length <= 80 &&
    FMR_IMPORT_CONFIG.regex.fmrNumber.test(value)
  ) {
    return value;
  }

  return '';
}

function finalizeFmrParseResult_(result) {
  if (!result.header.iwpNumber) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.IWP_MISSING
    );
  }

  if (!result.header.requestedBy) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.REQUESTED_BY_MISSING
    );
  }

  if (!result.header.dateRequired) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.DATE_REQUIRED_MISSING
    );
  }

  if (!result.header.isoLineNumber) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.ISO_LINE_MISSING
    );
  }

  let score = 0;

  if (
    result.detectedTemplate ===
    FMR_IMPORT_CONFIG.templates.TURNER_FMR_V1
  ) {
    score += 20;
  }

  if (result.header.fmrNumber) {
    score += 15;
  }

  if (result.header.iwpNumber) {
    score += 15;
  }

  if (result.header.isoLineNumber) {
    score += 10;
  }

  if (result.header.revision) {
    score += 5;
  }

  if (result.header.craft) {
    score += 5;
  }

  if (result.materialLines.length > 0) {
    score += 20;
  }

  const completeMaterialLines = result.materialLines.filter(
    function (line) {
      return (
        line.commodityCode &&
        line.size &&
        line.quantity !== '' &&
        line.materialDescription
      );
    }
  );

  if (
    result.materialLines.length > 0 &&
    completeMaterialLines.length === result.materialLines.length
  ) {
    score += 10;
  } else if (completeMaterialLines.length > 0) {
    score += 5;
  }

  const warningPenalties = {};
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.REVISION_AMBIGUOUS
  ] = 10;
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.ISO_SHEET_AMBIGUOUS
  ] = 5;
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.QUANTITY_MISSING
  ] = 10;
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.FMR_NUMBER_FROM_FILENAME
  ] = 5;
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.REQUESTED_BY_MISSING
  ] = 5;
  warningPenalties[
    FMR_IMPORT_CONFIG.warningCodes.DATE_REQUIRED_MISSING
  ] = 5;

  result.warnings.forEach(function (warning) {
    score -= warningPenalties[warning] || 0;
  });

  result.confidencePct = Math.max(0, Math.min(100, score));
  result.requiresVerification = true;

  if (
    result.confidencePct <
    FMR_IMPORT_CONFIG.defaults.confidenceThreshold
  ) {
    addFmrParserWarning_(
      result,
      FMR_IMPORT_CONFIG.warningCodes.TEMPLATE_LOW_CONFIDENCE
    );
  }
}

function addFmrParserWarning_(result, warning) {
  if (!warning) {
    return;
  }

  if (result.warnings.indexOf(warning) === -1) {
    result.warnings.push(warning);
  }
}

/* ========================================================================== */
/* TEXT HELPERS                                                               */
/* ========================================================================== */

function normalizeFmrParserText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeFmrParserLine_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFmrParserLabel_(value) {
  return normalizeFmrParserLine_(value)
    .toUpperCase()
    .replace(/[:.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeFmrParserRegex_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
