// DB - Read / log: Log rows filtered by lead, workflow and date, newest first, paged.
// Request (LogQuery): { leadId?, workflow?, from?, to?, page?, pageSize? }
//   leadId   exact match on 'Lead ID'
//   workflow case-insensitive substring of 'Workflow' (so "WF3" matches "WF3 Send approved emails")
//   from/to  yyyy-MM-dd, inclusive, compared with the first 10 characters of 'Timestamp'
// Newest first = by sheet row, last row first (rows are only ever appended).

// <lib:common>
// </lib:common>

const q = $('Config').first().json.body || {};
const errors = [];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const leadId = str(q.leadId).trim();
const workflow = str(q.workflow).trim().toLowerCase();
const from = str(q.from).trim().slice(0, 10);
const to = str(q.to).trim().slice(0, 10);
if (from && !DATE_RE.test(from)) errors.push('from must be yyyy-MM-dd');
if (to && !DATE_RE.test(to)) errors.push('to must be yyyy-MM-dd');
const page = q.page == null || q.page === '' ? 1 : Number(q.page);
const pageSize = q.pageSize == null || q.pageSize === '' ? 50 : Number(q.pageSize);
if (!Number.isInteger(page) || page < 1) errors.push('page must be a whole number from 1');
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) errors.push('pageSize must be a whole number from 1 to 500');
if (errors.length) return [{ json: reply(422, { errors }, '', false) }];

const rows = sheetRows($('Read Log').all())
  .map(r => normalizeRow(r, LOG_HEADERS))
  .filter(r => LOG_HEADERS.some(h => r[h] !== ''))
  .filter(r => !leadId || r['Lead ID'].trim() === leadId)
  .filter(r => !workflow || r.Workflow.toLowerCase().includes(workflow))
  .filter(r => {
    const day = r.Timestamp.slice(0, 10);
    if (from && !(day >= from)) return false;
    if (to && !(day <= to)) return false;
    return true;
  })
  .sort((a, b) => (b.row_number || 0) - (a.row_number || 0));

const start = (page - 1) * pageSize;
return [{
  json: reply(200, { ok: true, rows: rows.slice(start, start + pageSize), total: rows.length, page, pageSize }, '', false),
}];
