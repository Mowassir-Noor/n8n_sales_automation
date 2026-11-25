// One item per Actions row to post as a comment. Tasks created in this run are picked up here.
const p = $('Plan sync').first().json;
if (p.dry_run || !p.comments.length) return [{ json: { _noop: true } }];
const taskOf = { ...p.task_by_company };
let created = [], planned = [];
try { created = $('Create task').all(); planned = $('New tasks').all(); } catch (e) { created = []; }
created.forEach((it, i) => { const c = planned[i] && planned[i].json; if (c && c.lead_id && it.json && it.json.id) taskOf[c.lead_id] = it.json.id; });
const out = p.comments.filter((c) => taskOf[c.company_key]).map((c) => ({ json: { ...c, task_id: taskOf[c.company_key] } }));
return out.length ? out : [{ json: { _noop: true } }];
