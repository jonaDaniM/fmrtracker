const FMR_WEB_APP_VIEWS = Object.freeze({
  field: Object.freeze({
    title: 'FMR Field Portal'
  }),

  admin: Object.freeze({
    title: 'FMR Admin Portal'
  }),

  import: Object.freeze({
    title: 'FMR Import Portal'
  })
});

function doGet(e) {
  const requestedParameter =
    String(
      e &&
      e.parameter &&
      e.parameter.view
        ? e.parameter.view
        : 'field'
    )
      .trim()
      .toLowerCase();

  const requestedView =
    Object.prototype.hasOwnProperty.call(
      FMR_WEB_APP_VIEWS,
      requestedParameter
    )
      ? requestedParameter
      : 'field';

  const viewConfiguration =
    FMR_WEB_APP_VIEWS[
      requestedView
    ];

  const webAppUrl =
    ScriptApp
      .getService()
      .getUrl();

  if (!webAppUrl) {
    throw new Error(
      'The script is not currently available as a web app.'
    );
  }

  const template =
    HtmlService.createTemplateFromFile(
      'Index'
    );

  template.requestedView =
    requestedView;

  template.isFieldView =
    requestedView === 'field';

  template.isAdminView =
    requestedView === 'admin';

  template.isImportView =
    requestedView === 'import';

  /*
   * This must be an absolute script.google.com web-app URL. Relative links
   * otherwise resolve against the temporary script.googleusercontent.com
   * iframe URL and produce a blank userCodeAppPanel page.
   */
  template.webAppUrl =
    webAppUrl;

  return template
    .evaluate()
    .setTitle(
      viewConfiguration.title
    )
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode
        .ALLOWALL
    );
}

function include_(fileName) {
  return HtmlService
    .createHtmlOutputFromFile(
      fileName
    )
    .getContent();
}
