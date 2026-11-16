// DB - Lead action: re-read the row, run the expect check and the action's rules (with the shared
// email checks), and plan the write. Nothing is written here.
// Output: a reply item (422/409/500, nothing to write) or
//   { respond: false, write: true, update, log, suppressionRow, row, requestId }
// where `update` is { 'Lead ID', ...changed columns } for the Sheets update (auto-map, match 'Lead ID').

// <lib:common>
// </lib:common>
// <lib:executions>
// </lib:executions>
// <shared:checkDraft>
// </shared:checkDraft>
// <shared:checkFollowup>
// </shared:checkFollowup>
// <shared:recipient>
// </shared:recipient>
// <shared:hash>
// </shared:hash>

const FIRST_ACTIONS = ['approve_first', 'reject_first', 'edit_first', 'unapprove_first'];
const FOLLOWUP_ACTIONS = ['approve_followup', 'edit_followup', 'rewrite_followup', 'decline_followup'];
const FOLLOWUP_STAGES = ['Sent', 'Follow-up 1', 'Follow-up 2'];
const APPROVALS = ['approve_first', 'approve_followup'];

function safeAll(name) {
  try { return $(name).all(); } catch { return null; }
}

const req = $('Validate Request').first().json.req;
const now = nowInfo($now);
const rid = req.requestId;

// ---- Sheet data -------------------------------------------------------
const leadRows = sheetRows($('Read Leads').all());
const headers = detectHeaders(leadRows);
const headerCheck = checkLeadHeaders(headers);
if (!headerCheck.ok) {
  return [{ json: reply(422, { errors: ['The Leads tab headers do not match what the workflows expect; nothing was written.'].concat(headerCheck.problems) }, rid) }];
}
const leadHeaders = LEAD_HEADERS.concat([HOT_HANDLED]);
const matches = leadRows.filter(r => str(r['Lead ID']).trim() === req.leadId);
if (matches.length === 0) return [{ json: reply(422, { errors: ['Lead ' + req.leadId + ' was not found in the Leads tab'] }, rid) }];
if (matches.length > 1) return [{ json: reply(422, { errors: ['Lead ID ' + req.leadId + ' appears ' + matches.length + ' times in the Leads tab; fix the sheet first'] }, rid) }];
const row = normalizeRow(matches[0], leadHeaders);

const settings = normalizeRow(sheetRows($('Read Settings').all())[0] || {}, SETTINGS_HEADERS);
delete settings.row_number;
const suppression = sheetRows($('Read Suppression').all())
  .map(r => normalizeRow(r, SUPPRESSION_HEADERS))
  .filter(r => r.Email.trim() !== '' || r.Domain.trim() !== '');

// ---- expect check -----------------------------------------------------
const diffs = [];
const ex = req.expect;
if (row['Last Updated'] !== ex.lastUpdated) diffs.push('Last Updated');
if (row.Stage !== ex.stage) diffs.push('Stage');
if (row.Approved !== ex.approved) diffs.push('Approved');
if (FIRST_ACTIONS.indexOf(req.action) !== -1 && hashFirst(row.Subject, row['Draft Body']) !== ex.draftHash) diffs.push('Subject or Draft Body');
if (FOLLOWUP_ACTIONS.indexOf(req.action) !== -1 && hashFollowup(row['Follow-up Draft']) !== ex.draftHash) diffs.push('Follow-up Draft');
if (diffs.length) {
  return [{ json: reply(409, { conflict: true, row, message: 'This lead changed since you opened it (' + diffs.join(', ') + '). Nothing was saved.' }, rid) }];
}

// ---- rules ------------------------------------------------------------
const errors = [];
const changes = {};
const d = req.data;
const optedOut = row['Opt-out'].trim().toLowerCase() === 'yes';
const suppressed = isSuppressed(row.Email, suppression);
const needStage = (stages) => {
  if (stages.indexOf(row.Stage) === -1) errors.push('Stage is "' + row.Stage + '"; this needs ' + stages.map(s => '"' + s + '"').join(' or '));
};
const needFollowupDraft = () => {
  if (!row['Follow-up Draft'].trim()) errors.push('There is no follow-up draft');
};
let suppressionRow = null;

switch (req.action) {
  case 'approve_first': {
    needStage(['Drafted']);
    if (row['Compliance Status'] !== 'OK') errors.push('Compliance Status is "' + row['Compliance Status'] + '", not "OK"');
    const check = checkDraft({ subject: row.Subject, body: row['Draft Body'], lead: row, settings, suppression });
    if (check.status !== 'OK') for (const n of check.notes) errors.push(n);
    if (optedOut && errors.indexOf('Lead opted out') === -1) errors.push('Lead opted out');
    if (suppressed && !check.notes.some(n => /suppression/i.test(n))) errors.push('On suppression list');
    changes.Approved = 'Yes';
    break;
  }
  case 'reject_first':
    needStage(['Drafted']);
    changes.Approved = 'No';
    changes['Nil Notes'] = d.note;
    break;
  case 'edit_first': {
    needStage(['Drafted']);
    if (row.Approved === 'Yes') errors.push('The email is approved; un-approve it before editing');
    const check = checkDraft({ subject: d.subject, body: d.body, lead: row, settings, suppression });
    changes.Subject = d.subject;
    changes['Draft Body'] = check.body;
    changes['Compliance Status'] = check.status;
    changes['Compliance Notes'] = check.notes.join('; ');
    changes['Draft Body EN'] = '';
    changes.Approved = 'Pending';
    break;
  }
  case 'unapprove_first': {
    needStage(['Drafted']);
    if (row.Approved !== 'Yes') errors.push('The email is not approved');
    const running = safeAll('Check WF3 Running');
    const recent = safeAll('Last WF3 Runs');
    if (!running || !recent || (itemsFailed(running) && itemsFailed(recent))) {
      return [{ json: reply(500, { error: 'Could not check whether WF3 is sending right now: ' + (itemsFailed(recent || []) || 'n8n API not reachable') }, rid) }];
    }
    if (isWorkflowRunning(WF3_ID, executionRows(recent), executionRows(running), now)) {
      errors.push('WF3 is sending approved emails right now; this email may already be in its batch. Try again when the run has finished.');
    }
    changes.Approved = 'Pending';
    break;
  }
  case 'approve_followup': {
    needStage(FOLLOWUP_STAGES);
    needFollowupDraft();
    const check = checkFollowup({ body: row['Follow-up Draft'], lead: row, settings, suppression });
    if (!check.ok) for (const n of check.notes) errors.push(n);
    if (optedOut && errors.indexOf('Lead opted out') === -1) errors.push('Lead opted out');
    if (suppressed && !check.notes.some(n => /suppression/i.test(n))) errors.push('On suppression list');
    changes.Approved = 'Yes';
    break;
  }
  case 'edit_followup':
    needStage(FOLLOWUP_STAGES);
    needFollowupDraft();
    changes['Follow-up Draft'] = d.body;
    changes.Approved = 'Pending';
    break;
  case 'rewrite_followup':
    needStage(FOLLOWUP_STAGES);
    needFollowupDraft();
    changes.Approved = 'Edit';
    changes['Nil Notes'] = d.note;
    break;
  case 'decline_followup':
    needStage(FOLLOWUP_STAGES);
    needFollowupDraft();
    changes.Approved = 'No';
    break;
  case 'opt_out':
    changes['Opt-out'] = 'Yes';
    changes.Stage = 'Opted out';
    changes['Next Follow-up Date'] = '';
    if (row.Email.trim() && !isSuppressed(row.Email, suppression)) {
      suppressionRow = {
        Email: row.Email.trim(),
        Domain: '',
        Reason: 'Opt-out via dashboard: ' + d.note,
        Date: now.date,
      };
    }
    break;
  case 'set_reply_category':
    if (!row['Reply Category'].trim()) errors.push('This lead has no reply category to correct');
    changes['Reply Category'] = d.category;
    changes.Stage = d.category === 'Not interested' ? 'Opted out' : 'Replied - ' + d.category;
    break;
  case 'mark_hot_handled':
    if (!headerCheck.hasHotHandled) {
      return [{ json: reply(422, { errors: ["Add column AH 'Hot Handled' to the Leads tab first"] }, rid) }];
    }
    if (row['Reply Category'] !== 'Hot') errors.push('Reply Category is "' + row['Reply Category'] + '", not "Hot"');
    changes[HOT_HANDLED] = now.iso + ' by ' + req.actor;
    break;
  case 'reset_test_sent':
    if (!settings['Test Email'].trim()) errors.push('Test Email is empty in Settings, so this is not a test send');
    if (!row['Sent At'].trim()) errors.push('Sent At is empty');
    changes.Stage = 'Drafted';
    changes['Sent At'] = '';
    changes['Gmail Thread ID'] = '';
    changes['Follow-up Count'] = '';
    changes['Next Follow-up Date'] = '';
    changes['Follow-up Draft'] = '';
    changes.Approved = 'Pending';
    break;
  case 'close_test_sent':
    if (!row['Sent At'].trim()) errors.push('Sent At is empty');
    changes.Stage = 'Closed - No reply';
    changes['Next Follow-up Date'] = '';
    changes['Follow-up Draft'] = '';
    break;
  default:
    errors.push('Unknown action ' + req.action);
}

if (errors.length) return [{ json: reply(422, { errors }, rid) }];

changes['Last Updated'] = now.iso;
const before = {};
for (const k of Object.keys(changes)) before[k] = row[k];
const newRow = Object.assign({}, row, changes);
const update = Object.assign({ 'Lead ID': row['Lead ID'] }, changes);

return [{
  json: {
    respond: false,
    write: true,
    requestId: rid,
    update,
    row: newRow,
    suppressionRow,
    log: logRow({
      nowIso: now.iso,
      leadId: row['Lead ID'],
      company: row.Company,
      step: req.action,
      before,
      after: changes,
      actor: req.actor,
      adminApproval: req.actorRole === 'admin' && APPROVALS.indexOf(req.action) !== -1,
    }),
  },
}];
