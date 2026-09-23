'use strict';

async function create(db, v) {
  const { rows } = await db.query(
    `INSERT INTO applications
       (first_name,last_name,email,phone,company,profession,linkedin,area,why,age,live_va,work_va,industry,occupation,goals)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [v.first_name, v.last_name, v.email, v.phone, v.company, v.profession, v.linkedin, v.area, v.why, v.age, v.live_va, v.work_va, v.industry, v.occupation, v.goals]);
  return rows[0];
}

async function list(db, { status } = {}) {
  const baseQuery = `
    SELECT a.*, ml.name as level_name
    FROM applications a
    LEFT JOIN membership_levels ml ON a.membership_level_id = ml.id
  `;
  if (status) {
    const { rows } = await db.query(baseQuery + ' WHERE a.status=$1 ORDER BY a.created_at DESC', [status]);
    return rows;
  }
  const { rows } = await db.query(baseQuery + ' ORDER BY a.created_at DESC');
  return rows;
}

async function getById(db, id) {
  const { rows } = await db.query('SELECT * FROM applications WHERE id=$1', [id]);
  return rows[0] || null;
}

async function setStatus(db, id, status, levelId, reviewedAt) {
  const { rows } = await db.query(
    'UPDATE applications SET status=$2, membership_level_id=$3, reviewed_at=$4 WHERE id=$1 RETURNING *',
    [id, status, levelId, reviewedAt]);
  return rows[0];
}

async function addNote(db, id, note) {
  const { rows } = await db.query('UPDATE applications SET admin_notes=$2 WHERE id=$1 RETURNING *', [id, note]);
  return rows[0];
}

module.exports = { create, list, getById, setStatus, addNote };
