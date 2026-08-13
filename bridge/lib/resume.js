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

function normalizeLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isLabelEcho(value, labels = []) {
  const normalized = normalizeLabel(value);
  return !!normalized && labels.some(label => normalizeLabel(label) === normalized);
}

function textQuality(text) {
  const cleaned = cleanText(text);
  const words = cleaned.match(/[A-Za-z0-9][A-Za-z0-9+.#&/-]*/g) || [];
  const alphaNumeric = (cleaned.match(/[A-Za-z0-9]/g) || []).length;
  const ratio = cleaned.length ? alphaNumeric / cleaned.length : 0;
  return { text: cleaned, charCount: cleaned.length, wordCount: words.length, alphaNumericRatio: ratio, useful: cleaned.length >= MIN_USEFUL_TEXT_CHARS && words.length >= MIN_USEFUL_WORDS && ratio >= 0.35 };
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
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new ResumeImportError('RESUME_FILE_INVALID', 'Resume payload is missing or is not valid base64 data.');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length) throw new ResumeImportError('RESUME_FILE_INVALID', 'Resume file is empty.');
  if (buffer.length > MAX_RESUME_BYTES) throw new ResumeImportError('RESUME_FILE_TOO_LARGE', `Resume must be ${Math.floor(MAX_RESUME_BYTES / 1024 / 1024)} MB or smaller.`);
  return buffer;
}

async function extractPdf(buffer, loaders = {}) {
  const PDFParse = loaders.PDFParse || require('pdf-parse').PDFParse;
  const parser = new PDFParse({ data: buffer });
  try { const result = await parser.getText(); return { text: result && result.text || '', warnings: [] }; }
  finally { if (parser && typeof parser.destroy === 'function') await parser.destroy(); }
}

async function extractDocx(buffer, loaders = {}) {
  const mammoth = loaders.mammoth || require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result && result.value || '', warnings: Array.isArray(result && result.messages) ? result.messages.map(message => message.message || String(message)) : [] };
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
    if (format === 'pdf') throw new ResumeImportError('RESUME_OCR_REQUIRED', 'This PDF contains too little usable embedded text and is likely scanned/image-based. OCR is not run automatically; use a text-based PDF/DOCX/TXT or an OCR-enabled flow later.', { charCount: quality.charCount, wordCount: quality.wordCount });
    throw new ResumeImportError('RESUME_TEXT_TOO_SPARSE', 'The resume did not contain enough usable text to build a reliable profile draft.', { charCount: quality.charCount, wordCount: quality.wordCount });
  }
  return { format, fileName: String(fileName || `resume.${format}`), text: quality.text.slice(0, MAX_RESUME_TEXT_CHARS), originalTextLength: quality.charCount, truncated: quality.charCount > MAX_RESUME_TEXT_CHARS, warnings: extracted.warnings || [] };
}

function stripTrailingUrlPunctuation(value) { return String(value || '').replace(/[),.;:!?]+$/g, ''); }

function normalizeWebUrl(value) {
  let candidate = stripTrailingUrlPunctuation(String(value || '').trim());
  if (!candidate) return '';
  if (/^www\./i.test(candidate)) candidate = `https://${candidate}`;
  else if (!/^https?:\/\//i.test(candidate) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/|$)/.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

function sanitizeDomainUrl(value, domain, labels) {
  if (isLabelEcho(value, labels)) return '';
  const normalized = normalizeWebUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== domain && !host.endsWith(`.${domain}`)) return '';
    if (!url.pathname || url.pathname === '/') return '';
    return normalized;
  } catch { return ''; }
}

function sanitizePortfolioUrl(value) {
  if (isLabelEcho(value, ['portfolio','portfolio url','website','personal website','personal site'])) return '';
  return normalizeWebUrl(value);
}

function extractUrlCandidates(text) {
  const matches = cleanText(text).match(/(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:linkedin\.com|github\.com)\/[^\s<>"'`]+/gi) || [];
  return matches.map(stripTrailingUrlPunctuation);
}

function firstDomainUrl(text, domain, labels) {
  for (const candidate of extractUrlCandidates(text)) {
    const value = sanitizeDomainUrl(candidate, domain, labels);
    if (value) return value;
  }
  return '';
}

function findLabeledPortfolioUrl(text) {
  const lines = cleanText(text).split('\n');
  const labelPattern = /\b(portfolio|personal\s+(?:website|site)|website)\b/i;
  for (let index = 0; index < lines.length; index++) {
    if (!labelPattern.test(lines[index])) continue;
    const windowText = `${lines[index]}\n${lines[index + 1] || ''}`;
    for (const candidate of extractUrlCandidates(windowText)) {
      const normalized = normalizeWebUrl(candidate);
      if (!normalized) continue;
      try {
        const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'github.com' || host.endsWith('.github.com')) continue;
      } catch { continue; }
      return normalized;
    }
  }
  return '';
}

function extractDeterministicResumeFacts(text) {
  const source = cleanText(text);
  const emailMatch = source.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phoneMatches = source.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  const phone = phoneMatches.map(value => value.trim()).filter(value => { const digits = value.replace(/\D/g, ''); return digits.length >= 10 && digits.length <= 15; }).sort((a,b)=>(b.startsWith('+')?1:0)-(a.startsWith('+')?1:0))[0] || '';
  return {
    primary_email: emailMatch ? emailMatch[0] : '',
    phone,
    linkedin: firstDomainUrl(source, 'linkedin.com', ['linkedin','linkedin url','linkedin profile']),
    github: firstDomainUrl(source, 'github.com', ['github','github url','github profile']),
    portfolio: findLabeledPortfolioUrl(source)
  };
}

function stringValue(value, max = 4000, labels = []) {
  if (typeof value !== 'string') return '';
  const text = value.trim().slice(0, max);
  if (!text || isLabelEcho(text, labels)) return '';
  return text;
}

function stringArray(value, maxItems = 80, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(); const result = [];
  for (const item of value) { const text = stringValue(item,maxLength); const key=text.toLowerCase(); if(!text||seen.has(key)) continue; seen.add(key); result.push(text); if(result.length>=maxItems) break; }
  return result;
}

function sanitizeEducation(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,12).map(item=>({
    institution:stringValue(item&&item.institution,500,['institution','college','university','school']),
    degree:stringValue(item&&item.degree,500,['degree','qualification']),
    duration:stringValue(item&&item.duration,200,['duration','period']),
    graduation_year:stringValue(item&&item.graduation_year,100,['graduation year','year of graduation']),
    current_year_of_study:stringValue(item&&item.current_year_of_study,100,['current year of study']),
    class_12_percentage:stringValue(item&&item.class_12_percentage,100,['class 12 percentage']),
    class_10_percentage:stringValue(item&&item.class_10_percentage,100,['class 10 percentage'])
  })).filter(item=>Object.values(item).some(Boolean));
}

function sanitizeExperience(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,30).map(item=>({
    company:stringValue(item&&item.company,500,['company','employer','organization','organisation']),
    title:stringValue(item&&item.title,500,['title','role','job title','designation']),
    period:stringValue(item&&item.period,250,['period','duration','dates']),
    description:stringValue(item&&item.description,4000,['description'])
  })).filter(item=>Object.values(item).some(Boolean));
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
    full_name:stringValue(personal.full_name,500,['full name','name']), first_name:stringValue(personal.first_name,250,['first name','given name']), last_name:stringValue(personal.last_name,250,['last name','surname','family name']),
    primary_email:stringValue(personal.primary_email,500,['email','email address','primary email']), alternate_email:stringValue(personal.alternate_email,500,['alternate email','secondary email']), phone:stringValue(personal.phone,250,['phone','phone number','mobile','mobile number']), gender:stringValue(personal.gender,100,['gender']),
    location:{ city:stringValue(location.city,250,['city']), state:stringValue(location.state,250,['state']), country:stringValue(location.country,250,['country']) }
  });
  Object.assign(draft.links, {
    github:sanitizeDomainUrl(links.github,'github.com',['github','github url','github profile']), linkedin:sanitizeDomainUrl(links.linkedin,'linkedin.com',['linkedin','linkedin url','linkedin profile']), twitter:stringValue(links.twitter,1000,['twitter','x','twitter url']), portfolio:sanitizePortfolioUrl(links.portfolio), discord:stringValue(links.discord,500,['discord'])
  });
  draft.education = sanitizeEducation(source.education);
  draft.experience = sanitizeExperience(source.experience);
  Object.assign(draft.current_employment,{company:stringValue(employment.company,500,['company','current company','employer']),role:stringValue(employment.role,500,['role','current role','title','job title']),years_of_experience:stringValue(employment.years_of_experience,200,['years of experience','experience'])});
  draft.skills = stringArray(source.skills,80,200);
  draft.profile_text.bio = stringValue(profileText.bio,3000,['bio','summary','profile summary']);
  draft.profile_text.competitive_programming = stringValue(profileText.competitive_programming,1000);
  draft.profile_text.achievements = stringArray(profileText.achievements,30,1000);
  draft.profile_text.notes='';
  draft.job_preferences=createEmptyProfile().job_preferences; draft.documents=createEmptyProfile().documents; draft.learned_answers=[]; draft.custom={};
  const errors=validateProfile(draft); if(errors.length) throw new ResumeImportError('RESUME_DRAFT_INVALID',`Resume draft is invalid: ${errors.join('; ')}`,errors);
  return draft;
}

function comparableText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isNearDuplicateText(left, right) {
  const a = comparableText(left);
  const b = comparableText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 80) return false;
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return false;
  let intersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) intersection++;
  const containment = intersection / Math.min(aTokens.size, bTokens.size);
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return containment >= 0.9 && lengthRatio >= 0.8;
}

const MONTH_INDEX = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
};

function parsePeriodRank(period) {
  const text = cleanText(period).replace(/[–—]/g, '-');
  if (!text) return null;
  const dateMatches = [];
  const pattern = /\b(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?((?:19|20)\d{2})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const month = match[1] ? MONTH_INDEX[match[1].toLowerCase()] || 0 : 0;
    const year = Number(match[2]);
    dateMatches.push({ year, month, key: year * 12 + month });
  }
  if (!dateMatches.length) return null;
  const ongoing = /\b(present|current|now|ongoing)\b/i.test(text);
  const start = dateMatches[0];
  const end = ongoing ? { key: Number.MAX_SAFE_INTEGER } : dateMatches[dateMatches.length - 1];
  return { endKey: end.key, startKey: start.key, ongoing };
}

function latestDatedExperience(experience) {
  let best = null;
  for (let index = 0; index < (experience || []).length; index++) {
    const item = experience[index];
    if (!item || !item.company || !item.title) continue;
    const rank = parsePeriodRank(item.period);
    if (!rank) continue;
    const candidate = { item, index, ...rank };
    if (!best || candidate.endKey > best.endKey || (candidate.endKey === best.endKey && candidate.startKey > best.startKey) || (candidate.endKey === best.endKey && candidate.startKey === best.startKey && candidate.index < best.index)) {
      best = candidate;
    }
  }
  return best && best.item || null;
}

function deriveGraduationYear(duration) {
  const text = cleanText(duration).replace(/[–—]/g, '-');
  if (!text || /\b(present|current|now|ongoing)\b/i.test(text)) return '';
  const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  return years.length >= 2 ? years[years.length - 1] : '';
}

function finalizeResumeDraft(raw, resumeText) {
  const draft = sanitizeResumeDraft(raw);
  const facts = extractDeterministicResumeFacts(resumeText);
  if (facts.primary_email) draft.personal.primary_email = facts.primary_email;
  if (facts.phone) draft.personal.phone = facts.phone;
  if (facts.linkedin) draft.links.linkedin = facts.linkedin;
  if (facts.github) draft.links.github = facts.github;
  if (facts.portfolio) draft.links.portfolio = facts.portfolio;

  for (const item of draft.education) {
    if (!item.graduation_year) item.graduation_year = deriveGraduationYear(item.duration);
  }

  if (draft.profile_text.bio) {
    for (const item of draft.experience) {
      if (item.description && isNearDuplicateText(item.description, draft.profile_text.bio)) item.description = '';
    }
  }

  const latest = latestDatedExperience(draft.experience);
  if (latest) {
    if (!draft.current_employment.company) draft.current_employment.company = latest.company;
    if (!draft.current_employment.role) draft.current_employment.role = latest.title;
  }

  const errors = validateProfile(draft);
  if (errors.length) throw new ResumeImportError('RESUME_DRAFT_INVALID', `Final resume draft is invalid: ${errors.join('; ')}`, errors);
  return draft;
}

function keyOfEducation(item){return[item.institution,item.degree,item.graduation_year].map(value=>stringValue(value).toLowerCase()).join('|');}
function keyOfExperience(item){return[item.company,item.title,item.period].map(value=>stringValue(value).toLowerCase()).join('|');}
function fillEmpty(target,source,keys){for(const key of keys){if((target[key]===''||target[key]===null||target[key]===undefined)&&source[key])target[key]=source[key];}}
function mergeUniqueObjects(existing,incoming,keyFn){const output=Array.isArray(existing)?existing.map(item=>({...item})):[];const keys=new Set(output.map(keyFn).filter(Boolean));for(const item of incoming||[]){const key=keyFn(item);if(!key||keys.has(key))continue;output.push({...item});keys.add(key);}return output;}

function mergeResumeDraft(existingProfile,incomingDraft){
  const existing=existingProfile?JSON.parse(JSON.stringify(existingProfile)):createEmptyProfile(); const draft=sanitizeResumeDraft(incomingDraft);
  fillEmpty(existing.personal,draft.personal,['full_name','first_name','last_name','primary_email','alternate_email','phone','gender']); existing.personal.location=existing.personal.location||{city:'',state:'',country:''}; fillEmpty(existing.personal.location,draft.personal.location,['city','state','country']); fillEmpty(existing.links,draft.links,['github','linkedin','twitter','portfolio','discord']);
  existing.current_employment=existing.current_employment||{company:'',role:'',years_of_experience:''}; fillEmpty(existing.current_employment,draft.current_employment,['company','role','years_of_experience']);
  existing.education=mergeUniqueObjects(existing.education,draft.education,keyOfEducation); existing.experience=mergeUniqueObjects(existing.experience,draft.experience,keyOfExperience);
  const skillMap=new Map(); for(const skill of [...(existing.skills||[]),...(draft.skills||[])]){const text=stringValue(skill,200);const key=text.toLowerCase();if(text&&!skillMap.has(key))skillMap.set(key,text);} existing.skills=[...skillMap.values()];
  existing.profile_text=existing.profile_text||{bio:'',competitive_programming:'',achievements:[],notes:''}; fillEmpty(existing.profile_text,draft.profile_text,['bio','competitive_programming']); const achievementMap=new Map(); for(const item of [...(existing.profile_text.achievements||[]),...(draft.profile_text.achievements||[])]){const text=stringValue(item,1000);const key=text.toLowerCase();if(text&&!achievementMap.has(key))achievementMap.set(key,text);} existing.profile_text.achievements=[...achievementMap.values()];
  existing.job_preferences=existingProfile&&existingProfile.job_preferences||existing.job_preferences; existing.documents=existingProfile&&existingProfile.documents||existing.documents; existing.learned_answers=existingProfile&&existingProfile.learned_answers||existing.learned_answers; existing.custom=existingProfile&&existingProfile.custom||existing.custom;
  const errors=validateProfile(existing); if(errors.length) throw new ResumeImportError('RESUME_MERGE_INVALID',`Merged profile is invalid: ${errors.join('; ')}`,errors); return existing;
}

function buildResumeDraftPrompt(text) {
  return `You are extracting a candidate profile from resume text. Return ONLY JSON matching the requested profile shape.\n\nRESUME TEXT:\n${cleanText(text).slice(0,MAX_RESUME_TEXT_CHARS)}\n\nRules:\n- Use ONLY facts supported by the resume text.\n- If a value is absent or uncertain, use an empty string, empty array, or null rather than guessing.\n- Do not infer work authorization, sponsorship, salary, notice period, relocation preference, availability, or other job preferences from a resume.\n- Keep job_preferences empty/default.\n- Keep documents.resume_path empty.\n- Keep learned_answers empty and custom empty.\n- Do not return labels such as "LinkedIn", "GitHub", "Portfolio", "Email", "Phone", "Company", "Role", "Degree", or "Duration" as field values.\n- For links, return the actual URL only. If the URL is not present in the resume text, leave that link empty.\n- current_employment should reflect the current/latest role only when the resume clearly supports it.\n- years_of_experience should be copied only if explicitly stated; do not calculate it from dates.\n- For EVERY experience entry, keep company, title, period, and description separate. Never put a project name into title/period unless the resume explicitly presents it that way. If title or period is not supported, leave that field empty.\n- Do not reuse profile_text.bio/summary text as an experience description. If a role description is not supported by the resume, leave it empty.\n- For EVERY education entry, keep institution, degree, duration, and graduation_year separate. Do not copy one field into another. If a bounded duration explicitly ends in a graduation year, graduation_year may copy that explicit ending year; otherwise leave unsupported fields empty.\n- profile_text.bio may be a concise factual summary using only resume-supported information.\n\nReturn this JSON shape:\n${JSON.stringify(createEmptyProfile(),null,2)}`;
}

module.exports={MAX_RESUME_BYTES,MAX_RESUME_TEXT_CHARS,ResumeImportError,buildResumeDraftPrompt,cleanText,decodeBase64,detectFormat,deriveGraduationYear,extractDeterministicResumeFacts,extractResumeText,finalizeResumeDraft,isLabelEcho,isNearDuplicateText,latestDatedExperience,mergeResumeDraft,sanitizeResumeDraft,textQuality};