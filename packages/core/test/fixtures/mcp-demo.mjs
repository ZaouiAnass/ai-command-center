// Mini serveur MCP (stdio, JSON-RPC ligne à ligne) pour les tests : un outil « get_secret_word ».
import { createInterface } from "node:readline";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "demo", version: "1.0.0" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "get_secret_word", description: "Retourne le mot secret de démonstration.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] } });
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "ZEBRA-MCP-777" }] } });
  else if (m.id !== undefined && !m.method?.startsWith("notifications/")) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
