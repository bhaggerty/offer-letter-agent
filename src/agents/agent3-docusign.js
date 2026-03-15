'use strict';

/**
 * AGENT 3 — DocuSign Envelope Creation & Routing
 *
 * Responsibilities:
 *  1. Authenticate with DocuSign via JWT grant
 *  2. Create an envelope from the PDF buffer
 *  3. Place signature/date anchor tabs for both signers
 *  4. Set signing order: Blake (company) first, then candidate
 *  5. Register a Connect webhook so Agent 4 gets notified on status changes
 *  6. Send the envelope
 */

const docusign = require('docusign-esign');
const { storeEnvelopeRecord } = require('../lib/state-store');

const DS_BASE_PATH      = process.env.DOCUSIGN_BASE_PATH;
const DS_ACCOUNT_ID     = process.env.DOCUSIGN_ACCOUNT_ID;
const DS_INT_KEY        = process.env.DOCUSIGN_INTEGRATION_KEY;
const DS_USER_ID        = process.env.DOCUSIGN_IMPERSONATED_USER_ID;
const DS_PRIVATE_KEY    = (process.env.DOCUSIGN_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const DS_COMPANY_NAME   = process.env.DOCUSIGN_COMPANY_SIGNER_NAME;
const DS_COMPANY_EMAIL  = process.env.DOCUSIGN_COMPANY_SIGNER_EMAIL;
const DS_WEBHOOK_URL    = process.env.DOCUSIGN_WEBHOOK_URL;

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

  // ── Build the document ────────────────────────────────────────────────
  const document = docusign.Document.constructFromObject({
    documentBase64: pdfBuffer.toString('base64'),
    name: `Offer Letter — ${offerData.candidateName}`,
    fileExtension: 'pdf',
    documentId: '1',
  });

  // ── Signer 1: Blake (company signatory, signing order 1) ─────────────
  const companySigner = docusign.Signer.constructFromObject({
    email: DS_COMPANY_EMAIL,
    name: DS_COMPANY_NAME,
    recipientId: '1',
    routingOrder: '1',
    tabs: docusign.Tabs.constructFromObject({
      signHereTabs: [
        // Anchor tag — put \s1\ in your template PDF where Blake should sign
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
    }),
  });

  // ── Signer 2: Candidate (signing order 2, after Blake) ────────────────
  const candidateSigner = docusign.Signer.constructFromObject({
    email: offerData.candidateEmail,
    name: offerData.candidateName,
    recipientId: '2',
    routingOrder: '2',
    tabs: docusign.Tabs.constructFromObject({
      signHereTabs: [
        // Anchor tag — put \s2\ in your template PDF where the candidate signs
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

  // ── EventNotification (webhook) so Agent 4 is notified ───────────────
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

  // ── Assemble and send the envelope ───────────────────────────────────
  const envelopeDefinition = docusign.EnvelopeDefinition.constructFromObject({
    emailSubject: `Please sign your offer letter — ${offerData.role} at [Company Name]`,
    emailBlurb: `Hi ${offerData.candidateName}, please review and sign your offer letter at your earliest convenience.`,
    documents: [document],
    recipients: docusign.Recipients.constructFromObject({
      signers: [companySigner, candidateSigner],
    }),
    eventNotification,
    // Store recruiter ID in custom fields so we can notify them later
    customFields: docusign.CustomFields.constructFromObject({
      textCustomFields: [
        docusign.TextCustomField.constructFromObject({
          name: 'recruiterId',
          value: offerData.recruiterId,
          required: 'false',
          show: 'false',
        }),
        docusign.TextCustomField.constructFromObject({
          name: 'driveFolderId',
          value: folderId,
          required: 'false',
          show: 'false',
        }),
        docusign.TextCustomField.constructFromObject({
          name: 'drivePdfFileId',
          value: pdfFileId,
          required: 'false',
          show: 'false',
        }),
        docusign.TextCustomField.constructFromObject({
          name: 'candidateName',
          value: offerData.candidateName,
          required: 'false',
          show: 'false',
        }),
      ],
    }),
    status: 'sent',
  });

  const results = await envelopesApi.createEnvelope(DS_ACCOUNT_ID, {
    envelopeDefinition,
  });

  const envelopeId = results.envelopeId;
  console.log('[AGENT3] Envelope sent, ID:', envelopeId);

  // Persist envelope → offer mapping so Agent 4 can look it up
  await storeEnvelopeRecord(envelopeId, {
    offerData,
    folderId,
    pdfFileId,
    envelopeId,
    sentAt: new Date().toISOString(),
    status: 'sent',
  });

  // Notify recruiter the envelope is out
  await client.chat.postMessage({
    channel: offerData.recruiterId,
    text: `📨 Offer letter for *${offerData.candidateName}* (${offerData.role}) has been sent for signatures via DocuSign.\n\n*Signing order:*\n1. ${DS_COMPANY_NAME} (company signatory)\n2. ${offerData.candidateName} (candidate)\n\nYou'll be notified here when everything is signed.`,
  });

  return envelopeId;
}

module.exports = { createAndSendEnvelope, getApiClient };
