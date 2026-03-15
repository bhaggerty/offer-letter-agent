'use strict';

/**
 * AGENT 3 — DocuSign Envelope Creation & Routing
 *
 * Signing order:
 *   1. Alex Bovee (company signatory) — signs first
 *   2. Candidate — signs second, after Alex
 *   3. Blake Haggerty — receives a copy (no signature required)
 *
 * Responsibilities:
 *  1. Authenticate with DocuSign via JWT grant
 *  2. Create an envelope from the PDF buffer
 *  3. Place signature/date anchor tabs for Alex and the candidate
 *  4. Add Blake as a CarbonCopy recipient
 *  5. Register a Connect webhook so Agent 4 gets notified on status changes
 *  6. Send the envelope
 */

const docusign = require('docusign-esign');
const { storeEnvelopeRecord } = require('../lib/state-store');

const DS_BASE_PATH   = process.env.DOCUSIGN_BASE_PATH;
const DS_ACCOUNT_ID  = process.env.DOCUSIGN_ACCOUNT_ID;
const DS_INT_KEY     = process.env.DOCUSIGN_INTEGRATION_KEY;
const DS_USER_ID     = process.env.DOCUSIGN_IMPERSONATED_USER_ID;
const DS_PRIVATE_KEY = (process.env.DOCUSIGN_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const DS_WEBHOOK_URL = process.env.DOCUSIGN_WEBHOOK_URL;

// Signer 1 — Alex Bovee
const ALEX_NAME  = process.env.DOCUSIGN_ALEX_NAME  || 'Alex Bovee';
const ALEX_EMAIL = process.env.DOCUSIGN_ALEX_EMAIL;

// CC — Blake Haggerty (receives copy, no signature)
const BLAKE_NAME  = process.env.DOCUSIGN_BLAKE_NAME  || 'Blake Haggerty';
const BLAKE_EMAIL = process.env.DOCUSIGN_BLAKE_EMAIL;

/**
 * Build a DocuSign API client authenticated via JWT.
 */
async function getApiClient() {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(DS_BASE_PATH);

  const response = await apiClient.requestJWTUserToken(
    DS_INT_KEY,
    DS_USER_ID,
    ['signature', 'impersonation'],
    Buffer.from(DS_PRIVATE_KEY),
    3600
  );

  apiClient.addDefaultHeader('Authorization', `Bearer ${response.body.access_token}`);
  return apiClient;
}

/**
 * Main: create DocuSign envelope, add recipients + tabs, send.
 */
async function createAndSendEnvelope({ offerData, pdfBuffer, folderId, pdfFileId, client }) {
  console.log('[AGENT3] Creating DocuSign envelope for', offerData.candidateName);

  const apiClient = await getApiClient();
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  // ── Document ──────────────────────────────────────────────────────────
  const document = docusign.Document.constructFromObject({
    documentBase64: pdfBuffer.toString('base64'),
    name: `Offer Letter — ${offerData.candidateName}`,
    fileExtension: 'pdf',
    documentId: '1',
  });

  // ── Signer 1: Alex Bovee (routing order 1) ───────────────────────────
  // Place \s1\ and \d1\ anchors in your offer template where Alex signs
  const alexSigner = docusign.Signer.constructFromObject({
    email: ALEX_EMAIL,
    name: ALEX_NAME,
    recipientId: '1',
    routingOrder: '1',
    tabs: docusign.Tabs.constructFromObject({
      signHereTabs: [
        docusign.SignHere.constructFromObject({
          anchorString: '\\s1\\',
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '0',
        }),
      ],
      dateSignedTabs: [
        docusign.DateSigned.constructFromObject({
          anchorString: '\\d1\\',
          anchorUnits: 'pixels',
        }),
      ],
      fullNameTabs: [
        docusign.FullName.constructFromObject({
          anchorString: '\\n1\\',
          anchorUnits: 'pixels',
        }),
      ],
      titleTabs: [
        docusign.Title.constructFromObject({
          anchorString: '\\t1\\',
          anchorUnits: 'pixels',
          value: 'CEO',
        }),
      ],
    }),
  });

  // ── Signer 2: Candidate (routing order 2 — after Alex signs) ─────────
  // Place \s2\, \d2\, \n2\ anchors in your template for the candidate
  const candidateSigner = docusign.Signer.constructFromObject({
    email: offerData.candidateEmail,
    name: offerData.candidateName,
    recipientId: '2',
    routingOrder: '2',
    tabs: docusign.Tabs.constructFromObject({
      signHereTabs: [
        docusign.SignHere.constructFromObject({
          anchorString: '\\s2\\',
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '0',
        }),
      ],
      dateSignedTabs: [
        docusign.DateSigned.constructFromObject({
          anchorString: '\\d2\\',
          anchorUnits: 'pixels',
        }),
      ],
      fullNameTabs: [
        docusign.FullName.constructFromObject({
          anchorString: '\\n2\\',
          anchorUnits: 'pixels',
        }),
      ],
    }),
  });

  // ── CC: Blake Haggerty (receives a copy after all signatures) ─────────
  // routingOrder 3 means DocuSign sends the completed copy to Blake
  // only after both Alex and the candidate have signed.
  const blakeCarbonCopy = docusign.CarbonCopy.constructFromObject({
    email: BLAKE_EMAIL,
    name: BLAKE_NAME,
    recipientId: '3',
    routingOrder: '3',
  });

  // ── EventNotification webhook so Agent 4 gets notified ───────────────
  const eventNotification = docusign.EventNotification.constructFromObject({
    url: DS_WEBHOOK_URL,
    loggingEnabled: 'true',
    requireAcknowledgment: 'true',
    useSoapInterface: 'false',
    includeCertificateWithSoap: 'false',
    signMessageWithX509Cert: 'false',
    includeDocuments: 'false',
    includeEnvelopeVoidReason: 'true',
    includeTimeZone: 'true',
    includeSenderAccountAsCustomField: 'true',
    includeDocumentFields: 'true',
    includeCertificateOfCompletion: 'false',
    envelopeEvents: [
      { envelopeEventStatusCode: 'completed' },
      { envelopeEventStatusCode: 'declined' },
      { envelopeEventStatusCode: 'voided' },
    ],
    recipientEvents: [
      { recipientEventStatusCode: 'Sent' },
      { recipientEventStatusCode: 'Delivered' },
      { recipientEventStatusCode: 'Completed' },
      { recipientEventStatusCode: 'Declined' },
      { recipientEventStatusCode: 'AuthenticationFailed' },
    ],
  });

  // ── Assemble and send ─────────────────────────────────────────────────
  const envelopeDefinition = docusign.EnvelopeDefinition.constructFromObject({
    emailSubject: `Please sign your offer letter — ${offerData.role} at [Company Name]`,
    emailBlurb: `Hi ${offerData.candidateName}, please review and sign your offer letter at your earliest convenience.`,
    documents: [document],
    recipients: docusign.Recipients.constructFromObject({
      signers: [alexSigner, candidateSigner],
      carbonCopies: [blakeCarbonCopy],
    }),
    eventNotification,
    // Store context in envelope custom fields for Agent 4/5 lookups
    customFields: docusign.CustomFields.constructFromObject({
      textCustomFields: [
        docusign.TextCustomField.constructFromObject({ name: 'recruiterId',    value: offerData.recruiterId,    required: 'false', show: 'false' }),
        docusign.TextCustomField.constructFromObject({ name: 'driveFolderId',  value: folderId,                 required: 'false', show: 'false' }),
        docusign.TextCustomField.constructFromObject({ name: 'drivePdfFileId', value: pdfFileId,                required: 'false', show: 'false' }),
        docusign.TextCustomField.constructFromObject({ name: 'candidateName',  value: offerData.candidateName,  required: 'false', show: 'false' }),
      ],
    }),
    status: 'sent',
  });

  const results = await envelopesApi.createEnvelope(DS_ACCOUNT_ID, { envelopeDefinition });
  const envelopeId = results.envelopeId;
  console.log('[AGENT3] Envelope sent, ID:', envelopeId);

  // Persist record for Agent 4/5
  await storeEnvelopeRecord(envelopeId, {
    offerData,
    folderId,
    pdfFileId,
    envelopeId,
    sentAt: new Date().toISOString(),
    status: 'sent',
  });

  // Notify recruiter
  await client.chat.postMessage({
    channel: offerData.recruiterId,
    text: `📨 Offer letter for *${offerData.candidateName}* (${offerData.role}) is in DocuSign.\n\n*Signing order:*\n1. ${ALEX_NAME} — signs first\n2. ${offerData.candidateName} — signs after Alex\n3. ${BLAKE_NAME} — receives a copy\n\nYou'll be notified here when everything is signed.`,
  });

  return envelopeId;
}

module.exports = { createAndSendEnvelope, getApiClient };

