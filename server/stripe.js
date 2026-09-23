'use strict';

const { config } = require('./config');
const subscriptionsRepo = require('./repo/subscriptions');
const { sendEmail, paymentRequestEmail } = require('./email');

let stripeInstance = null;

function getStripe() {
  if (!config.stripeSecretKey) {
    return null;
  }
  if (!stripeInstance) {
    const Stripe = require('stripe');
    stripeInstance = new Stripe(config.stripeSecretKey, {
      apiVersion: '2024-06-20',
    });
  }
  return stripeInstance;
}

function resolveCheckoutPriceId(levelStripePriceId, envStripePriceId) {
  const fromLevel = String(levelStripePriceId || '').trim();
  if (fromLevel) return fromLevel;
  const fromEnv = String(envStripePriceId || '').trim();
  if (fromEnv) return fromEnv;
  return null;
}

function formatLevelPrice(priceCents, billingInterval) {
  if (priceCents == null || priceCents === '') return null;
  const n = Number(priceCents);
  if (!Number.isFinite(n) || n < 0) return null;
  const dollars = (n / 100).toFixed(2).replace(/\.00$/, '');
  const interval = billingInterval === 'year' ? 'year' : 'month';
  return `$${dollars} / ${interval}`;
}

async function createCheckoutSession(member, successUrl, cancelUrl) {
  const stripe = getStripe();
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }

  const priceId = resolveCheckoutPriceId(member.level_stripe_price_id, config.stripePriceId);
  if (!priceId) {
    return { success: false, error: 'No Stripe Price configured for this membership level (set level Stripe Price ID or STRIPE_PRICE_ID)' };
  }

  if (!member.stripe_customer_id) {
    return { success: false, error: 'Sync Stripe Customer first' };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: member.stripe_customer_id,
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        memberId: String(member.id),
      },
    });
    return { success: true, sessionId: session.id, url: session.url, priceId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createOrRetrieveCustomer(member, applicationId) {
  const stripe = getStripe();
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }

  if (member.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(member.stripe_customer_id);
      if (customer.deleted) {
        throw new Error('Customer was deleted');
      }
      return { success: true, customerId: customer.id, existing: true };
    } catch (err) {
      // Customer doesn't exist or was deleted, create new one
    }
  }

  try {
    const customer = await stripe.customers.create({
      email: member.email,
      name: `${member.first_name} ${member.last_name}`,
      metadata: {
        memberId: String(member.id),
        applicationId: applicationId ? String(applicationId) : '',
        membershipLevel: member.membership_level || '',
      },
    }, {
      idempotencyKey: `member_${member.id}`,
    });
    return { success: true, customerId: customer.id, existing: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function emailPaymentLinkToMember(db, member, { successUrl, cancelUrl }) {
  if (!member.stripe_customer_id) {
    return { ok: false, error: 'Sync Stripe Customer first' };
  }

  const resolvedPriceId = resolveCheckoutPriceId(member.level_stripe_price_id, config.stripePriceId);
  if (!resolvedPriceId) {
    return { ok: false, error: 'No Stripe Price configured' };
  }

  const result = await createCheckoutSession(member, successUrl, cancelUrl);
  if (!result.success) {
    return { ok: false, error: result.error };
  }

  await subscriptionsRepo.upsertIncomplete(db, member.id, resolvedPriceId);

  const emailContent = paymentRequestEmail(member, result.url);
  const emailResult = await sendEmail(db, {
    to: member.email,
    subject: emailContent.subject,
    html: emailContent.html,
    type: 'payment_request',
    memberId: member.id
  });

  if (!emailResult.ok) {
    return { ok: false, error: 'Checkout session created but email failed to send', sessionCreated: true };
  }

  return { ok: true };
}

module.exports = { getStripe, createOrRetrieveCustomer, createCheckoutSession, emailPaymentLinkToMember, resolveCheckoutPriceId, formatLevelPrice };
