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
async function fetchAndSaveAllPrd(options?: {
  monthsToLoad?: number; // 加载最近几个月的文档，默认1个月
}): Promise<void> {
  const {
    monthsToLoad = 1 // 默认加载最近1个月
  } = options || {};

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
  const projectMatches = [...html.matchAll(/<a href="([^\/?#]+)\//g)];
  let projectNames = projectMatches.map((m) => m[1]).filter((name) => name !== "..");
  
  // 获取所有项目，不进行筛选
  console.log(`获取所有项目：${projectNames.join(", ")}`);
  
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
      let versionNames = versionMatches
        .map((m) => m[1])
        .filter((v) => v !== "..");
      
      // 提取版本时间信息 - 使用更简单的匹配
      const versionTimeMap = new Map();
      const versionTimeMatches = [...projectHtml.matchAll(/<a href="([^\/?#]+)\/">[^<]+<\/a>\s*(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{1,2}:\d{2})/g)];
      versionTimeMatches.forEach((match) => {
        const versionName = match[1];
        const timeStr = match[2];
        if (versionName !== "..") {
          versionTimeMap.set(versionName, timeStr);
        }
      });
      
      // 获取所有版本，不进行筛选
      console.log(`项目 ${project}: 获取所有版本：${versionNames.join(", ")}`);
      
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
            
            // 检查是否需要获取内容（根据时间筛选条件）
            let shouldGetContent = true;
            
            if (monthsToLoad > 0) {
              // 获取版本时间信息
              const versionTime = versionTimeMap.get(version);
              if (versionTime) {
                shouldGetContent = isWithinLastMonths(versionTime, monthsToLoad);
                if (shouldGetContent) {
                  console.log(`✅ 版本 ${version} 在最近 ${monthsToLoad} 个月内 (${versionTime})`);
                } else {
                  console.log(`⏭️ 跳过版本 ${version}，不在最近 ${monthsToLoad} 个月内 (${versionTime})`);
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
                const page = await browserManager.createPage();
                try {
                  // 设置更长的超时时间，确保页面完全加载
                  await page.goto(versionUrl, {
                    waitUntil: "networkidle0", // 等待网络空闲，确保页面完全加载
                    timeout: 15000, // 增加超时时间
                  });
                  
                  // 等待页面渲染完成
                  await new Promise(resolve => setTimeout(resolve, 1000)); // 减少等待时间
                  
                  // 获取渲染后的内容
                  versionContent = await page.evaluate(() => {
                    // 移除script和style标签
                    const scripts = document.querySelectorAll('script, style');
                    scripts.forEach(script => script.remove());
                    
                    // 获取页面标题，尝试多种方式
                    let title = document.title || '';
                    
                    // 如果标题是默认值，尝试从其他元素获取
                    if (!title || title === 'Untitled Document' || title === 'Document') {
                      // 尝试从 h1 标签获取
                      const h1 = document.querySelector('h1');
                      if (h1 && h1.textContent) {
                        title = h1.textContent.trim();
                      } else {
                        // 尝试从页面中查找可能的标题
                        const possibleTitles = document.querySelectorAll('h1, h2, h3, .title, .header, [class*="title"], [class*="header"]');
                        for (const element of possibleTitles) {
                          const text = element.textContent?.trim();
                          if (text && text.length > 0 && text.length < 100) {
                            title = text;
                            break;
                          }
                        }
                      }
                    }
                    
                    // 获取所有文本内容，包括结构化的信息
                    let content = '';
                    
                    // 获取body内容
                    if (document.body) {
                      // 优先获取主要内容区域
                      const mainContent = document.querySelector('main, .main, .content, .container, #content, #main') || document.body;
                      
                      // 获取所有可见的文本节点，但优先处理主要内容区域
                      const walker = document.createTreeWalker(
                        mainContent,
                        NodeFilter.SHOW_TEXT,
                        {
                          acceptNode: function(node) {
                            const parent = node.parentElement;
                            if (!parent) return NodeFilter.FILTER_REJECT;
                            
                            // 跳过隐藏元素
                            const style = window.getComputedStyle(parent);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                              return NodeFilter.FILTER_REJECT;
                            }
                            
                            // 跳过script和style标签
                            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
                              return NodeFilter.FILTER_REJECT;
                            }
                            
                            // 跳过导航和工具栏
                            if (parent.closest('nav, .nav, .navigation, .toolbar, .header, .footer')) {
                              return NodeFilter.FILTER_REJECT;
                            }
                            
                            return NodeFilter.FILTER_ACCEPT;
                          }
                        }
                      );
                      
                      const textNodes = [];
                      let node;
                      while (node = walker.nextNode()) {
                        const text = node.textContent?.trim();
                        if (text && text.length > 0) {
                          // 过滤掉一些无用的文本
                          const uselessPatterns = [
                            /^(CLOSE|Local Preview|Share Prototype|Show Note Markers|Show Hotspots|Default Scale|Scale to Width|Scale to Fit|Use|and|keys|to move between pages|No notes for this page|Notes added in Axure RP will appear here)$/,
                            /^\(\d+ of \d+\)$/, // (1 of 12)
                            /^\(\d+ x \w+\)$/, // (1920 x any)
                            /^\(\w+ x \w+\)$/, // (any x any)
                            /^(Pages|Adaptive)$/,
                            /^[A-Z\s]+$/, // 全大写字母
                            /^\d+$/, // 纯数字
                            /^[^\u4e00-\u9fa5a-zA-Z0-9]+$/, // 不包含中文、英文、数字的文本
                          ];
                          
                          const isUseless = uselessPatterns.some(pattern => pattern.test(text));
                          if (!isUseless && text.length > 1) {
                            textNodes.push(text);
                          }
                        }
                      }
                      
                      content = textNodes.join('\n');
                    }
                    
                    // 如果没有获取到内容，使用innerText作为备选
                    if (!content) {
                      content = document.body ? document.body.innerText : document.documentElement.innerText;
                    }
                    
                    // 组合标题和内容，添加结构化信息
                    let result = '';
                    if (title) {
                      result += `标题: ${title}\n\n`;
                    }
                    
                    if (content) {
                      // 尝试提取页面结构信息
                      const sections = content.split('\n')
                        .filter(line => line.trim().length > 0)
                        .filter(line => {
                          // 进一步过滤无意义的内容
                          const trimmed = line.trim();
                          return trimmed.length > 2 && 
                                 !trimmed.match(/^[^\u4e00-\u9fa5a-zA-Z0-9]+$/) && // 包含有意义字符
                                 !trimmed.match(/^[A-Z\s]+$/) && // 不是全大写
                                 !trimmed.match(/^\d+$/) && // 不是纯数字
                                 !trimmed.match(/^\(\d+ of \d+\)$/) && // 不是页码
                                 !trimmed.match(/^\(\d+ x \w+\)$/) && // 不是尺寸信息
                                 !trimmed.match(/^(Pages|Adaptive|CLOSE)$/); // 不是工具按钮
                        });
                      
                      if (sections.length > 0) {
                        result += `页面内容:\n`;
                        sections.forEach((section, index) => {
                          result += `${index + 1}. ${section}\n`;
                        });
                      }
                    }
                    
                    return result || '无内容';
                  });
                } finally {
                  await page.close();
                }
              } catch (e: any) {
                console.error(`获取项目 ${project} 版本 ${version} 内容失败：`, e);
                versionContent = `获取失败: ${e.message}`;
              }
            } else {
              // 如果不需要获取内容，只保存基本信息
              versionContent = "";
            }
            
            return {
              name: version,
              url: versionUrl,
              content: versionContent,
              lastModified: versionTimeMap.get(version) || null
            };
          })
        );
        versionsWithContent.push(...batchResults);
        
        // 添加进度日志
        console.log(`项目 ${project}: 已完成 ${Math.min(i + concurrencyLimit, versionNames.length)}/${versionNames.length} 个版本`);
      }
      
      // 如果只获取筛选的内容，只保存有内容的版本
      // 这里不再需要onlyFilteredContent，因为它是全局筛选
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

// 时间解析函数
function parseTimeString(timeStr: string): Date {
  // 解析格式如 "19-Apr-2022 16:14"
  const months: { [key: string]: number } = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  
  const match = timeStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/);
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

export {
  isProjectVersions,
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  fetchAndSaveAllPrd,
  cleanupBrowser,
};
