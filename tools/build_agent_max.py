#!/usr/bin/env python3
"""Builds functions/pholamaCloud.ts (the Agent Max backend) = template + site knowledge. Run after build_max_knowledge.py."""
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
k = json.load(open(os.path.join(root, 'functions', 'agentMaxKnowledge.json')))['topics']
t = open(os.path.join(root, 'tools', 'agentMax.template.ts')).read()
assert t.count('/*KNOWLEDGE*/[]') == 1
open(os.path.join(root, 'functions', 'pholamaCloud.ts'), 'w').write(t.replace('/*KNOWLEDGE*/[]', json.dumps(k, ensure_ascii=False, separators=(',', ':'))))
print('built functions/pholamaCloud.ts with', len(k), 'topics')
