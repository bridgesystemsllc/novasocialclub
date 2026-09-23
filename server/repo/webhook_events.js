'use strict';

async function findById(db, eventId) {
  const { rows } = await db.query(
    'SELECT * FROM stripe_webhook_events WHERE event_id = $1',
    [eventId]
  );
  return rows[0] || null;
}

async function record(db, eventId, type) {
  const { rows } = await db.query(`
    INSERT INTO stripe_webhook_events (event_id, type)
    VALUES ($1, $2)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING *
  `, [eventId, type]);
  return rows[0] || null;
}

async function listRecent(db, limit = 100) {
  const { rows } = await db.query(
    'SELECT * FROM stripe_webhook_events ORDER BY processed_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

async function countSince(db, sinceDate) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM stripe_webhook_events WHERE processed_at >= $1',
    [sinceDate]
  );
  return rows[0].n;
}

module.exports = { findById, record, listRecent, countSince };
