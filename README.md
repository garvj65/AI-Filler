# AI-Filler

AI-Filler is a working prototype for turning unstructured candidate documents into structured profile data and using that data to auto-populate web application forms.

> **Prototype status:** complete and validated end-to-end for resume/candidate data and browser-based application forms.

The project began from a broader idea: use an LLM-assisted document parsing pipeline to extract structured data from PDFs and feed predictable JSON into dynamic forms. The implemented prototype narrows that idea to a concrete use case — resumes and job/application forms — and adds deterministic matching, schema validation, missing-field handling, human review, and browser automation around the LLM layer.

## Project objective

Build an LLM-assisted document-to-form workflow that:

- extracts useful data from unstructured resume documents,
- converts inconsistent document content into schema-aligned JSON,
- validates and sanitizes model output instead of trusting raw generations,
- handles missing or uncertain fields by leaving them blank rather than inventing values,
- maps known candidate facts into dynamic web-form fields,
- uses an LLM only when deterministic profile data cannot answer a question,
- and keeps the user in control through explicit review before profile data is saved.

Within the resume/job-application scope, that objective is implemented.

## What the prototype does

### 1. Resume -> structured profile

A user can upload a PDF, DOCX, or TXT resume from the extension.

```text
Resume
  -> native text extraction
  -> text-quality / scanned-PDF check
  -> deterministic contact/link extraction
  -> Groq structures the remaining resume content
  -> schema validation + normalization
  -> editable profile draft
  -> explicit user confirmation
  -> non-destructive merge into profile.json
```

The final normalization layer also handles common extraction problems such as label echoes, duplicated summary text inside experience records, latest-role mapping, and graduation-year normalization from explicit education periods.

### 2. Structured profile -> form population

```text
Web form
  -> Chromium extension scans fields
  -> local Node bridge
  -> validated candidate profile
  -> deterministic field matcher
  -> exact learned answers
  -> Groq fallback for unresolved questions
  -> answer validation
  -> browser fills fields / asks user for anything still unknown
```

Known factual data is resolved without an LLM call whenever possible. Subjective or unsupported questions can fall through to Groq or remain unanswered for manual review.

## Architecture

AI-Filler has three main parts:

- **Chromium extension** — scans form controls, sends normalized questions to the bridge, fills returned answers, and provides resume upload/review UI.
- **Local Node bridge** — owns the candidate profile, document extraction, deterministic matching, validation, provider calls, and persistence.
- **Candidate profile schema** — a versioned JSON structure used as the source of truth for personal data, education, experience, skills, job preferences, links, learned answers, and profile text.

The default hosted provider is **Groq**. An explicit Ollama mode remains available for local inference.

## Reliability and validation choices

The prototype deliberately avoids treating the LLM as the source of truth.

- deterministic facts are preferred over generated answers,
- LinkedIn/GitHub values must be real matching-domain URLs,
- label/placeholder echoes are rejected,
- radio/dropdown/checkbox answers must match options present on the page,
- unsupported values become blank/null instead of guesses,
- resume drafts are validated against the candidate schema,
- resume imports never write directly to the profile before user confirmation,
- existing non-empty profile values and user-confirmed job preferences are preserved during resume imports,
- and years of experience, salary, notice period, work authorization, relocation, and similar preferences are not invented from resume dates/text.

## Resume support

Supported input formats:

- **PDF** — native embedded-text extraction
- **DOCX** — raw-text extraction with Mammoth
- **TXT** — UTF-8 text extraction

Sparse/image-only PDFs return `RESUME_OCR_REQUIRED` instead of silently producing a weak draft. OCR is intentionally not part of the current prototype because native extraction is preferred when usable text is already present.

## Deterministic job-application fields

High-confidence matching covers common factual fields including:

- name, email, phone and location,
- LinkedIn, GitHub and portfolio links,
- education and graduation year,
- skills,
- current company and role,
- years of experience when explicitly known,
- employment status/type,
- notice period,
- current/expected compensation,
- relocation,
- work authorization and sponsorship,
- preferred work location,
- availability and joining/start date.

Subjective prompts such as `Why this role?`, `Why this company?`, and open-ended stories are intentionally not forced through deterministic matching.

## Setup

### Requirements

- Node.js **20.16+**
- Chrome, Edge, Brave, or another Chromium browser
- a Groq API key for the default hosted provider

```bash
git clone https://github.com/garvj65/AI-Filler.git
cd AI-Filler/bridge
npm install
```

Set the Groq key in the same terminal that starts the bridge.

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

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repository's `extension/` directory.

A first-time user does not need to manually create `profile.json`; the resume onboarding flow can create it after review and confirmation.

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

The extension uses two local endpoints:

```text
POST /resume/draft
POST /resume/confirm
```

`/resume/draft` extracts text, creates and sanitizes a draft, then returns it for review. `/resume/confirm` validates the edited draft and merges it with the existing candidate profile before writing `profile.json`.

Maximum resume size is 8 MB.

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

The prototype has also been manually validated end-to-end with a real resume and browser form-filling flow.

## Current scope and limitations

This is a **prototype, not a production SaaS product**.

Implemented scope:

- resumes/candidate documents,
- structured candidate profiles,
- browser-based application forms,
- local profile persistence,
- deterministic matching with LLM fallback.

Not currently implemented:

- fully generic arbitrary-document -> arbitrary-form mapping,
- OCR for scanned resumes,
- cloud profile/account sync,
- multi-user profiles,
- a full standalone profile-management application,
- site-specific application submission automation.

These are deliberate scope boundaries rather than blockers for the validated prototype objective.

## Privacy

`profile.json` stays local and is ignored by Git. The Groq key remains in the Node process environment. With the default Groq provider, bounded extracted resume text is sent to Groq to structure a draft, and unresolved form questions send the context needed for inference. Use `AI_PROVIDER=ollama` when inference payloads must remain local.

Do not commit API keys, real `profile.json` data, or personal resumes.

## Project status

**Prototype objective fulfilled.**

The final workflow demonstrates the technical feasibility of:

```text
unstructured resume
  -> extracted text
  -> validated structured candidate JSON
  -> deterministic/LLM-assisted answer resolution
  -> populated dynamic web form
```

The next meaningful work, if this prototype is extended, should be driven by real usage rather than additional speculative feature work.

## License and attribution

This repository is based on an MIT-licensed upstream project and preserves the upstream license. Keep the existing license and attribution when redistributing modified versions.
