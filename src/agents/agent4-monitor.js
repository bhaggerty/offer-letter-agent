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

    // DocuSign sometimes sends XML even when JSON is configured
    if (body.trim().startsWith('<')) {
      console.log('[AGENT4] Received XML payload, parsing...');

      const envelopeIdMatch = body.match(/<EnvelopeID>(.*?)<\/EnvelopeID>/i) ||
                              body.match(/<envelopeId>(.*?)<\/envelopeId>/i);
      const statusMatch     = body.match(/<Status>(.*?)<\/Status>/i) ||
                              body.match(/<status>(.*?)<\/status>/i);

      if (envelopeIdMatch && statusMatch) {
        const envelopeStatus = statusMatch[1].trim();

        // Check if there are still pending signers — if so, skip this webhook
        // DocuSign fires Completed per recipient; we only want the final envelope completion
        const sentCount      = (body.match(/<Status>Sent<\/Status>/gi) || []).length;
        const deliveredCount = (body.match(/<Status>Delivered<\/Status>/gi) || []).length;
        const pendingSigners = sentCount + deliveredCount;

        if (pendingSigners > 0) {
          console.log('[AGENT4] Still ' + pendingSigners + ' pending signers — posting Alex-signed update');
          const rec = await getEnvelopeRecord(envelopeIdMatch[1].trim());
          if (rec && rec.offerData?.execChannel) {
            const { WebClient } = require('@slack/web-api');
            const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
            await slackClient.chat.postMessage({
              channel: rec.offerData.execChannel,
              text: `✍️ Alex Bovee has signed — offer letter sent to *${rec.offerData.candidateName}* for their signature.`,
            });
          }
          return { statusCode: 200, body: 'OK' };
        }

        payload = {
          envelopeId: envelopeIdMatch[1].trim(),
          status:     envelopeStatus,
        };
        console.log('[AGENT4] Parsed XML — envelopeId:', payload.envelopeId, 'status:', payload.status);
      } else {
        console.warn('[AGENT4] Could not extract envelope ID/status from XML');
        return { statusCode: 200, body: 'OK' };
      }
    } else {
      payload = JSON.parse(body);
    }
  } catch (err) {
    console.error('[AGENT4] Failed to parse webhook body:', err);
    return { statusCode: 200, body: 'OK' };
  }

  // Log full payload so we can see exact shape
  console.log('[AGENT4] Full payload:', JSON.stringify(payload, null, 2));

  // DocuSign Connect JSON format
  const envelopeId =
    payload?.envelopeId ||
    payload?.data?.envelopeId ||
    payload?.data?.envelopeSummary?.envelopeId ||
    payload?.EnvelopeStatus?.EnvelopeID ||
    payload?.envelopeSummary?.envelopeId;

  const envelopeStatus =
    payload?.status ||
    payload?.data?.envelopeSummary?.status ||
    payload?.data?.status ||
    payload?.EnvelopeStatus?.Status ||
    payload?.envelopeSummary?.status;

  console.log('[AGENT4] Webhook received:', envelopeId, envelopeStatus);

  if (!envelopeId || !envelopeStatus) {
    return { statusCode: 200, body: 'OK' }; // Acknowledge but ignore malformed pings
  }

  const record = await getEnvelopeRecord(envelopeId);

  if (!record) {
    console.warn('[AGENT4] No record found for envelope:', envelopeId);
    return { statusCode: 200, body: 'OK' };
  }

  // Ignore duplicate completions — if already completed, skip
  if (record.status === 'completed' && envelopeStatus.toLowerCase() === 'completed') {
    console.log('[AGENT4] Duplicate completion webhook ignored for:', envelopeId);
    return { statusCode: 200, body: 'OK' };
  }

  await updateEnvelopeStatus(envelopeId, envelopeStatus.toLowerCase());

  switch (envelopeStatus.toLowerCase()) {
    case 'completed': {
      console.log('[AGENT4] Envelope completed:', envelopeId);
      if (record.offerData?.execChannel) {
        const { WebClient } = require('@slack/web-api');
        const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
        await slackClient.chat.postMessage({
          channel: record.offerData.execChannel,
          text: `✅ *${record.offerData.candidateName}* has signed — all signatures complete. Archiving to Drive...`,
        });
      }
      await agent5.handleOfferSigned({ record, envelopeId });
      break;
    }

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
  const msg = `⚠️ The offer letter for *${offerData.candidateName}* (${offerData.role}) was ${statusWord} in DocuSign (envelope ID: ${envelopeId}).`;

  await slack.chat.postMessage({
    channel: offerData.recruiterId,
    text: `${msg} Please follow up with the candidate or Blake.`,
  });

  if (offerData.execChannel) {
    await slack.chat.postMessage({
      channel: offerData.execChannel,
      text: msg,
    });
  }
}

module.exports = { handleDocuSignWebhook, handleReminderCheck };
