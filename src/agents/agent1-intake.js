'use strict';

/**
 * AGENT 1 — Intake & Approval
 *
 * Responsibilities:
 *  1. Use Claude to validate/normalise the offer data (catch obvious errors)
 *  2. Send Blake a rich Slack approval message with Approve / Reject buttons
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BLAKE_USER_ID = process.env.SLACK_APPROVAL_CHANNEL; // Blake's Slack User ID

/**
 * Validate offer data with Claude, then DM Blake for approval.
 */
async function processIntakeAndRoute({ offerData, client }) {
  // ── Step 1: Claude validates and formats the data ─────────────────────
  const validation = await validateOfferData(offerData);

  if (!validation.isValid) {
    // Notify the recruiter of issues before bothering Blake
    await client.chat.postMessage({
      channel: offerData.recruiterId,
      text: `⚠️ Your offer submission for *${offerData.candidateName}* has some issues that need fixing before it can be sent for approval:\n\n${validation.issues.map(i => `• ${i}`).join('\n')}`,
    });
    return;
  }

  // Use Claude's cleaned/normalised version of the data
  const cleanedOffer = { ...offerData, ...validation.normalised };

  // ── Step 2: DM Blake with approval buttons ────────────────────────────
  const offerValueJson = JSON.stringify(cleanedOffer);
  const rejectValueJson = JSON.stringify({ offerData: cleanedOffer, reason: '' });

  await client.chat.postMessage({
    channel: BLAKE_USER_ID,
    text: `New offer letter approval request for ${cleanedOffer.candidateName}`,
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
        type: 'section',
        text: { type: 'mrkdwn', text: `_Submitted by <@${cleanedOffer.recruiterId}> at ${new Date(cleanedOffer.submittedAt).toLocaleString()}_` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve' },
            style: 'primary',
            action_id: 'approve_offer',
            value: offerValueJson,
            confirm: {
              title: { type: 'plain_text', text: 'Approve this offer?' },
              text: { type: 'mrkdwn', text: `This will generate and send the offer letter to *${cleanedOffer.candidateName}* via DocuSign.` },
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

  // Confirm to the recruiter their submission is pending
  await client.chat.postMessage({
    channel: offerData.recruiterId,
    text: `👍 Your offer submission for *${cleanedOffer.candidateName}* (${cleanedOffer.role}) has been sent to Blake for approval. You'll be notified once it's processed.`,
  });
}

/**
 * Use Claude to validate and normalise the offer payload.
 * Returns { isValid, issues[], normalised{} }
 */
async function validateOfferData(offerData) {
  const prompt = `You are an HR data validator for offer letters. Review the following offer data and:
1. Check for obvious errors (missing required fields, invalid email format, nonsensical salary, past start date, etc.)
2. Normalise formatting: proper name casing, salary as "$XXX,XXX/year", dates as "Month DD, YYYY"
3. Return ONLY valid JSON with this exact shape:
{
  "isValid": true/false,
  "issues": ["issue1", "issue2"],
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

Offer data:
${JSON.stringify(offerData, null, 2)}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = response.content[0].text.trim();
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AGENT1] Claude validation parse error:', err);
    // Fail open — let the data through if Claude returns malformed JSON
    return { isValid: true, issues: [], normalised: {} };
  }
}

module.exports = { processIntakeAndRoute };
