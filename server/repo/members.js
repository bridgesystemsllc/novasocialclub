'use strict';

async function createFromApplication(db, app, level, token, expires) {
  const { rows } = await db.query(
    `INSERT INTO members
       (application_id,first_name,last_name,email,phone,company,linkedin,membership_level,set_password_token,token_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [app.id, app.first_name, app.last_name, app.email, app.phone, app.company, app.linkedin, level, token, expires]);
  return rows[0];
}

async function list(db, { q } = {}) {
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const { rows } = await db.query(
      `SELECT * FROM members
       WHERE lower(first_name) LIKE $1 OR lower(last_name) LIKE $1 OR lower(email) LIKE $1
       ORDER BY created_at DESC`, [like]);
    return rows;
  }
  const { rows } = await db.query('SELECT * FROM members ORDER BY created_at DESC');
  return rows;
}

async function getById(db, id) { const { rows } = await db.query('SELECT * FROM members WHERE id=$1', [id]); return rows[0] || null; }
async function getByEmail(db, email) { const { rows } = await db.query('SELECT * FROM members WHERE email=$1', [email]); return rows[0] || null; }
async function getBySetToken(db, token) { const { rows } = await db.query('SELECT * FROM members WHERE set_password_token=$1', [token]); return rows[0] || null; }

async function setPassword(db, id, hash) {
  const { rows } = await db.query(
    'UPDATE members SET password_hash=$2, set_password_token=NULL, token_expires_at=NULL WHERE id=$1 RETURNING *',
    [id, hash]);
  return rows[0];
}

async function setStatus(db, id, status) { const { rows } = await db.query('UPDATE members SET status=$2 WHERE id=$1 RETURNING *', [id, status]); return rows[0]; }
async function setLevel(db, id, level) { const { rows } = await db.query('UPDATE members SET membership_level=$2 WHERE id=$1 RETURNING *', [id, level]); return rows[0]; }
async function setSetToken(db, id, token, expires) { const { rows } = await db.query('UPDATE members SET set_password_token=$2, token_expires_at=$3 WHERE id=$1 RETURNING *', [id, token, expires]); return rows[0]; }
async function setStripeCustomerId(db, id, stripeCustomerId) { const { rows } = await db.query('UPDATE members SET stripe_customer_id=$2 WHERE id=$1 RETURNING *', [id, stripeCustomerId]); return rows[0]; }

module.exports = { createFromApplication, list, getById, getByEmail, getBySetToken, setPassword, setStatus, setLevel, setSetToken, setStripeCustomerId };
