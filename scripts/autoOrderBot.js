/*
 * Telegram auto order fulfillment bot.
 *
 * This script uses the Telegram Bot API via long polling to monitor incoming
 * commands and automatically create "补单" (make-up orders) records in a local
 * JSON datastore. No external bot framework is required which keeps the script
 * compatible with restricted environments.
 */

const path = require('path');
const fs = require('fs/promises');
const dotenv = require('dotenv');

const ENV_FILES = ['.env.local', '.env'];
for (const file of ENV_FILES) {
  const envPath = path.resolve(process.cwd(), file);
  const result = dotenv.config({ path: envPath });
  if (result.error && result.error.code !== 'ENOENT') {
    console.warn(`[auto-order-bot] Failed to load ${file}: ${result.error.message}`);
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const NOTIFY_CHAT_ID = process.env.TELEGRAM_NOTIFY_CHAT_ID;
const DEFAULT_TARGET = parseInt(process.env.AUTO_FILL_TARGET_COMPLETED || '0', 10);
const AUTO_INTERVAL_MINUTES = parseInt(process.env.AUTO_FILL_INTERVAL_MINUTES || '0', 10);
const DATA_FILE = path.resolve(
  process.env.ORDER_DATA_FILE || path.join(__dirname, '..', 'data', 'orders.json')
);

if (!BOT_TOKEN) {
  console.error('[auto-order-bot] Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}

const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
let isPolling = true;
let updateOffset = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (!Array.isArray(state.orders)) {
      state.orders = [];
    }
    if (!Array.isArray(state.templates)) {
      state.templates = [];
    }
    return state;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { orders: [], templates: [] };
    }
    throw error;
  }
}

async function saveState(state) {
  const dir = path.dirname(DATA_FILE);
  await fs.mkdir(dir, { recursive: true });
  const toSave = {
    orders: Array.isArray(state.orders) ? state.orders : [],
    templates: Array.isArray(state.templates) ? state.templates : [],
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(toSave, null, 2), 'utf8');
}

function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function generateOrderId(state, date = new Date()) {
  const dayKey = getDayKey(date);
  const prefix = dayKey.replace(/-/g, '');
  const todaysOrders = state.orders.filter((order) => typeof order.id === 'string' && order.id.startsWith(prefix));
  const lastSequence = todaysOrders.reduce((max, order) => {
    const parts = order.id.split('-');
    const candidate = parseInt(parts[1], 10);
    if (Number.isFinite(candidate) && candidate > max) {
      return candidate;
    }
    return max;
  }, 0);
  const nextSequence = String(lastSequence + 1).padStart(3, '0');
  return `${prefix}-${nextSequence}`;
}

function pickTemplate(state, templateName) {
  const templates = Array.isArray(state.templates) ? state.templates : [];
  if (!templates.length) {
    return { template: null, warning: null };
  }

  if (templateName) {
    const matched = templates.find((t) => t && t.name === templateName);
    if (matched) {
      return { template: matched, warning: null };
    }
    return {
      template: templates.find((t) => t && t.isDefault) || templates[0],
      warning: `未找到模板 “${templateName}”，已使用 ${
        templates.find((t) => t && t.isDefault)?.name || templates[0].name
      } 模板。`,
    };
  }

  const preferred = templates.find((t) => t && t.isDefault) || templates[0];
  return { template: preferred, warning: null };
}

function buildOrderFromTemplate(template) {
  if (!template) {
    return {
      customer: '自动补单',
      items: 1,
      note: 'Auto generated order',
    };
  }

  return {
    customer: template.customer || '自动补单',
    items: template.items || 1,
    note: template.note || 'Auto generated order',
    amount: template.amount,
    meta: template.meta,
  };
}

function createOrderRecord(state, template, options = {}) {
  const timestamp = new Date();
  const orderId = generateOrderId(state, timestamp);
  const templateData = buildOrderFromTemplate(template);

  const order = {
    id: orderId,
    status: 'completed',
    createdAt: timestamp.toISOString(),
    customer: options.customer || templateData.customer,
    items: options.items || templateData.items,
    note: options.note || templateData.note,
    autoFilled: true,
    templateName: template ? template.name : null,
    metadata: {
      trigger: options.trigger || 'manual',
      target: options.target,
      reason: options.reason,
      ...((templateData.meta && typeof templateData.meta === 'object' && !Array.isArray(templateData.meta))
        ? templateData.meta
        : {}),
    },
  };

  if (templateData.amount !== undefined) {
    order.amount = templateData.amount;
  }

  state.orders.push(order);
  return order;
}

function summarizeToday(state) {
  const todayKey = getDayKey();
  const todaysOrders = state.orders.filter((order) =>
    typeof order.createdAt === 'string' && order.createdAt.startsWith(todayKey)
  );

  const completed = todaysOrders.filter((order) => order.status === 'completed');
  const pending = todaysOrders.filter((order) => order.status === 'pending');
  const cancelled = todaysOrders.filter((order) => order.status === 'cancelled');
  const autoFilled = todaysOrders.filter((order) => order.autoFilled);

  return {
    todayKey,
    total: todaysOrders.length,
    completed: completed.length,
    pending: pending.length,
    cancelled: cancelled.length,
    autoFilled: autoFilled.length,
  };
}

async function performAutoFill(target, options = {}) {
  const state = await loadState();
  const { template, warning } = pickTemplate(state, options.templateName);
  const summaryBefore = summarizeToday(state);

  const createdOrders = [];
  if (target > summaryBefore.completed) {
    const deficit = target - summaryBefore.completed;
    for (let i = 0; i < deficit; i += 1) {
      const order = createOrderRecord(state, template, {
        trigger: options.trigger || 'manual',
        target,
        reason: options.reason,
        customer: options.customer,
        items: options.items,
        note: options.note,
      });
      createdOrders.push(order);
    }
  }

  await saveState(state);
  const summaryAfter = summarizeToday(state);

  return {
    createdOrders,
    before: summaryBefore,
    after: summaryAfter,
    template,
    warning,
  };
}

async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    disable_notification: Boolean(options.silent),
  };

  const response = await fetch(`${TELEGRAM_BASE_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[auto-order-bot] Failed to send message', response.status, errorText);
  }
}

function isChatAllowed(chatId) {
  if (!ALLOWED_CHAT_IDS.length) {
    return true;
  }
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

function formatStatsMessage(summary, totalOrders, autoTotal) {
  return [
    `今日统计（${summary.todayKey}）`,
    `- 总订单：${summary.total}`,
    `- 已完成：${summary.completed}（自动补单 ${summary.autoFilled}）`,
    `- 待处理：${summary.pending}`,
    `- 已取消：${summary.cancelled}`,
    '',
    `累计订单：${totalOrders}`,
    `累计自动补单：${autoTotal}`,
  ].join('\n');
}

async function handleStatsCommand(chatId) {
  const state = await loadState();
  const summary = summarizeToday(state);
  const totalOrders = state.orders.length;
  const autoTotal = state.orders.filter((order) => order.autoFilled).length;
  await sendMessage(chatId, formatStatsMessage(summary, totalOrders, autoTotal));
}

async function handleFillCommand(chatId, args, alias = 'fill') {
  if (!args.length && !DEFAULT_TARGET) {
    await sendMessage(chatId, '请提供目标完成单数，例如 /fill 30。');
    return;
  }

  const target = parseInt(args[0] || DEFAULT_TARGET, 10);
  if (!Number.isFinite(target) || target <= 0) {
    await sendMessage(chatId, '目标单数必须是正整数。');
    return;
  }

  const templateName = args[1];
  const reason = args.slice(templateName ? 2 : 1).join(' ').trim() || `${alias} command`;

  const result = await performAutoFill(target, {
    templateName,
    trigger: 'command',
    reason,
  });

  const messages = [];
  if (result.warning) {
    messages.push(result.warning);
  }

  if (!result.createdOrders.length) {
    messages.push(
      `今日已完成 ${result.after.completed} 单，已满足目标 ${target} 单，无需补单。`
    );
    await sendMessage(chatId, messages.join('\n'));
    return;
  }

  messages.push(
    [
      `已自动补单 ${result.createdOrders.length} 单。`,
      `目标：${target} 单`,
      `补单前：${result.before.completed} 单`,
      `补单后：${result.after.completed} 单`,
      result.template ? `使用模板：${result.template.name}` : '使用默认模板',
    ].join('\n')
  );

  const detailLines = result.createdOrders.map(
    (order) => `#${order.id} ${order.customer} x${order.items}`
  );
  messages.push('', ...detailLines);

  await sendMessage(chatId, messages.join('\n'));
}

async function handleTemplatesCommand(chatId) {
  const state = await loadState();
  if (!state.templates.length) {
    await sendMessage(chatId, '当前没有可用模板，所有补单将使用默认设置。');
    return;
  }

  const lines = state.templates.map((template) => {
    const flags = [];
    if (template.isDefault) {
      flags.push('默认');
    }
    if (template.description) {
      flags.push(template.description);
    }
    const suffix = flags.length ? `（${flags.join('，')}）` : '';
    return `• ${template.name}${suffix}`;
  });

  await sendMessage(chatId, ['可用模板：', ...lines].join('\n'));
}

async function handleHelpCommand(chatId) {
  await sendMessage(
    chatId,
    [
      '欢迎使用自动补单机器人！',
      '',
      '/start - 查看帮助',
      '/help - 查看帮助',
      '/stats - 查看今日及累计统计',
      '/fill <目标> [模板] [备注] - 自动补单',
      '/补单 <目标> [模板] [备注] - 中文命令别名',
      '/templates - 查看模板列表',
      '',
      DEFAULT_TARGET
        ? `环境变量默认目标：${DEFAULT_TARGET} 单，可直接输入 /fill 使用默认目标。`
        : '可通过设置 AUTO_FILL_TARGET_COMPLETED 环境变量定义默认目标。',
    ].join('\n')
  );
}

async function handleMessage(message) {
  if (!message || !message.chat) {
    return;
  }

  const chatId = message.chat.id;
  if (!isChatAllowed(chatId)) {
    if (message.text && message.text.startsWith('/')) {
      await sendMessage(chatId, '抱歉，您没有权限使用此机器人。');
    }
    return;
  }

  const text = (message.text || '').trim();
  if (!text.startsWith('/')) {
    return;
  }

  const [commandRaw, ...args] = text.split(/\s+/);
  const command = commandRaw.toLowerCase();

  switch (command) {
    case '/start':
    case '/help':
      await handleHelpCommand(chatId);
      break;
    case '/stats':
      await handleStatsCommand(chatId);
      break;
    case '/fill':
      await handleFillCommand(chatId, args, 'fill');
      break;
    case '/补单':
      await handleFillCommand(chatId, args, '补单');
      break;
    case '/templates':
      await handleTemplatesCommand(chatId);
      break;
    default:
      await sendMessage(chatId, '未识别的命令，请输入 /help 查看可用命令。');
  }
}

async function pollUpdates() {
  console.log('[auto-order-bot] Starting polling loop...');
  while (isPolling) {
    try {
      const url = new URL(`${TELEGRAM_BASE_URL}/getUpdates`);
      url.searchParams.set('timeout', '60');
      url.searchParams.set('offset', String(updateOffset));

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`getUpdates failed: ${response.status} ${errorText}`);
      }

      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(`getUpdates returned not ok: ${JSON.stringify(payload)}`);
      }

      const updates = Array.isArray(payload.result) ? payload.result : [];
      for (const update of updates) {
        updateOffset = update.update_id + 1;
        if (update.message) {
          await handleMessage(update.message);
        }
      }
    } catch (error) {
      console.error('[auto-order-bot] Polling error:', error.message);
      await sleep(5000);
    }
  }
}

async function runScheduledAutoFill() {
  if (!NOTIFY_CHAT_ID || !DEFAULT_TARGET || AUTO_INTERVAL_MINUTES <= 0) {
    return;
  }

  const result = await performAutoFill(DEFAULT_TARGET, {
    trigger: 'schedule',
    reason: 'scheduled auto fill',
  });

  if (!result.createdOrders.length) {
    return;
  }

  const lines = [
    '定时补单提醒：',
    `自动补单 ${result.createdOrders.length} 单。`,
    `补单前：${result.before.completed} 单`,
    `补单后：${result.after.completed} 单`,
  ];

  await sendMessage(NOTIFY_CHAT_ID, lines.join('\n'), { silent: true });
}

async function startScheduler() {
  if (!NOTIFY_CHAT_ID || !DEFAULT_TARGET || AUTO_INTERVAL_MINUTES <= 0) {
    console.log('[auto-order-bot] Scheduler not enabled (missing NOTIFY_CHAT_ID, target, or interval).');
    return;
  }

  const intervalMs = AUTO_INTERVAL_MINUTES * 60 * 1000;
  console.log(
    `[auto-order-bot] Scheduler enabled. Interval: ${AUTO_INTERVAL_MINUTES} 分钟，目标：${DEFAULT_TARGET} 单。`
  );
  setInterval(() => {
    runScheduledAutoFill().catch((error) => {
      console.error('[auto-order-bot] Scheduled run failed:', error.message);
    });
  }, intervalMs);

  // Run once at startup so the operator receives immediate feedback if needed.
  runScheduledAutoFill().catch((error) => {
    console.error('[auto-order-bot] Initial scheduled run failed:', error.message);
  });
}

process.on('SIGINT', () => {
  console.log('\n[auto-order-bot] Shutting down gracefully...');
  isPolling = false;
  process.exit(0);
});

(async () => {
  await startScheduler();
  await pollUpdates();
})();

