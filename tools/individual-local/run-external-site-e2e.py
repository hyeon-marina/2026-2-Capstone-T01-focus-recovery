#!/usr/bin/env python3
"""Opt-in automated technical E2E on real public pages, never human A/B/C consent or research actuals.
Uses NEW isolated local DBs/profiles and unmodified repository policy. Private test artifacts must not
be merged into the team's actual 160-session dataset. No network mocking or access-control bypass.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import local
import dataset as ds


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--automated-test-only',action='store_true',required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--chrome',required=True)
    a=p.parse_args();os.umask(0o077);root=a.output.resolve();root.mkdir(parents=True,mode=0o700,exist_ok=False)
    policy=local.ROOT/'docs/data-collection/TEAM_POLICY.json';expected=policy.with_suffix('.sha256').read_text().split()[0]
    key=root/'TEST-ONLY.agekey';subprocess.run(['age-keygen','-o',str(key)],check=True,capture_output=True)
    recipient=subprocess.run(['age-keygen','-y',str(key)],check=True,text=True,capture_output=True).stdout.strip()
    directories=[];bundles=[];privacy=[];rows=[]
    def command(args):
        with (root/'commands.log').open('ab') as log:
            subprocess.run([str(x) for x in args],cwd=local.ROOT,check=True,stdout=log,stderr=log)
    def cli(d,*args):command([sys.executable,local.ROOT/'tools/individual-local/local.py','--directory',d,*args])
    try:
        for i,slot in enumerate('ABC'):
            d=root/slot;directories.append(d)
            cli(d,'setup','--slot',slot,'--db-port',str(33231+i),'--tls-port',str(19543+i))
            assert ds.digest((d/'site-policy.json').read_bytes())==expected
            local.private(d/'AUTOMATED_TEST_ONLY','NO_HUMAN_PARTICIPANT_CONSENT')
            config=json.loads((d/'config.json').read_text());server='https://localhost:'+str(config['tlsPort'])
            credential=d/'participant.json';ca=d/'tls/localhost.pem'
            state=ds.request(server,credential,'/api/collection/local-status',ca)
            assert 'INSTITUTION_BLOCKED' not in state['blockers'] and state['blockers']==['CONSENT_REQUIRED']
            assert state['planRevision']==1 and not state['ready']
            env=os.environ.copy();env.update(FOCUS105_LOCAL_DIRECTORY=str(d),FOCUS105_AUTOMATED_EXTERNAL='1',CHROMIUM_PATH=a.chrome)
            with (d/'external-chrome.log').open('ab') as log:
                subprocess.run(['node','scripts/local-https-browser-test.mjs'],cwd=local.ROOT/'fe',env=env,stdout=log,stderr=log,check=True,timeout=360)
            state=ds.request(server,credential,'/api/collection/local-status',ca);assert state['ready'] and not state['blockers']
            chrome=json.loads((d/'https-chrome-summary.json').read_text());assert len(chrome['observedPages'])==10
            bundle=d/'AUTOMATED-EXTERNAL-TEST.tar.age'
            base=[sys.executable,local.ROOT/'tools/individual-local/dataset.py']
            command([*base,'export','--server',server,'--ca-file',ca,'--credential-file',credential,'--recipient',recipient,'--output',bundle])
            command([*base,'verify',bundle,'--identity',key,'--sha256',ds.digest(bundle.read_bytes())])
            manifest,files,_=ds.load_bundle(bundle,key)
            assert set(v['domain'] for v in files['visits'])=={'docs.python.org','blog.python.org','news.ycombinator.com','books.toscrape.com'}
            assert len(files['visits'])==10 and all(v['activeDurationMs']>=5000 for v in files['visits'])
            assert sum(v['tabSwitchCount'] for v in files['visits'])>=1
            assert all('?' not in v['normalizedUrl'] and '__focus_page__' in v['normalizedUrl'] for v in files['visits'])
            assert all(v['content'].startswith('METADATA_ONLY:') and v['title'].startswith('Topic:') for v in files['visits'])
            private=d/'privacy.json'
            command([*base,'privacy','--server',server,'--ca-file',ca,'--credential-file',credential,'--output',private])
            privacy.append(ds.read_privacy(private,ds.digest(private.read_bytes())));bundles.append(bundle)
            rows.append(dict(slot=slot,policyDigest=expected,assignments=54 if slot=='A' else 53,chrome=chrome,exportVerified=True,storedVisits=len(files['visits']),tabSwitches=sum(v['tabSwitchCount'] for v in files['visits'])))
            print('PASS AUTOMATED EXTERNAL '+slot,flush=True)
            cli(d,'stop')
        hashes=[ds.digest(b.read_bytes()) for b in bundles]
        merged=ds.merge(bundles,privacy,root/'TEST-ONLY-registry.sqlite',root/'AUTOMATED-TEST-merged.age',key,recipient,bundle_hashes=hashes)
        assert merged['rawCompleted']==3 and merged['validVisits']==30 and merged['status']=='PARTIAL'
        duplicate=ds.merge(bundles,privacy,root/'TEST-ONLY-registry.sqlite',root/'AUTOMATED-TEST-duplicate.age',key,recipient,bundle_hashes=hashes)
        assert duplicate['duplicateImports']==3
        report=dict(result='PASS',kind='AUTOMATED_EXTERNAL_SITE_TECHNICAL_E2E_NOT_HUMAN_CONSENT',actualParticipantConsents=0,actualHumanResearchSessions=0,source='Real public Python Docs, Python Blog, Hacker News, Books to Scrape HTTPS; no mocking',sources=rows,rawCompleted=3,validVisits=30,merge='PARTIAL',duplicateImports=3,osTrustInstallation='NOT_TESTED_CERTIFICATE_SPKI_PIN_ONLY')
        (root/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('PASS: real public-site automated technical path; human consent/actuals=0',flush=True)
    finally:
        for d in directories:
            if (d/'backend.json').exists():cli(d,'stop')


if __name__=='__main__':main()
