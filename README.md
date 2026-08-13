# AI Form Filler — Local Ollama Edition

Fill Google Forms and ordinary HTML forms from your own `profile.json`, using an AI model that runs locally through Ollama.

**No Claude Code. No API key. No AI subscription. No per-request bill.**

The browser extension scans visible form fields only when you click Start. The local Node bridge sends the scanned questions plus your local profile to Ollama on `127.0.0.1`, gets structured JSON answers back, validates them, and fills the form.

## Architecture

```text
Form tab
  -> extension/content.js scans fields and fills answers
  -> extension/background.js POSTs to http://127.0.0.1:8731/fill
  -> bridge/server.js validates the local candidate profile
  -> bridge/server.js waits for local Ollama readiness
  -> Ollama model is preloaded through /api/generate
  -> fill inference uses http://127.0.0.1:11434/api/chat
  -> answers are sanitized and validated before returning to the extension
```

Your `profile.json` remains on your machine. In the default configuration, the model inference also happens on your machine.

## Default model

The bridge defaults to:

```text
qwen3:4b-instruct
```

You can replace it with any compatible local Ollama chat model using `OLLAMA_MODEL`.

Examples:

```bash
# smaller / lighter
OLLAMA_MODEL=qwen3:1.7b node bridge/server.js

# default
OLLAMA_MODEL=qwen3:4b-instruct node bridge/server.js

# stronger if your machine has more RAM/VRAM
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

`profile.json` now has a stable, versioned structure documented in [`profile.schema.json`](profile.schema.json). The main sections are:

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

Invalid JSON and invalid schema values now produce explicit profile errors such as `PROFILE_JSON_INVALID`, `PROFILE_SCHEMA_INVALID`, and `PROFILE_FILE_MISSING` rather than failing later during inference.

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

The bridge validates the candidate profile, checks that Ollama is reachable, verifies that the configured model is installed, and preloads the model before a `/fill` request is allowed to run inference. A cold model therefore gets a separate warm-up budget instead of consuming the normal fill timeout.

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

The bridge uses environment variables instead of provider credentials:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen3:4b-instruct` | Local model to use |
| `AI_TIMEOUT_MS` | `120000` | Normal fill inference timeout |
| `OLLAMA_READINESS_TIMEOUT_MS` | `10000` | Ollama availability/model-list timeout |
| `OLLAMA_WARMUP_TIMEOUT_MS` | `300000` | Separate cold-start/model preload timeout |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama should keep the model loaded after use |
| `PORT` | `8731` | Bridge port |
| `BRIDGE_HOST` | `127.0.0.1` | Bridge bind address |

## Health check

```bash
curl http://localhost:8731/health
```

The response includes provider/model readiness plus profile readiness and schema version. If startup initialization fails, `/health` exposes the relevant state instead of waiting for a fill request to discover it.

## Quick test without the browser

Start Ollama and the bridge, then run:

```bash
curl -s -X POST localhost:8731/fill \
  -H 'Content-Type: application/json' \
  -d '{"fields":[{"id":"q0","question":"Your full name","type":"text"},{"id":"q1","question":"Email","type":"text"}]}'
```

Expected shape:

```json
{
  "answers": {
    "q0": "Jane Doe",
    "q1": "jane.doe@example.com"
  },
  "resumePath": null
}
```

## Development checks

From `bridge/`:

```bash
npm run check
npm test
```

The test suite uses mocked Ollama responses and local temporary profile files, so the deterministic readiness/error/profile-validation tests do not require a running model.

## Answer safety

The model is instructed to return `null` rather than guess when profile data does not support an answer. Before answers reach the browser, the bridge also:

- converts empty text answers to `null`
- rejects obvious question/label echoes such as `Filename:`
- requires radio/dropdown values to match a real page option
- filters checkbox arrays down to real page options

## What changed from the Claude Code version

The browser extension behavior is unchanged. The bridge no longer spawns:

```text
claude -p <prompt>
```

Instead it validates a local candidate profile, calls the local Ollama API, and validates structured answers before returning them to the extension.

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

Make sure Ollama is running. Its default local API is:

```text
http://127.0.0.1:11434
```

### `OLLAMA_MODEL_NOT_FOUND`

Pull the configured model:

```bash
ollama pull qwen3:4b-instruct
```

### `OLLAMA_WARMUP_TIMEOUT`

The model took longer than the warm-up budget to load. Increase `OLLAMA_WARMUP_TIMEOUT_MS` if the machine needs more cold-start time, or use a smaller local model.

### `OLLAMA_INFERENCE_TIMEOUT`

The model was already initialized but a normal fill request exceeded `AI_TIMEOUT_MS`. Increase that limit or use a smaller model if needed.

### Answers are weaker than expected

Make your `profile.json` richer and more explicit. AI-Filler prefers `null` over obviously unusable label/placeholder echoes. Deterministic profile matching is planned separately so common profile facts will not need LLM inference at all.

## Privacy note

With the default `OLLAMA_HOST`, both your profile data and inference stay local. If you deliberately point `OLLAMA_HOST` at another computer or hosted Ollama-compatible endpoint, your form/profile content will be sent there instead.

## License

The upstream repository is MIT licensed. Preserve the upstream license and attribution when redistributing a modified version.
