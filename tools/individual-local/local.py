#!/usr/bin/env python3
"""Loopback-only, persistent local collection. Offline owner setup; never invents consent or team/institution decisions."""
import argparse
import hashlib
import stat
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


def runtime_jar(directory, name):
    # A workspace rebuild must not replace nested JARs underneath a running JVM.
    staging = directory / ('runtime-' + uuid.uuid4().hex + '.pending')
    private(staging, '')
    with jar().open('rb') as source, staging.open('wb') as target:
        shutil.copyfileobj(source, target)
    output = directory / name
    os.replace(staging, output)
    return output


def compose(config, env, *args, **kwargs):
    return run(['docker', 'compose', '-p', config['project'], '-f', ROOT / 'deploy/individual-local/compose.yml', *args], env=env, **kwargs)


def protected(directory):
    # Refuse symlinks anywhere inside the local trust boundary, including TLS/secret inputs.
    if directory.is_symlink():
        raise ValueError('LOCAL_OWNER: symlink directory is not allowed')
    for path in [directory, *directory.rglob('*')]:
        if path.is_symlink():
            raise ValueError('LOCAL_OWNER: symlink is not allowed')
        info = path.stat()
        if os.name != 'nt':
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
                raise ValueError('LOCAL_OWNER: same OS owner and directory700/file600 required')
        else:
            # Check the actual ACL, not the localized icacls display text.
            script = "$a=Get-Acl -LiteralPath $env:FOCUS_LOCAL_ACL_PATH; $u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if (($a.Owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().Name) -or @($a.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $u }).Count) { exit 2 }"
            acl_env = os.environ.copy(); acl_env['FOCUS_LOCAL_ACL_PATH'] = str(path)
            run(['powershell', '-NoProfile', '-Command', script], env=acl_env, stdout=subprocess.DEVNULL)


def prerequisites():
    needed = ['java', 'javac', 'keytool', 'jcmd', 'docker', 'node', 'npm', 'age', 'age-keygen']
    missing = [cmd for cmd in needed if not shutil.which(cmd)]
    if missing:
        raise ValueError('MISSING_PROGRAMS: ' + ', '.join(missing) + '; see individual-local-setup.md')
    version = subprocess.run(['javac', '-version'], capture_output=True, text=True, check=True)
    if not (version.stdout + version.stderr).strip().startswith('javac 21.'):
        raise ValueError('JDK_REQUIRED: select JDK21 JAVA_HOME and PATH; see individual-local-setup.md')
    run(['docker', 'info', '--format', '{{.ServerVersion}}'])
    run(['docker', 'compose', 'version'])
    jar()


def complete_local_files(d):
    for name in ['mysql-root', 'spring.datasource.password', 'server.ssl.key-store-password']:
        if not (d / 'secrets' / name).is_file():
            raise ValueError('LOCAL_INIT_INCOMPLETE: secret missing; do not replace credentials of an existing DB')
    password = d / 'secrets/server.ssl.key-store-password'
    if not (d / 'tls/backend.p12').exists():
        run(['keytool', '-genkeypair', '-alias', 'localhost', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '90',
             '-dname', 'CN=localhost', '-ext', 'SAN=dns:localhost,ip:127.0.0.1', '-ext', 'EKU=serverAuth', '-ext', 'BC=ca:false',
             '-storetype', 'PKCS12', '-keystore', d / 'tls/backend.p12', '-storepass:file', password, '-keypass:file', password], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for name, flags in [('localhost.pem', ['-rfc']), ('localhost.cer', [])]:
        if not (d / 'tls' / name).exists():
            run(['keytool', '-exportcert', '-alias', 'localhost', '-keystore', d / 'tls/backend.p12', '-storepass:file', password, '-file', d / 'tls' / name, *flags], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not (d / 'site-policy.json').exists():
        private(d / 'site-policy.json', (ROOT / 'deploy/collection/site-policy.draft.json').read_text())


def self_setup(a, directory):
    if not a.slot:
        raise ValueError('SLOT_REQUIRED: --slot A/B/C')
    prerequisites()
    if not directory.exists():
        main(['--directory', str(directory), 'init', '--slot', a.slot,
              '--db-port', str(a.db_port), '--tls-port', str(a.tls_port)])
    protected(directory)
    config = json.loads((directory / 'config.json').read_text())
    if config['slot'] != a.slot:
        raise ValueError('LOCAL_SLOT_MISMATCH: existing slot cannot be switched; use a separate NEW local DB')
    complete_local_files(directory)
    owner = directory / 'owner.key'
    if not owner.exists():
        private(owner, secrets.token_urlsafe(48))
    policy = None
    if a.policy:
        raw = a.policy.read_bytes()
        if len(raw) > 65536 or not a.policy_sha256 or hashlib.sha256(raw).hexdigest() != a.policy_sha256:
            raise ValueError('LOCAL_POLICY_CHECKSUM: obtain the common SHA-256 separately from the team')
        policy = directory / ('policy-' + uuid.uuid4().hex + '.pending')
        private(policy, raw.decode('utf-8'))
    # Stop only a process whose nonce is verified by the existing stop implementation.
    if (directory / 'backend.json').exists():
        main(['--directory', str(directory), 'stop'])
    main(['--directory', str(directory), 'db'])
    request = directory / ('setup-' + uuid.uuid4().hex + '.json')
    private(request, json.dumps(dict(slot=a.slot, ownerSecretFile=str(owner),
        credentialFile=str(directory / 'participant.json'), rotate=a.rotate_credential,
        policyFile=str(policy) if policy else None, policyChecksum=a.policy_sha256)))
    env = env_for(config, directory)
    log = directory / 'setup.log'
    with log.open('ab') as stream:
        result = subprocess.run(['java', '-jar', str(runtime_jar(directory, 'setup-runtime.jar')), '--spring.main.web-application-type=none',
            '--focus-recovery.collection.local-request=' + str(request)], cwd=ROOT / 'be', env=env,
            stdout=stream, stderr=stream)
    if result.returncode:
        reasons = [code for code in ['LOCAL_POLICY_DRAFT','LOCAL_POLICY_MODE','LOCAL_POLICY_INCOMPLETE','LOCAL_POLICY_EXPIRED','LOCAL_PLAN_CHECKSUM','LOCAL_PLAN_MISMATCH','INSTITUTION_BLOCKED','GOAL_UNCONFIRMED','LOCAL_OWNER_MISMATCH','LOCAL_DATABASE_NOT_EMPTY','PLAN_HAS_ACTUALS','PLAN_REVISION_CONFLICT','POLICY_VERSION_CONFLICT','POLICY_EFFECTIVE_CONFLICT','LOCAL_POLICY_SENSITIVE_SITE','PRIVACY_WITHDRAWN'] if code in log.read_text(encoding='utf-8')[-20000:]]
        raise ValueError('LOCAL_SETUP_FAILED ' + ','.join(reasons) + ': inspect protected setup.log; data retained; rerun setup to recover')
    if policy:
        os.replace(policy, directory / 'site-policy.json')
    main(['--directory', str(directory), 'start'])
    context = ssl.create_default_context(cafile=str(directory / 'tls/localhost.pem'))
    for _ in range(150):
        try:
            with urllib.request.urlopen('https://localhost:' + str(config['tlsPort']) + '/api/health', context=context, timeout=1) as response:
                if response.status == 200:
                    break
        except ssl.SSLError:
            raise ValueError('TLS_ERROR: verify local certificate validity/SAN; never disable TLS checks')
        except OSError:
            time.sleep(.2)
    else:
        raise ValueError('SERVER_UNAVAILABLE: inspect backend.log and Docker; data retained')
    print('READY: slot ' + a.slot + '; credential saved to participant.json (value hidden); HTTPS verified.')
    print('Next: trust local certificate in Chrome, build extension, import participant.json into your own profile, review policy and explicitly consent.')
    if not policy and json.loads((directory / 'site-policy.json').read_text()).get('status') == 'DRAFT':
        print('BLOCKED: common policy and 20 goals are DRAFT. Obtain confirmed team policy + SHA-256; rerun setup --policy FILE --policy-sha256 HASH.')


def main(argv=None):
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=ROOT / '.collection/local')
    p.add_argument('command', choices=['check', 'init', 'db', 'start', 'stop', 'status', 'logs', 'verify', 'build', 'bootstrap', 'backup', 'setup', 'policy-checksum', 'policy-validate'])
    p.add_argument('--slot', choices=['A', 'B', 'C'])
    p.add_argument('--db-port', type=int, default=33101)
    p.add_argument('--tls-port', type=int, default=9443)
    p.add_argument('--request', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--recipient')
    p.add_argument('--rotate-credential', action='store_true')
    p.add_argument('--policy', type=Path)
    p.add_argument('--policy-sha256')
    a = p.parse_args(argv)
    if a.directory.is_symlink():
        raise ValueError('LOCAL_OWNER: symlink directory is not allowed')
    d = a.directory.absolute()
    if a.command == 'policy-validate':
        if not a.policy:
            raise ValueError('--policy FILE required')
        command = ['gradlew.bat' if os.name == 'nt' else './gradlew', 'checkLocalPolicy', '--console=plain', '-PcollectionPolicyFile=' + str(a.policy.resolve())]
        if a.policy_sha256:
            command.append('-PcollectionPolicySha256=' + a.policy_sha256)
        run(command, cwd=ROOT / 'be')
        return
    if a.command == 'policy-checksum':
        if not a.policy:
            raise ValueError('--policy FILE required')
        value = json.loads(a.policy.read_text(encoding='utf-8'))
        checksum = hashlib.sha256(json.dumps(value['plan'], ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        print('planChecksum: ' + checksum)
        print('policy SHA-256 (after inserting planChecksum): ' + hashlib.sha256(a.policy.read_bytes()).hexdigest())
        return
    if a.command == 'setup':
        self_setup(a, d)
        return
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
        complete_local_files(d)
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
            child = subprocess.Popen(['java', '-Dfocus.local.instance=' + nonce, '-jar', str(runtime_jar(d, 'backend-runtime.jar'))], cwd=ROOT / 'be', env=env, stdout=log, stderr=log,
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
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print('Local operation failed. Check JDK21, Docker, ports, protected files and backend.log. Existing data retained.', file=sys.stderr)
        if isinstance(exc, ValueError): print(str(exc), file=sys.stderr)
        raise SystemExit(2)
