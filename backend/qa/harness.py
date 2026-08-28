"""Adversarial QA harness for the AI assistant.

Logs in as real seeded accounts and drives POST /ai/ask exactly as the Angular
client does, including the client-supplied `history` array so multi-turn
context is exercised for real rather than simulated.

Usage:  python qa/harness.py <round_file.json>
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:5000/api/v1"
PASSWORD = "Demo-EMS-2026"
_token_cache: dict[str, str] = {}


class LoginFailed(RuntimeError):
    pass


def _post(path: str, payload: dict, token: str | None = None) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return {"_http_error": exc.code, "_body": exc.read().decode()[:400]}


def login(email: str) -> str | None:
    """None means guest (signed-out) - a real, supported caller for this endpoint."""
    if email in (None, "", "guest"):
        return None
    if email in _token_cache:
        return _token_cache[email]
    out = _post("/auth/login", {"email": email, "password": PASSWORD})
    token = out.get("accessToken") or out.get("access_token")
    if not token:
        # Recorded and skipped rather than fatal: one unusable account (a self-registered
        # external user is not on the shared demo password) must not discard the whole round.
        raise LoginFailed(f"login failed for {email}: {str(out)[:200]}")
    _token_cache[email] = token
    return token


def ask(question: str, token: str | None, history: list[dict]) -> dict:
    started = time.perf_counter()
    out = _post("/ai/ask", {"question": question, "history": history}, token)
    out["_ms"] = round((time.perf_counter() - started) * 1000)
    return out


def run(tests: list[dict], out_path: str | None = None) -> list[dict]:
    """A test may carry `turns` (multi-turn) or a single `q`.

    Conversation history accumulates across turns within one test only, which is
    what the real client does - each new conversation starts empty.
    """
    results = []
    for index, test in enumerate(tests):
        # Gemini free tier is 15 req/min per key and one question costs ~3 calls. Without this
        # pause a 429 lands on the GENERATION call and the recorded "answer" is the fallback
        # string - a fake failure that would pollute the results far worse than a slow run.
        if index:
            time.sleep(6)
        try:
            token = login(test.get("as"))
        except LoginFailed as exc:
            print(f"\n--- {test['id']} SKIPPED: {exc}")
            continue
        history: list[dict] = []
        turns = test.get("turns") or [test["q"]]
        exchanges = []
        for turn in turns:
            out = ask(turn, token, history)
            answer = out.get("answer", f"<ERROR {out.get('_http_error')}: {out.get('_body','')}>")
            exchanges.append({
                "q": turn,
                "answer": answer,
                "sources": [s.get("eventTitle") for s in out.get("sources") or []],
                "clubs": [c.get("clubName") for c in out.get("clubs") or []],
                "navigation": [n.get("label") for n in out.get("navigation") or []],
                "ms": out["_ms"],
            })
            history.append({"question": turn, "answer": answer})
        results.append({
            "id": test["id"], "as": test.get("as") or "guest",
            "intent": test.get("intent", ""), "expect": test.get("expect", ""),
            "exchanges": exchanges,
        })
        last = exchanges[-1]
        print(f"\n--- {test['id']} [{test.get('as') or 'guest'}] ---")
        for ex in exchanges:
            print(f"  Q: {ex['q']}")
            print(f"  A: {ex['answer']}")
            card = []
            if ex["sources"]: card.append(f"eventCards={ex['sources']}")
            if ex["clubs"]: card.append(f"clubCards={ex['clubs']}")
            if ex["navigation"]: card.append(f"nav={ex['navigation']}")
            if card: print(f"  [{'; '.join(card)}]")
            print(f"  ({ex['ms']}ms)")
        print(f"  EXPECT: {test.get('expect','')}")
        # Written after every test, not just at the end: a run that is cut short (tool timeout,
        # quota stall) still leaves every completed result on disk instead of discarding the round.
        if out_path:
            with open(out_path, "w") as fh:
                json.dump(results, fh, indent=2)
    return results


if __name__ == "__main__":
    path = sys.argv[1]
    with open(path) as fh:
        tests = json.load(fh)
    out_path = path.replace(".json", "-results.json")
    run(tests, out_path)
    print(f"\nWrote {out_path}")
