# Webtrail

Webtrail 是一个本地优先的 Chrome 永久历史记录插件。它接管 `chrome://history`，把 Chrome 当前仍可访问的历史导入本地 IndexedDB，之后持续归档新访问。即使从 Chrome 原生历史中删除记录，Webtrail 归档仍会保留，除非你明确执行“从永久归档删除”。

## 核心能力

- 可视化分析：按天、周、月切换柱状趋势图，联动灰蓝 GitHub 式热力图和热门域名 TOP 5。
- 历史记录：按日期、日历、域名、访问类型和关键词精确筛选，并按浏览会话清晰分组。
- 点击分析页日历或热力图日期，可直接切换到当天分析。
- 后台深度导入 Chrome 当前可访问的旧历史，并持续归档新访问。
- 使用 `unlimitedStorage` 的本地 IndexedDB 永久保存，不上传服务器。
- 导出历史 CSV、批量重新打开页面，并可只从 Chrome 原生历史删除记录。
- 覆盖 `chrome://history`，也可从扩展图标直接进入。

## 安装

```powershell
npm install
npm run build
```

然后：

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `dist/extension`。

也可以生成可分发压缩包：

```powershell
npm run pack:extension
```

产物为 `dist/webtrail-extension.zip`。

## 自动发布

每次提交到 `main` 后，GitHub Actions 会自动：

1. 执行类型检查、自动化测试和生产构建。
2. 生成 `webtrail-extension.zip`。
3. 创建对应 Git Tag。
4. 创建 GitHub Release 并上传插件压缩包。

当前 `package.json` 版本首次发布使用对应的 `v<版本号>`；同一版本的后续提交使用
`v<版本号>-build.<运行号>.<尝试号>`。准备正式升级时，同时修改
`package.json` 和 `src/renderer/public/manifest.json` 的版本号。

## 开发预览

```powershell
npm run dev
```

普通网页预览会写入一组确定性的本地示例数据，便于开发 UI。只有作为 Chrome 扩展加载后，才能访问真实 `chrome.history`。

## 验证

```powershell
npm run check
```

该命令执行 TypeScript 类型检查、扩展架构测试和生产构建。

## 数据边界

- Webtrail 只能导入 Chrome 目前仍能提供的历史；已经被 Chrome 清理且没有旧备份的数据无法恢复。
- 安装后产生的新历史会持续写入独立归档，不受 Chrome 原生历史清理影响。
- 卸载扩展会删除扩展自己的 IndexedDB。卸载前请使用顶部“导出”保存历史 CSV。
- 隐身模式被明确禁用；扩展不注入网页、不读取网页正文，也不把历史上传到服务器。
