import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(process.cwd());
const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const filePath = path.resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) && filePath !== path.join(ROOT, 'index.html')) {
      response.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const ocrPayload = {
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          word: 'clipboardtest',
          type: 'noun',
          ipa: '/ˈklɪp.bɔːrd/',
          englishMeaning: 'A test word supplied from the clipboard.',
          vietnameseMeaning: 'từ kiểm tra clipboard',
          example: 'This image was pasted into the form.',
        }),
      }],
    },
  }],
};

const [serviceWorkerSource, mainHtml, publicHtml] = await Promise.all([
  readFile(path.join(ROOT, 'service-worker.js'), 'utf8'),
  readFile(path.join(ROOT, 'index.html'), 'utf8'),
  readFile(path.join(ROOT, 'public', 'index.html'), 'utf8'),
]);
assert.match(serviceWorkerSource, /const CACHE_NAME = 'vocabulary-trainer-static-v\d+';/);
for (const html of [mainHtml, publicHtml]) {
  assert.match(html, /app\.js\?v=\d{8}-\d+/);
}

const server = await startStaticServer();
const { port } = server.address();
const origin = `http://localhost:${port}`;
let browser;

try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const pageErrors = [];
  const pageConsoleErrors = [];
  const pageHttpErrors = [];
  const qaTopic = `QA Topic ${Date.now()}`;
  const qaSubtopic = `QA Lesson ${Date.now()}`;
  let promptCount = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageConsoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) pageHttpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on('dialog', (dialog) => dialog.accept(promptCount++ === 0 ? qaTopic : qaSubtopic));
  await page.evaluateOnNewDocument(() => {
    window.__testSpeechRequests = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(utterance) {
          window.__testSpeechRequests.push(utterance.text);
          setTimeout(() => {
            utterance.onstart?.();
            utterance.onend?.();
          }, 0);
        },
      },
    });
  });
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  let ocrRequests = 0;
  page.on('request', (request) => {
    if (request.url() === 'http://localhost:3002/api/gemini/vision' && request.method() === 'OPTIONS') {
      void request.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
      return;
    }
    if (request.url() === 'http://localhost:3002/api/gemini/vision' && request.method() === 'POST') {
      ocrRequests += 1;
      void request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': origin },
        body: JSON.stringify(ocrPayload),
      });
      return;
    }
    if (request.url().startsWith(origin)) {
      void request.continue();
      return;
    }
    void request.abort();
  });

  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    document.querySelector('#entry-mode-detail').click();
    return document.querySelector('#input-meaning').required;
  });
  assert.equal(await page.$eval('#input-meaning', (input) => input.required), true);
  assert.equal(await page.$eval('#entry-mode-detail', (button) => button.getAttribute('aria-pressed')), 'true');
  await page.click('#entry-mode-quick');
  assert.equal(await page.$eval('#input-meaning', (input) => input.required), false);
  assert.equal(await page.$eval('#entry-mode-quick', (button) => button.getAttribute('aria-pressed')), 'true');
  await page.click('#entry-mode-detail');
  await page.waitForSelector('#input-mode-image');
  await page.click('#input-mode-image');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', {
      type: 'image/png',
    }));
    document.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: clipboard,
      bubbles: true,
      cancelable: true,
    }));
  });

  try {
    await page.waitForFunction(
      () => document.getElementById('input-word')?.value === 'clipboardtest',
      { timeout: 15000 },
    );
  } catch (error) {
    console.error('Clipboard E2E state:', await page.evaluate(() => ({
      status: document.getElementById('image-import-status')?.textContent,
      preview: document.getElementById('image-import-preview-img')?.src,
      imageMode: document.getElementById('input-mode-image')?.checked,
      word: document.getElementById('input-word')?.value,
    })));
    throw error;
  }
  assert.equal(ocrRequests, 1, 'pasting an image should make exactly one OCR request');
  assert.equal(
    await page.$eval('#image-import-preview-img', (image) => image.src.startsWith('data:image/png;base64,')),
    true,
    'pasted image should appear in the preview',
  );
  assert.doesNotMatch(
    await page.$eval('#image-import-status', (status) => status.textContent),
    /Nhập Gemini API key/i,
    'the browser should use the server-side OCR endpoint without asking for a client key',
  );

  await page.click('#image-import-rerun');
  await page.waitForFunction(
    () => document.getElementById('image-import-status')?.textContent.includes('Đã điền form'),
    { timeout: 15000 },
  );
  assert.equal(ocrRequests, 2, 'rerun should OCR the previously pasted image');

  await page.click('#entry-mode-quick');
  await page.$eval('#input-topic', (select) => {
    select.value = '__add_topic__';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction((topic) => document.getElementById('input-topic')?.value === topic, {}, qaTopic);
  const selectedTopic = await page.$eval('#input-topic', (select) => select.value);
  assert.equal(selectedTopic, qaTopic);
  await page.$eval('#input-subtopic', (select) => {
    select.value = '__add_subtopic__';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction((subtopic) => document.getElementById('input-subtopic')?.value === subtopic, {}, qaSubtopic);
  const selectedSubtopic = await page.$eval('#input-subtopic', (select) => select.value);
  assert.equal(selectedSubtopic, qaSubtopic);
  const quickPhrase = 'work-life balance';
  await page.$eval('#input-word', (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, quickPhrase);
  await page.$eval('#input-vietnamese-meaning', (input) => {
    input.value = 'cân bằng công việc và cuộc sống';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.$eval('#add-form', (form) => form.checkValidity()), true);
  assert.equal(await page.$eval('#input-meaning', (input) => input.required), false);
  await page.click('#quick-add-submit');
  await page.waitForFunction(
    () => document.getElementById('input-word')?.value === ''
      && document.getElementById('input-vietnamese-meaning')?.value === ''
      && document.getElementById('add-feedback')?.textContent.includes('Đã lưu'),
    { timeout: 15000 },
  );
  assert.equal(await page.$eval('#input-topic', (select) => select.value), selectedTopic);
  assert.equal(await page.$eval('#input-subtopic', (select) => select.value), selectedSubtopic);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'input-word');
  assert.equal(
    await page.$eval('.word-item[data-word="work-life balance"]', (card) => card.textContent.includes('Phrase')),
    true,
    'multi-word quick entries should be listed as phrases',
  );
  const savedQuickEntry = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('vocabularyTrainer.vocabulary.english') || '[]');
    return entries.find((entry) => entry.word === 'work-life balance');
  });
  assert.equal(savedQuickEntry?.meanings?.vietnamese, 'cân bằng công việc và cuộc sống');

  const noMeaningWord = 'quick empty meaning';
  await page.$eval('#input-word', (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, noMeaningWord);
  await page.click('#quick-add-submit');
  await page.waitForFunction(
    () => document.getElementById('input-word')?.value === ''
      && document.getElementById('input-vietnamese-meaning')?.value === ''
      && document.getElementById('add-feedback')?.textContent.includes('Đã lưu'),
    { timeout: 15000 },
  );
  assert.equal(await page.$eval('#input-topic', (select) => select.value), selectedTopic);
  assert.equal(await page.$eval('#input-subtopic', (select) => select.value), selectedSubtopic);
  const savedWithoutMeaning = await page.evaluate((word) => {
    const entries = JSON.parse(localStorage.getItem('vocabularyTrainer.vocabulary.english') || '[]');
    return entries.find((entry) => entry.word === word);
  }, noMeaningWord);
  assert.equal(savedWithoutMeaning?.meanings?.vietnamese, undefined);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (words) => words.every((word) => Array.from(document.querySelectorAll('.word-item'))
      .some((card) => card.dataset.word === word)),
    { timeout: 15000 },
    [quickPhrase, noMeaningWord],
  );
  const reloadedQuickEntry = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('vocabularyTrainer.vocabulary.english') || '[]');
    return entries.find((entry) => entry.word === 'work-life balance');
  });
  assert.equal(reloadedQuickEntry?.meanings?.vietnamese, 'cân bằng công việc và cuộc sống');
  await page.click('#entry-mode-detail');
  assert.equal(await page.$eval('#input-meaning', (input) => !input.closest('label').classList.contains('hidden')), true);

  const consoleErrorCountBeforeVisibilityTest = pageConsoleErrors.length;
  await page.click('.menu-button[data-page="test"]');
  await page.click('#test-mode-dictation');
  await page.click('#test-start');
  await page.waitForFunction(() => {
    const button = document.getElementById('test-word-visibility');
    return !document.getElementById('test-session')?.classList.contains('hidden')
      && button && !button.classList.contains('hidden');
  });
  const visibilityButton = '#test-word-visibility';
  await page.setViewport({ width: 375, height: 812 });
  const visibilityButtonBounds = await page.$eval(visibilityButton, (button) => {
    const { x, width, height } = button.getBoundingClientRect();
    return { x, width, height, viewportWidth: window.innerWidth };
  });
  assert.equal(visibilityButtonBounds.width >= 44 && visibilityButtonBounds.height >= 44, true);
  assert.equal(visibilityButtonBounds.x >= 0 && visibilityButtonBounds.x + visibilityButtonBounds.width <= visibilityButtonBounds.viewportWidth, true);
  const firstPromptCounter = await page.$eval('#test-counter', (counter) => counter.textContent);
  assert.match(await page.$eval('#test-example', (prompt) => prompt.textContent), /^Word: /);

  await page.click(visibilityButton);
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-label')), 'Hiện từ vựng');
  assert.match(await page.$eval('#test-example', (prompt) => prompt.textContent), /^Word: ••••••$/);
  await page.click(visibilityButton);
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'false');
  await page.click(visibilityButton);
  await page.focus(visibilityButton);
  await page.keyboard.press('Space');
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'false');
  await page.keyboard.press('Space');
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'true');

  await page.$eval('#dictation-mode-select', (select) => {
    select.value = 'example';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.$eval(visibilityButton, (button) => button.classList.contains('hidden')), true);
  await page.$eval('#dictation-mode-select', (select) => {
    select.value = 'word';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'true');

  let speechRequestCount = await page.evaluate(() => window.__testSpeechRequests.length);
  await page.click('#test-listen');
  await page.waitForFunction((count) => window.__testSpeechRequests.length > count, {}, speechRequestCount);
  const firstSpokenWord = await page.evaluate(() => window.__testSpeechRequests.at(-1));
  assert.equal(firstSpokenWord.length > 0, true);
  assert.equal(await page.$eval('#test-example', (prompt) => prompt.textContent), 'Word: ••••••');
  await page.$eval('#test-answer', (input, answer) => {
    input.value = answer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, firstSpokenWord);
  await page.click('#test-submit');
  await page.waitForFunction(() => document.getElementById('test-answer')?.disabled);
  assert.match(await page.$eval('#test-message', (message) => message.textContent), /Chính xác/);
  await page.waitForFunction(
    (counter) => document.getElementById('test-counter')?.textContent !== counter,
    { timeout: 10000 },
    firstPromptCounter,
  );
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'true');
  assert.match(await page.$eval('#test-example', (prompt) => prompt.textContent), /^Word: ••••••$/);

  speechRequestCount = await page.evaluate(() => window.__testSpeechRequests.length);
  await page.click('#test-listen');
  await page.waitForFunction((count) => window.__testSpeechRequests.length > count, {}, speechRequestCount);
  const nextSpokenWord = await page.evaluate(() => window.__testSpeechRequests.at(-1));
  await page.$eval('#test-answer', (input, answer) => {
    input.value = answer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, nextSpokenWord);
  await page.click('#test-submit');
  await page.waitForFunction(() => !document.getElementById('test-summary')?.classList.contains('hidden'));

  await page.click('#test-restart');
  await page.click('#test-start');
  await page.waitForFunction(() => !document.getElementById('test-word-visibility')?.classList.contains('hidden'));
  assert.equal(await page.$eval(visibilityButton, (button) => button.getAttribute('aria-pressed')), 'false');
  assert.doesNotMatch(await page.$eval('#test-example', (prompt) => prompt.textContent), /••••••/);
  assert.equal(
    pageConsoleErrors.length,
    consoleErrorCountBeforeVisibilityTest,
    `new browser console errors during Dictation visibility test: ${pageConsoleErrors.slice(consoleErrorCountBeforeVisibilityTest).join('; ')}; HTTP errors: ${pageHttpErrors.join('; ')}`,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('.menu-button[data-page="test"]');
  assert.equal(await page.$eval(visibilityButton, (button) => button.classList.contains('hidden')), true);
  assert.equal(pageErrors.length, 0, `browser JavaScript errors: ${pageErrors.join('; ')}`);

  console.log('ENTRY MODE E2E PASSED: quick phrases, optional meanings, selection retention, and reload.');
  console.log('IMAGE PASTE E2E PASSED: pasted image was imported and OCR rerun reused it.');
  console.log('DICTATION VISIBILITY E2E PASSED: toggle, keyboard, listen, answer, next question, new test, and reload.');
} finally {
  if (browser) {
    await browser.close();
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
