"use strict";

// Caching a face is a small job with two ways to fail silently, and both produce an address book
// that looks finished and is not:
//
//   1. saving whatever came back. Instagram answers an expired image URL with an HTML error page
//      and a 200, so "it downloaded fine" and "there is a picture" are different claims. Written to
//      avatar.jpg, that page renders as a broken tile — indistinguishable from a UI bug;
//   2. trusting the remote server for the filename, which is how a download escapes its directory.
//
// Both are asserted below, because neither shows up in a manual check that only ever fetches a real
// image from a working URL.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAvatarCache, imageKind } = require("../../server/contact-avatars");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Buffer.from("GIF89a-------", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "latin1")]);
const HTML = Buffer.from("<!doctype html><html><body>Page Not Found</body></html>", "utf8");

function cache() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "avatars-"));
  return { cache: createAvatarCache({ runtimeDir }), runtimeDir, cleanup: () => fs.rmSync(runtimeDir, { recursive: true, force: true }) };
}

// A stand-in for fetch that returns exactly the bytes named, with a 200 like the real failure does.
function respondWith(buffer, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) });
}

test("the real format is read from the bytes, not claimed by the server", () => {
  assert.equal(imageKind(JPEG), "jpg");
  assert.equal(imageKind(PNG), "png");
  assert.equal(imageKind(GIF), "gif");
  assert.equal(imageKind(WEBP), "webp");
  assert.equal(imageKind(HTML), "", "an HTML error page is not an image");
  assert.equal(imageKind(Buffer.alloc(0)), "");
});

test("an error page served as an image is refused, not saved", async () => {
  // The failure this module exists for. Without the signature check this writes a file called
  // <id>.jpg containing HTML, and the UI shows a broken tile for a contact who has a perfectly
  // good photo — while every log line says the fetch succeeded.
  const { cache: avatars, cleanup } = cache();
  try {
    await assert.rejects(
      avatars.store("abc", "https://cdn.invalid/expired.jpg", { fetchImpl: respondWith(HTML) }),
      /did not return an image/,
    );
    assert.equal(avatars.existingFor("abc"), "", "nothing may be left on disk");
  } finally { cleanup(); }
});

test("a real image is stored and found again", async () => {
  const { cache: avatars, runtimeDir, cleanup } = cache();
  try {
    const stored = await avatars.store("abc", "https://cdn.invalid/face.jpg", { fetchImpl: respondWith(JPEG) });
    assert.equal(stored.kind, "jpg");
    assert.equal(stored.bytes, JPEG.length);
    assert.equal(stored.path, path.join(runtimeDir, "contact-avatars", "abc.jpg"));
    assert.equal(avatars.existingFor("abc"), stored.path);
    assert.deepEqual(fs.readFileSync(stored.path), JPEG);
  } finally { cleanup(); }
});

test("the filename comes from the contact id, never from the remote URL", async () => {
  // A path from the other end of a network connection is a path that can point anywhere. The id is
  // a UUID this process generated.
  const { cache: avatars, runtimeDir, cleanup } = cache();
  try {
    const stored = await avatars.store("abc", "https://cdn.invalid/../../../../etc/passwd.jpg", { fetchImpl: respondWith(JPEG) });
    assert.equal(path.dirname(stored.path), path.join(runtimeDir, "contact-avatars"));
    assert.equal(path.basename(stored.path), "abc.jpg");
  } finally { cleanup(); }
});

test("a hostile contact id cannot escape the cache directory", async () => {
  const { cache: avatars, runtimeDir, cleanup } = cache();
  try {
    const stored = await avatars.store("../../evil", "https://cdn.invalid/face.jpg", { fetchImpl: respondWith(JPEG) });
    assert.equal(path.dirname(stored.path), path.join(runtimeDir, "contact-avatars"));
    assert.ok(!stored.path.includes(".."), stored.path);
    await assert.rejects(avatars.store("../..", "https://cdn.invalid/f.jpg", { fetchImpl: respondWith(JPEG) }), /contact id is required/);
  } finally { cleanup(); }
});

test("changing format does not leave the old face behind to be found first", async () => {
  // existingFor() scans extensions in a fixed order, so a stale jpg would win over a fresh png and
  // the owner would swear the refresh button does nothing.
  const { cache: avatars, cleanup } = cache();
  try {
    await avatars.store("abc", "https://cdn.invalid/a.jpg", { fetchImpl: respondWith(JPEG) });
    const second = await avatars.store("abc", "https://cdn.invalid/b.png", { fetchImpl: respondWith(PNG) });
    assert.equal(second.kind, "png");
    assert.equal(avatars.existingFor("abc"), second.path);
    assert.equal(fs.readdirSync(path.dirname(second.path)).filter((name) => name.startsWith("abc.")).length, 1);
  } finally { cleanup(); }
});

test("a face is only ever fetched over https", async () => {
  const { cache: avatars, cleanup } = cache();
  try {
    for (const url of ["http://cdn.invalid/a.jpg", "file:///C:/secret.jpg", "data:image/jpeg;base64,AAA", ""]) {
      await assert.rejects(avatars.store("abc", url, { fetchImpl: respondWith(JPEG) }), /https URL/, `must refuse ${url || "(empty)"}`);
    }
  } finally { cleanup(); }
});

test("a failed request and an empty body are both refused", async () => {
  const { cache: avatars, cleanup } = cache();
  try {
    await assert.rejects(avatars.store("abc", "https://cdn.invalid/x.jpg", { fetchImpl: respondWith(JPEG, { ok: false, status: 404 }) }), /HTTP 404/);
    await assert.rejects(avatars.store("abc", "https://cdn.invalid/x.jpg", { fetchImpl: respondWith(Buffer.alloc(0)) }), /was empty/);
    assert.equal(avatars.existingFor("abc"), "");
  } finally { cleanup(); }
});

test("clearing removes the file and reports whether there was one", async () => {
  const { cache: avatars, cleanup } = cache();
  try {
    await avatars.store("abc", "https://cdn.invalid/a.jpg", { fetchImpl: respondWith(JPEG) });
    assert.equal(avatars.clear("abc"), true);
    assert.equal(avatars.existingFor("abc"), "");
    assert.equal(avatars.clear("abc"), false, "clearing nothing is not a lie about having cleared something");
  } finally { cleanup(); }
});

test("the content type served matches what was actually stored", () => {
  const { cache: avatars, cleanup } = cache();
  try {
    assert.equal(avatars.contentTypeFor("a/b/c.jpg"), "image/jpeg");
    assert.equal(avatars.contentTypeFor("a/b/c.png"), "image/png");
    assert.equal(avatars.contentTypeFor("a/b/c.webp"), "image/webp");
  } finally { cleanup(); }
});
