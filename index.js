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
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'stats') return;

    const teamInput = interaction.options.getString('team').toLowerCase();
    const playerInput = interaction.options.getString('player').toLowerCase();
    
    await interaction.deferReply();

    try {
        let targetTeam = null;

        // 1. Find the Team ID across the Top 5 Leagues
        for (const league of LEAGUES) {
            const cacheKey = `teams_${league}`;
            let teams;

            if (cache.has(cacheKey)) {
                teams = cache.get(cacheKey);
            } else {
                const res = await axios.get(`https://api.football-data.org/v4/competitions/${league}/teams`, {
                    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
                });
                teams = res.data.teams;
                cache.set(cacheKey, teams, 86400); // Cache team list for 24 hours
            }

            // Look for a match in this league's teams
            targetTeam = teams.find(t => t.name.toLowerCase().includes(teamInput) || t.shortName?.toLowerCase().includes(teamInput));
            if (targetTeam) break; 
        }

        if (!targetTeam) {
            return interaction.editReply(`❌ Could not find a team matching "**${teamInput}**" in the top leagues.`);
        }

        // 2. Get the Team's Squad and Matches (to calculate stats)
        // Note: The free tier squad endpoint doesn't give "Total Goals" directly.
        // We still need to check the /scorers list for live stats!
        
        const scorerRes = await axios.get(`https://api.football-data.org/v4/competitions/PL/scorers`, { // Example for PL, you'd use the team's league
            headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
        });

        // Search for the player in the league's top scorers
        const statMatch = scorerRes.data.scorers.find(s => 
            s.player.name.toLowerCase().includes(playerInput) && s.team.id === targetTeam.id
        );

        if (!statMatch) {
            return interaction.editReply(`ℹ️ Found **${targetTeam.name}**, but **${playerInput}** isn't in the league's top scorers list yet.`);
        }

        // 3. Build the Embed (Same as before)
        const embed = new EmbedBuilder()
            .setTitle(statMatch.player.name)
            .setThumbnail(targetTeam.crest) // Use the team's logo as a backup!
            .addFields(
                { name: '🏟️ Club', value: targetTeam.name, inline: true },
                { name: '⚽ Goals', value: statMatch.goals.toString(), inline: true },
                { name: '🎯 Assists', value: (statMatch.assists || 0).toString(), inline: true }
            )
            .setColor('#2b2d31');

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error(error);
        await interaction.editReply("⚠️ Error fetching data. You might be hitting the 10-call-per-minute limit!");
    }
});

client.login(process.env.DISCORD_TOKEN);