// DB - Settings: the request body for 'Update Settings Row' (Sheets API values:batchUpdate), one cell per
// changed field in the planned row. Column letters come from the Settings header order as 'Read Settings'
// returned it. (The Sheets node cannot match on row_number, so the write goes through the API.)

// <lib:common>
// </lib:common>

const plan = $('Plan Settings').first().json;
const update = Object.assign({}, plan.update);
const row = Number(update.row_number) || 2;
delete update.row_number;

const headers = detectHeaders(sheetRows($('Read Settings').all()));
const data = [];
const missing = [];
for (const field of Object.keys(update)) {
  const i = headers.indexOf(field);
  if (i === -1) { missing.push(field); continue; }
  data.push({ range: 'Settings!' + colLetter(i) + row, values: [[str(update[field])]] });
}
if (missing.length) throw new Error('Settings tab has no column for: ' + missing.join(', ') + '. Add the header in row 1 first.');

return [{ json: { valueInputOption: 'RAW', data } }];
