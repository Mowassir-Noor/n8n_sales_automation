# WF7: ClickUp sync

`Texprove WF7 - ClickUp sync` (file `WF7-clickup-sync.json`) keeps the ClickUp list "Mail Atılan Kurumlar – Müşteri Listesi" (list ID `1100520000006922`, TEXPROVE space) in step with the Google Sheet. It implements sections 12 (item 6) and 13 of Nil's decision log of 23 Nov 2026. It only reads the sheet, except for marking Actions rows as synced.

## What it does

1. Reads the `Leads` and `Actions` tabs, the list's custom fields and all its tasks.
2. Groups the sheet into companies. A second-contact row (`L123-B`, `Parent Lead ID` = `L123`) belongs to the parent company. Only mailed companies are synced (a row with `Sent At` or `ClickUp Stage`).
3. Matches each company to a task: by the `Lead ID` field, then by email (`E-posta` or `2. Kişi E-posta`), then by exact company name. If nothing matches, it creates a task.
4. Sets custom fields by their ClickUp name (table below). Dropdowns are set by option label, dates as the Istanbul calendar day. An empty sheet value never clears a ClickUp field.
5. Sets `Aşama` from the `ClickUp Stage` column. For rows mailed before that column existed it is derived from `Stage`, `Follow-up Count` and `Reply Category`. A reply stage on either contact wins over a send stage. A `Demo planlandı` set by hand in ClickUp is never downgraded.
6. Posts every `Actions` row without a `ClickUp Comment ID` as a dated comment on the company's task, then writes `ClickUp Comment ID` and `ClickUp Synced At` into that row so it is posted once.
7. Writes one row to `Log` (`WF7 ClickUp sync`). If any ClickUp write failed, the run ends in error and the shared error workflow alerts Telegram.

Schedule: weekdays, every hour at :20 from 08:20 to 19:20 Istanbul time.

## Field mapping

| ClickUp field | Sheet source |
|---|---|
| Lead ID | parent `Lead ID` |
| task name | `Company` (only when the task is created) |
| Web Sitesi | `Website` |
| Segment | `Segment` (`Hariç` becomes `Diğer`) |
| Dalga | `Wave` (`1` = `1. dalga`, `2` = `2. dalga`, `Ayrı liste` = `Sourcing ofisi`) |
| Çalışan Sayısı | `Employees` |
| İhracat / Ciro | `Export Volume` |
| Kriter Uygunluğu | `Criteria Fit` |
| İlgili Kişi, İlgili Kişi Unvanı, E-posta, LinkedIn | `Contact Name`, `Contact Title`, `Email`, `LinkedIn` |
| 2. Kişi, 2. Kişi Unvanı, 2. Kişi E-posta | `Contact 2 ...`, or the `-B` row |
| Kişi Kaynağı | `Contact Source` |
| HubSpot Contact ID | `HubSpot Contact ID` |
| Mail Konusu | `Subject` |
| Aşama | `ClickUp Stage` (see step 5) |
| Mail Tarihi | `Sent At` |
| 2. Kişi İlk Mail Tarihi | `Contact 2 First Email At`, or the `-B` row's `Sent At` |
| 2. Mail (Takip) | `Gönderildi` once the first follow-up is sent |
| 2. Mail Tarihi, 2. Takip Tarihi, 3. Takip Tarihi | `Follow-up 1 At`, `Follow-up 2 At`, `Follow-up 3 At` |
| Yanıt Tarihi | `Reply At` |
| Geri Dönüş | `Oldu` if there is a reply, else `Olmadı` |
| Geri Dönüş Notu | `Reply Category` + `Reply Summary` |
| Son Aksiyon Tarihi | latest `Last Updated` |
| Sonraki Aksiyon Tarihi | earliest `Next Follow-up Date` |

A value that has no matching dropdown option (for example an old `Segment` such as "Denim") is skipped and listed in the run's notes.

## The Config node

| Setting | Meaning |
|---|---|
| `dry_run` | `true`: plan only, nothing is written. The plan is in the output of the `Run summary` node (`matched`, `would_create`, `conflicts`, `notes`). |
| `overwrite_hand_filled` | `false`: the eight fields Nil filled by hand (Mail Tarihi, E-posta, İlgili Kişi, Mail Konusu, Geri Dönüş, Geri Dönüş Notu, 2. Mail (Takip), 2. Mail Tarihi) are only filled where empty. A different value is listed under `conflicts` and left alone. `true` (live setting since 26 Nov 2026): the sheet wins for seven of them. A reply note (Geri Dönüş Notu) that someone typed is never replaced in either mode. |
| `only_lead_ids` | Comma list of lead IDs to limit a run to, for testing. Empty = all. |
| `max_comments_per_run` | Upper limit of comments per run (80). |
| `list_id` | The ClickUp list. |

## Setup

- n8n credential of type "ClickUp API" with a personal token (`pk_...`) of an account that can edit the list, attached to `Get Fields`, `Get Tasks`, `Create task`, `Set field`, `Post comment`.
- Google Sheets credential on the four sheet nodes.
- Error workflow: `Texprove Alerts - Workflow errors`. Timezone: Europe/Istanbul.

## Source

The Code nodes live in `wf7-clickup-sync/*.js`. `python3 build_export.py` (run inside that folder) rebuilds `WF7-clickup-sync.json` from them; node IDs in the file differ from the live workflow.

## Not covered

- `Demo planlandı` is still set by hand in ClickUp.
- Activity from before the `Actions` tab existed (25 Nov 2026) is not back-filled as comments.
- Tasks are never deleted or renamed, and task status is not touched.
