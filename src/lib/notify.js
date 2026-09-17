'use strict';

/**
 * Shared stakeholder notifications — every stage-change DM goes to both the
 * recruiter (offerData.recruiterId) and Amy (SLACK_AMY_USER_ID) so neither
 * gets missed as the offer moves through the pipeline.
 */

const SLACK_AMY_USER_ID = process.env.SLACK_AMY_USER_ID;

async function notifyStakeholders({ client, offerData, text, blocks }) {
  const recipients = new Set();
  if (offerData?.recruiterId) recipients.add(offerData.recruiterId);
  if (SLACK_AMY_USER_ID) recipients.add(SLACK_AMY_USER_ID);

  await Promise.all(
    Array.from(recipients).map((channel) =>
      client.chat.postMessage({
        channel,
        text,
        ...(blocks ? { blocks } : {}),
      })
    )
  );
}

module.exports = { notifyStakeholders };
