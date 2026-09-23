const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const email = require('../server/email');

async function loginAgent(base) {
  const loginRes = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'a@n.com', password: 'pw12345', _csrf: '' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const dashRes = await fetch(`${base}/admin`, { headers: { cookie } });
  const csrf = (await dashRes.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  return { cookie, csrf };
}

async function setupTestApp() {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  email.__setSender(async () => ({ id: 'x' }));
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const { cookie, csrf } = await loginAgent(base);
  return { db, server, base, cookie, csrf };
}

test('accepting an application creates a member and logs welcome email', async () => {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  email.__setSender(async () => ({ id: 'x' }));
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const appRow = await appsRepo.create(db, { first_name: 'Ada', last_name: 'L', email: 'ada@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const { cookie, csrf } = await loginAgent(base);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/accept`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ levelId: memberLevel.id, _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const { rows } = await db.query('SELECT * FROM members WHERE email=$1', ['ada@x.com']);
  expect(rows.length).toBe(1);
  expect(rows[0].set_password_token).toBeTruthy();
  const { rows: log } = await db.query("SELECT * FROM email_log WHERE type='welcome_set_password'");
  expect(log.length).toBe(1);
  server.close(); await db.close();
});

test('waitlist action sets status to waitlisted from pending', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Bob', last_name: 'W', email: 'bob@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const res = await fetch(`${base}/admin/applications/${appRow.id}/waitlist`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('waitlisted');
  server.close(); await db.close();
});

test('follow-up action sets status to follow_up from pending', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Carol', last_name: 'F', email: 'carol@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const res = await fetch(`${base}/admin/applications/${appRow.id}/follow-up`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('follow_up');
  server.close(); await db.close();
});

test('can transition from waitlisted to follow_up', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Dan', last_name: 'T', email: 'dan@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'waitlisted', null, null);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/follow-up`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('follow_up');
  server.close(); await db.close();
});

test('can transition from follow_up to waitlisted', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Eve', last_name: 'T', email: 'eve@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'follow_up', null, null);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/waitlist`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('waitlisted');
  server.close(); await db.close();
});

test('cannot waitlist an accepted application', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Fay', last_name: 'A', email: 'fay@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'accepted', null, new Date());
  const res = await fetch(`${base}/admin/applications/${appRow.id}/waitlist`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(400);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('accepted');
  server.close(); await db.close();
});

test('cannot follow-up a rejected application', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Gus', last_name: 'R', email: 'gus@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'rejected', null, new Date());
  const res = await fetch(`${base}/admin/applications/${appRow.id}/follow-up`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(400);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('rejected');
  server.close(); await db.close();
});

test('filter by waitlisted status returns only waitlisted applications', async () => {
  const { db, server, base, cookie } = await setupTestApp();
  const app1 = await appsRepo.create(db, { first_name: 'Hank', last_name: 'W', email: 'hank@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const app2 = await appsRepo.create(db, { first_name: 'Ivy', last_name: 'P', email: 'ivy@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, app1.id, 'waitlisted', null, null);
  const res = await fetch(`${base}/admin/applications?status=waitlisted`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Hank');
  expect(html).not.toContain('Ivy');
  server.close(); await db.close();
});

test('filter by follow_up status returns only follow_up applications', async () => {
  const { db, server, base, cookie } = await setupTestApp();
  const app1 = await appsRepo.create(db, { first_name: 'Jack', last_name: 'F', email: 'jack@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const app2 = await appsRepo.create(db, { first_name: 'Kate', last_name: 'P', email: 'kate@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, app1.id, 'follow_up', null, null);
  const res = await fetch(`${base}/admin/applications?status=follow_up`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Jack');
  expect(html).not.toContain('Kate');
  server.close(); await db.close();
});

test('accept still works from waitlisted status', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const appRow = await appsRepo.create(db, { first_name: 'Leo', last_name: 'A', email: 'leo@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'waitlisted', null, null);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/accept`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ levelId: memberLevel.id, _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const { rows } = await db.query('SELECT * FROM members WHERE email=$1', ['leo@x.com']);
  expect(rows.length).toBe(1);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('accepted');
  server.close(); await db.close();
});

test('reject still works from follow_up status', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Mia', last_name: 'R', email: 'mia@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'follow_up', null, null);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/reject`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('rejected');
  server.close(); await db.close();
});

test('waitlist returns 404 for non-existent application', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const res = await fetch(`${base}/admin/applications/99999/waitlist`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(404);
  server.close(); await db.close();
});

test('double-click waitlist is idempotent', async () => {
  const { db, server, base, cookie, csrf } = await setupTestApp();
  const appRow = await appsRepo.create(db, { first_name: 'Nina', last_name: 'I', email: 'nina@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  await appsRepo.setStatus(db, appRow.id, 'waitlisted', null, null);
  const res = await fetch(`${base}/admin/applications/${appRow.id}/waitlist`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  expect(res.status).toBe(302);
  const updated = await appsRepo.getById(db, appRow.id);
  expect(updated.status).toBe('waitlisted');
  server.close(); await db.close();
});
