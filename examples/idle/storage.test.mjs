/* global TextDecoder, TextEncoder, console */
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

const legacyStorage = memoryStorage(envelope());
let migrationCount = 0;
const migratedRepository = createLocalStorageRepository(legacyStorage, "idle", "1.1.0", {
  "1.0.0": (oldValue) => {
    migrationCount += 1;
    return { kind: "list", values: [oldValue, { kind: "integer", decimal: "1700000000000" }] };
  },
});
const migrated = await migratedRepository.load();
assert.deepEqual(migrated, {
  kind: "loaded",
  value: {
    kind: "list",
    values: [savedValue, { kind: "integer", decimal: "1700000000000" }],
  },
  migrated: true,
});
assert.deepEqual(await migratedRepository.load(), { kind: "loaded", value: migrated.value });
assert.equal(migrationCount, 1);
assert.equal(JSON.parse(new TextDecoder().decode(legacyStorage.raw())).applicationVersion, "1.1.0");

const migrationWriteFailureBytes = envelope();
const migrationWriteFailureStorage = memoryStorage(migrationWriteFailureBytes);
migrationWriteFailureStorage.fail();
const migrationWriteFailureRepository = createLocalStorageRepository(
  migrationWriteFailureStorage,
  "idle",
  "1.1.0",
  { "1.0.0": () => savedValue },
);
assert.deepEqual(await migrationWriteFailureRepository.load(), { kind: "storage-error" });
assert.deepEqual(migrationWriteFailureStorage.raw(), migrationWriteFailureBytes);
assert.deepEqual(
  await createLocalStorageRepository(memoryStorage(envelope()), "idle", "1.1.0", {
    "1.0.0": () => {
      throw new Error("invalid legacy game state");
    },
  }).load(),
  { kind: "codec-error" },
);
const invalidMigrationBytes = envelope();
const invalidMigrationStorage = memoryStorage(invalidMigrationBytes);
assert.deepEqual(
  await createLocalStorageRepository(invalidMigrationStorage, "idle", "1.1.0", {
    "1.0.0": () => ({ kind: "integer", decimal: "01" }),
  }).load(),
  { kind: "codec-error" },
);
assert.deepEqual(invalidMigrationStorage.raw(), invalidMigrationBytes);
const extendedEnvelopeStorage = memoryStorage(envelope());
const extendedEnvelope = JSON.parse(new TextDecoder().decode(extendedEnvelopeStorage.raw()));
extendedEnvelope.extra = "unexpected";
const extendedEnvelopeBytes = encoder.encode(JSON.stringify(extendedEnvelope));
const invalidEnvelopeStorage = memoryStorage(extendedEnvelopeBytes);
assert.deepEqual(
  await createLocalStorageRepository(invalidEnvelopeStorage, "idle", "1.0.0").load(),
  { kind: "codec-error" },
);
assert.deepEqual(invalidEnvelopeStorage.raw(), extendedEnvelopeBytes);
console.log("Idle save adapter: migration and preservation checks passed");
