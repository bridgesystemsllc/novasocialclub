const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const { newToken, expiryFromNow } = require('../server/tokens');

test('membersRepo.list search filters by first name case-insensitive', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'Bob', last_name: 'Jones', email: 'bob@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { q: 'ALICE' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Alice');

  const rows2 = await membersRepo.list(db, { q: 'alice' });
  expect(rows2.length).toBe(1);
  expect(rows2[0].first_name).toBe('Alice');

  await db.close();
});

test('membersRepo.list search filters by last name case-insensitive', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'Bob', last_name: 'Jones', email: 'bob@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { q: 'JONES' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Bob');

  await db.close();
});

test('membersRepo.list search filters by email', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'Bob', last_name: 'Jones', email: 'bob@other.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { q: 'example.com' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Alice');

  await db.close();
});

test('membersRepo.list status filter works for active', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'ActiveAlice', last_name: 'A', email: 'active@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'InactiveBob', last_name: 'B', email: 'inactive@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  const m2 = await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));
  await membersRepo.setStatus(db, m2.id, 'inactive');

  const rows = await membersRepo.list(db, { status: 'active' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('ActiveAlice');

  await db.close();
});

test('membersRepo.list status filter works for inactive', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'ActiveAlice', last_name: 'A', email: 'active@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'InactiveBob', last_name: 'B', email: 'inactive@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  const m2 = await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));
  await membersRepo.setStatus(db, m2.id, 'inactive');

  const rows = await membersRepo.list(db, { status: 'inactive' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('InactiveBob');

  await db.close();
});

test('membersRepo.list no status filter returns all', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'ActiveAlice', last_name: 'A', email: 'active@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'InactiveBob', last_name: 'B', email: 'inactive@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  const m2 = await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));
  await membersRepo.setStatus(db, m2.id, 'inactive');

  const rows = await membersRepo.list(db, {});
  expect(rows.length).toBe(2);

  await db.close();
});

test('membersRepo.list level_id filter works', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const vipLevel = await levelsRepo.create(db, { name: 'VIP', slug: 'vip', active: true, sortOrder: 1 });
  
  const a1 = await appsRepo.create(db, { first_name: 'RegularMike', last_name: 'M', email: 'regular@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'VIPVictor', last_name: 'V', email: 'vip@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, memberLevel.id, newToken(), expiryFromNow(7));
  await membersRepo.createFromApplication(db, a2, vipLevel.id, newToken(), expiryFromNow(7));

  const memberRows = await membersRepo.list(db, { level_id: memberLevel.id });
  expect(memberRows.length).toBe(1);
  expect(memberRows[0].first_name).toBe('RegularMike');

  const vipRows = await membersRepo.list(db, { level_id: vipLevel.id });
  expect(vipRows.length).toBe(1);
  expect(vipRows[0].first_name).toBe('VIPVictor');

  await db.close();
});

test('membersRepo.list combined q + status + level_id filters work', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const vipLevel = await levelsRepo.create(db, { name: 'VIP', slug: 'vip', active: true, sortOrder: 1 });
  
  const a1 = await appsRepo.create(db, { first_name: 'ActiveMember', last_name: 'A', email: 'am@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'InactiveVIP', last_name: 'B', email: 'iv@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a3 = await appsRepo.create(db, { first_name: 'ActiveVIP', last_name: 'C', email: 'av@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, memberLevel.id, newToken(), expiryFromNow(7));
  const m2 = await membersRepo.createFromApplication(db, a2, vipLevel.id, newToken(), expiryFromNow(7));
  await membersRepo.setStatus(db, m2.id, 'inactive');
  await membersRepo.createFromApplication(db, a3, vipLevel.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { status: 'active', level_id: vipLevel.id });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('ActiveVIP');

  const rows2 = await membersRepo.list(db, { q: 'vip', status: 'inactive' });
  expect(rows2.length).toBe(1);
  expect(rows2[0].first_name).toBe('InactiveVIP');

  const rows3 = await membersRepo.list(db, { q: 'test.com', status: 'active', level_id: memberLevel.id });
  expect(rows3.length).toBe(1);
  expect(rows3[0].first_name).toBe('ActiveMember');

  await db.close();
});

test('membersRepo.list returns empty array when no matches', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'A', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { q: 'nonexistent' });
  expect(rows.length).toBe(0);

  await db.close();
});

test('membersRepo.list ignores invalid level_id (NaN)', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'A', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { level_id: 'invalid' });
  expect(rows.length).toBe(1);
  expect(rows[0].first_name).toBe('Alice');

  await db.close();
});

test('membersRepo.list returns empty for valid but non-existent level_id', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'A', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { level_id: 999999 });
  expect(rows.length).toBe(0);

  await db.close();
});

test('membersRepo.list ignores invalid status values', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'A', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const a2 = await appsRepo.create(db, { first_name: 'Bob', last_name: 'B', email: 'bob@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));
  const m2 = await membersRepo.createFromApplication(db, a2, level.id, newToken(), expiryFromNow(7));
  await membersRepo.setStatus(db, m2.id, 'inactive');

  const rows = await membersRepo.list(db, { status: 'bogus' });
  expect(rows.length).toBe(2);

  await db.close();
});

test('membersRepo.list q parameter is trimmed and limited to 200 chars', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, { q: '   alice   ' });
  expect(rows.length).toBe(1);

  const longQ = 'x'.repeat(300);
  const rows2 = await membersRepo.list(db, { q: longQ });
  expect(rows2.length).toBe(0);

  await db.close();
});

test('membersRepo.list includes level_name from join', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const a1 = await appsRepo.create(db, { first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await membersRepo.createFromApplication(db, a1, level.id, newToken(), expiryFromNow(7));

  const rows = await membersRepo.list(db, {});
  expect(rows.length).toBe(1);
  expect(rows[0].level_name).toBe('Member');
  expect(rows[0].level_slug).toBe('member');

  await db.close();
});
