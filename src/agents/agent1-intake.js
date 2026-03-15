'use strict';

/**
 * AGENT 1 — Intake & Approval
 *
 * Trigger: Ashby "candidateHire" webhook.
 *
 * Flow:
 *  1. Ashby fires hire event with basic candidate info
 *  2. DM the recruiter a Slack modal to fill in missing offer details
 *  3. Recruiter submits the form
 *  4. DM Blake with full offer details + Approve/Reject buttons
 *  5. Blake approves → fire Agent 2 (doc generation pipeline)
 *  6. Blake rejects → notify recruiter
 */

const BLAKE_SLACK_USER_ID      = process.env.SLACK_BLAKE_USER_ID;
const RECRUITER_NOTIFY_CHANNEL = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;

/**
 * Entry point called by the Ashby webhook handler.
 * Sends the recruiter a form to fill in offer details.
 */
async function processFromAshby({ offerData, slack }) {
  console.log('[AGENT1] Processing Ashby hired event for', offerData.candidateName);

  // Find the recruiter to DM — fall back to notify channel if no recruiter ID
  const recruiterId = offerData.recruiterId || RECRUITER_NOTIFY_CHANNEL;

  // Open a Slack modal / DM form for the recruiter to fill in offer details
  await slack.chat.postMessage({
    channel: recruiterId,
    text: `New hire detected — please fill in offer details for ${offerData.candidateName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 New Hire — Fill in Offer Details' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${offerData.candidateName}* was just marked as Hired in Ashby for the *${offerData.role || 'Unknown Role'}* position.\n\nPlease fill in the offer details below and submit for Blake's approval.`,
        },
      },
      { type: 'divider' },
      // Pre-filled read-only info
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName}` },
          { type: 'mrkdwn', text: `*Email*\n${offerData.candidateEmail || '_Not found in Ashby_'}` },
          { type: 'mrkdwn', text: `*Role*\n${offerData.role || '_Not found in Ashby_'}` },
          { type: 'mrkdwn', text: `*Department*\n${offerData.department || '_Not found in Ashby_'}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'start_date',
        label: { type: 'plain_text', text: 'Start Date' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. June 1, 2025' },
        },
      },
      {
        type: 'input',
        block_id: 'salary',
        label: { type: 'plain_text', text: 'Base Salary' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. $120,000/year' },
        },
      },
      {
        type: 'input',
        block_id: 'signing_bonus',
        label: { type: 'plain_text', text: 'Signing Bonus' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. $10,000 or N/A' },
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'equity',
        label: { type: 'plain_text', text: 'Equity / Shares' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. 10,000 options or N/A' },
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'reports_to',
        label: { type: 'plain_text', text: 'Reports To (Manager Name)' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. Jane Smith' },
        },
      },
      {
        type: 'input',
        block_id: 'work_location',
        label: { type: 'plain_text', text: 'Work Location' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          placeholder: { type: 'plain_text', text: 'e.g. Remote, New York, NY' },
        },
      },
      {
        type: 'input',
        block_id: 'employment_type',
        label: { type: 'plain_text', text: 'Employment Type' },
        element: {
          type: 'static_select',
          action_id: 'input',
          initial_option: { text: { type: 'plain_text', text: 'Full-time' }, value: 'Full-time' },
          options: [
            { text: { type: 'plain_text', text: 'Full-time' }, value: 'Full-time' },
            { text: { type: 'plain_text', text: 'Part-time' }, value: 'Part-time' },
            { text: { type: 'plain_text', text: 'Contract' }, value: 'Contract' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'additional_notes',
        label: { type: 'plain_text', text: 'Additional Notes' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Any additional notes for the offer letter...' },
        },
        optional: true,
      },
      { type: 'divider' },
      {
        type: 'actions',
        block_id: 'offer_form_submit',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📤 Submit for Approval' },
            style: 'primary',
            action_id: 'submit_offer_form',
            value: JSON.stringify({
              candidateName:  offerData.candidateName,
              candidateEmail: offerData.candidateEmail,
              role:           offerData.role,
              department:     offerData.department,
              recruiterId,
            }),
          },
        ],
      },
    ],
  });

  console.log('[AGENT1] Offer details form sent to recruiter:', recruiterId);
}

/**
 * Called when recruiter submits the offer details form.
 * Sends Blake the full offer for approval.
 */
async function routeToBlakeForApproval({ offerData, client }) {
  const offerValueJson  = JSON.stringify(offerData);
  const rejectValueJson = JSON.stringify({ offerData });

  await client.chat.postMessage({
    channel: BLAKE_SLACK_USER_ID,
    text: `Offer approval required for ${offerData.candidateName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 Offer Letter Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName}` },
          { type: 'mrkdwn', text: `*Email*\n${offerData.candidateEmail}` },
          { type: 'mrkdwn', text: `*Role*\n${offerData.role}` },
          { type: 'mrkdwn', text: `*Department*\n${offerData.department}` },
          { type: 'mrkdwn', text: `*Start Date*\n${offerData.startDate}` },
          { type: 'mrkdwn', text: `*Reports To*\n${offerData.reportsTo}` },
          { type: 'mrkdwn', text: `*Base Salary*\n${offerData.salary}` },
          { type: 'mrkdwn', text: `*Signing Bonus*\n${offerData.signingBonus || 'N/A'}` },
          { type: 'mrkdwn', text: `*Equity*\n${offerData.equity || 'N/A'}` },
          { type: 'mrkdwn', text: `*Location*\n${offerData.workLocation}` },
          { type: 'mrkdwn', text: `*Employment Type*\n${offerData.employmentType}` },
        ],
      },
      ...(offerData.additionalNotes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes*\n${offerData.additionalNotes}` },
      }] : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Submitted by <@${offerData.recruiterId}> · ${new Date().toLocaleString()}_` }],
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
              text: { type: 'mrkdwn', text: `This will generate the offer letter and send it to *${offerData.candidateName}* via DocuSign.` },
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

  // Confirm to recruiter
  await client.chat.postMessage({
    channel: offerData.recruiterId,
    text: `👍 Offer details for *${offerData.candidateName}* have been sent to Blake for approval. You'll be notified once it's processed.`,
  });
}

module.exports = { processFromAshby, routeToBlakeForApproval };
