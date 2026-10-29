# Design decisions, deviations and known limits

The system implements a 7-agent sales and marketing plan written by the sales manager (October 2026) as seven n8n workflows. This page records what was changed on purpose, what is still missing, and what it costs.

## Why n8n, a sheet and no orchestrator

- **State lives in the sheet.** The plan suggested a state machine in the sheet; the `Stage` column plus fixed schedules move each lead, so there is no orchestrator agent, no queue and nothing to debug beyond one sheet and one n8n execution list.
- **Compliance is code, not an LLM.** The rules (country, generic inbox, domain mismatch, opt-out, suppression list, required sentences, banned words, trade-secret words) are plain JavaScript. A code rule cannot be argued out of a rule; the model's opinion stays secondary, as the plan asked.
- **A human approves every outbound email.** First emails (WF2 → WF3) and follow-ups (WF5) both wait for `Approved = Yes` in the sheet. Nothing is sent that a person has not seen.
- **Gmail sends, HubSpot records.** The plan named HubSpot as the sending tool. HubSpot's free plan is opt-in marketing email with an acceptable-use policy that does not suit 1:1 cold outreach (suspension risk, no workflow sending on the free tier), so emails go from a warmed mailbox and HubSpot gets the contact, the engagement log and the lead status. Downside: no HubSpot open tracking. This deviation should be confirmed with the manager before launch.
- **Drafts are written directly in the lead's language** (Turkish or English) instead of an English master plus a localisation agent. One LLM call fewer; an English reference copy (`Draft Body EN`) is produced for review.
- **Turkey first.** The plan's phase 1. Adding a country means: new WF0 search briefs and sources, the country in the `allowedCountries` list of the WF2 compliance code, opt-out and data-source sentences in that language in `Settings`, and a wider language hint in WF4. A `Countries` tab read by WF0 and WF2 is the recommended refactor when the second country arrives.
- **Company discovery and research use Claude's built-in web search** through n8n's Anthropic node (Sonnet 5.5, one call returning JSON). Earlier versions used an AI Agent with SerpApi / Brave, then Tavily / Firecrawl; both were replaced because the single-call design needs no extra API keys, no agent loop and is cheaper to reason about. Caps: 10 searches per brief in WF0, 8 per lead in WF1.
- **Two Anthropic accounts.** Every Claude call falls back to a second credential, so an exhausted or rate-limited account retries once elsewhere.
- **Notifications fan out.** Email, WhatsApp and Telegram nodes hang off the Settings read in parallel, each with continue-on-error, after an expired WhatsApp token once stopped a run before Telegram was reached. n8n v1 runs sibling branches one after another, so this is independence rather than concurrency.

## Covered from the plan

Company discovery with source URL, source date and confidence; research with a personalisation hook; compliance gate with `OK` / `Needs fix` / `Blocked`; manager approval; sending with a HubSpot action counter that pauses at 80%; follow-ups at days 4 / 10 / 20 with approval; reply classification into Hot / Warm / Cold / Not interested with Hot alerts; a 12-month `Log` tab; a `Suppression` tab for İYS opt-outs and do-not-contact; a trade-secret check on every draft; a weekly report and LinkedIn drafts to a `Social` tab.

## Still missing or different

- Follow-ups are model-written each time rather than fixed approved templates. The approval gate is the control; templates could be stored in `Settings` and the LLM node swapped for a Set node.
- No 90-day re-contact pause: `Closed - No reply` leads are never re-contacted automatically.
- Rejection reasons are written to `Nil Notes` but not analysed in the weekly report.
- Replies are not mined for objection type, product requests or decision timeline; no HubSpot deal is opened on Hot.
- Rules live in code, not a per-country rules file.
- İYS is not queried live (needs the company's İYS brand code and API access; whether B2B emails to company addresses require İYS registration should be confirmed with a lawyer). No live check that EU buyers' personal names are absent from drafts beyond the word list.
- HubSpot is not checked for duplicates (it would cost actions); the monthly quota is an estimate from the sheet.
- No holiday calendar for follow-ups. A weekly cap of 100 first emails is not enforced (15 per run, two runs a day).
- The social branch has no performance data, no scheduled posting and no consent check before naming a customer.
- Legal review of the outreach text (KVKK disclosure, opt-out wording) is still to be done.

## Cost

At roughly 25 new companies a week and 10 researched leads a weekday, usage was estimated at about $55–65 a month in Claude API spend (WF0 ≈ $20, WF1 ≈ $32 at about $0.30 per lead, WF2 ≈ $4, WF4–WF6 ≈ $5), rising toward $90 if research regularly hits its 8-search cap. Roughly $0.35 per lead end to end, plus n8n. Web search is billed at $10 per 1,000 searches on top of tokens. The monthly budget is $200 across two API accounts.

## Lessons recorded while building

- Any workflow called as a tool or sub-workflow must be published, or n8n reports "Workflow is not active and cannot be executed".
- After an AI node inside a loop, paired-item links are lost; read the loop item by run index instead.
- Google Sheets must store dates as Plain text or string comparisons on `yyyy-MM-dd` break.
- The Gmail node's "reply to thread" fails on a thread that holds only your own message; WF5 sends through the Gmail API with In-Reply-To / References instead.
- The Gmail trigger only sees unread mail that arrived since its last poll; opening the inbox by hand hides replies from WF4.
- Telegram's default Markdown parse mode fails on underscores in URLs; use HTML parse mode and escape `&` and `<`.
- Every notification node needs continue-on-error, otherwise one dead channel stops the run.
- A whole-word match is needed for banned buyer names ("zara" once matched "yazarak").
