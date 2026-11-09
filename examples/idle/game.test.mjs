/* global URL, process, console */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  calculateOfflineElapsed,
  createWholeSecondClock,
  MAX_OFFLINE_MILLISECONDS,
} from "./clock.js";

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
  state = game.invoke("오프라인경과", [state, int(86_400_000)]).value;
  assert.deepEqual(values(state), [57_600, 1, 2, 20, 10, 28_815]);
  state = game.invoke("새게임", []).value;
  state = game.invoke("오프라인경과", [state, int(-1)]).value;
  assert.deepEqual(values(state), [0, 1, 0, 10, 0, 0]);
  const clock = createWholeSecondClock();
  assert.equal(clock.consume(400), 0);
  assert.equal(clock.consume(400), 0);
  assert.equal(clock.consume(250), 1000);
  clock.reset();
  assert.deepEqual(calculateOfflineElapsed(1000, 1000), {
    kind: "elapsed",
    elapsedMilliseconds: 0,
    capped: false,
  });
  assert.deepEqual(calculateOfflineElapsed(1000, 60_000), {
    kind: "elapsed",
    elapsedMilliseconds: 59_000,
    capped: false,
  });
  assert.deepEqual(calculateOfflineElapsed(60_000, 1000), {
    kind: "clock-rewound",
    elapsedMilliseconds: 0,
  });
  assert.deepEqual(calculateOfflineElapsed(-1, 1000), {
    kind: "invalid-clock",
    elapsedMilliseconds: 0,
  });
  assert.deepEqual(calculateOfflineElapsed(1000, Number.NaN), {
    kind: "invalid-clock",
    elapsedMilliseconds: 0,
  });
  assert.deepEqual(calculateOfflineElapsed(0, MAX_OFFLINE_MILLISECONDS + 10_000), {
    kind: "elapsed",
    elapsedMilliseconds: MAX_OFFLINE_MILLISECONDS,
    capped: true,
  });
  let producedMilliseconds = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    producedMilliseconds += clock.consume(1000 / 60);
  }
  assert.equal(producedMilliseconds, 1000);
  console.log("Idle GEULION browser module: 22 assertions passed");
} finally {
  await rm(output, { recursive: true, force: true });
}
