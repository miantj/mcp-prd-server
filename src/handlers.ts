// handlers.ts
// 所有异步处理函数，原本在index.ts
import axios from "axios";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import {
  projectNameMap,
  config,
  dataDir,
  documentIndexPath,
  projectVersionsPath,
  serverRootDir,
} from "./config.js";
import {
  projectList,
  isValidProject,
  getAllVersionsOfProject,
  isValidVersion,
  htmlReduce,
  getCreatorResult,
  resolveAxurePageUrl,
} from "./utils.js";

const systemChromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function resolveChromeExecutablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  try {
    const puppeteerExecutablePath = puppeteer.executablePath();
    if (fs.existsSync(puppeteerExecutablePath)) {
      return puppeteerExecutablePath;
    }
  } catch {
    // Puppeteer can throw before the browser is installed; fall back below.
  }

  return systemChromePaths.find((chromePath) => fs.existsSync(chromePath));
}

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
      try {
        // 简单检查浏览器是否仍然连接
        await this.browser.pages();
        return this.browser;
      } catch (error) {
        console.log("浏览器连接已断开，重新启动...");
        this.browser = null;
        this.isInitializing = false;
        this.initPromise = null;
      }
    }

    if (this.isInitializing) {
      return this.initPromise!;
    }

    this.isInitializing = true;
    const executablePath = resolveChromeExecutablePath();
    this.initPromise = puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
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
      console.error("浏览器启动失败:", error);
      throw error;
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log("浏览器实例已关闭");
      } catch (error) {
        console.error("关闭浏览器时出错:", error);
      } finally {
        this.browser = null;
        this.isInitializing = false;
        this.initPromise = null;
      }
    }
  }

  async createPage(): Promise<puppeteer.Page> {
    const browser = await this.getBrowser();
    let page: puppeteer.Page | null = null;

    try {
      page = await browser.newPage();

      // 设置页面性能优化
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setRequestInterception(true);

      // 减少资源拦截的严格程度，只拦截不必要的资源
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        // 只拦截一些不必要的资源，保留样式表以确保页面正确渲染
        if (["font", "media"].includes(resourceType)) {
          // 对于图片、字体和媒体文件，只拦截外部资源，保留本地资源
          if (url.startsWith("http") && !url.includes(config.prdHost)) {
            req.abort();
          } else {
            req.continue();
          }
        } else {
          req.continue();
        }
      });

      // 修改 navigator.webdriver
      await page.evaluateOnNewDocument(() => {
        delete Object.getPrototypeOf(navigator).webdriver;
      });

      return page;
    } catch (error) {
      // 如果页面创建失败，确保清理资源
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.error("关闭页面时出错:", closeError);
        }
      }
      throw error;
    }
  }
}

// 类型声明
interface ProjectVersionResult {
  valid?: boolean;
  html: string;
  screenshot: string;
}

// 文档索引接口
interface DocumentIndex {
  project: string;
  version: string;
  url: string;
  title: string;
  keywords: string[];
  summary: string;
  lastModified: string;
  pages: Array<{
    name: string;
    url: string;
  }>; // 页面列表
}

// 搜索结果接口
interface SearchResult {
  project: string;
  version: string;
  url: string;
  title: string;
  summary: string;
  relevance: number; // 相关性评分
  matchType: "exact" | "keyword" | "fuzzy" | "semantic";
  matchedKeywords: string[];
  pages: Array<{
    name: string;
    url: string;
  }>; // 页面列表
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

/** 等待 Axure 线框正文出现（避免截到空壳/未渲染页） */
async function waitForAxureContent(page: puppeteer.Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        // 播放器壳页几乎只有 CLOSE / Share Prototype；线框页会有中文或业务文案
        const shellOnly =
          text.length < 40 &&
          /CLOSE|Share Prototype|Local Preview/i.test(text) &&
          !/[\u4e00-\u9fa5]/.test(text);
        if (shellOnly) return false;
        const hasWidget = !!document.querySelector(
          "#base, .ax_default, [data-label], img"
        );
        return hasWidget || text.length > 30;
      },
      { timeout: 15000 }
    );
  } catch {
    // 超时仍继续截图，避免整页失败
  }
  // 图片/字体再等一拍
  await new Promise((resolve) => setTimeout(resolve, 800));
}

// 获取当前页面内容
async function fetchPrd(
  url: string
): Promise<{ html: string; screenshot: string; screenshotPath: string }> {
  // 关键：只解析 #p=，新版分享链是 ?p=，会落到空 iframe 壳页 → 黑图
  const processedUrl = resolveAxurePageUrl(url);
  console.log("processedUrl", processedUrl);

  let page: puppeteer.Page | null = null;
  let htmlStr = "";
  try {
    const response = await axios.get(processedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      timeout: 15000,
    });
    htmlStr = htmlReduce(response.data);
    console.log("htmlStr", htmlStr);

    // 截图失败不阻断 HTML 返回：Axure 常有常驻连接，networkidle0 易超时
    let screenshotBase64 = "";
    let screenshotPath = "";
    try {
      const browserManager = BrowserManager.getInstance();
      page = await browserManager.createPage();

      // Axure 原型常保持 1～2 条连接，networkidle0 几乎必超时；networkidle2 实测可用
      await page.goto(processedUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
      await waitForAxureContent(page);

      // 透明背景在深色 IDE 里会被看成黑图；强制白底
      await page.evaluate(() => {
        document.documentElement.style.background = "#ffffff";
        if (document.body) document.body.style.background = "#ffffff";
      });

      const screenshot = await page.screenshot({
        encoding: "base64",
        fullPage: true,
        type: "png",
        omitBackground: false,
      });
      screenshotBase64 =
        typeof screenshot === "string"
          ? screenshot
          : (screenshot as Buffer).toString("base64");

      // 线框页静态 HTML 常几乎无文案，补一段渲染后正文供 Agent 读
      try {
        const renderedText = await page.evaluate(() =>
          (document.body?.innerText || "").replace(/\s+/g, "\n").trim()
        );
        if (renderedText && renderedText.length > 20) {
          htmlStr = `${htmlStr}\n<!-- axure-rendered-text -->\n${renderedText}`;
        }
      } catch {
        // ignore
      }

      // 落盘：Cursor 将大 MCP 结果写入 agent-tools/*.txt 时会丢掉 image 块，路径写在文本里可被 Read 读回
      if (config.saveScreenshot) {
        const dir = path.isAbsolute(config.screenshotDir)
          ? config.screenshotDir
          : path.join(serverRootDir, config.screenshotDir);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const urlHash = Buffer.from(url).toString("base64").substring(0, 10);
        const filename = `screenshot-${timestamp}-${urlHash}.png`;
        screenshotPath = path.join(dir, filename);
        await fs.promises.writeFile(
          screenshotPath,
          Buffer.from(screenshotBase64, "base64")
        );
        console.log(`Screenshot saved to: ${screenshotPath}`);
      }
    } catch (screenshotError: any) {
      console.error("PRD 截图失败（HTML 仍返回）:", screenshotError);
      if (
        screenshotError?.message &&
        screenshotError.message.includes("Protocol error: Connection closed")
      ) {
        console.log("检测到浏览器连接错误，尝试重新初始化...");
        const browserManager = BrowserManager.getInstance();
        await browserManager.closeBrowser();
      }
    }

    return {
      html: htmlStr,
      screenshot: screenshotBase64,
      screenshotPath,
    };
  } catch (error: any) {
    console.error("获取PRD内容失败:", error);

    // 如果是连接错误，尝试重新初始化浏览器
    if (
      error.message &&
      error.message.includes("Protocol error: Connection closed")
    ) {
      console.log("检测到浏览器连接错误，尝试重新初始化...");
      const browserManager = BrowserManager.getInstance();
      await browserManager.closeBrowser();
    }

    return {
      // axios 已成功时优先返回 HTML，避免截图/导航问题吞掉正文
      html: htmlStr || "获取PRD内容失败：" + (error.message || error),
      screenshot: "",
      screenshotPath: "",
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.error("关闭页面时出错:", closeError);
      }
    }
  }
}

// 1. 获取全部页面内容，并返回树形结构
async function fetchHtmlWithContentImpl(url: string): Promise<any> {
  // document.js 相对版本目录；resolve 到线框页后再取目录
  const pageUrl = resolveAxurePageUrl(url);
  let processedUrl = pageUrl;
  try {
    const u = new URL(pageUrl);
    if (/\.html?$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/[^/]+$/, "");
      u.search = "";
      u.hash = "";
      processedUrl = u.href;
    }
  } catch {
    // keep pageUrl
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
              ...(node.children
                ? { children: await fetchTree(node.children) }
                : {}),
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

const PRD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

type PrdFileRecord = {
  project_name: string;
  path_name: string;
  create_time: string;
  prd_link: string;
};

// 从公网列表接口拉取 PRD 记录（按创建时间倒序）；monthsToLoad>0 时提前停
async function fetchPrdFileRecords(options?: {
  projectName?: string;
  monthsToLoad?: number;
}): Promise<PrdFileRecord[]> {
  const { projectName, monthsToLoad = 0 } = options || {};
  const pageSize = 100;
  const all: PrdFileRecord[] = [];
  let page = 1;
  const monthsAgo = new Date();
  if (monthsToLoad > 0) {
    monthsAgo.setMonth(monthsAgo.getMonth() - monthsToLoad);
  }

  while (true) {
    const res = await axios.get(config.prdListApi, {
      params: {
        page,
        pageSize,
        ...(projectName ? { projectName } : {}),
      },
      headers: { "User-Agent": PRD_UA },
    });
    const list: PrdFileRecord[] = res.data?.data?.list || [];
    if (list.length === 0) break;

    for (const item of list) {
      if (monthsToLoad > 0 && item.create_time) {
        const t = new Date(item.create_time.replace(" ", "T"));
        if (!Number.isNaN(t.getTime()) && t < monthsAgo) {
          return all;
        }
      }
      all.push(item);
    }

    const total = res.data?.data?.total ?? 0;
    if (all.length >= total || list.length < pageSize) break;
    page += 1;
  }
  return all;
}

function dedupeLatestVersions(records: PrdFileRecord[]): PrdFileRecord[] {
  const map = new Map<string, PrdFileRecord>();
  for (const r of records) {
    const key = `${r.project_name}/${r.path_name}`;
    if (!map.has(key)) map.set(key, r); // 列表已按时间倒序，首次即最新
  }
  return [...map.values()];
}

/** 旧内网地址 → 公网 prdBaseUrl */
function normalizePrdUrl(url: string): string {
  if (!url) return url;
  return url.replace(
    /^https?:\/\/192\.168\.1\.244:7777\//,
    config.prdBaseUrl
  );
}

function buildNginxStyleLinks(names: string[]): string {
  const links = names
    .map((name) => `<a href="${name}/">${name}/</a>`)
    .join("\n");
  return `<html><body>${links}\n<script type="application/json" id="project-name-mapping">${JSON.stringify(
    projectNameMap
  )}</script></body></html>`;
}

// 爬取 {prdBaseUrl}{project}/ 下全部版本（列表接口）
async function fetchProjectVersions(
  project: string
): Promise<{ html: string }> {
  if (!isValidProject(project)) {
    return {
      html: `没有这个项目：${project}。可用项目有：${projectList.join("、")}`,
    };
  }
  try {
    const records = dedupeLatestVersions(
      await fetchPrdFileRecords({ projectName: project })
    );
    const versions = records.map((r) => r.path_name);
    return { html: htmlReduce(buildNginxStyleLinks(versions)) };
  } catch (error: any) {
    return {
      html: `获取${project}项目全部版本页面失败：` + error.message,
    };
  }
}

// 爬取 PRD 首页项目列表（列表接口）
async function fetchAllProjects(): Promise<{ html: string }> {
  try {
    const records = await fetchPrdFileRecords({ monthsToLoad: 12 });
    const projectNames = [...new Set(records.map((r) => r.project_name))];
    return { html: htmlReduce(buildNginxStyleLinks(projectNames)) };
  } catch (error: any) {
    return { html: "获取首页内容失败：" + error.message };
  }
}

// 定时爬取所有项目和版本并保存为JSON
async function fetchAndSaveAllPrd(options?: {
  monthsToLoad?: number; // 加载最近几个月的文档，默认1个月
}): Promise<void> {
  const {
    monthsToLoad = 1, // 默认加载最近1个月
  } = options || {};

  // 1. 从公网列表接口获取 PRD（已无目录浏览页）
  let records: PrdFileRecord[] = [];
  try {
    records = dedupeLatestVersions(
      await fetchPrdFileRecords({
        // monthsToLoad=0 表示全量；否则只拉最近 N 个月
        monthsToLoad: monthsToLoad > 0 ? monthsToLoad : 0,
      })
    );
  } catch (e: any) {
    console.error("获取项目列表失败：", e);
    return;
  }

  const byProject = new Map<string, PrdFileRecord[]>();
  for (const r of records) {
    const list = byProject.get(r.project_name) || [];
    list.push(r);
    byProject.set(r.project_name, list);
  }
  const projectNames = [...byProject.keys()];

  // 获取所有项目，不进行筛选
  console.log(`获取所有项目：${projectNames.join(", ")}`);

  // 3. 保存为 JSON 文件
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const savePath = path.join(dataDir, "project_list.json");
  fs.writeFileSync(savePath, JSON.stringify(projectNames, null, 2), "utf-8");
  console.log("已保存项目列表到", savePath);

  // 4. 加载现有数据（如果存在）
  const versionSavePath = path.join(dataDir, "project_versions.json");
  let existingVersions: Record<string, any[]> = {};

  if (fs.existsSync(versionSavePath)) {
    try {
      existingVersions = JSON.parse(fs.readFileSync(versionSavePath, "utf-8"));
      console.log(
        `加载现有数据，包含 ${Object.keys(existingVersions).length} 个项目`
      );
    } catch (e) {
      console.error("加载现有数据失败，将创建新文件:", e);
    }
  }

  // 5. 抓取每个项目下的版本内容
  const allVersions: Record<string, any[]> = { ...existingVersions };
  for (const project of projectNames) {
    try {
      const projectRecords = byProject.get(project) || [];
      const versionNames = projectRecords.map((r) => r.path_name);
      const versionTimeMap = new Map(
        projectRecords.map((r) => [r.path_name, r.create_time])
      );
      const versionUrlMap = new Map(
        projectRecords.map((r) => [
          r.path_name,
          r.prd_link.endsWith("/") ? r.prd_link : `${r.prd_link}/`,
        ])
      );

      // 获取所有版本，不进行筛选
      console.log(`项目 ${project}: 获取所有版本：${versionNames.join(", ")}`);

      // 为每个版本获取url和首页内容 - 使用浏览器管理器和并发限制
      const versionsWithContent = [];
      const browserManager = BrowserManager.getInstance();

      // 限制并发数量，避免系统负载过高
      const concurrencyLimit = 3;
      const timeoutMs = 30000; // 30秒超时

      for (let i = 0; i < versionNames.length; i += concurrencyLimit) {
        const batch = versionNames.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.allSettled(
          batch.map(async (version) => {
            const versionUrl =
              versionUrlMap.get(version) ||
              `${config.prdBaseUrl}${project}/${version}/`;
            let versionContent = "";

            // 检查是否需要获取内容（根据时间筛选条件）
            let shouldGetContent = true;

            if (monthsToLoad > 0) {
              // 获取版本时间信息
              const versionTime = versionTimeMap.get(version);
              if (versionTime) {
                shouldGetContent = isWithinLastMonths(
                  versionTime,
                  monthsToLoad
                );
                if (shouldGetContent) {
                  console.log(
                    `✅ 版本 ${version} 在最近 ${monthsToLoad} 个月内 (${versionTime})`
                  );
                }
              } else {
                console.log(`⚠️ 版本 ${version} 没有时间信息，跳过`);
                shouldGetContent = false;
              }
            } else {
              // 当monthsToLoad为0时，获取所有内容
              shouldGetContent = true;
              console.log(`📋 获取所有版本内容，包括 ${version}`);
            }

            if (shouldGetContent) {
              try {
                // 添加超时控制
                const timeoutPromise = new Promise((_, reject) => {
                  setTimeout(
                    () => reject(new Error(`获取版本 ${version} 超时`)),
                    timeoutMs
                  );
                });

                const contentPromise = (async () => {
                  // 参考 fetchHtmlWithContentImpl 方法，获取 document.js 并解析页面结构
                  const jsUrl = new URL("data/document.js", versionUrl).href;
                  const jsResp = await axios.get(jsUrl, {
                    headers: {
                      "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    },
                  });
                  const jsContent = jsResp.data;
                  const rootNodes =
                    getCreatorResult(jsContent).sitemap.rootNodes;

                  // 递归获取所有页面URL（不获取页面内容）
                  async function fetchAllPages(nodes: any[]): Promise<any[]> {
                    return Promise.all(
                      nodes.map(async (node: any) => {
                        if (node.type === "Folder" && node.children) {
                          return {
                            ...node,
                            children: await fetchAllPages(node.children),
                          };
                        } else if (node.type === "Wireframe" && node.url) {
                          // 拼接页面url
                          const htmlUrl = new URL(node.url, versionUrl).href;
                          return {
                            ...node,
                            fullUrl: htmlUrl,
                            ...(node.children
                              ? {
                                  children: await fetchAllPages(node.children),
                                }
                              : {}),
                          };
                        } else {
                          return node;
                        }
                      })
                    );
                  }

                  const pagesWithContent = await fetchAllPages(rootNodes);

                  // 递归提取所有 Wireframe 页面
                  function extractWireframePages(nodes: any[]): any[] {
                    const pages: any[] = [];
                    for (const node of nodes) {
                      if (node.type === "Wireframe" && node.fullUrl) {
                        pages.push({
                          name: node.pageName || node.name || "未命名页面",
                          url: node.fullUrl,
                        });
                      }
                      if (node.children) {
                        pages.push(...extractWireframePages(node.children));
                      }
                    }
                    return pages;
                  }

                  const wireframePages =
                    extractWireframePages(pagesWithContent);

                  // 构建精简的版本内容信息
                  const versionInfo = {
                    project: project,
                    version: version,
                    totalPages: wireframePages.length,
                    pages: wireframePages,
                    lastModified: versionTimeMap.get(version) || null,
                  };

                  return JSON.stringify(versionInfo, null, 2);
                })();

                versionContent = (await Promise.race([
                  contentPromise,
                  timeoutPromise,
                ])) as string;
              } catch (e: any) {
                console.error(
                  `获取项目 ${project} 版本 ${version} document.js 失败：`
                );
                // 如果获取 document.js 失败，回退到原来的页面内容获取方式
                try {
                  const page = await browserManager.createPage();
                  try {
                    await page.goto(versionUrl, {
                      waitUntil: "networkidle2",
                      timeout: 30000,
                    });

                    await new Promise((resolve) => setTimeout(resolve, 1000));

                    versionContent = await page.evaluate(() => {
                      const scripts =
                        document.querySelectorAll("script, style");
                      scripts.forEach((script) => script.remove());

                      let title = document.title || "";
                      if (
                        !title ||
                        title === "Untitled Document" ||
                        title === "Document"
                      ) {
                        const h1 = document.querySelector("h1");
                        if (h1 && h1.textContent) {
                          title = h1.textContent.trim();
                        } else {
                          const possibleTitles = document.querySelectorAll(
                            'h1, h2, h3, .title, .header, [class*="title"], [class*="header"]'
                          );
                          for (const element of possibleTitles) {
                            const text = element.textContent?.trim();
                            if (text && text.length > 0 && text.length < 100) {
                              title = text;
                              break;
                            }
                          }
                        }
                      }

                      let content = "";
                      if (document.body) {
                        const mainContent =
                          document.querySelector(
                            "main, .main, .content, .container, #content, #main"
                          ) || document.body;
                        const walker = document.createTreeWalker(
                          mainContent,
                          NodeFilter.SHOW_TEXT,
                          {
                            acceptNode: function (node) {
                              const parent = node.parentElement;
                              if (!parent) return NodeFilter.FILTER_REJECT;

                              const style = window.getComputedStyle(parent);
                              if (
                                style.display === "none" ||
                                style.visibility === "hidden"
                              ) {
                                return NodeFilter.FILTER_REJECT;
                              }

                              if (
                                parent.tagName === "SCRIPT" ||
                                parent.tagName === "STYLE"
                              ) {
                                return NodeFilter.FILTER_REJECT;
                              }

                              if (
                                parent.closest(
                                  "nav, .nav, .navigation, .toolbar, .header, .footer"
                                )
                              ) {
                                return NodeFilter.FILTER_REJECT;
                              }

                              return NodeFilter.FILTER_ACCEPT;
                            },
                          }
                        );

                        const textNodes = [];
                        let node;
                        while ((node = walker.nextNode())) {
                          const text = node.textContent?.trim();
                          if (text && text.length > 0) {
                            const uselessPatterns = [
                              /^(CLOSE|Local Preview|Share Prototype|Show Note Markers|Show Hotspots|Default Scale|Scale to Width|Scale to Fit|Use|and|keys|to move between pages|No notes for this page|Notes added in Axure RP will appear here)$/,
                              /^\(\d+ of \d+\)$/,
                              /^\(\d+ x \w+\)$/,
                              /^\(\w+ x \w+\)$/,
                              /^(Pages|Adaptive)$/,
                              /^[A-Z\s]+$/,
                              /^\d+$/,
                              /^[^\u4e00-\u9fa5a-zA-Z0-9]+$/,
                            ];

                            const isUseless = uselessPatterns.some((pattern) =>
                              pattern.test(text)
                            );
                            if (!isUseless && text.length > 1) {
                              textNodes.push(text);
                            }
                          }
                        }

                        content = textNodes.join("\n");
                      }

                      if (!content) {
                        content = document.body
                          ? document.body.innerText
                          : document.documentElement.innerText;
                      }

                      let result = "";
                      if (title) {
                        result += `标题: ${title}\n\n`;
                      }

                      if (content) {
                        const sections = content
                          .split("\n")
                          .filter((line) => line.trim().length > 0)
                          .filter((line) => {
                            const trimmed = line.trim();
                            return (
                              trimmed.length > 2 &&
                              !trimmed.match(/^[^\u4e00-\u9fa5a-zA-Z0-9]+$/) &&
                              !trimmed.match(/^[A-Z\s]+$/) &&
                              !trimmed.match(/^\d+$/) &&
                              !trimmed.match(/^\(\d+ of \d+\)$/) &&
                              !trimmed.match(/^\(\d+ x \w+\)$/) &&
                              !trimmed.match(/^(Pages|Adaptive|CLOSE)$/)
                            );
                          });

                        if (sections.length > 0) {
                          result += `页面内容:\n`;
                          sections.forEach((section, index) => {
                            result += `${index + 1}. ${section}\n`;
                          });
                        }
                      }

                      return result || "无内容";
                    });
                  } finally {
                    await page.close();
                  }
                } catch (pageError: any) {
                  console.error(
                    `获取项目 ${project} 版本 ${version} 页面内容也失败：`,
                    pageError
                  );
                  versionContent = `获取失败: ${e.message}`;
                }
              }
            } else {
              // 如果不需要获取内容，只保存基本信息
              versionContent = "";
            }

            return {
              name: version,
              url: normalizePrdUrl(versionUrl),
              content: versionContent || version,
              lastModified: versionTimeMap.get(version) || null,
              pages:
                versionContent && versionContent.startsWith("{")
                  ? (() => {
                      try {
                        const parsed = JSON.parse(versionContent);
                        return parsed.pages || [];
                      } catch {
                        return [];
                      }
                    })()
                  : [],
            };
          })
        );

        // 处理Promise.allSettled的结果
        const processedBatchResults = batchResults.map((result, index) => {
          if (result.status === "fulfilled") {
            return result.value;
          } else {
            console.error(
              `版本 ${versionNames[i + index]} 处理失败:`,
              result.reason
            );
            return {
              name: versionNames[i + index],
              url:
                versionUrlMap.get(versionNames[i + index]) ||
                `${config.prdBaseUrl}${project}/${versionNames[i + index]}/`,
              content: `处理失败: ${result.reason?.message || "未知错误"}`,
              lastModified: versionTimeMap.get(versionNames[i + index]) || null,
              pages: [],
            };
          }
        });

        versionsWithContent.push(...processedBatchResults);

        // 添加进度日志
        console.log(
          `项目 ${project}: 已完成 ${Math.min(
            i + concurrencyLimit,
            versionNames.length
          )}/${versionNames.length} 个版本`
        );
      }

      // 增量更新：合并新获取的版本和现有版本
      const existingProjectVersions = allVersions[project] || [];
      const existingVersionMap = new Map();

      // 创建现有版本的映射
      existingProjectVersions.forEach((version: any) => {
        existingVersionMap.set(version.name, version);
      });

      // 更新或添加新版本
      versionsWithContent.forEach((version: any) => {
        existingVersionMap.set(version.name, version);
      });

      // 转换回数组
      allVersions[project] = Array.from(existingVersionMap.values());

      console.log(
        `项目 ${project}: 更新后共有 ${allVersions[project].length} 个版本`
      );
    } catch (e: any) {
      console.error(`获取项目 ${project} 版本目录失败：`);
      allVersions[project] = [];
    }
  }

  // 统计更新结果
  const totalProjects = Object.keys(allVersions).length;
  const totalVersions = Object.values(allVersions).reduce(
    (sum: number, versions: any[]) => sum + versions.length,
    0
  );
  const originalVersions = Object.values(existingVersions).reduce(
    (sum: number, versions: any[]) => sum + versions.length,
    0
  );
  const newVersions = totalVersions - originalVersions;

  fs.writeFileSync(
    versionSavePath,
    JSON.stringify(allVersions, null, 2),
    "utf-8"
  );
  console.log(`已保存所有项目版本到 ${versionSavePath}`);
  console.log(
    `更新统计: 项目 ${totalProjects} 个, 版本 ${totalVersions} 个 (新增 ${newVersions} 个)`
  );
  await buildDocumentIndex();
}

// 清理函数，用于应用退出时关闭浏览器实例
async function cleanupBrowser(): Promise<void> {
  const browserManager = BrowserManager.getInstance();
  await browserManager.closeBrowser();
}

// 时间解析函数
function parseTimeString(timeStr: string): Date {
  // 公网列表接口格式: "2026-07-14 16:58:24"
  const apiMatch = timeStr.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (apiMatch) {
    const [, year, month, day, hour, minute, second] = apiMatch;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second || "0")
    );
  }

  // 旧目录页格式如 "19-Apr-2022 16:14"
  const months: { [key: string]: number } = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const match = timeStr.match(
    /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/
  );
  if (!match) {
    throw new Error(`无法解析时间格式: ${timeStr}`);
  }

  const [, day, month, year, hour, minute] = match;
  return new Date(
    parseInt(year),
    months[month],
    parseInt(day),
    parseInt(hour),
    parseInt(minute)
  );
}

// 检查时间是否在最近N个月内
function isWithinLastMonths(timeStr: string, months: number): boolean {
  try {
    const versionDate = parseTimeString(timeStr);
    const monthsAgo = new Date();
    monthsAgo.setMonth(monthsAgo.getMonth() - months);
    return versionDate >= monthsAgo;
  } catch (error) {
    console.warn(`时间解析失败: ${timeStr}`, error);
    return false;
  }
}

// 文档索引管理
class DocumentIndexManager {
  private static instance: DocumentIndexManager;
  private indexes: Map<string, DocumentIndex> = new Map();
  private indexFilePath: string;

  private constructor() {
    this.indexFilePath = documentIndexPath;
  }

  static getInstance(): DocumentIndexManager {
    if (!DocumentIndexManager.instance) {
      DocumentIndexManager.instance = new DocumentIndexManager();
    }
    return DocumentIndexManager.instance;
  }

  // 从现有数据构建索引
  async buildIndexFromExistingData(): Promise<void> {
    console.log("开始从现有数据构建文档索引...");

    try {
      // 读取现有的项目版本数据
      if (!fs.existsSync(projectVersionsPath)) {
        console.error("项目版本数据文件不存在");
        return;
      }

      const projectVersions = JSON.parse(
        fs.readFileSync(projectVersionsPath, "utf-8")
      );
      const indexes: DocumentIndex[] = [];
      let processedCount = 0;
      const totalCount = Object.values(projectVersions).flat().length;

      // 内存管理：限制同时处理的文档数量
      const maxConcurrentDocs = 100;
      let currentBatch: DocumentIndex[] = [];

      // 计算一个月前的时间戳
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      for (const [project, versions] of Object.entries(projectVersions)) {
        for (const version of versions as any[]) {
          try {
            // 解析最后修改时间
            const lastModified = new Date(version.lastModified);
            const isRecent = lastModified > oneMonthAgo;

            // 生成文档标题
            const title = `${project} ${version.name}`;

            // 提取关键词
            const keywords = this.extractKeywords(
              project,
              version.name,
              version.content,
              version.pages
            );

            // 生成摘要
            const summary = this.generateSummary(
              version.content,
              version.pages
            );

            const index: DocumentIndex = {
              project,
              version: version.name,
              url: normalizePrdUrl(version.url),
              title,
              keywords,
              summary,
              lastModified: version.lastModified,
              pages: version.pages,
            };

            currentBatch.push(index);
            this.indexes.set(`${project}-${version.name}`, index);

            processedCount++;

            // 当批次达到最大数量时，保存并清空
            if (currentBatch.length >= maxConcurrentDocs) {
              indexes.push(...currentBatch);
              currentBatch = [];

              // 强制垃圾回收（如果可用）
              if (global.gc) {
                global.gc();
              }
            }

            if (processedCount % 100 === 0) {
              console.log(`已处理 ${processedCount}/${totalCount} 个文档`);
            }
          } catch (error) {
            console.error(`处理文档 ${project}/${version.name} 时出错:`, error);
          }
        }
      }

      // 保存剩余的批次
      if (currentBatch.length > 0) {
        indexes.push(...currentBatch);
      }

      // 保存索引到文件
      await this.saveIndexes(indexes);
      console.log(`文档索引构建完成，共处理 ${indexes.length} 个文档`);
    } catch (error) {
      console.error("构建文档索引失败:", error);
    }
  }

  // 提取关键词
  private extractKeywords(
    project: string,
    version: string,
    content: string,
    pages?: any[]
  ): string[] {
    const keywords = new Set<string>();

    // 添加项目名和版本号
    keywords.add(project.toLowerCase());
    keywords.add(version.toLowerCase());

    // 从内容中提取关键词
    if (content && content.trim()) {
      try {
        // 尝试解析JSON内容
        const contentObj = JSON.parse(content);
        if (contentObj.pages && Array.isArray(contentObj.pages)) {
          // 从页面名称中提取关键词
          contentObj.pages.forEach((page: any) => {
            if (typeof page === "string") {
              // 页面名称是字符串
              const pageName = page.toLowerCase();
              keywords.add(pageName);
              // 提取中文词组
              this.extractChinesePhrases(pageName).forEach((phrase) => {
                keywords.add(phrase);
              });
            } else if (page.name) {
              // 页面名称是对象
              const pageName = page.name.toLowerCase();
              keywords.add(pageName);
              // 提取中文词组
              this.extractChinesePhrases(pageName).forEach((phrase) => {
                keywords.add(phrase);
              });
            }
          });
        }
      } catch (e) {
        // 如果解析失败，按原来的方式处理
        const techKeywords = [
          "api",
          "ui",
          "ux",
          "prd",
          "需求",
          "功能",
          "页面",
          "按钮",
          "表单",
          "列表",
          "搜索",
          "筛选",
          "排序",
          "分页",
          "弹窗",
          "模态",
          "导航",
          "菜单",
          "用户",
          "登录",
          "注册",
          "权限",
          "角色",
          "数据",
          "数据库",
          "缓存",
          "性能",
          "优化",
        ];

        const lowerContent = content.toLowerCase();
        techKeywords.forEach((keyword) => {
          if (lowerContent.includes(keyword)) {
            keywords.add(keyword);
          }
        });
      }

      // 提取项目名称映射中的中文名
      Object.entries(projectNameMap).forEach(([pinyin, chinese]) => {
        if (project.toLowerCase() === pinyin.toLowerCase()) {
          keywords.add(chinese);
        }
      });
    }

    // 从pages字段提取关键词
    if (pages && Array.isArray(pages)) {
      pages.forEach((page: any) => {
        if (page.name) {
          const pageName = page.name.toLowerCase();
          keywords.add(pageName);
          // 提取中文词组
          this.extractChinesePhrases(pageName).forEach((phrase) => {
            keywords.add(phrase);
          });
        }
      });
    }

    return Array.from(keywords);
  }

  // 提取中文词组
  private extractChinesePhrases(text: string): string[] {
    const phrases: string[] = [];
    const chineseWords = text.match(/[\u4e00-\u9fa5]+/g) || [];

    for (const word of chineseWords) {
      if (word.length >= 2) {
        phrases.push(word);
        // 对于较长的中文词组，提取子词组
        if (word.length > 3) {
          for (let i = 0; i <= word.length - 2; i++) {
            for (let j = i + 2; j <= word.length; j++) {
              const subPhrase = word.substring(i, j);
              if (subPhrase.length >= 2) {
                phrases.push(subPhrase);
              }
            }
          }
        }
      }
    }

    return phrases;
  }

  // 生成摘要
  private generateSummary(content: string, pages?: any[]): string {
    if (!content || content.trim() === "") {
      return "暂无内容";
    }

    try {
      // 尝试解析JSON内容
      const contentObj = JSON.parse(content);
      if (contentObj.pages && Array.isArray(contentObj.pages)) {
        // 从页面名称生成摘要
        const pageNames = contentObj.pages
          .map((page: any) => {
            if (typeof page === "string") {
              return page;
            } else if (page.name) {
              return page.name;
            }
            return "";
          })
          .filter((name: string) => name);

        if (pageNames.length > 0) {
          return `包含 ${pageNames.length} 个页面: ${pageNames
            .slice(0, 5)
            .join(", ")}${pageNames.length > 5 ? "..." : ""}`;
        }
      }
    } catch (e) {
      // 如果解析失败，按原来的方式处理
    }

    // 从pages字段生成摘要
    if (pages && Array.isArray(pages)) {
      const pageNames = pages
        .map((page: any) => page.name)
        .filter((name: any) => name);
      if (pageNames.length > 0) {
        return `包含 ${pageNames.length} 个页面: ${pageNames
          .slice(0, 5)
          .join(", ")}${pageNames.length > 5 ? "..." : ""}`;
      }
    }

    // 简单的摘要生成：取前200个字符
    const summary = content.replace(/\s+/g, " ").trim();
    return summary.length > 200 ? summary.substring(0, 200) + "..." : summary;
  }

  // 保存索引到文件
  private async saveIndexes(indexes: DocumentIndex[]): Promise<void> {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(
      this.indexFilePath,
      JSON.stringify(indexes, null, 2),
      "utf-8"
    );
    console.log(`索引已保存到: ${this.indexFilePath}`);
  }

  // 加载索引
  async loadIndexes(): Promise<void> {
    try {
      if (fs.existsSync(this.indexFilePath)) {
        const indexes = JSON.parse(
          fs.readFileSync(this.indexFilePath, "utf-8")
        );
        this.indexes.clear();
        indexes.forEach((index: DocumentIndex) => {
          this.indexes.set(`${index.project}-${index.version}`, index);
        });
        console.log(`已加载 ${this.indexes.size} 个文档索引`);
      }
    } catch (error) {
      console.error("加载文档索引失败:", error);
    }
  }

  // 获取所有索引
  getAllIndexes(): DocumentIndex[] {
    return Array.from(this.indexes.values());
  }

  // 根据关键词搜索
  searchByKeywords(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery
      .split(/\s+/)
      .filter((word) => word.length > 0);

    for (const index of this.indexes.values()) {
      let relevance = 0;
      const matchedKeywords: string[] = [];
      let matchType: "exact" | "keyword" | "fuzzy" | "semantic" = "fuzzy";

      // 精确匹配标题、项目名、版本号
      if (
        index.title.toLowerCase().includes(lowerQuery) ||
        index.project.toLowerCase().includes(lowerQuery) ||
        index.version.toLowerCase().includes(lowerQuery)
      ) {
        relevance += 15;
        matchType = "exact";
        matchedKeywords.push(query);
      }

      // 页面名称匹配（高权重）
      if (index.pages && Array.isArray(index.pages)) {
        for (const page of index.pages) {
          if (page.name) {
            const pageName = page.name.toLowerCase();

            // 完整页面名称匹配
            if (
              pageName.includes(lowerQuery) ||
              lowerQuery.includes(pageName)
            ) {
              relevance += 12;
              if (matchType === "fuzzy") matchType = "keyword";
              if (!matchedKeywords.includes(pageName)) {
                matchedKeywords.push(pageName);
              }
            }

            // 页面名称中的关键词匹配
            for (const queryWord of queryWords) {
              if (
                pageName.includes(queryWord) ||
                queryWord.includes(pageName)
              ) {
                relevance += 8;
                if (matchType === "fuzzy") matchType = "keyword";
                if (!matchedKeywords.includes(queryWord)) {
                  matchedKeywords.push(queryWord);
                }
              }
            }
          }
        }
      }

      // 关键词匹配
      for (const keyword of index.keywords) {
        // 完整关键词匹配
        if (keyword.includes(lowerQuery) || lowerQuery.includes(keyword)) {
          relevance += 10;
          if (matchType === "fuzzy") matchType = "keyword";
          if (!matchedKeywords.includes(keyword)) {
            matchedKeywords.push(keyword);
          }
        }

        // 关键词中的单词匹配
        for (const queryWord of queryWords) {
          if (keyword.includes(queryWord) || queryWord.includes(keyword)) {
            relevance += 6;
            if (matchType === "fuzzy") matchType = "keyword";
            if (!matchedKeywords.includes(keyword)) {
              matchedKeywords.push(keyword);
            }
          }
        }
      }

      // 摘要匹配
      if (index.summary.toLowerCase().includes(lowerQuery)) {
        relevance += 5;
        if (matchType === "fuzzy") matchType = "keyword";
      }

      // 模糊匹配标题和摘要
      if (relevance === 0) {
        for (const queryWord of queryWords) {
          if (
            index.title.toLowerCase().includes(queryWord) ||
            index.summary.toLowerCase().includes(queryWord)
          ) {
            relevance += 2;
          }
        }
      }

      // 中文词组匹配优化
      if (relevance === 0 && /[\u4e00-\u9fa5]/.test(lowerQuery)) {
        // 对于中文查询，尝试更宽松的匹配
        const chineseWords = lowerQuery.match(/[\u4e00-\u9fa5]+/g) || [];
        for (const chineseWord of chineseWords) {
          if (chineseWord.length >= 2) {
            // 至少2个中文字符
            // 在标题中查找
            if (index.title.toLowerCase().includes(chineseWord)) {
              relevance += 4;
              if (!matchedKeywords.includes(chineseWord)) {
                matchedKeywords.push(chineseWord);
              }
            }

            // 在页面名称中查找
            if (index.pages && Array.isArray(index.pages)) {
              for (const page of index.pages) {
                if (
                  page.name &&
                  page.name.toLowerCase().includes(chineseWord)
                ) {
                  relevance += 6;
                  if (!matchedKeywords.includes(chineseWord)) {
                    matchedKeywords.push(chineseWord);
                  }
                }
              }
            }

            // 在关键词中查找
            for (const keyword of index.keywords) {
              if (keyword.includes(chineseWord)) {
                relevance += 5;
                if (!matchedKeywords.includes(chineseWord)) {
                  matchedKeywords.push(chineseWord);
                }
              }
            }
          }
        }
      }

      if (relevance > 0) {
        results.push({
          project: index.project,
          version: index.version,
          url: index.url,
          title: index.title,
          summary: index.summary,
          relevance,
          matchType,
          matchedKeywords,
          pages: index.pages,
        });
      }
    }

    // 按相关性排序
    return results.sort((a, b) => b.relevance - a.relevance);
  }
}

// 搜索文档函数
async function searchDocuments(query: string): Promise<SearchResult[]> {
  const indexManager = DocumentIndexManager.getInstance();
  await indexManager.loadIndexes();

  // 检查索引是否为空，如果为空则构建索引
  if (indexManager.getAllIndexes().length === 0) {
    console.log("未找到文档索引，开始构建索引...");
    await buildDocumentIndex();
    // 重新加载新构建的索引
    await indexManager.loadIndexes();
  }

  const results = indexManager.searchByKeywords(query);
  return results.slice(0, 10);
}

// 构建文档索引
async function buildDocumentIndex(): Promise<void> {
  const indexManager = DocumentIndexManager.getInstance();
  await indexManager.buildIndexFromExistingData();
}

export {
  isProjectVersions,
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  fetchAndSaveAllPrd,
  cleanupBrowser,
  searchDocuments,
  buildDocumentIndex,
};
