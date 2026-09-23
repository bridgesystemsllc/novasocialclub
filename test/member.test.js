const { test, expect, describe } = require('bun:test');
const { freshDb } = require('./helpers');
const { createApp } = require('../server/index.js');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const { newToken, expiryFromNow } = require('../server/tokens');
const auth = require('../server/auth');

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

async function setupMemberAndLogin(db, app, base, memberData = {}) {
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const a = await appsRepo.create(db, {
    first_name: memberData.first_name || 'Test',
    last_name: memberData.last_name || 'User',
    email: memberData.email || 'test@example.com',
    phone: memberData.phone || '555-1234',
    company: memberData.company || 'TestCo',
    profession: '',
    linkedin: memberData.linkedin || 'https://linkedin.com/in/test',
    area: '',
    why: ''
  });
  const token = newToken();
  const member = await membersRepo.createFromApplication(db, a, memberLevel.id, token, expiryFromNow(7));
  const hash = await auth.hashPassword('testpw123');
  await membersRepo.setPassword(db, member.id, hash);
  let { cookie, csrf } = await getCsrf(base, '/member/login');
  const res = await fetch(`${base}/member/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email: memberData.email || 'test@example.com', password: 'testpw123', _csrf: csrf })
  });
  cookie = (res.headers.get('set-cookie') || cookie).split(';')[0];
  return { member, cookie };
}

describe('member profile', () => {
  test('GET /member/profile shows current values with email/level read-only', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { member, cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@test.com',
      phone: '555-9999',
      company: 'AliceCorp',
      linkedin: 'https://linkedin.com/in/alice'
    });
    const { csrf } = await getCsrf(base, '/member/profile', cookie);
    const res = await fetch(`${base}/member/profile`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('alice@test.com');
    expect(html).toContain('Alice');
    expect(html).toContain('Smith');
    expect(html).toContain('555-9999');
    expect(html).toContain('AliceCorp');
    expect(html).toContain('linkedin.com/in/alice');
    expect(html).toContain('disabled');
    expect(html).toContain('readonly');
    server.close(); await db.close();
  });

  test('POST /member/profile updates allowed fields only', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { member, cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Bob',
      last_name: 'Jones',
      email: 'bob@test.com',
      phone: '555-1111',
      company: 'BobCo',
      linkedin: 'https://linkedin.com/in/bob'
    });
    const { csrf } = await getCsrf(base, '/member/profile', cookie);
    const res = await fetch(`${base}/member/profile`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        _csrf: csrf,
        first_name: 'Robert',
        last_name: 'Johnson',
        phone: '555-2222',
        company: 'NewCorp',
        linkedin: 'https://linkedin.com/in/robert'
      })
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/member/profile?success=1');
    const updated = await membersRepo.getById(db, member.id);
    expect(updated.first_name).toBe('Robert');
    expect(updated.last_name).toBe('Johnson');
    expect(updated.phone).toBe('555-2222');
    expect(updated.company).toBe('NewCorp');
    expect(updated.linkedin).toBe('https://linkedin.com/in/robert');
    server.close(); await db.close();
  });

  test('POST /member/profile cannot change email even if forged in body', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { member, cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Carol',
      last_name: 'White',
      email: 'carol@test.com'
    });
    const { csrf } = await getCsrf(base, '/member/profile', cookie);
    await fetch(`${base}/member/profile`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        _csrf: csrf,
        first_name: 'Carol',
        last_name: 'White',
        email: 'hacker@evil.com',
        membership_level_id: '999',
        status: 'superadmin'
      })
    });
    const updated = await membersRepo.getById(db, member.id);
    expect(updated.email).toBe('carol@test.com');
    expect(updated.status).toBe('active');
    server.close(); await db.close();
  });

  test('POST /member/profile validation errors for empty first/last name', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { member, cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Dave',
      last_name: 'Brown',
      email: 'dave@test.com'
    });
    const { csrf } = await getCsrf(base, '/member/profile', cookie);
    const res = await fetch(`${base}/member/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        _csrf: csrf,
        first_name: '',
        last_name: ''
      })
    });
    const html = await res.text();
    expect(html).toContain('First name is required');
    expect(html).toContain('Last name is required');
    const unchanged = await membersRepo.getById(db, member.id);
    expect(unchanged.first_name).toBe('Dave');
    expect(unchanged.last_name).toBe('Brown');
    server.close(); await db.close();
  });

  test('POST /member/profile requires CSRF token', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { member, cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Eve',
      last_name: 'Green',
      email: 'eve@test.com'
    });
    const res = await fetch(`${base}/member/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        _csrf: 'invalid-token',
        first_name: 'Hacked',
        last_name: 'Name'
      })
    });
    expect(res.status).toBe(403);
    const unchanged = await membersRepo.getById(db, member.id);
    expect(unchanged.first_name).toBe('Eve');
    server.close(); await db.close();
  });

  test('member home shows Profile link', async () => {
    const db = await freshDb();
    const app = createApp({ db });
    const server = app.listen(0);
    const base = `http://localhost:${server.address().port}`;
    const { cookie } = await setupMemberAndLogin(db, app, base, {
      first_name: 'Frank',
      last_name: 'Blue',
      email: 'frank@test.com'
    });
    const res = await fetch(`${base}/member`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('/member/profile');
    expect(html).toContain('Edit Profile');
    server.close(); await db.close();
  });
});
