import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';
import { stripId3 } from '../src/ncm.js';
import { fixture } from './fixture.js';

test('local HTTP upload, binary download, malformed input and origin isolation', async (t) => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /拖入 NCM/);
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 8, 9]);
  const response = await fetch(`${base}/api/convert`, {
    method: 'POST', body: fixture(audio), headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('测试.ncm'), origin: base },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(decodeURIComponent(response.headers.get('x-output-name')), '测试歌手 - 测试歌曲.mp3');
  assert.deepEqual(stripId3(Buffer.from(await response.arrayBuffer())), audio);
  assert.equal((await fetch(`${base}/api/convert`, { method: 'POST', body: 'broken', headers: { 'content-type': 'application/octet-stream' } })).status, 422);
  assert.equal((await fetch(`${base}/api/convert`, { method: 'POST', body: fixture(), headers: { 'content-type': 'application/octet-stream', origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${base}/src/ncm.js`)).status, 404);
});
