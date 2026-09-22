'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const auth = require('../auth');
const membersRepo = require('../repo/members');

const PERKS = [
  'Complimentary access to member-only events',
  'Priority access to programming',
  'Member perks & discounts at NoVA partners',
  'Access to the private NOVA member network',
];

function render(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), locals, (err, body) => {
    if (err) return res.status(500).send(String(err));
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, locals), (e2, html) =>
      e2 ? res.status(500).send(String(e2)) : res.send(html));
  });
}

module.exports = function memberRoutes(getDb) {
  const router = express.Router();
  router.use(auth.csrf);

  router.get('/set-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.query.token || '');
    const m = await membersRepo.getBySetToken(db, token);
    const valid = m && m.token_expires_at && new Date(m.token_expires_at) > new Date();
    render(res, 'member/set-password', { title: 'Set Password', nav: false, csrfToken: res.locals.csrfToken, token, valid, error: null });
  });

  router.post('/set-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.body.token || '');
    const pw = String(req.body.password || '');
    const m = await membersRepo.getBySetToken(db, token);
    const valid = m && m.token_expires_at && new Date(m.token_expires_at) > new Date();
    if (!valid || pw.length < 8) {
      return render(res, 'member/set-password', { title: 'Set Password', nav: false, csrfToken: res.locals.csrfToken, token, valid, error: 'Invalid link or password too short (min 8).' });
    }
    await membersRepo.setPassword(db, m.id, await auth.hashPassword(pw));
    req.session.memberId = m.id;
    res.redirect('/member');
  });

  router.get('/login', (req, res) => render(res, 'member/login', { title: 'Member Login', nav: false, csrfToken: res.locals.csrfToken, error: null }));

  router.post('/login', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getByEmail(db, String(req.body.email || '').toLowerCase().trim());
    const ok = m && m.status === 'active' && await auth.verifyPassword(String(req.body.password || ''), m.password_hash);
    if (!ok) return render(res, 'member/login', { title: 'Member Login', nav: false, csrfToken: res.locals.csrfToken, error: 'Invalid email or password.' });
    req.session.memberId = m.id;
    res.redirect('/member');
  });

  router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/member/login')));

  router.get('/', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(() => {}); return res.redirect('/member/login'); }
    render(res, 'member/home', { title: 'My Membership', nav: false, csrfToken: res.locals.csrfToken, m, levelLabel: m.level_name || 'Member', perks: PERKS });
  });

  return router;
};
