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
bot = commands.Bot(command_prefix="!", intents=intents)
tree = bot.tree

# --------- HELPER FUNCTION ----------
def get_player_stats(player_name):
    url = "https://sportdb.dev/api/v1/players/search"

    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }

    params = {
        "name": player_name
    }

    response = requests.get(url, headers=headers, params=params)

    try:
        data = response.json()
    except:
        return None

    print("API RESPONSE:", data)  # DEBUG

    # check if valid
    if not data or "data" not in data or len(data["data"]) == 0:
        return None

    player = data["data"][0]

    return {
        "name": player.get("name", "Unknown"),
        "club": player.get("team", "Unknown"),
        "league": player.get("league", "Unknown"),
        "games": player.get("games", 0),
        "goals": player.get("goals", 0),
        "assists": player.get("assists", 0),
        "yellow": player.get("yellowCards", 0),
        "image": player.get("image")
    }


# --------- /stats COMMAND ----------
@tree.command(name="stats", description="Get player season stats")
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
@tree.command(name="aboutme", description="About the bot")
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
    print(f"Logged in as {bot.user}")

    try:
        for guild_id in GUILD_IDS:
            guild = discord.Object(id=guild_id)
            synced = await tree.sync(guild=guild)
            print(f"✅ Synced {len(synced)} commands to {guild_id}")

    except Exception as e:
        print(f"❌ Sync error: {e}")


# --------- RUN ----------
bot.run(TOKEN)