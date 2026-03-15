'use strict';

/**
 * AGENT 2 — Document Generation
 *
 * Responsibilities:
 *  1. Copy the master offer template in Google Drive
 *  2. Create a private folder: /Offers/<FirstName LastName>/
 *  3. Fill the template via Google Apps Script (or Drive API find-replace)
 *  4. Export the filled doc as PDF, save into the candidate folder
 *  5. Hand the PDF buffer + metadata to Agent 3 (DocuSign)
 */

const { google } = require('googleapis');
const axios = require('axios');
const agent3 = require('./agent3-docusign');

/**
 * Main pipeline entry point called after Blake approves.
 */
async function runDocPipeline({ offerData, approverId, client }) {
  console.log('[AGENT2] Starting doc pipeline for', offerData.candidateName);

  const auth = await getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // ── 1. Create candidate folder ────────────────────────────────────────
  const folderName = `${offerData.candidateName}`;
  const folderId = await createCandidateFolder({ drive, folderName });
  console.log('[AGENT2] Folder created:', folderId);

  // ── 2. Copy the template into that folder ────────────────────────────
  const copiedDoc = await drive.files.copy({
    fileId: process.env.GOOGLE_OFFER_TEMPLATE_ID,
    requestBody: {
      name: `Offer Letter — ${offerData.candidateName}`,
      parents: [folderId],
    },
  });
  const docId = copiedDoc.data.id;
  console.log('[AGENT2] Template copied, docId:', docId);

  // ── 3. Fill placeholders via Docs API ────────────────────────────────
  await fillDocTemplate({ docs, docId, offerData });
  console.log('[AGENT2] Template filled');

  // ── 4. Export as PDF ──────────────────────────────────────────────────
  const pdfBuffer = await exportAsPdf({ drive, auth, docId });
  console.log('[AGENT2] PDF exported, size:', pdfBuffer.length);

  // ── 5. Save PDF to Drive folder ───────────────────────────────────────
  const pdfFileId = await savePdfToDrive({ drive, folderId, offerData, pdfBuffer });
  console.log('[AGENT2] PDF saved to Drive:', pdfFileId);

  // ── 6. Hand off to Agent 3 (DocuSign) ────────────────────────────────
  await agent3.createAndSendEnvelope({ offerData, pdfBuffer, folderId, pdfFileId, client });
}

/**
 * Build a Google Auth client using the service account JSON from env.
 */
async function getGoogleAuth() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
    ],
  });
  return auth;
}

/**
 * Create a subfolder under GOOGLE_OFFERS_FOLDER_ID named after the candidate.
 * Returns the new folder's ID.
 */
async function createCandidateFolder({ drive, folderName }) {
  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_OFFERS_FOLDER_ID],
    },
    fields: 'id',
  });
  return res.data.id;
}

/**
 * Replace all {{PLACEHOLDER}} tokens in the Google Doc using the batchUpdate API.
 * Extend the replacements map with all placeholders in your template.
 */
async function fillDocTemplate({ docs, docId, offerData }) {
  const replacements = {
    '{{CANDIDATE_NAME}}':   offerData.candidateName,
    '{{CANDIDATE_EMAIL}}':  offerData.candidateEmail,
    '{{ROLE_TITLE}}':       offerData.role,
    '{{DEPARTMENT}}':       offerData.department,
    '{{START_DATE}}':       offerData.startDate,
    '{{SALARY}}':           offerData.salary,
    '{{SIGNING_BONUS}}':    offerData.signingBonus,
    '{{EQUITY}}':           offerData.equity,
    '{{REPORTS_TO}}':       offerData.reportsTo,
    '{{WORK_LOCATION}}':    offerData.workLocation,
    '{{OFFER_DATE}}':       new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    '{{COMPANY_SIGNER}}':   process.env.DOCUSIGN_COMPANY_SIGNER_NAME,
  };

  const requests = Object.entries(replacements).map(([find, replace]) => ({
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace || '',
    },
  }));

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });
}

/**
 * Export a Google Doc as PDF bytes.
 */
async function exportAsPdf({ drive, auth, docId }) {
  const token = await auth.getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`;

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token.token}` },
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
}

/**
 * Upload the PDF buffer back into the candidate's Drive folder.
 */
async function savePdfToDrive({ drive, folderId, offerData, pdfBuffer }) {
  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(pdfBuffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: `Offer Letter — ${offerData.candidateName}.pdf`,
      mimeType: 'application/pdf',
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id',
  });

  return res.data.id;
}

module.exports = { runDocPipeline };
