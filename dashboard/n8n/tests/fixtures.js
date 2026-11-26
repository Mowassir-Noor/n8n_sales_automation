// Invented test data only (example.com / example.com.tr, made-up companies).
import { LEAD_HEADERS, SETTINGS_HEADERS } from '../code/_lib/common.js';
import { hashFirst, hashFollowup } from '../../shared/email/hash.js';

export const settings = {
  'Sender Name': 'Deniz Örnek',
  'Sender Title': 'Founder',
  'Company Legal Name': 'Örnek Danışmanlık Ltd. Şti.',
  'Company Address': 'Örnek Mahallesi 1. Sokak No: 1, 06000 Ankara',
  'Opt-out TR': 'Bu tür e-postaları almak istemiyorsanız lütfen yanıtlayın.',
  'Opt-out EN': 'If you would rather not receive emails like this, just reply and tell us.',
  'Nil Email': 'manager@example.com',
  'Sheet URL': 'https://docs.google.com/spreadsheets/d/example',
  'HubSpot Monthly Limit': '3000',
  'HubSpot Pause Percent': '80',
  'Test Email': 'test-inbox@example.com',
  'Nil WhatsApp': '',
  'WhatsApp Phone Number ID': '',
  'Nil Telegram Chat ID': '123456789',
  'Company Website': 'https://www.example.com',
  'HubSpot Owner ID': '',
  'Mail Provider': 'SMTP',
  'SMTP From': 'Example <outreach@example.com>',
  'Seed Email': '',
  'Seed Every': '12',
  'Target Countries': 'Turkey',
  'Dashboard URL': 'https://dash.example.com',
  'Weekly New Leads': '50',
  'Daily Send Limit': '10',
  'Calendar Link': 'https://calendar.example.com/demo',
  'Value Prop Exporter TR': 'Örnek platform, AB müşterilerinizin istediği uyum verisini bir kez düzenleyip her müşterinize yeniden sunmanızı sağlar.',
  'Value Prop Exporter EN': 'The example platform lets you organise the compliance data your EU customers ask for once and reuse it for every customer.',
  'Value Prop Brand TR': 'Örnek platform, markalara tedarikçi verisini tek platformdan talep edip doğrulama imkânı verir.',
  'Value Prop Brand EN': 'The example platform gives brands one platform to request and verify supplier data.',
};

// A first email in the shape WF2 'Assemble Email' builds for a firm in Turkey (Nil's rules of 23 Nov 2026).
export const goodBody = [
  'Sayın Ayşe Example,',
  '',
  'Web sitenizde ihracat pazarlarınızı ve sertifikalarınızı inceledim.',
  '',
  settings['Value Prop Exporter TR'],
  '',
  'Sizin sipariş akışınıza benzer bir örnek üzerinden 30 dakikalık canlı bir demo göstermek isterim. Size uygun zamanı buradan seçebilirsiniz: https://calendar.example.com/demo',
  '',
  'Saygılarımla,',
  '',
  'Deniz Örnek',
  'Founder',
  'Örnek Danışmanlık Ltd. Şti.',
  'Örnek Mahallesi 1. Sokak',
  'No: 1, 06000 Ankara',
  'https://www.example.com',
  '',
  'İletişim bilgilerinizi şirketinizin herkese açık web sitesinden aldık.',
  '',
  'Bu tür e-postaları almak istemiyorsanız lütfen yanıtlayın.',
].join('\n');

export function lead(over = {}) {
  const row = {};
  for (const h of LEAD_HEADERS) row[h] = '';
  return Object.assign(row, {
    row_number: 5,
    'Lead ID': 'L901',
    Company: 'Example Tekstil A.Ş.',
    Website: 'https://www.example-tekstil.com.tr',
    Country: 'Turkey',
    'Contact Name': 'Ayşe Example',
    Email: 'ayse@example-tekstil.com.tr',
    Language: 'tr',
    'Compliance Status': 'OK',
    Subject: 'EU export compliance',
    'Draft Body': goodBody,
    Approved: 'Pending',
    Stage: 'Drafted',
    'Last Updated': '2026-11-13T23:41:07.112+03:00',
  }, over);
}

export function expectFor(row, kind = 'first') {
  return {
    lastUpdated: row['Last Updated'],
    stage: row.Stage,
    approved: row.Approved,
    draftHash: kind === 'first' ? hashFirst(row.Subject, row['Draft Body']) : kind === 'followup' ? hashFollowup(row['Follow-up Draft']) : '',
  };
}

export function settingsRow(over = {}) {
  const row = { row_number: 2 };
  for (const h of SETTINGS_HEADERS) row[h] = settings[h];
  return Object.assign(row, over);
}
