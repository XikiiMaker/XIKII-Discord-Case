const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TranslationEngine, needsTranslation, protectText } = require('../app/code/main/translation/engine.js');
const { defaultTranslationSettings, parseSettings, parseRequest, conversation, ruleFor } = require('../app/code/common/translation.js');
const config = (patch = {}) => ({ ...structuredClone(defaultTranslationSettings), consent: true, ...patch });
const request = (text = 'Hello', patch = {}) => ({ text, target: 'zh', context: [], ...patch });
const success = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }), { status: 200 });

void test('confirmed defaults: preview, no context, private messages on and channels off after consent', () => {
  assert.equal(defaultTranslationSettings.sendMode, 'preview');
  assert.equal(defaultTranslationSettings.contextCount, 0);
  assert.equal(ruleFor(defaultTranslationSettings, { id: '12', dm: true }).enabled, false);
  assert.equal(ruleFor(config(), { id: '12', dm: true }).enabled, true);
  assert.equal(ruleFor(config(), { id: '12', dm: false }).enabled, false);
  assert.equal(ruleFor(config({ dmEnabled: false, channels: { '12': { enabled: true, target: 'ja' } } }), { id: '12', dm: true }).enabled, false);
});
void test('routes and input boundaries reject malformed, oversized and foreign requests', () => {
  assert.deepEqual(conversation('https://discord.com/channels/@me/123'), { id: '123', dm: true });
  assert.equal(conversation('https://discord.com.evil.test/channels/@me/123'), null);
  assert.equal(conversation('https://discord.com/login'), null);
  assert.throws(() => parseRequest(request('a'.repeat(8001))));
  assert.throws(() => parseRequest(request('Hi', { context: Array(11).fill('x') })));
  assert.throws(() => parseSettings(config({ region: 'http://evil.test' })));
  assert.throws(() => parseSettings(config({ concurrency: 0 })));
  assert.throws(() => parseSettings(config({ channels: { '__bad': { enabled: true, target: 'zh' } } })));
});
void test('skip Chinese / only protected content but translate short foreign greetings and Japanese kana', () => {
  assert.equal(needsTranslation('你好！ <@123> https://example.com', 'zh'), false);
  assert.equal(needsTranslation('```js\nconst a = 1\n``` 🎉', 'zh'), false);
  assert.equal(needsTranslation('Hi', 'zh'), true);
  assert.equal(needsTranslation('今日は元気です', 'zh'), true);
  assert.equal(needsTranslation('你好 USB', 'zh'), true);
});
void test('format tokens are lossless and refuse missing or duplicate placeholders', () => {
  const text = 'Hi <@123> <#456> <:wave:789> `x` https://example.com/a?b=1 @everyone';
  const protectedText = protectText(text);
  assert.equal(protectedText.restore(protectedText.masked), text);
  assert.throws(() => protectedText.restore('missing'));
  assert.throws(() => protectedText.restore(protectedText.masked + protectedText.masked));
});
void test('same concurrent requests coalesce, cache hits avoid cost, config / context / keys separate cache', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return success('你好'); });
  const opts = config({ contextCount: 2 });
  assert.deepEqual(await Promise.all([engine.translate(request(), opts, 'key'), engine.translate(request(), opts, 'key')]), ['你好', '你好']);
  await engine.translate(request(), opts, 'key'); assert.equal(calls, 1);
  await engine.translate(request(), { ...opts, model: 'qwen-plus' }, 'key');
  await engine.translate(request('Hello', { context: ['different conversation'] }), opts, 'key');
  await engine.translate(request(), opts, 'other-key');
  assert.equal(calls, 4);
});
void test('LRU eviction and disabled cache work', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async () => { calls++; return success('译文'); });
  // LRU recency is intentionally tested sequentially.
  // oxlint-disable-next-line no-await-in-loop
  for (const text of ['a', 'b', 'a', 'c', 'b']) await engine.translate(request(text), config({ cacheSize: 2 }), 'key');
  assert.equal(calls, 4);
  engine.clear();
  await engine.translate(request(), config({ cacheSize: 0 }), 'key');
  await engine.translate(request(), config({ cacheSize: 0 }), 'key');
  assert.equal(calls, 6);
});
void test('queue enforces concurrency, then drains successfully', async () => {
  let active = 0, maximum = 0;
  const engine = new TranslationEngine(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return success('译文'); });
  await Promise.all(Array.from({ length: 8 }, (_, i) => engine.translate(request(`hello${i}`), config(), 'key')));
  assert.equal(maximum, 2);
});
void test('provider payload uses membership prompt, excludes context when disabled, and truncates context count', async () => {
  const sent = [];
  const engine = new TranslationEngine(async (url, init) => { sent.push([url, JSON.parse(init.body)]); return success('译文'); });
  await engine.translate(request('Hi', { context: ['private context'] }), config(), 'key');
  assert.deepEqual(JSON.parse(sent[0][1].messages[1].content).context, []);
  assert.match(sent[0][1].messages[0].content, /产品型号、品牌名称/);
  await engine.translate(request('Hey', { context: ['a', 'b', 'c'] }), config({ contextCount: 2 }), 'key');
  assert.deepEqual(JSON.parse(sent[1][1].messages[1].content).context, ['b', 'c']);
});
void test('failures are not cached and raw server errors are not exposed', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async () => ++calls === 1 ? new Response('SECRET SERVER BODY', { status: 401 }) : success('你好'));
  await assert.rejects(engine.translate(request(), config(), 'key'), error => /API Key/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(await engine.translate(request(), config(), 'key'), '你好');
  assert.equal(calls, 2);
});
void test('truncated or malformed responses are not sent', async () => {
  const engine = new TranslationEngine(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] })));
  await assert.rejects(engine.translate(request(), config(), 'key'), /不完整/);
});
void test('reset cancels active and queued work without refilling the cache', async () => {
  const engine = new TranslationEngine(async (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }));
  const first = engine.translate(request('first'), config({ concurrency: 1 }), 'key');
  const second = engine.translate(request('second'), config({ concurrency: 1 }), 'key');
  const rejected = Promise.all([assert.rejects(first, /取消/), assert.rejects(second, /设置已变化/)]);
  engine.clear(); await rejected;
});
void test('queue overflow fails promptly instead of scheduling unlimited spending', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new TranslationEngine(async () => { await gate; return success('译文'); });
  const scheduled = Array.from({ length: 41 }, (_, i) => engine.translate(request(`message${i}`), config({ concurrency: 1 }), 'key'));
  await assert.rejects(engine.translate(request('overflow'), config({ concurrency: 1 }), 'key'), /队列已满/);
  release(); await Promise.all(scheduled);
});

