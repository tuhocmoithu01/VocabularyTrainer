import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVocabularyEntry,
  DEFAULT_TYPE,
  addVocabularyEntry,
  initializeOfflineCache,
  filterVocabularyByTopic,
  findDuplicateVocabularyEntry,
  loadTopics,
  loadSubTopics,
  loadVocabulary,
  mergeVocabularyCategories,
  saveSubTopics,
  toFirestorePayload,
  updateVocabularyEntryByWord,
} from '../storage.js';
import { getCurrentLanguage, getLanguageOptions, setCurrentLanguage } from '../language-manager.js';
import { getVocabularyCollection, getSettingsCollection } from '../data-access.js';

test('initializeOfflineCache hydrates Test filters before Firestore responds', () => {
  const originalWindow = globalThis.window;
  const values = new Map([
    ['vocabularyTrainer.vocabulary.english', JSON.stringify([
      { word: 'decorate', topic: 'TOEIC', subTopic: 'Lesson 28' },
    ])],
    ['vocabularyTrainer.preferences.english', JSON.stringify({ topics: [], subTopics: [], soundEnabled: false })],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
  };

  try {
    const state = initializeOfflineCache('english');
    assert.equal(state.vocabulary.length, 1);
    assert.deepEqual(state.topics, ['TOEIC']);
    assert.deepEqual(state.subTopics, ['Lesson 28']);
    assert.equal(state.soundEnabled, false);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('topic and subtopic filters include vocabulary missing from saved preferences', () => {
  const originalWindow = globalThis.window;
  const originalLanguage = getCurrentLanguage();
  const values = new Map([
    ['vocabularyTrainer.vocabulary.english', JSON.stringify([
      { word: 'assess', topic: 'Work', subTopic: 'Assessment' },
      { word: 'interview', topic: 'Work', subTopic: 'Interview' },
      { word: 'competence (n)', topic: '700+ part 1: Job Application & Interview', subTopic: 'Competence' },
    ])],
    ['vocabularyTrainer.preferences.english', JSON.stringify({
      topics: ['General'],
      subTopics: ['Work::Assessment'],
      soundEnabled: true,
    })],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
  };

  try {
    setCurrentLanguage('english');
    initializeOfflineCache('english');

    assert.deepEqual(loadTopics(), ['General', '700+ part 1: Job Application & Interview', 'Work']);
    assert.deepEqual(loadSubTopics(), ['Assessment', 'Competence', 'Interview']);
    assert.deepEqual(loadSubTopics('Work'), ['Assessment', 'Interview']);
    assert.deepEqual(
      filterVocabularyByTopic(loadVocabulary(), '700+ part 1: Job Application & Interview', 'Competence')
        .map((entry) => entry.word),
      ['competence'],
    );
    assert.equal(
      findDuplicateVocabularyEntry(loadVocabulary(), 'COMPETENCE (N)')?.subTopic,
      'Competence',
    );
  } finally {
    setCurrentLanguage(originalLanguage);
    initializeOfflineCache(originalLanguage);
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('mergeVocabularyCategories adds missing categories without removing saved preferences', () => {
  const result = mergeVocabularyCategories(
    [
      { topic: '700+ part 1: Job Application & Interview', subTopic: 'Competence' },
      { topic: 'Work', subTopic: 'Assessment' },
    ],
    ['General', 'Work'],
    ['Work::Assessment', 'Old topic::Old subtopic'],
  );

  assert.deepEqual(result.topics, ['General', 'Work', '700+ part 1: Job Application & Interview']);
  assert.deepEqual(result.subTopics, [
    'Work::Assessment',
    'Old topic::Old subtopic',
    '700+ part 1: Job Application & Interview::Competence',
  ]);
});

test('switching languages retains the previous offline vocabulary cache', () => {
  const originalWindow = globalThis.window;
  const originalLanguage = getCurrentLanguage();
  const values = new Map([
    ['vocabularyTrainer.vocabulary.english', JSON.stringify([{ word: 'retain' }])],
    ['vocabularyTrainer.preferences.english', JSON.stringify({ topics: [], subTopics: [], soundEnabled: true })],
    ['vocabularyTrainer.vocabulary.japanese', JSON.stringify([{ word: '残す' }])],
    ['vocabularyTrainer.preferences.japanese', JSON.stringify({ topics: [], subTopics: [], soundEnabled: true })],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    dispatchEvent: () => {},
  };

  try {
    setCurrentLanguage('english');
    initializeOfflineCache('english');
    setCurrentLanguage('japanese');
    initializeOfflineCache('japanese');
    const englishCache = JSON.parse(values.get('vocabularyTrainer.vocabulary.english'));
    assert.equal(englishCache.length, 1);
    assert.equal(englishCache[0].word, 'retain');
  } finally {
    setCurrentLanguage(originalLanguage);
    initializeOfflineCache(originalLanguage);
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('loadSubTopics returns newly saved subtopics for the selected topic', async () => {
  await saveSubTopics(['meeting'], 'Work');

  const subTopics = loadSubTopics('Work');

  assert.deepEqual(subTopics, ['meeting']);
});

test('createVocabularyEntry defaults the type to Word when none provided', () => {
  const entry = createVocabularyEntry('learn', 'to study', 'I like to learn.', '/lɜːn/', 'Education', 'School');

  assert.equal(entry.type, DEFAULT_TYPE);
  assert.equal(entry.word, 'learn');
  assert.equal(entry.topic, 'Education');
});

test('Firestore vocabulary payload preserves UK and US pronunciation metadata', () => {
  const entry = createVocabularyEntry('competence', '', '', '');
  const payload = toFirestorePayload({
    ...entry,
    ipaUK: '/ˈkɒm.pə.təns/',
    ipaUS: '/ˈkɑm.pə.təns/',
    pronunciationAudioUK: 'https://example.test/uk.wav',
    pronunciationAudioUS: 'https://example.test/us.wav',
    pronunciationAudioSourceUK: 'https://example.test/uk-source',
    pronunciationAudioSourceUS: 'https://example.test/us-source',
    pronunciationSourceUrl: 'https://en.wiktionary.org/wiki/competence',
    pronunciationCheckedAt: '2026-10-25T00:00:00.000Z',
  });

  assert.equal(payload.ipaUK, '/ˈkɒm.pə.təns/');
  assert.equal(payload.ipaUS, '/ˈkɑm.pə.təns/');
  assert.equal(payload.pronunciationAudioUK, 'https://example.test/uk.wav');
  assert.equal(payload.pronunciationAudioUS, 'https://example.test/us.wav');
  assert.equal(payload.pronunciationAudioSourceUK, 'https://example.test/uk-source');
  assert.equal(payload.pronunciationAudioSourceUS, 'https://example.test/us-source');
  assert.equal(payload.pronunciationSourceUrl, 'https://en.wiktionary.org/wiki/competence');
  assert.equal(payload.pronunciationCheckedAt, '2026-10-25T00:00:00.000Z');
});

test('createVocabularyEntry moves recognized POS suffixes into the part-of-speech field', () => {
  const entry = createVocabularyEntry(
    'competence (n)',
    '',
    '',
    '',
    'Work',
    'Assessment',
    'Phrase',
  );

  assert.equal(entry.word, 'competence');
  assert.equal(entry.partOfSpeech, 'noun');
  assert.equal(entry.type, 'Word');
  assert.equal(createVocabularyEntry('curriculum vitae (CV)', '').word, 'curriculum vitae (CV)');
});

test('addVocabularyEntry preserves slashes in words while using a Firestore-safe document id', async () => {
  const originalWindow = globalThis.window;
  const originalLanguage = getCurrentLanguage();
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    dispatchEvent: () => {},
  };

  try {
    setCurrentLanguage('english');
    initializeOfflineCache('english');
    const word = 'proficient (in sth/at doing sth)';
    await addVocabularyEntry({
      word,
      meaning: 'thành thạo trong một lĩnh vực/kỹ năng',
      topic: 'Skills',
      subTopic: 'Job Application & Interview',
      ipaUK: '/prəˈfɪʃənt/',
      ipaUS: '/prəˈfɪʃənt/',
      pronunciationSourceUrl: 'https://en.wiktionary.org/wiki/proficient',
      pronunciationCheckedAt: '2026-10-25T00:00:00.000Z',
    });

    const savedEntry = loadVocabulary().find((entry) => entry.word === word);
    assert.ok(savedEntry);
    assert.equal(savedEntry.docId, 'proficient%20(in%20sth%2Fat%20doing%20sth)');
    assert.equal(savedEntry.ipaUK, '/prəˈfɪʃənt/');
    assert.equal(savedEntry.ipaUS, '/prəˈfɪʃənt/');
    assert.equal(savedEntry.pronunciationSourceUrl, 'https://en.wiktionary.org/wiki/proficient');

    const renamedEntry = await updateVocabularyEntryByWord(word, { word: 'capable' });
    assert.equal(renamedEntry.ipaUK, '');
    assert.equal(renamedEntry.ipaUS, '');
    assert.equal(renamedEntry.pronunciationCheckedAt, '');
  } finally {
    setCurrentLanguage(originalLanguage);
    initializeOfflineCache(originalLanguage);
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('createVocabularyEntry preserves support data as object arrays', () => {
  const entry = createVocabularyEntry('problem', 'vấn đề', 'This is a problem.', '/ˈprɑːbləm/', 'Education', 'School', 'Word', {}, ['issue', 'difficulty'], ['solution', 'answer'], 'something difficult that needs to be solved');

  assert.deepEqual(entry.synonyms, [{ word: 'issue', meaning: '' }, { word: 'difficulty', meaning: '' }]);
  assert.deepEqual(entry.antonyms, [{ word: 'solution', meaning: '' }, { word: 'answer', meaning: '' }]);
});

test('createVocabularyEntry preserves word family and fixed phrases as object arrays', () => {
  const entry = createVocabularyEntry(
    'explanation',
    'lời giải thích',
    'This is an explanation.',
    '/ˌɛk.spləˈneɪ.ʃən/',
    'Education',
    'School',
    'Word',
    {},
    ['synonym'],
    ['antonym'],
    'a statement that makes something clear',
    [],
    {},
    {},
    {},
    { basic: 'This is an explanation.' },
    [{ word: 'explanatory', meaning: 'mang tính giải thích', type: 'Tính từ' }],
    [{ word: 'give an explanation', meaning: 'đưa ra lời giải thích' }],
  );

  assert.deepEqual(entry.wordFamily, [{ word: 'explanatory', meaning: 'mang tính giải thích', type: 'Tính từ' }]);
  assert.deepEqual(entry.fixedPhrases, [{ word: 'give an explanation', meaning: 'đưa ra lời giải thích' }]);
});

test('createVocabularyEntry preserves the new AI expansion sections', () => {
  const entry = createVocabularyEntry(
    'act',
    'hành động',
    'This is a basic example.',
    '/ækt/',
    'Education',
    'School',
    'Word',
    {},
    ['behave'],
    ['ignore'],
    'to do something',
    [],
    '',
    '',
    '',
    null,
    [],
    [],
    [{ word: 'act as + N', meaning: 'đóng vai là ai đó', example: 'She can act as a teacher.' }],
    [{ word: 'actions speak louder than words', meaning: 'hành động nói nhiều hơn lời nói', example: 'Actions speak louder than words.' }],
    [{ word: 'make an action', meaning: 'sai', example: 'We need to make an action.' }],
  );

  assert.deepEqual(entry.sentencePatterns, [{ word: 'act as + N', meaning: 'đóng vai là ai đó', example: 'She can act as a teacher.' }]);
  assert.deepEqual(entry.commonExpressions, [{ word: 'actions speak louder than words', meaning: 'hành động nói nhiều hơn lời nói', example: 'Actions speak louder than words.' }]);
  assert.deepEqual(entry.commonMistakes, [{ word: 'make an action', meaning: 'sai', example: 'We need to make an action.' }]);
});

test('createVocabularyEntry normalizes the compact Examples structure', () => {
  const entry = createVocabularyEntry(
    'schedule',
    'sắp xếp lịch',
    'This is a basic example.',
    '/ˈʃedjuːl/',
    'Education',
    'School',
    'Word',
    {},
    ['arrange', 'plan'],
    ['cancel', 'delay'],
    'to arrange something for a specific time',
    'Business Meeting',
    '',
    [],
    {},
    { basic: 'Please schedule the meeting.', conversation: 'Can we schedule a call?', lessonContext: 'We will schedule the meeting tomorrow.' },
  );

  assert.deepEqual(entry.examples, {
    basic: 'Please schedule the meeting.',
    conversation: 'Can we schedule a call?',
    lessonContext: 'We will schedule the meeting tomorrow.',
  });
  assert.equal(entry.example, 'Please schedule the meeting.');
});

test('toFirestorePayload preserves the canonical example and drops legacy example fields', () => {
  const entry = createVocabularyEntry(
    'test',
    'kiểm tra',
    'One example sentence.',
    '/tɛst/',
    'Education',
    'School',
    'Word',
    {},
    ['trial'],
    ['ignore'],
    'a procedure for evaluation',
    [],
    { basic: 'One example sentence.' },
  );

  const payload = toFirestorePayload(entry);

  assert.equal(payload.example, 'One example sentence.');
  assert.deepEqual(payload.examples, { basic: 'One example sentence.' });
});

test('toFirestorePayload preserves additional example fields when present', () => {
  const payload = toFirestorePayload({
    word: 'schedule',
    example: 'Please schedule the meeting.',
    examples: {
      basic: 'Please schedule the meeting.',
      conversation: 'Can we schedule a call?',
      lessonContext: 'We will schedule the meeting tomorrow.',
    },
  });

  assert.deepEqual(payload.examples, {
    basic: 'Please schedule the meeting.',
    conversation: 'Can we schedule a call?',
    lessonContext: 'We will schedule the meeting tomorrow.',
  });
});

test('editing an entry preserves additional examples and expansion fields', async () => {
  const originalWindow = globalThis.window;
  const originalLanguage = getCurrentLanguage();
  const entry = {
    ...createVocabularyEntry(
      'schedule',
      'sắp xếp lịch',
      'Please schedule the meeting.',
      '/ˈʃedjuːl/',
      'TOEIC',
      'Lesson 1',
      'Word',
      { english: 'to arrange something for a specific time', vietnamese: 'sắp xếp lịch' },
      ['arrange'],
      ['cancel'],
      'to arrange something for a specific time',
      [{ word: 'schedule a meeting', meaning: 'lên lịch cuộc họp' }],
      '',
      '',
      '',
      {
        basic: 'Please schedule the meeting.',
        conversation: 'Can we schedule a call?',
        lessonContext: 'We will schedule the meeting tomorrow.',
      },
      [{ word: 'scheduler', meaning: 'người lập lịch' }],
      [{ word: 'on schedule', meaning: 'đúng lịch' }],
      [{ word: 'schedule + noun', meaning: 'lên lịch cho việc gì' }],
      [{ word: 'schedule a meeting', meaning: 'lên lịch cuộc họp' }],
      [{ word: 'schedule a work', meaning: 'cách dùng sai' }],
      [{ meaning: 'appointment', pos: 'noun', explanation: 'a planned meeting' }],
    ),
    customField: 'preserve this too',
  };
  const values = new Map([
    ['vocabularyTrainer.vocabulary.english', JSON.stringify([entry])],
    ['vocabularyTrainer.preferences.english', JSON.stringify({ topics: [], subTopics: [], soundEnabled: true })],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    dispatchEvent: () => {},
  };

  try {
    setCurrentLanguage('english');
    initializeOfflineCache('english');
    await updateVocabularyEntryByWord('schedule', {
      word: 'schedule',
      example: 'Please schedule the meeting today.',
      examples: { basic: 'Please schedule the meeting today.' },
    });

    const updated = loadVocabulary().find((item) => item.word === 'schedule');
    assert.deepEqual(updated.examples, {
      basic: 'Please schedule the meeting today.',
      conversation: 'Can we schedule a call?',
      lessonContext: 'We will schedule the meeting tomorrow.',
    });
    assert.deepEqual(updated.synonyms, [{ word: 'arrange', meaning: '' }]);
    assert.deepEqual(updated.antonyms, [{ word: 'cancel', meaning: '' }]);
    assert.deepEqual(updated.wordFamily, [{ word: 'scheduler', meaning: 'người lập lịch' }]);
    assert.deepEqual(updated.fixedPhrases, [{ word: 'on schedule', meaning: 'đúng lịch' }]);
    assert.deepEqual(updated.collocations, [{ word: 'schedule a meeting', meaning: 'lên lịch cuộc họp' }]);
    assert.deepEqual(updated.sentencePatterns, [{ word: 'schedule + noun', meaning: 'lên lịch cho việc gì' }]);
    assert.deepEqual(updated.commonExpressions, [{ word: 'schedule a meeting', meaning: 'lên lịch cuộc họp' }]);
    assert.deepEqual(updated.commonMistakes, [{ word: 'schedule a work', meaning: 'cách dùng sai' }]);
    assert.equal(updated.meaningsAnalysis[0].meaning, 'appointment');
    assert.equal(updated.meaningsAnalysis[0].pos, 'noun');
    assert.equal(updated.customField, 'preserve this too');
  } finally {
    setCurrentLanguage(originalLanguage);
    initializeOfflineCache(originalLanguage);
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('language manager switches collections by language and exposes options', () => {
  setCurrentLanguage('english');
  assert.equal(getCurrentLanguage(), 'english');
  assert.equal(getVocabularyCollection('english'), 'words');
  assert.equal(getSettingsCollection('english'), 'preferences');
  assert.equal(getVocabularyCollection('japanese'), 'words_japanese');
  assert.equal(getSettingsCollection('japanese'), 'preferences_japanese');
  assert.ok(getLanguageOptions().some((language) => language.code === 'english'));
});
