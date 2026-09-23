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

module.exports = { upsertMany, listUpcoming };