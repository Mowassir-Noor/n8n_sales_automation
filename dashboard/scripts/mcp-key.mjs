#!/usr/bin/env node
// Makes a Claude (MCP) access key for one dashboard user.
//   node scripts/mcp-key.mjs nil@example.com
// Prints the key (give it to that person once; it is not stored) and the MCP_KEYS entry for dashboard.env.
import { createHash, randomBytes } from 'node:crypto';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: node scripts/mcp-key.mjs <email>');
  process.exit(1);
}
const key = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(key, 'utf8').digest('hex');
console.log('Key for ' + email + ' (shown once, keep it secret):');
console.log('  ' + key);
console.log('');
console.log('Add this to MCP_KEYS in dashboard.env (comma-separate several people):');
console.log('  ' + email + ':' + hash);
console.log('');
console.log('Connector URL for Claude: <AUTH_URL>/api/mcp/' + key);
