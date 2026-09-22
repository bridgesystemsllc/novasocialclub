const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const { newToken, expiryFromNow } = require('../server/tokens');

async function getCsrf(base, pathname, cookieIn) {
  const r = await fetch(`${base}${pathname}`, { headers: cookieIn ? { cookie: cookieIn } : {} });
  const cookie = (r.headers.get('set-cookie') || (cookieIn || '')).split(';')[0];
  const csrf = (await r.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  return { cookie, csrf };
}

test('member sets password then logs in and sees membership', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const a = await appsRepo.create(db, { first_name: 'Mia', last_name: 'K', email: 'mia@x.com', phone: '', company: '', profession: '', linkedin: '', area: '', why: '' });
  const token = newToken();
  await membersRepo.createFromApplication(db, a, memberLevel.id, token, expiryFromNow(7));
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  let { cookie, csrf } = await getCsrf(base, `/member/set-password?token=${token}`);
  let res = await fetch(`${base}/member/set-password`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ token, password: 'memberpw1', _csrf: csrf }) });
  expect(res.status).toBe(302);
  ({ cookie, csrf } = await getCsrf(base, '/member/login'));
  res = await fetch(`${base}/member/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams({ email: 'mia@x.com', password: 'memberpw1', _csrf: csrf }) });
  expect(res.status).toBe(302);
  const home = await fetch(`${base}/member`, { headers: { cookie } });
  const html = await home.text();
  expect(html).toContain('Member');
  server.close(); await db.close();
});
