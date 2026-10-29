# Manager guide (approving emails)

Everything the sales manager does happens in the Google Sheet and in email, WhatsApp or Telegram. No n8n access is needed.

## Weekday mornings (after the WF2 notification, about 09:30)

1. Open the `Leads` tab, filter `Stage = Drafted` and `Approved = Pending`.
2. Read `Subject` and `Draft Body` (and `Draft Body EN` for an English version of a Turkish draft).
3. Set `Approved`:
   - `Yes` to send. WF3 sends at 10:00 and 14:00. Edits you make to Subject or Draft Body are sent as edited.
   - `No` to drop the lead for now. Put the reason in `Nil Notes`.
4. Rows with `Compliance Status = Needs fix`: the text check found a problem listed in `Compliance Notes` (missing opt-out sentence, a link, a banned word, a buyer name, too long). Fix the text, then set `Approved = Yes`. Nothing goes out while it stays `Pending`.
5. Rows with `Stage = Blocked - Compliance` are never emailed. If the block was wrong (for example a generic address that really is the right contact), correct the data and set `Stage = Researched`; WF2 tries again the next morning.
6. Rows with `Stage = Research failed` need a manual look: fill the contact by hand and set `Stage = Researched`, or delete the row.

## Follow-ups (after the WF5 summary, about 11:00)

WF5 does not send on its own. When a follow-up is due it writes the text to `Follow-up Draft` and sets `Approved = Pending`, then sends a summary listing drafts waiting, sent, blocked and declined.

- `Yes`: sent on the next weekday run, in the original email thread.
- `No`: dropped; the lead gets no further follow-ups.
- `Edit`: rewritten on the next run using what you put in `Nil Notes`, and offered again as `Pending`.

## Replies

- **Hot** replies (wants a call or demo) arrive as an alert by email, WhatsApp and Telegram with a one-sentence summary and a link to the thread. Reply from the inbox yourself; the workflows never answer prospects.
- Warm, Cold and Not interested replies only update the sheet and HubSpot. Filter `Stage = Replied - …` to review them.
- Anyone asking to be removed is set to `Opted out` automatically and is never emailed again.
- Only replies in the same Gmail thread are matched. A prospect who writes a fresh email is not picked up; handle those by hand.
- Do not open the sending inbox before the 15-minute poll: WF4 only sees unread mail.

## Mondays

- Read the weekly report (email and Telegram).
- Open the `Social` tab and set `Approved = Yes` on the LinkedIn drafts worth posting. Post them by hand and set `Posted = Yes`. The full draft texts are also in the notification.

## Stopping and blocking

- To stop one lead: set `Opt-out = Yes`. Every workflow checks it.
- İYS opt-outs or any do-not-contact request received outside the inbox: add the address or the company domain to the `Suppression` tab with the date.
- HubSpot quota warning: first emails are paused for the rest of the month. To keep sending, check HubSpot's own usage page, then raise `HubSpot Monthly Limit` or `HubSpot Pause Percent` in `Settings`.
