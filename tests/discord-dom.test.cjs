const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { messageText, recentContext, conversationMessages, plainComposer } = require('../app/code/renderer/modules/discord-translation-dom.js');

function dom(html) {
  const instance = new JSDOM(html, { url: 'https://discord.com/channels/@me/1' });
  for (const name of ['Element', 'HTMLImageElement', 'HTMLAnchorElement']) global[name] = instance.window[name];
  return instance.window.document;
}
void test('message extraction preserves Markdown, links, code, and emoji text', () => {
  const document = dom('<div id="m"><strong>Hello</strong> <a href="https://example.com">site</a><br><pre><code>x &lt; y</code></pre><img alt="🎉"></div>');
  assert.equal(messageText(document.getElementById('m')), '**Hello** [site](https://example.com)\n```\nx < y\n```🎉');
});
void test('messages from a previous route are excluded even while Discord retains old DOM', () => {
  const document = dom('<li id="chat-messages-1-11"><div id="message-content-11">current</div></li><li id="chat-messages-2-22"><div id="message-content-22">other channel secret</div></li>');
  assert.deepEqual(conversationMessages(document, '1').map(messageText), ['current']);
});
void test('context contains only preceding bounded messages, never target or later messages', () => {
  const document = dom('<div>A</div><div>B</div><div>C</div><div>D</div>');
  const nodes = [...document.querySelectorAll('div')];
  assert.deepEqual(recentContext(nodes, nodes[2], 1), ['B']);
  assert.deepEqual(recentContext(nodes, nodes[2], 0), []);
  assert.deepEqual(recentContext(nodes, null, 2), ['C', 'D']);
});
void test('structured mentions refuse destructive plain-text composer replacement', () => {
  const document = dom('<div id="plain">hello</div><div id="rich"><span contenteditable="false">@person</span></div>');
  assert.equal(plainComposer(document.getElementById('plain')), true);
  assert.equal(plainComposer(document.getElementById('rich')), false);
});

