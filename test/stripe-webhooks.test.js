const { test, expect, beforeAll, afterAll, mock } = require('bun:test');
const { freshDb } = require('./helpers');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const subscriptionsRepo = require('../server/repo/subscriptions');
const webhookEvents = require('../server/repo/webhook_events');
const { config } = require('../server/config');
const { createApp } = require('../server/index');
const crypto = require('crypto');

function generateStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadString}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function setupMember(db) {
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'Webhook', email: `webhook${Date.now()}@example.com`,
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  const member = await membersRepo.createFromApplication(db, app, memberLevel.id, 'token', new Date(Date.now() + 86400000));
  await membersRepo.setStripeCustomerId(db, member.id, `cus_test${Date.now()}`);
  return membersRepo.getById(db, member.id);
}

test('stripe_webhook_events table exists', async () => {
  const db = await freshDb();
  
  const { rows } = await db.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'stripe_webhook_events'
    ORDER BY ordinal_position
  `);
  
  const columns = rows.map(r => r.column_name);
  expect(columns).toContain('event_id');
  expect(columns).toContain('type');
  expect(columns).toContain('processed_at');
  
  await db.close();
});

test('webhookEvents.record inserts event', async () => {
  const db = await freshDb();
  
  const eventId = `evt_test_${Date.now()}`;
  const result = await webhookEvents.record(db, eventId, 'customer.subscription.created');
  
  expect(result.event_id).toBe(eventId);
  expect(result.type).toBe('customer.subscription.created');
  
  await db.close();
});

test('webhookEvents.findById returns event', async () => {
  const db = await freshDb();
  
  const eventId = `evt_test_find_${Date.now()}`;
  await webhookEvents.record(db, eventId, 'invoice.paid');
  
  const found = await webhookEvents.findById(db, eventId);
  expect(found).not.toBeNull();
  expect(found.event_id).toBe(eventId);
  
  const notFound = await webhookEvents.findById(db, 'evt_nonexistent');
  expect(notFound).toBeNull();
  
  await db.close();
});

test('webhookEvents.record is idempotent', async () => {
  const db = await freshDb();
  
  const eventId = `evt_test_idem_${Date.now()}`;
  const first = await webhookEvents.record(db, eventId, 'customer.subscription.updated');
  const second = await webhookEvents.record(db, eventId, 'customer.subscription.updated');
  
  expect(first).not.toBeNull();
  expect(second).toBeNull();
  
  const { rows } = await db.query('SELECT * FROM stripe_webhook_events WHERE event_id = $1', [eventId]);
  expect(rows.length).toBe(1);
  
  await db.close();
});

test('subscriptionsRepo.getByStripeSubscriptionId returns subscription', async () => {
  const db = await freshDb();
  const member = await setupMember(db);
  
  await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_test');
  await subscriptionsRepo.updateFromStripeSubscription(
    db, member.id, 'sub_test_123', 'active', new Date(), false
  );
  
  const found = await subscriptionsRepo.getByStripeSubscriptionId(db, 'sub_test_123');
  expect(found).not.toBeNull();
  expect(found.stripe_subscription_id).toBe('sub_test_123');
  
  const notFound = await subscriptionsRepo.getByStripeSubscriptionId(db, 'sub_nonexistent');
  expect(notFound).toBeNull();
  
  await db.close();
});

test('subscriptionsRepo.createFromWebhook creates subscription', async () => {
  const db = await freshDb();
  const member = await setupMember(db);
  
  const periodEnd = new Date('2025-12-31');
  const sub = await subscriptionsRepo.createFromWebhook(
    db, member.id, 'sub_webhook_123', 'price_test', 'active', periodEnd, false
  );
  
  expect(sub.member_id).toBe(member.id);
  expect(sub.stripe_subscription_id).toBe('sub_webhook_123');
  expect(sub.status).toBe('active');
  expect(sub.cancel_at_period_end).toBe(false);
  
  await db.close();
});

test('subscriptionsRepo.createFromWebhook upserts on conflict', async () => {
  const db = await freshDb();
  const member = await setupMember(db);
  
  await subscriptionsRepo.createFromWebhook(
    db, member.id, 'sub_first', 'price_old', 'incomplete', null, false
  );
  
  const updated = await subscriptionsRepo.createFromWebhook(
    db, member.id, 'sub_second', 'price_new', 'active', new Date(), true
  );
  
  expect(updated.stripe_subscription_id).toBe('sub_second');
  expect(updated.stripe_price_id).toBe('price_new');
  expect(updated.status).toBe('active');
  expect(updated.cancel_at_period_end).toBe(true);
  
  const { rows } = await db.query('SELECT * FROM subscriptions WHERE member_id = $1', [member.id]);
  expect(rows.length).toBe(1);
  
  await db.close();
});

test('membersRepo.getByStripeCustomerId returns member', async () => {
  const db = await freshDb();
  const member = await setupMember(db);
  
  const found = await membersRepo.getByStripeCustomerId(db, member.stripe_customer_id);
  expect(found).not.toBeNull();
  expect(found.id).toBe(member.id);
  
  const notFound = await membersRepo.getByStripeCustomerId(db, 'cus_nonexistent');
  expect(notFound).toBeNull();
  
  await db.close();
});

test('webhook endpoint returns 400 without signature when configured', async () => {
  const db = await freshDb();
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  
  const originalStripeKey = config.stripeSecretKey;
  const originalSecret = config.stripeWebhookSecret;
  config.stripeSecretKey = 'sk_test_fake';
  config.stripeWebhookSecret = 'whsec_test';
  
  try {
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test' }),
    });
    
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe('Missing stripe-signature header');
  } finally {
    config.stripeSecretKey = originalStripeKey;
    config.stripeWebhookSecret = originalSecret;
    server.close();
    await db.close();
  }
});

test('webhook endpoint returns 500 when secret not configured', async () => {
  const db = await freshDb();
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  
  const originalSecret = config.stripeWebhookSecret;
  config.stripeWebhookSecret = '';
  
  try {
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'stripe-signature': 'test'
      },
      body: JSON.stringify({ type: 'test' }),
    });
    
    expect(res.status).toBe(500);
  } finally {
    config.stripeWebhookSecret = originalSecret;
    server.close();
    await db.close();
  }
});

test('STRIPE_WEBHOOK_SECRET is in config', () => {
  expect('stripeWebhookSecret' in config).toBe(true);
});

test('paymentFailedEmail generates correct email', () => {
  const { paymentFailedEmail } = require('../server/email');
  
  const member = { first_name: 'John', last_name: 'Doe' };
  const email = paymentFailedEmail(member);
  
  expect(email.subject).toBe('NOVA Social Club — payment issue');
  expect(email.html).toContain('Hi John');
  expect(email.html).toContain('payment');
});

test('subscriptionCanceledEmail generates correct email', () => {
  const { subscriptionCanceledEmail } = require('../server/email');
  
  const member = { first_name: 'Jane', last_name: 'Smith' };
  const email = subscriptionCanceledEmail(member);
  
  expect(email.subject).toBe('NOVA Social Club — subscription canceled');
  expect(email.html).toContain('Hi Jane');
  expect(email.html).toContain('canceled');
});

test('stripeWebhooks route is mounted before express.json', async () => {
  const db = await freshDb();
  const app = createApp({ db });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  
  const originalStripeKey = config.stripeSecretKey;
  const originalSecret = config.stripeWebhookSecret;
  config.stripeSecretKey = '';
  config.stripeWebhookSecret = 'whsec_test';
  
  try {
    const payload = { type: 'test.event' };
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'stripe-signature': 't=123,v1=abc'
      },
      body: JSON.stringify(payload),
    });
    
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('Stripe not configured');
  } finally {
    config.stripeSecretKey = originalStripeKey;
    config.stripeWebhookSecret = originalSecret;
    server.close();
    await db.close();
  }
});
