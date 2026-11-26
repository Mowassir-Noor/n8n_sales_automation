// DB - Lists / social: the 200 answer after the write.

// <lib:common>
// </lib:common>

const plan = $('Plan Social').first().json;
const body = { ok: true, row: plan.row };
try {
  const j = $('Log Social Change').first().json;
  if (j && j.error) body.warnings = ['The Log row could not be written: ' + String(j.error.message || j.error)];
} catch {
  // Log node did not run
}
return [{ json: reply(200, body, plan.requestId) }];
