'use strict';
const path = require('path');
const express = require('express');
const { config } = require('./config');

function createApp(opts = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const rootDir = path.join(__dirname, '..');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  const getDb = opts.db ? async () => opts.db : require('./db').getDb;

  // Stripe webhook route MUST be mounted before express.json() for raw body signature verification
  app.use(require('./routes/stripeWebhooks')(getDb));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const dbForSession = opts.db || null;
  app.use(require('./auth').sessionMiddleware(dbForSession));

  app.use('/', require('./routes/public')(getDb));
  app.get('/portal.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'public-admin.css')));
  app.use('/admin', require('./routes/admin')(getDb));
  app.use('/member', require('./routes/member')(getDb));
  app.use(express.static(rootDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
  });
  return app;
}

if (require.main === module) {
  const { getDb } = require('./db');
  const { migrate } = require('./migrate');

  (async () => {
    const db = await getDb();
    await migrate(db);
    console.log('Database migration complete.');

    const app = createApp();
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`NOVA server listening on :${config.port}`);
    });
    server.ref();

    // Keep the event loop alive and handle graceful shutdown.
    const keepAlive = setInterval(() => {}, 1 << 30);
    function shutdown(signal) {
      console.log(`Received ${signal}, shutting down…`);
      clearInterval(keepAlive);
      server.close(() => process.exit(0));
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  })();
}

module.exports = { createApp };
