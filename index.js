require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const NodeCache = require('node-cache');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Initialize the cache. 
// stdTTL is "Time To Live" in seconds. 600 seconds = 10 minutes.
const cache = new NodeCache({ stdTTL: 600 }); 

const LEAGUES = ['PL', 'PD', 'SA', 'BL1', 'FL1']; 

const commands = [
    {
        name: 'stats',
        description: 'Get live current season stats for a player.',
        options: [
            {
                name: 'player',
                description: 'The name of the player (e.g., Pedri, Haaland)',
                type: 3, 
                required: true,
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}! Ready to fetch stats.`);
});

client.on('interactionCreate', async interaction => {
    // 1. Filter for Slash Commands
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'stats') return;

    // 2. IMMEDIATELY Defer (Gives you 15 mins instead of 3 seconds)
    try {
        await interaction.deferReply(); 
    } catch (e) {
        console.error("Failed to defer:", e);
        return;
    }

    const teamInput = interaction.options.getString('team').toLowerCase();
    const playerInput = interaction.options.getString('player').toLowerCase();

    try {
        let targetTeam = null;
        let leagueOfTeam = null;

        // Search for the team
        for (const league of LEAGUES) {
            const cacheKey = `teams_${league}`;
            let teams = cache.get(cacheKey);

            if (!teams) {
                const res = await axios.get(`https://api.football-data.org/v4/competitions/${league}/teams`, {
                    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
                });
                teams = res.data.teams;
                cache.set(cacheKey, teams, 86400);
            }

            targetTeam = teams.find(t => t.name.toLowerCase().includes(teamInput) || t.shortName?.toLowerCase().includes(teamInput));
            if (targetTeam) {
                leagueOfTeam = league;
                break;
            }
        }

        if (!targetTeam) {
            return interaction.editReply(`❌ Could not find team: **${teamInput}**`);
        }

        // Fetch scorers for that specific league
        const scorerRes = await axios.get(`https://api.football-data.org/v4/competitions/${leagueOfTeam}/scorers`, {
            headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
        });

        const statMatch = scorerRes.data.scorers.find(s => 
            s.player.name.toLowerCase().includes(playerInput) && s.team.id === targetTeam.id
        );

        if (!statMatch) {
            return interaction.editReply(`ℹ️ Found **${targetTeam.name}**, but **${playerInput}** isn't in the league's top scorers list.`);
        }

        // Success Embed
        const embed = new EmbedBuilder()
            .setTitle(statMatch.player.name)
            .setThumbnail(targetTeam.crest)
            .addFields(
                { name: '🏟️ Club', value: targetTeam.name, inline: true },
                { name: '⚽ Goals', value: statMatch.goals.toString(), inline: true },
                { name: '🎯 Assists', value: (statMatch.assists || 0).toString(), inline: true }
            )
            .setColor('#2b2d31');

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error("Search Error:", error.message);
        
        // Handle Rate Limits specifically
        if (error.response?.status === 429) {
            return interaction.editReply("⚠️ Rate limit hit! The free API only allows 10 requests per minute. Try again in 30 seconds.");
        }

        await interaction.editReply("❌ An error occurred. Check the console for details.");
    }
});

client.login(process.env.DISCORD_TOKEN);