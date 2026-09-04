/**
 * 验证 ?p= 分享链截图非空壳（文件大小 + 非纯黑粗检）
 */
import fs from "fs";
import { fetchPrd, cleanupBrowser } from "./build/handlers.js";

const TEST_URL =
  "https://prd-upload-pub.yishouapp.com/prd/BaoBan/4.73.00/latest/?id=wopzm5&p=os-%E5%95%86%E5%93%81%E5%BA%93-%E7%BC%96%E8%BE%91%E9%A1%B5-ai%E6%8E%A8%E8%8D%90%E5%B0%BA%E7%A0%81%E8%A1%A8&g=1";

function isMostlyBlackPng(filePath) {
  const buf = fs.readFileSync(filePath);
  // 粗检：抽样若干非 PNG 头字节，若几乎全是 0 则视为黑图
  let zeros = 0;
  let samples = 0;
  for (let i = 100; i < buf.length; i += 997) {
    samples += 1;
    if (buf[i] === 0) zeros += 1;
  }
  return samples > 0 && zeros / samples > 0.95;
}

async function main() {
  console.log("fetchPrd query-p screenshot test...");
  const r = await fetchPrd(TEST_URL);
  if (!r.screenshotPath || !fs.existsSync(r.screenshotPath)) {
    throw new Error("未生成 screenshotPath");
  }
  const size = fs.statSync(r.screenshotPath).size;
  console.log(`screenshotPath=${r.screenshotPath}`);
  console.log(`size=${size} htmlHasAI=${r.html.includes("AI推荐") || r.html.includes("AI 推荐")}`);
  if (size < 20_000) {
    throw new Error(`截图过小，可能仍是空壳: ${size}`);
  }
  if (isMostlyBlackPng(r.screenshotPath)) {
    throw new Error("截图疑似纯黑");
  }
  if (!r.html.includes("AI") && !r.html.includes("尺码")) {
    throw new Error("HTML/渲染文本未包含预期关键词");
  }
  console.log("✅ PASS");
}

main()
  .catch((e) => {
    console.error("❌ FAIL", e);
    process.exitCode = 1;
  })
  .finally(() => cleanupBrowser());
