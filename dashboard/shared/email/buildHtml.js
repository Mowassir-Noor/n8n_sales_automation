// Shared copy of WF3 'Build HTML' (and 'Seed check'): byte-for-byte the n8n node's buildHtml().
// Do not edit here first: change the n8n node, then copy it here. `npm run test:drift` compares them.
// Self-contained: no imports, so sync-n8n.mjs can strip the export line and paste it into a Code node.

// Turns the plain-text draft into a light HTML version (sent alongside the plain text).
// Looks like a personal email: no images, no banners; a tidy signature and a small grey footer.
function buildHtml(body, s) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = (t) => t.replace(/(https?:\/\/[^\s<]+)/g, (u) => '<a href="' + u + '" style="color:#0e7490;text-decoration:none;">' + u.replace(/^https?:\/\//, '').replace(/\/$/, '') + '</a>');
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const name = String(s['Sender Name'] || '').trim();
  const title = String(s['Sender Title'] || '').trim();
  const company = String(s['Company Legal Name'] || '').trim();
  const iName = name ? lines.findIndex(l => l.trim() === name) : -1;
  const paras = (arr) => arr.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const P = (p, style) => '<p style="margin:0 0 16px;' + (style || '') + '">' + link(esc(p)).replace(/\n/g, '<br>') + '</p>';
  if (iName < 0) {
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:600px;">' + paras(lines).map(p => P(p)).join('') + '</div>';
  }
  let iEnd = iName;
  while (iEnd + 1 < lines.length && lines[iEnd + 1].trim()) iEnd++;
  const main = paras(lines.slice(0, iName));
  const sig = lines.slice(iName, iEnd + 1).map(l => l.trim());
  const foot = paras(lines.slice(iEnd + 1));
  const sigHtml = sig.map((l, i) => {
    const t = link(esc(l));
    if (i === 0) return '<div style="font-size:15px;font-weight:bold;color:#111827;">' + t + '</div>';
    if (l === title) return '<div style="color:#4b5563;">' + t + '</div>';
    if (l === company) return '<div style="font-weight:bold;color:#0e7490;margin-top:2px;">' + t + '</div>';
    if (/^https?:\/\//.test(l)) return '<div style="margin-top:2px;">' + t + '</div>';
    return '<div style="font-size:13px;color:#6b7280;">' + t + '</div>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:600px;">'
    + main.map(p => P(p)).join('')
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 0;"><tr><td style="border-left:3px solid #0e7490;padding:2px 0 2px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;">' + sigHtml + '</td></tr></table>'
    + (foot.length ? '<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#9ca3af;">' + foot.map(p => P(p, 'margin:0 0 6px;')).join('') + '</div>' : '')
    + '</div>';
}

export { buildHtml };
