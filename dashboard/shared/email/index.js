// Shared email module: one import point for the dashboard (browser and server).
// The individual files stay self-contained so sync-n8n.mjs can paste each into an n8n Code node.
export { buildHtml } from './buildHtml.js';
export { checkDraft, fixAddressLineBreak, complianceIssues, sensitiveIssues } from './checkDraft.js';
export { checkFollowup, followupSensitiveIssues } from './checkFollowup.js';
export { recipientFor, firstEmailSubject, followupSubject, isSuppressed } from './recipient.js';
export { hashText, hashFirst, hashFollowup } from './hash.js';
