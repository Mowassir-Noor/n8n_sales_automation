// Mark the Actions rows whose comment was posted, so they are not posted twice.
const sent = $('Comments to post').all();
const out = [];
$input.all().forEach((it, i) => {
  const src = sent[i] && sent[i].json;
  const id = it.json && (it.json.id || it.json.hist_id);
  if (src && src.row_number && id && !it.json.error) out.push({ json: { row_number: src.row_number, 'ClickUp Comment ID': String(id), 'ClickUp Synced At': $now.toISO() } });
});
return out.length ? out : [{ json: { _noop: true } }];
