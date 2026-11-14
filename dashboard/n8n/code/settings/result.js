// DB - Settings: the 200 answer after the write (a failed Log append is reported in `warnings`).

// <lib:common>
// </lib:common>

const plan = $('Plan Settings').first().json;
const body = { ok: true, settings: plan.settings };
try {
  const j = $('Append Log Row').first().json;
  if (j && j.error) body.warnings = ['The Log row could not be written: ' + String(j.error.message || j.error)];
} catch (e) {
  // Log node did not run
}
return [{ json: reply(200, body, plan.requestId) }];
