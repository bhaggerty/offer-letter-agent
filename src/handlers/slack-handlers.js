'use strict';

/**
 * Registers all Slack Bolt listeners:
 *  - view submission  → offer_intake_modal  → Agent 1 (parse + route to Blake)
 *  - block_action     → approve_offer       → Agent 2 onwards
 *  - block_action     → reject_offer        → notify recruiter
 */

const agent1 = require('../agents/agent1-intake');

function registerSlackHandlers(app) {
  // ── Recruiter submits the intake modal ──────────────────────────────────
  app.view('offer_intake_modal', async ({ ack, view, body, client }) => {
    await ack();

    const recruiterId = body.user.id;
    const values = view.state.values;

    // Extract all fields from the modal blocks
    const offerData = {
      candidateName:    values.candidate_name?.input?.value,
      candidateEmail:   values.candidate_email?.input?.value,
      role:             values.role?.input?.value,
      department:       values.department?.input?.value,
      startDate:        values.start_date?.input?.value,
      salary:           values.salary?.input?.value,
      signingBonus:     values.signing_bonus?.input?.value || '0',
      equity:           values.equity?.input?.value || 'N/A',
      reportsTo:        values.reports_to?.input?.value,
      workLocation:     values.work_location?.input?.value,
      additionalNotes:  values.additional_notes?.input?.value || '',
      recruiterId,
      submittedAt:      new Date().toISOString(),
    };

    console.log('[AGENT1] Modal submitted by', recruiterId, offerData);

    try {
      await agent1.processIntakeAndRoute({ offerData, client });
    } catch (err) {
      console.error('[AGENT1] Error processing intake:', err);
      await client.chat.postMessage({
        channel: recruiterId,
        text: `⚠️ Something went wrong processing your offer submission for *${offerData.candidateName}*. Please try again or contact the engineering team.`,
      });
    }
  });

  // ── Blake approves ────────────────────────────────────────────────────
  app.action('approve_offer', async ({ ack, body, action, client }) => {
    await ack();

    const offerData = JSON.parse(action.value);
    const approverId = body.user.id;

    console.log('[AGENT1] Offer approved by', approverId, 'for', offerData.candidateName);

    // Update the approval message to show approved state
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer for *${offerData.candidateName}* approved by <@${approverId}>. Processing now...`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Offer Approved* by <@${approverId}>\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}\nGenerating offer letter and sending to DocuSign...`,
          },
        },
      ],
    });

    // Kick off the doc generation pipeline (agents 2-5)
    try {
      const { runDocPipeline } = require('../agents/agent2-docgen');
      await runDocPipeline({ offerData, approverId, client });
    } catch (err) {
      console.error('[AGENT2+] Pipeline error:', err);
      await client.chat.postMessage({
        channel: offerData.recruiterId,
        text: `⚠️ Approval succeeded but document generation failed for *${offerData.candidateName}*. Error: ${err.message}`,
      });
    }
  });

  // ── Blake rejects ─────────────────────────────────────────────────────
  app.action('reject_offer', async ({ ack, body, action, client }) => {
    await ack();

    const { offerData, reason } = JSON.parse(action.value);
    const rejecterId = body.user.id;

    console.log('[AGENT1] Offer rejected by', rejecterId, 'for', offerData.candidateName);

    // Update the approval message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ Offer for *${offerData.candidateName}* rejected.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Offer Rejected* by <@${rejecterId}>\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}`,
          },
        },
      ],
    });

    // Notify recruiter
    await client.chat.postMessage({
      channel: offerData.recruiterId,
      text: `❌ The offer for *${offerData.candidateName}* (${offerData.role}) was *not approved* by <@${rejecterId}>. Please follow up for more details.`,
    });
  });
}

module.exports = { registerSlackHandlers };
