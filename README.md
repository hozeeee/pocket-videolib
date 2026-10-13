# pocket-videolib

[![CI](https://github.com/hozeeee/pocket-videolib/actions/workflows/ci.yml/badge.svg)](https://github.com/hozeeee/pocket-videolib/actions/workflows/ci.yml)
[![Release](https://github.com/hozeeee/pocket-videolib/actions/workflows/release.yml/badge.svg)](https://github.com/hozeeee/pocket-videolib/actions/workflows/release.yml)

把本地目录变成一个随身媒体库：在电脑上一条命令启动，手机、平板、其他电脑通过浏览器即可浏览和播放其中的视频、音频与图片。

客户端支持**分片缓存**——服务端带宽不足时，可以先在浏览器里缓存一段（或整部）视频再观看，缓存完成后断网也能播放。

## 功能特性

- **单文件分发**：打包产物只有一个 `pocket-videolib.js`，网页资源已内嵌，零运行时依赖，有 Node.js 就能运行
- **媒体浏览**：目录导航、面包屑、关键字过滤、网格 / 列表视图切换，可只显示媒体文件
- **在线播放**
  - 视频 / 音频播放，支持 HTTP Range，可任意拖动进度
  - 自动加载同名字幕（`.vtt`，或自动转换的 `.srt`）
  - 记忆播放进度，下次打开自动续播
  - 同目录播放列表，播放结束自动播放下一个
  - 图片查看
- **客户端缓存**
  - 按 2 MiB 分片缓存到浏览器 IndexedDB，进度条直观显示已缓存区间
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

> 能否在浏览器中播放取决于浏览器自身的解码能力。`mp4`（H.264/AAC）与 `webm` 兼容性最好，`mkv`、`avi`、`wmv` 等格式在多数浏览器中无法直接播放，但仍可下载。

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
```

在同一局域网的设备上用浏览器打开对应地址即可。按 `Ctrl + C` 停止服务。

### 视频缓存

1. 进入视频播放页后，缓存面板默认开启"自动缓存"，会从当前播放位置开始在后台下载
2. 进度条上会标出已缓存的区间；可以随时暂停、继续或删除缓存
3. 顶部导航的"缓存"页面可以查看所有已缓存文件和浏览器存储占用

缓存的播放方式取决于访问环境：

| 访问环境                               | 播放行为                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| HTTPS，或 `localhost` 访问             | Service Worker 生效，**边缓存边播放**，已缓存部分从本地读取，未缓存部分走网络           |
| 局域网 HTTP（如 `http://192.168.x.x`） | 浏览器不允许注册 Service Worker；缓存仍会进行，**整个文件缓存完成后**自动切换为本地播放 |

> 如果希望在手机等远端设备上"边缓存边播放"，请使用 `--cert` / `--key` 开启 HTTPS。

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

| 参数                     | 简写 | 说明                                       | 默认值       |
| ------------------------ | ---- | ------------------------------------------ | ------------ |
| `[dir]` / `--dir <path>` | `-d` | 要分享的媒体目录                           | 当前工作目录 |
| `--port <number>`        | `-p` | 监听端口，`0` 表示随机端口                 | `8080`       |
| `--host <address>`       | `-H` | 绑定地址，仅本机访问可设为 `127.0.0.1`     | `0.0.0.0`    |
| `--auth <user:pass>`     | `-a` | 开启 HTTP Basic 认证，格式为 `用户名:密码` | 不开启       |
| `--cert <path>`          |      | TLS 证书文件，需与 `--key` 同时使用        | -            |
| `--key <path>`           |      | TLS 私钥文件，需与 `--cert` 同时使用       | -            |
| `--show-hidden`          |      | 显示以 `.` 开头的隐藏文件                  | 关闭         |
| `--follow-symlinks`      |      | 允许访问指向媒体目录外部的符号链接         | 关闭         |
| `--verbose`              |      | 打印访问日志                               | 关闭         |
| `--version`              | `-v` | 显示版本号                                 |              |
| `--help`                 | `-h` | 显示帮助信息                               |              |

### 环境变量

| 变量                   | 说明                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | 未指定 `--port` 时使用的端口                                                                                            |
| `POCKET_VIDEOLIB_AUTH` | 未指定 `--auth` 时使用的认证信息，格式 `用户名:密码`。推荐用它代替命令行传入密码，避免密码出现在进程列表与 shell 历史中 |

```bash
POCKET_VIDEOLIB_AUTH=admin:secret PORT=3000 pocket-videolib ~/Videos
```

## HTTP 接口

前端通过以下接口与服务端通信，也可以直接用 `curl`、播放器等工具访问：

| 接口                               | 说明                                                    |
| ---------------------------------- | ------------------------------------------------------- |
| `GET /api/info`                    | 服务信息：名称、版本、根目录名称                        |
| `GET /api/list?path=<相对路径>`    | 列出目录内容，目录排在前面                              |
| `GET /media/<相对路径>`            | 获取文件内容，支持 `Range`、`If-Range`、`If-None-Match` |
| `GET /media/<相对路径>?download`   | 以附件形式下载                                          |
| `GET /media/<字幕路径>?format=vtt` | 获取字幕，`.srt` 会转换为 WebVTT                        |

例如用 VLC、mpv 等播放器直接播放：

```bash
mpv "http://192.168.1.10:8080/media/movies/demo.mp4"
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
│   ├── routes/             # 接口：目录列表、媒体文件、静态资源
│   └── utils/              # Range 解析、路径安全、字幕转换等
├── shared/                 # 前后端共享的接口类型
├── web/                    # 前端（Vue 3 + Vite）
│   └── src/
│       ├── views/          # 页面：浏览、播放、缓存管理
│       ├── components/     # 组件：browser / player / cache / layout / common
│       ├── composables/    # 组合式函数
│       ├── services/       # 接口请求、IndexedDB 缓存、下载管理
│       ├── utils/          # 分片计算、格式化等
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

确认手机与电脑在同一局域网，且服务没有绑定到 `127.0.0.1`；检查电脑防火墙是否放行了对应端口。

**视频能缓存但不能边缓存边播放？**

通过局域网 IP 的 HTTP 地址访问时浏览器不允许使用 Service Worker，需要等待整个文件缓存完成，或开启 HTTPS。详见 [视频缓存](#视频缓存)。

**缓存占用了多少空间？能缓存多大的文件？**

缓存页面会显示浏览器给出的存储用量与配额。可用空间由浏览器根据设备剩余磁盘空间决定；存储空间紧张时浏览器可能自动清理缓存。

**某些视频只有声音没有画面，或无法播放？**

这是浏览器不支持该视频编码导致的（常见于 HEVC/H.265、`mkv`、`avi` 等）。可以转码为 H.264 编码的 `mp4`，或使用下载功能后在本地播放器中观看。

## License

[MIT](./LICENSE)
