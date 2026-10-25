/**
 * Pronunciation Visual Guide & Word Progress Highlight
 * 
 * Provides:
 * - Avatar image (replaces mouth/lip SVG animation)
 * - Word progress highlight (karaoke-style) synced with SpeechSynthesis
 */

import { createPronunciationAvatar, AVATAR_STATES } from './pronunciation-avatar.js';

const VISUAL_GUIDE_STATES = Object.freeze({
  IDLE: 'idle',
  SPEAKING: 'speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
});

/**
 * Creates a pronunciation avatar display.
 * Delegates to createPronunciationAvatar for image rendering.
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {function(number)} [opts.onAnimTick] Called each animation tick
 * @returns {{ setState: (state: string) => void, destroy: () => void, getState: () => string }}
 */
function createMouthRenderer(container, opts = {}) {
  return createPronunciationAvatar(container, opts);
}

/**
 * Word Progress Highlight (Karaoke)
 * Splits text into display tokens and manages highlight states during speech.
 */
const HIGHLIGHT_STATES = Object.freeze({
  PENDING: 'pending',     // ⚪ Chưa đọc
  ACTIVE: 'active',       // 🔵 Đang đọc
  COMPLETED: 'completed', // ✅ Đã đọc
});

function splitTextIntoTokens(text, { ipa = false } = {}) {
  if (!text || typeof text !== 'string') return [];

  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = ipa
    ? splitIpaIntoSyllables(trimmed)
    : trimmed.split(/\s+/);
  return parts.map((part, index) => ({
    text: part,
    displayText: part,
    isLast: index === parts.length - 1,
    index,
  }));
}

function splitIpaIntoSyllables(ipa) {
  const transcription = ipa.replace(/^[\/\[]|[\/\]]$/g, '').trim();
  const syllables = transcription.split(/[.·]/u).map((part) => part.trim()).filter(Boolean);
  return syllables.length ? syllables : [transcription];
}

function createWordProgressRenderer(container, opts = {}) {
  let tokens = [];
  let activeIndex = -1;
  let completedIndices = new Set();
  let animationTimer = null;
  let currentRunId = 0;
  let timelineRaf = null;
  let timelineStart = 0;
  let timelineDuration = 0;
  let timelineActiveIndex = -1;
  let timelineProgress = 0;

  function stopAnimation() {
    if (timelineRaf) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(timelineRaf);
      }
      timelineRaf = null;
    }
    timelineStart = 0;
    timelineDuration = 0;
  }

  function setText(text, options) {
    stopAnimation();
    tokens = splitTextIntoTokens(text, options);
    activeIndex = -1;
    timelineActiveIndex = -1;
    timelineProgress = 0;
    completedIndices = new Set();
    render();
  }

  function setActiveIndex(index) {
    if (index >= 0 && index < tokens.length) {
      for (let i = 0; i < index; i++) {
        completedIndices.add(i);
      }
      activeIndex = index;
    } else if (index >= tokens.length) {
      tokens.forEach((_, i) => completedIndices.add(i));
      activeIndex = -1;
    }
    timelineActiveIndex = activeIndex;
    timelineProgress = 0;
    render();
    if (typeof opts.onTokenAdvance === 'function') {
      opts.onTokenAdvance(activeIndex, tokens[activeIndex] || null);
    }
  }

  /**
   * Advance word progress by one token.
   * Called by the avatar's unified animation tick.
   * This replaces the independent startAnimation timer.
   * @returns {boolean} true if more tokens remain, false if done
   */
  function tick() {
    if (tokens.length === 0) return false;
    if (completedIndices.size >= tokens.length) return false;
    if (activeIndex >= tokens.length) return false;

    let nextIdx = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (!completedIndices.has(i)) {
        nextIdx = i;
        break;
      }
    }

    for (let i = 0; i < nextIdx; i++) {
      completedIndices.add(i);
    }
    activeIndex = nextIdx;
    render();
    completedIndices.add(nextIdx);
    if (typeof opts.onTokenAdvance === 'function') {
      opts.onTokenAdvance(activeIndex, tokens[activeIndex] || null);
    }

    for (let i = 0; i < tokens.length; i++) {
      if (!completedIndices.has(i)) return true;
    }
    allCompleted();
    return false;
  }

  function markCompleted(index) {
    if (index >= 0 && index < tokens.length) {
      completedIndices.add(index);
      if (index === activeIndex) {
        activeIndex = index + 1 < tokens.length ? index + 1 : -1;
      }
    }
    render();
  }

  function reset() {
    stopAnimation();
    activeIndex = -1;
    timelineActiveIndex = -1;
    timelineProgress = 0;
    completedIndices = new Set();
    render();
  }

  function allCompleted() {
    stopAnimation();
    tokens.forEach((_, i) => completedIndices.add(i));
    activeIndex = -1;
    timelineActiveIndex = -1;
    timelineProgress = 0;
    render();
  }

  function render() {
    if (!container) return;

    const html = tokens.map((token, index) => {
      let stateClass;
      const effectiveActiveIndex = timelineActiveIndex >= 0 ? timelineActiveIndex : activeIndex;
      if (index < effectiveActiveIndex) {
        stateClass = 'completed';
      } else if (index === effectiveActiveIndex) {
        stateClass = 'active';
      } else {
        stateClass = 'pending';
      }

      const separator = token.isLast ? '' : '<span class="word-separator">·</span>';
      const safeText = token.text.replace(/[&<>]/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
      })[character]);
      return `<span class="word-progress-token ${stateClass}">${safeText}</span>${separator}`;
    }).join('');

    container.innerHTML = html;
  }

  function destroy() {
    stopAnimation();
    tokens = [];
    activeIndex = -1;
    timelineActiveIndex = -1;
    timelineProgress = 0;
    completedIndices = new Set();
    if (container) {
      container.innerHTML = '';
    }
  }

  function startTimeline({ durationMs = 1200 } = {}) {
    if (!tokens.length) return;
    stopAnimation();
    const totalDuration = Math.max(900, Number(durationMs) || 1200);
    timelineDuration = totalDuration;
    timelineStart = performance.now();
    const step = (now) => {
      const elapsed = now - timelineStart;
      const progress = Math.min(1, elapsed / timelineDuration);
      let nextActiveIndex = -1;
      let nextProgress = 0;

      if (tokens.length) {
        const segmentDuration = Math.max(180, timelineDuration / Math.max(tokens.length, 1));
        const currentTokenIndex = Math.min(tokens.length - 1, Math.floor(progress * tokens.length));
        const tokenStart = currentTokenIndex * segmentDuration;
        const tokenEnd = Math.min(timelineDuration, tokenStart + segmentDuration);
        const tokenProgress = tokenEnd <= tokenStart ? 0 : Math.max(0, Math.min(1, (elapsed - tokenStart) / Math.max(1, tokenEnd - tokenStart)));
        nextActiveIndex = currentTokenIndex;
        nextProgress = tokenProgress;
      }

      timelineActiveIndex = nextActiveIndex;
      timelineProgress = nextProgress;
      render();
      if (typeof opts.onTimelineTick === 'function') {
        opts.onTimelineTick({ activeIndex: nextActiveIndex, progress: nextProgress, isSpeaking: true });
      }

      if (progress < 1) {
        timelineRaf = window.requestAnimationFrame(step);
      } else {
        allCompleted();
      }
    };

    timelineRaf = window.requestAnimationFrame(step);
  }

  // startAnimation aliased to tick for backward compatibility
  function startAnimation() {
    // No-op — word progress is now driven by avatar's unified tick
  }

  return {
    setText,
    setActiveIndex,
    startAnimation,
    stopAnimation,
    markCompleted,
    tick,
    reset,
    allCompleted,
    destroy,
    startTimeline,
    getTokenCount: () => tokens.length,
    getActiveIndex: () => timelineActiveIndex >= 0 ? timelineActiveIndex : activeIndex,
    getActiveToken: () => tokens[timelineActiveIndex >= 0 ? timelineActiveIndex : activeIndex] || null,
  };
}

export {
  VISUAL_GUIDE_STATES,
  AVATAR_STATES,
  createMouthRenderer,
  createWordProgressRenderer,
  splitTextIntoTokens,
  splitIpaIntoSyllables,
  HIGHLIGHT_STATES,
};
