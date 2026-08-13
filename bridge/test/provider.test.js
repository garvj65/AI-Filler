'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIProvider } = require('../lib/provider');

test('Groq is the default provider', () => {
  const provider = createAIProvider({
    groq: { apiKey: 'x', fetchImpl: async () => { throw new Error('not called'); } }
  });
  assert.equal(provider.name, 'groq');
  assert.equal(provider.model, 'llama-3.1-8b-instant');
});

test('Ollama remains opt-in', () => {
  const provider = createAIProvider({ provider: 'ollama', ollama: { model: 'local-test' } });
  assert.equal(provider.name, 'ollama');
  assert.equal(provider.model, 'local-test');
});

test('rejects unsupported providers', () => {
  assert.throws(
    () => createAIProvider({ provider: 'mystery' }),
    e => e.code === 'AI_PROVIDER_UNSUPPORTED' && e.isAIProviderError === true
  );
});
