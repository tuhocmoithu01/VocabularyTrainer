const CACHE_NAME = 'vocabulary-trainer-static-v14';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/images/background.jpg',
  '/assets/images/pronunciation-avatar-closed.png',
  '/assets/images/pronunciation-avatar-half.png',
  '/assets/images/pronunciation-avatar-open.png',
  '/assets/images/pronunciation-avatar-small.png',
  '/assets/images/pronunciation-avatar-wide.png',
  '/sounds/correct.mp3',
  '/sounds/wrong.mp3',
  '/ai-expansion.js',
  '/app.js',
  '/auto-next.js',
  '/data-access.js',
  '/dictionary.js',
  '/firebase.js',
  '/language-config.js',
  '/language-manager.js',
  '/learn.js',
  '/pronunciation-avatar.js',
  '/pronunciation-feedback.js',
  '/pronunciation-history.js',
  '/pronunciation-integration.js',
  '/pronunciation-viewer.js',
  '/sound.js',
  '/speaking-mode.js',
  '/speaking-test-flow.js',
  '/speech-recognition.js',
  '/speech-state.js',
  '/speech.js',
  '/storage.js',
  '/test.js',
  '/config/gemini-config.js',
  '/services/gemini-vision.js',
];
const STATIC_ASSET_PATHS = new Set(
  STATIC_ASSETS.map((asset) => new URL(asset, self.registration.scope).pathname),
);
const FIREBASE_SDK_URL = /^https:\/\/www\.gstatic\.com\/firebasejs\/12\.5\.0\/[^?#]+\.js$/;
const FIREBASE_SDK_ENTRY_POINTS = [
  'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js',
];

async function cacheFirebaseSdkModules(cache) {
  const pendingUrls = [...FIREBASE_SDK_ENTRY_POINTS];
  const cachedUrls = new Set();

  while (pendingUrls.length) {
    const moduleUrl = new URL(pendingUrls.pop());
    if (
      moduleUrl.origin !== 'https://www.gstatic.com' ||
      !moduleUrl.pathname.startsWith('/firebasejs/12.5.0/') ||
      !moduleUrl.pathname.endsWith('.js') ||
      cachedUrls.has(moduleUrl.href)
    ) {
      continue;
    }

    cachedUrls.add(moduleUrl.href);
    const response = await fetch(moduleUrl.href);
    if (!response.ok) {
      throw new Error(`Failed to cache Firebase SDK module (${response.status}): ${moduleUrl.href}`);
    }

    const source = await response.clone().text();
    await cache.put(moduleUrl.href, response);

    const moduleSpecifiers = [
      ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ];
    moduleSpecifiers.forEach((match) => {
      const dependencyUrl = new URL(match[1], moduleUrl);
      if (
        dependencyUrl.origin === 'https://www.gstatic.com' &&
        dependencyUrl.pathname.startsWith('/firebasejs/12.5.0/') &&
        dependencyUrl.pathname.endsWith('.js') &&
        !cachedUrls.has(dependencyUrl.href)
      ) {
        pendingUrls.push(dependencyUrl.href);
      }
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      try {
        await cacheFirebaseSdkModules(cache);
      } catch (error) {
        console.warn('Failed to precache Firebase SDK modules for offline use', error);
      }
    })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('vocabulary-trainer-static-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin === self.location.origin && STATIC_ASSET_PATHS.has(requestUrl.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
          try {
            const response = await fetch(request);
            if (response.ok) {
              await cache.put(request, response.clone());
            }
            return response;
          } catch (error) {
            const cachedResponse = await cache.match(request, { ignoreSearch: true });
            if (cachedResponse) {
              return cachedResponse;
            }
            throw error;
          }
        }

        const cachedResponse = await cache.match(request, { ignoreSearch: true });
        if (cachedResponse) {
          return cachedResponse;
        }

        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  if (FIREBASE_SDK_URL.test(request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
