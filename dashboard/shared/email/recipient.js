// Recipient, subjects and suppression, as WF3 and WF5 decide them. Self-contained: no imports.
//
// Sources:
//   recipientFor      WF3 'Send Email' / 'Send Email (SMTP)' and WF5 'Send Follow-up (SMTP)' toEmail:
//                     `Settings['Test Email'] || lead.Email` (no trim, as in n8n).
//                     Note: WF5's Gmail path ('Build Reply') replies to the original message's To header instead.
//   firstEmailSubject WF3 send nodes: `$json.Subject`.
//   followupSubject   WF5 'Send Follow-up (SMTP)': Subject as is when it starts with "re:" (any case), else 'Re: ' + Subject.
//   isSuppressed      WF3 'Safe to send?' (condition "nosupp", negated) = WF5 'Follow-up due?' (same expression).
//                     The other two 'Safe to send?' conditions (Compliance Status != Blocked, Opt-out != Yes) are not
//                     part of this function.

function recipientFor(lead, settings) {
  const testEmail = (settings && settings['Test Email']) || '';
  const realTo = String((lead && lead.Email) || '');
  return { to: String(testEmail || realTo), realTo, testMode: !!testEmail };
}

function firstEmailSubject(lead) {
  return String((lead && lead.Subject) || '');
}

function followupSubject(lead) {
  const subject = String((lead && lead.Subject) || '');
  return /^re:/i.test(subject) ? subject : 'Re: ' + subject;
}

function isSuppressed(email, suppression) {
  const e = String(email || '').toLowerCase().trim();
  const d = e.includes('@') ? e.split('@')[1] : '';
  return (suppression || []).some(r => {
    const se = String((r && r.Email) || '').toLowerCase().trim();
    const sd = String((r && r.Domain) || '').toLowerCase().replace(/^@/, '').trim();
    return !!((se && se === e) || (sd && d && (d === sd || d.endsWith('.' + sd))));
  });
}

export { recipientFor, firstEmailSubject, followupSubject, isSuppressed };
