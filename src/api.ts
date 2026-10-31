import { fetchSyncPost } from "siyuan";
import { errorText, normalizeToken, type DidaRequest } from "./sync";

export type KernelCall = <T>(path: string, body: unknown) => Promise<T>;

export const kernel: KernelCall = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetchSyncPost(path, body);
  if (!response || response.code !== 0) {
    throw new Error(`思源 ${path} 失败：${response?.msg || "无有效响应"}`);
  }
  return response.data as T;
};

class DidaHttpError extends Error {
  constructor(readonly status: number) {
    super(`滴答 HTTP ${status}${status === 401 || status === 403 ? "（请检查 Token 与读写权限）" : ""}`);
  }
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  return body.trim() ? JSON.parse(body) : null;
}

function validateBody(body: unknown): unknown {
  if (body && typeof body === "object" && "code" in body && (body as { code: unknown }).code !== 0) {
    throw new Error("滴答 API 返回业务错误，请检查 Token、权限和网络后重试");
  }
  return body;
}

export function createDidaRequest(tokenInput: string, call: KernelCall = kernel): DidaRequest {
  const token = normalizeToken(tokenInput);
  return async (path, method = "GET", body) => {
    if (!token) throw new Error("请先配置滴答 API Token");
    const url = `https://api.dida365.com/open/v1${path}`;
    let responseBody: unknown;
    try {
      const response = await call<{ status?: number; StatusCode?: number; body?: unknown }>("/api/network/forwardProxy", {
        url, method, timeout: 20000, contentType: "application/json",
        headers: [{ Authorization: `Bearer ${token}` }], responseEncoding: "text",
        ...(body === undefined ? { payload: "", payloadEncoding: "text" } : { payload: body }),
      });
      const status = response?.status ?? response?.StatusCode ?? 0;
      if (status >= 400) throw new DidaHttpError(status);
      if (status < 200 || status >= 300) throw new Error("思源代理未返回有效 HTTP 状态码");
      responseBody = parseBody(response.body);
    } catch (error) {
      // A real HTTP error is definitive; do not repeat an unauthorized or failed mutation.
      if (error instanceof DidaHttpError) {
        if (method === "DELETE" && error.status === 404) return null;
        throw error;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, {
          method, signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (method === "DELETE" && response.status === 404) return null;
        if (!response.ok) throw new DidaHttpError(response.status);
        responseBody = parseBody(await response.text());
      } catch (directError) {
        // Never include raw response bodies, request objects or credentials in an error.
        throw new Error(`滴答请求 ${method} ${path} 失败：${errorText(directError)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    return validateBody(responseBody);
  };
}
