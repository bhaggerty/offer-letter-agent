'use strict';

/**
 * Local development server — mirrors the Lambda handler using express.
 * Run with: node src/handlers/local.js
 */

require('dotenv').config();

const express = require('express');
const { App, ExpressReceiver } = require('@slack/bolt');
const { handleDocuSignWebhook } = require('../agents/agent4-monitor');
const { registerSlackHandlers } = require('./slack-handlers');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

registerSlackHandlers(app);

// DocuSign webhook route (separate path)
receiver.router.post('/docusign-webhook', express.json(), async (req, res) => {
  const fakeEvent = { body: JSON.stringify(req.body), rawPath: '/docusign-webhook' };
  const result = await handleDocuSignWebhook(fakeEvent);
  res.status(result.statusCode).send(result.body);
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡ Offer letter agent running on port', process.env.PORT || 3000);
  console.log('   Slack events:       http://localhost:3000/slack/events');
  console.log('   DocuSign webhook:   http://localhost:3000/docusign-webhook');
  console.log('   Use ngrok to expose for Slack + DocuSign Connect configuration');
})();
