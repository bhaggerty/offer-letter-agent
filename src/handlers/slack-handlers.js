'use strict';

/**
 * Slack Bolt listeners — two-step approval flow:
 *
 *  submit_offer_form    → recruiter submitted details → route to Blake
 *  blake_approve_offer  → Blake approved → route to exec channel
 *  blake_reject_offer   → Blake rejected → notify recruiter
 *  exec_approve_offer   → Paul/Alex approved → fire doc pipeline
 *  exec_reject_offer    → Paul/Alex rejected → notify Blake
 *  view_signed_offer    → no-op (link opens client-side)
 */

const { routeToBlakeForApproval, routeToExecChannel } = require('../agents/agent1-intake');

const BLAKE_SLACK_USER_ID = process.env.SLACK_BLAKE_USER_ID;

function registerSlackHandlers(app) {

  // ── Recruiter submits offer details form ──────────────────────────────
  app.action('submit_offer_form', async ({ ack, body, action, client }) => {
    await ack();

    const baseData = JSON.parse(action.value);
    const values   = body.state.values;

    const offerData = {
      ...baseData,
      role:            values.role?.input?.value || baseData.role,
      startDate:       values.start_date?.input?.value,
      salary:          values.salary?.input?.value,
      signingBonus:    values.signing_bonus?.input?.value || 'N/A',
      equity:          values.equity?.input?.value || 'N/A',
      reportsTo:       values.reports_to?.input?.value,
      workLocation:    values.work_location?.input?.value,
      employmentType:  values.employment_type?.input?.selected_option?.value || 'Full-time',
      variableComp:    values.variable_comp?.input?.value || '',
      rampPeriod:      values.ramp_period?.input?.value || '',
      additionalNotes: values.additional_notes?.input?.value || '',
      submittedAt:     new Date().toISOString(),
    };

    console.log('[AGENT1] Recruiter submitted offer form for', offerData.candidateName);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer details submitted for *${offerData.candidateName}* — sent to Blake for review.`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ Offer details submitted for *${offerData.candidateName}* (${offerData.role}). Sent to Blake for review.` },
      }],
    });

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

  // ── Blake approves → send to exec channel ────────────────────────────
  app.action('blake_approve_offer', async ({ ack, body, action, client }) => {
    await ack();

    const offerData  = JSON.parse(action.value);
    const approverId = body.user.id;
    const blakeNotes = body.state?.values?.blake_notes?.input?.value || '';

    console.log('[AGENT1] Blake approved offer for', offerData.candidateName);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer for *${offerData.candidateName}* approved by you — sent to exec channel for final sign-off.`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *Approved by <@${approverId}>*\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}\n\nSent to exec channel for final approval.${blakeNotes ? `\n\n*Your notes:* ${blakeNotes}` : ''}` },
      }],
    });

    try {
      await routeToExecChannel({ offerData, blakeNotes, client });
    } catch (err) {
      console.error('[AGENT1] Error routing to exec channel:', err);
      await client.chat.postMessage({
        channel: BLAKE_SLACK_USER_ID,
        text: `⚠️ Something went wrong sending the offer to the exec channel. Error: ${err.message}`,
      });
    }
  });

  // ── Blake rejects → notify recruiter ─────────────────────────────────
  app.action('blake_reject_offer', async ({ ack, body, action, client }) => {
    await ack();

    const { offerData } = JSON.parse(action.value);
    const rejecterId   = body.user.id;

    console.log('[AGENT1] Blake rejected offer for', offerData.candidateName);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ Offer for *${offerData.candidateName}* rejected.`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `❌ *Rejected by <@${rejecterId}>*\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}` },
      }],
    });

    await client.chat.postMessage({
      channel: offerData.recruiterId,
      text: `❌ The offer for *${offerData.candidateName}* (${offerData.role}) was not approved by Blake. Please follow up directly for more details.`,
    });
  });

  // ── Exec approves → fire doc pipeline ────────────────────────────────
  app.action('exec_approve_offer', async ({ ack, body, action, client }) => {
    await ack();

    const offerData  = JSON.parse(action.value);
    const approverId = body.user.id;

    console.log('[AGENT1] Exec approved offer for', offerData.candidateName, 'by', approverId);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `✅ Offer for *${offerData.candidateName}* approved — generating offer letter...`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *Approved by <@${approverId}>*\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}\n\nGenerating offer letter and routing to DocuSign...` },
      }],
    });

    try {
      const { runDocPipeline } = require('../agents/agent2-docgen');
      await runDocPipeline({ offerData, client });
    } catch (err) {
      console.error('[AGENT2+] Pipeline error:', err);
      await client.chat.postMessage({
        channel: offerData.recruiterId,
        text: `⚠️ Offer was approved but document generation failed for *${offerData.candidateName}*. Error: ${err.message}`,
      });
    }
  });

  // ── Exec rejects → notify Blake ───────────────────────────────────────
  app.action('exec_reject_offer', async ({ ack, body, action, client }) => {
    await ack();

    const { offerData } = JSON.parse(action.value);
    const rejecterId   = body.user.id;

    console.log('[AGENT1] Exec rejected offer for', offerData.candidateName, 'by', rejecterId);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ Offer for *${offerData.candidateName}* rejected.`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `❌ *Rejected by <@${rejecterId}>*\n*Candidate:* ${offerData.candidateName}\n*Role:* ${offerData.role}` },
      }],
    });

    await client.chat.postMessage({
      channel: BLAKE_SLACK_USER_ID,
      text: `❌ The offer for *${offerData.candidateName}* (${offerData.role}) was rejected by <@${rejecterId}> in the exec approval channel.`,
    });
  });

  // ── View Signed Offer button — link opens client-side ─────────────────
  app.action('view_signed_offer', async ({ ack }) => {
    await ack();
  });
}

module.exports = { registerSlackHandlers };
