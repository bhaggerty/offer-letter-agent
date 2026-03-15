'use strict';

/**
 * ECS/Local server — handles all incoming requests.
 * Run with: node src/handlers/local.js
 */

// Only load dotenv in local development — in ECS secrets are injected automatically
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) {}
}

const express = require('express');
const { App, ExpressReceiver } = require('@slack/bolt');
const { handleDocuSignWebhook } = require('../agents/agent4-monitor');
const { handleAshbyWebhook } = require('./ashby-webhook');
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

// Ashby webhook — GET for ping verification, POST for events
receiver.router.get('/ashby-webhook', (req, res) => {
  res.status(200).send('OK');
});
receiver.router.post('/ashby-webhook', express.json(), async (req, res) => {
  const fakeEvent = { body: JSON.stringify(req.body), rawPath: '/ashby-webhook', headers: req.headers };
  const result = await handleAshbyWebhook(fakeEvent);
  res.status(result.statusCode).send(result.body);
});

// DocuSign webhook — GET for ping verification, POST for events
receiver.router.get('/docusign-webhook', (req, res) => {
  res.status(200).send('OK');
});
receiver.router.post('/docusign-webhook', express.json(), async (req, res) => {
  const fakeEvent = { body: JSON.stringify(req.body), rawPath: '/docusign-webhook' };
  const result = await handleDocuSignWebhook(fakeEvent);
  res.status(result.statusCode).send(result.body);
});

(async () => {
  await app.start(process.env.PORT || 8080);
  console.log('⚡ Offer letter agent running on port', process.env.PORT || 8080);
  console.log('   Slack events:        http://localhost:8080/slack/events');
  console.log('   Ashby webhook:       http://localhost:8080/ashby-webhook');
  console.log('   DocuSign webhook:    http://localhost:8080/docusign-webhook');
})();
