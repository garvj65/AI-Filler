'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {finalizeResumeDraft,deriveGraduationYear,latestDatedExperience,isNearDuplicateText}=require('../lib/resume');
const bio='Computer Science graduate with hands-on experience in voice AI, telephony systems, and speech-processing workflows. Interested in building reliable voice applications that work well in real-world calling environments.';

test('removes duplicated bio and derives latest current role',()=>{
  const near=bio.replace('real-world calling environments.','real world calling environments');
  assert.equal(isNearDuplicateText(near,bio),true);
  const draft=finalizeResumeDraft({profile_text:{bio},experience:[
    {company:'Starmark',title:'AI Intern',period:'Feb 2026 - Jun 2026',description:near},
    {company:'Truffl',title:'AI Research Engineer',period:'Jun 2026 - Aug 2026',description:'Turn-taking module'},
    {company:'Augmento Labs',title:'AI Intern',period:'Feb 2026 - Aug 2026',description:'PDF workflow'}
  ],current_employment:{company:'',role:'',years_of_experience:''}},'garv@example.com');
  assert.equal(draft.experience[0].description,'');
  assert.equal(draft.current_employment.company,'Truffl');
  assert.equal(draft.current_employment.role,'AI Research Engineer');
  assert.equal(draft.current_employment.years_of_experience,'');
});

test('preserves explicit current employment and ranks Present latest',()=>{
  const latest=latestDatedExperience([{company:'Old',title:'Intern',period:'Jan 2026 - Aug 2026'},{company:'Current',title:'Engineer',period:'Jul 2026 - Present'}]);
  assert.equal(latest.company,'Current');
  const draft=finalizeResumeDraft({experience:[latest],current_employment:{company:'Explicit',role:'Explicit Role',years_of_experience:'2 years'}},'garv@example.com');
  assert.equal(draft.current_employment.company,'Explicit');
  assert.equal(draft.current_employment.role,'Explicit Role');
  assert.equal(draft.current_employment.years_of_experience,'2 years');
});

test('derives bounded graduation years and abstains on open-ended dates',()=>{
  assert.equal(deriveGraduationYear('2022 - 2026'),'2026');
  assert.equal(deriveGraduationYear('2022–2026'),'2026');
  assert.equal(deriveGraduationYear('Aug 2022 - May 2026'),'2026');
  assert.equal(deriveGraduationYear('2022 to 2026'),'2026');
  assert.equal(deriveGraduationYear('2022 - Present'),'');
  const draft=finalizeResumeDraft({education:[{institution:'BMSIT',degree:'B.E. CSE',duration:'2022 - 2026',graduation_year:''},{institution:'Open',degree:'Degree',duration:'2022 - Present',graduation_year:''}]},'garv@example.com');
  assert.equal(draft.education[0].graduation_year,'2026');
  assert.equal(draft.education[1].graduation_year,'');
});
