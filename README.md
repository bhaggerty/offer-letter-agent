# Offer Letter Agent

Automated offer letter pipeline triggered by Ashby. When a candidate is moved to the **Hired** stage, the agent kicks off a two-step approval flow, generates the correct offer letter, routes it through DocuSign for signatures, and notifies the recruiter when everything is signed.

---

## How It Works

```
Candidate moved to Hired in Ashby
        ↓
Recruiter gets a Slack form (via Offer Letter Agent app) to fill in offer details
        ↓
Head of Talent reviews in Slack — can add notes — Approve or Reject
        ↓ (Head of Talent approves)
Exec approval channel — designated exec gives final sign-off
        ↓ (Exec approves)
Agent 2 — Calls Google Apps Script to:
          • Select correct template (standard or sales)
          • Fill offer letter placeholders
          • Create candidate folder in Google Drive
          • Export as PDF
        ↓
Agent 3 — Uploads PDF to DocuSign
          Signing order:
            1. Company signatory (signs first)
            2. Candidate (signs second)
            3. Head of Talent (receives a copy)
        ↓
Agent 4 — Monitors DocuSign for all signatures complete
          Auto-reminds if unsigned after 3 days
        ↓
Agent 5 — Downloads signed PDF back to Drive
          Slacks the recruiter with confirmation + Drive link
```

---

## Template Selection

- **Standard offer** — used when Variable Comp and Ramp Period fields are left blank
- **Sales offer** — used when Variable Comp or Ramp Period fields are filled in

---

## Tech Stack

- **Runtime:** Node.js 20
- **Hosting:** ECS on AWS Fargate (internal deployment platform)
- **Database:** DynamoDB (auto-provisioned)
- **AI Validation:** OpenAI GPT-4o
- **Trigger:** Ashby webhook (Candidate Hired event)
- **Notifications:** Slack
- **Document Generation:** Google Apps Script
- **e-Signatures:** DocuSign (production)

---

## Project Structure

```
src/
├── handlers/
│   ├── lambda.js          # Main entry point — routes incoming requests
│   ├── ashby-webhook.js   # Handles Ashby hired stage events + recruiter mapping
│   ├── slack-handlers.js  # Handles all Slack button interactions
│   ├── local.js           # ECS server (port 8080)
│   └── reminder.js        # Daily cron — resends unsigned envelopes
├── agents/
│   ├── agent1-intake.js   # Recruiter form + two-step approval flow
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
| `SLACK_BLAKE_USER_ID` | Head of Talent's Slack member ID |
| `SLACK_RECRUITER_NOTIFY_CHANNEL` | Fallback channel if recruiter not in map |
| `SLACK_EXEC_APPROVAL_CHANNEL` | Private exec approval channel ID |
| `ASHBY_WEBHOOK_SECRET` | Secret token from Ashby webhook settings |
| `RECRUITER_SLACK_MAP` | JSON map of Ashby email → Slack user ID |
| `OPENAI_API_KEY` | OpenAI API key (GPT-4o) |
| `APPS_SCRIPT_URL` | Google Apps Script web app URL |
| `APPS_SCRIPT_SECRET` | Secret key for Apps Script authentication |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign app integration key |
| `DOCUSIGN_SECRET_KEY` | DocuSign OAuth secret |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account GUID (production) |
| `DOCUSIGN_BASE_PATH` | DocuSign production server URL + `/restapi` |
| `DOCUSIGN_IMPERSONATED_USER_ID` | DocuSign user GUID (production) |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key (PEM, newlines as \n) |
| `DOCUSIGN_COMPANY_SIGNER_NAME` | Name of company signatory (signs first) |
| `DOCUSIGN_COMPANY_SIGNER_EMAIL` | Email of company signatory |
| `DOCUSIGN_CC_NAME` | Name of Head of Talent (receives copy) |
| `DOCUSIGN_CC_EMAIL` | Email of Head of Talent |
| `DOCUSIGN_WEBHOOK_URL` | Your app's public URL + `/docusign-webhook` |
| `OFFER_REMINDER_DAYS` | Days before auto-reminding unsigned candidates (default: 3) |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |

---

## Recruiter Slack Map

The `RECRUITER_SLACK_MAP` secret maps Ashby user emails to Slack user IDs so the offer form goes directly to the recruiter who made the hire. Format:

```json
{
  "recruiter1@company.com": "UXXXXXXXXX",
  "recruiter2@company.com": "UXXXXXXXXX"
}
```

To add a new recruiter, update this secret in your deployment platform — no code changes needed.

---

## Offer Letter Templates

### Standard Template
Used for all non-sales hires. Placeholders:

`{{DATE}}` `{{FirstName}}` `{{LastName}}` `{{JobTitle}}` `{{Department}}`
`{{ManagerName}}` `{{StartDate}}` `{{BaseSalary}}` `{{SigningBonus}}`
`{{Shares}}` `{{EmploymentType}}` `{{WorkLocation}}`

### Sales Template
Used when Variable Comp or Ramp Period fields are filled in. Same placeholders as standard plus:

`{{VariableComp}}` `{{RampPeriod}}`

---

## DocuSign Anchor Tags

Add these in **white 4pt font** (invisible) at the signature locations in both templates:

| Anchor | Who | What |
|---|---|---|
| `\s1\` | Company signatory | Signature |
| `\n1\` | Company signatory | Printed name |
| `\t1\` | Company signatory | Title |
| `\d1\` | Company signatory | Date |
| `\s2\` | Candidate | Signature |
| `\n2\` | Candidate | Printed name |
| `\d2\` | Candidate | Date |

---

## Webhook URLs

| Service | Path |
|---|---|
| Ashby webhook | `/ashby-webhook` |
| Slack interactivity | `/slack/events` |
| DocuSign Connect | `/docusign-webhook` |

---

## Adding a New Recruiter

1. Get their Slack member ID (click profile → ••• → Copy member ID)
2. Update `RECRUITER_SLACK_MAP` secret in your deployment platform to add their email → Slack ID
3. No redeploy needed — secret updates take effect immediately

---

## Switching Exec Approval Channel

Update `SLACK_EXEC_APPROVAL_CHANNEL` in your deployment platform with the new channel ID and invite the bot with `/invite @Offer Letter Agent`.

---

## Known Gotchas

- **Ashby webhook event type** is `candidateHire` (not `applicationStageChange`)
- **Ashby candidate email** is at `candidate.primaryEmailAddress.value`
- **DocuSign sends XML** not JSON despite Connect being configured for JSON — code handles this automatically
- **DocuSign fires completion webhook per signer** — code checks for pending signers before processing to avoid duplicate PDFs
- **Apps Script permissions** — if Drive access fails, run the `testDriveAccess` function manually in the editor to grant OAuth permissions, then redeploy with a New version
- **Apps Script deploy** — always select New version when deploying, not just Deploy
- **DynamoDB key structure** — table uses `PK/SK` keys, not a single primary key
