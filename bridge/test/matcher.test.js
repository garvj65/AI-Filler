'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchDeterministic, normalizeQuestion } = require('../lib/matcher');
const { resolveFields } = require('../lib/resolver');

function profile() {
  return {
    schema_version: 1,
    personal: {
      full_name: 'Garv Jhajharia', first_name: 'Garv', last_name: 'Jhajharia',
      primary_email: 'garv@example.com', phone: '+91 9999999999',
      location: { city: 'Bengaluru', state: 'Karnataka', country: 'India' }
    },
    links: { linkedin: 'https://linkedin.com/in/garv', github: 'https://github.com/garv', portfolio: 'https://garv.dev' },
    education: [{ institution: 'BMSIT&M', degree: 'B.E. Computer Science', graduation_year: '2026' }],
    experience: [],
    current_employment: { company: 'Example Labs', role: 'AI Engineer', years_of_experience: '1 year' },
    skills: ['Python', 'JavaScript', 'SQL'],
    job_preferences: { notice_period: 'Immediate', current_ctc: '4 LPA', expected_ctc: '15 LPA', willing_to_relocate: true, availability: 'Immediately' },
    documents: {},
    learned_answers: [{ question: 'Why are you interested in this role?', answer: 'I enjoy applied AI work.' }]
  };
}

test('normalizes common prompt prefixes without fuzzy matching', () => {
  assert.equal(normalizeQuestion('Please enter your Email Address *'), 'email address');
  assert.equal(normalizeQuestion('What is your Full Name?'), 'full name');
});

test('matches common canonical profile fields directly', () => {
  const fields = [
    { id: 'n', question: 'Full Name', type: 'text' },
    { id: 'e', question: 'Email Address', type: 'text' },
    { id: 'p', question: 'Mobile Number', type: 'text' },
    { id: 'l', question: 'LinkedIn Profile URL', type: 'text' },
    { id: 'g', question: 'GitHub', type: 'text' },
    { id: 'c', question: 'Current City', type: 'text' }
  ];
  const result = matchDeterministic(fields, profile());
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.answers, {
    n: 'Garv Jhajharia', e: 'garv@example.com', p: '+91 9999999999',
    l: 'https://linkedin.com/in/garv', g: 'https://github.com/garv', c: 'Bengaluru'
  });
});

test('matches education, employment and compensation fields', () => {
  const fields = [
    { id: 'degree', question: 'Highest Degree', type: 'text' },
    { id: 'college', question: 'College Name', type: 'text' },
    { id: 'year', question: 'Year of Graduation', type: 'text' },
    { id: 'role', question: 'Current Job Title', type: 'text' },
    { id: 'company', question: 'Current Employer', type: 'text' },
    { id: 'notice', question: 'Notice Period', type: 'text' },
    { id: 'ctc', question: 'Current CTC', type: 'text' },
    { id: 'expected', question: 'Expected CTC', type: 'text' }
  ];
  const result = matchDeterministic(fields, profile());
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.answers.degree, 'B.E. Computer Science');
  assert.equal(result.answers.college, 'BMSIT&M');
  assert.equal(result.answers.year, '2026');
  assert.equal(result.answers.role, 'AI Engineer');
  assert.equal(result.answers.company, 'Example Labs');
  assert.equal(result.answers.notice, 'Immediate');
  assert.equal(result.answers.ctc, '4 LPA');
  assert.equal(result.answers.expected, '15 LPA');
});

test('maps booleans and skills only to actual page options', () => {
  const fields = [
    { id: 'relocate', question: 'Are you willing to relocate?', type: 'radio', options: ['Yes', 'No'] },
    { id: 'skills', question: 'Technical Skills', type: 'checkbox', options: ['Python', 'Rust', 'SQL'] }
  ];
  const result = matchDeterministic(fields, profile());
  assert.deepEqual(result.answers, { relocate: 'Yes', skills: ['Python', 'SQL'] });
});

test('does not overmatch unrelated questions', () => {
  const fields = [
    { id: 'heard', question: 'How did you hear about us?', type: 'text' },
    { id: 'story', question: 'Tell us about a difficult project', type: 'paragraph' }
  ];
  const result = matchDeterministic(fields, profile());
  assert.deepEqual(result.answers, {});
  assert.deepEqual(result.unresolved.map(f => f.id), ['heard', 'story']);
});

test('uses exact-normalized learned answers after canonical profile matching', () => {
  const p = profile();
  p.learned_answers.push({ question: 'Email Address', answer: 'stale@example.com' });
  const fields = [
    { id: 'email', question: 'Email Address', type: 'text' },
    { id: 'why', question: 'Why are you interested in this role?', type: 'paragraph' }
  ];
  const result = matchDeterministic(fields, p);
  assert.equal(result.answers.email, 'garv@example.com');
  assert.equal(result.sources.email, 'profile');
  assert.equal(result.answers.why, 'I enjoy applied AI work.');
  assert.equal(result.sources.why, 'learned');
});

test('skips AI fallback entirely when every field resolves deterministically', async () => {
  let calls = 0;
  const result = await resolveFields({
    fields: [
      { id: 'name', question: 'Candidate Name', type: 'text' },
      { id: 'email', question: 'Email', type: 'text' }
    ],
    profile: profile(),
    aiSource: 'groq',
    aiFallback: async () => { calls++; return {}; }
  });
  assert.equal(calls, 0);
  assert.equal(result.unresolvedCount, 0);
  assert.deepEqual(result.sources, { name: 'profile', email: 'profile' });
});

test('sends only unresolved fields to the selected AI provider and merges answers in original order', async () => {
  let received = null;
  const fields = [
    { id: 'name', question: 'Full Name', type: 'text' },
    { id: 'why', question: 'Why this company?', type: 'paragraph' },
    { id: 'github', question: 'GitHub URL', type: 'text' }
  ];
  const result = await resolveFields({
    fields,
    profile: profile(),
    aiSource: 'groq',
    aiFallback: async unresolved => {
      received = unresolved;
      return { why: 'Because the product is interesting.' };
    }
  });
  assert.deepEqual(received.map(f => f.id), ['why']);
  assert.deepEqual(result.answers, {
    name: 'Garv Jhajharia',
    why: 'Because the product is interesting.',
    github: 'https://github.com/garv'
  });
  assert.deepEqual(result.sources, { name: 'profile', why: 'groq', github: 'profile' });
});
