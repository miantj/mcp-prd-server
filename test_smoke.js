/**
 * 全功能冒烟测试（精简输出，不 dump 大 HTML/截图）
 */
import {
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  fetchAndSaveAllPrd,
  searchDocuments,
  cleanupBrowser,
} from "./build/handlers.js";

const TEST_URL =
  "https://prd-upload-pub.yishouapp.com/prd/yishou/7.47.0/latest/#id=v7rb94&p=%E5%AE%A2%E6%9C%8D%E5%88%86%E6%B5%81%E5%BC%B9%E7%AA%97%E6%94%AF%E6%8C%81%E7%94%B5%E8%AF%9D%E6%8B%A8%E6%89%93-%E5%8C%97%E6%B5%B7&g=1";

const results = [];

function ok(name, detail = "") {
  results.push({ name, pass: true, detail });
  console.log(`✅ PASS  ${name}${detail ? " — " + detail : ""}`);
}

function fail(name, err) {
  const detail = err?.message || String(err);
  results.push({ name, pass: false, detail });
  console.log(`❌ FAIL  ${name} — ${detail}`);
}

async function run(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    return Date.now() - t0;
  } catch (e) {
    fail(name, e);
    return -1;
  }
}

async function main() {
  console.log("=== PRD-Server 全功能冒烟测试 ===\n");

  // 临时降噪：fetchPrd 会 console.log 整页 HTML
  const _log = console.log;
  const quiet = (...args) => {
    const s = String(args[0] ?? "");
    if (s.startsWith("processedUrl") || s.startsWith("htmlStr")) return;
    _log(...args);
  };

  // 1. 项目列表
  await run("fetchAllProjects", async () => {
    const r = await fetchAllProjects();
    if (!r.html || r.html.includes("失败")) throw new Error(r.html.slice(0, 200));
    const links = [...r.html.matchAll(/<a href="([^"/]+)\//g)].map((m) => m[1]);
    if (links.length < 1) throw new Error("未解析到项目");
    ok("fetchAllProjects", `项目数=${links.length} sample=${links.slice(0, 5).join(",")}`);
  });

  // 2. 项目版本列表（限制：只校验返回含版本链接）
  await run("fetchProjectVersions(yishou)", async () => {
    // 该接口可能拉很多页，加超时观感
    const r = await fetchProjectVersions("yishou");
    if (!r.html || r.html.includes("失败") || r.html.startsWith("没有这个项目")) {
      throw new Error(r.html.slice(0, 200));
    }
    const links = [...r.html.matchAll(/<a href="([^"/]+)\//g)].map((m) => m[1]);
    if (links.length < 1) throw new Error("未解析到版本");
    ok(
      "fetchProjectVersions(yishou)",
      `版本数=${links.length} sample=${links.slice(0, 3).join(",")}`
    );
  });

  // 3. 单页 PRD
  console.log = quiet;
  await run("fetchPrd", async () => {
    const r = await fetchPrd(TEST_URL);
    console.log = _log;
    if (!r.html || r.html.startsWith("获取PRD内容失败")) {
      throw new Error(r.html?.slice(0, 200) || "empty html");
    }
    if (!r.html.includes("客服分流")) throw new Error("HTML 未包含预期标题关键词");
    if (!r.screenshot || r.screenshot.length < 100) {
      throw new Error("截图为空或过短");
    }
    ok(
      "fetchPrd",
      `htmlLen=${r.html.length} screenshotLen=${r.screenshot.length}`
    );
  });
  console.log = _log;

  // 4. 整包 PRD（document.js 树）
  await run("fetchHtmlWithContentImpl", async () => {
    const r = await fetchHtmlWithContentImpl(TEST_URL);
    if (!r?.success || r.error) {
      throw new Error(r?.error || JSON.stringify(r).slice(0, 200));
    }
    if (!Array.isArray(r.tree) || r.tree.length < 1) {
      throw new Error("tree 为空");
    }
    ok(
      "fetchHtmlWithContentImpl",
      `treeLen=${r.tree.length} size=${JSON.stringify(r).length}`
    );
  });

  // 5. 全量同步（最近 1 个月）——会更新 data/ 下 json
  await run("fetchAndSaveAllPrd(monthsToLoad=1)", async () => {
    await fetchAndSaveAllPrd({ monthsToLoad: 1 });
    ok("fetchAndSaveAllPrd(monthsToLoad=1)", "已跑完并写盘");
  });

  // 6. 搜索（放在同步之后，确保索引已刷新）
  await run("searchDocuments", async () => {
    const r = await searchDocuments("客服分流");
    if (!Array.isArray(r)) throw new Error("返回非数组");
    if (r.length < 1) throw new Error("搜索无结果");
    if (String(r[0].url || "").includes("192.168.1.244")) {
      throw new Error(`结果仍含旧地址: ${r[0].url}`);
    }
    ok(
      "searchDocuments",
      `结果数=${r.length} top=${r[0].title} url=${r[0].url}`
    );
  });

  await cleanupBrowser();

  console.log("\n=== 汇总 ===");
  const passed = results.filter((x) => x.pass).length;
  const failed = results.filter((x) => !x.pass).length;
  console.log(`通过 ${passed} / 失败 ${failed} / 合计 ${results.length}`);
  if (failed > 0) {
    results.filter((x) => !x.pass).forEach((x) => console.log(`  - ${x.name}: ${x.detail}`));
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("冒烟测试异常退出:", e);
  try {
    await cleanupBrowser();
  } catch {}
  process.exit(1);
});
