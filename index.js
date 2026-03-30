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
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'stats') return;

    const playerName = interaction.options.getString('player').toLowerCase();
    
    await interaction.deferReply(); 

    let foundPlayer = null;
    let competitionName = "";

    try {
        for (const league of LEAGUES) {
            let scorersData;

            // --- THE CACHE CHECK ---
            // If the bot already saved this league recently, use the saved data!
            if (cache.has(league)) {
                scorersData = cache.get(league);
                console.log(`Loaded ${league} from cache!`);
            } else {
                // If not, fetch it from the API and save it to the cache for next time
                console.log(`Fetching ${league} from API...`);
                const response = await axios.get(`https://api.football-data.org/v4/competitions/${league}/scorers`, {
                    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN }
                });
                
                scorersData = response.data;
                cache.set(league, scorersData); // Save to cache
            }

            const scorers = scorersData.scorers;
            const match = scorers.find(s => s.player.name.toLowerCase().includes(playerName));

            if (match) {
                foundPlayer = match;
                competitionName = scorersData.competition.name;
                break; 
            }
        }

        if (!foundPlayer) {
            return interaction.editReply(`❌ Could not find **${playerName}** in the top scorers/assisters list of the Top 5 Leagues.`);
        }

        const { player, team, playedMatches, goals, assists, penalties } = foundPlayer;

        const statsEmbed = new EmbedBuilder()
            .setColor('#2b2d31') 
            .setTitle(player.name)
            .setThumbnail('https://i.imgur.com/3j3bA8v.png') 
            .addFields(
                { name: '🏟️ Club', value: team.name, inline: false },
                { name: '🏆 League', value: competitionName, inline: false },
                { name: '📍 Nationality', value: player.nationality || 'Unknown', inline: false },
                { name: '⚽ Matches Played', value: playedMatches !== null ? playedMatches.toString() : '0', inline: false },
                { name: '⚽ Goals', value: goals !== null ? goals.toString() : '0', inline: false },
                { name: '🎯 Assists', value: assists !== null ? assists.toString() : '0', inline: false },
                { name: '🥅 Penalties Scored', value: penalties !== null ? penalties.toString() : '0', inline: false }
            )
            .setFooter({ text: 'Live Current Season Stats • football-data.org' });

        await interaction.editReply({ embeds: [statsEmbed] });

    } catch (error) {
        console.error('API Error:', error.response ? error.response.data : error.message);
        
        if (error.response && error.response.status === 429) {
            return interaction.editReply('⚠️ Rate limit hit! Even with caching, we requested too much too fast. Please try again in a minute.');
        }

        await interaction.editReply('❌ An error occurred while fetching the stats.');
    }
});

client.login(process.env.DISCORD_TOKEN);