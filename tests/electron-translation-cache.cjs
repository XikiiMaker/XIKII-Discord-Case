// Uses a synthetic userData profile. No real chat text or credentials are read.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, 'cache/translation-cache-fixture');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setAppPath(root); app.disableHardwareAcceleration();

const file = path.join(profile, 'translation-cache.json');
const entry = (text, expires) => ({ text, expires, provider: 'qwen' });
const hash = suffix => suffix.repeat(64).slice(0, 64);

async function main() {
  await app.whenReady();
  const { TranslationCacheStore } = require('../app/code/main/translation/cache-store.js');
  if (!safeStorage.isEncryptionAvailable()) {
    console.log('Translation cache: skipped, OS encryption unavailable');
    app.quit(); return;
  }
  const future = Date.now() + 60_000;

  const store = new TranslationCacheStore();
  store.set(hash('a'), entry('译文A', future));
  store.set(hash('b'), entry('译文B', Date.now() - 1));
  store.flush();
  assert(fs.existsSync(file), 'cache file must be written');

  const raw = fs.readFileSync(file, 'utf8');
  assert(!raw.includes('译文A'), 'translations must never be stored in plaintext');
  assert.equal(JSON.parse(raw).version, 1);

  const reopened = new TranslationCacheStore();
  assert.equal(reopened.get(hash('a')).text, '译文A', 'a live entry must survive a restart');
  assert.equal(reopened.get(hash('b')), undefined, 'an expired entry must not come back');

  reopened.clear();
  assert(!fs.existsSync(file), 'clearing must delete the file');
  assert.equal(new TranslationCacheStore().get(hash('a')), undefined);

  // Clearing arrives on an instance that may never have read the cache this session.
  const seeded = new TranslationCacheStore();
  seeded.set(hash('c'), entry('译文C', future));
  seeded.flush();
  assert(fs.existsSync(file));
  new TranslationCacheStore().clear();
  assert(!fs.existsSync(file), 'an untouched instance must still delete the file');

  // A corrupt file must degrade to an empty cache instead of breaking translation.
  fs.writeFileSync(file, '{"version":1,"encrypted":"not-base64-cipher"}');
  assert.equal(new TranslationCacheStore().get(hash('a')), undefined, 'a corrupt cache must not throw');

  fs.mkdirSync(path.join(root, 'cache/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cache/evidence/translation-cache.json'), JSON.stringify({
    passed: ['encrypted-at-rest', 'survives-restart', 'expired-entries-dropped', 'clear-removes-file', 'clear-without-prior-read', 'corrupt-file-degrades'],
    externalNetwork: false, realChatTextRead: false
  }, null, 2));
  console.log('Translation cache: passed'); app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
