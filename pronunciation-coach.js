export const PRONUNCIATION_COACH_STATES = Object.freeze({
  READY: 'READY',
  PLAYING_WORD: 'PLAYING_WORD',
  WAITING_FOR_SPEECH: 'WAITING_FOR_SPEECH',
  RECORDING: 'RECORDING',
  ASSESSING: 'ASSESSING',
  TRANSCRIPT_MATCHED: 'TRANSCRIPT_MATCHED',
  RETRY: 'RETRY',
  ASK_SYLLABLE_PRACTICE: 'ASK_SYLLABLE_PRACTICE',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
  COMPLETED: 'COMPLETED',
});

function normalizeTranscript(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createPronunciationCoachSession(words, topic = '', subTopic = '') {
  const queue = Array.isArray(words) ? words.filter((entry) => entry?.word) : [];
  let currentIndex = 0;
  let attemptsForWord = 0;
  let skippedCount = 0;
  let state = PRONUNCIATION_COACH_STATES.READY;
  let previousState = state;
  let active = false;
  let error = '';

  const currentWord = () => queue[currentIndex] || null;

  const snapshot = () => ({
    state,
    active,
    topic,
    subTopic,
    currentIndex,
    total: queue.length,
    attemptsForWord,
    skippedCount,
    currentWord: currentWord(),
    error,
  });

  const advance = (wasSkipped = false) => {
    if (wasSkipped) skippedCount += 1;
    currentIndex += 1;
    attemptsForWord = 0;
    error = '';
    state = currentIndex >= queue.length
      ? PRONUNCIATION_COACH_STATES.COMPLETED
      : PRONUNCIATION_COACH_STATES.READY;
    active = state !== PRONUNCIATION_COACH_STATES.COMPLETED;
  };

  return {
    start() {
      if (!queue.length) {
        return false;
      }
      currentIndex = 0;
      attemptsForWord = 0;
      skippedCount = 0;
      error = '';
      active = true;
      state = PRONUNCIATION_COACH_STATES.READY;
      return true;
    },
    snapshot,
    setState(nextState) {
      if (!active || !Object.values(PRONUNCIATION_COACH_STATES).includes(nextState)) {
        return false;
      }
      state = nextState;
      if (nextState !== PRONUNCIATION_COACH_STATES.ERROR) {
        error = '';
      }
      return true;
    },
    beginRecording() {
      if (!active || [
        PRONUNCIATION_COACH_STATES.RECORDING,
        PRONUNCIATION_COACH_STATES.ASSESSING,
        PRONUNCIATION_COACH_STATES.PLAYING_WORD,
        PRONUNCIATION_COACH_STATES.ASK_SYLLABLE_PRACTICE,
        PRONUNCIATION_COACH_STATES.PAUSED,
      ].includes(state)) {
        return false;
      }
      error = '';
      state = PRONUNCIATION_COACH_STATES.RECORDING;
      return true;
    },
    assessTranscript(transcript) {
      if (!active || state !== PRONUNCIATION_COACH_STATES.RECORDING) {
        return { accepted: false, correct: false, state };
      }

      state = PRONUNCIATION_COACH_STATES.ASSESSING;
      const expected = normalizeTranscript(currentWord()?.word);
      const actual = normalizeTranscript(transcript);
      if (!actual) {
        state = PRONUNCIATION_COACH_STATES.ERROR;
        error = 'no-speech';
        return { accepted: true, correct: false, reason: error, state };
      }

      if (actual === expected) {
        state = PRONUNCIATION_COACH_STATES.TRANSCRIPT_MATCHED;
        return { accepted: true, correct: false, transcriptMatches: true, state };
      }

      attemptsForWord += 1;
      state = attemptsForWord >= 2
        ? PRONUNCIATION_COACH_STATES.ASK_SYLLABLE_PRACTICE
        : PRONUNCIATION_COACH_STATES.RETRY;
      return { accepted: true, correct: false, state };
    },
    reportError(reason) {
      if (!active) {
        return false;
      }
      error = String(reason || 'unknown');
      state = PRONUNCIATION_COACH_STATES.ERROR;
      return true;
    },
    retry() {
      if (!active || ![
        PRONUNCIATION_COACH_STATES.RETRY,
        PRONUNCIATION_COACH_STATES.TRANSCRIPT_MATCHED,
        PRONUNCIATION_COACH_STATES.ASK_SYLLABLE_PRACTICE,
        PRONUNCIATION_COACH_STATES.ERROR,
      ].includes(state)) {
        return false;
      }
      error = '';
      state = PRONUNCIATION_COACH_STATES.READY;
      return true;
    },
    chooseSyllablePractice() {
      if (!active || state !== PRONUNCIATION_COACH_STATES.ASK_SYLLABLE_PRACTICE) {
        return false;
      }
      state = PRONUNCIATION_COACH_STATES.RETRY;
      return true;
    },
    skip() {
      if (!active) {
        return false;
      }
      advance(true);
      return true;
    },
    pause() {
      if (!active || state === PRONUNCIATION_COACH_STATES.PAUSED) {
        return false;
      }
      previousState = state;
      state = PRONUNCIATION_COACH_STATES.PAUSED;
      return true;
    },
    resume() {
      if (!active || state !== PRONUNCIATION_COACH_STATES.PAUSED) {
        return false;
      }
      state = previousState === PRONUNCIATION_COACH_STATES.RECORDING
        || previousState === PRONUNCIATION_COACH_STATES.PLAYING_WORD
        ? PRONUNCIATION_COACH_STATES.READY
        : previousState;
      return true;
    },
    stop() {
      active = false;
      error = '';
      state = PRONUNCIATION_COACH_STATES.COMPLETED;
      return snapshot();
    },
  };
}
