#!/usr/bin/env python3
"""Explicit SYNTHETIC fixture in NEW local MySQL volumes; no real approvals or participant data.
Exercises production offline setup + verified HTTPS API. Chrome is tested separately.
Retains all test files/volumes; never deletes existing data.
"""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
import dataset as ds
import local


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--synthetic-only',action='store_true',required=True)
    a=p.parse_args();os.umask(0o077);root=a.output.resolve();root.mkdir(mode=0o700,parents=True,exist_ok=False)
    template=json.loads((local.ROOT/'docs/data-collection/local-policy.draft.json').read_text())
    now=datetime.now(timezone.utc)
    template.update(status='CONFIRMED',policyId='SYNTHETIC-103',policyVersion='1',buildId='synthetic-103',notBefore=(now-timedelta(minutes=2)).isoformat(),expiresAt=(now+timedelta(hours=2)).isoformat(),sites=[dict(origin='https://example.org',pathPrefix='/public')])
    for key in ['teamDecisionRef','retentionRef','privacyEvidenceRef','startAuthorizationRef','purpose','collectionItems','useScope','retentionPolicy','sensitivePageExclusions','textPrivacyPolicy','changePolicy','collectionScope']:
        template[key]='SYNTHETIC-TEST-ONLY-NOT-ACTUAL-APPROVAL'
    template['institution']=dict(decision='NOT_REQUIRED',evidenceRef='SYNTHETIC-TEST-ONLY')
    plan=template['plan'];plan['revision']=1
    for g in plan['goals']:g.update(description='SYNTHETIC TEST TypeScript transaction research '+g['goalId'],status='CONFIRMED',evidenceRef='SYNTHETIC-TEST-ONLY')
    template['planChecksum']=hashlib.sha256(json.dumps(plan,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    policy=root/'SYNTHETIC-policy.json';local.private(policy,json.dumps(template,ensure_ascii=False,indent=2))
    digest=ds.digest(policy.read_bytes());directories=[];exports=[];privacy=[];owners=[];results=[]
    key=root/'merge.agekey';subprocess.run(['age-keygen','-o',str(key)],check=True,capture_output=True)
    recipient=subprocess.run(['age-keygen','-y',str(key)],check=True,capture_output=True,text=True).stdout.strip()
    def cli(d,*args,ok=True):
        with (root/'commands.log').open('ab') as out:
            r=subprocess.run([sys.executable,str(local.ROOT/'tools/individual-local/local.py'),'--directory',str(d),*args],stdout=out,stderr=out)
        assert (r.returncode==0)==ok, 'CLI result; see protected commands.log'
    def request(d,path,method='GET',body=None,token=None,status=200,build='synthetic-103',idem=None):
        c=json.loads((d/'config.json').read_text());credential=json.loads((d/'participant.json').read_text())['credential'] if token is None else token
        headers={'Authorization':'Bearer '+credential,'Content-Type':'application/json','X-Collection-Build':build}
        if idem:headers['Idempotency-Key']=idem
        req=urllib.request.Request('https://localhost:'+str(c['tlsPort'])+path,data=ds.encoded(body) if body is not None else None,method=method,headers=headers)
        try:
            with urllib.request.urlopen(req,context=ssl.create_default_context(cafile=str(d/'tls/localhost.pem')),timeout=10) as r:code=r.status;raw=r.read()
        except urllib.error.HTTPError as e:code=e.code;raw=e.read()
        assert code in (status if isinstance(status,tuple) else (status,)),(path,code,status,json.loads(raw) if raw else '')
        return json.loads(raw) if raw else None
    try:
        for i,slot in enumerate('ABC'):
            d=root/slot;directories.append(d)
            cli(d,'setup','--slot',slot,'--db-port',str(33231+i),'--tls-port',str(19543+i))
            original=json.loads((d/'participant.json').read_text());owners.append(original['participantId'])
            assert 'LOCAL_POLICY_DRAFT' in request(d,'/api/collection/local-status')['blockers']
            assigned=request(d,'/api/collection/assignments');assert len(assigned)==(54 if slot=='A' else 53)
            cli(d,'setup','--slot',slot);assert json.loads((d/'participant.json').read_text())==original
            if slot=='A':
                ownerKey=(d/'owner.key').read_text();(d/'owner.key').write_text('X'*64)
                cli(d,'setup','--slot',slot,ok=False);(d/'owner.key').write_text(ownerKey)
                cli(d,'setup','--slot',slot);assert json.loads((d/'participant.json').read_text())==original
            cli(d,'setup','--slot',next(x for x in 'ABC' if x!=slot),ok=False)
            cli(d,'setup','--slot',slot,'--rotate-credential')
            assert json.loads((d/'participant.json').read_text())['participantId']==original['participantId']
            request(d,'/api/auth/me',token=original['credential'],status=401)
            cli(d,'setup','--slot',slot,'--policy',str(policy),'--policy-sha256','0'*64,ok=False)
            cli(d,'setup','--slot',slot,'--policy',str(policy),'--policy-sha256',digest)
            pid='PLAN-00'+str(i+1)
            request(d,'/api/collection/assignments/'+pid+'/start','POST',{},status=409,idem=uuid.uuid4().hex)
            request(d,'/api/consent','POST',dict(requestId=str(uuid.uuid4()),policyId='SYNTHETIC-103',policyVersion='1',accepted=True))
            assert request(d,'/api/collection/local-status')['ready']
            raw=(d/'site-policy.json').read_bytes();(d/'site-policy.json').write_bytes(raw+b' ')
            assert not request(d,'/api/collection/local-status')['ready'];(d/'site-policy.json').write_bytes(raw)
            expired=copy.deepcopy(template);expired['expiresAt']=(now-timedelta(seconds=1)).isoformat();(d/'site-policy.json').write_text(json.dumps(expired));assert 'LOCAL_POLICY_EXPIRED' in request(d,'/api/collection/local-status')['blockers'];(d/'site-policy.json').write_bytes(raw)
            request(d,'/api/collection/admin/plan',status=403)
            request(d,'/api/collection/assignments/PLAN-160/start','POST',{},status=404 if slot!='A' else 201,idem=uuid.uuid4().hex) if slot!='A' else None
            request(d,'/api/collection/assignments/'+pid+'/start','POST',{},status=409,build='wrong-build',idem=uuid.uuid4().hex)
            session=request(d,'/api/collection/assignments/'+pid+'/start','POST',{},status=201,idem='synthetic-'+slot)['sessionId']
            first=None
            for n in range(1,11):
                visit=dict(visitId=str(uuid.uuid4()),sequence=n,browserTabKey='synthetic-test',normalizedUrl='https://example.org/public/page-'+str(n),domain='example.org',title='SYNTHETIC TEST',content='Controlled synthetic TypeScript transaction research text, no personal data, generated for API validation only.',searchQuery=None,isSearchResultPage=False,visitedAt=now.isoformat(timespec='milliseconds').replace('+00:00','Z'),activeDurationMs=5000,tabSwitchCount=0,behaviorVersion=0,extractionStatus='SUCCESS')
                if n==1:
                    blocked=copy.deepcopy(visit);blocked['normalizedUrl']='https://example.org/public/login';request(d,'/api/sessions/'+session+'/visits','POST',blocked,status=409)
                    blocked['normalizedUrl']='https://other.example/public';blocked['domain']='other.example';request(d,'/api/sessions/'+session+'/visits','POST',blocked,status=409)
                    first=visit['visitId']
                request(d,'/api/sessions/'+session+'/visits','POST',visit,status=201)
            request(d,'/api/sessions/'+session+'/visits/'+first+'/behavior','PATCH',dict(activeDurationMs=300000,tabSwitchCount=1,behaviorVersion=1))
            request(d,'/api/sessions/'+session+'/end','POST',dict(finalBehaviors=[]))
            attempt=request(d,'/api/collection/progress')['attempts'][0]
            request(d,'/api/collection/attempts/'+attempt['attemptId']+'/delivered','POST',dict(visitCount=10,lastSequence=10),status=204)
            progress=request(d,'/api/collection/progress');assert progress['raw']['completed']==1 and progress['completed']==0
            assert progress['attempts'][0]['analysisState']=='NOT_RUN' and progress['attempts'][0]['rawStatus']=='RAW_COLLECTED'
            # Actual DB metadata proves no hidden operator or duplicate owner was provisioned.
            config=json.loads((d/'config.json').read_text())
            query='SELECT (SELECT COUNT(*) FROM participant),(SELECT COUNT(*) FROM collection_operator),(SELECT COUNT(*) FROM collection_local_owner),(SELECT COUNT(*) FROM flyway_schema_history WHERE success=1);'
            count=local.compose(config,local.env_for(config,d),'exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql-app)"; export MYSQL_PWD; exec mysql -ufocus_collection --batch --skip-column-names focus_collection',input=query,text=True,capture_output=True)
            assert count.stdout.strip().split()==['1','0','1','18']
            snapshot=request(d,'/api/collection/exports','POST',{})
            bundle=d/'SYNTHETIC.tar.age';ds.publish(bundle,ds.age(ds.pack(snapshot,'synthetic-103'),recipient=recipient));exports.append(bundle)
            manifest,_,_=ds.load_bundle(bundle,key);ready=request(d,'/api/collection/local-status')
            assert ready['planRevision']==1 and ready['planChecksum']==template['planChecksum']
            assert ready['goalChecksum']==manifest['goalChecksum'] and ready['assignmentChecksum']==manifest['assignmentChecksum']
            rawprivacy=request(d,'/api/collection/export-privacy');file=d/'privacy.json';ds.publish(file,ds.encoded(rawprivacy));privacy.append(ds.read_privacy(file,ds.digest(file.read_bytes())))
            cli(d,'setup','--slot',slot);assert request(d,'/api/collection/progress')['raw']['completed']==1
            results.append(dict(slot=slot,assignments=len(assigned),visits=10,raw='RAW_COLLECTED',ai='NOT_RUN',https=True,restart=True,rotation=True))
            print('PASS SYNTHETIC setup/API '+slot,flush=True)
        assert len(set(owners))==3
        request(directories[1],'/api/auth/me',token=json.loads((directories[0]/'participant.json').read_text())['credential'],status=401)
        merge=ds.merge(exports,privacy,root/'registry.sqlite',root/'merged.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports]);assert merge['rawCompleted']==3 and merge['status']=='PARTIAL'
        duplicate=ds.merge(exports,privacy,root/'registry.sqlite',root/'duplicate.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports]);assert duplicate['duplicateImports']==3
        d=directories[0];request(d,'/api/consent/withdrawals','POST',dict(requestId=str(uuid.uuid4())),status=202)
        request(d,'/api/collection/assignments/PLAN-004/start','POST',{},status=409,idem=uuid.uuid4().hex)
        assert request(d,'/api/collection/progress')['attempts'][0]['rawStatus']=='QUARANTINED'
        file=d/'withdrawn-privacy.json';ds.publish(file,ds.encoded(request(d,'/api/collection/export-privacy')))
        latest=[ds.read_privacy(file,ds.digest(file.read_bytes())),*privacy[1:]]
        after=ds.merge(exports,latest,root/'registry.sqlite',root/'withdrawn.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports]);assert after['rawCompleted']==2
        try:ds.merge(exports,privacy,root/'registry.sqlite',root/'replay.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports])
        except ValueError:pass
        else:raise AssertionError('Old privacy accepted')
        # Self review preserves the original ended attempt and permits a new attempt with a new key.
        b=directories[1];attempt=request(b,'/api/collection/progress')['attempts'][0]
        request(b,'/api/collection/attempts/'+attempt['attemptId']+'/recollect','POST',dict(reasonCode='INSUFFICIENT_VISITS'),status=204)
        request(b,'/api/collection/assignments/PLAN-002/start','POST',{},status=201,idem=uuid.uuid4().hex)
        assert len(request(b,'/api/collection/progress')['attempts'])==2
        cli(d,'setup','--slot','A','--rotate-credential')
        assert request(d,'/api/collection/export-privacy')['withdrawn']
        assert not request(d,'/api/collection/local-status')['ready']
        # A new valid policy version invalidates old consent; no model evidence is invented.
        c=directories[2];changed=copy.deepcopy(template);changed['policyVersion']='2';changed['notBefore']=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()
        changedFile=root/'SYNTHETIC-policy-v2.json';local.private(changedFile,json.dumps(changed))
        cli(c,'setup','--slot','C','--policy',str(changedFile),'--policy-sha256',ds.digest(changedFile.read_bytes()))
        assert 'CONSENT_REQUIRED' in request(c,'/api/collection/local-status')['blockers']
        request(c,'/api/consent','POST',dict(requestId=str(uuid.uuid4()),policyId='SYNTHETIC-103',policyVersion='2',accepted=True))
        assert request(c,'/api/collection/local-status')['ready']
        report=dict(result='PASS',kind='SYNTHETIC-103-NOT-ACTUAL-COLLECTION',sources=results,chrome='SEPARATE_TEST',merge='PARTIAL',duplicateImports=3,withdrawal='QUARANTINED',privacyReplay='REJECTED',actualParticipantSessions=0)
        (root/'summary.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    finally:
        for d in directories:
            if (d/'config.json').exists():cli(d,'stop')

if __name__=='__main__':main()
