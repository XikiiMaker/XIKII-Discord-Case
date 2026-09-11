const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TranslationEngine } = require('../app/code/main/translation/engine.js');
const { defaultTranslationSettings, parseSettings } = require('../app/code/common/translation.js');
const request = { text: 'Hi <@123> https://example.com `USB-C`', target: 'zh', context: ['private conversation'] };
const config = { ...defaultTranslationSettings, contextCount: 1, fallback: { enabled: true, endpoint: 'https://fallback.test/translate' } };
const failure = () => new Response('PRIVATE SERVER ERROR', { status: 503 });
const primary = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '主引擎译文' } }] }));
const fallback = () => new Response(JSON.stringify({ translatedText: ['你好'] }));

void test('fallback is opt-in and validates configured destinations without embedded credentials', () => {
  const legacy = { ...defaultTranslationSettings }; delete legacy.fallback;
  assert.deepEqual(parseSettings(legacy).fallback, { enabled: false, endpoint: '' });
  for (const endpoint of ['', 'http://remote.test/translate', 'https://user:secret@host.test/translate', 'https://host.test/translate?key=secret', 'file:///translate', 'https://host.test/translate#x'])
    assert.throws(() => parseSettings({ ...config, fallback: { enabled: true, endpoint } }));
  assert.equal(parseSettings({ ...config, fallback: { enabled: true, endpoint: 'http://localhost:5000/translate' } }).fallback.endpoint, 'http://localhost:5000/translate');
});
void test('healthy Qwen never calls fallback and disabled fallback preserves the primary error', async () => {
  const urls = [];
  const engine = new TranslationEngine(async url => { urls.push(url); return primary(); });
  assert.equal(await engine.translate({ ...request, text: 'Hello' }, config, 'qwen-key'), '主引擎译文');
  assert.equal(urls.length, 1); assert(!urls.includes(config.fallback.endpoint));
  const failing = new TranslationEngine(async url => { urls.push(url); return failure(); });
  await assert.rejects(failing.translate(request, defaultTranslationSettings, 'qwen-key'), /Qwen 服务错误/);
  assert.equal(urls.length, 2);
});
void test('fallback preserves special content, uses its own key, excludes context and coalesces requests', async () => {
  const calls = [], progress = [];
  const engine = new TranslationEngine(async (url, init) => {
    calls.push([url, init]);
    if (url !== config.fallback.endpoint) return failure();
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { q: ['Hi'], source: 'auto', target: 'zh', format: 'text', api_key: 'fallback-key' });
    assert(!JSON.stringify(init).includes('qwen-key')); assert(!JSON.stringify(init).includes('private conversation'));
    assert.equal(init.redirect, 'error');
    return fallback();
  });
  const expected = '你好 <@123> https://example.com `USB-C`';
  assert.deepEqual(await Promise.all([
    engine.translate(request, config, 'qwen-key', (text, provider) => progress.push({ text, provider }), 'fallback-key'),
    engine.translate(request, config, 'qwen-key', undefined, 'fallback-key')
  ]), [expected, expected]);
  assert.equal(calls.length, 2);
  assert.deepEqual(progress, [{ text: '', provider: 'libretranslate' }, { text: expected, provider: 'libretranslate' }]);
  assert.equal(await engine.translate(request, config, 'qwen-key', undefined, 'fallback-key'), expected);
  assert.equal(calls.length, 2);
});
void test('fallback failures are not cached and provider response bodies do not enter errors', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async url => { calls++; return url === config.fallback.endpoint ? new Response(JSON.stringify({ translatedText: [] })) : failure(); });
  await assert.rejects(engine.translate(request, config, 'key'), error => /备用引擎返回无效/.test(error.message) && !error.message.includes('PRIVATE'));
  await assert.rejects(engine.translate(request, config, 'key'), /无效/);
  assert.equal(calls, 4);
});
void test('changing fallback key or endpoint separates cached results', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async url => { calls++; return url.includes('dashscope') ? failure() : fallback(); });
  await engine.translate(request, config, 'primary-key', undefined, 'first');
  await engine.translate(request, config, 'primary-key', undefined, 'second');
  await engine.translate(request, { ...config, fallback: { ...config.fallback, endpoint: 'https://another.test/translate' } }, 'primary-key', undefined, 'second');
  assert.equal(calls, 6);
});
void test('settings cancellation prevents failover and aborts an active fallback', async () => {
  const calls = [];
  const blocked = new TranslationEngine(async (url, init) => {
    calls.push(url);
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  const pending = blocked.translate(request, config, 'key');
  const rejected = assert.rejects(pending, /取消/); blocked.cancel(); await rejected;
  assert.equal(calls.length, 1);
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const engine = new TranslationEngine(async (url, init) => {
    if (url !== config.fallback.endpoint) return failure();
    reached();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  const inFallback = engine.translate(request, config, 'key');
  await entered;
  const cancelled = assert.rejects(inFallback, /备用翻译已取消/); engine.cancel(); await cancelled;
});
void test('fallback translations stay out of the persisted cache', async () => {
  const disk = new Map();
  const persistence = { get: hash => disk.get(hash), set: (hash, entry) => { disk.set(hash, entry); }, clear: () => { disk.clear(); } };
  const engine = new TranslationEngine(async url => url === config.fallback.endpoint ? fallback() : failure(), persistence);
  assert.equal(await engine.translate(request, config, 'key'), '你好 <@123> https://example.com `USB-C`');
  // A degraded result must expire quickly in memory, never outlive a restart.
  assert.equal(disk.size, 0);
});
void test('a failed Qwen stream is discarded before switching provider', async () => {
  const progress = [];
  const engine = new TranslationEngine(async url => url === config.fallback.endpoint ? fallback() : new Response('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\n'));
  const translated = await engine.translate(request, { ...config, streaming: true }, 'key', text => progress.push(text));
  assert.equal(translated, '你好 <@123> https://example.com `USB-C`');
  assert.deepEqual(progress, ['unfinished', '', translated]);
});
void test('fallback cache expires after one minute so the primary provider can recover', async () => {
  const realNow = Date.now;
  let now = realNow(), calls = 0;
  Date.now = () => now;
  try {
    const engine = new TranslationEngine(async url => { calls++; return url === config.fallback.endpoint ? fallback() : failure(); });
    await engine.translate(request, config, 'key');
    now += 59_000;
    await engine.translate(request, config, 'key'); assert.equal(calls, 2);
    now += 1_001;
    await engine.translate(request, config, 'key'); assert.equal(calls, 4);
  } finally { Date.now = realNow; }
});
