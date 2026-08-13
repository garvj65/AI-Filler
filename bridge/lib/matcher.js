'use strict';

function normalizeQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[_/\\|]+/g, ' ')
    .replace(/[^a-z0-9+.%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(please\s+)?(enter|provide|write|mention|share|select|choose)\s+(your\s+)?/, '')
    .replace(/^(what is|what's|whats)\s+your\s+/, '')
    .replace(/^(are you|do you|will you|can you)\s+/, '')
    .replace(/^your\s+/, '')
    .replace(/\s+(required|optional)$/g, '')
    .trim();
}

function firstEducation(profile) {
  return Array.isArray(profile.education) && profile.education.length ? profile.education[0] : {};
}

function compactLocation(profile) {
  const location = profile.personal && profile.personal.location || {};
  return [location.city, location.state, location.country].filter(Boolean).join(', ');
}

const FIELD_DEFINITIONS = [
  { key: 'full_name', aliases: ['full name', 'name', 'candidate name', 'applicant name'], get: p => p.personal && p.personal.full_name },
  { key: 'first_name', aliases: ['first name', 'given name'], get: p => p.personal && p.personal.first_name },
  { key: 'last_name', aliases: ['last name', 'surname', 'family name'], get: p => p.personal && p.personal.last_name },
  { key: 'email', aliases: ['email', 'email address', 'primary email', 'e mail', 'e mail address'], get: p => p.personal && p.personal.primary_email },
  { key: 'phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'telephone', 'telephone number'], get: p => p.personal && p.personal.phone },
  { key: 'city', aliases: ['city', 'current city', 'city of residence'], get: p => p.personal && p.personal.location && p.personal.location.city },
  { key: 'location', aliases: ['location', 'current location', 'where are you located', 'place of residence'], get: compactLocation },
  { key: 'linkedin', aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url', 'linkedin link'], get: p => p.links && p.links.linkedin },
  { key: 'github', aliases: ['github', 'github url', 'github profile', 'github profile url', 'github link'], get: p => p.links && p.links.github },
  { key: 'portfolio', aliases: ['portfolio', 'portfolio url', 'portfolio link', 'personal website', 'website'], get: p => p.links && p.links.portfolio },
  { key: 'degree', aliases: ['degree', 'highest degree', 'qualification', 'highest qualification'], get: p => firstEducation(p).degree },
  { key: 'institution', aliases: ['university', 'college', 'institution', 'university name', 'college name', 'school university', 'educational institution'], get: p => firstEducation(p).institution },
  { key: 'graduation_year', aliases: ['graduation year', 'year of graduation', 'passing year', 'year of passing'], get: p => firstEducation(p).graduation_year },
  { key: 'skills', aliases: ['skills', 'technical skills', 'tech stack', 'technologies', 'technologies known'], get: p => p.skills },
  { key: 'current_role', aliases: ['current role', 'current job title', 'current title', 'job title', 'current designation', 'present designation'], get: p => p.current_employment && p.current_employment.role },
  { key: 'current_company', aliases: ['current company', 'current employer', 'present company', 'present employer', 'current organization', 'current organisation', 'present organization', 'present organisation'], get: p => p.current_employment && p.current_employment.company },
  { key: 'years_of_experience', aliases: ['years of experience', 'total experience', 'total work experience', 'total years of experience', 'overall experience', 'professional experience', 'how many years of experience do you have'], get: p => p.current_employment && p.current_employment.years_of_experience },
  { key: 'employment_status', aliases: ['employment status', 'current employment status', 'currently employed', 'current work status'], get: p => p.job_preferences && p.job_preferences.current_employment_status },
  { key: 'notice_period', aliases: ['notice period', 'current notice period', 'notice period in days', 'notice period days', 'serving notice period'], get: p => p.job_preferences && p.job_preferences.notice_period },
  { key: 'current_ctc', aliases: ['current ctc', 'current compensation', 'current salary', 'present ctc', 'current annual compensation', 'current annual salary', 'current package', 'present salary', 'present compensation'], get: p => p.job_preferences && p.job_preferences.current_ctc },
  { key: 'expected_ctc', aliases: ['expected ctc', 'expected compensation', 'expected salary', 'salary expectation', 'salary expectations', 'expected annual compensation', 'desired compensation', 'desired salary', 'expected package'], get: p => p.job_preferences && p.job_preferences.expected_ctc },
  { key: 'relocation', aliases: ['willing to relocate', 'open to relocation', 'relocation willingness', 'relocate'], get: p => p.job_preferences && p.job_preferences.willing_to_relocate },
  { key: 'work_authorization', aliases: ['work authorization', 'work authorisation', 'authorized to work', 'authorised to work', 'legally authorized to work', 'legally authorised to work', 'legally authorized to work in india', 'legally authorised to work in india', 'eligible to work', 'work eligibility'], get: p => p.job_preferences && p.job_preferences.work_authorization },
  { key: 'sponsorship', aliases: ['require visa sponsorship', 'require sponsorship', 'need visa sponsorship', 'need sponsorship', 'visa sponsorship required', 'sponsorship required', 'now or in the future require sponsorship', 'now or in the future require visa sponsorship'], get: p => p.job_preferences && p.job_preferences.requires_sponsorship },
  { key: 'preferred_work_location', aliases: ['preferred location', 'preferred work location', 'preferred job location', 'location preference'], get: p => p.job_preferences && p.job_preferences.preferred_work_location },
  { key: 'employment_type', aliases: ['employment type', 'preferred employment type', 'job type', 'work type'], get: p => p.job_preferences && p.job_preferences.employment_type },
  { key: 'joining_date', aliases: ['joining date', 'date of joining', 'start date', 'available start date', 'earliest start date'], get: p => p.job_preferences && p.job_preferences.joining_date },
  { key: 'availability', aliases: ['availability', 'when can you start', 'available to start', 'joining availability'], get: p => p.job_preferences && p.job_preferences.availability },
  { key: 'applying_for', aliases: ['applying for', 'application type'], get: p => p.job_preferences && p.job_preferences.applying_for }
];

const ALIAS_MAP = new Map();
for (const definition of FIELD_DEFINITIONS) {
  for (const alias of definition.aliases) ALIAS_MAP.set(normalizeQuestion(alias), definition);
}

function findDefinition(question) {
  return ALIAS_MAP.get(normalizeQuestion(question)) || null;
}

function optionMatch(options, candidate) {
  if (!Array.isArray(options)) return null;
  const normalized = normalizeQuestion(candidate);
  if (!normalized) return null;
  return options.find(option => normalizeQuestion(option) === normalized) || null;
}

function booleanOption(options, value) {
  const positive = ['yes', 'true', 'y', 'willing', 'open to relocate', 'open'];
  const negative = ['no', 'false', 'n', 'not willing', 'not open'];
  const desired = value ? positive : negative;
  for (const label of desired) {
    const match = optionMatch(options, label);
    if (match !== null) return match;
  }
  return null;
}

function coerceValueForField(field, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  if (field.type === 'checkbox') {
    if (!Array.isArray(field.options)) return null;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const matches = [];
    for (const value of values) {
      const match = optionMatch(field.options, String(value));
      if (match !== null && !matches.includes(match)) matches.push(match);
    }
    return matches.length ? matches : null;
  }

  if (field.type === 'radio' || field.type === 'dropdown') {
    if (!Array.isArray(field.options)) return null;
    if (typeof rawValue === 'boolean') return booleanOption(field.options, rawValue);
    return optionMatch(field.options, String(rawValue));
  }

  if (field.type === 'text' || field.type === 'paragraph') {
    if (Array.isArray(rawValue)) return rawValue.filter(Boolean).join(', ') || null;
    if (typeof rawValue === 'boolean') return rawValue ? 'Yes' : 'No';
    const text = String(rawValue).trim();
    return text || null;
  }

  return rawValue;
}

function findLearnedAnswer(profile, question) {
  const normalized = normalizeQuestion(question);
  if (!normalized || !Array.isArray(profile.learned_answers)) return undefined;
  const match = profile.learned_answers.find(item => normalizeQuestion(item.question) === normalized);
  return match ? match.answer : undefined;
}

function matchField(field, profile) {
  const definition = findDefinition(field.question);
  if (definition) {
    const value = coerceValueForField(field, definition.get(profile));
    if (value !== null) return { answer: value, source: 'profile', key: definition.key };
  }

  const learned = findLearnedAnswer(profile, field.question);
  if (learned !== undefined) {
    const value = coerceValueForField(field, learned);
    if (value !== null) return { answer: value, source: 'learned', key: null };
  }

  return { answer: null, source: 'unanswered', key: definition && definition.key || null };
}

function matchDeterministic(fields, profile) {
  const answers = {};
  const sources = {};
  const unresolved = [];

  for (const field of fields) {
    const result = matchField(field, profile);
    if (result.source === 'unanswered') {
      unresolved.push(field);
      sources[field.id] = 'unanswered';
    } else {
      answers[field.id] = result.answer;
      sources[field.id] = result.source;
    }
  }

  return { answers, sources, unresolved };
}

module.exports = {
  FIELD_DEFINITIONS,
  coerceValueForField,
  findDefinition,
  findLearnedAnswer,
  matchDeterministic,
  matchField,
  normalizeQuestion
};
