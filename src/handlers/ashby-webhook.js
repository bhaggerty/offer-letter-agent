'use strict';

/**
 * Ashby Webhook Handler
 *
 * Ashby fires a POST to this endpoint whenever a candidate's stage changes.
 * We filter for applicationStage.type === "Hired" and extract offer data
 * from the application payload, then hand off directly to Agent 1.
 *
 * Ashby webhook docs: https://developers.ashbyhq.com/docs/webhooks
 *
 * Configure in Ashby: Settings → Integrations → Webhooks
 *   - Event: applicationStageChange
 *   - URL: https://<your-api-gateway>/prod/ashby-webhook
 *   - Secret: set ASHBY_WEBHOOK_SECRET in env (used to verify signature)
 */

const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const agent1 = require('../agents/agent1-intake');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Lambda handler for Ashby webhook POST.
 */
async function handleAshbyWebhook(event) {
  // ── 1. Verify Ashby webhook signature ────────────────────────────────
  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);

  if (process.env.ASHBY_WEBHOOK_SECRET) {
    const signature = (event.headers || {})['x-ashby-signature'] ||
                      (event.headers || {})['X-Ashby-Signature'];
    if (!verifySignature(rawBody, signature)) {
      console.error('[ASHBY] Signature verification failed');
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('[ASHBY] Failed to parse body:', err);
    return { statusCode: 400, body: 'Bad Request' };
  }

  // ── 2. Filter: only process applicationStageChange → Hired ───────────
  const eventType = payload?.action || payload?.event;
  console.log('[ASHBY] Event received:', eventType);

  if (eventType !== 'applicationStageChange') {
    return { statusCode: 200, body: 'OK — ignored' };
  }

  const application = payload?.data?.application || payload?.application;
  const newStage    = payload?.data?.applicationStage || application?.currentInterviewStage;

  // Ashby uses stageType "Hired" or a custom stage named "Hired"
  const isHired =
    newStage?.type === 'Hired' ||
    newStage?.name?.toLowerCase() === 'hired' ||
    application?.status === 'Hired';

  if (!isHired) {
    console.log('[ASHBY] Stage is not Hired, ignoring:', newStage?.name);
    return { statusCode: 200, body: 'OK — not hired stage' };
  }

  console.log('[ASHBY] Candidate hired, processing offer:', application?.candidate?.name);

  // ── 3. Map Ashby fields → offerData ──────────────────────────────────
  const offerData = extractOfferData(application, payload);

  if (!offerData.candidateEmail) {
    console.error('[ASHBY] No candidate email found in payload');
    await alertRecruitingChannel(`⚠️ A candidate was moved to Hired in Ashby but has no email on file. Please check the application for *${offerData.candidateName}* and trigger the offer manually.`);
    return { statusCode: 200, body: 'OK — missing email' };
  }

  // ── 4. Fire Agent 1 (validate + kick off pipeline directly) ──────────
  try {
    await agent1.processFromAshby({ offerData, slack });
  } catch (err) {
    console.error('[ASHBY] Agent1 error:', err);
    await alertRecruitingChannel(`⚠️ Ashby hired event received for *${offerData.candidateName}* but the offer pipeline failed to start. Error: ${err.message}`);
  }

  return { statusCode: 200, body: 'OK' };
}

/**
 * Map Ashby application payload fields to the offerData shape the rest
 * of the pipeline expects.
 *
 * Ashby's payload structure:
 *   payload.data.application.candidate   → name, email
 *   payload.data.application.job         → title, department
 *   payload.data.application.offer       → compensation fields (if offer created in Ashby)
 *   payload.data.application.hiringTeam  → recruiter, hiring manager
 *
 * Fields not available in Ashby (e.g. start date, equity details) will be
 * left as empty strings — Agent 1 (Claude) will flag them for a recruiter
 * to fill in via the SLACK_RECRUITER_NOTIFY_CHANNEL.
 */
function extractOfferData(application, payload) {
  const candidate   = application?.candidate   || {};
  const job         = application?.job         || {};
  const offer       = application?.offer       || {};
  const hiringTeam  = application?.hiringTeamMemberships || [];

  // Pull recruiter from hiring team (role = "Recruiter")
  const recruiterEntry = hiringTeam.find(m =>
    m?.role?.toLowerCase() === 'recruiter' || m?.title?.toLowerCase() === 'recruiter'
  );

  // Compensation — Ashby stores these under offer.compensation or offer.salaryRange
  const compensation = offer?.compensation || offer?.salaryRange || {};
  const salaryValue  = compensation?.value || compensation?.min || offer?.salary || '';
  const currency     = compensation?.currency || 'USD';
  const salaryStr    = salaryValue
    ? `${currency} ${Number(salaryValue).toLocaleString()}/year`
    : '';

  return {
    // Candidate
    candidateName:   [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.name || 'Unknown',
    candidateEmail:  candidate.email || candidate.primaryEmail || '',

    // Role
    role:            job.title || offer?.jobTitle || '',
    department:      job.departmentName || job.department?.name || '',
    reportsTo:       offer?.hiringManagerName || '',
    workLocation:    job.locationName || job.location?.name || offer?.workLocation || '',

    // Compensation
    salary:          salaryStr,
    signingBonus:    offer?.signingBonus ? `${currency} ${Number(offer.signingBonus).toLocaleString()}` : '0',
    equity:          offer?.equityValue || offer?.equity || 'N/A',

    // Dates
    startDate:       offer?.startDate || '',

    // Metadata
    ashbyApplicationId: application?.id || '',
    ashbyJobId:         job?.id || '',
    recruiterId:        recruiterEntry?.userId || process.env.SLACK_RECRUITER_NOTIFY_CHANNEL,
    additionalNotes:    offer?.notes || '',
    submittedAt:        new Date().toISOString(),
    source:             'ashby',
  };
}

/**
 * Verify Ashby HMAC-SHA256 webhook signature.
 * Ashby signs the raw body with your webhook secret.
 */
function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.ASHBY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  // Ashby may prefix with "sha256="
  const incoming = signature.replace(/^sha256=/, '');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));
}

async function alertRecruitingChannel(text) {
  const channel = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;
  if (!channel) return;
  await slack.chat.postMessage({ channel, text });
}

module.exports = { handleAshbyWebhook };
