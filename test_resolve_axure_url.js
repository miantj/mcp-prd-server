/**
 * resolveAxurePageUrl 单元测试（不依赖浏览器）
 */
import { resolveAxurePageUrl } from "./build/utils.js";

const cases = [
  {
    name: "query ?p=",
    input:
      "https://prd-upload-pub.yishouapp.com/prd/BaoBan/4.73.00/latest/?id=wopzm5&p=os-%E5%95%86%E5%93%81%E5%BA%93-%E7%BC%96%E8%BE%91%E9%A1%B5-ai%E6%8E%A8%E8%8D%90%E5%B0%BA%E7%A0%81%E8%A1%A8&g=1",
    expectIncludes: "os-商品库-编辑页-ai推荐尺码表.html",
  },
  {
    name: "hash #p=",
    input:
      "https://prd-upload-pub.yishouapp.com/prd/yishou/7.47.0/latest/#id=v7rb94&p=%E5%AE%A2%E6%9C%8D%E5%88%86%E6%B5%81&g=1",
    expectIncludes: "客服分流.html",
  },
  {
    name: "already wireframe html",
    input:
      "https://prd-upload-pub.yishouapp.com/prd/BaoBan/4.73.00/latest/os-商品库-编辑页-ai推荐尺码表.html",
    expectIncludes: "os-商品库-编辑页-ai推荐尺码表.html",
  },
];

let failed = 0;
for (const c of cases) {
  const out = resolveAxurePageUrl(c.input);
  const decoded = decodeURIComponent(out);
  const pass =
    out.includes(c.expectIncludes) || decoded.includes(c.expectIncludes);
  console.log(`${pass ? "✅" : "❌"} ${c.name}`);
  console.log(`   → ${out}`);
  if (!pass) {
    console.log(`   expected includes: ${c.expectIncludes}`);
    failed += 1;
  }
}

process.exit(failed ? 1 : 0);
