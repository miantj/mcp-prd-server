// handlers.ts
// 所有异步处理函数，原本在index.ts
import axios from "axios";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { projectNameMap, config } from "./config.js";
import {
  projectList,
  isValidProject,
  getAllVersionsOfProject,
  isValidVersion,
  htmlReduce,
  getCreatorResult,
} from "./utils.js";

// 浏览器实例管理器
class BrowserManager {
  private static instance: BrowserManager;
  private browser: puppeteer.Browser | null = null;
  private isInitializing = false;
  private initPromise: Promise<puppeteer.Browser> | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser) {
      return this.browser;
    }

    if (this.isInitializing) {
      return this.initPromise!;
    }

    this.isInitializing = true;
    this.initPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-features=HttpsFirstBalancedModeAutoEnable",
        "--disable-dev-shm-usage", // 减少内存使用
        "--disable-gpu", // 禁用GPU加速
        "--no-first-run", // 跳过首次运行设置
        "--no-default-browser-check", // 跳过默认浏览器检查
      ],
    });

    try {
      this.browser = await this.initPromise;
      console.log("浏览器实例已启动");
      return this.browser;
    } catch (error) {
      this.isInitializing = false;
      this.initPromise = null;
      throw error;
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isInitializing = false;
      this.initPromise = null;
      console.log("浏览器实例已关闭");
    }
  }

  async createPage(): Promise<puppeteer.Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    
    // 设置页面性能优化
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    
    // 拦截不必要的资源请求以提高性能
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 修改 navigator.webdriver
    await page.evaluateOnNewDocument(() => {
      delete Object.getPrototypeOf(navigator).webdriver;
    });

    return page;
  }
}

// 类型声明
interface ProjectVersionResult {
  valid?: boolean;
  html: string;
  screenshot: string;
}

// 检查URL是否为有效的项目和版本
async function isProjectVersions(
  url: string
): Promise<ProjectVersionResult | void> {
  let project = "";
  let version = "";
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split("/").filter(Boolean);
    project = parts[0] || "";
    version = parts[1] || "";
  } catch (e: any) {
    return {
      valid: false,
      html: `URL 解析失败: ${e.message}`,
      screenshot: "",
    };
  }
  if (!project || !isValidProject(project)) {
    return {
      html: `没有这个项目：${project}。可用项目有：${projectList.join("、")}`,
      screenshot: "",
    };
  }
  if (!version || !isValidVersion(project, version)) {
    return {
      html: `项目 ${project} 没有这个版本：${version}。可用版本有：${getAllVersionsOfProject(
        project
      ).join("、")}`,
      screenshot: "",
    };
  }
  // 仅日志输出
  console.log("project", project);
  console.log("version", version);
}

// 获取当前页面内容
async function fetchPrd(
  url: string
): Promise<{ html: string; screenshot: string }> {
  // const isProjectVersionsResult = await isProjectVersions(url);
  // if (isProjectVersionsResult) {
  //   return isProjectVersionsResult;
  // }
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
  console.log("processedUrl", processedUrl);
  try {
    const response = await axios.get(processedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const htmlStr = htmlReduce(response.data);
    console.log("htmlStr", htmlStr);
    // 获取页面截图
    const browserManager = BrowserManager.getInstance();
    const page = await browserManager.createPage();
    try {
      await page.goto(processedUrl, {
        waitUntil: "domcontentloaded", // 使用更快的等待条件
        timeout: 15000, // 减少超时时间
      });
      
      // 直接获取base64截图数据
      const screenshot = await page.screenshot({
        encoding: "base64",
        fullPage: true,
        type: "png",
      });
      
      // 如果开启了保存截图功能，保存图片到本地
      if (config.saveScreenshot) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const urlHash = Buffer.from(url).toString("base64").substring(0, 10);
        const filename = `screenshot-${timestamp}-${urlHash}.png`;
        const filepath = path.join(config.screenshotDir, filename);
        await fs.promises.writeFile(
          filepath,
          Buffer.from(screenshot, "base64")
        );
        console.log(`Screenshot saved to: ${filepath}`);
      }
      
      return {
        html: htmlStr,
        screenshot: screenshot as string, // 直接返回base64字符串，不添加data URL前缀
      };
    } finally {
      await page.close();
    }
  } catch (error: any) {
    return {
      html: "获取PRD内容失败：" + error.message,
      screenshot: "",
    };
  }
}

// 1. 获取全部页面内容，并返回树形结构
async function fetchHtmlWithContentImpl(url: string): Promise<any> {
  const isProjectVersionsResult = await isProjectVersions(url);
  if (isProjectVersionsResult) {
    return isProjectVersionsResult;
  }
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
      return Promise.all(
        nodes.map(async (node: any) => {
          if (node.type === "Folder" && node.children) {
            return {
              ...node,
              children: await fetchTree(node.children),
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
            } catch (e: any) {
              htmlContent = `获取失败: ${e}`;
            }
            return {
              ...node,
              content: htmlContent,
            };
          } else {
            return node;
          }
        })
      );
    }
    const treeWithContent = await fetchTree(rootNodes);
    return { success: true, tree: treeWithContent };
  } catch (e: any) {
    return { success: false, error: `获取document.js或解析失败：${e}` };
  }
}

// 新增：爬取 http://192.168.1.244:7777/{project}/ 下全部版本页面内容（只返回 html，不递归）
async function fetchProjectVersions(
  project: string
): Promise<{ html: string }> {
  if (!isValidProject(project)) {
    return {
      html: `没有这个项目：${project}。可用项目有：${projectList.join("、")}`,
    };
  }
  const url = `http://192.168.1.244:7777/${project}/`;
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    return { html: htmlReduce(response.data) };
  } catch (error: any) {
    return {
      html: `获取${project}项目全部版本页面失败：` + error.message,
    };
  }
}

// 新增：爬取 http://192.168.1.244:7777/ 首页内容
async function fetchAllProjects(): Promise<{ html: string }> {
  const url = "http://192.168.1.244:7777/";
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    // 处理响应内容
    let html = htmlReduce(response.data);
    // 添加项目映射信息到响应中
    const projectMappingScript = `
      <script type="application/json" id="project-name-mapping">
        ${JSON.stringify(projectNameMap)}
      </script>
    `;
    html = html.replace("</body>", `${projectMappingScript}</body>`);
    return { html };
  } catch (error: any) {
    return { html: "获取首页内容失败：" + error.message };
  }
}

// 定时爬取所有项目和版本并保存为JSON
async function fetchAndSaveAllPrd(): Promise<void> {
  // 1. 获取项目列表页HTML
  const url = "http://192.168.1.244:7777/";
  let html = "";
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    html = res.data;
  } catch (e: any) {
    console.error("获取项目列表页失败：", e);
    return;
  }
  // 2. 提取所有项目文件夹名（过滤掉 ..）
  const matches = [...html.matchAll(/<a href="([^\/?#]+)\//g)];
  let projectNames = matches.map((m) => m[1]).filter((name) => name !== "..");
  // 3. 保存为 JSON 文件
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const savePath = path.join(dataDir, "project_list.json");
  fs.writeFileSync(savePath, JSON.stringify(projectNames, null, 2), "utf-8");
  console.log("已保存项目列表到", savePath);
  // 4. 递归抓取每个项目下的所有版本目录（过滤掉 ..）
  const allVersions: Record<string, any[]> = {};
  for (const project of projectNames) {
    try {
      const projectUrl = `http://192.168.1.244:7777/${project}/`;
      const res = await axios.get(projectUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
      const projectHtml = res.data;
      const versionMatches = [
        ...projectHtml.matchAll(/<a href="([^\/?#]+)\//g),
      ];
      const versionNames = versionMatches
        .map((m) => m[1])
        .filter((v) => v !== "..");
      
      // 为每个版本获取url和首页内容 - 使用浏览器管理器和并发限制
      const versionsWithContent = [];
      const browserManager = BrowserManager.getInstance();
      
      // 限制并发数量，避免系统负载过高
      const concurrencyLimit = 3;
      for (let i = 0; i < versionNames.length; i += concurrencyLimit) {
        const batch = versionNames.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(
          batch.map(async (version) => {
            const versionUrl = `http://192.168.1.244:7777/${project}/${version}/`;
            let versionContent = "";
            try {
              const page = await browserManager.createPage();
              try {
                // 设置更短的超时时间
                await page.goto(versionUrl, {
                  waitUntil: "domcontentloaded", // 改为更快的等待条件
                  timeout: 15000, // 减少超时时间
                });
                
                // 等待页面渲染完成
                await new Promise(resolve => setTimeout(resolve, 1000)); // 减少等待时间
                
                // 获取渲染后的纯文本内容
                versionContent = await page.evaluate(() => {
                  // 移除script和style标签
                  const scripts = document.querySelectorAll('script, style');
                  scripts.forEach(script => script.remove());
                  
                  // 获取纯文本内容
                  return document.body ? document.body.innerText : document.documentElement.innerText;
                });
              } finally {
                await page.close();
              }
            } catch (e: any) {
              console.error(`获取项目 ${project} 版本 ${version} 内容失败：`, e);
              versionContent = `获取失败: ${e.message}`;
            }
            
            return {
              name: version,
              url: versionUrl,
              content: versionContent
            };
          })
        );
        versionsWithContent.push(...batchResults);
        
        // 添加进度日志
        console.log(`项目 ${project}: 已完成 ${Math.min(i + concurrencyLimit, versionNames.length)}/${versionNames.length} 个版本`);
      }
      
      allVersions[project] = versionsWithContent;
    } catch (e: any) {
      console.error(`获取项目 ${project} 版本目录失败：`, e);
      allVersions[project] = [];
    }
  }
  const versionSavePath = path.join(dataDir, "project_versions.json");
  fs.writeFileSync(
    versionSavePath,
    JSON.stringify(allVersions, null, 2),
    "utf-8"
  );
  console.log("已保存所有项目版本到", versionSavePath);
}

// 清理函数，用于应用退出时关闭浏览器实例
async function cleanupBrowser(): Promise<void> {
  const browserManager = BrowserManager.getInstance();
  await browserManager.closeBrowser();
}

export {
  isProjectVersions,
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  fetchAndSaveAllPrd,
  cleanupBrowser,
};
