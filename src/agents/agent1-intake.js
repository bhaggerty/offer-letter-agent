'use strict';

/**
 * AGENT 1 — Intake & Two-Step Approval
 *
 * Flow:
 *  1. Ashby fires hire event
 *  2. Recruiter gets Slack form to fill in offer details
 *  3. Recruiter submits → Blake gets approval DM with option to add notes
 *  4. Blake approves (with optional notes) → private channel where Paul/Alex approve
 *  5. Paul or Alex approves → pipeline fires
 *  6. Any rejection → notify appropriate party
 */

const BLAKE_SLACK_USER_ID        = process.env.SLACK_BLAKE_USER_ID;
const RECRUITER_NOTIFY_CHANNEL   = process.env.SLACK_RECRUITER_NOTIFY_CHANNEL;
const EXEC_APPROVAL_CHANNEL      = process.env.SLACK_EXEC_APPROVAL_CHANNEL; // C0AM3NZDA81

/**
 * Entry point called by the Ashby webhook handler.
 * Sends the recruiter a form to fill in offer details.
 */
async function processFromAshby({ offerData, slack }) {
  console.log('[AGENT1] Processing Ashby hired event for', offerData.candidateName);

  const recruiterId = offerData.recruiterId || RECRUITER_NOTIFY_CHANNEL;

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
          text: `*${offerData.candidateName}* was just marked as Hired in Ashby for the *${offerData.role || 'Unknown Role'}* position.\n\nPlease fill in the offer details below and submit for approval.`,
        },
      },
      { type: 'divider' },
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
        block_id: 'role',
        label: { type: 'plain_text', text: 'Job Title' },
        element: { type: 'plain_text_input', action_id: 'input', initial_value: offerData.role || '', placeholder: { type: 'plain_text', text: 'e.g. Senior Software Engineer' } },
      },
      {
        type: 'input',
        block_id: 'start_date',
        label: { type: 'plain_text', text: 'Start Date' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. June 1, 2025' } },
      },
      {
        type: 'input',
        block_id: 'salary',
        label: { type: 'plain_text', text: 'Base Salary' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. $120,000/year' } },
      },
      {
        type: 'input',
        block_id: 'signing_bonus',
        label: { type: 'plain_text', text: 'Signing Bonus' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. $10,000 or N/A' } },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'equity',
        label: { type: 'plain_text', text: 'Equity / Shares' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. 10,000 options or N/A' } },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'reports_to',
        label: { type: 'plain_text', text: 'Reports To (Manager Name)' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. Jane Smith' } },
      },
      {
        type: 'input',
        block_id: 'work_location',
        label: { type: 'plain_text', text: 'Work Location' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. Remote, New York, NY' } },
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
        block_id: 'variable_comp',
        label: { type: 'plain_text', text: 'Variable Comp (Sales only)' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. $40,000/year — leave blank for standard offer' } },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'ramp_period',
        label: { type: 'plain_text', text: 'Ramp Period (Sales only)' },
        element: { type: 'plain_text_input', action_id: 'input', placeholder: { type: 'plain_text', text: 'e.g. 3 months — leave blank for standard offer' } },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'additional_notes',
        label: { type: 'plain_text', text: 'Additional Notes' },
        element: { type: 'plain_text_input', action_id: 'input', multiline: true, placeholder: { type: 'plain_text', text: 'Any additional notes...' } },
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
 * Step 2: Send to Blake for first approval with notes option.
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
        text: { type: 'plain_text', text: '📋 Offer Letter — Your Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName || 'N/A'}` },
          { type: 'mrkdwn', text: `*Email*\n${offerData.candidateEmail || 'N/A'}` },
          { type: 'mrkdwn', text: `*Role*\n${offerData.role || 'N/A'}` },
          { type: 'mrkdwn', text: `*Department*\n${offerData.department || 'N/A'}` },
          { type: 'mrkdwn', text: `*Start Date*\n${offerData.startDate || 'N/A'}` },
          { type: 'mrkdwn', text: `*Reports To*\n${offerData.reportsTo || 'N/A'}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Base Salary*\n${offerData.salary || 'N/A'}` },
          { type: 'mrkdwn', text: `*Signing Bonus*\n${offerData.signingBonus || 'N/A'}` },
          { type: 'mrkdwn', text: `*Equity*\n${offerData.equity || 'N/A'}` },
          { type: 'mrkdwn', text: `*Location*\n${offerData.workLocation || 'N/A'}` },
          { type: 'mrkdwn', text: `*Employment Type*\n${offerData.employmentType || 'Full-time'}` },
        ],
      },
      ...(offerData.additionalNotes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Recruiter Notes*\n${offerData.additionalNotes}` },
      }] : []),
      {
        type: 'input',
        block_id: 'blake_notes',
        label: { type: 'plain_text', text: 'Your Notes (optional)' },
        element: { type: 'plain_text_input', action_id: 'input', multiline: true, placeholder: { type: 'plain_text', text: 'Add any notes for Paul/Alex...' } },
        optional: true,
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Submitted by <@${offerData.recruiterId}> · ${new Date().toLocaleString()}_` }],
      },
      {
        type: 'actions',
        block_id: 'blake_approval_actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve & Send to Exec' },
            style: 'primary',
            action_id: 'blake_approve_offer',
            value: offerValueJson,
            confirm: {
              title: { type: 'plain_text', text: 'Approve this offer?' },
              text: { type: 'mrkdwn', text: `This will send the offer to the exec approval channel for final sign-off.` },
              confirm: { type: 'plain_text', text: 'Yes, approve' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            action_id: 'blake_reject_offer',
            value: rejectValueJson,
          },
        ],
      },
    ],
  });

  await client.chat.postMessage({
    channel: offerData.recruiterId,
    text: `👍 Offer details for *${offerData.candidateName}* have been sent to Blake for review. You'll be notified once it's fully approved.`,
  });
}

/**
 * Step 3: Send to exec channel (Paul/Alex) for final approval.
 */
async function routeToExecChannel({ offerData, blakeNotes, client }) {
  const offerWithNotes = { ...offerData, blakeNotes };
  const offerValueJson  = JSON.stringify(offerWithNotes);
  const rejectValueJson = JSON.stringify({ offerData: offerWithNotes });

  await client.chat.postMessage({
    channel: EXEC_APPROVAL_CHANNEL,
    text: `Exec approval required for offer — ${offerData.candidateName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 Offer Letter — Exec Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName || 'N/A'}` },
          { type: 'mrkdwn', text: `*Email*\n${offerData.candidateEmail || 'N/A'}` },
          { type: 'mrkdwn', text: `*Role*\n${offerData.role || 'N/A'}` },
          { type: 'mrkdwn', text: `*Department*\n${offerData.department || 'N/A'}` },
          { type: 'mrkdwn', text: `*Start Date*\n${offerData.startDate || 'N/A'}` },
          { type: 'mrkdwn', text: `*Reports To*\n${offerData.reportsTo || 'N/A'}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Base Salary*\n${offerData.salary || 'N/A'}` },
          { type: 'mrkdwn', text: `*Signing Bonus*\n${offerData.signingBonus || 'N/A'}` },
          { type: 'mrkdwn', text: `*Equity*\n${offerData.equity || 'N/A'}` },
          { type: 'mrkdwn', text: `*Location*\n${offerData.workLocation || 'N/A'}` },
          { type: 'mrkdwn', text: `*Employment Type*\n${offerData.employmentType || 'Full-time'}` },
        ],
      },
      ...(blakeNotes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes from Blake*\n${blakeNotes}` },
      }] : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_Approved by <@${BLAKE_SLACK_USER_ID}> · ${new Date().toLocaleString()}_` }],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve & Send Offer' },
            style: 'primary',
            action_id: 'exec_approve_offer',
            value: offerValueJson,
            confirm: {
              title: { type: 'plain_text', text: 'Approve this offer?' },
              text: { type: 'mrkdwn', text: `This will generate and send the offer letter to *${offerData.candidateName}* via DocuSign.` },
              confirm: { type: 'plain_text', text: 'Yes, approve' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            action_id: 'exec_reject_offer',
            value: rejectValueJson,
          },
        ],
      },
    ],
  });
}

module.exports = { processFromAshby, routeToBlakeForApproval, routeToExecChannel };
