# Football Stats Discord Bot

Simple Node.js Discord bot that uses `sportdb.dev` to show football player stats in an embed with a thumbnail image.

## Command

- `/stats player:<name>`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id
SPORTDB_API_KEY=your_sportdb_api_key
```

3. Start the bot:

```bash
npm start
```

## Railway

- Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `SPORTDB_API_KEY` in Railway variables.
- Start command: `npm start`
- Node `18.x` is already set in `package.json`.
- Slash commands are registered globally, so the bot can be used in multiple servers.
- Global slash commands can take a little time to appear after the bot starts.
