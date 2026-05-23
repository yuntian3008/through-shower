const BASE = "https://api.telegram.org/bot";

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  from?: { id: number; first_name: string; username?: string; is_bot?: boolean };
  chat: { id: number; title?: string; type: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: PhotoSize[];
  document?: TgDocument;
}

export interface TgCallbackQuery {
  id: string;
  from: { id: number; first_name: string; username?: string };
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export class TelegramBot {
  private url: string;

  constructor(token: string) {
    this.url = `${BASE}${token}`;
  }

  async getMe() {
    return this.call<{ id: number; username: string }>("getMe");
  }

  async getUpdates(offset?: number, timeout = 0) {
    return this.call<TgUpdate[]>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async sendMessage(chatId: number, text: string, topicId?: number) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      message_thread_id: topicId,
      parse_mode: "MarkdownV2",
    });
  }

  async sendQuestion(
    chatId: number,
    text: string,
    buttons: { text: string; callback_data: string }[][],
    topicId?: number,
  ) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      message_thread_id: topicId,
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string) {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async editMessageText(chatId: number, messageId: number, text: string) {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "MarkdownV2",
    });
  }

  async react(chatId: number, messageId: number, emoji: string) {
    await this.call("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  }

  async createForumTopic(chatId: number, name: string) {
    return this.call<{ message_thread_id: number; name: string }>(
      "createForumTopic",
      { chat_id: chatId, name },
    );
  }

  async getFile(fileId: string) {
    return this.call<{ file_id: string; file_path?: string }>("getFile", {
      file_id: fileId,
    });
  }

  async downloadFile(filePath: string, destPath: string): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(destPath), { recursive: true });
    // File downloads use /file/bot<TOKEN>/ not /bot<TOKEN>/
    const fileUrl = this.url.replace("/bot", "/file/bot") + "/" + filePath;
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`downloadFile ${res.status}: ${await res.text()}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(destPath, buf);
  }

  async sendPhoto(
    chatId: number,
    localPath: string,
    caption?: string,
    topicId?: number,
  ) {
    const form = await this.buildMediaForm(chatId, "photo", localPath, caption, topicId);
    return this.callForm<TgMessage>("sendPhoto", form);
  }

  async sendDocument(
    chatId: number,
    localPath: string,
    caption?: string,
    topicId?: number,
    filename?: string,
  ) {
    const form = await this.buildMediaForm(
      chatId,
      "document",
      localPath,
      caption,
      topicId,
      filename,
    );
    return this.callForm<TgMessage>("sendDocument", form);
  }

  private async buildMediaForm(
    chatId: number,
    field: "photo" | "document",
    localPath: string,
    caption: string | undefined,
    topicId: number | undefined,
    filename?: string,
  ): Promise<FormData> {
    const { basename } = await import("path");
    const bunFile = Bun.file(localPath);
    const name = filename ?? basename(localPath);
    // Bun's FormData.append ignores the 3rd filename arg for BunFile, so we
    // materialise the bytes into a real File. The whole file buffers into
    // memory — Telegram's 50 MB upload cap is the practical bound.
    const file = new File([await bunFile.arrayBuffer()], name, {
      type: bunFile.type,
    });
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (topicId !== undefined) form.append("message_thread_id", String(topicId));
    if (caption !== undefined) form.append("caption", caption);
    form.append(field, file);
    return form;
  }

  private async callForm<T>(method: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.url}/${method}`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as {
      ok: boolean;
      result: T;
      description?: string;
    };
    if (!data.ok) {
      throw new Error(`Telegram ${method}: ${data.description}`);
    }
    return data.result;
  }

  private async call<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.url}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result: T;
      description?: string;
    };
    if (!data.ok) {
      throw new Error(`Telegram ${method}: ${data.description}`);
    }
    return data.result;
  }
}
