"""Failed sign-in throttling, kept in Redis so it holds across workers."""

from __future__ import annotations

from fastapi import Request

from callsentry.services.callstate import _redis

# One account can take 5 wrong passwords; one address (an office behind a
# single IP) 20 across all accounts, so a colleague's typos don't lock you out.
MAX_PER_ACCOUNT = 5
MAX_PER_IP = 20
WINDOW_SECONDS = 15 * 60


def client_ip(request: Request) -> str:
    """The caller's address behind Cloudflare and Caddy."""
    for header in ("cf-connecting-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _keys(ip: str, email: str) -> tuple[str, str]:
    return f"login:fail:ip:{ip}", f"login:fail:acct:{email.lower()}"


async def blocked(ip: str, email: str) -> bool:
    try:
        by_ip, by_account = await _redis().mget(*_keys(ip, email))
    except Exception:  # noqa: BLE001 - never lock everyone out if Redis is down
        return False
    return int(by_ip or 0) >= MAX_PER_IP or int(by_account or 0) >= MAX_PER_ACCOUNT


async def record_failure(ip: str, email: str) -> None:
    try:
        pipe = _redis().pipeline()
        for key in _keys(ip, email):
            pipe.incr(key)
            pipe.expire(key, WINDOW_SECONDS)
        await pipe.execute()
    except Exception:  # noqa: BLE001
        return


async def clear(ip: str, email: str) -> None:
    # A successful sign-in clears that account's count, not the address's.
    try:
        await _redis().delete(_keys(ip, email)[1])
    except Exception:  # noqa: BLE001
        return


async def allow(key: str, limit: int, window_seconds: int) -> bool:
    """A fixed-window counter: True while `key` has been hit fewer than `limit` times."""
    try:
        pipe = _redis().pipeline()
        pipe.incr(f"rl:{key}")
        pipe.expire(f"rl:{key}", window_seconds, nx=True)
        count, _ = await pipe.execute()
    except Exception:  # noqa: BLE001 - a Redis outage must not break the caller
        return True
    return int(count) <= limit
