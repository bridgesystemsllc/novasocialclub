const { test, expect } = require('bun:test');
const v = require('../server/validate');

test('isEmail', () => {
  expect(v.isEmail('a@b.com')).toBe(true);
  expect(v.isEmail('nope')).toBe(false);
});

test('validateApplication rejects missing required fields', () => {
  const r = v.validateApplication({ first_name: '', last_name: 'X', email: 'bad' });
  expect(r.ok).toBe(false);
  expect(r.errors.length).toBeGreaterThan(0);
});

test('validateApplication returns sanitized value with db columns', () => {
  const r = v.validateApplication({
    fname: 'Ada', lname: 'Lovelace', email: ' ada@x.com ',
    phone: '555', company: 'NOVA', profession: 'Founder',
    linkedin: 'in/ada', area: 'Reston', why: 'Community',
    website: '',
  });
  expect(r.ok).toBe(true);
  expect(r.value.first_name).toBe('Ada');
  expect(r.value.email).toBe('ada@x.com');
});

test('honeypot filled => rejected as spam', () => {
  const r = v.validateApplication({ fname: 'A', lname: 'B', email: 'a@b.com', website: 'http://spam' });
  expect(r.ok).toBe(false);
  expect(r.spam).toBe(true);
});

test('validateProfile requires first and last name', () => {
  const r1 = v.validateProfile({ first_name: '', last_name: '', phone: '555' });
  expect(r1.ok).toBe(false);
  expect(r1.errors).toContain('First name is required.');
  expect(r1.errors).toContain('Last name is required.');
  
  const r2 = v.validateProfile({ first_name: 'John', last_name: 'Doe' });
  expect(r2.ok).toBe(true);
  expect(r2.value.first_name).toBe('John');
  expect(r2.value.last_name).toBe('Doe');
});

test('validateProfile sanitizes and trims input', () => {
  const r = v.validateProfile({
    first_name: '  Alice  ',
    last_name: '  Smith  ',
    phone: '  555-1234  ',
    company: '  ACME Corp  ',
    linkedin: '  linkedin.com/in/alice  '
  });
  expect(r.ok).toBe(true);
  expect(r.value.first_name).toBe('Alice');
  expect(r.value.last_name).toBe('Smith');
  expect(r.value.phone).toBe('555-1234');
  expect(r.value.company).toBe('ACME Corp');
  expect(r.value.linkedin).toBe('linkedin.com/in/alice');
});

test('validateProfile enforces max lengths', () => {
  const longStr = 'a'.repeat(600);
  const r = v.validateProfile({
    first_name: longStr,
    last_name: longStr,
    phone: longStr,
    company: longStr,
    linkedin: longStr
  });
  expect(r.value.first_name.length).toBe(100);
  expect(r.value.last_name.length).toBe(100);
  expect(r.value.phone.length).toBe(30);
  expect(r.value.company.length).toBe(200);
  expect(r.value.linkedin.length).toBe(500);
});

test('pickProfile only includes allowed fields', () => {
  const picked = v.pickProfile({
    first_name: 'John',
    last_name: 'Doe',
    phone: '555',
    company: 'Corp',
    linkedin: 'link',
    email: 'hacker@evil.com',
    status: 'superadmin',
    membership_level_id: '999'
  });
  expect(picked.first_name).toBe('John');
  expect(picked.last_name).toBe('Doe');
  expect(picked.phone).toBe('555');
  expect(picked.company).toBe('Corp');
  expect(picked.linkedin).toBe('link');
  expect(picked.email).toBeUndefined();
  expect(picked.status).toBeUndefined();
  expect(picked.membership_level_id).toBeUndefined();
});

test('PROFILE_EDITABLE contains only allowed fields', () => {
  expect(v.PROFILE_EDITABLE).toEqual(['first_name', 'last_name', 'phone', 'company', 'linkedin']);
});
