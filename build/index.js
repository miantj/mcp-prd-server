import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { URL } from "url";
import vm from "vm";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
// 配置项
const config = {
    saveScreenshot: false, // 是否保存截图
    screenshotDir: "screenshots", // 截图保存目录
};
// 确保截图目录存在
if (config.saveScreenshot) {
    if (!fs.existsSync(config.screenshotDir)) {
        fs.mkdirSync(config.screenshotDir, { recursive: true });
    }
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
    try {
        const response = await axios.get(processedUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });
        const htmlStr = htmlReduce(response.data);
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
            await page.goto(processedUrl, { waitUntil: "networkidle0" });
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
// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
// 本地调试时直接调用 node build/index.js
if (config.saveScreenshot) {
    (async () => {
        const result = await fetchPrd("http://prd.yishou.com/newOS/cd6362/#id=75kp6z&p=h5%E6%B4%BB%E5%8A%A8%E6%A8%A1%E6%9D%BF_%E5%90%8E%E5%8F%B0%E9%85%8D%E7%BD%AE%E8%B0%83%E6%95%B4&g=1");
        console.log(result);
    })();
}
