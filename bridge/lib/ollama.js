'use strict';

class OllamaRuntimeError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'OllamaRuntimeError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function normalizeHost(host) {
  return String(host || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

function modelMatches(configured, candidate) {
  if (!candidate) return false;
  if (candidate === configured) return true;
  if (!configured.includes(':') && candidate === `${configured}:latest`) return true;
  return false;
}

function createOllamaClient(options = {}) {
  const host = normalizeHost(options.host || process.env.OLLAMA_HOST);
  const model = options.model || process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
  const inferenceTimeoutMs = Number(options.inferenceTimeoutMs || process.env.AI_TIMEOUT_MS || 120000);
  const readinessTimeoutMs = Number(options.readinessTimeoutMs || process.env.OLLAMA_READINESS_TIMEOUT_MS || 10000);
  const warmupTimeoutMs = Number(options.warmupTimeoutMs || process.env.OLLAMA_WARMUP_TIMEOUT_MS || 300000);
  const keepAlive = options.keepAlive || process.env.OLLAMA_KEEP_ALIVE || '10m';
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required (Node.js 18+ includes one).');
  }

  async function request(path, init, timeoutMs, phase) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${host}${path}`, { ...init, signal: controller.signal });
      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); } catch (_) {}
      }

      if (!response.ok) {
        const detail = payload && payload.error ? payload.error : text || 'No error body returned.';
        throw new OllamaRuntimeError(
          phase === 'warmup' ? 'OLLAMA_WARMUP_FAILED' : 'OLLAMA_REQUEST_FAILED',
          `Ollama ${phase} request failed (${response.status}): ${String(detail).slice(0, 500)}`
        );
      }
      return payload || {};
    } catch (error) {
      if (error instanceof OllamaRuntimeError) throw error;
      if (error && error.name === 'AbortError') {
        const code = phase === 'warmup' ? 'OLLAMA_WARMUP_TIMEOUT' : phase === 'readiness' ? 'OLLAMA_READINESS_TIMEOUT' : 'OLLAMA_INFERENCE_TIMEOUT';
        throw new OllamaRuntimeError(code, `Ollama ${phase} timed out after ${timeoutMs} ms.`, error);
      }
      const causeCode = error && error.cause && error.cause.code;
      if (causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND' || causeCode === 'EHOSTUNREACH') {
        throw new OllamaRuntimeError(
          'OLLAMA_UNREACHABLE',
          `Could not reach Ollama at ${host}. Make sure Ollama is running.`,
          error
        );
      }
      throw new OllamaRuntimeError('OLLAMA_REQUEST_FAILED', `Ollama ${phase} request failed: ${error.message || error}`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function listModels() {
    const payload = await request('/api/tags', { method: 'GET' }, readinessTimeoutMs, 'readiness');
    return Array.isArray(payload.models) ? payload.models : [];
  }

  async function ensureReady() {
    const models = await listModels();
    const found = models.some(item => modelMatches(model, item.name || item.model));
    if (!found) {
      throw new OllamaRuntimeError(
        'OLLAMA_MODEL_NOT_FOUND',
        `Ollama is running, but model "${model}" is not installed. Run: ollama pull ${model}`
      );
    }

    const startedAt = Date.now();
    await request(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, keep_alive: keepAlive })
      },
      warmupTimeoutMs,
      'warmup'
    );

    return { model, host, keepAlive, warmupMs: Date.now() - startedAt };
  }

  async function chat(prompt) {
    const payload = await request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          format: 'json',
          keep_alive: keepAlive,
          options: { temperature: 0 }
        })
      },
      inferenceTimeoutMs,
      'inference'
    );

    const content = payload && payload.message && payload.message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new OllamaRuntimeError('OLLAMA_EMPTY_RESPONSE', 'Ollama returned no message content.');
    }
    return content.trim();
  }

  return {
    host,
    model,
    inferenceTimeoutMs,
    readinessTimeoutMs,
    warmupTimeoutMs,
    keepAlive,
    listModels,
    ensureReady,
    chat
  };
}

module.exports = { OllamaRuntimeError, createOllamaClient, modelMatches };
