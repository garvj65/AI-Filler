# Factual job-application fields

AI-Filler resolves high-confidence factual application fields from `profile.json` before calling Groq.

In addition to the original candidate facts, the deterministic matcher now covers:

- total/overall years of experience
- current employment status
- work authorization / work eligibility
- visa sponsorship requirement
- preferred work location
- employment type
- joining/start date
- expanded current role/company aliases
- expanded notice-period wording
- expanded current/expected compensation wording

The corresponding optional profile fields are:

```json
{
  "current_employment": {
    "years_of_experience": "2+ years"
  },
  "job_preferences": {
    "current_employment_status": "Employed",
    "work_authorization": "Authorized to work in India",
    "requires_sponsorship": false,
    "preferred_work_location": "Bengaluru",
    "employment_type": "Full-time",
    "joining_date": "2026-09-01"
  }
}
```

Values are never forced into radio/dropdown/checkbox controls unless they match an option present on the page. Boolean fields such as sponsorship and relocation are limited to recognized yes/no-style options.

Subjective prompts such as `Why this role?`, `Why this company?`, and open-ended experience stories are intentionally **not** matched deterministically. They continue to fall through to the configured AI provider or manual review.
