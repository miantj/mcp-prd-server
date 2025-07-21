// tools.ts
// MCP工具注册，原本在index.ts
import { z } from "zod";
import {
  fetchPrd,
  fetchHtmlWithContentImpl,
  fetchProjectVersions,
  fetchAllProjects,
  isProjectVersions,
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
      const keywords = ["全部", "所有", "整体"];
      const useAll = keywords.some((k) => prompt.includes(k));
      if (useAll) {
        const result = await fetchHtmlWithContentImpl(url);
        return {
          ai_end: true, // 终止标记
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
              mimeType: "text/plain",
            },
          ],
        };
      } else {
        try {
          const result = await fetchPrd(url);
          return {
            ai_end: true, // 终止标记
            content: result.screenshot
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
                ],
          };
        } catch (error) {
          return {
            ai_end: true, // 终止标记
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

  // 获取全部项目列表
  server.tool(
    "fetch_all_projects",
    "获取公司的项目列表，返回 html 字符串页面内容",
    {
      prompt: z.string().describe("用户需求描述或提示词，如：获取公司全部项目列表"),
    },
    async () => {
      const result = await fetchAllProjects();
      return {
        content: [
          {
            type: "text",
            text: result.html,
            mimeType: "text/html",
          },
        ],
      };
    }
  );

  // 获取指定项目全部版本列表
  server.tool(
    "fetch_project_versions",
    "知道项目名的前提下，获取公司指定项目的全部版本号列表，返回 html 字符串页面内容",
    {
      project: z.string().describe("项目名称，如 yishou"),
    },
    async ({ project }: { project: string }) => {
      const result = await fetchProjectVersions(project);
      return {
        content: [
          {
            type: "text",
            text: result.html,
            mimeType: "text/html",
          },
        ],
      };
    }
  );
}

export { registerTools };
