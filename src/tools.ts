// tools.ts
// MCP工具注册，原本在index.ts
import { z } from "zod";
import {
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchAndSaveAllPrd,
  fetchAllProjects,
  isProjectVersions,
  searchDocuments,
  buildDocumentIndex,
} from "./handlers.js";

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
      try {
        const keywords = ["全部", "所有", "整体"];
        const useAll = keywords.some((k) => prompt.includes(k));
        if (useAll) {
          const result = await fetchHtmlWithContentImpl(url);
          return [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
              mimeType: "application/json",
            },
          ];
        } else {
          const result = await fetchPrd(url);
          return result.screenshot
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
              ];
        }
      } catch (error: unknown) {
        console.error("smart_fetch_prd 执行失败:", error);
        return [
          {
            type: "text",
            text: `获取PRD内容失败：${error}`,
            mimeType: "text/plain",
          },
        ];
      }
    }
  );

  // 更新所有项目的PRD文档
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
      try {
        await fetchAndSaveAllPrd({ monthsToLoad });
        return [
          {
            type: "text",
            text: "成功更新所有项目的PRD文档",
            mimeType: "text/plain",
          },
        ];
      } catch (error) {
        return [
          {
            type: "text",
            text: `更新PRD文档失败: ${error}`,
            mimeType: "text/plain",
          },
        ];
      }
    }
  );

  // 搜索PRD文档
  server.tool(
    "search_prd_documents",
    "根据关键词搜索PRD文档，返回匹配的文档列表",
    {
      query: z.string().describe("搜索关键词，支持项目名、版本号、功能描述等"),
      limit: z.number().optional().describe("返回结果数量限制，默认为20"),
    },
    async ({ query, limit = 20 }: { query: string; limit?: number }) => {
      try {
        const results = await searchDocuments(query, limit);
        return [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                results: results.map((result) => ({
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
        ];
      } catch (error) {
        return [
          {
            type: "text",
            text: `搜索失败: ${error}`,
            mimeType: "text/plain",
          },
        ];
      }
    }
  );

  // 构建文档索引
  server.tool(
    "build_document_index",
    "重新从现有项目版本数据构建文档索引，用于支持智能搜索功能，默认已经构建了文档索引，如果不需要智能搜索，则不需要调用",
    {},
    async () => {
      try {
        await buildDocumentIndex();
        return [
          {
            type: "text",
            text: "文档索引构建完成",
            mimeType: "text/plain",
          },
        ];
      } catch (error) {
        return [
          {
            type: "text",
            text: `构建索引失败: ${error}`,
            mimeType: "text/plain",
          },
        ];
      }
    }
  );
}

export { registerTools };
