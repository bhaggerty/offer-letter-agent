'use strict';

/**
 * State Store — DynamoDB
 *
 * Stores envelope → offer data mappings so Agent 4 and Agent 5
 * can look up context when DocuSign webhooks arrive.
 *
 * Table name: offer-letter-envelopes
 * Primary key: envelopeId (String)
 *
 * To create the table via CLI:
 *   aws dynamodb create-table \
 *     --table-name offer-letter-envelopes \
 *     --attribute-definitions AttributeName=envelopeId,AttributeType=S \
 *     --key-schema AttributeName=envelopeId,KeyType=HASH \
 *     --billing-mode PAY_PER_REQUEST
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.APP_DYNAMODB_TABLE_NAME || process.env.DYNAMODB_TABLE || 'offer-letter-envelopes';

let _client;
function getClient() {
  if (!_client) {
    const base = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    _client = DynamoDBDocumentClient.from(base);
  }
  return _client;
}

/**
 * Save a new envelope record.
 */
async function storeEnvelopeRecord(envelopeId, data) {
  await getClient().send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      envelopeId,
      ...data,
      createdAt: new Date().toISOString(),
      status: data.status || 'sent',
    },
  }));
}

/**
 * Retrieve an envelope record by ID.
 */
async function getEnvelopeRecord(envelopeId) {
  const res = await getClient().send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { envelopeId },
  }));
  return res.Item || null;
}

/**
 * Update the status field of an existing record.
 */
async function updateEnvelopeStatus(envelopeId, status) {
  await getClient().send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { envelopeId },
    UpdateExpression: 'SET #s = :s, updatedAt = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': status,
      ':u': new Date().toISOString(),
    },
  }));
}

/**
 * List all envelope records still in "sent" state (for reminder checks).
 */
async function listPendingEnvelopes() {
  const res = await getClient().send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#s = :sent',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':sent': 'sent' },
  }));
  return res.Items || [];
}

module.exports = {
  storeEnvelopeRecord,
  getEnvelopeRecord,
  updateEnvelopeStatus,
  listPendingEnvelopes,
};
