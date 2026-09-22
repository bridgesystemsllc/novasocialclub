const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const email = require('../server/email');

async function loginAgent(base) {
  const page = await fetch(`${base}/admin/login`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email: 'a@n.com', password: 'pw12345', _csrf: csrf }),
  });
  return { cookie, csrf };
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
