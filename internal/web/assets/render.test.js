import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { renderRecord, renderText, safeText } from "./app.js";
import { bulk, createView } from "./model.js";

const setup = () => {
  const { document } = parseHTML("<html><body></body></html>");
  const view = createView(
    {
      endpointId: "ep",
      associationId: "assoc",
      session: { id: "session" },
      state: {},
    },
    "A",
  );
  return { document, view };
};
test("Markdown-like code/text stays inert and never loads remote resources", () => {
  const { document } = setup(),
    target = document.createElement("div");
  renderText(
    document,
    target,
    '<img src="https://attacker" onerror="alert(1)">\n\n```html\n<script>evil()</script>\n```',
  );
  assert.equal(target.querySelector("img"), null);
  assert.equal(target.querySelector("script"), null);
  assert.match(target.textContent, /evil/);
  assert.ok(target.querySelector("pre code"));
  assert.equal(safeText("\u001b[31mred\u001b[0m\u0007"), "red");
});
test("tool error remains visible with result collapsed; full text available when expanded", () => {
  const { document, view } = setup();
  let changed = 0;
  const entry = {
    id: "tool",
    type: "message",
    role: "toolResult",
    isError: true,
    toolName: "test",
    data: {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "test",
        toolCallId: "call",
        isError: true,
        content: [{ type: "text", text: "retained full result" }],
      },
    },
  };
  const helpers = { changed: () => changed++, expand: () => {} };
  const article = renderRecord(document, view, entry, helpers);
  assert.match(article.querySelector(".error").textContent, /Tool error/);
  assert.equal(
    article.querySelector("button").getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(article.querySelector(".disclosure-body").hidden, true);
  article.querySelector("button").click();
  assert.equal(changed, 1);
  const expanded = renderRecord(document, view, entry, helpers);
  assert.equal(
    expanded.querySelector("button").getAttribute("aria-expanded"),
    "true",
  );
  assert.match(expanded.textContent, /retained full result/);
});
test("thinking uses explicit source blocks and independent bulk settings", () => {
  const { document, view } = setup();
  bulk(view, "thinking", true);
  const entry = {
    id: "assistant",
    type: "message",
    role: "assistant",
    data: {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "actual thought" },
          { type: "text", text: "answer" },
        ],
      },
    },
  };
  const article = renderRecord(document, view, entry, {
    changed: () => {},
    expand: () => {},
  });
  assert.equal(
    article.querySelector("button").getAttribute("aria-expanded"),
    "true",
  );
  assert.match(article.textContent, /actual thought/);
});
test("unknown/image content has explicit fallback, never active media", () => {
  const { document, view } = setup();
  const entry = {
    id: "assistant",
    type: "message",
    data: {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "image", url: "https://attacker/image" },
          { type: "future_block", html: '<iframe src="x">' },
        ],
      },
    },
  };
  const article = renderRecord(document, view, entry, {
    changed: () => {},
    expand: () => {},
  });
  assert.equal(article.querySelector("img,iframe"), null);
  assert.match(article.textContent, /automatic resource loading disabled/i);
  assert.match(article.textContent, /future_block/);
});
test("deferred entry offers complete expansion rather than a silent truncated preview", () => {
  const { document, view } = setup();
  let requested;
  const entry = {
    id: "large",
    type: "message",
    role: "toolResult",
    isError: true,
    bytes: 200000,
    deferred: true,
  };
  const article = renderRecord(document, view, entry, {
    changed: () => {},
    expand: (entry) => {
      requested = entry.id;
    },
  });
  assert.match(article.textContent, /200000 bytes/);
  assert.match(article.textContent, /Tool error/);
  article.querySelector("button").click();
  assert.equal(requested, "large");
});
