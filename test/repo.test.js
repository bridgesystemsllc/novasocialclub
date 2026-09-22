const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const apps = require('../server/repo/applications');
const members = require('../server/repo/members');
const levels = require('../server/repo/levels');
const subs = require('../server/repo/subscribers');
const { newToken, expiryFromNow } = require('../server/tokens');

test('application create + accept spawns member', async () => {
  const db = await freshDb();
  const memberLevel = await levels.getBySlug(db, 'member');
  const app = await apps.create(db, { first_name: 'Ada', last_name: 'L', email: 'ada@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  expect(app.status).toBe('pending');
  await apps.setStatus(db, app.id, 'accepted', memberLevel.id, new Date());
  const m = await members.createFromApplication(db, app, memberLevel.id, newToken(), expiryFromNow(7));
  expect(m.membership_level_id).toBe(memberLevel.id);
  expect(m.password_hash).toBeNull();
  await db.close();
});

test('subscribe is idempotent and re-subscribe reactivates', async () => {
  const db = await freshDb();
  await subs.subscribe(db, 'x@y.com', newToken());
  const row = await subs.subscribe(db, 'x@y.com', newToken());
  expect(row.status).toBe('subscribed');
  const emails = await subs.activeEmails(db);
  expect(emails).toContain('x@y.com');
  await db.close();
});
