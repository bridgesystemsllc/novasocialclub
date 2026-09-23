'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

process.env.USE_MEMORY_DB = '1';
process.env.SESSION_SECRET = 'test-secret';

const { getDb, closeDb } = require('../db');
const { migrate } = require('../migrate');
const appsRepo = require('../repo/applications');
const V = require('../validate');
const { adminNotifyEmail, __setSender } = require('../email');

let db;
let sentEmails = [];

describe('Application Form Flow', async () => {
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

  test('validateApplication maps why_join to why', async () => {
    const body = {
      fname: 'John',
      lname: 'Doe',
      email: 'john@example.com',
      phone: '555-1234',
      company: 'Acme',
      profession: 'Engineer',
      linkedin: 'linkedin.com/in/johndoe',
      age: '31-35',
      live_va: 'Yes',
      work_va: 'No',
      industry: 'Tech',
      occupation: 'Software Engineer',
      why_join: 'Looking to network with professionals in NoVA',
      goals: 'Build community connections',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, true, `Validation failed: ${result.errors.join(', ')}`);
    assert.strictEqual(result.value.why, 'Looking to network with professionals in NoVA');
    assert.strictEqual(result.value.age, '31-35');
    assert.strictEqual(result.value.live_va, 'Yes');
    assert.strictEqual(result.value.work_va, 'No');
    assert.strictEqual(result.value.industry, 'Tech');
    assert.strictEqual(result.value.occupation, 'Software Engineer');
    assert.strictEqual(result.value.goals, 'Build community connections');
  });

  test('validateApplication accepts why without why_join (legacy)', async () => {
    const body = {
      fname: 'Jane',
      lname: 'Smith',
      email: 'jane@example.com',
      age: '25-30',
      live_va: 'Yes',
      work_va: 'Yes',
      industry: 'Finance',
      occupation: 'Analyst',
      why: 'Legacy why field',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, true, `Validation failed: ${result.errors.join(', ')}`);
    assert.strictEqual(result.value.why, 'Legacy why field');
  });

  test('validateApplication prefers why_join over why', async () => {
    const body = {
      fname: 'Test',
      lname: 'User',
      email: 'test@example.com',
      age: '21-25',
      live_va: 'No',
      work_va: 'No',
      industry: 'Healthcare',
      occupation: 'Nurse',
      why: 'old reason',
      why_join: 'new reason from form',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.value.why, 'new reason from form');
  });

  test('validateApplication rejects missing age', async () => {
    const body = {
      fname: 'No',
      lname: 'Age',
      email: 'noage@example.com',
      live_va: 'Yes',
      work_va: 'Yes',
      industry: 'Tech',
      occupation: 'Developer',
      why_join: 'Testing',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Age')));
  });

  test('validateApplication rejects missing live_va', async () => {
    const body = {
      fname: 'No',
      lname: 'LiveVA',
      email: 'noliveva@example.com',
      age: '31-35',
      work_va: 'Yes',
      industry: 'Tech',
      occupation: 'Developer',
      why_join: 'Testing',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('live in Virginia')));
  });

  test('validateApplication rejects invalid live_va value', async () => {
    const body = {
      fname: 'Bad',
      lname: 'LiveVA',
      email: 'bad@example.com',
      age: '31-35',
      live_va: 'Maybe',
      work_va: 'Yes',
      industry: 'Tech',
      occupation: 'Developer',
      why_join: 'Testing',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Yes or No')));
  });

  test('validateApplication rejects missing why_join and why', async () => {
    const body = {
      fname: 'No',
      lname: 'Why',
      email: 'nowhy@example.com',
      age: '31-35',
      live_va: 'Yes',
      work_va: 'Yes',
      industry: 'Tech',
      occupation: 'Developer',
    };

    const result = V.validateApplication(body);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Why')));
  });

  test('appsRepo.create stores all new fields', async () => {
    const value = {
      first_name: 'Alice',
      last_name: 'Wonder',
      email: 'alice@example.com',
      phone: '555-9999',
      company: 'Wonderland Inc',
      profession: 'Explorer',
      linkedin: 'linkedin.com/in/alice',
      area: '',
      why: 'Want to explore NoVA',
      age: '25-30',
      live_va: 'Yes',
      work_va: 'No',
      industry: 'Adventure',
      occupation: 'Explorer',
      goals: 'Meet new friends',
    };

    const app = await appsRepo.create(db, value);
    assert.ok(app.id);
    assert.strictEqual(app.first_name, 'Alice');
    assert.strictEqual(app.why, 'Want to explore NoVA');
    assert.strictEqual(app.age, '25-30');
    assert.strictEqual(app.live_va, 'Yes');
    assert.strictEqual(app.work_va, 'No');
    assert.strictEqual(app.industry, 'Adventure');
    assert.strictEqual(app.occupation, 'Explorer');
    assert.strictEqual(app.goals, 'Meet new friends');

    const fetched = await appsRepo.getById(db, app.id);
    assert.strictEqual(fetched.age, '25-30');
    assert.strictEqual(fetched.live_va, 'Yes');
    assert.strictEqual(fetched.work_va, 'No');
    assert.strictEqual(fetched.industry, 'Adventure');
    assert.strictEqual(fetched.occupation, 'Explorer');
    assert.strictEqual(fetched.goals, 'Meet new friends');
  });

  test('adminNotifyEmail includes new fields escaped', async () => {
    const app = {
      first_name: 'Bob',
      last_name: 'Builder',
      email: 'bob@example.com',
      company: 'Build Co',
      profession: 'Builder',
      linkedin: 'linkedin.com/in/bob',
      area: '',
      why: 'Build connections <script>',
      age: '36-40',
      live_va: 'Yes',
      work_va: 'Yes',
      industry: 'Construction',
      occupation: 'Contractor',
      goals: 'Find partners',
    };

    const email = adminNotifyEmail(app);
    assert.ok(email.html.includes('Age: 36-40'));
    assert.ok(email.html.includes('Live in Virginia: Yes'));
    assert.ok(email.html.includes('Work in Virginia: Yes'));
    assert.ok(email.html.includes('Industry: Construction'));
    assert.ok(email.html.includes('Occupation: Contractor'));
    assert.ok(email.html.includes('Build connections &lt;script&gt;'));
    assert.ok(email.html.includes('Find partners'));
    assert.ok(!email.html.includes('Area (legacy)'));
  });

  test('adminNotifyEmail shows Area (legacy) only when non-empty', async () => {
    const app = {
      first_name: 'Carol',
      last_name: 'Legacy',
      email: 'carol@example.com',
      company: '',
      profession: '',
      linkedin: '',
      area: 'Arlington',
      why: 'Test legacy',
      age: '21-25',
      live_va: 'No',
      work_va: 'No',
      industry: 'Other',
      occupation: 'Other',
      goals: '',
    };

    const email = adminNotifyEmail(app);
    assert.ok(email.html.includes('Area (legacy): Arlington'));
  });

  test('full POST flow: why_join mapped to why in DB', async () => {
    const body = {
      fname: 'Flow',
      lname: 'Test',
      email: 'flow@example.com',
      phone: '555-0000',
      company: 'FlowCo',
      profession: 'Tester',
      linkedin: 'linkedin.com/in/flow',
      age: '31-35',
      live_va: 'Yes',
      work_va: 'Yes',
      industry: 'QA',
      occupation: 'Test Engineer',
      why_join: 'Full flow test reason',
      goals: 'Verify everything works',
    };

    const validation = V.validateApplication(body);
    assert.strictEqual(validation.ok, true, `Validation failed: ${validation.errors.join(', ')}`);
    
    const app = await appsRepo.create(db, validation.value);
    assert.strictEqual(app.why, 'Full flow test reason');
    assert.strictEqual(app.age, '31-35');
    assert.strictEqual(app.live_va, 'Yes');
    assert.strictEqual(app.work_va, 'Yes');
    assert.strictEqual(app.industry, 'QA');
    assert.strictEqual(app.occupation, 'Test Engineer');
    assert.strictEqual(app.goals, 'Verify everything works');
  });
});
