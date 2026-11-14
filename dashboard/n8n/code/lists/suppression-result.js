// DB - Lists / suppression: the 200 answer with the list as re-read after the change.

// <lib:common>
// </lib:common>

const plan = $('Plan Suppression').first().json;
const suppression = sheetRows($('Re-read Suppression').all())
  .map(r => normalizeRow(r, SUPPRESSION_HEADERS))
  .filter(r => r.Email.trim() !== '' || r.Domain.trim() !== '');
const body = { ok: true, suppression };
try {
  const j = $('Log Suppression Change').first().json;
  if (j && j.error) body.warnings = ['The Log row could not be written: ' + String(j.error.message || j.error)];
} catch (e) {
  // Log node did not run
}
return [{ json: reply(200, body, plan.requestId) }];
