/* global URL, process, console */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const output = await mkdtemp(join(tmpdir(), "geulion-idle-"));
try {
  const cli = new URL("../../packages/cli/dist/bin.js", import.meta.url);
  const build = spawnSync(
    process.execPath,
    [
      cli.pathname,
      "build",
      "examples/idle/game.geul",
      "--target",
      "browser",
      "--language-version",
      "0.3",
      "--out-dir",
      output,
    ],
    { encoding: "utf8", cwd: new URL("../../", import.meta.url), timeout: 10_000 },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const { createModule } = await import(pathToFileURL(join(output, "game.mjs")));
  const created = createModule({ write() {} });
  assert.equal(created.kind, "module");
  const game = created.module;
  const int = (number) => ({ kind: "integer", decimal: String(number) });
  const values = (value) => value.values.map((item) => Number(item.decimal));
  let state = game.invoke("새게임", []).value;
  assert.deepEqual(values(state), [0, 1, 0, 10, 0, 0]);
  for (let count = 0; count < 10; count += 1) state = game.invoke("클릭", [state]).value;
  assert.deepEqual(values(state), [10, 1, 0, 10, 10, 0]);
  state = game.invoke("업그레이드", [state]).value;
  assert.deepEqual(values(state), [0, 1, 1, 15, 10, 0]);
  state = game.invoke("경과", [state, int(5_500)]).value;
  assert.deepEqual(values(state), [5, 1, 1, 15, 10, 5]);
  state = game.invoke("업그레이드", [state]).value;
  assert.deepEqual(values(state), [5, 1, 1, 15, 10, 5]);
  state = game.invoke("경과", [state, int(10_000)]).value;
  state = game.invoke("업그레이드", [state]).value;
  assert.deepEqual(values(state), [0, 1, 2, 20, 10, 15]);
  console.log("Idle GEULION browser module: 10 assertions passed");
} finally {
  await rm(output, { recursive: true, force: true });
}
