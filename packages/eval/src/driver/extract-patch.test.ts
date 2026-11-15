import assert from 'node:assert/strict';
import { test } from 'vitest';
import { patchSizeWarning, stripScratchFiles } from './extract-patch.js';

const realFix = `diff --git a/requests/adapters.py b/requests/adapters.py
index 1111111..2222222 100644
--- a/requests/adapters.py
+++ b/requests/adapters.py
@@ -80,6 +80,8 @@ class HTTPAdapter:
-        raise ConnectionError(e)
+        if isinstance(e, _ReadTimeoutError):
+            raise ReadTimeout(e)
`;

const newReproduce = `diff --git a/reproduce_issue.py b/reproduce_issue.py
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/reproduce_issue.py
@@ -0,0 +1,2 @@
+import requests
+print("repro")
`;

const newRunTests = `diff --git a/run_tests.py b/run_tests.py
new file mode 100644
index 0000000..def5678
--- /dev/null
+++ b/run_tests.py
@@ -0,0 +1,1 @@
+import pytest
`;

const newTestFile = `diff --git a/test_readtimeout.py b/test_readtimeout.py
new file mode 100644
index 0000000..aaa1111
--- /dev/null
+++ b/test_readtimeout.py
@@ -0,0 +1,1 @@
+def test_x(): pass
`;

const modifiedExistingTest = `diff --git a/requests/tests/test_requests.py b/requests/tests/test_requests.py
index aaaaaaa..bbbbbbb 100644
--- a/requests/tests/test_requests.py
+++ b/requests/tests/test_requests.py
@@ -10,1 +10,1 @@
-    assert old
+    assert new
`;

test('stripScratchFiles drops a new reproduce script but keeps the real fix', () => {
  const out = stripScratchFiles(newReproduce + realFix);
  assert.match(out, /requests\/adapters\.py/);
  assert.doesNotMatch(out, /reproduce_issue\.py/);
});

test('stripScratchFiles drops new run_tests.py and new ad-hoc test files', () => {
  const out = stripScratchFiles(newRunTests + newTestFile + realFix);
  assert.doesNotMatch(out, /run_tests\.py/);
  assert.doesNotMatch(out, /test_readtimeout\.py/);
  assert.match(out, /adapters\.py/);
});

test('stripScratchFiles keeps modifications to existing test files (only new scratch dropped)', () => {
  const out = stripScratchFiles(modifiedExistingTest);
  assert.match(out, /test_requests\.py/);
});

test('stripScratchFiles is a no-op for a clean source-only diff', () => {
  assert.equal(stripScratchFiles(realFix), realFix);
});

test('patchSizeWarning is undefined for a normal-sized patch', () => {
  assert.equal(patchSizeWarning(realFix.length), undefined);
});

test('patchSizeWarning warns above 256KB', () => {
  const w = patchSizeWarning(300 * 1024);
  assert.match(w ?? '', /large/i);
});

test('patchSizeWarning flags an unusually large patch above 1MB', () => {
  const w = patchSizeWarning(2 * 1024 * 1024);
  assert.match(w ?? '', /unusually large|whole repo|scratch/i);
});
