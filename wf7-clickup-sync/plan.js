// Plan the ClickUp sync: match companies to tasks, work out which fields to write,
// which tasks to create and which Actions rows to post as comments. Writes nothing itself.
const cfg = $('Config').first().json;
const dryRun = cfg.dry_run !== false && String(cfg.dry_run) !== 'false';
const overwrite = cfg.overwrite_hand_filled === true || String(cfg.overwrite_hand_filled) === 'true';
const only = String(cfg.only_lead_ids || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const maxComments = Number(cfg.max_comments_per_run) || 80;

const S = (v) => (v === null || v === undefined ? '' : String(v).trim());
const norm = (v) => S(v).toLocaleLowerCase('tr').replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/[.:;,!]+$/g, '').trim();
const normName = (v) => norm(v).replace(/\b(a\.?\s?ş\.?|ltd\.?|şti\.?|san\.?|tic\.?|ve|tekstil|textile|group|grup)\b/g, ' ').replace(/[^a-z0-9çğıöşü]+/g, '');

// Dates: ISO timestamps, yyyy-mm-dd, dd.mm.yyyy and sheet serial numbers. Result = the Istanbul calendar day.
const dayOf = (v) => {
  const s = S(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  let ms;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    ms = n > 1e11 ? n : Math.round((n - 25569) * 86400000) - 3 * 3600000;
  } else ms = Date.parse(s);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
};
const dayToMs = (d) => Date.parse(d + 'T12:00:00+03:00');
const tsOf = (v) => {
  const s = S(v);
  if (!s) return 0;
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return ms;
  const d = dayOf(s);
  return d ? dayToMs(d) : 0;
};

// ---------- ClickUp side ----------
const fieldList = ($('Get Fields').first().json.fields || []);
const fieldByName = {};
for (const f of fieldList) fieldByName[norm(f.name)] = f;
const tasks = [];
for (const it of $('Get Tasks').all()) for (const t of (it.json.tasks || [])) tasks.push(t);

const optionsOf = (f) => ((f.type_config || {}).options || []);
const optLabel = (o) => S(o.name !== undefined ? o.name : o.label);
// Current value of a field on a task, as comparable text.
const currentValue = (task, f) => {
  const cf = (task.custom_fields || []).find((x) => x.id === f.id);
  if (!cf || cf.value === undefined || cf.value === null || cf.value === '') return '';
  const v = cf.value;
  if (f.type === 'drop_down') {
    const opts = optionsOf(cf.type_config ? cf : f);
    const o = opts.find((x) => x.id === v || String(x.orderindex) === String(v));
    return o ? optLabel(o) : S(v);
  }
  if (f.type === 'labels') {
    const opts = optionsOf(cf.type_config ? cf : f);
    return (Array.isArray(v) ? v : [v]).map((id) => { const o = opts.find((x) => x.id === id); return o ? optLabel(o) : S(id); }).join(', ');
  }
  if (f.type === 'date') return dayOf(v);
  if (f.type === 'checkbox') return (v === true || v === 'true') ? 'true' : '';
  return S(v);
};

// ---------- Sheet side: one company = parent row + its second-contact rows ----------
const groups = {};
for (const it of $('Read Leads').all()) {
  const r = it.json;
  const id = S(r['Lead ID']).toUpperCase();
  if (!id) continue;
  const m = id.match(/^(.+)-B$/);
  const key = S(r['Parent Lead ID']).toUpperCase() || (m ? m[1] : id);
  if (!groups[key]) groups[key] = { key, rows: [] };
  groups[key].rows.push(r);
}

const derivedStage = (r) => {
  const cu = S(r['ClickUp Stage']);
  if (cu) return cu;
  const st = S(r.Stage);
  const cat = norm(r['Reply Category']);
  if (/^(yes|true|evet|1)$/i.test(S(r['Opt-out']))) return 'Opt-out';
  if (cat === 'hot') return 'Yanıt: demo istiyor';
  if (cat === 'warm') return 'Yanıt: ilgili, bilgi istiyor';
  if (cat === 'cold' || cat === 'not interested') return 'Yanıt: olumsuz';
  if (st === 'Bounced') return 'Ulaşmadı';
  if (st === 'Closed - No reply') return 'Kapandı – yanıt yok';
  const fu = st.match(/^Follow-up (\d)/);
  if (fu) return fu[1] + '. takip atıldı';
  if (S(r['Sent At'])) {
    const n = Number(r['Follow-up Count']) || 0;
    if (n >= 1 && n <= 3) return n + '. takip atıldı';
    return /-B$/i.test(S(r['Lead ID'])) || S(r['Parent Lead ID']) ? '2. kişiye ilk mail atıldı' : 'İlk mail atıldı';
  }
  return '';
};
const stageRank = (s) => {
  const n = norm(s);
  if (n === norm('Demo planlandı')) return 100;
  if (n === norm('Yanıt: demo istiyor')) return 90;
  if (n === norm('Yanıt: ilgili, bilgi istiyor')) return 85;
  if (n === 'opt-out') return 80;
  if (n === norm('Yanıt: olumsuz')) return 75;
  return 0;
};

const HAND_FILLED = ['Mail Tarihi', 'E-posta', 'İlgili Kişi', 'Mail Konusu', 'Geri Dönüş', 'Geri Dönüş Notu', '2. Mail (Takip)', '2. Mail Tarihi'].map(norm);

const companies = [];
for (const g of Object.values(groups)) {
  const parent = g.rows.find((r) => S(r['Lead ID']).toUpperCase() === g.key) || g.rows[0];
  const second = g.rows.find((r) => r !== parent);
  const mailed = g.rows.some((r) => S(r['Sent At']) || S(r['ClickUp Stage']));
  if (!mailed) continue;
  if (only.length && !only.includes(g.key)) continue;

  let stage = '', best = -1, bestTs = -1;
  for (const r of g.rows) {
    const s = derivedStage(r);
    if (!s) continue;
    const rank = stageRank(s), ts = tsOf(r['Last Updated']);
    if (rank > best || (rank === best && ts > bestTs)) { stage = s; best = rank; bestTs = ts; }
  }
  // A bounce is a delivery failure, not an answer from the company.
  const isBounce = (r) => S(r.Stage) === 'Bounced' || S(r['ClickUp Stage']) === 'Ulaşmadı' || /bounce|ulaşmadı/i.test(S(r['Reply Category']));
  const replied = g.rows.find((r) => !isBounce(r) && (S(r['Reply At']) || S(r['Reply Category'])));
  const lastTs = Math.max(0, ...g.rows.map((r) => tsOf(r['Last Updated'])));
  const nextDates = g.rows.map((r) => dayOf(r['Next Follow-up Date'])).filter(Boolean).sort();
  const fu1 = dayOf(parent['Follow-up 1 At']);
  const followedUp = !!fu1 || (Number(parent['Follow-up Count']) || 0) >= 1;

  // ClickUp field name -> value from the sheet ('' = nothing to write)
  const want = {
    'Lead ID': g.key,
    'Web Sitesi': S(parent.Website),
    'Segment': norm(parent.Segment) === 'hariç' ? 'Diğer' : S(parent.Segment),
    'Dalga': ({ '1': '1. dalga', '2': '2. dalga', 'ayrı liste': 'Sourcing ofisi' })[norm(parent.Wave)] || S(parent.Wave),
    'Çalışan Sayısı': S(parent.Employees),
    'İhracat / Ciro': S(parent['Export Volume']),
    'Kriter Uygunluğu': S(parent['Criteria Fit']),
    'İlgili Kişi': S(parent['Contact Name']),
    'İlgili Kişi Unvanı': S(parent['Contact Title']),
    'E-posta': S(parent.Email),
    'LinkedIn': S(parent.LinkedIn),
    '2. Kişi': S(parent['Contact 2 Name']) || (second ? S(second['Contact Name']) : ''),
    '2. Kişi Unvanı': S(parent['Contact 2 Title']) || (second ? S(second['Contact Title']) : ''),
    '2. Kişi E-posta': S(parent['Contact 2 Email']) || (second ? S(second.Email) : ''),
    'Kişi Kaynağı': ({ 'basın': 'Basın / Google AI', 'google ai': 'Basın / Google AI', 'genel adres': 'Genel adres (info@)', 'info@': 'Genel adres (info@)', 'web': 'Web sitesi', 'website': 'Web sitesi' })[norm(parent['Contact Source'])] || S(parent['Contact Source']),
    'HubSpot Contact ID': S(parent['HubSpot Contact ID']),
    'Mail Konusu': S(parent.Subject),
    'Aşama': stage,
    'Mail Tarihi': dayOf(parent['Sent At']),
    '2. Kişi İlk Mail Tarihi': dayOf(parent['Contact 2 First Email At']) || (second ? dayOf(second['Sent At']) : ''),
    '2. Mail (Takip)': followedUp ? '__SENT__' : '',
    '2. Mail Tarihi': fu1,
    '2. Takip Tarihi': dayOf(parent['Follow-up 2 At']),
    '3. Takip Tarihi': dayOf(parent['Follow-up 3 At']),
    'Yanıt Tarihi': replied ? dayOf(replied['Reply At']) : '',
    'Geri Dönüş': replied ? 'Oldu' : 'Olmadı',
    'Geri Dönüş Notu': replied ? [S(replied['Reply Category']), S(replied['Reply Summary'])].filter(Boolean).join(': ') : '',
    'Son Aksiyon Tarihi': lastTs ? dayOf(new Date(lastTs).toISOString()) : '',
    'Sonraki Aksiyon Tarihi': nextDates[0] || '',
  };
  const emails = [];
  for (const r of g.rows) for (const k of ['Email', 'Contact 2 Email', 'General Email']) { const e = S(r[k]).toLowerCase(); if (e && !emails.includes(e)) emails.push(e); }
  companies.push({ key: g.key, name: S(parent.Company), want, emails, lead_ids: g.rows.map((r) => S(r['Lead ID']).toUpperCase()) });
}

// ---------- Match companies to tasks: Lead ID, then email, then exact company name ----------
const fLead = fieldByName[norm('Lead ID')], fMail = fieldByName[norm('E-posta')], fMail2 = fieldByName[norm('2. Kişi E-posta')];
const byLead = {}, byEmail = {}, byName = {};
for (const t of tasks) {
  if (fLead) { const v = currentValue(t, fLead).toUpperCase(); if (v) byLead[v] = t; }
  for (const f of [fMail, fMail2]) if (f) { const v = currentValue(t, f).toLowerCase(); if (v && !byEmail[v]) byEmail[v] = t; }
  const n = normName(t.name); if (n && !byName[n]) byName[n] = t;
}
const claimed = {};
const notes = [], conflicts = [], creates = [], fieldWrites = [], taskByCompany = {}, matched = [];

// Turn a sheet value into what the ClickUp API wants for this field type. Returns {ok, value, options, shown}.
const toApi = (f, name, v) => {
  if (v === '__SENT__') {
    if (f.type === 'checkbox') return { ok: true, value: true, shown: 'true' };
    if (f.type === 'drop_down') {
      const o = optionsOf(f).find((x) => /^(at[ıi]ld[ıi]|g[öo]nderildi|evet|yap[ıi]ld[ıi]|var)$/.test(norm(optLabel(x))));
      return o ? { ok: true, value: o.id, shown: optLabel(o) } : { ok: false, why: 'no "sent" option among: ' + optionsOf(f).map(optLabel).join(' | ') };
    }
    return { ok: true, value: 'Atıldı', shown: 'Atıldı' };
  }
  if (f.type === 'drop_down') {
    const o = optionsOf(f).find((x) => norm(optLabel(x)) === norm(v));
    return o ? { ok: true, value: o.id, shown: optLabel(o) } : { ok: false, why: 'no option "' + v + '" among: ' + optionsOf(f).map(optLabel).join(' | ') };
  }
  if (f.type === 'labels') {
    const o = optionsOf(f).find((x) => norm(optLabel(x)) === norm(v));
    return o ? { ok: true, value: [o.id], shown: optLabel(o) } : { ok: false, why: 'no label "' + v + '"' };
  }
  if (f.type === 'date') {
    const d = dayOf(v);
    return d ? { ok: true, value: dayToMs(d), options: { time: false }, shown: d } : { ok: false, why: 'not a date: ' + v };
  }
  if (f.type === 'number' || f.type === 'currency') {
    const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return Number.isFinite(n) && String(v).match(/\d/) ? { ok: true, value: n, shown: String(n) } : { ok: false, why: 'not a number: ' + v };
  }
  if (f.type === 'checkbox') return { ok: true, value: /^(true|yes|evet|1|oldu)$/i.test(v), shown: String(/^(true|yes|evet|1|oldu)$/i.test(v)) };
  if (f.type === 'url') return /^https?:\/\//i.test(v) ? { ok: true, value: v, shown: v } : { ok: true, value: 'https://' + v, shown: 'https://' + v };
  if (f.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, value: v, shown: v } : { ok: false, why: 'not an email: ' + v };
  return { ok: true, value: String(v).slice(0, 2000), shown: String(v).slice(0, 2000) };
};
const same = (f, cur, shown) => (f.type === 'date' ? cur === shown : f.type === 'url' ? norm(cur).replace(/\/$/, '') === norm(shown).replace(/\/$/, '') : norm(cur) === norm(shown));

const missingFields = {};
for (const c of companies) {
  let task = null, how = '';
  for (const id of [c.key]) if (byLead[id]) { task = byLead[id]; how = 'Lead ID'; }
  if (!task) for (const e of c.emails) if (byEmail[e]) { task = byEmail[e]; how = 'email'; break; }
  if (!task && byName[normName(c.name)]) { task = byName[normName(c.name)]; how = 'name'; }
  if (task && claimed[task.id]) {
    notes.push(c.key + ' ' + c.name + ': matches task "' + task.name + '" by ' + how + ', but ' + claimed[task.id] + ' already uses it. Skipped.');
    continue;
  }
  const writes = [];
  for (const [name, v] of Object.entries(c.want)) {
    if (!v) continue;
    const f = fieldByName[norm(name)];
    if (!f) { missingFields[name] = true; continue; }
    const api = toApi(f, name, v);
    if (!api.ok) { notes.push(c.key + ' ' + c.name + ': field "' + name + '" not set (' + api.why + ').'); continue; }
    if (task) {
      const cur = currentValue(task, f);
      if (same(f, cur, api.shown)) continue;
      if (cur && HAND_FILLED.includes(norm(name)) && !overwrite) {
        conflicts.push({ lead_id: c.key, company: c.name, task: task.name, field: name, clickup: cur, sheet: api.shown });
        continue;
      }
      if (norm(name) === norm('Aşama') && norm(cur) === norm('Demo planlandı') && stageRank(api.shown) < 100) continue; // set by hand, keep
      writes.push({ field: name, from: cur, to: api.shown });
      fieldWrites.push({ task_id: task.id, field_id: f.id, field: name, lead_id: c.key, company: c.name, body: api.options ? { value: api.value, value_options: api.options } : { value: api.value } });
    } else {
      writes.push({ field_id: f.id, value: api.value, options: api.options, field: name, to: api.shown });
    }
  }
  if (task) {
    claimed[task.id] = c.key;
    taskByCompany[c.key] = task.id;
    matched.push({ lead_id: c.key, company: c.name, task: task.name, task_id: task.id, matched_by: how, changes: writes });
  } else {
    creates.push({ lead_id: c.key, company: c.name, fields_shown: writes.map((w) => w.field + ' = ' + w.to), body: { name: c.name, custom_fields: writes.map((w) => (w.options ? { id: w.field_id, value: w.value, value_options: w.options } : { id: w.field_id, value: w.value })) } });
  }
}
for (const n of Object.keys(missingFields)) notes.push('ClickUp list has no field named "' + n + '"; it is not synced.');
const tasksWithoutLead = tasks.filter((t) => !claimed[t.id]).map((t) => t.name);

// ---------- Actions rows that are not in ClickUp yet ----------
const companyOfLead = {};
for (const c of companies) for (const id of c.lead_ids) companyOfLead[id] = c.key;
const LABEL = { 'first email': 'İlk mail', 'first email (2nd contact)': '2. kişiye ilk mail', 'reply': 'Yanıt', 'opt-out': 'Opt-out', 'bounce': 'Ulaşmadı', 'bounced': 'Ulaşmadı', 'closed - no reply': 'Kapandı – yanıt yok', 'approved': 'Onay', 'approval': 'Onay', 'demo planned': 'Demo planlandı' };
const comments = [];
let waiting = 0;
for (const it of $('Read Actions').all()) {
  const a = it.json;
  const lead = S(a['Lead ID']).toUpperCase();
  if (!lead || S(a['ClickUp Comment ID'])) continue;
  const key = companyOfLead[lead];
  if (!key) { if (!only.length) waiting++; continue; }
  if (comments.length >= maxComments) { waiting++; continue; }
  const act = S(a.Action);
  const fu = act.match(/^Follow-up (\d)/i);
  const label = fu ? fu[1] + '. takip' : (LABEL[act.toLowerCase()] || act);
  const incoming = /^(reply|opt-out|bounce)/i.test(act);
  const ms = tsOf(a.Timestamp);
  const when = ms ? new Date(ms + 3 * 3600000).toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}).*/, '$3.$2.$1 $4') : S(a.Timestamp);
  const who = [S(a.Person), S(a.Email) ? '<' + S(a.Email) + '>' : ''].filter(Boolean).join(' ');
  const lines = ['[n8n] ' + when + ' · ' + label];
  if (who) lines.push((incoming ? 'Kimden: ' : 'Kime: ') + who);
  if (S(a.Subject)) lines.push('Konu: ' + S(a.Subject));
  if (S(a.Summary)) lines.push('Özet: ' + S(a.Summary).slice(0, 1500));
  if (S(a['Approved By'])) lines.push('Onaylayan: ' + S(a['Approved By']));
  if (S(a.Result)) lines.push('Sonuç: ' + S(a.Result));
  if (lead !== key) lines.push('Kayıt: ' + lead + ' (2. kişi)');
  comments.push({ row_number: a.row_number, lead_id: lead, company_key: key, action: act, comment_text: lines.join('\n') });
}

return [{ json: {
  dry_run: dryRun, overwrite_hand_filled: overwrite, only_lead_ids: only,
  stats: { companies_mailed: companies.length, clickup_tasks: tasks.length, matched: matched.length, to_create: creates.length, field_writes: fieldWrites.length, hand_filled_differences: conflicts.length, comments: comments.length, actions_waiting: waiting },
  creates, field_writes: fieldWrites, comments, task_by_company: taskByCompany,
  matched, conflicts, notes, tasks_without_lead: tasksWithoutLead,
} }];
