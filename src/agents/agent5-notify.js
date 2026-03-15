'use strict';

/**
 * AGENT 5 — Notify & Archive
 *
 * Called by Agent 4 when DocuSign status = "completed". Responsibilities:
 *  1. Download the completed/signed PDF from DocuSign
 *  2. Save it back to the candidate's Google Drive folder (signed copy)
 *  3. Slack the recruiter with confirmation + Drive link
 *  4. (Optional) Log the completed offer to a tracking sheet
 */

const { google } = require('googleapis');
const { WebClient } = require('@slack/web-api');
const { getApiClient } = require('./agent3-docusign');
const docusign = require('docusign-esign');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function handleOfferSigned({ record, envelopeId }) {
  const { offerData, folderId } = record;
  console.log('[AGENT5] Offer signed for', offerData.candidateName, '— archiving');

  // ── 1. Download signed PDF from DocuSign ─────────────────────────────
  const signedPdfBuffer = await downloadSignedPdf(envelopeId);
  console.log('[AGENT5] Downloaded signed PDF, bytes:', signedPdfBuffer.length);

  // ── 2. Upload signed PDF to Drive ────────────────────────────────────
  const driveLink = await uploadSignedPdfToDrive({ offerData, folderId, signedPdfBuffer });
  console.log('[AGENT5] Signed PDF uploaded to Drive:', driveLink);

  // ── 3. Notify the recruiter ───────────────────────────────────────────
  await notifyRecruiter({ offerData, driveLink });

  // ── 4. (Optional) Append a row to a tracking sheet ───────────────────
  await logToTrackingSheet({ offerData, envelopeId, driveLink });
}

/**
 * Download the combined/signed PDF from a completed DocuSign envelope.
 */
async function downloadSignedPdf(envelopeId) {
  const apiClient = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  // Get combined document (all docs merged, with certificate)
  const pdfStream = await envelopesApi.getDocument(
    process.env.DOCUSIGN_ACCOUNT_ID,
    envelopeId,
    'combined'
  );

  // docusign-esign returns a Buffer or readable in Node
  if (Buffer.isBuffer(pdfStream)) return pdfStream;

  // Convert string/array to buffer if needed
  return Buffer.from(pdfStream);
}

/**
 * Upload signed PDF to the candidate's existing Drive folder.
 * Returns the web view link.
 */
async function uploadSignedPdfToDrive({ offerData, folderId, signedPdfBuffer }) {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(signedPdfBuffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: `Offer Letter — ${offerData.candidateName} (SIGNED).pdf`,
      mimeType: 'application/pdf',
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id, webViewLink',
  });

  // Make the file readable by anyone with the link (adjust to your org's policy)
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'domain' },
  });

  return res.data.webViewLink;
}

/**
 * Send the recruiter a Slack notification with a link to the signed offer.
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

  // Also ping the general recruiting channel if configured
  if (process.env.SLACK_RECRUITER_NOTIFY_CHANNEL) {
    await slack.chat.postMessage({
      channel: process.env.SLACK_RECRUITER_NOTIFY_CHANNEL,
      text: `✅ *${offerData.candidateName}* has signed their offer for *${offerData.role}*! Start date: ${offerData.startDate} 🎉`,
    });
  }
}

/**
 * Append a row to a Google Sheet for offer tracking.
 * Requires GOOGLE_TRACKING_SHEET_ID env var. Silently skips if not configured.
 */
async function logToTrackingSheet({ offerData, envelopeId, driveLink }) {
  const sheetId = process.env.GOOGLE_TRACKING_SHEET_ID;
  if (!sheetId) return;

  try {
    const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: keyJson,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Offers!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toISOString(),
          offerData.candidateName,
          offerData.candidateEmail,
          offerData.role,
          offerData.department,
          offerData.startDate,
          offerData.salary,
          envelopeId,
          'Signed',
          driveLink,
        ]],
      },
    });
  } catch (err) {
    console.error('[AGENT5] Sheet logging failed (non-fatal):', err.message);
  }
}

module.exports = { handleOfferSigned };
