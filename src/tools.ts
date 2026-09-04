// tools.ts
// MCP工具注册，原本在index.ts
import { z } from "zod";
import {
  fetchPrd,
  fetchHtmlWithContentImpl,
  // fetchProjectVersions,
  // searchDocuments,
  fetchAndSaveAllPrd,
} from "./handlers.js";
import { projectNameMap, rules } from "./config.js";

// registerTools: 统一注册所有server.tool
function registerTools(server: any) {
  // 智能选择工具
  server.tool(
    "smart_fetch_prd",
    "智能选择获取PRD内容的方式，默认优先 fetch_prd，若 prompt 包含'全部''所有''整体'等关键词则 fetch_html_with_content",
    {
      url: z.string().describe("PRD文档URL"),
      prompt: z.string().describe("用户需求描述或提示词"),
    },
    async ({ url, prompt }: { url: string; prompt: string }) => {
      const keywords = ["全部需求", "所有需求"];
      const useAll = keywords.some((k) => prompt.includes(k));
      
      try {
        if (useAll) {
          const result = await fetchHtmlWithContentImpl(url);
          return {
            content: [
              {
                type: "text",
                text: rules.beforeCode,
                mimeType: "text/plain",
              },
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
                mimeType: "application/json",
              },
              {
                type: "text",
                text: JSON.stringify(projectNameMap, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        } else {
          const result = await fetchPrd(url);
          // 不回传 base64 image：内容过大时 Cursor 只落 txt，图片会丢；
          // 改落盘并在文本中给绝对路径，Agent 用 Read 读图即可。
          return {
            content: [
              {
                type: "text",
                text: rules.beforeCode,
                mimeType: "text/plain",
              },
              {
                type: "text",
                text: result.html,
                mimeType: "text/html",
              },
              {
                type: "text",
                text: JSON.stringify(
                  {
                    projectNameMap,
                    screenshotPath: result.screenshotPath || null,
                    tip: result.screenshotPath
                      ? "截图已保存到本机，请用 Read 工具读取 screenshotPath 查看图片（agent-tools 的 txt 不含图片）"
                      : "本次无截图",
                  },
                  null,
                  2
                ),
                mimeType: "application/json",
              },
            ],
          };
        }
      } catch (error: any) {
        console.error("smart_fetch_prd 工具执行失败:", error);
        return {
          content: [
            {
              type: "text",
              text: "获取PRD内容失败：" + (error.message || error),
              mimeType: "text/plain",
            },
            {
              type: "text",
              text: JSON.stringify({ projectNameMap }),
              mimeType: "application/json",
            },
          ],
        };
      }
    }
  );

  // // 更新所有项目的PRD文档
  server.tool(
    "fetch_all_prd",
    "更新所有项目的PRD文档,必须用户强调更新,否则默认不执行",
    {
      monthsToLoad: z
        .number()
        .optional()
        .describe("加载最近几个月的文档，默认1个月"),
    },
    async ({ monthsToLoad }: { monthsToLoad?: number }) => {
      await fetchAndSaveAllPrd({ monthsToLoad });
      return {
        content: [
          {
            type: "text",
            text: "PRD文档数据更新成功",
            mimeType: "text/plain",
          },
          {
            type: "text",
            text: JSON.stringify({ projectNameMap }, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );

  // // 搜索项目文档
  // server.tool(
  //   "search_documents",
  //   "搜索文档内容，支持智能匹配和关键词搜索",
  //   {
  //     query: z.string().describe("搜索关键词，如 yishou"),
  //   },
  //   async ({ query }: { query: string }) => {
  //     const result = await searchDocuments(query);
  //     return {
  //       content: [
  //         {
  //           type: "text",
  //           text: JSON.stringify(
  //             {
  //               query,
  //               results: result.map((result) => ({
  //                 title: result.title,
  //                 project: result.project,
  //                 version: result.version,
  //                 url: result.url,
  //                 summary: result.summary,
  //                 relevance: result.relevance,
  //                 matchType: result.matchType,
  //                 matchedKeywords: result.matchedKeywords,
  //                 pages: result.pages,
  //               })),
  //             },
  //             null,
  //             2
  //           ),
  //           mimeType: "application/json",
  //         },
  //         {
  //           type: "text",
  //           text: JSON.stringify({ projectNameMap }, null, 2),
  //           mimeType: "application/json",
  //         },
  //       ],
  //     };
  //   }
  // );
}

export { registerTools };
