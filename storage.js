import { getDb } from './firebase.js';
import { getCurrentLanguage, normalizeLanguageCode } from './language-manager.js';
import { getFirestoreHelpers, getSettingsCollection, getVocabularyCollection } from './data-access.js';
import { buildMeaningMap, normalizeMeaningMap } from './language-config.js';

export const DEFAULT_TOPIC = 'General';
export const DEFAULT_SUBTOPIC = 'Default';
export const DEFAULT_TYPE = 'Word';

const SOUND_ENABLED_KEY = 'soundEnabled';
const TOPICS_KEY = 'topics';
const SUBTOPICS_KEY = 'subTopics';
const VOCABULARY_OFFLINE_CACHE_KEY_PREFIX = 'vocabularyTrainer.vocabulary';
const PREFERENCES_OFFLINE_CACHE_KEY_PREFIX = 'vocabularyTrainer.preferences';
const LEGACY_VOCABULARY_CACHE_KEY = 'vocabularyTrainer.vocabulary';
const LEGACY_PREFERENCES_CACHE_KEY = 'vocabularyTrainer.preferences';

let vocabularyCache = [];
let topicsCache = [];
let subTopicsCache = [];
let soundPreferenceCache = true;
let firestoreInitialized = false;
let firestoreSyncPromise = null;
let preferencesSyncPromise = null;
let vocabularyListenerActive = false;
let preferencesListenerActive = false;
let vocabularyListenerUnsubscribe = null;
let preferencesListenerUnsubscribe = null;
let vocabularyListenerPromise = null;
let preferencesListenerPromise = null;
let activeLanguage = normalizeLanguageCode(getCurrentLanguage());
let listenerGeneration = 0;
let vocabularyListenerLanguage = null;
let preferencesListenerLanguage = null;

function notifyVocabularyChange() {
  if (typeof window !== 'undefined') {
    try {
      console.log('DATA FLOW - notifyVocabularyChange vocabularyCache.length:', vocabularyCache.length);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('vocabulary-storage-updated', { detail: [...vocabularyCache] }));
  }
}

function notifyFirestoreSnapshot(collection, snapshot) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('firestore-snapshot-status', {
      detail: {
        collection,
        fromCache: Boolean(snapshot.metadata?.fromCache),
      },
    }));
  }
}

function readOfflineJson(key) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    console.warn('Failed to read offline cache', error);
    return null;
  }
}

function writeOfflineJson(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to persist offline cache', error);
  }
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function waitForFirestoreWrite(writePromise, description) {
  if (isOffline()) {
    void Promise.resolve(writePromise).catch((error) => {
      console.error(`Failed to sync ${description} after an offline write`, error);
    });
    return;
  }

  await writePromise;
}

function clearCacheForLanguage(language) {
  const normalizedLanguage = normalizeLanguageCode(language);
  const keys = [
    `${VOCABULARY_OFFLINE_CACHE_KEY_PREFIX}.${normalizedLanguage}`,
    `${PREFERENCES_OFFLINE_CACHE_KEY_PREFIX}.${normalizedLanguage}`,
    normalizedLanguage === 'english' ? LEGACY_VOCABULARY_CACHE_KEY : `${LEGACY_VOCABULARY_CACHE_KEY}.${normalizedLanguage}`,
    normalizedLanguage === 'english' ? LEGACY_PREFERENCES_CACHE_KEY : `${LEGACY_PREFERENCES_CACHE_KEY}.${normalizedLanguage}`,
  ];

  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  keys.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear offline cache', error);
    }
  });
}

function getLanguageKey(language = activeLanguage) {
  return normalizeLanguageCode(language);
}

function getVocabularyCacheKey(language = activeLanguage) {
  return `${VOCABULARY_OFFLINE_CACHE_KEY_PREFIX}.${getLanguageKey(language)}`;
}

function getPreferencesCacheKey(language = activeLanguage) {
  return `${PREFERENCES_OFFLINE_CACHE_KEY_PREFIX}.${getLanguageKey(language)}`;
}

function readOfflineVocabularyState(language = activeLanguage) {
  const keys = [
    getVocabularyCacheKey(language),
    language === 'english' ? LEGACY_VOCABULARY_CACHE_KEY : `${LEGACY_VOCABULARY_CACHE_KEY}.${language}`,
  ];

  console.log('DATA FLOW - readOfflineVocabularyState keys:', keys);

  for (const key of keys) {
    const cached = readOfflineJson(key);
    if (Array.isArray(cached)) {
      return cached;
    }
  }

  return [];
}

function readOfflinePreferencesState(language = activeLanguage) {
  const keys = [
    getPreferencesCacheKey(language),
    language === 'english' ? LEGACY_PREFERENCES_CACHE_KEY : `${LEGACY_PREFERENCES_CACHE_KEY}.${language}`,
  ];

  for (const key of keys) {
    const cached = readOfflineJson(key);
    if (cached && typeof cached === 'object') {
      return {
        topics: Array.isArray(cached.topics) ? cached.topics : [],
        subTopics: Array.isArray(cached.subTopics) ? cached.subTopics : [],
        soundEnabled: typeof cached.soundEnabled === 'boolean' ? cached.soundEnabled : true,
      };
    }
  }

  return { topics: [], subTopics: [], soundEnabled: true };
}

function persistVocabularyOfflineCache(words = vocabularyCache, language = activeLanguage) {
  const normalizedWords = normalizeVocabularyList(words, language);
  writeOfflineJson(getVocabularyCacheKey(language), normalizedWords);
  if (language === 'english') {
    writeOfflineJson(LEGACY_VOCABULARY_CACHE_KEY, normalizedWords);
  }
}

function persistPreferencesOfflineCache(language = activeLanguage) {
  const payload = {
    topics: [...topicsCache],
    subTopics: [...subTopicsCache],
    soundEnabled: soundPreferenceCache,
  };

  writeOfflineJson(getPreferencesCacheKey(language), payload);
  if (language === 'english') {
    writeOfflineJson(LEGACY_PREFERENCES_CACHE_KEY, payload);
  }
}

function deriveTopics(words) {
  return [...new Set(words.map((entry) => entry.topic || DEFAULT_TOPIC))].filter(Boolean).sort();
}

function deriveSubTopics(words) {
  return [...new Set(words.map((entry) => entry.subTopic || DEFAULT_SUBTOPIC))].filter(Boolean).sort();
}

function normalizeSupportObjectList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          const word = String(item || '').trim();
          return word ? { word, meaning: '' } : null;
        }
        if (typeof item === 'object' && item !== null) {
          const word = String(item.word || item.text || item.label || '').trim();
          const meaning = String(item.meaning || item.translation || item.definition || '').trim();
          const type = String(item.type || item.partOfSpeech || item.pos || '').trim();
          const example = String(item.example || item.shortExample || item.sample || '').trim();
          const ipa = String(item.ipa || '').trim();
          const cefr = String(item.cefr || '').trim();
          const normalizedItem = word ? (type ? { word, meaning, type } : { word, meaning }) : null;
          if (!normalizedItem) {
            return null;
          }
          if (example) {
            normalizedItem.example = example;
          }
          if (ipa) {
            normalizedItem.ipa = ipa;
          }
          if (cefr) {
            normalizedItem.cefr = cefr;
          }
          return normalizedItem;
        }
        return null;
      })
      .filter((item) => item && item.word);
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|,|;/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((word) => ({ word, meaning: '', type: '' }));
  }

  return [];
}

function normalizeMeaningsAnalysis(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const meaning = String(item.meaning || '').trim();
      const pos = String(item.pos || '').trim();
      if (!meaning || !pos) return null;
      return {
        meaning,
        pos,
        englishDefinition: String(item.englishDefinition || '').trim(),
        ipa: String(item.ipa || '').trim(),
        cefr: String(item.cefr || '').trim(),
        example: String(item.example || '').trim(),
        synonyms: normalizeSupportObjectList(item.synonyms),
        antonyms: normalizeSupportObjectList(item.antonyms),
        wordFamily: normalizeSupportObjectList(item.wordFamily),
        collocations: normalizeSupportObjectList(item.collocations),
        sentencePatterns: normalizeSupportObjectList(item.sentencePatterns),
      };
    })
    .filter(Boolean);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeVocabularyEntry(entry = {}, language = activeLanguage) {
  const normalizedTypeValue = entry?.type ? String(entry.type).trim() : DEFAULT_TYPE;
  const normalizedType = normalizedTypeValue
    ? normalizedTypeValue.toLowerCase() === 'collocation' || normalizedTypeValue.toLowerCase() === 'sentence'
      ? 'Phrase'
      : String(normalizedTypeValue).trim()
    : DEFAULT_TYPE;

  const normalizedTopic = entry?.topic ? String(entry.topic).trim() : DEFAULT_TOPIC;
  const normalizedSubTopic = entry?.subTopic ? String(entry.subTopic).trim() : DEFAULT_SUBTOPIC;

  const meanings = normalizeMeaningMap(entry?.meanings || entry?.meaning);
  const legacyMeaningValue = meanings.vietnamese || meanings.vi || meanings.english || entry?.meaning || '';
  const synonyms = normalizeSupportObjectList(entry?.synonyms);
  const antonyms = normalizeSupportObjectList(entry?.antonyms);
  const wordFamily = normalizeSupportObjectList(entry?.wordFamily);
  const collocations = normalizeSupportObjectList(entry?.collocations);
  const fixedPhrases = normalizeSupportObjectList(entry?.fixedPhrases);
  const sentencePatterns = normalizeSupportObjectList(entry?.sentencePatterns);
  const commonExpressions = normalizeSupportObjectList(entry?.commonExpressions);
  const commonMistakes = normalizeSupportObjectList(entry?.commonMistakes);
  const meaningsAnalysis = normalizeMeaningsAnalysis(entry?.meaningsAnalysis);
  const legacyExamples = entry?.examples && typeof entry.examples === 'object' && !Array.isArray(entry.examples) ? entry.examples : {};
  const exampleValue = String(
    entry?.example ||
    legacyExamples.example ||
    legacyExamples.basic ||
    legacyExamples.basicExample ||
    legacyExamples.conversation ||
    legacyExamples.conversationExample ||
    legacyExamples.lessonContext ||
    legacyExamples.lessonExample ||
    entry?.basicExample ||
    entry?.conversationExample ||
    entry?.lessonExample ||
    '',
  ).trim();
  const examples = {
    ...legacyExamples,
    basic: exampleValue,
  };
  return {
    ...entry,
    docId: entry?.docId ? String(entry.docId).trim() : '',
    word: entry?.word ? String(entry.word).trim() : '',
    meanings,
    meaning: legacyMeaningValue,
    example: exampleValue,
    ipa: entry?.ipa ? String(entry.ipa).trim() : '',
    synonyms,
    antonyms,
    wordFamily,
    fixedPhrases,
    sentencePatterns,
    commonExpressions,
    commonMistakes,
    meaningsAnalysis,
    examples,
    topic: normalizedTopic,
    subTopic: normalizedSubTopic,
    type: normalizedType || DEFAULT_TYPE,
    partOfSpeech: String(entry?.partOfSpeech || entry?.pos || '').trim(),
    writeCount: Number(entry?.writeCount) || 0,
    correct: Number(entry?.correct) || 0,
    wrong: Number(entry?.wrong) || 0,
    learned: typeof entry?.learned === 'boolean' ? entry.learned : false,
    language: normalizeLanguageCode(entry?.language || language),
  };
}

function normalizeVocabularyList(words, language = activeLanguage) {
  return (words || []).map((entry) => normalizeVocabularyEntry(entry, language)).filter((entry) => entry.word);
}

function updateDerivedCaches(words, language = activeLanguage) {
  vocabularyCache = normalizeVocabularyList(words, language);
  topicsCache = deriveTopics(vocabularyCache);
  subTopicsCache = deriveSubTopics(vocabularyCache);
  if (!topicsCache.length) {
    topicsCache = [DEFAULT_TOPIC];
  }
  if (!subTopicsCache.length) {
    subTopicsCache = [DEFAULT_SUBTOPIC];
  }
  activeLanguage = normalizeLanguageCode(language);
  try {
    console.log('DATA FLOW - updateDerivedCaches language:', activeLanguage, 'vocabularyCache.length:', vocabularyCache.length);
  } catch (e) {}
}

export function toFirestorePayload(entry) {
  const exampleValue = String(entry.example || entry.examples?.basic || entry.basicExample || '').trim();
  const examples = entry.examples && typeof entry.examples === 'object' && !Array.isArray(entry.examples) ? entry.examples : {};
  const additionalExamples = Object.fromEntries(
    Object.entries(examples).filter(([key, value]) => key !== 'basic' && typeof value === 'string' && value.trim()),
  );
  const payload = {
    word: entry.word,
    meanings: normalizeMeaningMap(entry.meanings || entry.meaning),
    meaning: entry.meaning || entry.meanings?.vietnamese || entry.meanings?.vi || entry.meanings?.english || '',
    example: exampleValue,
    ipa: entry.ipa,
    synonyms: normalizeSupportObjectList(entry.synonyms),
    antonyms: normalizeSupportObjectList(entry.antonyms),
    wordFamily: normalizeSupportObjectList(entry.wordFamily),
    fixedPhrases: normalizeSupportObjectList(entry.fixedPhrases),
    sentencePatterns: normalizeSupportObjectList(entry.sentencePatterns),
    commonExpressions: normalizeSupportObjectList(entry.commonExpressions),
    commonMistakes: normalizeSupportObjectList(entry.commonMistakes),
    meaningsAnalysis: normalizeMeaningsAnalysis(entry.meaningsAnalysis),
    examples: { ...additionalExamples, basic: String(examples.basic || entry.example || '').trim() || exampleValue },
    collocations: normalizeSupportObjectList(entry.collocations),
    topic: entry.topic,
    subTopic: entry.subTopic,
    type: entry.type,
    partOfSpeech: String(entry.partOfSpeech || entry.pos || '').trim(),
    writeCount: entry.writeCount,
    correct: entry.correct,
    wrong: entry.wrong,
    learned: entry.learned,
    language: normalizeLanguageCode(entry.language || activeLanguage),
  };

  console.log('DATA FLOW - Firestore Payload:', payload);
  return payload;
}

function resolveEntryDocumentId(entry, fallbackEntries = vocabularyCache) {
  if (entry?.docId) {
    return entry.docId;
  }

  if (entry?.word) {
    const matchingEntry = fallbackEntries.find((candidate) => normalizeWordKey(candidate.word) === normalizeWordKey(entry.word));
    if (matchingEntry?.docId) {
      return matchingEntry.docId;
    }
  }

  return normalizeWordKey(entry?.word) || '';
}

function buildEntryWithDocId(entry, fallbackEntries = vocabularyCache, language = activeLanguage) {
  const normalized = normalizeVocabularyEntry(entry, language);
  const resolvedDocId = resolveEntryDocumentId(normalized, fallbackEntries);
  return resolvedDocId ? { ...normalized, docId: resolvedDocId } : normalized;
}

function detachListeners() {
  listenerGeneration += 1;
  vocabularyListenerActive = false;
  preferencesListenerActive = false;
  vocabularyListenerPromise = null;
  preferencesListenerPromise = null;

  if (vocabularyListenerUnsubscribe) {
    vocabularyListenerUnsubscribe();
    vocabularyListenerUnsubscribe = null;
  }

  if (preferencesListenerUnsubscribe) {
    preferencesListenerUnsubscribe();
    preferencesListenerUnsubscribe = null;
  }
}

function hydrateOfflineCaches(language) {
  const offlineWords = readOfflineVocabularyState(language);
  const offlinePreferences = readOfflinePreferencesState(language);
  updateDerivedCaches(offlineWords, language);
  topicsCache = offlinePreferences.topics.length ? offlinePreferences.topics : (vocabularyCache.length ? deriveTopics(vocabularyCache) : [DEFAULT_TOPIC]);
  subTopicsCache = offlinePreferences.subTopics.length ? offlinePreferences.subTopics : (vocabularyCache.length ? deriveSubTopics(vocabularyCache) : [DEFAULT_SUBTOPIC]);
  soundPreferenceCache = typeof offlinePreferences.soundEnabled === 'boolean' ? offlinePreferences.soundEnabled : true;
  persistVocabularyOfflineCache(vocabularyCache, language);
  persistPreferencesOfflineCache(language);
}

export function initializeOfflineCache(language = getCurrentLanguage()) {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (activeLanguage !== normalizedLanguage) {
    applyLanguageState(normalizedLanguage);
  } else {
    hydrateOfflineCaches(normalizedLanguage);
  }

  return {
    vocabulary: [...vocabularyCache],
    topics: [...topicsCache],
    subTopics: [...subTopicsCache],
    soundEnabled: soundPreferenceCache,
  };
}

function applyLanguageState(language) {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (activeLanguage === normalizedLanguage) {
    return normalizedLanguage;
  }

  detachListeners();
  activeLanguage = normalizedLanguage;
  firestoreInitialized = false;
  firestoreSyncPromise = null;
  preferencesSyncPromise = null;
  hydrateOfflineCaches(normalizedLanguage);
  notifyVocabularyChange();
  return normalizedLanguage;
}

async function writeWordDocument(entry) {
  console.log('DATA FLOW - Before writeWordDocument entry:', entry);
  const normalized = buildEntryWithDocId(entry, vocabularyCache, activeLanguage);
  console.log('DATA FLOW - writeWordDocument normalized entry:', normalized);
  const db = await getDb();
  if (!db) {
    const existingEntries = vocabularyCache.filter((candidate) => normalizeWordKey(candidate.word) !== normalizeWordKey(normalized.word));
    const nextEntries = [...existingEntries, normalized];
    updateDerivedCaches(nextEntries, activeLanguage);
    persistVocabularyOfflineCache(nextEntries, activeLanguage);
    notifyVocabularyChange();
    return normalized;
  }

  const { doc, setDoc } = await getFirestoreHelpers(activeLanguage);
  const collectionName = getVocabularyCollection(activeLanguage);
  const docId = resolveEntryDocumentId(normalized);
  const writePromise = setDoc(doc(db, collectionName, docId || normalizeWordKey(normalized.word)), toFirestorePayload(normalized), { merge: true });
  if (isOffline()) {
    const existingEntries = vocabularyCache.filter((candidate) => normalizeWordKey(candidate.word) !== normalizeWordKey(normalized.word));
    updateDerivedCaches([...existingEntries, normalized], activeLanguage);
    persistVocabularyOfflineCache(vocabularyCache, activeLanguage);
    notifyVocabularyChange();
  }
  await waitForFirestoreWrite(writePromise, `vocabulary entry "${normalized.word}"`);
  return normalized;
}

async function deleteWordDocument(entryOrWord) {
  const db = await getDb();
  if (!db) {
    const normalizedWord = typeof entryOrWord === 'string' ? entryOrWord : entryOrWord?.word;
    const existingEntries = vocabularyCache.filter((currentEntry) => normalizeWordKey(currentEntry.word) !== normalizeWordKey(normalizedWord));
    updateDerivedCaches(existingEntries, activeLanguage);
    persistVocabularyOfflineCache(existingEntries, activeLanguage);
    notifyVocabularyChange();
    return;
  }

  const { deleteDoc, doc } = await getFirestoreHelpers(activeLanguage);
  const matchingEntry = typeof entryOrWord === 'string'
    ? vocabularyCache.find((currentEntry) => normalizeWordKey(currentEntry.word) === normalizeWordKey(entryOrWord))
    : entryOrWord;
  const docId = resolveEntryDocumentId(matchingEntry || entryOrWord);
  if (!docId) {
    return;
  }

  const deletePromise = deleteDoc(doc(db, getVocabularyCollection(activeLanguage), docId));
  if (isOffline()) {
    const normalizedWord = typeof entryOrWord === 'string' ? entryOrWord : entryOrWord?.word;
    const existingEntries = vocabularyCache.filter((entry) => normalizeWordKey(entry.word) !== normalizeWordKey(normalizedWord));
    updateDerivedCaches(existingEntries, activeLanguage);
    persistVocabularyOfflineCache(existingEntries, activeLanguage);
    notifyVocabularyChange();
  }
  await waitForFirestoreWrite(deletePromise, `vocabulary deletion "${docId}"`);
}

async function attachVocabularyListener(language = activeLanguage) {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (vocabularyListenerActive && vocabularyListenerLanguage === normalizedLanguage) {
    return vocabularyListenerPromise || Promise.resolve(vocabularyCache);
  }

  detachListeners();
  vocabularyListenerLanguage = normalizedLanguage;
  const db = await getDb();
  if (!db) {
    updateDerivedCaches(readOfflineVocabularyState(normalizedLanguage), normalizedLanguage);
    topicsCache = topicsCache.length ? topicsCache : [DEFAULT_TOPIC];
    subTopicsCache = subTopicsCache.length ? subTopicsCache : [DEFAULT_SUBTOPIC];
    persistVocabularyOfflineCache(vocabularyCache, normalizedLanguage);
    notifyVocabularyChange();
    return Promise.resolve(vocabularyCache);
  }

  const { collection, onSnapshot } = await getFirestoreHelpers(normalizedLanguage);
  vocabularyListenerActive = true;
  const currentGeneration = listenerGeneration;
  vocabularyListenerPromise = new Promise((resolve) => {
    vocabularyListenerUnsubscribe = onSnapshot(
      collection(db, getVocabularyCollection(normalizedLanguage)),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (currentGeneration !== listenerGeneration || activeLanguage !== normalizedLanguage) {
          return;
        }

        notifyFirestoreSnapshot('vocabulary', snapshot);

        if (
          snapshot.metadata.fromCache &&
          !snapshot.metadata.hasPendingWrites &&
          snapshot.empty &&
          vocabularyCache.length
        ) {
          console.warn('Preserving cached vocabulary until Firestore provides a server snapshot');
          resolve(vocabularyCache);
          return;
        }

        try {
          console.log('DATA FLOW - Firestore snapshot size:', snapshot.size, 'language:', normalizedLanguage);
          console.log('DATA FLOW - Firestore snapshot ids:', snapshot.docs.map((d) => d.id));
        } catch (e) {
          console.warn('DATA FLOW - Failed to log snapshot info', e);
        }

        const loadedEntries = snapshot.docs.map((docSnapshot) => normalizeVocabularyEntry({ ...docSnapshot.data(), docId: docSnapshot.id, language: normalizedLanguage }, normalizedLanguage));
        updateDerivedCaches(loadedEntries, normalizedLanguage);
        persistVocabularyOfflineCache(loadedEntries, normalizedLanguage);
        firestoreInitialized = true;
        notifyVocabularyChange();
        resolve(vocabularyCache);
      },
      (error) => {
        if (currentGeneration !== listenerGeneration) {
          return;
        }
        console.error('Failed to sync vocabulary from Firestore', error);
        resolve(vocabularyCache);
      },
    );
  });

  return vocabularyListenerPromise;
}

async function syncVocabularyFromFirestore(language = activeLanguage) {
  await attachVocabularyListener(language);
  return vocabularyCache;
}

async function attachPreferencesListener(language = activeLanguage) {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (preferencesListenerActive && preferencesListenerLanguage === normalizedLanguage) {
    return preferencesListenerPromise || Promise.resolve({ topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache });
  }

  const db = await getDb();
  if (!db) {
    const offlinePreferences = readOfflinePreferencesState(normalizedLanguage);
    topicsCache = offlinePreferences.topics.length ? offlinePreferences.topics : (vocabularyCache.length ? deriveTopics(vocabularyCache) : [DEFAULT_TOPIC]);
    subTopicsCache = offlinePreferences.subTopics.length ? offlinePreferences.subTopics : (vocabularyCache.length ? deriveSubTopics(vocabularyCache) : [DEFAULT_SUBTOPIC]);
    soundPreferenceCache = typeof offlinePreferences.soundEnabled === 'boolean' ? offlinePreferences.soundEnabled : true;
    persistPreferencesOfflineCache(normalizedLanguage);
    notifyVocabularyChange();
    return Promise.resolve({ topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache });
  }

  const { collection, onSnapshot } = await getFirestoreHelpers(normalizedLanguage);
  preferencesListenerActive = true;
  preferencesListenerLanguage = normalizedLanguage;
  const currentGeneration = listenerGeneration;
  preferencesListenerPromise = new Promise((resolve) => {
    preferencesListenerUnsubscribe = onSnapshot(
      collection(db, getSettingsCollection(normalizedLanguage)),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (currentGeneration !== listenerGeneration || activeLanguage !== normalizedLanguage) {
          return;
        }

        notifyFirestoreSnapshot('preferences', snapshot);
        if (
          snapshot.metadata.fromCache &&
          !snapshot.metadata.hasPendingWrites &&
          snapshot.empty &&
          (topicsCache.length || subTopicsCache.length)
        ) {
          console.warn('Preserving cached preferences until Firestore provides a server snapshot');
          resolve({ topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache });
          return;
        }

        const preferenceValues = Object.fromEntries(snapshot.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot.data()]));
        const storedTopics = Array.isArray(preferenceValues[TOPICS_KEY]?.value) ? preferenceValues[TOPICS_KEY].value : [];
        topicsCache = storedTopics.length ? storedTopics : (vocabularyCache.length ? deriveTopics(vocabularyCache) : [DEFAULT_TOPIC]);

        const storedSubTopics = Array.isArray(preferenceValues[SUBTOPICS_KEY]?.value) ? preferenceValues[SUBTOPICS_KEY].value : [];
        subTopicsCache = storedSubTopics.length ? storedSubTopics : (vocabularyCache.length ? deriveSubTopics(vocabularyCache) : [DEFAULT_SUBTOPIC]);

        const storedSoundValue = preferenceValues[SOUND_ENABLED_KEY]?.value;
        soundPreferenceCache = typeof storedSoundValue === 'boolean' ? storedSoundValue : true;
        persistPreferencesOfflineCache(normalizedLanguage);
        notifyVocabularyChange();
        resolve({ topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache });
      },
      (error) => {
        if (currentGeneration !== listenerGeneration) {
          return;
        }
        console.error('Failed to sync preferences from Firestore', error);
        resolve({ topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache });
      },
    );
  });

  return preferencesListenerPromise;
}

async function syncPreferencesFromFirestore(language = activeLanguage) {
  await attachPreferencesListener(language);
  return { topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache };
}

export async function ensureVocabularyLoaded() {
  const normalizedLanguage = normalizeLanguageCode(getCurrentLanguage());
  if (activeLanguage !== normalizedLanguage) {
    applyLanguageState(normalizedLanguage);
  }

  if (firestoreInitialized) {
    return vocabularyCache;
  }

  if (!firestoreSyncPromise) {
    firestoreSyncPromise = syncVocabularyFromFirestore(normalizedLanguage).catch((error) => {
      console.error('Failed to load vocabulary from Firestore', error);
      updateDerivedCaches(readOfflineVocabularyState(normalizedLanguage), normalizedLanguage);
      notifyVocabularyChange();
      return vocabularyCache;
    });
  }

  return firestoreSyncPromise;
}

export function loadVocabulary() {
  void ensureVocabularyLoaded();
  return [...vocabularyCache];
}

export function normalizeWordKey(value) {
  return (value || '').trim().toLowerCase();
}

export function findDuplicateVocabularyEntry(words, candidateWord, currentWord = '') {
  const normalizedCandidate = normalizeWordKey(candidateWord);
  const normalizedCurrentWord = normalizeWordKey(currentWord);

  if (!normalizedCandidate) {
    return null;
  }

  return (
    words.find((entry) => {
      const normalizedEntryWord = normalizeWordKey(entry?.word);
      return normalizedEntryWord === normalizedCandidate && normalizedEntryWord !== normalizedCurrentWord;
    }) || null
  );
}

export async function ensurePreferencesLoaded() {
  const normalizedLanguage = normalizeLanguageCode(getCurrentLanguage());
  if (activeLanguage !== normalizedLanguage) {
    applyLanguageState(normalizedLanguage);
  }

  if (preferencesSyncPromise) {
    return preferencesSyncPromise;
  }

  preferencesSyncPromise = syncPreferencesFromFirestore(normalizedLanguage).catch((error) => {
    console.error('Failed to load preferences from Firestore', error);
    return { topics: [...topicsCache], subTopics: [...subTopicsCache], soundEnabled: soundPreferenceCache };
  });

  return preferencesSyncPromise;
}

export async function migrateLocalStorageToFirestore() {
  const language = normalizeLanguageCode(getCurrentLanguage());
  const localVocabulary = readOfflineVocabularyState(language);
  try {
    const db = await getDb();
    if (!db) {
      return false;
    }

    const { collection, getDocs, doc, setDoc } = await getFirestoreHelpers(language);
    const [wordSnapshot, preferencesSnapshot] = await Promise.all([
      getDocs(collection(db, getVocabularyCollection(language))),
      getDocs(collection(db, getSettingsCollection(language))),
    ]);

    const localData = {
      vocabulary: localVocabulary,
      topics: [],
      subTopics: [],
      soundEnabled: null,
    };

    const firestoreWords = wordSnapshot.docs.map((docSnapshot) => normalizeVocabularyEntry({ ...docSnapshot.data(), docId: docSnapshot.id, language }, language));
    const firestoreWordKeys = new Set(firestoreWords.map((entry) => normalizeWordKey(entry.word)));
    const mergedWords = [...firestoreWords];
    const mergedWordKeys = new Set(firestoreWordKeys);
    const missingWords = [];

    localData.vocabulary.forEach((entry) => {
      const normalizedWordKeyValue = normalizeWordKey(entry.word);
      if (!normalizedWordKeyValue || mergedWordKeys.has(normalizedWordKeyValue)) {
        return;
      }
      mergedWordKeys.add(normalizedWordKeyValue);
      const normalizedEntry = normalizeVocabularyEntry({ ...entry, language }, language);
      mergedWords.push(normalizedEntry);
      missingWords.push(normalizedEntry);
    });

    const firestorePreferenceValues = Object.fromEntries(preferencesSnapshot.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot.data()]));
    const existingTopics = Array.isArray(firestorePreferenceValues[TOPICS_KEY]?.value) ? firestorePreferenceValues[TOPICS_KEY].value : [];
    const existingSubTopics = Array.isArray(firestorePreferenceValues[SUBTOPICS_KEY]?.value) ? firestorePreferenceValues[SUBTOPICS_KEY].value : [];
    const existingSoundValue = firestorePreferenceValues[SOUND_ENABLED_KEY]?.value;
    const nextTopics = [...new Set([...existingTopics, ...localData.topics].map((topic) => String(topic).trim()).filter(Boolean))];
    const nextSubTopics = [...new Set([...existingSubTopics, ...localData.subTopics].map((subTopic) => String(subTopic).trim()).filter(Boolean))];
    const nextSoundEnabled = typeof existingSoundValue === 'boolean' ? existingSoundValue : (typeof localData.soundEnabled === 'boolean' ? localData.soundEnabled : true);

    for (const entry of missingWords) {
      const docId = resolveEntryDocumentId(entry, mergedWords) || normalizeWordKey(entry.word);
      await waitForFirestoreWrite(
        setDoc(doc(db, getVocabularyCollection(language), docId), toFirestorePayload(entry), { merge: true }),
        `vocabulary migration "${entry.word}"`,
      );
    }

    if (nextTopics.length) {
      await waitForFirestoreWrite(
        setDoc(doc(db, getSettingsCollection(language), TOPICS_KEY), { value: nextTopics }, { merge: true }),
        'topic migration',
      );
    }
    if (nextSubTopics.length) {
      await waitForFirestoreWrite(
        setDoc(doc(db, getSettingsCollection(language), SUBTOPICS_KEY), { value: nextSubTopics }, { merge: true }),
        'subtopic migration',
      );
    }
    if (typeof existingSoundValue !== 'boolean' && typeof localData.soundEnabled === 'boolean') {
      await waitForFirestoreWrite(
        setDoc(doc(db, getSettingsCollection(language), SOUND_ENABLED_KEY), { value: localData.soundEnabled }, { merge: true }),
        'sound-setting migration',
      );
    }

    updateDerivedCaches(mergedWords, language);
    topicsCache = nextTopics.length ? nextTopics : topicsCache;
    subTopicsCache = nextSubTopics.length ? nextSubTopics : subTopicsCache;
    soundPreferenceCache = nextSoundEnabled;
    persistVocabularyOfflineCache(mergedWords, language);
    persistPreferencesOfflineCache(language);
    firestoreInitialized = false;
    firestoreSyncPromise = null;
    preferencesSyncPromise = null;
    notifyVocabularyChange();
    return true;
  } catch (error) {
    console.error('MIGRATE FAILED', error);
    return false;
  }
}

export async function loadSoundEnabled(defaultValue = true) {
  const preferences = await ensurePreferencesLoaded();
  return typeof preferences?.soundEnabled === 'boolean' ? preferences.soundEnabled : defaultValue;
}

export function saveSoundEnabled(enabled) {
  soundPreferenceCache = Boolean(enabled);
  persistPreferencesOfflineCache(activeLanguage);
  void (async () => {
    const db = await getDb();
    if (!db) {
      return;
    }
    const { doc, setDoc } = await getFirestoreHelpers(activeLanguage);
    await waitForFirestoreWrite(
      setDoc(doc(db, getSettingsCollection(activeLanguage), SOUND_ENABLED_KEY), { value: soundPreferenceCache }, { merge: true }),
      'sound setting',
    );
  })();
}

export function loadTopics() {
  void ensureVocabularyLoaded();
  void ensurePreferencesLoaded();
  return [...topicsCache];
}

export async function saveTopics(topics) {
  const nextTopics = [...new Set((topics || []).map((topic) => String(topic).trim()).filter(Boolean))];
  const db = await getDb();
  if (!db) {
    topicsCache = nextTopics.length ? nextTopics : [DEFAULT_TOPIC];
    persistPreferencesOfflineCache(activeLanguage);
    notifyVocabularyChange();
    return;
  }

  topicsCache = nextTopics.length ? nextTopics : [DEFAULT_TOPIC];
  persistPreferencesOfflineCache(activeLanguage);
  notifyVocabularyChange();
  const { doc, setDoc } = await getFirestoreHelpers(activeLanguage);
  await waitForFirestoreWrite(
    setDoc(doc(db, getSettingsCollection(activeLanguage), TOPICS_KEY), { value: [...topicsCache] }, { merge: true }),
    'topics',
  );
}

export function loadSubTopics(topic) {
  void ensureVocabularyLoaded();
  void ensurePreferencesLoaded();
  if (!topic) {
    return [...subTopicsCache].filter(Boolean);
  }

  const topicScopedSubTopics = (subTopicsCache || [])
    .filter((stored) => typeof stored === 'string' && stored.startsWith(`${topic}::`))
    .map((stored) => stored.slice(topic.length + 2));

  if (topicScopedSubTopics.length) {
    return [...new Set(topicScopedSubTopics)].filter(Boolean).sort();
  }

  const topicSubTopics = vocabularyCache.filter((entry) => entry.topic === topic).map((entry) => entry.subTopic || DEFAULT_SUBTOPIC);
  return [...new Set(topicSubTopics)].filter(Boolean).sort();
}

export async function saveSubTopics(subTopics, topic) {
  const nextSubTopics = [...new Set((subTopics || []).map((subTopic) => String(subTopic).trim()).filter(Boolean))];
  const db = await getDb();

  if (topic) {
    const existingForOtherTopics = subTopicsCache.filter((stored) => !stored.startsWith(`${topic}::`));
    subTopicsCache = [...existingForOtherTopics, ...nextSubTopics.map((subTopic) => `${topic}::${subTopic}`)];
  } else {
    subTopicsCache = nextSubTopics.length ? nextSubTopics : [DEFAULT_SUBTOPIC];
  }

  if (!db) {
    persistPreferencesOfflineCache(activeLanguage);
    notifyVocabularyChange();
    return;
  }

  persistPreferencesOfflineCache(activeLanguage);
  notifyVocabularyChange();
  const { doc, setDoc } = await getFirestoreHelpers(activeLanguage);
  await waitForFirestoreWrite(
    setDoc(doc(db, getSettingsCollection(activeLanguage), SUBTOPICS_KEY), { value: [...subTopicsCache] }, { merge: true }),
    'subtopics',
  );
}

export async function renameTopic(oldTopic, newTopic) {
  if (!oldTopic || !oldTopic.trim() || !newTopic || !newTopic.trim()) {
    throw new Error('Topic name is required.');
  }

  const normalizedOldTopic = oldTopic.trim();
  const normalizedNewTopic = newTopic.trim();
  await ensureVocabularyLoaded();
  const topics = loadTopics();
  const duplicate = topics.some(
    (topic) => topic.toLowerCase() === normalizedNewTopic.toLowerCase() && topic.toLowerCase() !== normalizedOldTopic.toLowerCase(),
  );
  if (duplicate) {
    throw new Error('Topic already exists.');
  }

  const matchingWords = loadVocabulary().filter((entry) => entry.topic && entry.topic.toLowerCase() === normalizedOldTopic.toLowerCase());
  const updatedEntries = matchingWords.map((entry) => ({ ...entry, topic: normalizedNewTopic }));
  await Promise.all(updatedEntries.map((entry) => writeWordDocument(entry)));
  updateDerivedCaches(vocabularyCache.map((entry) => {
    const matchingEntry = updatedEntries.find((updated) => normalizeWordKey(updated.word) === normalizeWordKey(entry.word));
    return matchingEntry ? { ...entry, ...matchingEntry } : entry;
  }), activeLanguage);

  await saveTopics(topics.map((topic) => topic.toLowerCase() === normalizedOldTopic.toLowerCase() ? normalizedNewTopic : topic));
}

export async function renameSubTopic(topic, oldSubTopic, newSubTopic) {
  if (!topic || !topic.trim() || !oldSubTopic || !oldSubTopic.trim() || !newSubTopic || !newSubTopic.trim()) {
    throw new Error('Sub Topic name is required.');
  }

  const normalizedTopic = topic.trim();
  const normalizedOldSubTopic = oldSubTopic.trim();
  const normalizedNewSubTopic = newSubTopic.trim();
  await ensureVocabularyLoaded();
  const subTopics = loadSubTopics(normalizedTopic);
  const duplicate = subTopics.some(
    (subTopic) => subTopic.toLowerCase() === normalizedNewSubTopic.toLowerCase() && subTopic.toLowerCase() !== normalizedOldSubTopic.toLowerCase(),
  );
  if (duplicate) {
    throw new Error('Sub Topic already exists.');
  }

  const matchingWords = loadVocabulary().filter(
    (entry) => entry.topic === normalizedTopic && entry.subTopic && entry.subTopic.toLowerCase() === normalizedOldSubTopic.toLowerCase(),
  );
  const updatedEntries = matchingWords.map((entry) => ({ ...entry, subTopic: normalizedNewSubTopic }));
  await Promise.all(updatedEntries.map((entry) => writeWordDocument(entry)));
  updateDerivedCaches(vocabularyCache.map((entry) => {
    const matchingEntry = updatedEntries.find((updated) => normalizeWordKey(updated.word) === normalizeWordKey(entry.word));
    return matchingEntry ? { ...entry, ...matchingEntry } : entry;
  }), activeLanguage);

  await saveSubTopics(subTopics.map((subTopic) => subTopic.toLowerCase() === normalizedOldSubTopic.toLowerCase() ? normalizedNewSubTopic : subTopic), normalizedTopic);
}

export async function deleteTopic(topic) {
  if (!topic || !topic.trim()) {
    throw new Error('Topic name is required.');
  }

  const normalizedTopic = topic.trim();
  await ensureVocabularyLoaded();
  const nextTopics = loadTopics().filter((storedTopic) => storedTopic.toLowerCase() !== normalizedTopic.toLowerCase());
  const wordsToDelete = loadVocabulary().filter((entry) => entry.topic && entry.topic.toLowerCase() === normalizedTopic.toLowerCase());

  await Promise.all(wordsToDelete.map((entry) => deleteWordDocument(entry)));
  await saveTopics(nextTopics);
}

export async function deleteSubTopic(topic, subTopic) {
  if (!topic || !topic.trim() || !subTopic || !subTopic.trim()) {
    throw new Error('Sub Topic name is required.');
  }

  const normalizedTopic = topic.trim();
  const normalizedSubTopic = subTopic.trim();
  await ensureVocabularyLoaded();
  const wordsToDelete = loadVocabulary().filter(
    (entry) => entry.topic === normalizedTopic && entry.subTopic && entry.subTopic.toLowerCase() === normalizedSubTopic.toLowerCase(),
  );

  await Promise.all(wordsToDelete.map((entry) => deleteWordDocument(entry)));

  const nextSubTopics = loadSubTopics(normalizedTopic).filter((stored) => stored.toLowerCase() !== normalizedSubTopic.toLowerCase());
  await saveSubTopics(nextSubTopics, normalizedTopic);
}

export async function saveVocabulary(words) {
  const normalized = normalizeVocabularyList(words, activeLanguage);
  console.log('DATA FLOW - saveVocabulary normalized list:', normalized);
  const db = await getDb();
  if (!db) {
    updateDerivedCaches(normalized, activeLanguage);
    persistVocabularyOfflineCache(normalized, activeLanguage);
    notifyVocabularyChange();
    return normalized;
  }

  await Promise.all(
    normalized.map((entry) => {
      const documentId = resolveEntryDocumentId(entry, normalized) || normalizeWordKey(entry.word);
      return writeWordDocument({ ...entry, docId });
    }),
  );

  updateDerivedCaches(normalized, activeLanguage);
  console.log('DATA FLOW - saveVocabulary after updateDerivedCaches');
  persistVocabularyOfflineCache(normalized, activeLanguage);
  firestoreInitialized = true;
  return normalized;
}

export function createVocabularyEntry(
  word,
  meaning,
  example,
  ipa = '',
  topic = DEFAULT_TOPIC,
  subTopic = DEFAULT_SUBTOPIC,
  type = DEFAULT_TYPE,
  meanings = {},
  synonyms = [],
  antonyms = [],
  definition = '',
  collocations = [],
  basicExample = '',
  conversationExample = '',
  lessonExample = '',
  examples = null,
  wordFamily = [],
  fixedPhrases = [],
  sentencePatterns = [],
  commonExpressions = [],
  commonMistakes = [],
  meaningsAnalysis = [],
  partOfSpeech = '',
) {
  const normalizedMeanings = normalizeMeaningMap(meanings || meaning);
  const fallbackMeaning = normalizedMeanings.vietnamese || normalizedMeanings.vi || normalizedMeanings.english || String(meaning || '').trim();
  const legacyExamplePayload = examples && typeof examples === 'object' && !Array.isArray(examples)
    ? examples
    : (typeof lessonExample === 'object' && lessonExample !== null && !Array.isArray(lessonExample))
      ? lessonExample
      : (typeof conversationExample === 'object' && conversationExample !== null && !Array.isArray(conversationExample))
        ? conversationExample
        : (typeof basicExample === 'object' && basicExample !== null && !Array.isArray(basicExample))
          ? basicExample
          : null;
  const exampleBasic = String(
    legacyExamplePayload?.basic ||
    legacyExamplePayload?.basicExample ||
    legacyExamplePayload?.example ||
    example ||
    basicExample ||
    conversationExample ||
    lessonExample ||
    '',
  ).trim();
  const exampleConversation = String(
    legacyExamplePayload?.conversation ||
    legacyExamplePayload?.conversationExample ||
    '',
  ).trim();
  const exampleLessonContext = String(
    legacyExamplePayload?.lessonContext ||
    legacyExamplePayload?.lessonExample ||
    '',
  ).trim();
  const normalizedExamples = {
    basic: exampleBasic,
    conversation: exampleConversation,
    lessonContext: exampleLessonContext,
  };

  const entryObject = {
    word: String(word || '').trim(),
    meanings: normalizedMeanings,
    meaning: fallbackMeaning,
    example: exampleBasic,
    ipa: String(ipa || '').trim(),
    synonyms: normalizeSupportObjectList(synonyms),
    antonyms: normalizeSupportObjectList(antonyms),
    wordFamily: normalizeSupportObjectList(wordFamily),
    fixedPhrases: normalizeSupportObjectList(fixedPhrases),
    collocations: normalizeSupportObjectList(collocations),
    sentencePatterns: normalizeSupportObjectList(sentencePatterns),
    commonExpressions: normalizeSupportObjectList(commonExpressions),
    commonMistakes: normalizeSupportObjectList(commonMistakes),
    meaningsAnalysis: normalizeMeaningsAnalysis(meaningsAnalysis),
    examples: normalizedExamples,
    topic: String(topic || '').trim() || DEFAULT_TOPIC,
    subTopic: String(subTopic || '').trim() || DEFAULT_SUBTOPIC,
    type: String(type || '').trim() || DEFAULT_TYPE,
    partOfSpeech: String(partOfSpeech || '').trim(),
    writeCount: 0,
    correct: 0,
    wrong: 0,
    learned: false,
    language: activeLanguage,
  };
  console.log('DATA FLOW - createVocabularyEntry output:', entryObject);
  return entryObject;
}

export async function addVocabularyEntry(entry) {
  await ensureVocabularyLoaded();
  const words = loadVocabulary();
  console.log('DATA FLOW - addVocabularyEntry input:', entry);
  const normalizedEntry = createVocabularyEntry(
    entry.word,
    entry.meaning,
    entry.example,
    entry.ipa,
    entry.topic,
    entry.subTopic,
    entry.type,
    entry.meanings || entry.meaning,
    entry.synonyms,
    entry.antonyms,
    entry.definition,
    entry.collocations,
    entry.basicExample,
    entry.conversationExample,
    entry.lessonExample,
    entry.examples,
    entry.wordFamily,
    entry.fixedPhrases,
    entry.sentencePatterns,
    entry.commonExpressions,
    entry.commonMistakes,
    entry.meaningsAnalysis,
    entry.partOfSpeech,
  );
  console.log('DATA FLOW - addVocabularyEntry normalized:', normalizedEntry);

  if (!normalizedEntry.word) {
    throw new Error('Từ không được để trống.');
  }

  const exists = words.some((item) => normalizeWordKey(item.word) === normalizeWordKey(normalizedEntry.word));
  if (exists) {
    throw new Error('Từ này đã tồn tại.');
  }

  await writeWordDocument(normalizedEntry);
  return normalizedEntry;
}

export async function removeVocabularyEntry(word) {
  await ensureVocabularyLoaded();
  await deleteWordDocument(word);
}

export async function updateVocabularyEntryByWord(originalWord, updates) {
  await ensureVocabularyLoaded();
  const words = loadVocabulary();
  const normalizedOriginalWord = normalizeWordKey(originalWord);
  const nextWord = (updates?.word || '').trim();

  if (nextWord) {
    const duplicate = words.find(
      (item) => normalizeWordKey(item.word) !== normalizedOriginalWord && normalizeWordKey(item.word) === normalizeWordKey(nextWord),
    );
    if (duplicate) {
      throw new Error('Từ này đã tồn tại.');
    }
  }

  const existing = words.find((item) => normalizeWordKey(item.word) === normalizedOriginalWord);
  if (!existing) {
    return null;
  }

  const existingExamples = existing.examples && typeof existing.examples === 'object' && !Array.isArray(existing.examples)
    ? existing.examples
    : {};
  const updatedExamples = updates?.examples && typeof updates.examples === 'object' && !Array.isArray(updates.examples)
    ? updates.examples
    : {};
  const merged = {
    ...existing,
    ...updates,
    examples: { ...existingExamples, ...updatedExamples },
    word: nextWord || existing.word,
  };
  console.log('DATA FLOW - Before updateVocabularyEntryByWord normalize:', merged);
  const updated = normalizeVocabularyEntry(merged, activeLanguage);
  console.log('DATA FLOW - After updateVocabularyEntryByWord normalize:', updated);
  if (!updated.word) {
    throw new Error('Từ không được để trống.');
  }

  await writeWordDocument(updated);
  return updated;
}

export async function updateVocabularyEntry(word, updates) {
  await ensureVocabularyLoaded();
  const words = loadVocabulary();
  const normalizedOriginalWord = normalizeWordKey(word);
  const existing = words.find((item) => normalizeWordKey(item.word) === normalizedOriginalWord);
  if (!existing) {
    return null;
  }

  const merged = { ...existing, ...updates };
  console.log('DATA FLOW - Before updateVocabularyEntry normalize:', merged);
  const updated = normalizeVocabularyEntry(merged, activeLanguage);
  console.log('DATA FLOW - After updateVocabularyEntry normalize:', updated);
  if (!updated.word) {
    throw new Error('Từ không được để trống.');
  }

  await writeWordDocument(updated);
  return updated;
}

export function findVocabularyEntry(word) {
  return loadVocabulary().find((item) => normalizeWordKey(item.word) === normalizeWordKey(word));
}

export function getUniqueTopics(words) {
  return [...new Set(words.map((entry) => entry.topic || DEFAULT_TOPIC))].sort();
}

export function getUniqueSubTopics(words, topic) {
  return [...new Set(words.filter((entry) => (topic ? entry.topic === topic : true)).map((entry) => entry.subTopic || DEFAULT_SUBTOPIC))].sort();
}

export function filterVocabularyByTopic(words, topic, subTopic) {
  return words.filter((entry) => {
    const matchesTopic = !topic || topic === '' || entry.topic === topic;
    const matchesSubTopic = !subTopic || subTopic === '' || entry.subTopic === subTopic;
    return matchesTopic && matchesSubTopic;
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('language-changed', (event) => {
    const nextLanguage = event?.detail?.language;
    if (nextLanguage) {
      applyLanguageState(nextLanguage);
    }
  });
}
