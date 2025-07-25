// tools.ts
// MCP工具注册，原本在index.ts
import { z } from "zod";
import {
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  searchDocuments,
  fetchAndSaveAllPrd,
} from "./handlers.js";
import { projectNameMap } from "./config.js";

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
      const keywords = ["全部", "所有", "整体"];
      const useAll = keywords.some((k) => prompt.includes(k));
      if (useAll) {
        const result = await fetchHtmlWithContentImpl(url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
              mimeType: "text/plain",
            },
            {
              type: "text",
              text: JSON.stringify({ projectNameMap }, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      } else {
        try {
          const result = await fetchPrd(url);
          return {
            content: [
              ...(result.screenshot
                ? [
                    {
                      type: "text",
                      text: result.html,
                      mimeType: "text/html",
                    },
                    {
                      type: "image",
                      data: result.screenshot.replace(
                        /^data:image\/png;base64,/,
                        ""
                      ),
                      mimeType: "image/png",
                    },
                  ]
                : [
                    {
                      type: "text",
                      text: result.html,
                      mimeType: "text/html",
                    },
                  ]),
              {
                type: "text",
                text: JSON.stringify({ projectNameMap }, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: "获取PRD内容失败：" + error,
                mimeType: "text/plain",
              },
            ],
          };
        }
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
  server.tool(
    "search_documents",
    "搜索文档内容，支持智能匹配和关键词搜索",
    {
      query: z.string().describe("搜索关键词，如 yishou"),
    },
    async ({ query }: { query: string }) => {
      const result = await searchDocuments(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                results: result.map((result) => ({
                  title: result.title,
                  project: result.project,
                  version: result.version,
                  url: result.url,
                  summary: result.summary,
                  relevance: result.relevance,
                  matchType: result.matchType,
                  matchedKeywords: result.matchedKeywords,
                  pages: result.pages,
                })),
              },
              null,
              2
            ),
            mimeType: "application/json",
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
}

export { registerTools };
