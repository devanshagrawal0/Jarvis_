"use strict";
// Fix 3: the attachment reader must pull real text out of .docx (mammoth) and plain text, dispatch by
// mime AND by extension, and degrade to "" for things it genuinely can't read (legacy .doc, unknown
// binary) or when the image path has no API key — never throw. The image→vision path itself needs a
// live model, so here we only assert it stays offline-safe (no key ⇒ "").
// Run: node --test tests/backend/attachment-reader.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const JSZip = require("jszip");
const { createAttachmentReader } = require("../../server/attachment-reader");

const reader = createAttachmentReader({ getSettings: () => ({}) });

function dataUrl(mime, buf) {
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}

async function makeDocx(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("reads real text out of a .docx (by mime and by extension)", async () => {
  const buf = await makeDocx([
    "The quarterly automation report: all systems green.",
    "Deploys succeeded and p95 latency dropped 12 percent.",
  ]);
  const byMime = await reader.extractAttachmentText({
    name: "report", dataUrl: dataUrl("application/vnd.openxmlformats-officedocument.wordprocessingml.document", buf),
  });
  assert.match(byMime, /quarterly automation report/);
  assert.match(byMime, /latency dropped 12 percent/);

  // dispatch must also work off the file extension when the mime is generic/octet-stream
  const byExt = await reader.extractAttachmentText({ name: "report.docx", dataUrl: dataUrl("application/octet-stream", buf) });
  assert.match(byExt, /all systems green/);
});

test("passes plain text through (att.text and text/* dataUrl)", async () => {
  assert.equal(await reader.extractAttachmentText({ text: "hello world" }), "hello world");
  const t = await reader.extractAttachmentText({ name: "notes.txt", dataUrl: dataUrl("text/plain", "line one\nline two") });
  assert.equal(t, "line one\nline two");
});

test("images degrade to '' when no API key is configured (offline-safe, no throw)", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const out = await reader.extractAttachmentText({ name: "shot.png", dataUrl: dataUrl("image/png", onePixelPng) });
    assert.equal(out, "");
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test("does not pretend to read what it can't (legacy .doc, unknown binary, junk)", async () => {
  assert.equal(await reader.extractAttachmentText({ name: "old.doc", dataUrl: dataUrl("application/msword", "\x00\x01binary") }), "");
  assert.equal(await reader.extractAttachmentText({ name: "thing.bin", dataUrl: dataUrl("application/octet-stream", "\x00\x01\x02") }), "");
  assert.equal(await reader.extractAttachmentText(null), "");
  assert.equal(await reader.extractAttachmentText({ dataUrl: "not-a-data-url" }), "");
});
