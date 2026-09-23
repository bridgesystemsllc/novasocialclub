const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const auth = require('../server/auth');
const admins = require('../server/repo/admins');
const subs = require('../server/repo/subscribers');
const { newToken } = require('../server/tokens');
const email = require('../server/email');

test('broadcast emails every active subscriber with unsubscribe link', async () => {
  const db = await freshDb();
  await admins.upsert(db, 'a@n.com', await auth.hashPassword('pw12345'));
  await subs.subscribe(db, 'one@x.com', newToken());
  await subs.subscribe(db, 'two@x.com', newToken());
  const seen = [];
  email.__setSender(async (m) => { seen.push(m); return { id: 'x' }; });
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const loginRes = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'a@n.com', password: 'pw12345', _csrf: '' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const dashRes = await fetch(`${base}/admin`, { headers: { cookie } });
  const csrf = (await dashRes.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(`${base}/admin/newsletter/broadcast`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ subject: 'News', body: '<p>hi</p>', _csrf: csrf }) });
  expect(res.status).toBe(302);
  expect(seen.length).toBe(2);
  expect(seen.every(m => m.html.includes('/unsubscribe?token='))).toBe(true);
  const { rows } = await db.query("SELECT * FROM email_log WHERE type='broadcast'");
  expect(rows.length).toBe(2);
  server.close(); await db.close();
});
