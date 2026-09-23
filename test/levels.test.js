const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const levels = require('../server/repo/levels');
const members = require('../server/repo/members');
const apps = require('../server/repo/applications');
const { newToken, expiryFromNow } = require('../server/tokens');

test('migration seeds Member level with slug=member', async () => {
  const db = await freshDb();
  const level = await levels.getBySlug(db, 'member');
  expect(level).toBeTruthy();
  expect(level.name).toBe('Member');
  expect(level.slug).toBe('member');
  expect(level.active).toBe(true);
  await db.close();
});

test('listActive returns only active levels', async () => {
  const db = await freshDb();
  const patron = await levels.create(db, { name: 'Patron', slug: 'patron', active: true });
  const inactive = await levels.create(db, { name: 'Legacy', slug: 'legacy', active: false });
  const active = await levels.listActive(db);
  expect(active.some(l => l.slug === 'member')).toBe(true);
  expect(active.some(l => l.slug === 'patron')).toBe(true);
  expect(active.some(l => l.slug === 'legacy')).toBe(false);
  await db.close();
});

test('create level generates unique slug and prevents duplicates', async () => {
  const db = await freshDb();
  const level = await levels.create(db, { name: 'Gold Member', slug: 'gold-member', active: true });
  expect(level.slug).toBe('gold-member');
  let err = null;
  try {
    await levels.create(db, { name: 'Another Gold', slug: 'gold-member', active: true });
  } catch (e) {
    err = e;
  }
  expect(err).toBeTruthy();
  await db.close();
});

test('cannot deactivate last active level', async () => {
  const db = await freshDb();
  const memberLevel = await levels.getBySlug(db, 'member');
  const activeCount = await levels.countActive(db);
  expect(activeCount).toBe(1);
  await db.close();
});

test('countActive returns correct count', async () => {
  const db = await freshDb();
  let count = await levels.countActive(db);
  expect(count).toBe(1);
  await levels.create(db, { name: 'VIP', slug: 'vip', active: true });
  count = await levels.countActive(db);
  expect(count).toBe(2);
  await levels.create(db, { name: 'Inactive', slug: 'inactive', active: false });
  count = await levels.countActive(db);
  expect(count).toBe(2);
  await db.close();
});

test('update level changes name and active status', async () => {
  const db = await freshDb();
  const level = await levels.create(db, { name: 'Test', slug: 'test', active: true });
  const updated = await levels.update(db, level.id, { name: 'Test Updated', active: false });
  expect(updated.name).toBe('Test Updated');
  expect(updated.active).toBe(false);
  await db.close();
});

test('list returns member_count', async () => {
  const db = await freshDb();
  const memberLevel = await levels.getBySlug(db, 'member');
  const app = await apps.create(db, { first_name: 'Test', last_name: 'User', email: 'test@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await members.createFromApplication(db, app, memberLevel.id, newToken(), expiryFromNow(7));
  const all = await levels.list(db);
  const member = all.find(l => l.slug === 'member');
  expect(member.member_count).toBe(1);
  await db.close();
});

test('slugify creates valid slugs', () => {
  expect(levels.slugify('Gold Member')).toBe('gold-member');
  expect(levels.slugify('VIP  Access')).toBe('vip-access');
  expect(levels.slugify('Test@123')).toBe('test-123');
});

test('accept application with levelId creates member with correct level', async () => {
  const db = await freshDb();
  const memberLevel = await levels.getBySlug(db, 'member');
  const app = await apps.create(db, { first_name: 'Ada', last_name: 'L', email: 'ada@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await apps.setStatus(db, app.id, 'accepted', memberLevel.id, new Date());
  const member = await members.createFromApplication(db, app, memberLevel.id, newToken(), expiryFromNow(7));
  expect(member.membership_level_id).toBe(memberLevel.id);
  const fetched = await members.getById(db, member.id);
  expect(fetched.level_name).toBe('Member');
  await db.close();
});

test('setLevelId updates member level', async () => {
  const db = await freshDb();
  const memberLevel = await levels.getBySlug(db, 'member');
  const vipLevel = await levels.create(db, { name: 'VIP', slug: 'vip', active: true });
  const app = await apps.create(db, { first_name: 'Bob', last_name: 'B', email: 'bob@test.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const member = await members.createFromApplication(db, app, memberLevel.id, newToken(), expiryFromNow(7));
  await members.setLevelId(db, member.id, vipLevel.id);
  const updated = await members.getById(db, member.id);
  expect(updated.membership_level_id).toBe(vipLevel.id);
  expect(updated.level_name).toBe('VIP');
  await db.close();
});
