import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateVocabularyEntry, normalizeWordAndPartOfSpeech, normalizeWordKey } from '../storage.js';

test('normalizeWordKey trims and lowercases input', () => {
  assert.equal(normalizeWordKey(' ACHIEVE '), 'achieve');
  assert.equal(normalizeWordKey('Achieve'), 'achieve');
});

test('part-of-speech suffixes are removed from the term and recognized as part of speech', () => {
  assert.deepEqual(normalizeWordAndPartOfSpeech('competence (n)'), {
    word: 'competence',
    partOfSpeech: 'noun',
  });
  assert.deepEqual(normalizeWordAndPartOfSpeech('shortlist (v/n)'), {
    word: 'shortlist',
    partOfSpeech: 'verb / noun',
  });
  assert.deepEqual(normalizeWordAndPartOfSpeech('proficient (in sth/at doing sth)'), {
    word: 'proficient (in sth/at doing sth)',
    partOfSpeech: '',
  });
  assert.deepEqual(normalizeWordAndPartOfSpeech('competence (n)', 'Noun'), {
    word: 'competence',
    partOfSpeech: 'Noun',
  });
});

test('findDuplicateVocabularyEntry ignores casing and whitespace and skips the current word', () => {
  const entries = [
    { word: 'Achieve', topic: 'Lesson 20', subTopic: 'Growing an international company', meaning: 'đạt được', example: 'we would like to achieve our sales goal before december', ipa: '/əˈtʃiːv/' },
    { word: 'Build', topic: 'General', subTopic: 'Default', meaning: 'xây dựng', example: 'We build products', ipa: '/bɪld/' },
  ];

  assert.deepEqual(findDuplicateVocabularyEntry(entries, ' achieve '), entries[0]);
  assert.equal(findDuplicateVocabularyEntry(entries, ' build ', 'Build'), null);
  assert.equal(findDuplicateVocabularyEntry(entries, ' unknown '), null);
});

test('duplicate detection matches terms whether or not input has a part-of-speech suffix', () => {
  const entries = [{ word: 'competence', partOfSpeech: 'noun' }];

  assert.equal(findDuplicateVocabularyEntry(entries, 'competence (n)'), entries[0]);
  assert.equal(normalizeWordKey('competence (n)'), normalizeWordKey('competence'));
});
