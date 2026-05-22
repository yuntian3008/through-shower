#!/usr/bin/env bun
import { join } from "path";
import { TelegramBot } from "./telegram";
import {
  DATA_DIR,
  ensureDirs,
  getActive,
  inboxPath,
  isDaemonRunning,
  loadConfig,
  loadSessions,
  readPid,
  saveConfig,
  saveSession,
  setActive,
} from "./store";

const DAEMON_PATH = join(import.meta.dir, "daemon.ts");
const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "setup":
      return setup();
    case "discover":
      return discover();
    case "init":
      return init();
    case "send":
      return send();
    case "sessions":
      return sessions();
    case "daemon":
      return daemon();
    default:
      console.log(`Usage: bun cli.ts <command>

Commands:
  setup     --token <T> --group <G> --user <U>   Save bot config
  discover  --token <T>                           Find group ID
  init      --name <session-name>                 Create topic + set active
  send      <text>                                Reply to active topic
  sessions                                        List all sessions
  daemon    start|stop|status                     Manage daemon`);
  }
}

function flag(name: string): string | undefined {
  const idx = rest.indexOf(name);
  if (idx === -1 || idx + 1 >= rest.length) return undefined;
  return rest[idx + 1];
}

async function setup() {
  const token = flag("--token");
  const groupId = flag("--group");
  const userId = flag("--user");
  if (!token || !groupId || !userId) {
    console.error(
      "Usage: bun cli.ts setup --token <BOT_TOKEN> --group <GROUP_ID> --user <USER_ID>",
    );
    process.exit(1);
  }

  const bot = new TelegramBot(token);
  const me = await bot.getMe();
  console.log(`Bot: @${me.username} (ID: ${me.id})`);

  await saveConfig({
    botToken: token,
    groupId: Number(groupId),
    botId: me.id,
    allowedUserId: Number(userId),
  });
  console.log("Config saved.");
}

async function discover() {
  const token = flag("--token");
  if (!token) {
    console.error("Usage: bun cli.ts discover --token <BOT_TOKEN>");
    console.error(
      "\n1. Create a supergroup with Topics enabled");
    console.error(
      "2. Add bot as admin with 'Manage Topics' permission");
    console.error("3. Send a message in the group");
    console.error("4. Run this command");
    process.exit(1);
  }

  const bot = new TelegramBot(token);
  const me = await bot.getMe();
  console.log(`Bot: @${me.username}`);
  console.log("Polling for group messages...");

  let offset: number | undefined;
  for (let i = 0; i < 30; i++) {
    const updates = await bot.getUpdates(offset, 2);
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message?.chat.type === "supergroup") {
        console.log(`\nGroup: "${u.message.chat.title}"`);
        console.log(`ID: ${u.message.chat.id}`);
        return;
      }
    }
  }
  console.error("\nNo supergroup message found.");
}

async function init() {
  const name = flag("--name");
  if (!name) {
    console.error("Usage: bun cli.ts init --name <session-name>");
    process.exit(1);
  }

  const config = await loadConfig();
  const bot = new TelegramBot(config.botToken);
  const sessions = await loadSessions();

  if (sessions[name]) {
    await setActive(name);
    console.log(
      `Reusing topic "${sessions[name].topicName}" (ID: ${sessions[name].topicId})`,
    );
    return;
  }

  const topic = await bot.createForumTopic(config.groupId, name);
  const info = {
    topicId: topic.message_thread_id,
    topicName: topic.name,
    createdAt: new Date().toISOString(),
  };
  await saveSession(name, info);
  await setActive(name);

  await bot.sendMessage(config.groupId, "Session started.", info.topicId);
  console.log(`Created topic "${name}" (ID: ${info.topicId})`);
}

async function send() {
  const text = rest.join(" ");
  if (!text) {
    console.error("Usage: bun cli.ts send <text>");
    process.exit(1);
  }

  const config = await loadConfig();
  const activeName = await getActive();
  if (!activeName) {
    console.error("No active session. Run: bun cli.ts init --name <name>");
    process.exit(1);
  }

  const allSessions = await loadSessions();
  const session = allSessions[activeName];
  if (!session) {
    console.error(`Session "${activeName}" not found.`);
    process.exit(1);
  }

  const bot = new TelegramBot(config.botToken);
  await bot.sendMessage(config.groupId, text, session.topicId);
  console.log("Sent.");
}

async function sessions() {
  const all = await loadSessions();
  const active = await getActive();
  if (Object.keys(all).length === 0) {
    console.log("No sessions.");
    return;
  }
  for (const [name, info] of Object.entries(all)) {
    const marker = name === active ? " *" : "";
    console.log(
      `${name}${marker}  topic:${info.topicId}  ${info.createdAt}`,
    );
  }
}

async function daemon() {
  const sub = rest[0];
  switch (sub) {
    case "start": {
      if (await isDaemonRunning()) {
        const pid = await readPid();
        console.log(`Daemon already running (pid ${pid}).`);
        return;
      }
      await ensureDirs();
      const proc = Bun.spawn(["bun", DAEMON_PATH], {
        stdout: "ignore",
        stderr: Bun.file(join(DATA_DIR, "daemon.log")),
        stdin: "ignore",
      });
      proc.unref();
      console.log(`Daemon started (pid ${proc.pid}).`);
      return;
    }
    case "stop": {
      const pid = await readPid();
      if (!pid) {
        console.log("No daemon running.");
        return;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Daemon stopped (pid ${pid}).`);
      } catch {
        console.log("Daemon not running (stale pid).");
      }
      return;
    }
    case "status": {
      if (await isDaemonRunning()) {
        const pid = await readPid();
        console.log(`Running (pid ${pid}).`);
      } else {
        console.log("Not running.");
      }
      return;
    }
    default:
      console.error("Usage: bun cli.ts daemon start|stop|status");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
