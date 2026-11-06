import { spawn } from 'node:child_process';
import { createServer } from './server.js';

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535');
const url = `http://127.0.0.1:${port}`;
const open = () => {
  const child = process.platform === 'win32'
    ? spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' })
    : process.platform === 'darwin'
      ? spawn('open', [url], { stdio: 'ignore' })
      : spawn('xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => console.log(`请在浏览器中打开 ${url}`));
};
const server = createServer();
server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${url}/api/status`);
      const status = await response.json();
      if (response.ok && status.app === 'ncm-to-mp3-local') { open(); return; }
    } catch { /* Another service owns the port. */ }
  }
  console.error(`启动失败：${error.message}\n可以设置 PORT 使用其他端口。`); process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => { console.log(`NCM to MP3: ${url}\n保持此窗口打开；按 Ctrl+C 关闭服务。`); open(); });
