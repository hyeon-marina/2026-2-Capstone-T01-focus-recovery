#!/usr/bin/env python3
"""Download ONLY existing Qwen specifications at operator-reviewed immutable revisions.
Creates a new directory; never replaces/deletes existing models. No inference or training.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--embedding-revision', required=True)
p.add_argument('--context-revision', required=True)
p.add_argument('--output', required=True, type=Path)
a = p.parse_args()
if not all(re.fullmatch('[a-f0-9]{40}', r) for r in (a.embedding_revision,a.context_revision)):
    p.error('Reviewed Hugging Face commit SHAs required; branch/tag/main is not immutable')
if a.output.exists():
    p.error('New output directory required; never overwrite existing model data')
from huggingface_hub import snapshot_download

a.output.mkdir(parents=True, mode=0o700)
manifest = {'kind':'existing-model-specification', 'models':[]}
for repo, revision, folder in [('Qwen/Qwen3-Embedding-0.6B',a.embedding_revision,'qwen3-embedding'),('Qwen/Qwen3-4B',a.context_revision,'qwen3-4b')]:
    target = a.output / folder
    snapshot_download(repo_id=repo,revision=revision,local_dir=target,
                      allow_patterns=['*.json','*.safetensors','*.txt','*.model','1_Pooling/*'])
    files = []
    for f in sorted(target.rglob('*')):
        if f.is_file() and '.cache' not in f.parts:
            h = hashlib.sha256()
            with f.open('rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
            files.append({'path':str(f.relative_to(target)),'bytes':f.stat().st_size,'sha256':h.hexdigest()})
    if not (target/'config.json').is_file() or not list(target.glob('*.safetensors')):
        raise SystemExit('Incomplete weights; preserve directory and inspect download failure')
    manifest['models'].append({'repository':repo,'revision':revision,'directory':folder,'files':files})
(a.output/'model-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Prepared original models; run strict offline smoke before deployment')
