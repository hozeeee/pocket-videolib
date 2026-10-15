# pocket-videolib

[![CI](https://github.com/hozeeee/pocket-videolib/actions/workflows/ci.yml/badge.svg)](https://github.com/hozeeee/pocket-videolib/actions/workflows/ci.yml)
[![Release](https://github.com/hozeeee/pocket-videolib/actions/workflows/release.yml/badge.svg)](https://github.com/hozeeee/pocket-videolib/actions/workflows/release.yml)

把本地目录变成一个随身媒体库：在电脑上一条命令启动，手机、平板、其他电脑通过浏览器即可浏览和播放其中的视频、音频与图片。

客户端支持**清晰度选择**与**分片缓存**——服务端安装了 ffmpeg 时可在原画与 1080p / 720p / 480p / 360p 转码之间切换（类似视频网站的 HLS 流媒体）；带宽不足时，可以先在浏览器里缓存一段（或整部）视频再观看，缓存完成后断网也能播放。

## 功能特性

- **单文件分发**：打包产物只有一个 `pocket-videolib.js`，网页资源已内嵌，零运行时依赖，有 Node.js 就能运行（转码为可选功能，需要系统中的 ffmpeg）
- **媒体浏览**：目录导航、面包屑、关键字过滤、网格 / 列表视图切换，可只显示媒体文件
- **在线播放**
  - 视频 / 音频播放，支持 HTTP Range，可任意拖动进度
  - 自动加载同名字幕（`.vtt`，或自动转换的 `.srt`）
  - 记忆播放进度，下次打开自动续播
  - 同目录播放列表，播放结束自动播放下一个
  - 图片查看
- **清晰度与转码**（需要 ffmpeg）
  - 按需转码为 HLS（1080p / 720p / 480p / 360p，不超过原始分辨率），只转码正在观看的片段，转码结果缓存在磁盘
  - 自动检测浏览器能否解码原画（如 HEVC、`mkv`），不支持时自动切换为转码播放
  - 未安装 ffmpeg 时只提供原画，其他功能不受影响
- **客户端缓存**
  - 缓存当前所选清晰度：原画按 2 MiB 分片、转码清晰度按 HLS 分片缓存到浏览器 IndexedDB，进度条直观显示已缓存区间
  - 播放与缓存共用同一份数据：播放过的部分不会再下载一次，播放缓冲不足时后台缓存自动让路
  - 从当前播放位置优先缓存，拖动进度后自动调整下载顺序
  - 支持暂停 / 继续 / 失败自动重试，服务端文件变更后自动识别
  - 通过 Service Worker 实现"边缓存边播放"，已缓存部分直接从本地读取
  - 缓存管理页：查看缓存列表、存储占用，删除单个或全部缓存
- **安全**
  - 可选 HTTP Basic 认证
  - 可选 HTTPS
  - 禁止访问根目录以外的文件（防路径穿越、默认禁止符号链接逃逸）
  - 默认隐藏以 `.` 开头的文件

### 支持的格式

| 类型 | 扩展名                                                            |
| ---- | ----------------------------------------------------------------- |
| 视频 | `mp4` `m4v` `webm` `mkv` `mov` `ogv` `avi` `wmv` `flv` `ts` `3gp` |
| 音频 | `mp3` `m4a` `aac` `flac` `wav` `ogg` `oga` `opus`                 |
| 图片 | `jpg` `jpeg` `png` `gif` `webp` `avif` `bmp` `svg`                |
| 字幕 | `vtt` `srt`                                                       |

> 能否在浏览器中播放原画取决于浏览器自身的解码能力。`mp4`（H.264/AAC）与 `webm` 兼容性最好，`mkv`、`avi`、`wmv` 等格式在多数浏览器中无法直接播放。服务端启用转码后，这些格式可以通过转码清晰度观看；未启用时仍可下载。

## 安装

运行环境要求 **Node.js >= 18.17**。

### 方式一：下载单文件（推荐）

从 [GitHub Releases](https://github.com/hozeeee/pocket-videolib/releases) 下载 `pocket-videolib.js`，直接运行：

```bash
node pocket-videolib.js ~/Videos
```

### 方式二：通过 npm 安装

> 需要项目已发布到 npm（见下文 [发布到 npm](#发布到-npm)）。

```bash
# 全局安装
npm install -g pocket-videolib
pocket-videolib ~/Videos

# 或者免安装直接运行
npx pocket-videolib ~/Videos
```

### 方式三：从源码构建

```bash
git clone https://github.com/hozeeee/pocket-videolib.git
cd pocket-videolib
npm install
npm run build
node dist/pocket-videolib.js ~/Videos
```

## 使用说明

### 快速开始

```bash
# 分享当前目录，默认端口 8080
pocket-videolib

# 分享指定目录并指定端口
pocket-videolib -d /data/movies -p 3000

# 开启密码保护
pocket-videolib ~/Videos --auth admin:secret
```

启动后终端会打印可访问的地址（包括局域网 IP），例如：

```text
  pocket-videolib v0.1.0
  Serving: /home/me/Videos
  Open:    http://localhost:8080
  Open:    http://192.168.1.10:8080
  Open:    http://[240e:3b7::1]:8080
  网卡链路: eth0 1 Gbps（本机到路由器的协商速率）
  外网实测: 下载 286 Mbps / 上传 42 Mbps（Cloudflare，当前实际吞吐率）
  上行限速: 不限速（可用 --limit-rate 设置）
  Quality:  original + up to 1080p HLS (ffmpeg 7.1)
```

在同一局域网的设备上用浏览器打开对应地址即可。按 `Ctrl + C` 停止服务。

### 限制上行带宽

多人同时观看或客户端后台缓存时，可能占满本机的上行带宽。使用 `--limit-rate` 限制媒体文件传输的**总速率**（所有连接共享，并发请求会大致平分）：

```bash
pocket-videolib ~/Videos --limit-rate 20Mbps   # 比特，按 1000 换算，与运营商带宽单位一致
pocket-videolib ~/Videos --limit-rate 2M       # 字节，即 2 MiB/s，按 1024 换算（同 curl）
```

| 写法                           | 含义                      |
| ------------------------------ | ------------------------- |
| `500K` / `500KB` / `500KiB`    | 500 KiB/s                 |
| `2M` / `2MB/s` / `1.5G`        | MiB/s、GiB/s              |
| `800kbps` / `20Mbps` / `1Gbps` | 比特每秒（也可写 `mbit`） |
| `0`                            | 不限速                    |

启动时会同时显示：

- **网卡链路**：本机到路由器 / 交换机的协商速率。Linux 读取 `/sys/class/net`（无线网卡通过 `iw`），macOS 有线网卡读取 `ifconfig`、Wi-Fi 读取 `system_profiler`，Windows 读取 `Get-NetAdapter`
- **外网实测**：通过 Cloudflare 边缘节点实际下载和上传数据，反映当前运营商线路的真实吞吐率。先用小数据包预热，再自适应选择约 2 秒的测量数据量，单次启动最多下载约 25.5 MiB、上传约 10.25 MiB，总超时 25 秒
- **上行限速**：`--limit-rate` 设置的所有媒体连接共享上限；不低于实测外网上行时会提示可能不会生效

测速会将本机公网 IP 提供给 Cloudflare，并产生最多约 36 MiB 流量；Cloudflare 可能根据 IP 估算地区和运营商 ASN。离线或测速服务不可达不会影响媒体服务启动，只会显示“测速失败”。不希望启动时测速时可使用：

```bash
pocket-videolib ~/Videos --no-speed-test
```

限速仅作用于 `/media` 文件传输与 `/hls` 转码分片，目录列表、页面等小响应不受影响。

### 清晰度与转码

服务端能找到 ffmpeg 时自动启用转码，启动信息中会显示 `Quality: original + up to 1080p HLS (...)`；找不到时显示仅提供原画。

```bash
# Debian / Ubuntu
sudo apt install ffmpeg
# macOS
brew install ffmpeg
# Windows
winget install ffmpeg

# ffmpeg 不在 PATH 中时手动指定（ffprobe 默认使用同一目录下的）
pocket-videolib ~/Videos --ffmpeg /opt/ffmpeg/bin/ffmpeg

# 指定转码缓存目录与上限；或完全关闭转码
pocket-videolib ~/Videos --transcode-cache /data/pvl-cache --transcode-cache-size 50G
pocket-videolib ~/Videos --no-transcode
```

工作方式：

- 播放页的清晰度菜单提供"原画"和不高于原始分辨率的转码档位，选择会被记住；已完整缓存某个清晰度时优先使用它
- 转码按 6 秒一个分片**按需进行**（并预先转码后面几个分片），拖动进度后从新位置开始，不必等整部视频转完；输出为 H.264 + AAC，所有主流浏览器都能播放
- 转码结果写入磁盘缓存（默认位于系统临时目录的 `pocket-videolib/hls`，上限 10 GiB，超出后清理最久未使用的分片），再次观看或多人观看同一视频时不重复转码；源文件修改后自动失效
- 转码对 CPU 要求较高，配置较低的机器建议选择 720p 及以下；若浏览器能直接播放原画，原画不消耗服务端 CPU
- 带宽有限时选择较低清晰度，流量大致为：1080p 约 5.6 Mbps、720p 约 3.2 Mbps、480p 约 1.7 Mbps、360p 约 1 Mbps

### IPv6

默认同时监听 IPv4 与 IPv6（双栈），启动时会列出本机的公网 / 局域网 IPv6 地址（链路本地地址 `fe80::` 需要带网卡名，浏览器无法直接访问，不会列出）。系统未启用 IPv6 时会自动只监听 IPv4。

```bash
pocket-videolib ~/Videos                  # 默认：IPv4 + IPv6
pocket-videolib ~/Videos --host ::        # 显式指定双栈
pocket-videolib ~/Videos --host 0.0.0.0   # 仅 IPv4
pocket-videolib ~/Videos --host ::1       # 仅本机 IPv6，也可写成 [::1]
```

浏览器中访问 IPv6 地址需要用方括号包裹，如 `http://[240e:3b7::1]:8080`。通过公网 IPv6 从外网访问时，还需要在路由器 / 光猫和系统防火墙中放行对应端口，并建议开启 `--auth`。

### 视频缓存

1. 进入视频播放页后，缓存面板默认开启"自动缓存"，会从当前播放位置开始在后台下载**当前清晰度**；切换清晰度后改为缓存新的清晰度（已缓存的保留）
2. 进度条上会标出已缓存的区间；可以随时暂停、继续或删除缓存
3. 顶部导航的"缓存"页面可以查看所有已缓存文件（含清晰度）和浏览器存储占用

缓存的播放方式取决于访问环境：

| 访问环境                               | 转码清晰度                                          | 原画                                                                                    |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| HTTPS，或 `localhost` 访问             | 边缓存边播放，已缓存分片从本地读取，可离线播放      | Service Worker 生效，**边缓存边播放**，已缓存部分从本地读取，未缓存部分走网络           |
| 局域网 HTTP（如 `http://192.168.x.x`） | 同上（由播放器直接读写缓存，不依赖 Service Worker） | 浏览器不允许注册 Service Worker；缓存仍会进行，**整个文件缓存完成后**自动切换为本地播放 |

> 局域网 HTTP 访问时，推荐使用转码清晰度来"边缓存边播放"；如果希望原画也能边缓存边播放，请使用 `--cert` / `--key` 开启 HTTPS。iOS 17.1 以下的 Safari 只能使用系统自带的 HLS 播放器，此时转码清晰度也需要 HTTPS 才能读取缓存。

### 开启 HTTPS

可以用 [mkcert](https://github.com/FiloSottile/mkcert) 生成局域网可信证书：

```bash
mkcert -install
mkcert 192.168.1.10 localhost
pocket-videolib ~/Videos --cert ./192.168.1.10+1.pem --key ./192.168.1.10+1-key.pem
```

远端设备需要信任 mkcert 的根证书（`mkcert -CAROOT` 目录下的 `rootCA.pem`），否则浏览器会提示证书不受信任，Service Worker 也无法注册。

### 字幕

与视频同目录、文件名以视频文件名开头的字幕文件会被自动加载，例如 `movie.mp4` 会匹配：

- `movie.srt`
- `movie.zh.vtt`
- `movie.en.srt`

文件名中视频名之后的部分（如 `zh`、`en`）会作为字幕轨道名称。`.srt` 会由服务端自动转换为 WebVTT。

## 命令行参数

```text
pocket-videolib [dir] [options]
```

| 参数                            | 简写 | 说明                                                | 默认值                                 |
| ------------------------------- | ---- | --------------------------------------------------- | -------------------------------------- |
| `[dir]` / `--dir <path>`        | `-d` | 要分享的媒体目录                                    | 当前工作目录                           |
| `--port <number>`               | `-p` | 监听端口，`0` 表示随机端口                          | `8080`                                 |
| `--host <address>`              | `-H` | 绑定地址，支持 IPv4 / IPv6，见 [IPv6](#ipv6)        | IPv4 + IPv6 双栈                       |
| `--auth <user:pass>`            | `-a` | 开启 HTTP Basic 认证，格式为 `用户名:密码`          | 不开启                                 |
| `--cert <path>`                 |      | TLS 证书文件，需与 `--key` 同时使用                 | -                                      |
| `--key <path>`                  |      | TLS 私钥文件，需与 `--cert` 同时使用                | -                                      |
| `--limit-rate <rate>`           |      | 限制总上行带宽，见 [限制上行带宽](#限制上行带宽)    | 不限速                                 |
| `--no-speed-test`               |      | 关闭启动时的 Cloudflare 外网下载/上传测速           | 默认测速                               |
| `--ffmpeg <path>`               |      | ffmpeg 可执行文件，见 [清晰度与转码](#清晰度与转码) | `PATH` 中的 `ffmpeg`                   |
| `--ffprobe <path>`              |      | ffprobe 可执行文件                                  | 与 ffmpeg 同目录                       |
| `--no-transcode`                |      | 关闭转码，只提供原画                                | 有 ffmpeg 时开启                       |
| `--transcode-cache <dir>`       |      | 转码分片的磁盘缓存目录                              | 系统临时目录下的 `pocket-videolib/hls` |
| `--transcode-cache-size <size>` |      | 转码缓存占用上限，如 `500M`、`50G`                  | `10G`                                  |
| `--show-hidden`                 |      | 显示以 `.` 开头的隐藏文件                           | 关闭                                   |
| `--follow-symlinks`             |      | 允许访问指向媒体目录外部的符号链接                  | 关闭                                   |
| `--verbose`                     |      | 打印访问日志                                        | 关闭                                   |
| `--version`                     | `-v` | 显示版本号                                          |                                        |
| `--help`                        | `-h` | 显示帮助信息                                        |                                        |

### 环境变量

| 变量                         | 说明                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PORT`                       | 未指定 `--port` 时使用的端口                                                                                            |
| `POCKET_VIDEOLIB_AUTH`       | 未指定 `--auth` 时使用的认证信息，格式 `用户名:密码`。推荐用它代替命令行传入密码，避免密码出现在进程列表与 shell 历史中 |
| `POCKET_VIDEOLIB_LIMIT_RATE` | 未指定 `--limit-rate` 时使用的限速，如 `20Mbps`                                                                         |
| `POCKET_VIDEOLIB_FFMPEG`     | 未指定 `--ffmpeg` 时使用的 ffmpeg 路径                                                                                  |
| `POCKET_VIDEOLIB_FFPROBE`    | 未指定 `--ffprobe` 时使用的 ffprobe 路径                                                                                |

```bash
POCKET_VIDEOLIB_AUTH=admin:secret PORT=3000 pocket-videolib ~/Videos
```

## HTTP 接口

前端通过以下接口与服务端通信，也可以直接用 `curl`、播放器等工具访问：

| 接口                                      | 说明                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `GET /api/info`                           | 服务信息：名称、版本、根目录名称                        |
| `GET /api/list?path=<相对路径>`           | 列出目录内容，目录排在前面                              |
| `GET /media/<相对路径>`                   | 获取文件内容，支持 `Range`、`If-Range`、`If-None-Match` |
| `GET /media/<相对路径>?download`          | 以附件形式下载                                          |
| `GET /media/<字幕路径>?format=vtt`        | 获取字幕，`.srt` 会转换为 WebVTT                        |
| `GET /api/media-info?path=<相对路径>`     | 视频信息：时长、分辨率、编码与可用的转码清晰度          |
| `GET /hls/<相对路径>/<清晰度>/index.m3u8` | 某个清晰度的 HLS 播放列表，如 `720p`                    |
| `GET /hls/<相对路径>/<清晰度>/<序号>.ts`  | HLS 分片（MPEG-TS），按需转码                           |

例如用 VLC、mpv 等播放器直接播放：

```bash
mpv "http://192.168.1.10:8080/media/movies/demo.mp4"
# 播放 720p 转码版本
mpv "http://192.168.1.10:8080/hls/movies/demo.mp4/720p/index.m3u8"
```

## 开发

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- 后端：`tsx watch`，监听 `8080` 端口，分享项目根目录
- 前端：Vite 开发服务器，`/api` 与 `/media` 请求代理到 `http://localhost:8080`（可通过环境变量 `BACKEND_URL` 修改）

> 开发模式下不会注册 Service Worker，缓存完成后会使用本地 Blob 播放。

### 常用脚本

| 命令                                | 说明                                             |
| ----------------------------------- | ------------------------------------------------ |
| `npm run dev`                       | 启动开发环境                                     |
| `npm run build`                     | 构建前端并打包为单文件 `dist/pocket-videolib.js` |
| `npm start`                         | 运行打包产物                                     |
| `npm test`                          | 运行单元测试与接口测试（Vitest）                 |
| `npm run lint` / `npm run lint:fix` | 代码检查 / 自动修复                              |
| `npm run typecheck`                 | 服务端与前端类型检查                             |

### 代码风格

项目使用 [@antfu/eslint-config](https://github.com/antfu/eslint-config) 同时负责代码检查与格式化，不使用 Prettier。

- **VS Code**：安装推荐扩展（ESLint、Vue - Official）后，保存文件时会自动执行 `eslint --fix`
- **Git 提交**：`simple-git-hooks` + `lint-staged` 会在 `pre-commit` 时自动修复暂存区文件

### 构建流程

1. `vite build` 将前端打包为单个 `web/dist/index.html`（JS、CSS 全部内联）
2. 单独构建 Service Worker 为 `web/dist/sw.js`
3. `tsup` 打包服务端代码，并将上述两个文件以字符串形式内嵌，输出 `dist/pocket-videolib.js`

### 目录结构

```text
pocket-videolib
├── src/                    # 服务端
│   ├── index.ts            # 入口：启动、日志、优雅退出
│   ├── cli.ts              # 命令行参数解析
│   ├── config.ts           # 配置校验
│   ├── server.ts           # 创建 HTTP / HTTPS 服务
│   ├── handler.ts          # 请求分发、认证
│   ├── transcode.ts        # ffmpeg 探测、HLS 按需转码与磁盘缓存
│   ├── routes/             # 接口：目录列表、媒体文件、HLS、静态资源
│   └── utils/              # Range 解析、路径安全、字幕转换等
├── shared/                 # 前后端共享的接口类型
├── web/                    # 前端（Vue 3 + Vite）
│   └── src/
│       ├── views/          # 页面：浏览、播放、缓存管理
│       ├── components/     # 组件：browser / player / cache / layout / common
│       ├── composables/    # 组合式函数
│       ├── services/       # 接口请求、IndexedDB 缓存、下载管理、hls.js 缓存加载器
│       ├── utils/          # 分片计算、清晰度选择、格式化等
│       └── sw.ts           # Service Worker
├── test/                   # 测试
└── .github/workflows/      # GitHub Actions
```

## GitHub Actions

项目包含两个工作流，位于 `.github/workflows/`。

### CI（`ci.yml`）

**触发条件**：推送到 `master` / `main` 分支，或提交 Pull Request。同一分支有新的推送时会自动取消正在运行的旧任务。

| Job      | 说明                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `lint`   | 使用 `.nvmrc` 指定的 Node 版本，执行 `npm run lint` 与 `npm run typecheck`                                                    |
| `test`   | 在 Ubuntu、Windows、macOS 上使用 Node 22 运行 `npm test`                                                                      |
| `build`  | 执行 `npm run build`，运行 `--version` 冒烟测试，并将 `pocket-videolib.js` 上传为构建产物（Artifact）                         |
| `compat` | 依赖 `build`，下载构建产物后分别在 Node 18 / 20 / 24 上启动服务，用 `curl` 验证 `/api/info`、`/api/list` 和 Range 请求（206） |

每次 CI 成功后，可在对应运行记录的 **Artifacts** 中下载打包好的 `pocket-videolib.js`。

### Release（`release.yml`）

**触发条件**：推送 `v` 开头的 Git 标签。

执行步骤：

1. 安装依赖、运行测试、构建
2. 创建 GitHub Release，附带 `dist/pocket-videolib.js`，并自动生成更新日志
3. 如果配置了 `NPM_TOKEN`，自动发布到 npm；未配置则跳过此步骤

发布新版本：

```bash
npm version patch   # 或 minor / major，会更新 package.json 并创建 v* 标签
git push --follow-tags
```

> 工作流需要 `contents: write` 权限来创建 Release，已在配置文件中声明。如果仓库设置中限制了 Actions 的权限，请在 **Settings → Actions → General → Workflow permissions** 中允许读写。

### 发布到 npm

1. 在 [npmjs.com](https://www.npmjs.com/) 的 **Access Tokens** 页面创建一个 **Automation**（或具有发布权限的 Granular）令牌
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中新建 Secret，名称为 `NPM_TOKEN`，值为上一步的令牌
3. 推送新的版本标签，Release 工作流会自动执行 `npm publish`

## 常见问题

**手机上无法访问？**

确认手机与电脑在同一局域网，且服务没有绑定到 `127.0.0.1` / `::1`；检查电脑防火墙是否放行了对应端口。

**视频能缓存但不能边缓存边播放？**

通过局域网 IP 的 HTTP 地址访问时浏览器不允许使用 Service Worker，原画需要等待整个文件缓存完成；可以改用转码清晰度，或开启 HTTPS。详见 [视频缓存](#视频缓存)。

**缓存占用了多少空间？能缓存多大的文件？**

缓存页面会显示浏览器给出的存储用量与配额。可用空间由浏览器根据设备剩余磁盘空间决定；存储空间紧张时浏览器可能自动清理缓存。

**某些视频只有声音没有画面，或提示格式不支持？**

这是浏览器不支持该视频编码导致的（常见于 HEVC/H.265、`mkv`、`avi` 等）。服务端安装 ffmpeg 后，播放页会自动切换为转码清晰度；也可以手动在清晰度菜单中选择。未安装 ffmpeg 时，可以下载后在本地播放器中观看。

**选择转码清晰度后开始播放较慢？**

首次观看时需要先转码第一个分片（通常 1～3 秒，取决于 CPU），之后的分片会提前转码；已转码的分片缓存在磁盘中，再次观看时直接返回。

## License

[MIT](./LICENSE)
