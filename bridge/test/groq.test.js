'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGroqClient } = require('../lib/groq');

function mockResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

test('reports missing Groq API key without making a request', async () => {
  let calls = 0;
  const client = createGroqClient({ apiKey: '', fetchImpl: async () => { calls++; } });
  await assert.rejects(client.ensureReady(), e => e.code === 'GROQ_API_KEY_MISSING');
  assert.equal(calls, 0);
});

test('sends JSON object mode request and returns Groq message content', async () => {
  let captured;
  const client = createGroqClient({
    apiKey: 'gsk_test_secret',
    model: 'llama-3.1-8b-instant',
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return mockResponse(200, { choices: [{ message: { content: '{"q1":"hello"}' } }] });
    }
  });

  await client.ensureReady();
  const content = await client.chat('Return JSON');
  assert.equal(content, '{"q1":"hello"}');
  assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(captured.body.model, 'llama-3.1-8b-instant');
  assert.deepEqual(captured.body.response_format, { type: 'json_object' });
  assert.equal(captured.init.headers.Authorization, 'Bearer gsk_test_secret');
});

test('maps Groq authentication failures without exposing the key', async () => {
  const client = createGroqClient({
    apiKey: 'super-secret',
    fetchImpl: async () => mockResponse(401, { error: { message: 'invalid api key' } })
  });
  await assert.rejects(client.chat('x'), e => {
    assert.equal(e.code, 'GROQ_AUTH_FAILED');
    assert.equal(e.message.includes('super-secret'), false);
    return true;
  });
});

test('maps Groq rate limits and exposes retry-after only', async () => {
  const client = createGroqClient({
    apiKey: 'x',
    fetchImpl: async () => mockResponse(429, { error: { message: 'rate limit' } }, { 'retry-after': '4' })
  });
  await assert.rejects(client.chat('x'), e => {
    assert.equal(e.code, 'GROQ_RATE_LIMITED');
    assert.match(e.message, /4 seconds/);
    return true;
  });
});

test('maps empty successful responses', async () => {
  const client = createGroqClient({
    apiKey: 'x',
    fetchImpl: async () => mockResponse(200, { choices: [{ message: { content: '' } }] })
  });
  await assert.rejects(client.chat('x'), e => e.code === 'GROQ_EMPTY_RESPONSE');
});

test('maps inference timeouts', async () => {
  const client = createGroqClient({
    apiKey: 'x',
    inferenceTimeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });
  await assert.rejects(client.chat('x'), e => e.code === 'GROQ_TIMEOUT');
});
