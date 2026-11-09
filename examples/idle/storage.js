/* global TextDecoder, TextEncoder, structuredClone */
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function createLocalStorageRepository(
  storageAdapter,
  key,
  applicationVersion,
  migrations = {},
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(applicationVersion)) {
    throw new TypeError("invalid application version");
  }
  if (typeof migrations !== "object" || migrations === null || Array.isArray(migrations)) {
    throw new TypeError("invalid migrations");
  }
  let value = null;
  let loaded = false;
  let tail = Promise.resolve();
  const enqueue = (task) => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const read = async () => {
    let bytes;
    try {
      bytes = await storageAdapter.read(key);
    } catch {
      return { kind: "storage-error" };
    }
    if (bytes === null) {
      value = null;
      loaded = true;
      return { kind: "absent" };
    }
    let envelope;
    try {
      envelope = JSON.parse(textDecoder.decode(bytes));
    } catch {
      return { kind: "codec-error" };
    }
    if (
      !exactKeys(envelope, [
        "format",
        "envelopeVersion",
        "languageVersion",
        "applicationVersion",
        "value",
      ]) ||
      envelope?.format !== "geulion-save" ||
      envelope.envelopeVersion !== 1 ||
      envelope.languageVersion !== "0.3" ||
      typeof envelope.applicationVersion !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(envelope.applicationVersion) ||
      !isGeulionValue(envelope.value)
    )
      return { kind: "codec-error" };
    if (textEncoder.encode(JSON.stringify(envelope)).length > 1_048_576)
      return { kind: "codec-error" };
    if (envelope.applicationVersion !== applicationVersion) {
      if (!Object.hasOwn(migrations, envelope.applicationVersion)) return { kind: "codec-error" };
      let migrated;
      try {
        migrated = migrations[envelope.applicationVersion](structuredClone(envelope.value));
      } catch {
        return { kind: "codec-error" };
      }
      if (!isGeulionValue(migrated)) return { kind: "codec-error" };
      const upgraded = {
        format: "geulion-save",
        envelopeVersion: 1,
        languageVersion: "0.3",
        applicationVersion,
        value: migrated,
      };
      let bytes;
      try {
        bytes = textEncoder.encode(JSON.stringify(upgraded));
        if (bytes.length > 1_048_576) return { kind: "codec-error" };
        await storageAdapter.write(key, bytes);
      } catch {
        return { kind: "storage-error" };
      }
      value = structuredClone(migrated);
      loaded = true;
      return { kind: "loaded", value: structuredClone(value), migrated: true };
    }
    value = structuredClone(envelope.value);
    loaded = true;
    return { kind: "loaded", value: structuredClone(value) };
  };
  const write = async (next) => {
    if (!isGeulionValue(next)) return { kind: "codec-error" };
    const envelope = {
      format: "geulion-save",
      envelopeVersion: 1,
      languageVersion: "0.3",
      applicationVersion,
      value: next,
    };
    try {
      const bytes = textEncoder.encode(JSON.stringify(envelope));
      if (bytes.length > 1_048_576) return { kind: "codec-error" };
      await storageAdapter.write(key, bytes);
    } catch {
      return { kind: "storage-error" };
    }
    value = structuredClone(next);
    loaded = true;
    return { kind: "saved", value: structuredClone(value) };
  };
  return {
    load: () => enqueue(read),
    save: (next) =>
      enqueue(async () => {
        const result = await write(next);
        return result.kind === "saved" ? { kind: "saved" } : result;
      }),
    transact: (update) =>
      enqueue(async () => {
        if (!loaded) {
          const current = await read();
          if (current.kind === "codec-error" || current.kind === "storage-error") return current;
        }
        let next;
        try {
          next = update(value === null ? null : structuredClone(value));
        } catch {
          return { kind: "codec-error" };
        }
        return write(next);
      }),
  };
}

function isGeulionValue(root) {
  const seen = new Set();
  let nodes = 0;
  const visit = (value, depth) => {
    if (
      ++nodes > 65_536 ||
      depth > 64 ||
      value === null ||
      typeof value !== "object" ||
      seen.has(value)
    )
      return false;
    seen.add(value);
    const keys = Object.keys(value);
    const exact = (expected) =>
      keys.length === expected.length && expected.every((key) => keys.includes(key));
    let valid;
    switch (value.kind) {
      case "unit":
      case "none":
        valid = exact(["kind"]);
        break;
      case "integer":
        valid =
          exact(["kind", "decimal"]) &&
          typeof value.decimal === "string" &&
          /^-?(0|[1-9]\d*)$/u.test(value.decimal) &&
          value.decimal !== "-0" &&
          BigInt(value.decimal) >= -9223372036854775808n &&
          BigInt(value.decimal) <= 9223372036854775807n;
        break;
      case "real": {
        const parsed = Number(value.value);
        valid =
          exact(["kind", "value"]) &&
          typeof value.value === "string" &&
          (Number.isNaN(parsed)
            ? value.value === "NaN"
            : parsed.toString() === value.value ||
              ["Infinity", "-Infinity", "-0"].includes(value.value));
        break;
      }
      case "string":
        valid =
          exact(["kind", "value"]) &&
          typeof value.value === "string" &&
          !hasLoneSurrogate(value.value) &&
          new TextEncoder().encode(value.value).length <= 262_144;
        break;
      case "boolean":
        valid = exact(["kind", "value"]) && typeof value.value === "boolean";
        break;
      case "some":
        valid = exact(["kind", "value"]) && visit(value.value, depth + 1);
        break;
      case "list":
        valid =
          exact(["kind", "values"]) &&
          Array.isArray(value.values) &&
          value.values.length <= 16_384 &&
          value.values.every((item) => visit(item, depth + 1));
        break;
      case "dictionary": {
        const unique =
          Array.isArray(value.entries) &&
          new Set(value.entries.map((entry) => (Array.isArray(entry) ? entry[0] : null))).size ===
            value.entries.length;
        valid =
          exact(["kind", "entries"]) &&
          Array.isArray(value.entries) &&
          value.entries.length <= 16_384 &&
          unique &&
          value.entries.every(
            (entry) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              !hasLoneSurrogate(entry[0]) &&
              new TextEncoder().encode(entry[0]).length <= 262_144 &&
              visit(entry[1], depth + 1),
          );
        break;
      }
      default:
        valid = false;
    }
    seen.delete(value);
    return valid;
  };
  return visit(root, 0);
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function exactKeys(value, expected) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
