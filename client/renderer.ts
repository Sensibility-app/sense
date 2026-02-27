import type { ContentPart } from "../shared/messages.ts";

const MARKDOWN_DEBOUNCE_MS = 50;

type RenderBlock =
  | { type: "user"; content: string }
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentPart[]; is_error: boolean }
  | { type: "server_tool_use"; id: string; name: string; input: unknown }
  | { type: "system"; content: string; level: string };

export class Renderer {
  private markdownTimer: number | null = null;
  private pendingMarkdown: { element: HTMLElement; text: string } | null = null;

  constructor(
    private output: HTMLElement,
    private submitBtn: HTMLElement,
    private stopBtn: HTMLElement,
  ) {
    this.configureMarked();
  }

  private configureMarked(): void {
    const configure = () => {
      try {
        (window as unknown as { marked: { setOptions: (opts: object) => void } }).marked.setOptions({
          breaks: true,
          gfm: true,
          headerIds: false,
          mangle: false,
        });
      } catch { /* marked config may fail before library loads */ }
    };
    if ((globalThis as unknown as { marked?: unknown }).marked) {
      configure();
    } else {
      globalThis.addEventListener("DOMContentLoaded", configure);
    }
  }

  private parseMarkdown(text: string): string {
    try {
      return (window as unknown as { marked: { parse: (t: string) => string } }).marked.parse(text);
    } catch {
      return text;
    }
  }

  private lastElement(): Element | null {
    return this.output.lastElementChild;
  }

  clear(): void {
    this.output.innerHTML = "";
    this.flushMarkdown();
  }

  addBlock(block: RenderBlock): void {
    switch (block.type) {
      case "user":
        this.createUserBlock(block.content);
        break;

      case "thinking": {
        const last = this.lastElement();
        if (last?.classList.contains("thinking")) {
          const content = last.querySelector(".thinking-content") as HTMLElement;
          const currentText = content.dataset.rawText || "";
          const newText = currentText + block.content;
          content.dataset.rawText = newText;
          this.scheduleMarkdown(content, newText);
        } else {
          this.createThinkingBlock(block.content);
        }
        break;
      }

      case "text": {
        const last = this.lastElement();
        if (last?.classList.contains("assistant")) {
          const content = last.querySelector(".message-content") as HTMLElement;
          const currentText = content.dataset.rawText || "";
          const newText = currentText + block.content;
          content.dataset.rawText = newText;
          this.scheduleMarkdown(content, newText);
        } else {
          this.createTextBlock(block.content);
        }
        break;
      }

      case "tool_use":
        this.createToolUseBlock(block.id, block.name, block.input);
        break;

      case "server_tool_use":
        this.createToolUseBlock(block.id, block.name, block.input);
        break;

      case "tool_result": {
        const toolEl = this.output.querySelector(`[data-tool-id="${block.tool_use_id}"]`) as HTMLElement;
        if (toolEl) {
          if (block.is_error) {
            toolEl.classList.add("error");
          }
          const content = toolEl.querySelector(".tool-content") as HTMLElement;
          this.renderToolResultContent(content, block.content);
        }
        break;
      }

      case "system":
        this.createSystemBlock(block.content, block.level);
        break;
    }
  }

  private createUserBlock(content: string): void {
    const el = document.createElement("div");
    el.className = "message user";
    const inner = document.createElement("div");
    inner.className = "message-content";
    inner.innerHTML = this.parseMarkdown(content);
    el.appendChild(inner);
    this.output.appendChild(el);
  }

  private createThinkingBlock(content: string): void {
    const el = document.createElement("div");
    el.className = "message thinking";

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Thinking";
    details.appendChild(summary);

    const inner = document.createElement("div");
    inner.className = "thinking-content";
    inner.dataset.rawText = content;
    inner.innerHTML = this.parseMarkdown(content);
    details.appendChild(inner);

    el.appendChild(details);
    this.output.appendChild(el);
  }

  private createTextBlock(content: string): void {
    const el = document.createElement("div");
    el.className = "message assistant";

    const inner = document.createElement("div");
    inner.className = "message-content";
    inner.dataset.rawText = content;
    inner.innerHTML = this.parseMarkdown(content);

    el.appendChild(inner);
    this.output.appendChild(el);
  }

  private createToolUseBlock(id: string, name: string, input: unknown): void {
    const el = document.createElement("div");
    el.className = "message tool";
    el.dataset.toolId = id;

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = name;
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "tool-content";

    const inputPre = document.createElement("pre");
    inputPre.textContent = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    content.appendChild(inputPre);

    details.appendChild(content);
    el.appendChild(details);
    this.output.appendChild(el);
  }

  private createSystemBlock(content: string, level: string): void {
    const el = document.createElement("div");
    el.className = `message system${level === "error" ? " error" : ""}`;
    const inner = document.createElement("div");
    inner.className = "message-content";
    inner.textContent = content;
    el.appendChild(inner);
    this.output.appendChild(el);
  }

  private renderToolResultContent(container: HTMLElement, content: string | ContentPart[]): void {
    if (typeof content === "string") {
      const pre = document.createElement("pre");
      pre.className = "tool-output";
      pre.textContent = content;
      container.appendChild(pre);
      return;
    }
    for (const part of content) {
      if (part.type === "text") {
        const pre = document.createElement("pre");
        pre.className = "tool-output";
        pre.textContent = part.text;
        container.appendChild(pre);
      } else if (part.type === "image") {
        const img = document.createElement("img");
        img.className = "tool-output-image";
        img.src = `data:${part.source.media_type};base64,${part.source.data}`;
        img.alt = "Tool output";
        container.appendChild(img);
      }
    }
  }

  private scheduleMarkdown(element: HTMLElement, text: string): void {
    this.pendingMarkdown = { element, text };
    if (this.markdownTimer !== null) {
      clearTimeout(this.markdownTimer);
    }
    this.markdownTimer = setTimeout(() => {
      this.flushMarkdown();
    }, MARKDOWN_DEBOUNCE_MS);
  }

  private flushMarkdown(): void {
    if (this.markdownTimer !== null) {
      clearTimeout(this.markdownTimer);
      this.markdownTimer = null;
    }
    if (this.pendingMarkdown) {
      this.pendingMarkdown.element.innerHTML = this.parseMarkdown(this.pendingMarkdown.text);
      this.pendingMarkdown = null;
    }
  }

  finishTask(): void {
    this.flushMarkdown();
    this.setProcessing(false);
  }

  setProcessing(processing: boolean): void {
    this.submitBtn.style.display = processing ? "none" : "flex";
    this.stopBtn.style.display = processing ? "flex" : "none";
  }

  saveScrollPosition(): void {
    sessionStorage.setItem("scrollPosition", String(globalThis.scrollY || document.documentElement.scrollTop));

    const openDetails: number[] = [];
    this.output.querySelectorAll("details").forEach((el, i) => {
      if (el.open) openDetails.push(i);
    });
    sessionStorage.setItem("openDetails", JSON.stringify(openDetails));
  }

  restoreScrollPosition(): void {
    const openDetails = sessionStorage.getItem("openDetails");
    if (openDetails) {
      const indices = JSON.parse(openDetails) as number[];
      this.output.querySelectorAll("details").forEach((el, i) => {
        if (indices.includes(i)) el.open = true;
      });
      sessionStorage.removeItem("openDetails");
    }

    const scrollPos = sessionStorage.getItem("scrollPosition");
    if (scrollPos !== null) {
      requestAnimationFrame(() => {
        globalThis.scrollTo({ top: Number(scrollPos) });
        sessionStorage.removeItem("scrollPosition");
      });
    }
  }
}
