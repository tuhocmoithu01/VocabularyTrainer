/**
 * Pronunciation Practice Integration
 *
 * Wires pronunciation-viewer, pronunciation-feedback, pronunciation-history
 * into the existing Speaking Test in app.js.
 *
 * This module is designed to be called from app.js after DOM is ready.
 */

import { createMouthRenderer, createWordProgressRenderer, VISUAL_GUIDE_STATES } from './pronunciation-viewer.js';
import { generateFeedback, calculateScore } from './pronunciation-feedback.js';
import { addAttempt, getAttempts, getWordStats } from './pronunciation-history.js';

let mouthRenderer = null;
let wordProgressRenderer = null;
let isRecording = false;
let currentTranscript = '';

function normalizePronunciationVariants(value) {
  if (!value || typeof value !== 'object') {
    return { uk: null, us: null, components: [], sourceUrl: '', message: '' };
  }
  return {
    uk: value.uk?.ipa ? value.uk : null,
    us: value.us?.ipa ? value.us : null,
    components: Array.isArray(value.components) ? value.components : [],
    sourceUrl: String(value.sourceUrl || ''),
    message: String(value.message || ''),
  };
}

function setPronunciationPlaybackStatus(message) {
  const container = document.getElementById('pronunciation-variants');
  if (!container) {
    return;
  }
  let status = container.querySelector('.pronunciation-playback-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'pronunciation-variant-message pronunciation-playback-status';
    container.appendChild(status);
  }
  status.textContent = message;
}

async function playPronunciationAudio(audioUrl, word, locale) {
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    try {
      await audio.play();
      return;
    } catch (error) {
      console.error(`Failed to play ${locale} pronunciation audio`, error);
    }
  }

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    console.error(`No audio or speech synthesis is available for ${locale} pronunciation.`);
    setPronunciationPlaybackStatus('Không có audio từ điển và trình duyệt không hỗ trợ đọc mẫu.');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = locale;
  utterance.onerror = (error) => {
    console.error(`Failed to synthesize ${locale} pronunciation`, error);
    setPronunciationPlaybackStatus('Trình duyệt không thể phát âm mẫu này.');
  };
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang?.toLowerCase() === locale.toLowerCase());
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function renderPronunciationVariants(text, pronunciations) {
  const container = document.getElementById('pronunciation-variants');
  const variants = normalizePronunciationVariants(pronunciations);
  if (!container) {
    return Boolean(variants.uk || variants.us);
  }

  container.replaceChildren();
  const available = [
    { key: 'uk', label: 'UK', locale: 'en-GB', pronunciation: variants.uk },
    { key: 'us', label: 'US', locale: 'en-US', pronunciation: variants.us },
  ].filter((item) => item.pronunciation);

  if (variants.message) {
    const message = document.createElement('p');
    message.className = 'pronunciation-variant-message';
    message.textContent = variants.message;
    container.appendChild(message);
  }

  available.forEach(({ key, label, locale, pronunciation }) => {
    const item = document.createElement('div');
    item.className = 'pronunciation-variant';
    item.dataset.accent = key;

    const accentLabel = document.createElement('span');
    accentLabel.className = 'pronunciation-variant-label';
    accentLabel.textContent = label;

    const transcription = document.createElement('span');
    transcription.className = 'pronunciation-variant-ipa';
    transcription.textContent = pronunciation.ipa;

    const audioSource = pronunciation.audioSourceUrl ? document.createElement('a') : null;
    if (audioSource) {
      audioSource.className = 'pronunciation-variant-source';
      audioSource.href = pronunciation.audioSourceUrl;
      audioSource.target = '_blank';
      audioSource.rel = 'noopener noreferrer';
      audioSource.textContent = 'audio source';
    }

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'pronunciation-variant-play';
    playButton.textContent = '🔊';
    playButton.setAttribute('aria-label', `Nghe phiên âm ${label}`);
    playButton.addEventListener('click', () => {
      void playPronunciationAudio(pronunciation.audio, text, locale);
    });

    item.append(accentLabel, playButton, transcription);
    if (audioSource) {
      item.appendChild(audioSource);
    }
    container.appendChild(item);
  });

  variants.components.forEach((component) => {
    const componentRow = document.createElement('div');
    componentRow.className = 'pronunciation-component';
    const word = document.createElement('strong');
    word.textContent = component.word;
    componentRow.appendChild(word);

    [
      { label: 'UK', locale: 'en-GB', pronunciation: component.uk },
      { label: 'US', locale: 'en-US', pronunciation: component.us },
    ].forEach(({ label, locale, pronunciation }) => {
      if (!pronunciation) {
        return;
      }
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'pronunciation-variant-play';
      playButton.textContent = '🔊';
      playButton.setAttribute('aria-label', `Nghe ${component.word} (${label})`);
      playButton.addEventListener('click', () => {
        void playPronunciationAudio(pronunciation.audio, component.word, locale);
      });
      const transcription = document.createElement('span');
      transcription.className = 'pronunciation-variant-ipa';
      transcription.textContent = `${label} ${pronunciation.ipa}`;
      componentRow.append(playButton, transcription);
      if (pronunciation.audioSourceUrl) {
        const audioSource = document.createElement('a');
        audioSource.className = 'pronunciation-variant-source';
        audioSource.href = pronunciation.audioSourceUrl;
        audioSource.target = '_blank';
        audioSource.rel = 'noopener noreferrer';
        audioSource.textContent = 'nguồn audio';
        componentRow.appendChild(audioSource);
      }
    });
    [
      { label: 'UK', pronunciation: component.uk },
      { label: 'US', pronunciation: component.us },
    ].forEach(({ label, pronunciation }) => {
      if (pronunciation) {
        return;
      }
      const unavailable = document.createElement('span');
      unavailable.className = 'pronunciation-variant-unavailable';
      const status = component.lookupPending
        ? 'Đang tra…'
        : component.lookupFailed
          ? 'Không tra được'
          : 'Chưa có IPA';
      unavailable.textContent = `${label}: ${status}`;
      componentRow.appendChild(unavailable);
    });
    container.appendChild(componentRow);
  });

  if (variants.sourceUrl) {
    const attribution = document.createElement('a');
    attribution.className = 'pronunciation-source';
    attribution.href = variants.sourceUrl;
    attribution.target = '_blank';
    attribution.rel = 'noopener noreferrer';
    attribution.textContent = 'Nguồn: Wiktionary (CC BY-SA)';
    container.appendChild(attribution);
  }

  if (!available.length && !variants.components.length && !variants.message) {
    container.classList.add('hidden');
    return false;
  }

  container.classList.remove('hidden');
  return Boolean(available.length);
}

// DOM references (set during init)
let dom = {};

/**
 * Initialize pronunciation UI components.
 * Call once after DOM is ready.
 */
export function initPronunciationUI(elements = {}) {
  dom = elements;

  // Create visual guide renderers
  const mouthContainer = document.getElementById('mouth-animation-container');
  const wordProgressContainer = document.getElementById('word-progress-display');

  if (wordProgressContainer) {
    wordProgressRenderer = createWordProgressRenderer(wordProgressContainer, {
      onTimelineTick: (state) => {
        if (mouthRenderer && typeof mouthRenderer.setTimelineState === 'function') {
          mouthRenderer.setTimelineState(state);
        }
      },
    });
  }

  if (mouthContainer) {
    // Wire word progress tick into the avatar's unified animation loop
    mouthRenderer = createMouthRenderer(mouthContainer, {
      onAnimTick: () => {
        if (wordProgressRenderer && typeof wordProgressRenderer.tick === 'function') {
          wordProgressRenderer.tick();
          const activeIndex = wordProgressRenderer.getActiveIndex();
          if (mouthRenderer && typeof mouthRenderer.setFrameByIndex === 'function') {
            mouthRenderer.setFrameByIndex(activeIndex);
          }
          return activeIndex;
        }
        return -1;
      },
    });
  }

  // Setup practice pronunciation button delegation
  setupPracticeButtons();

  // Setup slow listen button
  const slowBtn = document.getElementById('test-listen-slow');
  if (slowBtn) {
    slowBtn.addEventListener('click', () => {
      if (typeof dom.speakPromptSlow === 'function') {
        dom.speakPromptSlow();
      }
    });
  }

  // Setup stop record button
  const stopBtn = document.getElementById('test-stop-record');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (typeof dom.stopRecording === 'function') {
        dom.stopRecording();
      }
    });
  }
}

/**
 * Show pronunciation guide (visual + word progress)
 */
export function showPronunciationGuide(text, pronunciations = {}) {
  const guide = document.getElementById('pronunciation-guide');
  if (guide) {
    guide.classList.remove('hidden');
  }

  const hasVariants = renderPronunciationVariants(text, pronunciations);
  if (wordProgressRenderer) {
    wordProgressRenderer.setText(hasVariants ? '' : text);
  }

  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.IDLE);
    mouthRenderer.setFrameByIndex(-1);
  }
  if (wordProgressRenderer && typeof wordProgressRenderer.stopAnimation === 'function') {
    wordProgressRenderer.stopAnimation();
  }
}

/**
 * Hide pronunciation guide
 */
export function hidePronunciationGuide() {
  const guide = document.getElementById('pronunciation-guide');
  if (guide) {
    guide.classList.add('hidden');
  }
}

/**
 * Called when SpeechSynthesis starts speaking
 */
export function onSpeakingStart(text, options = {}) {
  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.SPEAKING);
  }
  if (wordProgressRenderer && text) {
    wordProgressRenderer.setText(text);
    const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : 1200;
    wordProgressRenderer.startTimeline({ durationMs });
  }

  // Update button visibility for speaking mode
  const slowBtn = document.getElementById('test-listen-slow');
  const recordBtn = document.getElementById('test-record');
  const stopBtn = document.getElementById('test-stop-record');
  if (slowBtn) slowBtn.classList.remove('hidden');
  if (recordBtn) recordBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
}

/**
 * Called when SpeechSynthesis ends
 */
export function onSpeakingEnd() {
  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.IDLE);
  }
  // Don't force allCompleted() — let timed animation run to completion naturally.
  // allCompleted() would stop the animation mid-way and mark all tokens done at once,
  // which breaks the sequential highlight effect the user wants to see.

  const stopBtn = document.getElementById('test-stop-record');
  if (stopBtn) stopBtn.classList.add('hidden');
}

/**
 * Called when recording starts
 */
export function onRecordingStart() {
  isRecording = true;
  currentTranscript = '';

  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.LISTENING);
  }

  const recordBtn = document.getElementById('test-record');
  const stopBtn = document.getElementById('test-stop-record');
  const listenBtn = document.getElementById('test-listen');
  const slowBtn = document.getElementById('test-listen-slow');

  if (recordBtn) recordBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');
  if (listenBtn) listenBtn.classList.add('hidden');
  if (slowBtn) slowBtn.classList.add('hidden');

  // Hide previous result
  const resultCard = document.getElementById('pronunciation-result');
  if (resultCard) resultCard.classList.add('hidden');
}

/**
 * Called when recording stops
 */
export function onRecordingStop({ processing = true } = {}) {
  isRecording = false;

  if (mouthRenderer) {
    mouthRenderer.setState(processing ? VISUAL_GUIDE_STATES.PROCESSING : VISUAL_GUIDE_STATES.IDLE);
  }

  const recordBtn = document.getElementById('test-record');
  const stopBtn = document.getElementById('test-stop-record');
  const listenBtn = document.getElementById('test-listen');
  const slowBtn = document.getElementById('test-listen-slow');

  if (recordBtn) recordBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
  if (listenBtn) listenBtn.classList.remove('hidden');
  if (slowBtn) slowBtn.classList.remove('hidden');
}

/**
 * Update word progress highlight at a specific token index
 */
export function updateWordProgress(index) {
  if (wordProgressRenderer) {
    wordProgressRenderer.setActiveIndex(index);
  }
}

/**
 * Mark a word progress token as completed
 */
export function markWordCompleted(index) {
  if (wordProgressRenderer) {
    wordProgressRenderer.markCompleted(index);
  }
}

/**
 * Reset all pronunciation UI for a new question
 */
export function resetPronunciationForQuestion(text, pronunciations = {}) {
  currentTranscript = '';
  isRecording = false;

  const guide = document.getElementById('pronunciation-guide');
  const resultCard = document.getElementById('pronunciation-result');
  const testAnswerWrapper = document.getElementById('test-answer-wrapper');
  const testSubmit = document.getElementById('test-submit');
  const testNextBtn = document.getElementById('test-next');
  const testRetryBtn = document.getElementById('test-retry');
  const testSkipBtn = document.getElementById('test-skip');
  const testRecordBtn = document.getElementById('test-record');
  const testListenBtn = document.getElementById('test-listen');
  const slowBtn = document.getElementById('test-listen-slow');
  const stopBtn = document.getElementById('test-stop-record');

  // Show guide for speaking mode
  if (guide) guide.classList.remove('hidden');
  if (resultCard) resultCard.classList.add('hidden');

  // Hide typing elements for speaking mode
  if (testAnswerWrapper) testAnswerWrapper.classList.add('hidden');
  if (testSubmit) testSubmit.classList.add('hidden');
  if (testNextBtn) testNextBtn.classList.add('hidden');
  if (testRetryBtn) testRetryBtn.classList.add('hidden');
  if (testSkipBtn) testSkipBtn.classList.add('hidden');

  // Show speaking buttons
  if (testRecordBtn) testRecordBtn.classList.remove('hidden');
  if (testListenBtn) testListenBtn.classList.remove('hidden');
  if (slowBtn) slowBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');

  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.IDLE);
  }

  const hasVariants = renderPronunciationVariants(text, pronunciations);
  if (wordProgressRenderer) {
    wordProgressRenderer.setText(hasVariants ? '' : text);
  }
}

/**
 * Show pronunciation result with score, feedback, and history
 */
export function showPronunciationResult({ expected, actual, confidence = 0.7, word = '', mode = 'vocabulary' }) {
  const resultCard = document.getElementById('pronunciation-result');
  if (!resultCard) return;

  resultCard.classList.remove('hidden');

  // Calculate scores
  const feedback = generateFeedback(expected, actual, confidence * 100);
  const overallScore = calculateScore(expected, actual, confidence);
  const accuracyScore = feedback.isCorrect ? Math.round(confidence * 100) : Math.max(30, overallScore - 20);
  const fluencyScore = feedback.isCorrect ? Math.round(confidence * 85) : Math.max(20, overallScore - 30);
  const confScore = Math.round(confidence * 100);

  // Update score display
  const scoreValue = document.getElementById('pron-score-value');
  const scoreAccuracy = document.getElementById('pron-score-accuracy');
  const scoreFluency = document.getElementById('pron-score-fluency');
  const scoreConfidence = document.getElementById('pron-score-confidence');

  if (scoreValue) scoreValue.textContent = overallScore;
  if (scoreAccuracy) scoreAccuracy.textContent = accuracyScore;
  if (scoreFluency) scoreFluency.textContent = fluencyScore;
  if (scoreConfidence) scoreConfidence.textContent = confScore;

  // Update transcript
  const transcriptEl = document.getElementById('pron-transcript');
  if (transcriptEl) {
    transcriptEl.textContent = actual || '—';
  }

  // Update feedback messages
  const feedbackContainer = document.getElementById('pron-feedback-messages');
  if (feedbackContainer) {
    feedbackContainer.innerHTML = (feedback.messages || []).map(msg => `
      <div class="pron-feedback-msg ${msg.type}">
        <div class="msg-title">${msg.title}</div>
        <div class="msg-body">${msg.message}</div>
      </div>
    `).join('');
  }

  // Save to history
  if (word) {
    addAttempt({
      word,
      expected,
      actual,
      score: overallScore,
      scores: { accuracy: accuracyScore, fluency: fluencyScore, confidence: confScore },
      mode,
      feedback,
    });

    // Update history section
    updateHistoryDisplay(word);
  }

  // Show next/retry/skip buttons
  const testNextBtn = document.getElementById('test-next');
  const testRetryBtn = document.getElementById('test-retry');
  const testSkipBtn = document.getElementById('test-skip');
  const testRecordBtn = document.getElementById('test-record');
  const stopBtn = document.getElementById('test-stop-record');

  if (testNextBtn) testNextBtn.classList.remove('hidden');
  if (testRetryBtn) testRetryBtn.classList.remove('hidden');
  if (testSkipBtn) testSkipBtn.classList.remove('hidden');
  if (testRecordBtn) testRecordBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');

  if (mouthRenderer) {
    mouthRenderer.setState(VISUAL_GUIDE_STATES.IDLE);
  }
}

/**
 * Display pronunciation history for a word
 */
export function updateHistoryDisplay(word) {
  const historySection = document.getElementById('pron-history-section');
  const historyList = document.getElementById('pron-history-list');
  if (!historySection || !historyList) return;

  const stats = getWordStats(word);
  if (stats.totalAttempts === 0) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');

  const latestAttempts = stats.attempts.slice(-10).reverse();
  historyList.innerHTML = latestAttempts.map((attempt, index) => {
    const attemptNum = stats.totalAttempts - index;
    const scoreClass = attempt.score >= 80 ? 'high' : attempt.score >= 50 ? 'medium' : 'low';
    return `
      <div class="pron-history-item">
        <span class="pron-history-attempt">Attempt ${attemptNum}</span>
        <span class="pron-history-score ${scoreClass}">${attempt.score}</span>
        <div class="pron-history-bar">
          <span class="pron-history-bar-fill ${scoreClass}" style="width:${attempt.score}%"></span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Hide pronunciation result
 */
export function hidePronunciationResult() {
  const resultCard = document.getElementById('pronunciation-result');
  if (resultCard) resultCard.classList.add('hidden');
}

/**
 * Clean up pronunciation UI for dictation mode
 */
export function resetForDictationMode() {
  hidePronunciationGuide();
  hidePronunciationResult();

  const testAnswerWrapper = document.getElementById('test-answer-wrapper');
  const testSubmit = document.getElementById('test-submit');
  const testRecordBtn = document.getElementById('test-record');
  const testListenBtn = document.getElementById('test-listen');
  const slowBtn = document.getElementById('test-listen-slow');
  const stopBtn = document.getElementById('test-stop-record');
  const testRetryBtn = document.getElementById('test-retry');
  const testSkipBtn = document.getElementById('test-skip');

  if (testAnswerWrapper) testAnswerWrapper.classList.remove('hidden');
  if (testSubmit) testSubmit.classList.remove('hidden');
  if (testRecordBtn) testRecordBtn.classList.add('hidden');
  if (testListenBtn) testListenBtn.classList.remove('hidden');
  if (slowBtn) slowBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
  if (testRetryBtn) testRetryBtn.classList.add('hidden');
  if (testSkipBtn) testSkipBtn.classList.add('hidden');

  if (mouthRenderer) mouthRenderer.setState(VISUAL_GUIDE_STATES.IDLE);
  if (wordProgressRenderer) wordProgressRenderer.reset();
}

/**
 * Setup event delegation for Practice Pronunciation buttons in word cards
 */
function setupPracticeButtons() {
  const wordListEl = document.getElementById('word-list');
  if (!wordListEl) return;

  wordListEl.addEventListener('click', (event) => {
    const button = event.target.closest('.practice-pronunciation-btn');
    if (!button) return;

    const word = button.getAttribute('data-word');
    if (!word) return;

    // Navigate to test page and start speaking test with this specific word
    if (typeof dom.startPronunciationForWord === 'function') {
      dom.startPronunciationForWord(word);
    }
  });
}

/**
 * Get current transcript from recognition
 */
export function getCurrentTranscript() {
  return currentTranscript;
}

/**
 * Set current transcript
 */
export function setCurrentTranscript(transcript) {
  currentTranscript = transcript || '';
}

/**
 * Check if currently recording
 */
export function isCurrentlyRecording() {
  return isRecording;
}

export { mouthRenderer, wordProgressRenderer };
