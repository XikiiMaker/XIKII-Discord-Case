const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unreadFromTitle, shouldFlash } = require('../app/code/common/desktop.js');

void test('mention counts take priority over unread dots and retain count changes', () => {
  assert.equal(unreadFromTitle('(1) Discord | chat'), '1');
  assert.equal(unreadFromTitle('• (2) Discord | chat'), '2');
  assert.equal(unreadFromTitle('• Discord | chat'), true);
  assert.equal(unreadFromTitle('(0) Discord | chat'), false);
  assert.equal(unreadFromTitle('Discord | chat (25)'), false);
});
void test('attention flashes on new mention counts only, independently of tray', () => {
  assert.equal(shouldFlash('2', '1', true, false), true);
  assert.equal(shouldFlash('2', '2', true, false), false);
  assert.equal(shouldFlash('2', '1', true, true), false);
  assert.equal(shouldFlash('2', '1', false, false), false);
  assert.equal(shouldFlash(true, false, true, false), false);
});
