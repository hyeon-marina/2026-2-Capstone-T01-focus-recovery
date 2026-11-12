"""Issue 112. Fresh test owner only, using real HTTPS pages plus controlled privacy fixtures."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import dataset
import local


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--chrome', required=True)
    parser.add_argument('--test-subnet', help='Optional unused Docker subnet for this new project')
    options = parser.parse_args()
    os.umask(0o077)
    output = options.output.resolve()
    output.mkdir(mode=0o700, exist_ok=False)
    directory = output / 'A'
    key = output / 'test.agekey'
    subprocess.run(['age-keygen', '-o', key], check=True, capture_output=True)
    recipient = subprocess.check_output(['age-keygen', '-y', key], text=True).strip()

    def cli(*args):
        subprocess.run([sys.executable, local.ROOT/'tools/individual-local/local.py',
                        '--directory', directory, *args], check=True)

    def browser(recovery):
        env = dict(os.environ, FOCUS105_LOCAL_DIRECTORY=str(directory), FOCUS105_AUTOMATED_EXTERNAL='1',
                   FOCUS112_RECOVERY='1' if recovery else '0', CHROMIUM_PATH=options.chrome)
        subprocess.run(['node', 'scripts/local-https-browser-test.mjs'], cwd=local.ROOT/'fe', env=env, check=True)

    def request(path, method='GET'):
        return dataset.request('https://localhost:19546', directory/'participant.json', path,
                               directory/'tls/localhost.pem', method=method)

    def counts():
        tables = ('work_session', 'page_visit', 'collection_attempt', 'consent_record', 'privacy_retraction',
                  'visit_tombstone', 'collection_failure', 'collection_export_audit')
        sql = '\n'.join(f'SELECT COUNT(*) FROM {table};' for table in tables)
        result = local.compose(config, local.env_for(config, directory), 'exec', '-T', 'mysql', 'sh', '-c',
                               'MYSQL_PWD="$(cat /run/secrets/mysql-app)"; export MYSQL_PWD; '
                               'exec mysql -ufocus_collection --batch --skip-column-names focus_collection',
                               input=sql, text=True, capture_output=True)
        return dict(zip(tables, map(int, result.stdout.split()), strict=True))

    old = subprocess.check_output(['git', 'show',
        'bb3cb46375fcc97be946d69b2b6a9a1f22b174f3:docs/data-collection/TEAM_POLICY.json'], cwd=local.ROOT)
    if dataset.digest(old) != local.V5_TEAM_POLICY_SHA256:
        raise ValueError('Official v5 checksum mismatch')
    policy = output/'official-v5.json'
    policy.write_bytes(old)
    cli('init', '--slot', 'A', '--db-port', '33234', '--tls-port', '19546')
    config = json.loads((directory/'config.json').read_text())
    if options.test_subnet:
        project = config['project']
        subprocess.run(['docker', 'network', 'create', '--subnet', options.test_subnet,
                        '--label', 'com.docker.compose.project='+project, '--label',
                        'com.docker.compose.network=default', project+'_default'], check=True)
    try:
        cli('setup', '--slot', 'A', '--policy', policy, '--policy-sha256', dataset.digest(old))
        local.private(directory/'AUTOMATED_TEST_ONLY', 'NO_HUMAN_PARTICIPANT_CONSENT')
        browser(False)
        original = request('/api/collection/exports', 'POST')['files']
        before = counts()
        credential = (directory/'participant.json').read_bytes()
        cli('backup', '--recipient', recipient, '--output', output/'v5-backup.sql.age')
        cli('setup', '--slot', 'A')
        assert counts() == before and credential == (directory/'participant.json').read_bytes()
        assert not request('/api/consent')['consentValid']
        browser(True)
        snapshot = request('/api/collection/exports', 'POST')
        files = snapshot['files']
        for table, field in [('visits','visitId'), ('sessions','sessionId'), ('collection_attempts','attemptId'),
                             ('consent_references','consentId')]:
            assert {row[field] for row in original[table]} <= {row[field] for row in files[table]}
        assert all(v in files['visits'] for v in original['visits'])
        assert len(files['visits']) == 21
        assert any(v['domain'] == 'www.koreaherald.com' and '[EMAIL]' in v['content'] for v in files['visits'])
        bundle = output/'mixed.tar.age'
        dataset.publish(bundle, dataset.age(dataset.pack(snapshot, 'issue-112-technical-test'), recipient=recipient))
        privacy = [request('/api/collection/export-privacy')]
        merged = output/'merged.age'
        report = dataset.merge([bundle], privacy, output/'registry.sqlite', merged, key, recipient,
                               bundle_hashes=[dataset.digest(bundle.read_bytes())])
        review = dataset.training_review(merged, dataset.digest(merged.read_bytes()), privacy, output/'review.age', key, recipient)
        assert (report['rawCompleted'],review['sessions'],review['visits'],review['windows']) == (2,2,20,16)
        print(json.dumps(dict(result='PASS',humanResearchSessions=0,beforeUpgrade=before,after=counts(),
                              exportedVisits=len(files['visits']),reviewWindows=16)))
    finally:
        cli('stop')


if __name__ == '__main__':
    if not __debug__:
        raise SystemExit('Assertions must be enabled')
    main()
