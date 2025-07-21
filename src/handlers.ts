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
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", // 禁用沙箱模式,在某些Linux环境下必需
        "--disable-setuid-sandbox", // 禁用setuid沙箱,配合no-sandbox使用
        "--disable-features=HttpsFirstBalancedModeAutoEnable",
      ],
    });
    try {
      const page = await browser.newPage();
      // 修改 navigator.webdriver
      await page.evaluateOnNewDocument(() => {
        delete Object.getPrototypeOf(navigator).webdriver;
      });
      await page.goto(processedUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      await page.setViewport({ width: 1920, height: 1080 });
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
      await page.close();
      return {
        html: htmlStr,
        screenshot: screenshot as string, // 直接返回base64字符串，不添加data URL前缀
      };
    } finally {
      await browser.close();
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
  const allVersions: Record<string, string[]> = {};
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
      allVersions[project] = versionMatches
        .map((m) => m[1])
        .filter((v) => v !== "..");
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

export {
  isProjectVersions,
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  fetchAndSaveAllPrd,
};
