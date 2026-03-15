'use strict';

/**
 * State Store — DynamoDB
 *
 * Auto-provisioned table uses PK/SK key structure.
 * We use PK = "ENVELOPE" and SK = envelopeId
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

async function storeEnvelopeRecord(envelopeId, data) {
  await getClient().send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: 'ENVELOPE',
      SK: envelopeId,
      envelopeId,
      ...data,
      createdAt: new Date().toISOString(),
      status: data.status || 'sent',
    },
  }));
}

async function getEnvelopeRecord(envelopeId) {
  const res = await getClient().send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: 'ENVELOPE', SK: envelopeId },
  }));
  return res.Item || null;
}

async function updateEnvelopeStatus(envelopeId, status) {
  await getClient().send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: 'ENVELOPE', SK: envelopeId },
    UpdateExpression: 'SET #s = :s, updatedAt = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': status,
      ':u': new Date().toISOString(),
    },
  }));
}

async function listPendingEnvelopes() {
  const res = await getClient().send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#s = :sent AND PK = :pk',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':sent': 'sent', ':pk': 'ENVELOPE' },
  }));
  return res.Items || [];
}

module.exports = {
  storeEnvelopeRecord,
  getEnvelopeRecord,
  updateEnvelopeStatus,
  listPendingEnvelopes,
};
