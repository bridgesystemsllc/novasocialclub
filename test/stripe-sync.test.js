const { test, expect } = require('bun:test');
const { freshDb } = require('./helpers');
const membersRepo = require('../server/repo/members');
const appsRepo = require('../server/repo/applications');
const { config } = require('../server/config');

test('stripe_customer_id column exists in members table', async () => {
  const db = await freshDb();
  
  const { rows } = await db.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'members' AND column_name = 'stripe_customer_id'
  `);
  
  expect(rows.length).toBe(1);
  await db.close();
});

test('stripe_customer_id column is unique', async () => {
  const db = await freshDb();
  
  const { rows } = await db.query(`
    SELECT constraint_name FROM information_schema.table_constraints 
    WHERE table_name = 'members' AND constraint_type = 'UNIQUE'
  `);
  
  const uniqueConstraints = rows.map(r => r.constraint_name);
  const hasStripeUnique = uniqueConstraints.some(name => 
    name.includes('stripe_customer_id') || name.includes('members_stripe')
  );
  expect(hasStripeUnique).toBe(true);
  await db.close();
});

test('setStripeCustomerId updates member', async () => {
  const db = await freshDb();
  
  const app = await appsRepo.create(db, { 
    first_name: 'Test', last_name: 'User', email: 'test@example.com',
    phone: '', company: '', profession: '', linkedin: '', area: '', why: '' 
  });
  
  const token = 'test-token-123';
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const member = await membersRepo.createFromApplication(db, app, 'member', token, expires);
  
  expect(member.stripe_customer_id).toBeNull();
  
  const updated = await membersRepo.setStripeCustomerId(db, member.id, 'cus_test123');
  expect(updated.stripe_customer_id).toBe('cus_test123');
  
  const fetched = await membersRepo.getById(db, member.id);
  expect(fetched.stripe_customer_id).toBe('cus_test123');
  
  await db.close();
});

test('createOrRetrieveCustomer returns error when Stripe not configured', async () => {
  const originalKey = config.stripeSecretKey;
  config.stripeSecretKey = '';
  
  delete require.cache[require.resolve('../server/stripe')];
  const { createOrRetrieveCustomer } = require('../server/stripe');
  
  const result = await createOrRetrieveCustomer({ id: 1, email: 'test@test.com', first_name: 'Test', last_name: 'User' }, 1);
  
  expect(result.success).toBe(false);
  expect(result.error).toBe('Stripe not configured');
  
  config.stripeSecretKey = originalKey;
});

test('getStripe returns null when key not configured', async () => {
  const originalKey = config.stripeSecretKey;
  config.stripeSecretKey = '';
  
  delete require.cache[require.resolve('../server/stripe')];
  const { getStripe } = require('../server/stripe');
  
  const stripe = getStripe();
  expect(stripe).toBeNull();
  
  config.stripeSecretKey = originalKey;
});

test('STRIPE_SECRET_KEY is in config', () => {
  expect('stripeSecretKey' in config).toBe(true);
});
