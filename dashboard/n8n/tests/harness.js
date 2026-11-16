// Runs an n8n Code node source (as built by sync-n8n.mjs) with mocked n8n globals.
import { loadCode } from '../../scripts/sync-n8n.mjs';

// A stand-in for n8n's Luxon `$now` at a fixed Istanbul time (+03:00, no DST).
export function fakeNow(local = '2026-11-16T12:00:00') {
  const ms = Date.parse(local + '+03:00');
  const [d, t] = local.split('T');
  const [h, m, s] = t.split(':').map(Number);
  const weekday = ((new Date(ms + 3 * 3600 * 1000).getUTCDay() + 6) % 7) + 1;
  const zoned = {
    toISO: () => local + '.000+03:00',
    toFormat: (f) => {
      if (f !== 'yyyy-MM-dd') throw new Error('fakeNow: unsupported format ' + f);
      return d;
    },
    toMillis: () => ms,
    weekday,
    hour: h,
    minute: m,
    second: s,
  };
  return { setZone: () => zoned };
}

export function runNode(ref, { nodes = {}, input = [], staticData = {}, now = fakeNow(), opts } = {}) {
  const code = loadCode(ref, opts);
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Node '${name}' hasn't been executed`);
    const items = nodes[name].map(j => ({ json: j }));
    return { all: () => items, first: () => items[0] };
  };
  const $input = { all: () => input.map(j => ({ json: j })), first: () => ({ json: input[0] }) };
  const fn = new Function('$input', '$', '$now', '$getWorkflowStaticData', 'return (async () => {\n' + code + '\n})();');
  return fn($input, $, now, () => staticData).then(items => items.map(i => i.json));
}
