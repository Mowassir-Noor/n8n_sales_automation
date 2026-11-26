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
  'Calendar Link': 'https://calendar.example.org/demo',
  'Value Prop Exporter TR': 'Örnek platform, ihracatçıların AB müşterilerine sunduğu uyum verisini bir kez düzenleyip her müşteriye yeniden sunmasını sağlar.',
  'Value Prop Exporter EN': 'The example platform lets exporters organise the compliance data their EU customers ask for once and reuse it for every customer.',
  'Value Prop Brand TR': 'Örnek platform, markalara tedarikçi verisini tek platformdan talep edip doğrulama imkânı verir.',
  'Value Prop Brand EN': 'The example platform gives brands one platform to request and verify supplier data.',
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

const footTr = 'İletişim bilgilerinizi şirketinizin herkese açık web sitesinden aldık.\n\n' + settings['Opt-out TR'];
const footEn = "We found your contact details on your company's public website.\n\n" + settings['Opt-out EN'];
const ctaTr = 'Sizin sipariş akışınıza benzer bir örnek üzerinden 30 dakikalık canlı bir demo göstermek isterim. Size uygun zamanı buradan seçebilirsiniz: ' + settings['Calendar Link'];
const ctaEn = 'Could I show you this in a 30-minute live demo, built on an example close to your own order flow? You can pick a time here: ' + settings['Calendar Link'];

// The shape WF2 'Assemble Email' builds (Nil's rules of 23 Nov 2026): greeting, one personal sentence, the value
// sentence from Settings, a supporting sentence, the demo offer with the calendar link, sign-off, signature, footer.
function mailTr(greeting, opening, support) {
  return [greeting, opening, settings['Value Prop Exporter TR'], support, ctaTr, 'Saygılarımla,', sigTr, footTr].filter(Boolean).join('\n\n');
}
function mailEn(greeting, opening, support) {
  return [greeting, opening, settings['Value Prop Exporter EN'], support, ctaEn, 'Kind regards,', sigTr.replace('Kurucu Ortak', 'Co-founder'), footEn].filter(Boolean).join('\n\n');
}

/** A follow-up in the shape WF5 'Assemble Follow-up' builds. */
export const followupTr = ['Sayın Ayşe Demir,', 'Geçen hafta gönderdiğim maile kısa bir ek yapmak istedim.', 'AB müşterileriniz uyum verisini giderek daha sık isteyecek ve bu veriyi bir kez düzenlemek için iyi bir zaman.',
  'Sizin sipariş akışınıza benzer bir örnek üzerinden 30 dakikalık canlı demo için size uygun zamanı buradan seçebilirsiniz: ' + settings['Calendar Link'], 'Saygılarımla,', sigTr, footTr].join('\n\n');

/** Five invented drafts: TR/EN, with and without contact name, one with a street address in the text. */
export const drafts = [
  {
    name: 'tr-with-contact',
    lead: lead({}),
    subject: 'Dijital Ürün Pasaportu hakkında kısa bir not',
    body: mailTr('Sayın Ayşe Demir,', "Anadolu Örme'nin yeni örme koleksiyonunu ve fuar katılımınızı ilgiyle inceledim.", "AB'de zorla çalıştırma yasağı 14 Aralık 2027'de uygulanmaya başlıyor ve bu veri sizin için de gündeme gelecek."),
  },
  {
    name: 'tr-no-contact',
    lead: lead({ 'Contact Name': '', Email: 'info@anadolu-orme.example.com' }),
    subject: 'DPP hazırlığı',
    body: mailTr('Sayın Anadolu Örme ekibi,', 'Web sitenizde ihracat pazarlarınızı ve sertifikalarınızı inceledim.', ''),
  },
  {
    name: 'en-with-contact',
    lead: lead({ Country: 'Bangladesh', Language: 'en', 'Contact Name': 'Mert Yılmaz', Email: 'mert@denim-works.example.com', Website: 'denim-works.example.com', Company: 'Denim Works Example Ltd' }),
    subject: 'Digital Product Passport for your denim line',
    body: mailEn('Dear Mert,', 'I saw the new collection on your website and the trade fair you joined this year.', 'The EU forced labour ban applies from 14 December 2027, and your customers will ask for the data behind it.'),
  },
  {
    name: 'en-no-contact',
    lead: lead({ Country: 'Vietnam', Language: 'en', 'Contact Name': '', Email: 'hello@ege-iplik.example.com', Website: 'https://ege-iplik.example.com', Company: 'Ege İplik Example' }),
    subject: 'EU textile rules: a short summary',
    body: mailEn('Dear Ege İplik Example team,', 'EU rules for textile traceability <DPP> & labelling are changing, and your site shows you already export to the EU.', ''),
  },
  {
    name: 'tr-street-address',
    lead: lead({ 'Contact Name': 'Can Öztürk', Email: 'can@marmara-dokuma.example.com', Website: 'https://marmara-dokuma.example.com', Company: 'Marmara Dokuma Example' }),
    subject: 'Bursa ziyareti',
    body: mailTr('Sayın Can Öztürk,', 'Atölyenizin Lale Sokak No: 7 ve Gül Cad. No. 3 adreslerinde olduğunu web sitenizde gördüm.', ''),
  },
];
