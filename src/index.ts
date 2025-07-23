#!/usr/bin/env node

// 只保留一次 import，每个依赖只导入一次
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import { config, projectListPath, projectVersionsPath } from "./config.js";
import { registerTools } from "./tools.js";
import { fetchPrd, fetchAndSaveAllPrd, cleanupBrowser } from "./handlers.js";

async function main() {
  try {
    // 读取项目和版本数据前，判断文件是否存在，不存在则自动生成
    if (!fs.existsSync(projectListPath) || !fs.existsSync(projectVersionsPath)) {
      console.error("项目或版本数据文件不存在，正在自动爬取并生成...");
      await fetchAndSaveAllPrd();
    }

    // 创建MCP服务器
    const server = new McpServer({
      name: "PRD-Server",
      version: "1.0.0",
    });

    // 注册所有工具
    registerTools(server);
    
    console.error("PRD-Server 工具注册完成");

    // 启动服务器
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error("PRD-Server 已启动并连接到传输层");

    // 本地调试时直接调用 node build/index.js
    if (config.saveScreenshot) {
      (async () => {
        const result = await fetchAndSaveAllPrd();
        console.log(result);
      })();
    }
    
    // 注册进程退出时的清理函数
    process.on('SIGINT', async () => {
      console.log('正在关闭浏览器实例...');
      await cleanupBrowser();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('正在关闭浏览器实例...');
      await cleanupBrowser();
      process.exit(0);
    });
    
    process.on('exit', async () => {
      await cleanupBrowser();
    });
  } catch (error) {
    console.error("PRD-Server 启动失败:", error);
    await cleanupBrowser();
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error("PRD-Server 运行时错误:", error);
  await cleanupBrowser();
  process.exit(1);
});
