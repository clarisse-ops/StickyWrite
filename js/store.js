// Local persistence: documents, settings, personal dictionary, ignored lints.
// Everything lives in localStorage. Nothing ever leaves the machine.

const DOCS_KEY = 'sw:docs';
const SETTINGS_KEY = 'sw:settings';
const DICT_KEY = 'sw:dictionary';

const DEFAULT_SETTINGS = {
  dialect: 'American',
  ltUrl: 'http://localhost:8081',
  ollamaUrl: 'http://localhost:11434',
  model: '',
  ltOn: true,
  aiOn: true,
};

export const store = {
  // ----- settings -----
  getSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch { return { ...DEFAULT_SETTINGS }; }
  },
  saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  },

  // ----- dictionary -----
  getDictionary() {
    try { return JSON.parse(localStorage.getItem(DICT_KEY) || '[]'); } catch { return []; }
  },
  addDictionaryWord(word) {
    const words = store.getDictionary();
    if (!words.includes(word)) {
      words.push(word);
      localStorage.setItem(DICT_KEY, JSON.stringify(words));
    }
    return words;
  },
  removeDictionaryWord(word) {
    const words = store.getDictionary().filter(w => w !== word);
    localStorage.setItem(DICT_KEY, JSON.stringify(words));
    return words;
  },

  // ----- documents -----
  listDocs() {
    try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch { return []; }
  },
  _saveList(list) {
    localStorage.setItem(DOCS_KEY, JSON.stringify(list));
  },
  createDoc(title = 'Untitled document', text = '') {
    const doc = {
      id: 'doc_' + Math.random().toString(36).slice(2, 10),
      title,
      updated: Date.now(),
      ignored: [],
    };
    const list = store.listDocs();
    list.unshift(doc);
    store._saveList(list);
    localStorage.setItem('sw:text:' + doc.id, text);
    return doc;
  },
  getText(id) {
    return localStorage.getItem('sw:text:' + id) ?? '';
  },
  saveDoc(id, { title, text }) {
    const list = store.listDocs();
    const doc = list.find(d => d.id === id);
    if (!doc) return;
    if (title != null) doc.title = title;
    doc.updated = Date.now();
    store._saveList(list);
    if (text != null) localStorage.setItem('sw:text:' + id, text);
  },
  deleteDoc(id) {
    store._saveList(store.listDocs().filter(d => d.id !== id));
    localStorage.removeItem('sw:text:' + id);
  },
  addIgnored(id, fingerprint) {
    const list = store.listDocs();
    const doc = list.find(d => d.id === id);
    if (!doc) return;
    doc.ignored = doc.ignored || [];
    if (!doc.ignored.includes(fingerprint)) doc.ignored.push(fingerprint);
    store._saveList(list);
  },
  getIgnored(id) {
    return store.listDocs().find(d => d.id === id)?.ignored || [];
  },
};

export const DEMO_TEXT = `Welcome to StickyWrite, you're private writing assistant.

This demo document has a few mistake in it on purpose. Click any underlined word too see what StickyWrite suggests, then accept the fix or dismiss it.

Their are three engines under the hood. Harper runs instantly in you're browser. LanguageTool digs deeper when its running on this machine, and a local AI model can rewrite hole sentences for clarity and tone.

Try typing you own text hear, or paste something your working on. The the suggestions update as you write.`;
