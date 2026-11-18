import type { GatewayEvent } from "./gatewayTypes";
export type { GatewayEvent } from "./gatewayTypes";

export interface Rpc {
  handleLine(line: string): void;
  request<T = unknown>(method: string, params?: object): Promise<T>;
  onEvent(cb: (ev: GatewayEvent) => void): () => void;
  onClosed(cb: (reason: string) => void): () => void;
}

/** JSON-RPC error reply; `data` is the reply's error.data (e.g. current revision on stale_*). */
export class RpcError extends Error {
  data?: any;
  code?: number;
  constructor(message: string, code?: number, data?: any) { super(message); this.name = "RpcError"; this.code = code; this.data = data; }
}

/** JSON-RPC 2.0 client over an injected line transport. */
export function createRpc(send: (line: string) => void | Promise<void>): Rpc {
  let nextId = 1;
  const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  const evCbs = new Set<(ev: GatewayEvent) => void>();
  const closeCbs = new Set<(reason: string) => void>();
  return {
    handleLine(line) {
      let m: any;
      try { m = JSON.parse(line); } catch { return; }
      if (!m || typeof m !== "object") return;
      if (m.perch === "closed") {
        const reason = typeof m.reason === "string" ? m.reason : "";
        for (const p of pending.values()) p.fail(new Error(reason || "연결이 끊어졌습니다"));
        pending.clear();
        closeCbs.forEach((cb) => cb(reason));
      } else if (m.method === "event" && m.params) evCbs.forEach((cb) => cb(m.params));
      else if (typeof m.id === "number" && pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        if (m.error) p.fail(new RpcError(m.error.message ?? String(m.error.code ?? "error"), m.error.code, m.error.data)); else p.ok(m.result);
      }
    },
    request<T>(method: string, params?: object) {
      const id = nextId++;
      return new Promise<T>((ok, fail) => {
        pending.set(id, { ok, fail });
        Promise.resolve(send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))).catch((e) => { pending.delete(id); fail(e instanceof Error ? e : new Error(String(e))); });
      });
    },
    onEvent(cb) { evCbs.add(cb); return () => { evCbs.delete(cb); }; },
    onClosed(cb) { closeCbs.add(cb); return () => { closeCbs.delete(cb); }; },
  };
}
