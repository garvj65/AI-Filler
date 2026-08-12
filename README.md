# AI Form Filler — Local Ollama Edition

Fill Google Forms and ordinary HTML forms from your own `profile.json`, using an AI model that runs locally through Ollama.

**No Claude Code. No API key. No AI subscription. No per-request bill.**

The browser extension scans visible form fields only when you click Start. The local Node bridge sends the scanned questions plus your local profile to Ollama on `127.0.0.1`, gets structured JSON answers back, and fills the form.

## Architecture

```text
Form tab
  -> extension/content.js scans fields and fills answers
  -> extension/background.js POSTs to http://127.0.0.1:8731/fill
  -> bridge/server.js calls local Ollama at http://127.0.0.1:11434/api/chat
  -> Qwen3 returns JSON answers
```

Your `profile.json` remains on your machine. In the default configuration, the model inference also happens on your machine.

## Default model

The bridge defaults to:

```text
qwen3:4b-instruct
```

It is a good balance for short classification/matching tasks like form filling. You can replace it with any Ollama chat model using `OLLAMA_MODEL`.

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

### 1. Clone the original project

```bash
git clone https://github.com/garvj65/AI-Filler.git
cd AI-Filler
cp profile.example.json profile.json
```

Fill `profile.json` with your own information.

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

Expected startup output:

```text
Form-filler bridge running on http://127.0.0.1:8731
AI: Ollama model qwen3:4b-instruct at http://127.0.0.1:11434
No API key or subscription required.
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
| `AI_TIMEOUT_MS` | `120000` | Model request timeout |
| `PORT` | `8731` | Bridge port |
| `BRIDGE_HOST` | `127.0.0.1` | Bridge bind address |

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

## What changed from the Claude Code version

The browser extension behavior is unchanged. The bridge no longer spawns:

```text
claude -p <prompt>
```

Instead it calls the local Ollama chat API with JSON output enabled. The response is then validated against each form field before being returned to the extension. Radio/dropdown answers must match one of the page's actual options, and checkbox answers are filtered to valid options.

## Troubleshooting

### `Could not reach Ollama`

Make sure Ollama is running. Its default local API is:

```text
http://127.0.0.1:11434
```

### `model not found`

Pull the configured model:

```bash
ollama pull qwen3:4b-instruct
```

### Too slow

Try a smaller model:

```bash
OLLAMA_MODEL=qwen3:1.7b node bridge/server.js
```

### Answers are weaker than expected

Try:

```bash
OLLAMA_MODEL=qwen3:8b node bridge/server.js
```

and make your `profile.json` richer and more explicit.

## Privacy note

With the default `OLLAMA_HOST`, both your profile data and inference stay local. If you deliberately point `OLLAMA_HOST` at another computer or hosted Ollama-compatible endpoint, your form/profile content will be sent there instead.

## License

The upstream repository is MIT licensed. Preserve the upstream license and attribution when redistributing a modified version.
