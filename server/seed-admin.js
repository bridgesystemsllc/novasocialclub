'use strict';
const { config } = require('./config');
const { hashPassword } = require('./auth');
const admins = require('./repo/admins');

async function run(db) {
  if (!config.adminEmail || !config.adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the admin.');
  }

  const credentials = [
    { email: config.adminEmail, password: config.adminPassword },
  ];

  if (config.supportAdminEmail || config.supportAdminPassword) {
    if (!config.supportAdminEmail || !config.supportAdminPassword) {
      throw new Error('SUPPORT_ADMIN_EMAIL and SUPPORT_ADMIN_PASSWORD must both be set.');
    }
    credentials.push({
      email: config.supportAdminEmail,
      password: config.supportAdminPassword,
    });
  }

  const seeded = [];
  for (const credential of credentials) {
    const hash = await hashPassword(credential.password);
    seeded.push(await admins.upsert(db, credential.email.toLowerCase(), hash));
  }
  return seeded;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const { getDb, closeDb } = require('./db');
    const db = await getDb();
    const seeded = await run(db);
    console.log(`Admins seeded: ${seeded.map((admin) => admin.email).join(', ')}`);
    await closeDb();
  })();
}
