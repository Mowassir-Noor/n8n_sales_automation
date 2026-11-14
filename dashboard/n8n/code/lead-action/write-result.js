// DB - Lead action: the 200 answer after the write. The Log and Suppression appends are not fatal
// (the lead row is already written); a failure there is reported in `warnings`.

// <lib:common>
// </lib:common>

function failed(name) {
  try {
    const j = $(name).first().json;
    return j && j.error ? String(j.error.message || j.error) : '';
  } catch {
    return '';
  }
}

const plan = $('Plan Write').first().json;
const warnings = [];
const logErr = failed('Append Log Row');
if (logErr) warnings.push('The Log row could not be written: ' + logErr);
if (plan.suppressionRow) {
  const suppErr = failed('Append Suppression Row');
  if (suppErr) warnings.push('The Suppression row could not be written: ' + suppErr);
}
const body = { ok: true, row: plan.row };
if (warnings.length) body.warnings = warnings;
return [{ json: reply(200, body, plan.requestId) }];
