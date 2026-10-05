#!/usr/bin/env python3
"""Builds the knowledge Agent Max uses to answer questions about Pholama.
Model lists come straight from models.json, so they cannot go out of date. Run this after editing models.json or the facts below:
    python3 tools/build_max_knowledge.py
It writes functions/agentMaxKnowledge.json (bundled into the cloud function)."""
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(root, 'models.json')))
L = d['capLabels']; T = d['tiers']
caps = lambda m: ', '.join(L.get(c, c) for c in m.get('caps', []))
pc = '\n'.join(f"- {m['name']} {m['sizeGB']}GB download, {m['minRamGB']}GB RAM: {caps(m)}" for m in d['local'])

topics = [
 {"id": "overview", "keys": "what is pholama overview about free private how it works start", "text":
  "Pholama is a chat app that runs AI models on YOUR OWN PC, so chats stay private and are free. "
  "You need a free account to chat (just a name and a password, no email). "
  "PHONE SUPPORT HAS ENDED: models are no longer installed on phones or in the browser. There are three ways to chat: (1) the Pholama PC app, which runs models on your computer with tools, web search and Roblox Studio, (2) a phone or other device that opens your PC app over your network (the PC does the work), and (3) Agent Max, the cloud assistant that needs no download and works in any browser. "
  "To run models, get the PC app, open Models, download one, close the box and type."},
 {"id": "account", "keys": "account sign log in login signup password name email forgot reset stay logged memory", "text":
  "ACCOUNTS: You must have an account to send messages or to download anything. Tap Account, choose Create account, and pick a name and a password (8+ characters). There is NO email. "
  "You stay logged in on that device and return straight into the app. Because there is no email, a forgotten password CANNOT be reset, so choose one you will remember. "
  "Names are unique: if yours is taken you will be told. Wrong name or password shows 'Wrong name or password'. "
  "MEMORY is optional and OFF until you turn it on in Account. When on, saying 'remember that I like short answers' saves it, and Pholama uses it in later chats. You can see or delete every memory in Account, or wipe all of them. Memory works with PC models."},
 {"id": "download", "keys": "download install resume stop pause delete storage wifi error retry progress loading animation llama", "text":
  "DOWNLOADS (PC app only): open Models, then Download next to a model. You must be logged in. A llama logo fills up as it downloads. "
  "You can Stop at any time. Resume continues from where it stopped, even after closing the app or restarting the PC. Files already downloaded are kept. Delete frees the space. "
  "If a download errors, tap Retry or Resume and check your internet and free disk space. After downloading, models work offline. The website does not download models."},
 {"id": "pc", "keys": "pc computer host node start.bat ollama llama.cpp install wifi windows mac linux localhost 11435 api", "text":
  "PC HOST: gives more power plus tools and web search. You do NOT need to install Node.js: the one-line installer brings its own private copy (about 30 MB, one time, nothing is installed on the PC). Run the installer from the Pholama page or README, or unzip and double-click start.bat (Windows) / run ./start.sh (Mac/Linux), then open http://localhost:11435, tap Models > On this PC > Install (downloads llama.cpp, with CUDA on NVIDIA GPUs), then Download a model that fits your RAM. "
  "RECOMMENDED TOOL MODEL: Qwen2.5 1.5B Instruct (about 1 GB, needs 3 GB RAM). It is the smallest model that runs tools well (calculator, time, web search, reading pages) and it leaves plain questions alone. Download it with: pholama pull qwen2.5-1.5b. "
  "KEEPING THE PC SMOOTH: Pholama watches your PC while a local AI is running. If the PC really starts to lag (memory almost full, or the PC freezing up). A busy CPU alone never stops it, because a model that is writing a reply is meant to use the CPU it stops ALL local AIs and tells you why. Only local AIs are stopped: Agent Max in the cloud and the website are not touched. Short spikes while a model is loading are ignored. When you close Pholama (pholama stop, closing the window, or Ctrl+C) every local AI is stopped and turned off too, and a leftover one from a crash is cleaned up on the next start. REMOVING PHOLAMA: run pholama remove-all. It lists everything it will delete (app, models, private Node.js, llama.cpp, the command and the icons), and only deletes after you type the word remove. pholama remove-all --dry-run only lists. To remove just one model use pholama rm <model>. "
  "If you already use Ollama, leave it running and its models appear in the picker. To use the PC from your phone over WiFi start with HOST=0.0.0.0 and open http://<your-PC-IP>:11435 on the phone (only on a network you trust: the PC host itself has no login). "
  "PC models:\n" + pc},
 {"id": "tools", "keys": "tools search web calculator clock mcp credits thinking switches icons log live tokens", "text":
  "TOOLS (PC app only; the website is plain chat with Agent Max): web search (20 credits), read a web page (10), calculator and clock (1 each), MCP tool call (15), Thinking (25, charged only when the model really thinks). There are 1000 credits per day on the PC, resetting at local midnight. At 0, tools switch off and the model answers alone. Plain local chat is always free. "
  "Next to the message box there are icon buttons for Search, Tools, MCP and Thinking. An icon only appears if the selected model can really do it; tap to turn it off or on and Pholama remembers. Each reply shows a token line like '42 in, 17 out, 59 tokens'; a leading ~ means it is an estimate. "
  "The PC host also shows a live log of each step the AI takes."},
 {"id": "controls", "keys": "stop button new session clear chat effort think normal long max send controls", "text":
  "CHAT CONTROLS: the round button sends your message and turns into a STOP square while a reply is running. Pressing Stop ends it and keeps what was already written. The + button starts a NEW SESSION: it stops any running reply and clears the chat (models and settings stay). "
  "THINK EFFORT (Normal, Long, Max) sits next to the message box. On your own models it is always free: Long and Max just ask the model to take more care and allow a longer answer. On Agent Max it changes how long and careful the answer is."},
 {"id": "agent-max", "keys": "agent max cloud limit daily monthly restock quota free no download integration credits", "text":
  "AGENT MAX is Pholama's cloud assistant: nothing to download, works in any browser, needs a free account. On the website it can use tools (calculator, clock) and knows how Pholama works. In the PC app's Studio it can create and edit files, because the PC does the file work while Max thinks. "
  "MAX BRAIN: in the PC app, Settings > Usage lets you choose what powers Max: 'Max (official, cloud)' is the smartest and uses your daily and monthly messages; or pick one of your own local AIs, which is free and unlimited but only as smart as that model. "
  "LIMITS: 10 messages per day and 30 per month per account. Each message counts as 1 (Normal, Long and Max effort all count the same). Your 10 daily messages come back every day at midnight UTC until you reach 30 in the month. After 30, Agent Max waits for the next month to restock. Any time you are out, local models stay free and unlimited. If Agent Max fails to answer you are not charged. "
  "LOCAL AI RULE: once you install a local AI that can run tools (any PC model tagged tools, such as Qwen2.5 1.5B), your daily Agent Max allowance drops to 1 message a day (shown as used/1), because the local AI is free and unlimited. If you remove it, or have none, the daily allowance goes back to 10 (used/10). The monthly limit stays 30. "
  "Agent Max cannot browse the web and cannot see your files."},
 {"id": "problems", "keys": "problem error not working fix help slow crash blank stuck phone ended", "text":
  "COMMON PROBLEMS: Download stops or errors: tap Retry or Resume and free some disk space. Too slow: pick a smaller model. Models no longer run on phones: use Agent Max, or open your PC app from the phone. "
  "Nothing happens when you send: you may be logged out, so tap Account. 'Pick a model first': open Models in the PC app and download one, or choose Agent Max. Agent Max says you used your allowance: wait for the daily or monthly restock, or use a local model."},
]
REMOTE = {'pc'}   # only the long model lists; everything else is bundled so Max still answers if the site file is unreachable
core = []
for t in topics:
    if t['id'] in REMOTE:
        head = t['text'].split('\n')[0]
        # keep whole sentences only (never cut mid-sentence), up to ~600 characters
        parts, short = head.split('. '), ''
        for sent in parts:
            cand = (short + ('. ' if short else '') + sent).strip()
            if len(cand) > 600 and short: break
            short = cand
        import re
        short = re.sub(r'\s*(PC models|Models):\.?$', '', short.strip()).strip()   # drop the dangling list label
        if not short.endswith('.'): short += '.'
        core.append({**t, 'text': short + ' (The full model list could not be loaded right now; the Models button in the app shows every model and what fits your device.)', 'remote': True})
    else: core.append(t)
json.dump({'topics': topics}, open(os.path.join(root, 'web', 'max-knowledge.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
out = {"topics": core}
os.makedirs(os.path.join(root, 'functions'), exist_ok=True)
json.dump(out, open(os.path.join(root, 'functions', 'agentMaxKnowledge.json'), 'w'), indent=1, ensure_ascii=False)
print('topics:', len(topics), '| bytes:', len(json.dumps(out)), '| PC:', len(d['local']))
