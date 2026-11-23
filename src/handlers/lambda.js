'use strict';

/**
 * Lambda handler — single function URL receives:
 *   POST /          → Slack events (modal submissions, block_actions)
 *   POST /docusign-webhook → DocuSign Connect envelope status events
 */

const { App, AwsLambdaReceiver } = require('@slack/bolt');
const { handleDocuSignWebhook } = require('../agents/agent4-monitor');
const { registerSlackHandlers } = require('./slack-handlers');
const { verifyDocuSignSignature } = require('../lib/webhook-auth');

let app;
let awsLambdaReceiver;

function getApp() {
  if (app) return { app, awsLambdaReceiver };

  awsLambdaReceiver = new AwsLambdaReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver: awsLambdaReceiver,
  });

  registerSlackHandlers(app);
  return { app, awsLambdaReceiver };
}

module.exports.handler = async (event, context) => {
  // DocuSign webhook arrives on a different path
  const path = event.rawPath || event.path || '';
  if (path.includes('docusign-webhook')) {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');
    if (!verifyDocuSignSignature(rawBody, event.headers)) {
      console.warn('[DOCUSIGN] Rejected webhook with missing/invalid HMAC signature');
      return { statusCode: 401, body: 'Unauthorized' };
    }
    return handleDocuSignWebhook({ ...event, body: rawBody.toString('utf8'), isBase64Encoded: false });
  }

  // Everything else is a Slack event
  const { awsLambdaReceiver } = getApp();
  const handler = await awsLambdaReceiver.start();
  return handler(event, context);
};
