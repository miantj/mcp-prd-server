import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { URL } from "url";
import vm from "vm";
import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import path from "path";

// 创建screenshots目录（如果不存在）
const screenshotsDir = path.join(process.cwd(), "screenshots");
async function ensureScreenshotsDir() {
  try {
    await fs.access(screenshotsDir);
  } catch {
    await fs.mkdir(screenshotsDir, { recursive: true });
  }
}

// 初始化时创建目录
ensureScreenshotsDir().catch(console.error);

// 获取安全的文件名（移除不安全字符）
function getSafeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}

// 创建MCP服务器
const server = new McpServer({
  name: "PRD-Server",
  version: "1.0.0",
});

// 1. 封装核心逻辑
async function fetchHtmlWithContentImpl(url: string) {
  // 处理URL格式
  let processedUrl = url;
  if (url.includes("#")) {
    const baseUrl = url.split("#")[0];
    const params = new URLSearchParams(url.split("#")[1]);
    const pageName = params.get("p");
    if (pageName) {
      processedUrl = `${baseUrl}${pageName}.html`;
    }
  }
  try {
    // 1. 获取 document.js
    const jsUrl = new URL("data/document.js", processedUrl).href;
    const jsResp = await axios.get(jsUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const jsContent = jsResp.data;
    const rootNodes = getCreatorResult(jsContent).sitemap.rootNodes;

    // 递归抓取内容
    async function fetchTree(nodes: any[]): Promise<any[]> {
      return Promise.all(nodes.map(async node => {
        if (node.type === "Folder" && node.children) {
          return {
            ...node,
            children: await fetchTree(node.children)
          };
        } else if (node.type === "Wireframe" && node.url) {
          // 拼接页面url
          const htmlUrl = new URL(node.url, processedUrl).href;
          let htmlContent = "";
          try {
            const htmlResp = await axios.get(htmlUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              },
            });
            htmlContent = htmlReduce(htmlResp.data);
          } catch (e) {
            htmlContent = `获取失败: ${e}`;
          }
          return {
            ...node,
            content: htmlContent
          };
        } else {
          return node;
        }
      }));
    }

    const treeWithContent = await fetchTree(rootNodes);

    return { success: true, tree: treeWithContent };
  } catch (e) {
    return { success: false, error: `获取document.js或解析失败：${e}` };
  }
}

/**
 * 精简和处理HTML字符串
 * @param {string} htmlStr - 原始HTML字符串
 * @param {string} [url] - 可选，页面URL，用于修正img的src
 * @returns {string} 处理后的HTML字符串
 */
function htmlReduce(htmlStr: string) {
  // 1. 合并多余空白
  htmlStr = htmlStr.replace(/\s+/g, " ").trim();
  // 2. 删除<script>标签及内容
  htmlStr = htmlStr.replace(/<script\b[^>]*>.*?<\/script>/gi, "");

  return htmlStr;
}

// 假设 jsContent 是 document.js 的内容（字符串）
function getCreatorResult(jsContent: string) {
  // 提取 (function() { ... })() 结构
  const funcMatch = jsContent.match(/\(\s*function\s*\(\)\s*\{[\s\S]*?return _creator\(\);\s*\}\s*\)\s*\(\s*\)/);
  if (!funcMatch) throw new Error("未找到 function() { ... }() 结构");
  const funcStr = funcMatch[0];
  // 用 vm 执行
  const script = new vm.Script(funcStr);
  return script.runInNewContext();
}

// 智能选择工具：默认 fetch_prd，若 prompt 包含"全部""所有""整体"则用 fetch_html_with_content
server.tool(
  "smart_fetch_prd",
  "智能选择获取PRD内容的方式，默认优先 fetch_prd，若 prompt 包含'全部''所有''整体'等关键词则 fetch_html_with_content",
  {
    url: z.string().describe("PRD文档URL"),
    prompt: z.string().describe("用户需求描述或提示词")
  },
  async ({ url, prompt }) => {
    // 关键词判断
    const keywords = ["全部", "所有", "整体"];
    const useAll = keywords.some(k => prompt.includes(k));
    if (useAll) {
      // 调用 fetchHtmlWithContentImpl
      const result = await fetchHtmlWithContentImpl(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
            mimeType: "text/plain",
          },
        ],
      };
    } else {
      // 复用 fetch_prd 逻辑
      let processedUrl = url;
      if (url.includes("#")) {
        const baseUrl = url.split("#")[0];
        const params = new URLSearchParams(url.split("#")[1]);
        const pageName = params.get("p");
        if (pageName) {
          processedUrl = `${baseUrl}${pageName}.html`;
        }
      }
      try {
        const response = await axios.get(processedUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        });
        const htmlStr = htmlReduce(response.data);
        return {
          content: [
            {
              type: "text",
              text: htmlStr,
              mimeType: "text/html",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: "获取PRD内容失败：" + (error as any).message,
              mimeType: "text/plain",
            },
          ],
        };
      }
    }
  }
);

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);

// 获取当前页面内容
async function fetchPrd(url: string) {
  let processedUrl = url;
  let pageName = "";
  if (url.includes("#")) {
    const baseUrl = url.split("#")[0];
    const params = new URLSearchParams(url.split("#")[1]);
    pageName = params.get("p") || "";
    if (pageName) {
      processedUrl = `${baseUrl}${pageName}.html`;
    }
  }

  try {
    const response = await axios.get(processedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const htmlStr = htmlReduce(response.data);

    // 获取页面截图
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.goto(processedUrl, { waitUntil: "networkidle0" });
      await page.setViewport({ width: 1920, height: 1080 });
      
      // 生成文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${getSafeFileName(pageName || "page")}_${timestamp}.png`;
      const screenshotPath = path.join(screenshotsDir, fileName);
      
      // 保存截图
      const tempPath = `./temp_${timestamp}.png` as const;
      await page.screenshot({
        path: tempPath,
        fullPage: true
      });

      // 移动文件到目标路径
      await fs.rename(tempPath, screenshotPath);
      await page.close();

      return {
        html: htmlStr,
        screenshot: screenshotPath
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      html: "获取PRD内容失败：" + (error as any).message,
      screenshot: ""
    };
  }
}

// 本地调试时直接调用 node build/index.js
// (async () => {
//   const result = await fetchHtmlWithContentImpl(
//     "https://prd-upload-pub.yishouapp.com/prd/BaoBan/4.61.0/#id=deh674&p=%E6%AC%A0%E8%B4%A7%E6%98%8E%E7%BB%86%E6%96%B0%E5%A2%9E%E5%AD%97%E6%AE%B5-%E5%AD%90%E5%8C%A0&g=1"
//   );
//   console.log(result);
// })();