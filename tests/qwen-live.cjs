// Explicit opt-in only. Reads one authorized key, never prints or persists it.
const fs = require('node:fs');
const path = require('node:path');
const { TranslationEngine } = require('../app/code/main/translation/engine.js');
const { defaultTranslationSettings } = require('../app/code/common/translation.js');
const root = path.resolve(__dirname, '..');
const budgetFile = path.join(root, 'cache/live-qwen-budget.json');
const evidence = path.join(root, 'cache/evidence/qwen-live-result.json');
async function main() {
  if (process.env.XIKII_ALLOW_LIVE_TESTS !== '1' || !process.env.XIKII_QWEN_ENV_FILE) throw new Error('Live test opt-in and authorized env-file path are required.');
  const source = fs.readFileSync(process.env.XIKII_QWEN_ENV_FILE, 'utf8');
  const entry = /^\s*(?:export\s+)?QWEN_API_KEY\s*=\s*(.+)$/m.exec(source);
  const key = entry?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!key || key.length < 10) throw new Error('The authorized file has no usable QWEN_API_KEY.');
  let budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { requests: 0, limit: 20 };
  if (!Number.isInteger(budget.requests) || budget.limit !== 20) throw new Error('Live-test request budget is invalid.');
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  const engine = new TranslationEngine(async (url, init) => {
    if (budget.requests >= 20) throw new Error('The authorized 20-request live-test budget has been reached.');
    budget = { ...budget, requests: budget.requests + 1 };
    fs.writeFileSync(budgetFile, JSON.stringify(budget));
    return fetch(url, init);
  });
  const model = process.env.XIKII_QWEN_TEST_MODEL || 'qwen-turbo';
  const cases = [
    { name: 'English to Chinese with protected formatting', text: '**Hello!** Visit https://example.com and keep `USB-C` unchanged.', target: 'zh', context: [], streaming: false },
    { name: 'Chinese to English with context and streaming', text: '它支持蓝牙吗？', target: 'en', context: ['We are discussing the XIKII keyboard.'], streaming: true },
    { name: 'English hardware terminology to Chinese with context', text: 'When will the XIKII case ship?', target: 'zh', context: ['We are discussing a PC case made by XIKII.'], streaming: true }
  ];
  const results = [];
  // Sequential calls provide individual latency and avoid an uncontrolled cost burst.
  for (const item of cases.filter(candidate => !process.env.XIKII_QWEN_TEST_CASE || candidate.name.includes(process.env.XIKII_QWEN_TEST_CASE))) {
    const start = Date.now(); let firstProgressMs = null, progressEvents = 0;
    const request = { text: item.text, target: item.target, context: item.context };
    const settings = { ...defaultTranslationSettings, model, contextCount: item.context.length, streaming: item.streaming };
    try {
      // oxlint-disable-next-line no-await-in-loop
      const translated = await engine.translate(request, settings, key, () => { firstProgressMs ??= Date.now() - start; progressEvents++; });
      const beforeCache = budget.requests;
      // oxlint-disable-next-line no-await-in-loop
      const cached = await engine.translate(request, settings, key);
      const languageVerified = item.target === 'zh' ? /\p{Script=Han}/u.test(translated) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(translated) : /Bluetooth/i.test(translated);
      const outputScopeVerified = !/我们.*讨论|正在讨论|We are discussing/i.test(translated);
      results.push({ name: item.name, original: item.text, translated, elapsedMs: Date.now() - start, firstProgressMs, progressEvents,
        cacheVerified: beforeCache === budget.requests && cached === translated, languageVerified, outputScopeVerified, ok: languageVerified && outputScopeVerified });
    } catch (error) { results.push({ name: item.name, ok: false, error: error instanceof Error ? error.message : 'Unknown translation error' }); }
  }
  const result = { model, requestsUsedTotal: budget.requests, limit: budget.limit, date: new Date().toISOString(), results };
  const historyFile = path.join(root, 'cache/evidence/qwen-live-history.json');
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  history.push(result); fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  fs.writeFileSync(evidence, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (results.some(item => !item.ok)) process.exitCode = 1;
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
