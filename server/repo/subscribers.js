'use strict';

async function subscribe(db, email, token) {
  const { rows } = await db.query(
    `INSERT INTO newsletter_subscribers (email, unsubscribe_token)
     VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET status='subscribed', unsubscribed_at=NULL
     RETURNING *`, [email, token]);
  return rows[0];
}

async function list(db) { const { rows } = await db.query('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC'); return rows; }
async function getByToken(db, token) { const { rows } = await db.query('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token=$1', [token]); return rows[0] || null; }

async function unsubscribe(db, token) {
  const { rows } = await db.query(
    `UPDATE newsletter_subscribers SET status='unsubscribed', unsubscribed_at=now()
     WHERE unsubscribe_token=$1 RETURNING *`, [token]);
  return rows[0] || null;
}

async function activeEmails(db) { const { rows } = await db.query("SELECT email FROM newsletter_subscribers WHERE status='subscribed'"); return rows.map(r => r.email); }

async function activeSubscribers(db) {
  const { rows } = await db.query("SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE status='subscribed'");
  return rows;
}

module.exports = { subscribe, list, getByToken, unsubscribe, activeEmails, activeSubscribers };
