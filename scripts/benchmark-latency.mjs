const baseUrl = String(process.env.JARVIS_URL || "http://127.0.0.1:8799").replace(/\/+$/, "");
const prompts = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "hi",
      "how are you",
      "what can you do",
      "what did I just ask",
      "open calculator",
      "what is the weather today in Boston",
      "explain how your memory works",
    ];

const bootstrap = await fetch(`${baseUrl}/api/capabilities`);
if (!bootstrap.ok) throw new Error(`Could not establish a JARVIS session: HTTP ${bootstrap.status}`);
const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("JARVIS did not issue a local session cookie.");

for (const prompt of prompts) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ prompt, mode: "minimal-command" }),
  });
  if (!response.ok || !response.body) throw new Error(`Benchmark request failed: HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs = null;
  let result = null;

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "delta" && firstTokenMs === null) {
        firstTokenMs = Math.round(performance.now() - started);
      }
      if (event.type === "done") result = event.result;
    }
    if (chunk.done) break;
  }

  console.log(JSON.stringify({
    prompt,
    firstTokenMs,
    completeMs: Math.round(performance.now() - started),
    serverMs: result?.timing?.totalMs,
    model: result?.model,
    modelCalls: result?.timing?.totalModelCalls,
    source: result?.source,
  }));
}
