import discord
from discord.ext import commands
from discord import app_commands
import asyncio
import soccerdata as sd
import pandas as pd
import os

# ================= CONFIG =================

TOKEN = os.getenv("DISCORD_TOKEN")  # Railway env var

intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)

# ================= GLOBAL DATA =================

player_df = None

# ================= LOAD DATA =================

def load_data():
    global player_df

    print("📦 Loading player data...")

    try:
        fbref = sd.FBref()

        # Load only top league for speed (can expand later)
        df = fbref.read_player_season_stats(
    leagues=[
        "ENG-Premier League",
        "ESP-La Liga",
        "ITA-Serie A",
        "GER-Bundesliga",
        "FRA-Ligue 1"
    ]
)

        df = df.reset_index()

        player_df = df

        print("✅ Data loaded:", len(player_df))

    except Exception as e:
        print("❌ Error loading data:", e)

# ================= FETCH FUNCTION =================

def get_player_stats(player_name):
    global player_df
    print(player_df["player"].head(20))

    if player_df is None:
        return None

    players = player_df[
        player_df["player"].str.contains(player_name, case=False, na=False)
    ]

    if players.empty:
        return None

    p = players.iloc[0]

    return {
        "name": p["player"],
        "club": p.get("team", "Unknown"),
        "league": p.get("league", "Unknown"),
        "games": int(p.get("games", 0)),
        "goals": int(p.get("goals", 0)),
        "assists": int(p.get("assists", 0)),
        "yellow": int(p.get("cards_yellow", 0)),
        "image": None
    }

# ================= EVENTS =================

@bot.event
async def on_ready():
    print(f"🤖 Logged in as {bot.user}")

    try:
        synced = await bot.tree.sync()
        print(f"✅ Synced {len(synced)} commands")
    except Exception as e:
        print("❌ Sync error:", e)

    # Load data in background
    await asyncio.to_thread(load_data)

# ================= COMMAND =================

@bot.tree.command(name="stats", description="Get player stats")
async def stats(interaction: discord.Interaction, player: str):

    await interaction.response.send_message("⏳ Fetching player stats...")

    data = await asyncio.to_thread(get_player_stats, player)

    if not data:
        await interaction.edit_original_response(
            content="❌ Player not found"
        )
        return

    embed = discord.Embed(
        title=data["name"],
        description=f"🏟️ {data['club']} • 📊 {data['league']}",
        color=0x2b2d31
    )

    embed.add_field(
        name="📈 Season Stats",
        value=(
            f"**Goals:** {data['goals']}\n"
            f"**Matches:** {data['games']}\n"
            f"**Assists:** {data['assists']}\n"
            f"**Yellow Cards:** {data['yellow']}"
        ),
        inline=False
    )

    embed.set_footer(text="Powered by FBref via soccerdata")

    await interaction.edit_original_response(content=None, embed=embed)

# ================= RUN =================

bot.run(TOKEN)