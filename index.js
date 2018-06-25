"use strict";

const Botkit = require("botkit");
const puppeteer = require("puppeteer");
const tempfile = require("tempfile");
const fs = require("fs");
const rp = require("request-promise");

// This configuration can gets overwritten when process.env.SLACK_MESSAGE_EVENTS is given.
const DEFAULT_SLACK_MESSAGE_EVENTS = "direct_message,direct_mention,mention";

if (!process.env.SLACK_BOT_TOKEN) {
  console.error("Error: Specify SLACK_BOT_TOKEN in environment values");
  process.exit(1);
}
if (!((process.env.REDASH_HOST && process.env.REDASH_API_KEY) || (process.env.REDASH_HOSTS_AND_API_KEYS))) {
  console.error("Error: Specify REDASH_HOST and REDASH_API_KEY in environment values");
  console.error("Or you can set multiple Re:dash configs by specifying like below");
  console.error("REDASH_HOSTS_AND_API_KEYS=\"http://redash1.example.com;TOKEN1,http://redash2.example.com;TOKEN2\"");
  process.exit(1);
}

const parseApiKeysPerHost = () => {
  if (process.env.REDASH_HOST) {
    if (process.env.REDASH_HOST_ALIAS) {
      return {[process.env.REDASH_HOST]: {"alias": process.env.REDASH_HOST_ALIAS, "key": process.env.REDASH_API_KEY}};
    } else {
      return {[process.env.REDASH_HOST]: {"alias": process.env.REDASH_HOST, "key": process.env.REDASH_API_KEY}};
    }
  } else {
    return process.env.REDASH_HOSTS_AND_API_KEYS.split(",").reduce((m, host_and_key) => {
      var [host, alias, key] = host_and_key.split(";");
      if (!key) {
        key = alias;
        alias = host;
      }
      m[host] = {"alias": alias, "key": key};
      return m;
    }, {});
  }
};

const redashApiKeysPerHost = parseApiKeysPerHost();
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackMessageEvents = process.env.SLACK_MESSAGE_EVENTS || DEFAULT_SLACK_MESSAGE_EVENTS;
const chromiumBrowserPath = process.env.CHROMIUM_BROWSER_PATH || "";

const controller = Botkit.slackbot({
  debug: !!process.env.DEBUG
});

controller.spawn({
  retry: 3,
  token: slackBotToken
}).startRTM();

Object.keys(redashApiKeysPerHost).forEach((redashHost) => {
  const redashHostAlias = redashApiKeysPerHost[redashHost]["alias"];
  const redashApiKey    = redashApiKeysPerHost[redashHost]["key"];
  controller.hears(`${redashHost}/queries/([0-9]+)#([0-9]+)`, slackMessageEvents, (bot, message) => {
    const originalUrl = message.match[0];
    const queryId = message.match[1];
    const visualizationId =  message.match[2];

    const queryUrl = `${redashHostAlias}/queries/${queryId}#${visualizationId}`;
    const embedUrl = `${redashHostAlias}/embed/query/${queryId}/visualization/${visualizationId}?api_key=${redashApiKey}`;

    bot.reply(message, `Taking screenshot of ${originalUrl}`);
    bot.botkit.log(queryUrl);
    bot.botkit.log(embedUrl);

    const outputFile = tempfile(".png");

    (async () => {
      try {
        const queryInfo = await rp.get(`${redashHost}/api/queries/${queryId}?api_key=${redashApiKey}`, {json: true});

        const puppeteerOptions = {
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
          ]
        };
        if (chromiumBrowserPath !== "") {
          puppeteerOptions["executablePath"] = chromiumBrowserPath;
        }
        const browser = await puppeteer.launch(puppeteerOptions);
        const page = await browser.newPage();
        await page.setViewport({width: 1024, height: 480});
        await page.goto(embedUrl, {waitUntil: "networkidle2"});
        await page.screenshot({path: outputFile});
        await browser.close();

        const slackOptions = {
          token: slackBotToken,
          filename: `${queryInfo.name}-${queryId}-${visualizationId}.png`,
          file: fs.createReadStream(outputFile),
          channels: message.channel
        };
        await rp.post("https://api.slack.com/api/files.upload", {formData: slackOptions});
        bot.botkit.log(`ok, upload ${slackOptions.filename} to ${slackOptions.channels}`);
      } catch(e) {
        bot.reply(message, `Something wrong happend in file upload \`\`\`${e}\`\`\``);
        bot.botkit.log.error(e);
      }
    })();
  });
});
