// ─── Anthropic API Types ──────────────────────────────────────────────────────

export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  system?: SystemContent;
  messages: MessageParam[];
  tools?: Tool[];
  stream?: boolean;
  thinking?: ThinkingConfig;
}

export type SystemContent =
  | string
  | Array<{ type: "text"; text: string; cache_control?: CacheControl }>;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | RequestContentBlock[];
}

export type RequestContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

export interface CacheControl {
  type: "ephemeral";
}

export interface ThinkingConfig {
  type: "enabled" | "disabled";
  budget_tokens?: number;
}

export interface Message {
  id: string;
  type: "message";
  role: "assistant";
  content: ResponseContentBlock[];
  stop_reason: string | null;
  usage: Usage;
}

export type ResponseContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ─── Stream Event Types ───────────────────────────────────────────────────────

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent;

export interface MessageStartEvent {
  type: "message_start";
  message: { usage: Usage };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "thinking" }
    | { type: "text" }
    | { type: "tool_use"; id: string; name: string };
}

export type ContentDelta =
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string }
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string };

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: ContentDelta;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string };
  usage: { output_tokens: number };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface PingEvent {
  type: "ping";
}

// ─── Client Interface ─────────────────────────────────────────────────────────

export interface LLMClient {
  messages: {
    create(params: MessageCreateParams & { stream: true }): Promise<AsyncIterable<StreamEvent>>;
    create(params: MessageCreateParams & { stream?: false }): Promise<Message>;
    create(params: MessageCreateParams): Promise<Message | AsyncIterable<StreamEvent>>;
  };
}

// ─── Transport Layer ──────────────────────────────────────────────────────────

type Transport = (
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

function createHttpTransport(baseUrl: string, apiKey?: string): Transport {
  return async (method, path, body, headers) => {
    const url = `${baseUrl}${path}`;
    const reqHeaders = new Headers(headers);
    if (apiKey) reqHeaders.set("x-api-key", apiKey);

    return fetch(url, { method, headers: reqHeaders, body });
  };
}

function createSocketTransport(socketPath: string): Transport {
  return async (method, path, body, headers) => {
    const conn = await Deno.connect({ transport: "unix", path: socketPath });

    const bodyBytes = body ? new TextEncoder().encode(body) : null;
    const reqLines = [
      `${method} ${path} HTTP/1.1`,
      "Host: llm-proxy",
      "Accept: application/json",
    ];
    if (headers) {
      for (const [k, v] of Object.entries(headers)) reqLines.push(`${k}: ${v}`);
    }
    if (bodyBytes) {
      reqLines.push("Content-Type: application/json");
      reqLines.push(`Content-Length: ${bodyBytes.length}`);
    }
    reqLines.push("", "");

    await writeAllBytes(conn, new TextEncoder().encode(reqLines.join("\r\n")));
    if (bodyBytes) await writeAllBytes(conn, bodyBytes);

    const { status, headers: respHeaders, leftover } = await readResponseHeaders(conn);

    const isChunked = respHeaders.get("transfer-encoding")?.includes("chunked") ?? false;
    const bodyStream = createConnectionBodyStream(conn, leftover, isChunked);

    return new Response(bodyStream, { status, headers: respHeaders });
  };
}

async function writeAllBytes(conn: Deno.Conn, data: Uint8Array): Promise<void> {
  let written = 0;
  while (written < data.length) {
    written += await conn.write(data.subarray(written));
  }
}

async function readResponseHeaders(conn: Deno.Conn): Promise<{
  status: number;
  headers: Headers;
  leftover: Uint8Array;
}> {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(4096);
  const separator = new TextEncoder().encode("\r\n\r\n");

  while (true) {
    const n = await conn.read(buf);
    if (n === null) throw new Error("Connection closed before headers complete");
    chunks.push(buf.slice(0, n));

    const combined = concatBytes(chunks);
    const sepIdx = findBytes(combined, separator);
    if (sepIdx === -1) continue;

    const headerBytes = combined.subarray(0, sepIdx);
    const leftover = combined.subarray(sepIdx + 4);
    const headerText = new TextDecoder().decode(headerBytes);
    const [statusLine, ...headerLines] = headerText.split("\r\n");

    const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;

    const headers = new Headers();
    for (const line of headerLines) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        headers.append(line.substring(0, idx).trim(), line.substring(idx + 1).trim());
      }
    }

    return { status, headers, leftover };
  }
}

function createConnectionBodyStream(
  conn: Deno.Conn,
  leftover: Uint8Array,
  chunked: boolean,
): ReadableStream<Uint8Array> {
  let leftoverConsumed = false;

  const raw = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!leftoverConsumed && leftover.length > 0) {
        leftoverConsumed = true;
        controller.enqueue(leftover);
        return;
      }
      try {
        const buf = new Uint8Array(8192);
        const n = await conn.read(buf);
        if (n === null) {
          controller.close();
          try { conn.close(); } catch { void 0; }
          return;
        }
        controller.enqueue(buf.slice(0, n));
      } catch {
        controller.close();
        try { conn.close(); } catch { void 0; }
      }
    },
    cancel() {
      try { conn.close(); } catch { void 0; }
    },
  });

  if (!chunked) return raw;
  return raw.pipeThrough(createChunkedDecoder());
}

function createChunkedDecoder(): TransformStream<Uint8Array, Uint8Array> {
  let buffer: Uint8Array = new Uint8Array(0);

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      buffer = concatBytes([buffer, chunk]);

      while (true) {
        const crlfIdx = findBytes(buffer, CRLF);
        if (crlfIdx === -1) return;

        const sizeLine = new TextDecoder().decode(buffer.subarray(0, crlfIdx)).trim();
        const chunkSize = parseInt(sizeLine.split(";")[0], 16);

        if (isNaN(chunkSize) || chunkSize === 0) {
          controller.terminate();
          return;
        }

        const dataStart = crlfIdx + 2;
        const dataEnd = dataStart + chunkSize;
        const trailingEnd = dataEnd + 2;

        if (buffer.length < trailingEnd) return;

        controller.enqueue(buffer.subarray(dataStart, dataEnd));
        buffer = buffer.subarray(trailingEnd);
      }
    },
  });
}

const CRLF = new TextEncoder().encode("\r\n");

// ─── SSE Parser ───────────────────────────────────────────────────────────────

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const part of parts) {
        const event = parseOneSSEEvent(part);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseOneSSEEvent(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseOneSSEEvent(raw: string): StreamEvent | null {
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  const joined = dataLines.join("");
  if (!joined.trim()) return null;

  try {
    return JSON.parse(joined) as StreamEvent;
  } catch {
    return null;
  }
}

// ─── Client Factory ───────────────────────────────────────────────────────────

const LLM_SOCKET_PATH = "/run/llm.sock";
const ANTHROPIC_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA = "interleaved-thinking-2025-05-14";

export interface ClientConfig {
  socketPath?: string;
  baseUrl?: string;
  apiKey?: string;
}

export function createClient(config?: ClientConfig): LLMClient {
  const transport = resolveTransport(config);

  return {
    messages: {
      async create(params: MessageCreateParams): Promise<Message | AsyncIterable<StreamEvent>> {
        const reqHeaders: Record<string, string> = {
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-beta": ANTHROPIC_BETA,
        };

        const body = JSON.stringify(params);
        const response = await transport("POST", "/v1/messages", body, reqHeaders);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LLM API error (${response.status}): ${errorText}`);
        }

        if (params.stream && response.body) {
          return parseSSE(response.body);
        }

        return await response.json() as Message;
      },
    } as LLMClient["messages"],
  };
}

function resolveTransport(config?: ClientConfig): Transport {
  if (config?.socketPath) {
    return createSocketTransport(config.socketPath);
  }

  if (config?.baseUrl) {
    return createHttpTransport(config.baseUrl, config.apiKey);
  }

  if (socketExists(LLM_SOCKET_PATH)) {
    return createSocketTransport(LLM_SOCKET_PATH);
  }

  const proxyUrl = Deno.env.get("LLM_PROXY_URL");
  if (proxyUrl) {
    return createHttpTransport(proxyUrl);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (apiKey) {
    return createHttpTransport(ANTHROPIC_BASE, apiKey);
  }

  throw new Error(
    "No LLM transport available. Set LLM_PROXY_URL, ANTHROPIC_API_KEY, or mount socket at /run/llm.sock",
  );
}

function socketExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Byte Utilities ───────────────────────────────────────────────────────────

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
