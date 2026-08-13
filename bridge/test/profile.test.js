'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileError, loadProfileFromFile, parseProfile, validateProfile } = require('../lib/profile');

function minimalProfile() {
  return {
    schema_version: 1,
    personal: {}, links: {}, education: [], experience: [], skills: [],
    job_preferences: {}, documents: {}, learned_answers: []
  };
}

test('accepts a partial but structurally valid v1 profile', () => {
  assert.deepEqual(validateProfile(minimalProfile()), []);
});

test('rejects schema-invalid profile data with actionable paths', () => {
  const profile = minimalProfile();
  profile.skills = 'Python';
  profile.personal.phone = 123;
  const errors = validateProfile(profile);
  assert.ok(errors.includes('skills must be array'));
  assert.ok(errors.includes('personal.phone must be string'));
});

test('reports malformed JSON distinctly', () => {
  assert.throws(() => parseProfile('{not json'), error => {
    assert.ok(error instanceof ProfileError);
    assert.equal(error.code, 'PROFILE_JSON_INVALID');
    return true;
  });
});

test('migrates legacy profile while preserving resume and learned answers', () => {
  const legacy = {
    full_name: 'Jane Doe', primary_email: 'jane@example.com', resume_path: '/tmp/resume.pdf',
    college: 'Example University', degree: 'B.Tech', skills: ['Python'],
    learned_answers: [{ question: 'Relocate?', answer: 'Yes' }]
  };
  const { profile, migrated } = parseProfile(JSON.stringify(legacy));
  assert.equal(migrated, true);
  assert.equal(profile.personal.full_name, 'Jane Doe');
  assert.equal(profile.documents.resume_path, '/tmp/resume.pdf');
  assert.deepEqual(profile.learned_answers, legacy.learned_answers);
  assert.equal(profile.education[0].institution, 'Example University');
});

test('loads a valid file and reports a missing file distinctly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-filler-profile-'));
  const file = path.join(dir, 'profile.json');
  fs.writeFileSync(file, JSON.stringify(minimalProfile()));
  assert.equal(loadProfileFromFile(file).profile.schema_version, 1);
  assert.throws(() => loadProfileFromFile(path.join(dir, 'missing.json')), error => error.code === 'PROFILE_FILE_MISSING');
});
