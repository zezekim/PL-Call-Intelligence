"""Rewrite existing calls' coaching in plain words (one model call per call).

    python -m callsentry.scripts.plain_coaching [--dry-run]

Skips calls already rewritten, and stops if the daily spending cap is hit.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from callsentry.core.db import get_sessionmaker
from callsentry.intel import plainspeak
from callsentry.models import Call, CallAnalysis, CostCategory
from callsentry.services import costs, spend
from callsentry.services.platform_settings import load_overrides


async def main(dry_run: bool) -> None:
    async with get_sessionmaker()() as session:
        await load_overrides(session)
        await spend.refresh(session)
        rows = (
            await session.scalars(select(CallAnalysis).options(selectinload(CallAnalysis.call)))
        ).all()
        todo = [a for a in rows if (a.coaching or {}).get("coaching")
                and not (a.coaching or {}).get("plain")]
        print(f"{len(todo)} of {len(rows)} calls need plain coaching")
        total = 0.0
        for analysis in todo:
            if dry_run:
                continue
            if spend.exceeded():
                print("daily spending cap reached; stopping")
                break
            call: Call = analysis.call
            analysis.coaching, result = await plainspeak.rewrite(analysis.coaching)
            await costs.record(
                session, business_id=call.business_id, call_id=call.id,
                category=CostCategory.LLM, provider=result.provider, tier=result.tier,
                units=result.total_tokens / 1000, unit_name="1k_tokens", cost_usd=result.cost_usd,
            )
            await costs.recompute_call_cost(session, call.id)
            await session.commit()
            total += result.cost_usd
            first = (analysis.coaching.get("coaching") or [{}])[0].get("title")
            print(f"{call.external_ref or call.id}: ${result.cost_usd:.4f}  {first}")
        print(f"done, ${total:.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    asyncio.run(main(parser.parse_args().dry_run))
