// config.ts
import path from "path";
import fs from "fs";

// 项目名称映射表
export const projectNameMap = {
  BaoBan: "爆版",
  ERP: "ERP系统",
  temp: "临时",
  test: "测试",
  yishou: "一手",
  yizhe: "衣者",
};

// 配置项
export const config = {
  saveScreenshot: false, // 是否保存截图
  screenshotDir: "screenshots", // 截图保存目录
  url: "http://192.168.1.244:7777/yishou/7.58.0", // 截图保存目录
};

// 数据目录和文件路径
export const dataDir = path.join(process.cwd(), "data");
export const projectListPath = path.join(dataDir, "project_list.json");
export const projectVersionsPath = path.join(dataDir, "project_versions.json");

// 确保截图目录存在
if (config.saveScreenshot) {
  if (!fs.existsSync(config.screenshotDir)) {
    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }
} 