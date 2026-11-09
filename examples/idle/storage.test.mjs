/* global TextEncoder, console */
import assert from "node:assert/strict";
import { createLocalStorageRepository } from "./storage.js";

const encoder = new TextEncoder();
const savedValue = { kind: "some", value: { kind: "integer", decimal: "7" } };
function envelope(value = savedValue) {
  return encoder.encode(
    JSON.stringify({
      format: "geulion-save",
      envelopeVersion: 1,
      languageVersion: "0.3",
      applicationVersion: "1.0.0",
      value,
    }),
  );
}
function memoryStorage(initial = null) {
  let bytes = initial;
  let failWrite = false;
  return {
    async read() {
      return bytes;
    },
    async write(_key, next) {
      if (failWrite) throw new Error("quota");
      bytes = next;
    },
    fail() {
      failWrite = true;
    },
    raw() {
      return bytes;
    },
  };
}

const absentStorage = memoryStorage();
const absentRepository = createLocalStorageRepository(absentStorage, "idle", "1.0.0");
assert.deepEqual(await absentRepository.load(), { kind: "absent" });
assert.deepEqual(await absentRepository.save({ kind: "none" }), { kind: "saved" });
assert.deepEqual(await absentRepository.load(), { kind: "loaded", value: { kind: "none" } });

const corruptBytes = encoder.encode("{broken");
const corruptStorage = memoryStorage(corruptBytes);
const corruptRepository = createLocalStorageRepository(corruptStorage, "idle", "1.0.0");
assert.deepEqual(await corruptRepository.load(), { kind: "codec-error" });
assert.deepEqual(corruptStorage.raw(), corruptBytes);
assert.deepEqual(await corruptRepository.transact(() => ({ kind: "none" })), {
  kind: "codec-error",
});
assert.deepEqual(corruptStorage.raw(), corruptBytes);

const incompatibleBytes = envelope();
const incompatibleStorage = memoryStorage(incompatibleBytes);
const incompatibleRepository = createLocalStorageRepository(incompatibleStorage, "idle", "2.0.0");
assert.deepEqual(await incompatibleRepository.load(), { kind: "codec-error" });
assert.deepEqual(incompatibleStorage.raw(), incompatibleBytes);

const validStorage = memoryStorage(envelope());
const repository = createLocalStorageRepository(validStorage, "idle", "1.0.0");
assert.deepEqual(await repository.load(), { kind: "loaded", value: savedValue });
validStorage.fail();
assert.deepEqual(await repository.save({ kind: "none" }), { kind: "storage-error" });
assert.deepEqual(await repository.transact((current) => current), { kind: "storage-error" });
assert.deepEqual(validStorage.raw(), envelope());

const malformedStorage = memoryStorage(envelope({ kind: "integer", decimal: "01" }));
assert.deepEqual(await createLocalStorageRepository(malformedStorage, "idle", "1.0.0").load(), {
  kind: "codec-error",
});
console.log("Idle save adapter: 14 assertions passed");
