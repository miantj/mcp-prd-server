import { searchDocuments } from './build/handlers.js';

async function testSearchDocuments() {
  try {
    console.log("开始测试 searchDocuments 功能...");
    
    // 测试不同的搜索关键词
    const testQueries = [
      "和慢必赔相关的文档有那些",
      "erp异常工单的 prd 需求有哪些，网址是什么",
    ];
    
    for (const query of testQueries) {
      console.log(`\n=== 搜索关键词: "${query}" ===`);
      
      try {
        const results = await searchDocuments(query, 5);
        console.log(`找到 ${results.length} 个结果:`);
        
        if (results.length === 0) {
          console.log("  没有找到相关文档");
        } else {
          console.log(results); 
          results.forEach((result, index) => {
            console.log(`\n${index + 1}. ${result.title}`);
            console.log(`   项目: ${result.project}`);
            console.log(`   版本: ${result.version}`);
            console.log(`   相关性评分: ${result.relevance}`);
            console.log(`   匹配类型: ${result.matchType}`);
            console.log(`   匹配关键词: ${result.matchedKeywords.join(', ')}`);
            console.log(`   摘要: ${result.summary.substring(0, 80)}...`);
            console.log(`   URL: ${result.url}`);
          });
        }
      } catch (error) {
        console.error(`搜索 "${query}" 时出错:`, error.message);
      }
    }
    
    console.log("\n=== 测试完成 ===");
    
  } catch (error) {
    console.error("测试过程中出现错误:", error);
  }
}

testSearchDocuments(); 