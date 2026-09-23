'use strict';
const express = require('express');
const { config } = require('../config');
const V = require('../validate');
const { newToken } = require('../tokens');
const appsRepo = require('../repo/applications');
const subsRepo = require('../repo/subscribers');
const partnersRepo = require('../repo/partners');
const email = require('../email');
const { eventsRepo, refreshEvents } = require('../posh');

module.exports = function publicRoutes(getDb) {
  const router = express.Router();

  router.get('/api/events', async (req, res) => {
    const db = await getDb();
    let events = await eventsRepo.listUpcoming(db);

    if (!events.length) {
      try {
        await refreshEvents(db, true);
        events = await eventsRepo.listUpcoming(db);
      } catch (err) {
        console.error('[events] Initial POSH sync failed:', err.message);
      }
    } else {
      refreshEvents(db).catch(err => console.error('[events] Background POSH sync failed:', err.message));
    }

    return res.json({ ok: true, events });
  });

  router.post('/api/apply', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validateApplication(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors });
    const app = await appsRepo.create(db, value);
    const t1 = email.applicationReceivedEmail(app);
    await email.sendEmail(db, { to: app.email, subject: t1.subject, html: t1.html, type: 'application_received' });
    if (config.adminEmail) {
      const t2 = email.adminNotifyEmail(app);
      await email.sendEmail(db, { to: config.adminEmail, subject: t2.subject, html: t2.html, type: 'admin_notify' });
    }
    return res.json({ ok: true });
  });

  router.post('/api/newsletter', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validateNewsletter(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors });
    const sub = await subsRepo.subscribe(db, value.email, newToken());
    const unsubUrl = `${config.appBaseUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
    const t = email.newsletterConfirmEmail(unsubUrl);
    await email.sendEmail(db, { to: value.email, subject: t.subject, html: t.html, type: 'newsletter_confirm' });
    return res.json({ ok: true });
  });

  router.post('/api/partner', async (req, res) => {
    const db = await getDb();
    const { ok, errors, value } = V.validatePartner(req.body || {});
    if (!ok) return res.status(400).json({ ok: false, errors });
    await partnersRepo.create(db, value);
    return res.json({ ok: true });
  });

  router.get('/unsubscribe', async (req, res) => {
    const db = await getDb();
    const token = String(req.query.token || '');
    const row = await subsRepo.unsubscribe(db, token);
    res.status(row ? 200 : 404).send(
      `<!doctype html><meta charset=utf8><title>Unsubscribe</title>
       <div style="font-family:Georgia,serif;max-width:520px;margin:80px auto;text-align:center">
       <h1>${row ? "You've been unsubscribed" : 'Link not found'}</h1>
       <p>${row ? "You won't receive further NOVA newsletters." : 'This unsubscribe link is invalid.'}</p>
       <p><a href="/">Return to The NOVA Social Club</a></p></div>`);
  });

  return router;
};
