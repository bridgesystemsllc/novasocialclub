'use strict';

const subsRepo = require('../repo/subscribers');
const broadcastsRepo = require('../repo/newsletterBroadcasts');
const email = require('../email');
const { config } = require('../config');

async function sendBroadcastToSubscribed(db, { subject, bodyHtml }) {
  const subscribers = await subsRepo.activeSubscribers(db);
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const s of subscribers) {
    attempted++;
    const unsub = `${config.appBaseUrl}/unsubscribe?token=${s.unsubscribe_token}`;
    const t = email.broadcastEmail(subject, bodyHtml, unsub);
    const result = await email.sendEmail(db, { to: s.email, subject: t.subject, html: t.html, type: 'broadcast' });
    if (result.ok) {
      sent++;
    } else {
      failed++;
    }
  }

  return { attempted, sent, failed };
}

async function processDueBroadcasts(db) {
  const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
  const olderThan = new Date(Date.now() - STUCK_THRESHOLD_MS);
  await broadcastsRepo.failStuckSending(db, olderThan);

  const broadcast = await broadcastsRepo.claimDue(db, new Date());
  if (!broadcast) return;

  try {
    const result = await sendBroadcastToSubscribed(db, {
      subject: broadcast.subject,
      bodyHtml: broadcast.body_html
    });

    if (result.attempted === 0 || result.sent > 0 || result.failed === 0) {
      await broadcastsRepo.markSent(db, broadcast.id);
    } else {
      await broadcastsRepo.markFailed(db, broadcast.id, `All ${result.failed} sends failed`);
    }
  } catch (err) {
    const errorMsg = String(err.message || err).slice(0, 2000);
    await broadcastsRepo.markFailed(db, broadcast.id, errorMsg);
  }
}

function startNewsletterBroadcastPoller(getDb, { intervalMs = 60000 } = {}) {
  const intervalId = setInterval(async () => {
    try {
      const db = await getDb();
      await processDueBroadcasts(db);
    } catch (err) {
      console.error('[newsletterBroadcastPoller] Error:', err);
    }
  }, intervalMs);

  return intervalId;
}

module.exports = {
  sendBroadcastToSubscribed,
  startNewsletterBroadcastPoller
};
