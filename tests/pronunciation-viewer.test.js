import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordProgressRenderer, splitTextIntoTokens } from '../pronunciation-viewer.js';

test('splitTextIntoTokens keeps a word intact unless IPA is available', () => {
  const tokens = splitTextIntoTokens('competence');

  assert.deepEqual(tokens.map((token) => token.text), ['competence']);
});

test('splitTextIntoTokens divides IPA at syllable boundaries and preserves stress marks', () => {
  const tokens = splitTextIntoTokens('/ˈkɒm.pə.təns/', { ipa: true });

  assert.deepEqual(tokens.map((token) => token.text), ['ˈkɒm', 'pə', 'təns']);
});

test('splitTextIntoTokens keeps IPA without syllable markers as one transcription', () => {
  const tokens = splitTextIntoTokens('/əˈses/', { ipa: true });

  assert.deepEqual(tokens.map((token) => token.text), ['əˈses']);
});

test('word progress escapes transcriptions before rendering them as HTML', () => {
  let html = '';
  const container = {};
  Object.defineProperty(container, 'innerHTML', {
    get: () => html,
    set: (value) => {
      html = value;
    },
  });
  const renderer = createWordProgressRenderer(container);

  renderer.setText('<ʃ/>', { ipa: true });

  assert.match(html, /&lt;ʃ\/&gt;/);
  assert.doesNotMatch(html, /<ʃ\/>/);
});

test('word progress stops rendering after all tokens are completed', () => {
  let html = '';
  let renderCount = 0;
  const container = {};
  Object.defineProperty(container, 'innerHTML', {
    get: () => html,
    set: (value) => {
      html = value;
      renderCount += 1;
    },
  });
  const renderer = createWordProgressRenderer(container);

  renderer.setText('blue print');
  assert.equal(renderer.tick(), true);
  assert.equal(renderer.tick(), false);
  const completedRenderCount = renderCount;

  assert.equal(renderer.tick(), false);
  assert.equal(renderCount, completedRenderCount);
});
