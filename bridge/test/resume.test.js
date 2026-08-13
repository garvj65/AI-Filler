'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_RESUME_BYTES,
  ResumeImportError,
  buildResumeDraftPrompt,
  detectFormat,
  extractDeterministicResumeFacts,
  extractResumeText,
  finalizeResumeDraft,
  mergeResumeDraft,
  sanitizeResumeDraft
} = require('../lib/resume');
const { createEmptyProfile, validateProfile } = require('../lib/profile');

const usefulText = `Garv Jhajharia
AI Engineer
garv@example.com
+91 9743011840
Bengaluru, India
LinkedIn: https://www.linkedin.com/in/garvjhajharia/
GitHub: github.com/garvj65
Portfolio
https://garv.dev

Experience
Example Labs — AI Engineer — 2025 to Present
Built applied AI systems for real customer workflows using Python, JavaScript, SQL, APIs, speech recognition, backend services, validation, testing, and deployment.

Education
BMS Institute of Technology and Management — B.Tech Computer Science — 2022 to 2026

Skills
Python JavaScript SQL Node.js React APIs Machine Learning`;
const b64 = value => Buffer.from(value).toString('base64');

function existingProfile() {
  const p = createEmptyProfile();
  p.personal.full_name = 'Confirmed Name';
  p.personal.primary_email = 'confirmed@example.com';
  p.links.github = 'https://github.com/confirmed';
  p.education = [{ institution:'BMSIT', degree:'B.Tech CSE', duration:'', graduation_year:'2026', current_year_of_study:'', class_12_percentage:'', class_10_percentage:'' }];
  p.experience = [{ company:'Old Co', title:'Intern', period:'2024', description:'Existing confirmed experience' }];
  p.skills = ['Python'];
  p.job_preferences.current_ctc = '5 LPA';
  p.documents.resume_path = 'C:/confirmed/resume.pdf';
  p.learned_answers = [{ question:'Why this role?', answer:'Confirmed answer' }];
  p.custom = { keep:true };
  return p;
}

test('detects supported formats and rejects unsupported input', () => {
  assert.equal(detectFormat('resume.pdf',''),'pdf');
  assert.equal(detectFormat('resume.docx',''),'docx');
  assert.equal(detectFormat('resume.txt',''),'txt');
  assert.throws(() => detectFormat('resume.doc','application/msword'), e => e.code === 'RESUME_FORMAT_UNSUPPORTED');
});

test('extracts useful TXT natively', async () => {
  const r = await extractResumeText({ fileName:'resume.txt', mimeType:'text/plain', base64:b64(usefulText) });
  assert.equal(r.format,'txt');
  assert.match(r.text,/Garv Jhajharia/);
});

test('extracts PDF and detects OCR-required sparse PDFs', async () => {
  let destroyed = false;
  class GoodPDF { async getText(){return{text:usefulText}} async destroy(){destroyed=true} }
  const r = await extractResumeText({fileName:'resume.pdf',mimeType:'application/pdf',base64:b64('pdf')},{loaders:{PDFParse:GoodPDF}});
  assert.equal(r.format,'pdf');
  assert.equal(destroyed,true);
  class SparsePDF { async getText(){return{text:'Garv Jhajharia'}} async destroy(){} }
  await assert.rejects(() => extractResumeText({fileName:'scan.pdf',mimeType:'application/pdf',base64:b64('pdf')},{loaders:{PDFParse:SparsePDF}}), e => e instanceof ResumeImportError && e.code === 'RESUME_OCR_REQUIRED');
});

test('extracts DOCX with Mammoth raw-text API', async () => {
  const mammoth = { async extractRawText({buffer}) { assert.ok(Buffer.isBuffer(buffer)); return { value:usefulText, messages:[{message:'warning'}] }; } };
  const r = await extractResumeText({fileName:'resume.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',base64:b64('docx')},{loaders:{mammoth}});
  assert.deepEqual(r.warnings,['warning']);
});

test('rejects oversized input before parsing', async () => {
  const huge = Buffer.alloc(MAX_RESUME_BYTES + 1,65).toString('base64');
  await assert.rejects(() => extractResumeText({fileName:'resume.txt',mimeType:'text/plain',base64:huge}), e => e.code === 'RESUME_FILE_TOO_LARGE');
});

test('deterministically extracts email, phone, LinkedIn, GitHub and labeled portfolio URL', () => {
  const facts = extractDeterministicResumeFacts(usefulText);
  assert.equal(facts.primary_email, 'garv@example.com');
  assert.equal(facts.phone, '+91 9743011840');
  assert.equal(facts.linkedin, 'https://www.linkedin.com/in/garvjhajharia');
  assert.equal(facts.github, 'https://github.com/garvj65');
  assert.equal(facts.portfolio, 'https://garv.dev');
});

test('does not invent portfolio from unrelated GitHub or LinkedIn URLs', () => {
  const facts = extractDeterministicResumeFacts('LinkedIn https://linkedin.com/in/user\nGitHub https://github.com/user\n' + usefulText.replace(/Portfolio\nhttps:\/\/garv\.dev/,'') );
  assert.equal(facts.portfolio, '');
});

test('sanitizes real smoke-test label echoes and invalid social values', () => {
  const d = sanitizeResumeDraft({
    personal: { full_name:'Full Name', primary_email:'Email', phone:'Phone', location:{city:'City',state:'State',country:'India'} },
    links: { linkedin:'Linkedin', github:'GitHub', portfolio:'Portfolio' },
    current_employment: { company:'Company', role:'Role', years_of_experience:'Years of Experience' },
    education: [{ institution:'Institution', degree:'Degree', duration:'Duration', graduation_year:'Graduation Year' }],
    experience: [{ company:'Company', title:'Title', period:'Period', description:'Description' }]
  });
  assert.equal(d.personal.full_name, '');
  assert.equal(d.personal.primary_email, '');
  assert.equal(d.personal.phone, '');
  assert.equal(d.personal.location.city, '');
  assert.equal(d.personal.location.state, '');
  assert.equal(d.personal.location.country, 'India');
  assert.equal(d.links.linkedin, '');
  assert.equal(d.links.github, '');
  assert.equal(d.links.portfolio, '');
  assert.equal(d.current_employment.company, '');
  assert.equal(d.current_employment.role, '');
  assert.equal(d.current_employment.years_of_experience, '');
  assert.deepEqual(d.education, []);
  assert.deepEqual(d.experience, []);
});

test('rejects wrong-domain URLs in LinkedIn and GitHub fields', () => {
  const d = sanitizeResumeDraft({ links: { linkedin:'https://example.com/linkedin', github:'https://gitlab.com/user' } });
  assert.equal(d.links.linkedin, '');
  assert.equal(d.links.github, '');
});

test('final draft prefers deterministic contact/link facts over weak Groq output', () => {
  const raw = {
    personal: { primary_email:'wrong@example.net', phone:'Phone' },
    links: { linkedin:'Linkedin', github:'https://github.com/wrong', portfolio:'Portfolio' }
  };
  const d = finalizeResumeDraft(raw, usefulText);
  assert.equal(d.personal.primary_email, 'garv@example.com');
  assert.equal(d.personal.phone, '+91 9743011840');
  assert.equal(d.links.linkedin, 'https://www.linkedin.com/in/garvjhajharia');
  assert.equal(d.links.github, 'https://github.com/garvj65');
  assert.equal(d.links.portfolio, 'https://garv.dev');
});

test('preserves experience and education fields separately when supplied', () => {
  const d = sanitizeResumeDraft({
    education:[{institution:'BMS Institute of Technology & Management',degree:'B.E., Computer Science & Engineering',duration:'2022–2026',graduation_year:'2026'}],
    experience:[{company:'Truffl',title:'AI Research Engineer',period:'Jul 2026 – Present',description:'Project: Turn-Taking Kernel'}]
  });
  assert.deepEqual(d.education[0], { institution:'BMS Institute of Technology & Management', degree:'B.E., Computer Science & Engineering', duration:'2022–2026', graduation_year:'2026', current_year_of_study:'', class_12_percentage:'', class_10_percentage:'' });
  assert.deepEqual(d.experience[0], { company:'Truffl', title:'AI Research Engineer', period:'Jul 2026 – Present', description:'Project: Turn-Taking Kernel' });
});

test('draft prompt explicitly requires structured experience/education and forbids years calculation', () => {
  const prompt = buildResumeDraftPrompt(usefulText);
  assert.match(prompt, /For EVERY experience entry, keep company, title, period, and description separate/);
  assert.match(prompt, /For EVERY education entry, keep institution, degree, duration, and graduation_year separate/);
  assert.match(prompt, /years_of_experience should be copied only if explicitly stated; do not calculate it from dates/);
  assert.match(prompt, /Do not return labels such as "LinkedIn"/);
});

test('sanitizes draft and strips preferences/local state', () => {
  const d = sanitizeResumeDraft({personal:{full_name:' Jane Doe ',primary_email:'jane@example.com',location:{city:'Bengaluru'}},links:{github:'https://github.com/jane'},education:[{institution:'Uni',degree:'B.Tech',graduation_year:'2026'}],experience:[{company:'Co',title:'Engineer',period:'2025-present',description:'Worked on AI'}],skills:['Python','python','',7],job_preferences:{current_ctc:'999 LPA'},documents:{resume_path:'/invented/path.pdf'},learned_answers:[{question:'x',answer:'y'}],profile_text:{bio:'Factual bio',achievements:['Won X','won x']}});
  assert.equal(d.personal.full_name,'Jane Doe');
  assert.deepEqual(d.skills,['Python']);
  assert.equal(d.job_preferences.current_ctc,'');
  assert.equal(d.documents.resume_path,'');
  assert.deepEqual(d.learned_answers,[]);
  assert.deepEqual(validateProfile(d),[]);
});

test('non-destructive merge preserves confirmed local state', () => {
  const m = mergeResumeDraft(existingProfile(),{personal:{full_name:'Resume Name',primary_email:'resume@example.com',phone:'+91 12345',location:{city:'Bengaluru'}},links:{github:'https://github.com/resume',linkedin:'https://linkedin.com/in/resume'},current_employment:{company:'New Co',role:'AI Engineer',years_of_experience:'2 years'},education:[{institution:'BMSIT',degree:'B.Tech CSE',graduation_year:'2026'},{institution:'High School',degree:'12th',graduation_year:'2022'}],experience:[{company:'Old Co',title:'Intern',period:'2024',description:'duplicate'},{company:'New Co',title:'AI Engineer',period:'2025-present',description:'role'}],skills:['python','JavaScript'],profile_text:{bio:'Resume bio',achievements:['Achievement A']},job_preferences:{current_ctc:'999 LPA'}});
  assert.equal(m.personal.full_name,'Confirmed Name');
  assert.equal(m.personal.primary_email,'confirmed@example.com');
  assert.equal(m.personal.phone,'+91 12345');
  assert.equal(m.links.github,'https://github.com/confirmed');
  assert.equal(m.links.linkedin,'https://linkedin.com/in/resume');
  assert.equal(m.job_preferences.current_ctc,'5 LPA');
  assert.equal(m.documents.resume_path,'C:/confirmed/resume.pdf');
  assert.deepEqual(m.learned_answers,[{question:'Why this role?',answer:'Confirmed answer'}]);
  assert.deepEqual(m.custom,{keep:true});
  assert.equal(m.education.length,2);
  assert.equal(m.experience.length,2);
  assert.deepEqual(m.skills,['Python','JavaScript']);
  assert.deepEqual(validateProfile(m),[]);
});
