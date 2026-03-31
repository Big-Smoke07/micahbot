require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActivityType
} = require("discord.js");
const axios = require("axios");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const SPORTDB_API_KEY = process.env.SPORTDB_API_KEY;
const API_BASE_URL = "https://api.sportdb.dev";

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !SPORTDB_API_KEY) {
  console.error(
    "Missing required env vars. Expected DISCORD_TOKEN, DISCORD_CLIENT_ID, and SPORTDB_API_KEY."
  );
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show football stats for a player")
    .addStringOption((option) =>
      option
        .setName("player")
        .setDescription("Footballer name, for example Harry Kane")
        .setRequired(true)
    )
    .toJSON()
];

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "X-API-Key": SPORTDB_API_KEY
  },
  timeout: 15000
});

const PLAYER_ALIASES = {
  gavi: { id: "xrV9v8CU", url: "gavi", name: "Gavi" },
  "lamine yamal": { id: "lAt3vEub", url: "lamine-yamal", name: "Lamine Yamal" },
  "vini jr": { id: "CbwQ4Mws", url: "vinicius-junior", name: "Vinicius Junior" },
  "vinicius jr": { id: "CbwQ4Mws", url: "vinicius-junior", name: "Vinicius Junior" },
  "vini jnr": { id: "CbwQ4Mws", url: "vinicius-junior", name: "Vinicius Junior" },
  vini: { id: "CbwQ4Mws", url: "vinicius-junior", name: "Vinicius Junior" }
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getStatValue(stats, names) {
  if (!Array.isArray(stats)) {
    return 0;
  }

  const normalizedNames = names.map(normalizeText);
  const match = stats.find((entry) => normalizedNames.includes(normalizeText(entry.name)));
  return match ? match.value : 0;
}

function tokenizeName(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function scoreSearchResult(item, query) {
  const queryText = normalizeText(query);
  const queryParts = tokenizeName(query);
  const nameText = normalizeText(item.name);
  const nameParts = tokenizeName(item.name);
  const reversedNameText = [...nameParts].reverse().join(" ");
  const teamNames = (item.teams || []).map((team) => normalizeText(team.name));

  let score = 0;

  if (item.type === "player") {
    score += 100;
  }

  if (nameText === queryText) {
    score += 100;
  } else if (reversedNameText === queryText) {
    score += 95;
  } else if (nameText.startsWith(queryText)) {
    score += 80;
  } else if (reversedNameText.startsWith(queryText)) {
    score += 75;
  } else if (nameText.includes(queryText)) {
    score += 60;
  } else if (reversedNameText.includes(queryText)) {
    score += 55;
  }

  for (const part of queryParts) {
    if (nameParts.includes(part)) {
      score += 20;
    } else if (nameText.includes(part)) {
      score += 10;
    }
  }

  if ((item.teams || []).length > 0) {
    score += 5;
  }

  if (queryParts.length > 1 && queryParts.every((part) => nameParts.includes(part))) {
    score += 40;
  }

  if (teamNames.some((team) => team.includes("real madrid") || team.includes("manchester city") || team.includes("psg"))) {
    score += 1;
  }

  return score;
}

function rankSearchResults(results, query) {
  return results
    .filter((item) => item.type === "player")
    .map((item) => ({
      item,
      score: scoreSearchResult(item, query),
      nameLength: normalizeText(item.name).length || 999
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.nameLength - b.nameLength;
    })
    .map((entry) => entry.item);
}

function uniqueByLink(results) {
  const seen = new Set();
  const output = [];

  for (const item of results) {
    const key = `${item.url || ""}:${item.id || ""}`;
    if (!item || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseSeasonValue(season) {
  const match = String(season || "").match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

function chooseLatestLeagueEntry(leagues) {
  if (!Array.isArray(leagues) || !leagues.length) {
    return null;
  }

  return [...leagues]
    .filter((entry) => Array.isArray(entry.stats) && entry.stats.length > 0)
    .sort((a, b) => parseSeasonValue(b.season) - parseSeasonValue(a.season))[0] || null;
}

async function searchPlayers(playerName) {
  const normalizedPlayerName = normalizeText(playerName);
  const aliasMatch = PLAYER_ALIASES[normalizedPlayerName];
  if (aliasMatch) {
    return [aliasMatch];
  }

  const parts = tokenizeName(playerName);
  const queryVariants = uniqueByLink(
    [
      { q: playerName },
      { q: normalizeText(playerName) },
      parts.length > 1 ? { q: parts.join(" ") } : null,
      parts.length > 1 ? { q: [...parts].reverse().join(" ") } : null,
      parts.length > 0 ? { q: parts[0] } : null,
      parts.length > 1 ? { q: parts[parts.length - 1] } : null
    ].filter(Boolean).map((entry) => ({ url: entry.q, id: entry.q }))
  ).map((entry) => entry.url);

  const aggregatedResults = [];

  for (const query of queryVariants) {
    const response = await api.get("/api/flashscore/search", {
      params: { q: query }
    });

    aggregatedResults.push(...(response.data.results || []));
  }

  return rankSearchResults(uniqueByLink(aggregatedResults), playerName);
}

async function getPlayerDetails(slug, id) {
  const response = await api.get(`/api/flashscore/player/${slug}/${id}`);
  return response.data;
}

async function resolvePlayerWithStats(playerName) {
  const candidates = await searchPlayers(playerName);

  for (const candidate of candidates.slice(0, 12)) {
    try {
      const playerData = await getPlayerDetails(candidate.url, candidate.id);
      const latestLeagueEntry = chooseLatestLeagueEntry(playerData.careers?.league);

      if (latestLeagueEntry) {
        return { candidate, playerData, latestLeagueEntry };
      }
    } catch (error) {
      if (error.response?.status === 404) {
        continue;
      }

      throw error;
    }
  }

  return null;
}

function buildEmbed(playerData, latestLeagueEntry) {
  const playerName = [playerData.firstName, playerData.lastName].filter(Boolean).join(" ") || "Unknown Player";
  const stats = latestLeagueEntry?.stats || [];
  const teamName = latestLeagueEntry?.teamName || playerData.teamName || "Unknown";
  const gamesPlayed = getStatValue(stats, ["matches played", "appearances", "matches"]);
  const goals = getStatValue(stats, ["goals scored", "goals"]);
  const assists = getStatValue(stats, ["assists"]);
  const yellowCards = getStatValue(stats, ["yellow cards", "yellow"]);
  const season = latestLeagueEntry?.season || "";
  const competition = latestLeagueEntry?.competitionName || "";

  const embed = new EmbedBuilder()
    .setTitle(playerName)
    .setDescription(`**Club:** ${teamName}`)
    .setColor(0x1f8b4c)
    .addFields(
      { name: "Games Played", value: String(toNumber(gamesPlayed)), inline: true },
      { name: "Goals", value: String(toNumber(goals)), inline: true },
      { name: "Assists", value: String(toNumber(assists)), inline: true },
      { name: "Yellow Cards", value: String(toNumber(yellowCards)), inline: true }
    );

  if (playerData.photo) {
    embed.setThumbnail(playerData.photo);
  }

  if (season || competition || teamName) {
    embed.setFooter({
      text: [season, competition, teamName].filter(Boolean).join(" • ")
    });
  }

  return embed;
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }

    return await interaction.reply(payload);
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) {
      console.error("Reply skipped:", error.message);
      return null;
    }

    throw error;
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
  console.log("Registered global slash commands.");
}

client.once("clientReady", () => {
  client.user.setStatus("idle");
  client.user.setActivity("Fetching football stats", {
    type: ActivityType.Custom
  });
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "stats") {
    return;
  }

  const playerName = interaction.options.getString("player", true).trim();

  try {
    await interaction.deferReply();
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) {
      console.error("Failed to acknowledge interaction:", error.message);
      return;
    }

    throw error;
  }

  try {
    const resolved = await resolvePlayerWithStats(playerName);

    if (!resolved) {
      await safeReply(interaction, `No footballer with usable stats was found for "${playerName}".`);
      return;
    }

    const embed = buildEmbed(resolved.playerData, resolved.latestLeagueEntry);
    await safeReply(interaction, { embeds: [embed] });
  } catch (error) {
    console.error("Stats command failed:", error.response?.data || error.message);

    if (error.response?.status === 401 || error.response?.status === 403) {
      await safeReply(interaction, "SportDB rejected the API key. Double-check SPORTDB_API_KEY.");
      return;
    }

    await safeReply(interaction, "Something went wrong while fetching player stats from SportDB.");
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("Bot startup failed:", error.response?.data || error.message);
    process.exit(1);
  }
})();
