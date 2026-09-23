const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const emailLogRepo = require('../server/repo/emailLog');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const { newToken, expiryFromNow } = require('../server/tokens');

test('emailLogRepo.record creates entry', async () => {
  const db = await freshDb();
  const row = await emailLogRepo.record(db, {
    to: 'test@example.com',
    subject: 'Welcome',
    type: 'welcome_set_password',
    memberId: null,
    status: 'sent'
  });
  expect(row.to_email).toBe('test@example.com');
  expect(row.subject).toBe('Welcome');
  expect(row.type).toBe('welcome_set_password');
  expect(row.status).toBe('sent');
  await db.close();
});

test('emailLogRepo.list returns rows ordered by sent_at DESC, id DESC', async () => {
  const db = await freshDb();
  const first = await emailLogRepo.record(db, { to: 'first@test.com', subject: 'First', type: 'test', status: 'sent' });
  const second = await emailLogRepo.record(db, { to: 'second@test.com', subject: 'Second', type: 'test', status: 'sent' });
  const third = await emailLogRepo.record(db, { to: 'third@test.com', subject: 'Third', type: 'test', status: 'sent' });

  const rows = await emailLogRepo.list(db, {});
  expect(rows.length).toBe(3);
  expect(rows[0].id).toBe(third.id);
  expect(rows[1].id).toBe(second.id);
  expect(rows[2].id).toBe(first.id);
  await db.close();
});

test('emailLogRepo.list filters by type', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'welcome_set_password', status: 'sent' });
  await emailLogRepo.record(db, { to: 'b@test.com', subject: 'B', type: 'rejection', status: 'sent' });
  await emailLogRepo.record(db, { to: 'c@test.com', subject: 'C', type: 'welcome_set_password', status: 'sent' });

  const rows = await emailLogRepo.list(db, { type: 'rejection' });
  expect(rows.length).toBe(1);
  expect(rows[0].to_email).toBe('b@test.com');
  await db.close();
});

test('emailLogRepo.list filters by status', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'test', status: 'sent' });
  await emailLogRepo.record(db, { to: 'b@test.com', subject: 'B', type: 'test', status: 'failed', error: 'timeout' });
  await emailLogRepo.record(db, { to: 'c@test.com', subject: 'C', type: 'test', status: 'sent' });

  const rows = await emailLogRepo.list(db, { status: 'failed' });
  expect(rows.length).toBe(1);
  expect(rows[0].to_email).toBe('b@test.com');
  expect(rows[0].error).toBe('timeout');
  await db.close();
});

test('emailLogRepo.list filters by q (ILIKE to_email)', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'alice@example.com', subject: 'A', type: 'test', status: 'sent' });
  await emailLogRepo.record(db, { to: 'bob@other.com', subject: 'B', type: 'test', status: 'sent' });
  await emailLogRepo.record(db, { to: 'charlie@example.com', subject: 'C', type: 'test', status: 'sent' });

  const rows = await emailLogRepo.list(db, { q: 'example.com' });
  expect(rows.length).toBe(2);
  expect(rows.every(r => r.to_email.includes('example.com'))).toBe(true);

  const rows2 = await emailLogRepo.list(db, { q: 'ALICE' });
  expect(rows2.length).toBe(1);
  expect(rows2[0].to_email).toBe('alice@example.com');
  await db.close();
});

test('emailLogRepo.list combined filters work', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'alice@test.com', subject: 'A', type: 'welcome', status: 'sent' });
  await emailLogRepo.record(db, { to: 'alice@test.com', subject: 'B', type: 'welcome', status: 'failed' });
  await emailLogRepo.record(db, { to: 'bob@test.com', subject: 'C', type: 'rejection', status: 'sent' });

  const rows = await emailLogRepo.list(db, { type: 'welcome', status: 'sent', q: 'alice' });
  expect(rows.length).toBe(1);
  expect(rows[0].subject).toBe('A');
  await db.close();
});

test('emailLogRepo.list pagination works', async () => {
  const db = await freshDb();
  const records = [];
  for (let i = 1; i <= 5; i++) {
    const r = await emailLogRepo.record(db, { to: `user${i}@test.com`, subject: `Sub${i}`, type: 'test', status: 'sent' });
    records.push(r);
  }

  const page1 = await emailLogRepo.list(db, { limit: 2, page: 1 });
  expect(page1.length).toBe(2);
  expect(page1[0].id).toBe(records[4].id);
  expect(page1[1].id).toBe(records[3].id);

  const page2 = await emailLogRepo.list(db, { limit: 2, page: 2 });
  expect(page2.length).toBe(2);
  expect(page2[0].id).toBe(records[2].id);
  expect(page2[1].id).toBe(records[1].id);

  const page3 = await emailLogRepo.list(db, { limit: 2, page: 3 });
  expect(page3.length).toBe(1);
  expect(page3[0].id).toBe(records[0].id);

  await db.close();
});

test('emailLogRepo.list invalid page defaults to 1', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'test', status: 'sent' });

  const rows = await emailLogRepo.list(db, { page: -5 });
  expect(rows.length).toBe(1);

  const rows2 = await emailLogRepo.list(db, { page: 0 });
  expect(rows2.length).toBe(1);
  await db.close();
});

test('emailLogRepo.count returns total matching rows', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'welcome', status: 'sent' });
  await emailLogRepo.record(db, { to: 'b@test.com', subject: 'B', type: 'welcome', status: 'failed' });
  await emailLogRepo.record(db, { to: 'c@test.com', subject: 'C', type: 'rejection', status: 'sent' });

  const total = await emailLogRepo.count(db, {});
  expect(total).toBe(3);

  const welcomeCount = await emailLogRepo.count(db, { type: 'welcome' });
  expect(welcomeCount).toBe(2);

  const failedCount = await emailLogRepo.count(db, { status: 'failed' });
  expect(failedCount).toBe(1);
  await db.close();
});

test('emailLogRepo.distinctTypes returns unique types', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'welcome', status: 'sent' });
  await emailLogRepo.record(db, { to: 'b@test.com', subject: 'B', type: 'rejection', status: 'sent' });
  await emailLogRepo.record(db, { to: 'c@test.com', subject: 'C', type: 'welcome', status: 'sent' });

  const types = await emailLogRepo.distinctTypes(db);
  expect(types.length).toBe(2);
  expect(types).toContain('welcome');
  expect(types).toContain('rejection');
  await db.close();
});

test('emailLogRepo.distinctStatuses returns unique statuses', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'test', status: 'sent' });
  await emailLogRepo.record(db, { to: 'b@test.com', subject: 'B', type: 'test', status: 'failed' });
  await emailLogRepo.record(db, { to: 'c@test.com', subject: 'C', type: 'test', status: 'skipped' });

  const statuses = await emailLogRepo.distinctStatuses(db);
  expect(statuses.length).toBe(3);
  expect(statuses).toContain('sent');
  expect(statuses).toContain('failed');
  expect(statuses).toContain('skipped');
  await db.close();
});

test('emailLogRepo.list joins member name when member_id present', async () => {
  const db = await freshDb();
  const level = await levelsRepo.getBySlug(db, 'member');
  const app = await appsRepo.create(db, {
    first_name: 'Alice',
    last_name: 'Smith',
    email: 'alice@test.com',
    phone: '',
    company: '',
    profession: '',
    linkedin: '',
    area: '',
    why: ''
  });
  const member = await membersRepo.createFromApplication(db, app, level.id, newToken(), expiryFromNow(7));

  await emailLogRepo.record(db, { to: 'alice@test.com', subject: 'Welcome', type: 'welcome', memberId: member.id, status: 'sent' });
  await emailLogRepo.record(db, { to: 'other@test.com', subject: 'Other', type: 'test', memberId: null, status: 'sent' });

  const rows = await emailLogRepo.list(db, {});
  const aliceRow = rows.find(r => r.to_email === 'alice@test.com');
  expect(aliceRow.member_id).toBe(member.id);
  expect(aliceRow.first_name).toBe('Alice');
  expect(aliceRow.last_name).toBe('Smith');

  const otherRow = rows.find(r => r.to_email === 'other@test.com');
  expect(otherRow.member_id).toBe(null);
  expect(otherRow.first_name).toBe(null);
  await db.close();
});

test('emailLogRepo.list returns empty for no matches', async () => {
  const db = await freshDb();
  await emailLogRepo.record(db, { to: 'a@test.com', subject: 'A', type: 'test', status: 'sent' });

  const rows = await emailLogRepo.list(db, { q: 'nonexistent' });
  expect(rows.length).toBe(0);
  await db.close();
});

test('emailLogRepo.list returns empty for empty table', async () => {
  const db = await freshDb();
  const rows = await emailLogRepo.list(db, {});
  expect(rows.length).toBe(0);
  await db.close();
});
