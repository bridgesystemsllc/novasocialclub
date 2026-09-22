'use strict';

const express = require('express');
const { config } = require('../config');
const { getStripe } = require('../stripe');
const webhookEvents = require('../repo/webhook_events');
const subscriptionsRepo = require('../repo/subscriptions');
const membersRepo = require('../repo/members');
const { sendEmail, paymentFailedEmail, subscriptionCanceledEmail } = require('../email');

function createRouter(getDb) {
  const router = express.Router();

  router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      console.warn('[stripe-webhook] Stripe not configured');
      return res.status(500).send('Stripe not configured');
    }

    if (!config.stripeWebhookSecret) {
      console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      console.warn('[stripe-webhook] missing stripe-signature header');
      return res.status(400).send('Missing stripe-signature header');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    } catch (err) {
      console.warn('[stripe-webhook] bad signature:', err.message);
      return res.status(400).send('Bad signature');
    }

    const db = await getDb();

    const existing = await webhookEvents.findById(db, event.id);
    if (existing) {
      console.log(`[stripe-webhook] duplicate ${event.id} ignored`);
      return res.status(200).send('OK');
    }

    try {
      await processEvent(db, event);
      await webhookEvents.record(db, event.id, event.type);
      console.log(`[stripe-webhook] processed ${event.type} ${event.id}`);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('[stripe-webhook] handler error:', err);
      return res.status(500).send('Handler error');
    }
  });

  return router;
}

async function processEvent(db, event) {
  const { type, data } = event;
  const obj = data.object;

  switch (type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(db, obj);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(db, obj);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(db, obj);
      break;

    case 'invoice.paid':
      await handleInvoicePaid(db, obj);
      break;

    case 'checkout.session.completed':
      await handleCheckoutCompleted(db, obj);
      break;

    default:
      console.log(`[stripe-webhook] unhandled event type: ${type}`);
  }
}

async function handleSubscriptionUpdated(db, subscription) {
  const status = subscription.status;
  const stripeSubscriptionId = subscription.id;
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end || false;
  const customerId = subscription.customer;

  let sub = await subscriptionsRepo.getByStripeSubscriptionId(db, stripeSubscriptionId);

  if (sub) {
    await subscriptionsRepo.updateFromStripeSubscription(
      db, sub.member_id, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd
    );
    console.log(`[stripe-webhook] updated subscription ${stripeSubscriptionId} → ${status}`);
  } else {
    const member = await membersRepo.getByStripeCustomerId(db, customerId);
    if (member) {
      const priceId = subscription.items?.data?.[0]?.price?.id || config.stripePriceId;
      await subscriptionsRepo.createFromWebhook(
        db, member.id, stripeSubscriptionId, priceId, status, currentPeriodEnd, cancelAtPeriodEnd
      );
      console.log(`[stripe-webhook] created subscription ${stripeSubscriptionId} for member ${member.id}`);
    } else {
      const memberId = subscription.metadata?.memberId;
      if (memberId) {
        const priceId = subscription.items?.data?.[0]?.price?.id || config.stripePriceId;
        await subscriptionsRepo.createFromWebhook(
          db, parseInt(memberId, 10), stripeSubscriptionId, priceId, status, currentPeriodEnd, cancelAtPeriodEnd
        );
        console.log(`[stripe-webhook] created subscription ${stripeSubscriptionId} for member ${memberId} (from metadata)`);
      } else {
        console.warn(`[stripe-webhook] no member found for customer ${customerId}, subscription ${stripeSubscriptionId}`);
      }
    }
  }
}

async function handleSubscriptionDeleted(db, subscription) {
  const stripeSubscriptionId = subscription.id;
  const sub = await subscriptionsRepo.getByStripeSubscriptionId(db, stripeSubscriptionId);
  
  if (sub) {
    await subscriptionsRepo.updateFromStripeSubscription(
      db, sub.member_id, stripeSubscriptionId, 'canceled', sub.current_period_end, false
    );
    console.log(`[stripe-webhook] subscription ${stripeSubscriptionId} → canceled`);
    
    const member = await membersRepo.getById(db, sub.member_id);
    if (member) {
      const { subject, html } = subscriptionCanceledEmail(member);
      await sendEmail(db, { to: member.email, subject, html, type: 'subscription_canceled', memberId: member.id });
    }
  } else {
    console.warn(`[stripe-webhook] deleted subscription ${stripeSubscriptionId} not found locally`);
  }
}

async function handlePaymentFailed(db, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    console.log('[stripe-webhook] invoice.payment_failed without subscription, skipping');
    return;
  }

  const sub = await subscriptionsRepo.getByStripeSubscriptionId(db, subscriptionId);
  if (sub) {
    const member = await membersRepo.getById(db, sub.member_id);
    if (member) {
      const { subject, html } = paymentFailedEmail(member);
      await sendEmail(db, { to: member.email, subject, html, type: 'payment_failed', memberId: member.id });
      console.log(`[stripe-webhook] payment_failed email sent to ${member.email}`);
    }
  } else {
    console.warn(`[stripe-webhook] payment_failed for unknown subscription ${subscriptionId}`);
  }
}

async function handleInvoicePaid(db, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    console.log('[stripe-webhook] invoice.paid without subscription, skipping');
    return;
  }

  const sub = await subscriptionsRepo.getByStripeSubscriptionId(db, subscriptionId);
  if (sub && sub.status !== 'active') {
    await subscriptionsRepo.updateStatus(db, sub.member_id, 'active');
    console.log(`[stripe-webhook] subscription ${subscriptionId} reinforced → active`);
  }
}

async function handleCheckoutCompleted(db, session) {
  const subscriptionId = session.subscription;
  const memberId = session.metadata?.memberId;

  if (!subscriptionId) {
    console.log('[stripe-webhook] checkout.session.completed without subscription');
    return;
  }

  if (memberId) {
    const existingSub = await subscriptionsRepo.getByMemberId(db, parseInt(memberId, 10));
    if (existingSub && !existingSub.stripe_subscription_id) {
      await subscriptionsRepo.updateFromStripeSubscription(
        db, parseInt(memberId, 10), subscriptionId, 'active', null, false
      );
      console.log(`[stripe-webhook] linked subscription ${subscriptionId} to member ${memberId}`);
    }
  }
}

module.exports = createRouter;
