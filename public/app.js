import { createZip } from './zip.js';

const $ = (selector) => document.querySelector(selector);
const input = $('#file-input');
const zone = $('#dropzone');
const jobs = [];
const MAX_FILE = 300 * 1024 ** 2;
const MAX_BATCH = 512 * 1024 ** 2;
let processing = false;
let sequence = 0;
let online = false;

function notify(message = '') { $('#notice').textContent = message; $('#notice').hidden = !message; }
async function checkConnection() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error();
    const status = await response.json();
    online = true;
    $('#connection').classList.remove('disconnected');
    $('#connection').replaceChildren(Object.assign(document.createElement('i')), document.createTextNode('仅在本机处理'));
    $('#format-note').textContent = status.ffmpeg
      ? 'MP3 音源直接还原 · FLAC 音源转为 320 kbps MP3 · 保留歌曲信息与封面'
      : 'MP3 音源可直接转换。FLAC 无损音源需要安装 FFmpeg，安装后请重启服务。';
  } catch {
    online = false;
    $('#connection').classList.add('disconnected');
    $('#connection').textContent = '本地服务未连接';
    notify('无法连接本地服务，请运行项目中的 start.bat，或执行 node src/server.js。');
  }
}

$('#choose-button').addEventListener('click', (event) => { event.stopPropagation(); input.click(); });
zone.addEventListener('click', () => input.click());
zone.addEventListener('keydown', (event) => {
  if (event.target === zone && ['Enter', ' '].includes(event.key)) { event.preventDefault(); input.click(); }
});
input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
let dragDepth = 0;
zone.addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth++; zone.classList.add('dragging'); });
zone.addEventListener('dragover', (event) => event.preventDefault());
zone.addEventListener('dragleave', () => { if (--dragDepth <= 0) zone.classList.remove('dragging'); });
zone.addEventListener('drop', (event) => {
  event.preventDefault(); dragDepth = 0; zone.classList.remove('dragging'); addFiles(event.dataTransfer.files);
});

function addFiles(files) {
  const rejected = [];
  let batchSize = jobs.reduce((sum, job) => sum + job.file.size, 0);
  for (const file of files) {
    if (!/\.ncm$/i.test(file.name)) { rejected.push(`${file.name}：请选择 .ncm 文件`); continue; }
    if (!file.size || file.size > MAX_FILE) { rejected.push(`${file.name}：文件为空或超过 300 MB`); continue; }
    if (jobs.some((job) => job.file.name === file.name && job.file.size === file.size && job.file.lastModified === file.lastModified)) {
      rejected.push(`${file.name}：已在列表中`); continue;
    }
    if (batchSize + file.size > MAX_BATCH || jobs.length >= 100) { rejected.push('本批次最多 100 首 / 512 MB，请下载并清空列表后继续。'); break; }
    batchSize += file.size;
    jobs.push({ id: ++sequence, file, state: 'queued' });
  }
  notify(rejected.join('；'));
  render(); pump();
}

function action(label, callback, secondary = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label;
  if (secondary) button.className = 'secondary';
  button.addEventListener('click', callback);
  return button;
}

function render() {
  $('#queue').replaceChildren();
  $('#count').textContent = jobs.length;
  $('#clear-button').hidden = !jobs.length;
  $('#clear-button').disabled = processing;
  const done = jobs.filter((job) => job.state === 'done');
  $('#summary').hidden = !done.length;
  $('#summary-text').textContent = `${done.length} / ${jobs.length} 首已完成 · 转换结果仅保存在当前页面`;
  if (!jobs.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = '准备好你的音乐，转换结果会显示在这里。';
    $('#queue').append(empty);
  }
  for (const job of jobs) {
    const row = document.createElement('div'); row.className = 'item'; row.dataset.state = job.state;
    const icon = document.createElement('div'); icon.className = 'item-icon'; icon.textContent = job.state === 'done' ? '♪' : job.state === 'error' ? '!' : '♫';
    const main = document.createElement('div'); main.className = 'item-main';
    const title = document.createElement('div'); title.className = 'item-name'; title.textContent = job.name || job.file.name; title.title = title.textContent;
    const meta = document.createElement('div'); meta.className = 'item-meta';
    meta.textContent = `${(job.file.size / 1024 ** 2).toFixed(1)} MB${job.source ? ` · ${job.source.toUpperCase()} → MP3` : ''}`;
    const status = document.createElement('span'); status.className = `item-status ${job.state === 'error' ? 'error' : job.state === 'done' ? 'ok' : ''}`;
    status.setAttribute('role', 'status');
    status.textContent = { queued: '等待转换', working: '正在本机转换…', done: job.warning || '转换完成', error: job.error, cancelled: '已取消' }[job.state];
    job.statusElement = status;
    main.append(title, meta, status);
    const actions = document.createElement('div'); actions.className = 'item-actions';
    if (job.state === 'working') {
      const progress = document.createElement('div'); progress.className = 'progress processing';
      const fill = document.createElement('span'); progress.append(fill); main.append(progress); job.progressElement = progress;
      actions.append(action('取消', () => job.xhr?.abort(), true));
    } else if (job.state === 'done') actions.append(action('下载 MP3', () => download(job.url, job.name)));
    else if (job.state === 'error' || job.state === 'cancelled') actions.append(action('重试', () => { job.state = 'queued'; render(); pump(); }));
    row.append(icon, main, actions); $('#queue').append(row);
  }
}

async function pump() {
  if (processing) return;
  processing = true;
  try {
    let job;
    while ((job = jobs.find((item) => item.state === 'queued'))) {
      job.state = 'working'; render();
      try {
        await checkConnection();
        if (!online) throw new Error('本地服务未连接。请启动服务后重试。');
        const result = await requestConversion(job);
        job.name = result.name; job.source = result.source; job.warning = result.warning;
        job.blob = result.blob; job.url = URL.createObjectURL(result.blob); job.state = 'done';
      } catch (error) {
        job.state = error.name === 'AbortError' ? 'cancelled' : 'error'; job.error = error.message;
      } finally { job.xhr = null; }
      render();
    }
  } finally { processing = false; render(); }
}

function requestConversion(job) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); job.xhr = xhr;
    xhr.open('POST', '/api/convert'); xhr.responseType = 'blob'; xhr.timeout = 10 * 60 * 1000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(job.file.name));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round(event.loaded / event.total * 100);
      job.statusElement.textContent = percent === 100 ? '正在解密与转换…' : `正在读取文件 ${percent}%`;
    };
    xhr.onprogress = (event) => {
      if (!event.lengthComputable) return;
      job.statusElement.textContent = `正在接收 MP3 ${Math.round(event.loaded / event.total * 100)}%`;
    };
    xhr.onload = async () => {
      try {
        if (xhr.status !== 200) {
          let message = '转换失败，请重试。';
          try { message = JSON.parse(await xhr.response.text()).error || message; } catch { /* Unknown response. */ }
          throw new Error(message);
        }
        resolve({ blob: xhr.response, name: decodeURIComponent(xhr.getResponseHeader('X-Output-Name')), source: xhr.getResponseHeader('X-Source-Format'), warning: decodeURIComponent(xhr.getResponseHeader('X-Conversion-Warnings') || '') });
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error('连接中断，请确认本地服务正在运行。'));
    xhr.ontimeout = () => reject(new Error('转换超过 10 分钟，请检查文件后重试。'));
    xhr.onabort = () => reject(new DOMException('转换已取消。', 'AbortError'));
    xhr.send(job.file);
  });
}

function download(url, name) {
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
}
$('#clear-button').addEventListener('click', () => {
  if (processing) return;
  for (const job of jobs) if (job.url) URL.revokeObjectURL(job.url);
  jobs.length = 0; notify(); render();
});
$('#download-all').addEventListener('click', async () => {
  const button = $('#download-all'); button.disabled = true; button.textContent = '正在打包…';
  try {
    const zip = await createZip(jobs.filter((job) => job.state === 'done').map((job) => ({ name: job.name, blob: job.blob })));
    const url = URL.createObjectURL(zip); download(url, 'ncm-to-mp3.zip'); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { notify(`打包失败：${error.message}。可以逐首下载。`); }
  finally { button.disabled = false; button.textContent = '打包下载 ZIP'; }
});
window.addEventListener('beforeunload', (event) => { if (processing) { event.preventDefault(); event.returnValue = ''; } });
render(); checkConnection();
