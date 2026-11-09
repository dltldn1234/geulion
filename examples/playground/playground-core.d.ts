export const MAX_SOURCE_BYTES: number;
export const MAX_SHARED_BYTES: number;
export function scheduleWorkerTimeout(
  worker: Pick<Worker, "terminate">,
  milliseconds: number,
  isCurrent: () => boolean,
  onTimeout: () => void,
): ReturnType<typeof setTimeout>;
export function encodeSharedCode(source: string): string;
export function decodeSharedCode(fragment: string): string | undefined;
export function createSandboxWorkerSource(compiledModule: string): string;
