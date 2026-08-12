#!/usr/bin/env node
// Local bridge: receives scanned form fields, asks a local Ollama model
// to match them against profile.json, and returns the answers.
// No API key, paid API, or model subscription is required.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8731);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PROFILE_PATH = path.join(__dirname, '..', 'profile.json');

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120000);

function loadProfile() {
  return fs.readFileSync(PROFILE_PATH, 'utf8');
}

function buildPrompt(profile, fields) {
  // Surface any previously-learned answers so the AI reuses them verbatim.
  let learned = '';
  try {
    const p = JSON.parse(profile);
    if (Array.isArray(p.learned_answers) && p.learned_answers.length) {
      learned =
        '\n\nThe user previously answered these questions by hand. REUSE the saved answer ' +
        'whenever the same or a clearly equivalent question appears:\n' +
        p.learned_answers
          .map(la => `- Q: ${la.question}\n  A: ${JSON.stringify(la.answer)}`)
          .join('\n');
    }
  } catch (_) {}

  return `You are filling out a web form on behalf of a person. Everything known about them is in this JSON:

${profile}
${learned}

Below are the form questions scanned from the page (JSON array). Each item has: id, question, type, and (for choice fields) options.

${JSON.stringify(fields, null, 2)}

For EACH question, decide the best answer using ONLY the person's data above.
Rules:
- type "text" or "paragraph": return a plain string suited to the question.
- type "radio" or "dropdown": return EXACTLY ONE of the given options, copied verbatim. If none fit, return null.
- type "checkbox": return an ARRAY of zero or more of the given options, copied verbatim.
- If you cannot answer truthfully from the data, return null. NEVER invent emails, phone numbers, names, roll numbers, IDs, dates, employers, qualifications, or other personal facts that are not in the data.
- Preserve saved answers exactly when the question is the same or clearly equivalent.

Respond with ONLY a JSON object mapping each question id to its answer. No prose, no code fences.
Example: {"q0":"Jane Doe","q1":"jane.doe@example.com","q2":null,"q3":["Python","JavaScript"]}`;
}

async function runOllama(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0 }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(
        `Ollama request failed (${response.status}). ` +
        `${detail.slice(0, 500) || 'No error body returned.'}`
      );
    }

    const payload = await response.json();
    const content = payload && payload.message && payload.message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Ollama returned no message content.');
    }
    return content.trim();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Ollama timed out after ${AI_TIMEOUT_MS} ms.`);
    }

    const causeCode = error && error.cause && error.cause.code;
    if (causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND') {
      throw new Error(
        `Could not reach Ollama at ${OLLAMA_HOST}. ` +
        `Make sure Ollama is running and pull the model with: ollama pull ${OLLAMA_MODEL}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  // Ollama is asked for JSON mode, but keep this tolerant of code fences or extra whitespace.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in AI output: ' + text.slice(0, 300));
  }
  return JSON.parse(body.slice(start, end + 1));
}

function validateAnswers(fields, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('AI response must be a JSON object keyed by field id.');
  }

  const safe = {};
  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(answers, field.id)
      ? answers[field.id]
      : null;

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
      safe[field.id] = ['string', 'number', 'boolean'].includes(typeof value)
        ? String(value)
        : null;
      continue;
    }

    // Preserve compatibility for any field type added by the extension later.
    safe[field.id] = value;
  }

  return safe;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      provider: 'ollama',
      model: OLLAMA_MODEL,
      ollamaHost: OLLAMA_HOST
    }));
  }

  // Serve the resume bytes so the extension can auto-attach it to native file inputs.
  if (req.method === 'GET' && req.url === '/resume') {
    let resumePath = null;
    try {
      resumePath = JSON.parse(loadProfile()).resume_path || null;
    } catch (_) {}

    if (!resumePath || !fs.existsSync(resumePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"error":"resume_path not set in profile.json, or the file is missing"}');
    }

    const name = path.basename(resumePath);
    const ext = path.extname(name).toLowerCase();
    const mime =
      ext === '.pdf' ? 'application/pdf' :
      ext === '.doc' ? 'application/msword' :
      ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
      ext === '.txt' ? 'text/plain' :
      'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${name}"`
    });
    return fs.createReadStream(resumePath).pipe(res);
  }

  if (req.method !== 'POST' || (req.url !== '/fill' && req.url !== '/remember')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"not found"}');
  }

  const route = req.url;
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', async () => {
    try {
      if (route === '/remember') {
        const { items } = JSON.parse(body || '{}');
        const profile = JSON.parse(loadProfile());
        if (!Array.isArray(profile.learned_answers)) profile.learned_answers = [];

        let saved = 0;
        for (const it of items || []) {
          if (!it || !it.question || it.answer === null || it.answer === undefined || it.answer === '') {
            continue;
          }

          const norm = String(it.question).trim().toLowerCase();
          const existing = profile.learned_answers.find(
            x => String(x.question).trim().toLowerCase() === norm
          );
          if (existing) existing.answer = it.answer;
          else profile.learned_answers.push({ question: it.question, answer: it.answer });
          saved++;
        }

        fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
        console.log(`[remember] saved ${saved} answer(s); ${profile.learned_answers.length} total`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, saved }));
      }

      // route === '/fill'
      const { fields } = JSON.parse(body || '{}');
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error('Request must include a non-empty "fields" array');
      }

      const profile = loadProfile();
      let resumePath = null;
      try {
        resumePath = JSON.parse(profile).resume_path || null;
      } catch (_) {}

      const prompt = buildPrompt(profile, fields);
      console.log(`[fill] ${fields.length} field(s) -> Ollama/${OLLAMA_MODEL}...`);
      const raw = await runOllama(prompt);
      const answers = validateAnswers(fields, extractJson(raw));
      console.log('[fill] answers:', JSON.stringify(answers));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answers, resumePath }));
    } catch (e) {
      console.error('[error]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Form-filler bridge running on http://${HOST}:${PORT}`);
  console.log(`Profile: ${PROFILE_PATH}`);
  console.log(`AI: Ollama model ${OLLAMA_MODEL} at ${OLLAMA_HOST}`);
  console.log(`No API key or subscription required.`);
  console.log(`If needed, run: ollama pull ${OLLAMA_MODEL}`);
});
