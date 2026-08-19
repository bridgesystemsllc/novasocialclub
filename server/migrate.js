'use strict';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  profession TEXT,
  linkedin TEXT,
  area TEXT,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  membership_level TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  company TEXT,
  linkedin TEXT,
  membership_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  set_password_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'subscribed',
  unsubscribe_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS partner_inquiries (
  id SERIAL PRIMARY KEY,
  business TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  type TEXT NOT NULL,
  member_id INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS posh_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_url TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  venue_name TEXT,
  city TEXT,
  description TEXT,
  image_url TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function migrate(db) {
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) { await db.query(stmt); }
}

module.exports = { migrate, SCHEMA };

if (require.main === module) {
  (async () => {
    const { getDb, closeDb } = require('./db');
    const db = await getDb();
    await migrate(db);
    console.log('Migration complete.');
    await closeDb();
  })();
}
