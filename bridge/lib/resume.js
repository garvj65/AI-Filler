'use strict';

const path = require('path');
const { createEmptyProfile, validateProfile } = require('./profile');

const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const MAX_RESUME_TEXT_CHARS = 60000;
const MIN_USEFUL_TEXT_CHARS = 160;
const MIN_USEFUL_WORDS = 25;

class ResumeImportError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ResumeImportError';
    this.code = code;
    this.details = details;
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textQuality(text) {
  const cleaned = cleanText(text);
  const words = cleaned.match(/[A-Za-z0-9][A-Za-z0-9+.#&/-]*/g) || [];
  const alphaNumeric = (cleaned.match(/[A-Za-z0-9]/g) || []).length;
  const ratio = cleaned.length ? alphaNumeric / cleaned.length : 0;
  return {
    text: cleaned,
    charCount: cleaned.length,
    wordCount: words.length,
    alphaNumericRatio: ratio,
    useful: cleaned.length >= MIN_USEFUL_TEXT_CHARS && words.length >= MIN_USEFUL_WORDS && ratio >= 0.35
  };
}

function detectFormat(fileName, mimeType) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === '.txt' || mime === 'text/plain') return 'txt';
  throw new ResumeImportError('RESUME_FORMAT_UNSUPPORTED', 'Supported resume formats are PDF, DOCX, and TXT.');
}

function decodeBase64(base64) {
  const value = String(base64 || '').trim();
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new ResumeImportError('RESUME_FILE_INVALID', 'Resume payload is missing or is not valid base64 data.');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length) throw new ResumeImportError('RESUME_FILE_INVALID', 'Resume file is empty.');
  if (buffer.length > MAX_RESUME_BYTES) {
    throw new ResumeImportError('RESUME_FILE_TOO_LARGE', `Resume must be ${Math.floor(MAX_RESUME_BYTES / 1024 / 1024)} MB or smaller.`);
  }
  return buffer;
}

async function extractPdf(buffer, loaders = {}) {
  const PDFParse = loaders.PDFParse || require('pdf-parse').PDFParse;
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result && result.text || '', warnings: [] };
  } finally {
    if (parser && typeof parser.destroy === 'function') await parser.destroy();
  }
}

async function extractDocx(buffer, loaders = {}) {
  const mammoth = loaders.mammoth || require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result && result.value || '',
    warnings: Array.isArray(result && result.messages) ? result.messages.map(message => message.message || String(message)) : []
  };
}

async function extractResumeText({ fileName, mimeType, base64 }, options = {}) {
  const format = detectFormat(fileName, mimeType);
  const buffer = decodeBase64(base64);
  let extracted;

  if (format === 'txt') extracted = { text: buffer.toString('utf8'), warnings: [] };
  else if (format === 'docx') extracted = await extractDocx(buffer, options.loaders);
  else extracted = await extractPdf(buffer, options.loaders);

  const quality = textQuality(extracted.text);
  if (!quality.useful) {
    if (format === 'pdf') {
      throw new ResumeImportError(
        'RESUME_OCR_REQUIRED',
        'This PDF contains too little usable embedded text and is likely scanned/image-based. OCR is not run automatically; use a text-based PDF/DOCX/TXT or an OCR-enabled flow later.',
        { charCount: quality.charCount, wordCount: quality.wordCount }
      );
    }
    throw new ResumeImportError(
      'RESUME_TEXT_TOO_SPARSE',
      'The resume did not contain enough usable text to build a reliable profile draft.',
      { charCount: quality.charCount, wordCount: quality.wordCount }
    );
  }

  return {
    format,
    fileName: String(fileName || `resume.${format}`),
    text: quality.text.slice(0, MAX_RESUME_TEXT_CHARS),
    originalTextLength: quality.charCount,
    truncated: quality.charCount > MAX_RESUME_TEXT_CHARS,
    warnings: extracted.warnings || []
  };
}

function stringValue(value, max = 4000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function stringArray(value, maxItems = 80, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = stringValue(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeEducation(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map(item => ({
    institution: stringValue(item && item.institution, 500),
    degree: stringValue(item && item.degree, 500),
    duration: stringValue(item && item.duration, 200),
    graduation_year: stringValue(item && item.graduation_year, 100),
    current_year_of_study: stringValue(item && item.current_year_of_study, 100),
    class_12_percentage: stringValue(item && item.class_12_percentage, 100),
    class_10_percentage: stringValue(item && item.class_10_percentage, 100)
  })).filter(item => Object.values(item).some(Boolean));
}

function sanitizeExperience(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => ({
    company: stringValue(item && item.company, 500),
    title: stringValue(item && item.title, 500),
    period: stringValue(item && item.period, 250),
    description: stringValue(item && item.description, 4000)
  })).filter(item => Object.values(item).some(Boolean));
}

function sanitizeResumeDraft(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const draft = createEmptyProfile();
  const personal = source.personal && typeof source.personal === 'object' ? source.personal : {};
  const location = personal.location && typeof personal.location === 'object' ? personal.location : {};
  const links = source.links && typeof source.links === 'object' ? source.links : {};
  const employment = source.current_employment && typeof source.current_employment === 'object' ? source.current_employment : {};
  const profileText = source.profile_text && typeof source.profile_text === 'object' ? source.profile_text : {};

  Object.assign(draft.personal, {
    full_name: stringValue(personal.full_name, 500),
    first_name: stringValue(personal.first_name, 250),
    last_name: stringValue(personal.last_name, 250),
    primary_email: stringValue(personal.primary_email, 500),
    alternate_email: stringValue(personal.alternate_email, 500),
    phone: stringValue(personal.phone, 250),
    gender: stringValue(personal.gender, 100),
    location: {
      city: stringValue(location.city, 250),
      state: stringValue(location.state, 250),
      country: stringValue(location.country, 250)
    }
  });

  Object.assign(draft.links, {
    github: stringValue(links.github, 1000),
    linkedin: stringValue(links.linkedin, 1000),
    twitter: stringValue(links.twitter, 1000),
    portfolio: stringValue(links.portfolio, 1000),
    discord: stringValue(links.discord, 500)
  });

  draft.education = sanitizeEducation(source.education);
  draft.experience = sanitizeExperience(source.experience);
  Object.assign(draft.current_employment, {
    company: stringValue(employment.company, 500),
    role: stringValue(employment.role, 500),
    years_of_experience: stringValue(employment.years_of_experience, 200)
  });
  draft.skills = stringArray(source.skills, 80, 200);
  draft.profile_text.bio = stringValue(profileText.bio, 3000);
  draft.profile_text.competitive_programming = stringValue(profileText.competitive_programming, 1000);
  draft.profile_text.achievements = stringArray(profileText.achievements, 30, 1000);
  draft.profile_text.notes = '';

  draft.job_preferences = createEmptyProfile().job_preferences;
  draft.documents = createEmptyProfile().documents;
  draft.learned_answers = [];
  draft.custom = {};

  const errors = validateProfile(draft);
  if (errors.length) throw new ResumeImportError('RESUME_DRAFT_INVALID', `Resume draft is invalid: ${errors.join('; ')}`, errors);
  return draft;
}

function keyOfEducation(item) {
  return [item.institution, item.degree, item.graduation_year].map(value => stringValue(value).toLowerCase()).join('|');
}

function keyOfExperience(item) {
  return [item.company, item.title, item.period].map(value => stringValue(value).toLowerCase()).join('|');
}

function fillEmpty(target, source, keys) {
  for (const key of keys) {
    if ((target[key] === '' || target[key] === null || target[key] === undefined) && source[key]) target[key] = source[key];
  }
}

function mergeUniqueObjects(existing, incoming, keyFn) {
  const output = Array.isArray(existing) ? existing.map(item => ({ ...item })) : [];
  const keys = new Set(output.map(keyFn).filter(Boolean));
  for (const item of incoming || []) {
    const key = keyFn(item);
    if (!key || keys.has(key)) continue;
    output.push({ ...item });
    keys.add(key);
  }
  return output;
}

function mergeResumeDraft(existingProfile, incomingDraft) {
  const existing = existingProfile ? JSON.parse(JSON.stringify(existingProfile)) : createEmptyProfile();
  const draft = sanitizeResumeDraft(incomingDraft);

  fillEmpty(existing.personal, draft.personal, ['full_name', 'first_name', 'last_name', 'primary_email', 'alternate_email', 'phone', 'gender']);
  existing.personal.location = existing.personal.location || { city: '', state: '', country: '' };
  fillEmpty(existing.personal.location, draft.personal.location, ['city', 'state', 'country']);
  fillEmpty(existing.links, draft.links, ['github', 'linkedin', 'twitter', 'portfolio', 'discord']);

  existing.current_employment = existing.current_employment || { company: '', role: '', years_of_experience: '' };
  fillEmpty(existing.current_employment, draft.current_employment, ['company', 'role', 'years_of_experience']);

  existing.education = mergeUniqueObjects(existing.education, draft.education, keyOfEducation);
  existing.experience = mergeUniqueObjects(existing.experience, draft.experience, keyOfExperience);

  const skillMap = new Map();
  for (const skill of [...(existing.skills || []), ...(draft.skills || [])]) {
    const text = stringValue(skill, 200);
    const key = text.toLowerCase();
    if (text && !skillMap.has(key)) skillMap.set(key, text);
  }
  existing.skills = [...skillMap.values()];

  existing.profile_text = existing.profile_text || { bio: '', competitive_programming: '', achievements: [], notes: '' };
  fillEmpty(existing.profile_text, draft.profile_text, ['bio', 'competitive_programming']);
  const achievementMap = new Map();
  for (const item of [...(existing.profile_text.achievements || []), ...(draft.profile_text.achievements || [])]) {
    const text = stringValue(item, 1000);
    const key = text.toLowerCase();
    if (text && !achievementMap.has(key)) achievementMap.set(key, text);
  }
  existing.profile_text.achievements = [...achievementMap.values()];

  existing.job_preferences = existingProfile && existingProfile.job_preferences || existing.job_preferences;
  existing.documents = existingProfile && existingProfile.documents || existing.documents;
  existing.learned_answers = existingProfile && existingProfile.learned_answers || existing.learned_answers;
  existing.custom = existingProfile && existingProfile.custom || existing.custom;

  const errors = validateProfile(existing);
  if (errors.length) throw new ResumeImportError('RESUME_MERGE_INVALID', `Merged profile is invalid: ${errors.join('; ')}`, errors);
  return existing;
}

function buildResumeDraftPrompt(text) {
  return `You are extracting a candidate profile from resume text. Return ONLY JSON matching the requested profile shape.\n\nRESUME TEXT:\n${cleanText(text).slice(0, MAX_RESUME_TEXT_CHARS)}\n\nRules:\n- Use ONLY facts supported by the resume text.\n- If a value is absent or uncertain, use an empty string, empty array, or null rather than guessing.\n- Do not infer work authorization, sponsorship, salary, notice period, relocation preference, availability, or other job preferences from a resume.\n- Keep job_preferences empty/default.\n- Keep documents.resume_path empty.\n- Keep learned_answers empty and custom empty.\n- current_employment should reflect the current/latest role only when the resume clearly supports it.\n- years_of_experience should be copied only if explicitly stated; do not calculate it from dates.\n- profile_text.bio may be a concise factual summary using only resume-supported information.\n\nReturn this JSON shape:\n${JSON.stringify(createEmptyProfile(), null, 2)}`;
}

module.exports = {
  MAX_RESUME_BYTES,
  MAX_RESUME_TEXT_CHARS,
  ResumeImportError,
  buildResumeDraftPrompt,
  cleanText,
  decodeBase64,
  detectFormat,
  extractResumeText,
  mergeResumeDraft,
  sanitizeResumeDraft,
  textQuality
};
