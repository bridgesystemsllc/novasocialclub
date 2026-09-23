'use strict';

async function record(db, { to, subject, type, memberId = null, status, error = null }) {
  const { rows } = await db.query(
    'INSERT INTO email_log (to_email,subject,type,member_id,status,error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [to, subject, type, memberId, status, error]);
  return rows[0];
}

async function list(db, { type, status, q, page = 1, limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (type) {
    conditions.push(`e.type = $${idx++}`);
    params.push(type);
  }
  if (status) {
    conditions.push(`e.status = $${idx++}`);
    params.push(status);
  }
  if (q) {
    conditions.push(`e.to_email ILIKE $${idx++}`);
    params.push(`%${q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * limit;

  params.push(limit);
  params.push(offset);

  const { rows } = await db.query(
    `SELECT e.*, m.first_name, m.last_name 
     FROM email_log e 
     LEFT JOIN members m ON e.member_id = m.id 
     ${where} 
     ORDER BY e.sent_at DESC, e.id DESC 
     LIMIT $${idx++} OFFSET $${idx}`,
    params
  );
  return rows;
}

async function count(db, { type, status, q } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (type) {
    conditions.push(`type = $${idx++}`);
    params.push(type);
  }
  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (q) {
    conditions.push(`to_email ILIKE $${idx++}`);
    params.push(`%${q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT COUNT(*) as total FROM email_log ${where}`, params);
  return parseInt(rows[0].total, 10);
}

async function distinctTypes(db) {
  const { rows } = await db.query('SELECT DISTINCT type FROM email_log ORDER BY type');
  return rows.map(r => r.type);
}

async function distinctStatuses(db) {
  const { rows } = await db.query('SELECT DISTINCT status FROM email_log ORDER BY status');
  return rows.map(r => r.status);
}

module.exports = { record, list, count, distinctTypes, distinctStatuses };
