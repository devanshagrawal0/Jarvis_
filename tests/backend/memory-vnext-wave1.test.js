const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixturePath = path.join(__dirname, '..', 'fixtures', 'memory-vnext', 'jarvis-memory-bench-wave1.json');

test('Wave 1 memory benchmark fixture is sanitized and structurally complete', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(Array.isArray(fixture.cases));
  assert.ok(fixture.cases.length >= 30);

  const ids = new Set();
  const suites = new Set();
  const serialized = JSON.stringify(fixture);
  for (const item of fixture.cases) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `duplicate case id: ${item.id}`);
    ids.add(item.id);
    suites.add(item.suite);
    assert.equal(typeof item.query, 'string');
    assert.ok(item.query.length > 0);
    assert.ok(item.expected && typeof item.expected === 'object');
  }

  for (const required of ['continuity', 'correction', 'scope', 'forget', 'routing', 'cache', 'consistency', 'workers', 'security']) {
    assert.ok(suites.has(required), `missing required suite: ${required}`);
  }

  assert.doesNotMatch(serialized, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(serialized, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(serialized, /C:\\Users\\devan/i);
});

