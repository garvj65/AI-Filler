# AI-Filler

Fill Google Forms and ordinary HTML forms from your own candidate profile. AI-Filler resolves known facts deterministically first and sends only unresolved questions to an LLM.

**Default AI provider: Groq.** No local model or GPU inference is required for the normal setup.

## Architecture

```text
Form tab
  -> extension scans fields
  -> local Node bridge at http://127.0.0.1:8731
  -> validated candidate profile schema v1
  -> deterministic matcher resolves known profile fields
  -> exact learned answers resolve next
  -> only unresolved fields go to Groq
  -> AI answers are validated
  -> merged answers return to the extension
```

The browser extension never receives your Groq API key. The key exists only in the Node bridge process environment.

## Deterministic-first matching

Common candidate facts do not need LLM inference. The matcher currently covers high-precision aliases for:

- full, first, and last name
- email and phone
- city/current location
- LinkedIn, GitHub, and portfolio
- degree, university/college, and graduation year
- skills
- current role and company
- notice period
- current and expected CTC/compensation
- relocation willingness
- availability

Precedence:

```text
validated profile fact
  -> exact-normalized learned answer
  -> selected AI provider
  -> unanswered/null
```

If every field is resolved deterministically, AI-Filler makes no hosted LLM request for that fill.

## Default hosted model

The bridge defaults to:

```text
AI_PROVIDER=groq
GROQ_MODEL=llama-3.1-8b-instant
```

Groq is called through its OpenAI-compatible Chat Completions API using JSON Object Mode. Existing answer validation still constrains radio/dropdown/checkbox answers to options actually present on the page.

## Requirements

- Node.js 18+
- Chrome, Edge, Brave, or another Chromium browser
- a Groq API key for questions that require LLM fallback

Ollama is optional and is no longer required for the default setup.

## Setup

### 1. Clone the project

```bash
git clone https://github.com/garvj65/AI-Filler.git
cd AI-Filler
cp profile.example.json profile.json
```

PowerShell:

```powershell
Copy-Item profile.example.json profile.json
```

Fill `profile.json` with your own information.

### 2. Candidate profile schema

`profile.json` uses the versioned structure documented in `profile.schema.json`.

Main sections:

```text
schema_version
personal
links
education
experience
current_employment
skills
job_preferences
documents
profile_text
learned_answers
custom
```

Older flat profiles from the original project remain accepted and are migrated in memory.

### 3. Create a Groq API key

Create an API key in the Groq Console. Do **not** paste the key into `profile.json`, the extension, source files, README files, or Git commits.

Set it only in the terminal that starts the bridge.

PowerShell:

```powershell
$env:GROQ_API_KEY="your-key-here"
```

macOS/Linux:

```bash
export GROQ_API_KEY="your-key-here"
```

Optionally choose another Groq model:

```powershell
$env:GROQ_MODEL="llama-3.1-8b-instant"
```

### 4. Start the bridge

```bash
cd bridge
node server.js
```

Typical output:

```text
Profile schema v1 ready.
Checking AI provider groq/llama-3.1-8b-instant...
Form-filler bridge running on http://127.0.0.1:8731
AI: groq/llama-3.1-8b-instant at https://api.groq.com
Hosted inference enabled. No local LLM/GPU processing is required.
AI provider ready: groq/llama-3.1-8b-instant.
```

No Ollama process is started or contacted in the default configuration.

### 5. Load the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Open a form and start AI-Filler.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `groq` | AI fallback provider: `groq` or `ollama` |
| `GROQ_API_KEY` | none | Groq API key; keep it out of project files |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Groq model for unresolved questions |
| `GROQ_API_URL` | Groq Chat Completions endpoint | Optional endpoint override |
| `AI_TIMEOUT_MS` | `60000` for Groq | AI inference timeout |
| `PORT` | `8731` | Local bridge port |
| `BRIDGE_HOST` | `127.0.0.1` | Local bridge bind address |

Ollama-only variables (`OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_READINESS_TIMEOUT_MS`, `OLLAMA_WARMUP_TIMEOUT_MS`, `OLLAMA_KEEP_ALIVE`) are used only when `AI_PROVIDER=ollama`.

## Health check

```bash
curl http://localhost:8731/health
```

With Groq configured, the response reports:

```json
{
  "ok": true,
  "provider": "groq",
  "model": "llama-3.1-8b-instant"
}
```

If the Groq key is missing, health exposes `GROQ_API_KEY_MISSING`. Deterministic matching code remains available, but any unresolved field requiring AI fallback will fail until a key is configured.

## Quick fill test

```bash
curl -s -X POST localhost:8731/fill \
  -H 'Content-Type: application/json' \
  -d '{"fields":[{"id":"q0","question":"Your full name","type":"text"},{"id":"q1","question":"Email","type":"text"}]}'
```

Canonical fields like these should resolve from `profile.json` without a Groq request.

For mixed forms, logs show only unresolved fields going to the selected provider:

```text
[fill] 1/6 unresolved field(s) -> groq/llama-3.1-8b-instant...
[fill] sources: {"profile":5,"groq":1}
```

## Optional local Ollama mode

Ollama is preserved as an opt-in provider for users who prefer fully local inference.

PowerShell:

```powershell
$env:AI_PROVIDER="ollama"
$env:OLLAMA_MODEL="qwen3:4b-instruct"
node server.js
```

Only this explicit mode performs Ollama readiness checks/model warm-up and uses local model compute.

## Development checks

From `bridge/`:

```bash
npm run check
npm test
```

Provider tests use mocked HTTP responses and do not require a real Groq key or running Ollama model.

## Answer safety

AI-Filler prefers `null` over a guess. Before values reach the browser, the bridge:

- resolves high-confidence profile facts deterministically
- reuses exact-normalized learned answers
- sends only unresolved fields to the AI provider
- requests JSON output
- converts empty AI text answers to `null`
- rejects obvious label/question echoes
- requires radio/dropdown values to match page options
- filters checkbox arrays to real page options

## Troubleshooting

### `GROQ_API_KEY_MISSING`

Set `GROQ_API_KEY` in the same terminal where you run `node server.js`.

### `GROQ_AUTH_FAILED`

The configured API key was rejected. Check the environment variable or create a new Groq key.

### `GROQ_RATE_LIMITED`

The current free-plan/project limit was reached. Wait for the indicated retry period or review your Groq project limits.

### `GROQ_TIMEOUT`

The hosted inference request exceeded `AI_TIMEOUT_MS`.

### `PROFILE_FILE_MISSING`

Create the local profile:

```bash
cp profile.example.json profile.json
```

### `PROFILE_JSON_INVALID` / `PROFILE_SCHEMA_INVALID`

Fix the profile syntax/shape using `profile.example.json` and `profile.schema.json` as references.

## Privacy note

`profile.json` remains a local file and the API key stays in the Node process environment. However, when a question requires hosted Groq inference, the bridge sends the unresolved question and candidate-profile context needed by the prompt to Groq. Use `AI_PROVIDER=ollama` if you require the inference payload to remain entirely local.

## License

The upstream project is MIT licensed. Preserve the upstream license and attribution when redistributing a modified version.
