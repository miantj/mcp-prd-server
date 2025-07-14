import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { URL } from "url";
import vm from "vm";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
// 项目名称映射表
const projectNameMap = {
    BaoBan: "爆版",
    ERP: "ERP系统",
    temp: "临时",
    test: "测试",
    yishou: "一手",
    yizhe: "衣者",
};
// 配置项
const config = {
    saveScreenshot: false, // 是否保存截图
    screenshotDir: "screenshots", // 截图保存目录
    // url: "https://prd-upload-pub.yishouapp.com/prd/yishou/7.58.0/#id=4c2sh7&p=%E5%AE%A1%E6%A0%B8%E5%88%97%E8%A1%A8&g=1", // 截图保存目录
    url: "http://192.168.1.244:7777/yishou/7.58.0", // 截图保存目录
};
// 确保截图目录存在
if (config.saveScreenshot) {
    if (!fs.existsSync(config.screenshotDir)) {
        fs.mkdirSync(config.screenshotDir, { recursive: true });
    }
}
// 读取项目和版本数据前，判断文件是否存在，不存在则自动生成
const dataDir = path.join(process.cwd(), "data");
const projectListPath = path.join(dataDir, "project_list.json");
const projectVersionsPath = path.join(dataDir, "project_versions.json");
if (!fs.existsSync(projectListPath) || !fs.existsSync(projectVersionsPath)) {
    console.log("项目或版本数据文件不存在，正在自动爬取并生成...");
    await fetchAndSaveAllPrd();
}
const projectList = JSON.parse(fs.readFileSync(projectListPath, "utf-8"));
const projectVersions = JSON.parse(fs.readFileSync(projectVersionsPath, "utf-8"));
// 获取所有项目的ID列表
function getAllProjectIds() {
    return projectList.map((item) => item.id);
}
// 检查项目是否有效
function isValidProject(project) {
    return getAllProjectIds().includes(project);
}
// 获取指定项目的所有版本号
function getAllVersionsOfProject(project) {
    return projectVersions[project]
        ? projectVersions[project].map((v) => v.version)
        : [];
}
// 检查版本号是否有效
function isValidVersion(project, version) {
    return getAllVersionsOfProject(project).includes(version);
}
// 创建MCP服务器
const server = new McpServer({
    name: "PRD-Server",
    version: "1.0.0",
});
// 获取当前页面内容
async function fetchPrd(url) {
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
            });
            // 如果开启了保存截图功能，保存图片到本地
            if (config.saveScreenshot) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const urlHash = Buffer.from(url).toString("base64").substring(0, 10);
                const filename = `screenshot-${timestamp}-${urlHash}.png`;
                const filepath = path.join(config.screenshotDir, filename);
                await fs.promises.writeFile(filepath, Buffer.from(screenshot, "base64"));
                console.log(`Screenshot saved to: ${filepath}`);
            }
            await page.close();
            return {
                html: htmlStr,
                screenshot: screenshot, // 直接返回base64字符串，不添加data URL前缀
            };
        }
        finally {
            await browser.close();
        }
    }
    catch (error) {
        return {
            html: "获取PRD内容失败：" + error.message,
            screenshot: "",
        };
    }
}
// 1. 获取全部页面内容，并返回树形结构
async function fetchHtmlWithContentImpl(url) {
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });
        const jsContent = jsResp.data;
        const rootNodes = getCreatorResult(jsContent).sitemap.rootNodes;
        // 递归抓取内容
        async function fetchTree(nodes) {
            return Promise.all(nodes.map(async (node) => {
                if (node.type === "Folder" && node.children) {
                    return {
                        ...node,
                        children: await fetchTree(node.children),
                    };
                }
                else if (node.type === "Wireframe" && node.url) {
                    // 拼接页面url
                    const htmlUrl = new URL(node.url, processedUrl).href;
                    let htmlContent = "";
                    try {
                        const htmlResp = await axios.get(htmlUrl, {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                            },
                        });
                        htmlContent = htmlReduce(htmlResp.data);
                    }
                    catch (e) {
                        htmlContent = `获取失败: ${e}`;
                    }
                    return {
                        ...node,
                        content: htmlContent,
                    };
                }
                else {
                    return node;
                }
            }));
        }
        const treeWithContent = await fetchTree(rootNodes);
        return { success: true, tree: treeWithContent };
    }
    catch (e) {
        return { success: false, error: `获取document.js或解析失败：${e}` };
    }
}
/**
 * 增强HTML内容的语义化
 * @param {string} htmlStr - 原始HTML字符串
 * @returns {string} 处理后的HTML字符串
 */
function enhanceHtmlSemantics(htmlStr) {
    // 1. 为项目名称添加语义化标记
    Object.entries(projectNameMap).forEach(([pinyin, chinese]) => {
        // 为拼音添加中文注释
        const pinyinRegex = new RegExp(`(${pinyin})(?![^<]*>)`, "gi");
        htmlStr = htmlStr.replace(pinyinRegex, `<span class="project-name" data-chinese="${chinese}" data-pinyin="$1">$1</span>`);
        // 为中文添加拼音注释
        const chineseRegex = new RegExp(`(${chinese})(?![^<]*>)`, "gi");
        htmlStr = htmlStr.replace(chineseRegex, `<span class="project-name" data-chinese="$1" data-pinyin="${pinyin}">$1</span>`);
    });
    return htmlStr;
}
/**
 * 精简和处理HTML字符串
 * @param {string} htmlStr - 原始HTML字符串
 * @param {string} [url] - 可选，页面URL，用于修正img的src
 * @returns {string} 处理后的HTML字符串
 */
function htmlReduce(htmlStr) {
    // 1. 合并多余空白
    htmlStr = htmlStr.replace(/\s+/g, " ").trim();
    // 2. 删除<script>标签及内容
    htmlStr = htmlStr.replace(/<script\b[^>]*>.*?<\/script>/gi, "");
    // 3. 增强语义化
    htmlStr = enhanceHtmlSemantics(htmlStr);
    return htmlStr;
}
// 假设 jsContent 是 document.js 的内容（字符串）
function getCreatorResult(jsContent) {
    // 提取 (function() { ... })() 结构
    const funcMatch = jsContent.match(/\(\s*function\s*\(\)\s*\{[\s\S]*?return _creator\(\);\s*\}\s*\)\s*\(\s*\)/);
    if (!funcMatch)
        throw new Error("未找到 function() { ... }() 结构");
    const funcStr = funcMatch[0];
    // 用 vm 执行
    const script = new vm.Script(funcStr);
    return script.runInNewContext();
}
// 智能选择工具：默认 fetch_prd，若 prompt 包含"全部""所有""整体"则用 fetch_html_with_content
server.tool("smart_fetch_prd", "智能选择获取PRD内容的方式，默认优先 fetch_prd，若 prompt 包含'全部''所有''整体'等关键词则 fetch_html_with_content", {
    url: z.string().describe("PRD文档URL"),
    prompt: z.string().describe("用户需求描述或提示词"),
}, async ({ url, prompt }) => {
    // 关键词判断
    const keywords = ["全部", "所有", "整体"];
    const useAll = keywords.some((k) => prompt.includes(k));
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
    }
    else {
        // 复用 fetch_prd 逻辑
        try {
            const result = await fetchPrd(url);
            return {
                content: [
                    {
                        type: "text",
                        text: result.html,
                        mimeType: "text/html",
                    },
                    {
                        type: "image",
                        data: result.screenshot.replace(/^data:image\/png;base64,/, ""), // 移除data URL前缀
                        mimeType: "image/png",
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: "获取PRD内容失败：" + error.message,
                        mimeType: "text/plain",
                    },
                ],
            };
        }
    }
});
// 新增：爬取 http://192.168.1.244:7777/{project}/ 下全部版本页面内容（只返回 html，不递归）
async function fetchProjectVersions(project) {
    if (!isValidProject(project)) {
        return {
            html: `没有这个项目：${project}。可用项目有：${getAllProjectIds().join("、")}`,
        };
    }
    const url = `http://192.168.1.244:7777/${project}/`;
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });
        return { html: htmlReduce(response.data) };
    }
    catch (error) {
        return {
            html: `获取${project}项目全部版本页面失败：` + error.message,
        };
    }
}
// 新增：爬取 http://192.168.1.244:7777/ 首页内容
async function fetchAllProjects() {
    const url = "http://192.168.1.244:7777/";
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
    }
    catch (error) {
        return { html: "获取首页内容失败：" + error.message };
    }
}
// 优化工具名称和描述
// 1. 获取全部项目列表
server.tool("fetch_all_projects", "获取 http://192.168.1.244:7777/ 下全部项目列表页面内容（只返回 html 字符串）", {}, async () => {
    const result = await fetchAllProjects();
    return {
        content: [
            {
                type: "text",
                text: result.html,
                mimeType: "text/html",
            },
        ],
    };
});
// 2. 获取指定项目全部版本列表
server.tool("fetch_project_versions", "获取 http://192.168.1.244:7777/{project}/ 下指定项目的全部版本列表页面内容（只返回 html 字符串）", {
    project: z.string().describe("项目名称，如 yishou"),
}, async ({ project }) => {
    const result = await fetchProjectVersions(project);
    return {
        content: [
            {
                type: "text",
                text: result.html,
                mimeType: "text/html",
            },
        ],
    };
});
// 定时爬取所有项目和版本并保存为JSON
async function fetchAndSaveAllPrd() {
    // 1. 获取项目列表页HTML
    const url = "http://192.168.1.244:7777/";
    let html = "";
    try {
        const res = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });
        html = res.data;
    }
    catch (e) {
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
    const allVersions = {};
    for (const project of projectNames) {
        try {
            const projectUrl = `http://192.168.1.244:7777/${project}/`;
            const res = await axios.get(projectUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
            });
            const projectHtml = res.data;
            const versionMatches = [
                ...projectHtml.matchAll(/<a href="([^\/?#]+)\//g),
            ];
            allVersions[project] = versionMatches
                .map((m) => m[1])
                .filter((v) => v !== "..");
        }
        catch (e) {
            console.error(`获取项目 ${project} 版本目录失败：`, e);
            allVersions[project] = [];
        }
    }
    const versionSavePath = path.join(dataDir, "project_versions.json");
    fs.writeFileSync(versionSavePath, JSON.stringify(allVersions, null, 2), "utf-8");
    console.log("已保存所有项目版本到", versionSavePath);
}
// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
// 本地调试时直接调用 node build/index.js
if (config.saveScreenshot) {
    (async () => {
        const result = await fetchAndSaveAllPrd();
        console.log(result);
    })();
}
