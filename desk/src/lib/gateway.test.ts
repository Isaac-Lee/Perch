import { describe, expect, it } from "vitest";
import { createRpc, type GatewayEvent } from "./gateway";

describe("createRpc", () => {
  it("matches replies to requests and rejects errors", async () => {
    const sent: string[] = [];
    const rpc = createRpc((l) => { sent.push(l); });
    const a = rpc.request<{ ok: number }>("m1", { x: 1 });
    const b = rpc.request("m2");
    expect(JSON.parse(sent[0])).toEqual({ jsonrpc: "2.0", id: 1, method: "m1", params: { x: 1 } });
    rpc.handleLine('{"jsonrpc":"2.0","id":2,"error":{"code":4001,"message":"invalid_params"}}');
    rpc.handleLine('{"jsonrpc":"2.0","id":1,"result":{"ok":1}}');
    await expect(a).resolves.toEqual({ ok: 1 });
    await expect(b).rejects.toThrow("invalid_params");
  });

  it("keeps error.data and code on the rejection", async () => {
    const rpc = createRpc(() => {});
    const p = rpc.request("m");
    rpc.handleLine('{"jsonrpc":"2.0","id":1,"error":{"code":4009,"message":"stale_revision","data":{"revision":3,"execution_generation":2}}}');
    await expect(p).rejects.toMatchObject({ message: "stale_revision", code: 4009, data: { revision: 3, execution_generation: 2 } });
  });

  it("delivers events, ignores garbage, fails pending on close", async () => {
    const rpc = createRpc(() => {});
    const evs: GatewayEvent[] = [];
    rpc.onEvent((e) => evs.push(e));
    let closed = "";
    rpc.onClosed((r) => { closed = r; });
    rpc.handleLine("not json");
    rpc.handleLine('{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","payload":{"text":"hi"},"session_id":"s"}}');
    expect(evs).toEqual([{ type: "message.delta", payload: { text: "hi" }, session_id: "s" }]);
    const p = rpc.request("x");
    rpc.handleLine('{"perch":"closed","reason":"eof"}');
    await expect(p).rejects.toThrow();
    expect(closed).toBe("eof");
  });
});
