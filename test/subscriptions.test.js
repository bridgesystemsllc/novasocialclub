const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const subscriptionsRepo = require('../server/repo/subscriptions');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const levelsRepo = require('../server/repo/levels');
const { config } = require('../server/config');

test('subscriptions table exists with correct schema', async () => {
  const db = await freshDb();
  
  const { rows } = await db.query(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'subscriptions'
    ORDER BY ordinal_position
  `);
  
  const columns = rows.map(r => r.column_name);
  expect(columns).toContain('id');
  expect(columns).toContain('member_id');
  expect(columns).toContain('stripe_subscription_id');
  expect(columns).toContain('stripe_price_id');
  expect(columns).toContain('status');
  expect(columns).toContain('current_period_end');
  expect(columns).toContain('cancel_at_period_end');
  expect(columns).toContain('created_at');
  expect(columns).toContain('updated_at');
  
  await db.close();
});

test('member_id is unique in subscriptions', async () => {
  const db = await freshDb();
  
  const { rows } = await db.query(`
    SELECT constraint_name FROM information_schema.table_constraints 
    WHERE table_name = 'subscriptions' AND constraint_type = 'UNIQUE'
  `);
  
  const uniqueConstraints = rows.map(r => r.constraint_name);
  const hasMemberUnique = uniqueConstraints.some(name => 
    name.includes('member_id') || name.includes('subscriptions_member')
  );
  expect(hasMemberUnique).toBe(true);
  await db.close();
});

test('upsertIncomplete creates a subscription with incomplete status', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'User', email: 'test@example.com',
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  
  const member = await membersRepo.createFromApplication(db, app, memberLevel.id, 'token', new Date(Date.now() + 86400000));
  
  const sub = await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_test123');
  
  expect(sub.member_id).toBe(member.id);
  expect(sub.stripe_price_id).toBe('price_test123');
  expect(sub.status).toBe('incomplete');
  expect(sub.stripe_subscription_id).toBeNull();
  
  await db.close();
});

test('upsertIncomplete updates existing subscription to incomplete', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'User', email: 'test2@example.com',
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  
  const member = await membersRepo.createFromApplication(db, app, memberLevel.id, 'token', new Date(Date.now() + 86400000));
  
  await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_old');
  const updated = await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_new');
  
  expect(updated.stripe_price_id).toBe('price_new');
  expect(updated.status).toBe('incomplete');
  
  const all = await db.query('SELECT * FROM subscriptions WHERE member_id = $1', [member.id]);
  expect(all.rows.length).toBe(1);
  
  await db.close();
});

test('getByMemberId returns subscription or null', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'User', email: 'test3@example.com',
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  
  const member = await membersRepo.createFromApplication(db, app, memberLevel.id, 'token', new Date(Date.now() + 86400000));
  
  const noSub = await subscriptionsRepo.getByMemberId(db, member.id);
  expect(noSub).toBeNull();
  
  await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_test');
  const sub = await subscriptionsRepo.getByMemberId(db, member.id);
  expect(sub).not.toBeNull();
  expect(sub.member_id).toBe(member.id);
  
  await db.close();
});

test('hasActiveSubscription returns correct boolean', () => {
  expect(subscriptionsRepo.hasActiveSubscription(null)).toBe(false);
  expect(subscriptionsRepo.hasActiveSubscription({ status: 'incomplete' })).toBe(false);
  expect(subscriptionsRepo.hasActiveSubscription({ status: 'active' })).toBe(true);
  expect(subscriptionsRepo.hasActiveSubscription({ status: 'trialing' })).toBe(true);
  expect(subscriptionsRepo.hasActiveSubscription({ status: 'past_due' })).toBe(false);
  expect(subscriptionsRepo.hasActiveSubscription({ status: 'canceled' })).toBe(false);
});

test('updateFromStripeSubscription updates all fields', async () => {
  const db = await freshDb();
  const memberLevel = await levelsRepo.getBySlug(db, 'member');
  
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'User', email: 'test4@example.com',
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  
  const member = await membersRepo.createFromApplication(db, app, memberLevel.id, 'token', new Date(Date.now() + 86400000));
  
  await subscriptionsRepo.upsertIncomplete(db, member.id, 'price_test');
  
  const periodEnd = new Date('2025-01-15T00:00:00Z');
  const updated = await subscriptionsRepo.updateFromStripeSubscription(
    db, member.id, 'sub_abc123', 'active', periodEnd, false
  );
  
  expect(updated.stripe_subscription_id).toBe('sub_abc123');
  expect(updated.status).toBe('active');
  expect(new Date(updated.current_period_end).toISOString()).toBe(periodEnd.toISOString());
  expect(updated.cancel_at_period_end).toBe(false);
  
  await db.close();
});

test('STRIPE_PRICE_ID is in config', () => {
  expect('stripePriceId' in config).toBe(true);
});

test('createCheckoutSession returns error when Stripe not configured', async () => {
  const originalKey = config.stripeSecretKey;
  config.stripeSecretKey = '';
  
  delete require.cache[require.resolve('../server/stripe')];
  const { createCheckoutSession } = require('../server/stripe');
  
  const result = await createCheckoutSession(
    { id: 1, stripe_customer_id: 'cus_test' },
    'http://localhost/success',
    'http://localhost/cancel'
  );
  
  expect(result.success).toBe(false);
  expect(result.error).toBe('Stripe not configured');
  
  config.stripeSecretKey = originalKey;
});

test('createCheckoutSession returns error when price not configured', async () => {
  const originalKey = config.stripeSecretKey;
  const originalPrice = config.stripePriceId;
  config.stripeSecretKey = 'sk_test_fake';
  config.stripePriceId = '';
  
  delete require.cache[require.resolve('../server/stripe')];
  const { createCheckoutSession } = require('../server/stripe');
  
  const result = await createCheckoutSession(
    { id: 1, stripe_customer_id: 'cus_test' },
    'http://localhost/success',
    'http://localhost/cancel'
  );
  
  expect(result.success).toBe(false);
  expect(result.error).toBe('STRIPE_PRICE_ID not configured');
  
  config.stripeSecretKey = originalKey;
  config.stripePriceId = originalPrice;
});

test('createCheckoutSession returns error when customer not synced', async () => {
  const originalKey = config.stripeSecretKey;
  const originalPrice = config.stripePriceId;
  config.stripeSecretKey = 'sk_test_fake';
  config.stripePriceId = 'price_test';
  
  delete require.cache[require.resolve('../server/stripe')];
  const { createCheckoutSession } = require('../server/stripe');
  
  const result = await createCheckoutSession(
    { id: 1, stripe_customer_id: null },
    'http://localhost/success',
    'http://localhost/cancel'
  );
  
  expect(result.success).toBe(false);
  expect(result.error).toBe('Sync Stripe Customer first');
  
  config.stripeSecretKey = originalKey;
  config.stripePriceId = originalPrice;
});
