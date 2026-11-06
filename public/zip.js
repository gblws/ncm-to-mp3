// Uncompressed ZIP32: MP3 is already compressed; no external library needed.
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createZip(files) {
  const parts = [], central = [], used = new Set();
  let offset = 0, centralSize = 0;
  for (const file of files) {
    let name = file.name, index = 1;
    while (used.has(name.toLowerCase())) name = file.name.replace(/\.mp3$/i, ` (${++index}).mp3`);
    used.add(name.toLowerCase());
    const encoded = new TextEncoder().encode(name);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + encoded.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x21, true); view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, encoded.length, true);
    header.set(encoded, 30); parts.push(header, file.blob);
    const record = new Uint8Array(46 + encoded.length), recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true); recordView.setUint16(4, 20, true); recordView.setUint16(6, 20, true); recordView.setUint16(8, 0x0800, true);
    recordView.setUint16(14, 0x21, true); recordView.setUint32(16, crc, true); recordView.setUint32(20, bytes.length, true); recordView.setUint32(24, bytes.length, true); recordView.setUint16(28, encoded.length, true); recordView.setUint32(42, offset, true);
    record.set(encoded, 46); central.push(record); centralSize += record.length; offset += header.length + bytes.length;
  }
  if (files.length > 65535 || offset + centralSize >= 0xffffffff) throw new Error('ZIP 超过大小限制');
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
