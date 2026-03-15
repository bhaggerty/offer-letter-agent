'use strict';

/**
 * AGENT 4 — Signature Monitor
 *
 * Receives DocuSign Connect webhook POSTs and:
 *   - completed  → fire Agent 5 (notify + archive)
 *   - declined   → alert recruiter
 *   - voided     → alert recruiter
 *   - (scheduled EventBridge rule) → send reminders for envelopes pending > N days
 */

const { getEnvelopeRecord, updateEnvelopeStatus } = require('../lib/state-store');
const agent5 = require('./agent5-notify');

/**
 * Lambda handler for DocuSign webhook POST.
 * DocuSign sends XML or JSON depending on Connect configuration.
 * We configure it for JSON (set "Include Envelope Custom Fields" = true in Connect).
 */
async function handleDocuSignWebhook(event) {
  let payload;

  try {
    const body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    payload = JSON.parse(body);
  } catch (err) {
    console.error('[AGENT4] Failed to parse webhook body:', err);
    return { statusCode: 400, body: 'Bad Request' };
  }

  const envelopeId     = payload?.envelopeId || payload?.data?.envelopeId;
  const envelopeStatus = payload?.status      || payload?.data?.envelopeSummary?.status;

  console.log('[AGENT4] Webhook received:', envelopeId, envelopeStatus);

  if (!envelopeId || !envelopeStatus) {
    return { statusCode: 200, body: 'OK' }; // Acknowledge but ignore malformed pings
  }

  const record = await getEnvelopeRecord(envelopeId);

  if (!record) {
    console.warn('[AGENT4] No record found for envelope:', envelopeId);
    return { statusCode: 200, body: 'OK' };
  }

  await updateEnvelopeStatus(envelopeId, envelopeStatus);

  switch (envelopeStatus.toLowerCase()) {
    case 'completed':
      console.log('[AGENT4] Envelope completed:', envelopeId);
      await agent5.handleOfferSigned({ record, envelopeId });
      break;

    case 'declined':
      console.log('[AGENT4] Envelope declined:', envelopeId);
      await notifyRecruiterOfDecline({ record, envelopeId, status: 'declined' });
      break;

    case 'voided':
      console.log('[AGENT4] Envelope voided:', envelopeId);
      await notifyRecruiterOfDecline({ record, envelopeId, status: 'voided' });
      break;

    default:
      console.log('[AGENT4] Status update (no action):', envelopeStatus);
  }

  // DocuSign requires a 200 acknowledgment or it will retry
  return { statusCode: 200, body: 'OK' };
}

/**
 * Scheduled handler — called by EventBridge on a daily cron.
 * Finds all envelopes still in "sent" state older than OFFER_REMINDER_DAYS
 * and triggers a DocuSign reminder.
 */
async function handleReminderCheck() {
  const { listPendingEnvelopes } = require('../lib/state-store');
  const { getApiClient } = require('./agent3-docusign');
  const docusign = require('docusign-esign');

  const reminderDays = parseInt(process.env.OFFER_REMINDER_DAYS || '3', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - reminderDays);

  const pending = await listPendingEnvelopes();

  for (const record of pending) {
    const sentAt = new Date(record.sentAt);
    if (sentAt < cutoff) {
      console.log('[AGENT4] Sending reminder for envelope:', record.envelopeId);
      try {
        const apiClient = await getApiClient();
        const envelopesApi = new docusign.EnvelopesApi(apiClient);
        await envelopesApi.update(
          process.env.DOCUSIGN_ACCOUNT_ID,
          record.envelopeId,
          { envelopeDefinition: { status: 'sent' } } // resend = update status back to sent
        );
        console.log('[AGENT4] Reminder sent for', record.envelopeId);
      } catch (err) {
        console.error('[AGENT4] Reminder failed for', record.envelopeId, err.message);
      }
    }
  }
}

async function notifyRecruiterOfDecline({ record, envelopeId, status }) {
  const { WebClient } = require('@slack/web-api');
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  const { offerData } = record;
  const statusWord = status === 'declined' ? '❌ declined to sign' : '🚫 voided';

  await slack.chat.postMessage({
    channel: offerData.recruiterId,
    text: `⚠️ The offer letter for *${offerData.candidateName}* (${offerData.role}) was ${statusWord} in DocuSign (envelope ID: ${envelopeId}). Please follow up with the candidate or Blake.`,
  });
}

module.exports = { handleDocuSignWebhook, handleReminderCheck };
