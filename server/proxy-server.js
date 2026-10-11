import http from 'http';
import fs from 'fs';
import path from 'path';
import { requestGeminiVision } from '../functions/gemini-vision-provider.js';

const DEFAULT_PORT = 3002;

function readLocalGeminiConfig() {
  const p = path.join(process.cwd(), 'config', 'api_gemini.js');
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const configObjMatch = txt.match(/window\.__GEMINI_CONFIG__\s*=\s*\{([\s\S]*?)\};/m);
    const objText = configObjMatch ? configObjMatch[1] : '';
    const apiKeyMatch = objText.match(/apiKey\s*:\s*['"]([^'"]*)['"]/);
    const modelMatch = objText.match(/model\s*:\s*['"]([^'"]*)['"]/);
    const providerMatch = objText.match(/provider\s*:\s*['"]([^'"]*)['"]/);
    const authTypeMatch = objText.match(/authType\s*:\s*['"]([^'"]*)['"]/);
    return {
      source: 'config/api_gemini.js',
      path: p,
      apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
      model: modelMatch ? modelMatch[1] : 'gemini-2.5-flash',
      provider: providerMatch ? providerMatch[1] : '',
      authType: authTypeMatch ? authTypeMatch[1] : '',
      missing: false,
    };
  } catch (e) {
    return { source: 'config/api_gemini.js', path: p, apiKey: '', model: '', provider: '', authType: '', missing: true };
  }
}

function validateGeminiConfig(config) {
  if (config.missing) return 'Gemini API key chưa được cấu hình trong api_gemini.js';
  if (!config.apiKey || !String(config.apiKey).trim()) {
    return 'Gemini API key chưa được cấu hình trong api_gemini.js';
  }
  if (!config.authType || String(config.authType).trim() !== 'API_KEY') {
    return 'Gemini authType phải là API_KEY trong api_gemini.js';
  }
  return '';
}

function buildGeminiHeaders(config) {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': config.apiKey,
  };
}

function buildGeminiUrl(baseUrl, config) {
  if (config.authType === 'API_KEY' && config.apiKey) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}key=${encodeURIComponent(config.apiKey)}`;
  }
  return baseUrl;
}

function logGeminiMetadata(config, endpoint) {
  console.log('[GEMINI DEBUG] authType: API_KEY');
  console.log('[GEMINI DEBUG] source:', config.source);
  console.log('[GEMINI DEBUG] model:', config.model);
  console.log('[GEMINI DEBUG] endpoint:', endpoint);
}

function redact(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/(Bearer\s+|AIza[0-9A-Za-z_\-]{10,}|AQ\.[A-Za-z0-9_\-\.]{8,})/g, '<REDACTED>');
}

export async function startProxy(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    // CORS preflight handling
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '3600',
      });
      res.end();
      return;
    }

    // Simple health
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/gemini/vision') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload;
      try { payload = JSON.parse(body); } catch (e) { payload = {}; }

      const config = readLocalGeminiConfig();
      const validationError = validateGeminiConfig(config);
      const imageBase64 = payload.imageBase64 || '';
      const mimeType = payload.mimeType || 'image/png';
      const model = config.model || payload.model || 'gemini-3.5-flash-lite';
      const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;

      logGeminiMetadata(config, url);
      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: validationError }));
        return;
      }

      const result = await requestGeminiVision({
        apiKey: config.apiKey,
        imageBase64,
        mimeType,
        model,
        prompt: payload.prompt,
      });
      console.log('[GEMINI GOOGLE RESPONSE] status:', result.status);
      console.log('[GEMINI GOOGLE RESPONSE] endpoint:', url);
      console.log('[GEMINI GOOGLE RESPONSE] model:', model);
      res.writeHead(result.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result.body));
      return;
    }

    // TEXT test route — simple server-side wrapper to test TEXT prompt using same auth
    if (req.method === 'POST' && req.url === '/api/gemini/text_test') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload;
      try { payload = JSON.parse(body); } catch (e) { payload = {}; }

      const config = readLocalGeminiConfig();
      const validationError = validateGeminiConfig(config);

      const model = config.model || payload.model || 'gemini-3.5-flash-lite';
      const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
      const prompt = payload.prompt || 'Reply with exactly: GEMINI_OK';

      const requestBody = {
        contents: [
          {
            parts: [
              { text: prompt },
            ],
          },
        ],
      };

      logGeminiMetadata(config, url);
      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: validationError }));
        return;
      }

      const headers = buildGeminiHeaders(config);

      try {
        console.log('[GEMINI DEBUG] text_test: endpoint', url, 'model', model);
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
        const text = await resp.text();
        const sanitized = redact(text);
        console.log('[GEMINI GOOGLE RESPONSE] text_test status:', resp.status);
        console.log('[GEMINI GOOGLE RESPONSE] text_test endpoint:', url);
        console.log('[GEMINI GOOGLE RESPONSE] text_test model:', model);
        console.log('[GEMINI GOOGLE RESPONSE] text_test body:', sanitized.slice(0, 4000));
        res.writeHead(resp.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        try {
          const json = JSON.parse(text);
          res.end(resp.status >= 400
            ? JSON.stringify({ ok: false, status: resp.status, provider: 'google', errorCode: json?.error?.code || '', errorStatus: json?.error?.status || '', error: json?.error?.message || sanitized, providerResponse: json })
            : JSON.stringify(json));
        } catch (e) {
          res.end(JSON.stringify({ ok: false, status: resp.status, provider: 'google', error: sanitized, raw: sanitized }));
        }
        return;
      } catch (err) {
        const msg = redact(String(err.message || err));
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, status: 502, provider: 'google', error: msg }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] && process.argv[1].endsWith('proxy-server.js')) {
  // Started as script
  startProxy().then(() => console.log('Proxy server started on port', DEFAULT_PORT));
}
