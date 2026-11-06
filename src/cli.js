import fs from 'node:fs/promises';
import path from 'node:path';
import { convertNcm } from './convert.js';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('用法: node src/cli.js <歌曲.ncm> [更多.ncm] [--out 输出目录]\n默认输出到 ./output；同名文件自动编号，原 NCM 保留。');
} else {
  const outIndex = args.indexOf('--out');
  let directory = path.resolve('output');
  if (outIndex >= 0) {
    if (!args[outIndex + 1]) throw new Error('--out 后需要指定输出目录');
    directory = path.resolve(args[outIndex + 1]); args.splice(outIndex, 2);
  }
  if (!args.length) throw new Error('请指定至少一个 .ncm 文件');
  await fs.mkdir(directory, { recursive: true });
  for (const input of args) {
    try {
      const result = await convertNcm(await fs.readFile(input), path.basename(input));
      let count = 1;
      while (true) {
        const filename = count === 1 ? result.filename : result.filename.replace(/\.mp3$/, ` (${count}).mp3`);
        const output = path.join(directory, filename);
        try {
          await fs.writeFile(output, result.audio, { flag: 'wx' });
          console.log(`完成: ${output}`); break;
        } catch (error) { if (error.code !== 'EEXIST') throw error; count++; }
      }
      for (const warning of result.warnings) console.log(warning);
    } catch (error) { console.error(`失败: ${path.basename(input)} — ${error.message}`); process.exitCode = 1; }
  }
}
