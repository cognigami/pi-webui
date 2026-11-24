import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  isConversationRecord,
  renderRecord,
  renderText,
  renderTimeline,
  safeText,
} from "./app.js";
import { bulk, createView, toggle } from "./model.js";

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
test("conversation visibility follows chat roles and explicit display; setup records remain opt-in", () => {
  const { view } = setup();
  for (const type of [
    "model_change",
    "thinking_level_change",
    "custom",
    "context_edit",
    "future_entry",
  ])
    assert.equal(
      !!isConversationRecord(view, { id: type, type, data: { type } }),
      false,
    );
  assert.equal(
    !!isConversationRecord(view, { type: "message", role: "system" }),
    false,
  );
  for (const role of ["user", "assistant", "toolResult"])
    assert.equal(isConversationRecord(view, { type: "message", role }), true);
  for (const type of ["compaction", "branch_summary"])
    assert.equal(isConversationRecord(view, { type }), true);
  assert.equal(
    isConversationRecord(view, { type: "custom", isError: true }),
    true,
  );
  assert.equal(
    isConversationRecord(view, {
      type: "custom_message",
      data: { display: true },
    }),
    true,
  );
  assert.equal(
    !!isConversationRecord(view, {
      type: "custom_message",
      data: { display: false },
    }),
    false,
  );
});
test("deferred custom-message visibility uses bounded display metadata before full expansion", () => {
  const { view } = setup();
  const hidden = {
    id: "hidden",
    type: "custom_message",
    display: false,
    deferred: true,
  };
  const visible = {
    id: "visible",
    type: "custom_message",
    display: true,
    deferred: true,
  };
  assert.equal(!!isConversationRecord(view, hidden), false);
  assert.equal(isConversationRecord(view, visible), true);
  view.full.set("hidden", { type: "custom_message", display: false });
  assert.equal(!!isConversationRecord(view, hidden), false);
  assert.equal(
    isConversationRecord(view, {
      id: "default",
      type: "custom_message",
      deferred: true,
    }),
    true,
  );
});
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
        parentToolCallId: "parent-call",
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
  assert.match(
    article.querySelector(".disclosure-body").textContent,
    /parent-call/,
  );
  assert.equal(
    [...article.children].some(
      (node) =>
        node.tagName === "P" && node.textContent.includes("parent-call"),
    ),
    false,
  );
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

const message = (id, role, content, fields = {}) => ({
  id,
  type: "message",
  role,
  data: { type: "message", message: { role, content, ...fields } },
});
const thought = (thinking) => ({ type: "thinking", thinking });
const text = (value) => ({ type: "text", text: value });
const call = (id) => ({
  type: "toolCall",
  id,
  name: "inspect",
  arguments: { file: "input.txt" },
});
const result = (id, toolCallId, content, fields = {}) =>
  message(id, "toolResult", content, { toolCallId, ...fields });
const helpers = { changed() {}, expand() {} };

function mount({ document, view }, entries, options) {
  const { nodes, continuation } = renderTimeline(
    document,
    view,
    entries,
    helpers,
    options,
  );
  const container = document.createElement("div");
  container.append(...nodes);
  return { container, continuation };
}

test("one Work control spans assistant records and visible prose never moves into it", () => {
  const fixture = setup();
  const entries = [
    message("u", "user", "prompt"),
    message("a", "assistant", [
      thought("first thought"),
      text("interim prose"),
      call("call"),
    ]),
    result("r", "call", "tool output"),
    message("b", "assistant", [thought("second thought"), text("final prose")]),
    message("u2", "user", "next prompt"),
    message("c", "assistant", [thought("another request")]),
  ];
  const { container } = mount(fixture, entries);
  const headers = container.querySelectorAll('[data-role="work"] button');
  assert.equal(headers.length, 2);
  assert.equal(headers[0].getAttribute("aria-expanded"), "false");
  assert.deepEqual(
    [...container.querySelectorAll("article:not([hidden]) p")].map(
      (node) => node.textContent,
    ),
    ["prompt", "interim prose", "final prose", "next prompt"],
  );
  headers[0].click();
  const opened = mount(fixture, entries).container;
  const firstGroup = [...opened.querySelectorAll("[data-work-key]")].filter(
    (part) => part.dataset.workKey === headers[0].dataset.focusKey,
  );
  assert.equal(firstGroup.length, 3);
  assert.ok(firstGroup.every((part) => !part.hidden));
  assert.ok(firstGroup.every((part) => part.classList.contains("tool-record")));
  const paragraphOrder = [
    ...opened.querySelectorAll("article:not([hidden]) > p"),
  ].map((node) => node.textContent);
  assert.deepEqual(paragraphOrder, [
    "prompt",
    "first thought",
    "interim prose",
    "second thought",
    "final prose",
    "next prompt",
  ]);
  assert.equal(opened.querySelectorAll('[data-role="assistant"]').length, 2);
  assert.equal(opened.querySelectorAll('[data-role="toolResult"]').length, 1);
  const pair = opened.querySelector('[data-record="r"]');
  assert.equal(pair.querySelectorAll("button").length, 1);
  assert.match(pair.textContent, /Arguments.*input.txt.*Result.*tool output/s);
});

test("tool pairing uses IDs and does not cross a prompt or transformation boundary", () => {
  const fixture = setup();
  const entries = [
    message("a", "assistant", [call("first"), call("second"), call("late")]),
    result("r2", "second", "second output"),
    result("r1", "first", "first output"),
    {
      id: "cut",
      type: "compaction",
      data: { type: "compaction", summary: "summary" },
    },
    result("late", "late", "after compaction"),
    message("b", "assistant", [call("new-prompt")]),
    message("u", "user", "next prompt"),
    result("orphan", "new-prompt", "new cycle output"),
  ];
  bulk(fixture.view, "tools", true);
  const { container } = mount(fixture, entries);
  const tools = [...container.querySelectorAll('[data-role="toolResult"]')];
  assert.deepEqual(
    tools.map((node) => node.dataset.record),
    ["r1", "r2", "a:work:2", "late", "b:work:0", "orphan"],
  );
  assert.match(tools[0].textContent, /first output/);
  assert.match(tools[1].textContent, /second output/);
  assert.match(tools[2].textContent, /No retained result/);
  assert.match(tools[3].textContent, /after compaction/);
  assert.doesNotMatch(tools[3].textContent, /Arguments/);
  assert.match(tools[4].textContent, /No retained result/);
  assert.match(tools[5].textContent, /new cycle output/);
  assert.equal(container.querySelectorAll('[data-role="work"]').length, 3);
  assert.match(
    container.querySelector('[data-record="cut"]').textContent,
    /Compaction/,
  );
  assert.ok(tools.every((node) => !node.hidden));
  assert.ok(
    [...container.querySelectorAll('[data-role="work"] button')].every(
      (node) => node.getAttribute("aria-expanded") === "false",
    ),
  );
});

test("one tool trigger reveals its result after intervening prose rather than moving the prose or output", () => {
  const fixture = setup();
  const entries = [
    message("u", "user", "prompt"),
    message("a", "assistant", [call("call"), text("intervening prose")]),
    result("r", "call", "tool output", { isError: true }),
  ];
  const closed = mount(fixture, entries).container;
  const tool = closed.querySelector('[data-record="r"] button');
  const output = closed.querySelector('[data-record="r:output"]');
  assert.equal(
    tool.closest("article").nextElementSibling.textContent,
    "Assistantintervening prose",
  );
  assert.equal(output.previousElementSibling.dataset.role, "assistant");
  assert.equal(output.hidden, false);
  assert.equal(output.querySelector(".disclosure-body").hidden, true);
  assert.match(output.querySelector(".error").textContent, /Tool error/);
  assert.ok(tool.getAttribute("aria-controls").split(" ").includes(output.id));
  assert.equal(output.querySelector("button"), null);
  tool.click();
  const opened = mount(fixture, entries).container;
  assert.match(
    opened.querySelector('[data-record="r"] pre').textContent,
    /input.txt/,
  );
  assert.equal(
    opened.querySelector('[data-record="r:output"] .disclosure-body').hidden,
    false,
  );
  assert.match(
    opened.querySelector('[data-record="r:output"]').textContent,
    /tool output/,
  );
});

test("a collapsed Work section leaves tool errors and unresolved live progress visible", () => {
  const fixture = setup();
  const entries = [
    message("u", "user", "prompt"),
    message("a", "assistant", [thought("analysis"), call("failed")]),
    result("r", "failed", "failure output", {
      isError: true,
      parentToolCallId: "outer",
    }),
    message("error", "assistant", [thought("failed attempt")], {
      stopReason: "aborted",
    }),
  ];
  const retained = mount(fixture, entries);
  const failed = retained.container.querySelector('[data-record="r"]');
  assert.equal(failed.hidden, false);
  assert.equal(failed.querySelector(".error").textContent, "Tool error");
  assert.equal(failed.querySelector(".disclosure-body").hidden, true);
  assert.match(failed.textContent, /Nested under outer/);
  assert.match(
    retained.container.querySelector('[data-record="error"] .error')
      .textContent,
    /Response aborted/,
  );

  const liveEntries = [
    message("live-assistant", "assistant", [
      thought("more thinking"),
      call("live"),
    ]),
  ];
  const live = mount(fixture, liveEntries, {
    live: true,
    continuation: retained.continuation,
    tools: [
      {
        type: "tool_execution_update",
        toolCallId: "live",
        partialResult: { content: [text("partial output")] },
      },
    ],
  }).container;
  assert.equal(live.querySelector('[data-role="work"]'), null);
  assert.equal(live.querySelector('[data-role="thinking"]').hidden, true);
  const unfinished = live.querySelector('[data-role="toolResult"]');
  assert.equal(unfinished.hidden, false);
  assert.match(unfinished.querySelector("button").textContent, /In progress/);
  assert.equal(
    unfinished.querySelector("button").dataset.focusKey,
    "result:live",
  );
  assert.match(
    unfinished.textContent,
    /Arguments.*input.txt.*Partial result.*partial output/s,
  );
  toggle(fixture.view, "tools", "result:live", true);
  const ended = mount(fixture, liveEntries, {
    live: true,
    continuation: retained.continuation,
    tools: [
      {
        type: "tool_execution_end",
        toolCallId: "live",
        result: { content: [text("settled output")] },
      },
    ],
  }).container;
  assert.equal(ended.querySelectorAll('[data-role="toolResult"]').length, 1);
  const button = ended.querySelector("button");
  assert.equal(
    button.dataset.focusKey,
    unfinished.querySelector("button").dataset.focusKey,
  );
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.doesNotMatch(button.textContent, /In progress/);
  assert.match(ended.textContent, /settled output/);
});

test("deferred results keep their load control until their retained ID can be paired", () => {
  const fixture = setup();
  const entries = [
    message("a", "assistant", [call("lookup")]),
    {
      id: "large",
      type: "message",
      role: "toolResult",
      deferred: true,
      bytes: 90000,
    },
  ];
  const pending = mount(fixture, entries).container;
  assert.match(
    pending.querySelector('[data-record="large"] button').textContent,
    /Load full retained entry/,
  );
  fixture.view.full.set("large", result("large", "lookup", "full output").data);
  toggle(fixture.view, "tools", "result:lookup", true);
  const loaded = mount(fixture, entries).container;
  const pair = loaded.querySelector('[data-record="large"]');
  assert.equal(pair.hidden, false);
  assert.equal(pair.querySelector("button").dataset.focusKey, "result:lookup");
  assert.match(pair.textContent, /Arguments.*input.txt.*full output/s);
  assert.equal(loaded.querySelectorAll('[data-role="toolResult"]').length, 1);
  fixture.view.showRecords = true;
  const raw = mount(fixture, entries).container;
  assert.equal(raw.querySelector('[data-role="work"]'), null);
  assert.match(raw.querySelector('[data-record="a"]').textContent, /Tool call/);
  assert.match(
    raw.querySelector('[data-record="large"]').textContent,
    /Tool result/,
  );
});
