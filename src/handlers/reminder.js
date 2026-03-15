'use strict';

const { handleReminderCheck } = require('../agents/agent4-monitor');

module.exports.handler = async () => {
  console.log('[REMINDER] Running daily reminder check');
  await handleReminderCheck();
  console.log('[REMINDER] Done');
};
