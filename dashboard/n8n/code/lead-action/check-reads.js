// DB - Lead action: stop before Plan Write when a Sheets read failed. The reads use alwaysOutputData,
// so a refused read (Google's 429 "Read requests per minute per user" quota) still sends one empty item
// down the success branch, and Plan Write would see an empty Leads tab. This looks at each read's error
// branch ($(name).all(1)) and throws; the error output goes to Respond Error (HTTP 500,
// { error: "n8n: …" }). The dashboard maps the "too many requests" text to "Google Sheets is busy"
// and retries the same requestId. Nothing has been written at this point.
for (const name of ['Read Leads', 'Read Settings', 'Read Suppression']) {
  let errs = [];
  try { errs = $(name).all(1) || []; } catch { errs = []; }
  const hit = errs.find(i => i && i.json && i.json.error != null && i.json.error !== '');
  if (hit) {
    const e = hit.json.error;
    const msg = typeof e === 'string' ? e : String((e && e.message) || JSON.stringify(e));
    throw new Error(name + ': ' + msg + ' (nothing was saved)');
  }
}
return $input.all();
