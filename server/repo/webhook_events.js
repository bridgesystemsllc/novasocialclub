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

module.exports = { findById, record };
