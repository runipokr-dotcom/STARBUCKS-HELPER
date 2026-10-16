import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const partner = await readFile(new URL("../partner.html", import.meta.url), "utf8");
const share = await readFile(new URL("../share.html", import.meta.url), "utf8");
const editor = await readFile(new URL("../catalog-editor.html", import.meta.url), "utf8");
const deploy = await readFile(
  new URL("../scripts/deploy_issue2_partner_entry.sh", import.meta.url),
  "utf8",
);

test("partner entry keeps the capability in the fragment and blocks indexing/referrer leakage", () => {
  assert.match(partner, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(partner, /name="referrer" content="no-referrer"/);
  assert.match(partner, /fetch\("\.\/share\.html", \{ cache: "no-store", referrerPolicy: "no-referrer" \}\)/);
  assert.doesNotMatch(partner, /location\.search|URLSearchParams|auth-gate\.js/);
  assert.match(share, /location\.hash\.slice\(1\)/);
  assert.match(share, /PARTNER_SHARE_COLLECTION\s*=\s*"partnerCatalogShares"/);
  assert.match(share, /\^\[A-Za-z0-9_-\]\{43\}\$/);
});

test("editor generates the separate partner path while preserving the fixed public URL", () => {
  assert.match(editor, /PUBLIC_SHARE_ID\s*=\s*"c6xxh9"/);
  assert.match(editor, /share\.html\?id=\$\{id\}/);
  assert.match(editor, /:\s*"\/partner\.html"/);
  assert.match(editor, /\^\\\/\[A-Za-z0-9\/_\.\-\]\{1,80\}\$/);
  assert.match(editor, /return `\$\{base\.origin\}\$\{path\}#\$\{config\.capability\}`/);
  assert.doesNotMatch(editor, /partner\.html\?capability=/);
});

test("deployment gate is limited to the entrypoint and verifies public share unchanged", () => {
  for (const path of [
    "START_HERE.md",
    "WORKLOG.md",
    "partner.html",
    "scripts/deploy_issue2_partner_entry.sh",
    "tests/partner-entry.static.test.mjs",
    "tests/share.partner-lifecycle.browser.test.mjs",
  ]) assert.match(deploy, new RegExp(path.replaceAll(".", "\\.")));

  assert.match(deploy, /share\.html\?id=c6xxh9/);
  assert.match(deploy, /git push origin HEAD:main/);
  const checkOnly = deploy.indexOf('if [[ "$MODE" == "--check-only" ]]');
  const push = deploy.indexOf("git push origin HEAD:main");
  assert.ok(checkOnly >= 0 && checkOnly < push);
  assert.doesNotMatch(deploy, /firebase\s+deploy|firestore\.googleapis\.com|setDoc\(|updateDoc\(|deleteDoc\(/);
});
