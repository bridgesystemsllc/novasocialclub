'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const crypto = require('crypto');
const auth = require('../auth');
const membersRepo = require('../repo/members');
const subscriptionsRepo = require('../repo/subscriptions');
const { createCheckoutSession } = require('../stripe');
const { config } = require('../config');
const { sendEmail, passwordResetEmail } = require('../email');
const V = require('../validate');

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

  router.get('/login', (req, res) => {
    const success = req.query.reset === 'success' ? 'Password updated. Log in.' : null;
    render(res, 'member/login', { title: 'Member Login', nav: false, csrfToken: res.locals.csrfToken, error: null, success });
  });

  router.post('/login', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getByEmail(db, String(req.body.email || '').toLowerCase().trim());
    const ok = m && m.status === 'active' && await auth.verifyPassword(String(req.body.password || ''), m.password_hash);
    if (!ok) return render(res, 'member/login', { title: 'Member Login', nav: false, csrfToken: res.locals.csrfToken, error: 'Invalid email or password.', success: null });
    req.session.memberId = m.id;
    res.redirect('/member');
  });

  router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/member/login')));

  router.get('/forgot-password', (req, res) => render(res, 'member/forgot-password', { title: 'Forgot Password', nav: false, csrfToken: res.locals.csrfToken, error: null, success: null }));

  router.post('/forgot-password', async (req, res) => {
    const db = await getDb();
    const email = String(req.body.email || '').toLowerCase().trim();
    
    if (!email || !email.includes('@')) {
      return render(res, 'member/forgot-password', { title: 'Forgot Password', nav: false, csrfToken: res.locals.csrfToken, error: 'Invalid email format.', success: null });
    }

    const m = await membersRepo.getByEmail(db, email);
    if (m && m.status === 'active' && m.password_hash) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await membersRepo.setResetToken(db, m.id, token, expires);
      const resetUrl = `${config.appBaseUrl}/member/reset-password?token=${token}`;
      const emailContent = passwordResetEmail(m, resetUrl);
      await sendEmail(db, { to: m.email, subject: emailContent.subject, html: emailContent.html, type: 'password_reset', memberId: m.id });
    }

    render(res, 'member/forgot-password', { title: 'Forgot Password', nav: false, csrfToken: res.locals.csrfToken, error: null, success: 'If an account exists, we sent a reset link.' });
  });

  router.get('/reset-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.query.token || '');
    const m = await membersRepo.getByResetToken(db, token);
    const valid = m && m.reset_token_expires_at && new Date(m.reset_token_expires_at) > new Date();
    render(res, 'member/reset-password', { title: 'Reset Password', nav: false, csrfToken: res.locals.csrfToken, token, valid, error: null });
  });

  router.post('/reset-password', async (req, res) => {
    const db = await getDb();
    const token = String(req.body.token || '');
    const pw = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const m = await membersRepo.getByResetToken(db, token);
    const valid = m && m.reset_token_expires_at && new Date(m.reset_token_expires_at) > new Date();

    if (!valid) {
      return render(res, 'member/reset-password', { title: 'Reset Password', nav: false, csrfToken: res.locals.csrfToken, token, valid: false, error: 'Link expired or invalid.' });
    }
    if (pw !== confirm) {
      return render(res, 'member/reset-password', { title: 'Reset Password', nav: false, csrfToken: res.locals.csrfToken, token, valid: true, error: 'Passwords do not match.' });
    }
    if (pw.length < 8) {
      return render(res, 'member/reset-password', { title: 'Reset Password', nav: false, csrfToken: res.locals.csrfToken, token, valid: true, error: 'Password must be at least 8 characters.' });
    }

    await membersRepo.updatePasswordAndClearResetToken(db, m.id, await auth.hashPassword(pw));
    res.redirect('/member/login?reset=success');
  });

  router.get('/', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(() => {}); return res.redirect('/member/login'); }
    const subscription = await subscriptionsRepo.getByMemberId(db, m.id);
    const hasActiveSub = subscriptionsRepo.hasActiveSubscription(subscription);
    const stripePriceId = config.stripePriceId;
    let billingError = null;
    if (req.query.billing === 'error') {
      billingError = req.query.billingError || 'Billing error';
    }
    render(res, 'member/home', { title: 'My Membership', nav: false, csrfToken: res.locals.csrfToken, m, levelLabel: m.level_name || 'Member', perks: PERKS, subscription, hasActiveSub, stripePriceId, billingError });
  });

  router.get('/profile', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(() => {}); return res.redirect('/member/login'); }
    render(res, 'member/profile', {
      title: 'Profile',
      nav: false,
      csrfToken: res.locals.csrfToken,
      m,
      levelLabel: m.level_name || 'Member',
      error: null,
      success: req.query.success === '1' ? 'Profile updated.' : null
    });
  });

  router.post('/profile', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(() => {}); return res.redirect('/member/login'); }
    const { ok, errors, value } = V.validateProfile(req.body);
    if (!ok) {
      return render(res, 'member/profile', {
        title: 'Profile',
        nav: false,
        csrfToken: res.locals.csrfToken,
        m: { ...m, ...value },
        levelLabel: m.level_name || 'Member',
        error: errors.join(' '),
        success: null
      });
    }
    try {
      await membersRepo.updateProfile(db, m.id, value);
      res.redirect('/member/profile?success=1');
    } catch (err) {
      return render(res, 'member/profile', {
        title: 'Profile',
        nav: false,
        csrfToken: res.locals.csrfToken,
        m: { ...m, ...value },
        levelLabel: m.level_name || 'Member',
        error: 'Failed to update profile. Please try again.',
        success: null
      });
    }
  });

  router.post('/billing/checkout', auth.requireMember, async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, req.session.memberId);
    if (!m) { req.session.destroy(() => {}); return res.redirect('/member/login'); }

    if (!config.stripePriceId) {
      return res.redirect('/member?billing=error&billingError=' + encodeURIComponent('STRIPE_PRICE_ID not configured'));
    }
    if (!m.stripe_customer_id) {
      return res.redirect('/member?billing=error&billingError=' + encodeURIComponent('Stripe Customer not synced. Contact support.'));
    }

    const successUrl = `${config.appBaseUrl}/member/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.appBaseUrl}/member/billing/cancel`;

    const result = await createCheckoutSession(m, successUrl, cancelUrl);
    if (!result.success) {
      return res.redirect('/member?billing=error&billingError=' + encodeURIComponent(result.error));
    }

    await subscriptionsRepo.upsertIncomplete(db, m.id, config.stripePriceId);
    res.redirect(result.url);
  });

  router.get('/billing/success', auth.requireMember, (req, res) => {
    render(res, 'member/billing-success', { title: 'Payment Successful', nav: false, csrfToken: res.locals.csrfToken });
  });

  router.get('/billing/cancel', auth.requireMember, (req, res) => {
    render(res, 'member/billing-cancel', { title: 'Payment Cancelled', nav: false, csrfToken: res.locals.csrfToken });
  });

  return router;
};
