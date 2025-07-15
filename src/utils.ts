// utils.ts
import fs from "fs";
import vm from "vm";
import {
  projectListPath,
  projectVersionsPath,
  projectNameMap,
} from "./config.js";

export const projectList = JSON.parse(
  fs.readFileSync(projectListPath, "utf-8")
);
export const projectVersions = JSON.parse(
  fs.readFileSync(projectVersionsPath, "utf-8")
);

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
