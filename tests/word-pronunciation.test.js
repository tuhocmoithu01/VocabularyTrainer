import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWordPronunciationVariants, parseWiktionaryPronunciations } from '../dictionary.js';

test('Wiktionary pronunciation parser returns separately labeled UK and US IPA and audio', () => {
  const source = [
    '===Pronunciation===',
    '* {{IPA|en|/ˈkɒm.pə.təns/|a=UK}}',
    '** {{audio|en|competence-uk.wav|a=Southern England}}',
    '* {{IPA|en|/ˈkɑm.pə.təns/|a=US,Atlantic Canada}}',
    '** {{audio|en|competence-us.wav|a=US}}',
  ].join('\n');

  assert.deepEqual(parseWiktionaryPronunciations(source, 'competence'), {
    uk: {
      ipa: '/ˈkɒm.pə.təns/',
      audio: 'https://commons.wikimedia.org/wiki/Special:FilePath/competence-uk.wav',
      audioSourceUrl: 'https://commons.wikimedia.org/wiki/File:competence-uk.wav',
    },
    us: {
      ipa: '/ˈkɑm.pə.təns/',
      audio: 'https://commons.wikimedia.org/wiki/Special:FilePath/competence-us.wav',
      audioSourceUrl: 'https://commons.wikimedia.org/wiki/File:competence-us.wav',
    },
    sourceUrl: 'https://en.wiktionary.org/wiki/competence',
  });
});

test('Wiktionary pronunciation parser does not guess an accent when none is labeled', () => {
  const source = '* {{IPA|en|/əˈses/}}';

  assert.deepEqual(parseWiktionaryPronunciations(source, 'assess'), {
    uk: null,
    us: null,
    sourceUrl: 'https://en.wiktionary.org/wiki/assess',
  });
});

test('Wiktionary pronunciation parser keeps UK-only and US-only results independent', () => {
  const ukOnly = parseWiktionaryPronunciations('* {{IPA|en|/ˈwɜːd/|a=UK}}', 'word');
  const usOnly = parseWiktionaryPronunciations('* {{IPA|en|/ˈwɝd/|a=US}}', 'word');

  assert.equal(ukOnly.uk.ipa, '/ˈwɜːd/');
  assert.equal(ukOnly.us, null);
  assert.equal(usOnly.uk, null);
  assert.equal(usOnly.us.ipa, '/ˈwɝd/');
});

test('Wiktionary maps audio labeled California only to US when IPA is shared', () => {
  const source = [
    '* {{IPA|en|/əˈsɛs/|a=RP,GA,CA}}',
    '** {{audio|en|en-us-assess.ogg|a=California}}',
  ].join('\n');
  const result = parseWiktionaryPronunciations(source, 'assess');

  assert.equal(result.uk.ipa, '/əˈsɛs/');
  assert.equal(result.us.ipa, '/əˈsɛs/');
  assert.equal(result.uk.audio, '');
  assert.match(result.us.audio, /en-us-assess\.ogg/);
});

test('Wiktionary maps a shared IPA only to accents explicitly labeled by audio', () => {
  const result = parseWiktionaryPronunciations([
    '* {{IPA|en|/pɪk/|[pʰɪk]}}',
    '* {{audio|en|pick-uk.ogg|a=UK}}',
    '* {{audio|en|pick-us.ogg|a=US}}',
  ].join('\n'), 'pick');
  const usOnly = parseWiktionaryPronunciations([
    '* {{IPA|en|/plænd/}}',
    '* {{audio|en|en-us-planned.ogg|a=US}}',
  ].join('\n'), 'planned');

  assert.equal(result.uk.ipa, '/pɪk/');
  assert.match(result.uk.audio, /pick-uk\.ogg/);
  assert.equal(result.us.ipa, '/pɪk/');
  assert.match(result.us.audio, /pick-us\.ogg/);
  assert.equal(usOnly.uk, null);
  assert.equal(usOnly.us.ipa, '/plænd/');
  assert.match(usOnly.us.audio, /en-us-planned\.ogg/);
});

test('Wiktionary reads common pick, planned, and meeting pronunciation templates', () => {
  const pick = parseWiktionaryPronunciations([
    '* {{IPA|en|/pɪk/|[pʰɪk]}}',
    '* {{audio|en|LL-Q1860 (eng)-Back ache-pick.wav|a=UK}}',
    '* {{audio|en|en-us-pick.ogg|a=US}}',
  ].join('\n'), 'pick');
  const planned = parseWiktionaryPronunciations([
    '* {{IPA|en|/plænd/}}',
    '* {{audio|en|en-us-planned.ogg|a=US}}',
  ].join('\n'), 'planned');
  const meeting = parseWiktionaryPronunciations([
    '* {{IPA|en|/ˈmiːtɪŋ/|a=UK}}',
    '* {{IPA|en|/ˈmitɪŋ/|a=US}}',
    '* {{audio|en|en-us-meeting.ogg|a=US}}',
  ].join('\n'), 'meeting');

  assert.equal(pick.uk.ipa, '/pɪk/');
  assert.equal(pick.us.ipa, '/pɪk/');
  assert.equal(planned.uk, null);
  assert.equal(planned.us.ipa, '/plænd/');
  assert.equal(meeting.uk.ipa, '/ˈmiːtɪŋ/');
  assert.equal(meeting.us.ipa, '/ˈmitɪŋ/');
});

test('Wiktionary recognizes US regional pronunciation labels', () => {
  const result = parseWiktionaryPronunciations([
    '* {{IPA|en|/jɪ/|/jə/|a=Pacific Northwest,CA}}',
    '* {{audio|en|en-us-you unstressed.ogg|a=US}}',
  ].join('\n'), 'you');

  assert.equal(result.us.ipa, '/jɪ/');
  assert.equal(result.uk, null);
  assert.match(result.us.audio, /en-us-you%20unstressed\.ogg/);
});

test('pronunciation lookup requests the English Wiktionary parse endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        parse: {
          wikitext: '* {{IPA|en|/ˈkɒm.pə.təns/|a=UK}}\n* {{IPA|en|/ˈkɑm.pə.təns/|a=US}}',
        },
      }),
    };
  };

  try {
    const result = await fetchWordPronunciationVariants('competence');

    assert.match(requestedUrl, /^https:\/\/en\.wiktionary\.org\/w\/api\.php\?/);
    assert.match(requestedUrl, /page=competence/);
    assert.equal(result.uk.ipa, '/ˈkɒm.pə.təns/');
    assert.equal(result.us.ipa, '/ˈkɑm.pə.təns/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pronunciation lookup normalizes and requests a complete phrase', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        parse: {
          wikitext: '* {{IPA|en|/ə ˈplænd ˈmiː.tɪŋ/|a=UK}}',
        },
      }),
    };
  };

  try {
    const result = await fetchWordPronunciationVariants('  a   planned meeting ');
    const query = new URL(requestedUrl).searchParams;

    assert.equal(query.get('page'), 'a_planned_meeting');
    assert.equal(result.uk.ipa, '/ə ˈplænd ˈmiː.tɪŋ/');
    assert.equal(result.us, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pronunciation lookup caches each accent independently by normalized Wiktionary key', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        parse: {
          wikitext: [
            '* {{IPA|en|/wɜːd/|a=UK}}',
            '* {{audio|en|word-uk.ogg|a=UK}}',
          ].join('\n'),
        },
      }),
    };
  };

  try {
    const first = await fetchWordPronunciationVariants('Cache-Test-UK');
    const second = await fetchWordPronunciationVariants('  cache-test-uk. ');

    assert.equal(requestCount, 1);
    assert.equal(first.uk.ipa, '/wɜːd/');
    assert.equal(second.uk.ipa, '/wɜːd/');
    assert.equal(second.us, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pronunciation lookup times out when Wiktionary never responds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  try {
    await assert.rejects(
      fetchWordPronunciationVariants('timeout-test-phrase-2026'),
      /timed out/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pronunciation lookup surfaces network errors without caching them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      fetchWordPronunciationVariants('network-error-test-2026'),
      /Failed to fetch/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
