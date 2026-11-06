import { createCipheriv } from 'node:crypto';

export function fixture(audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]), options = {}) {
  const encrypt = (bytes, key) => {
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'hex'), null);
    return Buffer.concat([cipher.update(bytes), cipher.final()]);
  };
  const xor = (bytes, mask) => Buffer.from(bytes.map((byte) => byte ^ mask));
  const integer = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
  const key = Buffer.from('test-stream-key-for-fixtures');
  const encryptedKey = xor(encrypt(Buffer.concat([Buffer.from('neteasecloudmusic'), key]), '687a4852416d736f356b496e62617857'), 0x64);
  const metadata = options.noMetadata ? Buffer.alloc(0) : xor(Buffer.concat([
    Buffer.from("163 key(Don't modify):"),
    Buffer.from(encrypt(Buffer.from('music:' + JSON.stringify({ musicName: '测试歌曲', artist: [['测试歌手', 1]], album: '测试专辑' })), '2331346c6a6b5f215c5d2630553c2728').toString('base64')),
  ]), 0x63);
  const box = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) % 256;
    [box[i], box[j]] = [box[j], box[i]];
  }
  const ciphertext = Buffer.from(audio);
  for (let i = 0; i < audio.length; i++) {
    const index = (i + 1) % 256;
    ciphertext[i] ^= box[(box[index] + box[(index + box[index]) % 256]) % 256];
  }
  const cover = options.cover || Buffer.alloc(0);
  const padding = options.padding || 0;
  return Buffer.concat([
    Buffer.from('CTENFDAM'), Buffer.alloc(2), integer(encryptedKey.length), encryptedKey,
    integer(metadata.length), metadata, Buffer.alloc(5), integer(cover.length + padding), integer(cover.length),
    cover, Buffer.alloc(padding), ciphertext,
  ]);
}
