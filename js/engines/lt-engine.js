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

// LanguageTool's own free public API. Used only when no local server exists
// and the user has the cloud setting on. Rate-limited by LT: we pace calls.
const CLOUD_BASE = 'https://api.languagetool.org';
const CLOUD_MIN_INTERVAL_MS = 4500;
const CLOUD_MAX_CHARS = 19000;

export class LanguageToolEngine {
  constructor(baseUrl = 'http://localhost:8081') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.available = false;
    this.mode = 'off';          // 'local' | 'cloud' | 'off'
    this.cloudEnabled = true;
    this._cloudOk = null;       // cached cloud reachability
    this._cloudProbedAt = 0;
    this._lastCloudCall = 0;
  }

  _apiBase() {
    return this.mode === 'cloud' ? CLOUD_BASE : this.baseUrl;
  }

  async probe() {
    try {
      const res = await fetch(this.baseUrl + '/v2/languages', { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        this.mode = 'local';
        this.available = true;
        return this.available;
      }
    } catch { /* no local server */ }

    if (this.cloudEnabled) {
      // Re-probe a failed cloud every 5 minutes instead of giving up forever.
      if (this._cloudOk === null || (!this._cloudOk && Date.now() - this._cloudProbedAt > 300000)) {
        this._cloudProbedAt = Date.now();
        try {
          const res = await fetch(CLOUD_BASE + '/v2/languages', { signal: AbortSignal.timeout(5000) });
          this._cloudOk = res.ok;
        } catch {
          this._cloudOk = false;
        }
      }
      if (this._cloudOk) {
        this.mode = 'cloud';
        this.available = true;
        return this.available;
      }
    }
    this.mode = 'off';
    this.available = false;
    return this.available;
  }

  // Returns an array of findings, or null when the cloud tier is pacing
  // itself (caller keeps its previous findings and retries shortly).
  async check(text, dialectName = 'American', dictWords = []) {
    if (!this.available || !text.trim()) return [];
    if (this.mode === 'cloud') {
      const since = Date.now() - this._lastCloudCall;
      if (since < CLOUD_MIN_INTERVAL_MS) return null;
      this._lastCloudCall = Date.now();
    }
    const maxChars = this.mode === 'cloud' ? CLOUD_MAX_CHARS : 60000;
    const lang = { American: 'en-US', British: 'en-GB', Australian: 'en-AU', Canadian: 'en-CA' }[dialectName] || 'en-US';
    // Default level (picky adds noisy typography rules, e.g. dash conversions).
    const body = new URLSearchParams({
      text: text.slice(0, maxChars),
      language: lang,
      enabledOnly: 'false',
      disabledCategories: 'TYPOGRAPHY',
    });
    let data;
    try {
      const res = await fetch(this._apiBase() + '/v2/check', {
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
