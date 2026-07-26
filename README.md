# Webtrail

Webtrail 是一个本地优先的 Chrome 永久历史记录插件。它接管 `chrome://history`，把 Chrome 当前仍可访问的历史导入本地 IndexedDB，之后持续归档新访问。即使从 Chrome 原生历史中删除记录，Webtrail 归档仍会保留，除非你明确执行“从永久归档删除”。

## 核心能力

- 时间线、会话、页面、域名四种浏览方式。
- 按日期、小时、标题、URL、域名全文筛选。
- 后台深度导入 Chrome 当前可访问的旧历史，并持续归档新访问。
- 使用 `unlimitedStorage` 的本地 IndexedDB 永久保存，不上传服务器。
- 导入旧 Webtrail JSON/CSV，完整备份 JSON，按当前结果导出 CSV。
- 批量重新打开页面；分别控制“从 Chrome 移除”和“从永久归档删除”。
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
- 卸载扩展会删除扩展自己的 IndexedDB。卸载前请在“设置 → 迁移与备份”中导出完整 JSON。
- 隐身模式被明确禁用；扩展不注入网页、不读取网页正文，也不把历史上传到服务器。
