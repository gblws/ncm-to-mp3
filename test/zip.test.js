import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../public/zip.js';

test('ZIP has UTF-8 names, CRC32, matching offsets and unique duplicate names', async () => {
  const zip = Buffer.from(await (await createZip([
    { name: '中文.mp3', blob: new Blob(['123456789']) },
    { name: '中文.mp3', blob: new Blob(['abc']) },
  ])).arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(6), 0x0800);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  assert.ok(zip.includes(Buffer.from('中文 (2).mp3')));
  const end = zip.length - 22, centralOffset = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
  assert.equal(zip.readUInt32LE(centralOffset + 42), 0);
});
