// Local AI via Ollama: tone detection, clarity rewrites, selection rewrites.
// Optional tier: the app works without it, these features just stay hidden.

const PREFERRED = ['qwen3', 'qwen2.5', 'llama3.1', 'llama3.2', 'gemma3', 'mistral', 'phi4'];

// Word-level diff between original and corrected text (LCS over tokens).
// Returns change hunks {start, old, neu} with start as a char offset into a,
// or null when the texts are too large to diff comfortably.
function wordDiff(a, b) {
  const ta = a.split(/(\s+)/).filter(x => x !== '');
  const tb = b.split(/(\s+)/).filter(x => x !== '');
  const n = ta.length, m = tb.length;
  if (n * m > 400000) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rawHunks = [];
  let i = 0, j = 0, aPos = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { aPos += ta[i].length; i++; j++; continue; }
    const start = aPos;
    let oldS = '', neuS = '';
    while (i < n || j < m) {
      if (i < n && j < m && ta[i] === tb[j]) break;
      const takeA = j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1]);
      if (takeA) { oldS += ta[i]; aPos += ta[i].length; i++; }
      else { neuS += tb[j]; j++; }
    }
    rawHunks.push({ start, old: oldS, neu: neuS });
  }
  // Tidy each hunk: trim shared leading/trailing whitespace, and give
  // insertion-only hunks a visible anchor by pulling in the previous word.
  const hunks = [];
  for (const h of rawHunks) {
    let { start, old, neu } = h;
    const ltrim = Math.min(old.match(/^\s*/)[0].length, neu.match(/^\s*/)[0].length);
    start += ltrim; old = old.slice(ltrim); neu = neu.slice(ltrim);
    const rOld = old.match(/\s*$/)[0].length, rNeu = neu.match(/\s*$/)[0].length;
    const rtrim = Math.min(rOld, rNeu);
    if (rtrim) { old = old.slice(0, old.length - rtrim); neu = neu.slice(0, neu.length - rtrim); }
    if (!old && neu) {
      const before = a.slice(0, start);
      const prev = before.match(/(\S+)(\s*)$/);
      if (prev) {
        start -= prev[1].length + prev[2].length;
        old = prev[1] + prev[2];
        neu = prev[1] + prev[2] + neu + (neu.endsWith(' ') || a[start + old.length] === ' ' ? '' : ' ');
      }
    }
    if (old === neu) continue;
    hunks.push({ start, old, neu });
  }
  return hunks;
}

export class OllamaEngine {
  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.available = false;
    this.models = [];
    this.model = null;
  }

  async probe(preferredModel = '') {
    try {
      const res = await fetch(this.baseUrl + '/api/tags', { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      this.models = (data.models || []).map(m => m.name);
      this.available = this.models.length > 0;
      this.model = preferredModel && this.models.includes(preferredModel)
        ? preferredModel
        : this._pickModel();
    } catch {
      this.available = false;
    }
    return this.available;
  }

  _pickModel() {
    for (const pref of PREFERRED) {
      const hit = this.models.find(m => m.toLowerCase().startsWith(pref));
      if (hit) return hit;
    }
    return this.models[0] || null;
  }

  async _chat(system, user, expectJson = true) {
    const res = await fetch(this.baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        ...(expectJson ? { format: 'json' } : {}),
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error('Ollama request failed: ' + res.status);
    const data = await res.json();
    let content = data.message?.content || '';
    // Strip <think> blocks that reasoning models emit.
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return content;
  }

  async detectTone(text) {
    const content = await this._chat(
      'You analyze the tone of a piece of writing. Respond ONLY with JSON: {"tones": [{"label": "...", "emoji": "..."}]} with the 2-3 dominant tones. Labels are single words like Confident, Friendly, Formal, Neutral, Optimistic, Direct, Worried, Casual.',
      text.slice(0, 6000)
    );
    const parsed = JSON.parse(content);
    return (parsed.tones || []).slice(0, 3);
  }

  // Clarity pass over paragraphs. Returns findings mapped to document offsets.
  async clarityCheck(text, onProgress) {
    const paragraphs = [];
    let offset = 0;
    for (const part of text.split('\n')) {
      if (part.trim().split(/\s+/).length >= 8) paragraphs.push({ text: part, offset });
      offset += part.length + 1;
    }
    const findings = [];
    let done = 0;
    for (const para of paragraphs.slice(0, 20)) {
      onProgress?.(`Checking paragraph ${++done} of ${Math.min(paragraphs.length, 20)}...`);
      let parsed;
      try {
        const content = await this._chat(
          'You are an expert writing editor. Find at most 2 sentences in the paragraph that could be clearer or more concise, and rewrite them. Keep the writer\'s voice and meaning. Only suggest a rewrite when it is a genuine improvement; if the paragraph is already clear, return an empty list. Respond ONLY with JSON: {"suggestions": [{"original": "<exact sentence copied verbatim from the paragraph>", "revision": "<your rewrite>", "reason": "<short reason, max 10 words>"}]}',
          para.text
        );
        parsed = JSON.parse(content);
      } catch {
        continue;
      }
      for (const s of parsed.suggestions || []) {
        if (!s.original || !s.revision || s.original === s.revision) continue;
        const idx = para.text.indexOf(s.original);
        if (idx === -1) continue; // model didn't quote verbatim: drop it
        findings.push({
          engine: 'llm',
          start: para.offset + idx,
          end: para.offset + idx + s.original.length,
          category: 'clarity',
          kindLabel: 'AI clarity',
          message: s.reason || 'Clearer phrasing',
          problem: s.original,
          replacements: [{ text: s.revision, kind: 0 }],
          ruleId: 'llm:clarity',
        });
      }
    }
    return findings;
  }

  // Grammar pass over one paragraph. Small models are far better at
  // "rewrite this correctly" than "list the errors", so we ask for a minimal
  // corrected rewrite and diff it against the original to extract precise
  // suggestions (the GECToR insight). Returns errors with offsets relative
  // to the paragraph.
  async grammarCheck(paragraph) {
    const content = await this._chat(
      'You are a careful copy editor. Rewrite the text with every grammar error, wrong word, missing word, and wrong verb form fixed. Change as FEW words as possible and keep the writer\'s exact voice, tone, and phrasing. American English spelling is correct as-is (gray, color, center). Do not restructure sentences that are already correct. Respond ONLY with JSON: {"corrected": "<the fixed text>"}',
      paragraph
    );
    const parsed = JSON.parse(content);
    let corrected = (parsed.corrected || '').trim();
    if (!corrected) return [];
    // Normalize typographic quotes the model may introduce.
    corrected = corrected.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    if (corrected === paragraph.trim()) return [];
    const hunks = wordDiff(paragraph, corrected);
    if (!hunks) return [];
    // Sanity guard: if the model changed a large share of the words, it
    // rewrote rather than corrected. Discard the pass.
    const changedChars = hunks.reduce((n, h) => n + h.old.length, 0);
    if (changedChars > paragraph.length * 0.4) return [];
    const out = [];
    for (const h of hunks) {
      if (!h.old.trim() && !h.neu.trim()) continue;
      out.push({
        offset: h.start,
        length: h.old.length,
        original: h.old,
        corrected: h.neu,
        reason: 'AI correction',
      });
    }
    return out;
  }

  async synonyms(word, sentence) {
    const content = await this._chat(
      'You suggest synonyms that fit the sentence context. Respond ONLY with JSON: {"synonyms": ["...", "..."]} with 4-6 single words or short phrases that could replace the target word in this exact sentence, same tense and form, ordered best first. No explanations.',
      `Sentence: ${sentence}\nTarget word: ${word}`
    );
    const parsed = JSON.parse(content);
    return (parsed.synonyms || []).filter(s => typeof s === 'string' && s && s.toLowerCase() !== word.toLowerCase());
  }

  async rewrite(text, mode) {
    const instructions = {
      shorten: 'Rewrite this text to be significantly shorter while keeping every important point. Same voice, same meaning.',
      simplify: 'Rewrite this text in simpler, plainer language a 8th grader would understand. Same voice, same meaning.',
      formal: 'Rewrite this text in a more formal, professional register. Keep it human, not stiff.',
      casual: 'Rewrite this text in a more casual, conversational register. Keep it professional enough for work.',
    };
    const content = await this._chat(
      instructions[mode] + ' Respond ONLY with JSON: {"revision": "<the rewritten text>"}',
      text
    );
    const parsed = JSON.parse(content);
    return parsed.revision || null;
  }
}
