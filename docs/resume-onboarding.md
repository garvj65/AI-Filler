# Resume onboarding design

Resume import is deliberately a reviewable two-step operation:

1. `/resume/draft` performs native document-text extraction, deterministic fact extraction, AI-assisted structuring, sanitization, and final normalization, then returns a candidate-profile draft.
2. `/resume/confirm` accepts the user-reviewed draft and merges it into `profile.json`.

There is no profile write during the draft step.

## Extraction order

- TXT: UTF-8 decode.
- DOCX: Mammoth raw-text extraction from a Node `Buffer`.
- PDF: pdf-parse native text extraction from a `Buffer`.
- If a PDF yields too little useful embedded text, return `RESUME_OCR_REQUIRED`.

OCR is deliberately not invoked for normal resumes. Native extraction is preferred whenever usable text already exists.

## Deterministic facts before/around AI structuring

High-confidence values are extracted or validated without relying solely on the model:

- primary email,
- phone number,
- LinkedIn URL,
- GitHub URL,
- clearly labeled portfolio/personal-site URL.

Real domain validation is applied to LinkedIn and GitHub fields, and label echoes such as `LinkedIn -> "Linkedin"` or `Company -> "Company"` are rejected.

Deterministic contact/link facts override weaker AI output for the same fields.

## Final draft normalization

After the AI draft is sanitized, the bridge performs a small deterministic normalization pass:

- experience descriptions that duplicate or nearly duplicate `profile_text.bio` are cleared,
- when `current_employment.company` / `role` are empty, the latest clearly dated experience can supply them,
- overlapping roles with the same end date prefer the later start date,
- `Present` / `Current` roles rank newer than historical bounded roles,
- `education[].graduation_year` can be copied from an explicitly bounded duration such as `2022 - 2026` or `Aug 2022 - May 2026`,
- open-ended durations such as `2022 - Present` do not invent a graduation year,
- `years_of_experience` is never calculated from dates; it remains blank unless explicitly supported.

These rules prefer a missing value over an incorrect inferred one.

## Merge rules

A confirmed resume draft may fill empty personal/link/current-employment fields, append unique education and experience records, union skills/achievements case-insensitively, and fill an empty factual bio.

It preserves existing non-empty candidate values and preserves these local/user-confirmed sections exactly:

- `job_preferences`
- `documents`
- `learned_answers`
- `custom`

This prevents resume import from silently replacing salary, notice period, authorization, relocation, learned responses, or local resume configuration.

## Intentionally not inferred

Resume import does not infer:

- salary/current CTC/expected CTC,
- notice period,
- work authorization,
- sponsorship,
- relocation preference,
- availability/joining preferences,
- years of experience from date arithmetic.

Those values belong to explicit candidate preferences or manual confirmation rather than document guessing.

## Provider boundary

The original resume binary remains in the browser/local bridge flow. After native extraction, bounded resume text is sent to the selected AI provider to structure the draft. With the default provider this means extracted text is sent to Groq. `AI_PROVIDER=ollama` keeps the structuring step local.

## Prototype status

The resume onboarding flow has been validated end-to-end with a real text-based PDF resume. For the current prototype scope, resume ingestion and normalization are considered complete; future work should be driven by observed real-world failures rather than broader speculative parsing features.
