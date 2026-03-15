# Offer Letter Agent

End-to-end automated offer letter pipeline built on AWS Lambda.

**Flow:** Slack modal → Blake approves → Google Drive doc generated → PDF exported → DocuSign signed → Recruiter notified

---

## Architecture

```
Recruiter fills Slack modal
        ↓
  Agent 1 (Lambda)
  • Claude validates offer data
  • DMs Blake with Approve / Reject buttons
        ↓ (Blake clicks Approve)
  Agent 2 (Lambda)
  • Copies Google Doc template
  • Creates /Offers/<FirstName LastName>/ folder in Drive
  • Fills all {{PLACEHOLDERS}} via Docs API
  • Exports as PDF, saves to Drive folder
        ↓
  Agent 3 (Lambda)
  • Uploads PDF to DocuSign
  • Places \s1\, \s2\, \d1\, \d2\ anchor tabs
  • Sets signing order: Blake → Candidate
  • Sends envelope, registers Connect webhook
        ↓
  Agent 4 (Lambda — triggered by DocuSign webhook POST)
  • completed → fires Agent 5
  • declined/voided → alerts recruiter
  • (Daily cron via EventBridge) → auto-remind if N days unsigned
        ↓
  Agent 5 (Lambda)
  • Downloads signed PDF from DocuSign
  • Saves signed copy to candidate's Drive folder
  • Slacks recruiter with confirmation + Drive link
  • (Optional) Appends row to tracking Google Sheet
```

---

## Prerequisites

1. **AWS** — Lambda, API Gateway, DynamoDB, SAM CLI installed
2. **Slack App** — with `chat:write`, `im:write`, `channels:read`, interactivity enabled
3. **Google Cloud** — Service Account with Drive + Docs + Sheets API access, shared to your offers folder
4. **DocuSign Developer Account** — JWT auth configured, Connect webhook enabled
5. **Anthropic API Key** — for offer data validation in Agent 1

---

## Setup

### 1. Slack App Configuration

In your Slack App settings (api.slack.com/apps):

**OAuth & Permissions — Bot Token Scopes:**
- `chat:write`
- `im:write`
- `channels:read`
- `commands` (if adding a slash command trigger)

**Interactivity & Shortcuts:**
- Enable Interactivity
- Request URL: `https://<your-api-gateway>/prod/slack/events`

**Event Subscriptions:**
- Request URL: `https://<your-api-gateway>/prod/slack/events`
- Subscribe to bot events: `message.im` (optional)

**Your existing Slack Workflow** should submit a modal with `callback_id: offer_intake_modal`.
The modal must include blocks with these `block_id` / `action_id` pairs:

| block_id          | action_id | Type  | Field              |
|-------------------|-----------|-------|--------------------|
| candidate_name    | input     | plain_text_input | Candidate Full Name |
| candidate_email   | input     | plain_text_input | Candidate Email     |
| role              | input     | plain_text_input | Job Title           |
| department        | input     | plain_text_input | Department          |
| start_date        | input     | plain_text_input | Start Date          |
| salary            | input     | plain_text_input | Base Salary         |
| signing_bonus     | input     | plain_text_input | Signing Bonus       |
| equity            | input     | plain_text_input | Equity              |
| reports_to        | input     | plain_text_input | Reports To          |
| work_location     | input     | plain_text_input | Work Location       |
| additional_notes  | input     | plain_text_input | Notes (optional)    |

### 2. Google Drive Template

1. Create your offer letter Google Doc with these exact placeholder strings:
   - `{{CANDIDATE_NAME}}`, `{{CANDIDATE_EMAIL}}`, `{{ROLE_TITLE}}`
   - `{{DEPARTMENT}}`, `{{START_DATE}}`, `{{SALARY}}`
   - `{{SIGNING_BONUS}}`, `{{EQUITY}}`, `{{REPORTS_TO}}`
   - `{{WORK_LOCATION}}`, `{{OFFER_DATE}}`, `{{COMPANY_SIGNER}}`

2. In the PDF version of your template, add these **invisible anchor strings** for DocuSign tabs:
   - `\s1\` — where Blake signs
   - `\d1\` — where Blake's date goes
   - `\s2\` — where the candidate signs
   - `\d2\` — where the candidate's date goes
   - `\n2\` — where the candidate's printed name goes

   > Tip: Set the anchor text in white font, size 4pt so it's invisible on screen.

3. Share the template file and offers folder with your Google Service Account email.

4. Note the template file ID (from the URL: `docs.google.com/document/d/<ID>/edit`).

### 3. DocuSign JWT Auth Setup

1. In DocuSign Admin → Apps & Keys → Create App → enable JWT Grant
2. Generate RSA keypair, save private key as `DOCUSIGN_PRIVATE_KEY`
3. Get your Integration Key, Account ID, and User ID (GUID) from the Admin panel
4. Grant consent: `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INT_KEY>&redirect_uri=https://example.com`

### 4. Deploy to AWS

```bash
# Install dependencies
npm install

# Deploy with SAM
sam build
sam deploy --guided

# SAM will prompt for all Parameters — have your credentials ready.
# It will output your Slack Events URL and DocuSign Webhook URL.
```

### 5. Post-Deploy Configuration

After `sam deploy` outputs your URLs:

1. **Slack** → paste the Slack Events URL into Interactivity + Event Subscriptions
2. **DocuSign** → Admin → Connect → Create Configuration:
   - URL: paste the DocuSign Webhook URL
   - Events: Envelope Sent, Delivered, Completed, Declined, Voided
   - Include: Custom Fields, Envelope Custom Fields
   - Format: JSON

---

## Local Development

```bash
cp .env.example .env
# Fill in all values in .env

npm install

# Install express for local server
npm install express --save-dev

# Run locally (requires ngrok for Slack + DocuSign to reach you)
node src/handlers/local.js

# In another terminal:
ngrok http 3000
# Paste the ngrok HTTPS URL into Slack + DocuSign Connect settings
```

---

## Optional: Tracking Sheet

Set `GOOGLE_TRACKING_SHEET_ID` to a Google Sheet ID.  
Agent 5 will append a row with: Date, Candidate, Email, Role, Dept, Start Date, Salary, DocuSign ID, Status, Drive Link.

The sheet must be shared with your service account and have a tab named `Offers` with headers in row 1.

---

## Customising the Template Placeholders

Edit the `replacements` map in `src/agents/agent2-docgen.js` → `fillDocTemplate()` to add or rename placeholders to match your actual Google Doc template.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blake never gets the DM | `SLACK_APPROVAL_CHANNEL` is not Blake's Slack User ID (should be `U0123456789` format, not `@blake`) |
| "No record found for envelope" in Agent 4 | DynamoDB table not created, or wrong region |
| DocuSign tabs not placing correctly | Anchor strings not present in PDF, or whitespace mismatch |
| Google Doc placeholders not replaced | Service account not shared on the template file or parent folder |
| Lambda timeout | Increase `Timeout` in `template.yaml` — PDF export can be slow on large docs |
