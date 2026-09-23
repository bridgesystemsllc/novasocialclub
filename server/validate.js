'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(s) { return typeof s === 'string' && EMAIL_RE.test(s.trim()); }

function cleanStr(s, max = 500) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function honeypotTripped(body) { return cleanStr(body.website, 200) !== ''; }

function validateApplication(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    first_name: cleanStr(body.fname ?? body.first_name, 80),
    last_name: cleanStr(body.lname ?? body.last_name, 80),
    email: cleanStr(body.email, 160).toLowerCase(),
    phone: cleanStr(body.phone, 40),
    company: cleanStr(body.company, 120),
    profession: cleanStr(body.profession, 120),
    linkedin: cleanStr(body.linkedin, 200),
    why: cleanStr(body.why_join ?? body.why, 2000),
    age: cleanStr(body.age, 40),
    live_va: cleanStr(body.live_va, 20),
    work_va: cleanStr(body.work_va, 20),
    industry: cleanStr(body.industry, 120),
    occupation: cleanStr(body.occupation, 120),
    goals: cleanStr(body.goals, 2000),
    area: cleanStr(body.area, 120),
  };
  const errors = [];
  if (!value.first_name) errors.push('First name is required.');
  if (!value.last_name) errors.push('Last name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  if (!value.age) errors.push('Age is required.');
  if (!value.live_va) errors.push('Do you live in Virginia is required.');
  if (!value.work_va) errors.push('Do you work in Virginia is required.');
  if (value.live_va && !['Yes', 'No'].includes(value.live_va)) errors.push('Do you live in Virginia must be Yes or No.');
  if (value.work_va && !['Yes', 'No'].includes(value.work_va)) errors.push('Do you work in Virginia must be Yes or No.');
  if (!value.industry) errors.push('Industry is required.');
  if (!value.occupation) errors.push('Occupation is required.');
  if (!value.why) errors.push('Why do you want to join is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validateNewsletter(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = { email: cleanStr(body.email, 160).toLowerCase() };
  const errors = isEmail(value.email) ? [] : ['A valid email is required.'];
  return { ok: errors.length === 0, spam: false, errors, value };
}

function validatePartner(body) {
  if (honeypotTripped(body)) return { ok: false, spam: true, errors: ['spam'], value: null };
  const value = {
    business: cleanStr(body.business, 160),
    contact_name: cleanStr(body.contact_name ?? body.name, 120),
    email: cleanStr(body.email, 160).toLowerCase(),
    message: cleanStr(body.message, 2000),
  };
  const errors = [];
  if (!value.business) errors.push('Business name is required.');
  if (!isEmail(value.email)) errors.push('A valid email is required.');
  return { ok: errors.length === 0, spam: false, errors, value };
}

const PROFILE_EDITABLE = ['first_name', 'last_name', 'phone', 'company', 'linkedin'];
const PROFILE_MAX_LENGTHS = { first_name: 100, last_name: 100, phone: 30, company: 200, linkedin: 500 };

function validateProfile(body) {
  const value = {};
  for (const k of PROFILE_EDITABLE) {
    value[k] = cleanStr(body[k], PROFILE_MAX_LENGTHS[k]);
  }
  const errors = [];
  if (!value.first_name) errors.push('First name is required.');
  if (!value.last_name) errors.push('Last name is required.');
  return { ok: errors.length === 0, errors, value };
}

function pickProfile(body) {
  const result = {};
  for (const k of PROFILE_EDITABLE) {
    result[k] = cleanStr(body[k], PROFILE_MAX_LENGTHS[k]);
  }
  return result;
}

module.exports = { isEmail, cleanStr, validateApplication, validateNewsletter, validatePartner, validateProfile, pickProfile, PROFILE_EDITABLE };
