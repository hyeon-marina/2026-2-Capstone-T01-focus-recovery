#!/usr/bin/env python3
"""Opt-in regression with real FastAPI + MOCK models, kept separate from raw collection E2E.
Uses ONLY a retained SYNTHETIC-101 fixture; creates new test schemas without changing source rows.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

if not __debug__:
    raise SystemExit('Validation requires Python without -O')

ROOT=Path(__file__).resolve().parents[2]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--mysql-fixture',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--ai-python',required=True);p.add_argument('--chrome',required=True);a=p.parse_args()
    c=json.loads(a.mysql_fixture.read_text());assert c['kind']=='SYNTHETIC-101' and c['container'].startswith('focus101-') and c['database']=='focus101_synthetic' and c['dbPort'] in (33111,33112,33113)
    os.umask(0o077);a.output.mkdir(parents=True,exist_ok=False,mode=0o700)
    for port in (8893,8895,8897):
        with socket.socket() as sock:sock.bind(('127.0.0.1',port))
    env=os.environ.copy();env.update(AI_V2_PROFILE='synthetic-test',AI_V2_ENABLED='1',AI_V2_SERVICE_TOKEN='synthetic-internal-service-token-95-0123456789',AI_RETRACTION_SECRET='synthetic-service-only-secret-93-0123456789',CHROMIUM_PATH=a.chrome,
        FOCUS89_AI_URL='http://127.0.0.1:8897',FOCUS93_AI_URL='http://127.0.0.1:8893',FOCUS95_AI_URL='http://127.0.0.1:8895',FOCUS97_AI_URL='http://127.0.0.1:8897',
        FOCUS101_MYSQL_URL='jdbc:mysql://127.0.0.1:'+str(c['dbPort'])+'/focus101_synthetic?serverTimezone=UTC',FOCUS101_MYSQL_PASSWORD=c['password'])
    processes=[]
    try:
        subprocess.run(['docker','start',c['container']],check=True,capture_output=True)
        def sql(query):
            r=subprocess.run(['docker','exec','-i',c['container'],'sh','-c','IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql -uroot'],input=c['password']+'\n'+query,text=True,capture_output=True)
            if r.returncode:raise RuntimeError('Synthetic DB not ready')
        for _ in range(150):
            try:sql('SELECT 1;');break
            except RuntimeError:time.sleep(.2)
        for prefix in ('85','89','93','95','97'):
            schema='focus'+prefix+'_issue101_'+uuid.uuid4().hex;sql('CREATE DATABASE '+schema+' CHARACTER SET utf8mb4;')
            env['FOCUS'+prefix+'_MYSQL_URL']='jdbc:mysql://127.0.0.1:'+str(c['dbPort'])+'/'+schema+'?serverTimezone=UTC';env['FOCUS'+prefix+'_MYSQL_PASSWORD']=c['password']
        for port in (8893,8895,8897):
            log=(a.output/('ai-'+str(port)+'.log')).open('ab')
            proc=subprocess.Popen([a.ai_python,str(ROOT/'be/src/test/python/v2_http_fixture.py'),'--port',str(port),'--retraction-journal',str((a.output/('journal-'+str(port)+'.sqlite')).resolve())],cwd=ROOT,env=env,stdout=log,stderr=log);log.close();processes.append(proc)
            for _ in range(100):
                if proc.poll() is not None:raise RuntimeError('MOCK model fixture failed')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/openapi.json',timeout=1) as r:
                        if r.status==200:break
                except OSError:pass
                time.sleep(.1)
            else:raise RuntimeError('MOCK fixture startup timed out')
        command=['gradlew.bat' if os.name=='nt' else './gradlew','test','--rerun-tasks','--console=plain','bootJar']
        subprocess.run(command,cwd=ROOT/'be',env=env,check=True)
    finally:
        for proc in processes:
            if proc.poll() is None:proc.terminate()
        for proc in processes:
            try:proc.wait(timeout=15)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        subprocess.run(['docker','stop',c['container']],capture_output=True)
        print('Stopped only regression fixtures. Source rows and all test schemas/volumes retained.')

if __name__=='__main__':main()
