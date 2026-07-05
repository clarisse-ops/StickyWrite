import { Editor } from './editor.js';
import { HarperEngine } from './engines/harper-engine.js';
import { LanguageToolEngine } from './engines/lt-engine.js';
import { OllamaEngine } from './engines/ollama-engine.js';
import { textStats, overallScore, fleschLabel } from './stats.js';
import { store, DEMO_TEXT } from './store.js';

const $ = (id) => document.getElementById(id);

const CAT_COLORS = {
  correctness: 'var(--correctness)',
  clarity: 'var(--clarity)',
  engagement: 'var(--engagement)',
  delivery: 'var(--delivery)',
};
const CAT_LABELS = {
  correctness: 'Correctness',
  clarity: 'Clarity',
  engagement: 'Engagement',
  delivery: 'Delivery',
};

// ---------- state ----------
let settings = store.getSettings();
let dictionary = store.getDictionary();
let currentDoc = null;
let findings = [];       // merged, rendered findings
let llmFindings = [];    // sticky AI clarity findings (revalidated each cycle)
let ltFindings = [];
let harperFindings = [];
let activeTab = 'all';
let expandedId = null;
let lintSeq = 0;
let lintTimer = null;

const editor = new Editor($('editor'));
const harper = new HarperEngine();
const lt = new LanguageToolEngine(settings.ltUrl);
const ollama = new OllamaEngine(settings.ollamaUrl);

// ---------- boot ----------
window.__sw = {}; // diagnostics: current findings + any init error land here
init().catch(err => { console.error('[sw] init failed', err); window.__sw.initError = String(err && err.stack || err); });

async function init() {
  wireUi();
  if (window.matchMedia('(max-width: 1100px)').matches) {
    $('docs-drawer').classList.add('hidden-drawer');
  }
  loadDocList();
  const docs = store.listDocs();
  if (docs.length === 0) {
    currentDoc = store.createDoc('Welcome to StickyWrite', DEMO_TEXT);
    loadDocList();
  } else {
    currentDoc = docs[0];
  }
  openDoc(currentDoc.id, { skipSave: true });

  // Harper (always-on tier)
  setPill('pill-harper', 'loading');
  try {
    await harper.init(settings.dialect, dictionary);
    setPill('pill-harper', 'on');
  } catch (err) {
    console.error('Harper failed to load', err);
    window.__sw.harperError = String(err && err.stack || err);
    setPill('pill-harper', 'off');
    toast('Harper engine failed to load. Check the console.');
  }
  scheduleLint(0);

  // Optional tiers
  probeOptionalEngines();
  setInterval(probeOptionalEngines, 30000);
}

async function probeOptionalEngines() {
  if (settings.ltOn) {
    const was = lt.available;
    await lt.probe();
    setPill('pill-lt', lt.available ? 'on' : 'off');
    if (lt.available && !was) scheduleLint(0);
  } else {
    lt.available = false;
    setPill('pill-lt', 'off');
  }
  if (settings.aiOn) {
    await ollama.probe(settings.model);
    setPill('pill-ai', ollama.available ? 'on' : 'off');
    $('pill-ai').lastChild.textContent = ollama.available && ollama.model
      ? 'AI · ' + ollama.model.split(':')[0] : 'AI';
    $('ai-bar').hidden = !ollama.available;
  } else {
    ollama.available = false;
    setPill('pill-ai', 'off');
    $('ai-bar').hidden = true;
  }
}

function setPill(id, state) {
  const el = $(id);
  el.classList.toggle('on', state === 'on');
  el.classList.toggle('loading', state === 'loading');
}

// ---------- documents ----------
function loadDocList() {
  const list = store.listDocs();
  const ul = $('doc-list');
  ul.innerHTML = '';
  for (const d of list) {
    const li = document.createElement('li');
    li.className = d.id === currentDoc?.id ? 'active' : '';
    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = d.title || 'Untitled document';
    const del = document.createElement('button');
    del.className = 'doc-del';
    del.textContent = '✕';
    del.title = 'Delete';
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${d.title}"?`)) return;
      store.deleteDoc(d.id);
      if (d.id === currentDoc?.id) {
        const rest = store.listDocs();
        currentDoc = rest[0] || store.createDoc();
        openDoc(currentDoc.id, { skipSave: true });
      }
      loadDocList();
    };
    li.append(name, del);
    li.onclick = () => { if (d.id !== currentDoc.id) { saveCurrent(); openDoc(d.id); } };
    ul.appendChild(li);
  }
}

function openDoc(id, { skipSave } = {}) {
  if (!skipSave) saveCurrent();
  currentDoc = store.listDocs().find(d => d.id === id);
  if (!currentDoc) return;
  $('doc-title').value = currentDoc.title;
  editor.setText(store.getText(id));
  llmFindings = []; ltFindings = []; harperFindings = []; findings = [];
  renderCards();
  hidePopup();
  $('tone-chips').hidden = true;
  loadDocList();
  scheduleLint(0);
  updateStats();
}

function saveCurrent() {
  if (!currentDoc) return;
  store.saveDoc(currentDoc.id, { title: $('doc-title').value, text: editor.getText() });
}

// ---------- linting ----------
function scheduleLint(delay = 450) {
  clearTimeout(lintTimer);
  lintTimer = setTimeout(runLint, delay);
}

async function runLint() {
  const seq = ++lintSeq;
  const text = editor.getText();
  updateStats();

  // Harper first (fast)
  if (harper.ready) {
    try {
      let hf = await harper.check(text);
      if (seq !== lintSeq) return;
      harperFindings = fixOffsets(hf, text);
      mergeAndRender(text);
    } catch (err) { console.error('harper check failed', err); }
  }

  // LanguageTool (slower)
  if (lt.available) {
    try {
      const lf = await lt.check(text, settings.dialect, dictionary);
      if (seq !== lintSeq) return;
      ltFindings = lf;
      mergeAndRender(text);
    } catch (err) { console.error('lt check failed', err); }
  } else {
    ltFindings = [];
    mergeAndRender(text);
  }
}

// Harper spans count Unicode scalar values; JS strings count UTF-16 units.
// They only differ when emoji or other astral characters are present.
function fixOffsets(fs, text) {
  const ok = fs.every(f => text.substring(f.start, f.end) === f.problem);
  if (ok) return fs;
  const scalars = Array.from(text);
  const map = new Array(scalars.length + 1);
  let u16 = 0;
  scalars.forEach((ch, i) => { map[i] = u16; u16 += ch.length; });
  map[scalars.length] = u16;
  return fs.map(f => ({
    ...f,
    start: map[f.start] ?? f.start,
    end: map[f.end] ?? f.end,
  }));
}

function fingerprint(f) {
  return f.ruleId + '|' + f.problem;
}

function mergeAndRender(text) {
  // Revalidate sticky AI findings against the current text.
  llmFindings = llmFindings.map(f => {
    if (text.substring(f.start, f.end) === f.problem) return f;
    const idx = text.indexOf(f.problem);
    if (idx === -1) return null;
    return { ...f, start: idx, end: idx + f.problem.length };
  }).filter(Boolean);

  const ignored = new Set(store.getIgnored(currentDoc.id));
  const dictSet = new Set(dictionary.map(w => w.toLowerCase()));
  let all = [...harperFindings, ...ltFindings]
    .filter(f => !ignored.has(fingerprint(f)))
    .filter(f => !(f.ruleId.startsWith('harper:Spelling') && dictSet.has(f.problem.toLowerCase())));

  // Dedupe overlapping findings across engines: one card per text span,
  // keeping the most severe category (then the more useful finding).
  const SEV = { correctness: 0, clarity: 1, engagement: 2, delivery: 3 };
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const f of all) {
    const i = kept.findIndex(k => Math.max(k.start, f.start) < Math.min(k.end, f.end));
    if (i === -1) { kept.push(f); continue; }
    const k = kept[i];
    const better =
      SEV[f.category] < SEV[k.category] ||
      (SEV[f.category] === SEV[k.category] && (
        (f.replacements.length > 0 && k.replacements.length === 0) ||
        (f.end - f.start > k.end - k.start && f.replacements.length > 0)
      ));
    if (better) kept[i] = f;
  }
  // AI rewrites are sentence-level, a different granularity than word-level
  // lints, so they coexist with them instead of competing in the dedupe.
  kept.push(...llmFindings.filter(f => !ignored.has(fingerprint(f))));
  kept.sort((a, b) => a.start - b.start);
  kept.forEach((f, i) => { f.id = i; });
  findings = kept;
  window.__sw.findings = findings;
  editor.paint(findings);
  renderCards();
  updateScore();
}

// ---------- stats & score ----------
function updateStats() {
  const s = textStats(editor.getText());
  $('stat-words').textContent = `${s.words} word${s.words === 1 ? '' : 's'}`;
  $('stat-chars').textContent = `${s.chars} characters`;
  $('stat-time').textContent = `${s.readMinutes} min read`;
  $('stat-readability').textContent = 'Readability: ' + fleschLabel(s.flesch);
}

function updateScore() {
  const s = textStats(editor.getText());
  const score = overallScore(findings, s.words);
  $('score-num').textContent = score;
  const ring = $('score-ring');
  const C = 106.8;
  ring.style.strokeDashoffset = C - (C * score / 100);
  ring.style.stroke = score >= 85 ? 'var(--accent)' : score >= 60 ? '#f5b93e' : 'var(--correctness)';
}

// ---------- cards ----------
function renderCards() {
  const counts = { all: findings.length, correctness: 0, clarity: 0, engagement: 0, delivery: 0 };
  findings.forEach(f => counts[f.category]++);
  for (const [cat, n] of Object.entries(counts)) $('count-' + cat).textContent = n;

  const wrap = $('cards');
  wrap.innerHTML = '';
  const visible = findings.filter(f => activeTab === 'all' || f.category === activeTab);
  $('empty-state').style.display = visible.length ? 'none' : 'block';

  for (const f of visible) {
    wrap.appendChild(buildCard(f, false));
  }
}

function buildCard(f, isPopup) {
  const card = document.createElement('div');
  card.className = 'card' + (f.id === expandedId || isPopup ? ' expanded' : '');
  card.dataset.fid = f.id;

  const head = document.createElement('div');
  head.className = 'card-head';
  const dot = document.createElement('span');
  dot.className = 'catdot';
  dot.style.background = CAT_COLORS[f.category];
  const kind = document.createElement('span');
  kind.textContent = `${CAT_LABELS[f.category]} · ${f.kindLabel}`;
  const eng = document.createElement('span');
  eng.className = 'engine-tag';
  eng.textContent = f.engine === 'llm' ? 'AI' : f.engine === 'lt' ? 'LT' : 'Harper';
  head.append(dot, kind, eng);

  const fix = document.createElement('div');
  fix.className = 'fix-line';
  const prob = document.createElement('span');
  prob.className = 'problem';
  prob.textContent = truncate(f.problem || '(missing)', 60);
  fix.appendChild(prob);
  if (f.replacements.length) {
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const rep = document.createElement('span');
    rep.className = 'replacement';
    const r0 = f.replacements[0];
    rep.textContent = r0.kind === 1 ? 'Remove' : truncate(r0.text || 'Remove', 60);
    fix.append(arrow, rep);
  }

  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.textContent = f.message;

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  f.replacements.slice(0, 3).forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'rep-btn' + (i > 0 ? ' secondary' : '');
    b.textContent = r.kind === 1 ? 'Remove' : (r.text === '' ? 'Remove' : truncate(r.text, 40));
    b.onclick = (e) => { e.stopPropagation(); acceptFinding(f, r); };
    actions.appendChild(b);
  });
  const dismiss = document.createElement('button');
  dismiss.className = 'link-btn';
  dismiss.textContent = 'Dismiss';
  dismiss.onclick = (e) => { e.stopPropagation(); dismissFinding(f); };
  actions.appendChild(dismiss);
  if (f.ruleId.startsWith('harper:Spelling') || f.ruleId.startsWith('lt:MORFOLOGIK')) {
    const add = document.createElement('button');
    add.className = 'link-btn';
    add.textContent = 'Add to dictionary';
    add.onclick = (e) => { e.stopPropagation(); addToDictionary(f); };
    actions.appendChild(add);
  }

  card.append(head, fix, msg, actions);
  card.onclick = () => {
    if (isPopup) return;
    expandedId = f.id === expandedId ? null : f.id;
    renderCards();
    if (expandedId != null) editor.focusFinding(f);
    else editor.unfocus();
  };
  return card;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- actions ----------
function acceptFinding(f, r) {
  hidePopup();
  editor.unfocus();
  let ok;
  if (r.kind === 2) ok = editor.insertAt(f.end, r.text);        // InsertAfter
  else ok = editor.replaceRange(f.start, f.end, r.kind === 1 ? '' : r.text);
  if (!ok) { toast('Could not apply this suggestion.'); return; }
  llmFindings = llmFindings.filter(x => x !== f);
  saveCurrent();
  scheduleLint(80);
}

function dismissFinding(f) {
  hidePopup();
  editor.unfocus();
  store.addIgnored(currentDoc.id, fingerprint(f));
  llmFindings = llmFindings.filter(x => x !== f);
  mergeAndRender(editor.getText());
}

async function addToDictionary(f) {
  const word = f.problem.trim();
  dictionary = store.addDictionaryWord(word);
  await harper.addWords([word]);
  hidePopup();
  toast(`"${word}" added to your dictionary`);
  scheduleLint(0);
}

// ---------- popup ----------
function showPopup(f) {
  const pop = $('popup-card');
  pop.innerHTML = '';
  pop.appendChild(buildCard(f, true));
  pop.hidden = false;
  const rect = editor.findingRect(f);
  if (!rect) { pop.hidden = true; return; }
  const pw = 320, ph = pop.offsetHeight || 160;
  let x = Math.min(Math.max(12, rect.left), window.innerWidth - pw - 12);
  let y = rect.bottom + 8;
  if (y + ph > window.innerHeight - 12) y = rect.top - ph - 8;
  pop.style.left = x + 'px';
  pop.style.top = Math.max(64, y) + 'px';
  editor.focusFinding(f);
}

function hidePopup() {
  $('popup-card').hidden = true;
}

// ---------- AI features ----------
async function runAiClarity() {
  if (!ollama.available) return;
  const btn = $('btn-ai-clarity');
  btn.disabled = true;
  aiProgress('Reading your document...');
  try {
    const text = editor.getText();
    const found = await ollama.clarityCheck(text, aiProgress);
    llmFindings = found;
    mergeAndRender(editor.getText());
    toast(found.length
      ? `AI found ${found.length} clarity improvement${found.length === 1 ? '' : 's'}`
      : 'AI read the whole document and had no clarity suggestions. Nice.');
  } catch (err) {
    console.error(err);
    toast('AI clarity check failed. Is Ollama still running?');
  } finally {
    btn.disabled = false;
    aiProgress(null);
  }
}

async function runToneDetect() {
  if (!ollama.available) return;
  const btn = $('btn-ai-tone');
  btn.disabled = true;
  aiProgress('Detecting tone...');
  try {
    const tones = await ollama.detectTone(editor.getText());
    const wrap = $('tone-chips');
    wrap.innerHTML = '';
    for (const t of tones) {
      const chip = document.createElement('span');
      chip.className = 'tone-chip';
      chip.textContent = `${t.emoji || '🎭'} ${t.label}`;
      wrap.appendChild(chip);
    }
    wrap.hidden = tones.length === 0;
  } catch (err) {
    console.error(err);
    toast('Tone detection failed. Is Ollama still running?');
  } finally {
    btn.disabled = false;
    aiProgress(null);
  }
}

function aiProgress(text) {
  $('ai-progress').hidden = !text;
  if (text) $('ai-progress-text').textContent = text;
}

// ---------- selection rewrite toolbar ----------
let selRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const tb = $('sel-toolbar');
  if (!ollama.available || sel.isCollapsed || !sel.rangeCount ||
      !$('editor').contains(sel.anchorNode) || sel.toString().trim().length < 20) {
    tb.hidden = true;
    return;
  }
  selRange = sel.getRangeAt(0).cloneRange();
  const rect = selRange.getBoundingClientRect();
  tb.hidden = false;
  tb.style.left = Math.min(Math.max(12, rect.left + rect.width / 2 - tb.offsetWidth / 2), window.innerWidth - tb.offsetWidth - 12) + 'px';
  tb.style.top = Math.max(64, rect.top - tb.offsetHeight - 10) + 'px';
});

async function rewriteSelection(mode) {
  const tb = $('sel-toolbar');
  tb.hidden = true;
  if (!selRange) return;
  const selectedText = selRange.toString();
  const startOff = editor.offsetAt(selRange.startContainer, selRange.startOffset);
  const endOff = editor.offsetAt(selRange.endContainer, selRange.endOffset);
  if (startOff == null || endOff == null) return;
  aiProgress('Rewriting...');
  try {
    const revision = await ollama.rewrite(selectedText, mode);
    if (!revision) throw new Error('empty');
    showRewriteCard(selectedText, revision, startOff, endOff, mode);
  } catch (err) {
    console.error(err);
    toast('Rewrite failed. Is Ollama still running?');
  } finally {
    aiProgress(null);
  }
}

function showRewriteCard(original, revision, start, end, mode) {
  const wrap = $('cards');
  const card = document.createElement('div');
  card.className = 'card expanded';
  card.innerHTML = `
    <div class="card-head"><span class="catdot" style="background:var(--delivery)"></span>
      <span>AI rewrite · ${mode}</span><span class="engine-tag">AI</span></div>
    <div class="msg" style="display:block">${escapeHtml(revision)}</div>`;
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const apply = document.createElement('button');
  apply.className = 'rep-btn';
  apply.textContent = 'Apply';
  apply.onclick = () => {
    const cur = editor.getText();
    if (cur.substring(start, end) === original) {
      editor.replaceRange(start, end, revision);
    } else {
      const idx = cur.indexOf(original);
      if (idx === -1) { toast('The original text changed, apply it manually.'); return; }
      editor.replaceRange(idx, idx + original.length, revision);
    }
    card.remove();
    saveCurrent();
    scheduleLint(80);
  };
  const copy = document.createElement('button');
  copy.className = 'rep-btn secondary';
  copy.textContent = 'Copy';
  copy.onclick = () => { navigator.clipboard.writeText(revision); toast('Copied'); };
  const discard = document.createElement('button');
  discard.className = 'link-btn';
  discard.textContent = 'Discard';
  discard.onclick = () => card.remove();
  actions.append(apply, copy, discard);
  card.appendChild(actions);
  wrap.prepend(card);
  $('empty-state').style.display = 'none';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- settings ----------
function openSettings() {
  $('set-dialect').value = settings.dialect;
  $('set-lt-url').value = settings.ltUrl;
  $('set-ollama-url').value = settings.ollamaUrl;
  $('set-lt-on').checked = settings.ltOn;
  $('set-ai-on').checked = settings.aiOn;
  const sel = $('set-model');
  sel.innerHTML = '<option value="">(auto-detect)</option>';
  for (const m of ollama.models) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    sel.appendChild(o);
  }
  sel.value = settings.model && ollama.models.includes(settings.model) ? settings.model : '';
  renderDictWords();
  $('settings-modal').hidden = false;
}

function renderDictWords() {
  const wrap = $('dict-words');
  wrap.innerHTML = '';
  if (!dictionary.length) {
    wrap.innerHTML = '<span class="muted small">No words yet. Use "Add to dictionary" on a spelling card.</span>';
    return;
  }
  for (const w of dictionary) {
    const chip = document.createElement('span');
    chip.className = 'dict-word';
    chip.textContent = w;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.onclick = () => { dictionary = store.removeDictionaryWord(w); renderDictWords(); toast('Removed. Takes effect after reload.'); };
    chip.appendChild(x);
    wrap.appendChild(chip);
  }
}

async function saveSettings() {
  const oldDialect = settings.dialect;
  settings = {
    dialect: $('set-dialect').value,
    ltUrl: $('set-lt-url').value.trim() || 'http://localhost:8081',
    ollamaUrl: $('set-ollama-url').value.trim() || 'http://localhost:11434',
    model: $('set-model').value,
    ltOn: $('set-lt-on').checked,
    aiOn: $('set-ai-on').checked,
  };
  store.saveSettings(settings);
  lt.baseUrl = settings.ltUrl.replace(/\/$/, '');
  ollama.baseUrl = settings.ollamaUrl.replace(/\/$/, '');
  $('settings-modal').hidden = true;
  if (settings.dialect !== oldDialect) await harper.setDialect(settings.dialect);
  await probeOptionalEngines();
  scheduleLint(0);
  toast('Settings saved');
}

// ---------- misc UI ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function wireUi() {
  editor.onChange = () => { saveCurrentDebounced(); scheduleLint(); hidePopup(); };
  editor.onCaretOnLint = (f) => { if (f) showPopup(f); else { hidePopup(); editor.unfocus(); } };

  $('btn-docs').onclick = () => $('docs-drawer').classList.toggle('hidden-drawer');
  $('btn-new-doc').onclick = () => {
    saveCurrent();
    currentDoc = store.createDoc();
    openDoc(currentDoc.id, { skipSave: true });
    $('editor').focus();
  };
  $('doc-title').addEventListener('input', () => { saveCurrentDebounced(); });
  $('doc-title').addEventListener('change', () => { saveCurrent(); loadDocList(); });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.onclick = () => {
      activeTab = tab.dataset.cat;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      renderCards();
    };
  }

  $('btn-copy').onclick = async () => {
    await navigator.clipboard.writeText(editor.getText());
    toast('Document copied to clipboard');
  };
  $('btn-download').onclick = () => {
    const blob = new Blob([editor.getText()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ($('doc-title').value || 'stickywrite') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $('btn-settings').onclick = openSettings;
  $('btn-close-settings').onclick = () => { $('settings-modal').hidden = true; };
  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) $('settings-modal').hidden = true;
  });
  $('btn-save-settings').onclick = saveSettings;
  for (const pill of document.querySelectorAll('.pill')) pill.onclick = openSettings;

  $('btn-ai-clarity').onclick = runAiClarity;
  $('btn-ai-tone').onclick = runToneDetect;
  for (const b of $('sel-toolbar').querySelectorAll('button')) {
    b.onclick = () => rewriteSelection(b.dataset.mode);
  }

  document.addEventListener('mousedown', (e) => {
    if (!$('popup-card').hidden && !$('popup-card').contains(e.target) && !$('editor').contains(e.target)) {
      hidePopup();
      editor.unfocus();
    }
  });
  window.addEventListener('beforeunload', saveCurrent);
}

let saveTimer = null;
function saveCurrentDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveCurrent(); loadDocList(); }, 800);
}
