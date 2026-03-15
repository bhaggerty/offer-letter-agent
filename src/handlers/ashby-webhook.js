'use strict';

const { WebClient } = require('@slack/web-api');
const agent1 = require('../agents/agent1-intake');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function handleAshbyWebhook(event) {
  let payload;

  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);

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

  const eventType = payload?.action || payload?.event || payload?.type;
  console.log('[ASHBY] Event received:', eventType);
  console.log('[ASHBY] Full payload:', JSON.stringify(payload, null, 2));

  if (eventType === 'ping' || eventType === 'test') {
    return { statusCode: 200, body: 'OK' };
  }

  const isHireEvent = ['candidateHire', 'candidateHired', 'applicationStageChange'].includes(eventType);
  if (!isHireEvent) {
    console.log('[ASHBY] Ignoring event type:', eventType);
    return { statusCode: 200, body: 'OK' };
  }

  const application = payload?.data?.application || {};
  console.log('[ASHBY] Candidate hired, processing offer:', application?.candidate?.name);

  const offerData = extractOfferData(application);

  try {
    await agent1.processFromAshby({ offerData, slack });
  } catch (err) {
    console.error('[ASHBY] Agent1 error:', err);
    await alertRecruitingChannel(`⚠️ Ashby hired event received for *${offerData.candidateName}* but the offer pipeline failed to start. Error: ${err.message}`);
  }

  return { statusCode: 200, body: 'OK' };
}

function extractOfferData(application) {
  const candidate      = application?.candidate || {};
  const job            = application?.job || {};
  const creditedToUser = application?.creditedToUser || {};

  // Email is nested under primaryEmailAddress.value
  const candidateEmail = candidate?.primaryEmailAddress?.value || 
                         candidate?.email || 
                         candidate?.primaryEmail || '';

  // Recruiter is the creditedToUser — map their email to a Slack user
  // We store their Ashby user ID for now; the recruiter DM will go to SLACK_RECRUITER_NOTIFY_CHANNEL
  // as a fallback since we don't have a direct Ashby→Slack user ID mapping
  const recruiterId = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;

  return {
    candidateName:      candidate?.name || 'Unknown',
    candidateEmail,
    role:               job?.title || '',
    department:         job?.departmentId || '',
    reportsTo:          '',
    workLocation:       job?.locationId || '',
    salary:             '',
    signingBonus:       'N/A',
    equity:             'N/A',
    startDate:          '',
    employmentType:     'Full-time',
    ashbyApplicationId: application?.id || '',
    ashbyJobId:         job?.id || '',
    recruiterId,
    creditedToUserEmail: creditedToUser?.email || '',
    creditedToUserName:  `${creditedToUser?.firstName || ''} ${creditedToUser?.lastName || ''}`.trim(),
    additionalNotes:    '',
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
