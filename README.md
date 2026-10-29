# Texprove n8n workflow exports (2026-10-29)

One file per workflow, in n8n's import format (name, nodes, connections, settings). Exported after the parallel-notification rewiring on 2026-10-29.

| File | Workflow | Nodes |
|---|---|---|
| WF0-company-discovery.json | Texprove WF0 - Company discovery | 13 |
| WF1-lead-research.json | WF1 lead research | 13 |
| WF2-compliance-and-draft.json | WF2 compliance + draft | 27 |
| WF3-send-first-email.json | WF3 send first email | 23 |
| WF4-reply-triage.json | WF4 reply triage | 23 |
| WF5-follow-ups.json | WF5 follow-ups (with approval gate) | 38 |
| WF6-weekly-report.json | WF6 weekly report + LinkedIn drafts | 22 |

## Importing
In n8n: Workflows > Create (⋯ menu) > Import from File, pick one JSON. Then:
1. Re-select credentials on each Anthropic, Google Sheets, Gmail, HubSpot, WhatsApp and Telegram node. The files reference credentials by id/name only; no keys or tokens are included.
2. Keep every imported workflow inactive until the pre-launch checklist in workflow-review.md is done.
3. Check Settings > Timezone is Europe/Istanbul on each workflow.
