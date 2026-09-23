'use strict';

async function createScheduled(db, { subject, bodyHtml, scheduledAtUtc, createdByAdminId = null }) {
  const { rows } = await db.query(
    `INSERT INTO newsletter_broadcasts (subject, body_html, scheduled_at, status, created_by_admin_id)
     VALUES ($1, $2, $3, 'scheduled', $4)
     RETURNING *`,
    [subject, bodyHtml, scheduledAtUtc, createdByAdminId]
  );
  return rows[0];
}

async function listRecent(db, limit = 50) {
  const { rows } = await db.query(
    `SELECT * FROM newsletter_broadcasts
     ORDER BY scheduled_at DESC NULLS LAST, id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function cancelIfScheduled(db, id) {
  const { rows } = await db.query(
    `UPDATE newsletter_broadcasts
     SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND status = 'scheduled'
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function claimDue(db, now = new Date()) {
  const { rows } = await db.query(
    `UPDATE newsletter_broadcasts
     SET status = 'sending', updated_at = now()
     WHERE id = (
       SELECT id FROM newsletter_broadcasts
       WHERE status = 'scheduled' AND scheduled_at <= $1
       ORDER BY scheduled_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [now]
  );
  return rows[0] || null;
}

async function markSent(db, id) {
  const { rows } = await db.query(
    `UPDATE newsletter_broadcasts
     SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function markFailed(db, id, error) {
  const truncatedError = String(error || '').slice(0, 2000);
  const { rows } = await db.query(
    `UPDATE newsletter_broadcasts
     SET status = 'failed', error = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, truncatedError]
  );
  return rows[0] || null;
}

async function failStuckSending(db, olderThan) {
  const { rows } = await db.query(
    `UPDATE newsletter_broadcasts
     SET status = 'failed', error = 'Stuck in sending', updated_at = now()
     WHERE status = 'sending' AND updated_at < $1
     RETURNING *`,
    [olderThan]
  );
  return rows;
}

module.exports = {
  createScheduled,
  listRecent,
  cancelIfScheduled,
  claimDue,
  markSent,
  markFailed,
  failStuckSending
};
