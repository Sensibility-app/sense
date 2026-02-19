import { createTool, PERMISSIONS, ToolResult } from "./_shared/tool-utils.ts";
import { Readability } from "npm:@mozilla/readability@0.5.0";
import { JSDOM } from "npm:jsdom@23.0.1";

export const { definition, permissions, executor } = createTool(
  {
    name: "fetch_url",
    description: "Fetch content from a URL. Can retrieve web pages, API responses, or any HTTP-accessible content. Returns the response text.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch (must start with http:// or https://)",
        },
        method: {
          type: "string",
          description: "HTTP method to use (default: GET)",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        },
        headers: {
          type: "object",
          description: "Optional HTTP headers to send",
        },
        body: {
          type: "string",
          description: "Optional request body (for POST/PUT/PATCH)",
        },
        extract_content: {
          type: "boolean",
          description: "If true, extracts main article content and converts to readable text (default: false)",
        },
      },
      required: ["url"],
    },
  },
  PERMISSIONS.EXECUTE,
  async (args: { 
    url: string; 
    method?: string; 
    headers?: Record<string, string>;
    body?: string;
    extract_content?: boolean;
  }): Promise<ToolResult> => {
    try {
      const { url, method = "GET", headers, body, extract_content = false } = args;

      // Basic URL validation
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: "Error: URL must start with http:// or https://",
          isError: true,
        };
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      const text = await response.text();

      if (!response.ok) {
        return {
          content: `HTTP ${response.status} ${response.statusText}\n\n${text}`,
          isError: true,
        };
      }

      // If extract_content is true, use Readability to extract main content
      if (extract_content) {
        try {
          const dom = new JSDOM(text, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          
          if (article) {
            let content = `# ${article.title}\n\n`;
            if (article.byline) {
              content += `By ${article.byline}\n\n`;
            }
            content += article.textContent;
            
            return {
              content,
              isError: false,
            };
          } else {
            return {
              content: "Could not extract article content from this page. Try without extract_content parameter.",
              isError: true,
            };
          }
        } catch (extractError) {
          return {
            content: `Content extraction failed: ${extractError.message}\n\nRaw HTML length: ${text.length} characters`,
            isError: true,
          };
        }
      }

      return {
        content: text,
        isError: false,
      };
    } catch (error) {
      return {
        content: `Fetch failed: ${error.message}`,
        isError: true,
      };
    }
  }
);
