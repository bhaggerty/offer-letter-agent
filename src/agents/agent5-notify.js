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

  // ── 3. Notify the recruiter ───────────────────────────────────────────
  await notifyRecruiter({ offerData, driveLink });
}

/**
 * Download the combined signed PDF from a completed DocuSign envelope.
 */
async function downloadSignedPdf(envelopeId) {
  const apiClient = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const pdfStream = await envelopesApi.getDocument(
    process.env.DOCUSIGN_ACCOUNT_ID,
    envelopeId,
    'combined'
  );

  if (Buffer.isBuffer(pdfStream)) return pdfStream;
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

module.exports = { handleOfferSigned };
