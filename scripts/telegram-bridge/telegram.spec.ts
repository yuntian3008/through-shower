import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { join } from "path";
import { rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    const calls: string[] = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      calls.push(String(_args[0]));
      return new Response(bytes);
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    const dest = join(TMP, "out.bin");
    await bot.downloadFile("photos/abc.jpg", dest);

    expect(calls[0]).toBe(
      "https://api.telegram.org/file/botTOKEN/photos/abc.jpg",
    );
    const written = await readFile(dest);
    expect(written.length).toBe(4);
    expect(written[0]).toBe(1);
  });

  test("should throw with status and body when response is not ok", async () => {
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    const dest = join(TMP, "out.bin");
    await expect(bot.downloadFile("missing.jpg", dest)).rejects.toThrow(
      "downloadFile 404: not found",
    );
  });
});

describe("TelegramBot.sendPhoto", () => {
  const TMP = join(tmpdir(), "thought-shower-tg-spec");
  let photoPath: string;

  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
    photoPath = join(TMP, "p.jpg");
    await writeFile(photoPath, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  test("should POST multipart to sendPhoto with chat_id + thread + caption", async () => {
    let capturedUrl = "";
    let capturedBody: FormData | undefined;
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      capturedUrl = String(_args[0]);
      capturedBody = (_args[1] as RequestInit | undefined)?.body as FormData;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    await bot.sendPhoto(-100, photoPath, "hello", 5);

    expect(capturedUrl).toContain("/botTOKEN/sendPhoto");
    expect(capturedBody?.get("chat_id")).toBe("-100");
    expect(capturedBody?.get("caption")).toBe("hello");
    expect(capturedBody?.get("message_thread_id")).toBe("5");
    expect(capturedBody?.get("photo")).toBeInstanceOf(File);
  });

  test("should throw with Telegram method + description on !ok response", async () => {
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      return new Response(JSON.stringify({ ok: false, description: "FLOOD_WAIT" }));
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    await expect(bot.sendPhoto(-100, photoPath)).rejects.toThrow(
      "Telegram sendPhoto: FLOOD_WAIT",
    );
  });
});

describe("TelegramBot.sendDocument", () => {
  const TMP = join(tmpdir(), "thought-shower-tg-spec-doc");
  let docPath: string;

  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
    docPath = join(TMP, "r.pdf");
    await writeFile(docPath, "%PDF-1.4\n");
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  test("should POST multipart to sendDocument with optional filename override", async () => {
    let capturedBody: FormData | undefined;
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      capturedBody = (_args[1] as RequestInit | undefined)?.body as FormData;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as unknown as typeof fetch;

    const bot = new TelegramBot("TOKEN");
    await bot.sendDocument(-100, docPath, undefined, undefined, "renamed.pdf");

    const file = capturedBody?.get("document") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("renamed.pdf");
  });
});
