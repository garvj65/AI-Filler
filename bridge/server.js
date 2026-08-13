#!/usr/bin/env node
// Local bridge: resolves known candidate facts deterministically and uses the
// selected AI provider only for unresolved questions or resume-to-profile drafting.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createAIProvider, createAIProviderError, isAIProviderError } = require('./lib/provider');
const { validateAnswers } = require('./lib/answers');
const { resolveFields } = require('./lib/resolver');
const { ProfileError, createEmptyProfile, getResumePath, loadProfileFromFile, saveProfileToFile } = require('./lib/profile');
const { ResumeImportError, buildResumeDraftPrompt, extractResumeText, finalizeResumeDraft, mergeResumeDraft, sanitizeResumeDraft } = require('./lib/resume');

const PORT = Number(process.env.PORT || 8731);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PROFILE_PATH = path.join(__dirname, '..', 'profile.json');
const MAX_REQUEST_BODY_BYTES = Number(process.env.MAX_REQUEST_BODY_BYTES || 12 * 1024 * 1024);
const ai = createAIProvider();
const aiState = { ready: false, status: 'starting', error: null, initMs: null };
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
    if (profileState.migratedLegacy) console.warn('Legacy profile format detected. It is supported in memory and will be saved as schema v1 after the next profile write.');
    console.log(`Profile schema v${profile.schema_version} ready.`);
    return profile;
  } catch (error) {
    profileState.ready = false;
    profileState.error = { code: error.code || 'PROFILE_LOAD_FAILED', message: error.message };
    if (error.code === 'PROFILE_FILE_MISSING') console.warn('[profile] No profile.json yet. Resume onboarding can create one.');
    else console.error(`[profile] ${profileState.error.code}: ${profileState.error.message}`);
    return null;
  }
}
initializeProfile();

function buildPrompt(profile, fields) {
  let learned = '';
  if (Array.isArray(profile.learned_answers) && profile.learned_answers.length) {
    learned = '\n\nThe user previously answered these questions by hand. REUSE the saved answer whenever the same or a clearly equivalent question appears:\n' + profile.learned_answers.map(la => `- Q: ${la.question}\n  A: ${JSON.stringify(la.answer)}`).join('\n');
  }
  const profileJson = JSON.stringify(profile, null, 2);
  return `You are filling out a web form on behalf of a person. Everything known about them is in this validated candidate profile JSON:\n\n${profileJson}\n${learned}\n\nBelow are the unresolved form questions scanned from the page (JSON array). Each item has: id, question, type, and (for choice fields) options.\n\n${JSON.stringify(fields, null, 2)}\n\nFor EACH question, decide the best answer using ONLY the person's data above.\nRules:\n- type "text" or "paragraph": return a plain string suited to the question.\n- type "radio" or "dropdown": return EXACTLY ONE of the given options, copied verbatim. If none fit, return null.\n- type "checkbox": return an ARRAY of zero or more of the given options, copied verbatim.\n- If you cannot answer truthfully from the data, return null. Prefer null over a guess.\n- NEVER invent personal facts that are not in the data.\n- NEVER use the field label, placeholder, section heading, option-group heading, or question text itself as the answer.\n- Preserve saved answers exactly when the question is the same or clearly equivalent.\n\nRespond with ONLY a JSON object mapping each question id to its answer. No prose, no code fences.`;
}

function extractJson(text) {
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : String(text || '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in AI output: ' + body.slice(0, 300));
  return JSON.parse(body.slice(start, end + 1));
}

async function initializeAI() {
  aiState.status = 'checking';
  aiState.error = null;
  const startedAt = Date.now();
  console.log(`Checking AI provider ${ai.name}/${ai.model}...`);
  try {
    const result = await ai.ensureReady();
    aiState.ready = true;
    aiState.status = 'ready';
    aiState.initMs = typeof result.warmupMs === 'number' ? result.warmupMs : Date.now() - startedAt;
    if (ai.name === 'ollama') console.log(`AI provider ready: Ollama/${ai.model} warmed in ${aiState.initMs} ms.`);
    else console.log(`AI provider ready: ${ai.name}/${ai.model}.`);
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
async function ensureAIReady() {
  await readinessPromise;
  if (!aiState.ready) throw createAIProviderError(aiState.error && aiState.error.code || 'AI_PROVIDER_NOT_READY', aiState.error && aiState.error.message || 'The configured AI provider is not ready.');
}
function resumeErrorStatus(error) {
  if (!(error instanceof ResumeImportError)) return null;
  if (error.code === 'RESUME_FILE_TOO_LARGE') return 413;
  if (error.code === 'RESUME_FORMAT_UNSUPPORTED') return 415;
  if (error.code === 'RESUME_OCR_REQUIRED' || error.code === 'RESUME_TEXT_TOO_SPARSE') return 422;
  return 400;
}
function parseRequestBody(body) {
  try { return JSON.parse(body || '{}'); }
  catch (error) { throw new ResumeImportError('REQUEST_JSON_INVALID', `Request body is not valid JSON: ${error.message}`); }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') {
    const ok = profileState.ready && aiState.ready;
    return sendJson(res, ok ? 200 : aiState.status === 'checking' && profileState.ready ? 200 : 503, { ok, provider: ai.name, model: ai.model, providerHost: ai.host || null, ai: { ...aiState }, profile: { ...profileState, schemaVersion: profileState.ready ? 1 : null }, onboarding: { resumeImport: true, canCreateProfile: aiState.ready } });
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
    } catch (e) { return sendJson(res, 500, { error: e.message, code: e.code || 'PROFILE_LOAD_FAILED' }); }
  }

  const postRoutes = new Set(['/fill', '/remember', '/resume/draft', '/resume/confirm']);
  if (req.method !== 'POST' || !postRoutes.has(req.url)) return sendJson(res, 404, { error: 'not found' });
  const route = req.url;
  let body = '';
  let bodyBytes = 0;
  let bodyTooLarge = false;
  req.on('data', chunk => {
    if (bodyTooLarge) return;
    bodyBytes += Buffer.byteLength(chunk);
    if (bodyBytes > MAX_REQUEST_BODY_BYTES) { bodyTooLarge = true; return; }
    body += chunk;
  });
  req.on('end', async () => {
    try {
      if (bodyTooLarge) return sendJson(res, 413, { error: 'Request body is too large.', code: 'REQUEST_BODY_TOO_LARGE' });

      if (route === '/resume/draft') {
        const payload = parseRequestBody(body);
        const extracted = await extractResumeText(payload);
        await ensureAIReady();
        console.log(`[resume] ${extracted.format.toUpperCase()} native text ${extracted.originalTextLength} chars -> ${ai.name}/${ai.model} draft...`);
        const raw = await ai.chat(buildResumeDraftPrompt(extracted.text));
        const draft = finalizeResumeDraft(extractJson(raw), extracted.text);
        return sendJson(res, 200, { ok: true, draft, source: { fileName: extracted.fileName, format: extracted.format, textLength: extracted.originalTextLength, truncated: extracted.truncated, warnings: extracted.warnings } });
      }

      if (route === '/resume/confirm') {
        const payload = parseRequestBody(body);
        const draft = sanitizeResumeDraft(payload.draft);
        let existing;
        try { existing = loadProfile(); }
        catch (error) { if (error.code !== 'PROFILE_FILE_MISSING') throw error; existing = createEmptyProfile(); }
        const merged = mergeResumeDraft(existing, draft);
        saveProfileToFile(PROFILE_PATH, merged);
        profileState.ready = true;
        profileState.migratedLegacy = false;
        profileState.error = null;
        console.log(`[resume] confirmed profile draft; ${merged.education.length} education, ${merged.experience.length} experience, ${merged.skills.length} skill entries`);
        return sendJson(res, 200, { ok: true, profile: merged, summary: { education: merged.education.length, experience: merged.experience.length, skills: merged.skills.length } });
      }

      if (route === '/remember') {
        const { items } = parseRequestBody(body);
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
        return sendJson(res, 200, { ok: true, saved });
      }

      const { fields } = parseRequestBody(body);
      if (!Array.isArray(fields) || fields.length === 0) throw new Error('Request must include a non-empty "fields" array');
      const profile = loadProfile();
      const resumePath = getResumePath(profile) || null;
      const result = await resolveFields({ fields, profile, aiSource: ai.name, aiFallback: async unresolved => { await ensureAIReady(); const raw = await ai.chat(buildPrompt(profile, unresolved)); return validateAnswers(unresolved, extractJson(raw)); } });
      const sourceCounts = Object.values(result.sources).reduce((counts, source) => { counts[source] = (counts[source] || 0) + 1; return counts; }, {});
      console.log('[fill] sources:', JSON.stringify(sourceCounts));
      console.log('[fill] answers:', JSON.stringify(result.answers));
      return sendJson(res, 200, { answers: result.answers, resumePath });
    } catch (e) {
      console.error('[error]', e.code ? `${e.code}: ${e.message}` : e.message);
      const status = resumeErrorStatus(e) || (isAIProviderError(e) ? 503 : e instanceof ProfileError ? 422 : 500);
      return sendJson(res, status, { error: e.message, code: e.code || 'FILL_FAILED', details: e.details || undefined });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Form-filler bridge running on http://${HOST}:${PORT}`);
  console.log(`Profile: ${PROFILE_PATH}`);
  console.log(`AI: ${ai.name}/${ai.model}${ai.host ? ` at ${ai.host}` : ''}`);
  if (ai.name === 'groq') console.log('Hosted inference enabled. No local LLM/GPU processing is required.');
  else console.log('Local Ollama inference enabled by AI_PROVIDER=ollama.');
  console.log('Resume onboarding: PDF/DOCX/TXT native extraction with review-before-save.');
});

module.exports = { buildPrompt, extractJson, initializeAI, initializeProfile, resumeErrorStatus, server };
