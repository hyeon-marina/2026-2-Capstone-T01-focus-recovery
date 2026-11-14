#!/usr/bin/env python3
"""Three NEW isolated Docker MySQLs + actual MV3 Chrome + Spring. No FastAPI or real data.
Retains stopped containers, volumes, profiles and encrypted evidence; never deletes existing data.
"""
import argparse
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
import copy

import dataset as ds
from local import private

if not __debug__:
    raise SystemExit('Validation requires Python without -O')

ROOT=Path(__file__).resolve().parents[2]


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);p.add_argument('--chrome',required=True);p.add_argument('--metadata-only',action='store_true');p.add_argument('--page-content',action='store_true',help='Exercise public-text adapter, focused input exclusion, delayed DOM and lost POST/PATCH/END ACKs');p.add_argument('--public-documents',action='store_true');a=p.parse_args()
    if a.public_documents and not a.page_content:p.error('--public-documents requires --page-content')
    if a.metadata_only and a.page_content:p.error('Choose metadata-only or page-content')
    os.umask(0o077);root=a.output.resolve();root.mkdir(parents=True,exist_ok=False,mode=0o700)
    for port in (33111,33112,33113,18101,18102,18103,8911):
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            sock.bind(('127.0.0.1',port))
    java=Path(os.environ['JAVA_HOME'])/'bin/java' if os.environ.get('JAVA_HOME') else 'java'
    gradle='gradlew.bat' if os.name=='nt' else './gradlew'
    subprocess.run([gradle,'writeCollectionTestClasspath','--console=plain'],cwd=ROOT/'be',check=True)
    classpath=(ROOT/'be/build/collection-test-classpath.txt').read_text()
    key=root/'merge.agekey'
    subprocess.run(['age-keygen','-o',str(key)],check=True,capture_output=True)
    recipient=subprocess.run(['age-keygen','-y',str(key)],check=True,capture_output=True,text=True).stdout.strip()
    runid=uuid.uuid4().hex[:12];processes=[];containers=[];exports=[];privacy=[];fixtures=[];evidence=[]
    now=datetime.now(timezone.utc)
    policy={k:'synthetic-only-not-approval' for k in ['approvalRef','contractApprovalRef','retentionRef','institutionRef','modelEvidenceRef','privacyEvidenceRef','startAuthorizationRef']}
    policy.update(status='SYNTHETIC',buildId='controlled-web-101',policyId='SYNTHETIC-101',policyVersion='1',notBefore=(now-timedelta(minutes=1)).isoformat().replace('+00:00','Z'),expiresAt=(now+timedelta(hours=4)).isoformat().replace('+00:00','Z'),sites=[dict(origin='http://127.0.0.1:8911',pathPrefix='/public/')])
    policy['metadataOnly']=a.metadata_only
    if a.page_content:policy.update(metadataOnly=True,pageContent=True,maskContacts=True)
    policyfile=root/'site-policy.json';private(policyfile,json.dumps(policy))
    def launch(config,path):
        env=os.environ.copy();env['FOCUS101_FIXTURE_FILE']=str(path)
        log=(path.parent/'backend.log').open('ab')
        proc=subprocess.Popen([str(java),'-cp',classpath,'com.focusrecovery.domain.collection.IndividualLocalSyntheticServer'],cwd=ROOT/'be',env=env,stdout=log,stderr=log)
        log.close();processes.append(proc)
        for _ in range(150):
            if proc.poll() is not None:raise RuntimeError('Synthetic backend failed; inspect protected backend.log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:'+str(config['serverPort'])+'/api/health',timeout=1) as r:
                    if r.status==200 and (path.parent/'operator.json').exists():return proc
            except OSError:pass
            time.sleep(.2)
        raise RuntimeError('Synthetic backend startup timed out')
    def browser(slot,directory,withdraw=False):
        env=os.environ.copy();env.update(FOCUS101_SERVER='http://127.0.0.1:'+str(18101+'ABC'.index(slot)),FOCUS101_SLOT=slot,FOCUS101_EVIDENCE=str(directory),COLLECTION_SITE_POLICY_FILE=str(policyfile),CHROMIUM_PATH=a.chrome)
        if withdraw:env['FOCUS101_WITHDRAW_ONLY']='1'
        if a.page_content:env['FOCUS119_FAULTS']='1'
        if a.public_documents:env['FOCUS121_DOCUMENTS']='1'
        with (directory/('withdrawal-browser.log' if withdraw else 'browser.log')).open('wb') as log:
            subprocess.run(['npm.cmd' if os.name=='nt' else 'npm','run','test:raw:browser'],cwd=ROOT/'fe',env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
    def sql(config,query):
        r=subprocess.run(['docker','exec','-i',config['container'],'sh','-c','IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql -uroot --batch --raw --skip-column-names focus101_synthetic'],input=config['password']+'\n'+query,text=True,capture_output=True)
        if r.returncode:raise RuntimeError('Synthetic DB not ready')
        return r.stdout
    def fresh_privacy(slot,config,directory):
        owner=ds.parse((directory/'participant.json').read_bytes())['participantId']
        value=ds.request('http://127.0.0.1:'+str(config['serverPort']),directory/'operator.json','/api/collection/admin/export-privacy/'+owner,synthetic=True)
        file=directory/('privacy-'+uuid.uuid4().hex+'.json');ds.publish(file,ds.encoded(value));return ds.read_privacy(file,ds.digest(file.read_bytes()))
    try:
        counts=[]
        for i,slot in enumerate('ABC'):
            directory=root/slot;directory.mkdir(mode=0o700);evidence.append(directory)
            config=dict(kind='SYNTHETIC-101',container='focus101-'+runid+'-'+slot.lower(),database='focus101_synthetic',dbPort=33111+i,serverPort=18101+i,password=secrets.token_urlsafe(32),policyFile=str(policyfile))
            file=directory/'fixture.json';private(file,json.dumps(config));fixtures.append((config,file))
            envfile=directory/'mysql.env';private(envfile,'MYSQL_ROOT_PASSWORD='+config['password']+'\nMYSQL_DATABASE=focus101_synthetic\n')
            result=subprocess.run(['docker','run','--name',config['container'],'--detach','--publish','127.0.0.1:'+str(config['dbPort'])+':3306','--env-file',str(envfile),'--mount','type=volume,source='+config['container']+'-data,target=/var/lib/mysql','mysql:8.4'],capture_output=True)
            if result.returncode:raise RuntimeError('New synthetic DB start failed; check ports/names/Docker')
            containers.append(config['container'])
            for _ in range(150):
                try:sql(config,'SELECT 1;');break
                except RuntimeError:time.sleep(.2)
            else:raise RuntimeError('MySQL startup timed out')
            launch(config,file);browser(slot,directory)
            out=directory/(slot+'.tar.age')
            subprocess.run([sys.executable,str(ROOT/'tools/individual-local/dataset.py'),'export','--server','http://127.0.0.1:'+str(config['serverPort']),'--credential-file',str(directory/'participant.json'),'--synthetic-loopback','--recipient',recipient,'--output',str(out)],check=True)
            m,f,h=ds.load_bundle(out,key);assert len(f['visits'])==10;exports.append(out)
            privacy.append(fresh_privacy(slot,config,directory))
            metadata=sql(config,"SELECT COUNT(*) FROM page_visit; SELECT COUNT(*) FROM analysis_window; SELECT COUNT(*) FROM analysis_result; SELECT COUNT(*) FROM flyway_schema_history WHERE success=1;")
            actual=[int(x) for x in metadata.split()];assert actual==[10,0,0,18];counts.append(dict(slot=slot,visits=10,windows=0,analyses=0,migrations=18,encryptedSha256=ds.digest(out.read_bytes()),manifestSha256=h,files=m['files']))
            print('PASS: independent MySQL '+slot+' / Chrome measured 10 Visits / no AI',flush=True)
        registry=root/'merge-registry.sqlite';merged=root/'merged.tar.age'
        r=ds.merge(exports,privacy,registry,merged,key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports]);assert (r['rawCompleted'],r['validVisits'],r['theoreticalWindows'])==(3,30,24)
        duplicate=ds.merge(exports,privacy,registry,root/'duplicate.tar.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports]);assert duplicate['duplicateImports']==3
        snapshot=json.loads((evidence[0]/'snapshot.json').read_text());conflicting=copy.deepcopy(snapshot);conflicting['manifest']['exportId']=str(uuid.uuid4());conflicting['files']['visits'][0]['title']='Conflicting synthetic title'
        conflict=root/'conflict.tar.age';ds.publish(conflict,ds.age(ds.pack(conflicting,'synthetic-e2e'),recipient=recipient))
        try:ds.merge([conflict,*exports[1:]],privacy,registry,root/'must-not-exist.tar.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in [conflict,*exports[1:]]])
        except ValueError as e:assert 'ID collision' in str(e)
        else:raise AssertionError('ID conflict accepted')
        assert not (root/'must-not-exist.tar.age').exists()
        mismatch=copy.deepcopy(snapshot);mismatch['manifest']['planRevision']+=1;mismatchfile=root/'mismatched-plan.tar.age';ds.publish(mismatchfile,ds.age(ds.pack(mismatch,'synthetic-e2e'),recipient=recipient))
        try:ds.merge([mismatchfile,*exports[1:]],privacy,registry,root/'must-not-exist-plan.tar.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in [mismatchfile,*exports[1:]]])
        except ValueError as e:assert 'Plan revision' in str(e)
        else:raise AssertionError('Revision conflict accepted')
        # Stop both the backend JVM and its MySQL; the exact same volume/credentials must recover.
        first=processes[0];first.terminate();first.wait(timeout=30)
        subprocess.run(['docker','stop',containers[0]],check=True,capture_output=True);subprocess.run(['docker','start',containers[0]],check=True,capture_output=True)
        config,file=fixtures[0]
        for _ in range(150):
            try:sql(config,'SELECT 1;');break
            except RuntimeError:time.sleep(.2)
        config['restart']=True;file.write_text(json.dumps(config));launch(config,file)
        progress=ds.request('http://127.0.0.1:'+str(config['serverPort']),evidence[0]/'operator.json','/api/collection/admin/progress',synthetic=True)
        assert progress['raw']['syntheticCompleted']==1 and progress['attempts'][0]['quality']['validVisits']==10
        browser('A',evidence[0],withdraw=True)
        latest=[fresh_privacy(slot,config,directory) for slot,(config,_),directory in zip('ABC',fixtures,evidence)]
        withdrawn=ds.merge(exports,latest,registry,root/'after-withdrawal.tar.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports])
        assert (withdrawn['rawCompleted'],withdrawn['validVisits'],withdrawn['privacyExcluded'])==(2,20,1)
        try:ds.merge(exports,privacy,registry,root/'must-not-exist-old-privacy.tar.age',key,recipient,bundle_hashes=[ds.digest(x.read_bytes()) for x in exports])
        except ValueError as e:assert 'privacy rollback' in str(e)
        else:raise AssertionError('Old privacy replay accepted')
        report=dict(result='PASS',kind='SYNTHETIC-101',os=sys.platform,aiProcess=False,independentMySql=3,perSource=counts,
                    initial={k:r[k] for k in ['rawCompleted','validVisits','theoreticalWindows','actualGeneratedWindows','aiAnalysisCompletedWindows','status','participants']},duplicateImports=duplicate['duplicateImports'],idCollision='REJECTED',planMismatch='REJECTED',oldPrivacyReplay='REJECTED',serverAndMySqlRestart='PASS',
                    afterWithdrawal={k:withdrawn[k] for k in ['rawCompleted','validVisits','privacyExcluded']},dataset=str(merged),afterWithdrawalDataset=str(root/'after-withdrawal.tar.age'),containers=containers)
        ds.publish(root/'validation.json',ds.encoded(report));print(json.dumps({k:v for k,v in report.items() if k!='perSource'},indent=2))
    finally:
        for proc in processes:
            if proc.poll() is None:proc.terminate()
        for proc in processes:
            try:proc.wait(timeout=30)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        for name in containers:subprocess.run(['docker','stop',name],capture_output=True)
        print('Stopped only this run\'s synthetic processes/containers. Volumes and evidence retained.')


if __name__=='__main__':main()
