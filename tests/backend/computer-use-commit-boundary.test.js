"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pendingExternalCommit } = require("../../server/computer-use");

test("external account actions pause on explicit Send and Like controls", () => {
  const send = pendingExternalCommit("send AJ hello on Instagram", { action: "click", ref: "e-7", reasoning: "Click Send" }, [{ ref: "e-7", name: "Send" }], [{ action: "fill" }]);
  const like = pendingExternalCommit("like the current YouTube video", { action: "click", elementId: 12, reasoning: "Like the video" }, [{ id: 12, name: "Like this video" }], []);
  assert.equal(send.action, "click");
  assert.match(send.label, /send/i);
  assert.equal(like.elementId, 12);
});

test("navigation, recipient search, and message preparation remain pre-approval", () => {
  assert.equal(pendingExternalCommit("send AJ hello on Instagram", { action: "click", ref: "e-2", reasoning: "Open messages" }, [{ ref: "e-2", name: "Messages" }], []), null);
  assert.equal(pendingExternalCommit("send AJ hello on Instagram", { action: "press", key: "Enter", reasoning: "Search for AJ" }, [], [{ action: "fill", value: "AJ" }]), null);
  assert.equal(pendingExternalCommit("send AJ hello on Instagram", { action: "fill", ref: "e-9", value: "hello", reasoning: "Prepare the message" }, [{ ref: "e-9", name: "Message" }], []), null);
});

test("ordinary non-consequential browsing never creates a commit gate", () => {
  assert.equal(pendingExternalCommit("open the latest Sidemen video", { action: "click", ref: "e-4", reasoning: "Open the top result" }, [{ ref: "e-4", name: "Sidemen road trip" }], []), null);
});
