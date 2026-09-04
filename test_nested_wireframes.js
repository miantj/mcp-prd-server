import assert from "node:assert/strict";
import { fetchHtmlWithContentImpl } from "./build/handlers.js";

const url =
  "https://prd-upload-pub.yishouapp.com/prd/newOS/cd10297/latest/#id=jwz1qw&p=h5-%E5%B9%B3%E5%8F%B0%E6%B4%BB%E5%8A%A8%E4%BA%A4%E4%BA%92%EF%BC%88%E7%88%86%E7%89%88%EF%BC%89--pc%E7%BD%91%E9%A1%B5%E7%AB%AF%E5%8F%AF%E8%AE%BF%E9%97%AE&g=1";
const result = await fetchHtmlWithContentImpl(url);
assert.equal(result.success, true, result.error);
const nodes = [];
const visit = (items = []) =>
  items.forEach((node) => {
    nodes.push(node);
    visit(node.children);
  });
visit(result.tree);

for (const id of ["jwz1qw", "o0dlll"]) {
  const node = nodes.find((item) => item.id === id);
  assert.ok(node?.content?.includes("<!DOCTYPE html>"), `${id} 缺少正文 HTML`);
}

console.log("PASS: 嵌套 Wireframe 均包含正文 HTML");
