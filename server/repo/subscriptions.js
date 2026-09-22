'use strict';

async function getByMemberId(db, memberId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE member_id = $1',
    [memberId]
  );
  return rows[0] || null;
}

async function upsertIncomplete(db, memberId, stripePriceId) {
  const { rows } = await db.query(`
    INSERT INTO subscriptions (member_id, stripe_price_id, status)
    VALUES ($1, $2, 'incomplete')
    ON CONFLICT (member_id) DO UPDATE SET
      stripe_price_id = EXCLUDED.stripe_price_id,
      status = 'incomplete',
      updated_at = now()
    RETURNING *
  `, [memberId, stripePriceId]);
  return rows[0];
}

async function updateStatus(db, memberId, status) {
  const { rows } = await db.query(`
    UPDATE subscriptions SET status = $2, updated_at = now()
    WHERE member_id = $1 RETURNING *
  `, [memberId, status]);
  return rows[0] || null;
}

async function updateFromStripeSubscription(db, memberId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd) {
  const { rows } = await db.query(`
    UPDATE subscriptions SET
      stripe_subscription_id = $2,
      status = $3,
      current_period_end = $4,
      cancel_at_period_end = $5,
      updated_at = now()
    WHERE member_id = $1 RETURNING *
  `, [memberId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd]);
  return rows[0] || null;
}

function hasActiveSubscription(subscription) {
  if (!subscription) return false;
  return subscription.status === 'active' || subscription.status === 'trialing';
}

module.exports = {
  getByMemberId,
  upsertIncomplete,
  updateStatus,
  updateFromStripeSubscription,
  hasActiveSubscription,
};
