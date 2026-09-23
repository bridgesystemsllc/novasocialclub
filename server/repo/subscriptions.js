'use strict';

async function getByMemberId(db, memberId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE member_id = $1',
    [memberId]
  );
  return rows[0] || null;
}

async function getByStripeSubscriptionId(db, stripeSubscriptionId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
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

async function createFromWebhook(db, memberId, stripeSubscriptionId, stripePriceId, status, currentPeriodEnd, cancelAtPeriodEnd) {
  const { rows } = await db.query(`
    INSERT INTO subscriptions (member_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (member_id) DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      stripe_price_id = EXCLUDED.stripe_price_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = now()
    RETURNING *
  `, [memberId, stripeSubscriptionId, stripePriceId, status, currentPeriodEnd, cancelAtPeriodEnd]);
  return rows[0];
}

async function listWithMembers(db, { q, status, levelId } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conditions.push(`(lower(m.first_name) LIKE $${idx} OR lower(m.last_name) LIKE $${idx} OR lower(m.email) LIKE $${idx})`);
    params.push(like);
    idx++;
  }

  if (status === 'none') {
    conditions.push('s.id IS NULL');
  } else if (status && status !== 'all') {
    conditions.push(`s.status = $${idx}`);
    params.push(status);
    idx++;
  }

  if (levelId && levelId !== 'all') {
    conditions.push(`m.membership_level_id = $${idx}`);
    params.push(Number(levelId));
    idx++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(`
    SELECT 
      m.id as member_id,
      m.first_name,
      m.last_name,
      m.email,
      m.stripe_customer_id,
      l.name as level_name,
      s.id as subscription_id,
      s.stripe_subscription_id,
      s.status as subscription_status,
      s.current_period_end,
      s.cancel_at_period_end
    FROM members m
    LEFT JOIN subscriptions s ON s.member_id = m.id
    LEFT JOIN membership_levels l ON l.id = m.membership_level_id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT 200
  `, params);
  return rows;
}

async function countsByStatus(db) {
  const { rows } = await db.query(`
    SELECT 
      COALESCE(s.status, 'none') as status,
      COUNT(*)::int as count
    FROM members m
    LEFT JOIN subscriptions s ON s.member_id = m.id
    GROUP BY COALESCE(s.status, 'none')
  `);
  const counts = { active: 0, past_due: 0, canceled: 0, none: 0 };
  for (const row of rows) {
    if (row.status === 'active' || row.status === 'trialing') {
      counts.active += row.count;
    } else if (row.status === 'past_due') {
      counts.past_due += row.count;
    } else if (row.status === 'canceled') {
      counts.canceled += row.count;
    } else if (row.status === 'none') {
      counts.none += row.count;
    }
  }
  return counts;
}

module.exports = {
  getByMemberId,
  getByStripeSubscriptionId,
  upsertIncomplete,
  updateStatus,
  updateFromStripeSubscription,
  createFromWebhook,
  hasActiveSubscription,
  listWithMembers,
  countsByStatus,
};
