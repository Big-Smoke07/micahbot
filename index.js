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
const blockedTerms = require("./blocked-terms");

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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

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

const ALLOWED_GUILD_IDS = new Set([
  "741705713512087652",
  "1488233064575402175",
  "1396941278507307048"
]);

const RESTRICTED_SERVER_MESSAGE = "Sorry this bot is exclusively made for Markaroni server";

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const PLAYER_CACHE_TTL_MS = 60 * 60 * 1000;
const TEAM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE = {
  search: new Map(),
  player: new Map(),
  team: new Map()
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

function tokenizeName(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPercent(value) {
  const numeric = toNumber(value);
  return Number.isInteger(numeric) ? `${numeric}%` : `${numeric.toFixed(1)}%`;
}

function getStatValue(stats, names) {
  if (!Array.isArray(stats)) {
    return 0;
  }

  const normalizedNames = names.map(normalizeText);
  const match = stats.find((entry) => normalizedNames.includes(normalizeText(entry.name)));
  return match ? match.value : 0;
}

function isBlockedQuery(value) {
  const normalizedQuery = normalizeText(value);

  return blockedTerms.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && normalizedQuery.includes(normalizedTerm);
  });
}

function isAllowedGuildId(guildId) {
  return Boolean(guildId) && ALLOWED_GUILD_IDS.has(guildId);
}

function getCached(map, key) {
  const cached = map.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    map.delete(key);
    return null;
  }

  return cached.value;
}

function setCached(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
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

  if (
    teamNames.some(
      (team) =>
        team.includes("real madrid") ||
        team.includes("manchester city") ||
        team.includes("psg") ||
        team.includes("barcelona") ||
        team.includes("arsenal")
    )
  ) {
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
    if (!item) {
      continue;
    }

    const key = `${item.url || ""}:${item.id || ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseSeasonValue(season) {
  const matches = String(season || "").match(/\d{4}/g);
  if (!matches || !matches.length) {
    return 0;
  }

  return Number(matches[matches.length - 1]) || 0;
}

function getLatestSeason(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }

  return [...entries]
    .filter((entry) => Array.isArray(entry.stats) && entry.stats.length > 0)
    .sort((a, b) => parseSeasonValue(b.season) - parseSeasonValue(a.season))[0]?.season || "";
}

function aggregateStats(entries, statNames) {
  return entries.reduce((total, entry) => total + toNumber(getStatValue(entry.stats, statNames)), 0);
}

function buildSeasonSummary(playerData) {
  const careers = playerData.careers || {};
  const allCompetitions = [
    ...(careers.league || []),
    ...(careers.nationalCups || []),
    ...(careers.internationalCups || [])
  ].filter((entry) => Array.isArray(entry.stats) && entry.stats.length > 0);

  if (!allCompetitions.length) {
    return null;
  }

  const latestSeason = getLatestSeason(allCompetitions);
  const seasonEntries = allCompetitions.filter((entry) => entry.season === latestSeason);

  if (!seasonEntries.length) {
    return null;
  }

  const isGoalkeeper = seasonEntries.some((entry) => {
    return entry.stats.some((stat) => {
      const statName = normalizeText(stat.name);
      return statName === "save percentage" || statName === "shutouts" || statName === "clean sheets";
    });
  });

  const competitionNames = [...new Set(seasonEntries.map((entry) => entry.competitionName).filter(Boolean))];
  const teamName = seasonEntries.find((entry) => entry.teamName)?.teamName || playerData.teamName || "Unknown";

  return {
    season: latestSeason,
    teamName,
    competitionsLabel:
      competitionNames.length > 1 ? "All Competitions" : competitionNames[0] || "Season Stats",
    gamesPlayed: aggregateStats(seasonEntries, ["matches played", "appearances", "matches"]),
    goals: aggregateStats(seasonEntries, ["goals scored", "goals"]),
    assists: aggregateStats(seasonEntries, ["assists"]),
    cleanSheets: aggregateStats(seasonEntries, ["shutouts", "clean sheets"]),
    yellowCards: aggregateStats(seasonEntries, ["yellow cards", "yellow"]),
    savePercentage:
      seasonEntries.reduce((total, entry) => total + toNumber(getStatValue(entry.stats, ["save percentage"])), 0) /
      Math.max(
        seasonEntries.filter((entry) => toNumber(getStatValue(entry.stats, ["save percentage"])) > 0).length,
        1
      ),
    isGoalkeeper
  };
}

async function searchPlayers(playerName) {
  const normalizedPlayerName = normalizeText(playerName);
  const aliasMatch = PLAYER_ALIASES[normalizedPlayerName];
  if (aliasMatch) {
    return [aliasMatch];
  }

  const cached = getCached(CACHE.search, normalizedPlayerName);
  if (cached) {
    return cached;
  }

  const parts = tokenizeName(playerName);
  const queryVariants = uniqueByLink(
    [
      { q: playerName },
      { q: normalizedPlayerName },
      parts.length > 1 ? { q: parts.join(" ") } : null,
      parts.length > 1 ? { q: [...parts].reverse().join(" ") } : null,
      parts.length > 0 ? { q: parts[0] } : null,
      parts.length > 1 ? { q: parts[parts.length - 1] } : null
    ]
      .filter(Boolean)
      .map((entry) => ({ url: entry.q, id: entry.q }))
  ).map((entry) => entry.url);

  const aggregatedResults = [];

  for (const query of queryVariants) {
    const response = await api.get("/api/flashscore/search", {
      params: { q: query }
    });

    aggregatedResults.push(...(response.data.results || []));
  }

  const ranked = rankSearchResults(uniqueByLink(aggregatedResults), playerName);
  setCached(CACHE.search, normalizedPlayerName, ranked, SEARCH_CACHE_TTL_MS);
  return ranked;
}

async function getPlayerDetails(slug, id) {
  const cacheKey = `${slug}:${id}`;
  const cached = getCached(CACHE.player, cacheKey);
  if (cached) {
    return cached;
  }

  const response = await api.get(`/api/flashscore/player/${slug}/${id}`);
  setCached(CACHE.player, cacheKey, response.data, PLAYER_CACHE_TTL_MS);
  return response.data;
}

async function getTeamDetails(teamSlug, teamId) {
  if (!teamSlug || !teamId) {
    return null;
  }

  const cacheKey = `${teamSlug}:${teamId}`;
  const cached = getCached(CACHE.team, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await api.get(`/api/flashscore/team/${teamSlug}/${teamId}`);
    setCached(CACHE.team, cacheKey, response.data, TEAM_CACHE_TTL_MS);
    return response.data;
  } catch (error) {
    if (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403) {
      return null;
    }

    throw error;
  }
}

function extractClubLogo(teamData) {
  if (!teamData || typeof teamData !== "object") {
    return null;
  }

  const candidateKeys = ["logo", "image", "badge", "crest", "photo"];
  for (const key of candidateKeys) {
    const value = teamData[key];
    if (typeof value === "string" && value.startsWith("http")) {
      return value;
    }
  }

  if (Array.isArray(teamData.images)) {
    const image = teamData.images.find((value) => typeof value === "string" && value.startsWith("http"));
    if (image) {
      return image;
    }
  }

  return null;
}

async function resolvePlayerWithStats(playerName) {
  const candidates = await searchPlayers(playerName);

  for (const candidate of candidates.slice(0, 8)) {
    try {
      const playerData = await getPlayerDetails(candidate.url, candidate.id);
      const seasonSummary = buildSeasonSummary(playerData);

      if (seasonSummary) {
        const teamData = await getTeamDetails(playerData.teamSlug, playerData.teamId);
        return {
          candidate,
          playerData,
          seasonSummary,
          clubLogo: extractClubLogo(teamData)
        };
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

function buildEmbed(playerData, seasonSummary, clubLogo) {
  const playerName = [playerData.firstName, playerData.lastName].filter(Boolean).join(" ") || "Unknown Player";

  const embed = new EmbedBuilder()
    .setTitle(playerName)
    .setDescription(`**Club:** ${seasonSummary.teamName}`)
    .setColor(0x1f8b4c)
    .addFields(
      { name: "Games Played", value: String(toNumber(seasonSummary.gamesPlayed)), inline: true },
      ...(seasonSummary.isGoalkeeper
        ? [
            { name: "Clean Sheets", value: String(toNumber(seasonSummary.cleanSheets)), inline: true },
            { name: "Save %", value: formatPercent(seasonSummary.savePercentage), inline: true }
          ]
        : [
            { name: "Goals", value: String(toNumber(seasonSummary.goals)), inline: true },
            { name: "Assists", value: String(toNumber(seasonSummary.assists)), inline: true }
          ]),
      { name: "Yellow Cards", value: String(toNumber(seasonSummary.yellowCards)), inline: true }
    );

  if (playerData.photo) {
    embed.setThumbnail(playerData.photo);
  }

  if (clubLogo) {
    embed.setAuthor({
      name: seasonSummary.teamName,
      iconURL: clubLogo
    });
  }

  embed.setFooter({
    text: [seasonSummary.season, seasonSummary.competitionsLabel, seasonSummary.teamName]
      .filter(Boolean)
      .join(" • ")
  });

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

client.on("messageCreate", async (message) => {
  if (message.author.bot) {
    return;
  }

  if (!isAllowedGuildId(message.guildId)) {
    await message.reply(RESTRICTED_SERVER_MESSAGE);
    return;
  }

  if (normalizeText(message.content) === "arsenal") {
    await message.reply("bottlers");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "stats") {
    return;
  }

  if (!isAllowedGuildId(interaction.guildId)) {
    await safeReply(interaction, RESTRICTED_SERVER_MESSAGE);
    return;
  }

  const playerName = interaction.options.getString("player", true).trim();

  if (isBlockedQuery(playerName)) {
    await safeReply(interaction, "That search term isn't allowed.");
    return;
  }

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

    const embed = buildEmbed(resolved.playerData, resolved.seasonSummary, resolved.clubLogo);
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
