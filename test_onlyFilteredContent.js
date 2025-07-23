// 测试 onlyFilteredContent 功能
import { fetchAndSaveAllPrd } from './build/handlers.js';

async function testOnlyFilteredContent() {
  console.log('=== 测试 onlyFilteredContent 功能 ===');

  console.log('\n2. 测试只保存有内容的版本（onlyFilteredContent: true）');
  await fetchAndSaveAllPrd({
    filterProjects: ["yishou"],
    filterVersions: ["7.58.0"],
    onlyFilteredContent: false
  });
  
  console.log('\n测试完成！');
}

testOnlyFilteredContent().catch(console.error); 