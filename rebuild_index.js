// rebuild_index.js

import { fetchHtmlWithContentImpl } from './build/handlers.js';

async function rebuildIndex() {
  console.log("=== 开始测试 ===\n");
  const url = "https://prd-upload-pub.yishouapp.com/prd/ERP/cd6838/#id=cnbgqz&p=erp%E5%BC%82%E5%B8%B8%E5%B7%A5%E5%8D%95%EF%BC%88%E6%97%A0%E6%95%B0%E6%8D%AE%EF%BC%89&g=1";
  try {
    const result = await fetchHtmlWithContentImpl(url);
 
    console.log(result);
    console.log("✅ 测试完成！");
    
  } catch (error) {
    console.error("❌ 测试失败:", error);
  }
}

rebuildIndex(); 