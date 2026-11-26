// One item per field to set on an existing task.
const p = $('Plan sync').first().json;
if (p.dry_run || !p.field_writes.length) return [{ json: { _noop: true } }];
return p.field_writes.map((w) => ({ json: w }));
