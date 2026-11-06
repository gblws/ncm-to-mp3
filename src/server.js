import http from 'node:http';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { convertNcm, findFfmpeg } from './convert.js';
import { ConversionError } from './ncm.js';

export const MAX_FILE_SIZE = 300 * 1024 * 1024;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/zip.js', ['zip.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (Number(request.headers['content-length']) > MAX_FILE_SIZE) {
    request.resume();
    throw new ConversionError('单个文件不能超过 300 MB。', 'FILE_TOO_LARGE', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_FILE_SIZE) throw new ConversionError('单个文件不能超过 300 MB。', 'FILE_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createServer() {
  let busy = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    const allowed = new Set([`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`]);
    const host = request.headers.host || '';
    const origin = request.headers.origin;
    if (!allowed.has(host) || (origin && ![...allowed].some((value) => origin === `http://${value}`))) {
      request.resume();
      return json(response, 403, { error: '只允许本机页面访问。' });
    }
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === '/api/status') {
        return json(response, 200, { app: 'ncm-to-mp3-local', ffmpeg: Boolean(await findFfmpeg()), maxFileSize: MAX_FILE_SIZE });
      }
      if (request.method === 'POST' && pathname === '/api/convert') {
        if (busy) {
          request.resume();
          return json(response, 429, { error: '另一个文件正在转换，请稍后重试。' });
        }
        if (request.headers['content-type'] !== 'application/octet-stream') {
          request.resume();
          return json(response, 415, { error: '请以二进制方式发送 NCM 文件。' });
        }
        busy = true;
        const controller = new AbortController();
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          const filename = decodeURIComponent(String(request.headers['x-file-name'] || 'song.ncm'));
          const result = await convertNcm(await readBody(request), filename, { signal: controller.signal });
          if (controller.signal.aborted) return;
          response.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': result.audio.length,
            'Content-Disposition': `attachment; filename="converted.mp3"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
            'X-Output-Name': encodeURIComponent(result.filename),
            'X-Source-Format': result.sourceFormat,
            'X-Conversion-Warnings': encodeURIComponent(result.warnings.join(' ')),
          });
          response.end(result.audio);
        } finally { busy = false; }
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        request.resume();
        return json(response, 405, { error: 'Method not allowed' });
      }
      const asset = staticFiles.get(pathname);
      if (!asset) return json(response, 404, { error: 'Not found' });
      const data = await fs.readFile(new URL(`../public/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        if (!(error instanceof ConversionError)) console.error(error);
        json(response, error.status || 500, { error: error instanceof ConversionError ? error.message : '转换失败，请检查文件并重试。', code: error.code || 'INTERNAL_ERROR' });
      }
    }
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 30 * 1000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535');
  const server = createServer();
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请打开 http://127.0.0.1:${port} 或设置 PORT 使用其他端口。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`NCM to MP3: http://127.0.0.1:${port}\n按 Ctrl+C 关闭服务。`));
}
