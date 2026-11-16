// DB - Read / snapshot: Leads, Settings, Suppression and Social in one response.
// Inputs: 'Read Leads', 'Read Settings', 'Read Suppression', 'Read Social' (all alwaysOutputData,
// so an empty tab arrives as one `{}` item, dropped by sheetRows()).

// <lib:common>
// </lib:common>

const now = nowInfo($now);
const leadRows = sheetRows($('Read Leads').all());
const headerCheck = checkLeadHeaders(detectHeaders(leadRows));
const leadHeaders = LEAD_HEADERS.concat([HOT_HANDLED]);

const leads = leadRows
  .filter(r => str(r['Lead ID']).trim() !== '')
  .map(r => normalizeRow(r, leadHeaders));

const settingsRows = sheetRows($('Read Settings').all());
const settingsRow = normalizeRow(settingsRows[0] || {}, SETTINGS_HEADERS);
delete settingsRow.row_number;

const suppression = sheetRows($('Read Suppression').all())
  .map(r => normalizeRow(r, SUPPRESSION_HEADERS))
  .filter(r => r.Email.trim() !== '' || r.Domain.trim() !== '');

const social = sheetRows($('Read Social').all())
  .map(r => normalizeRow(r, SOCIAL_HEADERS))
  .filter(r => SOCIAL_HEADERS.some(h => r[h].trim() !== ''));

return [{
  json: reply(200, {
    ok: true,
    fetchedAt: now.iso,
    headersOk: headerCheck.ok,
    headerProblems: headerCheck.problems,
    leads,
    settings: settingsRow,
    suppression,
    social,
  }, '', false),
}];
