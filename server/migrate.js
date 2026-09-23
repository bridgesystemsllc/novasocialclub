'use strict';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS membership_levels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  stripe_price_id TEXT,
  description TEXT,
  price_cents INTEGER,
  billing_interval TEXT NOT NULL DEFAULT 'month',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  membership_level_id INTEGER REFERENCES membership_levels(id),
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
  membership_level TEXT,
  membership_level_id INTEGER REFERENCES membership_levels(id),
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  set_password_token TEXT,
  token_expires_at TIMESTAMPTZ,
  reset_password_token TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
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
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL UNIQUE REFERENCES members(id),
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_broadcasts (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_by_admin_id INTEGER,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
CREATE TABLE IF NOT EXISTS event_ticket_sends (
  event_id TEXT NOT NULL REFERENCES posh_events(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, member_id)
);
`;

async function migrate(db) {
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) { await db.query(stmt); }
  
  // Add stripe_customer_id column if it doesn't exist (for existing databases)
  try {
    await db.query(`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE
    `);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }

  // Add reset_password_token columns for forgot-password flow (for existing databases)
  try {
    await db.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_password_token TEXT`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }
  try {
    await db.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }

  // Add membership_levels table for existing databases
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS membership_levels (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        active BOOLEAN NOT NULL DEFAULT true,
        sort_order INT NOT NULL DEFAULT 0,
        stripe_price_id TEXT,
        description TEXT,
        price_cents INTEGER,
        billing_interval TEXT NOT NULL DEFAULT 'month',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }

  // Add new membership_levels columns for existing databases
  try {
    await db.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS description TEXT`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }
  try {
    await db.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS price_cents INTEGER`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }
  try {
    await db.query(`ALTER TABLE membership_levels ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'month'`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }

  // Add membership_level_id columns for existing databases
  try {
    await db.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_level_id INTEGER REFERENCES membership_levels(id)`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }
  try {
    await db.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS membership_level_id INTEGER REFERENCES membership_levels(id)`);
  } catch (err) {
    if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
      throw err;
    }
  }

  // Seed the default Member level
  const { rows: existing } = await db.query(`SELECT id, price_cents FROM membership_levels WHERE slug = 'member'`);
  let memberLevelId;
  if (existing.length === 0) {
    const { rows } = await db.query(`
      INSERT INTO membership_levels (name, slug, active, sort_order, price_cents, billing_interval)
      VALUES ('Member', 'member', true, 0, 10000, 'month')
      RETURNING id
    `);
    memberLevelId = rows[0].id;
  } else {
    memberLevelId = existing[0].id;
    // Seed display price default for existing Member level if price_cents is null
    if (existing[0].price_cents === null) {
      await db.query(`UPDATE membership_levels SET price_cents = 10000, billing_interval = 'month' WHERE slug = 'member' AND price_cents IS NULL`);
    }
  }

  // Migrate legacy TEXT membership_level values to the seed Member level
  await db.query(`
    UPDATE members SET membership_level_id = $1
    WHERE membership_level_id IS NULL
  `, [memberLevelId]);

  await db.query(`
    UPDATE applications SET membership_level_id = $1
    WHERE membership_level_id IS NULL AND membership_level IS NOT NULL
  `, [memberLevelId]);

  // Add subscriptions table for existing databases
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL UNIQUE REFERENCES members(id),
        stripe_subscription_id TEXT UNIQUE,
        stripe_price_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'incomplete',
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }

  // Add stripe_webhook_events table for existing databases
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }

  // Add newsletter_broadcasts table for existing databases
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS newsletter_broadcasts (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        created_by_admin_id INTEGER,
        sent_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }

  // Add posh_events table for existing databases
  try {
    await db.query(`
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
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }

  // Add event_ticket_sends table for existing databases
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS event_ticket_sends (
        event_id TEXT NOT NULL REFERENCES posh_events(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, member_id)
      )
    `);
  } catch (err) {
    if (!err.message.includes('already exists')) {
      throw err;
    }
  }
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
