import {
  addVocabularyEntry,
  ensurePreferencesLoaded,
  ensureVocabularyLoaded,
  findDuplicateVocabularyEntry,
  findVocabularyEntry,
  filterVocabularyByTopic,
  getUniqueSubTopics,
  getUniqueTopics,
  initializeOfflineCache,
  loadSubTopics,
  loadTopics,
  loadVocabulary,
  migrateLocalStorageToFirestore,
  removeVocabularyEntry,
  saveSubTopics,
  saveTopics,
  renameTopic,
  renameSubTopic,
  deleteTopic,
  deleteSubTopic,
  updateVocabularyEntry,
  updateVocabularyEntryByWord,
  DEFAULT_TOPIC,
  DEFAULT_SUBTOPIC,
  DEFAULT_TYPE,
  normalizeWordKey,
} from './storage.js';
import { getCurrentLanguage, getLanguageLabel, getLanguageOptions, setCurrentLanguage } from './language-manager.js';
import { buildMeaningMap, getCurrentMeaningLanguage, getDisplayConfig, getMeaningDisplayValue, getMeaningLanguageOptions, getMeaningValue, setCurrentMeaningLanguage } from './language-config.js';
import { fetchWordIpa, fetchWordSupportData, enrichSupportEntriesWithMeanings } from './dictionary.js';
import {
  buildLearnQueue,
  formatLearnLabel,
  getSpellingSequence,
  isLearnAnswerCorrect,
  normalizeLearnReadingMode,
  toggleWordVisibility,
} from './learn.js';
import { buildTestQueue, filterWordSuggestions } from './test.js';
import { playAudioFeedback } from './sound.js';
import { loadSoundEnabled, saveSoundEnabled } from './storage.js';
import { createAutoNextController } from './auto-next.js';
import {
  getSpeechRecognitionConstructor,
  getSpeechRecognitionErrorMessage,
  getSpeechRecognitionUnsupportedMessage,
  isSpeechRecognitionSupported,
  requestMicrophoneAccess,
} from './speech-recognition.js';
import { createSpeechUtterance, getSpeechLanguageCode, getSlowPlaybackRate } from './speech.js';
import { createSpeechStateMachine, SPEECH_STATES } from './speech-state.js';
import { createSpeakingTestFlowState, getAdjacentQuestionIndex } from './speaking-test-flow.js';
import {
  getDictationInstruction,
  getDictationPromptLabel,
  getDictationPromptText,
  getSpeakingInstruction,
  getSpeakingPromptLabel,
  getSpeakingPromptText,
  normalizeDictationMode,
  normalizeSpeakingMode,
} from './speaking-mode.js';
import {
  initPronunciationUI,
  onRecordingStart,
  onRecordingStop,
  onSpeakingEnd,
  onSpeakingStart,
  resetForDictationMode,
  resetPronunciationForQuestion,
  showPronunciationGuide,
  showPronunciationResult,
} from './pronunciation-integration.js';
import {
  runStep,
  generateAll,
  mapResultsToUIState,
  aggregateFromMeaningsAnalysis,
} from './ai-expansion.js';

const ADD_TOPIC_VALUE = '__add_topic__';
const ADD_SUBTOPIC_VALUE = '__add_subtopic__';
const SUBTOPIC_NOT_SELECTED_VALUE = '__not_selected__';
const ALL_FILTER_VALUE = '';

const pageButtons = document.querySelectorAll('.menu-button');
const pages = document.querySelectorAll('.page');
const addForm = document.getElementById('add-form');
const inputTopic = document.getElementById('input-topic');
const inputSubtopic = document.getElementById('input-subtopic');
const inputType = document.getElementById('input-type');
const inputPartOfSpeech = document.getElementById('input-part-of-speech');
const inputWord = document.getElementById('input-word');
const inputMeaning = document.getElementById('input-meaning');
const inputVietnameseMeaning = document.getElementById('input-vietnamese-meaning');
const inputIpa = document.getElementById('input-ipa');
const inputFixedPhrases = document.getElementById('input-fixed-phrases');
const inputExample = document.getElementById('input-example');
const aiExpansionEditor = document.getElementById('ai-expansion-editor');
const aiGenerateBtn = document.getElementById('btn-ai-generate');
const addFeedback = document.getElementById('add-feedback');
const addSubmitButton = document.getElementById('add-submit');
const addCancelButton = document.getElementById('add-cancel');
const wordSuggestions = document.getElementById('word-suggestions');
const duplicateStatus = document.getElementById('duplicate-status');
const duplicateCard = document.getElementById('duplicate-card');
const sortBySelect = document.getElementById('sort-by');
const filterTopicSelect = document.getElementById('filter-topic');
const filterSubtopicSelect = document.getElementById('filter-subtopic');
const filterTypeSelect = document.getElementById('filter-type');
const filterStatusSelect = document.getElementById('filter-status');
const wordList = document.getElementById('word-list');
const learnTopicFilter = document.getElementById('learn-topic-filter');
const learnSubtopicFilter = document.getElementById('learn-subtopic-filter');
const learnSelection = document.getElementById('learn-selection');
const learnCount = document.getElementById('learn-count');
const learnReadingMode = document.getElementById('learn-reading-mode');
const learnStart = document.getElementById('learn-start');
const learnFeedback = document.getElementById('learn-feedback');
const learnSession = document.getElementById('learn-session');
const displayWord = document.getElementById('display-word');
const displayMeaning = document.getElementById('display-meaning');
const displayExample = document.getElementById('display-example');
const learnAnswer = document.getElementById('learn-answer');
const learnCheck = document.getElementById('learn-check');
const learnToggle = document.getElementById('learn-toggle');
const learnReplay = document.getElementById('learn-replay');
const learnKnown = document.getElementById('learn-known');
const learnMessage = document.getElementById('learn-message');
const learnProgress = document.getElementById('learn-progress');
const sessionCounter = document.getElementById('session-counter');
const testTopicFilter = document.getElementById('test-topic-filter');
const testSubtopicFilter = document.getElementById('test-subtopic-filter');
const testStart = document.getElementById('test-start');
const testFeedback = document.getElementById('test-feedback');
const testSession = document.getElementById('test-session');
const testMeaning = document.getElementById('test-meaning');
const testExample = document.getElementById('test-example');
const testAnswer = document.getElementById('test-answer');
const testSubmit = document.getElementById('test-submit');
const testPrevious = document.getElementById('test-previous');
const testNext = document.getElementById('test-next');
const testMessage = document.getElementById('test-message');
const testProgress = document.getElementById('test-progress');
const testCounter = document.getElementById('test-counter');
const testProgressDetail = document.getElementById('test-progress-detail');
const testSummary = document.getElementById('test-summary');
const summaryScore = document.getElementById('summary-score');
const summaryBreakdown = document.getElementById('summary-breakdown');
const testRestart = document.getElementById('test-restart');
const testModeSpeaking = document.getElementById('test-mode-speaking');
const testModeDictation = document.getElementById('test-mode-dictation');
const testModeHint = document.getElementById('test-mode-hint');
const testModeLabel = document.getElementById('test-mode-label');
const testStageLabel = document.getElementById('test-stage-label');
const testInputLabel = document.getElementById('test-input-label');
const testListen = document.getElementById('test-listen');
const testRecord = document.getElementById('test-record');
const testRetry = document.getElementById('test-retry');
const testSkip = document.getElementById('test-skip');
const speakingModeWrapper = document.getElementById('speaking-mode-wrapper');
const speakingModeSelect = document.getElementById('speaking-mode-select');
const dictationModeWrapper = document.getElementById('dictation-mode-wrapper');
const dictationModeSelect = document.getElementById('dictation-mode-select');
const soundToggle = document.getElementById('sound-toggle');
const languageSelect = document.getElementById('language-select');
const languageLabel = document.getElementById('language-label');
const meaningLanguageSelect = document.getElementById('meaning-language-select');
const inputModeManual = document.getElementById('input-mode-manual');
const inputModeImage = document.getElementById('input-mode-image');
const imageImportPanel = document.getElementById('image-import-panel');
const imageImportInput = document.getElementById('image-import-input');
const imageImportPreview = document.getElementById('image-import-preview');
const imageImportPreviewImg = document.getElementById('image-import-preview-img');
const imageImportStatus = document.getElementById('image-import-status');
const imageImportChange = document.getElementById('image-import-change');
const imageImportRerun = document.getElementById('image-import-rerun');
const imageImportClear = document.getElementById('image-import-clear');
let currentImageImportFile = null;

// ===== SOUND SETTINGS =====
const SOUND_ENABLED_KEY = 'soundEnabled';
const SOUND_ENABLED_DEFAULT = true;
const SOUND_VOLUME = 0.6;
const CORRECT_SOUND_PATH = 'sounds/correct.mp3';
const WRONG_SOUND_PATH = 'sounds/wrong.mp3';
const AUTO_NEXT_DELAY_SECONDS = 3;
const AUTO_NEXT_DELAY = 3000;
const MICROPHONE_PERMISSION_TIMEOUT = 15000;
const SPEECH_RECOGNITION_TIMEOUT = 15000;

const correctAudio = new Audio(CORRECT_SOUND_PATH);
const wrongAudio = new Audio(WRONG_SOUND_PATH);

let soundEnabled = SOUND_ENABLED_DEFAULT;

let vocabulary = [];
let learnQueue = [];
let currentLearnIndex = 0;
let learnRepetitionsPerWord = 1;
let isLearnActionPending = false;
let isHiddenWord = false;
let selectedLearnReadingMode = 'normal';
let learnSpellingTimer = null;
let learnSpellingStepTimer = null;
let learnSpellingRunId = 0;
let testQueue = [];
let currentTestIndex = 0;
let testScore = 0;
let testWrong = 0;
let dictationWrongAttempts = 0;
let selectedTestMode = '';
let selectedSpeakingMode = 'vocabulary';
let selectedDictationMode = 'word';
let dictationStage = 'word';
let currentPlaybackRate = 1;
let testRecognition = null;
let recordingWatchdog = null;
let recordingSessionToken = 0;
let sessionActive = false;
let autoNextTimer = null;
let speakingAutoNextTimer = null;
let isTestTransitioning = false;
const autoNextController = createAutoNextController();
const speechStateMachine = createSpeechStateMachine();
const speakingTestFlow = createSpeakingTestFlowState();
let pendingRecordingAfterPlayback = false;
let activeSpeechPlaybackToken = 0;
let activeSpeechSessionToken = 0;
let editingWord = null;
let wordSuggestionItems = [];
let activeSuggestionIndex = -1;
let duplicateHighlightTimer = null;
let currentSupportSynonyms = [];
let currentSupportAntonyms = [];
let currentSupportWordFamily = [];
let currentSupportFixedPhrases = [];
let currentSupportCollocations = [];
let currentSupportSentencePatterns = [];
let currentSupportCommonExpressions = [];
let currentSupportCommonMistakes = [];
let currentMeaningsAnalysis = [];
let activeSupportEditor = { section: '', index: -1 };

function logSpeechEvent(event, detail = {}) {
  const entry = { event, state: speechStateMachine.getState(), detail };
  if (typeof window !== 'undefined') {
    window.__speechDebugLog = window.__speechDebugLog || [];
    window.__speechDebugLog.push(entry);
  }
  console.info('[speech]', entry);
}

function setPlaybackRate(rate) {
  const parsedRate = Number(rate);
  if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
    return;
  }

  currentPlaybackRate = parsedRate;
  const speedSelect = document.getElementById('pronunciation-speed-select');
  if (speedSelect) {
    speedSelect.value = String(currentPlaybackRate);
  }
}

function updateSpeechButtonState() {
  if (!testListen || !testRecord) {
    return;
  }

  const isSpeakingMode = selectedTestMode === 'speaking';
  const isDictationMode = selectedTestMode === 'dictation';
  const isBusy = speechStateMachine.getState() !== SPEECH_STATES.IDLE;
  const isSupported = isSpeechRecognitionSupported();
  const shouldHideRetryOptions = !testRetry || !testSkip || !isSpeakingMode;

  testListen.disabled = isBusy || (!isSpeakingMode && !isDictationMode);
  testRecord.disabled = isBusy || !isSpeakingMode || !isSupported;
  if (shouldHideRetryOptions) {
    testRetry?.classList.add('hidden');
    testSkip?.classList.add('hidden');
  }
}

function cleanupSpeechSession({ preservePending = false } = {}) {
  if (recordingWatchdog !== null) {
    window.clearTimeout(recordingWatchdog);
    recordingWatchdog = null;
  }
  recordingSessionToken += 1;

  // Cancel speech synthesis
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  pendingRecordingAfterPlayback = preservePending;
  activeSpeechPlaybackToken += 1;

  // Properly cleanup and destroy voice recognition
  stopVoiceRecognition();

  const activeRecognition = speechStateMachine.getActiveRecognition();
  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch (error) {
      console.warn('Failed to abort recognition during cleanup', error);
    }
  }

  speechStateMachine.clearActiveRecognition();
  speechStateMachine.reset();
  updateSpeechButtonState();
  logSpeechEvent('cleanup-session');
}

function updateSoundToggleLabel() {
  if (!soundToggle) {
    return;
  }
  soundToggle.textContent = `🔊 Sound: ${soundEnabled ? 'ON' : 'OFF'}`;
}

async function loadSoundSetting() {
  try {
    soundEnabled = await loadSoundEnabled(SOUND_ENABLED_DEFAULT);
  } catch (error) {
    soundEnabled = SOUND_ENABLED_DEFAULT;
  }
  updateSoundToggleLabel();
}

function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  void saveSoundEnabled(soundEnabled);
  updateSoundToggleLabel();
}

function initializeAudio() {
  [correctAudio, wrongAudio].forEach((audio) => {
    audio.preload = 'auto';
    audio.volume = SOUND_VOLUME;
    audio.loop = false;
  });
}

async function playCorrectSound() {
  if (!soundEnabled) {
    return false;
  }
  return playAudioFeedback(correctAudio, soundEnabled, console.error);
}

async function playWrongSound() {
  if (!soundEnabled) {
    return false;
  }
  return playAudioFeedback(wrongAudio, soundEnabled, console.error);
}

function showPage(pageName) {
  window.__vocabularyTrainerPage = pageName;
  pages.forEach((page) => page.classList.toggle('active', page.id === `page-${pageName}`));
  pageButtons.forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
}

function clearAddFormInputFields() {
  if (inputWord) inputWord.value = '';
  if (inputPartOfSpeech) inputPartOfSpeech.value = '';
  if (inputMeaning) inputMeaning.value = '';
  if (inputVietnameseMeaning) inputVietnameseMeaning.value = '';
  if (inputIpa) inputIpa.value = '';
  if (inputFixedPhrases) inputFixedPhrases.value = '';
  if (inputExample) inputExample.value = '';
  if (imageImportInput) imageImportInput.value = '';
  if (imageImportPreviewImg) imageImportPreviewImg.src = '';
  if (imageImportPreview) imageImportPreview.classList.add('hidden');
  if (imageImportStatus) imageImportStatus.textContent = '';
  editingWord = null;
  addFeedback.textContent = '';
  hideWordSuggestions();
  updateDuplicateStatus();
  currentMeaningsAnalysis = [];
  currentSupportSynonyms = [];
  currentSupportAntonyms = [];
  currentSupportWordFamily = [];
  currentSupportFixedPhrases = [];
  currentSupportCollocations = [];
  currentSupportSentencePatterns = [];
  currentSupportCommonExpressions = [];
  currentSupportCommonMistakes = [];
  activeSupportEditor = { section: '', index: -1 };
  renderSupportEditorSections();
}

function resetAddForm() {
  // Clear only input fields, preserve Topic/SubTopic/Type selections
  clearAddFormInputFields();
  if (inputModeManual) inputModeManual.checked = true;
  if (imageImportPanel) imageImportPanel.classList.add('hidden');
  addSubmitButton.textContent = 'Lưu từ';
  addSubmitButton.disabled = false;
  addCancelButton.classList.add('hidden');
}

function buildSelectOptions(items, includeAll = false, includeAdd = false) {
  const options = [];
  if (includeAll) {
    options.push({ value: ALL_FILTER_VALUE, label: 'All' });
  }

  items.forEach((item) => {
    options.push({ value: item, label: item });
  });

  if (includeAdd) {
    options.push({ value: ADD_TOPIC_VALUE, label: '+ Add Topic' });
  }

  return options;
}

function populateSelect(selectElement, options, selectedValue) {
  selectElement.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`) // no escaping needed for trusted labels
    .join('');

  if (selectedValue && options.some((option) => option.value === selectedValue)) {
    selectElement.value = selectedValue;
  }
}

function getWordsFromFilters(topic, subTopic) {
  if (!topic && !subTopic) {
    return loadVocabulary();
  }

  return filterVocabularyByTopic(loadVocabulary(), topic || undefined, subTopic || undefined);
}

export function sortVocabularyWords(words, sortBy = 'alphabet') {
  const normalizedWords = [...(words || [])];
  switch (sortBy) {
    case 'reverse-alphabet':
      return normalizedWords.sort((first, second) => second.word.localeCompare(first.word, undefined, { sensitivity: 'base' }));
    case 'most-correct':
      return normalizedWords.sort((first, second) => (second.correct || 0) - (first.correct || 0));
    case 'most-wrong':
      return normalizedWords.sort((first, second) => (second.wrong || 0) - (first.wrong || 0));
    case 'most-practiced': {
      const total = (entry) => (entry.correct || 0) + (entry.wrong || 0);
      return normalizedWords.sort((first, second) => total(second) - total(first));
    }
    case 'least-practiced': {
      const total = (entry) => (entry.correct || 0) + (entry.wrong || 0);
      return normalizedWords.sort((first, second) => total(first) - total(second));
    }
    case 'learned-first':
      return normalizedWords.sort((first, second) => {
        if (first.learned !== second.learned) {
          return first.learned ? -1 : 1;
        }
        return first.word.localeCompare(second.word, undefined, { sensitivity: 'base' });
      });
    case 'unlearned-first':
      return normalizedWords.sort((first, second) => {
        if (first.learned !== second.learned) {
          return first.learned ? 1 : -1;
        }
        return first.word.localeCompare(second.word, undefined, { sensitivity: 'base' });
      });
    default:
      return normalizedWords.sort((first, second) => first.word.localeCompare(second.word, undefined, { sensitivity: 'base' }));
  }
}

function getStoredTopics() {
  const topics = loadTopics();
  return topics.length ? topics : [DEFAULT_TOPIC];
}

function getStoredSubTopics(topic) {
  const subTopics = loadSubTopics(topic);
  return subTopics.length ? subTopics : [DEFAULT_SUBTOPIC];
}

async function addTopicToStorage(topic) {
  const topics = getStoredTopics();
  const normalizedTopic = topic.trim();
  const exists = topics.some((item) => item.toLowerCase() === normalizedTopic.toLowerCase());
  if (exists) {
    throw new Error('Topic đã tồn tại.');
  }
  await saveTopics([...topics, normalizedTopic]);
}

async function addSubTopicToStorage(topic, subTopic) {
  const normalizedTopic = topic.trim();
  const normalizedSubTopic = subTopic.trim();
  const subTopics = getStoredSubTopics(normalizedTopic);
  const exists = subTopics.some((item) => item.toLowerCase() === normalizedSubTopic.toLowerCase());
  if (exists) {
    throw new Error('Sub Topic đã tồn tại.');
  }
  await saveSubTopics([...subTopics, normalizedSubTopic], normalizedTopic);
}

async function promptForNewTopic() {
  const topicName = window.prompt('Nhập tên Topic mới:');
  if (!topicName || !topicName.trim()) {
    return null;
  }

  const normalizedTopic = topicName.trim();
  try {
    await addTopicToStorage(normalizedTopic);
    addFeedback.textContent = '';
    return normalizedTopic;
  } catch (error) {
    addFeedback.textContent = error.message;
    return null;
  }
}

async function promptForNewSubTopic(topic) {
  const subTopicName = window.prompt('Nhập tên Sub Topic mới:');
  if (!subTopicName || !subTopicName.trim()) {
    return null;
  }

  const normalizedSubTopic = subTopicName.trim();
  try {
    await addSubTopicToStorage(topic, normalizedSubTopic);
    addFeedback.textContent = '';
    return normalizedSubTopic;
  } catch (error) {
    addFeedback.textContent = error.message;
    return null;
  }
}

function getActiveTopicValue() {
  return inputTopic.value === ADD_TOPIC_VALUE ? (inputTopic.dataset.previousValue || DEFAULT_TOPIC) : inputTopic.value;
}

function getActiveSubTopicValue() {
  return inputSubtopic.value === ADD_SUBTOPIC_VALUE ? (inputSubtopic.dataset.previousValue || DEFAULT_SUBTOPIC) : inputSubtopic.value;
}

function promptForRenameTopic(topic) {
  const currentTopic = topic || getActiveTopicValue();
  const renamedTopic = window.prompt('Nhập tên Topic mới:', currentTopic);
  if (!renamedTopic || !renamedTopic.trim() || renamedTopic.trim() === currentTopic.trim()) {
    return null;
  }
  return renamedTopic.trim();
}

function promptForRenameSubTopic(topic, subTopic) {
  const topicName = topic || getActiveTopicValue();
  const currentSubTopic = subTopic || getActiveSubTopicValue();
  const renamedSubTopic = window.prompt('Nhập tên Sub Topic mới:', currentSubTopic);
  if (!renamedSubTopic || !renamedSubTopic.trim() || renamedSubTopic.trim() === currentSubTopic.trim()) {
    return null;
  }
  return renamedSubTopic.trim();
}

function refreshAddFormTopicList(selectedTopic = DEFAULT_TOPIC) {
  const topics = getStoredTopics();
  const topicOptions = buildSelectOptions(topics, false, true);
  populateSelect(inputTopic, topicOptions, selectedTopic);

  const topicValue = inputTopic.value === ADD_TOPIC_VALUE ? selectedTopic : inputTopic.value;
  refreshAddFormSubtopicList(topicValue);
}

function refreshAddFormSubtopicList(topic, selectedSubtopic = DEFAULT_SUBTOPIC) {
  const subTopics = getStoredSubTopics(topic);
  const subtopicOptions = subTopics
    .map((sub) => ({ value: sub, label: sub }))
    .concat([{ value: ADD_SUBTOPIC_VALUE, label: '+ Add Sub Topic' }]);
  populateSelect(inputSubtopic, subtopicOptions, selectedSubtopic);
}

function loadAddFormSubtopicListNotSelected(topic) {
  const subTopics = getStoredSubTopics(topic);
  const subtopicOptions = [
    { value: SUBTOPIC_NOT_SELECTED_VALUE, label: 'Vui lòng chọn Sub Topic' }
  ].concat(
    subTopics.map((sub) => ({ value: sub, label: sub }))
  ).concat([{ value: ADD_SUBTOPIC_VALUE, label: '+ Add Sub Topic' }]);
  populateSelect(inputSubtopic, subtopicOptions, SUBTOPIC_NOT_SELECTED_VALUE);
}

function refreshFilterControls() {
  const topics = getStoredTopics();
  const topicOptions = buildSelectOptions(topics, true, false);
  populateSelect(learnTopicFilter, topicOptions, ALL_FILTER_VALUE);
  populateSelect(testTopicFilter, topicOptions, ALL_FILTER_VALUE);

  if (filterTopicSelect) {
    populateSelect(filterTopicSelect, topicOptions, ALL_FILTER_VALUE);
  }

  updateLearnFilterSubtopics();
  updateTestFilterSubtopics();
  updateVocabFilterSubtopics();
}

function updateLearnFilterSubtopics() {
  const selectedTopic = learnTopicFilter.value;
  const subTopics = getStoredSubTopics(selectedTopic || undefined);
  const options = [{ value: ALL_FILTER_VALUE, label: 'All' }].concat(
    subTopics.map((sub) => ({ value: sub, label: sub })),
  );
  populateSelect(learnSubtopicFilter, options, ALL_FILTER_VALUE);
}

function updateTestFilterSubtopics() {
  const selectedTopic = testTopicFilter.value;
  const subTopics = getStoredSubTopics(selectedTopic || undefined);
  const options = [{ value: ALL_FILTER_VALUE, label: 'All' }].concat(
    subTopics.map((sub) => ({ value: sub, label: sub })),
  );
  populateSelect(testSubtopicFilter, options, ALL_FILTER_VALUE);
}

function updateVocabFilterSubtopics() {
  const selectedTopic = filterTopicSelect?.value || '';
  const subTopics = getStoredSubTopics(selectedTopic || undefined);
  const options = [{ value: ALL_FILTER_VALUE, label: 'All' }].concat(
    subTopics.map((sub) => ({ value: sub, label: sub })),
  );
  populateSelect(filterSubtopicSelect, options, ALL_FILTER_VALUE);
}

async function renderWordList() {
  const words = loadVocabulary();
  vocabulary = words;

  // Step 1: Apply filters (Topic, SubTopic, Type, Status)
  const filterTopic = filterTopicSelect?.value || '';
  const filterSubtopic = filterSubtopicSelect?.value || '';
  const filterType = filterTypeSelect?.value || '';
  const filterStatus = filterStatusSelect?.value || '';

  let filteredWords = words;
  if (filterTopic) {
    filteredWords = filteredWords.filter((entry) => entry.topic === filterTopic);
  }
  if (filterSubtopic) {
    filteredWords = filteredWords.filter((entry) => entry.subTopic === filterSubtopic);
  }
  if (filterType) {
    filteredWords = filteredWords.filter((entry) => entry.type === filterType);
  }
  if (filterStatus === 'learned') {
    filteredWords = filteredWords.filter((entry) => entry.learned);
  } else if (filterStatus === 'not-learned') {
    filteredWords = filteredWords.filter((entry) => !entry.learned);
  }

  // Step 2: Apply sort
  const sortBy = sortBySelect?.value || 'alphabet';
  const sortedWords = sortVocabularyWords(filteredWords, sortBy);

  // Step 3: Render
  const html = renderWordListAlphabetically(sortedWords);
  wordList.innerHTML = html;
}

function renderLanguageSelector() {
  if (!languageSelect) {
    return;
  }

  const options = getLanguageOptions();
  languageSelect.innerHTML = options
    .map((language) => `<option value="${language.code}" ${language.code === getCurrentLanguage() ? 'selected' : ''}>${language.flag} ${language.label}</option>`)
    .join('');
  languageSelect.value = getCurrentLanguage();
  if (languageLabel) {
    languageLabel.textContent = `Ngôn ngữ học: ${getLanguageLabel(getCurrentLanguage())}`;
  }
}

function renderMeaningLanguageSelector() {
  if (!meaningLanguageSelect) {
    return;
  }

  const options = getMeaningLanguageOptions();
  meaningLanguageSelect.innerHTML = options
    .map((language) => `<option value="${language.code}" ${language.code === getCurrentMeaningLanguage() ? 'selected' : ''}>${language.flag} ${language.label}</option>`)
    .join('');
  meaningLanguageSelect.value = getCurrentMeaningLanguage();
}

function getActiveDisplayConfig() {
  return getDisplayConfig(getCurrentLanguage(), getCurrentMeaningLanguage());
}

function autoResizeTextarea(textarea) {
  if (!textarea) {
    return;
  }

  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(textarea.scrollHeight, 92)}px`;
}

function syncExampleTextareaHeights() {
  [inputExample].forEach((textarea) => autoResizeTextarea(textarea));
}

function updateDynamicLabels() {
  const config = getActiveDisplayConfig();
  const termLabel = document.querySelector('[data-field-label="term"]');
  const pronunciationLabel = document.querySelector('[data-field-label="pronunciation"]');
  const meaningLabel = document.querySelector('[data-field-label="meaning"]');
  const exampleLabel = document.querySelector('[data-field-label="example"]');
  const learnTermLabel = document.querySelector('[data-display-label="term"]');
  const learnMeaningLabel = document.querySelector('[data-display-label="meaning"]');
  const learnExampleLabel = document.querySelector('[data-display-label="example"]');
  const termInput = document.getElementById('input-word');
  const meaningInput = document.getElementById('input-meaning');
  const ipaInput = document.getElementById('input-ipa');
  const exampleInput = document.getElementById('input-example');

  if (termLabel) {
    termLabel.textContent = config.termLabel;
  }
  if (pronunciationLabel) {
    pronunciationLabel.textContent = config.pronunciationLabel;
  }
  if (meaningLabel) {
    meaningLabel.textContent = config.meaningLabel;
  }
  if (exampleLabel) {
    exampleLabel.textContent = config.exampleLabel;
  }
  if (learnTermLabel) {
    learnTermLabel.textContent = config.termLabel;
  }
  if (learnMeaningLabel) {
    learnMeaningLabel.textContent = config.meaningLabel;
  }
  if (learnExampleLabel) {
    learnExampleLabel.textContent = config.exampleLabel;
  }
  if (termInput) {
    termInput.placeholder = config.termHint || '';
  }
  if (meaningInput) {
    meaningInput.placeholder = config.meaningPlaceholder || '';
  }
  if (ipaInput) {
    ipaInput.placeholder = config.pronunciationPlaceholder || '';
  }
  if (exampleInput) {
    exampleInput.placeholder = config.exampleHint || '';
  }
  syncExampleTextareaHeights();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSupportTable(items, title, columns = [], emptyMessage = '') {
  if (!Array.isArray(items) || items.length === 0) {
    if (emptyMessage) {
      return `
        <div class="support-table-wrapper">
          <div class="support-table-title">${title}</div>
          <p class="support-table-empty">${escapeHtml(emptyMessage)}</p>
        </div>
      `;
    }
    return '';
  }

  const headerLabel = title === 'Từ đồng nghĩa' ? 'Từ đồng nghĩa' : title === 'Từ trái nghĩa' ? 'Từ trái nghĩa' : title;
  const columnHeaders = columns.length ? columns : ['Từ', 'Nghĩa'];
  return `
    <div class="support-table-wrapper">
      <div class="support-table-title">${title}</div>
      <table class="support-table">
        <thead>
          <tr>
            <th>STT</th>
            ${columnHeaders.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item, index) => {
              const rowCells = columnHeaders.map((column) => {
                const key = column === 'Từ' || column === 'Cụm từ' || column === 'Word' ? 'word'
                  : column === 'Loại từ' || column === 'Type' ? 'type'
                  : column === 'IPA' ? 'ipa'
                  : column === 'CEFR' ? 'cefr'
                  : column === 'Ví dụ' || column === 'Example' ? 'example'
                  : 'meaning';
                const rawValue = item[key] ?? item.word ?? item.text ?? item.label ?? '';
                const value = typeof rawValue === 'string' ? rawValue : String(rawValue || '');
                return `<td>${escapeHtml(value)}</td>`;
              });
              return `<tr><td>${index + 1}</td>${rowCells.join('')}</tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function mergeSupportLists(currentList = [], parsedList = []) {
  const existingMap = new Map(
    normalizeSupportList(currentList).map((item) => [normalizeWordKey(item.word), item]),
  );

  const merged = new Map(existingMap);
  normalizeSupportList(parsedList).forEach((item) => {
    const key = normalizeWordKey(item.word);
    if (!key) {
      return;
    }
    const existing = existingMap.get(key) || {};
    const type = String(item.type || existing.type || '').trim();
    const ipa = String(item.ipa || existing.ipa || '').trim();
    const cefr = String(item.cefr || existing.cefr || '').trim();
    const example = String(item.example || existing.example || '').trim();
    const nextEntry = {
      word: String(item.word || '').trim(),
      meaning: String(item.meaning || existing.meaning || '').trim(),
      ...(type ? { type } : {}),
      ...(ipa ? { ipa } : {}),
      ...(cefr ? { cefr } : {}),
      ...(example ? { example } : {}),
    };
    merged.set(key, nextEntry);
  });

  return Array.from(merged.values()).filter((entry) => entry && entry.word);
}

function normalizeSupportList(items) {
  if (!items && items !== 0) {
    return [];
  }

  if (Array.isArray(items)) {
    return items
      .map((item) => {
        if (!item && item !== 0) {
          return null;
        }
        if (typeof item === 'string') {
          return { word: item.trim(), meaning: '' };
        }
        if (typeof item === 'object' && item !== null) {
          const type = String(item.type || item.partOfSpeech || item.pos || '').trim();
          const word = String(item.word || item.text || item.label || item.expression || item.value || '').trim();
          const meaning = String(item.meaning || item.translation || item.definition || item.description || item.explanation || '').trim();
          const ipa = String(item.ipa || item.pronunciation || '').trim();
          const cefr = String(item.cefr || item.level || '').trim();
          const example = String(item.example || item.shortExample || item.sample || '').trim();
          const normalized = word ? {
            word,
            meaning,
            ...(type ? { type } : {}),
          } : null;
          if (!normalized) {
            return null;
          }
          if (ipa) {
            normalized.ipa = ipa;
          }
          if (cefr) {
            normalized.cefr = cefr;
          }
          if (example) {
            normalized.example = example;
          }
          return normalized;
        }
        return null;
      })
      .filter((entry) => entry && entry.word);
  }

  if (typeof items === 'string') {
    return items
      .split(/\n|,|;/)
      .map((item) => ({ word: String(item || '').trim(), meaning: '' }))
      .filter((entry) => entry.word);
  }

  if (typeof items === 'object' && items !== null) {
    const type = String(items.type || items.partOfSpeech || items.pos || '').trim();
    const word = String(items.word || items.text || items.label || items.expression || items.value || '').trim();
    const meaning = String(items.meaning || items.translation || items.definition || items.description || items.explanation || '').trim();
    const ipa = String(items.ipa || items.pronunciation || '').trim();
    const cefr = String(items.cefr || items.level || '').trim();
    const example = String(items.example || items.shortExample || items.sample || '').trim();
    const normalized = word ? [{ word, meaning, ...(type ? { type } : {}) }] : [];
    if (!normalized.length) {
      return [];
    }
    if (ipa) {
      normalized[0].ipa = ipa;
    }
    if (cefr) {
      normalized[0].cefr = cefr;
    }
    if (example) {
      normalized[0].example = example;
    }
    return normalized;
  }

  return [];
}

function renderSupportEditorSections() {
  if (!aiExpansionEditor) {
    return;
  }

  const sections = [
    // === MEANINGS ANALYSIS CARD ===
    ...(currentMeaningsAnalysis.length > 0 ? [{
      key: 'meaningsAnalysis',
      title: '📊 Meanings Analysis',
      subtitle: `Phát hiện ${currentMeaningsAnalysis.length} nghĩa — mỗi nghĩa có dữ liệu riêng`,
      emptyMessage: 'Chạy "✨ Tạo tất cả" để phân tích.',
      items: [],
      fields: [],
    }] : []),
    {
      key: 'wordFamily',
      title: 'Word Family',
      subtitle: 'Verb / Noun / Adjective / Adverb',
      emptyMessage: 'Chưa có mục nào.',
      items: currentSupportWordFamily,
      fields: [
        { id: 'word', label: 'Từ', placeholder: 'explain' },
        { id: 'type', label: 'Loại từ', placeholder: 'Verb' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'giải thích' },
        { id: 'ipa', label: 'IPA', placeholder: '/ɪkˈspleɪn/' },
        { id: 'cefr', label: 'CEFR', placeholder: 'B2' },
        { id: 'example', label: 'Ví dụ', placeholder: 'Please explain it.' },
      ],
    },
    {
      key: 'synonyms',
      title: 'Synonyms',
      subtitle: '5–15 từ đồng nghĩa',
      emptyMessage: 'Chưa có từ đồng nghĩa nào.',
      items: currentSupportSynonyms,
      fields: [
        { id: 'word', label: 'Từ', placeholder: 'clarify' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'giải thích rõ' },
        { id: 'ipa', label: 'IPA', placeholder: '/ˈklærɪfaɪ/' },
        { id: 'cefr', label: 'CEFR', placeholder: 'B2' },
        { id: 'example', label: 'Ví dụ', placeholder: 'Can you clarify that?' },
      ],
    },
    {
      key: 'antonyms',
      title: 'Antonyms',
      subtitle: '3–10 từ trái nghĩa',
      emptyMessage: 'Chưa có từ trái nghĩa nào.',
      items: currentSupportAntonyms,
      fields: [
        { id: 'word', label: 'Từ', placeholder: 'confuse' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'làm rối' },
        { id: 'ipa', label: 'IPA', placeholder: '/kənˈfjuːz/' },
        { id: 'cefr', label: 'CEFR', placeholder: 'B1' },
        { id: 'example', label: 'Ví dụ', placeholder: 'The message confused me.' },
      ],
    },
    {
      key: 'collocations',
      title: 'Collocations',
      subtitle: 'Cụm từ phổ biến',
      emptyMessage: 'Chưa có collocation nào.',
      items: currentSupportCollocations,
      fields: [
        { id: 'word', label: 'Cụm từ', placeholder: 'make a decision' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'đưa ra quyết định' },
        { id: 'example', label: 'Ví dụ', placeholder: 'We need to make a decision.' },
      ],
    },
    {
      key: 'sentencePatterns',
      title: 'Sentence Patterns',
      subtitle: 'Mẫu câu thường gặp',
      emptyMessage: 'Chưa có mẫu câu nào.',
      items: currentSupportSentencePatterns,
      fields: [
        { id: 'word', label: 'Pattern', placeholder: 'act as + N' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'đóng vai là ai đó' },
        { id: 'example', label: 'Ví dụ', placeholder: 'She can act as a teacher.' },
      ],
    },
    {
      key: 'commonExpressions',
      title: 'Common Expressions',
      subtitle: 'Thành ngữ / biểu thức',
      emptyMessage: 'Chưa có biểu thức nào.',
      items: currentSupportCommonExpressions,
      fields: [
        { id: 'word', label: 'Expression', placeholder: 'actions speak louder than words' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'hành động nói nhiều hơn lời nói' },
        { id: 'example', label: 'Ví dụ', placeholder: 'Actions speak louder than words.' },
      ],
    },
    {
      key: 'commonMistakes',
      title: 'Common Mistakes',
      subtitle: 'Lỗi người học hay mắc',
      emptyMessage: 'Chưa có lỗi nào.',
      items: currentSupportCommonMistakes,
      fields: [
        { id: 'word', label: 'Lỗi', placeholder: 'make an action' },
        { id: 'meaning', label: 'Nghĩa', placeholder: 'sai' },
        { id: 'example', label: 'Ví dụ', placeholder: 'We need to make an action.' },
      ],
    },
  ];

  aiExpansionEditor.innerHTML = sections.map((section) => {
    const renderedItems = (section.items || []).map((entry, index) => `
      <div class="support-editor-row">
        <div class="support-editor-row-main">
          <div class="support-editor-row-title">${escapeHtml(entry.word || '')}</div>
          <div class="support-editor-row-meta">
            ${entry.type ? `<span>${escapeHtml(entry.type)}</span>` : ''}
            ${entry.meaning ? `<span>${escapeHtml(entry.meaning)}</span>` : ''}
            ${entry.ipa ? `<span>IPA: ${escapeHtml(entry.ipa)}</span>` : ''}
            ${entry.cefr ? `<span>CEFR: ${escapeHtml(entry.cefr)}</span>` : ''}
            ${entry.example ? `<span>${escapeHtml(entry.example)}</span>` : ''}
          </div>
        </div>
        <div class="support-editor-actions">
          <button type="button" class="secondary-button small-button" data-support-action="edit" data-support-section="${section.key}" data-support-index="${index}">Edit</button>
          <button type="button" class="secondary-button small-button" data-support-action="delete" data-support-section="${section.key}" data-support-index="${index}">Delete</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="support-editor-card">
        <div class="support-editor-header">
          <div>
            <div class="support-editor-title">${escapeHtml(section.title)}</div>
            <div class="support-editor-subtitle">${escapeHtml(section.subtitle)}</div>
          </div>
          <button type="button" class="secondary-button small-button" data-support-action="add" data-support-section="${section.key}">+ Add</button>
        </div>
        <div class="support-editor-form hidden" data-support-form="${section.key}">
          ${section.fields.map((field) => `
            <label class="support-editor-field">
              <span>${escapeHtml(field.label)}</span>
              <input type="text" data-support-field="${field.id}" data-support-section="${section.key}" placeholder="${escapeHtml(field.placeholder)}" />
            </label>
          `).join('')}
          <div class="support-editor-actions">
            <button type="button" class="primary-button small-button" data-support-action="save" data-support-section="${section.key}">Save</button>
            <button type="button" class="secondary-button small-button" data-support-action="cancel" data-support-section="${section.key}">Cancel</button>
          </div>
        </div>
        <div class="support-editor-list">
          ${renderedItems || `<div class="support-editor-empty">${escapeHtml(section.emptyMessage)}</div>`}
        </div>
      </div>
    `;
  }).join('');

  syncSupportInputFields();
}

function syncSupportInputFields() {
  if (inputFixedPhrases) {
    inputFixedPhrases.value = currentSupportFixedPhrases.map((item) => item.word).filter(Boolean).join(', ');
  }
}

function getSupportSectionItems(section) {
  switch (section) {
    case 'synonyms': return currentSupportSynonyms;
    case 'antonyms': return currentSupportAntonyms;
    case 'wordFamily': return currentSupportWordFamily;
    case 'collocations': return currentSupportCollocations;
    case 'sentencePatterns': return currentSupportSentencePatterns;
    case 'commonExpressions': return currentSupportCommonExpressions;
    case 'commonMistakes': return currentSupportCommonMistakes;
    default: return currentSupportFixedPhrases;
  }
}

function setSupportSectionItems(section, items) {
  switch (section) {
    case 'synonyms': currentSupportSynonyms = items; break;
    case 'antonyms': currentSupportAntonyms = items; break;
    case 'wordFamily': currentSupportWordFamily = items; break;
    case 'collocations': currentSupportCollocations = items; break;
    case 'sentencePatterns': currentSupportSentencePatterns = items; break;
    case 'commonExpressions': currentSupportCommonExpressions = items; break;
    case 'commonMistakes': currentSupportCommonMistakes = items; break;
    default: currentSupportFixedPhrases = items; break;
  }
}

function getSupportEditorForm(section) {
  return aiExpansionEditor?.querySelector(`[data-support-form="${section}"]`);
}

function openSupportEditor(section, index = -1) {
  const form = getSupportEditorForm(section);
  if (!form) {
    return;
  }
  activeSupportEditor = { section, index };
  const items = getSupportSectionItems(section);
  const entry = typeof index === 'number' && index >= 0 ? items[index] : null;
  form.classList.remove('hidden');
  form.querySelectorAll('[data-support-field]').forEach((input) => {
    const fieldId = input.getAttribute('data-support-field');
    let value = '';
    if (entry) {
      value = String(entry[fieldId] || '').trim();
    }
    input.value = value;
  });
}

function closeSupportEditor(section) {
  const form = getSupportEditorForm(section);
  if (!form) {
    return;
  }
  form.classList.add('hidden');
  activeSupportEditor = { section: '', index: -1 };
}

function saveSupportEditorEntry() {
  const section = activeSupportEditor.section;
  if (!section) {
    return;
  }
  const form = getSupportEditorForm(section);
  if (!form) {
    return;
  }

  const values = {};
  form.querySelectorAll('[data-support-field]').forEach((input) => {
    const fieldId = input.getAttribute('data-support-field');
    values[fieldId] = input.value.trim();
  });

  const word = values.word || '';
  if (!word) {
    return;
  }

  const nextEntry = { word };
  if (values.meaning) nextEntry.meaning = values.meaning;
  if (section === 'wordFamily' && values.type) nextEntry.type = values.type;
  if (values.ipa) nextEntry.ipa = values.ipa;
  if (values.cefr) nextEntry.cefr = values.cefr;
  if (values.example) nextEntry.example = values.example;

  const items = [...getSupportSectionItems(section)];
  if (activeSupportEditor.index >= 0 && activeSupportEditor.index < items.length) {
    items[activeSupportEditor.index] = nextEntry;
  } else {
    items.push(nextEntry);
  }
  setSupportSectionItems(section, items);
  syncSupportInputFields();
  renderSupportEditorSections();
  closeSupportEditor(section);
}

function handleSupportEditorAction(event) {
  const button = event.target.closest('button[data-support-action]');
  if (!button || !aiExpansionEditor?.contains(button)) {
    return;
  }

  const action = button.getAttribute('data-support-action');
  const section = button.getAttribute('data-support-section');
  const index = Number(button.getAttribute('data-support-index') || '-1');

  if (action === 'add') {
    openSupportEditor(section);
  } else if (action === 'edit') {
    openSupportEditor(section, index);
  } else if (action === 'delete') {
    const items = [...getSupportSectionItems(section)];
    items.splice(index, 1);
    setSupportSectionItems(section, items);
    syncSupportInputFields();
    renderSupportEditorSections();
  } else if (action === 'save') {
    saveSupportEditorEntry();
  } else if (action === 'cancel') {
    closeSupportEditor(section);
  }
}

function renderWordCard(entry) {
  const config = getActiveDisplayConfig();
  const meaningValue = getMeaningDisplayValue(entry, getCurrentMeaningLanguage());
  const exampleValue = entry.example || entry.basicExample || entry.examples?.basic || entry.examples?.example || '';
  const synonyms = normalizeSupportList(entry.synonyms);
  const antonyms = normalizeSupportList(entry.antonyms);
  const wordFamily = normalizeSupportList(entry.wordFamily);
  const fixedPhrases = normalizeSupportList(entry.fixedExpressions || entry.fixedPhrases);
  return `
    <div class="word-item" data-word="${escapeHtml(entry.word)}" data-doc-id="${escapeHtml(entry.docId || '')}">
      <div>
        <h3>${escapeHtml(entry.word)}</h3>
        <p><strong>Type:</strong> ${escapeHtml(entry.type || DEFAULT_TYPE)}</p>
        <p><strong>Part of Speech:</strong> ${escapeHtml(entry.partOfSpeech || entry.pos || '—')}</p>
        <p><strong>Topic:</strong> ${escapeHtml(entry.topic)}</p>
        <p><strong>Sub Topic:</strong> ${escapeHtml(entry.subTopic)}</p>
        <p><strong>${config.pronunciationLabel}:</strong> ${escapeHtml(entry.ipa || entry.pronunciation || '—')}</p>
        <p><strong>${config.meaningLabel}:</strong> ${escapeHtml(meaningValue)}</p>
        <p class="word-example"><strong>${config.exampleLabel}:</strong> ${escapeHtml(exampleValue || '—')}</p>
        <p><strong>Trạng thái:</strong> ${entry.learned ? 'Đã thuộc' : 'Chưa thuộc'}</p>
      </div>
      <div class="word-support-tables">
        ${renderSupportTable(synonyms, 'Đồng nghĩa', ['Từ', 'Nghĩa'])}
        ${renderSupportTable(antonyms, 'Trái nghĩa', ['Từ', 'Nghĩa'])}
        ${renderSupportTable(wordFamily, 'Họ từ', ['Từ', 'Loại từ', 'Nghĩa', 'IPA', 'CEFR', 'Ví dụ'], 'Không có họ từ.')}
        ${renderSupportTable(fixedPhrases, 'Cụm từ cố định', ['Cụm từ', 'Nghĩa'], 'Không có cụm từ cố định.')}
      </div>
      <div class="word-actions">
        <button type="button" class="edit-word secondary-button">✏ Edit</button>
        <button type="button" class="delete-word">🗑 Delete</button>
      </div>
    </div>
  `;
}

function renderWordListAlphabetically(words) {
  if (!words.length) {
    return '<p class="feedback">Chưa có từ nào. Thêm từ ngay để bắt đầu học.</p>';
  }

  const sortedWords = [...words].sort((first, second) => first.word.localeCompare(second.word, undefined, { sensitivity: 'base' }));
  const grouped = sortedWords.reduce((acc, entry) => {
    const letter = entry.word ? entry.word.charAt(0).toUpperCase() : '';
    if (!acc[letter]) {
      acc[letter] = [];
    }
    acc[letter].push(entry);
    return acc;
  }, {});

  return Object.keys(grouped)
    .sort()
    .map((letter) => `
      <section class="alphabet-group">
        <h3 class="word-group-heading">${letter}</h3>
        ${grouped[letter].map(renderWordCard).join('')}
      </section>
    `)
    .join('');
}
function renderWordListByTopic(words) {
  if (!words.length) {
    return '<p class="feedback">Chưa có từ nào. Thêm từ ngay để bắt đầu học.</p>';
  }

  const sortedWords = [...words].sort((first, second) => {
    const categoryComparison = (first.category || first.topic || DEFAULT_TOPIC).localeCompare(second.category || second.topic || DEFAULT_TOPIC, undefined, { sensitivity: 'base' });
    if (categoryComparison !== 0) {
      return categoryComparison;
    }
    const topicComparison = (first.topic || DEFAULT_TOPIC).localeCompare(second.topic || DEFAULT_TOPIC, undefined, { sensitivity: 'base' });
    if (topicComparison !== 0) {
      return topicComparison;
    }
    const subTopicComparison = (first.subTopic || DEFAULT_SUBTOPIC).localeCompare(second.subTopic || DEFAULT_SUBTOPIC, undefined, { sensitivity: 'base' });
    if (subTopicComparison !== 0) {
      return subTopicComparison;
    }
    return first.word.localeCompare(second.word, undefined, { sensitivity: 'base' });
  });

  const groupedByCategory = sortedWords.reduce((categoryAcc, entry) => {
    const category = entry.category || entry.topic || DEFAULT_TOPIC;
    const topic = entry.topic || DEFAULT_TOPIC;
    const subTopic = entry.subTopic || DEFAULT_SUBTOPIC;
    categoryAcc[category] = categoryAcc[category] || {};
    categoryAcc[category][topic] = categoryAcc[category][topic] || {};
    categoryAcc[category][topic][subTopic] = categoryAcc[category][topic][subTopic] || [];
    categoryAcc[category][topic][subTopic].push(entry);
    return categoryAcc;
  }, {});

  return Object.keys(groupedByCategory)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((category) => `
      <section class="topic-group">
        <h2 class="topic-heading">📁 ${category}</h2>
        ${Object.keys(groupedByCategory[category])
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
          .map((topic) => `
            <div class="subtopic-group">
              <h3 class="subtopic-heading">▶ ${topic}</h3>
              ${Object.keys(groupedByCategory[category][topic])
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                .map((subTopic) => {
                  const entries = groupedByCategory[category][topic][subTopic];
                  const wordsSection = entries.filter((entry) => entry.type === 'Word');
                  const phrasesSection = entries.filter((entry) => entry.type === 'Phrase');
                  return `
                    <div class="subtopic-group nested">
                      <h4 class="subtopic-heading">• ${subTopic}</h4>
                      ${wordsSection.length ? `<div class="type-group"><h5>Words</h5>${wordsSection.map(renderWordCard).join('')}</div>` : ''}
                      ${phrasesSection.length ? `<div class="type-group"><h5>Phrases</h5>${phrasesSection.map(renderWordCard).join('')}</div>` : ''}
                    </div>
                  `;
                })
                .join('')}
            </div>
          `)
          .join('')}
      </section>
    `)
    .join('');
}

function renderLearnSelection() {
  const allWords = loadVocabulary();
  vocabulary = allWords;
  const topic = learnTopicFilter.value || undefined;
  const subTopic = learnSubtopicFilter.value || undefined;
  const words = filterVocabularyByTopic(allWords, topic, subTopic);
  learnSelection.innerHTML = words.length
    ? words
        .map(
          (entry) => `
            <div class="select-item">
              <label>
                <input type="radio" name="learn-word" value="${entry.word}" />
                <span>${formatLearnLabel(entry)} • ${entry.topic} / ${entry.subTopic}</span>
              </label>
            </div>
          `,
        )
        .join('')
    : '<p class="feedback">Không có từ để luyện. Vui lòng thêm từ mới hoặc thay đổi bộ lọc.</p>';
}

function renderTestState() {
  const allWords = loadVocabulary();
  vocabulary = allWords;
  const words = getWordsFromFilters(testTopicFilter.value, testSubtopicFilter.value);
  testFeedback.textContent = words.length ? '' : 'Không có từ để test theo bộ lọc hiện tại. Vui lòng chọn lại.';
}

function setLearnSessionVisibility(visible) {
  learnSession.classList.toggle('hidden', !visible);
  sessionActive = visible;
}

function setTestSessionVisibility(visible) {
  testSession.classList.toggle('hidden', !visible);
  if (!visible) {
    testSummary.classList.add('hidden');
  }
}

function clearLearnSpellingAnimation() {
  if (learnSpellingTimer) {
    window.clearTimeout(learnSpellingTimer);
  }
  if (learnSpellingStepTimer) {
    window.clearTimeout(learnSpellingStepTimer);
  }
  learnSpellingTimer = null;
  learnSpellingStepTimer = null;
}

function renderLearnWordDisplay(entry, highlightIndex = -1) {
  if (!entry) {
    return;
  }

  if (isHiddenWord) {
    displayWord.textContent = '••••••';
    return;
  }

  const mode = normalizeLearnReadingMode(learnReadingMode?.value || selectedLearnReadingMode);
  if (mode !== 'spelling') {
    displayWord.textContent = entry.word;
    return;
  }

  const letters = getSpellingSequence(entry.word);
  displayWord.innerHTML = letters
    .map((letter, index) => {
      const isActive = index <= highlightIndex;
      return `<span class="spelling-letter${isActive ? ' active' : ''}">${letter}</span>`;
    })
    .join('');
}

function updateLearnDisplay() {
  const currentEntry = learnQueue[currentLearnIndex];
  displayMeaning.textContent = getMeaningDisplayValue(currentEntry, getCurrentMeaningLanguage());
  displayExample.textContent = currentEntry.example;
  renderLearnWordDisplay(currentEntry);
  learnToggle.textContent = isHiddenWord ? 'Hiện từ' : 'Ẩn từ';
  const totalWords = Math.ceil(learnQueue.length / learnRepetitionsPerWord);
  const currentWord = Math.floor(currentLearnIndex / learnRepetitionsPerWord) + 1;
  const currentRepetition = (currentLearnIndex % learnRepetitionsPerWord) + 1;
  sessionCounter.textContent = `Từ ${currentWord} / ${totalWords} • Lượt ${currentRepetition} / ${learnRepetitionsPerWord}`;
  const progressPercent = Math.round(((currentLearnIndex + 1) / learnQueue.length) * 100);
  learnProgress.style.width = `${progressPercent}%`;
}

function speakLearnWord(entry) {
  if (!entry || !('speechSynthesis' in window)) {
    return false;
  }

  const synth = window.speechSynthesis;
  const mode = normalizeLearnReadingMode(learnReadingMode?.value || selectedLearnReadingMode);
  clearLearnSpellingAnimation();
  synth.cancel();

  if (mode !== 'spelling') {
    const utterance = createSpeechUtterance(entry.word, getCurrentLanguage(), { rate: 0.8, pitch: 1 });
    utterance.onstart = () => {
      if (learnMessage) {
        learnMessage.textContent = 'Đang phát âm...';
      }
    };
    utterance.onerror = () => {
      if (learnMessage) {
        learnMessage.textContent = 'Không thể phát âm từ này lúc này.';
      }
    };
    utterance.onend = () => {
      if (learnMessage) {
        learnMessage.textContent = '';
      }
    };
    synth.speak(utterance);
    return true;
  }

  const letters = getSpellingSequence(entry.word);
  if (!letters.length) {
    return false;
  }

  const letterPauseMs = 500;
  const finishPauseMs = 800;
  let index = 0;
  learnSpellingRunId += 1;
  const currentRunId = learnSpellingRunId;

  const updateHighlight = (nextIndex) => {
    if (currentRunId !== learnSpellingRunId) {
      return;
    }
    renderLearnWordDisplay(entry, nextIndex);
  };

  const speakNextLetter = () => {
    if (currentRunId !== learnSpellingRunId || index >= letters.length) {
      return;
    }

    const letterUtterance = createSpeechUtterance(letters[index], getCurrentLanguage(), { rate: 0.8, pitch: 1 });
    letterUtterance.onstart = () => {
      if (learnMessage) {
        learnMessage.textContent = 'Đang phát âm...';
      }
    };
    letterUtterance.onerror = () => {
      if (learnMessage) {
        learnMessage.textContent = 'Không thể phát âm từ này lúc này.';
      }
    };
    letterUtterance.onend = () => {
      if (currentRunId !== learnSpellingRunId) {
        return;
      }
      updateHighlight(index);
      index += 1;
      if (index < letters.length) {
        learnSpellingStepTimer = window.setTimeout(speakNextLetter, letterPauseMs);
      } else {
        learnSpellingTimer = window.setTimeout(() => {
          if (currentRunId !== learnSpellingRunId) {
            return;
          }
          const wholeWordUtterance = createSpeechUtterance(entry.word, getCurrentLanguage(), { rate: 0.8, pitch: 1 });
          wholeWordUtterance.onstart = () => {
            if (learnMessage) {
              learnMessage.textContent = 'Đang phát âm...';
            }
          };
          wholeWordUtterance.onerror = () => {
            if (learnMessage) {
              learnMessage.textContent = 'Không thể phát âm từ này lúc này.';
            }
          };
          wholeWordUtterance.onend = () => {
            if (learnMessage) {
              learnMessage.textContent = '';
            }
          };
          synth.speak(wholeWordUtterance);
          renderLearnWordDisplay(entry, letters.length - 1);
        }, finishPauseMs);
      }
    };
    synth.speak(letterUtterance);
  };

  renderLearnWordDisplay(entry, -1);
  speakNextLetter();
  return true;
}

// Normalize user input so comparisons are robust across punctuation and casing.
function normalizeText(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function testTimeout(callback, delay) {
  window.setTimeout(callback, delay);
}

function cancelAutoNext() {
  autoNextController.cancel();
  autoNextTimer = null;
}

function cancelSpeakingAutoNext() {
  if (speakingAutoNextTimer !== null) {
    window.clearInterval(speakingAutoNextTimer);
    speakingAutoNextTimer = null;
  }
}

function startSpeakingAutoNext() {
  cancelSpeakingAutoNext();

  if (selectedTestMode !== 'speaking' || !sessionActive) {
    return;
  }

  const startedAt = Date.now();
  const updateCountdown = () => {
    if (selectedTestMode !== 'speaking' || !sessionActive) {
      cancelSpeakingAutoNext();
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const secondsLeft = Math.max(0, Math.ceil((AUTO_NEXT_DELAY - elapsedMs) / 1000));

    if (secondsLeft <= 0) {
      cancelSpeakingAutoNext();
      proceedToNextTestQuestion();
      return;
    }

    testMessage.textContent = `✅ Chính xác. Chuyển câu sau: ${secondsLeft}...`;
  };

  updateCountdown();
  speakingAutoNextTimer = window.setInterval(updateCountdown, 1000);
}

function startAutoNext() {
  cancelAutoNext();
  autoNextTimer = autoNextController;
  autoNextController.start(
    () => {
      proceedToNextTestQuestion();
    },
    AUTO_NEXT_DELAY_SECONDS,
    (remainingSeconds) => {
      if (selectedTestMode !== 'dictation' || !sessionActive) {
        return;
      }
      testMessage.textContent = `✅ Chính xác. Chuyển câu sau: ${remainingSeconds}...`;
    },
  );
}

// Toggle the active test mode between speaking and dictation.
function setSelectedTestMode(mode) {
  cancelAutoNext();
  cancelSpeakingAutoNext();
  isTestTransitioning = false;
  selectedTestMode = mode;
  selectedSpeakingMode = normalizeSpeakingMode(speakingModeSelect?.value || selectedSpeakingMode);
  selectedDictationMode = normalizeDictationMode(dictationModeSelect?.value || selectedDictationMode);
  testModeSpeaking.classList.toggle('active-mode', mode === 'speaking');
  testModeDictation.classList.toggle('active-mode', mode === 'dictation');
  speakingModeWrapper?.classList.toggle('hidden', mode !== 'speaking');
  dictationModeWrapper?.classList.toggle('hidden', mode !== 'dictation');

  if (mode === 'speaking' && !isSpeechRecognitionSupported()) {
    testRecord.disabled = true;
    testModeHint.textContent = getSpeechRecognitionUnsupportedMessage();
    updateSpeechButtonState();
    return;
  }

  testRecord.disabled = false;
  testModeHint.textContent = mode === 'speaking' ? 'Chế độ Speaking Test đã được chọn.' : 'Chế độ Dictation Test đã được chọn.';
  updateSpeechButtonState();
}

function stopVoiceRecognition() {
  if (recordingWatchdog !== null) {
    window.clearTimeout(recordingWatchdog);
    recordingWatchdog = null;
  }
  if (testRecognition) {
    try {
      // First try to abort (most forceful)
      testRecognition.abort();
    } catch (error1) {
      try {
        // If abort fails, try stop
        testRecognition.stop();
      } catch (error2) {
        console.warn('Failed to stop/abort recognition', error2);
      }
    }
    
    // Clear all event handlers to prevent memory leaks
    try {
      testRecognition.onstart = null;
      testRecognition.onresult = null;
      testRecognition.onerror = null;
      testRecognition.onend = null;
    } catch (error) {
      console.warn('Failed to clear recognition handlers', error);
    }
  }
  testRecognition = null;
}

function prepareSpeechSession() {
  activeSpeechSessionToken += 1;
  const token = activeSpeechSessionToken;
  cleanupSpeechSession({ preservePending: false });
  return token;
}

function finalizeSpeechResult() {
  speechStateMachine.finishResult();
  updateSpeechButtonState();
  logSpeechEvent('result-finalized');
}

// Use Web Speech Synthesis to read the target word or example sentence.
function speakText(text, rate = currentPlaybackRate) {
  if (!('speechSynthesis' in window)) {
    return false;
  }

  const effectiveRate = Number(rate) > 0 ? Number(rate) : currentPlaybackRate;

  const sessionToken = prepareSpeechSession();
  const synth = window.speechSynthesis;
  const playbackResult = speechStateMachine.beginPlayback();
  if (!playbackResult.allowed) {
    logSpeechEvent('playback-blocked', { reason: playbackResult.reason });
    return false;
  }

  updateSpeechButtonState();
  logSpeechEvent('playback-started', { text, rate: effectiveRate });
  synth.cancel();
  const utterance = createSpeechUtterance(text, getCurrentLanguage(), { rate: effectiveRate, pitch: 1 });
  utterance.onstart = () => {
    testMessage.textContent = 'Đang phát âm...';
    onSpeakingStart(text);
    logSpeechEvent('utterance-started', { sessionToken });
  };
  utterance.onerror = () => {
    testMessage.textContent = 'Không thể phát âm nội dung này lúc này.';
    if (sessionToken === activeSpeechSessionToken) {
      speechStateMachine.endPlayback();
      onSpeakingEnd();
      updateSpeechButtonState();
      logSpeechEvent('utterance-error', { sessionToken });
    }
  };
  utterance.onend = () => {
    if (sessionToken !== activeSpeechSessionToken) {
      return;
    }
    speechStateMachine.endPlayback();
    if (pendingRecordingAfterPlayback) {
      pendingRecordingAfterPlayback = false;
      processTestRecording();
    }
    if (selectedTestMode === 'speaking') {
      testMessage.textContent = 'Sẵn sàng.';
    }
    onSpeakingEnd();
    updateSpeechButtonState();
    logSpeechEvent('utterance-ended', { sessionToken });
  };
  synth.speak(utterance);
  return true;
}

function speakSpeakingPrompt(entry, playbackRate = currentPlaybackRate) {
  if (!('speechSynthesis' in window)) {
    testMessage.textContent = 'Trình duyệt không hỗ trợ Speech Synthesis.';
    return;
  }

  const promptText = getSpeakingPromptText(selectedSpeakingMode, entry);
  if (!promptText) {
    return;
  }

  const sessionToken = prepareSpeechSession();
  const synth = window.speechSynthesis;
  const playbackResult = speechStateMachine.beginPlayback();
  if (!playbackResult.allowed) {
    logSpeechEvent('playback-blocked', { reason: playbackResult.reason });
    return;
  }

  updateSpeechButtonState();
  logSpeechEvent('playback-started', { promptText, sessionToken, rate: playbackRate });
  synth.cancel();
  const utterance = createSpeechUtterance(promptText, getCurrentLanguage(), { rate: playbackRate, pitch: 1 });
  utterance.onstart = () => {
    testMessage.textContent = 'Đang phát âm...';
    onSpeakingStart(promptText);
    logSpeechEvent('utterance-started', { sessionToken });
  };
  utterance.onerror = () => {
    testMessage.textContent = 'Không thể phát âm yêu cầu này lúc này.';
    if (sessionToken === activeSpeechSessionToken) {
      speechStateMachine.endPlayback();
      onSpeakingEnd();
      updateSpeechButtonState();
      logSpeechEvent('utterance-error', { sessionToken });
    }
  };
  utterance.onend = () => {
    if (sessionToken !== activeSpeechSessionToken) {
      return;
    }
    speechStateMachine.endPlayback();
    if (pendingRecordingAfterPlayback) {
      pendingRecordingAfterPlayback = false;
      processTestRecording();
    }
    testMessage.textContent = 'Sẵn sàng.';
    onSpeakingEnd();
    updateSpeechButtonState();
    logSpeechEvent('utterance-ended', { sessionToken });
  };
  synth.speak(utterance);
}

function updateTestProgress() {
  const totalQuestions = Math.max(testQueue.length, 1);
  const currentEntry = testQueue[currentTestIndex];
  const totalGroups = Math.max(new Set(testQueue.map((entry) => entry.groupIndex ?? 0)).size, 1);
  const groupIndex = currentEntry?.groupIndex ?? 0;
  const groupSize = currentEntry?.groupSize || 1;
  const groupPosition = currentEntry?.groupPosition || 1;

  testCounter.textContent = `Word Group ${groupIndex + 1} / ${totalGroups}`;
  testProgressDetail.textContent = `Current ${groupPosition} / ${groupSize}`;
  const progressPercent = Math.round(((currentTestIndex + 1) / totalQuestions) * 100);
  testProgress.style.width = `${progressPercent}%`;
}

function showTestSummary() {
  cancelAutoNext();
  cancelSpeakingAutoNext();
  cleanupSpeechSession({ preservePending: false });
  isTestTransitioning = false;
  const totalChecks = testScore + testWrong;
  const accuracy = totalChecks ? Math.round((testScore / totalChecks) * 100) : 0;
  const summaryStats = speakingTestFlow.getSummaryStats();
  testSummary.classList.remove('hidden');
  summaryScore.textContent = `Correct: ${testScore} | Wrong: ${testWrong}`;
  summaryBreakdown.textContent = `Accuracy: ${accuracy}% | Skipped: ${summaryStats.skipped}`;
  testSubmit.classList.add('hidden');
  testPrevious?.classList.add('hidden');
  testNext.classList.add('hidden');
  testAnswer.classList.add('hidden');
  testRecord.classList.add('hidden');
  testListen.classList.add('hidden');
  testMessage.textContent = 'Hoàn tất bài test.';
  sessionActive = false;
}

function updateTestDisplay() {
  cancelAutoNext();
  cancelSpeakingAutoNext();
  cleanupSpeechSession({ preservePending: false });
  isTestTransitioning = false;
  const currentEntry = testQueue[currentTestIndex];
  if (!currentEntry) {
    return;
  }
  if (selectedTestMode === 'speaking') {
    selectedSpeakingMode = normalizeSpeakingMode(speakingModeSelect?.value || selectedSpeakingMode);
    const promptText = getSpeakingPromptText(selectedSpeakingMode, currentEntry);
    testModeLabel.textContent = 'Mode: Speaking Test';
    testStageLabel.textContent = 'Pronunciation';
    testMeaning.textContent = getSpeakingInstruction(selectedSpeakingMode);
    testExample.textContent = `${getSpeakingPromptLabel(selectedSpeakingMode)}: ${promptText}`;
    testInputLabel.textContent = 'Phản hồi';
    testAnswer.classList.add('hidden');
    testAnswer.disabled = false;
    testAnswer.value = '';
    testRecord.classList.remove('hidden');
    testListen.classList.remove('hidden');
    testSubmit.classList.add('hidden');
    testPrevious?.classList.toggle('hidden', currentTestIndex <= 0);
    testNext.classList.toggle('hidden', currentTestIndex >= testQueue.length - 1);
    testRetry?.classList.add('hidden');
    testSkip?.classList.add('hidden');
    testListen.disabled = false;
    testRecord.disabled = false;
    testSubmit.disabled = false;

    if (!isSpeechRecognitionSupported()) {
      testRecord.disabled = true;
      testMessage.textContent = getSpeechRecognitionUnsupportedMessage();
    } else {
      testMessage.textContent = `Nhấn 🔊 Listen để nghe ${selectedSpeakingMode === 'example' ? 'câu ví dụ' : 'từ'} rồi bấm 🎤 Record để ghi âm.`;
    }

    resetPronunciationForQuestion(promptText);
    showPronunciationGuide(promptText);
    testNext.classList.toggle('hidden', currentTestIndex >= testQueue.length - 1);
    speakSpeakingPrompt(currentEntry);
  } else {
    selectedDictationMode = normalizeDictationMode(dictationModeSelect?.value || selectedDictationMode);
    testModeLabel.textContent = 'Mode: Dictation Test';
    testStageLabel.textContent = selectedDictationMode === 'example' ? 'Stage: Example' : 'Stage: Word';
    testMeaning.textContent = getDictationInstruction(selectedDictationMode);
    testExample.textContent = `${getDictationPromptLabel(selectedDictationMode)}: ${getDictationPromptText(selectedDictationMode, currentEntry)}`;
    testInputLabel.textContent = selectedDictationMode === 'example' ? 'Nhập câu ví dụ' : 'Nhập từ';
    testAnswer.classList.remove('hidden');
    testAnswer.disabled = false;
    testAnswer.removeAttribute('aria-disabled');
    testAnswer.value = '';
    testRecord.classList.add('hidden');
    testSubmit.classList.remove('hidden');
    testSubmit.disabled = false;
    testNext.classList.add('hidden');
    testPrevious?.classList.add('hidden');
    testListen.classList.remove('hidden');
    testListen.disabled = false;
    testMessage.textContent = selectedDictationMode === 'example' ? 'Bấm 🔊 Listen để nghe câu ví dụ.' : 'Bấm 🔊 Listen để nghe từ.';

    dictationWrongAttempts = 0;
    resetForDictationMode();
    if (selectedDictationMode === 'example') {
      speakText(currentEntry.example, currentPlaybackRate);
    } else {
      speakText(currentEntry.word, currentPlaybackRate);
    }
    testTimeout(() => testAnswer.focus(), 120);
  }

  updateTestProgress();
}

function resetLearnSession() {
  clearLearnSpellingAnimation();
  learnQueue = [];
  currentLearnIndex = 0;
  learnRepetitionsPerWord = 1;
  isLearnActionPending = false;
  learnCheck.disabled = false;
  learnKnown.disabled = false;
  isHiddenWord = false;
  learnAnswer.value = '';
  learnMessage.textContent = '';
  setLearnSessionVisibility(false);
}

function resetTestSession() {
  cancelAutoNext();
  cancelSpeakingAutoNext();
  
  // Fully cleanup speech recognition
  stopVoiceRecognition();
  cleanupSpeechSession({ preservePending: false });
  
  isTestTransitioning = false;
  testQueue = [];
  currentTestIndex = 0;
  testScore = 0;
  testWrong = 0;
  dictationWrongAttempts = 0;
  dictationStage = 'word';
  testAnswer.value = '';
  testMessage.textContent = '';
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
  testPrevious?.classList.add('hidden');
  testNext.classList.add('hidden');
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
  testSubmit.classList.remove('hidden');
  testSummary.classList.add('hidden');
  testAnswer.classList.remove('hidden');
  testAnswer.disabled = false;
  testRecord.classList.remove('hidden');
  testListen.classList.remove('hidden');
  testMeaning.textContent = '';
  testExample.textContent = '';
  testInputLabel.textContent = 'Gõ từ';
  testModeLabel.textContent = '';
  testStageLabel.textContent = '';
  setTestSessionVisibility(false);
  sessionActive = false;
}

function moveToNextLearnWord() {
  if (currentLearnIndex + 1 >= learnQueue.length) {
    currentLearnIndex = learnQueue.length;
    learnMessage.textContent = 'Hoàn tất buổi luyện viết. Chúc mừng!';
    setTimeout(resetLearnSession, 1200);
    return;
  }
  currentLearnIndex += 1;
  learnAnswer.value = '';
  learnMessage.textContent = '';
  isHiddenWord = false;
  updateLearnDisplay();
  speakLearnWord(learnQueue[currentLearnIndex]);
  learnAnswer.focus();
}

async function processLearnCheck() {
  if (isLearnActionPending || !sessionActive || !learnQueue[currentLearnIndex]) {
    return;
  }

  const answer = learnAnswer.value;
  if (!answer.trim()) {
    learnMessage.textContent = 'Vui lòng nhập từ để kiểm tra.';
    return;
  }

  const entry = learnQueue[currentLearnIndex];
  const latestEntry = findVocabularyEntry(entry.word);
  if (!latestEntry) {
    learnMessage.textContent = 'Không tìm thấy từ đang luyện. Hãy tải lại danh sách từ.';
    return;
  }

  isLearnActionPending = true;
  learnCheck.disabled = true;
  learnKnown.disabled = true;
  try {
    const correct = isLearnAnswerCorrect(answer, entry);
    const updateFields = { writeCount: latestEntry.writeCount + 1 };
    if (correct) {
      updateFields.correct = latestEntry.correct + 1;
    } else {
      updateFields.wrong = latestEntry.wrong + 1;
    }

    const updatedEntry = await updateVocabularyEntry(entry.word, updateFields);
    if (!updatedEntry) {
      throw new Error('Từ đang luyện không còn trong danh sách.');
    }

    if (correct) {
      learnMessage.textContent = 'Chính xác! Tiếp tục nào.';
      moveToNextLearnWord();
    } else {
      learnMessage.textContent = `Sai rồi. Đáp án: ${entry.word}`;
      displayWord.textContent = entry.word;
      learnNextState();
    }

    renderWordList();
  } catch (error) {
    console.error('Failed to save learn result', error);
    learnMessage.textContent = `Không thể lưu kết quả luyện tập: ${error.message}`;
  } finally {
    isLearnActionPending = false;
    learnCheck.disabled = false;
    learnKnown.disabled = false;
  }
}

function learnNextState() {
  learnAnswer.value = '';
  testTimeout(() => {
    learnAnswer.focus();
  }, 50);
}

async function processLearnKnown() {
  if (isLearnActionPending || !sessionActive || !learnQueue[currentLearnIndex]) {
    return;
  }

  const entry = learnQueue[currentLearnIndex];
  isLearnActionPending = true;
  learnCheck.disabled = true;
  learnKnown.disabled = true;
  try {
    const updatedEntry = await updateVocabularyEntry(entry.word, { learned: true });
    if (!updatedEntry) {
      throw new Error('Từ đang luyện không còn trong danh sách.');
    }

    renderWordList();
    moveToNextLearnWord();
  } catch (error) {
    console.error('Failed to mark learn word as known', error);
    learnMessage.textContent = `Không thể lưu trạng thái từ đã thuộc: ${error.message}`;
  } finally {
    isLearnActionPending = false;
    learnCheck.disabled = false;
    learnKnown.disabled = false;
  }
}

function processLearnToggle() {
  isHiddenWord = toggleWordVisibility(isHiddenWord);
  updateLearnDisplay();
}

function replayLearnWord() {
  const currentEntry = learnQueue[currentLearnIndex];
  if (!currentEntry) {
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  clearLearnSpellingAnimation();
  renderLearnWordDisplay(currentEntry, -1);
  speakLearnWord(currentEntry);
}

function handleSpeakingTestFailure() {
  const entry = testQueue[currentTestIndex];
  if (!entry || selectedTestMode !== 'speaking') {
    return;
  }

  const questionKey = `${entry.word}:${currentTestIndex}`;
  const failureResult = speakingTestFlow.handleFailure(questionKey);
  const attempt = failureResult.attempt;

  if (failureResult.showRetryOptions) {
    testMessage.textContent = failureResult.message;
    testRecord.disabled = true;
    testListen.disabled = true;
    testRetry?.classList.remove('hidden');
    testSkip?.classList.remove('hidden');
    testNext.classList.add('hidden');
  } else {
    testMessage.textContent = failureResult.message;
    testRetry?.classList.add('hidden');
    testSkip?.classList.add('hidden');
    testRecord.disabled = false;
    testListen.disabled = false;
  }

  if (attempt > 0) {
    testMessage.textContent = `${failureResult.message} Attempt: ${attempt}/3`;
  }
}

function handleSpeakingTestSuccess() {
  const entry = testQueue[currentTestIndex];
  if (!entry || selectedTestMode !== 'speaking') {
    return;
  }

  const questionKey = `${entry.word}:${currentTestIndex}`;
  speakingTestFlow.handleSuccess(questionKey);
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
}

function handleSpeakingTestRetry() {
  const entry = testQueue[currentTestIndex];
  if (!entry || selectedTestMode !== 'speaking') {
    return;
  }

  const questionKey = `${entry.word}:${currentTestIndex}`;
  speakingTestFlow.handleRetry(questionKey);
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
  testRecord.disabled = false;
  testListen.disabled = false;
  testMessage.textContent = 'Sẵn sàng để thử lại.';
  logSpeechEvent('speaking-retry');
}

function handleSpeakingTestSkip() {
  const entry = testQueue[currentTestIndex];
  if (!entry || selectedTestMode !== 'speaking') {
    return;
  }

  const questionKey = `${entry.word}:${currentTestIndex}`;
  speakingTestFlow.skipCurrentQuestion(questionKey);
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
  testRecord.disabled = true;
  testListen.disabled = true;
  testMessage.textContent = 'Đã bỏ qua câu hỏi này.';
  
  // CRITICAL: Fully cleanup speech recognition before moving to next question
  stopVoiceRecognition();
  cleanupSpeechSession({ preservePending: false });
  
  // Small delay to ensure cleanup completes
  testTimeout(() => {
    proceedToNextTestQuestion();
  }, 50);
}

function processTestListening(playbackRate = currentPlaybackRate) {
  if (speechStateMachine.getState() !== SPEECH_STATES.IDLE) {
    logSpeechEvent('listen-blocked', { reason: 'busy' });
    return;
  }

  const entry = testQueue[currentTestIndex];
  if (!entry) {
    return;
  }

  if (selectedTestMode === 'speaking') {
    const promptText = getSpeakingPromptText(selectedSpeakingMode, entry);
    resetPronunciationForQuestion(promptText);
    showPronunciationGuide(promptText);
    speakSpeakingPrompt(entry, playbackRate);
    testMessage.textContent = 'Đang phát âm...';
  } else if (selectedDictationMode === 'example') {
    resetForDictationMode();
    speakText(entry.example, playbackRate);
    testMessage.textContent = 'Đã phát âm câu ví dụ.';
  } else {
    resetForDictationMode();
    speakText(entry.word, playbackRate);
    testMessage.textContent = 'Đã phát âm từ.';
  }
}

// Capture spoken input for the speaking test using Web Speech Recognition when available.
function processTestRecording() {
  const entry = testQueue[currentTestIndex];
  if (selectedTestMode !== 'speaking' || !entry) {
    return;
  }

  if (speechStateMachine.getState() === SPEECH_STATES.PLAYING_AUDIO) {
    pendingRecordingAfterPlayback = true;
    logSpeechEvent('recording-queued-after-playback');
    return;
  }

  const stateResult = speechStateMachine.beginRecording();
  if (!stateResult.allowed) {
    logSpeechEvent('recording-blocked', { reason: stateResult.reason });
    return;
  }
  const sessionToken = ++recordingSessionToken;

  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    speechStateMachine.reset();
    testMessage.textContent = getSpeechRecognitionUnsupportedMessage();
    testRecord.disabled = true;
    console.error('SpeechRecognition is not available in this browser.', window);
    return;
  }

  testMessage.textContent = 'Đang nghe...';
  testRecord.textContent = '🎤 Listening...';
  onRecordingStart();
  updateSpeechButtonState();
  logSpeechEvent('recording-started');

  // CRITICAL: Properly cleanup old recognition before creating new one
  // This prevents "dead" recognition from blocking new instances
  stopVoiceRecognition();
  speechStateMachine.clearActiveRecognition();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  let permissionTimeout = null;
  const permissionRequest = Promise.race([
    requestMicrophoneAccess(),
    new Promise((resolve) => {
      permissionTimeout = window.setTimeout(
        () => resolve({ success: false, reason: 'timeout', error: null }),
        MICROPHONE_PERMISSION_TIMEOUT,
      );
    }),
  ]).finally(() => {
    if (permissionTimeout !== null) window.clearTimeout(permissionTimeout);
  });

  void permissionRequest.then(({ success, reason, error }) => {
    if (sessionToken !== recordingSessionToken) return;

    if (!success) {
      speechStateMachine.reset();
      testMessage.textContent = reason === 'timeout'
        ? 'Đang chờ quyền Microphone quá lâu. Hãy kiểm tra quyền mic rồi thử lại.'
        : reason === 'NotAllowedError' || reason === 'PermissionDeniedError' || reason === 'not-allowed'
        ? 'Bạn cần cấp quyền Microphone để sử dụng Speaking Test.'
        : getSpeechRecognitionUnsupportedMessage();
      testRecord.textContent = '🎤 Record';
      testRecord.disabled = false;
      onRecordingStop();
      updateSpeechButtonState();
      console.error('Microphone access request was denied or unavailable.', { reason, error });
      return;
    }

    const recognition = new SpeechRecognition();
  let recordingFinished = false;
    recognition.lang = getSpeechLanguageCode(getCurrentLanguage());
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      logSpeechEvent('recognition-started');
    };

    recognition.onresult = (event) => {
      // Prevent processing if this is not the active session
      if (testRecognition !== recognition) {
        logSpeechEvent('recognition-result-ignored', { reason: 'inactive-session' });
        return;
      }
      if (recordingFinished) return;
      recordingFinished = true;
      if (recordingWatchdog !== null) {
        window.clearTimeout(recordingWatchdog);
        recordingWatchdog = null;
      }
      
      speechStateMachine.beginProcessing();
      updateSpeechButtonState();
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      // Normalize BOTH expected and actual for case-insensitive comparison
      const expected = normalizeText(getSpeakingPromptText(selectedSpeakingMode, entry)).trim();
      const actual = normalizeText(transcript).trim();
      const correct = actual === expected;

      if (correct) {
        testScore += 1;
        testMessage.textContent = '✅ Chính xác.';
        onRecordingStop();
        showPronunciationResult({
          expected,
          actual,
          confidence: 0.9,
          word: entry.word,
          mode: selectedSpeakingMode,
        });
        testListen.disabled = true;
        testRecord.disabled = true;
        testSubmit.disabled = true;
        testNext.classList.remove('hidden');
        testRecord.textContent = '🎤 Record';
        handleSpeakingTestSuccess();
        void playCorrectSound();
        startSpeakingAutoNext();
      } else {
        testWrong += 1;
        testMessage.textContent = `❌ Incorrect. Đáp án đúng: ${expected}`;
        onRecordingStop();
        showPronunciationResult({
          expected,
          actual,
          confidence: 0.4,
          word: entry.word,
          mode: selectedSpeakingMode,
        });
        handleSpeakingTestFailure();
        playWrongSound();
      }

      finalizeSpeechResult();
      testRecord.textContent = '🎤 Record';
    };

    recognition.onerror = (event) => {
      // Prevent processing if this is not the active session
      if (testRecognition !== recognition) {
        logSpeechEvent('recognition-error-ignored', { reason: 'inactive-session' });
        return;
      }
      if (recordingFinished) return;
      recordingFinished = true;
      if (recordingWatchdog !== null) {
        window.clearTimeout(recordingWatchdog);
        recordingWatchdog = null;
      }
      
      const errorCode = event?.error || 'unknown';
      console.error('Speech recognition error', { errorCode, event });
      testMessage.textContent = getSpeechRecognitionErrorMessage(errorCode);
      onRecordingStop();
      testRecord.textContent = '🎤 Record';
      if (selectedTestMode === 'speaking') {
        handleSpeakingTestFailure();
      }
      stopVoiceRecognition();
      speechStateMachine.reset();
      updateSpeechButtonState();
    };

    recognition.onend = () => {
      // Prevent processing if this is not the active session
      if (testRecognition === recognition) {
        testRecognition = null;
      }
      if (!recordingFinished) {
        recordingFinished = true;
        if (recordingWatchdog !== null) {
          window.clearTimeout(recordingWatchdog);
          recordingWatchdog = null;
        }
        testMessage.textContent = 'Không nghe thấy giọng nói. Hãy thử nói lại gần micro hơn.';
        handleSpeakingTestFailure();
      }
      onRecordingStop();
      speechStateMachine.reset();
      testRecord.textContent = '🎤 Record';
      updateSpeechButtonState();
      logSpeechEvent('recognition-ended');
    };

    speechStateMachine.setActiveRecognition(recognition);
    testRecognition = recognition;
    recordingWatchdog = window.setTimeout(() => {
      if (testRecognition !== recognition || recordingFinished) return;
      recordingFinished = true;
      testMessage.textContent = 'Hết thời gian nghe. Hãy thử ghi âm lại.';
      handleSpeakingTestFailure();
      stopVoiceRecognition();
      speechStateMachine.reset();
      testRecord.textContent = '🎤 Record';
      onRecordingStop();
      updateSpeechButtonState();
    }, SPEECH_RECOGNITION_TIMEOUT);
    try {
      recognition.start();
    } catch (error) {
      recordingFinished = true;
      if (recordingWatchdog !== null) {
        window.clearTimeout(recordingWatchdog);
        recordingWatchdog = null;
      }
      stopVoiceRecognition();
      speechStateMachine.reset();
      onRecordingStop();
      testRecord.textContent = '🎤 Record';
      testMessage.textContent = 'Không thể bắt đầu nhận diện giọng nói. Hãy thử lại.';
      updateSpeechButtonState();
      console.error('Speech recognition failed to start.', error);
    }
  });
}

// Validate the user's typed response for the dictation flow and update scores.
function processTestSubmission() {
  const entry = testQueue[currentTestIndex];
  if (!entry || selectedTestMode !== 'dictation') {
    return;
  }

  // Normalize answer: trim, normalize whitespace, lowercase
  const rawAnswer = testAnswer.value;
  const answer = normalizeText(rawAnswer).trim();
  if (!answer) {
    testMessage.textContent = 'Nhập câu trả lời để kiểm tra.';
    return;
  }

  let correct = false;
  let feedback = '';

  if (selectedDictationMode === 'example') {
    const expected = normalizeText(entry.example).trim();
    correct = answer === expected;
    feedback = correct ? '✅ Chính xác.' : '❌ Sai. Hãy thử lại.';
  } else {
    const expected = normalizeText(entry.word).trim();
    correct = answer === expected;
    feedback = correct ? '✅ Chính xác.' : '❌ Sai. Hãy thử lại.';
  }

  if (correct) {
    testScore += 1;
    testMessage.textContent = feedback;
    playCorrectSound();
    testSubmit.classList.add('hidden');
    testNext.classList.add('hidden');
    testAnswer.disabled = true;
    testAnswer.setAttribute('aria-disabled', 'true');
    testSubmit.disabled = true;
    testListen.disabled = true;
    testSkip?.classList.add('hidden');
    if (selectedTestMode === 'dictation') {
      startAutoNext();
    }
  } else {
    dictationWrongAttempts += 1;
    testWrong += 1;
    const questionKey = `${entry.word}:${currentTestIndex}`;
    const failureResult = speakingTestFlow.handleFailure(questionKey);
    if (failureResult.showRetryOptions) {
      testMessage.textContent = `${feedback} ${failureResult.message}`;
      testSkip?.classList.remove('hidden');
      testSubmit.disabled = true;
      testAnswer.focus();
    } else {
      testMessage.textContent = feedback;
      testSkip?.classList.add('hidden');
      testAnswer.focus();
    }
    playWrongSound();
  }
}

function proceedToNextTestQuestion() {
  if (isTestTransitioning) {
    return;
  }

  isTestTransitioning = true;
  cancelAutoNext();
  cancelSpeakingAutoNext();
  
  // Fully cleanup speech recognition before moving to next
  stopVoiceRecognition();
  cleanupSpeechSession({ preservePending: false });
  
  const entry = testQueue[currentTestIndex];
  if (selectedTestMode === 'speaking' && entry) {
    const questionKey = `${entry.word}:${currentTestIndex}`;
    speakingTestFlow.handleSuccess(questionKey);
  }

  if (selectedTestMode === 'dictation') {
    dictationStage = 'word';
    dictationWrongAttempts = 0;  // Reset dictation wrong attempts
  }

  if (currentTestIndex + 1 >= testQueue.length) {
    showTestSummary();
    isTestTransitioning = false;
    return;
  }

  currentTestIndex += 1;
  updateTestDisplay();
  isTestTransitioning = false;
}

function navigateTestQuestion(direction) {
  if (!sessionActive || !testQueue.length) return;

  const nextIndex = getAdjacentQuestionIndex(currentTestIndex, direction, testQueue.length);
  if (nextIndex < 0 || nextIndex === currentTestIndex) return;

  cancelAutoNext();
  cancelSpeakingAutoNext();
  cleanupSpeechSession({ preservePending: false });
  currentTestIndex = nextIndex;
  updateTestDisplay();
}

function startLearnSession() {
  const selectedInput = document.querySelector('input[name="learn-word"]:checked');
  const count = Number(learnCount.value);

  if (!selectedInput) {
    learnFeedback.textContent = 'Vui lòng chọn một từ để luyện.';
    return;
  }

  const words = filterVocabularyByTopic(
    loadVocabulary(),
    learnTopicFilter.value || undefined,
    learnSubtopicFilter.value || undefined,
  );
  const selectedWordIndex = words.findIndex(
    (entry) => normalizeWordKey(entry.word) === normalizeWordKey(selectedInput.value),
  );
  if (selectedWordIndex < 0) {
    learnFeedback.textContent = 'Từ đã chọn không còn trong chủ đề/bài học này. Vui lòng chọn lại.';
    return;
  }

  learnRepetitionsPerWord = count;
  learnQueue = buildLearnQueue(words.slice(selectedWordIndex), count);
  if (!learnQueue.length) {
    learnFeedback.textContent = 'Không thể bắt đầu luyện. Hãy kiểm tra số lượt và danh sách từ.';
    return;
  }

  currentLearnIndex = 0;
  isLearnActionPending = false;
  learnCheck.disabled = false;
  learnKnown.disabled = false;
  isHiddenWord = false;
  selectedLearnReadingMode = normalizeLearnReadingMode(learnReadingMode?.value || selectedLearnReadingMode);
  learnFeedback.textContent = '';
  setLearnSessionVisibility(true);
  updateLearnDisplay();
  speakLearnWord(learnQueue[currentLearnIndex]);
  learnAnswer.value = '';
  testTimeout(() => learnAnswer.focus(), 120);
}

function startTestSession() {
  cancelAutoNext();
  cancelSpeakingAutoNext();
  cleanupSpeechSession({ preservePending: false });
  if (!selectedTestMode) {
    testFeedback.textContent = 'Vui lòng chọn một chế độ Test trước.';
    return;
  }

  const words = getWordsFromFilters(testTopicFilter.value, testSubtopicFilter.value);
  if (!words.length) {
    testFeedback.textContent = 'Không có từ để test theo bộ lọc hiện tại. Vui lòng chọn lại.';
    return;
  }

  testQueue = buildTestQueue(words);
  currentTestIndex = 0;
  isTestTransitioning = false;
  testScore = 0;
  testWrong = 0;
  dictationWrongAttempts = 0;
  dictationStage = 'word';
  testFeedback.textContent = '';
  setTestSessionVisibility(true);
  updateTestDisplay();
  testSummary.classList.add('hidden');
  testSubmit.classList.remove('hidden');
  testRetry?.classList.add('hidden');
  testSkip?.classList.add('hidden');
  testMessage.textContent = '';
  testAnswer.value = '';
  sessionActive = true;
}

function updateDuplicateStatus() {
  const currentWord = inputWord.value.trim();
  if (!currentWord) {
    duplicateStatus.classList.add('hidden');
    duplicateCard.classList.add('hidden');
    duplicateStatus.textContent = '';
    addSubmitButton.disabled = false;
    return;
  }

  const duplicateEntry = findDuplicateVocabularyEntry(getVocabularySnapshot(), currentWord, editingWord || '');
  const duplicateMeaningValue = getMeaningDisplayValue(duplicateEntry, getCurrentMeaningLanguage());
  if (duplicateEntry) {
    duplicateStatus.classList.remove('hidden');
    duplicateStatus.classList.add('is-duplicate');
    duplicateStatus.classList.remove('is-new');
    duplicateStatus.innerHTML = '<span class="duplicate-pill">⚠️ Từ này đã tồn tại trong bộ từ vựng</span>';
    duplicateCard.classList.remove('hidden');
    duplicateCard.innerHTML = `
      <div class="duplicate-card-top">
        <div>
          <h4>${duplicateEntry.word}</h4>
          <p>${duplicateEntry.topic} / ${duplicateEntry.subTopic}</p>
        </div>
        <div class="duplicate-actions">
          <button type="button" class="secondary-button duplicate-action-button" id="duplicate-view">👁 Xem</button>
          <button type="button" class="secondary-button duplicate-action-button" id="duplicate-edit">✏ Chỉnh sửa</button>
        </div>
      </div>
      <div class="duplicate-card-details">
        <p><strong>${getActiveDisplayConfig().meaningLabel}:</strong> ${duplicateMeaningValue}</p>
        <p><strong>Example:</strong> ${duplicateEntry.example}</p>
        <p><strong>IPA:</strong> ${duplicateEntry.ipa || '—'}</p>
      </div>
    `;
    duplicateCard.querySelector('#duplicate-view')?.addEventListener('click', () => scrollToWordCard(duplicateEntry.word));
    duplicateCard.querySelector('#duplicate-edit')?.addEventListener('click', () => {
      startEditMode(duplicateEntry);
      showPage('add');
    });
    addSubmitButton.disabled = true;
    return;
  }

  duplicateStatus.classList.remove('hidden');
  duplicateStatus.classList.remove('is-duplicate');
  duplicateStatus.classList.add('is-new');
  duplicateStatus.innerHTML = '<span class="duplicate-pill duplicate-pill-new">🟢 New Word</span>';
  duplicateCard.classList.add('hidden');
  duplicateCard.innerHTML = '';
  addSubmitButton.disabled = false;
}

function getVocabularySnapshot() {
  if (!vocabulary.length) {
    vocabulary = loadVocabulary();
  }
  return vocabulary;
}

function scrollToWordCard(word) {
  const targetCard = Array.from(wordList.querySelectorAll('.word-item')).find((card) => normalizeWordKey(card.dataset.word) === normalizeWordKey(word));
  if (!targetCard) {
    return;
  }

  targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  targetCard.classList.add('is-highlighted');
  if (duplicateHighlightTimer) {
    window.clearTimeout(duplicateHighlightTimer);
  }
  duplicateHighlightTimer = window.setTimeout(() => {
    targetCard.classList.remove('is-highlighted');
  }, 2400);
}

function renderWordSuggestions() {
  const query = inputWord.value.trim();
  const suggestions = filterWordSuggestions(getVocabularySnapshot(), query, 10);
  wordSuggestionItems = suggestions;

  if (!query || !suggestions.length) {
    hideWordSuggestions();
    return;
  }

  wordSuggestions.innerHTML = suggestions
    .map(
      (entry, index) => `
        <li class="suggestion-item ${index === activeSuggestionIndex ? 'active' : ''}" role="option" data-word="${entry.word}">
          ${entry.word}
        </li>
      `,
    )
    .join('');

  wordSuggestions.classList.remove('hidden');
}

function hideWordSuggestions() {
  wordSuggestions.classList.add('hidden');
  wordSuggestions.innerHTML = '';
  activeSuggestionIndex = -1;
  wordSuggestionItems = [];
}

function selectSuggestion() {
  const targetIndex = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0;
  const selected = wordSuggestionItems[targetIndex];
  if (!selected) {
    return false;
  }

  if (inputWord) inputWord.value = selected.word;
  hideWordSuggestions();
  return true;
}

function startEditMode(entry) {
  editingWord = entry.word;
  addSubmitButton.textContent = 'Cập nhật';
  addSubmitButton.disabled = false;
  addCancelButton.classList.remove('hidden');
  addFeedback.textContent = '';

  const topic = entry.topic || DEFAULT_TOPIC;
  const subTopic = entry.subTopic || DEFAULT_SUBTOPIC;
  const exampleValue = entry.example || entry.basicExample || entry.examples?.basic || entry.examples?.example || '';
  refreshAddFormTopicList(topic);
  inputTopic.value = topic;
  refreshAddFormSubtopicList(topic, subTopic);
  inputSubtopic.value = subTopic;
  inputType.value = entry.type || DEFAULT_TYPE;
  inputPartOfSpeech.value = entry.partOfSpeech || entry.pos || '';
  inputWord.value = entry.word || '';
  const entryMeanings = entry.meanings && typeof entry.meanings === 'object' ? entry.meanings : {};
  inputMeaning.value = entryMeanings.english || entry.englishDefinition || '';
  inputVietnameseMeaning.value = entryMeanings.vietnamese || entry.vietnameseMeaning || (!entryMeanings.english ? entry.meaning || '' : '');
  inputIpa.value = entry.ipa || '';
  // definition removed from form
  const normalizedSynonyms = normalizeSupportList(entry.synonyms);
  const normalizedAntonyms = normalizeSupportList(entry.antonyms);
  if (inputFixedPhrases) {
    inputFixedPhrases.value = normalizeSupportList(entry.fixedExpressions || entry.fixedPhrases).map((item) => item.word).join(', ');
  }
  currentMeaningsAnalysis = (entry.meaningsAnalysis && Array.isArray(entry.meaningsAnalysis)) ? entry.meaningsAnalysis : [];
  currentSupportSynonyms = normalizedSynonyms;
  currentSupportAntonyms = normalizedAntonyms;
  currentSupportWordFamily = normalizeSupportList(entry.wordFamily);
  currentSupportFixedPhrases = normalizeSupportList(entry.fixedExpressions || entry.fixedPhrases);
  currentSupportCollocations = normalizeSupportList(entry.collocations);
  currentSupportSentencePatterns = normalizeSupportList(entry.sentencePatterns);
  currentSupportCommonExpressions = normalizeSupportList(entry.commonExpressions);
  currentSupportCommonMistakes = normalizeSupportList(entry.commonMistakes);
  if (inputExample) inputExample.value = exampleValue;
  syncExampleTextareaHeights();
  hideWordSuggestions();
  updateDuplicateStatus();
  renderSupportEditorSections();
  if (inputWord && typeof inputWord.focus === 'function') inputWord.focus();
}

// ===== AI EXPANSION PIPELINE =====

function getAIExpansionContext() {
  const word = inputWord?.value?.trim() || '';
  return {
    word,
    meaning: inputMeaning?.value?.trim() || '',
    topic: inputTopic?.value || '',
    subTopic: inputSubtopic?.value || '',
  };
}

function setImageImportStatus(message, isError = false) {
  if (!imageImportStatus) {
    return;
  }
  imageImportStatus.textContent = message;
  imageImportStatus.classList.toggle('is-error', isError);
}

function updateImageImportVisibility() {
  const isImageMode = inputModeImage?.checked;
  if (!imageImportPanel) {
    return;
  }
  imageImportPanel.classList.toggle('hidden', !isImageMode);
}

function showImagePreview(src) {
  if (!imageImportPreview || !imageImportPreviewImg) {
    return;
  }
  imageImportPreviewImg.src = src;
  imageImportPreview.classList.remove('hidden');
}

function clearImagePreview() {
  if (!imageImportPreview || !imageImportPreviewImg) {
    return;
  }
  imageImportPreviewImg.src = '';
  imageImportPreview.classList.add('hidden');
}

async function runOCRFile(file) {
  if (!file) {
    throw new Error('Không có ảnh để đọc.');
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.readAsDataURL(file);
  });

  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('Không thể đọc ảnh.');
  }

  showImagePreview(dataUrl);
  setImageImportStatus('⏳ Đang đọc ảnh...');

  try {
    const { analyzeImageWithGeminiVision } = await import('./services/gemini-vision.js');
    const parsed = await analyzeImageWithGeminiVision(dataUrl);
    console.log('DATA FLOW - OCR Result:', parsed);
    if (!parsed || !parsed.word) {
      throw new Error('Gemini Vision không đọc được nội dung ảnh.');
    }
    return parsed;
  } catch (error) {
    throw new Error(error?.message || 'Lỗi OCR. Vui lòng chọn ảnh rõ hơn.');
  }
}

async function applyOCRResult(parsed) {
  if (!parsed) {
    return;
  }
  console.log('DATA FLOW - Filled Form (before apply):', {
    word: inputWord?.value,
    type: inputType?.value,
    ipa: inputIpa?.value,
    meaning: inputMeaning?.value,
    example: inputExample?.value,
    englishMeaning: parsed.englishMeaning,
    vietnameseMeaning: parsed.vietnameseMeaning,
    rawMeaning: parsed.meaning,
  });
  if (parsed.word) inputWord.value = parsed.word;
  if (parsed.type) inputType.value = parsed.type;
  if (parsed.ipa) inputIpa.value = parsed.ipa;

  const currentMeaningLanguage = getCurrentMeaningLanguage();
  if (currentMeaningLanguage === 'vietnamese') {
    if (parsed.vietnameseMeaning) {
      inputVietnameseMeaning.value = parsed.vietnameseMeaning;
    } else if (parsed.englishMeaning) {
      inputMeaning.value = parsed.englishMeaning;
    } else if (parsed.meaning) {
      inputMeaning.value = parsed.meaning;
    }
  } else {
    if (parsed.englishMeaning) {
      inputMeaning.value = parsed.englishMeaning;
    } else if (parsed.vietnameseMeaning) {
      inputVietnameseMeaning.value = parsed.vietnameseMeaning;
    } else if (parsed.meaning) {
      inputMeaning.value = parsed.meaning;
    }
  }

  if (parsed.example) inputExample.value = parsed.example;

  console.log('DATA FLOW - Filled Form (after apply):', {
    word: inputWord?.value,
    type: inputType?.value,
    ipa: inputIpa?.value,
    meaning: inputMeaning?.value,
    vietnameseMeaning: inputVietnameseMeaning?.value,
    example: inputExample?.value,
  });

  await handleGenerateAll();
}

async function processImageImport(file) {
  if (!file) {
    setImageImportStatus('Vui lòng chọn ảnh để import.', true);
    return;
  }
  currentImageImportFile = file;
  try {
    const parsed = await runOCRFile(file);
    setImageImportStatus('✅ OCR thành công. Đang tự động mở rộng AI...');
    await applyOCRResult(parsed);
    setImageImportStatus('✅ Đã điền form và chạy AI Expansion.');
  } catch (error) {
    setImageImportStatus(error.message || 'Không đọc được ảnh. Vui lòng chọn ảnh rõ hơn.', true);
  }
}

function getImageFileFromClipboard(clipboardData) {
  const files = Array.from(clipboardData?.files || []);
  const imageFile = files.find((file) => file.type.startsWith('image/'));
  if (imageFile) {
    return imageFile;
  }

  const items = Array.from(clipboardData?.items || []);
  for (const item of items) {
    if (item.kind !== 'file' && !item.type.startsWith('image/')) {
      continue;
    }
    const file = item.getAsFile();
    if (file?.type.startsWith('image/')) {
      return file;
    }
  }
  return null;
}

async function handleImagePaste(event) {
  if (!inputModeImage?.checked) {
    return;
  }
  const file = getImageFileFromClipboard(event.clipboardData);
  if (!file) {
    setImageImportStatus('Clipboard không có ảnh. Hãy chụp/copy ảnh rồi nhấn Ctrl+V, hoặc chọn file ảnh.', true);
    return;
  }
  event.preventDefault();
  await processImageImport(file);
}

async function handleImageImportFileChange() {
  if (!imageImportInput || !imageImportInput.files) {
    return;
  }
  const file = imageImportInput.files[0];
  if (!file) {
    return;
  }
  await processImageImport(file);
}

function handleImageImportChange() {
  if (!imageImportInput) {
    return;
  }
  imageImportInput.click();
}

function handleImageImportClear() {
  currentImageImportFile = null;
  if (imageImportInput) imageImportInput.value = '';
  clearImagePreview();
  setImageImportStatus('');
}

function handleImageImportRerun() {
  const file = currentImageImportFile || imageImportInput?.files?.[0];
  if (!file) {
    setImageImportStatus('Vui lòng chọn ảnh để chạy lại OCR.', true);
    return;
  }
  void processImageImport(file);
}

async function handleAIStep(stepKey) {
  const ctx = getAIExpansionContext();
  if (!ctx.word) { addFeedback.textContent = 'Vui lòng nhập từ trước.'; return; }
  addFeedback.textContent = '⏳ Đang tạo ' + stepKey + '...';
  try {
    const result = await runStep(stepKey, ctx.word, ctx);
    if (result.success) {
      const uiState = mapResultsToUIState([result]);
      if (stepKey === 'basic') {
        if (result.data?.ipa) inputIpa.value = result.data.ipa;
        if (result.data?.example) inputExample.value = result.data.example;
      }
      if (uiState.synonyms) currentSupportSynonyms = mergeSupportLists(currentSupportSynonyms, uiState.synonyms);
      if (uiState.antonyms) currentSupportAntonyms = mergeSupportLists(currentSupportAntonyms, uiState.antonyms);
      if (uiState.wordFamily) currentSupportWordFamily = mergeSupportLists(currentSupportWordFamily, uiState.wordFamily);
      if (uiState.collocations) currentSupportCollocations = mergeSupportLists(currentSupportCollocations, uiState.collocations);
      if (uiState.sentencePatterns) currentSupportSentencePatterns = mergeSupportLists(currentSupportSentencePatterns, uiState.sentencePatterns);
      renderSupportEditorSections();
      addFeedback.textContent = '✅ Đã tạo ' + stepKey + ' thành công.';
    } else {
      addFeedback.textContent = '❌ Lỗi ' + stepKey + ': ' + (result.error || 'Không xác định');
    }
  } catch (err) {
    addFeedback.textContent = '❌ Lỗi ' + stepKey + ': ' + err.message;
  }
}

async function handleGenerateAll() {
  const ctx = getAIExpansionContext();
  if (!ctx.word) { addFeedback.textContent = 'Vui lòng nhập từ trước.'; return; }
  aiGenerateBtn.disabled = true;
  aiGenerateBtn.textContent = '⏳ Đang phân tích từ...';
  addFeedback.textContent = '⏳ Đang phân tích tất cả nghĩa (bước 1/2)...';
  try {
    console.log('DATA FLOW - Before AI Expansion:', {
      word: ctx.word,
      meaning: ctx.meaning,
      ipa: inputIpa?.value,
      example: inputExample?.value,
      type: inputType?.value,
      supportCollocations: currentSupportCollocations,
      supportSynonyms: currentSupportSynonyms,
      supportAntonyms: currentSupportAntonyms,
      supportWordFamily: currentSupportWordFamily,
    });
    const results = await generateAll(ctx.word, ctx);
    const uiState = mapResultsToUIState(results);
    console.log('DATA FLOW - After AI Expansion results:', results);
    
    // 1. meaningsAnalysis — per-meaning data
    if (uiState.meaningsAnalysis && uiState.meaningsAnalysis.length) {
      currentMeaningsAnalysis = uiState.meaningsAnalysis;
      addFeedback.textContent = '✅ Phân tích nghĩa xong. Đang điền dữ liệu...';
    }
    
    // 2. Auto-fill basic fields from aggregated data
    if (uiState._aggregated && uiState._aggregated.basic) {
      const agg = uiState._aggregated;
      if (agg.basic.partOfSpeech) inputPartOfSpeech.value = agg.basic.partOfSpeech;
      if (agg.basic.ipa) inputIpa.value = agg.basic.ipa;
      if (agg.basic.example) inputExample.value = agg.basic.example;
      if (agg.basic.definition) inputMeaning.value = agg.basic.definition;
      if (agg.basic.meaning) inputVietnameseMeaning.value = agg.basic.meaning;
    }
    
    // Also try from basic step directly
    const basicResult = results.find(r => r.step === 'basic');
    if (basicResult?.success && basicResult.data) {
      if (basicResult.data.partOfSpeech) inputPartOfSpeech.value = basicResult.data.partOfSpeech;
      if (basicResult.data.ipa && !inputIpa.value) inputIpa.value = basicResult.data.ipa;
      if (basicResult.data.example && !inputExample.value) inputExample.value = basicResult.data.example;
      if (basicResult.data.definition) inputMeaning.value = basicResult.data.definition;
      if (basicResult.data.meaning) inputVietnameseMeaning.value = basicResult.data.meaning;
    }
    
    // 3. Auto-fill flat support lists from aggregated data
    if (uiState._aggregated) {
      const agg = uiState._aggregated;
      if (agg.synonyms && agg.synonyms.length) currentSupportSynonyms = mergeSupportLists(currentSupportSynonyms, agg.synonyms);
      if (agg.antonyms && agg.antonyms.length) currentSupportAntonyms = mergeSupportLists(currentSupportAntonyms, agg.antonyms);
      if (agg.wordFamily && agg.wordFamily.length) currentSupportWordFamily = mergeSupportLists(currentSupportWordFamily, agg.wordFamily);
      if (agg.fixedPhrases && agg.fixedPhrases.length) currentSupportFixedPhrases = mergeSupportLists(currentSupportFixedPhrases, agg.fixedPhrases);
      if (agg.collocations && agg.collocations.length) currentSupportCollocations = mergeSupportLists(currentSupportCollocations, agg.collocations);
      if (agg.sentencePatterns && agg.sentencePatterns.length) currentSupportSentencePatterns = mergeSupportLists(currentSupportSentencePatterns, agg.sentencePatterns);
      if (agg.commonExpressions && agg.commonExpressions.length) currentSupportCommonExpressions = mergeSupportLists(currentSupportCommonExpressions, agg.commonExpressions);
      if (agg.commonMistakes && agg.commonMistakes.length) currentSupportCommonMistakes = mergeSupportLists(currentSupportCommonMistakes, agg.commonMistakes);
    }
    
    renderSupportEditorSections();
    console.log('DATA FLOW - After AI Expansion UI state:', {
      meaning: inputMeaning?.value,
      example: inputExample?.value,
      ipa: inputIpa?.value,
      currentSupportCollocations,
      currentSupportSynonyms,
      currentSupportAntonyms,
      currentSupportWordFamily,
      currentMeaningsAnalysisLength: currentMeaningsAnalysis.length,
    });
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const meaningsCount = currentMeaningsAnalysis.length;
    if (failCount === 0) {
      addFeedback.textContent = `✅ Hoàn thành ${results.length} bước. Phát hiện ${meaningsCount} nghĩa. Dữ liệu đã điền vào form.`;
    } else {
      addFeedback.textContent = `✅ ${successCount} bước thành công, ${failCount} bước thất bại. ${meaningsCount} nghĩa được phát hiện.`;
    }
  } catch (err) {
    addFeedback.textContent = '❌ Lỗi: ' + err.message;
  } finally {
    aiGenerateBtn.disabled = false;
    aiGenerateBtn.textContent = '✨ AI Generate';
  }
}

function bindEvents() {
  pageButtons.forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.page));
  });

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const wasEditing = Boolean(editingWord);
    const word = inputWord?.value?.trim() || '';
    const englishDefinition = inputMeaning?.value?.trim() || '';
    const vietnameseMeaning = inputVietnameseMeaning?.value?.trim() || '';
    const partOfSpeech = inputPartOfSpeech?.value?.trim() || '';
    const existingMeanings = (editingWord ? vocabulary.find((item) => normalizeWordKey(item.word) === normalizeWordKey(editingWord)) : null)?.meanings || {};
    let meanings = buildMeaningMap(existingMeanings, 'english', englishDefinition);
    meanings = buildMeaningMap(meanings, 'vietnamese', vietnameseMeaning);
    let ipa = inputIpa?.value?.trim() || '';
    const parsedSynonyms = normalizeSupportList(currentSupportSynonyms);
    const parsedAntonyms = normalizeSupportList(currentSupportAntonyms);
    const parsedWordFamily = normalizeSupportList(currentSupportWordFamily);
    const parsedFixedPhrases = normalizeSupportList(inputFixedPhrases?.value || '');
    const parsedCollocations = normalizeSupportList(currentSupportCollocations);
    const parsedSentencePatterns = normalizeSupportList(currentSupportSentencePatterns);
    const parsedCommonExpressions = normalizeSupportList(currentSupportCommonExpressions);
    const parsedCommonMistakes = normalizeSupportList(currentSupportCommonMistakes);
    const synonyms = mergeSupportLists(currentSupportSynonyms, parsedSynonyms);
    const antonyms = mergeSupportLists(currentSupportAntonyms, parsedAntonyms);
    const wordFamily = mergeSupportLists(currentSupportWordFamily, parsedWordFamily);
    const fixedPhrases = mergeSupportLists(currentSupportFixedPhrases, parsedFixedPhrases);
    const collocations = mergeSupportLists(currentSupportCollocations, parsedCollocations);
    const sentencePatterns = mergeSupportLists(currentSupportSentencePatterns, parsedSentencePatterns);
    const commonExpressions = mergeSupportLists(currentSupportCommonExpressions, parsedCommonExpressions);
    const commonMistakes = mergeSupportLists(currentSupportCommonMistakes, parsedCommonMistakes);
    const needsSupportEnrichment = (items) => Array.isArray(items) && items.some((item) => item && item.word && !item.meaning);
    const enrichedSynonyms = needsSupportEnrichment(synonyms) ? await enrichSupportEntriesWithMeanings(synonyms) : synonyms;
    const enrichedAntonyms = needsSupportEnrichment(antonyms) ? await enrichSupportEntriesWithMeanings(antonyms) : antonyms;
    const example = inputExample?.value?.trim() || '';
    const examples = { basic: example };
    const meaningsAnalysis = currentMeaningsAnalysis;
    let topic = inputTopic.value;
    let subTopic = inputSubtopic.value;
    let type = inputType?.value || DEFAULT_TYPE;

    if (!word || !englishDefinition) {
      addFeedback.textContent = 'Vui lòng nhập đủ thông tin.';
      return;
    }

    if (topic === ADD_TOPIC_VALUE) {
      const newTopic = promptForNewTopic();
      if (!newTopic) {
        return;
      }
      topic = newTopic;
    }

    // Check if subtopic is in "not selected" state
    if (subTopic === SUBTOPIC_NOT_SELECTED_VALUE) {
      addFeedback.textContent = 'Vui lòng chọn Sub Topic.';
      return;
    }

    if (subTopic === ADD_SUBTOPIC_VALUE) {
      const activeTopic = topic === ADD_TOPIC_VALUE ? DEFAULT_TOPIC : topic;
      const newSubTopic = promptForNewSubTopic(activeTopic);
      if (!newSubTopic) {
        return;
      }
      subTopic = newSubTopic;
    }

    if (!ipa) {
      ipa = await fetchWordIpa(word);
    }

    const duplicateEntry = findDuplicateVocabularyEntry(getVocabularySnapshot(), word, editingWord || '');
    if (duplicateEntry) {
      addFeedback.textContent = 'Word already exists.';
      updateDuplicateStatus();
      return;
    }

    try {
      const submissionPayload = {
        word,
        meaning: englishDefinition,
        definition: englishDefinition,
        vietnameseMeaning,
        partOfSpeech,
        example,
        ipa,
        synonyms: enrichedSynonyms,
        antonyms: enrichedAntonyms,
        wordFamily,
        fixedPhrases,
        fixedExpressions: fixedPhrases,
        collocations,
        sentencePatterns,
        commonExpressions,
        commonMistakes,
        topic,
        subTopic,
        type,
        meanings,
        examples,
        meaningsAnalysis,
      };
      console.log('DATA FLOW - Before Save Submission Payload:', submissionPayload);
      if (editingWord) {
          await updateVocabularyEntryByWord(editingWord, submissionPayload);
      } else {
          await addVocabularyEntry(submissionPayload);
      }

      resetAddForm();
      addFeedback.textContent = wasEditing ? 'Cập nhật thành công.' : 'Lưu từ thành công.';
      refreshFilterControls();
      renderWordList();
      renderLearnSelection();
      renderTestState();
      if (!wasEditing) {
        addForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        inputWord?.focus({ preventScroll: true });
      }
    } catch (error) {
      addFeedback.textContent = error.message;
    }
  });

  addCancelButton.addEventListener('click', () => {
    resetAddForm();
  });

  inputWord.addEventListener('input', () => {
    activeSuggestionIndex = -1;
    renderWordSuggestions();
    updateDuplicateStatus();
  });

  inputExample?.addEventListener('input', () => autoResizeTextarea(inputExample));
  aiExpansionEditor?.addEventListener('click', handleSupportEditorAction);

  aiGenerateBtn?.addEventListener('click', handleGenerateAll);

  inputWord.addEventListener('focus', () => {
    renderWordSuggestions();
    updateDuplicateStatus();
  });

  inputWord.addEventListener('blur', () => {
    window.setTimeout(() => {
      hideWordSuggestions();
    }, 140);
  });

  inputWord.addEventListener('keydown', (event) => {
    if (!wordSuggestionItems.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex + 1) % wordSuggestionItems.length;
      renderWordSuggestions();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestionIndex = activeSuggestionIndex <= 0 ? wordSuggestionItems.length - 1 : activeSuggestionIndex - 1;
      renderWordSuggestions();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      if (selectSuggestion()) {
        return;
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideWordSuggestions();
    }
  });

  wordSuggestions.addEventListener('mousedown', (event) => {
    const suggestionItem = event.target.closest('.suggestion-item');
    if (!suggestionItem) {
      return;
    }

    event.preventDefault();
    inputWord.value = suggestionItem.dataset.word;
    hideWordSuggestions();
    inputMeaning.focus();
  });

  wordList.addEventListener('click', async (event) => {
    const editButton = event.target.closest('.edit-word');
    if (editButton) {
      const wordItem = editButton.closest('.word-item');
      if (!wordItem) {
        return;
      }
      const entryToEdit = vocabulary.find((item) => normalizeWordKey(item.word) === normalizeWordKey(wordItem.dataset.word));
      if (entryToEdit) {
        startEditMode(entryToEdit);
      }
      return;
    }

    const deleteButton = event.target.closest('.delete-word');
    if (!deleteButton) {
      return;
    }
    const wordItem = deleteButton.closest('.word-item');
    if (!wordItem) {
      return;
    }
    const wordToDelete = wordItem.dataset.word;
    await removeVocabularyEntry(wordToDelete);
    resetAddForm();
    refreshFilterControls();
    renderWordList();
    renderLearnSelection();
    renderTestState();
  });

  inputTopic.addEventListener('focus', () => {
    inputTopic.dataset.previousValue = inputTopic.value;
  });

  inputTopic.addEventListener('change', async () => {
    updateDuplicateStatus();
    if (inputTopic.value === ADD_TOPIC_VALUE) {
      const previousTopic = inputTopic.dataset.previousValue || DEFAULT_TOPIC;
      const newTopic = await promptForNewTopic();
      if (newTopic) {
        refreshAddFormTopicList(newTopic);
        inputTopic.value = newTopic;
        loadAddFormSubtopicListNotSelected(newTopic);
      } else {
        refreshAddFormTopicList(previousTopic);
        inputTopic.value = previousTopic;
      }
      return;
    }
    // When user actively changes to a different topic, reset subtopic to "not selected" state
    loadAddFormSubtopicListNotSelected(inputTopic.value);
  });

  inputSubtopic.addEventListener('focus', () => {
    inputSubtopic.dataset.previousValue = inputSubtopic.value;
  });

  inputSubtopic.addEventListener('change', async () => {
    updateDuplicateStatus();
    if (inputSubtopic.value === ADD_SUBTOPIC_VALUE) {
      const topicName = inputTopic.value === ADD_TOPIC_VALUE ? DEFAULT_TOPIC : inputTopic.value;
      const previousSubTopic = inputSubtopic.dataset.previousValue || DEFAULT_SUBTOPIC;
      const newSubTopic = await promptForNewSubTopic(topicName);
      if (newSubTopic) {
        refreshAddFormSubtopicList(topicName, newSubTopic);
        inputSubtopic.value = newSubTopic;
      } else {
        refreshAddFormSubtopicList(topicName, previousSubTopic);
        inputSubtopic.value = previousSubTopic;
      }
    }
  });

  inputModeManual?.addEventListener('change', () => {
    updateImageImportVisibility();
    if (imageImportPanel) {
      currentImageImportFile = null;
      setImageImportStatus('');
      clearImagePreview();
      imageImportInput.value = '';
    }
  });

  inputModeImage?.addEventListener('change', () => {
    updateImageImportVisibility();
    setImageImportStatus('Paste ảnh hoặc chọn file để import.');
  });

  imageImportInput?.addEventListener('change', () => {
    void handleImageImportFileChange();
  });

  imageImportChange?.addEventListener('click', handleImageImportChange);
  imageImportClear?.addEventListener('click', handleImageImportClear);
  imageImportRerun?.addEventListener('click', handleImageImportRerun);

  document.addEventListener('paste', (event) => {
    void handleImagePaste(event);
  }, true);

  document.getElementById('rename-topic')?.addEventListener('click', async () => {
    const topicName = getActiveTopicValue();
    const newTopicName = promptForRenameTopic(topicName);
    if (!newTopicName) {
      return;
    }

    try {
      await renameTopic(topicName, newTopicName);
      addFeedback.textContent = 'Đổi tên Topic thành công.';
      refreshAddFormTopicList(newTopicName);
      refreshFilterControls();
      renderWordList();
      renderLearnSelection();
      renderTestState();
    } catch (error) {
      addFeedback.textContent = error.message;
    }
  });

  document.getElementById('delete-topic')?.addEventListener('click', async () => {
    const topicName = getActiveTopicValue();
    if (!topicName || !window.confirm(`Xóa Topic "${topicName}" và tất cả từ liên quan?`)) {
      return;
    }

    try {
      await deleteTopic(topicName);
      addFeedback.textContent = 'Topic đã được xóa.';
      refreshAddFormTopicList(DEFAULT_TOPIC);
      refreshFilterControls();
      renderWordList();
      renderLearnSelection();
      renderTestState();
    } catch (error) {
      addFeedback.textContent = error.message;
    }
  });

  document.getElementById('rename-subtopic')?.addEventListener('click', async () => {
    const topicName = getActiveTopicValue();
    const subTopicName = getActiveSubTopicValue();
    const newSubTopicName = promptForRenameSubTopic(topicName, subTopicName);
    if (!newSubTopicName) {
      return;
    }

    try {
      await renameSubTopic(topicName, subTopicName, newSubTopicName);
      addFeedback.textContent = 'Đổi tên Sub Topic thành công.';
      refreshAddFormSubtopicList(topicName, newSubTopicName);
      refreshFilterControls();
      renderWordList();
      renderLearnSelection();
      renderTestState();
    } catch (error) {
      addFeedback.textContent = error.message;
    }
  });

  document.getElementById('delete-subtopic')?.addEventListener('click', async () => {
    const topicName = getActiveTopicValue();
    const subTopicName = getActiveSubTopicValue();
    if (!subTopicName || !window.confirm(`Xóa Sub Topic "${subTopicName}" và tất cả từ liên quan?`)) {
      return;
    }

    try {
      await deleteSubTopic(topicName, subTopicName);
      addFeedback.textContent = 'Sub Topic đã được xóa.';
      refreshAddFormSubtopicList(topicName, DEFAULT_SUBTOPIC);
      refreshFilterControls();
      renderWordList();
      renderLearnSelection();
      renderTestState();
    } catch (error) {
      addFeedback.textContent = error.message;
    }
  });

  learnTopicFilter.addEventListener('change', () => {
    updateLearnFilterSubtopics();
    renderLearnSelection();
  });

  learnSubtopicFilter.addEventListener('change', () => {
    renderLearnSelection();
  });

  sortBySelect?.addEventListener('change', () => {
    renderWordList();
  });

  filterTopicSelect?.addEventListener('change', () => {
    updateVocabFilterSubtopics();
    renderWordList();
  });

  filterSubtopicSelect?.addEventListener('change', () => {
    renderWordList();
  });

  filterStatusSelect?.addEventListener('change', () => {
    renderWordList();
  });

  languageSelect?.addEventListener('change', async () => {
    setCurrentLanguage(languageSelect.value);
    renderLanguageSelector();
    updateDynamicLabels();
    await ensureVocabularyLoaded();
    await ensurePreferencesLoaded();
    refreshAddFormTopicList();
    refreshFilterControls();
    renderWordList();
    renderLearnSelection();
    renderTestState();
    updateDuplicateStatus();
  });

  meaningLanguageSelect?.addEventListener('change', () => {
    setCurrentMeaningLanguage(meaningLanguageSelect.value);
    renderMeaningLanguageSelector();
    updateDynamicLabels();
    renderWordList();
    if (learnQueue[currentLearnIndex]) {
      updateLearnDisplay();
    }
  });

  filterTypeSelect?.addEventListener('change', () => {
    renderWordList();
  });

  testTopicFilter.addEventListener('change', () => {
    updateTestFilterSubtopics();
    renderTestState();
  });

  testSubtopicFilter.addEventListener('change', () => {
    renderTestState();
  });

  learnReadingMode?.addEventListener('change', () => {
    selectedLearnReadingMode = normalizeLearnReadingMode(learnReadingMode.value);
    if (sessionActive && learnQueue[currentLearnIndex]) {
      speakLearnWord(learnQueue[currentLearnIndex]);
    }
  });

  const pronunciationSpeedSelect = document.getElementById('pronunciation-speed-select');
  pronunciationSpeedSelect?.addEventListener('change', (event) => {
    setPlaybackRate(event.target.value);
    if (selectedTestMode === 'dictation' && testQueue[currentTestIndex]) {
      processTestListening();
    }
  });

  learnStart.addEventListener('click', startLearnSession);
  learnCheck.addEventListener('click', processLearnCheck);
  learnKnown.addEventListener('click', processLearnKnown);
  learnToggle.addEventListener('click', processLearnToggle);
  learnReplay.addEventListener('click', replayLearnWord);

  testModeSpeaking.addEventListener('click', () => setSelectedTestMode('speaking'));
  testModeDictation.addEventListener('click', () => setSelectedTestMode('dictation'));
  testStart.addEventListener('click', startTestSession);
  testListen.addEventListener('click', processTestListening);
  testRecord.addEventListener('click', processTestRecording);
  testSubmit.addEventListener('click', processTestSubmission);
  testPrevious?.addEventListener('click', () => navigateTestQuestion(-1));
  testNext.addEventListener('click', () => navigateTestQuestion(1));
  testRetry?.addEventListener('click', handleSpeakingTestRetry);
  testSkip?.addEventListener('click', handleSpeakingTestSkip);
  soundToggle?.addEventListener('click', () => {
    setSoundEnabled(!soundEnabled);
  });
  testRestart.addEventListener('click', () => {
    resetTestSession();
    testFeedback.textContent = 'Bạn có thể bắt đầu lại test bất cứ lúc nào.';
  });

  speakingModeSelect?.addEventListener('change', () => {
    selectedSpeakingMode = normalizeSpeakingMode(speakingModeSelect.value);
    if (selectedTestMode === 'speaking' && testQueue[currentTestIndex]) {
      updateTestDisplay();
    }
  });

  dictationModeSelect?.addEventListener('change', () => {
    selectedDictationMode = normalizeDictationMode(dictationModeSelect.value);
    if (selectedTestMode === 'dictation' && testQueue[currentTestIndex]) {
      updateTestDisplay();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.activeElement === learnAnswer) {
      event.preventDefault();
      processLearnCheck();
    }

    if (event.key === 'Enter' && document.activeElement === testAnswer) {
      event.preventDefault();
      if (testSubmit.classList.contains('hidden')) {
        proceedToNextTestQuestion();
      } else {
        processTestSubmission();
      }
    }
  });
}


async function initializeApp() {
  initializeOfflineCache();
  bindEvents();
  showPage(window.__vocabularyTrainerPage || 'add');
  setSelectedTestMode('');
  speakingModeWrapper?.classList.add('hidden');
  dictationModeWrapper?.classList.add('hidden');
  initPronunciationUI({
    speakPromptSlow: () => {
      const slowRate = getSlowPlaybackRate(currentPlaybackRate);
      if (selectedTestMode === 'speaking') {
        const currentEntry = testQueue[currentTestIndex];
        if (currentEntry) {
          const promptText = getSpeakingPromptText(selectedSpeakingMode, currentEntry);
          resetPronunciationForQuestion(promptText);
          showPronunciationGuide(promptText);
          speakSpeakingPrompt(currentEntry, slowRate);
        }
      } else if (selectedTestMode === 'dictation') {
        processTestListening(slowRate);
      }
    },
    stopRecording: () => {
      if (testRecognition) {
        stopVoiceRecognition();
        speechStateMachine.reset();
        onRecordingStop();
        testRecord.textContent = '🎤 Record';
        testMessage.textContent = 'Đã dừng ghi âm.';
        updateSpeechButtonState();
      }
    },
    startPronunciationForWord: (word) => {
      selectedTestMode = 'speaking';
      setSelectedTestMode('speaking');
      if (word && vocabulary.some((entry) => normalizeWordKey(entry.word) === normalizeWordKey(word))) {
        const entry = vocabulary.find((item) => normalizeWordKey(item.word) === normalizeWordKey(word));
        if (entry) {
          testQueue = [entry];
          currentTestIndex = 0;
          updateTestDisplay();
        }
      }
    },
  });
  initializeAudio();
  renderLanguageSelector();
  renderMeaningLanguageSelector();
  updateDynamicLabels();
  window.addEventListener('vocabulary-storage-updated', () => {
    // Preserve current topic and subtopic selections
    const currentTopic = inputTopic.value && inputTopic.value !== ADD_TOPIC_VALUE ? inputTopic.value : DEFAULT_TOPIC;
    const currentSubTopic = inputSubtopic.value && inputSubtopic.value !== SUBTOPIC_NOT_SELECTED_VALUE ? inputSubtopic.value : DEFAULT_SUBTOPIC;
    
    refreshAddFormTopicList(currentTopic);
    
    // Only refresh subtopic if the topic still exists, otherwise reset to default
    const topics = getStoredTopics();
    if (!topics.some((t) => t === currentTopic)) {
      refreshAddFormTopicList(DEFAULT_TOPIC);
    } else {
      refreshAddFormSubtopicList(currentTopic, currentSubTopic);
    }
    
    refreshFilterControls();
    renderWordList();
    renderLearnSelection();
    renderTestState();
    updateDuplicateStatus();
  });
  renderLanguageSelector();
  renderMeaningLanguageSelector();
  updateDynamicLabels();
  refreshAddFormTopicList();
  updateImageImportVisibility();
  refreshFilterControls();
  renderWordList();
  renderLearnSelection();
  renderTestState();
  void migrateLocalStorageToFirestore();
  void ensureVocabularyLoaded();
  void ensurePreferencesLoaded();
  void loadSoundSetting();
}

void initializeApp();
