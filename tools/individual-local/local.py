#!/usr/bin/env python3
"""Loopback-only, persistent local collection. Never seeds participants, consent or approvals."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        if os.name == 'nt':
            # Restrict access before any secret bytes are written.
            subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r', os.environ['USERNAME'] + ':(F)'], check=True, stdout=subprocess.DEVNULL)
        stream.write(text)


def run(cmd, **kwargs):
    return subprocess.run([str(x) for x in cmd], check=True, **kwargs)


def env_for(config, directory):
    env = os.environ.copy()
    env.update(SPRING_PROFILES_ACTIVE='individual-local', COLLECTION_SECRETS_DIR=str(directory / 'secrets'),
               COLLECTION_SECRET_DIR=str(directory / 'secrets'), COLLECTION_DB_PORT=str(config['dbPort']),
               COLLECTION_TLS_PORT=str(config['tlsPort']), COLLECTION_TLS_KEYSTORE=str(directory / 'tls/backend.p12'),
               COLLECTION_SITE_POLICY_FILE=str(directory / 'site-policy.json'))
    return env


def jar():
    jars = [p for p in (ROOT / 'be/build/libs').glob('*-SNAPSHOT.jar') if not p.name.endswith('-plain.jar')]
    if len(jars) != 1:
        raise ValueError('Build one be bootJar with JDK 21 first')
    return jars[0]


def compose(config, env, *args, **kwargs):
    return run(['docker', 'compose', '-p', config['project'], '-f', ROOT / 'deploy/individual-local/compose.yml', *args], env=env, **kwargs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=ROOT / '.collection/local')
    p.add_argument('command', choices=['check', 'init', 'db', 'start', 'stop', 'status', 'logs', 'verify', 'build', 'bootstrap', 'backup'])
    p.add_argument('--slot', choices=['A', 'B', 'C'])
    p.add_argument('--db-port', type=int, default=33101)
    p.add_argument('--tls-port', type=int, default=9443)
    p.add_argument('--request', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--recipient')
    a = p.parse_args()
    d = a.directory.resolve()
    if a.command == 'check':
        needed=['java','javac','keytool','jcmd','docker','node','npm','age','age-keygen']
        for cmd in needed:
            print(cmd + ': ' + ('FOUND' if shutil.which(cmd) else 'MISSING'))
        if any(not shutil.which(cmd) for cmd in needed):raise ValueError('Install missing tools first')
        run(['java', '-version']); run(['docker', 'info', '--format', '{{.ServerVersion}}']); run(['node', '--version'])
        return
    if a.command == 'init':
        if not a.slot or not all(1024 <= n <= 65535 for n in (a.db_port, a.tls_port)) or a.db_port == a.tls_port:
            p.error('--slot and distinct valid ports required')
        os.umask(0o077)
        d.mkdir(parents=True, mode=0o700, exist_ok=False)
        if os.name == 'nt':
            run(['icacls', d, '/inheritance:r', '/grant:r', os.environ['USERNAME'] + ':(OI)(CI)F'], stdout=subprocess.DEVNULL)
        (d / 'secrets').mkdir(mode=0o700); (d / 'tls').mkdir(mode=0o700)
        config = dict(project='focus-local-' + uuid.uuid4().hex[:12], slot=a.slot, dbPort=a.db_port, tlsPort=a.tls_port)
        private(d / 'config.json', json.dumps(config, indent=2))
        for name in ['mysql-root', 'spring.datasource.password', 'server.ssl.key-store-password']:
            private(d / 'secrets' / name, secrets.token_urlsafe(48))
        password = d / 'secrets/server.ssl.key-store-password'
        run(['keytool', '-genkeypair', '-alias', 'localhost', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '90',
             '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost,ip:127.0.0.1', '-ext', 'EKU=serverAuth', '-ext', 'BC=ca:false',
             '-storetype', 'PKCS12', '-keystore', d / 'tls/backend.p12', '-storepass:file', password, '-keypass:file', password], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for name, flags in [('localhost.pem', ['-rfc']), ('localhost.cer', [])]:
            run(['keytool', '-exportcert', '-alias', 'localhost', '-keystore', d / 'tls/backend.p12', '-storepass:file', password, '-file', d / 'tls' / name, *flags], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.copyfile(ROOT / 'deploy/collection/site-policy.draft.json', d / 'site-policy.json')
        print('Initialized NEW private local directory. Trust localhost.cer/pem; actual collection BLOCKED. No accounts or approvals created.')
        return
    c = json.loads((d / 'config.json').read_text(encoding='utf-8'))
    if not c['project'].startswith('focus-local-') or not all(x.isalnum() or x == '-' for x in c['project']):
        raise ValueError('Dedicated local project required')
    env = env_for(c, d)
    if a.command == 'db':
        compose(c, env, 'up', '-d', '--wait', 'mysql')
        print('Persistent volume: ' + c['project'] + '_local-db; existing rows retained')
    elif a.command == 'start':
        if (d / 'backend.json').exists():
            raise ValueError('Existing process record; use status/stop and investigate stale record before restart')
        with socket.socket() as s:
            s.bind(('127.0.0.1', c['tlsPort']))
        nonce = str(uuid.uuid4())
        with (d / 'backend.log').open('ab') as log:
            child = subprocess.Popen(['java', '-Dfocus.local.instance=' + nonce, '-jar', str(jar())], cwd=ROOT / 'be', env=env, stdout=log, stderr=log,
                                     start_new_session=os.name != 'nt')
        private(d / 'backend.json', json.dumps(dict(pid=child.pid, nonce=nonce)))
        print('Backend starting on https://localhost:' + str(c['tlsPort']) + '; check status and backend.log')
    elif a.command == 'stop':
        if (d / 'backend.json').exists():
            proc = json.loads((d / 'backend.json').read_text())
            check = subprocess.run(['jcmd', str(proc['pid']), 'VM.system_properties'], capture_output=True, text=True)
            if check.returncode or ('focus.local.instance=' + proc['nonce']) not in check.stdout.splitlines():
                raise ValueError('Process identity not verified. No process killed; inspect stale backend.json manually')
            os.kill(proc['pid'], signal.SIGTERM)
            for _ in range(50):
                time.sleep(.1)
                if subprocess.run(['jcmd', str(proc['pid']), 'VM.system_properties'], capture_output=True).returncode:
                    break
            else:
                raise ValueError('Backend still stopping; DB kept running')
            (d / 'backend.json').unlink()
        compose(c, env, 'stop', 'mysql')
        print('Stopped. Database volume and files retained; no down -v command is provided.')
    elif a.command == 'status':
        compose(c, env, 'ps')
        ctx = ssl.create_default_context(cafile=str(d / 'tls/localhost.pem'))
        with urllib.request.urlopen('https://localhost:' + str(c['tlsPort']) + '/api/health', context=ctx, timeout=5) as r:
            print('HTTPS health: ' + str(r.status))
        print('Approval status requires authenticated consent/site-policy/progress checks; health alone never opens collection.')
    elif a.command == 'logs':
        print((d / 'backend.log').read_text(encoding='utf-8')[-12000:])
    elif a.command == 'verify':
        sql = (ROOT / 'tools/collection/verify.sql').read_text()
        compose(c, env, 'exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql-app)"; export MYSQL_PWD; exec mysql -ufocus_collection --batch focus_collection', input=sql, text=True)
    elif a.command == 'build':
        build_env = env.copy()
        build_env.update(VITE_API_BASE_URL='https://localhost:' + str(c['tlsPort']))
        run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'build:real'], cwd=ROOT / 'fe', env=build_env)
        run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'package:collection', '--', 'real'], cwd=ROOT / 'fe', env=build_env)
    elif a.command == 'backup':
        if not a.output or not str(a.output).endswith('.age') or a.output.exists() or not a.recipient:
            raise ValueError('New .sql.age output and public recipient required')
        import dataset
        dump=compose(c,env,'exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql-app)"; export MYSQL_PWD; exec mysqldump -ufocus_collection --single-transaction --no-tablespaces --set-gtid-purged=OFF focus_collection',capture_output=True)
        encrypted=dataset.age(dump.stdout,recipient=a.recipient)
        dataset.publish(a.output,encrypted)
        print(json.dumps(dict(backup=str(a.output),sha256=dataset.digest(encrypted),encrypted=True)))
    elif a.command == 'bootstrap':
        if not a.request:
            p.error('--request reviewed bootstrap JSON required; stop backend first')
        if (d / 'backend.json').exists():
            raise ValueError('Stop backend before offline bootstrap; DB must be running')
        run(['java', '-jar', jar(), '--spring.main.web-application-type=none', '--focus-recovery.collection.bootstrap-request=' + str(a.request.resolve())], env=env, cwd=ROOT / 'be')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Local operation failed. Check JDK21, Docker, ports, protected files and backend.log. Existing data retained.', file=sys.stderr)
        raise SystemExit(2)
