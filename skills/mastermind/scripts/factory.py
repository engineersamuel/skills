#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6"]
# ///
"""Factory state for one mastermind task: .trellage/factory/<id>/factory.yaml.

Commands:
  init ID PROMPT            create the factory file
  get ID [KEY]              print the file, or one dotted key, as JSON
  set ID KEY JSON           set one dotted key (only mastermind writes)
  append ID KEY JSON        append to a list at a dotted key
  ask ID QID TEXT OPT...    add a question for the human (OPT is name=description)
  wait-answer ID QID [SEC]  block until the human answers QID; print the answer
  serve ID                  answer page; run as: portless factory-ID --tailscale uv run factory.py serve ID
  jev-choice STATE INSTR OPT...   Jev choice; OPT is name=description
  jev-noul STATE INSTR...         Jev yes/no probability, one per INSTR
"""

import html
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import yaml

STAGES = [
    "intake",
    "clarify",
    "research",
    "decide",
    "implement",
    "optimize",
    "review",
    "verify",
    "report",
]
JEV_URL = "https://api.typesafe.ai/v1/systemone"


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def path(fid):
    return (
        Path(os.environ.get("FACTORY_ROOT", ".trellage/factory")) / fid / "factory.yaml"
    )


def load(fid):
    return yaml.safe_load(path(fid).read_text())


def save(fid, data):
    p = path(fid)
    tmp = p.with_suffix(".tmp")
    data["updatedAt"] = now()
    tmp.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def walk(data, key, create=False):
    parts = key.split(".")
    for k in parts[:-1]:
        if create and k not in data:
            data[k] = {}
        data = data[k]
    return data, parts[-1]


def options(args):
    return dict(a.split("=", 1) for a in args)


def init(fid, prompt):
    p = path(fid)
    if p.exists():
        sys.exit(f"exists: {p}")
    p.parent.mkdir(parents=True, exist_ok=True)
    save(
        fid,
        {
            "schemaVersion": 1,
            "id": fid,
            "prompt": prompt,
            "status": "running",  # running | needs-human | done | blocked
            "stage": "intake",
            "codeChanged": None,
            "snapshot": None,
            "decisions": [],
            "questions": {},
            "open": [],
            "agents": [],
            "evidence": [],
            "next": "intake",
            "createdAt": now(),
        },
    )
    print(p)


def jev(state, questions):
    env = Path.home() / ".config/trellage/.env.local"
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("TYPESAFE_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("'\"")
    if not key:
        sys.exit("TYPESAFE_API_KEY not set")
    body = json.dumps(
        {"model": "jev-latest", "state": state, "questions": questions}
    ).encode()
    req = urllib.request.Request(
        JEV_URL,
        body,
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["answers"]


PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Factory {id}</title><style>
:root{{--bg:#fff;--fg:#111;--mut:#666;--line:#ddd;--acc:#2456d6}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111;--fg:#eee;--mut:#999;--line:#333;--acc:#7aa2ff}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui;margin:0 auto;max-width:760px;padding:16px}}
.mut{{color:var(--mut)}} section{{border-top:1px solid var(--line);padding:12px 0}}
button{{display:block;width:100%;text-align:left;margin:6px 0;padding:10px;border:1px solid var(--line);border-radius:8px;background:none;color:var(--fg);font:inherit;cursor:pointer}}
button:hover{{border-color:var(--acc)}} b.ans{{color:var(--acc)}}</style></head><body>
<h1>{id}</h1><p class="mut">stage <b>{stage}</b> · status <b>{status}</b> · next: {next}</p><p>{prompt}</p>{questions}
<section><h3>Open items</h3><ul>{open}</ul></section></body></html>"""


def render(fid):
    d = load(fid)
    qs = []
    for qid, q in d.get("questions", {}).items():
        if q.get("answer") is not None:
            qs.append(
                f"<section><p>{html.escape(q['text'])}</p><b class=ans>{html.escape(str(q['answer']))}</b></section>"
            )
            continue
        btns = "".join(
            f'<form method=post><input type=hidden name=qid value="{html.escape(qid)}"><input type=hidden name=answer value="{html.escape(k)}">'
            f"<button><b>{html.escape(k)}</b> — {html.escape(v)}</button></form>"
            for k, v in q["options"].items()
        )
        qs.append(f"<section><h3>{html.escape(q['text'])}</h3>{btns}</section>")
    return PAGE.format(
        id=html.escape(fid),
        stage=html.escape(str(d["stage"])),
        status=html.escape(str(d["status"])),
        next=html.escape(str(d.get("next"))),
        prompt=html.escape(d["prompt"]),
        questions="".join(qs),
        open="".join(f"<li>{html.escape(str(o))}</li>" for o in d.get("open", [])),
    ).encode()


def serve(fid):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(render(fid))

        def do_POST(self):
            form = parse_qs(
                self.rfile.read(int(self.headers["Content-Length"])).decode()
            )
            qid, answer = form["qid"][0], form["answer"][0]
            d = load(fid)
            q = d["questions"].get(qid)
            if q and q.get("answer") is None and answer in q["options"]:
                q["answer"], q["answeredAt"] = answer, now()
                save(fid, d)
            self.send_response(303)
            self.send_header("Location", "/")
            self.end_headers()

    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "4555"))), H).serve_forever()


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd, args = argv[1], argv[2:]
    if cmd == "init":
        init(args[0], args[1])
    elif cmd == "get":
        d = load(args[0])
        if len(args) > 1:
            parent, k = walk(d, args[1])
            d = parent[k]
        print(json.dumps(d, indent=2, default=str))
    elif cmd in ("set", "append"):
        d = load(args[0])
        parent, k = walk(d, args[1], create=True)
        value = json.loads(args[2])
        if args[1] == "stage" and value not in STAGES:
            sys.exit(f"unknown stage: {value}")
        if cmd == "set":
            parent[k] = value
        else:
            parent.setdefault(k, []).append(value)
        save(args[0], d)
    elif cmd == "ask":
        d = load(args[0])
        d["questions"][args[1]] = {
            "text": args[2],
            "options": options(args[3:]),
            "answer": None,
            "askedAt": now(),
        }
        d["status"] = "needs-human"
        save(args[0], d)
    elif cmd == "wait-answer":
        deadline = time.time() + int(args[2]) if len(args) > 2 else None
        while deadline is None or time.time() < deadline:
            d = load(args[0])
            answer = d["questions"][args[1]].get("answer")
            if answer is not None:
                if all(q.get("answer") is not None for q in d["questions"].values()):
                    d["status"] = "running"
                    save(args[0], d)
                print(answer)
                return
            time.sleep(2)
        sys.exit("timeout")
    elif cmd == "serve":
        serve(args[0])
    elif cmd == "jev-choice":
        a = jev(
            args[0],
            {
                "q": {
                    "type": "choice",
                    "instructions": args[1],
                    "criteria": options(args[2:]),
                }
            },
        )
        print(json.dumps(a["q"]))
    elif cmd == "jev-noul":
        a = jev(
            args[0],
            {
                f"q{i}": {"type": "noul", "instructions": t}
                for i, t in enumerate(args[1:])
            },
        )
        print(json.dumps({t: a[f"q{i}"]["noul"] for i, t in enumerate(args[1:])}))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
