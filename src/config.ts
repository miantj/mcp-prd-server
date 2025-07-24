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
  url: "https://prd-upload-pub.yishouapp.com/prd/yishou/7.59.0/#id=g8yvfk&p=%E8%A1%A5%E5%81%BF%E9%85%8D%E7%BD%AE&g=1", // 截图保存目录
  monthsToLoad: 1, // 加载最近几个月的文档，默认1个月
};

// 数据目录和文件路径
export const dataDir = path.resolve(process.cwd(), "data");
export const projectListPath = path.join(dataDir, "project_list.json");
export const projectVersionsPath = path.join(dataDir, "project_versions.json");

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`数据目录已创建: ${dataDir}`);
  } catch (error) {
    console.error(`创建数据目录失败: ${dataDir}`, error);
    process.exit(1);
  }
}

// 确保截图目录存在
if (config.saveScreenshot) {
  const screenshotDir = path.resolve(process.cwd(), config.screenshotDir);
  if (!fs.existsSync(screenshotDir)) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
    } catch (error) {
      console.error(`创建截图目录失败: ${screenshotDir}`, error);
    }
  }
}
