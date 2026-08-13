'use strict';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[?:*]+$/g, '')
    .trim();
}

function isObviousLabelEcho(field, value) {
  const answer = normalizeText(value);
  if (!answer) return true;

  const question = normalizeText(field && field.question);
  if (question && answer === question) return true;

  const genericLabels = new Set([
    'filename',
    'file name',
    'checkbox item',
    'checkbox items',
    'radio item',
    'radio items',
    'dropdown item',
    'dropdown items',
    'select an option',
    'select option',
    'choose an option',
    'choose option'
  ]);
  return genericLabels.has(answer);
}

function validateAnswers(fields, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('AI response must be a JSON object keyed by field id.');
  }

  const safe = {};
  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(answers, field.id) ? answers[field.id] : null;

    if (value === null || value === undefined) {
      safe[field.id] = null;
      continue;
    }

    if (field.type === 'radio' || field.type === 'dropdown') {
      safe[field.id] =
        typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value)
          ? value
          : null;
      continue;
    }

    if (field.type === 'checkbox') {
      if (!Array.isArray(value) || !Array.isArray(field.options)) {
        safe[field.id] = null;
        continue;
      }
      safe[field.id] = [...new Set(value.filter(v => typeof v === 'string' && field.options.includes(v)))];
      continue;
    }

    if (field.type === 'text' || field.type === 'paragraph') {
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        safe[field.id] = null;
        continue;
      }
      const stringValue = String(value).trim();
      safe[field.id] = !stringValue || isObviousLabelEcho(field, stringValue) ? null : stringValue;
      continue;
    }

    safe[field.id] = value;
  }

  return safe;
}

module.exports = { isObviousLabelEcho, normalizeText, validateAnswers };
