const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const prompt = `Read the English vocabulary flashcard image.
Analyze layout and extract the following fields.
Return a single JSON object only, no markdown, no text explanation, no code block.
Fields:
- word
- type
- ipa
- englishMeaning
- vietnameseMeaning
- example
If Vietnamese meaning appears in parentheses, return only the text inside parentheses without parentheses.
If a field is not visible, return an empty string.
Do not guess missing data.
Example output:
{ "word": "chairman", "type": "noun", "ipa": "/ˈtʃɛərmən/", "englishMeaning": "the person in charge of a meeting or organization", "vietnameseMeaning": "chủ tịch", "example": "The chairman opened the meeting." }
`;

function stripJsonCodeFence(rawText) {
  if (typeof rawText !== 'string') {
    return rawText;
  }

  return rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
}

function extractJsonText(rawText) {
  if (typeof rawText !== 'string') {
    return null;
  }

  const text = stripJsonCodeFence(rawText).trim();
  if (!text) {
    return null;
  }

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  const candidate = text.slice(jsonStart, jsonEnd + 1);
  return candidate;
}

function parseGeminiResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Gemini Vision trả về dữ liệu không hợp lệ.');
  }

  const jsonText = extractJsonText(rawText);
  if (!jsonText) {
    throw new Error('Gemini Vision không trả về JSON hợp lệ.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error('Gemini Vision không trả về JSON hợp lệ.');
  }

  return {
    word: String(parsed.word || '').trim(),
    type: String(parsed.type || '').trim(),
    ipa: String(parsed.ipa || '').trim(),
    englishMeaning: String(parsed.englishMeaning || parsed.englishmeaning || parsed.english_meaning || '').trim(),
    vietnameseMeaning: String(parsed.vietnameseMeaning || parsed.vietnamesemeaning || parsed.vietnamese_meaning || '').trim(),
    example: String(parsed.example || '').trim(),
    meaning: String(parsed.meaning || '').trim(),
  };
}

export async function analyzeImageWithGeminiVision(imageDataUrl) {
  if (typeof imageDataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
    throw new Error('Dữ liệu ảnh không hợp lệ. Hãy chọn lại ảnh rồi thử lại.');
  }
  const dataUrlMatch = imageDataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!dataUrlMatch) {
    throw new Error('Dữ liệu ảnh không hợp lệ. Hãy chọn lại ảnh rồi thử lại.');
  }
  const [, mimeType, imageBase64] = dataUrlMatch;
  const endpoint = typeof window !== 'undefined'
    && window.location
    && /^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)
    ? `http://${window.location.hostname}:3002/api/gemini/vision`
    : '/api/gemini/vision';

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType,
        model: DEFAULT_MODEL,
        prompt,
      }),
    });
  } catch {
    if (/^http:\/\/(?:localhost|127\.0\.0\.1):3002\//.test(endpoint)) {
      throw new Error('Không kết nối được máy chủ OCR cục bộ ở cổng 3002. Hãy chạy proxy-server.js rồi thử lại.');
    }
    throw new Error('Không kết nối được API OCR. Hãy kiểm tra máy chủ ứng dụng rồi thử lại.');
  }

  const text = await resp.text();
  if (!resp.ok) {
    let message = text || `HTTP ${resp.status}`;
    try {
      const json = JSON.parse(text);
      message = typeof json?.error === 'string'
        ? json.error
        : json?.error?.message || json?.message || message;
    } catch {
      // Keep the server's response text for non-JSON errors.
    }
    throw new Error(`OCR API failed (HTTP ${resp.status}): ${message}`);
  }

  let gdata;
  try {
    gdata = JSON.parse(text);
  } catch {
    throw new Error('OCR API returned invalid JSON.');
  }

  // Try multiple possible response shapes to extract text output.
  // This service must remain compatible with older prediction/instance payloads
  // and the current Google Gemini `candidates[].content.parts[].text` shape.
  let rawText = '';
  if (gdata?.predictions && Array.isArray(gdata.predictions) && gdata.predictions[0]) {
    rawText = String(gdata.predictions[0].content || gdata.predictions[0].output || '');
  }
  if (!rawText && gdata?.instances && Array.isArray(gdata.instances)) {
    rawText = String(gdata.instances[0]?.output || gdata.instances[0]?.content || '');
  }
  if (!rawText && gdata?.candidates && Array.isArray(gdata.candidates)) {
    const candidate = gdata.candidates[0];
    if (candidate?.content) {
      if (typeof candidate.content === 'string') {
        rawText = candidate.content;
      } else if (typeof candidate.content.text === 'string') {
        rawText = candidate.content.text;
      } else if (Array.isArray(candidate.content.parts)) {
        rawText = candidate.content.parts
          .map((part) => part?.text || '')
          .filter(Boolean)
          .join('\n');
      }
    }
  }
  if (!rawText && typeof gdata?.outputText === 'string') rawText = gdata.outputText;

  if (!rawText && typeof gdata?.text === 'string') rawText = gdata.text;
  if (!rawText && gdata?.output && Array.isArray(gdata.output)) {
    const message = gdata.output.find((item) => item?.type === 'message' && Array.isArray(item?.content));
    if (message) {
      rawText = message.content
        .filter((part) => part?.type === 'output_text')
        .map((part) => part?.text || '')
        .filter(Boolean)
        .join('\n');
    }
  }

  if (!rawText) {
    rawText = JSON.stringify(gdata).slice(0, 2000);
  }

  let parsed;
  try {
    parsed = parseGeminiResponse(rawText);
  } catch {
    throw new Error('Gemini Vision không trả về JSON hợp lệ.');
  }

  const mapped = {
    word: parsed.word || '',
    type: parsed.type || parsed.partOfSpeech || '',
    partOfSpeech: parsed.type || parsed.partOfSpeech || '',
    ipa: parsed.ipa || '',
    meaning: parsed.englishMeaning || parsed.meaning || parsed.englishmeaning || '',
    example: parsed.example || '',
    synonyms: parsed.synonyms || [],
    antonyms: parsed.antonyms || [],
    wordFamily: parsed.wordFamily || parsed.word_family || [],
    collocations: parsed.collocations || [],
  };

  return mapped;
}
