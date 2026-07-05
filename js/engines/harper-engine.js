// Harper: runs fully in the browser via WebAssembly. Always available.
import { WorkerLinter, Dialect } from '../../vendor/harper/index.js';
import { binary } from '../../vendor/harper/binary.js';

// Harper lint kinds -> StickyWrite categories
const KIND_TO_CAT = {
  Spelling: 'correctness', Typo: 'correctness', Grammar: 'correctness',
  Agreement: 'correctness', BoundaryError: 'correctness', Capitalization: 'correctness',
  Punctuation: 'correctness', Malapropism: 'correctness', Eggcorn: 'correctness',
  Nonstandard: 'correctness', Usage: 'correctness', Regionalism: 'correctness',
  Readability: 'clarity', Redundancy: 'clarity', Repetition: 'clarity',
  Formatting: 'clarity', Miscellaneous: 'clarity',
  WordChoice: 'engagement', Enhancement: 'engagement', Style: 'engagement',
};

export class HarperEngine {
  constructor() {
    this.linter = null;
    this.ready = false;
  }

  async init(dialectName = 'American', dictWords = []) {
    this.linter = new WorkerLinter({ binary, dialect: Dialect[dialectName] ?? Dialect.American });
    await this.linter.setup();
    if (dictWords.length) await this.linter.importWords(dictWords);
    this.ready = true;
  }

  async setDialect(dialectName) {
    if (this.linter) await this.linter.setDialect(Dialect[dialectName] ?? Dialect.American);
  }

  async addWords(words) {
    if (this.linter && words.length) await this.linter.importWords(words);
  }

  // Rebuild the user dictionary (needed when a word is removed).
  async resetWords(words) {
    if (!this.linter) return;
    await this.linter.clearWords();
    if (words.length) await this.linter.importWords(words);
  }

  async check(text) {
    if (!this.ready || !text.trim()) return [];
    const lints = await this.linter.lint(text, { language: 'plaintext' });
    const out = [];
    for (const lint of lints) {
      const span = lint.span();
      const kind = lint.lint_kind();
      const replacements = lint.suggestions().map(s => ({
        text: s.get_replacement_text(),
        kind: s.kind(), // 0 Replace, 1 Remove, 2 InsertAfter
      }));
      out.push({
        engine: 'harper',
        start: span.start,
        end: span.end,
        category: KIND_TO_CAT[kind] || 'correctness',
        kindLabel: lint.lint_kind_pretty ? lint.lint_kind_pretty() : kind,
        message: lint.message(),
        problem: lint.get_problem_text(),
        replacements,
        ruleId: 'harper:' + kind,
      });
    }
    return out;
  }
}
