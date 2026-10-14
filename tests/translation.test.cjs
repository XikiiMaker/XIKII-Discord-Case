const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TranslationEngine, needsTranslation, protectText } = require('../app/code/main/translation/engine.js');
const { defaultTranslationSettings, parseSettings, migrateStoredSettings, parseRequest, conversation, ruleFor, modelRetirementNotice } = require('../app/code/common/translation.js');
const config = (patch = {}) => ({ ...structuredClone(defaultTranslationSettings), consent: true, ...patch });
const request = (text = 'Hello', patch = {}) => ({ text, target: 'zh', context: [], ...patch });
const success = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }), { status: 200 });

void test('current defaults: direct send, no context, private messages on and channels off after consent', () => {
  assert.equal(defaultTranslationSettings.model, 'qwen-flash');
  assert.equal(Object.hasOwn(defaultTranslationSettings, 'sendMode'), false);
  assert.equal(Object.hasOwn(parseSettings(config({ sendMode: 'preview' })), 'sendMode'), false, 'legacy preview setting is discarded');
  assert.equal(defaultTranslationSettings.contextCount, 0);
  assert.equal(ruleFor(defaultTranslationSettings, { id: '12', dm: true }).enabled, false);
  assert.equal(ruleFor(config(), { id: '12', dm: true }).enabled, true);
  assert.equal(ruleFor(config(), { id: '12', dm: false }).enabled, false);
  assert.equal(ruleFor(config({ dmEnabled: false, channels: { '12': { enabled: true, target: 'ja' } } }), { id: '12', dm: true }).enabled, false);
});
void test('legacy model settings are retained until an explicit save, with a retirement notice', () => {
  const legacy = config({ model: 'qwen-turbo', contextCount: 3, concurrency: 4 });
  const migrated = migrateStoredSettings(legacy);
  assert.equal(migrated.model, 'qwen-turbo');
  assert.equal(migrated.contextCount, 3); assert.equal(migrated.concurrency, 4);
  assert.match(modelRetirementNotice(migrated.model), /下线.*qwen-flash.*保存/);
  assert.equal(modelRetirementNotice('qwen-flash'), undefined);
  assert.equal(modelRetirementNotice('qwen-plus'), undefined);
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
void test('skip Chinese / protected content / unsupported languages, translate short English greetings', () => {
  assert.equal(needsTranslation('你好！ <@123> https://example.com', 'zh'), false);
  assert.equal(needsTranslation('```js\nconst a = 1\n``` 🎉', 'zh'), false);
  assert.equal(needsTranslation('Hi', 'zh'), true);
  assert.equal(needsTranslation('今日は元気です', 'zh'), false);
  assert.equal(needsTranslation('你好 USB', 'zh'), true);
  assert.equal(needsTranslation('你好，我们讨论 USB 接口', 'zh'), false);
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
  engine.clearCache();
  await engine.translate(request(), config({ cacheSize: 0 }), 'key');
  await engine.translate(request(), config({ cacheSize: 0 }), 'key');
  assert.equal(calls, 6);
});
void test('paid translations survive cancellation and restarts, and only a manual clear wipes them', async () => {
  let calls = 0;
  const disk = new Map();
  const persistence = { get: hash => disk.get(hash), set: (hash, entry) => { disk.set(hash, entry); }, clear: () => { disk.clear(); } };
  const fetcher = async () => { calls++; return success('译文'); };
  const engine = new TranslationEngine(fetcher, persistence);
  await engine.translate(request(), config(), 'key');
  assert.equal(calls, 1);
  assert.equal(disk.size, 1, 'a Qwen result must reach the persistence layer');
  // Toggling a channel or closing a window cancels in-flight work only.
  engine.cancel();
  await engine.translate(request(), config(), 'key');
  assert.equal(calls, 1, 'cancelling must not discard finished translations');
  // A restart starts with an empty memory cache but can still read the persisted entry.
  const restarted = new TranslationEngine(fetcher, persistence);
  await restarted.translate(request(), config(), 'key');
  assert.equal(calls, 1, 'a restart must reuse the persisted translation');
  restarted.clearCache();
  assert.equal(disk.size, 0, 'a manual clear must wipe the persisted copy too');
  await restarted.translate(request(), config(), 'key');
  assert.equal(calls, 2);
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
  assert.equal(sent[0][1].messages.length, 2);
  assert(!JSON.stringify(sent[0][1]).includes('private context'));
  assert.match(sent[0][1].messages[0].content, /产品型号、品牌名称/);
  await engine.translate(request('Hey', { context: ['a', 'b', 'c'] }), config({ contextCount: 2 }), 'key');
  assert(sent[1][1].messages[1].content.includes('["b","c"]'));
  assert.equal(sent[1][1].messages.at(-1).content, 'Hey');
});
void test('failures are not cached and raw server errors are not exposed', async () => {
  let calls = 0;
  const engine = new TranslationEngine(async () => ++calls === 1 ? new Response('SECRET SERVER BODY', { status: 401 }) : success('你好'));
  await assert.rejects(engine.translate(request(), config(), 'key'), error => /API Key/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(await engine.translate(request(), config(), 'key'), '你好');
  assert.equal(calls, 2);
});
void test('a legacy model 429 points to a model change, and changing the model recovers without caching the error', async () => {
  const models = [];
  const engine = new TranslationEngine(async (_url, init) => {
    const { model } = JSON.parse(init.body); models.push(model);
    return model === 'qwen-turbo' ? new Response(JSON.stringify({ error: { code: 'limit_requests', message: 'PRIVATE ACCOUNT DATA' } }), { status: 429 }) : success('你好');
  });
  await assert.rejects(engine.translate(request(), config({ model: 'qwen-turbo' }), 'key'), error => /下线.*qwen-flash.*保存/.test(error.message) && !error.message.includes('PRIVATE'));
  assert.equal(await engine.translate(request(), config(), 'key'), '你好');
  assert.equal(await engine.translate(request(), config(), 'key'), '你好');
  assert.deepEqual(models, ['qwen-turbo', 'qwen-flash']);
});
void test('current model 429 distinguishes known causes without exposing provider messages or adding retries', async () => {
  const cases = [
    [{ error: { code: 'limit_requests', message: 'PRIVATE ACCOUNT DATA' } }, /HTTP 429/],
    [{ error: { code: 'BudgetLimitExceeded', message: 'PRIVATE ACCOUNT DATA' } }, /预算/],
    [{ code: 'Throttling.AllocationQuota', message: 'PRIVATE ACCOUNT DATA' }, /Token.*TPM\/TPS/],
    [{ error_code: 'insufficient_quota', message: 'PRIVATE ACCOUNT DATA' }, /Token.*TPM\/TPS/],
    [{ error: { code: 'Throttling.Concurrency', message: 'PRIVATE ACCOUNT DATA' } }, /并发/],
    [{ error: { code: 'PRIVATE ACCOUNT DATA' } }, /HTTP 429/],
    ['PRIVATE ACCOUNT DATA', /HTTP 429/],
    ['x'.repeat(16_001), /HTTP 429/]
  ];
  await Promise.all(cases.map(async ([body, expected]) => {
    let calls = 0;
    const engine = new TranslationEngine(async () => { calls++; return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 429 }); });
    await assert.rejects(engine.translate(request(), config(), 'key'), error => expected.test(error.message) && !/PRIVATE|qwen-turbo|下线/.test(error.message));
    assert.equal(calls, 1, 'a rejected request is not automatically retried');
  }));
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
  engine.cancel(); await rejected;
});
void test('queue overflow fails promptly instead of scheduling unlimited spending', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new TranslationEngine(async () => { await gate; return success('译文'); });
  const scheduled = Array.from({ length: 41 }, (_, i) => engine.translate(request(`message${i}`), config({ concurrency: 1 }), 'key'));
  await assert.rejects(engine.translate(request('overflow'), config({ concurrency: 1 }), 'key'), /队列已满/);
  release(); await Promise.all(scheduled);
});

