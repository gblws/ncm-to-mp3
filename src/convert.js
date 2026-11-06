import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConversionError, decodeNcm, embedMp3Tags, outputFilename, detectAudioFormat } from './ncm.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
let ffmpegPromise;

export function findFfmpeg() {
  ffmpegPromise ??= (async () => {
    const candidates = [process.env.FFMPEG_PATH, path.join(root, '.tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'ffmpeg'].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const { stdout } = await run(candidate, ['-version'], { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 });
        if (stdout.startsWith('ffmpeg version')) return candidate;
      } catch { /* Try the next configured location. */ }
    }
    return null;
  })();
  return ffmpegPromise;
}

async function transcodeFlac(audio, executable, signal) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ncm-to-mp3-'));
  const input = path.join(temp, 'input.flac');
  const output = path.join(temp, 'output.mp3');
  try {
    await fs.writeFile(input, audio);
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
        '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame',
        '-b:a', '320k', '-ar', '44100', '-ac', '2', '-write_id3v2', '0', output,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal, timeout: 10 * 60 * 1000 });
      let diagnostic = '';
      child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(diagnostic || `FFmpeg exited ${code}`)));
    });
    const mp3 = await fs.readFile(output);
    if (detectAudioFormat(mp3) !== 'mp3') throw new Error('Unexpected output');
    return mp3;
  } catch (error) {
    if (signal?.aborted) throw new ConversionError('转换已取消。', 'CANCELLED', 499);
    throw new ConversionError('FLAC 转 MP3 失败，请检查音频是否完整以及 FFmpeg 是否支持 libmp3lame。', 'TRANSCODE_FAILED');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function convertNcm(buffer, originalName, { signal } = {}) {
  const result = decodeNcm(buffer);
  let audio = result.audio;
  if (result.format === 'flac') {
    const executable = await findFfmpeg();
    if (!executable) throw new ConversionError('该 NCM 内含 FLAC 无损音频。请先安装 FFmpeg 或运行 scripts/setup-ffmpeg.ps1，再重启服务后重试。', 'FFMPEG_MISSING');
    audio = await transcodeFlac(audio, executable, signal);
  }
  return {
    audio: embedMp3Tags(audio, result.metadata, result.image),
    filename: outputFilename(result.metadata, originalName),
    sourceFormat: result.format,
    warnings: result.warnings,
  };
}
