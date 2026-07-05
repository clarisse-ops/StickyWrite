// Context rules: deterministic catches for the classic confused-word traps
// (your/you're, hear/here, should of, better then...). Pure JavaScript, so
// they work everywhere the app runs, including the hosted Harper-only version.
// Every rule is precision-first: a rule that sometimes flags correct writing
// is worse than no rule at all.

const RULES = [
  {
    id: 'your-gerund',
    // "your working on" -> you're (gerund must be followed by a preposition or
    // end of clause, so "your working relationship" stays untouched)
    re: /\byour(?=\s+\w+ing\s*(?:on|with|to|at|for|about|out|up|in|so|and|but|[.,!?;:]|$))/gi,
    fix: (m) => (m[0] === 'Y' ? "You're" : "you're"),
    message: 'This looks like "you are", which is spelled "you\'re".',
  },
  {
    id: 'your-adverb',
    // "your going to", "your so", "your not", "your welcome"
    re: /\byour(?=\s+(?:gonna|going\s+to|so|too|very|really|probably|definitely|always|never|not|welcome|sure|right|wrong|done|almost|still|just)\b)/gi,
    fix: (m) => (m[0] === 'Y' ? "You're" : "you're"),
    message: 'This looks like "you are", which is spelled "you\'re".',
  },
  {
    id: 'their-verb',
    re: /\btheir(?=\s+(?:is|are|was|were|will|would)\b)/gi,
    fix: (m) => (m[0] === 'T' ? 'There' : 'there'),
    message: '"Their" shows ownership. Before "is" or "are", you want "there".',
  },
  {
    id: 'there-own',
    re: /\bthere(?=\s+own\b)/gi,
    fix: (m) => (m[0] === 'T' ? 'Their' : 'their'),
    message: '"There" is a place. For ownership, you want "their".',
  },
  {
    id: 'its-verb',
    re: /\bits(?=\s+(?:a|an|the|been|not|going|gonna|very|really|only|just|about|time)\b)/gi,
    fix: (m) => (m[0] === 'I' ? "It's" : "it's"),
    message: 'This looks like "it is", which is spelled "it\'s".',
  },
  {
    id: 'apostrophe-s-own',
    re: /\bit's(?=\s+own\b)/gi,
    fix: (m) => (m[0] === 'I' ? 'Its' : 'its'),
    message: 'For ownership, "its" has no apostrophe.',
  },
  {
    id: 'hear-here',
    re: /(?<=\b(?:right|over|down|up|in|out|click|come|stay|live|move|sign|start|from|text|type|typing|paste|write)\s)hear\b/gi,
    fix: (m) => (m[0] === 'H' ? 'Here' : 'here'),
    message: '"Hear" is for listening. For a place, you want "here".',
  },
  {
    id: 'you-own',
    re: /\byou(?=\s+own\s+(?:text|words|content|voice|style|pace|way|time|thing|stuff|ideas|story|schedule)\b)/gi,
    fix: (m) => (m[0] === 'Y' ? 'Your' : 'your'),
    message: 'This looks like ownership, which is "your own".',
  },
  {
    id: 'should-of',
    re: /\b(?:should|would|could|must|might)\s+(of)\b/gi,
    group: 1,
    fix: () => 'have',
    message: '"Should of" is a mishearing of "should\'ve". Write "have".',
  },
  {
    id: 'to-adjective',
    re: /\bto(?=\s+(?:big|small|late|early|much|many|good|bad|long|short|hard|easy|hot|cold|fast|slow|busy|expensive|difficult|complicated|tired|old|young)\b)/gi,
    fix: (m) => (m[0] === 'T' ? 'Too' : 'too'),
    message: 'Before an adjective like this, you want "too" (meaning overly).',
  },
  {
    id: 'then-comparison',
    re: /(?<=\b(?:more|less|better|worse|faster|slower|higher|lower|bigger|smaller|easier|harder|rather|other|greater|cheaper|stronger|longer|shorter)\s)then\b/gi,
    fix: (m) => (m[0] === 'T' ? 'Than' : 'than'),
    message: 'Comparisons use "than". "Then" is about time.',
  },
  {
    id: 'loose-lose',
    re: /\bloose(?=\s+(?:weight|money|time|clients?|customers?|sleep|track|money|hope|interest|followers|momentum|him|her|them|it|you)\b)/gi,
    fix: (m) => (m[0] === 'L' ? 'Lose' : 'lose'),
    message: '"Loose" means not tight. You want "lose".',
  },
  {
    id: 'greeting-comma',
    re: /\b(Hi|Hey|Hello)(?=\s+(?:my|I'm|I\s+am|everyone|guys|team|all)\b)/g,
    fix: (m) => m + ',',
    message: 'A greeting takes a comma: "Hi, my name is..."',
  },
];

export function contextCheck(text) {
  const out = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const hit = rule.group ? m[rule.group] : m[0];
      const start = rule.group ? m.index + m[0].indexOf(hit) : m.index;
      out.push({
        engine: 'ctx',
        start,
        end: start + hit.length,
        category: 'correctness',
        kindLabel: 'Commonly confused',
        message: rule.message,
        problem: hit,
        replacements: [{ text: rule.fix(hit), kind: 0 }],
        ruleId: 'ctx:' + rule.id,
      });
      if (rule.re.lastIndex === m.index) rule.re.lastIndex++;
    }
  }
  return out;
}
