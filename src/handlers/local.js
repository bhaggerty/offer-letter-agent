'use strict';

/**
 * ECS server — handles all incoming requests.
 * Run with: node src/handlers/local.js
 * Secrets are injected as environment variables by ECS at runtime.
 */

const express = require('express');
const { App, ExpressReceiver } = require('@slack/bolt');
const { handleDocuSignWebhook } = require('../agents/agent4-monitor');
const { handleAshbyWebhook } = require('./ashby-webhook');
const { registerSlackHandlers } = require('./slack-handlers');
const { verifyAshbySignature, verifyDocuSignSignature } = require('../lib/webhook-auth');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

registerSlackHandlers(app);

// Ashby webhook — GET for ping, POST for events
receiver.router.get('/ashby-webhook', (req, res) => {
  res.status(200).send('OK');
});
// Raw body is required: the HMAC is computed over the exact bytes Ashby sent.
receiver.router.post('/ashby-webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!verifyAshbySignature(req.body, req.headers)) {
    console.warn('[ASHBY] Rejected webhook with missing/invalid signature');
    return res.status(401).send('Unauthorized');
  }
  try {
    const fakeEvent = { body: req.body.toString('utf8'), rawPath: '/ashby-webhook', headers: req.headers };
    const result = await handleAshbyWebhook(fakeEvent);
    res.status(result.statusCode).send(result.body);
  } catch (err) {
    console.error('[ASHBY] Handler error:', err.message);
    res.status(200).send('OK');
  }
});

// DocuSign webhook — use raw body to preserve payload
receiver.router.get('/docusign-webhook', (req, res) => {
  res.status(200).send('OK');
});
receiver.router.post('/docusign-webhook', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  if (!verifyDocuSignSignature(req.body, req.headers)) {
    console.warn('[DOCUSIGN] Rejected webhook with missing/invalid HMAC signature');
    return res.status(401).send('Unauthorized');
  }
  try {
    const rawBody = req.body.toString('utf8');
    console.log('[DOCUSIGN] Raw body received, length:', rawBody.length);
    const fakeEvent = { body: rawBody, rawPath: '/docusign-webhook' };
    const result = await handleDocuSignWebhook(fakeEvent);
    res.status(result.statusCode).send(result.body);
  } catch (err) {
    console.error('[DOCUSIGN] Handler error:', err.message);
    res.status(200).send('OK');
  }
});

(async () => {
  await app.start(process.env.PORT || 8080);
  console.log('⚡ Offer letter agent running on port', process.env.PORT || 8080);
  console.log('   Slack events:        http://localhost:8080/slack/events');
  console.log('   Ashby webhook:       http://localhost:8080/ashby-webhook');
  console.log('   DocuSign webhook:    http://localhost:8080/docusign-webhook');
})();
