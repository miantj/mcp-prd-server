// rebuild_index.js

import { fetchHtmlWithContentImpl, fetchPrd } from "./build/handlers.js";

async function rebuildIndex() {
  console.log("=== 开始测试 ===\n");
  const url =
    "https://prd-upload-pub.yishouapp.com/prd/yishou/7.47.0/latest/#id=v7rb94&p=%E5%AE%A2%E6%9C%8D%E5%88%86%E6%B5%81%E5%BC%B9%E7%AA%97%E6%94%AF%E6%8C%81%E7%94%B5%E8%AF%9D%E6%8B%A8%E6%89%93-%E5%8C%97%E6%B5%B7&g=1";
  try {
    const result = await fetchPrd(url);

    console.log(result);
    console.log("✅ 测试完成！");
  } catch (error) {
    console.error("❌ 测试失败:", error);
  }
}

rebuildIndex();
