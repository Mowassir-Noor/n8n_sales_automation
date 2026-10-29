# Setup, testing and go-live

## 1. Requirements

- An n8n instance (Cloud or self-hosted, v1.x with the Anthropic, Google Sheets, Gmail, HubSpot, WhatsApp and Telegram nodes available).
- An Anthropic API key with credit (a second key on a separate account is optional, for the fallback nodes).
- A Google account owning the sheet and the sending Gmail inbox. For production use a warmed Google Workspace mailbox on your own domain with SPF, DKIM and DMARC set up, not a personal Gmail.
- HubSpot (free plan is enough) with a private app token that can read/write contacts and engagements.
- Optional: a WhatsApp Business Cloud sender (Meta app) and a Telegram bot for manager notifications. Email works without them.

## 2. Create the Google Sheet

Follow [google-sheet.md](google-sheet.md): five tabs, exact headers, every cell Plain text, one filled `Settings` row. Put your own address in `Settings > Test Email` for now.

## 3. Create credentials in n8n

| Credential type in n8n | Name used in the exports | Used by |
|---|---|---|
| Anthropic | `Anthropic account` | every Claude node |
| Anthropic | `Anthropic account 2` | every node whose name ends in "(account 2)"; may point at the same key if you have only one |
| Google Sheets OAuth2 | `Google Sheets account` | all sheet nodes |
| Gmail OAuth2 | `Gmail account` | sending, reply trigger, thread lookups |
| HubSpot (private app / service key) | `HubSpot Service Key account` | WF3, WF4, WF5 |
| WhatsApp (Business Cloud API access token) | `WhatsApp API` | WhatsApp notification nodes. The OAuth2 credential type only works for the WhatsApp trigger, not sending. Use a permanent system-user token; the 24-hour token from Meta's API Setup page expires |
| Telegram API (bot token from @BotFather) | `Telegram account` | Telegram notification nodes |

Never put keys or tokens in the sheet or in workflow parameters; they belong in n8n Credentials only. The exports contain credential names and IDs only.

WhatsApp notes: free-form texts deliver only within 24 hours of the manager's last message to the business number; outside that window Meta needs a pre-approved template. A Meta test number can message at most 5 allow-listed numbers. Telegram has no such window and is the reliable channel; the manager must press Start on the bot once, then put their numeric chat ID (from @userinfobot) in `Settings`.

## 4. Import the workflows

For each `WF*.json`: **Workflows > ⋯ > Import from File**. Then in each workflow:

1. Open every node that shows a credential warning and select the matching credential from the table above.
2. Open every Google Sheets node and select your spreadsheet and the right tab (`Leads`, `Settings`, `Social`, `Log`, `Suppression`).
3. Check **Settings > Timezone** is `Europe/Istanbul` (or your sending timezone; the cron expressions assume it).
4. Save. Leave the workflow **inactive**.

## 5. Test by hand

Use each workflow's **Manual Test** trigger and check the sheet after every run. With `Test Email` set, every first email and follow-up goes to that address.

1. Add two or three test leads with `Stage = New` and run **WF1**: rows reach `Researched` with a hook.
2. Run **WF2**: drafts appear, Compliance Status is `OK` or `Needs fix`, you receive one notification on each configured channel.
3. Set `Approved = Yes` on a test row and run **WF3**: the email arrives at the test address, HubSpot shows the contact, the row is `Sent` with a thread ID.
4. Reply to that email from another address. Publish **WF4** (the Gmail trigger polls as soon as it is active) or run it from the editor: Reply Category is filled and, if Hot, the alert arrives. Unpublish again if you are not ready to go live.
5. Set `Next Follow-up Date` on a `Sent` row to yesterday and run **WF5**: the row gets a `Follow-up Draft` with `Approved = Pending` and you get a summary. Set `Approved = Yes`, run WF5 again: the follow-up lands in the same thread.
6. Run **WF6**: the report arrives and three rows appear in `Social`.
7. Run **WF0** once: new rows have Source URL, Confidence ≥ 60 and no duplicates. Delete test companies you do not want.

## 6. Go-live checklist

- [ ] Real `Company Legal Name` and `Company Address` in `Settings`; opt-out sentences, the data-source sentence and the signature reviewed by the manager or a lawyer (KVKK / İYS).
- [ ] Sending mailbox is the company domain mailbox (Gmail credential swapped in WF2 to WF6), SPF/DKIM/DMARC pass, inbox warmed for a few weeks.
- [ ] `Settings > Test Email` cleared.
- [ ] `Nil Email`, `Nil WhatsApp`, `Nil Telegram Chat ID` are the manager's real contacts; WhatsApp uses a permanent token (and a template if messages must arrive outside the 24-hour window).
- [ ] `Anthropic account 2` credential exists if a separate fallback account is wanted.
- [ ] Sending channel confirmed with the manager (Gmail send + HubSpot log is what is built; HubSpot's free plan is not meant for cold sending).
- [ ] Test rows removed or set to `Opted out`; duplicate `Social` rows from test runs deleted.
- [ ] Activate workflows one at a time: WF1 to WF6 first, WF0 last once the manager is happy with the discovered companies.
- [ ] First week: keep **Limit 15** in WF3, watch bounce and spam rates, compare the HubSpot estimate in the quota warning with HubSpot's usage page.

## 7. Operating notes

- A workflow called by another (tool or sub-workflow) must be published, or n8n refuses to run it.
- Model choice: the AI Agent node loop needs a model that can run with thinking off; the current build uses plain Anthropic nodes and LLM chains, so Sonnet 5.5 works. Fallback nodes are kept on Sonnet 4.6 on purpose, so a model-specific problem cannot take both paths down.
- n8n's Anthropic node does not expose token counts; the Anthropic console usage page is the only exact cost source.
- Re-export after changing a workflow: **⋯ > Download** in the editor, and commit the JSON here.
