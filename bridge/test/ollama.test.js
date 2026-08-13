'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOllamaClient, OllamaRuntimeError } = require('../lib/ollama');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test('ensureReady verifies model and preloads it with a longer warmup budget', async () => {
  const calls = [];
  const client = createOllamaClient({
    model: 'qwen3:4b-instruct',
    keepAlive: '10m',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/api/tags')) return response(200, { models: [{ name: 'qwen3:4b-instruct' }] });
      return response(200, { done: true });
    }
  });

  await client.ensureReady();
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/tags$/);
  assert.match(calls[1].url, /\/api\/generate$/);
  const warmupBody = JSON.parse(calls[1].init.body);
  assert.equal(warmupBody.model, 'qwen3:4b-instruct');
  assert.equal(warmupBody.keep_alive, '10m');
  assert.equal(warmupBody.stream, false);
});

test('ensureReady reports a missing configured model distinctly', async () => {
  const client = createOllamaClient({
    model: 'qwen3:4b-instruct',
    fetchImpl: async () => response(200, { models: [{ name: 'llama3.2:latest' }] })
  });

  await assert.rejects(client.ensureReady(), error => {
    assert.ok(error instanceof OllamaRuntimeError);
    assert.equal(error.code, 'OLLAMA_MODEL_NOT_FOUND');
    assert.match(error.message, /ollama pull qwen3:4b-instruct/);
    return true;
  });
});

test('maps connection refusal to OLLAMA_UNREACHABLE', async () => {
  const client = createOllamaClient({
    fetchImpl: async () => {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
  });

  await assert.rejects(client.ensureReady(), error => {
    assert.equal(error.code, 'OLLAMA_UNREACHABLE');
    return true;
  });
});

test('maps an aborted chat request to an inference timeout', async () => {
  const client = createOllamaClient({
    inferenceTimeoutMs: 5,
    fetchImpl: (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });

  await assert.rejects(client.chat('hello'), error => {
    assert.equal(error.code, 'OLLAMA_INFERENCE_TIMEOUT');
    return true;
  });
});
