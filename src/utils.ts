// utils.ts
import fs from "fs";
import vm from "vm";
import {
  projectListPath,
  projectVersionsPath,
  projectNameMap,
} from "./config.js";

// 安全读取JSON文件
function safeReadJsonFile(filePath: string, defaultValue: any = []) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`文件不存在: ${filePath}，使用默认值`);
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`JSON解析失败: ${filePath}`, error);
    } else {
      console.error(`读取文件失败: ${filePath}`, error);
    }
    return defaultValue;
  }
}

export const projectList = safeReadJsonFile(projectListPath, []);
export const projectVersions = safeReadJsonFile(projectVersionsPath, {});

// 检查项目是否有效
export function isValidProject(project: string): boolean {
  return projectList.includes(project);
}

// 获取指定项目的所有版本号
export function getAllVersionsOfProject(project: string) {
  return projectVersions[project] || [];
}

// 检查版本号是否有效
export function isValidVersion(project: string, version: string): boolean {
  return getAllVersionsOfProject(project).includes(version);
}

/**
 * 将 Axure 分享链接解析为真实线框页 URL。
 * 支持：
 * - 新版查询串：?id=xxx&p=页面名&g=1
 * - 旧版 hash：#id=xxx&p=页面名&g=1
 * - 已是 *.html 线框页：原样返回
 * 否则返回去掉 search/hash 后的目录地址（播放器壳页）。
 */
export function resolveAxurePageUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    let pageName = urlObj.searchParams.get("p") || "";

    if (!pageName && urlObj.hash) {
      const hash = urlObj.hash.replace(/^#/, "");
      // hash 可能是 "id=...&p=...&g=1" 或纯页面名
      if (hash.includes("=")) {
        pageName = new URLSearchParams(hash).get("p") || "";
      } else if (hash) {
        pageName = hash;
      }
    }

    // 已是线框 html，且无 p 参数指向其它页
    if (!pageName && /\.html?$/i.test(urlObj.pathname)) {
      return urlObj.href;
    }

    urlObj.search = "";
    urlObj.hash = "";
    let pathname = urlObj.pathname || "/";
    if (/\.html?$/i.test(pathname)) {
      pathname = pathname.replace(/[^/]+$/, "");
    }
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }
    urlObj.pathname = pathname;
    const baseUrl = urlObj.href;

    if (!pageName) {
      return baseUrl;
    }

    const decoded = decodeURIComponent(pageName.trim());
    const fileName = /\.html?$/i.test(decoded) ? decoded : `${decoded}.html`;
    return new URL(fileName, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * 增强HTML内容的语义化
 * @param {string} htmlStr - 原始HTML字符串
 * @returns {string} 处理后的HTML字符串
 */
export function enhanceHtmlSemantics(htmlStr: string) {
  Object.entries(projectNameMap).forEach(([pinyin, chinese]) => {
    const pinyinRegex = new RegExp(`(${pinyin})(?![^<]*>)`, "gi");
    htmlStr = htmlStr.replace(
      pinyinRegex,
      `<span class=\"project-name\" data-chinese=\"${chinese}\" data-pinyin=\"$1\">$1</span>`
    );
    const chineseRegex = new RegExp(`(${chinese})(?![^<]*>)`, "gi");
    htmlStr = htmlStr.replace(
      chineseRegex,
      `<span class=\"project-name\" data-chinese=\"$1\" data-pinyin=\"${pinyin}\">$1</span>`
    );
  });
  return htmlStr;
}

/**
 * 精简和处理HTML字符串
 * @param {string} htmlStr - 原始HTML字符串
 * @returns {string} 处理后的HTML字符串
 */
export function htmlReduce(htmlStr: string) {
  htmlStr = htmlStr.replace(/\s+/g, " ").trim();
  htmlStr = htmlStr.replace(/<script\b[^>]*>.*?<\/script>/gi, "");
  htmlStr = enhanceHtmlSemantics(htmlStr);
  return htmlStr;
}

// 假设 jsContent 是 document.js 的内容（字符串）
export function getCreatorResult(jsContent: string) {
  const funcMatch = jsContent.match(
    /\(\s*function\s*\(\)\s*\{[\s\S]*?return _creator\(\);\s*\}\s*\)\s*\(\s*\)/
  );
  if (!funcMatch) throw new Error("未找到 function() { ... }() 结构");
  const funcStr = funcMatch[0];
  const script = new vm.Script(funcStr);
  return script.runInNewContext();
}
