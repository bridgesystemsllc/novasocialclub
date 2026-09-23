'use strict';
const { config } = require('./config');
const emailLog = require('./repo/emailLog');

let _sender = null; // lazily created real Resend sender; overridable in tests
function __setSender(fn) { _sender = fn; }

function realSender() {
  if (!config.resendApiKey) {
    return async (msg) => {
      console.warn(`[email] RESEND_API_KEY missing; skipping send to ${msg.to}`);
      return { id: null, skipped: true };
    };
  }
  const { Resend } = require('resend');
  const client = new Resend(config.resendApiKey);
  return async (msg) => {
    const { data, error } = await client.emails.send({ from: config.resendFrom, to: msg.to, subject: msg.subject, html: msg.html });
    if (error) throw new Error(error.message || 'resend error');
    return { id: data?.id || null };
  };
}

async function sendEmail(db, { to, subject, html, type, memberId = null }) {
  const sender = _sender || realSender();
  try {
    const out = await sender({ to, subject, html });
    await emailLog.record(db, { to, subject, type, memberId, status: out.skipped ? 'skipped' : 'sent' });
    return { ok: true, id: out.id, logged: true };
  } catch (err) {
    await emailLog.record(db, { to, subject, type, memberId, status: 'failed', error: String(err.message || err) });
    return { ok: false, id: null, logged: true };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrap = (inner) => `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#111">${inner}</div>`;

function applicationReceivedEmail(app) {
  return { subject: 'Your NOVA Social Club application', html: wrap(
    `<h2>Application received</h2><p>Hi ${esc(app.first_name)}, thanks for applying to The NOVA Social Club. Applications are reviewed on a rolling basis and we'll be in touch soon.</p>`) };
}

function adminNotifyEmail(app) {
  return { subject: `New application: ${app.first_name} ${app.last_name}`, html: wrap(
    `<h2>New application</h2><p><b>${esc(app.first_name)} ${esc(app.last_name)}</b> (${esc(app.email)})</p>
     <p>Company: ${esc(app.company)}<br>Profession: ${esc(app.profession)}<br>Area: ${esc(app.area)}<br>LinkedIn: ${esc(app.linkedin)}</p>
     <p>${esc(app.why)}</p>`) };
}

function welcomeSetPasswordEmail(member, url) {
  return { subject: 'Welcome to The NOVA Social Club — set your password', html: wrap(
    `<h2>Welcome, ${esc(member.first_name)}</h2><p>Your membership (${esc(member.membership_level)}) has been approved. Set your password to access your member page:</p>
     <p><a href="${esc(url)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">Set your password</a></p>
     <p>This link expires in 7 days.</p>`) };
}

function passwordResetEmail(member, url) {
  return { subject: 'Reset your NOVA Social Club password', html: wrap(
    `<h2>Password reset</h2><p>Hi ${esc(member.first_name)}, we received a request to reset your password for The NOVA Social Club.</p>
     <p><a href="${esc(url)}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">Reset your password</a></p>
     <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`) };
}

function rejectionEmail(app) {
  return { subject: 'An update on your NOVA Social Club application', html: wrap(
    `<h2>Thank you for applying</h2><p>Hi ${esc(app.first_name)}, thank you for your interest in The NOVA Social Club. We're unable to extend an invitation at this time, but we'd welcome a future application.</p>`) };
}

function newsletterConfirmEmail(unsubUrl) {
  return { subject: "You're subscribed to The NOVA Social Club", html: wrap(
    `<h2>You're on the list</h2><p>Thanks for subscribing to NOVA updates.</p><p style="font-size:12px;color:#666"><a href="${esc(unsubUrl)}">Unsubscribe</a></p>`) };
}

function broadcastEmail(subject, bodyHtml, unsubUrl) {
  return { subject, html: wrap(`${bodyHtml}<hr><p style="font-size:12px;color:#666"><a href="${esc(unsubUrl)}">Unsubscribe</a></p>`) };
}

function paymentFailedEmail(member) {
  return { subject: 'NOVA Social Club — payment issue', html: wrap(
    `<h2>Payment issue</h2><p>Hi ${esc(member.first_name)}, we were unable to process your latest payment for your NOVA Social Club membership.</p>
     <p>Please update your payment method in your member portal to maintain your membership benefits.</p>`) };
}

function subscriptionCanceledEmail(member) {
  return { subject: 'NOVA Social Club — subscription canceled', html: wrap(
    `<h2>Subscription canceled</h2><p>Hi ${esc(member.first_name)}, your NOVA Social Club membership has been canceled.</p>
     <p>We're sorry to see you go. If you'd like to rejoin, you can start a new subscription from your member portal.</p>`) };
}

module.exports = {
  sendEmail, __setSender,
  applicationReceivedEmail, adminNotifyEmail, welcomeSetPasswordEmail,
  passwordResetEmail, rejectionEmail, newsletterConfirmEmail, broadcastEmail,
  paymentFailedEmail, subscriptionCanceledEmail,
};
