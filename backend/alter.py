import asyncio
import os
import sys
from sqlalchemy import text
from app.infrastructure.database import engine

async def alter_table():
    async with engine.begin() as conn:
        print("Altering table columns to TEXT...")
        await conn.execute(text("ALTER TABLE transactions ALTER COLUMN kbk TYPE TEXT, ALTER COLUMN knp TYPE TEXT, ALTER COLUMN receipt_number TYPE TEXT, ALTER COLUMN party_from TYPE TEXT, ALTER COLUMN party_to TYPE TEXT, ALTER COLUMN party_identifier TYPE TEXT;"))
        print("Done!")

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(alter_table())
