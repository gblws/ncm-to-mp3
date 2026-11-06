# NCM to MP3 · 本地音乐转换

打开本地页面，把网易云音乐下载的 `.ncm` 文件拖进去，转换并下载 `.mp3`。支持批量队列、中文歌曲信息、专辑封面、取消重试和 ZIP 打包下载。

使用 Node.js 内置模块实现，**不需要 npm install**。音频只发送给本机 `127.0.0.1` 服务；页面不加载 CDN、在线字体、统计脚本或第三方 API。

## 开始使用

安装 [Node.js](https://nodejs.org/) 18 或以上版本，推荐使用当前 LTS 版本。下载本仓库并解压。

**Windows：** 双击 `start.bat`，会启动服务并自动打开浏览器。保持启动窗口打开，关闭它就会停止服务。

**Windows / macOS / Linux：** 在项目目录运行：

```sh
node src/server.js
```

打开 **http://127.0.0.1:8787**，拖入 NCM 文件或点击“选择文件”。转换完成后，可以逐首下载或点击“打包下载 ZIP”。下载位置由浏览器决定。

也可以使用 `npm start`。服务只监听本机回环地址。修改端口示例：

```powershell
# PowerShell
$env:PORT = '8788'
node src/server.js
```

```sh
# macOS / Linux
PORT=8788 node src/server.js
```

## MP3 与 FLAC

NCM 是容器，其内部通常是 MP3 或 FLAC：

- **内部 MP3：** 直接解密原始音频，不重编码，不改变原音质或码率。
- **内部 FLAC：** 使用本机 FFmpeg 转码成 320 kbps、44.1 kHz、双声道 MP3。这是有损转换。
- 尽可能将 NCM 中的标题、歌手、专辑和 PNG/JPEG 封面写入 ID3v2.4 标签；元信息损坏时会提示并使用原文件名。
- 不会删除或改写原 NCM 文件。页面的转换结果暂存在内存中，刷新页面后清空，请及时下载。

MP3 音源不需要 FFmpeg。FLAC 音源需要先安装 [FFmpeg](https://ffmpeg.org/download.html)，确保命令行可执行 `ffmpeg -version`，然后重启服务。也可设置 `FFMPEG_PATH` 为可执行文件的绝对路径。

Windows 还可以在项目根目录运行：

```powershell
powershell -File scripts/setup-ffmpeg.ps1
```

脚本从 FFmpeg 官网列出的 [Gyan 构建](https://www.gyan.dev/ffmpeg/builds/) 下载程序，校验 SHA256 后放入项目的 `.tools/ffmpeg.exe`。该目录被 Git 忽略，不会上传仓库。FFmpeg 是独立软件，适用其[自身许可证](https://ffmpeg.org/legal.html)。

## 命令行批量转换

```sh
node src/cli.js "歌曲.ncm" "另一首.ncm" --out output
```

默认输出到 `output/`，遇到同名文件自动加编号，不覆盖已有文件。每个文件单独报告成功或失败。

## 限制

- 支持标准 `CTENFDAM` 文件头的 NCM 容器，不支持 NRC 歌词、其他音乐平台加密格式或损坏的 NCM。
- 页面单文件最多 300 MB，每批最多 100 首 / 512 MB。完成并下载后可清空列表继续。
- 队列依次转换；一个本地服务同一时间处理一个文件。其他标签页同时提交会提示稍后重试。
- 这是需要 Node.js 本地服务的项目，不能直接双击 `index.html` 使用，也不能仅部署到 GitHub Pages。
- 支持现代 Edge、Chrome、Firefox 和 Safari；通常需要允许浏览器下载文件。

## 开发和测试

```sh
npm test
# 没有 npm 时
node --test test/ncm.test.js test/server.test.js test/zip.test.js test/transcode.test.js
```

测试覆盖 NCM 密钥流和封面填充、中文元信息、损坏输入、ID3 标签、HTTP 二进制下载、来源校验、ZIP 完整性，以及 FLAC 到可解码 MP3 的集成测试。缺少 FFmpeg 时，最后一项自动跳过。仓库测试只使用合成音频和合成 NCM，不包含真实歌曲。

```text
public/       页面、转换队列和 ZIP 打包
src/ncm.js    NCM 解密和 ID3 标签
src/convert.js MP3 导出与 FFmpeg 转码
src/server.js 本地 HTTP 服务
src/cli.js    命令行转换
scripts/      Windows FFmpeg 安装辅助脚本
test/         自动化测试
```

## 参考与许可

项目交互参考 [音乐解锁](https://unlock.music.hi.cn/)，NCM 格式与转换流程参考 [iKunpw/auto-ncmdump](https://github.com/iKunpw/auto-ncmdump) 及其使用的 ncmdump 实现。这里以 Node.js 独立实现，不包含参考项目的可执行文件或其打包依赖。

源码使用 [MIT 许可证](LICENSE)。请仅处理你拥有合法使用权的音频，并遵守当地法律和相关服务条款。
