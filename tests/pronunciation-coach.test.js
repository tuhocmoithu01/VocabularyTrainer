import test from 'node:test';
import assert from 'node:assert/strict';
import { createPronunciationCoachSession, PRONUNCIATION_COACH_STATES as STATES } from '../pronunciation-coach.js';

test('matching transcript is not treated as a pronunciation pass or auto-advanced', () => {
  const session = createPronunciationCoachSession([{ word: 'portfolio' }, { word: 'proficient' }], 'Work', 'Interview');
  assert.equal(session.start(), true);
  assert.equal(session.snapshot().currentWord.word, 'portfolio');
  assert.equal(session.beginRecording(), true);

  const result = session.assessTranscript('Portfolio!');

  assert.equal(result.transcriptMatches, true);
  assert.equal(result.state, STATES.TRANSCRIPT_MATCHED);
  assert.equal(session.snapshot().currentWord.word, 'portfolio');
  assert.equal(session.snapshot().skippedCount, 0);
  assert.equal(session.retry(), true);
  assert.equal(session.beginRecording(), true);
  assert.equal(session.assessTranscript('wrong').state, STATES.RETRY);
});

test('two incorrect transcripts offer syllable practice without inventing a syllable result', () => {
  const session = createPronunciationCoachSession([{ word: 'proficient' }]);
  session.start();
  session.beginRecording();
  assert.equal(session.assessTranscript('proficiency').state, STATES.RETRY);

  session.beginRecording();
  const secondResult = session.assessTranscript('proficiency');

  assert.equal(secondResult.state, STATES.ASK_SYLLABLE_PRACTICE);
  assert.equal(session.snapshot().attemptsForWord, 2);
  assert.equal(session.chooseSyllablePractice(), true);
  assert.equal(session.snapshot().state, STATES.RETRY);
});

test('recognition errors do not count as incorrect pronunciation attempts', () => {
  const session = createPronunciationCoachSession([{ word: 'portfolio' }]);
  session.start();
  session.beginRecording();
  session.reportError('not-allowed');

  assert.equal(session.snapshot().state, STATES.ERROR);
  assert.equal(session.snapshot().attemptsForWord, 0);
  assert.equal(session.retry(), true);
  assert.equal(session.snapshot().state, STATES.READY);
});

test('empty transcript is an error rather than an incorrect attempt', () => {
  const session = createPronunciationCoachSession([{ word: 'portfolio' }]);
  session.start();
  session.beginRecording();

  const result = session.assessTranscript('');

  assert.equal(result.reason, 'no-speech');
  assert.equal(session.snapshot().attemptsForWord, 0);
});

test('does not allow overlapping recordings', () => {
  const session = createPronunciationCoachSession([{ word: 'word' }]);
  session.start();

  assert.equal(session.beginRecording(), true);
  assert.equal(session.beginRecording(), false);
});

test('pause and resume never silently restart a recording', () => {
  const session = createPronunciationCoachSession([{ word: 'word' }]);
  session.start();
  session.beginRecording();
  session.pause();

  assert.equal(session.snapshot().state, STATES.PAUSED);
  assert.equal(session.resume(), true);
  assert.equal(session.snapshot().state, STATES.READY);
});

test('skip advances without recording a successful pronunciation', () => {
  const session = createPronunciationCoachSession([{ word: 'first' }, { word: 'second' }]);
  session.start();

  assert.equal(session.skip(), true);
  assert.equal(session.snapshot().currentWord.word, 'second');
  assert.equal(session.snapshot().skippedCount, 1);
});

test('finishes after the last skipped word', () => {
  const session = createPronunciationCoachSession([{ word: 'first' }]);
  session.start();
  session.skip();

  assert.equal(session.snapshot().state, STATES.COMPLETED);
  assert.equal(session.snapshot().active, false);
});
