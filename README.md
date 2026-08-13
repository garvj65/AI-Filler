# AI-Filler

AI-Filler is a Chromium extension plus local Node bridge that fills web forms from a structured candidate profile. Known facts are resolved deterministically; only unresolved questions go to the configured AI provider.

**Default AI provider: Groq.** Ollama remains optional for users who want fully local inference.

## Architecture

```text
Form page
  -> extension scans fields
  -> local bridge at http://127.0.0.1:8731
  -> candidate profile schema v1
  -> deterministic matcher
  -> exact learned answers
  -> Groq only for unresolved questions
  -> validated answers
  -> extension fills page / asks for unresolved values
```

## Resume onboarding

AI-Filler can build the candidate profile from a resume instead of requiring manual JSON entry:

```text
Choose PDF / DOCX / TXT
  -> native text extraction
  -> scanned-PDF quality check
  -> AI creates schema-v1 draft
  -> dedicated review page
  -> user edits/confirms
  -> non-destructive merge into profile.json
```

Nothing is written during draft creation. Existing non-empty profile values, job preferences, `learned_answers`, custom data, and an existing `documents.resume_path` are preserved when the reviewed draft is confirmed.

- PDF: native embedded-text extraction first.
- DOCX: native raw-text extraction.
- TXT: direct UTF-8 text extraction.
- Sparse/image-only PDF: returns `RESUME_OCR_REQUIRED` rather than creating a weak draft.
- OCR is not run by default; it remains a future fallback for scanned resumes.

The browser does not expose a trustworthy full local path for a selected file, so resume onboarding does not silently change `documents.resume_path`.

## Deterministic job fields

High-confidence matching includes name/contact details, links, education, skills, current company/role, years of experience, employment status/type, notice period, compensation, relocation, work authorization, sponsorship, preferred work location, availability, and joining/start date. Subjective prompts such as `Why this role?` remain AI/manual questions.

## Requirements

- Node.js 20.16+
- Chrome, Edge, Brave, or another Chromium browser
- a Groq API key for hosted AI drafting/fallback

## Setup

```bash
git clone https://github.com/garvj65/AI-Filler.git
cd AI-Filler/bridge
npm install
```

Set the Groq key in the terminal that starts the bridge.

PowerShell:

```powershell
$env:GROQ_API_KEY="your-key-here"
node server.js
```

macOS/Linux:

```bash
export GROQ_API_KEY="your-key-here"
node server.js
```

Do not put the key in source code, `profile.json`, the extension, README files, or Git commits.

A first-time user can start without `profile.json`; resume onboarding can create one after explicit review and confirmation.

Load the extension from `chrome://extensions` using **Load unpacked** and select `extension/`.

The popup supports:

- **Start — scan & fill**
- choose a PDF/DOCX/TXT resume and **Create profile draft**

## Candidate profile

`profile.json` follows `profile.schema.json` and stays local. Older flat profiles from the upstream project remain compatible through in-memory migration.

Main sections are `personal`, `links`, `education`, `experience`, `current_employment`, `skills`, `job_preferences`, `documents`, `profile_text`, `learned_answers`, and `custom`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `groq` | `groq` or optional `ollama` |
| `GROQ_API_KEY` | none | Groq API key |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Groq model |
| `AI_TIMEOUT_MS` | `60000` for Groq | AI request timeout |
| `MAX_REQUEST_BODY_BYTES` | `12582912` | local bridge request-size limit |
| `PORT` | `8731` | local bridge port |
| `BRIDGE_HOST` | `127.0.0.1` | local bind address |

## Resume import API

The extension uses:

```text
POST /resume/draft
POST /resume/confirm
```

`/resume/draft` receives the selected file as base64, performs native extraction, sends bounded extracted text to the selected AI provider, and returns a sanitized profile draft. `/resume/confirm` re-sanitizes the reviewed draft, merges it safely with the existing profile (or a new empty profile), validates the result, and only then writes `profile.json`.

Maximum resume size is 8 MB. Resume job preferences such as salary, notice period, work authorization, sponsorship, relocation and availability are deliberately not inferred.

## Optional local Ollama mode

```powershell
$env:AI_PROVIDER="ollama"
$env:OLLAMA_MODEL="qwen3:4b-instruct"
node server.js
```

Only this explicit mode performs local Ollama inference.

## Development checks

```bash
cd bridge
npm run check
npm test
```

## Troubleshooting

- `RESUME_OCR_REQUIRED`: PDF probably contains images rather than usable embedded text. Use a text-based PDF, DOCX, or TXT for now.
- `RESUME_FILE_TOO_LARGE`: use a resume 8 MB or smaller.
- `RESUME_FORMAT_UNSUPPORTED`: use PDF, DOCX, or TXT.
- `GROQ_API_KEY_MISSING`: set the key in the same terminal that starts `server.js`.
- `PROFILE_JSON_INVALID` / `PROFILE_SCHEMA_INVALID`: manually edited profile is malformed or invalid.

## Privacy

`profile.json` stays local and the Groq key stays in the Node process environment. With the default Groq provider, extracted resume text—not the original resume binary—is sent to Groq to create the draft. Unresolved form questions similarly send the prompt context required for inference. Use `AI_PROVIDER=ollama` if inference payloads must remain local.

## License

The upstream project is MIT licensed. Preserve the upstream license and attribution when redistributing a modified version.
