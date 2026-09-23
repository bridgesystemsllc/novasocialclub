'use strict';

async function createFromApplication(db, app, levelId, token, expires) {
  const { rows } = await db.query(
    `INSERT INTO members
       (application_id,first_name,last_name,email,phone,company,linkedin,membership_level_id,set_password_token,token_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [app.id, app.first_name, app.last_name, app.email, app.phone, app.company, app.linkedin, levelId, token, expires]);
  return rows[0];
}

async function list(db, { q, status, level_id } = {}) {
  const baseQuery = `
    SELECT m.*, l.name as level_name, l.slug as level_slug
    FROM members m
    LEFT JOIN membership_levels l ON l.id = m.membership_level_id
  `;
  
  const conditions = [];
  const params = [];
  let idx = 1;

  if (q && typeof q === 'string') {
    const trimmed = q.slice(0, 200).trim();
    if (trimmed) {
      const like = `%${trimmed.toLowerCase()}%`;
      conditions.push(`(lower(m.first_name) LIKE $${idx} OR lower(m.last_name) LIKE $${idx} OR lower(m.email) LIKE $${idx})`);
      params.push(like);
      idx++;
    }
  }

  if (status === 'active' || status === 'inactive') {
    conditions.push(`m.status = $${idx}`);
    params.push(status);
    idx++;
  }

  if (level_id !== undefined && level_id !== '' && level_id !== null) {
    const levelIdNum = parseInt(level_id, 10);
    if (!isNaN(levelIdNum) && levelIdNum > 0) {
      conditions.push(`m.membership_level_id = $${idx}`);
      params.push(levelIdNum);
      idx++;
    }
  }

  let query = baseQuery;
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ` ORDER BY m.created_at DESC`;

  const { rows } = await db.query(query, params);
  return rows;
}

async function getById(db, id) {
  const { rows } = await db.query(`
    SELECT m.*, l.name as level_name, l.slug as level_slug
    FROM members m
    LEFT JOIN membership_levels l ON l.id = m.membership_level_id
    WHERE m.id = $1
  `, [id]);
  return rows[0] || null;
}

async function getByEmail(db, email) { const { rows } = await db.query('SELECT * FROM members WHERE email=$1', [email]); return rows[0] || null; }
async function getBySetToken(db, token) { const { rows } = await db.query('SELECT * FROM members WHERE set_password_token=$1', [token]); return rows[0] || null; }

async function setPassword(db, id, hash) {
  const { rows } = await db.query(
    'UPDATE members SET password_hash=$2, set_password_token=NULL, token_expires_at=NULL WHERE id=$1 RETURNING *',
    [id, hash]);
  return rows[0];
}

async function setStatus(db, id, status) { const { rows } = await db.query('UPDATE members SET status=$2 WHERE id=$1 RETURNING *', [id, status]); return rows[0]; }
async function setLevelId(db, id, levelId) { const { rows } = await db.query('UPDATE members SET membership_level_id=$2 WHERE id=$1 RETURNING *', [id, levelId]); return rows[0]; }
async function setSetToken(db, id, token, expires) { const { rows } = await db.query('UPDATE members SET set_password_token=$2, token_expires_at=$3 WHERE id=$1 RETURNING *', [id, token, expires]); return rows[0]; }
async function setStripeCustomerId(db, id, stripeCustomerId) { const { rows } = await db.query('UPDATE members SET stripe_customer_id=$2 WHERE id=$1 RETURNING *', [id, stripeCustomerId]); return rows[0]; }

async function getByStripeCustomerId(db, stripeCustomerId) {
  const { rows } = await db.query('SELECT * FROM members WHERE stripe_customer_id=$1', [stripeCustomerId]);
  return rows[0] || null;
}

module.exports = { createFromApplication, list, getById, getByEmail, getBySetToken, setPassword, setStatus, setLevelId, setSetToken, setStripeCustomerId, getByStripeCustomerId };
