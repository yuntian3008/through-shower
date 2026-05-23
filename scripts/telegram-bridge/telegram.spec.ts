import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { join } from "path";
import { rm, readFile } from "node:fs/promises";
import { TelegramBot } from "./telegram";

const originalFetch = globalThis.fetch;

describe("TelegramBot.getFile", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should call Telegram getFile and return file_path", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      calls.push(String(_args[0]));
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: "photos/abc.jpg" } }),
      );
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    const result = await bot.getFile("FILEID");
    expect(result.file_path).toBe("photos/abc.jpg");
    expect(calls[0]).toContain("/botTOKEN/getFile");
  });
});

describe("TelegramBot.downloadFile", () => {
  const TMP = join(import.meta.dir, "..", "..", ".tmp-telegram-spec");

  beforeEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  test("should GET file URL and write bytes to dest", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      return new Response(bytes);
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    const dest = join(TMP, "out.bin");
    await bot.downloadFile("photos/abc.jpg", dest);

    const written = await readFile(dest);
    expect(written.length).toBe(4);
    expect(written[0]).toBe(1);
  });
});
