import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { URL } from "url";
import vm from "vm";
import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import path from "path";

// 配置
const CONFIG = {
  name: "PRD-Server",
  version: "1.0.0",
  browserOptions: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
  viewport: { width: 1920, height: 1080 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
};

// 工具函数
const utils = {
  // 确保截图目录存在
  async ensureScreenshotsDir() {
    const screenshotsDir = path.join(process.cwd(), "screenshots");
    try {
      await fs.access(screenshotsDir);
    } catch {
      await fs.mkdir(screenshotsDir, { recursive: true });
    }
    return screenshotsDir;
  },

  // 获取安全的文件名
  getSafeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "_");
  },

  // 生成文件名
  generateFileName(baseName: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = this.getSafeFileName(baseName);
    return `${safeName}_${timestamp}.png`;
  },

  // 处理HTML内容
  reduceHtml(htmlStr: string): string {
    return htmlStr
      .replace(/\s+/g, " ")
      .trim()
      .replace(/<script\b[^>]*>.*?<\/script>/gi, "");
  },

  // 处理URL
  processUrl(url: string): { processedUrl: string; pageName: string } {
    let processedUrl = url;
    let pageName = "";

    if (url.includes("#")) {
      const baseUrl = url.split("#")[0];
      const params = new URLSearchParams(url.split("#")[1]);
      const pageName = params.get("p");
      if (pageName) {
        processedUrl = `${baseUrl}${pageName}.html`;
      }
    }
    console.log(processedUrl, pageName);
    return { processedUrl, pageName };
  },

  // 解析document.js
  parseCreatorResult(jsContent: string) {
    const funcMatch = jsContent.match(
      /\(\s*function\s*\(\)\s*\{[\s\S]*?return _creator\(\);\s*\}\s*\)\s*\(\s*\)/
    );
    if (!funcMatch) throw new Error("未找到 function() { ... }() 结构");
    const script = new vm.Script(funcMatch[0]);
    return script.runInNewContext();
  },
};

// PRD服务类
class PrdService {
  private browser: any = null;

  constructor() {
    utils.ensureScreenshotsDir();
  }

  // 获取浏览器实例
  private async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch(CONFIG.browserOptions);
    }
    return this.browser;
  }

  // 关闭浏览器
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // 获取页面截图
  private async captureScreenshot(
    page: any,
    nodeName: string
  ): Promise<string> {
    await page.setViewport(CONFIG.viewport);

    const fileName = utils.generateFileName(nodeName || "page");
    const screenshotsDir = await utils.ensureScreenshotsDir();
    const screenshotPath = path.join(screenshotsDir, fileName);
    const tempPath = `./${fileName}`;

    await page.screenshot({ path: tempPath, fullPage: true });
    await fs.rename(tempPath, screenshotPath);
    return screenshotPath;
  }

  // 获取document.js
  private async fetchDocumentJs(url: string) {
    const jsUrl = new URL("data/document.js", url).href;
    const response = await axios.get(jsUrl, {
      headers: { "User-Agent": CONFIG.userAgent },
    });
    return utils.parseCreatorResult(response.data);
  }

  // 递归获取树形结构
  private async fetchTree(nodes: any[], baseUrl: string): Promise<any[]> {
    const browser = await this.getBrowser();

    return await Promise.all(
      nodes.map(async (node) => {
        if (node.type === "Folder" && node.children) {
          return {
            ...node,
            children: await this.fetchTree(node.children, baseUrl),
          };
        } else if (node.type === "Wireframe" && node.url) {
          const htmlUrl = new URL(node.url, baseUrl).href;
          let htmlContent = "";
          let screenshotPath = "";

          try {
            const htmlResp = await axios.get(htmlUrl, {
              headers: { "User-Agent": CONFIG.userAgent },
            });
            htmlContent = utils.reduceHtml(htmlResp.data);

            const page = await browser.newPage();
            await page.goto(htmlUrl, { waitUntil: "networkidle0" });
            screenshotPath = await this.captureScreenshot(page, node.name);
            await page.close();
          } catch (error) {
            htmlContent = `获取失败: ${error}`;
          }

          return { ...node, content: htmlContent, screenshot: screenshotPath };
        } else {
          return node;
        }
      })
    );
  }

  // 获取全部内容
  async fetchAllContent(url: string) {
    try {
      const { processedUrl } = utils.processUrl(url);
      const creatorResult = await this.fetchDocumentJs(processedUrl);
      const treeWithContent = await this.fetchTree(
        creatorResult.sitemap.rootNodes,
        processedUrl
      );
      return { success: true, tree: treeWithContent };
    } catch (error) {
      return { success: false, error: `获取失败：${error}` };
    }
  }

  // 获取单个页面
  async fetchSinglePage(url: string) {
    const { processedUrl, pageName } = utils.processUrl(url);

    try {
      const response = await axios.get(processedUrl, {
        headers: { "User-Agent": CONFIG.userAgent },
      });
      const htmlStr = utils.reduceHtml(response.data);

      const browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.goto(processedUrl, { waitUntil: "networkidle0" });
      const screenshotPath = await this.captureScreenshot(page, pageName);
      await page.close();

      return { html: htmlStr, screenshot: screenshotPath };
    } catch (error) {
      return {
        html: "获取PRD内容失败：" + (error as any).message,
        screenshot: "",
      };
    }
  }

  // 智能选择
  async smartFetch(url: string, prompt: string) {
    const keywords = ["全部", "所有", "整体"];
    const useAll = keywords.some((k) => prompt.includes(k));

    if (useAll) {
      return await this.fetchAllContent(url);
    } else {
      return await this.fetchSinglePage(url);
    }
  }
}

// 创建MCP服务器
const server = new McpServer({
  name: CONFIG.name,
  version: CONFIG.version,
});

// 创建PRD服务实例
const prdService = new PrdService();

// 注册工具
server.tool(
  "smart_fetch_prd",
  "智能选择获取PRD内容的方式，默认优先 fetch_prd，若 prompt 包含'全部''所有''整体'等关键词则 fetch_html_with_content",
  {
    url: z.string().describe("PRD文档URL"),
    prompt: z.string().describe("用户需求描述或提示词"),
  },
  async ({ url, prompt }) => {
    try {
      const result = await prdService.smartFetch(url, prompt);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
            mimeType: "text/plain",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `处理失败: ${error}`,
            }),
            mimeType: "text/plain",
          },
        ],
      };
    }
  }
);

// 启动服务器
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // 设置进程退出时的清理
    process.on("SIGINT", async () => {
      await prdService.closeBrowser();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await prdService.closeBrowser();
      process.exit(0);
    });

    console.log("PRD MCP Server started successfully");
  } catch (error) {
    console.error("Failed to start PRD MCP Server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

// 本地调试时直接调用 node build/index.js
(async () => {
  const prdService = new PrdService();
  try {
    const result = await prdService.fetchSinglePage(
      "https://prd-upload-pub.yishouapp.com/prd/ERP/cd6638/#id=9mi7xg&p=%E8%B4%A8%E6%A3%80%E6%AC%A1%E5%93%81%E7%B1%BB%E5%9E%8B&g=1"
    );
    console.log(result);
  } finally {
    await prdService.closeBrowser();
  }
})();
