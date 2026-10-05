import http from "node:http";

async function testModel() {
  console.log("=== Testing qwen3:4b-instruct-2507 Ollama Model ===");

  const req = http.request(
    "http://127.0.0.1:11434/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk.toString();
      });
      res.on("end", () => {
        console.log("Status:", res.statusCode);
        const lines = text.trim().split("\n");
        let content = "";
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) content += parsed.message.content;
          } catch {}
        }
        console.log("Response Content:\n", content);
        console.log("Has think tags?:", content.includes("<think>"));
      });
    }
  );

  req.write(
    JSON.stringify({
      model: "qwen3:4b-instruct-2507",
      stream: false,
      think: false,
      messages: [{ role: "user", content: "Say hello and give a 1-sentence response." }],
    })
  );
  req.end();
}

testModel().catch(console.error);
