#!/usr/bin/env python3
"""Create NEW internal backend TLS files. Public domain certificate is separately required."""
import argparse
import os
from pathlib import Path
import subprocess
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',required=True,type=Path);p.add_argument('--secrets',required=True,type=Path);a=p.parse_args()
a.output.mkdir(mode=0o700,parents=True,exist_ok=False)
os.umask(0o077)
password=(a.secrets/'server.ssl.key-store-password').resolve()
if not password.is_file():p.error('Prepare secret directory first')
def run(*args):subprocess.run(['openssl',*args],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
r=a.output.resolve()
run('req','-x509','-newkey','rsa:3072','-nodes','-keyout',str(r/'backend-ca.key'),'-out',str(r/'backend-ca.pem'),'-days','365','-subj','/CN=Focus internal collection CA','-addext','basicConstraints=critical,CA:TRUE')
run('req','-newkey','rsa:3072','-nodes','-keyout',str(r/'backend.key'),'-out',str(r/'backend.csr'),'-subj','/CN=be')
(r/'backend.ext').write_text('subjectAltName=DNS:be\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n')
run('x509','-req','-in',str(r/'backend.csr'),'-CA',str(r/'backend-ca.pem'),'-CAkey',str(r/'backend-ca.key'),'-CAcreateserial','-out',str(r/'backend.pem'),'-days','90','-extfile',str(r/'backend.ext'))
run('pkcs12','-export','-in',str(r/'backend.pem'),'-inkey',str(r/'backend.key'),'-certfile',str(r/'backend-ca.pem'),'-out',str(r/'backend.p12'),'-passout','file:'+str(password))
print('Prepared internal be certificate. Supply public fullchain.pem/privkey.pem; do not expose CA private key.')
