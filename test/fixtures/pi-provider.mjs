// A deterministic model drives real pi tool execution without network requests or credentials.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function fixtureProvider(pi) {
  pi.registerProvider("desktop-fixture", {
    api: "desktop-fixture",
    baseUrl: "http://unused.invalid",
    apiKey: "unused-test-placeholder",
    models: [{ id: "fixture", name: "Desktop fixture", api: "desktop-fixture", reasoning: false,
      input: ["text", "image"], contextWindow: 128000, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const last = context.messages.filter(message => message.role !== "system").at(-1);
      const calls = last?.role === "user" ? JSON.parse(last.content.filter(part => part.type === "text").map(part => part.text).join("")) : [];
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), content: [], stopReason: "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "start", partial: message });
      if (calls.length) {
        for (const [contentIndex, call] of calls.entries()) {
          const toolCall = { type: "toolCall", id: `fixture-${Date.now()}-${contentIndex}`, name: call.name, arguments: call.args };
          message.content.push(toolCall);
          stream.push({ type: "toolcall_start", contentIndex, partial: message });
          stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(call.args), partial: message });
          stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message });
        }
        message.stopReason = "toolUse";
      } else {
        message.content.push({ type: "text", text: "desktop fixture complete" });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "desktop fixture complete", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "desktop fixture complete", partial: message });
      }
      stream.push({ type: "done", reason: message.stopReason, message });
      stream.end();
      return stream;
    },
  });
}
