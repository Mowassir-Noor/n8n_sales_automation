// One item per task to create. Dry run or nothing to create = one marker item, so the chain goes on.
const p = $('Plan sync').first().json;
if (p.dry_run || !p.creates.length) return [{ json: { _noop: true } }];
return p.creates.map((c) => ({ json: c }));
