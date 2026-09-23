'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.USE_MEMORY_DB = '1';
process.env.SESSION_SECRET = 'test-secret';

const { getDb, closeDb } = require('../db');
const { migrate } = require('../migrate');
const membersRepo = require('../repo/members');
const auth = require('../auth');
const { sendEmail, passwordResetEmail, __setSender } = require('../email');

let db;
let sentEmails = [];

describe('Password Reset Flow', async () => {
  beforeEach(async () => {
    db = await getDb();
    await migrate(db);
    sentEmails = [];
    __setSender(async (msg) => { sentEmails.push(msg); return { id: 'test-id' }; });
  });

  afterEach(async () => {
    await closeDb();
    __setSender(null);
  });

  test('getByResetToken finds member with matching token', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, password_hash, reset_password_token, reset_token_expires_at, status)
      VALUES ('Test', 'User', 'test@example.com', 'hash123', 'test-token', NOW() + INTERVAL '1 hour', 'active')
    `);

    const found = await membersRepo.getByResetToken(db, 'test-token');
    assert.ok(found);
    assert.strictEqual(found.email, 'test@example.com');

    const notFound = await membersRepo.getByResetToken(db, 'wrong-token');
    assert.strictEqual(notFound, null);
  });

  test('setResetToken updates member with token and expiry', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, password_hash, status)
      VALUES ('Test', 'User', 'test@example.com', 'hash123', 'active')
    `);
    const { rows } = await db.query('SELECT id FROM members WHERE email=$1', ['test@example.com']);
    const memberId = rows[0].id;

    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await membersRepo.setResetToken(db, memberId, 'new-token', expires);

    const member = await membersRepo.getById(db, memberId);
    assert.strictEqual(member.reset_password_token, 'new-token');
    assert.ok(member.reset_token_expires_at);
  });

  test('updatePasswordAndClearResetToken clears reset fields after password update', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, password_hash, reset_password_token, reset_token_expires_at, status)
      VALUES ('Test', 'User', 'test@example.com', 'old-hash', 'test-token', NOW() + INTERVAL '1 hour', 'active')
    `);
    const { rows } = await db.query('SELECT id FROM members WHERE email=$1', ['test@example.com']);
    const memberId = rows[0].id;

    const newHash = await auth.hashPassword('newpassword123');
    await membersRepo.updatePasswordAndClearResetToken(db, memberId, newHash);

    const member = await membersRepo.getById(db, memberId);
    assert.strictEqual(member.reset_password_token, null);
    assert.strictEqual(member.reset_token_expires_at, null);
    assert.ok(await auth.verifyPassword('newpassword123', member.password_hash));
  });

  test('passwordResetEmail generates correct email content', () => {
    const member = { first_name: 'John' };
    const url = 'https://example.com/member/reset-password?token=abc123';
    const email = passwordResetEmail(member, url);

    assert.strictEqual(email.subject, 'Reset your NOVA Social Club password');
    assert.ok(email.html.includes('John'));
    assert.ok(email.html.includes(url));
    assert.ok(email.html.includes('1 hour'));
  });

  test('sendEmail logs password_reset type to email_log', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, password_hash, status)
      VALUES ('Test', 'User', 'test@example.com', 'hash123', 'active')
    `);
    const { rows } = await db.query('SELECT id FROM members WHERE email=$1', ['test@example.com']);
    const memberId = rows[0].id;

    await sendEmail(db, {
      to: 'test@example.com',
      subject: 'Reset your password',
      html: '<p>Reset link</p>',
      type: 'password_reset',
      memberId
    });

    const { rows: logs } = await db.query('SELECT * FROM email_log WHERE type=$1', ['password_reset']);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].to_email, 'test@example.com');
    assert.strictEqual(logs[0].type, 'password_reset');
    assert.strictEqual(logs[0].status, 'sent');
  });

  test('expired token is rejected', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, password_hash, reset_password_token, reset_token_expires_at, status)
      VALUES ('Test', 'User', 'test@example.com', 'hash123', 'expired-token', NOW() - INTERVAL '1 hour', 'active')
    `);

    const member = await membersRepo.getByResetToken(db, 'expired-token');
    assert.ok(member);
    const valid = member && member.reset_token_expires_at && new Date(member.reset_token_expires_at) > new Date();
    assert.strictEqual(valid, false);
  });

  test('set_password_token columns remain separate from reset_password_token', async () => {
    await db.query(`
      INSERT INTO members (first_name, last_name, email, set_password_token, token_expires_at, reset_password_token, reset_token_expires_at, status)
      VALUES ('Test', 'User', 'test@example.com', 'set-token', NOW() + INTERVAL '7 days', 'reset-token', NOW() + INTERVAL '1 hour', 'active')
    `);

    const bySetToken = await membersRepo.getBySetToken(db, 'set-token');
    assert.ok(bySetToken);
    assert.strictEqual(bySetToken.email, 'test@example.com');

    const byResetToken = await membersRepo.getByResetToken(db, 'reset-token');
    assert.ok(byResetToken);
    assert.strictEqual(byResetToken.email, 'test@example.com');

    assert.strictEqual(bySetToken.set_password_token, 'set-token');
    assert.strictEqual(byResetToken.reset_password_token, 'reset-token');

    const newHash = await auth.hashPassword('newpassword');
    await membersRepo.updatePasswordAndClearResetToken(db, byResetToken.id, newHash);

    const afterReset = await membersRepo.getById(db, byResetToken.id);
    assert.strictEqual(afterReset.set_password_token, 'set-token');
    assert.strictEqual(afterReset.reset_password_token, null);
  });
});
