'use strict';

const { config } = require('./config');

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

async function createCheckoutSession(member, successUrl, cancelUrl) {
  const stripe = getStripe();
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }

  if (!config.stripePriceId) {
    return { success: false, error: 'STRIPE_PRICE_ID not configured' };
  }

  if (!member.stripe_customer_id) {
    return { success: false, error: 'Sync Stripe Customer first' };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: member.stripe_customer_id,
      line_items: [{
        price: config.stripePriceId,
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        memberId: String(member.id),
      },
    });
    return { success: true, sessionId: session.id, url: session.url };
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

module.exports = { getStripe, createOrRetrieveCustomer, createCheckoutSession };
