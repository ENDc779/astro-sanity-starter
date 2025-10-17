# Astro Netlify Sanity Starter

![Astro Netlify Sanity Starter](https://assets.stackbit.com/docs/astro-sanity-starter-thumb.jpg)

[Live Demo](https://astro-sanity-starter-demo.netlify.app/)

Netlify Astro and Sanity minimal starter with [visual editing](https://docs.netlify.com/visual-editor/overview/).

| Prerequisites                                                                |
| :--------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/) v18.17.+                                      |
| (optional) [nvm](https://github.com/nvm-sh/nvm) for Node version management. |

## Getting Started

Create local project from this repo and run:

```txt
npm install
```

### Sign Into Sanity

If you are not already signed into Sanity via the CLI, install the CLI package and then run the login command.

    npm install -g @sanity/cli
    sanity login

This will open a browser and walk you through the authentication process.

### Import Content

Once authenticated, you'll be able to create a Sanity project and import content.

    npm run create-project

_Note: You may want to sign into Sanity in the browser and rename your project._

Once the project exists and you've set the environment variables, you can import the content.

    npm run import {projectId}

Replace `{projectId}` with the project ID output from the previous command.

### Store Sanity Values

Sign into Sanity to create an editor token, navigate to the following address (replace the `SANITY_PROJECT_ID` with your project ID) `https://www.sanity.io/manage/personal/project/SANITY_PROJECT_ID/api#tokens`. Then create `.env` file in you repo, copy & paste the following environment variables into the file and set their values.

```plain
SANITY_PROJECT_ID="..."
SANITY_DATASET="..."
SANITY_TOKEN="..."
```

### Run Sanity Studio

Sanity Studio code exists for this project in the `studio` directory. First, install the dependencies in this directory.

    cd studio
    npm install

Then create a `.env` file in the `studio` directory with the following environment variables and set their values:

```plain
SANITY_STUDIO_PROJECT_ID="..."
SANITY_STUDIO_DATASET="..."
```

Then run the studio locally.

    sanity dev

If you want to see the content, you can open your browser and navigate to localhost:3333.

### Start Development Server

Then you can run the Astro.js development server in root directory:

```txt
npm run dev
```

Install Netlify Create CLI:

    npm install -g @stackbit/cli

And the Stackbit development server.

    stackbit dev

This outputs your own Netlify Create URL. Open this, register or sign in, and you will be directed to Netlify Create's visual editor for your new project.

## Next Steps

Here are a few suggestions on what to do next if you're new to Netlify visual editor:

- Learn [how Netlify visual editor works](https://docs.netlify.com/create/concepts/how-create-works/)
- Check [Netlify visual editor reference documentation](https://visual-editor-reference.netlify.com/)

## Support

If you get stuck along the way, get help in our [support forums](https://answers.netlify.com/).

## Telegram 自动补单机器人

仓库中提供了一个简单的 Telegram 机器人脚本，支持自动补单、统计查询以及定时巡检功能。脚本位于 `scripts/autoOrderBot.js`，默认读取 `data/orders.json` 作为订单数据存储。

### 快速开始

1. 在 Telegram 中创建机器人并获取 `TELEGRAM_BOT_TOKEN`（使用 [@BotFather](https://core.telegram.org/bots#botfather)）。
2. 在项目根目录创建 `.env.local`（或直接导出环境变量），至少包含以下内容：

   ```bash
   TELEGRAM_BOT_TOKEN="你的机器人 Token"
   TELEGRAM_NOTIFY_CHAT_ID="接收通知的聊天 ID"
   AUTO_FILL_TARGET_COMPLETED="30" # 可选，默认补单目标
   AUTO_FILL_INTERVAL_MINUTES="15" # 可选，定时任务间隔（分钟）
   TELEGRAM_ALLOWED_CHAT_IDS="123456789,987654321" # 可选，限制可用的聊天 ID
   ```

   > `ORDER_DATA_FILE` 可选，如果需要自定义订单数据文件路径，可设置此变量。

3. 运行脚本：

   ```bash
   node scripts/autoOrderBot.js
   ```

4. 在 Telegram 中向机器人发送以下命令体验功能：

   - `/start` 或 `/help`：查看帮助信息。
   - `/stats`：查看今日及累计统计。
   - `/fill <目标> [模板] [备注]`：根据目标自动补单。
   - `/补单 <目标> [模板] [备注]`：与 `/fill` 相同的中文命令。
   - `/templates`：查看可用模板列表。

### 数据存储说明

- `data/orders.json` 保存历史订单及模板配置，机器人自动补单会将新订单写回该文件。
- 可以在 `templates` 数组中配置多个补单模板，通过 `isDefault: true` 指定默认模板。
- 手动编辑订单或模板后，重启机器人即可读取最新配置。

> 机器人脚本依赖 Node.js v18+ 提供的原生 `fetch`，请确保运行环境满足 README 顶部的 Node.js 要求。
