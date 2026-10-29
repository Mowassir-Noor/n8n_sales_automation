# Workflow reference

All seven workflows run in Europe/Istanbul time with n8n execution order v1. Each has a schedule trigger and a **Manual Test** trigger (except WF4, which has only a Gmail trigger). Every Claude call has an "(account 2)" twin: in WF0 and WF1 the Anthropic node's error output feeds a clone with the same prompt; in WF2, WF4, WF5 and WF6 the LLM chain has **Enable Fallback Model** on with a second chat-model node. When the first account errors (credits, rate limit, outage) that one call is retried on the second account.

Every notification node to the manager (Gmail, WhatsApp, Telegram) is wired in parallel from the Settings read, has **On Error → Continue** and **Execute Once**, so a failing channel never stops the run or the channels next to it.

---

## WF0 Company discovery

Finds new Turkish textile exporters that sell to the EU and adds them to `Leads`, so the pipeline is not limited to companies typed in by hand.

**Runs:** Monday 07:00 (`0 7 * * 1`), or by hand.

**Steps**

1. **Get Existing Leads** reads the whole `Leads` tab so duplicates can be skipped.
2. **Build Search Plan** (Code) holds six briefs (knitwear, woven apparel, denim, home textile, certified fabric mills, sportswear), each with three suggested searches in Turkish and English and the list of known company names to skip. Edit here to steer discovery or add a segment or country.
3. **Find Companies with Claude** is the Anthropic node (Claude Sonnet 5.5) with Claude's built-in web search on, at most 10 searches per brief. Claude runs the searches, opens the company sites, and answers with a JSON list of up to 8 Turkish manufacturers: website, the page with the EU-export evidence, the evidence sentence and a confidence score (90+ when EU countries or European brands are named as customers; 60–89 for exporting in general; lower when only implied). Buyers, agents, directories, fairs and news sites are excluded. The prompt states today's date so past fairs are not called upcoming.
4. **Parse Companies** (Code) pulls the JSON out of the reply, one item per company.
5. **Dedupe and Assign IDs** (Code) drops any company without a source URL, with confidence under `minConfidence` (60), or whose website domain or normalised name already exists; the rest get the next free `L###` ID. At most `maxNewPerRun` (25) per run; extras are dropped, not queued.
6. **Append New Leads** writes the rows with `Stage = New`; **Log Discovery** records the run.

**Writes:** Lead ID, Company, Website, Country = Turkey, Segment, Source URL, Source Date, Confidence, Research Notes ("EU evidence: …"), Stage, Last Updated.

**Cost:** 6 Claude calls and up to 60 web searches per run (web search is billed at $10 per 1,000 searches on top of tokens), about 5 minutes, under $3 a week.

---

## WF1 Lead research

Researches each new company and finds a decision maker and a personalisation hook.

**Runs:** weekdays 08:00 (`0 8 * * 1-5`), or by hand. Up to 10 rows with `Stage = New` per run (**Limit 10**), one at a time (**Loop Over Leads**).

**Steps**

1. **Research with Claude**: Anthropic node (Claude Sonnet 5.5) with built-in web search, at most 8 searches per lead. Claude searches the company site, its about / sustainability / certificate / contact pages, recent news (new factory, certification, EU brand deal, trade fair) and the decision maker, then answers with one JSON object.
2. **Parse Research** (Code) extracts the JSON; unknown fields stay empty. The hook prefers recent news.
3. **Update Lead Row** writes back by Lead ID; **Log Research** records the result.

**Writes:** Contact Name, Contact Title, Email, LinkedIn, Language (`tr`/`en`), Research Notes, Personalisation Hook, Last Updated, `Stage = Researched`. If research errors or returns no hook, the row gets `Stage = Research failed` for a manual look.

**Note:** after a loop with an AI call the paired-item link is lost, so the write-back nodes read the lead by loop run index (`$('Limit 10').all()[$runIndex]`), not by `$('Loop Over Leads').item`. Keep that if you edit the workflow.

---

## WF2 Compliance check and draft

Checks each researched lead against the outreach rules, writes the first email, checks the text, and asks the manager to approve.

**Runs:** weekdays 09:00 (`0 9 * * 1-5`), or by hand. Up to 20 rows with `Stage = Researched`.

**Steps**

1. **Read Settings** and **Read Suppression** once, then **Get Researched Leads**.
2. **Compliance check** (Code, no LLM) blocks a lead when: the country is not Turkey; the email is a generic inbox (info@, sales@, …); the email domain does not match the website; `Opt-out = Yes`; or the email or its domain is on `Suppression`. Blocked rows go through **Mark Blocked** (`Stage = Blocked - Compliance`, reason in Compliance Notes) and are never emailed.
3. **Draft First Email** (LLM chain, Claude Sonnet 5.5, structured JSON output): writes the email in the lead's language from the research notes and hook. The prompt fixes the structure: under 120 words of body, one question, the signature with legal name, address and company website from Settings, the sentence saying the contact details came from the company's public website, and the opt-out sentence.
4. **Check Draft** (Code) reads the text back and requires: sender name, legal name, address, the opt-out sentence in the right language, the data-source sentence, the Texprove website link in the signature, no links other than the lead's own site and Texprove's, under 190 words, nothing commercially sensitive (whole-word match on buyer/brand names, money amounts, quantities, order / price / capacity / margin / revenue wording), and none of the hype words (garanti, guaranteed, 100%, ücretsiz, free trial, son şans, last chance). Failures give `Compliance Status = Needs fix` with the reasons.
5. **Translate to English** (Claude Haiku 5.5) turns a Turkish draft into plain English for `Draft Body EN`. Reference only; the Turkish text is what gets sent.
6. **Save Draft** writes the row with `Approved = Pending`; **Log Compliance** and **Log Draft** record the decisions.
7. **Notify Nil** (Gmail), **WhatsApp Nil** and **Telegram Nil** send one summary per run with the count of drafts waiting and how many need fixing, plus the sheet link.

**Writes:** Compliance Status (`OK` / `Needs fix` / `Blocked`), Compliance Notes, Subject, Draft Body, Draft Body EN, Approved = Pending, Last Updated, `Stage = Drafted` or `Blocked - Compliance`.

**What to edit:** blocking rules and banned words in the two Code nodes; tone and structure in the system message of **Draft First Email**; sender details, opt-out sentences and the manager's contacts come from `Settings`.

---

## WF3 Send approved emails

Sends the drafts the manager approved, from the connected Gmail inbox, and logs each one to HubSpot.

**Runs:** weekdays 10:00 and 14:00 (`0 10,14 * * 1-5`), or by hand. Up to 15 emails per run with a 90-second pause between them (**Wait 90s**), so at most 30 first emails a day.

**Steps**

1. **HubSpot quota gate.** **Get All Leads** and **Read Settings**, then **HubSpot Quota Check** (Code) estimates this month's HubSpot actions from the sheet: 2 per first email, 1 per follow-up (dated from Sent At + 4 / 10 / 20 days) and 2 per reply (by Last Updated). If the estimate is at or above `HubSpot Pause Percent` of `HubSpot Monthly Limit` (defaults 80% of 3,000), **Quota OK?** routes to **Warn Nil Quota** and **Log Quota Pause** and nothing is sent. Replies and follow-ups are not gated.
2. **Get Approved Drafts** reads `Stage = Drafted` and `Approved = Yes`, **Limit 15**, **Loop Over Drafts** one at a time.
3. **Safe to send?** skips a row when `Compliance Status = Blocked`, `Opt-out = Yes`, or the email / domain is on `Suppression`. Skipped rows are marked by **Mark Skipped** (`Blocked - Compliance` or `Opted out`) so they do not take a slot every run.
4. **Send Email** (Gmail, plain text, n8n attribution off). If `Settings > Test Email` is filled, the message goes to that address instead of the lead.
5. **HubSpot Upsert Contact** and **HubSpot Log Email** (both continue on error, so a HubSpot failure never causes a second send).
6. **Mark Sent** updates the row right after the send; **Log Send** records it.

**Writes:** `Stage = Sent`, Sent At, Gmail Thread ID, HubSpot Contact ID, Follow-up Count = 0, Next Follow-up Date = Sent At + 4 days, Last Updated.

**Notes:** the quota figure is an estimate, not HubSpot's meter; check it against HubSpot's usage page in the first month. While paused the manager gets the warning on every run until the month rolls over or the limit is raised. A weekly cap of 100 first emails is not enforced; lower **Limit 15** to reduce volume.

---

## WF4 Reply triage

Reads every reply that lands in the inbox, classifies it, updates the sheet and HubSpot, and alerts the manager when a lead is hot.

**Runs:** **Gmail Trigger** polls every 15 minutes for unread inbox mail not sent by you. It cannot be started from a schedule or the API; to test it, publish the workflow and reply to a sent email, or run it from the editor on a real message.

**Steps**

1. **Find Lead by Thread** looks up the `Leads` row whose Gmail Thread ID matches the mail. No match means it is not a reply to a campaign email and the run stops.
2. **Summarize Reply** (Claude Haiku 5.5, structured JSON) writes a one-sentence summary, flags any removal request, and classifies the reply as Hot (wants a call or demo), Warm (interested, later), Cold (polite no), Not interested (asks to stop) or Auto-reply (out of office, bounce).
3. **Route by Category** (Switch) → **Category Hot / Warm / Cold / Not interested** → **Decide Outcome**. Auto-reply changes nothing. Not interested, or any removal request, sets `Stage = Opted out` and `Opt-out = Yes`. Hot / Warm / Cold set `Stage = Replied - …` and clear Next Follow-up Date so WF5 stops.
4. **Update Lead Row**, **Log Reply**, **HubSpot Log Reply** (engagement) and **HubSpot Set Lead Status** (IN_PROGRESS for Hot, OPEN for Warm, UNQUALIFIED for Cold and Not interested). HubSpot nodes continue on error.
5. **Hot reply?** → **Read Settings** → **Alert Nil** (Gmail), **WhatsApp Nil (hot)**, **Telegram Nil (hot)** in parallel with the summary and a link to the thread. **Mark Reply Read** at the end.

**Writes:** Reply Category, Reply Summary, Stage, Opt-out, Next Follow-up Date (cleared), Last Updated.

**Notes:** only replies in the same thread are matched. No HubSpot deal is opened for Hot replies. Telegram texts use HTML parse mode with `&` and `<` escaped (Markdown mode breaks on underscores in the sheet URL).

---

## WF5 Follow-ups

Drafts up to three follow-ups in the same email thread, 4, 10 and 20 days after the first email, sends them once approved, and closes leads that never answer.

**Runs:** weekdays 11:00 (`0 11 * * 1-5`), or by hand. Up to 15 leads per run.

**Steps**

1. **Get Leads** → **Follow-up due?** keeps rows where Stage is `Sent`, `Follow-up 1` or `Follow-up 2`, `Opt-out` is not Yes, there is a Gmail Thread ID, Next Follow-up Date is today or earlier, and the email / domain is not on `Suppression`. **Limit 15**, **Loop Over Follow-ups**.
2. **Get Thread** fetches the Gmail thread; **Lead replied?** skips the lead if any message is not from you (WF4 handles replies).
3. **Decide Follow-up Action** (Code) reads `Follow-up Draft` and `Approved`:
   - no draft yet → **draft**
   - draft and `Approved = Yes` → **send**
   - draft and `Approved = No` → **decline**
   - draft and `Approved = Edit` → **draft** again, with `Nil Notes` passed as editing instructions
   - anything else → **wait** (nothing happens until the manager decides)
4. **draft:** **Write Follow-up** (Claude Sonnet 5.5, structured JSON) writes a short follow-up in the lead's language with a different angle from the first email and earlier follow-ups (a new benefit, a case, a one-line nudge for the third). **Check Follow-up** (Code) applies the same trade-secret check as WF2. Clean drafts go to **Save Follow-up Draft** (`Follow-up Draft` = text, `Approved = Pending`) and **Log Follow-up Drafted**; blocked ones go to **Log Follow-up Blocked** and are rewritten on the next run.
5. **send:** **Get Original Message-ID** (Gmail API) → **Build Reply** (Code: `Re:` subject, In-Reply-To, References, the saved draft as body) → **Send Follow-up** (Gmail API, same thread ID). The Gmail node's "reply to thread" is not used because it fails on a thread holding only your own message. Then **HubSpot Log Follow-up** (continue on error), **Update Follow-up Row**, **Log Follow-up**.
6. **decline:** **Decline Follow-up** clears `Follow-up Draft` and `Next Follow-up Date`; **Log Follow-up Declined**.
7. After the loop: **Ready to close?** → **Close No Reply** sets `Closed - No reply` seven days after Follow-up 3 with no reply; **Log Close**.
8. **Summarize Follow-ups** (Code) counts sent / drafted / blocked / declined; if **Anything to report?** is true, **Read Settings (follow-ups)** → **Email Nil (follow-ups)**, **WhatsApp Nil (follow-ups)**, **Telegram Nil (follow-ups)** in parallel. Nothing is sent when nothing was due.

**Writes (on send):** Follow-up Count + 1, `Stage = Follow-up 1/2/3`, Next Follow-up Date = Sent At + 10 days, + 20 days, then empty, Follow-up Draft cleared, Last Updated.

**Notes:** the due-date check compares `yyyy-MM-dd` strings, which is why date columns stay Plain text. No holiday calendar. Follow-ups are written fresh by the model, not from fixed templates; the approval gate is the control.

---

## WF6 Weekly report and LinkedIn drafts

Two branches from one trigger.

**Runs:** Monday 08:30 (`30 8 * * 1`), or by hand.

**Branch A, weekly report**

1. **Get All Leads** → **Compute Weekly Stats** (Code) counts rows per Stage and the last 7 days' activity: first emails sent, leads followed up, replies by category, opt-outs.
2. **Write Weekly Report** (Claude Sonnet 5.5) writes under 200 words with the numbers, what went well and two suggestions.
3. **Read Settings (report)** → **Email Weekly Report** (subject "Texprove outreach, week of …") and **Telegram Nil (report)** in parallel; **Log Report**.

**Branch B, LinkedIn drafts**

1. **Write LinkedIn Drafts** (Claude Sonnet 5.5, structured JSON) writes three posts for the company page: an EU regulation explainer, a customer-style story, a practical tip.
2. **Split Drafts** → **Append to Social** with `Approved = Pending`, `Posted = No`.
3. **Read Settings (social)** → **Email Social Drafts Ready**, **WhatsApp Nil (social)**, **Telegram Nil (social)** in parallel. Email and Telegram carry the three full draft texts (Telegram sliced to the 4,096-character limit), not only the sheet link.

Nothing is posted to LinkedIn by the workflow.

**Notes:** "Follow-ups sent" counts leads touched in the last 7 days, not individual emails. Reply and opt-out counts rely on WF4 writing Last Updated. Running WF6 twice in a week appends a second set of drafts to `Social`; delete the extras by hand.
