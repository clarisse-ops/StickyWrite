// LanguageTool: talks to a local LT server (scripts/start.py launches it).
// Adds a deeper rule set on top of Harper. Optional: app works without it.

const CAT_MAP = {
  TYPOS: 'correctness', GRAMMAR: 'correctness', PUNCTUATION: 'correctness',
  CASING: 'correctness', CONFUSED_WORDS: 'correctness', COMPOUNDING: 'correctness',
  TYPOGRAPHY: 'correctness', SEMANTICS: 'correctness', MISC: 'correctness',
  REDUNDANCY: 'clarity', STYLE: 'clarity', PLAIN_ENGLISH: 'clarity',
  WIKIPEDIA: 'clarity', COLLOQUIALISMS: 'engagement', REGIONALISMS: 'engagement',
  GENDER_NEUTRALITY: 'delivery', FORMAL_SPEECH: 'delivery',
};

export class LanguageToolEngine {
  constructor(baseUrl = 'http://localhost:8081') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.available = false;
  }

  async probe() {
    try {
      const res = await fetch(this.baseUrl + '/v2/languages', { signal: AbortSignal.timeout(2500) });
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async check(text, dialectName = 'American', dictWords = []) {
    if (!this.available || !text.trim()) return [];
    const lang = { American: 'en-US', British: 'en-GB', Australian: 'en-AU', Canadian: 'en-CA' }[dialectName] || 'en-US';
    // Default level (picky adds noisy typography rules, e.g. dash conversions).
    const body = new URLSearchParams({
      text: text.slice(0, 60000),
      language: lang,
      enabledOnly: 'false',
      disabledCategories: 'TYPOGRAPHY',
    });
    let data;
    try {
      const res = await fetch(this.baseUrl + '/v2/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return [];
      data = await res.json();
    } catch {
      return [];
    }
    const dict = new Set(dictWords.map(w => w.toLowerCase()));
    const out = [];
    for (const m of data.matches || []) {
      const problem = text.substr(m.offset, m.length);
      const catId = m.rule?.category?.id || 'MISC';
      // Respect the personal dictionary for spelling hits.
      if (catId === 'TYPOS' && dict.has(problem.toLowerCase().replace(/[^a-z']/g, ''))) continue;
      out.push({
        engine: 'lt',
        start: m.offset,
        end: m.offset + m.length,
        category: CAT_MAP[catId] || 'clarity',
        kindLabel: m.rule?.category?.name || 'Style',
        message: m.message,
        problem,
        replacements: (m.replacements || []).slice(0, 5).map(r => ({ text: r.value, kind: 0 })),
        ruleId: 'lt:' + (m.rule?.id || catId),
      });
    }
    return out;
  }
}
