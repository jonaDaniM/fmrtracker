/**
 * Web app entry points for the bound FMR Tracker spreadsheet project.
 */

function doGet(e) {
  const view = normalizeWebView_((e && e.parameter && e.parameter.view) || 'field');
  const template = HtmlService.createTemplateFromFile('Index');
  template.REQUESTED_VIEW = view;

  return template
    .evaluate()
    .setTitle(titleForView_(view))
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function normalizeWebView_(value) {
  const view = String(value || 'field').trim().toLowerCase();
  if (view === 'admin' || view === 'import' || view === 'field') return view;
  return 'field';
}

function titleForView_(view) {
  if (view === 'admin') return 'FMR Administration Portal';
  if (view === 'import') return 'FMR Import Portal';
  return 'FMR Field Portal';
}
