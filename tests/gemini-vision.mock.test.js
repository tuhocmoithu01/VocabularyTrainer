import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startProxy } from '../server/proxy-server.js';

// Mock test for services/gemini-vision.js
// This script simulates a Google Gemini response and verifies parsing.

global.window = global.window || {};
const nativeFetch = global.fetch.bind(global);

// Simulate the server-side Gemini endpoint response.
let request;
global.fetch = async function (url, opts) {
  request = { url, options: opts };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n{ "word": "anniversary", "type": "noun", "ipa": "/ˌæn.ɪˈvɜː.sər.i/", "englishMeaning": "the day on which an important event happened in a previous year", "example": "Our company is offering special discounts to celebrate our 10th anniversary.", "synonyms": [], "antonyms": [], "wordFamily": [], "collocations": [] }\n```'
              }
            ],
            role: 'model'
          },
          finishReason: 'STOP',
          index: 0
        }
      ]
    })
  };
};

(async () => {
  try {
    const mod = await import('../services/gemini-vision.js');
    const result = await mod.analyzeImageWithGeminiVision('data:image/png;base64,TEST');
    assert.equal(result.word, 'anniversary');
    assert.equal(request.url, '/api/gemini/vision');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.options.headers['x-goog-api-key'], undefined);
    const requestBody = JSON.parse(request.options.body);
    assert.equal(requestBody.imageBase64, 'TEST');
    assert.equal(requestBody.mimeType, 'image/png');
    assert.equal(requestBody.model, 'gemini-3.5-flash-lite');
    assert.ok(requestBody.prompt);
    assert.equal(request.options.headers.Authorization, undefined);

    global.window.location = { hostname: 'localhost' };
    await mod.analyzeImageWithGeminiVision('data:image/jpeg;base64,LOCAL');
    assert.equal(request.url, 'http://localhost:3002/api/gemini/vision');
    assert.equal(JSON.parse(request.options.body).imageBase64, 'LOCAL');
    delete global.window.location;

    await assert.rejects(
      mod.analyzeImageWithGeminiVision('invalid-image-data'),
      /Dữ liệu ảnh không hợp lệ/,
    );

    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: 503, message: 'Gemini API temporarily unavailable.' } }),
    });
    await assert.rejects(
      mod.analyzeImageWithGeminiVision('data:image/png;base64,TEST'),
      /OCR API failed \(HTTP 503\): Gemini API temporarily unavailable/,
    );

    global.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => '<html><title>404 Page not found</title></html>',
    });
    await assert.rejects(
      mod.analyzeImageWithGeminiVision('data:image/png;base64,TEST'),
      /OCR API failed \(HTTP 404\)/,
    );

    global.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    global.window.location = { hostname: 'localhost' };
    await assert.rejects(
      mod.analyzeImageWithGeminiVision('data:image/png;base64,TEST'),
      /máy chủ OCR cục bộ ở cổng 3002.*proxy-server\.js/,
    );
    global.window.location = { hostname: 'vocabulary.example.com' };
    await assert.rejects(
      mod.analyzeImageWithGeminiVision('data:image/png;base64,TEST'),
      /Không kết nối được API OCR\. Hãy kiểm tra máy chủ ứng dụng/,
    );
    delete global.window.location;

    const [firebaseConfig, functionSource, clientSource, visionSource] = await Promise.all([
      readFile(new URL('../firebase.json', import.meta.url), 'utf8'),
      readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
      readFile(new URL('../app.js', import.meta.url), 'utf8'),
      readFile(new URL('../services/gemini-vision.js', import.meta.url), 'utf8'),
    ]);
    const hostingConfig = JSON.parse(firebaseConfig);
    assert.ok(hostingConfig.hosting.rewrites.some((rewrite) => (
      rewrite.source === '/api/gemini/vision'
      && rewrite.function?.functionId === 'geminiVision'
      && rewrite.function?.region === 'asia-southeast1'
    )));
    assert.match(functionSource, /defineSecret\('GEMINI_API_KEY'\)/);
    assert.match(functionSource, /requestGeminiVision/);
    assert.doesNotMatch(clientSource, /GEMINI_API_KEY|apiKey|x-goog-api-key/);
    assert.doesNotMatch(visionSource, /GEMINI_API_KEY|apiKey|x-goog-api-key/);

    let providerRequest;
    global.fetch = async (url, options) => {
      providerRequest = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"word":"local"}' }] } }] }),
      };
    };
    const originalCwd = process.cwd();
    const temporaryConfigDirectory = await mkdtemp(path.join(tmpdir(), 'vocabulary-gemini-test-'));
    await mkdir(path.join(temporaryConfigDirectory, 'config'));
    await writeFile(
      path.join(temporaryConfigDirectory, 'config', 'api_gemini.js'),
      'window.__GEMINI_CONFIG__ = { apiKey: "AQ.mock-compatible-credential", provider: "google", model: "gemini-3.5-flash-lite", authType: "API_KEY" };',
    );
    process.chdir(temporaryConfigDirectory);
    const proxy = await startProxy(0);
    try {
      const { port } = proxy.address();
      const localResponse = await nativeFetch(`http://127.0.0.1:${port}/api/gemini/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: 'LOCAL_TEST_IMAGE',
          mimeType: 'image/png',
          model: 'gemini-3.5-flash-lite',
          prompt: 'test prompt',
        }),
      });
      const localPayload = await localResponse.json();
      assert.equal(localResponse.status, 200, JSON.stringify(localPayload));
      assert.equal(localPayload.candidates[0].content.parts[0].text, '{"word":"local"}');
      assert.equal(
        providerRequest.options.headers['x-goog-api-key'],
        'AQ.mock-compatible-credential',
        'proxy should forward configured credentials without rejecting them by prefix',
      );
      assert.equal(
        JSON.stringify({
          url: `http://127.0.0.1:${port}/api/gemini/vision`,
          body: {
            imageBase64: 'LOCAL_TEST_IMAGE',
            mimeType: 'image/png',
            model: 'gemini-3.5-flash-lite',
            prompt: 'test prompt',
          },
        }).includes(providerRequest.options.headers['x-goog-api-key']),
        false,
      );
    } finally {
      try {
        await new Promise((resolve, reject) => {
          proxy.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        process.chdir(originalCwd);
        await rm(temporaryConfigDirectory, { recursive: true, force: true });
      }
    }
    console.log('MOCK TEST RESULT:', result);
    process.exit(0);
  } catch (err) {
    console.error('MOCK TEST ERROR:', err);
    process.exit(2);
  }
})();
