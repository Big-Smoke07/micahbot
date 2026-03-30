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
    print("⚡ FUNCTION CALLED:", player_name)

    url = f"https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p={player_name}"

    try:
        res = requests.get(url)

        print("STATUS:", res.status_code)
        print("RAW:", res.text[:300])

        data = res.json()

    except Exception as e:
        print("❌ ERROR:", e)
        return None

    if not data or not data.get("player"):
        return None

    player = data["player"][0]

    return {
        "name": player.get("strPlayer"),
        "club": player.get("strTeam"),
        "league": player.get("strLeague"),
        "games": "N/A",
        "goals": player.get("intGoals") or "N/A",
        "assists": "N/A",
        "yellow": "N/A",
        "image": player.get("strThumb")
    }


# --------- /stats COMMAND ----------
@bot.tree.command(name="stats", description="Get player season stats")
async def stats(interaction: discord.Interaction, player: str):

    await interaction.response.send_message("⏳ Fetching player stats...")

    data = await asyncio.to_thread(get_player_stats, player)

    if not data:
        await interaction.edit_original_response(
            content="❌ Player not found"
        )
        return

    embed = discord.Embed(
        title=f"{data['name']}",
        description=f"🏟️ {data['club']}  •  📊 {data['league']}",
        color=0x2b2d31
    )

    embed.add_field(
        name="📈 Info",
        value=(
            f"**Goals:** {data['goals']}\n"
            f"**Matches:** {data['games']}\n"
            f"**Assists:** {data['assists']}\n"
            f"**Yellow Cards:** {data['yellow']}"
        ),
        inline=False
    )

    if data["image"] and str(data["image"]).startswith("http"):
        embed.set_thumbnail(url=data["image"])

    embed.set_footer(text="Powered by TheSportsDB")

    await interaction.edit_original_response(content=None, embed=embed)

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