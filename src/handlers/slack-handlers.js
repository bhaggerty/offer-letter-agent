'use strict';

/**
 * Slack Bolt listeners.
 *
 *  - block_action → submit_offer_form  → recruiter submitted offer details → route to Blake
 *  - block_action → approve_offer      → Blake approved → fire Agent 2
 *  - block_action → reject_offer       → Blake rejected → notify recruiter
 *  - block_action → view_signed_offer  → no-op (link opens client-side)
 */

const { routeToBlakeForApproval } = require('../agents/agent1-intake');

function registerSlackHandlers(app) {

  // ── Recruiter submits offer details form ──────────────────────────────
  app.action('submit_offer_form', async ({ ack, body, action, client }) => {
    await ack();

    const baseData   = JSON.parse(action.value);
    const values     = body.state.values;

    // Merge base data from Ashby with recruiter-filled fields
    const offerData = {
      ...baseData,
      startDate:      values.start_date?.input?.value,
      salary:         values.salary?.input?.value,
      signingBonus:   values.signing_bonus?.input?.value || 'N/A',
      equity:         values.equity?.input?.value || 'N/A',
      reportsTo:      values.reports_to?.input?.value,
      workLocation:   values.work_location?.input?.value,
      employmentType: values.employment_type?.input?.selected_option?.value || 'Full-time',
      additionalNotes: values.additional_notes?.input?.value || '',
      submittedAt:    new Date().toISOString(),
    };

    console.log('[AGENT1] Recruiter submitted offer form for', offerData.candidateName);

    // Update the form message to show it's been submitted
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer details submitted for *${offerData.candidateName}* — sent to Blake for approval.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Offer details submitted for *${offerData.candidateName}* (${offerData.role}). Sent to Blake for approval.`,
          },
        },
      ],
    });

    // Route to Blake for approval
    try {
      await routeToBlakeForApproval({ offerData, client });
    } catch (err) {
      console.error('[AGENT1] Error routing to Blake:', err);
      await client.chat.postMessage({
        channel: offerData.recruiterId,
        text: `⚠️ Something went wrong sending the offer to Blake. Error: ${err.message}`,
      });
    }
  });

  // ── Blake approves ────────────────────────────────────────────────────
  app.action('approve_offer', async ({ ack, body, action, client }) => {
    await ack();

    const offerData  = JSON.parse(action.value);
    const approverId = body.user.id;

    console.log('[AGENT1] Offer approved by', approverId, 'for', offerData.candidateName);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer for *${offerData.candidateName}* approved — generating offer letter...`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Approved* by <@${approverId}>\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}\n\nGenerating offer letter and routing to DocuSign...`,
          },
        },
      ],
    });

    try {
      const { runDocPipeline } = require('../agents/agent2-docgen');
      await runDocPipeline({ offerData, client });
    } catch (err) {
      console.error('[AGENT2+] Pipeline error:', err);
      await client.chat.postMessage({
        channel: offerData.recruiterId,
        text: `⚠️ Blake approved the offer for *${offerData.candidateName}* but document generation failed. Error: ${err.message}`,
      });
    }
  });

  // ── Blake rejects ─────────────────────────────────────────────────────
  app.action('reject_offer', async ({ ack, body, action, client }) => {
    await ack();

    const { offerData } = JSON.parse(action.value);
    const rejecterId   = body.user.id;

    console.log('[AGENT1] Offer rejected by', rejecterId, 'for', offerData.candidateName);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ Offer for *${offerData.candidateName}* rejected.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Rejected* by <@${rejecterId}>\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}`,
          },
        },
      ],
    });

    await client.chat.postMessage({
      channel: offerData.recruiterId,
      text: `❌ The offer for *${offerData.candidateName}* (${offerData.role}) was not approved by <@${rejecterId}>. Please follow up directly for more details.`,
    });
  });

  // ── View Signed Offer button — link opens client-side ─────────────────
  app.action('view_signed_offer', async ({ ack }) => {
    await ack();
  });
}

module.exports = { registerSlackHandlers };
