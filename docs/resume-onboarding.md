# Resume onboarding design

Resume import is deliberately a two-step operation:

1. `/resume/draft` performs native document-text extraction and returns a sanitized candidate-profile draft.
2. `/resume/confirm` accepts the user-reviewed draft and merges it into `profile.json`.

There is no profile write during the draft step.

## Extraction order

- TXT: UTF-8 decode.
- DOCX: Mammoth raw-text extraction from a Node `Buffer`.
- PDF: pdf-parse native text extraction from a `Buffer`.
- If a PDF yields too little useful embedded text, return `RESUME_OCR_REQUIRED`.

OCR is deliberately not invoked for normal resumes. A future OCR fallback should only run after sparse-PDF detection and should still feed into the same draft/review/confirm contract.

## Merge rules

A confirmed resume draft may fill empty personal/link/current-employment fields, append unique education and experience records, union skills/achievements case-insensitively, and fill an empty factual bio.

It preserves existing non-empty candidate values and preserves these local/user-confirmed sections exactly:

- `job_preferences`
- `documents`
- `learned_answers`
- `custom`

This prevents a resume import from silently replacing salary, notice period, authorization, relocation, learned responses, or local resume-upload configuration.

## Provider boundary

The original resume binary remains in the browser/local bridge flow. After native extraction, bounded resume text is sent to the selected AI provider to structure the draft. With the default provider this means extracted text is sent to Groq. `AI_PROVIDER=ollama` keeps the structuring step local.
