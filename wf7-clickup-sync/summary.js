// One Log row per run. Dry runs with nothing to do and live runs with nothing to do are not logged.
const p = $('Plan sync').first().json;
const ran = (n) => { try { return $(n).all().map((i) => i.json); } catch (e) { return []; } };
const errs = [];
const count = (name, planName, label) => {
  const res = ran(name), plan = ran(planName);
  let ok = 0;
  res.forEach((r, i) => {
    if (r && r.error) { const src = plan[i] || {}; errs.push(label + ' ' + (src.lead_id || '') + ' ' + (src.field || src.company || src.action || '') + ': ' + String((r.error && r.error.message) || r.error).slice(0, 200)); }
    else if (r && !r._noop) ok++;
  });
  return ok;
};
const created = count('Create task', 'New tasks', 'create');
const fields = count('Set field', 'Field changes', 'field');
const comments = count('Post comment', 'Comments to post', 'comment');
const s = p.stats;
const nothing = !s.to_create && !s.field_writes && !s.comments && !errs.length;
const text = p.dry_run
  ? 'DRY RUN, nothing written. Would create ' + s.to_create + ' tasks, set ' + s.field_writes + ' fields, post ' + s.comments + ' comments.'
  : 'Created ' + created + ' of ' + s.to_create + ' tasks, set ' + fields + ' of ' + s.field_writes + ' fields, posted ' + comments + ' of ' + s.comments + ' comments.';
return [{ json: {
  log: !nothing || p.dry_run,
  failed: errs.length,
  output: text + (errs.length ? ' ' + errs.length + ' failed.' : ''),
  input: s.companies_mailed + ' mailed companies, ' + s.clickup_tasks + ' ClickUp tasks, ' + s.matched + ' matched' + (p.only_lead_ids.length ? ' (only ' + p.only_lead_ids.join(', ') + ')' : ''),
  reason: [s.hand_filled_differences ? s.hand_filled_differences + ' hand-filled values differ from the sheet and were left alone' : '', s.actions_waiting ? s.actions_waiting + ' actions waiting' : '', ...errs.slice(0, 5), ...p.notes.slice(0, 5)].filter(Boolean).join(' | ').slice(0, 3000),
  errors: errs, stats: s, conflicts: p.conflicts, notes: p.notes, would_create: p.creates.map((c) => c.lead_id + ' ' + c.company), matched: p.matched, tasks_without_lead: p.tasks_without_lead,
} }];
