# Google Sheet setup

The sheet is the only shared state between the workflows, so headers must match exactly. The workflows expect one spreadsheet (ours is named **Texprove Leads**) with five tabs: `Leads`, `Settings`, `Social`, `Log`, `Suppression`.

Format **every cell as Plain text** (select all, Format > Number > Plain text) before adding data. The workflows compare dates as `yyyy-MM-dd` strings; if Google Sheets converts them to locale dates, follow-ups fire on the wrong day or never.

After importing the workflows, open every Google Sheets node and point it at your own spreadsheet (document ID) and the right tab. The exports still carry the ID of the original sheet.

## Tab `Leads`

Row 1 headers, in this order (columns A to AG):

```
Lead ID | Company | Website | Country | Segment | Contact Name | Contact Title | Email | LinkedIn | Research Notes | Personalisation Hook | Language | Compliance Status | Compliance Notes | Subject | Draft Body | Draft Body EN | Approved | Nil Notes | Stage | Sent At | Gmail Thread ID | Follow-up Count | Next Follow-up Date | Reply Category | Reply Summary | HubSpot Contact ID | Opt-out | Last Updated | Source URL | Source Date | Confidence | Follow-up Draft
```

| Column | Written by | Meaning |
|---|---|---|
| Lead ID | WF0 (or you) | `L001`, `L002`, … Must be unique; every update is matched on it |
| Company, Website, Country, Segment | WF0 (or you) | Country must be `Turkey` (Türkiye / Turkiye also pass the compliance check) |
| Contact Name, Contact Title, Email, LinkedIn | WF1 | Decision maker found by research |
| Research Notes, Personalisation Hook, Language | WF1 | Language is `tr` or `en` and decides the draft language |
| Compliance Status, Compliance Notes | WF2 | `OK`, `Needs fix` or `Blocked`, with the reasons |
| Subject, Draft Body, Draft Body EN | WF2 | The first email. `Draft Body EN` is an English reference translation of a Turkish draft, never sent |
| Approved | manager | Dropdown: `Pending`, `Yes`, `No`, `Edit`. Only `Yes` sends. Used for first emails (WF3) and follow-ups (WF5) |
| Nil Notes | manager | Free text; WF5 uses it to rewrite a follow-up when Approved = `Edit` |
| Stage | all | The state machine, see below |
| Sent At, Gmail Thread ID, HubSpot Contact ID | WF3 | Set when the first email goes out |
| Follow-up Count, Next Follow-up Date | WF3, WF5, WF4 | WF4 clears the date when a reply arrives so WF5 stops |
| Reply Category, Reply Summary | WF4 | Hot / Warm / Cold / Not interested / Auto-reply |
| Opt-out | WF4 or manager | `Yes` stops every workflow for that lead |
| Last Updated | all | `yyyy-MM-dd HH:mm` |
| Source URL, Source Date, Confidence | WF0 | Where the EU-export evidence was found and how sure the model was (0 to 100) |
| Follow-up Draft | WF5 | The pending follow-up text waiting for approval; cleared after sending or declining |

Make `Approved` a data-validation dropdown with the four values so nobody types `yes` in lower case.

### Stage values

Main path: `New` → `Researched` → `Drafted` → `Sent` → `Follow-up 1` → `Follow-up 2` → `Follow-up 3` → `Closed - No reply`

Side exits at any point: `Research failed`, `Blocked - Compliance`, `Replied - Hot`, `Replied - Warm`, `Replied - Cold`, `Opted out`.

Leads added by hand need `Lead ID`, `Company`, `Website`, `Country = Turkey` and `Stage = New`; WF1 picks them up the next weekday morning.

## Tab `Settings`

One header row and one data row (row 2). Every workflow reads this row at the start of a run, so changes take effect on the next run without touching n8n.

| Column | Header | What goes in it |
|---|---|---|
| A | Sender Name | Full name the emails come from |
| B | Sender Title | Their title |
| C | Company Legal Name | Registered company name (printed in the signature) |
| D | Company Address | Registered postal address (printed in the signature) |
| E | Opt-out TR | Turkish opt-out sentence appended to every email |
| F | Opt-out EN | English opt-out sentence |
| G | Nil Email | Manager's address for approval requests, Hot alerts, summaries and reports |
| H | Sheet URL | Link to this sheet, included in notifications |
| I | HubSpot Monthly Limit | Optional, default 3000 |
| J | HubSpot Pause Percent | Optional, default 80. WF3 pauses first emails when the estimated month's actions reach this share of the limit |
| K | Test Email | **Test mode switch.** While it holds an address, WF3 sends every first email (and creates the HubSpot contact) to that address instead of the lead. Clear it before going live |
| L | Nil WhatsApp | Manager's WhatsApp number with country code, no `+` (e.g. `9050…`) |
| M | WhatsApp Phone Number ID | The Phone Number ID of your WhatsApp Business Cloud sender |
| N | Nil Telegram Chat ID | Manager's numeric Telegram chat ID (they must press Start on the bot once) |
| O | Company Website | `https://www.texprove.com`; WF2 puts it on the last line of the signature and the draft check requires it |

Columns K to O may be empty; the matching channel is then skipped or, for Test Email, real sending is enabled.

## Tab `Social`

Headers: `Week | Topic | Draft | Approved | Nil Notes | Posted`

WF6 appends three rows every Monday with `Approved = Pending` and `Posted = No`. Nothing posts to LinkedIn automatically: the manager approves, posts by hand and sets `Posted = Yes`.

## Tab `Log`

Headers: `Timestamp | Workflow | Lead ID | Company | Step | Input | Output | Reason`

Every workflow appends one row per decision (company found, research, compliance result, draft, send, skip, quota pause, reply, follow-up drafted/sent/blocked/declined, closure, weekly report). Input and Output are cut at about 3,000 characters. Nothing reads this tab; keep 12 months and archive older rows by hand.

## Tab `Suppression`

Headers: `Email | Domain | Reason | Date`

One row per address or company domain that must never be contacted: İYS opt-out ("ret") notices, bounces, manual do-not-contact requests. WF2 blocks matching leads, WF3 refuses to send to them, WF5 skips their follow-ups. The tab can be empty but must exist.
