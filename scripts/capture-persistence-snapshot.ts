import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ADB = "adb";

function runAdbSh(shCmd: string): string {
  const escaped = shCmd.replace(/'/g, "'\\''");
  return execSync(`${ADB} shell 'run-as com.openmausbot.companion sh -c "${escaped}"'`, { encoding: "utf8" });
}

export interface PersistenceSnapshot {
  timestamp: string;
  appVersionName: string;
  appVersionCode: number;
  schemaVersion: number;
  conversations: {
    count: number;
    threadIds: string[];
  };
  messages: {
    totalCount: number;
    perThread: Record<string, number>;
  };
  attachments: {
    count: number;
    items: Array<{ id: string; name: string; mimeType: string; size: number; sha256?: string }>;
  };
  bots: {
    count: number;
    items: Array<{ id: string; name: string; title: string; color: string; modelSelection: any; threadId: string }>;
  };
  avatarsAndMascots: Array<{ botId: string; name: string; color: string; avatarUrl: string | null }>;
  memory: Array<{ botId: string; path: string; lineCount: number; sha256: string }>;
  goals: {
    count: number;
    items: Array<{ id: string; botId: string; title: string; status: string; progress: number }>;
  };
  watches: {
    count: number;
    items: Array<{ id: string; botId: string; target: string; status: string }>;
  };
  automations: {
    count: number;
    items: Array<{ id: string; name: string; status: string; botId: string }>;
  };
  modelSelection: {
    default: any;
    perBot: Record<string, any>;
  };
  providerConfiguration: {
    configuredInstanceCount: number;
    instances: string[];
    hasOpenaiCompat: boolean;
    hasComposio: boolean;
  };
  connectedServices: {
    composioSurface: string;
    composioUserId: string;
    status: string;
  };
  permissions: {
    terminal: string;
    filesystem: string;
    browser: string;
    composio: string;
  };
  artifacts: Array<{ name: string; path: string; size: number; sha256: string }>;
  settings: {
    profileName: string;
    profileEmail: string;
    neverAskPermissions: boolean;
    updaterChannel: string;
    updaterAutoCheck: boolean;
    updaterRepo: string;
  };
}

export function captureSnapshot(): PersistenceSnapshot {
  // App version
  const pkgDumpsys = execSync(`${ADB} shell dumpsys package com.openmausbot.companion | grep -E "versionName|versionCode"`, { encoding: "utf8" });
  const versionNameMatch = pkgDumpsys.match(/versionName=([^\s]+)/);
  const versionCodeMatch = pkgDumpsys.match(/versionCode=([0-9]+)/);
  const appVersionName = versionNameMatch ? versionNameMatch[1] : "unknown";
  const appVersionCode = versionCodeMatch ? parseInt(versionCodeMatch[1], 10) : 0;

  // 1. Bots and Conversations
  const botsRaw = runAdbSh("cat files/host/data/bots.json");
  const parsedBots = JSON.parse(botsRaw);
  const botsList = Array.isArray(parsedBots) ? parsedBots : (parsedBots.bots || []);

  const threadIds: string[] = [];
  const messageCounts: Record<string, number> = {};
  let totalMessages = 0;
  const attachmentItems: any[] = [];
  const botItems: any[] = [];
  const avatarItems: any[] = [];
  const perBotModel: Record<string, any> = {};

  for (const bot of botsList) {
    botItems.push({
      id: bot.id,
      name: bot.name,
      title: bot.title || "",
      color: bot.color,
      modelSelection: bot.modelSelection,
      threadId: bot.threadId
    });
    avatarItems.push({
      botId: bot.id,
      name: bot.name,
      color: bot.color,
      avatarUrl: bot.avatarUrl
    });
    perBotModel[bot.name] = bot.modelSelection;

    for (const task of bot.tasks || []) {
      if (!threadIds.includes(task.threadId)) {
        threadIds.push(task.threadId);
      }
    }
    if (bot.threadId && !threadIds.includes(bot.threadId)) {
      threadIds.push(bot.threadId);
    }

    const msgs = bot.messages || [];
    totalMessages += msgs.length;
    messageCounts[bot.name] = msgs.length;

    for (const msg of msgs) {
      if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          attachmentItems.push({
            id: att.id,
            name: att.name,
            mimeType: att.mimeType,
            size: att.size
          });
        }
      }
    }
  }

  // 2. Memory
  const memoryItems: any[] = [];
  for (const bot of botsList) {
    try {
      const memRaw = runAdbSh(`cat files/host/data/workspaces/${bot.id}/MEMORY.md 2>/dev/null || true`);
      if (memRaw && memRaw.trim()) {
        const hash = createHash("sha256").update(memRaw).digest("hex");
        memoryItems.push({
          botId: bot.id,
          botName: bot.name,
          path: `workspaces/${bot.id}/MEMORY.md`,
          lineCount: memRaw.split("\n").length,
          sha256: hash
        });
      }
    } catch {}
  }

  // 3. Goals
  const goalsRaw = runAdbSh("cat files/host/data/goals.json 2>/dev/null || echo '{\"goals\":[]}'");
  const goalsData = JSON.parse(goalsRaw);
  const goalItems = (goalsData.goals || []).map((g: any) => ({
    id: g.id,
    botId: g.botId,
    title: g.title,
    status: g.status,
    progress: g.progress
  }));

  // 4. Watches
  const watchesRaw = runAdbSh("cat files/host/data/watches.json 2>/dev/null || echo '{\"watches\":[]}'");
  const watchesData = JSON.parse(watchesRaw);
  const watchItems = (watchesData.watches || []).map((w: any) => ({
    id: w.id,
    botId: w.botId,
    target: w.target,
    status: w.status
  }));

  // 5. Automations / Routines
  const routinesRaw = runAdbSh("cat files/host/data/routines.json 2>/dev/null || echo '{\"routines\":[]}'");
  const routinesData = JSON.parse(routinesRaw);
  const routineItems = (routinesData.routines || []).map((r: any) => ({
    id: r.id,
    name: r.routineName,
    status: r.status,
    botId: r.botId
  }));

  // 6. Config, Models, Permissions, Settings
  const configRaw = runAdbSh("cat files/host/data/config.json");
  const configData = JSON.parse(configRaw);

  const instanceKeys = Object.keys(configData.instances || {});
  const perms = configData.agentPermissions || {};

  // 7. Artifacts
  const artifacts: any[] = [];
  for (const bot of botsList) {
    try {
      const artRaw = runAdbSh(`cat files/host/data/workspaces/${bot.id}/verification-report.json 2>/dev/null || true`);
      if (artRaw && artRaw.trim()) {
        const hash = createHash("sha256").update(artRaw).digest("hex");
        artifacts.push({
          name: "verification-report.json",
          path: `workspaces/${bot.id}/verification-report.json`,
          size: artRaw.length,
          sha256: hash
        });
      }
      const pdfRaw = runAdbSh(`cat files/host/data/workspaces/${bot.id}/architecture_spec_v1.pdf 2>/dev/null || true`);
      if (pdfRaw && pdfRaw.trim()) {
        const hash = createHash("sha256").update(pdfRaw).digest("hex");
        artifacts.push({
          name: "architecture_spec_v1.pdf",
          path: `workspaces/${bot.id}/architecture_spec_v1.pdf`,
          size: pdfRaw.length,
          sha256: hash
        });
      }
    } catch {}
  }

  const snapshot: PersistenceSnapshot = {
    timestamp: new Date().toISOString(),
    appVersionName,
    appVersionCode,
    schemaVersion: configData.schemaVersion || 1,
    conversations: {
      count: threadIds.length,
      threadIds
    },
    messages: {
      totalCount: totalMessages,
      perThread: messageCounts
    },
    attachments: {
      count: attachmentItems.length,
      items: attachmentItems
    },
    bots: {
      count: botItems.length,
      items: botItems
    },
    avatarsAndMascots: avatarItems,
    memory: memoryItems,
    goals: {
      count: goalItems.length,
      items: goalItems
    },
    watches: {
      count: watchItems.length,
      items: watchItems
    },
    automations: {
      count: routineItems.length,
      items: routineItems
    },
    modelSelection: {
      default: configData.defaultModelSelection,
      perBot: perBotModel
    },
    providerConfiguration: {
      configuredInstanceCount: instanceKeys.length,
      instances: instanceKeys,
      hasOpenaiCompat: Boolean(configData.openaiCompat?.url),
      hasComposio: Boolean(configData.composio?.apiKey)
    },
    connectedServices: {
      composioSurface: configData.composio?.surface || "none",
      composioUserId: configData.composio?.userId ? "openmausbot_***[REDACTED]" : "none",
      status: "connected"
    },
    permissions: {
      terminal: perms.terminal || "denied",
      filesystem: perms.filesystem || "denied",
      browser: perms.browser || "denied",
      composio: perms.composio || "denied"
    },
    artifacts,
    settings: {
      profileName: configData.profile?.name ? "Technical Verification User" : "none",
      profileEmail: configData.profile?.email ? "verification@mobot.internal" : "none",
      neverAskPermissions: Boolean(configData.neverAskPermissions),
      updaterChannel: configData.updater?.channel || "stable",
      updaterAutoCheck: Boolean(configData.updater?.autoCheck),
      updaterRepo: configData.updater?.repo || "mobot-app/mobot"
    }
  };

  return snapshot;
}

if (process.argv[1] && process.argv[1].endsWith("capture-persistence-snapshot.ts")) {
  const snapshot = captureSnapshot();
  const outPath = process.argv[2] || "/tmp/persistence_snapshot.json";
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot captured to ${outPath}:`);
  console.log(JSON.stringify(snapshot, null, 2));
}
