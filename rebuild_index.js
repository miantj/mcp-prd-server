// rebuild_index.js
// 重新构建文档索引

import { buildDocumentIndex } from './build/handlers.js';

async function rebuildIndex() {
  console.log("=== 开始重新构建文档索引 ===\n");
  
  try {
    console.log("正在重新构建文档索引...");
    await buildDocumentIndex();
    console.log("✅ 文档索引重新构建完成！");
    console.log("现在可以测试优化后的搜索功能了。");
    
  } catch (error) {
    console.error("❌ 重新构建索引失败:", error);
  }
}

rebuildIndex(); 