// Local AI via Ollama: tone detection, clarity rewrites, selection rewrites.
// Optional tier: the app works without it, these features just stay hidden.

const PREFERRED = ['qwen3', 'qwen2.5', 'llama3.1', 'llama3.2', 'gemma3', 'mistral', 'phi4'];

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

  // Grammar pass over one paragraph: catches real-word errors (hear/here,
  // you/your) that rule engines cannot see. Returns errors with offsets
  // relative to the paragraph.
  async grammarCheck(paragraph) {
    const content = await this._chat(
      'You are a meticulous copy editor. Find genuine errors only: a wrong word that is spelled correctly (hear/here, your/you\'re, hole/whole), a missing or extra word, a wrong verb form, or a missing comma after a greeting. American English spelling is correct as-is, never change gray/color/center style spellings. Do NOT rewrite style, tone, punctuation preferences, or word choice. Do NOT flag informal but correct writing. When unsure, do not flag. Respond ONLY with JSON: {"errors": [{"original": "<shortest exact substring copied verbatim, including the error>", "corrected": "<the fixed substring>", "reason": "<max 8 words>"}]}. If there are no errors: {"errors": []}',
      paragraph
    );
    const parsed = JSON.parse(content);
    const out = [];
    for (const e of parsed.errors || []) {
      if (!e.original || !e.corrected || e.original === e.corrected) continue;
      const idx = paragraph.indexOf(e.original);
      if (idx === -1) continue; // model did not quote verbatim: drop
      out.push({
        offset: idx,
        length: e.original.length,
        original: e.original,
        corrected: e.corrected,
        reason: e.reason || 'Grammar',
      });
    }
    return out;
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
