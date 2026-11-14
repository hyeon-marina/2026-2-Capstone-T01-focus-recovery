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
import uuid
import ssl
import urllib.request
import local
import dataset as ds


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--automated-test-only',action='store_true',required=True)
    p.add_argument('--verify-v4-upgrade',action='store_true',help='A starts from exact official v4 policy and automated consent, then upgrades without replacing owner/credential')
    p.add_argument('--public-articles',action='store_true',help='Exercise actual public blogs and article layouts, including Naver mainFrame')
    p.add_argument('--localized-public-docs',action='store_true',help='Exercise all nine official GitHub Pages locales, including the C Korean redirect regression')
    p.add_argument('--test-subnet-prefix',help='Optional dedicated test IPv4 /24 prefix, e.g. 10.253.240; preserves existing networks')
    p.add_argument('--tls-port-base', type=int, default=19543, help='First of three consecutive local test HTTPS ports')
    p.add_argument('--output',type=Path,required=True);p.add_argument('--chrome',required=True)
    a=p.parse_args();os.umask(0o077);root=a.output.resolve();root.mkdir(parents=True,mode=0o700,exist_ok=False)
    if a.public_articles and a.localized_public_docs:p.error('Choose one public-site scenario')
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
            if a.test_subnet_prefix:
                import ipaddress
                network=ipaddress.ip_network(a.test_subnet_prefix+'.0/24',strict=True)
                cli(d,'init','--slot',slot,'--db-port',str(33231+i),'--tls-port',str(a.tls_port_base+i))
                project=json.loads((d/'config.json').read_text())['project']
                subnet=list(network.subnets(new_prefix=28))[i]
                command(['docker','network','create','--subnet',str(subnet),'--label','com.docker.compose.project='+project,'--label','com.docker.compose.network=default',project+'_default'])
            if a.verify_v4_upgrade and slot=='A':
                old=subprocess.run(['git','show','1bfe57f6bdd74348166022da4b22c63d585bf95c:docs/data-collection/TEAM_POLICY.json'],cwd=local.ROOT,check=True,capture_output=True).stdout
                assert ds.digest(old)==local.V4_TEAM_POLICY_SHA256
                oldfile=root/'official-v4.json';local.private(oldfile,old.decode())
                cli(d,'setup','--slot',slot,'--db-port',str(33231+i),'--tls-port',str(a.tls_port_base+i),'--policy',oldfile,'--policy-sha256',ds.digest(old))
                credential_before=(d/'participant.json').read_bytes()
                before=json.loads(credential_before);config=json.loads((d/'config.json').read_text())
                oldpolicy=json.loads(old)
                req=urllib.request.Request('https://localhost:'+str(config['tlsPort'])+'/api/consent',method='POST',data=ds.encoded(dict(requestId=str(uuid.uuid4()),policyId=oldpolicy['policyId'],policyVersion='4',accepted=True)),headers={'Authorization':'Bearer '+before['credential'],'Content-Type':'application/json'})
                with urllib.request.urlopen(req,context=ssl.create_default_context(cafile=str(d/'tls/localhost.pem'))) as response:
                    assert response.status==200
                assert ds.request('https://localhost:'+str(config['tlsPort']),d/'participant.json','/api/consent',d/'tls/localhost.pem')['consentValid']
            cli(d,'setup','--slot',slot,'--db-port',str(33231+i),'--tls-port',str(a.tls_port_base+i))
            if a.verify_v4_upgrade and slot=='A':assert (d/'participant.json').read_bytes()==credential_before
            assert ds.digest((d/'site-policy.json').read_bytes())==expected
            local.private(d/'AUTOMATED_TEST_ONLY','NO_HUMAN_PARTICIPANT_CONSENT')
            config=json.loads((d/'config.json').read_text());server='https://localhost:'+str(config['tlsPort'])
            credential=d/'participant.json';ca=d/'tls/localhost.pem'
            state=ds.request(server,credential,'/api/collection/local-status',ca)
            assert 'INSTITUTION_BLOCKED' not in state['blockers'] and state['blockers']==['CONSENT_REQUIRED']
            assert state['planRevision']==1 and not state['ready']
            env=os.environ.copy();env.update(FOCUS105_LOCAL_DIRECTORY=str(d),FOCUS105_AUTOMATED_EXTERNAL='1',FOCUS_TEST_TLS_PORT=str(a.tls_port_base+i),CHROMIUM_PATH=a.chrome)
            if a.localized_public_docs:env['FOCUS119_LOCALIZED_DOCS']='1'
            if a.public_articles:env['FOCUS121_PUBLIC_ARTICLES']='1'
            with (d/'external-chrome.log').open('ab') as log:
                subprocess.run(['node','scripts/local-https-browser-test.mjs'],cwd=local.ROOT/'fe',env=env,stdout=log,stderr=log,check=True,timeout=360)
            state=ds.request(server,credential,'/api/collection/local-status',ca);assert state['ready'] and not state['blockers']
            chrome=json.loads((d/'https-chrome-summary.json').read_text());assert len(chrome['observedPages'])==10
            bundle=d/'AUTOMATED-EXTERNAL-TEST.tar.age'
            base=[sys.executable,local.ROOT/'tools/individual-local/dataset.py']
            command([*base,'export','--server',server,'--ca-file',ca,'--credential-file',credential,'--recipient',recipient,'--output',bundle])
            command([*base,'verify',bundle,'--identity',key,'--sha256',ds.digest(bundle.read_bytes())])
            manifest,files,_=ds.load_bundle(bundle,key)
            assert set(v['domain'] for v in files['visits'])==({'docs.github.com'} if a.localized_public_docs else {'docs.python.org','blog.python.org','news.ycombinator.com','books.toscrape.com','search.naver.com'})
            assert len(files['visits'])==10 and all(v['activeDurationMs']>=5000 for v in files['visits'])
            assert sum(v['tabSwitchCount'] for v in files['visits'])>=1
            assert all('?' not in v['normalizedUrl'] and '__focus_page__' in v['normalizedUrl'] for v in files['visits'])
            assert all(not v['content'].startswith('METADATA_ONLY:') and not v['title'].startswith('Topic:') and len(v['content'])<=5000 for v in files['visits'])
            assert [ds.digest(v['title'].encode()) for v in sorted(files['visits'],key=lambda v:v['sequence'])]==[p['titleSha256'] for p in chrome['observedPages']]
            if a.localized_public_docs:
                assert chrome['scenario']=='LOCALIZED_PUBLIC_DOCS'
                assert [p['locale'] for p in chrome['observedPages']]==['en','ko','es','ja','pt','zh','ru','fr','de','ko']
                assert all(not v['isSearchResultPage'] and v['searchQuery'] is None for v in files['visits'])
            elif a.public_articles:
                assert chrome['scenario']=='PUBLIC_ARTICLES' and len(chrome['observedPages'])==10
                assert all(not v['isSearchResultPage'] and v['searchQuery'] is None for v in files['visits'])
            else:assert any(v['isSearchResultPage'] and v['searchQuery']=='Python venv documentation' for v in files['visits'])
            private=d/'privacy.json'
            command([*base,'privacy','--server',server,'--ca-file',ca,'--credential-file',credential,'--output',private])
            privacy.append(ds.read_privacy(private,ds.digest(private.read_bytes())));bundles.append(bundle)
            rows.append(dict(slot=slot,policyDigest=expected,assignments=54 if slot=='A' else 53,chrome=chrome,exportVerified=True,storedVisits=len(files['visits']),tabSwitches=sum(v['tabSwitchCount'] for v in files['visits']),contentCodePoints=[len(v['content']) for v in sorted(files['visits'],key=lambda v:v['sequence'])],titleHashesMatchBrowser=True,searchQueryVerified='NOT_APPLICABLE' if a.localized_public_docs or a.public_articles else True,v4UpgradeVerified=a.verify_v4_upgrade and slot=='A'))
            print('PASS AUTOMATED EXTERNAL '+slot,flush=True)
            cli(d,'stop')
        hashes=[ds.digest(b.read_bytes()) for b in bundles]
        merged=ds.merge(bundles,privacy,root/'TEST-ONLY-registry.sqlite',root/'AUTOMATED-TEST-merged.age',key,recipient,bundle_hashes=hashes)
        assert merged['rawCompleted']==3 and merged['validVisits']==30 and merged['status']=='PARTIAL'
        duplicate=ds.merge(bundles,privacy,root/'TEST-ONLY-registry.sqlite',root/'AUTOMATED-TEST-duplicate.age',key,recipient,bundle_hashes=hashes)
        assert duplicate['duplicateImports']==3
        review=root/'AUTOMATED-TEST-review.age'
        training=ds.training_review(root/'AUTOMATED-TEST-merged.age',ds.digest((root/'AUTOMATED-TEST-merged.age').read_bytes()),privacy,review,key,recipient)
        assert (training['sessions'],training['visits'],training['windows'])==(3,30,24)
        assert ds.verify_artifact(review,key)[1]['result']=='PASS'
        report=dict(result='PASS',kind='AUTOMATED_EXTERNAL_SITE_TECHNICAL_E2E_NOT_HUMAN_CONSENT',actualParticipantConsents=0,actualHumanResearchSessions=0,source='Actual public Naver/Tistory/Blogger/WordPress/legacy essays and technical articles; no mocking' if a.public_articles else 'Real public GitHub Pages documentation in nine official locales; no mocking' if a.localized_public_docs else 'Real public Python Docs, Python Blog, Hacker News, Books to Scrape, Naver Search HTTPS; no mocking',trainingReview=training,sources=rows,rawCompleted=3,validVisits=30,merge='PARTIAL',duplicateImports=3,osTrustInstallation='NOT_TESTED_CERTIFICATE_SPKI_PIN_ONLY')
        (root/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('PASS: real public-site automated technical path; human consent/actuals=0',flush=True)
    finally:
        for d in directories:
            if (d/'config.json').exists():cli(d,'stop')


if __name__=='__main__':main()
