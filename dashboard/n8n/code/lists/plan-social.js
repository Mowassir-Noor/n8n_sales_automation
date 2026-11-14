// DB - Lists / social: expect check (Week, Topic, hash of Draft) and the planned update.
// Output: a reply item, or { respond: false, write: true, update: { row_number, ...fields }, row, log, requestId }

// <lib:common>
// </lib:common>
// <shared:hash>
// </shared:hash>

const req = $('Validate Request').first().json.req;
const now = nowInfo($now);
const rid = req.requestId;
const rows = sheetRows($('Read Social').all()).map(r => normalizeRow(r, SOCIAL_HEADERS));
const current = rows.find(r => r.row_number === req.rowNumber);
if (!current) {
  return [{ json: reply(409, { conflict: true, row: null, message: 'Row ' + req.rowNumber + ' is not in the Social tab any more. Nothing was saved.' }, rid) }];
}
const diffs = [];
if (current.Week !== req.expect.Week) diffs.push('Week');
if (current.Topic !== req.expect.Topic) diffs.push('Topic');
if (hashText(current.Draft) !== req.expect.draftHash) diffs.push('Draft');
if (diffs.length) {
  return [{ json: reply(409, { conflict: true, row: current, message: 'This post changed since you opened it (' + diffs.join(', ') + '). Nothing was saved.' }, rid) }];
}
const before = {};
for (const k of Object.keys(req.data)) before[k] = current[k];
return [{
  json: {
    respond: false,
    write: true,
    requestId: rid,
    update: Object.assign({ row_number: req.rowNumber }, req.data),
    row: Object.assign({}, current, req.data),
    log: logRow({ nowIso: now.iso, leadId: '', company: current.Week + ' / ' + current.Topic, step: 'social_update', before, after: req.data, actor: req.actor }),
  },
}];
