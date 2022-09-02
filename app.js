const { App } = require('@slack/bolt');
const { ethers } = require("ethers");
const AWS = require("aws-sdk");
require('dotenv').config();

// Initializes your app with your bot token and signing secret
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const provider = new ethers.providers.JsonRpcProvider(process.env.NETWORK_PROVIDER_URL);
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  endpoint: process.env.AWS_ENDPOINT,
  s3ForcePathStyle: true,
  signatureVersion: "v4",
  connectTimeout: 0,
  httpOptions: { timeout: 0 }
});
const blockNumberPath = 'blockNumber';
let blockNumber;

abi = [{"constant":false,"inputs":[{"name":"_level","type":"address"}],"name":"registerLevel","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"isOwner","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_instance","type":"address"}],"name":"submitLevelInstance","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_level","type":"address"}],"name":"createLevelInstance","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":false,"inputs":[{"name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"anonymous":false,"inputs":[{"indexed":true,"name":"player","type":"address"},{"indexed":false,"name":"instance","type":"address"}],"name":"LevelInstanceCreatedLog","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"player","type":"address"},{"indexed":false,"name":"level","type":"address"}],"name":"LevelCompletedLog","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}];

const data = require("./gamedata/gamedata.json")
const deployData = require("./gamedata/deploy.rinkeby.json")
const levelsIn = data.levels;
const levelsOut = [];

for (let i = 0; i < levelsIn.length; i++) {
  const level = levelsIn[i];
  level.deployedAddress = deployData[level.deployId]
  level.idx = i;
  levelsOut[level.deployedAddress] = level;
}

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);

  console.log('⚡️ Bolt app is running!');

  let blockNumber;
  try {
    const blockNumberObject = await s3.getObject({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: blockNumberPath,
    }).promise();

    blockNumber = Number(blockNumberObject.Body.toString());
  } catch (err) {
    blockNumber = await provider.getBlockNumber();

    await s3.putObject({
        Body: blockNumber.toString(),
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: blockNumberPath,
    }).promise();
  }

  const ethernaut = new ethers.Contract(process.env.ETHERNAUT_ADDRESS, abi, provider);
  const users = await app.client.usergroups.users.list({usergroup: process.env.SLACK_BOT_USERGROUP_ID});
  const wallets = [];

  for (const user of users.users) {
    console.log(`Loading profile ${user}`);
    const userProfile = await app.client.users.profile.get({user:user, include_labels: true});
    const wallet = userProfile.profile.fields[process.env.SLACK_BOT_WALLET_FIELD_ID]?.value;

    if (wallet) {
      console.log(`Loading wallet ${wallet}`);
      filterFrom = ethernaut.filters.LevelCompletedLog(wallet);

      wallets[wallet] = user;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const lastBlockNumber = await provider.getBlockNumber();
  const events = (await ethernaut.queryFilter("LevelCompletedLog", blockNumber + 1, lastBlockNumber)).filter(event => {
    return wallets[event.args.player];
  });

  for (const event of events) {
    console.log(`Event found for the wallet ${event.args.player}`);
    const result = await app.client.chat.postMessage({
        channel: process.env.SLACK_BOT_CHANNEL,
        text: `Well done <@${wallets[event.args.player]}>, You have completed the level ${levelsOut[event.args.level].name}!!!`
    });

    await s3.putObject({
      Body: event.blockNumber.toString(),
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: blockNumberPath,
    }).promise();
  }

  await s3.putObject({
    Body: lastBlockNumber.toString(),
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: blockNumberPath,
  }).promise();

  app.stop();
})();