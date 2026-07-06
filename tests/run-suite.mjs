// StickyWrite accuracy suite: context-rule unit tests + AI-tier tests.
// Run: node tests/run-suite.mjs [--skip-ai]
import { contextCheck } from '../js/engines/context-rules.js';
import { OllamaEngine } from '../js/engines/ollama-engine.js';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? '  [' + detail + ']' : '')); }
};

// ---------- context rules: must catch ----------
const CTX_CATCH = [
  ['your going to love this update.', 'your', "you're"],
  ['Their is a problem with the invoice.', 'Their', 'There'],
  ['Because there easier to work with, we won.', 'there', "they're"],
  ['Its a great opportunity for the brand.', 'Its', "It's"],
  ['We should of known better.', 'of', 'have'],
  ['He is to busy for another client.', 'to', 'too'],
  ['This looks better then before.', 'then', 'than'],
  ['Click over hear to continue.', 'hear', 'here'],
  ['Try typing you own text now.', 'you', 'your'],
  ['Hi my name is Sarah.', 'Hi', 'Hi,'],
  ['Not sure how this works. can you fix it.', 'can', 'Can'],
  ['Their going to announce it soon.', 'Their', "They're"],
  ['Thankyou for the quick turnaround.', 'Thankyou', 'Thank you'],
  ['He is taller then me.', 'then', 'than'],
  ['lowercase paragraph starts get flagged.', 'lowercase', 'Lowercase'],
];
for (const [text, target, expected] of CTX_CATCH) {
  const fs = contextCheck(text);
  const hit = fs.find(f => f.problem === target);
  ok(`ctx catches "${target}" in "${text.slice(0, 34)}..."`, !!hit, 'not flagged');
  if (hit) ok(`ctx primary for "${target}" is "${expected}"`, hit.replacements[0].text === expected,
    'got "' + hit.replacements[0].text + '"');
}

// ---------- context rules: must NOT flag ----------
const CTX_CLEAN = [
  ['Your working relationship with clients matters.', ['Your', 'working']],
  ['It is better that you decide.', ['that']],
  ['There are three engines under the hood.', ['There']],
  ['Visit stickypost.social for more examples.', ['social']],
  ['The meeting is at 3 p.m. tomorrow.', ['tomorrow']],
  ['I bought an iPhone yesterday.', ['iPhone']],
  ['Loose clothing is comfortable in summer.', ['Loose']],
  ['To be fair, the campaign did well.', ['To']],
  ['1. first item on the list', ['first']],
  ['We were there more than once.', ['there']],
];
for (const [text, words] of CTX_CLEAN) {
  const fs = contextCheck(text);
  for (const w of words) {
    const wrongly = fs.find(f => f.problem === w);
    ok(`ctx leaves "${w}" alone in "${text.slice(0, 34)}..."`, !wrongly,
      wrongly ? 'flagged as ' + wrongly.ruleId + ' -> ' + wrongly.replacements[0]?.text : '');
  }
}

// ---------- AI tier (rewrite-diff, real model) ----------
if (!process.argv.includes('--skip-ai')) {
  const eng = new OllamaEngine('http://localhost:11434');
  await eng.probe();
  if (!eng.available) {
    console.log('AI tier: Ollama not reachable, skipped.');
  } else {
    console.log('AI tier: using', eng.model);
    const AI_CATCH = [
      ['I want to sell my hole house before summer ends.', 'whole'],
      ['Can you here me now or is the audio broken.', 'hear'],
      ['We except your proposal and can start next week.', 'accept'],
      ['Please bare with me while we fix the scheduling issue.', 'bear'],
      ['The change had a big affect on our monthly numbers.', 'effect'],
      ['I would of never guessed the campaign would win.', 'have'],
      ['Lets talk about you\'re plan for the quarter tomorrow.', 'your'],
      ['It is a strange feeling, watching software work better that you do.', 'than'],
    ];
    for (const [text, expected] of AI_CATCH) {
      try {
        const errs = await eng.grammarCheck(text);
        const hit = errs.some(e => e.corrected.toLowerCase().includes(expected));
        const offsetsValid = errs.every(e => text.substr(e.offset, e.length) === e.original);
        ok(`AI catches "${expected}" in "${text.slice(0, 38)}..."`, hit,
          'suggestions: ' + errs.map(e => `"${e.original}"->"${e.corrected}"`).join(', '));
        ok(`AI offsets valid for "${text.slice(0, 30)}..."`, offsetsValid);
      } catch (err) {
        ok(`AI catches "${expected}"`, false, 'error: ' + err.message);
      }
    }
    const AI_CLEAN = [
      ['We keep the design gray and centered on every slide.', ['grey', 'centred']],
      ['Their team shipped the project on time and under budget.', ["they're", 'there']],
      ['You should have seen how well the launch went.', ['should of']],
    ];
    for (const [text, banned] of AI_CLEAN) {
      try {
        const errs = await eng.grammarCheck(text);
        const bad = errs.filter(e => banned.some(b => e.corrected.toLowerCase().includes(b)));
        ok(`AI leaves "${text.slice(0, 38)}..." alone`, bad.length === 0,
          bad.map(e => `"${e.original}"->"${e.corrected}"`).join(', '));
      } catch (err) {
        ok(`AI clean "${text.slice(0, 30)}"`, false, 'error: ' + err.message);
      }
    }
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
for (const f of failures) console.log('FAIL:', f);
process.exit(fail ? 1 : 0);
