'use strict';

try { require('dotenv').config(); } catch (_) { /* env provided by host (Replit Secrets) */ }

function bool(v) { return v === '1' || v === 'true'; }

const databaseUrl = process.env.DATABASE_URL || '';

const config = {
  port: Number(process.env.PORT || 5000),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5000',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
  databaseUrl,
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM || 'The NOVA Social Club <onboarding@resend.dev>',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  supportAdminEmail: process.env.SUPPORT_ADMIN_EMAIL || '',
  supportAdminPassword: process.env.SUPPORT_ADMIN_PASSWORD || '',
  isProd: process.env.NODE_ENV === 'production',
  // Use embedded PGlite when no real DATABASE_URL is present (local/test) or when forced.
  useMemoryDb: bool(process.env.USE_MEMORY_DB) || databaseUrl === '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePriceId: process.env.STRIPE_PRICE_ID || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
};

module.exports = { config };
