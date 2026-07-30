
function parseVisionIsoPage(context, response) {
  const safeContext = normalizeVisionContext_(context);

  if (response && response.error) {
    return quarantineWholePage_(
      safeContext,
      (
        getVisionReviewReason_(
          'VISION_PAGE_ERROR',
          'vision_page_error'
        ) +
        ':' +
        getVisionErrorMessage_(response.error)
      ),
      '',
      FMR_VISION_CONFIG.pageClasses.OTHER
    );
  }

  const annotation = response && response.fullTextAnnotation;
  const page = annotation && annotation.pages && annotation.pages[0];

  if (!page) {
    return quarantineWholePage_(
      safeContext,
      FMR_VISION_CONFIG.reviewReasons.MISSING_FULL_TEXT_ANNOTATION,
      '',
      FMR_VISION_CONFIG.pageClasses.OTHER
    );
  }

  const normalizedPage = normalizeVisionPage_(page);

  const pageText = normalizedPage.words
    .slice()
    .sort(compareVisionReadingOrder_)
    .map(word => word.text)
    .join(' ');

  const pageClass = classifyVisionPage_(pageText);

  if (pageClass !== FMR_VISION_CONFIG.pageClasses.ISO) {
    if (
      pageClass ===
      FMR_VISION_CONFIG.pageClasses.PARTIAL_ISO
    ) {
      return quarantineWholePage_(
        safeContext,
        FMR_VISION_CONFIG.reviewReasons.PARTIAL_ISO_STRUCTURE,
        pageText,
        pageClass
      );
    }

    return createIgnoredVisionPageResult_(pageClass);
  }

  const scale = calculateVisionScale_(
    normalizedPage.words
  );

  const lines = groupVisionWordsIntoLines_(
    normalizedPage.words,
    FMR_VISION_CONFIG.defaults.lineTolerance * scale
  );

  const identity = detectVisionDrawingIdentity_(
    lines,
    normalizedPage.words,
    scale
  );

  const bomHeader = detectVisionBomHeader_(
    normalizedPage.words,
    scale
  );

  const pageReasons = [];

  if (!identity.drawingNumber) {
    pageReasons.push(
      FMR_VISION_CONFIG.reviewReasons.MISSING_DRAWING_NUMBER
    );
  }

  if (!identity.revision) {
    pageReasons.push(
      FMR_VISION_CONFIG.reviewReasons.MISSING_REVISION
    );
  }

  if (!bomHeader.found) {
    pageReasons.push(
      bomHeader.reason ||
      FMR_VISION_CONFIG.reviewReasons.BOM_HEADER_MISSING
    );
  }

  const pageContext = Object.assign(
    {},
    safeContext,
    {
      drawingNumber: identity.drawingNumber,
      revision: identity.revision
    }
  );

  if (pageReasons.length > 0) {
    return quarantineWholePage_(
      pageContext,
      pageReasons,
      pageText,
      pageClass
    );
  }

  const rowReconstruction = reconstructVisionBomRows_(
    normalizedPage.words,
    bomHeader,
    scale
  );

  const rows = rowReconstruction.rows;

  if (rows.length === 0) {
    return quarantineWholePage_(
      pageContext,
      getVisionReviewReason_(
        'NO_BOM_ROWS_DETECTED',
        'no_bom_rows_detected'
      ),
      pageText,
      pageClass
    );
  }

  const duplicatePoints = findDuplicateVisionPoints_(
    rows
  );

  if (duplicatePoints.length > 0) {
    return quarantineWholePage_(
      pageContext,
      (
        FMR_VISION_CONFIG.reviewReasons
          .DUPLICATE_RETAINED_BOM_POINTS +
        ':' +
        duplicatePoints.join(',')
      ),
      pageText,
      pageClass
    );
  }

  const repairedRows = rows.map(row =>
    repairAndValidateVisionRow_(
      pageContext,
      row,
      bomHeader,
      scale
    )
  );

  const invalidRows = repairedRows.filter(
    item => !item.valid
  );

  /*
   * The entire ISO page is quarantined when any retained BOM row is invalid.
   * No valid-looking rows from that page are silently accepted.
   *
   * The Review output contains:
   * - One page-level record with the full normalized page text.
   * - One row-level record for each invalid point with its bounding box.
   */
  if (invalidRows.length > 0) {
    const combinedReasons = Array.from(
      new Set(
        invalidRows.reduce(
          (all, item) => all.concat(item.reasons),
          []
        )
      )
    );

    const pageReview = buildVisionReviewRecord_(
      pageContext,
      {
        pointNumber: '',
        rawRowText: pageText,
        bbox: emptyVisionBoundingBox_()
      },
      combinedReasons,
      pageClass
    );

    const rowReviews = invalidRows.map(item =>
      buildVisionReviewRecord_(
        pageContext,
        item.row,
        item.reasons,
        pageClass
      )
    );

    return {
      records: [],
      reviews: [pageReview].concat(rowReviews),

      pageSummary: {
        pageClass,
        accepted: 0,
        quarantined: invalidRows.length,
        ignored: false,
        pipeRows: 0,

        ignoredNumericAnnotations:
          rowReconstruction
            .ignoredNumericAnnotations
            .length,

        drawingNumber:
          identity.drawingNumber,

        revision:
          identity.revision
      }
    };
  }

  /*
   * Extraction retains every valid row, including PIPE.
   * Pipe filtering is available separately through:
   *
   * filterVisionBomRecordsByPipeMode()
   */
  const acceptedRecords = repairedRows.map(item =>
    buildVisionBomRecord_(
      pageContext,
      item.row
    )
  );

  return {
    records: acceptedRecords,
    reviews: [],

    pageSummary: {
      pageClass,
      accepted: acceptedRecords.length,
      quarantined: 0,
      ignored: false,

      pipeRows: acceptedRecords.filter(
        record => record.is_pipe
      ).length,

      ignoredNumericAnnotations:
        rowReconstruction
          .ignoredNumericAnnotations
          .length,

      drawingNumber:
        identity.drawingNumber,

      revision:
        identity.revision
    }
  };
}

/**
 * Applies a downstream pipe-selection mode to already extracted BOM records.
 *
 * This function does not alter or delete the original extraction output.
 *
 * @param {Object[]} records
 * @param {string} mode NORMAL, INCLUDE_PIPE, or PIPE_ONLY.
 * @return {Object[]}
 */
function filterVisionBomRecordsByPipeMode(
  records,
  mode
) {
  const normalizedMode = normalizeVisionPipeMode(
    mode
  );

  const source = Array.isArray(records)
    ? records
    : [];

  if (
    normalizedMode ===
    FMR_VISION_CONFIG.pipeModes.INCLUDE_PIPE
  ) {
    return source.slice();
  }

  if (
    normalizedMode ===
    FMR_VISION_CONFIG.pipeModes.PIPE_ONLY
  ) {
    return source.filter(
      record => Boolean(record.is_pipe)
    );
  }

  return source.filter(
    record => !record.is_pipe
  );
}

/* ========================================================================== */
/* WORD + COORDINATE NORMALIZATION                                            */
/* ========================================================================== */

/**
 * Converts a Cloud Vision page into normalized word records.
 *
 * @param {Object} page Cloud Vision Page.
 * @return {{
 *   words:Object[],
 *   width:number,
 *   height:number,
 *   rotation:number
 * }}
 */
function normalizeVisionPage_(page) {
  const width = Number(page.width || 0);
  const height = Number(page.height || 0);
  const rawWords = [];

  (page.blocks || []).forEach(block => {
    (block.paragraphs || []).forEach(paragraph => {
      (paragraph.words || []).forEach(word => {
        const text = (word.symbols || [])
          .map(symbol => symbol.text || '')
          .join('');

        if (!normalizeVisionWhitespace_(text)) {
          return;
        }

        const bbox = visionBoundingBoxToPoints_(
          word.boundingBox || {},
          width,
          height
        );

        rawWords.push({
          text,

          x0: bbox.x0,
          y0: bbox.y0,
          x1: bbox.x1,
          y1: bbox.y1,

          cx: (bbox.x0 + bbox.x1) / 2,
          cy: (bbox.y0 + bbox.y1) / 2,

          width:
            Math.max(
              0,
              bbox.x1 - bbox.x0
            ),

          height:
            Math.max(
              0,
              bbox.y1 - bbox.y0
            ),

          confidence:
            Number(word.confidence || 0),

          sourceVertices:
            bbox.vertices
        });
      });
    });
  });

  return normalizeVisionOrientation_(
    rawWords,
    width,
    height
  );
}

/**
 * Converts Vision bounding vertices into page coordinates.
 *
 * @param {Object} boundingBox
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @return {{
 *   x0:number,
 *   y0:number,
 *   x1:number,
 *   y1:number,
 *   vertices:Object[]
 * }}
 */
function visionBoundingBoxToPoints_(
  boundingBox,
  pageWidth,
  pageHeight
) {
  let vertices =
    boundingBox.vertices || [];

  if (
    (!vertices || vertices.length === 0) &&
    boundingBox.normalizedVertices
  ) {
    const safeWidth =
      pageWidth > 0
        ? pageWidth
        : 1;

    const safeHeight =
      pageHeight > 0
        ? pageHeight
        : 1;

    vertices =
      boundingBox.normalizedVertices.map(
        vertex => ({
          x:
            Number(vertex.x || 0) *
            safeWidth,

          y:
            Number(vertex.y || 0) *
            safeHeight
        })
      );
  }

  const normalized = (vertices || []).map(
    vertex => ({
      x: Number(vertex.x || 0),
      y: Number(vertex.y || 0)
    })
  );

  while (normalized.length < 4) {
    normalized.push({
      x: 0,
      y: 0
    });
  }

  const xs = normalized.map(
    vertex => vertex.x
  );

  const ys = normalized.map(
    vertex => vertex.y
  );

  return {
    x0: Math.min.apply(null, xs),
    y0: Math.min.apply(null, ys),
    x1: Math.max.apply(null, xs),
    y1: Math.max.apply(null, ys),
    vertices: normalized
  };
}

/**
 * Rotates the page into its dominant upright orientation.
 *
 * A single global translation is applied after rotation so relative word
 * positions remain intact.
 *
 * @param {Object[]} words
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @return {{
 *   words:Object[],
 *   width:number,
 *   height:number,
 *   rotation:number
 * }}
 */
function normalizeVisionOrientation_(
  words,
  pageWidth,
  pageHeight
) {
  if (!words.length) {
    return {
      words: [],
      width: pageWidth,
      height: pageHeight,
      rotation: 0
    };
  }

  const angles = words
    .map(word => {
      const vertices =
        word.sourceVertices || [];

      if (vertices.length < 2) {
        return 0;
      }

      const dx =
        vertices[1].x -
        vertices[0].x;

      const dy =
        vertices[1].y -
        vertices[0].y;

      return (
        Math.atan2(dy, dx) *
        180 /
        Math.PI
      );
    })
    .filter(Number.isFinite)
    .map(angle =>
      snapVisionAngle_(angle)
    );

  const dominantRotation =
    modeVisionNumber_(angles);

  const correctiveRotation =
    normalizeCorrectiveRotation_(
      -dominantRotation
    );

  if (correctiveRotation === 0) {
    return {
      words: words.map(
        word => Object.assign({}, word)
      ),

      width: pageWidth,
      height: pageHeight,
      rotation: 0
    };
  }

  const radians =
    correctiveRotation *
    Math.PI /
    180;

  const rotatedWordPoints = words.map(
    word => {
      const points = [
        {
          x: word.x0,
          y: word.y0
        },
        {
          x: word.x1,
          y: word.y0
        },
        {
          x: word.x1,
          y: word.y1
        },
        {
          x: word.x0,
          y: word.y1
        }
      ].map(point =>
        rotateVisionPoint_(
          point,
          pageWidth,
          pageHeight,
          radians
        )
      );

      return {
        word,
        points
      };
    }
  );

  const allPoints =
    rotatedWordPoints.reduce(
      (result, item) =>
        result.concat(item.points),
      []
    );

  const globalMinX = Math.min.apply(
    null,
    allPoints.map(
      point => point.x
    )
  );

  const globalMinY = Math.min.apply(
    null,
    allPoints.map(
      point => point.y
    )
  );

  const globalMaxX = Math.max.apply(
    null,
    allPoints.map(
      point => point.x
    )
  );

  const globalMaxY = Math.max.apply(
    null,
    allPoints.map(
      point => point.y
    )
  );

  const translatedWords =
    rotatedWordPoints.map(item =>
      rebuildVisionWordFromPoints_(
        item.word,

        item.points.map(
          point => ({
            x:
              point.x -
              globalMinX,

            y:
              point.y -
              globalMinY
          })
        )
      )
    );

  return {
    words: translatedWords,

    width:
      globalMaxX -
      globalMinX,

    height:
      globalMaxY -
      globalMinY,

    rotation:
      correctiveRotation
  };
}

function snapVisionAngle_(angle) {
  const normalized =
    ((angle % 360) + 360) %
    360;

  const candidates = [
    0,
    90,
    180,
    270
  ];

  return candidates.reduce(
    (best, candidate) => {
      const currentDistance = Math.min(
        Math.abs(
          normalized -
          candidate
        ),

        360 -
        Math.abs(
          normalized -
          candidate
        )
      );

      const bestDistance = Math.min(
        Math.abs(
          normalized -
          best
        ),

        360 -
        Math.abs(
          normalized -
          best
        )
      );

      return currentDistance < bestDistance
        ? candidate
        : best;
    },
    0
  );
}

function normalizeCorrectiveRotation_(
  degrees
) {
  const normalized =
    ((degrees % 360) + 360) %
    360;

  if (normalized === 270) {
    return -90;
  }

  if (normalized === 180) {
    return 180;
  }

  return normalized;
}

function modeVisionNumber_(numbers) {
  if (!numbers || numbers.length === 0) {
    return 0;
  }

  const counts = {};

  numbers.forEach(number => {
    counts[number] =
      (counts[number] || 0) +
      1;
  });

  return Number(
    Object.keys(counts).sort(
      (first, second) => {
        if (
          counts[second] !==
          counts[first]
        ) {
          return (
            counts[second] -
            counts[first]
          );
        }

        /*
         * Prefer upright text when counts tie.
         */
        return (
          Number(first) -
          Number(second)
        );
      }
    )[0] || 0
  );
}

function rotateVisionPoint_(
  point,
  pageWidth,
  pageHeight,
  radians
) {
  const cx =
    pageWidth / 2;

  const cy =
    pageHeight / 2;

  const dx =
    point.x - cx;

  const dy =
    point.y - cy;

  return {
    x:
      dx * Math.cos(radians) -
      dy * Math.sin(radians) +
      cx,

    y:
      dx * Math.sin(radians) +
      dy * Math.cos(radians) +
      cy
  };
}

function rebuildVisionWordFromPoints_(
  word,
  points
) {
  const xs = points.map(
    point => point.x
  );

  const ys = points.map(
    point => point.y
  );

  const x0 = Math.min.apply(
    null,
    xs
  );

  const y0 = Math.min.apply(
    null,
    ys
  );

  const x1 = Math.max.apply(
    null,
    xs
  );

  const y1 = Math.max.apply(
    null,
    ys
  );

  return Object.assign(
    {},
    word,
    {
      x0,
      y0,
      x1,
      y1,

      cx:
        (x0 + x1) /
        2,

      cy:
        (y0 + y1) /
        2,

      width:
        Math.max(
          0,
          x1 - x0
        ),

      height:
        Math.max(
          0,
          y1 - y0
        ),

      sourceVertices:
        points
    }
  );
}

function calculateVisionScale_(words) {
  const heights = (words || [])
    .map(
      word =>
        Number(
          word.height || 0
        )
    )
    .filter(
      height => height > 0
    )
    .sort(
      (first, second) =>
        first - second
    );

  if (!heights.length) {
    return 1;
  }

  const middle =
    Math.floor(
      heights.length / 2
    );

  const median =
    heights.length % 2 === 0
      ? (
          heights[middle - 1] +
          heights[middle]
        ) / 2
      : heights[middle];

  const rawScale =
    median /
    FMR_VISION_CONFIG
      .defaults
      .referenceWordHeight;

  return Math.max(
    FMR_VISION_CONFIG
      .defaults
      .minimumCoordinateScale,

    Math.min(
      FMR_VISION_CONFIG
        .defaults
        .maximumCoordinateScale,

      rawScale
    )
  );
}

/* ========================================================================== */
/* PAGE CLASSIFICATION                                                        */
/* ========================================================================== */

function classifyVisionPage_(pageText) {
  const normalized =
    normalizeVisionText_(pageText);

  const compacted =
    normalized.replace(
      /\s+/g,
      ''
    );

  const hasIsoTitle =
    FMR_VISION_CONFIG
      .regex
      .isoTitleMarker
      .test(normalized);

  const hasBom =
    FMR_VISION_CONFIG
      .regex
      .bomMarker
      .test(normalized);

  if (
    normalized.indexOf(
      'SECTION 15117'
    ) !== -1 &&

    normalized.indexOf(
      'FABRICATION OF METALLIC PIPE AND TUBING'
    ) !== -1 &&

    normalized.indexOf(
      'ATTACHMENT A - WELD/BRAZE LOG SHEET'
    ) !== -1
  ) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .WELD_LOG
    );
  }

  if (
    normalized.indexOf(
      'PIPE HANGERS AND SUPPORTS'
    ) !== -1 &&

    normalized.indexOf(
      'ATTACHMENT C'
    ) !== -1
  ) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .PIPE_SUPPORT_ATTACHMENT
    );
  }

  if (
    normalized.indexOf(
      'FIELD MATERIAL REQUEST'
    ) !== -1
  ) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .EXISTING_FMR
    );
  }

  if (
    normalized.indexOf(
      'LOGISTICS PLAN'
    ) !== -1
  ) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .LOGISTICS
    );
  }

  if (
    compacted.indexOf(
      'ISOSINPROCESSING'
    ) !== -1 &&

    compacted.indexOf(
      'ISOREVWORKFLOWSTATUS'
    ) !== -1
  ) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .WORKFLOW_INDEX
    );
  }

  if (hasIsoTitle && hasBom) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .ISO
    );
  }

  if (hasIsoTitle || hasBom) {
    return (
      FMR_VISION_CONFIG
        .pageClasses
        .PARTIAL_ISO
    );
  }

  return (
    FMR_VISION_CONFIG
      .pageClasses
      .OTHER
  );
}

/* ========================================================================== */
/* LINE GROUPING + DRAWING IDENTITY                                           */
/* ========================================================================== */

function groupVisionWordsIntoLines_(
  words,
  verticalTolerance
) {
  const tolerance = Math.max(
    0.1,
    Number(
      verticalTolerance ||
      0.1
    )
  );

  const sorted = (words || [])
    .slice()
    .sort(
      compareVisionReadingOrder_
    );

  const lines = [];

  sorted.forEach(word => {
    let bestLine = null;

    let bestDistance =
      Number.POSITIVE_INFINITY;

    lines.forEach(line => {
      const distance =
        Math.abs(
          line.cy -
          word.cy
        );

      if (
        distance <= tolerance &&
        distance < bestDistance
      ) {
        bestLine = line;
        bestDistance = distance;
      }
    });

    if (!bestLine) {
      bestLine = {
        words: [],
        cy: word.cy
      };

      lines.push(bestLine);
    }

    bestLine.words.push(word);

    bestLine.cy =
      bestLine.words.reduce(
        (sum, item) =>
          sum + item.cy,
        0
      ) /
      bestLine.words.length;
  });

  lines.forEach(line => {
    line.words.sort(
      (first, second) =>
        first.x0 -
        second.x0
    );

    line.text =
      line.words
        .map(word => word.text)
        .join(' ');

    line.x0 = Math.min.apply(
      null,
      line.words.map(
        word => word.x0
      )
    );

    line.x1 = Math.max.apply(
      null,
      line.words.map(
        word => word.x1
      )
    );

    line.y0 = Math.min.apply(
      null,
      line.words.map(
        word => word.y0
      )
    );

    line.y1 = Math.max.apply(
      null,
      line.words.map(
        word => word.y1
      )
    );
  });

  return lines.sort(
    (first, second) => {
      if (
        Math.abs(
          first.cy -
          second.cy
        ) >
        tolerance / 2
      ) {
        return (
          first.cy -
          second.cy
        );
      }

      return (
        first.x0 -
        second.x0
      );
    }
  );
}

function compareVisionReadingOrder_(
  first,
  second
) {
  if (
    Math.abs(
      first.cy -
      second.cy
    ) > 2
  ) {
    return (
      first.cy -
      second.cy
    );
  }

  return (
    first.x0 -
    second.x0
  );
}

function detectVisionDrawingIdentity_(
  lines,
  words,
  scale
) {
  let headerLine = null;
  let isoStartWord = null;
  let revWord = null;

  /*
   * First locate the ISOMETRIC DRAWING NUMBER sequence.
   * REV is evaluated separately so a missing REV token can be reported
   * accurately.
   */
  (lines || []).some(line => {
    const normalizedWords =
      line.words.map(word =>
        normalizeVisionText_(
          word.text
        )
      );

    for (
      let index = 0;
      index <=
        normalizedWords.length - 3;
      index++
    ) {
      const isIsoHeader =
        normalizedWords[index] ===
          'ISOMETRIC' &&

        normalizedWords[index + 1] ===
          'DRAWING' &&

        normalizedWords[index + 2] ===
          'NUMBER';

      if (!isIsoHeader) {
        continue;
      }

      headerLine = line;
      isoStartWord =
        line.words[index];

      revWord =
        line.words
          .slice(index + 3)
          .find(word =>
            normalizeVisionText_(
              word.text
            ) === 'REV'
          ) || null;

      return true;
    }

    return false;
  });

  if (
    !headerLine ||
    !isoStartWord
  ) {
    return {
      drawingNumber: '',
      revision: '',

      reason:
        FMR_VISION_CONFIG
          .reviewReasons
          .ISOMETRIC_HEADER_MISSING
    };
  }

  if (!revWord) {
    return {
      drawingNumber: '',
      revision: '',

      reason:
        FMR_VISION_CONFIG
          .reviewReasons
          .REV_TOKEN_MISSING
    };
  }

  const yMin =
    headerLine.y1 -
    1 * scale;

  const yMax =
    headerLine.y1 +
    45 * scale;

  const drawingWords = (words || [])
    .filter(word =>
      word.y0 >= yMin &&
      word.y0 <= yMax &&

      word.x0 >=
        isoStartWord.x0 -
        5 * scale &&

      word.x1 <=
        revWord.x0 -
        4 * scale
    )
    .sort(
      compareVisionReadingOrder_
    );

  const revisionWords = (words || [])
    .filter(word =>
      word.y0 >= yMin &&
      word.y0 <= yMax &&

      word.x0 >=
        revWord.x0 -
        8 * scale &&

      word.x1 <=
        revWord.x1 +
        32 * scale
    )
    .filter(word =>
      normalizeVisionText_(
        word.text
      ) !== 'REV'
    );

  const drawingNumber =
    drawingWords
      .map(word =>
        normalizeVisionWhitespace_(
          word.text
        )
      )
      .join('')
      .replace(/\s+/g, '')
      .trim();

  const revisionCandidate =
    revisionWords
      .map(word => ({
        text:
          normalizeVisionWhitespace_(
            word.text
          ),

        verticalDistance:
          Math.abs(
            word.cy -
            headerLine.y1
          ),

        horizontalDistance:
          Math.abs(
            word.cx -
            revWord.cx
          )
      }))
      .filter(candidate =>
        FMR_VISION_CONFIG
          .regex
          .revision
          .test(candidate.text)
      )
      .sort(
        (first, second) => {
          const firstScore =
            first.verticalDistance +
            first.horizontalDistance *
              0.25;

          const secondScore =
            second.verticalDistance +
            second.horizontalDistance *
              0.25;

          return (
            firstScore -
            secondScore
          );
        }
      )[0];

  return {
    drawingNumber,

    revision:
      revisionCandidate
        ? revisionCandidate.text
        : '',

    headerLine
  };
}

/* ========================================================================== */
/* BOM HEADER                                                                 */
/* ========================================================================== */

function detectVisionBomHeader_(
  words,
  scale
) {
  const tokenNames = [
    'PT',
    'DESCRIPTION',
    'NPD',
    'CMDTY',
    'QTY'
  ];

  const candidates = {};

  tokenNames.forEach(token => {
    candidates[token] =
      (words || []).filter(
        word =>
          normalizeVisionText_(
            word.text
          ) === token
      );
  });

  const missingTokens =
    tokenNames.filter(
      token =>
        candidates[token].length ===
        0
    );

  if (missingTokens.length > 0) {
    return {
      found: false,

      reason:
        FMR_VISION_CONFIG
          .reviewReasons
          .BOM_HEADER_MISSING,

      missingTokens
    };
  }

  let best = null;

  candidates.DESCRIPTION.forEach(
    description => {
      candidates.NPD.forEach(npd => {
        candidates.CMDTY.forEach(
          cmdty => {
            candidates.QTY.forEach(
              qty => {
                const ys = [
                  description.cy,
                  npd.cy,
                  cmdty.cy,
                  qty.cy
                ];

                if (
                  Math.max.apply(
                    null,
                    ys
                  ) -
                  Math.min.apply(
                    null,
                    ys
                  ) >
                  FMR_VISION_CONFIG
                    .defaults
                    .headerVerticalBand *
                    scale
                ) {
                  return;
                }

                const pt =
                  candidates.PT
                    .filter(candidate =>
                      Math.abs(
                        candidate.cy -
                        description.cy
                      ) <=
                        FMR_VISION_CONFIG
                          .defaults
                          .ptVerticalTolerance *
                        scale &&

                      candidate.cx <
                        description.cx
                    )
                    .sort(
                      (
                        first,
                        second
                      ) =>
                        Math.abs(
                          first.cy -
                          description.cy
                        ) -
                        Math.abs(
                          second.cy -
                          description.cy
                        )
                    )[0];

                if (!pt) {
                  return;
                }

                const columnsInOrder =
                  pt.cx <
                    description.cx &&

                  description.cx <
                    npd.cx &&

                  npd.cx <
                    cmdty.cx &&

                  cmdty.cx <
                    qty.cx;

                if (!columnsInOrder) {
                  return;
                }

                const score =
                  Math.abs(
                    pt.cy -
                    description.cy
                  ) +

                  Math.abs(
                    npd.cy -
                    description.cy
                  ) +

                  Math.abs(
                    cmdty.cy -
                    description.cy
                  ) +

                  Math.abs(
                    qty.cy -
                    description.cy
                  );

                if (
                  !best ||
                  score < best.score
                ) {
                  best = {
                    found: true,
                    pt,
                    description,
                    npd,
                    cmdty,
                    qty,
                    score
                  };
                }
              }
            );
          }
        );
      });
    }
  );

  if (!best) {
    return {
      found: false,

      reason:
        FMR_VISION_CONFIG
          .reviewReasons
          .BOM_COLUMNS_OUT_OF_ORDER
    };
  }

  best.bounds = [
    best.pt.cx +
      20 * scale,

    best.npd.cx -
      25 * scale,

    best.cmdty.cx -
      15 * scale,

    best.qty.cx -
      25 * scale
  ];

  best.tableLeft = Math.max(
    0,
    best.pt.cx -
      25 * scale
  );

  best.tableRight =
    best.qty.cx +
    Math.max(
      24 * scale,

      (
        best.qty.cx -
        best.cmdty.cx
      ) * 0.22
    );

  best.headerBottom = Math.max(
    best.pt.y1,
    best.description.y1,
    best.npd.y1,
    best.cmdty.y1,
    best.qty.y1
  );

  return best;
}

/* ========================================================================== */
/* ROW RECONSTRUCTION                                                         */
/* ========================================================================== */

function reconstructVisionBomRows_(
  words,
  header,
  scale
) {
  const tableWords = (words || [])
    .filter(word =>
      word.y0 >
        header.headerBottom +
        FMR_VISION_CONFIG
          .defaults
          .headerRowOffset *
          scale &&

      word.x0 >=
        header.tableLeft &&

      word.x1 <=
        header.tableRight
    );

  const tableLines =
    groupVisionWordsIntoLines_(
      tableWords,

      FMR_VISION_CONFIG
        .defaults
        .lineTolerance *
        scale
    )
    .filter(line =>
      !isVisionFloatingNoteLine_(
        line.text
      )
    );

  const candidateStarts = [];
  const ignoredNumericAnnotations = [];

  tableLines.forEach(
    (line, lineIndex) => {
      const isRevisionHistory =
        FMR_VISION_CONFIG
          .regex
          .issuedForConstruction
          .test(
            normalizeVisionText_(
              line.text
            )
          );

      if (isRevisionHistory) {
        return;
      }

      const lineCandidates =
        line.words
          .filter(word => {
            const text =
              normalizeVisionWhitespace_(
                word.text
              );

            return (
              FMR_VISION_CONFIG
                .regex
                .point
                .test(text) &&

              word.cx <
                header.bounds[0] &&

              Math.abs(
                word.cx -
                header.pt.cx
              ) <=
                FMR_VISION_CONFIG
                  .defaults
                  .pointHorizontalTolerance *
                scale
            );
          })
          .sort(
            (first, second) =>
              Math.abs(
                first.cx -
                header.pt.cx
              ) -
              Math.abs(
                second.cx -
                header.pt.cx
              )
          );

      if (
        lineCandidates.length === 0
      ) {
        return;
      }

      /*
       * At most one BOM row begins on a physical line.
       *
       * The point token closest to the PT anchor is the row candidate.
       * Additional point-like numbers on the same line are treated as
       * annotations.
       */
      const rowPointWord =
        lineCandidates[0];

      lineCandidates
        .slice(1)
        .forEach(
          annotationWord => {
            ignoredNumericAnnotations.push({
              point:
                Number(
                  normalizeVisionWhitespace_(
                    annotationWord.text
                  )
                ),

              text:
                line.text,

              bbox:
                combineVisionBoundingBoxes_(
                  [annotationWord]
                ),

              structuralNote:
                FMR_VISION_CONFIG
                  .reviewReasons
                  .IGNORED_NUMERIC_ANNOTATION
            });
          }
        );

      const candidate = {
        point:
          Number(
            normalizeVisionWhitespace_(
              rowPointWord.text
            )
          ),

        word:
          rowPointWord,

        line,
        lineIndex
      };

      const hasMaterialCells =
        lineHasVisionMaterialCells_(
          line,
          rowPointWord,
          header,
          scale
        );

      if (!hasMaterialCells) {
        ignoredNumericAnnotations.push({
          point:
            candidate.point,

          text:
            line.text,

          bbox:
            combineVisionBoundingBoxes_(
              line.words
            ),

          structuralNote:
            FMR_VISION_CONFIG
              .reviewReasons
              .IGNORED_NUMERIC_ANNOTATION
        });

        return;
      }

      candidateStarts.push(
        candidate
      );
    }
  );

  candidateStarts.sort(
    (first, second) => {
      if (
        Math.abs(
          first.word.cy -
          second.word.cy
        ) > 1
      ) {
        return (
          first.word.cy -
          second.word.cy
        );
      }

      return (
        first.word.x0 -
        second.word.x0
      );
    }
  );

  const rows = [];

  candidateStarts.forEach(
    (start, index) => {
      const next =
        candidateStarts[index + 1] ||
        null;

      const retainedLines = [];
      let previousLine = null;

      for (
        let lineIndex =
          start.lineIndex;

        lineIndex <
          tableLines.length;

        lineIndex++
      ) {
        const line =
          tableLines[lineIndex];

        if (
          next &&
          line.cy >= next.line.cy
        ) {
          break;
        }

        if (
          !next &&
          lineIndex > start.lineIndex
        ) {
          if (
            line.cy -
            start.word.cy >=

            FMR_VISION_CONFIG
              .defaults
              .finalRowMaxHeight *
              scale
          ) {
            break;
          }

          if (
            previousLine &&

            line.cy -
            previousLine.cy >

            FMR_VISION_CONFIG
              .defaults
              .finalRowGap *
              scale
          ) {
            break;
          }
        }

        retainedLines.push(line);
        previousLine = line;
      }

      const row =
        assignVisionRowColumns_(
          start,
          retainedLines,
          header,
          scale
        );

      if (row) {
        rows.push(row);
      }
    }
  );

  return {
    rows,
    ignoredNumericAnnotations
  };
}

function lineHasVisionMaterialCells_(
  line,
  pointWord,
  header,
  scale
) {
  return line.words.some(word => {
    if (word === pointWord) {
      return false;
    }

    const text =
      normalizeVisionWhitespace_(
        word.text
      );

    if (!text) {
      return false;
    }

    if (
      word.cx <
      header.bounds[0] -
        FMR_VISION_CONFIG
          .defaults
          .pointDescriptionAllowance *
        scale
    ) {
      return false;
    }

    return (
      word.cx <
        header.bounds[3] ||

      FMR_VISION_CONFIG
        .regex
        .quantity
        .test(text)
    );
  });
}

function isVisionFloatingNoteLine_(
  text
) {
  const normalized =
    normalizeVisionText_(text);

  return (
    normalized ===
      'FIELD WELDS TO BE' ||

    normalized ===
      'CUT AND BEVELED'
  );
}

function assignVisionRowColumns_(
  pointStart,
  lines,
  header,
  scale
) {
  const row = {
    pointNumber:
      pointStart.point,

    pointAnnotations: [],
    descriptionWords: [],
    sizeWords: [],
    commodityWords: [],
    quantityWords: [],
    retainedWords: [],
    structuralNotes: [],
    reviewReasons: []
  };

  (lines || []).forEach(line => {
    line.words.forEach(word => {
      if (
        word === pointStart.word ||

        (
          normalizeVisionWhitespace_(
            word.text
          ) ===
            String(
              pointStart.point
            ) &&

          Math.abs(
            word.cx -
            pointStart.word.cx
          ) <=
            1 * scale &&

          Math.abs(
            word.cy -
            pointStart.word.cy
          ) <=
            1 * scale
        )
      ) {
        return;
      }

      if (
        word.cx <
        header.bounds[0]
      ) {
        if (
          word.cx <
          header.bounds[0] -
            FMR_VISION_CONFIG
              .defaults
              .pointDescriptionAllowance *
            scale
        ) {
          return;
        }

        const text =
          normalizeVisionWhitespace_(
            word.text
          );

        if (
          FMR_VISION_CONFIG
            .regex
            .point
            .test(text)
        ) {
          row.pointAnnotations.push(
            word
          );

          row.retainedWords.push(
            word
          );
        } else {
          row.descriptionWords.push(
            word
          );

          row.retainedWords.push(
            word
          );
        }
      } else if (
        word.cx <
        header.bounds[1]
      ) {
        row.descriptionWords.push(
          word
        );

        row.retainedWords.push(
          word
        );
      } else if (
        word.cx <
        header.bounds[2]
      ) {
        row.sizeWords.push(
          word
        );

        row.retainedWords.push(
          word
        );
      } else if (
        word.cx <
        header.bounds[3]
      ) {
        row.commodityWords.push(
          word
        );

        row.retainedWords.push(
          word
        );
      } else {
        row.quantityWords.push(
          word
        );

        row.retainedWords.push(
          word
        );
      }
    });
  });

  if (
    row.descriptionWords.length === 0 &&
    row.sizeWords.length === 0 &&
    row.commodityWords.length === 0 &&
    row.quantityWords.length === 0
  ) {
    row.structuralNotes.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .IGNORED_NUMERIC_ANNOTATION
    );

    return null;
  }

  row.rawRowText =
    (lines || [])
      .map(line =>
        line.words
          .slice()
          .sort(
            (first, second) =>
              first.x0 -
              second.x0
          )
          .map(
            word => word.text
          )
          .join(' ')
      )
      .join(' | ');

  const rowWords =
    [pointStart.word].concat(
      row.retainedWords
    );

  row.bbox =
    combineVisionBoundingBoxes_(
      rowWords
    );

  return row;
}

/* ========================================================================== */
/* REPAIR + VALIDATION                                                        */
/* ========================================================================== */

function repairAndValidateVisionRow_(
  context,
  row,
  header,
  scale
) {
  let description =
    joinVisionWordsByLines_(
      row.descriptionWords,
      scale
    );

  let sizeText =
    joinVisionWordsByLines_(
      row.sizeWords,
      scale
    );

  const commodity =
    selectVisionCommodityCode_(
      row.commodityWords,
      header,
      scale,
      row.reviewReasons
    );

  const quantity =
    selectVisionQuantity_(
      row.quantityWords,
      header,
      scale,
      row.reviewReasons
    );

  description =
    removePointOnlyDescriptionLine_(
      description,
      row.pointNumber
    );

  const sizeRepair =
    repairVisionDescriptionAndSize_(
      description,
      sizeText
    );

  description =
    sizeRepair.description;

  sizeText =
    normalizeVisionSize_(
      sizeRepair.size
    );

  if (
    FMR_VISION_CONFIG
      .regex
      .supportDescription
      .test(description)
  ) {
    description =
      description.replace(
        /\s+\d{5,6}\s*$/,
        ''
      );
  }

  if (!description) {
    row.reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MISSING_DESCRIPTION
    );
  }

  if (!sizeText) {
    row.reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MISSING_NOMINAL_SIZE
    );
  } else if (
    !FMR_VISION_CONFIG
      .regex
      .size
      .test(sizeText)
  ) {
    row.reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .INVALID_NOMINAL_SIZE
    );
  }

  if (!commodity) {
    row.reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MISSING_COMMODITY_CODE
    );
  }

  if (!quantity) {
    row.reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MISSING_QUANTITY
    );
  }

  row.description =
    normalizeVisionWhitespace_(
      description
    );

  row.nominalSize =
    sizeText;

  row.commodityCode =
    normalizeVisionWhitespace_(
      commodity
    );

  row.quantity =
    normalizeVisionWhitespace_(
      quantity
    );

  row.isPipe =
    isVisionPipeStock_(
      row.description
    );

  row.reviewReasons =
    Array.from(
      new Set(
        row.reviewReasons
      )
    );

  return {
    valid:
      row.reviewReasons.length ===
      0,

    reasons:
      row.reviewReasons.slice(),

    row
  };
}

function joinVisionWordsByLines_(
  words,
  scale
) {
  if (
    !words ||
    words.length === 0
  ) {
    return '';
  }

  const safeScale =
    Number(scale || 1);

  const lines =
    groupVisionWordsIntoLines_(
      words,

      FMR_VISION_CONFIG
        .defaults
        .lineTolerance *
        safeScale
    );

  return normalizeVisionWhitespace_(
    lines
      .map(line =>
        line.words
          .slice()
          .sort(
            (first, second) =>
              first.x0 -
              second.x0
          )
          .map(
            word => word.text
          )
          .join(' ')
      )
      .join(' ')
  );
}

function removePointOnlyDescriptionLine_(
  description,
  pointNumber
) {
  const normalized =
    normalizeVisionWhitespace_(
      description
    );

  if (
    normalized ===
      String(pointNumber) ||

    FMR_VISION_CONFIG
      .regex
      .point
      .test(normalized)
  ) {
    return '';
  }

  return normalized;
}

function repairVisionDescriptionAndSize_(
  description,
  sizeText
) {
  let repairedDescription =
    normalizeVisionWhitespace_(
      description
    );

  let repairedSize =
    normalizeVisionWhitespace_(
      sizeText
    );

  const sizeTokens =
    repairedSize
      .split(/\s+/)
      .filter(Boolean);

  for (
    let index = 0;
    index < sizeTokens.length;
    index++
  ) {
    const rawSuffix =
      sizeTokens
        .slice(index)
        .join(' ');

    const normalizedSuffix =
      normalizeVisionSize_(
        rawSuffix
      );

    if (
      FMR_VISION_CONFIG
        .regex
        .size
        .test(normalizedSuffix)
    ) {
      const prefix =
        sizeTokens
          .slice(0, index)
          .join(' ');

      repairedSize =
        normalizedSuffix;

      if (prefix) {
        repairedDescription =
          applyVisionSizePrefixRepair_(
            repairedDescription,
            prefix,
            repairedSize
          );
      }

      break;
    }
  }

  return {
    description:
      normalizeVisionWhitespace_(
        repairedDescription
      ),

    size:
      normalizeVisionSize_(
        repairedSize
      )
  };
}

function applyVisionSizePrefixRepair_(
  description,
  prefix,
  size
) {
  const normalizedPrefix =
    normalizeVisionText_(
      prefix
    );

  let repaired =
    normalizeVisionWhitespace_(
      description
    );

  if (
    normalizedPrefix ===
    'PIPE'
  ) {
    repaired =
      repaired.replace(
        /\bFOR SIZE\b/i,
        'FOR PIPE SIZE'
      );
  } else if (
    normalizedPrefix ===
    'FNPT'
  ) {
    repaired =
      `${repaired} FNPT`;
  } else if (
    normalizedPrefix ===
      'SW' ||

    normalizedPrefix ===
      'SW/SCRD' ||

    normalizedPrefix ===
      'MTE/FTE'
  ) {
    repaired =
      `${repaired} ${prefix}`;
  } else if (
    normalizedPrefix ===
    'SCR'
  ) {
    /*
     * Deliberate column-bleed discard.
     */
  } else if (
    normalizedPrefix ===
    'NPD'
  ) {
    repaired =
      `${repaired} NPD`;
  } else if (
    /^\d+(?:-\d+\/\d+)?"$/
      .test(prefix)
  ) {
    if (
      /AND SMALLER PIPE/i
        .test(repaired)
    ) {
      repaired =
        repaired.replace(
          /AND SMALLER PIPE/i,
          `${prefix} AND SMALLER PIPE`
        );
    } else {
      repaired =
        `${repaired} ${prefix}`;
    }
  } else {
    repaired =
      `${repaired} ${prefix}`;
  }

  return normalizeVisionWhitespace_(
    repaired
  );
}

function selectVisionCommodityCode_(
  words,
  header,
  scale,
  reviewReasons
) {
  const candidates = (words || [])
    .filter(word =>
      FMR_VISION_CONFIG
        .regex
        .code
        .test(
          normalizeVisionWhitespace_(
            word.text
          )
        )
    )
    .filter(word => {
      const text =
        normalizeVisionWhitespace_(
          word.text
        );

      const farNumericRevisionMarker =
        /^\d{1,2}$/.test(text) &&

        Math.abs(
          word.cx -
          header.cmdty.cx
        ) >
          FMR_VISION_CONFIG
            .defaults
            .commodityFarNumericDistance *
          scale;

      return (
        !farNumericRevisionMarker
      );
    });

  if (!candidates.length) {
    return '';
  }

  const lines =
    groupVisionWordsIntoLines_(
      candidates,

      FMR_VISION_CONFIG
        .defaults
        .lineTolerance *
      scale
    );

  if (lines.length === 1) {
    return lines[0].words
      .slice()
      .sort(
        (first, second) =>
          first.x0 -
          second.x0
      )
      .map(
        word => word.text
      )
      .join(' ');
  }

  const ranked = lines
    .map(line => ({
      line,

      distance:
        Math.abs(
          line.words.reduce(
            (sum, word) =>
              sum + word.cx,
            0
          ) /
            line.words.length -
          header.cmdty.cx
        )
    }))
    .sort(
      (first, second) =>
        first.distance -
        second.distance
    );

  if (
    ranked.length > 1 &&

    ranked[1].distance -
    ranked[0].distance <

      FMR_VISION_CONFIG
        .defaults
        .commodityLineWinnerGap *
      scale
  ) {
    reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MULTIPLE_COMMODITY_CODE_CANDIDATES
    );

    return '';
  }

  return ranked[0]
    .line
    .words
    .slice()
    .sort(
      (first, second) =>
        first.x0 -
        second.x0
    )
    .map(
      word => word.text
    )
    .join(' ');
}

function selectVisionQuantity_(
  words,
  header,
  scale,
  reviewReasons
) {
  const candidates = (words || [])
    .filter(word =>
      FMR_VISION_CONFIG
        .regex
        .quantity
        .test(
          normalizeVisionWhitespace_(
            word.text
          )
        )
    )
    .map(word => ({
      word,

      distance:
        Math.abs(
          word.cx -
          header.qty.cx
        )
    }))
    .sort(
      (first, second) =>
        first.distance -
        second.distance
    );

  if (!candidates.length) {
    return '';
  }

  if (
    candidates[0].distance >

    FMR_VISION_CONFIG
      .defaults
      .quantityMaxDistance *
    scale
  ) {
    reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .QUANTITY_CANDIDATE_TOO_FAR
    );

    return '';
  }

  if (
    candidates.length > 1 &&

    candidates[1].distance -
    candidates[0].distance <

      FMR_VISION_CONFIG
        .defaults
        .quantityWinnerGap *
      scale
  ) {
    reviewReasons.push(
      FMR_VISION_CONFIG
        .reviewReasons
        .MULTIPLE_QUANTITY_CANDIDATES
    );

    return '';
  }

  return normalizeVisionWhitespace_(
    candidates[0]
      .word
      .text
  );
}

/* ========================================================================== */
/* RECORDS + HASHES                                                           */
/* ========================================================================== */

function buildVisionBomRecord_(
  context,
  row
) {
  const record = {
    run_id:
      context.runId,

    source_file_id:
      context.sourceFileId,

    source_pdf:
      context.sourcePdf,

    source_page:
      context.sourcePage,

    iwp_number:
      context.iwpNumber || '',

    drawing_number:
      context.drawingNumber,

    revision:
      context.revision,

    point_number:
      row.pointNumber,

    description:
      row.description,

    nominal_size:
      row.nominalSize,

    commodity_code:
      row.commodityCode,

    quantity:
      row.quantity,

    is_pipe:
      Boolean(row.isPipe),

    raw_row_text:
      row.rawRowText,

    bbox_x0:
      row.bbox.x0,

    bbox_y0:
      row.bbox.y0,

    bbox_x1:
      row.bbox.x1,

    bbox_y1:
      row.bbox.y1,

    ocr_derived:
      true,

    structural_notes:
      row.structuralNotes.join(';'),

    status:
      FMR_VISION_CONFIG
        .recordStatuses
        .ACCEPTED,

    review_reasons:
      '',

    content_hash:
      ''
  };

  record.content_hash =
    hashVisionRecord_(
      record
    );

  return record;
}

function buildVisionReviewRecord_(
  context,
  row,
  reasons,
  pageClass
) {
  const bbox =
    row && row.bbox
      ? row.bbox
      : emptyVisionBoundingBox_();

  return {
    run_id:
      context.runId,

    source_file_id:
      context.sourceFileId,

    source_pdf:
      context.sourcePdf,

    source_page:
      context.sourcePage,

    iwp_number:
      context.iwpNumber || '',

    drawing_number:
      context.drawingNumber || '',

    revision:
      context.revision || '',

    point_number:
      row &&
      row.pointNumber !== undefined
        ? row.pointNumber
        : '',

    raw_row_text:
      row &&
      row.rawRowText
        ? row.rawRowText
        : '',

    bbox_x0:
      bbox.x0,

    bbox_y0:
      bbox.y0,

    bbox_x1:
      bbox.x1,

    bbox_y1:
      bbox.y1,

    reason_codes:
      normalizeVisionReasonCodes_(
        reasons
      ),

    page_class:
      pageClass,

    ocr_derived:
      true,

    created_at:
      new Date()
  };
}

function quarantineWholePage_(
  context,
  reasons,
  rawText,
  pageClass
) {
  const review =
    buildVisionReviewRecord_(
      context,

      {
        pointNumber: '',
        rawRowText: rawText,
        bbox: emptyVisionBoundingBox_()
      },

      reasons,
      pageClass
    );

  return {
    records: [],
    reviews: [review],

    pageSummary: {
      pageClass,
      accepted: 0,
      quarantined: 1,
      ignored: false,
      pipeRows: 0,
      ignoredNumericAnnotations: 0,

      drawingNumber:
        context.drawingNumber || '',

      revision:
        context.revision || ''
    }
  };
}

function hashVisionRecord_(record) {
  const ordered = [
    normalizeVisionText_(
      record.drawing_number
    ),

    normalizeVisionText_(
      record.revision
    ),

    String(
      record.point_number || ''
    ).trim(),

    normalizeVisionWhitespace_(
      record.description
    ),

    normalizeVisionSize_(
      record.nominal_size
    ),

    normalizeVisionWhitespace_(
      record.commodity_code
    ).toUpperCase(),

    normalizeVisionWhitespace_(
      record.quantity
    )
  ].join('|');

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      ordered,
      Utilities.Charset.UTF_8
    );

  return digest
    .map(byte => {
      const value =
        (byte + 256) %
        256;

      return (
        `0${value.toString(16)}`
      ).slice(-2);
    })
    .join('');
}

function findDuplicateVisionPoints_(
  rows
) {
  const counts = {};

  (rows || []).forEach(row => {
    counts[row.pointNumber] =
      (
        counts[row.pointNumber] ||
        0
      ) + 1;
  });

  return Object.keys(counts)
    .filter(
      point =>
        counts[point] > 1
    )
    .map(Number)
    .sort(
      (first, second) =>
        first - second
    );
}

function combineVisionBoundingBoxes_(
  words
) {
  const usableWords = (words || [])
    .filter(word =>
      word &&

      Number.isFinite(
        Number(word.x0)
      ) &&

      Number.isFinite(
        Number(word.y0)
      ) &&

      Number.isFinite(
        Number(word.x1)
      ) &&

      Number.isFinite(
        Number(word.y1)
      )
    );

  if (!usableWords.length) {
    return emptyVisionBoundingBox_();
  }

  return {
    x0:
      Math.min.apply(
        null,

        usableWords.map(
          word =>
            Number(word.x0)
        )
      ),

    y0:
      Math.min.apply(
        null,

        usableWords.map(
          word =>
            Number(word.y0)
        )
      ),

    x1:
      Math.max.apply(
        null,

        usableWords.map(
          word =>
            Number(word.x1)
        )
      ),

    y1:
      Math.max.apply(
        null,

        usableWords.map(
          word =>
            Number(word.y1)
        )
      )
  };
}

/* ========================================================================== */
/* SMALL INTERNAL HELPERS                                                     */
/* ========================================================================== */

function normalizeVisionContext_(
  context
) {
  const source =
    context || {};

  return {
    runId:
      String(
        source.runId || ''
      ),

    sourceFileId:
      String(
        source.sourceFileId || ''
      ),

    sourcePdf:
      String(
        source.sourcePdf || ''
      ),

    sourcePage:
      source.sourcePage === undefined ||
      source.sourcePage === null
        ? ''
        : source.sourcePage,

    iwpNumber:
      String(
        source.iwpNumber || ''
      ),

    drawingNumber:
      String(
        source.drawingNumber || ''
      ),

    revision:
      String(
        source.revision || ''
      )
  };
}

function normalizeVisionReasonCodes_(
  reasons
) {
  const values =
    Array.isArray(reasons)
      ? reasons
      : [reasons];

  return Array.from(
    new Set(
      values
        .map(value =>
          String(
            value || ''
          ).trim()
        )
        .filter(Boolean)
    )
  ).join(';');
}

function emptyVisionBoundingBox_() {
  return {
    x0: '',
    y0: '',
    x1: '',
    y1: ''
  };
}

function createIgnoredVisionPageResult_(
  pageClass
) {
  return {
    records: [],
    reviews: [],

    pageSummary: {
      pageClass,
      accepted: 0,
      quarantined: 0,
      ignored: true,
      pipeRows: 0,
      ignoredNumericAnnotations: 0,
      drawingNumber: '',
      revision: ''
    }
  };
}

function getVisionReviewReason_(
  key,
  fallback
) {
  const reasons =
    FMR_VISION_CONFIG.reviewReasons ||
    {};

  return (
    reasons[key] ||
    fallback
  );
}

function getVisionErrorMessage_(
  error
) {
  if (!error) {
    return 'unknown_error';
  }

  if (
    typeof error === 'string'
  ) {
    return normalizeVisionWhitespace_(
      error
    );
  }

  return normalizeVisionWhitespace_(
    error.message ||
    error.status ||
    JSON.stringify(error)
  );
}