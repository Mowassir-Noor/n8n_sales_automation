#!/usr/bin/env node
// Drift check between the n8n workflow exports (repo root) and dashboard/shared/email.
//
//   node scripts/drift.mjs          check; exit 1 on any drift      (npm run test:drift)
//   node scripts/drift.mjs --pin    re-pin the upstream copies under shared/email/upstream/
//
// Two kinds of checks:
//   1. Function copies: the source of a named function inside an n8n Code node must equal the shared file's
//      function after whitespace normalisation (buildHtml from WF3 'Build HTML' and 'Seed check'; sensitiveIssues
//      from WF2 'Check Draft' and WF5 'Check Follow-up').
//   2. Pinned nodes: nodes that are not pure functions (the n8n code reads $input / other nodes) are ported by
//      hand. A copy of what was ported is pinned under shared/email/upstream/; when the node in the WF JSON no
//      longer matches the pin, the shared port may be stale.
// Also imported by shared/tests/drift.test.js.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DASHBOARD = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(DASHBOARD, '..');
const SHARED = join(DASHBOARD, 'shared', 'email');
const UPSTREAM = join(SHARED, 'upstream');

const WF2 = 'WF2-compliance-and-draft.json';
const WF3 = 'WF3-send-first-email.json';
const WF5 = 'WF5-follow-ups.json';

/** Named function copies: [workflow file, node, function name in node, shared file, function name in shared file]. */
const FUNCTION_COPIES = [
  { wf: WF3, node: 'Build HTML', fn: 'buildHtml', file: 'buildHtml.js', sharedFn: 'buildHtml' },
  { wf: WF3, node: 'Seed check', fn: 'buildHtml', file: 'buildHtml.js', sharedFn: 'buildHtml' },
  { wf: WF2, node: 'Check Draft', fn: 'sensitiveIssues', file: 'checkDraft.js', sharedFn: 'sensitiveIssues' },
  { wf: WF5, node: 'Check Follow-up', fn: 'sensitiveIssues', file: 'checkFollowup.js', sharedFn: 'followupSensitiveIssues' },
];

const code = (n) => String(n.parameters.jsCode || '');
const pick = (...keys) => (n) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, n.parameters[k]])), null, 2) + '\n';

/** Pinned nodes and what part of them the shared port depends on. */
const PINS = [
  { wf: WF2, node: 'Check Draft', port: 'checkDraft.js (checkDraft, fixAddressLineBreak)', pin: 'WF2__Check-Draft.code.txt', extract: code },
  { wf: WF2, node: 'Compliance check', port: 'checkDraft.js (complianceIssues)', pin: 'WF2__Compliance-check.code.txt', extract: code },
  { wf: WF5, node: 'Check Follow-up', port: 'checkFollowup.js (checkFollowup)', pin: 'WF5__Check-Follow-up.code.txt', extract: code },
  { wf: WF5, node: 'Follow-up due?', port: 'checkFollowup.js (opt-out/suppression), recipient.js (isSuppressed)', pin: 'WF5__Follow-up-due.json', extract: pick('conditions') },
  { wf: WF3, node: 'Safe to send?', port: 'recipient.js (isSuppressed)', pin: 'WF3__Safe-to-send.json', extract: pick('conditions') },
  { wf: WF3, node: 'Send Email', port: 'recipient.js (recipientFor, firstEmailSubject)', pin: 'WF3__Send-Email.json', extract: pick('sendTo', 'subject') },
  { wf: WF3, node: 'Send Email (SMTP)', port: 'recipient.js (recipientFor, firstEmailSubject)', pin: 'WF3__Send-Email-SMTP.json', extract: pick('toEmail', 'subject') },
  { wf: WF5, node: 'Send Follow-up (SMTP)', port: 'recipient.js (recipientFor, followupSubject)', pin: 'WF5__Send-Follow-up-SMTP.json', extract: pick('toEmail', 'subject') },
];

export function normalise(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Source of `function name(...) { ... }`: from the declaration to the first line that is only "}". */
export function extractFunction(src, name) {
  const start = src.search(new RegExp('(^|\\n)function ' + name + '\\('));
  if (start < 0) return null;
  const from = src[start] === '\n' ? start + 1 : start;
  const end = src.slice(from).search(/\n\}[ \t]*(\n|$)/);
  if (end < 0) return null;
  return src.slice(from, from + end + 2);
}

const wfCache = new Map();
function loadNode(wf, node) {
  if (!wfCache.has(wf)) wfCache.set(wf, JSON.parse(readFileSync(join(REPO, wf), 'utf8')));
  const n = wfCache.get(wf).nodes.find((x) => x.name === node);
  if (!n) throw new Error(`${wf}: node '${node}' not found`);
  return n;
}

/** Source of a function inside a workflow Code node (for tests that eval the n8n copy). */
export function nodeFunctionSource(wf, node, fn) {
  return extractFunction(code(loadNode(wf, node)), fn);
}

export function checkDrift() {
  wfCache.clear();
  const problems = [];
  const checked = [];
  for (const c of FUNCTION_COPIES) {
    const label = `${c.wf} › '${c.node}' › ${c.fn}()  vs  shared/email/${c.file} › ${c.sharedFn}()`;
    checked.push(label);
    let upstream;
    try {
      upstream = extractFunction(code(loadNode(c.wf, c.node)), c.fn);
    } catch (e) {
      problems.push(`${label}: ${e.message}`);
      continue;
    }
    const shared = extractFunction(readFileSync(join(SHARED, c.file), 'utf8'), c.sharedFn);
    if (!upstream) { problems.push(`${label}: function ${c.fn}() not found in node '${c.node}'`); continue; }
    if (!shared) { problems.push(`${label}: function ${c.sharedFn}() not found in shared/email/${c.file}`); continue; }
    const renamed = c.fn === c.sharedFn ? upstream : upstream.replace('function ' + c.fn + '(', 'function ' + c.sharedFn + '(');
    if (normalise(renamed) !== normalise(shared)) {
      problems.push(`${label}: DIFFERENT. Node '${c.node}' in ${c.wf} changed (or the shared copy was edited). ` +
        `Copy the node's ${c.fn}() into shared/email/${c.file} unchanged${c.fn !== c.sharedFn ? ` (keep the name ${c.sharedFn})` : ''}.`);
    }
  }
  for (const p of PINS) {
    const label = `${p.wf} › '${p.node}'  vs  pinned shared/email/upstream/${p.pin}`;
    checked.push(label);
    let now;
    try {
      now = p.extract(loadNode(p.wf, p.node));
    } catch (e) {
      problems.push(`${label}: ${e.message}`);
      continue;
    }
    let pinned;
    try {
      pinned = readFileSync(join(UPSTREAM, p.pin), 'utf8');
    } catch {
      problems.push(`${label}: no pinned copy. Run \`node scripts/drift.mjs --pin\` once the port matches the node.`);
      continue;
    }
    if (normalise(now) !== normalise(pinned)) {
      problems.push(`${label}: node '${p.node}' in ${p.wf} changed since it was pinned. ` +
        `Update the shared port ${p.port} to match, then re-pin with \`node scripts/drift.mjs --pin\`.`);
    }
  }
  return { problems, checked };
}

export function pinUpstream() {
  wfCache.clear();
  mkdirSync(UPSTREAM, { recursive: true });
  const written = [];
  for (const p of PINS) {
    writeFileSync(join(UPSTREAM, p.pin), p.extract(loadNode(p.wf, p.node)));
    written.push(relative(DASHBOARD, join(UPSTREAM, p.pin)));
  }
  return written;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes('--pin')) {
    for (const f of pinUpstream()) console.log('pinned ' + f);
    console.log('Function copies are not pinned; they are compared with the shared files directly.');
  }
  const { problems, checked } = checkDrift();
  if (problems.length) {
    console.error(`Drift between the n8n workflows and dashboard/shared/email (${problems.length}):`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }
  for (const c of checked) console.log('  ✓ ' + c);
  console.log(`No drift (${checked.length} checks).`);
}
