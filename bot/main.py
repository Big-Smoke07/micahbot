import asyncio
import discord
from discord import app_commands
from discord.ext import commands
import requests
import os
from dotenv import load_dotenv

load_dotenv()

GUILD_IDS = [
    1396941278507307048,  # Server 1
    741705713512087652,  # Server 2
    1488233064575402175   # Server 3
]

TOKEN = os.getenv("DISCORD_TOKEN")
API_KEY = os.getenv("SPORTDB_API_KEY")

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)


# --------- HELPER FUNCTION ----------
def get_player_stats(player_name):
    headers = {
        "X-API-Key": API_KEY
    }

    # STEP 1: search player
    search_url = f"https://api.sportdb.dev/api/players/search/{player_name}"
    res = requests.get(search_url, headers=headers)

    print("SEARCH STATUS:", res.status_code)

    if res.status_code != 200:
        print(res.text)
        return None

    data = res.json()
    if not data:
        return None

    player = data[0]
    player_id = player["id"]

    # STEP 2: get stats
    stats_url = f"https://api.sportdb.dev/api/players/{player_id}/stats"
    res2 = requests.get(stats_url, headers=headers)

    print("STATS STATUS:", res2.status_code)

    if res2.status_code != 200:
        print(res2.text)
        return None

    stats_data = res2.json()
    if not stats_data:
        return None

    stats = stats_data[0]

    return {
        "name": player.get("name"),
        "club": stats.get("team"),
        "league": stats.get("league"),
        "games": stats.get("appearances"),
        "goals": stats.get("goals"),
        "assists": stats.get("assists"),
        "yellow": stats.get("yellowCards"),
        "image": player.get("image")
    }


# --------- /stats COMMAND ----------
@bot.tree.command(name="stats", description="Get player season stats")
async def stats(interaction: discord.Interaction, player: str):

    # ⚡ respond instantly (NO defer)
    await interaction.response.send_message("⏳ Fetching player stats...")

    # run blocking function safely
    data = await asyncio.to_thread(get_player_stats, player)

    if not data:
        await interaction.edit_original_response(
            content="❌ Player retired / not in database"
        )
        return

    embed = discord.Embed(
        title=f"{data['name']} — Season Stats",
        description=f"🏟️ {data['club']}  •  📊 {data['league']}",
        color=0x2b2d31
    )

    embed.add_field(
        name="📈 Performance",
        value=(
            f"**Matches Played:** {data['games']}\n"
            f"**Goals:** {data['goals']}\n"
            f"**Assists:** {data['assists']}\n"
            f"**Yellow Cards:** {data['yellow']}"
        ),
        inline=False
    )

    if data["image"] and str(data["image"]).startswith("http"):
        embed.set_thumbnail(url=data["image"])

    embed.set_footer(text="Season data • Powered by sportdb.dev")

    # 🔁 edit instead of followup
    await interaction.edit_original_response(content=None, embed=embed)
# --------- /aboutme COMMAND ----------
@bot.tree.command(name="aboutme", description="About the bot")
async def aboutme(interaction: discord.Interaction):

    embed = discord.Embed(
        title="About Me",
        description="Made by Big Smoke",
        color=0x2b2d31
    )

    await interaction.response.send_message(embed=embed)


# --------- READY EVENT ----------
@bot.event
async def on_ready():
    try:
        synced = await bot.tree.sync()
        print(f"✅ Synced {len(synced)} commands")
    except Exception as e:
        print(e)

    print(f"Logged in as {bot.user}")

# --------- RUN ----------
bot.run(TOKEN)