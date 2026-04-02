'use strict';

/**
 * AGENT 5 — Notify & Archive
 *
 * Called by Agent 4 when DocuSign status = "completed". Responsibilities:
 *  1. Download the completed/signed PDF from DocuSign
 *  2. Save it back to the candidate's Google Drive folder via Apps Script
 *  3. Slack the recruiter with confirmation + Drive link
 */

const axios = require('axios');
const { WebClient } = require('@slack/web-api');
const { getApiClient } = require('./agent3-docusign');
const docusign = require('docusign-esign');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

async function handleOfferSigned({ record, envelopeId }) {
  const { offerData, folderId } = record;
  console.log('[AGENT5] Offer signed for', offerData.candidateName, '— archiving');

  // ── 1. Download signed PDF from DocuSign ─────────────────────────────
  const signedPdfBuffer = await downloadSignedPdf(envelopeId);
  console.log('[AGENT5] Downloaded signed PDF, bytes:', signedPdfBuffer.length);

  // ── 2. Upload signed PDF to Drive via Apps Script ─────────────────────
  const driveLink = await uploadSignedPdfViaScrip({ offerData, folderId, signedPdfBuffer });
  console.log('[AGENT5] Signed PDF uploaded to Drive:', driveLink);

  // ── 3. Notify exec channel and recruiter ─────────────────────────────
  if (offerData.execChannel) {
    await slack.chat.postMessage({
      channel: offerData.execChannel,
      text: `🎉 *${offerData.candidateName}* — offer letter fully signed and archived to Drive.`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `🎉 *${offerData.candidateName}* (${offerData.role}) — offer letter fully signed and archived.` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '📄 View Signed Offer' },
            url: driveLink,
            action_id: 'view_signed_offer',
          },
        },
      ],
    });
  }
  await notifyRecruiter({ offerData, driveLink });
  await notifyOnboarding({ offerData });
}

/**
 * Download the combined signed PDF from a completed DocuSign envelope.
 */
async function downloadSignedPdf(envelopeId) {
  const apiClient = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  // '1' downloads just the signed offer letter without the certificate of completion
  const pdfStream = await envelopesApi.getDocument(
    process.env.DOCUSIGN_ACCOUNT_ID,
    envelopeId,
    '1'
  );

  // DocuSign returns a string of binary data — convert correctly
  if (Buffer.isBuffer(pdfStream)) return pdfStream;
  if (typeof pdfStream === 'string') return Buffer.from(pdfStream, 'binary');
  return Buffer.from(pdfStream);
}

/**
 * Upload the signed PDF back to the candidate's Drive folder via Apps Script.
 * Returns the Drive web view link.
 */
async function uploadSignedPdfViaScrip({ offerData, folderId, signedPdfBuffer }) {
  const response = await axios.post(APPS_SCRIPT_URL, {
    secretKey:   APPS_SCRIPT_SECRET,
    action:      'uploadSignedPdf',
    folderId,
    fileName:    `Offer Letter - ${offerData.candidateName} (SIGNED).pdf`,
    pdfBase64:   signedPdfBuffer.toString('base64'),
  }, {
    headers: { 'Content-Type': 'application/json' },
    maxRedirects: 5,
    timeout: 30000,
  });

  if (!response.data.success) {
    throw new Error(`Apps Script upload error: ${response.data.error}`);
  }

  return response.data.fileUrl;
}

/**
 * Send the recruiter a Slack DM with confirmation and Drive link.
 */
async function notifyRecruiter({ offerData, driveLink }) {
  await slack.chat.postMessage({
    channel: offerData.recruiterId,
    text: `🎉 Offer fully signed!`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🎉 Offer Letter Fully Signed!' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName}` },
          { type: 'mrkdwn', text: `*Role*\n${offerData.role}` },
          { type: 'mrkdwn', text: `*Start Date*\n${offerData.startDate}` },
          { type: 'mrkdwn', text: `*Signed At*\n${new Date().toLocaleString()}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📄 View Signed Offer' },
            url: driveLink,
            action_id: 'view_signed_offer',
          },
        ],
      },
    ],
  });
}

const ONBOARDING_SLACK_USER_ID = 'U08SMNZA272';

/**
 * Notify the onboarding contact with full offer details and a prompt to start onboarding.
 */
async function notifyOnboarding({ offerData }) {
  const fields = [
    { type: 'mrkdwn', text: `*Candidate*\n${offerData.candidateName}` },
    { type: 'mrkdwn', text: `*Role*\n${offerData.role}` },
    { type: 'mrkdwn', text: `*Start Date*\n${offerData.startDate}` },
    { type: 'mrkdwn', text: `*Salary*\n${offerData.salary}` },
    { type: 'mrkdwn', text: `*Signing Bonus*\n${offerData.signingBonus || 'N/A'}` },
    { type: 'mrkdwn', text: `*Equity*\n${offerData.equity || 'N/A'}` },
    { type: 'mrkdwn', text: `*Reports To*\n${offerData.reportsTo}` },
    { type: 'mrkdwn', text: `*Work Location*\n${offerData.workLocation}` },
    { type: 'mrkdwn', text: `*Employment Type*\n${offerData.employmentType}` },
  ];

  if (offerData.variableComp) {
    fields.push({ type: 'mrkdwn', text: `*Variable Comp*\n${offerData.variableComp}` });
  }
  if (offerData.rampPeriod) {
    fields.push({ type: 'mrkdwn', text: `*Ramp Period*\n${offerData.rampPeriod}` });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ Offer Letter Fully Executed — Start Onboarding' },
    },
    {
      type: 'section',
      fields,
    },
  ];

  if (offerData.additionalNotes) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Additional Notes*\n${offerData.additionalNotes}` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: 'Please *Start Onboarding* for this candidate.' },
  });

  await slack.chat.postMessage({
    channel: ONBOARDING_SLACK_USER_ID,
    text: `✅ Offer letter fully executed for ${offerData.candidateName} — please Start Onboarding.`,
    blocks,
  });
}

module.exports = { handleOfferSigned };
