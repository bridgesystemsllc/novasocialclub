'use strict';

async function upsertMany(db, events) {
  for (const event of events) {
    await db.query(
      `INSERT INTO posh_events
        (id, title, event_url, starts_at, venue_name, city, description, image_url, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (id) DO UPDATE SET
        title=EXCLUDED.title,
        event_url=EXCLUDED.event_url,
        starts_at=EXCLUDED.starts_at,
        venue_name=EXCLUDED.venue_name,
        city=EXCLUDED.city,
        description=EXCLUDED.description,
        image_url=EXCLUDED.image_url,
        last_seen_at=now()`,
      [
        event.id,
        event.title,
        event.eventUrl,
        event.startsAt,
        event.venueName,
        event.city,
        event.description,
        event.imageUrl,
      ]
    );
  }
}

async function listUpcoming(db, limit = 3) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query(
    `SELECT id, title, event_url, starts_at, venue_name, city, description, image_url
       FROM posh_events
      WHERE starts_at >= now()
        AND last_seen_at >= $1
      ORDER BY starts_at ASC
      LIMIT $2`,
    [cutoff, limit]
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    eventUrl: row.event_url,
    startsAt: row.starts_at,
    venueName: row.venue_name,
    city: row.city,
    description: row.description,
    imageUrl: row.image_url,
  }));
}

async function listUpcomingAdmin(db, limit = 50) {
  const { rows } = await db.query(
    `SELECT id, title, event_url, starts_at, venue_name, city, description, image_url, last_seen_at
       FROM posh_events
      WHERE starts_at >= now()
      ORDER BY starts_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    eventUrl: row.event_url,
    startsAt: row.starts_at,
    venueName: row.venue_name,
    city: row.city,
    description: row.description,
    imageUrl: row.image_url,
    lastSeenAt: row.last_seen_at,
  }));
}

async function getById(db, id) {
  const { rows } = await db.query(
    `SELECT id, title, event_url, starts_at, venue_name, city, description, image_url, last_seen_at
       FROM posh_events
      WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    eventUrl: row.event_url,
    startsAt: row.starts_at,
    venueName: row.venue_name,
    city: row.city,
    description: row.description,
    imageUrl: row.image_url,
    lastSeenAt: row.last_seen_at,
  };
}

async function listSendsForEvent(db, eventId, limit = 100) {
  const { rows } = await db.query(
    `SELECT ets.event_id, ets.member_id, ets.sent_at,
            m.first_name, m.last_name, m.email
       FROM event_ticket_sends ets
       JOIN members m ON m.id = ets.member_id
      WHERE ets.event_id = $1
      ORDER BY ets.sent_at DESC
      LIMIT $2`,
    [eventId, limit]
  );
  return rows;
}

async function getSend(db, eventId, memberId) {
  const { rows } = await db.query(
    `SELECT event_id, member_id, sent_at FROM event_ticket_sends
      WHERE event_id = $1 AND member_id = $2`,
    [eventId, memberId]
  );
  return rows[0] || null;
}

async function recordSend(db, eventId, memberId) {
  await db.query(
    `INSERT INTO event_ticket_sends (event_id, member_id, sent_at)
     VALUES ($1, $2, now())
     ON CONFLICT (event_id, member_id) DO UPDATE SET sent_at = now()`,
    [eventId, memberId]
  );
}

module.exports = { upsertMany, listUpcoming, listUpcomingAdmin, getById, listSendsForEvent, getSend, recordSend };