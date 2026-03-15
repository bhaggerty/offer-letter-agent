# Offer Letter Agent

Automated offer letter pipeline triggered by Ashby. When a candidate is moved to the **Hired** stage, the agent automatically generates an offer letter, routes it through DocuSign for signatures, and notifies the recruiter when everything is signed.

---

## How It Works

```
Candidate moved to Hired in Ashby
        ↓
Agent 1 — Validates offer data with OpenAI
          DMs Blake in Slack with Approve / Reject buttons
        ↓ (Blake clicks Approve)
Agent 2 — Calls Google Apps Script to:
          • Fill offer letter template
          • Create candidate folder in Google Drive
          • Export as PDF
        ↓
Agent 3 — Uploads PDF to DocuSign
          Signing order:
            1. Alex Bovee (signs first)
            2. Candidate (signs second)
            3. Blake Haggerty (receives a copy)
        ↓
Agent 4 — Monitors DocuSign for completion
          Auto-reminds if unsigned after 3 days
        ↓
Agent 5 — Downloads signed PDF back to Drive
          Slacks the recruiter with confirmation + Drive link
```

---

## Tech Stack

- **Runtime:** Node.js 20
- **Hosting:** Internal Lambda deployment (ConductorOne)
- **Database:** DynamoDB (auto-provisioned)
- **AI Validation:** OpenAI GPT-4o
- **Trigger:** Ashby webhook (Candidate Hired event)
- **Notifications:** Slack
- **Document Generation:** Google Apps Script
- **e-Signatures:** DocuSign

---

## Project Structure

```
src/
├── handlers/
│   ├── lambda.js          # Main entry point — routes incoming requests
│   ├── ashby-webhook.js   # Handles Ashby hired stage events
│   ├── slack-handlers.js  # Handles Slack approve/reject button clicks
│   ├── local.js           # Local development server (port 8080)
│   └── reminder.js        # Daily cron — resends unsigned envelopes
├── agents/
│   ├── agent1-intake.js   # Validates offer data, routes to Blake for approval
│   ├── agent2-docgen.js   # Calls Apps Script to generate PDF
│   ├── agent3-docusign.js # Creates DocuSign envelope, sets signing order
│   ├── agent4-monitor.js  # Listens for DocuSign completion webhook
│   └── agent5-notify.js   # Archives signed PDF, notifies recruiter
└── lib/
    └── state-store.js     # DynamoDB helpers for envelope state
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_BLAKE_USER_ID` | Blake's Slack member ID |
| `SLACK_RECRUITER_NOTIFY_CHANNEL` | Recruiting channel ID or #channel-name |
| `ASHBY_WEBHOOK_SECRET` | Secret token from Ashby webhook settings |
| `OPENAI_API_KEY` | OpenAI API key |
| `APPS_SCRIPT_URL` | Google Apps Script web app URL |
| `APPS_SCRIPT_SECRET` | Secret key for Apps Script authentication |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign app integration key |
| `DOCUSIGN_SECRET_KEY` | DocuSign OAuth secret |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account GUID |
| `DOCUSIGN_BASE_PATH` | DocuSign server URL (e.g. https://demo.docusign.net/restapi) |
| `DOCUSIGN_IMPERSONATED_USER_ID` | DocuSign user GUID |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key (PEM format, newlines as \n) |
| `DOCUSIGN_ALEX_NAME` | Alex Bovee |
| `DOCUSIGN_ALEX_EMAIL` | Alex's work email |
| `DOCUSIGN_BLAKE_NAME` | Blake Haggerty |
| `DOCUSIGN_BLAKE_EMAIL` | Blake's work email |
| `DOCUSIGN_WEBHOOK_URL` | Public URL for DocuSign to POST completion events |
| `OFFER_REMINDER_DAYS` | Days before auto-reminding unsigned candidates (default: 3) |
| `NODE_ENV` | production |
| `PORT` | 8080 |

---

## Webhook URLs

After deployment your app is reachable at:
`https://offer-letter-agent.{env}.secsvcs.c1rew.com`

Configure these in each service:

| Service | Setting | URL |
|---|---|---|
| Ashby | Settings → Integrations → Webhooks | `.../ashby-webhook` |
| Slack | Interactivity & Shortcuts → Request URL | `.../slack/events` |
| DocuSign | Admin → Connect → Configuration URL | `.../docusign-webhook` |

---

## Offer Letter Template

The Google Apps Script expects these placeholders in the Google Doc template:

`{{FirstName}}` `{{LastName}}` `{{JobTitle}}` `{{Department}}`
`{{ManagerName}}` `{{StartDate}}` `{{BaseSalary}}` `{{SigningBonus}}`
`{{Shares}}` `{{EmploymentType}}` `{{WorkLocation}}`

For DocuSign signature placement, add these strings in **white 4pt font** (invisible) at the signature locations:

| Anchor | Who | Location |
|---|---|---|
| `\s1\` | Alex Bovee | Where Alex signs |
| `\d1\` | Alex Bovee | Where Alex's date goes |
| `\s2\` | Candidate | Where candidate signs |
| `\d2\` | Candidate | Where candidate's date goes |
| `\n2\` | Candidate | Where candidate prints name |

---

## Source Code

github.com/bhaggerty/offer-letter-agent
