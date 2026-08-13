# AI Form Filler — Local Ollama Edition

Fill Google Forms and ordinary HTML forms from your own `profile.json`, using deterministic profile matching first and a local Ollama model only for questions that still need AI reasoning.

**No Claude Code. No API key. No AI subscription. No per-request bill.**

The browser extension scans visible form fields only when you click Start. The local Node bridge validates your profile, resolves known candidate facts directly, reuses exact learned answers, and sends only unresolved questions to Ollama on `127.0.0.1`.

## Architecture

```text
Form tab
  -> extension/content.js scans fields
  -> extension/background.js POSTs to http://127.0.0.1:8731/fill
  -> bridge validates candidate profile schema v1
  -> deterministic matcher resolves known profile fields
  -> exact-normalized learned answers resolve next
  -> only unresolved fields go to local Ollama
  -> AI answers are sanitized and validated
  -> all answers are merged in original field order
  -> extension fills the page
```

Your `profile.json` remains on your machine. In the default configuration, model inference also happens on your machine.

## Deterministic-first matching

Common candidate facts no longer need LLM inference. The initial matcher covers high-precision aliases for:

- full, first, and last name
- email and phone
- city and current location
- LinkedIn, GitHub, and portfolio
- degree, university/college, and graduation year
- skills
- current role and current company
- notice period
- current and expected compensation/CTC
- relocation willingness
- availability

Matching is deliberately conservative: AI-Filler normalizes casing, whitespace, punctuation, and common prompt prefixes, but it does not fuzzy-match arbitrary questions. If a field is not a known canonical field, an exact-normalized `learned_answers` match is tried. Anything still unresolved falls back to Ollama.

Precedence is:

```text
validated profile fact
  -> exact-normalized learned answer
  -> Ollama fallback
  -> unanswered/null
```

For radio/dropdown/checkbox fields, deterministic values are still constrained to options actually present on the page. If every field is resolved deterministically, no Ollama chat inference request is made for that fill. Answer sources (`profile`, `learned`, `ollama`, `unanswered`) are tracked internally for future confidence/review work, while the extension-facing `/fill` response remains backward compatible.

## Default model

The bridge defaults to:

```text
qwen3:4b-instruct
```

You can replace it with any compatible local Ollama chat model using `OLLAMA_MODEL`.

Examples:

```bash
OLLAMA_MODEL=qwen3:1.7b node bridge/server.js
OLLAMA_MODEL=qwen3:4b-instruct node bridge/server.js
OLLAMA_MODEL=qwen3:8b node bridge/server.js
```

PowerShell:

```powershell
$env:OLLAMA_MODEL="qwen3:8b"
node bridge/server.js
```

## Requirements

- Node.js 18+
- Ollama
- Chrome, Edge, Brave, or another Chromium browser

## Setup

### 1. Clone the project

```bash
git clone https://github.com/garvj65/AI-Filler.git
cd AI-Filler
cp profile.example.json profile.json
```

On PowerShell:

```powershell
Copy-Item profile.example.json profile.json
```

Fill `profile.json` with your own information.

### Candidate profile schema v1

`profile.json` has a stable, versioned structure documented in [`profile.schema.json`](profile.schema.json). The main sections are:

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

The minimum structurally valid profile contains `schema_version: 1` plus the required object/array sections; individual candidate facts can remain empty when unknown. `documents.resume_path` is the canonical resume location.

Older flat profiles from the original project are still accepted. AI-Filler migrates them to the v1 structure in memory, preserving values such as `resume_path`, education, skills, work experience, and `learned_answers`. The migrated v1 structure is written back the next time `/remember` saves a learned answer. New profiles should use `profile.example.json` directly.

Invalid JSON and invalid schema values produce explicit profile errors such as `PROFILE_JSON_INVALID`, `PROFILE_SCHEMA_INVALID`, and `PROFILE_FILE_MISSING` rather than failing later during inference.

### 2. Install Ollama

Install Ollama for your operating system and make sure the local service is running.

### 3. Pull the default model

```bash
ollama pull qwen3:4b-instruct
```

You can verify it independently with:

```bash
ollama run qwen3:4b-instruct
```

### 4. Start the bridge

```bash
cd bridge
node server.js
```

The bridge validates the candidate profile, checks that Ollama is reachable, verifies that the configured model is installed, and preloads the model. A cold model gets a separate warm-up budget instead of consuming the normal fill timeout. Deterministic-only fills do not invoke Ollama chat inference even though the local model readiness check runs at bridge startup.

Typical startup output:

```text
Profile schema v1 ready.
Checking Ollama at http://127.0.0.1:11434...
Warming model qwen3:4b-instruct (cold starts may take a while)...
Form-filler bridge running on http://127.0.0.1:8731
AI: Ollama model qwen3:4b-instruct at http://127.0.0.1:11434
No API key or subscription required.
Ollama ready: qwen3:4b-instruct warmed in 12345 ms.
```

### 5. Load the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Select the `extension/` folder.
5. Open a form, click the extension, and start the scan/fill flow.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen3:4b-instruct` | Local model to use for unresolved questions |
| `AI_TIMEOUT_MS` | `120000` | Normal Ollama inference timeout |
| `OLLAMA_READINESS_TIMEOUT_MS` | `10000` | Ollama availability/model-list timeout |
| `OLLAMA_WARMUP_TIMEOUT_MS` | `300000` | Separate cold-start/model preload timeout |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama should keep the model loaded after use |
| `PORT` | `8731` | Bridge port |
| `BRIDGE_HOST` | `127.0.0.1` | Bridge bind address |

## Health check

```bash
curl http://localhost:8731/health
```

The response includes provider/model readiness plus profile readiness and schema version.

## Quick test without the browser

Start Ollama and the bridge, then run:

```bash
curl -s -X POST localhost:8731/fill \
  -H 'Content-Type: application/json' \
  -d '{"fields":[{"id":"q0","question":"Your full name","type":"text"},{"id":"q1","question":"Email","type":"text"}]}'
```

For canonical fields like these, the answers are read directly from the profile and merged into the same response shape:

```json
{
  "answers": {
    "q0": "Jane Doe",
    "q1": "jane.doe@example.com"
  },
  "resumePath": null
}
```

For mixed forms, bridge logs show how many fields required Ollama, for example:

```text
[fill] 1/6 unresolved field(s) -> Ollama/qwen3:4b-instruct...
[fill] sources: {"profile":5,"ollama":1}
```

## Development checks

From `bridge/`:

```bash
npm run check
npm test
```

The test suite covers Ollama readiness/errors, answer validation, profile schema/migration, deterministic aliases, negative matches, choice constraints, learned-answer precedence, no-Ollama-needed fills, and mixed profile+Ollama resolution.

## Answer safety

AI-Filler prefers `null` over a guess. Before answers reach the browser, the bridge:

- uses deterministic profile facts where high-precision aliases match
- reuses only exact-normalized learned questions in this phase
- sends only unresolved fields to Ollama
- converts empty AI text answers to `null`
- rejects obvious question/label echoes such as `Filename:`
- requires radio/dropdown values to match a real page option
- filters checkbox arrays down to real page options

## What changed from the Claude Code version

The browser extension behavior is unchanged. The bridge no longer spawns:

```text
claude -p <prompt>
```

Instead it validates a local candidate profile, resolves known fields locally, and uses the local Ollama API only as a fallback for unresolved questions.

## Troubleshooting

### `PROFILE_FILE_MISSING`

Create your local profile first:

```bash
cp profile.example.json profile.json
```

### `PROFILE_JSON_INVALID`

`profile.json` is not valid JSON. Fix its JSON syntax before restarting or filling.

### `PROFILE_SCHEMA_INVALID`

A profile value has the wrong v1 type or shape. Compare it against `profile.example.json` / `profile.schema.json`; the error includes the affected field path.

### `OLLAMA_UNREACHABLE`

Make sure Ollama is running at `http://127.0.0.1:11434`.

### `OLLAMA_MODEL_NOT_FOUND`

```bash
ollama pull qwen3:4b-instruct
```

### `OLLAMA_WARMUP_TIMEOUT`

Increase `OLLAMA_WARMUP_TIMEOUT_MS` if the machine needs more cold-start time, or use a smaller local model.

### `OLLAMA_INFERENCE_TIMEOUT`

A normal unresolved-question inference exceeded `AI_TIMEOUT_MS`. Increase that limit or use a smaller model if needed.

### A common field still goes to Ollama

The deterministic matcher intentionally uses a conservative alias registry rather than fuzzy guessing. Add a high-confidence alias with a regression test rather than broad substring matching.

## Privacy note

With the default `OLLAMA_HOST`, both your profile data and inference stay local. If you deliberately point `OLLAMA_HOST` at another computer or hosted Ollama-compatible endpoint, unresolved form/profile content sent for inference will go there instead.

## License

The upstream repository is MIT licensed. Preserve the upstream license and attribution when redistributing a modified version.
