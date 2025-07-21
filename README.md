# MCP PRD Server

这是一个基于MCP（Model Context Protocol）的PRD内容管理服务器，用于获取和管理PRD文档内容。

## 功能特性

- 获取PRD文档内容
- 支持按章节获取PRD内容
- 提供PRD资源访问
- 自动爬取和缓存PRD数据
- 支持项目列表和版本管理

## 安装

### 作为依赖安装

```bash
npm install mcp-prd-server
```

### 全局安装

```bash
npm install -g mcp-prd-server
```

## 使用方法

### 作为 MCP 服务器使用

```bash
# 直接运行
node build/index.js

# 或者使用全局命令
prd-server
```

### 在代码中使用

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 创建MCP服务器
const server = new McpServer({
  name: "PRD-Server",
  version: "1.0.0",
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
```

## 开发

### 本地开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建项目
npm run build

# 运行项目
npm start
```

## 发布到 npm

### 1. 准备发布

```bash
# 构建项目
npm run build

# 检查将要发布的文件
npm pack --dry-run
```

### 2. 登录 npm

```bash
npm login
```

### 3. 发布包

```bash
# 发布到 npm
npm publish

# 或者发布到特定 scope
npm publish --access public
```

### 4. 更新版本

```bash
# 更新补丁版本 (1.0.0 -> 1.0.1)
npm version patch

# 更新次要版本 (1.0.0 -> 1.1.0)
npm version minor

# 更新主要版本 (1.0.0 -> 2.0.0)
npm version major
```

## 配置说明

### package.json 关键字段

- `main`: 指定包的入口文件
- `bin`: 指定可执行文件
- `files`: 指定要发布的文件
- `prepublishOnly`: 发布前自动执行的脚本

### 发布文件结构

```
mcp-prd-server/
├── build/           # 编译后的 JavaScript 文件
├── README.md        # 项目说明文档
└── package.json     # 包配置文件
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
