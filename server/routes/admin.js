'use strict';
const express = require('express');
const ejs = require('ejs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const admins = require('../repo/admins');
const appsRepo = require('../repo/applications');
const membersRepo = require('../repo/members');
const subsRepo = require('../repo/subscribers');
const partnersRepo = require('../repo/partners');
const levelsRepo = require('../repo/levels');
const webhookEventsRepo = require('../repo/webhook_events');
const emailLogRepo = require('../repo/emailLog');
const tokens = require('../tokens');
const email = require('../email');
const V = require('../validate');
const { config } = require('../config');
const { createOrRetrieveCustomer, createCheckoutSession } = require('../stripe');
const subscriptionsRepo = require('../repo/subscriptions');

function normalizePageLocals(view, locals) {
  const pageLocals = Object.assign({}, locals);
  if (view === 'admin/dashboard') {
    pageLocals.kpis = Object.assign({
      pendingApps: 0,
      activeMembers: 0,
      billingIssues: 0,
      webhookEvents24h: 0,
      emailFailures: 0,
    }, pageLocals.kpis || {});
    pageLocals.recentPendingApps = pageLocals.recentPendingApps || [];
    pageLocals.recentWebhooks = pageLocals.recentWebhooks || [];
  }
  return pageLocals;
}

function renderPage(res, view, locals) {
  const viewsDir = path.join(__dirname, '..', 'views');
  const pageLocals = normalizePageLocals(view, locals);
  ejs.renderFile(path.join(viewsDir, view + '.ejs'), pageLocals, (err, body) => {
    if (err) {
      console.error(`[admin] Failed to render ${view}:`, err);
      return res.status(500).send('The admin portal could not load this page.');
    }
    ejs.renderFile(path.join(viewsDir, 'layout.ejs'), Object.assign({ body }, pageLocals), (e2, html) => {
      if (e2) {
        console.error('[admin] Failed to render layout:', e2);
        return res.status(500).send('The admin portal could not load this page.');
      }
      return res.send(html);
    });
  });
}

module.exports = function adminRoutes(getDb) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

  // Login routes are exempt from CSRF — they are protected by password auth.
  router.get('/login', (req, res) =>
    renderPage(res, 'admin/login', { title: 'Login', nav: false, error: null, csrfToken: '' }));

  router.post('/login', loginLimiter, async (req, res) => {
    const db = await getDb();
    const emailIn = String(req.body.email || '').toLowerCase().trim();
    const admin = await admins.getByEmail(db, emailIn);
    const ok = admin && await auth.verifyPassword(String(req.body.password || ''), admin.password_hash);
    if (!ok) return renderPage(res, 'admin/login', { title: 'Login', nav: false, error: 'Invalid email or password.', csrfToken: res.locals.csrfToken });
    req.session.adminId = admin.id;
    res.redirect('/admin');
  });

  router.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

  router.use(auth.csrf);        // CSRF protection for all authenticated routes
  router.use(auth.requireAdmin); // everything below requires login

  router.get('/', async (req, res) => {
    const db = await getDb();
    const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      pendingApps,
      activeMembers,
      billingCounts,
      webhookCount24h,
      emailFailCount,
      recentWebhooks
    ] = await Promise.all([
      appsRepo.list(db, { status: 'pending' }),
      membersRepo.list(db, { status: 'active' }),
      subscriptionsRepo.countsByStatus(db),
      webhookEventsRepo.countSince(db, sinceDate),
      emailLogRepo.count(db, { status: 'failed' }),
      webhookEventsRepo.listRecent(db, 8)
    ]);
    const kpis = {
      pendingApps: pendingApps.length,
      activeMembers: activeMembers.length,
      billingIssues: billingCounts.past_due,
      webhookEvents24h: webhookCount24h,
      emailFailures: emailFailCount
    };
    const recentPendingApps = pendingApps.slice(0, 8);
    renderPage(res, 'admin/dashboard', {
      title: 'Dashboard',
      nav: true,
      path: 'dashboard',
      csrfToken: res.locals.csrfToken,
      kpis,
      recentPendingApps,
      recentWebhooks
    });
  });

  router.get('/applications', async (req, res) => {
    const db = await getDb();
    const status = req.query.status || '';
    const rows = await appsRepo.list(db, status ? { status } : {});
    const levels = await levelsRepo.listActive(db);
    renderPage(res, 'admin/applications', { title: 'Applications', nav: true, path: 'applications', csrfToken: res.locals.csrfToken, rows, status, levels });
  });

  router.get('/applications/:id', async (req, res) => {
    const db = await getDb();
    const a = await appsRepo.getById(db, Number(req.params.id));
    if (!a) return res.status(404).send('Not found');
    const levels = await levelsRepo.listActive(db);
    let stripeMsg = null;
    if (req.query.stripe === 'synced') {
      stripeMsg = { type: 'success', text: 'Application accepted. Member created. Stripe Customer synced.' };
    } else if (req.query.stripe === 'failed') {
      stripeMsg = { type: 'warning', text: `Member created. Stripe Customer sync failed: ${req.query.stripeError || 'Unknown error'} — retry from member detail.` };
    }
    renderPage(res, 'admin/application-detail', { title: 'Application', nav: true, path: 'applications', csrfToken: res.locals.csrfToken, a, levels, stripeMsg });
  });

  router.post('/applications/:id/accept', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const levelId = Number(req.body.levelId);
    const level = await levelsRepo.getById(db, levelId);
    if (!level || !level.active) return res.status(400).send('Invalid level');
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'accepted', levelId, new Date());
    const existing = await membersRepo.getByEmail(db, a.email);
    const token = tokens.newToken();
    const expires = tokens.expiryFromNow(7);
    let member;
    if (existing) {
      await membersRepo.setLevelId(db, existing.id, levelId);
      member = await membersRepo.setSetToken(db, existing.id, token, expires);
    } else {
      member = await membersRepo.createFromApplication(db, a, levelId, token, expires);
    }

    // Create Stripe Customer (non-blocking for membership)
    let stripeMsg = '';
    const stripeResult = await createOrRetrieveCustomer(member, a.id);
    if (stripeResult.success) {
      if (!stripeResult.existing) {
        await membersRepo.setStripeCustomerId(db, member.id, stripeResult.customerId);
      }
      stripeMsg = 'stripe=synced';
    } else {
      stripeMsg = `stripe=failed&stripeError=${encodeURIComponent(stripeResult.error)}`;
    }

    // Welcome email must still send even if Stripe fails
    const url = `${config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(member, url);
    await email.sendEmail(db, { to: member.email, subject: t.subject, html: t.html, type: 'welcome_set_password', memberId: member.id });
    res.redirect(`/admin/applications/${id}?${stripeMsg}`);
  });

  router.post('/applications/:id/reject', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    await appsRepo.setStatus(db, id, 'rejected', null, new Date());
    if (req.body.notify === 'on') {
      const t = email.rejectionEmail(a);
      await email.sendEmail(db, { to: a.email, subject: t.subject, html: t.html, type: 'rejection' });
    }
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/notes', async (req, res) => {
    const db = await getDb();
    await appsRepo.addNote(db, Number(req.params.id), V.cleanStr(req.body.notes, 2000));
    res.redirect(`/admin/applications/${req.params.id}`);
  });

  router.post('/applications/:id/waitlist', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    const allowed = ['pending', 'waitlisted', 'follow_up'];
    if (!allowed.includes(a.status)) {
      return res.status(400).send('Cannot waitlist an accepted or rejected application.');
    }
    await appsRepo.setStatus(db, id, 'waitlisted', a.membership_level_id, null);
    res.redirect(`/admin/applications/${id}`);
  });

  router.post('/applications/:id/follow-up', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const a = await appsRepo.getById(db, id);
    if (!a) return res.status(404).send('Not found');
    const allowed = ['pending', 'waitlisted', 'follow_up'];
    if (!allowed.includes(a.status)) {
      return res.status(400).send('Cannot follow up an accepted or rejected application.');
    }
    await appsRepo.setStatus(db, id, 'follow_up', a.membership_level_id, null);
    res.redirect(`/admin/applications/${id}`);
  });

  router.get('/members', async (req, res) => {
    const db = await getDb();
    const q = req.query.q || '';
    const status = req.query.status || '';
    const levelId = req.query.level_id || '';

    const filters = {};
    if (q) filters.q = q;
    if (status === 'active' || status === 'inactive') filters.status = status;
    if (levelId) filters.level_id = levelId;

    const rows = await membersRepo.list(db, filters);
    const levels = await levelsRepo.list(db);
    renderPage(res, 'admin/members', { title: 'Members', nav: true, path: 'members', csrfToken: res.locals.csrfToken, rows, q, status, levelId, levels });
  });

  router.get('/members/:id', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const levels = await levelsRepo.listActive(db);
    const subscription = await subscriptionsRepo.getByMemberId(db, m.id);
    let stripeMsg = null;
    if (req.query.stripe === 'synced') {
      stripeMsg = { type: 'success', text: 'Stripe Customer synced.' };
    } else if (req.query.stripe === 'failed') {
      stripeMsg = { type: 'warning', text: `Stripe Customer sync failed: ${req.query.stripeError || 'Unknown error'}. Retry from below.` };
    } else if (req.query.billing === 'error') {
      stripeMsg = { type: 'warning', text: req.query.billingError || 'Billing error' };
    }
    const stripePriceId = config.stripePriceId;
    renderPage(res, 'admin/member-detail', { title: 'Member', nav: true, path: 'members', csrfToken: res.locals.csrfToken, m, levels, stripeMsg, subscription, stripePriceId });
  });

  router.post('/members/:id/level', async (req, res) => {
    const db = await getDb();
    const levelId = Number(req.body.levelId);
    const level = await levelsRepo.getById(db, levelId);
    if (!level || !level.active) return res.status(400).send('Invalid level');
    await membersRepo.setLevelId(db, Number(req.params.id), levelId);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post('/members/:id/status', async (req, res) => {
    const db = await getDb();
    const status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await membersRepo.setStatus(db, Number(req.params.id), status);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post('/members/:id/resend', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const token = tokens.newToken();
    await membersRepo.setSetToken(db, m.id, token, tokens.expiryFromNow(7));
    const url = `${config.appBaseUrl}/member/set-password?token=${token}`;
    const t = email.welcomeSetPasswordEmail(m, url);
    await email.sendEmail(db, { to: m.email, subject: t.subject, html: t.html, type: 'welcome_set_password', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });

  router.post('/members/:id/email', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const subject = V.cleanStr(req.body.subject, 200);
    const body = String(req.body.body || '');
    await email.sendEmail(db, { to: m.email, subject, html: `<div style="font-family:Georgia,serif">${body}</div>`, type: 'member_email', memberId: m.id });
    res.redirect(`/admin/members/${m.id}`);
  });

  router.post('/members/:id/sync-stripe-customer', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');
    const stripeResult = await createOrRetrieveCustomer(m, m.application_id);
    if (stripeResult.success) {
      if (!stripeResult.existing || !m.stripe_customer_id) {
        await membersRepo.setStripeCustomerId(db, m.id, stripeResult.customerId);
      }
      res.redirect(`/admin/members/${m.id}?stripe=synced`);
    } else {
      res.redirect(`/admin/members/${m.id}?stripe=failed&stripeError=${encodeURIComponent(stripeResult.error)}`);
    }
  });

  router.post('/members/:id/start-billing', async (req, res) => {
    const db = await getDb();
    const m = await membersRepo.getById(db, Number(req.params.id));
    if (!m) return res.status(404).send('Not found');

    if (!config.stripePriceId) {
      return res.redirect(`/admin/members/${m.id}?billing=error&billingError=${encodeURIComponent('STRIPE_PRICE_ID not configured')}`);
    }
    if (!m.stripe_customer_id) {
      return res.redirect(`/admin/members/${m.id}?billing=error&billingError=${encodeURIComponent('Sync Stripe Customer first')}`);
    }

    const successUrl = `${config.appBaseUrl}/member/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.appBaseUrl}/member/billing/cancel`;

    const result = await createCheckoutSession(m, successUrl, cancelUrl);
    if (!result.success) {
      return res.redirect(`/admin/members/${m.id}?billing=error&billingError=${encodeURIComponent(result.error)}`);
    }

    await subscriptionsRepo.upsertIncomplete(db, m.id, config.stripePriceId);
    res.redirect(result.url);
  });

  // Levels CRUD
  router.get('/levels', async (req, res) => {
    const db = await getDb();
    const rows = await levelsRepo.list(db);
    renderPage(res, 'admin/levels', { title: 'Membership Levels', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, rows });
  });

  router.get('/levels/new', async (req, res) => {
    renderPage(res, 'admin/level-form', { title: 'Add Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level: null, error: null });
  });

  router.post('/levels', async (req, res) => {
    const db = await getDb();
    const name = V.cleanStr(req.body.name, 100);
    if (!name) {
      return renderPage(res, 'admin/level-form', { title: 'Add Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level: null, error: 'Name is required.' });
    }
    const slug = levelsRepo.slugify(name);
    const existingBySlug = await levelsRepo.getBySlug(db, slug);
    if (existingBySlug) {
      return renderPage(res, 'admin/level-form', { title: 'Add Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level: { name }, error: 'A level with a similar name already exists.' });
    }
    const active = req.body.active === 'on';
    await levelsRepo.create(db, { name, slug, active });
    res.redirect('/admin/levels');
  });

  router.get('/levels/:id/edit', async (req, res) => {
    const db = await getDb();
    const level = await levelsRepo.getById(db, Number(req.params.id));
    if (!level) return res.status(404).send('Not found');
    renderPage(res, 'admin/level-form', { title: 'Edit Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level, error: null });
  });

  router.post('/levels/:id', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const level = await levelsRepo.getById(db, id);
    if (!level) return res.status(404).send('Not found');
    const name = V.cleanStr(req.body.name, 100);
    if (!name) {
      return renderPage(res, 'admin/level-form', { title: 'Edit Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level, error: 'Name is required.' });
    }
    const active = req.body.active === 'on';
    if (!active && level.active) {
      const activeCount = await levelsRepo.countActive(db);
      if (activeCount <= 1) {
        return renderPage(res, 'admin/level-form', { title: 'Edit Level', nav: true, path: 'levels', csrfToken: res.locals.csrfToken, level, error: 'Keep at least one active membership level.' });
      }
    }
    await levelsRepo.update(db, id, { name, active });
    res.redirect('/admin/levels');
  });

  router.post('/levels/:id/toggle', async (req, res) => {
    const db = await getDb();
    const id = Number(req.params.id);
    const level = await levelsRepo.getById(db, id);
    if (!level) return res.status(404).send('Not found');
    const newActive = !level.active;
    if (!newActive) {
      const activeCount = await levelsRepo.countActive(db);
      if (activeCount <= 1) {
        return res.status(400).send('Keep at least one active membership level.');
      }
    }
    await levelsRepo.update(db, id, { active: newActive });
    res.redirect('/admin/levels');
  });

  router.get('/newsletter', async (req, res) => {
    const db = await getDb();
    const rows = await subsRepo.list(db);
    renderPage(res, 'admin/newsletter', { title: 'Newsletter', nav: true, path: 'newsletter', csrfToken: res.locals.csrfToken, rows });
  });

  router.get('/newsletter/export.csv', async (req, res) => {
    const db = await getDb();
    const rows = await subsRepo.list(db);
    const csv = ['email,status,created_at']
      .concat(rows.map(r => `${r.email},${r.status},${new Date(r.created_at).toISOString()}`))
      .join('\n');
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="subscribers.csv"').send(csv);
  });

  router.post('/newsletter/broadcast', async (req, res) => {
    const db = await getDb();
    const subject = V.cleanStr(req.body.subject, 200);
    const body = String(req.body.body || '');
    const all = await subsRepo.list(db);
    for (const s of all.filter(x => x.status === 'subscribed')) {
      const unsub = `${config.appBaseUrl}/unsubscribe?token=${s.unsubscribe_token}`;
      const t = email.broadcastEmail(subject, body, unsub);
      await email.sendEmail(db, { to: s.email, subject: t.subject, html: t.html, type: 'broadcast' });
    }
    res.redirect('/admin/newsletter');
  });

  router.get('/partners', async (req, res) => {
    const db = await getDb();
    const rows = await partnersRepo.list(db);
    renderPage(res, 'admin/partners', { title: 'Partners', nav: true, path: 'partners', csrfToken: res.locals.csrfToken, rows });
  });

  router.get('/billing', async (req, res) => {
    const db = await getDb();
    const q = req.query.q || '';
    const status = req.query.status || 'all';
    const levelId = req.query.levelId || 'all';
    const rows = await subscriptionsRepo.listWithMembers(db, { q, status, levelId });
    const counts = await subscriptionsRepo.countsByStatus(db);
    const levels = await levelsRepo.listActive(db);
    renderPage(res, 'admin/billing', {
      title: 'Billing',
      nav: true,
      path: 'billing',
      csrfToken: res.locals.csrfToken,
      rows,
      counts,
      levels,
      q,
      status,
      levelId
    });
  });

  router.get('/webhooks', async (req, res) => {
    const db = await getDb();
    const rows = await webhookEventsRepo.listRecent(db, 100);
    const webhookSecretConfigured = Boolean(config.stripeWebhookSecret);
    renderPage(res, 'admin/webhooks', {
      title: 'Webhooks',
      nav: true,
      path: 'webhooks',
      csrfToken: res.locals.csrfToken,
      rows,
      webhookSecretConfigured
    });
  });

  router.get('/settings', (req, res) => {
    const stripeKeysConfigured = Boolean(config.stripeSecretKey);
    const stripeMode = config.stripeSecretKey.startsWith('sk_live') ? 'Live' : 'Test';
    const stripePriceConfigured = Boolean(config.stripePriceId);
    const webhookSecretConfigured = Boolean(config.stripeWebhookSecret);
    const resendConfigured = Boolean(config.resendApiKey);
    const resendFrom = config.resendFrom || '';
    const appBaseUrl = config.appBaseUrl || '';
    const isProd = config.isProd;

    renderPage(res, 'admin/settings', {
      title: 'Settings',
      nav: true,
      path: 'settings',
      csrfToken: res.locals.csrfToken,
      stripeKeysConfigured,
      stripeMode,
      stripePriceConfigured,
      webhookSecretConfigured,
      resendConfigured,
      resendFrom,
      appBaseUrl,
      isProd
    });
  });

  router.get('/email-log', async (req, res) => {
    const db = await getDb();
    const type = req.query.type || '';
    const status = req.query.status || '';
    const q = req.query.q || '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 100;

    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (q) filters.q = q;
    filters.page = page;
    filters.limit = limit;

    const [rows, total, types, statuses] = await Promise.all([
      emailLogRepo.list(db, filters),
      emailLogRepo.count(db, filters),
      emailLogRepo.distinctTypes(db),
      emailLogRepo.distinctStatuses(db)
    ]);

    const totalPages = Math.ceil(total / limit);
    const hasFilters = !!(type || status || q);

    renderPage(res, 'admin/email-log', {
      title: 'Email Log',
      nav: true,
      path: 'email-log',
      csrfToken: res.locals.csrfToken,
      rows,
      type,
      status,
      q,
      page,
      totalPages,
      total,
      types,
      statuses,
      hasFilters
    });
  });

  return router;
};

module.exports.normalizePageLocals = normalizePageLocals;
