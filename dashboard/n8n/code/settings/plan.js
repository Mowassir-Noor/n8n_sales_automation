// DB - Settings: compare `expect` with the current row 2 (409 on any difference), enforce the go-live
// rule against the Leads tab, and plan the write. Output: a reply item, or
//   { respond: false, write: true, update: { row_number, ...fields }, settings, log, requestId }

// <lib:common>
// </lib:common>

const req = $('Validate Request').first().json.req;
const now = nowInfo($now);
const rid = req.requestId;

const rows = sheetRows($('Read Settings').all());
if (!rows.length) return [{ json: reply(422, { errors: ['The Settings tab has no data in row 2'] }, rid) }];
const current = normalizeRow(rows[0], SETTINGS_HEADERS);
const rowNumber = current.row_number || 2;
delete current.row_number;

const diffs = Object.keys(req.expect).filter(f => current[f] !== req.expect[f]);
if (diffs.length) {
  return [{ json: reply(409, { conflict: true, row: current, message: 'Settings changed since you opened them (' + diffs.join(', ') + '). Nothing was saved.' }, rid) }];
}

if (Object.prototype.hasOwnProperty.call(req.data, 'Test Email') && req.data['Test Email'] === '' && current['Test Email'] !== '') {
  const testSent = sheetRows($('Read Leads').all())
    .map(r => normalizeRow(r, LEAD_HEADERS))
    .filter(r => r['Lead ID'].trim() && r['Sent At'].trim() && r.Stage !== 'Opted out' && r.Stage !== 'Closed - No reply');
  if (testSent.length) {
    return [{ json: reply(422, { errors: ['Go live is blocked: ' + testSent.length + ' lead(s) were sent in test mode and still need reset or close: ' + testSent.map(r => r['Lead ID']).join(', ')] }, rid) }];
  }
}

const before = {};
for (const f of Object.keys(req.data)) before[f] = current[f];
const settings = Object.assign({}, current, req.data);

return [{
  json: {
    respond: false,
    write: true,
    requestId: rid,
    update: Object.assign({ row_number: rowNumber }, req.data),
    settings,
    log: logRow({
      nowIso: now.iso,
      leadId: '',
      company: '',
      step: req.data['Test Email'] === '' && before['Test Email'] !== '' ? 'settings_go_live' : 'settings_update',
      before,
      after: req.data,
      actor: req.actor,
    }),
  },
}];
