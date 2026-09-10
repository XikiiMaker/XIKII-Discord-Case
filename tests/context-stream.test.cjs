const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConversationContext } = require('../app/code/common/translation-context.js');
const { readTranslationStream, readBoundedJson } = require('../app/code/main/translation/stream.js');
const { TranslationEngine } = require('../app/code/main/translation/engine.js');
const { defaultTranslationSettings, parseSettings, migrateStoredSettings, languages } = require('../app/code/common/translation.js');
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
const delta = content => event({ choices: [{ delta: { content }, finish_reason: null }] });
const end = event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\r\n\r\n';
function stream(raw, chunkSize = 1) {
  const bytes = new TextEncoder().encode(raw);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }));
}
void test('context retains virtualized messages, handles edits and orders large snowflakes exactly', () => {
  const window = new ConversationContext(2, 3);
  window.update('1', [{ id: '9007199254740993', text: 'second' }, { id: '9007199254740992', text: 'first' }]);
  window.update('1', [{ id: '9007199254740994', text: 'third' }]);
  assert.deepEqual(window.before('1', null, 10), ['first', 'second', 'third']);
  assert.deepEqual(window.before('1', '9007199254740993', 10), ['first']);
  window.update('1', [{ id: '9007199254740993', text: 'edited' }]);
  assert.deepEqual(window.before('1', null, 2), ['edited', 'third']);
  window.remove('1', '9007199254740993');
  assert.deepEqual(window.before('1', null, 3), ['first', 'third']);
});
void test('context is bounded by messages and conversations and can be cleared on opt-out', () => {
  const window = new ConversationContext(2, 2);
  window.update('1', [{ id: '1', text: 'a' }, { id: '2', text: 'b' }, { id: '3', text: 'c'.repeat(1500) }]);
  assert.deepEqual(window.before('1', null, 10), ['b', 'c'.repeat(1000)]);
  window.update('2', [{ id: '1', text: 'channel2' }]); window.update('3', [{ id: '1', text: 'channel3' }]);
  assert.deepEqual(window.before('1', null, 10), []);
  assert.deepEqual(window.before('2', null, 0), []);
  window.clear(); assert.deepEqual(window.before('3', null, 10), []);
});
void test('old config migrates show-original and streaming defaults without losing conversation overrides', () => {
  const old = { ...defaultTranslationSettings, channels: { '123': { enabled: true, target: 'ja' } } };
  delete old.showOriginal; delete old.streaming;
  const parsed = migrateStoredSettings(old);
  assert.equal(parsed.showOriginal, true); assert.equal(parsed.streaming, false);
  assert.equal(parsed.channels['123'].target, 'en');
  assert.deepEqual(Object.keys(languages).sort(), ['en', 'zh']);
  assert.throws(() => parseSettings({ ...defaultTranslationSettings, target: 'ja' }));
});
void test('SSE preserves Unicode across single-byte chunks and publishes partial progress', async () => {
  const seen = [];
  const text = await readTranslationStream(stream(': keepalive\r\n\r\n' + delta('你') + delta('好🎉') + end), value => seen.push(value));
  assert.equal(text, '你好🎉'); assert.deepEqual(seen, ['你', '你好🎉']);
});
void test('SSE refuses truncation, empty responses, invalid JSON and missing DONE', async () => {
  await assert.rejects(readTranslationStream(stream(delta('partial')), () => {}), /中断/);
  await assert.rejects(readTranslationStream(stream(delta('partial') + event({ choices: [{ finish_reason: 'length' }] })), () => {}), /不完整/);
  await assert.rejects(readTranslationStream(stream('data: invalid\n\n'), () => {}), /格式无效/);
  await assert.rejects(readTranslationStream(stream(end), () => {}), /中断/);
});
void test('streaming preserves protected tokens and only caches the validated final result', async () => {
  let calls = 0;
  const seen = [];
  const engine = new TranslationEngine(async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body); assert.equal(body.stream, true);
    const masked = body.messages.at(-1).content;
    return stream(delta(masked.slice(0, 15)) + delta(masked.slice(15)) + end, 7);
  });
  const input = { text: 'Hi <@123> `x=1`', target: 'zh', context: [] };
  const opts = { ...defaultTranslationSettings, streaming: true };
  assert.equal(await engine.translate(input, opts, 'key', text => seen.push(text)), input.text);
  assert(!seen.some(text => text.includes('XIKII_')));
  assert.equal(await engine.translate(input, opts, 'key'), input.text); assert.equal(calls, 1);
});
void test('JSON providers are bounded without Content-Length and invalid JSON is not echoed to users', async () => {
  await assert.rejects(readBoundedJson(stream('x'.repeat(256001), 1024)), /大小限制/);
  const engine = new TranslationEngine(async () => new Response('PRIVATE RESPONSE CONTENT'));
  await assert.rejects(engine.translate({ text: 'Hello', target: 'zh', context: [] }, defaultTranslationSettings, 'key'), error => /Qwen 返回无效/.test(error.message) && !error.message.includes('PRIVATE'));
});
