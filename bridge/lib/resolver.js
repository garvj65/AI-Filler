'use strict';

const { matchDeterministic } = require('./matcher');

async function resolveFields({ fields, profile, aiFallback, aiSource = 'ai' }) {
  const deterministic = matchDeterministic(fields, profile);
  const answers = { ...deterministic.answers };
  const sources = { ...deterministic.sources };

  if (deterministic.unresolved.length > 0) {
    const fallbackAnswers = await aiFallback(deterministic.unresolved);
    for (const field of deterministic.unresolved) {
      const value = Object.prototype.hasOwnProperty.call(fallbackAnswers, field.id)
        ? fallbackAnswers[field.id]
        : null;
      answers[field.id] = value;
      sources[field.id] = value === null || value === undefined ? 'unanswered' : aiSource;
    }
  }

  const orderedAnswers = {};
  const orderedSources = {};
  for (const field of fields) {
    orderedAnswers[field.id] = Object.prototype.hasOwnProperty.call(answers, field.id) ? answers[field.id] : null;
    orderedSources[field.id] = sources[field.id] || 'unanswered';
  }

  return {
    answers: orderedAnswers,
    sources: orderedSources,
    unresolvedCount: deterministic.unresolved.length
  };
}

module.exports = { resolveFields };
