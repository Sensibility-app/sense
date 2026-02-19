import { createTool, PERMISSIONS, ToolResult } from "./_shared/tool-utils.ts";

export const { definition, permissions, executor } = createTool(
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo. Returns search results with titles, snippets, and URLs. Useful for finding current information, recent events, or answering questions that require up-to-date knowledge.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
  },
  PERMISSIONS.EXECUTE,
  async (args: { query: string }): Promise<ToolResult> => {
    try {
      const { query } = args;
      
      // Use DuckDuckGo HTML version for search results
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        return {
          content: `Search failed: HTTP ${response.status}`,
          isError: true,
        };
      }
      
      const html = await response.text();
      
      // Parse results from HTML (basic extraction)
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      
      // Extract result blocks (simplified parsing)
      const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
      
      let match;
      let count = 0;
      while ((match = resultPattern.exec(html)) !== null && count < 8) {
        const url = match[1].replace(/^\/\/duckduckgo\.com\/l\/\?.*?uddg=/, '').split('&')[0];
        const title = match[2].replace(/<[^>]*>/g, '').trim();
        const snippet = match[3].replace(/<[^>]*>/g, '').trim();
        
        if (url && title && snippet) {
          try {
            const decodedUrl = decodeURIComponent(url);
            if (decodedUrl.startsWith('http')) {
              results.push({ title, url: decodedUrl, snippet });
              count++;
            }
          } catch {
            // Skip invalid URLs
          }
        }
      }
      
      if (results.length === 0) {
        return {
          content: "No search results found. The query might be too specific or DuckDuckGo returned no results.",
          isError: false,
        };
      }
      
      const formatted = results.map((r, i) => 
        `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`
      ).join('\n\n');
      
      return {
        content: `Search results for "${query}":\n\n${formatted}`,
        isError: false,
      };
    } catch (error) {
      return {
        content: `Search error: ${error.message}`,
        isError: true,
      };
    }
  }
);
