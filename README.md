# DeepSeek 余额状态栏（`@local/dsh-account-statusbar`）

一个 Harness 本地插件：在界面最底部新增一条状态栏，**第一个条目显示 DeepSeek 账户余额**。

## 它做什么

- 占用 root 作用域的 `shell.bottom` 槽位（横跨三列下方的整行），高度 26px，随主题自动明暗。
- 左侧首个条目：`● DeepSeek 余额  ¥123.45`。
  - 圆点表示状态：绿色=已读到，灰色=未登录，蓝色=读取中，红色=失败。
  - 悬停显示刷新时间与失败原因；点击立即刷新。
  - 账户有赠送额度时，追加 `+¥x.xx`。
  - 未登录显示“未登录”，读取失败显示“余额不可用”，但会保留上一次成功读到的金额（灰显）。
- 余额读取走 Harness 自带的 `account` Remote 命名空间（`ctx.remote.account.getBalance`），即设置页“账户”卡片使用的同一条 Host 通道，因此登录凭证、平台请求、401 失效处理都由 Host 负责，插件本身不接触 token。
- 刷新时机：页面打开后约 0.4s 首次读取、之后每 60s、切回标签页且数据超过 30s 时、点击条目时。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包含 `dsh.bundle.patch` 与 `dsh.client`（`platform: web`、`immediately`），导出 `./client`、`./locale/*.json`、`./icon` |
| `cordis.patch.yml` | 插入一条 Host 行 `account-statusbar` |
| `index.js` | Host 半：空 `apply`。它只让包拥有 Loader 行，浏览器半才会被 Client 模块系统提供 |
| `client.js` | 浏览器半：注册 `shell.bottom`，持有余额快照并渲染状态栏 |
| `locale/zh.json`、`locale/en.json` | 插件列表中的标题与描述 |
| `icon.svg` | 原创图标 |

## 怎么加更多条目

状态栏外层是“左侧条目行 + 右侧条目行”的 flex 容器：新条目加进 `StatusBar` 的条目行即可，高度、分隔线与悬停效果由 `.dsh-account-statusbar` 统一提供，条目自身只需一个 `button.dsh-account-statusbar__item`。

## 安装

方式一（本地目录）：Web 界面 **插件 → 添加插件**，填入本目录绝对路径；安装后刷新页面。

方式二（GitHub）：

```bash
dsh plugin --profile <你的 profile> add github:SenhoiBot/dsh-account-statusbar
```

（或在 插件 → 添加插件 里填 `github:SenhoiBot/dsh-account-statusbar`。装完刷新页面。）

## 验证

- 安装后刷新页面，界面底部应出现 26px 状态栏。
- 本插件不自带构建步骤：`client.js` 是手写的浏览器模块（`window.__ModuleLoader__.load`），无 TSX、无打包。
- 无浏览器控制时能验证的部分：`node --check` 语法、`package.json`/locale JSON、`node test/statusbar.test.mjs`（槽位注册、Remote 结果到状态的映射、文案，16 项断言）。**实际渲染效果仍需在页面刷新后人工确认。**
