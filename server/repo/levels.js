'use strict';

async function list(db) {
  const { rows } = await db.query(`
    SELECT l.*, COUNT(m.id)::int as member_count
    FROM membership_levels l
    LEFT JOIN members m ON m.membership_level_id = l.id
    GROUP BY l.id
    ORDER BY l.sort_order ASC, l.name ASC
  `);
  return rows;
}

async function listActive(db) {
  const { rows } = await db.query(`
    SELECT * FROM membership_levels
    WHERE active = true
    ORDER BY sort_order ASC, name ASC
  `);
  return rows;
}

async function getById(db, id) {
  const { rows } = await db.query('SELECT * FROM membership_levels WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getBySlug(db, slug) {
  const { rows } = await db.query('SELECT * FROM membership_levels WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function create(db, { name, slug, active = true, sortOrder = 0 }) {
  const { rows } = await db.query(`
    INSERT INTO membership_levels (name, slug, active, sort_order)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [name, slug, active, sortOrder]);
  return rows[0];
}

async function update(db, id, { name, active, sortOrder }) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(active);
  }
  if (sortOrder !== undefined) {
    sets.push(`sort_order = $${idx++}`);
    vals.push(sortOrder);
  }
  sets.push(`updated_at = now()`);

  if (sets.length === 1) return getById(db, id);

  vals.push(id);
  const { rows } = await db.query(
    `UPDATE membership_levels SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );
  return rows[0];
}

async function countActive(db) {
  const { rows } = await db.query('SELECT COUNT(*)::int as count FROM membership_levels WHERE active = true');
  return rows[0].count;
}

async function countMembersWithLevel(db, levelId) {
  const { rows } = await db.query('SELECT COUNT(*)::int as count FROM members WHERE membership_level_id = $1', [levelId]);
  return rows[0].count;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { list, listActive, getById, getBySlug, create, update, countActive, countMembersWithLevel, slugify };
