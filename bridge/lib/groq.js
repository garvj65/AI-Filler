'use strict';

class GroqRuntimeError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'GroqRuntimeError';
    this.code = code;
    this.isAIProviderError = true;
    if (cause) this.cause = cause;
  }
}

function createGroqClient(options = {}) {
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.GROQ_API_KEY || '';
  const model = options.model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const endpoint = options.endpoint || process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const inferenceTimeoutMs = Number(options.inferenceTimeoutMs || process.env.AI_TIMEOUT_MS || 60000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required (Node.js 18+ includes one).');
  }

  function ensureApiKey() {
    if (!String(apiKey).trim()) {
      throw new GroqRuntimeError(
        'GROQ_API_KEY_MISSING',
        'GROQ_API_KEY is not set. Create a Groq API key and set it in the bridge process environment.'
      );
    }
  }

  async function ensureReady() {
    ensureApiKey();
    return { provider: 'groq', model, host: new URL(endpoint).origin };
  }

  async function chat(prompt) {
    ensureApiKey();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), inferenceTimeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); } catch (_) {}
      }

      if (!response.ok) {
        const detail =
          payload && payload.error && (payload.error.message || payload.error.code)
            ? (payload.error.message || payload.error.code)
            : text || 'No error body returned.';

        if (response.status === 401 || response.status === 403) {
          throw new GroqRuntimeError(
            'GROQ_AUTH_FAILED',
            'Groq rejected the API key. Check GROQ_API_KEY and create a new key if needed.'
          );
        }
        if (response.status === 429) {
          const retryAfter = response.headers && response.headers.get
            ? response.headers.get('retry-after')
            : null;
          throw new GroqRuntimeError(
            'GROQ_RATE_LIMITED',
            `Groq rate limit reached.${retryAfter ? ` Retry after ${retryAfter} seconds.` : ''}`
          );
        }
        throw new GroqRuntimeError(
          'GROQ_REQUEST_FAILED',
          `Groq request failed (${response.status}): ${String(detail).slice(0, 500)}`
        );
      }

      const content =
        payload &&
        payload.choices &&
        payload.choices[0] &&
        payload.choices[0].message &&
        payload.choices[0].message.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new GroqRuntimeError('GROQ_EMPTY_RESPONSE', 'Groq returned no message content.');
      }
      return content.trim();
    } catch (error) {
      if (error instanceof GroqRuntimeError) throw error;
      if (error && error.name === 'AbortError') {
        throw new GroqRuntimeError(
          'GROQ_TIMEOUT',
          `Groq inference timed out after ${inferenceTimeoutMs} ms.`,
          error
        );
      }
      throw new GroqRuntimeError(
        'GROQ_REQUEST_FAILED',
        `Could not complete the Groq request: ${error && error.message ? error.message : error}`,
        error
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'groq',
    host: new URL(endpoint).origin,
    endpoint,
    model,
    inferenceTimeoutMs,
    ensureReady,
    chat
  };
}

module.exports = { GroqRuntimeError, createGroqClient };
