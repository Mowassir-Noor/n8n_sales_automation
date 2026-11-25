import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHtml, checkDraft, fixAddressLineBreak, complianceIssues, nilRuleIssues, sensitiveIssues,
  checkFollowup, followupNilRuleIssues, followupSensitiveIssues,
  recipientFor, firstEmailSubject, followupSubject, isSuppressed,
  hashText, hashFirst, hashFollowup,
} from '../email/index.js';
import { nodeFunctionSource } from '../../scripts/drift.mjs';
import { settings, lead, drafts, followupTr } from './fixtures.js';

const EMAIL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'email');

const n8nFn = (wf, node, fn) => {
  const src = nodeFunctionSource(wf, node, fn);
  if (!src) throw new Error(`${fn}() not found in ${node}`);
  return new Function(src + '\nreturn ' + fn + ';')();
};

// ---------------------------------------------------------------------------------------------
describe('buildHtml', () => {
  const wf3BuildHtml = n8nFn('WF3-send-first-email.json', 'Build HTML', 'buildHtml');
  const wf3SeedHtml = n8nFn('WF3-send-first-email.json', 'Seed check', 'buildHtml');

  for (const d of drafts) {
    it(`snapshot: ${d.name}`, () => {
      const r = checkDraft({ subject: d.subject, body: d.body, lead: d.lead, settings, suppression: [] });
      expect(r).toMatchSnapshot('checkDraft');
      expect(buildHtml(r.body, settings)).toMatchSnapshot('html');
    });

    it(`identical to the WF3 'Build HTML' and 'Seed check' node code: ${d.name}`, () => {
      for (const body of [d.body, fixAddressLineBreak(d.body), d.body.replace(/\n/g, '\r\n')]) {
        const ours = buildHtml(body, settings);
        expect(wf3BuildHtml(body, settings)).toBe(ours);
        expect(wf3SeedHtml(body, settings)).toBe(ours);
      }
    });
  }

  it('identical to the node code on edge cases', () => {
    const cases = [
      ['', settings],
      [null, settings],
      ['Just one line', settings],
      ['No signature here\n\nSecond paragraph', settings],
      [drafts[0].body, { ...settings, 'Sender Name': '' }],
      [drafts[0].body, { ...settings, 'Sender Name': '  Defne Kılıç  ' }],
      ['Hi\n\n  Defne Kılıç  \nhttps://www.texprove.example.org/\n\n\n\nfoot <b> & "x"', settings],
    ];
    for (const [body, s] of cases) expect(wf3BuildHtml(body, s)).toBe(buildHtml(body, s));
  });

  it('falls back to plain paragraphs without the Sender Name line', () => {
    const html = buildHtml('Hello\n\nBye', settings);
    expect(html).not.toContain('<table');
    expect(html).toContain('<p style="margin:0 0 16px;">Hello</p>');
  });

  it('escapes HTML and links URLs', () => {
    const html = buildHtml('a <script> & b https://x.example.com/p/', settings);
    expect(html).toContain('a &lt;script&gt; &amp; b <a href="https://x.example.com/p/"');
    expect(html).toContain('>x.example.com/p</a>');
  });
});

// ---------------------------------------------------------------------------------------------
describe('fixAddressLineBreak', () => {
  it.each([
    ['Lale Sk. No: 7', 'Lale Sk.\nNo: 7'],
    ['Lale Sok. No:7', 'Lale Sok.\nNo:7'],
    ['Gül Cad. No. 3', 'Gül Cad.\nNo. 3'],
    ['Gül Cd.  No : 3', 'Gül Cd.\nNo : 3'],
    ['Deniz Bulv.\tNo: 1', 'Deniz Bulv.\nNo: 1'],
    ['Lale Sokak No: 7', 'Lale Sokak\nNo: 7'],
    ['Lale Sokağı No: 7', 'Lale Sokağı\nNo: 7'],
    ['Atatürk Caddesi No: 9', 'Atatürk Caddesi\nNo: 9'],
    ['Sahil Bulvarı No: 2', 'Sahil Bulvarı\nNo: 2'],
  ])('%s', (input, out) => expect(fixAddressLineBreak(input)).toBe(out));

  it('leaves other text alone', () => {
    for (const s of ['Ofis No: 36', 'Sk. Numara 4', 'Sk.\nNo: 1', 'Tasks. No: 1', '']) expect(fixAddressLineBreak(s)).toBe(s);
    expect(fixAddressLineBreak(undefined)).toBe('');
  });

  it('is what checkDraft returns as body', () => {
    const r = checkDraft({ subject: 's', body: 'Lale Sk. No: 7', lead: lead({}), settings, suppression: [] });
    expect(r.body).toBe('Lale Sk.\nNo: 7');
  });
});

// ---------------------------------------------------------------------------------------------
describe('checkDraft', () => {
  const ok = drafts[0];
  const run = (over = {}) => checkDraft({ subject: ok.subject, body: ok.body, lead: ok.lead, settings, suppression: [], ...over });

  it('all five fixture drafts are OK', () => {
    for (const d of drafts) {
      const r = checkDraft({ subject: d.subject, body: d.body, lead: d.lead, settings, suppression: [] });
      expect(r, d.name).toEqual({ status: 'OK', notes: [], body: fixAddressLineBreak(d.body) });
    }
  });

  it('Subject is empty / Body is empty', () => {
    expect(run({ subject: '   ' }).notes).toEqual(['Subject is empty']);
    expect(run({ body: '' }).notes).toContain('Body is empty');
    expect(run({ subject: '' }).status).toBe('Needs fix');
  });

  it('Sender name / legal name / address missing', () => {
    expect(run({ body: ok.body.replace('Defne Kılıç', 'D. K.') }).notes).toEqual(['Sender name missing', 'signature line not found']);
    expect(run({ body: ok.body.replace('Örnek Tekstil Danışmanlık A.Ş.', '') }).notes).toEqual(['Company legal name missing']);
    expect(run({ body: ok.body.replace('Kavaklı Sk. No: 12', 'Başka adres') }).notes).toEqual(['Company address missing']);
    // only the first 12 characters of the address are required
    expect(run({ body: ok.body.replace('Kavaklı Sk. No: 12, 06000', 'Kavaklı Sk. No: 99') }).notes).toEqual([]);
    expect(run({ settings: { ...settings, 'Sender Name': '' } }).notes).toEqual(['Sender name missing']);
  });

  it('Texprove website missing from signature (Settings Company Website, default texprove.com)', () => {
    expect(run({ body: ok.body.replace('https://www.texprove.example.org', '') }).notes).toEqual(['Texprove website missing from signature']);
    const noSite = { ...settings, 'Company Website': '' };
    expect(run({ settings: noSite }).notes).toEqual([
      'Texprove website missing from signature',
      'Link other than the calendar link and texprove.com: https://www.texprove.example.org',
    ]);
    expect(run({ settings: noSite, body: ok.body.replace('https://www.texprove.example.org', 'texprove.com') }).notes).toEqual([]);
  });

  it('Opt-out sentence missing (TR / EN) uses the first 25 characters', () => {
    expect(run({ body: ok.body.replace(settings['Opt-out TR'], '') }).notes).toEqual(['Opt-out sentence missing (TR)']);
    const en = drafts[2];
    expect(checkDraft({ subject: en.subject, body: en.body.replace('If you would rather', 'If you'), lead: en.lead, settings, suppression: [] }).notes)
      .toEqual(['Opt-out sentence missing (EN)']);
    expect(run({ body: ok.body.replace(settings['Opt-out TR'], settings['Opt-out TR'].slice(0, 25)) }).notes).toEqual([]);
  });

  it('Data-source sentence missing', () => {
    expect(run({ body: ok.body.replace('web sitesinden aldık', 'buldum') }).notes).toEqual(['Data-source sentence missing']);
    const en = drafts[2];
    expect(checkDraft({ subject: en.subject, body: en.body.replace('contact details on your company', 'details'), lead: en.lead, settings, suppression: [] }).notes)
      .toEqual(['Data-source sentence missing']);
  });

  it('Links: only the calendar link and the own website', () => {
    const r = run({ body: ok.body + '\nhttps://other.example.net/x and http://evil.example.com).' });
    expect(r.notes).toEqual(['Link other than the calendar link and texprove.example.org: https://other.example.net/x, http://evil.example.com']);
    // the lead's own website is no longer allowed either
    expect(run({ body: ok.body + '\nhttps://anadolu-orme.example.com/urunler' }).notes).toEqual(['Link other than the calendar link and texprove.example.org: https://anadolu-orme.example.com/urunler']);
  });

  it('Too long (over 330 words incl. signature)', () => {
    const words = ok.body.trim().split(/\s+/).length;
    const pad = ' kelime'.repeat(331 - words);
    const r = run({ body: ok.body.replace('Saygılarımla,', 'Saygılarımla' + pad + ',') });
    expect(r.notes).toEqual(['Too long (331 words incl. signature)']);
    expect(run({ body: ok.body.replace('Saygılarımla,', 'Saygılarımla' + ' kelime'.repeat(330 - words) + ',') }).notes).toEqual([]);
  });

  it("Nil's rules: demo offer, calendar link, value sentence", () => {
    expect(run({ body: ok.body.replace('30 dakikalık', 'kısa') }).notes).toEqual(['30-minute demo offer missing']);
    expect(run({ body: ok.body.replace(settings['Calendar Link'], '') }).notes).toEqual(['Calendar link missing']);
    expect(run({ settings: { ...settings, 'Calendar Link': '' } }).notes).toEqual([
      "Settings 'Calendar Link' is empty",
      'Link other than the calendar link and texprove.example.org: https://calendar.example.org/demo',
    ]);
    expect(run({ body: ok.body.replace('bir kez düzenleyip', 'düzenleyip') }).notes).toEqual(['Value proposition sentence missing (exporter, TR)']);
    expect(run({ settings: { ...settings, 'Value Prop Exporter TR': '' } }).notes).toEqual(['Value proposition sentence missing (exporter, TR)']);
    // a brand needs the sentence of the brand template, not the exporter one
    expect(run({ lead: lead({ Segment: 'Marka' }) }).notes).toEqual(['Value proposition sentence missing (brand, TR)']);
  });

  it("Nil's rules: banned offers, claims and dates", () => {
    const add = (t) => run({ body: ok.body.replace('Saygılarımla,', t + '\n\nSaygılarımla,') }).notes;
    expect(add('15 dakikalık bir görüşme de olur.')).toEqual(['Mentions 15 minutes (the offer is a 30-minute demo)', 'Offer other than the demo: görüşme']);
    expect(add('Katalog ve numune gönderebilirim.')).toEqual(['Price, package, catalog or sample wording: katalog, numune']);
    expect(add('Tier-4 seviyesine kadar izlenebilirlik.')).toEqual(['Mentions Tier (Tier-4 / tier depth claims are not allowed)']);
    expect(add('Yüzde 40 tasarruf ve daha az denetim.')).toEqual(['Contains a percentage (no savings rates: there is no measured data)', 'Claims fewer audits']);
    expect(add('Kural 1 Ocak 2027 tarihinde başlıyor.')).toEqual(['Date other than 14 December 2027, 2027 (expected) and April 2028: 1 ocak 2027']);
    expect(add('Pasaport 2027 yılında bekleniyor, EPR ise Nisan 2028.')).toEqual([]);
  });

  it("Nil's rules: language follows the country", () => {
    expect(run({ lead: lead({ Country: 'Bangladesh' }) }).notes).toEqual([
      'Opt-out sentence missing (EN)',
      'Data-source sentence missing',
      'Value proposition sentence missing (exporter, EN)',
      'Wrong language: firms outside Turkey get English',
    ]);
    const en = drafts[2];
    expect(checkDraft({ subject: en.subject, body: en.body, lead: { ...en.lead, Country: 'Turkey' }, settings, suppression: [] }).notes).toContain('Wrong language: firms in Turkey get Turkish');
  });

  it('Hype wording', () => {
    expect(run({ body: ok.body + '\nGaranti veriyoruz, son şans!' }).notes).toEqual(['Hype wording: garanti, son şans']);
    expect(run({ body: ok.body + '\nguaranteed, last chance' }).notes).toEqual(['Hype wording: guaranteed, last chance']);
  });

  it('Trade-secret rule checks subject and body', () => {
    expect(run({ subject: 'Zara tedarikçisi olduğunuz için' }).notes).toEqual([
      'Names a buyer or brand: zara',
      'Commercially sensitive wording: tedarikçisi olduğunuz',
    ]);
    expect(run({ body: ok.body + '\nH&M ve LC Waikiki için 5.000 adet, 3 € fiyat, kapasite ve marj.' }).notes).toEqual([
      'Names a buyer or brand: h&m, lc waikiki',
      'Mentions money or prices',
      'Mentions order volumes or quantities',
      'Commercially sensitive wording: fiyat, kapasite, marj',
    ]);
  });

  it('Signature line not found (dashboard rule)', () => {
    expect(run({ body: ok.body.replace('\nDefne Kılıç\n', '\nSaygılar, Defne Kılıç\n') }).notes).toEqual(['signature line not found']);
    expect(run({ body: ok.body.replace('\nDefne Kılıç\n', '\n   Defne Kılıç  \n') }).notes).toEqual([]);
    // dotless ı vs i is a different line
    expect(run({ body: ok.body.replace('\nDefne Kılıç\n', '\nDefne Kilic\n') + ' Defne Kılıç' }).notes).toEqual(['signature line not found']);
  });

  it('Blocked: the WF2 Compliance check rules', () => {
    expect(run({ lead: lead({ Email: '' }) }).notes[0]).toBe('Email is empty');
    expect(run({ lead: lead({ Email: 'x@gmail.com' }) })).toMatchObject({ status: 'Blocked', notes: ['Free or personal email domain'] });
    expect(run({ lead: lead({ 'Opt-out': 'yes' }) })).toMatchObject({ status: 'Blocked', notes: ['Lead opted out'] });
    expect(run({ suppression: [{ Email: ' AYSE.DEMIR@anadolu-orme.example.com', Domain: '', Reason: 'x', Date: '' }] }))
      .toMatchObject({ status: 'Blocked', notes: ['On suppression list (İYS ret / do-not-contact)'] });
    expect(run({ suppression: [{ Email: '', Domain: '@example.com', Reason: 'x', Date: '' }] }))
      .toMatchObject({ status: 'Blocked', notes: ['Email domain on suppression list'] });
    expect(run({ lead: lead({ Email: 'a@elsewhere.example.org' }) }).notes).toEqual(['Email domain does not match website domain']);
    expect(run({ lead: lead({ Country: 'Germany' }) }).notes[0]).toBe('Country not allowed');
    expect(run({ lead: lead({ Country: 'Bangladesh' }) }).notes).not.toContain('Country not allowed');
    for (const c of ['Türkiye', ' turkiye ', 'TURKEY']) expect(run({ lead: lead({ Country: c }) }).status).toBe('OK');
    // a mail to a brand may name that brand
    expect(sensitiveIssues('Koton için', 'Koton Mağazacılık')).toEqual([]);
  });

  it('Blocked wins over Needs fix; notes list compliance reasons first', () => {
    const r = run({ subject: '', lead: lead({ Country: 'France' }) });
    expect(r.status).toBe('Blocked');
    expect(r.notes.slice(0, 2)).toEqual(['Country not allowed', 'Subject is empty']);
  });

  it('complianceIssues and sensitiveIssues are exported', () => {
    expect(complianceIssues(lead({}), [])).toEqual([]);
    expect(sensitiveIssues('yazarak cotton')).toEqual([]);
    expect(sensitiveIssues('Otto ve Zara.')).toEqual(['Names a buyer or brand: zara, otto']);
  });

  it('tolerates missing input', () => {
    expect(checkDraft(undefined).status).toBe('Blocked');
    expect(checkDraft({}).body).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
describe('checkFollowup', () => {
  const body = followupTr;
  const run = (over = {}) => checkFollowup({ body, lead: lead({ Stage: 'Sent' }), settings, suppression: [], ...over });

  it('OK', () => expect(run()).toEqual({ ok: true, notes: [] }));
  it('Body is empty', () => expect(run({ body: '  ' }).notes[0]).toBe('Body is empty'));
  it('Too long (over 230 words)', () => {
    const words = body.trim().split(/\s+/).length;
    expect(run({ body: body.replace('Saygılarımla,', 'Saygılarımla' + ' kelime'.repeat(231 - words) + ',') }).notes).toEqual(['Too long (231 words)']);
    expect(run({ body: body.replace('Saygılarımla,', 'Saygılarımla' + ' kelime'.repeat(230 - words) + ',') }).notes).toEqual([]);
  });
  it("Nil's rules apply to follow-ups too", () => {
    expect(run({ body: body.replace(settings['Calendar Link'], '') }).notes).toEqual(['Calendar link missing']);
    expect(run({ body: body.replace('30 dakikalık', 'kısa') }).notes).toEqual(['30-minute demo offer missing']);
    expect(run({ lead: lead({ Stage: 'Sent', Country: 'Vietnam' }) }).notes).toEqual(['Wrong language: firms outside Turkey get English']);
  });
  it('Hype wording', () => expect(run({ body: body + ' Last chance, GARANTİ değil ama garanti' }).notes).toEqual(['Hype wording: garanti, last chance']));
  it('Trade-secret rule', () => {
    expect(run({ body: body + ' Inditex için 200 pcs, USD fiyat' }).notes).toEqual([
      'Names a buyer or brand: inditex',
      'Mentions money or prices',
      'Mentions order volumes or quantities',
      'Commercially sensitive wording: fiyat',
    ]);
  });
  it('Opt-out and suppression (WF5 Follow-up due? gate)', () => {
    expect(run({ lead: lead({ 'Opt-out': 'Yes' }) }).notes).toEqual(['Lead opted out']);
    expect(run({ suppression: [{ Email: '', Domain: 'anadolu-orme.example.com', Reason: '', Date: '' }] }).notes)
      .toEqual(['On suppression list (İYS ret / do-not-contact)']);
  });
  it('tolerates missing lead and settings', () => expect(checkFollowup({ body }).ok).toBe(false));
  it('followupSensitiveIssues equals sensitiveIssues', () => {
    for (const t of ['Zara', '5 ton', '₺', 'moq', 'clean text']) expect(followupSensitiveIssues(t)).toEqual(sensitiveIssues(t));
    const o = { lang: 'tr', calendarLink: settings['Calendar Link'], ownDomain: 'texprove.example.org', senderName: settings['Sender Name'] };
    for (const t of [body, 'Tier-4', '15 dakika', '']) expect(followupNilRuleIssues(t, o)).toEqual(nilRuleIssues(t, o));
  });
});

// ---------------------------------------------------------------------------------------------
describe('recipient', () => {
  const l = lead({ Email: 'ayse.demir@anadolu-orme.example.com', Subject: 'DPP notu' });
  it('recipientFor: Test Email overrides', () => {
    expect(recipientFor(l, settings)).toEqual({ to: 'ayse.demir@anadolu-orme.example.com', realTo: 'ayse.demir@anadolu-orme.example.com', testMode: false });
    expect(recipientFor(l, { ...settings, 'Test Email': 'test@example.org' }))
      .toEqual({ to: 'test@example.org', realTo: 'ayse.demir@anadolu-orme.example.com', testMode: true });
  });
  it('firstEmailSubject', () => {
    expect(firstEmailSubject(l)).toBe('DPP notu');
    expect(firstEmailSubject({})).toBe('');
  });
  it('followupSubject adds Re: when missing (same as WF5 Send Follow-up (SMTP))', () => {
    expect(followupSubject(l)).toBe('Re: DPP notu');
    expect(followupSubject({ Subject: 'RE: x' })).toBe('RE: x');
    expect(followupSubject({ Subject: 're:x' })).toBe('re:x');
    expect(followupSubject({ Subject: ' Re: x' })).toBe('Re:  Re: x');
  });
  it('followupSubject matches the n8n expression', () => {
    const expr = (S) => (/^re:/i.test(String(S || '')) ? S : 'Re: ' + S);
    for (const s of ['a', 'Re: a', 'rE:a', 'Ynt: a', '']) expect(followupSubject({ Subject: s })).toBe(expr(s));
  });
  it('isSuppressed (WF3 Safe to send?)', () => {
    const supp = [
      { Email: 'Blocked@Example.com ', Domain: '', Reason: '', Date: '' },
      { Email: '', Domain: '@suppressed.example.org', Reason: '', Date: '' },
    ];
    expect(isSuppressed('blocked@example.com', supp)).toBe(true);
    expect(isSuppressed(' BLOCKED@example.com', supp)).toBe(true);
    expect(isSuppressed('other@example.com', supp)).toBe(false);
    expect(isSuppressed('a@suppressed.example.org', supp)).toBe(true);
    expect(isSuppressed('a@mail.suppressed.example.org', supp)).toBe(true);
    expect(isSuppressed('a@notsuppressed.example.org', supp)).toBe(false);
    expect(isSuppressed('', supp)).toBe(false);
    expect(isSuppressed('a@example.com', [])).toBe(false);
    expect(isSuppressed('a@example.com', undefined)).toBe(false);
  });
  it('isSuppressed equals the WF3 node expression', () => {
    const d = JSON.parse(readFileSync(join(EMAIL_DIR, '..', '..', '..', 'WF3-send-first-email.json'), 'utf8'));
    const cond = d.nodes.find((n) => n.name === 'Safe to send?').parameters.conditions.conditions.find((c) => c.id === 'nosupp');
    const expr = cond.leftValue.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
    const supp = [{ Email: 'x@example.com', Domain: '' }, { Email: '', Domain: 'sub.example.org' }, { Email: '', Domain: '' }];
    const evalNode = (email) => new Function('$json', '$', 'return ' + expr)({ Email: email }, () => ({ all: () => supp.map((json) => ({ json })) }));
    for (const e of ['x@example.com', 'X@EXAMPLE.COM', 'y@example.com', 'a@sub.example.org', 'a@b.sub.example.org', 'a@xsub.example.org', '', 'nodomain']) {
      expect(isSuppressed(e, supp), e).toBe(!evalNode(e));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('hash', () => {
  // Reference: the widely used public-domain cyrb53 (bryc), seed 0.
  const cyrb53 = (str, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  it('cyrb53, 14 lowercase hex chars', () => {
    for (const s of ['', 'a', 'Defne Kılıç', '🙂 emoji', 'x'.repeat(5000), drafts[0].body]) {
      expect(hashText(s)).toMatch(/^[0-9a-f]{14}$/);
      expect(hashText(s)).toBe(cyrb53(s).toString(16).padStart(14, '0'));
    }
    expect(hashText('a')).toMatchSnapshot();
  });
  it('null/undefined count as ""', () => {
    expect(hashText(undefined)).toBe(hashText(''));
    expect(hashText(null)).toBe(hashText(''));
    expect(hashFirst(undefined, null)).toBe(hashFirst('', ''));
    expect(hashFollowup(undefined)).toBe(hashText(''));
  });
  it('hashFirst = hashText(subject + NUL + body)', () => {
    expect(hashFirst('s', 'b')).toBe(hashText('s\u0000b'));
    expect(hashFirst('ab', 'c')).not.toBe(hashFirst('a', 'bc'));
  });
  it('hashFollowup = hashText', () => expect(hashFollowup('x')).toBe(hashText('x')));
  it('differs on small edits', () => expect(hashText('Merhaba Ayşe')).not.toBe(hashText('Merhaba Ayse')));
});

// ---------------------------------------------------------------------------------------------
describe('n8n paste rules', () => {
  const files = readdirSync(EMAIL_DIR).filter((f) => f.endsWith('.js') && f !== 'index.js');
  const strip = (src) => src.replace(/^export \{[^}]*\};?\s*$/m, '');

  it.each(files)('%s is self-contained, export line last, no globals', (f) => {
    const src = readFileSync(join(EMAIL_DIR, f), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src.trimEnd().split('\n').pop()).toMatch(/^export \{[^}]*\};$/);
    expect(src.match(/^export /gm)).toHaveLength(1);
    const code = strip(src).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(require|process|Buffer|window|document|globalThis|self|module|exports)\b/);
    expect(code).not.toMatch(/\$input|\$json|\$\(|\$now|\$today/);
    expect(() => new Function(strip(src))).not.toThrow();
  });

  it('all files pasted into one Code node compile together (no duplicate top-level names)', () => {
    const all = files.map((f) => strip(readFileSync(join(EMAIL_DIR, f), 'utf8'))).join('\n');
    const fns = [...all.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
    expect(new Set(fns).size).toBe(fns.length);
    const api = new Function(all + '\nreturn { buildHtml, checkDraft, checkFollowup, recipientFor, hashFirst };')();
    const d = drafts[4];
    const r = api.checkDraft({ subject: d.subject, body: d.body, lead: d.lead, settings, suppression: [] });
    expect(r).toEqual(checkDraft({ subject: d.subject, body: d.body, lead: d.lead, settings, suppression: [] }));
    expect(api.buildHtml(r.body, settings)).toBe(buildHtml(r.body, settings));
  });
});
