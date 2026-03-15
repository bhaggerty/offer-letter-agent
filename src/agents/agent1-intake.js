'use strict';

/**
 * AGENT 1 — Intake & Approval
 *
 * Trigger: Ashby "candidate hired" webhook.
 *
 * Responsibilities:
 *  1. Use OpenAI to validate and normalise the Ashby offer data
 *  2. If required fields are missing, alert the recruiter to fix in Ashby first
 *  3. If data is complete, DM Blake with a rich Approve / Reject message
 *  4. On approval → fire Agent 2 (doc generation pipeline)
 *  5. On rejection → notify the recruiter
 */

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BLAKE_SLACK_USER_ID      = process.env.SLACK_BLAKE_USER_ID;
const RECRUITER_NOTIFY_CHANNEL = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;

/**
 * Entry point called by the Ashby webhook handler.
 * `slack` is a pre-built @slack/web-api WebClient instance.
 */
async function processFromAshby({ offerData, slack }) {
  console.log('[AGENT1] Processing Ashby hired event for', offerData.candidateName);

  // ── Step 1: OpenAI validates and normalises the data ──────────────────
  const validation = await validateOfferData(offerData);

  // ── Step 2: If critical fields are missing, pause and alert recruiter ─
  if (!validation.isValid) {
    const issueList = validation.issues.map(i => `• ${i}`).join('\n');
    await slack.chat.postMessage({
      channel: RECRUITER_NOTIFY_CHANNEL,
      text: `⚠️ *Action required — offer for ${offerData.candidateName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *${offerData.candidateName}* was moved to Hired in Ashby but the offer letter is missing required information. Please update the offer in Ashby then re-save to re-trigger:\n\n${issueList}`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Role: ${offerData.role} | Ashby ID: ${offerData.ashbyApplicationId}` }],
        },
      ],
    });
    return;
  }

  // Merge OpenAI's normalised values on top of raw Ashby data
  const cleanedOffer = { ...offerData, ...validation.normalised };

  // ── Step 3: DM Blake with Approve / Reject buttons ────────────────────
  const offerValueJson  = JSON.stringify(cleanedOffer);
  const rejectValueJson = JSON.stringify({ offerData: cleanedOffer });

  await slack.chat.postMessage({
    channel: BLAKE_SLACK_USER_ID,
    text: `New offer approval required for ${cleanedOffer.candidateName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 Offer Letter Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${cleanedOffer.candidateName}` },
          { type: 'mrkdwn', text: `*Email*\n${cleanedOffer.candidateEmail}` },
          { type: 'mrkdwn', text: `*Role*\n${cleanedOffer.role}` },
          { type: 'mrkdwn', text: `*Department*\n${cleanedOffer.department}` },
          { type: 'mrkdwn', text: `*Start Date*\n${cleanedOffer.startDate}` },
          { type: 'mrkdwn', text: `*Reports To*\n${cleanedOffer.reportsTo}` },
          { type: 'mrkdwn', text: `*Base Salary*\n${cleanedOffer.salary}` },
          { type: 'mrkdwn', text: `*Signing Bonus*\n${cleanedOffer.signingBonus}` },
          { type: 'mrkdwn', text: `*Equity*\n${cleanedOffer.equity}` },
          { type: 'mrkdwn', text: `*Location*\n${cleanedOffer.workLocation}` },
        ],
      },
      ...(cleanedOffer.additionalNotes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes*\n${cleanedOffer.additionalNotes}` },
      }] : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Sourced from Ashby · ${new Date(cleanedOffer.submittedAt).toLocaleString()}_` }],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve & Send' },
            style: 'primary',
            action_id: 'approve_offer',
            value: offerValueJson,
            confirm: {
              title: { type: 'plain_text', text: 'Approve this offer?' },
              text: { type: 'mrkdwn', text: `This will generate the offer letter and send it to *${cleanedOffer.candidateName}* via DocuSign for signatures.` },
              confirm: { type: 'plain_text', text: 'Yes, approve' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            action_id: 'reject_offer',
            value: rejectValueJson,
          },
        ],
      },
    ],
  });

  // Let the recruiter know it's pending Blake's approval
  await slack.chat.postMessage({
    channel: RECRUITER_NOTIFY_CHANNEL,
    text: `👍 Offer for *${cleanedOffer.candidateName}* (${cleanedOffer.role}) has been sent to Blake for approval. You'll be notified once it's processed.`,
  });
}

/**
 * Use OpenAI to validate and normalise the offer payload from Ashby.
 * Returns { isValid, issues[], normalised{} }
 */
async function validateOfferData(offerData) {
  const prompt = `You are an HR data validator for offer letters. Review the following offer data (sourced from an ATS) and:

1. Check for missing or invalid REQUIRED fields:
   - candidateName (must not be empty or "Unknown")
   - candidateEmail (must be a valid email)
   - role (must not be empty)
   - startDate (must be present and a future date)
   - salary (must be present and non-zero)

2. Non-blocking fields (do NOT fail validation for these, just normalise): department, reportsTo, workLocation, equity, signingBonus

3. Normalise formatting:
   - Names: proper title case
   - Salary: "$XXX,XXX/year" format
   - Dates: "Month DD, YYYY" format
   - Signing bonus: "$XX,XXX" or "N/A"

4. Return ONLY valid JSON — no preamble, no markdown fences:
{
  "isValid": true,
  "issues": [],
  "normalised": {
    "candidateName": "...",
    "candidateEmail": "...",
    "role": "...",
    "department": "...",
    "startDate": "...",
    "salary": "...",
    "signingBonus": "...",
    "equity": "...",
    "reportsTo": "...",
    "workLocation": "..."
  }
}

Set isValid to false ONLY if a required field is missing or invalid. List each problem in issues[].

Offer data:
${JSON.stringify(offerData, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('[AGENT1] OpenAI validation parse error:', err);
    return { isValid: true, issues: [], normalised: {} };
  }
}

module.exports = { processFromAshby };


/**
 * Entry point called by the Ashby webhook handler.
 * `slack` is a pre-built @slack/web-api WebClient instance.
 */
async function processFromAshby({ offerData, slack }) {
  console.log('[AGENT1] Processing Ashby hired event for', offerData.candidateName);

  // ── Step 1: Claude validates and normalises the data ──────────────────
  const validation = await validateOfferData(offerData);

  // ── Step 2: If critical fields are missing, pause and alert recruiter ─
  if (!validation.isValid) {
    const issueList = validation.issues.map(i => `• ${i}`).join('\n');
    await slack.chat.postMessage({
      channel: RECRUITER_NOTIFY_CHANNEL,
      text: `⚠️ *Action required — offer for ${offerData.candidateName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *${offerData.candidateName}* was moved to Hired in Ashby but the offer letter is missing required information. Please update the offer in Ashby then re-save to re-trigger:\n\n${issueList}`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Role: ${offerData.role} | Ashby ID: ${offerData.ashbyApplicationId}` }],
        },
      ],
    });
    return;
  }

  // Merge Claude's normalised values on top of raw Ashby data
  const cleanedOffer = { ...offerData, ...validation.normalised };

  // ── Step 3: DM Blake with Approve / Reject buttons ────────────────────
  const offerValueJson  = JSON.stringify(cleanedOffer);
  const rejectValueJson = JSON.stringify({ offerData: cleanedOffer });

  await slack.chat.postMessage({
    channel: BLAKE_SLACK_USER_ID,
    text: `New offer approval required for ${cleanedOffer.candidateName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 Offer Letter Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${cleanedOffer.candidateName}` },
          { type: 'mrkdwn', text: `*Email*\n${cleanedOffer.candidateEmail}` },
          { type: 'mrkdwn', text: `*Role*\n${cleanedOffer.role}` },
          { type: 'mrkdwn', text: `*Department*\n${cleanedOffer.department}` },
          { type: 'mrkdwn', text: `*Start Date*\n${cleanedOffer.startDate}` },
          { type: 'mrkdwn', text: `*Reports To*\n${cleanedOffer.reportsTo}` },
          { type: 'mrkdwn', text: `*Base Salary*\n${cleanedOffer.salary}` },
          { type: 'mrkdwn', text: `*Signing Bonus*\n${cleanedOffer.signingBonus}` },
          { type: 'mrkdwn', text: `*Equity*\n${cleanedOffer.equity}` },
          { type: 'mrkdwn', text: `*Location*\n${cleanedOffer.workLocation}` },
        ],
      },
      ...(cleanedOffer.additionalNotes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes*\n${cleanedOffer.additionalNotes}` },
      }] : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Sourced from Ashby · ${new Date(cleanedOffer.submittedAt).toLocaleString()}_` }],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve & Send' },
            style: 'primary',
            action_id: 'approve_offer',
            value: offerValueJson,
            confirm: {
              title: { type: 'plain_text', text: 'Approve this offer?' },
              text: { type: 'mrkdwn', text: `This will generate the offer letter and send it to *${cleanedOffer.candidateName}* via DocuSign for signatures.` },
              confirm: { type: 'plain_text', text: 'Yes, approve' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            action_id: 'reject_offer',
            value: rejectValueJson,
          },
        ],
      },
    ],
  });

  // Let the recruiter know it's pending Blake's approval
  await slack.chat.postMessage({
    channel: RECRUITER_NOTIFY_CHANNEL,
    text: `👍 Offer for *${cleanedOffer.candidateName}* (${cleanedOffer.role}) has been sent to Blake for approval. You'll be notified once it's processed.`,
  });
}

/**
 * Use Claude to validate and normalise the offer payload from Ashby.
 * Returns { isValid, issues[], normalised{} }
 */
async function validateOfferData(offerData) {
  const prompt = `You are an HR data validator for offer letters. Review the following offer data (sourced from an ATS) and:

1. Check for missing or invalid REQUIRED fields:
   - candidateName (must not be empty or "Unknown")
   - candidateEmail (must be a valid email)
   - role (must not be empty)
   - startDate (must be present and a future date)
   - salary (must be present and non-zero)

2. Non-blocking fields (do NOT fail validation for these, just normalise): department, reportsTo, workLocation, equity, signingBonus

3. Normalise formatting:
   - Names: proper title case
   - Salary: "$XXX,XXX/year" format
   - Dates: "Month DD, YYYY" format
   - Signing bonus: "$XX,XXX" or "N/A"

4. Return ONLY valid JSON — no preamble, no markdown fences:
{
  "isValid": true,
  "issues": [],
  "normalised": {
    "candidateName": "...",
    "candidateEmail": "...",
    "role": "...",
    "department": "...",
    "startDate": "...",
    "salary": "...",
    "signingBonus": "...",
    "equity": "...",
    "reportsTo": "...",
    "workLocation": "..."
  }
}

Set isValid to false ONLY if a required field is missing or invalid. List each problem in issues[].

Offer data:
${JSON.stringify(offerData, null, 2)}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('[AGENT1] Claude validation parse error:', err);
    return { isValid: true, issues: [], normalised: {} };
  }
}

module.exports = { processFromAshby };


