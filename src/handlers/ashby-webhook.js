'use strict';

const { WebClient } = require('@slack/web-api');
const agent1 = require('../agents/agent1-intake');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function handleAshbyWebhook(event) {
  let payload;

  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);

  // Handle empty body ping requests
  if (!rawBody || rawBody === '{}' || rawBody === '') {
    console.log('[ASHBY] Ping received, responding OK');
    return { statusCode: 200, body: 'OK' };
  }

  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('[ASHBY] Failed to parse body:', err);
    return { statusCode: 200, body: 'OK' };
  }

  // Log full payload so we can see exact shape in logs
  const eventType = payload?.action || payload?.event || payload?.type;
  console.log('[ASHBY] Event received:', eventType);
  console.log('[ASHBY] Full payload:', JSON.stringify(payload, null, 2));

  // Respond OK to ping/test events
  if (eventType === 'ping' || eventType === 'test') {
    return { statusCode: 200, body: 'OK' };
  }

  // Accept all hire-related event types from Ashby
  const isHireEvent = [
    'candidateHire',
    'candidateHired',
    'applicationStageChange',
  ].includes(eventType);

  if (!isHireEvent) {
    console.log('[ASHBY] Ignoring event type:', eventType);
    return { statusCode: 200, body: 'OK' };
  }

  // For applicationStageChange, check it's actually the Hired stage
  if (eventType === 'applicationStageChange') {
    const application = payload?.data?.application || payload?.application;
    const newStage    = payload?.data?.applicationStage || application?.currentInterviewStage;
    const isHired =
      newStage?.type === 'Hired' ||
      newStage?.name?.toLowerCase() === 'hired' ||
      application?.status === 'Hired';

    if (!isHired) {
      console.log('[ASHBY] Stage is not Hired, ignoring:', newStage?.name);
      return { statusCode: 200, body: 'OK' };
    }
  }

  // Extract offer data from payload
  const application = payload?.data?.application || payload?.application || payload?.data || {};
  console.log('[ASHBY] Candidate hired, processing offer:', application?.candidate?.name);

  const offerData = extractOfferData(application, payload);

  if (!offerData.candidateEmail) {
    console.error('[ASHBY] No candidate email found');
    await alertRecruitingChannel(`⚠️ A candidate was moved to Hired in Ashby but has no email on file. Please check the application for *${offerData.candidateName}*.`);
    return { statusCode: 200, body: 'OK' };
  }

  try {
    await agent1.processFromAshby({ offerData, slack });
  } catch (err) {
    console.error('[ASHBY] Agent1 error:', err);
    await alertRecruitingChannel(`⚠️ Ashby hired event received for *${offerData.candidateName}* but the offer pipeline failed to start. Error: ${err.message}`);
  }

  return { statusCode: 200, body: 'OK' };
}

function extractOfferData(application, payload) {
  const candidate  = application?.candidate   || {};
  const job        = application?.job         || {};
  const offer      = application?.offer       || {};
  const hiringTeam = application?.hiringTeamMemberships || [];

  const recruiterEntry = hiringTeam.find(m =>
    m?.role?.toLowerCase() === 'recruiter' || m?.title?.toLowerCase() === 'recruiter'
  );

  const compensation = offer?.compensation || offer?.salaryRange || {};
  const salaryValue  = compensation?.value || compensation?.min || offer?.salary || '';
  const currency     = compensation?.currency || 'USD';
  const salaryStr    = salaryValue ? `${currency} ${Number(salaryValue).toLocaleString()}/year` : '';

  return {
    candidateName:      [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.name || 'Unknown',
    candidateEmail:     candidate.email || candidate.primaryEmail || '',
    role:               job.title || offer?.jobTitle || '',
    department:         job.departmentName || job.department?.name || '',
    reportsTo:          offer?.hiringManagerName || '',
    workLocation:       job.locationName || job.location?.name || offer?.workLocation || '',
    salary:             salaryStr,
    signingBonus:       offer?.signingBonus ? `${currency} ${Number(offer.signingBonus).toLocaleString()}` : '0',
    equity:             offer?.equityValue || offer?.equity || 'N/A',
    startDate:          offer?.startDate || '',
    ashbyApplicationId: application?.id || '',
    ashbyJobId:         job?.id || '',
    recruiterId:        recruiterEntry?.userId || process.env.SLACK_RECRUITER_NOTIFY_CHANNEL,
    additionalNotes:    offer?.notes || '',
    submittedAt:        new Date().toISOString(),
    source:             'ashby',
  };
}

async function alertRecruitingChannel(text) {
  const channel = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;
  if (!channel) return;
  await slack.chat.postMessage({ channel, text });
}

module.exports = { handleAshbyWebhook };
