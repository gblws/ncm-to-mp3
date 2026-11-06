import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findFfmpeg, convertNcm } from '../src/convert.js';
import { fixture } from './fixture.js';

test('FLAC in NCM is actually encoded to playable MP3', async (t) => {
  const executable = await findFfmpeg();
  if (!executable) { t.skip('Install FFmpeg for the optional FLAC integration test'); return; }
  const run = promisify(execFile);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncm-transcode-test-'));
  try {
    const input = path.join(dir, 'tone.flac'), output = path.join(dir, 'result.mp3');
    await run(executable, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'flac', input], { windowsHide: true });
    const result = await convertNcm(fixture(await fs.readFile(input)), 'tone.ncm');
    assert.equal(result.sourceFormat, 'flac');
    assert.equal(result.audio.subarray(0, 3).toString(), 'ID3');
    await fs.writeFile(output, result.audio);
    await run(executable, ['-v', 'error', '-i', output, '-f', 'null', '-'], { windowsHide: true });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
