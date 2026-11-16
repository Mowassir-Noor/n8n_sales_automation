// Invented test data only: example.com / example.org addresses, invented people and companies.

export const settings = {
  'Sender Name': 'Defne Kılıç', // Turkish dotless ı on purpose
  'Sender Title': 'Kurucu Ortak',
  'Company Legal Name': 'Örnek Tekstil Danışmanlık A.Ş.',
  'Company Address': 'Kavaklı Sk. No: 12, 06000 Çankaya/Ankara',
  'Opt-out TR': 'Bu tür e-postaları almak istemiyorsanız bu e-postayı "RET" yazarak yanıtlamanız yeterlidir.',
  'Opt-out EN': 'If you would rather not receive emails like this, simply reply with "unsubscribe".',
  'Nil Email': 'manager@example.org',
  'Sheet URL': 'https://docs.example.org/sheet',
  'HubSpot Monthly Limit': '',
  'HubSpot Pause Percent': '',
  'Test Email': '',
  'Nil WhatsApp': '',
  'WhatsApp Phone Number ID': '',
  'Nil Telegram Chat ID': '',
  'Company Website': 'https://www.texprove.example.org',
  'HubSpot Owner ID': '',
  'Mail Provider': 'SMTP',
  'SMTP From': 'Örnek <outreach@texprove.example.org>',
  'Seed Email': '',
  'Seed Every': '',
};

const emptyLead = {
  'Lead ID': '', Company: '', Website: '', Country: '', Segment: '', 'Contact Name': '', 'Contact Title': '',
  Email: '', LinkedIn: '', 'Research Notes': '', 'Personalisation Hook': '', Language: '',
  'Compliance Status': '', 'Compliance Notes': '', Subject: '', 'Draft Body': '', 'Draft Body EN': '',
  Approved: '', 'Nil Notes': '', Stage: '', 'Sent At': '', 'Gmail Thread ID': '', 'Follow-up Count': '',
  'Next Follow-up Date': '', 'Reply Category': '', 'Reply Summary': '', 'HubSpot Contact ID': '', 'Opt-out': '',
  'Last Updated': '', 'Source URL': '', 'Source Date': '', Confidence: '', 'Follow-up Draft': '', 'Hot Handled': '',
};

export function lead(over) {
  return {
    ...emptyLead,
    'Lead ID': 'L901',
    Company: 'Anadolu Örme Tekstil',
    Website: 'https://www.anadolu-orme.example.com',
    Country: 'Turkey',
    'Contact Name': 'Ayşe Demir',
    Email: 'ayse.demir@anadolu-orme.example.com',
    Language: 'tr',
    Stage: 'Drafted',
    Approved: 'Pending',
    ...over,
  };
}

const sigTr = [
  'Defne Kılıç',
  'Kurucu Ortak',
  'Örnek Tekstil Danışmanlık A.Ş.',
  'Kavaklı Sk. No: 12, 06000 Çankaya/Ankara',
  'https://www.texprove.example.org',
].join('\n');

const footTr = 'İletişim bilgilerinizi şirketinizin web sitesinden aldık.\n' + settings['Opt-out TR'];
const footEn = 'We found your contact details on your company website.\n' + settings['Opt-out EN'];

/** Five invented drafts: TR/EN, with and without contact name, one with a street address in the text. */
export const drafts = [
  {
    name: 'tr-with-contact',
    lead: lead({}),
    subject: 'Dijital Ürün Pasaportu hakkında kısa bir not',
    body: 'Merhaba Ayşe Hanım,\n\nAnadolu Örme\'nin örme kumaş koleksiyonunu inceledim. AB\'de Dijital Ürün Pasaportu (DPP) tekstil için yakında zorunlu olacak.\n\nBu konuda 15 dakikalık bir görüşme yapabilir miyiz?\n\nSaygılarımla,\n' + sigTr + '\n\n' + footTr,
  },
  {
    name: 'tr-no-contact',
    lead: lead({ 'Contact Name': '', Email: 'info@anadolu-orme.example.com' }),
    subject: 'DPP hazırlığı',
    body: 'Merhaba,\n\nAB Dijital Ürün Pasaportu kuralları ihracatçı üreticileri doğrudan etkiliyor.\nKısa bir özet göndermemi ister misiniz?\n\n' + sigTr + '\n\n' + footTr,
  },
  {
    name: 'en-with-contact',
    lead: lead({ Language: 'en', 'Contact Name': 'Mert Yılmaz', Email: 'mert@denim-works.example.com', Website: 'denim-works.example.com', Company: 'Denim Works Example Ltd' }),
    subject: 'Digital Product Passport for your denim line',
    body: 'Dear Mert,\n\nI saw the new collection on https://denim-works.example.com/collections/ and wanted to share a short note on the EU Digital Product Passport.\n\nWould a 15-minute call next week be useful?\n\nBest regards,\n' + sigTr.replace('Kurucu Ortak', 'Co-founder') + '\n\n' + footEn,
  },
  {
    name: 'en-no-contact',
    lead: lead({ Language: 'en', 'Contact Name': '', Email: 'hello@ege-iplik.example.com', Website: 'https://ege-iplik.example.com', Company: 'Ege İplik Example' }),
    subject: 'EU textile rules: a short summary',
    body: 'Hello,\n\nEU rules for textile traceability <DPP> & labelling are changing.\n\nI can send a one-page summary.\n\nKind regards,\n' + sigTr + '\n\n' + footEn,
  },
  {
    name: 'tr-street-address',
    lead: lead({ 'Contact Name': 'Can Öztürk', Email: 'can@marmara-dokuma.example.com', Website: 'https://marmara-dokuma.example.com', Company: 'Marmara Dokuma Example' }),
    subject: 'Bursa ziyareti',
    body: 'Merhaba Can Bey,\n\nGelecek ay Bursa\'dayım; atölyeniz Lale Sokak No: 7 ve Gül Cad. No. 3 adreslerine yakın.\nGörüşmek isterseniz haber verin.\n\n' + sigTr + '\n\n' + footTr,
  },
];
