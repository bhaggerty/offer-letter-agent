'use strict';

/**
 * AGENT 2 — Document Generation
 *
 * Calls the Google Apps Script web app to:
 *  1. Copy the offer letter template
 *  2. Create a candidate folder in the private Drive directory
 *  3. Fill all placeholders with offer data
 *  4. Export as PDF and save to the candidate folder
 *
 * Then hands the PDF off to Agent 3 (DocuSign).
 */

const axios   = require('axios');
const agent3  = require('./agent3-docusign');

const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

/**
 * Post a status update to the exec channel (and optionally the recruiter).
 */
async function postExecStatus({ client, offerData, text }) {
  if (offerData.execChannel) {
    await client.chat.postMessage({
      channel: offerData.execChannel,
      text,
    });
  }
}

/**
 * Main pipeline entry point — called after exec approves.
 */
async function runDocPipeline({ offerData, client }) {
  console.log('[AGENT2] Calling Apps Script for', offerData.candidateName);

  // Let the exec channel know we're generating the doc
  await postExecStatus({
    client,
    offerData,
    text: `📄 *${offerData.candidateName}* — Generating offer letter...`,
  });

  // Split candidate name into first/last for the script
  const nameParts = offerData.candidateName.trim().split(' ');
  const firstName = nameParts[0];
  const lastName  = nameParts.slice(1).join(' ');

  // ── Call the Apps Script web app ──────────────────────────────────────
  let scriptResult;
  try {
    const response = await axios.post(APPS_SCRIPT_URL, {
      secretKey:      APPS_SCRIPT_SECRET,
      firstName,
      lastName,
      candidateEmail: offerData.candidateEmail,
      jobTitle:       offerData.role,
      department:     offerData.department,
      managerName:    offerData.reportsTo,
      startDate:      offerData.startDate,
      baseSalary:     offerData.salary,
      signingBonus:   offerData.signingBonus,
      equity:         offerData.equity,
      employmentType: offerData.employmentType || 'Full-time',
      workLocation:   offerData.workLocation,
      variableComp:   offerData.variableComp || '',
      rampPeriod:     offerData.rampPeriod || '',
    }, {
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 5,
      timeout: 90000,
    });

    scriptResult = response.data;
  } catch (err) {
    console.error('[AGENT2] Apps Script call failed:', err.message);
    await postExecStatus({
      client,
      offerData,
      text: `⚠️ *${offerData.candidateName}* — Document generation failed: ${err.message}`,
    });
    throw new Error(`Document generation failed: ${err.message}`);
  }

  if (!scriptResult.success) {
    await postExecStatus({
      client,
      offerData,
      text: `⚠️ *${offerData.candidateName}* — Apps Script error: ${scriptResult.error}`,
    });
    throw new Error(`Apps Script error: ${scriptResult.error}`);
  }

  console.log('[AGENT2] Apps Script success, docId:', scriptResult.docId);

  await postExecStatus({
    client,
    offerData,
    text: `✅ *${offerData.candidateName}* — Offer letter generated. Sending to DocuSign...`,
  });

  // ── Convert base64 PDF back to a Buffer for DocuSign ─────────────────
  const pdfBuffer = Buffer.from(scriptResult.pdfBase64, 'base64');

  // ── Hand off to Agent 3 (DocuSign) ───────────────────────────────────
  await agent3.createAndSendEnvelope({
    offerData,
    pdfBuffer,
    folderId:  scriptResult.folderId,
    pdfFileId: scriptResult.pdfId,
    client,
  });
}

module.exports = { runDocPipeline };
