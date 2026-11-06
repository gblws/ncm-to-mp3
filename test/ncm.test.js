import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeNcm, embedMp3Tags, stripId3, safeFilename, outputFilename } from '../src/ncm.js';
import { fixture } from './fixture.js';

test('decrypts a multi-cycle stream and preserves input and padded cover', () => {
  const audio = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))]);
  const cover = Buffer.from('89504e470d0a1a0a', 'hex');
  const encrypted = fixture(audio, { cover, padding: 900 });
  const copy = Buffer.from(encrypted);
  const result = decodeNcm(encrypted);
  assert.deepEqual(result.audio, audio);
  assert.deepEqual(encrypted, copy);
  assert.deepEqual(result.image, cover);
  assert.deepEqual(result.metadata, { title: '测试歌曲', artist: '测试歌手', album: '测试专辑' });
  assert.equal(result.format, 'mp3');
  assert.deepEqual(result.warnings, []);
});

test('supports containers without metadata and identifies FLAC from audio', () => {
  const result = decodeNcm(fixture(Buffer.from('fLaCtest'), { noMetadata: true }));
  assert.equal(result.format, 'flac');
  assert.deepEqual(result.metadata, {});
});

test('rejects invalid headers, truncation, invalid AES and unknown audio', () => {
  assert.throws(() => decodeNcm(Buffer.from('not ncm')), /不是有效/);
  const full = fixture();
  for (const length of [10, 13, 25, full.length - 10]) assert.throws(() => decodeNcm(full.subarray(0, length)));
  const badLength = Buffer.from(full); badLength.writeUInt32LE(0xffffffff, 10);
  assert.throws(() => decodeNcm(badLength), /密钥长度异常/);
  const badKey = Buffer.from(full); badKey[20] ^= 255;
  assert.throws(() => decodeNcm(badKey), /密钥/);
  assert.throws(() => decodeNcm(fixture(Buffer.from('random data'))), /未识别/);
});

test('a malformed metadata block does not destroy valid audio', () => {
  const input = fixture(); const keySize = input.readUInt32LE(10); input[14 + keySize + 4] ^= 32;
  // Corrupt ciphertext, not just the cosmetic prefix.
  input[14 + keySize + 4 + 25] = 0;
  const result = decodeNcm(input);
  assert.equal(result.format, 'mp3');
  assert.equal(result.warnings.length, 1);
});

test('tags preserve exact MPEG payload and have valid syncsafe sizes and APIC layout', () => {
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  const image = Buffer.from('ffd8ff00', 'hex');
  const tagged = embedMp3Tags(audio, { title: '中文'.repeat(100), artist: '歌手' }, image);
  const size = tagged[6] * 2097152 + tagged[7] * 16384 + tagged[8] * 128 + tagged[9];
  assert.equal(size + 10 + audio.length, tagged.length);
  assert.deepEqual(stripId3(tagged), audio);
  assert.deepEqual(stripId3(embedMp3Tags(tagged, { title: 'new' })), audio);
  assert.ok(tagged.includes(Buffer.concat([Buffer.from('image/jpeg'), Buffer.from([0, 3, 0]), image])));
});

test('portable filenames fall back correctly and strip paths and reserved names', () => {
  assert.equal(safeFilename('a:b/c*?'), 'a_b_c__');
  assert.equal(safeFilename('NUL'), '未命名歌曲');
  assert.equal(outputFilename({}, 'song.ncm'), 'song.mp3');
  assert.equal(outputFilename({ title: '歌', artist: '人' }, '../fake.ncm'), '人 - 歌.mp3');
});
