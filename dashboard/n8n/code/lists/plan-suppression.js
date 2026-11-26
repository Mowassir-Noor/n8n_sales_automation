// DB - Lists / suppression: check against the current tab and plan the change.
// Output: a reply item (next: 'respond'), or
//   { next: 'append', row, log, requestId }        add: append `row`
//   { next: 'delete', rowNumber, log, requestId }  remove: delete sheet row `rowNumber`

// <lib:common>
// </lib:common>

const req = $('Validate Request').first().json.req;
const now = nowInfo($now);
const rid = req.requestId;
const rows = sheetRows($('Read Suppression').all()).map(r => normalizeRow(r, SUPPRESSION_HEADERS));
const asReply = (status, body) => Object.assign(reply(status, body, rid), { next: 'respond' });

if (req.action === 'add') {
  const dupe = rows.find(r =>
    (req.email && r.Email.trim().toLowerCase() === req.email) ||
    (req.domain && r.Domain.trim().toLowerCase().replace(/^@/, '') === req.domain));
  if (dupe) {
    return [{ json: asReply(422, { errors: ['Already on the Suppression list (row ' + dupe.row_number + ')'] }) }];
  }
  const row = { Email: req.email, Domain: req.domain, Reason: req.reason, Date: now.date };
  return [{
    json: {
      respond: false,
      next: 'append',
      requestId: rid,
      row,
      log: logRow({ nowIso: now.iso, leadId: '', company: '', step: 'suppression_add', before: {}, after: row, actor: req.actor }),
    },
  }];
}

const current = rows.find(r => r.row_number === req.rowNumber);
if (!current) {
  return [{ json: asReply(409, { conflict: true, row: null, message: 'Row ' + req.rowNumber + ' is no longer on the Suppression list. Nothing was removed.' }) }];
}
if (current.Email !== req.expect.Email || current.Domain !== req.expect.Domain) {
  return [{ json: asReply(409, { conflict: true, row: current, message: 'Row ' + req.rowNumber + ' changed since you opened the list. Nothing was removed.' }) }];
}
const before = { Email: current.Email, Domain: current.Domain, Reason: current.Reason, Date: current.Date, row: req.rowNumber };
return [{
  json: {
    respond: false,
    next: 'delete',
    requestId: rid,
    rowNumber: req.rowNumber,
    log: logRow({ nowIso: now.iso, leadId: '', company: '', step: 'suppression_remove', before, after: { removed: true, reason: req.reason }, actor: req.actor }),
  },
}];
