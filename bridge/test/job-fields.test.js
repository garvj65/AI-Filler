'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchDeterministic, normalizeQuestion } = require('../lib/matcher');
const { validateProfile, migrateLegacyProfile } = require('../lib/profile');

function profile() {
  return {
    schema_version: 1,
    personal: {
      full_name: 'Garv Jhajharia', first_name: 'Garv', last_name: 'Jhajharia',
      primary_email: 'garv@example.com', alternate_email: '', phone: '+91 9999999999', gender: '',
      location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' }
    },
    links: { github: '', linkedin: '', twitter: '', portfolio: '', discord: '' },
    education: [],
    experience: [],
    current_employment: { company: 'Example Labs', role: 'AI Engineer', years_of_experience: '1 year' },
    skills: ['Python'],
    job_preferences: {
      applying_for: 'Full-time', availability: 'Immediately', current_ctc: '5 LPA', expected_ctc: '12 LPA',
      notice_period: '30 days', willing_to_relocate: true,
      work_authorization: 'Authorized to work in India', requires_sponsorship: false,
      current_employment_status: 'Employed', preferred_work_location: 'Bengaluru',
      employment_type: 'Full-time', joining_date: '2026-09-01'
    },
    documents: { resume_path: '' },
    profile_text: { bio: '', competitive_programming: '', achievements: [], notes: '' },
    learned_answers: [],
    custom: {}
  };
}

test('normalizes yes/no question prefixes before alias lookup', () => {
  assert.equal(normalizeQuestion('Are you willing to relocate?'), 'willing to relocate');
  assert.equal(normalizeQuestion('Do you require visa sponsorship?'), 'require visa sponsorship');
});

test('resolves factual employment fields directly from profile', () => {
  const fields = [
    { id: 'years', question: 'Years of Experience', type: 'text' },
    { id: 'status', question: 'Current Employment Status', type: 'text' },
    { id: 'location', question: 'Preferred Work Location', type: 'text' },
    { id: 'type', question: 'Employment Type', type: 'text' },
    { id: 'joining', question: 'Earliest Start Date', type: 'text' },
    { id: 'notice', question: 'Notice Period in Days', type: 'text' },
    { id: 'salary', question: 'Current Annual Compensation', type: 'text' }
  ];
  const result = matchDeterministic(fields, profile());
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.answers, {
    years: '1 year',
    status: 'Employed',
    location: 'Bengaluru',
    type: 'Full-time',
    joining: '2026-09-01',
    notice: '30 days',
    salary: '5 LPA'
  });
});

test('resolves work authorization and sponsorship only to real page options', () => {
  const fields = [
    {
      id: 'auth', question: 'Are you legally authorized to work in India?', type: 'dropdown',
      options: ['Authorized to work in India', 'Require work authorization', 'Not applicable']
    },
    {
      id: 'sponsor', question: 'Do you require visa sponsorship?', type: 'radio',
      options: ['Yes', 'No']
    }
  ];
  const result = matchDeterministic(fields, profile());
  assert.deepEqual(result.answers, { auth: 'Authorized to work in India', sponsor: 'No' });
  assert.equal(result.unresolved.length, 0);
});

test('abstains when a factual profile value does not exist in page options', () => {
  const fields = [
    {
      id: 'auth', question: 'Work Authorization', type: 'dropdown',
      options: ['US Citizen', 'Green Card', 'Other']
    }
  ];
  const result = matchDeterministic(fields, profile());
  assert.deepEqual(result.answers, {});
  assert.deepEqual(result.unresolved.map(field => field.id), ['auth']);
});

test('does not deterministically answer subjective role/company prompts', () => {
  const fields = [
    { id: 'whyRole', question: 'Why are you interested in this role?', type: 'paragraph' },
    { id: 'whyCompany', question: 'Why this company?', type: 'paragraph' },
    { id: 'story', question: 'Tell us about a difficult project', type: 'paragraph' }
  ];
  const result = matchDeterministic(fields, profile());
  assert.deepEqual(result.answers, {});
  assert.deepEqual(result.unresolved.map(field => field.id), ['whyRole', 'whyCompany', 'story']);
});

test('profile validator accepts new optional job preference fields', () => {
  assert.deepEqual(validateProfile(profile()), []);
  const invalid = profile();
  invalid.job_preferences.employment_type = 42;
  assert.match(validateProfile(invalid).join(';'), /job_preferences\.employment_type must be string/);
});

test('legacy migration carries new factual preference keys when present', () => {
  const migrated = migrateLegacyProfile({
    full_name: 'Jane Doe',
    current_employment_status: 'Employed',
    preferred_work_location: 'Bengaluru',
    employment_type: 'Full-time',
    start_date: '2026-09-01',
    years_of_experience: '2 years'
  });
  assert.equal(migrated.current_employment.years_of_experience, '2 years');
  assert.equal(migrated.job_preferences.current_employment_status, 'Employed');
  assert.equal(migrated.job_preferences.preferred_work_location, 'Bengaluru');
  assert.equal(migrated.job_preferences.employment_type, 'Full-time');
  assert.equal(migrated.job_preferences.joining_date, '2026-09-01');
});
