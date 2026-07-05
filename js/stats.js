// Word counts, reading time, Flesch reading ease, and the overall score.

export function textStats(text) {
  const words = (text.match(/[A-Za-z0-9'’-]+/g) || []);
  const sentences = (text.match(/[.!?]+(\s|$)/g) || []).length || (words.length ? 1 : 0);
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const wordCount = words.length;
  const flesch = wordCount && sentences
    ? Math.round(206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount))
    : null;
  return {
    words: wordCount,
    chars: text.length,
    sentences,
    readMinutes: Math.max(1, Math.round(wordCount / 230)),
    flesch: flesch == null ? null : Math.max(0, Math.min(100, flesch)),
  };
}

function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 1;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return (word.match(/[aeiouy]{1,2}/g) || ['']).length || 1;
}

const WEIGHTS = { correctness: 3, clarity: 1.5, engagement: 1, delivery: 1 };

export function overallScore(findings, wordCount) {
  if (!wordCount) return 100;
  const penalty = findings.reduce((n, f) => n + (WEIGHTS[f.category] || 1), 0);
  // Normalized per 100 words, so long docs aren't punished for length.
  const per100 = penalty / Math.max(wordCount / 100, 0.5);
  return Math.max(0, Math.round(100 - per100 * 2.5));
}

export function fleschLabel(score) {
  if (score == null) return '–';
  if (score >= 80) return `${score} (very easy)`;
  if (score >= 60) return `${score} (easy)`;
  if (score >= 40) return `${score} (medium)`;
  if (score >= 20) return `${score} (hard)`;
  return `${score} (very hard)`;
}
