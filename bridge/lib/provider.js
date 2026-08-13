'use strict';

const { createGroqClient } = require('./groq');
const { createOllamaClient } = require('./ollama');

function createAIProviderError(code, message) {
  const error = new Error(message);
  error.name = 'AIProviderError';
  error.code = code;
  error.isAIProviderError = true;
  return error;
}

function createAIProvider(options = {}) {
  const providerName = String(
    options.provider || process.env.AI_PROVIDER || 'groq'
  ).trim().toLowerCase();

  if (providerName === 'groq') {
    return createGroqClient(options.groq || {});
  }

  if (providerName === 'ollama') {
    const client = createOllamaClient(options.ollama || {});
    return { ...client, name: 'ollama' };
  }

  throw createAIProviderError(
    'AI_PROVIDER_UNSUPPORTED',
    `Unsupported AI_PROVIDER "${providerName}". Supported providers: groq, ollama.`
  );
}

function isAIProviderError(error) {
  return Boolean(
    error &&
    (error.isAIProviderError || /^GROQ_|^OLLAMA_|^AI_PROVIDER_/.test(error.code || ''))
  );
}

module.exports = { createAIProvider, createAIProviderError, isAIProviderError };
