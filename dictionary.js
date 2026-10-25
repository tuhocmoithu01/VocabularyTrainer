const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const WIKTIONARY_API_URL = 'https://en.wiktionary.org/w/api.php';
const PRONUNCIATION_CACHE = new Map();
const PRONUNCIATION_REQUESTS = new Map();
const PRONUNCIATION_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const PRONUNCIATION_MISS_CACHE_TTL = 24 * 60 * 60 * 1000;

function getPronunciationAccent(annotation) {
  const value = String(annotation || '').toLowerCase();
  const uk = /\b(uk|gb|british|england|scotland|wales|rp|received pronunciation)\b/.test(value);
  const us = /\b(us|usa|united states|american|general american|genam|ga|california|pacific northwest)\b/.test(value);
  return { uk, us };
}

function extractPronunciationTemplate(line, name) {
  const templatePattern = new RegExp(`\\{\\{\\s*${name}\\s*\\|([^{}]+)\\}\\}`, 'gi');
  const matches = [...line.matchAll(templatePattern)];
  return matches.map((match) => match[1].split('|').map((part) => part.trim()));
}

export function parseWiktionaryPronunciations(wikitext, word) {
  const variants = {
    uk: { ipa: '', audio: '', audioSourceUrl: '' },
    us: { ipa: '', audio: '', audioSourceUrl: '' },
  };
  let lastAccent = { uk: false, us: false };
  let unaccentedIpa = '';

  for (const line of String(wikitext || '').split(/\r?\n/)) {
    const ipaTemplates = extractPronunciationTemplate(line, 'IPA')
      .filter((parts) => parts[0]?.toLowerCase() === 'en');
    if (ipaTemplates.length) {
      lastAccent = { uk: false, us: false };
      unaccentedIpa = '';
      ipaTemplates.forEach((parts) => {
        const transcription = parts.find((part) => /^[/\[].*[/\]]$/.test(part));
        const annotation = parts.filter((part) => /^[a-z]+\s*=/i.test(part)).join(' ');
        const accent = getPronunciationAccent(annotation);
        if (!transcription) {
          return;
        }
        if (accent.uk && !variants.uk.ipa) {
          variants.uk.ipa = transcription;
        }
        if (accent.us && !variants.us.ipa) {
          variants.us.ipa = transcription;
        }
        if (!accent.uk && !accent.us && !unaccentedIpa) {
          unaccentedIpa = transcription;
        }
        lastAccent = {
          uk: lastAccent.uk || accent.uk,
          us: lastAccent.us || accent.us,
        };
      });
    }

    for (const parts of extractPronunciationTemplate(line, 'audio')) {
      if (parts[0]?.toLowerCase() !== 'en') {
        continue;
      }
      const filename = parts[1] || '';
      if (!filename || filename.includes('=')) {
        continue;
      }
      const annotation = parts.filter((part) => /^[a-z]+\s*=/i.test(part)).join(' ');
      const audioAccent = getPronunciationAccent(`${annotation} ${filename}`);
      const hasExplicitAudioAccent = audioAccent.uk || audioAccent.us;
      const targetUk = hasExplicitAudioAccent
        ? audioAccent.uk
        : lastAccent.uk && !lastAccent.us;
      const targetUs = hasExplicitAudioAccent
        ? audioAccent.us
        : lastAccent.us && !lastAccent.uk;
      const audioUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
      const audioSourceUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`;
      if (targetUk && !variants.uk.ipa && unaccentedIpa) {
        variants.uk.ipa = unaccentedIpa;
      }
      if (targetUs && !variants.us.ipa && unaccentedIpa) {
        variants.us.ipa = unaccentedIpa;
      }
      if (targetUk && variants.uk.ipa && !variants.uk.audio) {
        variants.uk.audio = audioUrl;
        variants.uk.audioSourceUrl = audioSourceUrl;
      }
      if (targetUs && variants.us.ipa && !variants.us.audio) {
        variants.us.audio = audioUrl;
        variants.us.audioSourceUrl = audioSourceUrl;
      }
    }
  }

  const pageName = String(word || '').trim().replace(/\s+/g, '_');
  return {
    uk: variants.uk.ipa ? variants.uk : null,
    us: variants.us.ipa ? variants.us : null,
    sourceUrl: pageName ? `https://en.wiktionary.org/wiki/${encodeURIComponent(pageName)}` : '',
  };
}

const STATIC_SUPPORT_DATA = {
  problem: {
    meaning: 'vấn đề',
    definition: 'something difficult that needs to be solved',
    synonyms: ['issue', 'difficulty', 'trouble'],
    antonyms: ['solution', 'answer'],
    collocations: ['have a problem', 'solve a problem'],
    basicExample: 'There is a problem with the schedule.',
    conversationExample: 'I am having a problem with the booking system.',
    lessonExample: 'In today\'s business meeting, we need to solve this problem before the client arrives.',
  },
  solution: {
    meaning: 'giải pháp',
    definition: 'a way to solve a problem',
    synonyms: ['answer', 'remedy', 'fix'],
    antonyms: ['problem', 'difficulty'],
    collocations: ['find a solution', 'offer a solution'],
    basicExample: 'We found a solution quickly.',
    conversationExample: 'Do you have a solution for this issue?',
    lessonExample: 'The team proposed a practical solution during the discussion.',
  },
  create: {
    meaning: 'tạo ra',
    definition: 'to make something new',
    synonyms: ['make', 'build', 'produce'],
    antonyms: ['destroy', 'erase'],
    collocations: ['create a plan', 'create an opportunity'],
    basicExample: 'She wants to create a new app.',
    conversationExample: 'We can create a better workflow together.',
    lessonExample: 'The manager asked the team to create a proposal for the launch.',
  },
  answer: {
    meaning: 'câu trả lời',
    definition: 'a response to a question or problem',
    synonyms: ['reply', 'response', 'solution'],
    antonyms: ['question', 'problem'],
    collocations: ['give an answer', 'find an answer'],
    basicExample: 'Please give me an answer.',
    conversationExample: 'I need an answer before we continue.',
    lessonExample: 'The speaker gave a clear answer during the Q&A session.',
  },
  schedule: {
    meaning: 'xếp lịch',
    definition: 'to arrange something for a specific time',
    synonyms: ['arrange', 'plan', 'set'],
    antonyms: ['cancel', 'delay'],
    collocations: ['schedule a meeting', 'schedule an appointment'],
    basicExample: 'Can we schedule a meeting tomorrow?',
    conversationExample: 'I will schedule the appointment for next Monday.',
    lessonExample: 'During the business meeting, we need to schedule the conference for Thursday.',
  },
  deadline: {
    meaning: 'hạn chót',
    definition: 'the latest time something must happen',
    synonyms: ['due date', 'time limit', 'cutoff'],
    antonyms: ['extension', 'leniency'],
    collocations: ['meet the deadline', 'miss the deadline', 'set a deadline'],
    basicExample: 'The deadline for the project is Friday.',
    conversationExample: 'We need to meet the deadline before the client arrives.',
    lessonExample: 'The team discussed how to manage the deadline during the meeting.',
  },
  meeting: {
    meaning: 'cuộc họp',
    definition: 'a planned gathering of people for discussion or decision-making',
    synonyms: ['conference', 'session', 'discussion'],
    antonyms: ['break', 'separation'],
    collocations: ['hold a meeting', 'attend a meeting', 'schedule a meeting'],
    basicExample: 'We have a meeting at 10 a.m.',
    conversationExample: 'Can we move the meeting to tomorrow?',
    lessonExample: 'The client joined the meeting to discuss the proposal.',
  },
};

function normalizeStringArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

export function normalizeSupportTextValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function selectFirstSentence(value) {
  const normalized = normalizeSupportTextValue(value);
  if (!normalized) {
    return '';
  }

  const sentenceMatch = normalized.match(/^[^.!?]+[.!?]?/);
  if (!sentenceMatch) {
    return normalized;
  }

  return sentenceMatch[0].trim();
}

function cleanContextLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.trim();
  if (!text) {
    return '';
  }

  const cleaned = text.replace(/lesson\s*\d+\s*[:\-]?\s*/i, '').replace(/unit\s*\d+\s*[:\-]?\s*/i, '').trim();
  return cleaned || text;
}

const VIETNAMESE_SUPPORT_MEANINGS = {
  record: 'hồ sơ',
  profile: 'hồ sơ cá nhân',
  'customer account': 'tài khoản khách hàng',
  issue: 'vấn đề',
  difficulty: 'khó khăn',
  trouble: 'rắc rối',
  solution: 'giải pháp',
  answer: 'câu trả lời',
  arrange: 'sắp xếp',
  plan: 'kế hoạch',
  set: 'đặt',
  cancel: 'hủy',
  delay: 'hoãn',
  'due date': 'hạn chót',
  'time limit': 'thời hạn',
  cutoff: 'hạn',
  extension: 'gia hạn',
  leniency: 'khoan dung',
  conference: 'hội nghị',
  session: 'phiên họp',
  discussion: 'thảo luận',
  break: 'nghỉ ngơi',
  separation: 'chia cách',
  create: 'tạo',
  build: 'xây dựng',
  produce: 'sản xuất',
  destroy: 'phá hủy',
  erase: 'xóa',
  reply: 'phản hồi',
  response: 'phản ứng',
  question: 'câu hỏi',
  problem: 'vấn đề',
  schedule: 'lịch trình',
  meeting: 'cuộc họp',
  appointment: 'cuộc hẹn',
  achieve: 'đạt được',
  inform: 'thông báo',
  successful: 'thành công',
  account: 'tài khoản',
};

function normalizeSupportObjectItem(item) {
  if (!item && item !== 0) {
    return null;
  }

  if (typeof item === 'string') {
    const rawValue = String(item || '').trim();
    if (!rawValue) {
      return null;
    }

    const [wordPart, meaningPart] = rawValue.split(':').map((part) => part.trim());
    return {
      word: wordPart,
      meaning: meaningPart || '',
    };
  }

  if (typeof item === 'object' && item !== null) {
    const word = String(item.word || item.text || item.label || item.expression || item.value || '').trim();
    if (!word) {
      return null;
    }
    const meaning = String(item.meaning || item.translation || item.definition || item.description || item.explanation || '').trim();
    const type = String(item.type || item.partOfSpeech || item.pos || '').trim();
    const ipa = String(item.ipa || item.pronunciation || '').trim();
    const cefr = String(item.cefr || item.level || '').trim();
    const example = String(item.example || item.shortExample || item.sample || '').trim();
    const normalized = type ? { word, meaning, type } : { word, meaning };
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
}

function normalizeSupportObjectList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSupportObjectItem(item))
      .filter((entry) => entry && entry.word);
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|,|;/)
      .map((item) => normalizeSupportObjectItem(item))
      .filter((entry) => entry && entry.word);
  }

  return [];
}

function buildStringLikeSupportEntry(entry) {
  const normalizedEntry = normalizeSupportObjectItem(entry);
  if (!normalizedEntry || !normalizedEntry.word) {
    return null;
  }

  const stringLikeEntry = new String(normalizedEntry.word);
  Object.assign(stringLikeEntry, normalizedEntry);
  return stringLikeEntry;
}

function normalizeSupportWordKey(value) {
  return String(value || '').trim().toLowerCase();
}

function filterSupportEntries(entries, baseWord) {
  const normalizedBaseWord = normalizeSupportWordKey(baseWord);
  return (entries || [])
    .filter((entry) => entry && entry.word)
    .map((entry) => normalizeSupportObjectItem(entry))
    .filter((entry) => {
      if (!entry) {
        return false;
      }
      const wordLower = normalizeSupportWordKey(entry.word);
      if (!wordLower) {
        return false;
      }
      if (!normalizedBaseWord) {
        return true;
      }
      if (wordLower === normalizedBaseWord) {
        return false;
      }
      if (wordLower.includes(normalizedBaseWord) || normalizedBaseWord.includes(wordLower)) {
        return false;
      }
      return true;
    });
}

function uniqueSupportEntries(entries) {
  const seen = new Set();
  return (entries || []).reduce((acc, entry) => {
    if (!entry || !entry.word) {
      return acc;
    }
    const key = normalizeSupportWordKey(entry.word);
    if (!key || seen.has(key)) {
      return acc;
    }
    seen.add(key);
    acc.push(entry);
    return acc;
  }, []);
}

async function fetchVietnameseMeaning(word) {
  const normalized = normalizeSupportWordKey(word);
  if (!normalized) {
    return '';
  }

  if (Object.prototype.hasOwnProperty.call(VIETNAMESE_SUPPORT_MEANINGS, normalized)) {
    return VIETNAMESE_SUPPORT_MEANINGS[normalized];
  }

  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`);
    if (!response.ok) {
      return '';
    }

    const data = await response.json();
    const translated = data?.responseData?.translatedText || '';
    return String(translated).trim();
  } catch (error) {
    console.warn('Translation fetch failed:', error);
    return '';
  }
}

export async function enrichSupportEntriesWithMeanings(entries = []) {
  return Promise.all(
    (entries || []).map(async (entry) => {
      const normalizedEntry = normalizeSupportObjectItem(entry);
      if (!normalizedEntry || !normalizedEntry.word) {
        return null;
      }
      if (normalizedEntry.meaning) {
        return normalizedEntry;
      }

      const meaning = await fetchVietnameseMeaning(normalizedEntry.word);
      return {
        ...normalizedEntry,
        meaning: meaning || '',
      };
    }),
  ).then((results) => results.filter((entry) => entry && entry.word));
}

function buildContextSummary(context = {}) {
  const parts = [context.language, context.lesson, context.topic, context.subTopic, context.subTopicDescription, context.meaning]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim());

  return parts.join(' ').toLowerCase();
}

function buildSupportPayload({ meaning = '', ipa = '', definition = '', synonyms = [], antonyms = [], collocations = [], wordFamily = [], fixedPhrases = [], sentencePatterns = [], commonExpressions = [], commonMistakes = [], basicExample = '', conversationExample = '', lessonExample = '', examples = null } = {}) {
  const normalizedExamples = examples && typeof examples === 'object' && !Array.isArray(examples)
    ? {
        basic: String(examples.basic || '').trim(),
        conversation: String(examples.conversation || '').trim(),
        lessonContext: String(examples.lessonContext || '').trim(),
      }
    : {
        basic: String(basicExample || '').trim(),
        conversation: String(conversationExample || '').trim(),
        lessonContext: String(lessonExample || '').trim(),
      };

  const normalizedBasicExample = selectFirstSentence(normalizeSupportTextValue(normalizedExamples.basic));
  const normalizedConversationExample = selectFirstSentence(normalizeSupportTextValue(normalizedExamples.conversation));
  const normalizedLessonExample = selectFirstSentence(normalizeSupportTextValue(normalizedExamples.lessonContext));
  return {
    meaning: String(meaning || '').trim(),
    ipa: String(ipa || '').trim(),
    definition: String(definition || '').trim(),
    synonyms: normalizeSupportObjectList(synonyms).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    antonyms: normalizeSupportObjectList(antonyms).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    wordFamily: normalizeSupportObjectList(wordFamily),
    fixedPhrases: normalizeSupportObjectList(fixedPhrases),
    collocations: normalizeSupportObjectList(collocations).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    sentencePatterns: normalizeSupportObjectList(sentencePatterns).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    commonExpressions: normalizeSupportObjectList(commonExpressions).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    commonMistakes: normalizeSupportObjectList(commonMistakes).map((entry) => buildStringLikeSupportEntry(entry)).filter(Boolean),
    example: normalizedBasicExample,
    basicExample: normalizedBasicExample,
    conversationExample: normalizedConversationExample,
    lessonExample: normalizedLessonExample,
    examples: {
      basic: normalizedBasicExample,
      conversation: normalizedConversationExample,
      lessonContext: normalizedLessonExample,
    },
  };
}

function buildWordFamilySuggestions(word) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const wordFamilyMap = {
    explain: [
      { word: 'explanation', meaning: 'lời giải thích', type: 'Danh từ' },
      { word: 'explanatory', meaning: 'mang tính giải thích', type: 'Tính từ' },
      { word: 'explained', meaning: 'đã giải thích', type: 'Động từ (V2/V3)' },
      { word: 'explaining', meaning: 'đang giải thích', type: 'V-ing' },
    ],
    explanation: [
      { word: 'explain', meaning: 'giải thích', type: 'Động từ' },
      { word: 'explanatory', meaning: 'mang tính giải thích', type: 'Tính từ' },
      { word: 'explained', meaning: 'đã giải thích', type: 'Động từ (V2/V3)' },
    ],
    decision: [
      { word: 'decide', meaning: 'quyết định', type: 'Động từ' },
      { word: 'decisive', meaning: 'quyết đoán', type: 'Tính từ' },
      { word: 'decided', meaning: 'đã quyết định', type: 'Động từ (V2/V3)' },
    ],
    decide: [
      { word: 'decision', meaning: 'quyết định', type: 'Danh từ' },
      { word: 'decisive', meaning: 'quyết đoán', type: 'Tính từ' },
      { word: 'deciding', meaning: 'đang quyết định', type: 'V-ing' },
    ],
  };

  return wordFamilyMap[normalizedWord] || [];
}

function buildFixedPhraseSuggestions(word) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const fixedPhraseMap = {
    explain: [
      { word: 'explain clearly', meaning: 'giải thích một cách rõ ràng' },
      { word: 'explain something to someone', meaning: 'giải thích một việc cho ai đó' },
      { word: 'explain the reason', meaning: 'giải thích lý do' },
    ],
    explanation: [
      { word: 'give an explanation', meaning: 'đưa ra lời giải thích' },
      { word: 'offer an explanation', meaning: 'đưa ra lời giải thích' },
      { word: 'provide an explanation', meaning: 'cung cấp lời giải thích' },
      { word: 'need an explanation', meaning: 'cần một lời giải thích' },
    ],
    decision: [
      { word: 'make a decision', meaning: 'đưa ra quyết định' },
      { word: 'reach a decision', meaning: 'đi đến quyết định' },
      { word: 'final decision', meaning: 'quyết định cuối cùng' },
    ],
    decide: [
      { word: 'decide on something', meaning: 'quyết định về điều gì đó' },
      { word: 'decide to do something', meaning: 'quyết định làm điều gì đó' },
    ],
  };

  return fixedPhraseMap[normalizedWord] || [];
}

function buildGenericSupportData(word, context = {}) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const topic = cleanContextLabel(String(context.topic || '').trim());
  const subTopic = cleanContextLabel(String(context.subTopic || '').trim());
  const lesson = cleanContextLabel(String(context.lesson || '').trim());
  const contextLabel = [subTopic, topic, lesson].filter((value) => value && !/lesson\s*\d+/i.test(value)).filter(Boolean)[0] || 'this topic';
  const meaning = String(context.meaning || '').trim();
  const baseMeaning = meaning || (normalizedWord === 'meeting' ? 'cuộc họp' : '');
  const baseDefinition = normalizedWord === 'meeting'
    ? 'a planned gathering of people for discussion or decision-making'
    : 'a term related to the current topic';
  const basicExample = normalizedWord ? `${normalizedWord.charAt(0).toUpperCase() + normalizedWord.slice(1)} is important in ${contextLabel}.` : '';
  const conversationExample = normalizedWord ? `Can you explain what ${normalizedWord} means in this situation?` : '';
  const lessonExample = normalizedWord
    ? `In ${contextLabel}, ${normalizedWord} was one of the key terms discussed in class.`
    : '';

  const sentencePatterns = normalizedWord
    ? [
        { word: `act as + N`, meaning: 'đóng vai là ai đó', example: `She can act as a teacher.` },
        { word: `act on + something`, meaning: 'hành động dựa trên điều gì', example: `We need to act on this issue.` },
      ]
    : [];
  const commonExpressions = normalizedWord
    ? [
        { word: `actions speak louder than words`, meaning: 'hành động nói nhiều hơn lời nói', example: `Actions speak louder than words.` },
      ]
    : [];
  const commonMistakes = normalizedWord
    ? [
        { word: `make an action`, meaning: 'sai', example: `We need to make an action.` },
      ]
    : [];

  return buildSupportPayload({
    meaning: baseMeaning,
    definition: baseDefinition,
    synonyms: [],
    antonyms: [],
    wordFamily: buildWordFamilySuggestions(normalizedWord),
    fixedPhrases: buildFixedPhraseSuggestions(normalizedWord),
    collocations: normalizedWord ? [`use ${normalizedWord} in conversation`, `${normalizedWord} appears in this topic`] : [],
    sentencePatterns,
    commonExpressions,
    commonMistakes,
    basicExample,
    conversationExample,
    lessonExample,
  });
}

function buildContextualSupportData(word, context = {}) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const staticData = STATIC_SUPPORT_DATA[normalizedWord];
  if (staticData) {
    return buildSupportPayload({
      meaning: staticData.meaning || '',
      definition: staticData.definition || '',
      synonyms: staticData.synonyms || [],
      antonyms: staticData.antonyms || [],
      collocations: staticData.collocations || [],
      basicExample: staticData.basicExample || '',
      conversationExample: staticData.conversationExample || '',
      lessonExample: staticData.lessonExample || '',
      examples: {
        basic: staticData.basicExample || '',
        conversation: staticData.conversationExample || '',
        lessonContext: staticData.lessonExample || '',
      },
    });
  }

  const contextSummary = buildContextSummary(context);
  const isBusinessTopic = contextSummary.includes('meeting') || contextSummary.includes('business') || contextSummary.includes('appointment') || contextSummary.includes('conference');
  const genericData = buildGenericSupportData(word, context);
  const lessonExample = isBusinessTopic
    ? `During the ${context.topic || 'lesson'} discussion, ${normalizedWord} was used in a practical example.`
    : genericData.lessonExample;

  return buildSupportPayload({
    ...genericData,
    lessonExample,
    examples: {
      basic: genericData.basicExample,
      conversation: genericData.conversationExample,
      lessonContext: lessonExample,
    },
  });
}

function mergeSupportDataWithContext(staticData = {}, word, context = {}) {
  const contextualData = buildContextualSupportData(word, context);
  const collocations = [...new Set([...(staticData.collocations || []), ...(contextualData.collocations || [])])];
  const lessonExample = contextualData.lessonExample || staticData.lessonExample || '';
  const conversationExample = contextualData.conversationExample || staticData.conversationExample || '';
  const basicExample = contextualData.basicExample || staticData.basicExample || '';
  const examples = {
    basic: contextualData.examples?.basic || staticData.basicExample || basicExample || '',
    conversation: contextualData.examples?.conversation || staticData.conversationExample || conversationExample || '',
    lessonContext: contextualData.examples?.lessonContext || staticData.lessonExample || lessonExample || '',
  };

  return buildSupportPayload({
    meaning: staticData.meaning || contextualData.meaning || '',
    definition: staticData.definition || contextualData.definition || '',
    synonyms: [...new Set([...(staticData.synonyms || []), ...(contextualData.synonyms || [])])],
    antonyms: [...new Set([...(staticData.antonyms || []), ...(contextualData.antonyms || [])])],
    wordFamily: [...new Set([...(staticData.wordFamily || []), ...(contextualData.wordFamily || [])].map((item) => normalizeSupportObjectItem(item)).filter(Boolean).map((item) => `${item.word}::${item.type || ''}::${item.meaning}`))].map((item) => {
      const [word, type, meaning] = item.split('::');
      return { word, type, meaning };
    }),
    fixedPhrases: [...new Set([...(staticData.fixedPhrases || []), ...(contextualData.fixedPhrases || [])].map((item) => normalizeSupportObjectItem(item)).filter(Boolean).map((item) => `${item.word}::${item.meaning}`))].map((item) => {
      const [word, meaning] = item.split('::');
      return { word, meaning };
    }),
    collocations,
    basicExample,
    conversationExample,
    lessonExample,
    examples,
  });
}

/**
 * Extract the first available phonetic transcription from API response.
 * @param {unknown} responseData
 * @returns {string}
 */
function extractIpaFromResponse(responseData) {
  if (!Array.isArray(responseData) || responseData.length === 0) {
    return '';
  }

  const entry = responseData[0];
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  if (typeof entry.phonetic === 'string' && entry.phonetic.trim()) {
    return entry.phonetic.trim();
  }

  if (Array.isArray(entry.phonetics)) {
    const phoneticItem = entry.phonetics.find((item) => item && typeof item.text === 'string' && item.text.trim());
    return phoneticItem ? phoneticItem.text.trim() : '';
  }

  return '';
}

function extractDefinitionFromResponse(responseData) {
  if (!Array.isArray(responseData) || responseData.length === 0) {
    return '';
  }

  const entry = responseData[0];
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  if (Array.isArray(entry.meanings)) {
    for (const meaning of entry.meanings) {
      if (meaning && Array.isArray(meaning.definitions)) {
        const definition = meaning.definitions.find((item) => item && typeof item.definition === 'string' && item.definition.trim());
        if (definition) {
          return definition.definition.trim();
        }
      }
    }
  }

  return '';
}

function extractSupportWordsFromResponse(responseData) {
  const synonyms = [];
  const antonyms = [];

  if (!Array.isArray(responseData)) {
    return { synonyms, antonyms };
  }

  responseData.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.meanings)) {
      return;
    }

    entry.meanings.forEach((meaning) => {
      if (!meaning || typeof meaning !== 'object') {
        return;
      }

      if (Array.isArray(meaning.synonyms)) {
        meaning.synonyms.forEach((word) => {
          if (typeof word === 'string' && word.trim()) {
            synonyms.push(word.trim());
          }
        });
      }

      if (Array.isArray(meaning.antonyms)) {
        meaning.antonyms.forEach((word) => {
          if (typeof word === 'string' && word.trim()) {
            antonyms.push(word.trim());
          }
        });
      }

      if (Array.isArray(meaning.definitions)) {
        meaning.definitions.forEach((definitionItem) => {
          if (!definitionItem || typeof definitionItem !== 'object') {
            return;
          }
          if (Array.isArray(definitionItem.synonyms)) {
            definitionItem.synonyms.forEach((word) => {
              if (typeof word === 'string' && word.trim()) {
                synonyms.push(word.trim());
              }
            });
          }
          if (Array.isArray(definitionItem.antonyms)) {
            definitionItem.antonyms.forEach((word) => {
              if (typeof word === 'string' && word.trim()) {
                antonyms.push(word.trim());
              }
            });
          }
        });
      }
    });
  });

  return {
    synonyms: [...new Set(synonyms)].slice(0, 10),
    antonyms: [...new Set(antonyms)].slice(0, 10),
  };
}

/**
 * Fetch IPA transcription for a word from dictionaryapi.dev.
 * If the API fails or the transcription is not present, returns an empty string.
 * @param {string} word
 * @returns {Promise<string>}
 */
export async function fetchWordIpa(word) {
  if (!word || typeof word !== 'string') {
    return '';
  }

  try {
    const response = await fetch(`${DICTIONARY_API_BASE}/${encodeURIComponent(word.trim())}`);
    if (!response.ok) {
      return '';
    }

    const data = await response.json();
    return extractIpaFromResponse(data);
  } catch (error) {
    console.warn('IPA fetch failed:', error);
    return '';
  }
}

async function fetchWiktionaryPronunciationVariants(normalizedWord) {
  const page = encodeURIComponent(normalizedWord.replace(/ /g, '_'));
  const url = `${WIKTIONARY_API_URL}?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2&origin=*`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) {
      return parseWiktionaryPronunciations('', normalizedWord);
    }
    if (!response.ok) {
      throw new Error(`Pronunciation lookup failed (${response.status}) for "${normalizedWord}".`);
    }

    const data = await response.json();
    if (data?.error?.code === 'missingtitle') {
      return parseWiktionaryPronunciations('', normalizedWord);
    }
    if (typeof data?.parse?.wikitext !== 'string') {
      throw new Error(`Pronunciation lookup returned invalid data for "${normalizedWord}".`);
    }

    return parseWiktionaryPronunciations(data.parse.wikitext, normalizedWord);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Pronunciation lookup timed out for "${normalizedWord}".`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWordPronunciationVariants(word) {
  if (!word || typeof word !== 'string') {
    return { uk: null, us: null, sourceUrl: '' };
  }

  const normalizedWord = word.trim().replace(/\s+/g, ' ').replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
  if (!normalizedWord) {
    return { uk: null, us: null, sourceUrl: '' };
  }

  const normalizedKey = normalizedWord.toLocaleLowerCase('en');
  const sourceUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizedWord.replace(/\s+/g, '_'))}`;
  const cacheKeys = {
    uk: `${normalizedKey}|wiktionary|uk`,
    us: `${normalizedKey}|wiktionary|us`,
  };
  const cachedUk = PRONUNCIATION_CACHE.get(cacheKeys.uk);
  const cachedUs = PRONUNCIATION_CACHE.get(cacheKeys.us);
  if (cachedUk?.expiresAt > Date.now() && cachedUs?.expiresAt > Date.now()) {
    return {
      uk: cachedUk.variant,
      us: cachedUs.variant,
      sourceUrl,
    };
  }

  const requestKey = `${normalizedKey}|wiktionary|uk,us`;
  let request = PRONUNCIATION_REQUESTS.get(requestKey);
  if (!request) {
    request = fetchWiktionaryPronunciationVariants(normalizedWord);
    PRONUNCIATION_REQUESTS.set(requestKey, request);
  }
  try {
    const result = await request;
    const checkedAt = Date.now();
    PRONUNCIATION_CACHE.set(cacheKeys.uk, {
      variant: result.uk,
      expiresAt: checkedAt + (result.uk ? PRONUNCIATION_CACHE_TTL : PRONUNCIATION_MISS_CACHE_TTL),
    });
    PRONUNCIATION_CACHE.set(cacheKeys.us, {
      variant: result.us,
      expiresAt: checkedAt + (result.us ? PRONUNCIATION_CACHE_TTL : PRONUNCIATION_MISS_CACHE_TTL),
    });
    return result;
  } finally {
    if (PRONUNCIATION_REQUESTS.get(requestKey) === request) {
      PRONUNCIATION_REQUESTS.delete(requestKey);
    }
  }
}

/**
 * Suggest support data for a word without persisting it automatically.
 * @param {string} word
 * @param {Object} context
 * @returns {Promise<{ipa:string, definition:string, synonyms:string[], antonyms:string[], collocations:string[], basicExample:string, conversationExample:string, lessonExample:string}>}
 */
export async function fetchWordSupportData(word, context = {}) {
  if (!word || typeof word !== 'string') {
    return buildSupportPayload();
  }

  const normalizedWord = String(word).trim().toLowerCase();
  if (STATIC_SUPPORT_DATA[normalizedWord]) {
    const staticData = STATIC_SUPPORT_DATA[normalizedWord];
    const merged = mergeSupportDataWithContext(staticData, word, context);
    merged.synonyms = uniqueSupportEntries(filterSupportEntries(merged.synonyms, word));
    merged.antonyms = uniqueSupportEntries(filterSupportEntries(merged.antonyms, word));
    const enrichedSynonyms = await enrichSupportEntriesWithMeanings(merged.synonyms);
    const enrichedAntonyms = await enrichSupportEntriesWithMeanings(merged.antonyms);
    return {
      ...merged,
      synonyms: enrichedSynonyms.map((item) => item.word),
      antonyms: enrichedAntonyms.map((item) => item.word),
      enrichedSynonyms,
      enrichedAntonyms,
      wordFamily: merged.wordFamily || [],
      fixedPhrases: merged.fixedPhrases || [],
      collocations: merged.collocations || [],
      enrichedCollocations: normalizeSupportObjectList(merged.collocations).map((item) => buildStringLikeSupportEntry(item)).filter(Boolean),
    };
  }

  const contextualData = buildContextualSupportData(word, context);
  if (contextualData.lessonExample || contextualData.basicExample || contextualData.conversationExample || contextualData.collocations.length) {
    const contextual = {
      ...contextualData,
      ipa: '',
    };
    contextual.synonyms = uniqueSupportEntries(filterSupportEntries(contextual.synonyms, word));
    contextual.antonyms = uniqueSupportEntries(filterSupportEntries(contextual.antonyms, word));
    contextual.collocations = Array.isArray(contextual.collocations)
      ? contextual.collocations.filter((item) => typeof item === 'string' ? item.trim() : (item && item.word))
      : [];
    const enrichedSynonyms = await enrichSupportEntriesWithMeanings(contextual.synonyms);
    const enrichedAntonyms = await enrichSupportEntriesWithMeanings(contextual.antonyms);
    const enrichedCollocations = normalizeSupportObjectList(contextual.collocations)
      .map((item) => buildStringLikeSupportEntry(item))
      .filter(Boolean);
    return {
      ...contextual,
      synonyms: enrichedSynonyms.map((item) => item.word),
      antonyms: enrichedAntonyms.map((item) => item.word),
      enrichedSynonyms,
      enrichedAntonyms,
      enrichedCollocations,
      wordFamily: contextual.wordFamily || [],
      fixedPhrases: contextual.fixedPhrases || [],
      collocations: enrichedCollocations,
    };
  }

  try {
    const response = await fetch(`${DICTIONARY_API_BASE}/${encodeURIComponent(word.trim())}`);
    if (!response.ok) {
      return buildSupportPayload();
    }

    const data = await response.json();
    const extracted = extractSupportWordsFromResponse(data);
    const payload = buildSupportPayload({
      meaning: context.meaning ? String(context.meaning).trim() : '',
      ipa: extractIpaFromResponse(data),
      definition: extractDefinitionFromResponse(data),
      synonyms: extracted.synonyms,
      antonyms: extracted.antonyms,
      collocations: [],
      basicExample: '',
      conversationExample: '',
      lessonExample: '',
    });
    payload.synonyms = uniqueSupportEntries(filterSupportEntries(payload.synonyms, word));
    payload.antonyms = uniqueSupportEntries(filterSupportEntries(payload.antonyms, word));
    const enrichedSynonyms = await enrichSupportEntriesWithMeanings(payload.synonyms);
    const enrichedAntonyms = await enrichSupportEntriesWithMeanings(payload.antonyms);
    return {
      ...payload,
      synonyms: enrichedSynonyms.map((item) => item.word),
      antonyms: enrichedAntonyms.map((item) => item.word),
      enrichedSynonyms,
      enrichedAntonyms,
      wordFamily: payload.wordFamily || [],
      fixedPhrases: payload.fixedPhrases || [],
      collocations: payload.collocations || [],
      enrichedCollocations: normalizeSupportObjectList(payload.collocations).map((item) => buildStringLikeSupportEntry(item)).filter(Boolean),
    };
  } catch (error) {
    console.warn('Support data fetch failed:', error);
    return buildSupportPayload();
  }
}
