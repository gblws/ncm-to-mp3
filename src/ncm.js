import { createDecipheriv } from 'node:crypto';

const CORE_KEY = Buffer.from('687a4852416d736f356b496e62617857', 'hex');
const META_KEY = Buffer.from('2331346c6a6b5f215c5d2630553c2728', 'hex');

export class ConversionError extends Error {
  constructor(message, code = 'INVALID_NCM', status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function decryptAes(data, key, label) {
  try {
    if (!data.length || data.length % 16) throw new Error('Invalid AES length');
    const cipher = createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  } catch {
    throw new ConversionError(`${label}无法解密，文件可能不完整或使用了不支持的 NCM 版本。`);
  }
}

function xor(data, mask) {
  const output = Buffer.from(data);
  for (let i = 0; i < output.length; i++) output[i] ^= mask;
  return output;
}

function metadataFrom(data, warnings) {
  if (!data.length) return {};
  try {
    const decoded = xor(data, 0x63);
    // The 22-byte ASCII prefix is outside the Base64/AES envelope.
    const ciphertext = Buffer.from(decoded.subarray(22).toString('ascii'), 'base64');
    const text = decryptAes(ciphertext, META_KEY, '歌曲信息').toString('utf8');
    if (!text.startsWith('music:')) throw new Error('Unknown metadata envelope');
    const song = JSON.parse(text.slice(6));
    if (!song || typeof song !== 'object' || Array.isArray(song)) throw new Error('Invalid metadata');
    const textValue = (value) => typeof value === 'string' ? value.slice(0, 4096) : '';
    return {
      title: textValue(song.musicName),
      artist: Array.isArray(song.artist)
        ? song.artist.map((artist) => textValue(Array.isArray(artist) ? artist[0] : artist)).filter(Boolean).join(' / ')
        : textValue(song.artist),
      album: textValue(song.album),
    };
  } catch {
    warnings.push('歌曲信息无法读取，已使用原文件名；音频仍可转换。');
    return {};
  }
}

function keyStream(key) {
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
  }
  const stream = Buffer.alloc(256);
  for (let i = 0; i < stream.length; i++) {
    const position = (i + 1) & 255;
    stream[i] = box[(box[position] + box[(box[position] + position) & 255]) & 255];
  }
  return stream;
}

export function detectAudioFormat(audio) {
  if (audio.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (audio.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (audio.length >= 4 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0
      && (audio[1] & 0x18) !== 0x08 && (audio[1] & 0x06) !== 0
      && (audio[2] & 0xf0) !== 0xf0 && (audio[2] & 0x0c) !== 0x0c) return 'mp3';
  throw new ConversionError('解密后未识别到 MP3 或 FLAC 音频，请检查文件是否完整。', 'UNSUPPORTED_AUDIO');
}

/** Decode the standard CTENFDAM container. Never mutate the input. */
export function decodeNcm(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('输入必须是 Buffer');
  let offset = 0;
  const read = (size, label) => {
    if (size < 0 || offset + size > buffer.length) throw new ConversionError(`NCM ${label}不完整，文件可能已损坏。`);
    const chunk = buffer.subarray(offset, offset + size);
    offset += size;
    return chunk;
  };
  const u32 = (label) => read(4, label).readUInt32LE(0);
  if (buffer.length < 10 || read(8, '文件头').toString('ascii') !== 'CTENFDAM') {
    throw new ConversionError('不是有效的 NCM 文件，请选择网易云音乐下载的 .ncm 文件。');
  }
  read(2, '版本字段');
  const keySize = u32('密钥长度');
  if (keySize > 16 * 1024) throw new ConversionError('NCM 密钥长度异常。');
  const keyEnvelope = decryptAes(xor(read(keySize, '密钥区'), 0x64), CORE_KEY, '音频密钥');
  if (keyEnvelope.subarray(0, 17).toString('ascii') !== 'neteasecloudmusic' || keyEnvelope.length <= 17) {
    throw new ConversionError('NCM 音频密钥无效，无法转换。');
  }
  const metaSize = u32('歌曲信息长度');
  if (metaSize > 16 * 1024 * 1024) throw new ConversionError('NCM 歌曲信息长度异常。');
  const warnings = [];
  const metadata = metadataFrom(read(metaSize, '歌曲信息区'), warnings);
  read(5, '校验字段');
  const imageSpace = u32('封面空间');
  const imageSize = u32('封面长度');
  if (imageSize > imageSpace || imageSpace > 32 * 1024 * 1024) throw new ConversionError('NCM 封面长度异常。');
  // Space can exceed image length. Padding is not encrypted audio.
  const image = read(imageSpace, '封面区').subarray(0, imageSize);
  const audio = Buffer.from(buffer.subarray(offset));
  const stream = keyStream(keyEnvelope.subarray(17));
  for (let i = 0; i < audio.length; i++) audio[i] ^= stream[i & 255];
  if (!audio.length) throw new ConversionError('NCM 文件中没有音频数据。');
  return { audio, metadata, image, format: detectAudioFormat(audio), warnings };
}

export function safeFilename(value, fallback = '未命名歌曲') {
  const name = String(value || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '').trim().slice(0, 150).replace(/[. ]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) return fallback;
  return name;
}

export function outputFilename(metadata, originalName) {
  const fallback = originalName.replace(/^.*[\\/]/, '').replace(/\.ncm$/i, '');
  const title = safeFilename(metadata.title || fallback);
  const artist = safeFilename(metadata.artist, '');
  return `${safeFilename(artist ? `${artist} - ${title}` : title)}.mp3`;
}

function syncsafe(size) {
  return Buffer.from([(size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
}

export function stripId3(audio) {
  let offset = 0;
  while (audio.length - offset >= 10 && audio.toString('ascii', offset, offset + 3) === 'ID3') {
    const header = audio.subarray(offset, offset + 10);
    if (header.subarray(6, 10).some((value) => value > 127)) break;
    const size = header[6] * 2097152 + header[7] * 16384 + header[8] * 128 + header[9];
    const end = offset + 10 + size + (header[3] === 4 && (header[5] & 16) ? 10 : 0);
    if (end > audio.length) break;
    offset = end;
  }
  return audio.subarray(offset);
}

/** ID3v2.4 UTF-8 text and embedded cover art. */
export function embedMp3Tags(audio, metadata = {}, image = Buffer.alloc(0)) {
  const frames = [];
  const frame = (id, body) => Buffer.concat([Buffer.from(id), syncsafe(body.length), Buffer.alloc(2), body]);
  for (const [id, value] of [['TIT2', metadata.title], ['TPE1', metadata.artist], ['TALB', metadata.album]]) {
    if (value) frames.push(frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')])));
  }
  const png = image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = image[0] === 0xff && image[1] === 0xd8;
  if (png || jpeg) frames.push(frame('APIC', Buffer.concat([
    Buffer.from([0]), Buffer.from(png ? 'image/png' : 'image/jpeg'), Buffer.from([0, 3, 0]), image,
  ])));
  if (!frames.length) return audio;
  const payload = Buffer.concat(frames);
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0]), syncsafe(payload.length), payload, stripId3(audio)]);
}
