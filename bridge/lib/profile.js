'use strict';

const fs = require('fs');

class ProfileError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireType(errors, path, value, type) {
  if (type === 'array' ? !Array.isArray(value) : type === 'object' ? !isObject(value) : typeof value !== type) {
    errors.push(`${path} must be ${type}`);
  }
}

function validateStringFields(errors, object, fields, prefix) {
  if (!isObject(object)) return;
  for (const key of fields) {
    if (object[key] !== undefined && object[key] !== null && typeof object[key] !== 'string') {
      errors.push(`${prefix}.${key} must be string`);
    }
  }
}

function validateProfile(profile) {
  const errors = [];
  if (!isObject(profile)) return ['profile must be object'];
  if (profile.schema_version !== 1) errors.push('schema_version must equal 1');

  const requiredObjects = ['personal', 'links', 'job_preferences', 'documents'];
  const requiredArrays = ['education', 'experience', 'skills', 'learned_answers'];
  for (const key of requiredObjects) requireType(errors, key, profile[key], 'object');
  for (const key of requiredArrays) requireType(errors, key, profile[key], 'array');

  validateStringFields(errors, profile.personal, ['full_name', 'first_name', 'last_name', 'primary_email', 'alternate_email', 'phone', 'gender'], 'personal');
  if (isObject(profile.personal) && profile.personal.location !== undefined) {
    requireType(errors, 'personal.location', profile.personal.location, 'object');
    validateStringFields(errors, profile.personal.location, ['city', 'state', 'country'], 'personal.location');
  }

  validateStringFields(errors, profile.links, ['github', 'linkedin', 'twitter', 'portfolio', 'discord'], 'links');
  validateStringFields(
    errors,
    profile.job_preferences,
    [
      'applying_for', 'availability', 'current_ctc', 'expected_ctc', 'notice_period',
      'work_authorization', 'current_employment_status', 'preferred_work_location',
      'employment_type', 'joining_date'
    ],
    'job_preferences'
  );
  if (isObject(profile.job_preferences) && profile.job_preferences.willing_to_relocate !== undefined && profile.job_preferences.willing_to_relocate !== null && typeof profile.job_preferences.willing_to_relocate !== 'boolean') {
    errors.push('job_preferences.willing_to_relocate must be boolean or null');
  }
  if (isObject(profile.job_preferences) && profile.job_preferences.requires_sponsorship !== undefined && profile.job_preferences.requires_sponsorship !== null && typeof profile.job_preferences.requires_sponsorship !== 'boolean') {
    errors.push('job_preferences.requires_sponsorship must be boolean or null');
  }

  validateStringFields(errors, profile.documents, ['resume_path'], 'documents');

  if (Array.isArray(profile.skills) && profile.skills.some(item => typeof item !== 'string')) {
    errors.push('skills items must be string');
  }

  if (Array.isArray(profile.education)) {
    profile.education.forEach((item, index) => {
      if (!isObject(item)) return errors.push(`education[${index}] must be object`);
      validateStringFields(errors, item, ['institution', 'degree', 'duration', 'graduation_year', 'current_year_of_study', 'class_12_percentage', 'class_10_percentage'], `education[${index}]`);
    });
  }

  if (Array.isArray(profile.experience)) {
    profile.experience.forEach((item, index) => {
      if (!isObject(item)) return errors.push(`experience[${index}] must be object`);
      validateStringFields(errors, item, ['company', 'title', 'period', 'description'], `experience[${index}]`);
    });
  }

  if (profile.current_employment !== undefined) {
    requireType(errors, 'current_employment', profile.current_employment, 'object');
    validateStringFields(errors, profile.current_employment, ['company', 'role', 'years_of_experience'], 'current_employment');
  }

  if (profile.profile_text !== undefined) {
    requireType(errors, 'profile_text', profile.profile_text, 'object');
    validateStringFields(errors, profile.profile_text, ['bio', 'competitive_programming', 'notes'], 'profile_text');
    if (isObject(profile.profile_text) && profile.profile_text.achievements !== undefined) {
      requireType(errors, 'profile_text.achievements', profile.profile_text.achievements, 'array');
      if (Array.isArray(profile.profile_text.achievements) && profile.profile_text.achievements.some(item => typeof item !== 'string')) {
        errors.push('profile_text.achievements items must be string');
      }
    }
  }

  if (Array.isArray(profile.learned_answers)) {
    profile.learned_answers.forEach((item, index) => {
      if (!isObject(item)) return errors.push(`learned_answers[${index}] must be object`);
      if (typeof item.question !== 'string' || !item.question.trim()) errors.push(`learned_answers[${index}].question must be non-empty string`);
      if (!Object.prototype.hasOwnProperty.call(item, 'answer')) errors.push(`learned_answers[${index}].answer is required`);
    });
  }

  if (profile.custom !== undefined && !isObject(profile.custom)) errors.push('custom must be object');
  return errors;
}

function createEmptyProfile() {
  return {
    schema_version: 1,
    personal: {
      full_name: '',
      first_name: '',
      last_name: '',
      primary_email: '',
      alternate_email: '',
      phone: '',
      gender: '',
      location: { city: '', state: '', country: '' }
    },
    links: { github: '', linkedin: '', twitter: '', portfolio: '', discord: '' },
    education: [],
    experience: [],
    current_employment: { company: '', role: '', years_of_experience: '' },
    skills: [],
    job_preferences: {
      applying_for: '',
      availability: '',
      current_ctc: '',
      expected_ctc: '',
      notice_period: '',
      willing_to_relocate: null,
      work_authorization: '',
      requires_sponsorship: null,
      current_employment_status: '',
      preferred_work_location: '',
      employment_type: '',
      joining_date: ''
    },
    documents: { resume_path: '' },
    profile_text: { bio: '', competitive_programming: '', achievements: [], notes: '' },
    learned_answers: [],
    custom: {}
  };
}

function migrateLegacyProfile(legacy) {
  const workExperience = Array.isArray(legacy.work_experience) ? legacy.work_experience : [];
  const positions = Array.isArray(legacy.positions) ? legacy.positions : [];
  const experience = [];

  for (const item of workExperience) {
    if (typeof item === 'string') experience.push({ company: '', title: '', period: '', description: item });
    else if (isObject(item)) experience.push({ company: item.company || '', title: item.title || item.role || '', period: item.period || item.duration || '', description: item.description || '' });
  }
  for (const item of positions) {
    if (typeof item === 'string') experience.push({ company: '', title: '', period: '', description: item });
  }

  return {
    schema_version: 1,
    personal: {
      full_name: legacy.full_name || '',
      first_name: legacy.first_name || '',
      last_name: legacy.last_name || '',
      primary_email: legacy.primary_email || '',
      alternate_email: legacy.alternate_email || '',
      phone: legacy.phone || '',
      gender: legacy.gender || '',
      location: { city: legacy.home_city || '', state: legacy.home_state || '', country: legacy.country || '' }
    },
    links: { github: legacy.github || '', linkedin: legacy.linkedin || '', twitter: legacy.twitter || '', portfolio: legacy.portfolio || '', discord: legacy.discord || '' },
    education: legacy.college || legacy.degree || legacy.graduation_year ? [{
      institution: legacy.college || '', degree: legacy.degree || '', duration: legacy.education_duration || '', graduation_year: legacy.graduation_year || '',
      current_year_of_study: legacy.current_year_of_study || '', class_12_percentage: legacy.class_12_percentage || '', class_10_percentage: legacy.class_10_percentage || ''
    }] : [],
    experience,
    current_employment: { company: legacy.current_company || '', role: legacy.current_role || '', years_of_experience: legacy.years_of_experience_in_development || legacy.years_of_experience || '' },
    skills: Array.isArray(legacy.skills) ? legacy.skills : [],
    job_preferences: {
      applying_for: legacy.applying_for || '',
      availability: legacy.availability || '',
      current_ctc: legacy.current_ctc || '',
      expected_ctc: legacy.expected_ctc || '',
      notice_period: legacy.notice_period || '',
      willing_to_relocate: typeof legacy.willing_to_relocate === 'boolean' ? legacy.willing_to_relocate : null,
      work_authorization: legacy.work_authorization || '',
      requires_sponsorship: typeof legacy.requires_sponsorship === 'boolean' ? legacy.requires_sponsorship : null,
      current_employment_status: legacy.current_employment_status || '',
      preferred_work_location: legacy.preferred_work_location || '',
      employment_type: legacy.employment_type || '',
      joining_date: legacy.joining_date || legacy.start_date || ''
    },
    documents: { resume_path: legacy.resume_path || '' },
    profile_text: { bio: legacy.bio || '', competitive_programming: legacy.competitive_programming || '', achievements: Array.isArray(legacy.achievements) ? legacy.achievements : [], notes: legacy.notes || '' },
    learned_answers: Array.isArray(legacy.learned_answers) ? legacy.learned_answers : [],
    custom: {}
  };
}

function parseProfile(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch (error) { throw new ProfileError('PROFILE_JSON_INVALID', `profile.json is not valid JSON: ${error.message}`); }

  const migrated = raw && raw.schema_version === undefined;
  const profile = migrated ? migrateLegacyProfile(raw) : raw;
  const errors = validateProfile(profile);
  if (errors.length) throw new ProfileError('PROFILE_SCHEMA_INVALID', `profile.json does not match candidate profile schema v1: ${errors.join('; ')}`, errors);
  return { profile, migrated };
}

function loadProfileFromFile(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ProfileError('PROFILE_FILE_MISSING', `Profile file not found at ${filePath}. Copy profile.example.json to profile.json and fill it in.`);
    throw error;
  }
  return parseProfile(text);
}

function saveProfileToFile(filePath, profile) {
  const errors = validateProfile(profile);
  if (errors.length) throw new ProfileError('PROFILE_SCHEMA_INVALID', `Refusing to save invalid profile: ${errors.join('; ')}`, errors);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2) + '\n');
}

function getResumePath(profile) {
  return profile && profile.documents && profile.documents.resume_path || '';
}

module.exports = { ProfileError, createEmptyProfile, getResumePath, loadProfileFromFile, migrateLegacyProfile, parseProfile, saveProfileToFile, validateProfile };
