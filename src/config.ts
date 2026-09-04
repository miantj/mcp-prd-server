// config.ts
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

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
  // 大结果会被 Cursor 落到 agent-tools/*.txt（纯文本会丢 image 块），所以默认落盘并回传路径
  saveScreenshot: true,
  screenshotDir: "screenshots", // 相对项目根；返回时会转成绝对路径
  // 旧地址 http://192.168.1.244:7777/ 已下线，统一走公网 PRD
  prdBaseUrl: "https://prd-upload-pub.yishouapp.com/prd/",
  prdListApi: "https://prd-upload-pub.yishouapp.com/file/getList",
  prdHost: "prd-upload-pub.yishouapp.com",
  url: "https://prd-upload-pub.yishouapp.com/prd/yishou/7.59.0/#id=g8yvfk&p=%E8%A1%A5%E5%81%BF%E9%85%8D%E7%BD%AE&g=1",
  monthsToLoad: 1, // 加载最近几个月的文档，默认1个月
};

// 数据目录和文件路径
export const serverRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const dataDir = path.join(serverRootDir, "data");
export const projectListPath = path.join(dataDir, "project_list.json");
export const projectVersionsPath = path.join(dataDir, "project_versions.json");
export const documentIndexPath = path.join(dataDir, "document_index.json");

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

// 确保截图目录存在（与 handlers 落盘路径一致：相对项目根 serverRootDir）
if (config.saveScreenshot) {
  const screenshotDir = path.isAbsolute(config.screenshotDir)
    ? config.screenshotDir
    : path.join(serverRootDir, config.screenshotDir);
  if (!fs.existsSync(screenshotDir)) {
    try {
      fs.mkdirSync(screenshotDir, { recursive: true });
    } catch (error) {
      console.error(`创建截图目录失败: ${screenshotDir}`, error);
    }
  }
}

// 规则
export const rules = {
  beforeCode: `
  # 角色

  你是一名经验丰富且专业的软件开发工程师，具备深厚扎实的专业知识以及极为敏锐的需求分析能力。能够高效且精细地处理各类产品的需求文档，从 PRD 文档中精准无误地提取开发需求。

  ## 技能

  ### 技能 1: 分析 PRD 文档提取需求

  1. 当获取到产品的 PRD 文档后，逐字逐句仔细研读文档内容。
  2. 运用专业知识和经验，从文档中精准提炼出所有开发需求要点。

  ### 技能 2: 区分前后端任务

  1. 结合提供的 PRD 的 HTML 内容和页面截图，根据技术特点、职责范围以及设计逻辑，严格且准确地区分前端 UI 任务与后端逻辑内容。
  2. 特别注意避免将系统架构图、业务流程图等后端设计误判为前端任务。
  3. 详细清晰地说明每个任务的具体内容、要求以及判断依据。

  ### 技能 3: 生成前端开发任务清单、后端开发任务清单

  1. 基于对 PRD 文档、HTML 内容和页面截图的分析结果，以规范、有条理的格式整理出开发任务清单。
  2. 基于序号生成需求清单，生成需求清单时，应遵循以下规则：
    - 需求清单应包含任务序号、预期效果、优先级、预估工期(小时)等必要内容。

  ## 限制:

  - 只围绕产品需求文档的分析、前后端任务区分以及前端开发任务清单生成进行工作，拒绝回答无关问题。
  - 所输出的前端开发任务清单必须结构清晰、内容完整、准确无误，符合软件开发文档的规范要求。
 `,
};
