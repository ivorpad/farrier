#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]

if len(args) < 2 or args[0] != "add":
    print("fake skills fixture only supports: add <source> -s <skills...> -a <agents...> -y", file=sys.stderr)
    sys.exit(2)

source = args[1]
skills_start = args.index("-s") + 1 if "-s" in args else 0
agents_start = args.index("-a") + 1 if "-a" in args else 0

if skills_start == 0 or agents_start == 0 or agents_start <= skills_start:
    print("fake skills fixture received malformed arguments", file=sys.stderr)
    sys.exit(2)

skill_ids = args[skills_start:agents_start - 1]
agents = [arg for arg in args[agents_start:] if arg not in ("-y", "-g")]
roots = {"claude-code": ".claude/skills", "codex": ".agents/skills"}

for agent in agents:
    root = roots.get(agent)
    if not root:
        continue
    for skill_id in skill_ids:
        directory = os.path.join(os.getcwd(), root, skill_id)
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "SKILL.md"), "w", encoding="utf8") as handle:
            handle.write(f"---\nname: {skill_id}\ndescription: Test fixture installed from {source}.\n---\n")

lock_path = os.path.join(os.getcwd(), "skills-lock.json")
try:
    with open(lock_path, encoding="utf8") as handle:
        lock = json.load(handle)
except (OSError, json.JSONDecodeError):
    lock = {"skills": {}}

for skill_id in skill_ids:
    lock["skills"][skill_id] = {"source": source}

with open(lock_path, "w", encoding="utf8") as handle:
    handle.write(json.dumps(lock, indent=2) + "\n")
