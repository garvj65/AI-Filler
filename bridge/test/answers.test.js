'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isObviousLabelEcho, validateAnswers } = require('../lib/answers');

test('normalizes blank text answers to null', () => {
  const fields = [{ id: 'q0', question: 'Email', type: 'text' }];
  assert.deepEqual(validateAnswers(fields, { q0: '   ' }), { q0: null });
});

test('rejects an answer that simply echoes the field question', () => {
  const fields = [{ id: 'q0', question: 'Filename:', type: 'text' }];
  assert.deepEqual(validateAnswers(fields, { q0: 'Filename:' }), { q0: null });
  assert.equal(isObviousLabelEcho(fields[0], 'Filename'), true);
});

test('keeps useful profile-derived text', () => {
  const fields = [{ id: 'q0', question: 'What is your full name?', type: 'text' }];
  assert.deepEqual(validateAnswers(fields, { q0: 'Garv Jhajharia' }), { q0: 'Garv Jhajharia' });
});

test('keeps only valid checkbox options and rejects invalid dropdowns', () => {
  const fields = [
    { id: 'q0', question: 'Skills', type: 'checkbox', options: ['Python', 'JavaScript'] },
    { id: 'q1', question: 'City', type: 'dropdown', options: ['Bengaluru', 'Hyderabad'] }
  ];
  assert.deepEqual(validateAnswers(fields, { q0: ['Python', 'Rust', 'Python'], q1: 'Goa' }), {
    q0: ['Python'],
    q1: null
  });
});
