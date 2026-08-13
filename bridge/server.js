#!/usr/bin/env node
// Local bridge: receives scanned form fields, asks a local Ollama model
// to match them against a validated candidate profile, and returns safe answers.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createOllamaClient, OllamaRuntimeError } = require('./lib/ollama');
const { validateAnswers } = require('./lib/answers');
const { resolveFields } = require('./lib/resolver');
const { ProfileError, getResumePath, loadProfileFromFile, saveProfileToFile } = require('./lib/profile');

const PORT = Number(process.env.PORT || 8731);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PROFILE_PATH = path.join(__dirname, '..', 'profile.json');
const ollama = createOllamaClient();

const aiState = { ready: false, status: 'starting', error: null, warmupMs: null };
const profileState = { ready: false, migratedLegacy: false, error: null };

function loadProfile() {
  const result = loadProfileFromFile(PROFILE_PATH);
  profileState.ready = true;
  profileState.migratedLegacy = result.migrated;
  profileState.error = null;
  return result.profile;
}

function initializeProfile() {
  try {
    const profile = loadProfile();
    if (profileState.migratedLegacy) {
      console.warn('Legacy profile format detected. It is supported in memory and will be saved as schema v1 after the next learned-answer update.');
    }
    console.log(`Profile schema v${profile.schema_version} ready.`);
    return profile;
  } catch (error) {
    profileState.ready = false;
    profileState.error = { code: error.code || 'PROFILE_LOAD_FAILED', message: error.message };
    console.error(`[profile] ${profileState.error.code}: ${profileState.error.message}`);
    return null;
  }
}

initializeProfile();

function buildPrompt(profile, fields) {
  let learned = '';
  if (Array.isArray(profile.learned_answers) && profile.learned_answers.length) {
    learned =
      '\n\nThe user previously answered these questions by hand. REUSE the saved answer ' +
      'whenever the same or a clearly equivalent question appears:\n' +
      profile.learned_answers
        .map(la => `- Q: ${la.question}\n  A: ${JSON.stringify(la.answer)}`)
        .join('\n');
  }

  const profileJson = JSON.stringify(profile, null, 2);
  return `You are filling out a web form on behalf of a person. Everything known about them is in this validated candidate profile JSON:\n\n${profileJson}\n${learned}\n\nBelow are the form questions scanned from the page (JSON array). Each item has: id, question, type, and (for choice fields) options.\n\n${JSON.stringify(fields, null, 2)}\n\nFor EACH question, decide the best answer using ONLY the person's data above.\nRules:\n- type "text" or "paragraph": return a plain string suited to the question.\n- type "radio" or "dropdown": return EXACTLY ONE of the given options, copied verbatim. If none fit, return null.\n- type "checkbox": return an ARRAY of zero or more of the given options, copied verbatim.\n- If you cannot answer truthfully from the data, return null. Prefer null over a guess.\n- NEVER invent emails, phone numbers, names, roll numbers, IDs, dates, employers, qualifications, or other personal facts that are not in the data.\n- NEVER use the field label, placeholder, section heading, option-group heading, or question text itself as the answer. Generic labels such as "Filename", "Checkbox Items", "Radio Items", or "Select an option" are not answers.\n- For generic demo/test fields that do not ask for a fact contained in the profile, return null.\n- Preserve saved answers exactly when the question is the same or clearly equivalent.\n\nRespond with ONLY a JSON object mapping each question id to its answer. No prose, no code fences.\nExample: {"q0":"Jane Doe","q1":"jane.doe@example.com","q2":null,"q3":["Python","JavaScript"]}`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in AI output: ' + text.slice(0, 300));
  return JSON.parse(body.slice(start, end + 1));
}

async function initializeAI() {
  aiState.status = 'checking';
  aiState.error = null;
  console.log(`Checking Ollama at ${ollama.host}...`);
  try {
    console.log(`Warming model ${ollama.model} (cold starts may take a while)...`);
    const result = await ollama.ensureReady();
    aiState.ready = true;
    aiState.status = 'ready';
    aiState.warmupMs = result.warmupMs;
    console.log(`Ollama ready: ${ollama.model} warmed in ${result.warmupMs} ms.`);
  } catch (error) {
    aiState.ready = false;
    aiState.status = 'error';
    aiState.error = { code: error.code || 'AI_INIT_FAILED', message: error.message };
    console.error(`[ai-init] ${aiState.error.code}: ${aiState.error.message}`);
  }
}

const readinessPromise = initializeAI();

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') {
    const ok = aiState.ready && profileState.ready;
    return sendJson(res, ok ? 200 : aiState.status === 'checking' && profileState.ready ? 200 : 503, {
      ok,
      provider: 'ollama',
      model: ollama.model,
      ollamaHost: ollama.host,
      ai: { ...aiState },
      profile: { ...profileState, schemaVersion: profileState.ready ? 1 : null }
    });
  }

  if (req.method === 'GET' && req.url === '/resume') {
    try {
      const profile = loadProfile();
      const resumePath = getResumePath(profile);
      if (!resumePath || !fs.existsSync(resumePath)) return sendJson(res, 404, { error: 'documents.resume_path not set in profile.json, or the file is missing', code: 'RESUME_NOT_FOUND' });
      const name = path.basename(resumePath);
      const ext = path.extname(name).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.doc' ? 'application/msword' : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ext === '.txt' ? 'text/plain' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `inline; filename="${name}"` });
      return fs.createReadStream(resumePath).pipe(res);
    } catch (e) {
      return sendJson(res, 500, { error: e.message, code: e.code || 'PROFILE_LOAD_FAILED' });
    }
  }

  if (req.method !== 'POST' || (req.url !== '/fill' && req.url !== '/remember')) return sendJson(res, 404, { error: 'not found' });

  const route = req.url;
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', async () => {
    try {
      if (route === '/remember') {
        const { items } = JSON.parse(body || '{}');
        const profile = loadProfile();
        let saved = 0;
        for (const it of items || []) {
          if (!it || !it.question || it.answer === null || it.answer === undefined || it.answer === '') continue;
          const norm = String(it.question).trim().toLowerCase();
          const existing = profile.learned_answers.find(x => String(x.question).trim().toLowerCase() === norm);
          if (existing) existing.answer = it.answer;
          else profile.learned_answers.push({ question: it.question, answer: it.answer });
          saved++;
        }
        saveProfileToFile(PROFILE_PATH, profile);
        profileState.migratedLegacy = false;
        console.log(`[remember] saved ${saved} answer(s); ${profile.learned_answers.length} total`);
        return sendJson(res, 200, { ok: true, saved });
      }

      const { fields } = JSON.parse(body || '{}');
      if (!Array.isArray(fields) || fields.length === 0) throw new Error('Request must include a non-empty "fields" array');

      const profile = loadProfile();
      const resumePath = getResumePath(profile) || null;
      const result = await resolveFields({
        fields,
        profile,
        aiFallback: async unresolved => {
          await readinessPromise;
          if (!aiState.ready) {
            throw new OllamaRuntimeError(
              aiState.error && aiState.error.code || 'OLLAMA_NOT_READY',
              aiState.error && aiState.error.message || 'Ollama is not ready.'
            );
          }
          const prompt = buildPrompt(profile, unresolved);
          console.log(`[fill] ${unresolved.length}/${fields.length} unresolved field(s) -> Ollama/${ollama.model}...`);
          const raw = await ollama.chat(prompt);
          return validateAnswers(unresolved, extractJson(raw));
        }
      });

      const sourceCounts = Object.values(result.sources).reduce((counts, source) => {
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {});
      console.log('[fill] sources:', JSON.stringify(sourceCounts));
      console.log('[fill] answers:', JSON.stringify(result.answers));
      return sendJson(res, 200, { answers: result.answers, resumePath });
    } catch (e) {
      console.error('[error]', e.code ? `${e.code}: ${e.message}` : e.message);
      const status = e instanceof OllamaRuntimeError ? 503 : e instanceof ProfileError ? 422 : 500;
      return sendJson(res, status, { error: e.message, code: e.code || 'FILL_FAILED', details: e.details || undefined });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Form-filler bridge running on http://${HOST}:${PORT}`);
  console.log(`Profile: ${PROFILE_PATH}`);
  console.log(`AI: Ollama model ${ollama.model} at ${ollama.host}`);
  console.log('No API key or subscription required.');
});

module.exports = { buildPrompt, extractJson, initializeAI, initializeProfile, server };
