const dotenv = require('dotenv');

dotenv.config();

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseMaxEmbeds(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 1;
  }
  return Math.min(Math.max(parsed, 1), 5);
}

module.exports = {
  discordToken: requireEnv('DISCORD_TOKEN'),
  facebookUserAgent: process.env.FACEBOOK_USER_AGENT || DEFAULT_USER_AGENT,
  maxFacebookEmbeds: parseMaxEmbeds(process.env.MAX_FACEBOOK_EMBEDS || '1'),
};
