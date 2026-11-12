#!/usr/bin/env python3
"""Authenticated snapshots, age encryption, strict JSONL validation and atomic raw dataset merges."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import ssl
import subprocess
import sys
import tarfile
import urllib.parse
import urllib.request
import uuid

SCHEMA = 'focus-raw-export/1'
FILES = {
    'goals': 'goalId description status evidenceRef',
    'assignments': 'plannedSessionId goalId scenarioType repetition slotId',
    'participants': 'slotId participantId',
    'sessions': 'sessionId participantId goalId scenario startedAt endedAt status collectionSpecVersion consentRecordId privacyStatus privacyRevision source plannedSessionId',
    'visits': 'visitId sessionId sequence browserTabKey normalizedUrl domain title content searchQuery isSearchResultPage visitedAt extractionStatus activeDurationMs tabSwitchCount behaviorVersion',
    'behaviors': 'visitId sessionId activeDurationMs tabSwitchCount behaviorVersion updatedAt',
    'collection_attempts': 'attemptId plannedSessionId participantId sessionId source reviewStatus deliveredVisitCount deliveredThroughSequence reasonCode createdAt',
    'collection_failures': 'failureId attemptId reasonCode observedAt',
    'consent_references': 'consentId participantId policyId policyVersion acceptedAt withdrawnAt policyStatus retentionPolicyRef approvalRef',
    'privacy_events': 'retractionId sessionId visitId reasonCode requestedAt processingStatus',
    'raw_quality': 'attemptId plannedSessionId participantId sessionId goalId scenarioType source sessionStatus privacyStatus reviewStatus reasonCode collectedAt quality extractionFailures collectionFailures deliveryConfirmed status rawQuality rawStatus analysisState analysisWindowCount',
}
SCENARIOS = {'GOAL_MAINTENANCE', 'JUSTIFIED_DETOUR', 'GRADUAL_DRIFT', 'CLEAR_DRIFT'}
LIMIT = 256 * 1024 * 1024


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'ai'))
from training.raw_review import review_records, validate_visit_privacy, validate_review_records


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def parse(raw):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result, 'Duplicate JSON key')
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))


def instant(text):
    require(isinstance(text, str) and text.endswith('Z'), 'UTC timestamp required')
    return datetime.fromisoformat(text[:-1] + '+00:00')


def uid(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'Canonical UUID required')
    return value


def integer(value, minimum=0):
    require(type(value) is int and minimum <= value <= 9007199254740991, 'Invalid integer')
    return value


def private_write(path, data):
    path = Path(path)
    with path.open('xb') as f:
        os.chmod(path, 0o600)
        if os.name == 'nt':
            subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r', os.environ['USERNAME'] + ':(F)'], check=True, stdout=subprocess.DEVNULL)
        f.write(data)
        f.flush(); os.fsync(f.fileno())


def publish(path, data):
    path=Path(path);partial=path.with_name(path.name+'.partial-'+uuid.uuid4().hex)
    private_write(partial,data)
    try:
        os.link(partial,path)
    finally:
        partial.unlink(missing_ok=True)


def age(data, recipient=None, identity=None):
    cmd = ['age', '--encrypt', '-r', recipient] if recipient else ['age', '--decrypt', '-i', str(identity)]
    r = subprocess.run(cmd, input=data, capture_output=True)
    require(r.returncode == 0, 'age operation failed; check key files (no plaintext published)')
    return r.stdout


def request(server, credential_file, path, ca=None, synthetic=False, method='GET'):
    u = urllib.parse.urlsplit(server)
    require(not (u.path or u.query or u.fragment or u.username or u.password) and u.hostname and
            (u.scheme == 'https' or synthetic and u.scheme == 'http' and u.hostname == '127.0.0.1'), 'HTTPS origin required')
    credential = parse(Path(credential_file).read_bytes())['credential']
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca)))
    req = urllib.request.Request(server + path, method=method, data=b'{}' if method == 'POST' else None,
                                 headers={'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
    with opener.open(req, timeout=120) as response:
        raw = response.read(LIMIT + 1)
    require(len(raw) <= LIMIT, 'Snapshot exceeds bounded export size')
    return parse(raw)


def pack(snapshot, commit):
    m, files = snapshot['manifest'], snapshot['files']
    require(set(files) == set(FILES) and m['schemaVersion'] == SCHEMA, 'Unexpected export schema/files')
    version = 'raw-' + uid(m['exportId'])
    payloads = {name + '.jsonl': b''.join(encoded(dict(row, datasetVersion=version)) for row in rows) for name, rows in files.items()}
    m = dict(m, datasetVersion=version, sourceCommit=commit, files={name: dict(sha256=digest(raw), rows=len(files[name[:-6]])) for name, raw in payloads.items()})
    m['goalChecksum'] = digest(b''.join(encoded(row) for row in files['goals']))
    m['assignmentChecksum'] = digest(b''.join(encoded(row) for row in files['assignments']))
    sources={s['source'] for s in files['sessions']}
    require(sources or m.get('dataSource') in {'SYNTHETIC','PARTICIPANT'},'Empty snapshot needs an explicit data source')
    m['dataSources'] = sorted(sources or {m['dataSource']})
    payloads['manifest.json'] = encoded(m)
    payloads['checksums.sha256'] = ''.join(digest(raw) + '  ' + name + '\n' for name, raw in sorted(payloads.items())).encode()
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w') as tar:
        for name, raw in sorted(payloads.items()):
            info = tarfile.TarInfo(name); info.size = len(raw); info.mode = 0o600
            tar.addfile(info, io.BytesIO(raw))
    # shortcut: bounded in-memory snapshots, use streaming encrypted pages if an export exceeds 256 MiB.
    require(out.tell() <= LIMIT, 'Snapshot exceeds bounded export size')
    return out.getvalue()


def read_payloads(path, identity=None, synthetic=False):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= LIMIT, 'Invalid bundle size/path')
    raw = path.read_bytes()
    if path.name.endswith('.age'):
        require(identity is not None, 'age identity file required')
        raw = age(raw, identity=identity)
    else:
        require(synthetic, 'Plaintext is permitted only for explicit SYNTHETIC validation')
    require(len(raw) <= LIMIT, 'Decrypted snapshot too large')
    payloads = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as tar:
        members = tar.getmembers()
        require(len(members) <= len(FILES) + 3, 'Unexpected archive members')
        for item in members:
            require(item.isfile() and item.name not in payloads and item.name in {*(x + '.jsonl' for x in FILES), 'manifest.json', 'checksums.sha256', 'id_map.jsonl', 'review.jsonl'} and 0 <= item.size <= LIMIT, 'Unsafe archive member')
            require(sum(len(x) for x in payloads.values()) + item.size <= LIMIT, 'Archive expansion too large')
            payloads[item.name] = tar.extractfile(item).read()
    checksums = ''.join(digest(v) + '  ' + k + '\n' for k, v in sorted(payloads.items()) if k != 'checksums.sha256').encode()
    require(payloads['checksums.sha256'] == checksums, 'Checksum mismatch')
    return payloads


def load_bundle(path, identity=None, synthetic=False):
    payloads=read_payloads(path,identity,synthetic)
    require(set(payloads)=={*(x+'.jsonl' for x in FILES),'manifest.json','checksums.sha256'},'Export file set mismatch')
    m = parse(payloads['manifest.json'])
    allowed=set('schemaVersion collectionSpecVersion apiContractVersion exportId sourceInstanceId participantId planRevision exportedAt privacyAsOf aiArtifacts privacy sourceCommit dataSource datasetVersion files goalChecksum assignmentChecksum dataSources'.split())
    require(set(m)<=allowed and set(m)>=allowed-{'dataSource'},'Unexpected manifest fields')
    require(m['schemaVersion'] == SCHEMA and m['collectionSpecVersion'] == '2.0' and m['apiContractVersion'] == 2, 'Schema version mismatch')
    require(set(m['files']) == {x + '.jsonl' for x in FILES}, 'Manifest file list mismatch')
    uid(m['exportId']); uid(m['sourceInstanceId']); uid(m['participantId']); integer(m['planRevision'])
    require(m['datasetVersion'] == 'raw-' + m['exportId'], 'Dataset version mismatch')
    files = {}
    for name, fields in FILES.items():
        file = name + '.jsonl'; data = payloads[file]
        rows = [parse(line) for line in data.splitlines()]
        require(m['files'][file] == dict(sha256=digest(data), rows=len(rows)), 'Manifest checksum/count mismatch')
        for row in rows:
            require(set(row) == set(fields.split()) | {'datasetVersion'} and row['datasetVersion'] == m['datasetVersion'], 'Unexpected record fields')
            del row['datasetVersion']
        files[name] = rows
    for name, field in [('goals', 'goalChecksum'), ('assignments', 'assignmentChecksum')]:
        require(m[field] == digest(b''.join(encoded(row) for row in files[name])), 'Plan checksum mismatch')
    validate(m, files, synthetic)
    return m, files, digest(payloads['manifest.json'])


def unique(rows, key):
    result = {}
    for row in rows:
        require(row[key] not in result, 'Duplicate ' + key)
        result[row[key]] = row
    return result


def validate(m, f, synthetic):
    goals = unique(f['goals'], 'goalId'); assignments = unique(f['assignments'], 'plannedSessionId')
    require(set(goals) == {'GOAL-%03d' % i for i in range(1,21)} and set(assignments) == {'PLAN-%03d' % i for i in range(1,161)}, '20 goals / 160 assignments required')
    require(Counter(a['slotId'] for a in assignments.values()) == dict(A=54, B=53, C=53), '54/53/53 assignment mismatch')
    combinations = set()
    for a in assignments.values():
        require(a['goalId'] in goals and a['scenarioType'] in SCENARIOS and type(a['repetition']) is int and a['repetition'] in (1, 2), 'Invalid assignment')
        combinations.add((a['goalId'], a['scenarioType'], a['repetition']))
    require(len(combinations) == 160, 'Scenario/repetition distribution mismatch')
    require(len(f['participants']) == 1 and f['participants'][0]['participantId'] == m['participantId'], 'Participant binding mismatch')
    slot = f['participants'][0]['slotId']
    sessions = unique(f['sessions'], 'sessionId'); visits = unique(f['visits'], 'visitId'); attempts = unique(f['collection_attempts'], 'attemptId')
    consents = unique(f['consent_references'], 'consentId'); qualities = unique(f['raw_quality'], 'attemptId')
    behaviors = unique(f['behaviors'], 'visitId')
    unique(f['collection_failures'], 'failureId'); unique(f['privacy_events'], 'retractionId')
    require(set(behaviors) == set(visits) and set(qualities) == set(attempts), 'Missing behavior/quality references')
    seen_sessions = set(); sources = set()
    for a in attempts.values():
        uid(a['attemptId']); uid(a['sessionId'])
        require(a['sessionId'] in sessions and a['sessionId'] not in seen_sessions and a['participantId'] == m['participantId'], 'Attempt owner/session FK')
        seen_sessions.add(a['sessionId'])
        require(a['plannedSessionId'] in assignments and assignments[a['plannedSessionId']]['slotId'] == slot, 'Assignment ownership mismatch')
        require(a['reviewStatus'] in {'PENDING', 'FAILED', 'RECOLLECT_REQUIRED'}, 'Invalid review status')
        s = sessions[a['sessionId']]; plan = assignments[a['plannedSessionId']]
        require(s['participantId'] == a['participantId'] and s['plannedSessionId'] == a['plannedSessionId'] and s['goalId'] == plan['goalId'] and s['scenario'] == plan['scenarioType'] and s['source'] == a['source'], 'Session/assignment references mismatch')
        require(s['collectionSpecVersion'] == '2.0' and s['status'] in {'ACTIVE', 'ENDED'} and s['privacyStatus'] in {'CLEAR', 'QUARANTINED'}, 'Invalid session state')
        integer(s['privacyRevision']); instant(s['startedAt']); instant(a['createdAt'])
        if s['status'] == 'ENDED':
            require(s['endedAt'] and instant(s['endedAt']) >= instant(s['startedAt']), 'Invalid session end')
        require(s['consentRecordId'] in consents and consents[s['consentRecordId']]['participantId'] == m['participantId'], 'Consent FK')
        c = consents[s['consentRecordId']]
        require(c['policyStatus'] in ({'SYNTHETIC'} if a['source'] == 'SYNTHETIC' else {'APPROVED', 'RETIRED'}), 'Consent source mismatch')
        if a['source'] == 'PARTICIPANT':
            require(c['approvalRef'] and c['retentionPolicyRef'], 'Approved consent references required')
        require(goals[s['goalId']]['status'] == 'CONFIRMED', 'Executed goal is not confirmed')
        q = qualities[a['attemptId']]
        require(q['sessionId'] == a['sessionId'] and q['participantId'] == a['participantId'] and q['plannedSessionId'] == a['plannedSessionId'] and q['source'] == a['source'], 'Quality FK')
        require(set(q['quality']) == set('validVisits expectedWindows validWindows analysisSuccess analysisFailure referencesValid reasons'.split()), 'Unexpected analysis quality fields')
        require(set(q['rawQuality']) == set('validVisits theoreticalWindows referencesValid reasons'.split()), 'Unexpected raw quality fields')
        for field in ['validVisits','expectedWindows','validWindows','analysisSuccess','analysisFailure']:
            integer(q['quality'][field])
        for field in ['validVisits','theoreticalWindows']:
            integer(q['rawQuality'][field])
        integer(q['analysisWindowCount'])
        require(type(q['deliveryConfirmed']) is bool and type(q['rawQuality']['referencesValid']) is bool and type(q['quality']['referencesValid']) is bool, 'Invalid quality boolean')
        for reasons in [q['rawQuality']['reasons'], q['quality']['reasons']]:
            require(isinstance(reasons,list) and all(isinstance(x,str) and x in {'VISITS_BELOW_10','VISIT_REFERENCE_INVALID','VISIT_WINDOW_REFERENCE_INVALID','WINDOW_COUNT_MISMATCH','ANALYSIS_OR_STATE_INCOMPLETE'} for x in reasons), 'Unexpected quality reason')
        require(q['rawStatus'] in {'RAW_COLLECTED','IN_PROGRESS','QUARANTINED','RECOLLECT_REQUIRED','FAILED'} and q['analysisState'] in {'NOT_RUN','COMPLETED','INCOMPLETE'}, 'Invalid quality state')
        sources.add(a['source'])
    require(seen_sessions == set(sessions), 'Orphan session')
    require(sources <= {'SYNTHETIC', 'PARTICIPANT'} and len(sources) <= 1 and len(m['dataSources'])==1 and set(m['dataSources'])<={'SYNTHETIC','PARTICIPANT'} and sources<=set(m['dataSources']), 'Source separation failed')
    if synthetic:
        require(m['dataSources']==['SYNTHETIC'] and sources <= {'SYNTHETIC'}, 'SYNTHETIC switch cannot read real data')
    sequences = defaultdict(set)
    for v in visits.values():
        uid(v['visitId']); require(v['sessionId'] in sessions, 'Visit session FK')
        s = sessions[v['sessionId']]
        require(s['status'] == 'ENDED' and s['privacyStatus'] == 'CLEAR', 'Payload from active/quarantined session')
        integer(v['sequence'], 1); integer(v['activeDurationMs'], 5000); integer(v['tabSwitchCount']); integer(v['behaviorVersion'])
        require(v['sequence'] not in sequences[v['sessionId']], 'Duplicate sequence')
        sequences[v['sessionId']].add(v['sequence'])
        require(type(v['isSearchResultPage']) is bool, 'Invalid search flag')
        require(v['extractionStatus'] == 'SUCCESS' and isinstance(v['title'], str) and v['title'].strip() and len(v['title'])<=500 and isinstance(v['content'], str) and (1 if v['isSearchResultPage'] else 50)<=len(v['content'])<=5000, 'Invalid extraction')
        require(isinstance(v['browserTabKey'],str) and 0<len(v['browserTabKey'])<=100, 'Invalid browser tab key')
        u=urllib.parse.urlsplit(v['normalizedUrl'])
        require(u.scheme in {'http','https'} and u.hostname==v['domain'] and not(u.username or u.password or u.query or u.fragment) and u.path.startswith('/'), 'Invalid normalized URL/domain')
        require(isinstance(v['searchQuery'],str) and 0<len(v['searchQuery'].strip())<=500 if v['isSearchResultPage'] else v['searchQuery'] is None, 'Invalid search query')
        validate_visit_privacy(v)
        instant(v['visitedAt'])
        b = behaviors[v['visitId']]
        require(all(b[k] == v[k] for k in ['sessionId', 'activeDurationMs', 'tabSwitchCount', 'behaviorVersion']), 'Behavior FK/counter mismatch')
    for row in f['collection_failures']:
        uid(row['failureId']); require(row['attemptId'] in attempts and row['reasonCode'] in {'EXTRACTION_FAILED','EXTRACTION_NO_CONTENT','EXTRACTION_DOM_ERROR','EXTRACTION_RENDER_TIMEOUT','EXTRACTION_ACCESS_DENIED', 'SHORT_DURATION', 'POLICY'}, 'Failure FK/code')
        instant(row['observedAt'])
    for row in f['privacy_events']:
        uid(row['retractionId']); require(row['sessionId'] in sessions, 'Privacy FK')


def read_privacy(path, expected):
    raw = Path(path).read_bytes()
    require(digest(raw) == expected, 'Privacy authority checksum mismatch')
    return validate_privacy(parse(raw))


def validate_privacy(p):
    require(set(p)==set('sourceInstanceId participantId observedAt withdrawn validConsentId sessions tombstones'.split()), 'Unexpected privacy fields')
    uid(p['sourceInstanceId']); uid(p['participantId'])
    if p['validConsentId']:uid(p['validConsentId'])
    for s in p['sessions']:
        require(set(s)-{'authorizedByConsentId'}==set('sessionId consentId privacyStatus privacyRevision'.split()), 'Unexpected privacy session fields')
        if 'authorizedByConsentId' in s:
            uid(s['authorizedByConsentId'])
            require(s['authorizedByConsentId'] == p['validConsentId'], 'Historical consent authority mismatch')
        uid(s['sessionId']);uid(s['consentId']);integer(s['privacyRevision'])
        require(s['privacyStatus'] in {'CLEAR','QUARANTINED'}, 'Invalid privacy status')
    for t in p['tombstones']:
        require(set(t)=={'visitId','sessionId'}, 'Unexpected tombstone fields');uid(t['visitId']);uid(t['sessionId'])
    require(type(p['withdrawn']) is bool, 'Privacy withdrawn must be boolean')
    now = datetime.now(timezone.utc)
    require(now - timedelta(minutes=15) <= instant(p['observedAt']) <= now + timedelta(seconds=5), 'Fresh authenticated privacy snapshot required (15 min maximum age)')
    unique(p['sessions'], 'sessionId')
    return p


def merge(inputs, privacy, registry, output, identity=None, recipient=None, synthetic=False, bundle_hashes=None):
    require(not Path(output).exists(), 'New output file required')
    require(synthetic or bundle_hashes is not None, 'Trusted exporter ciphertext digests required')
    if bundle_hashes is not None:
        require(len(bundle_hashes)==len(inputs),'One trusted ciphertext digest per input required')
        for file,h in zip(inputs,bundle_hashes):require(digest(Path(file).read_bytes())==h,'Trusted bundle checksum mismatch')
    bundles = sorted([load_bundle(x, identity, synthetic) for x in inputs],key=lambda item:(instant(item[0]['exportedAt']),item[0]['exportId']))
    require(bundles, 'At least one bundle required')
    require(len({(m['planRevision'], m['goalChecksum'], m['assignmentChecksum']) for m, _, _ in bundles}) == 1, 'Plan revision/checksum mismatch')
    require(len({tuple(m['dataSources']) for m, _, _ in bundles}) == 1, 'REAL/SYNTHETIC mixing forbidden')
    require(recipient or synthetic, 'Encrypted output recipient required')
    require(not recipient or str(output).endswith('.age'),'Encrypted output must use .age suffix')
    current = {(p['sourceInstanceId'], p['participantId']): validate_privacy(p) for p in privacy}
    require(len(current) == len(privacy), 'Duplicate privacy authority')
    require(set(current) == {(m['sourceInstanceId'], m['participantId']) for m, _, _ in bundles}, 'Every source needs current trusted privacy state')
    registry = Path(registry)
    require(not registry.is_symlink(), 'Registry symlink forbidden')
    new = not registry.exists()
    if new:
        private_write(registry, b'')
    db = sqlite3.connect(registry, isolation_level=None)
    db.executescript('''CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, owner TEXT, slot TEXT, observed TEXT);
      CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, source TEXT, hash TEXT, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS denied(source TEXT, session TEXT, PRIMARY KEY(source,session));
      CREATE TABLE IF NOT EXISTS withdrawn(source TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, path TEXT, manifest_hash TEXT);''')
    duplicate = 0; excluded = set(); included = {}; all_files = {k: {} for k in FILES}; mappings = {}
    try:
        db.execute('BEGIN IMMEDIATE')
        plan = encoded([bundles[0][0][k] for k in ['planRevision','goalChecksum','assignmentChecksum','dataSources']]).decode()
        prior = db.execute("SELECT value FROM meta WHERE key='plan'").fetchone()
        require(not prior or prior[0] == plan, 'Registry plan/source mismatch')
        db.execute('INSERT OR IGNORE INTO meta VALUES(?,?)', ('plan',plan))
        owners = {}; slots = {}
        for m, f, mh in bundles:
            source, owner = m['sourceInstanceId'], m['participantId']; slot = f['participants'][0]['slotId']; p = current[(source, owner)]
            require(instant(p['observedAt'])>=instant(m['privacyAsOf']), 'Privacy snapshot predates export')
            require(owner not in owners or owners[owner] == source, 'Participant bound to multiple sources')
            require(slot not in slots or slots[slot] == source, 'Slot bound to multiple sources')
            owners[owner] = source; slots[slot] = source
            old = db.execute('SELECT owner,slot,observed FROM sources WHERE id=?', (source,)).fetchone()
            if old:
                require(old[:2] == (owner, slot) and instant(p['observedAt']) >= instant(old[2]), 'Source collision or privacy rollback')
            # A slot/owner cannot silently move to a different PC across partial imports.
            require(not db.execute('SELECT id FROM sources WHERE (owner=? OR slot=?) AND id<>?', (owner, slot, source)).fetchone(), 'Source identity collision')
            db.execute('INSERT OR REPLACE INTO sources VALUES(?,?,?,?)', (source, owner, slot, p['observedAt']))
            if p['withdrawn']:
                db.execute('INSERT OR IGNORE INTO withdrawn VALUES(?)', (source,))
            for s in p['sessions']:
                if s['privacyStatus'] != 'CLEAR':
                    db.execute('INSERT OR IGNORE INTO denied VALUES(?,?)', (source, s['sessionId']))
            for t in p['tombstones']:
                db.execute('INSERT OR IGNORE INTO denied VALUES(?,?)', (source, t['sessionId']))
        # Privacy exclusions survive a later data conflict. They must never roll back with a failed import.
        db.execute('COMMIT')
        db.execute('BEGIN IMMEDIATE')
        for m, f, mh in bundles:
            source, owner = m['sourceInstanceId'], m['participantId']; p = current[(source, owner)]
            old = db.execute('SELECT hash FROM exports WHERE id=?', (m['exportId'],)).fetchone()
            if old:
                require(old[0] == mh, 'Export ID reused with different data'); duplicate += 1
            db.execute('INSERT OR IGNORE INTO exports VALUES(?,?)', (m['exportId'], mh))
            ps = {s['sessionId']: s for s in p['sessions']}
            for s in f['sessions']:
                uid(s['sessionId']); latest = ps.get(s['sessionId'])
                allowed = latest and not p['withdrawn'] and latest['privacyStatus'] == 'CLEAR' and latest['consentId'] == s['consentRecordId'] and latest.get('authorizedByConsentId',latest['consentId']) == p['validConsentId'] and latest['privacyRevision'] == s['privacyRevision']
                allowed = allowed and not db.execute('SELECT 1 FROM withdrawn WHERE source=?', (source,)).fetchone() and not db.execute('SELECT 1 FROM denied WHERE source=? AND session=?', (source, s['sessionId'])).fetchone()
                if not allowed:
                    excluded.add((source, s['sessionId']))
            # Immutable IDs must not change content or cross a source. Metadata with expected lifecycle changes is checked separately.
            closed=[s for s in f['sessions'] if s['status']=='ENDED']
            for s in closed:
                if (source,s['sessionId']) in excluded:continue
                h=digest(encoded([s['startedAt'],s['endedAt']]))
                old=db.execute('SELECT source,hash FROM records WHERE kind=? AND id=?',('session_end',s['sessionId'])).fetchone()
                require(not old or old==(source,h),'ID collision: closed session')
                db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?,?)',('session_end',s['sessionId'],source,h))
            for kind, key, immutable in [('sessions', 'sessionId', ['participantId','goalId','scenario','startedAt','collectionSpecVersion','consentRecordId','source','plannedSessionId']), ('visits','visitId',None), ('collection_attempts','attemptId',['plannedSessionId','participantId','sessionId','source','createdAt'])]:
                for row in f[kind]:
                    sid = row.get('sessionId')
                    if (source, sid) in excluded:
                        continue
                    h = digest(encoded({k: row[k] for k in immutable} if immutable else row))
                    old = db.execute('SELECT source,hash FROM records WHERE kind=? AND id=?', (kind, row[key])).fetchone()
                    require(not old or old == (source, h), 'ID collision: ' + kind)
                    db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?,?)', (kind, row[key], source, h))
            for kind, rows in f.items():
                key = {'goals':'goalId','assignments':'plannedSessionId','participants':'participantId','sessions':'sessionId','visits':'visitId','behaviors':'visitId','collection_attempts':'attemptId','collection_failures':'failureId','consent_references':'consentId','privacy_events':'retractionId','raw_quality':'attemptId'}[kind]
                for row in rows:
                    k = (source, row[key])
                    previous = all_files[kind].get(k)
                    if previous and previous != row:
                        require(kind in {'sessions','raw_quality','collection_attempts','consent_references'}, 'Record collision: ' + kind)
                    all_files[kind][k] = row
        # Recompute raw completion; a supplied quality flag is never trusted on its own.
        by_session = defaultdict(list)
        for (src, _), v in all_files['visits'].items():
            by_session[(src, v['sessionId'])].append(v)
        latest_attempts = {}
        for (src, aid), a in all_files['collection_attempts'].items():
            k = (src, a['plannedSessionId'])
            if k not in latest_attempts or (instant(a['createdAt']), aid) > (instant(latest_attempts[k]['createdAt']), latest_attempts[k]['attemptId']):
                latest_attempts[k] = a
        for (src, _), a in latest_attempts.items():
            sk = (src, a['sessionId']); s = all_files['sessions'][sk]; visits = by_session[sk]
            consent = all_files['consent_references'][(src, s['consentRecordId'])]
            valid = sk not in excluded and s['status'] == 'ENDED' and s['privacyStatus'] == 'CLEAR' and a['reviewStatus'] == 'PENDING' and consent['withdrawnAt'] is None and len(visits) >= 10 and a['deliveredVisitCount'] == len(visits) and a['deliveredThroughSequence'] == max(v['sequence'] for v in visits)
            if valid:
                require(a['plannedSessionId'] not in included, 'Duplicate completed PLAN across sources')
                included[a['plannedSessionId']] = (src, s)
        selected = {(src, s['sessionId']) for src, s in included.values()}
        selected_attempts = {(src, a['attemptId']) for (src, _), a in all_files['collection_attempts'].items() if (src, a['sessionId']) in selected}
        version = 'merged-' + str(uuid.uuid4()); out_files = {}
        for kind, rows in all_files.items():
            result = []
            for (src, rid), row in sorted(rows.items()):
                if kind in {'sessions','visits','behaviors','raw_quality','privacy_events'} and ((src, row['sessionId']) in excluded or kind in {'visits','behaviors'} and (src,row['sessionId']) not in selected):
                    continue
                if kind == 'consent_references' and not any(s['consentRecordId'] == rid and source == src and (source,s['sessionId']) not in excluded for (source,_), s in all_files['sessions'].items()):
                    continue
                if kind == 'collection_failures' and (src, all_files['collection_attempts'][(src,row['attemptId'])]['sessionId']) in excluded:
                    continue
                if kind == 'collection_attempts' and (src, rid) not in selected_attempts:
                    # Retain metadata-only failed/recollection history, never withdrawn payloads.
                    if (src, row['sessionId']) in excluded:
                        continue
                integrated = str(uuid.uuid5(uuid.NAMESPACE_URL, src + ':' + kind + ':' + rid))
                mappings[(src, kind, rid)] = dict(sourceInstanceId=src, entity=kind, originalId=rid, integratedId=integrated)
                result.append(dict(row, sourceInstanceId=src, integratedId=integrated, datasetVersion=version, **({'collectionStatus':'COMPLETE' if (src,rid) in selected else 'INCOMPLETE'} if kind=='sessions' else {})))
            out_files[kind + '.jsonl'] = b''.join(encoded(r) for r in result)
        out_files['id_map.jsonl'] = b''.join(encoded(r) for _, r in sorted(mappings.items()))
        count = sum(len(by_session[s]) for s in selected)
        report = dict(schemaVersion='focus-raw-dataset/1', datasetVersion=version, generatedAt=datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
                      planRevision=bundles[0][0]['planRevision'], goalChecksum=bundles[0][0]['goalChecksum'], assignmentChecksum=bundles[0][0]['assignmentChecksum'],
                      sourceExports=[dict(exportId=m['exportId'], manifestSha256=h, sourceInstanceId=m['sourceInstanceId']) for m, _, h in bundles],
                      privacySnapshots=[dict(sourceInstanceId=p['sourceInstanceId'], participantId=p['participantId'], observedAt=p['observedAt'], sha256=digest(encoded(p))) for p in privacy],
                      dataSources=bundles[0][0]['dataSources'], planned=160, rawCompleted=len(included), validVisits=count,
                      theoreticalWindows=sum(max(0,len(by_session[s])-2) for s in selected),
                      actualGeneratedWindows=sum(all_files['raw_quality'][(src, a['attemptId'])]['analysisWindowCount'] for (src, _), a in latest_attempts.items() if (src,a['sessionId']) in selected),
                      aiAnalysisCompletedWindows=sum(all_files['raw_quality'][(src, a['attemptId'])]['quality']['analysisSuccess'] for (src, _), a in latest_attempts.items() if (src,a['sessionId']) in selected),
                      aiArtifacts='NOT_INCLUDED', duplicateImports=duplicate, privacyExcluded=len(excluded), status='COMPLETE' if len(included)==160 else 'PARTIAL',
                      participants=dict(Counter(all_files['participants'][(src,s['participantId'])]['slotId'] for src,s in included.values())),
                      scenarios=dict(Counter(s['scenario'] for _,s in included.values())), goals=dict(Counter(s['goalId'] for _,s in included.values())),
                      files={k:dict(sha256=digest(v),rows=len(v.splitlines())) for k,v in out_files.items()})
        out_files['manifest.json'] = encoded(report)
        out_files['checksums.sha256'] = ''.join(digest(v) + '  ' + k + '\n' for k,v in sorted(out_files.items())).encode()
        output_bytes = io.BytesIO()
        with tarfile.open(fileobj=output_bytes, mode='w') as tar:
            for name, data in sorted(out_files.items()):
                info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600;tar.addfile(info,io.BytesIO(data))
        data = age(output_bytes.getvalue(),recipient=recipient) if recipient else output_bytes.getvalue()
        # Reserve the new file and fully fsync before recording publication. Failure never publishes a success manifest.
        target=Path(output); staging=target.with_name(target.name+'.partial-'+uuid.uuid4().hex)
        private_write(staging,data)
        published=False
        try:
            # Hard link is an atomic no-clobber publication on both NTFS and POSIX.
            db.execute('INSERT INTO runs VALUES(?,?,?)',(version,str(target.resolve()),digest(out_files['manifest.json'])))
            db.execute('COMMIT')
            os.link(staging,target)
            published=True
        except BaseException:
            if published:
                target.unlink()
            raise
        finally:
            staging.unlink(missing_ok=True)
        return report
    except BaseException:
        if db.in_transaction:
            db.execute('ROLLBACK')
        raise
    finally:
        db.close()


def verify_artifact(path, identity=None, synthetic=False):
    payloads=read_payloads(path,identity,synthetic)
    m=parse(payloads['manifest.json'])
    if m['schemaVersion']=='focus-training-review/1':
        require(set(payloads)=={'manifest.json','checksums.sha256','review.jsonl'},'Review file set mismatch')
        rows=[parse(line) for line in payloads['review.jsonl'].splitlines()]
        require(digest(payloads['review.jsonl'])==m['rawSha256'],'Review text hash mismatch')
        require(m['labelStatus']=='UNLABELLED' and m['privacyReview']=='REQUIRED' and m['splitCounts']==dict(Counter(r['split'] for r in rows)),'Review labels/split mismatch')
        validate_review_records(rows)
        require(m['sessions']==len(rows) and m['visits']==sum(len(r['visits']) for r in rows)
            and m['windows']==sum(len(r['windows']) for r in rows),'Review record count mismatch')
        return m,dict(result='PASS',sessions=m['sessions'],visits=m['visits'],windows=m['windows'],labelStatus='UNLABELLED',privacyReview='REQUIRED')
    if m['schemaVersion']==SCHEMA:
        m,f,h=load_bundle(path,identity,synthetic)
        return m,dict(result='PASS',exportId=m['exportId'],manifestSha256=h,sessions=len(f['sessions']),visits=len(f['visits']),source=m['dataSources'])
    require(m['schemaVersion']=='focus-raw-dataset/1','Unknown dataset schema')
    expected={*(x+'.jsonl' for x in FILES),'id_map.jsonl'}
    require(set(m['files'])==expected and set(payloads)==expected|{'manifest.json','checksums.sha256'},'Dataset file set mismatch')
    tables={}
    for name in expected:
        raw=payloads[name];rows=[parse(line) for line in raw.splitlines()]
        require(m['files'][name]==dict(sha256=digest(raw),rows=len(rows)),'Dataset count/hash mismatch')
        tables[name[:-6]]=rows
        if name!='id_map.jsonl':
            require(all(r['datasetVersion']==m['datasetVersion'] for r in rows),'Dataset version mismatch')
    def index(name,key):
        rows=tables[name];result={(r['sourceInstanceId'],r[key]):r for r in rows}
        require(len(result)==len(rows),'Duplicate dataset key');return result
    sessions=index('sessions','sessionId');visits=index('visits','visitId');attempts=index('collection_attempts','attemptId');consents=index('consent_references','consentId')
    assignments=index('assignments','plannedSessionId');participants=index('participants','participantId');goals=index('goals','goalId')
    counts=Counter()
    for (source,_),v in visits.items():
        key=(source,v['sessionId']);require(key in sessions and sessions[key]['collectionStatus']=='COMPLETE','Dataset visit FK/completion')
        counts[key]+=1
    for key,s in sessions.items():
        source=key[0]
        require((source,s['consentRecordId']) in consents and (source,s['plannedSessionId']) in assignments and (source,s['participantId']) in participants and (source,s['goalId']) in goals,'Dataset session FK')
        require(s['privacyStatus']=='CLEAR','Quarantined dataset session')
        if s['collectionStatus']=='COMPLETE':require(counts[key]>=10,'Dataset session below 10 visits')
    for (source,_),a in attempts.items():require((source,a['sessionId']) in sessions,'Dataset attempt FK')
    for name in ['behaviors','raw_quality','collection_failures']:
        for r in tables[name]:
            key=(r['sourceInstanceId'],r['visitId'] if name=='behaviors' else r['attemptId'])
            require(key in (visits if name=='behaviors' else attempts),'Dataset child FK')
    require(sum(s['collectionStatus']=='COMPLETE' for s in sessions.values())==m['rawCompleted'] and len(visits)==m['validVisits'],'Dataset completion count mismatch')
    require(sum(max(0,n-2) for n in counts.values())==m['theoreticalWindows'],'Dataset theoretical window count mismatch')
    require(m['status']==('COMPLETE' if m['rawCompleted']==160 else 'PARTIAL'),'Dataset completion status mismatch')
    return m,dict(result='PASS',datasetVersion=m['datasetVersion'],rawCompleted=m['rawCompleted'],validVisits=m['validVisits'],theoreticalWindows=m['theoreticalWindows'],status=m['status'])


def training_review(bundle, expected, privacy, output, identity, recipient):
    """Only a verified merged Import plus fresh authority snapshots can become review data."""
    require(digest(Path(bundle).read_bytes()) == expected, 'Trusted ciphertext SHA required')
    manifest, _ = verify_artifact(bundle, identity)
    require(manifest['schemaVersion'] == 'focus-raw-dataset/1', 'Merged Import required')
    require(recipient and str(output).endswith('.age'), 'Encrypted review output required')
    payloads = read_payloads(bundle, identity)
    tables = {name: [parse(line) for line in payloads[name+'.jsonl'].splitlines()] for name in FILES}
    current = {(p['sourceInstanceId'], p['participantId']): validate_privacy(p) for p in privacy}
    require(len(current) == len(privacy), 'Duplicate privacy authority')
    expected_owners = {(s['sourceInstanceId'],s['participantId']) for s in tables['sessions']}
    require(expected_owners <= set(current), 'Fresh privacy for every source required')
    prior = {(p['sourceInstanceId'],p['participantId']): p for p in manifest['privacySnapshots']}
    allowed = set()
    for s in tables['sessions']:
        key=(s['sourceInstanceId'],s['participantId']); p=current[key]
        require(instant(p['observedAt']) >= instant(prior[key]['observedAt']), 'Privacy rollback')
        authority=next((r for r in p['sessions'] if r['sessionId']==s['sessionId']),None)
        if (not p['withdrawn'] and authority and p['validConsentId']==authority.get('authorizedByConsentId',authority['consentId'])
            and authority['consentId']==s['consentRecordId'] and authority['privacyStatus']=='CLEAR'
            and authority['privacyRevision']==s['privacyRevision']
            and not any(t['sessionId']==s['sessionId'] for t in p['tombstones'])):
            allowed.add((s['sourceInstanceId'],s['sessionId']))
    tables['sessions']=[s for s in tables['sessions'] if (s['sourceInstanceId'],s['sessionId']) in allowed]
    tables['visits']=[v for v in tables['visits'] if (v['sourceInstanceId'],v['sessionId']) in allowed]
    # Historical metadata remains importable; it must not block new text sessions after upgrade.
    by_session=defaultdict(list)
    for v in tables['visits']:by_session[(v['sourceInstanceId'],v['sessionId'])].append(v)
    legacy={key for key,visits in by_session.items() if visits and all(
        v['content']=='METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.'
        and (v['title']=='Public browsing metadata' or v['title'].startswith('Topic: ')) for v in visits)}
    tables['sessions']=[s for s in tables['sessions'] if (s['sourceInstanceId'],s['sessionId']) not in legacy]
    tables['visits']=[v for v in tables['visits'] if (v['sourceInstanceId'],v['sessionId']) not in legacy]
    records=review_records(tables)
    raw=b''.join(encoded(r) for r in records)
    report=dict(schemaVersion='focus-training-review/1',sessions=len(records),visits=sum(len(r['visits']) for r in records),
        windows=sum(len(r['windows']) for r in records),sourceDatasetVersion=manifest['datasetVersion'],
        rawSha256=digest(raw),labelStatus='UNLABELLED',privacyReview='REQUIRED',
        splitUnit='goalId',splitCounts=dict(Counter(r['split'] for r in records)),
        extractionFailures=sum(f['reasonCode'].startswith('EXTRACTION_') for f in tables['collection_failures']),
        dataSources=manifest['dataSources'],legacyMetadataSessionsExcluded=len(legacy),privacySessionsExcluded=len(payloads['sessions.jsonl'].splitlines())-len(allowed))
    memory=io.BytesIO()
    review_files={'review.jsonl':raw,'manifest.json':encoded(report)}
    review_files['checksums.sha256']=''.join(digest(data)+'  '+name+'\n' for name,data in sorted(review_files.items())).encode()
    with tarfile.open(fileobj=memory,mode='w') as tar:
        for name,data in sorted(review_files.items()):
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600;tar.addfile(info,io.BytesIO(data))
    publish(Path(output),age(memory.getvalue(),recipient=recipient))
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    for name in ['export','privacy']:
        q=sub.add_parser(name);q.add_argument('--server',required=True);q.add_argument('--credential-file',required=True);q.add_argument('--ca-file');q.add_argument('--synthetic-loopback',action='store_true');q.add_argument('--participant');q.add_argument('--output',required=True,type=Path)
        if name=='export':q.add_argument('--recipient');q.add_argument('--synthetic-plaintext',action='store_true')
    q=sub.add_parser('verify');q.add_argument('--sha256');q.add_argument('bundle');q.add_argument('--identity');q.add_argument('--synthetic-plaintext',action='store_true')
    q=sub.add_parser('inspect');q.add_argument('bundle');q.add_argument('--identity');q.add_argument('--synthetic-plaintext',action='store_true')
    q=sub.add_parser('merge');q.add_argument('bundles',nargs='+');q.add_argument('--bundle-sha256',action='append',help='Trusted exporter ciphertext SHA-256, same order as bundles');q.add_argument('--privacy',action='append',nargs=2,metavar=('FILE','TRUSTED_SHA256'),required=True);q.add_argument('--registry',required=True);q.add_argument('--output',required=True);q.add_argument('--identity');q.add_argument('--recipient');q.add_argument('--synthetic-plaintext',action='store_true')
    q=sub.add_parser('training-review');q.add_argument('bundle');q.add_argument('--sha256',required=True);q.add_argument('--identity',required=True);q.add_argument('--recipient',required=True);q.add_argument('--privacy',action='append',nargs=2,required=True);q.add_argument('--output',required=True)
    a=p.parse_args();os.umask(0o077)
    if a.command=='training-review':
        print(json.dumps(training_review(a.bundle,a.sha256,[read_privacy(file,h) for file,h in a.privacy],a.output,a.identity,a.recipient)))
    elif a.command in {'export','privacy'}:
        require(not a.output.exists(),'New output required')
        if a.participant:uid(a.participant)
        if a.command=='privacy':
            route='/api/collection/admin/export-privacy/'+a.participant if a.participant else '/api/collection/export-privacy'
            value=request(a.server,a.credential_file,route,a.ca_file,a.synthetic_loopback)
            data=encoded(value);publish(a.output,data);print(json.dumps(dict(privacySaved=str(a.output),sha256=digest(data),observedAt=value['observedAt'])))
        else:
            require(a.recipient or a.synthetic_plaintext,'age --recipient required for real exports')
            route='/api/collection/admin/exports/'+a.participant if a.participant else '/api/collection/exports'
            value=request(a.server,a.credential_file,route,a.ca_file,a.synthetic_loopback,'POST')
            commit=value['manifest'].get('sourceCommit','NOT_RECORDED')
            data=pack(value,commit)
            if a.synthetic_plaintext:
                require(value['manifest'].get('dataSource')=='SYNTHETIC' and all(s['source']=='SYNTHETIC' for s in value['files']['sessions']),'Plaintext real export prohibited')
            else:
                require(a.output.name.endswith('.age'),'Use .tar.age output suffix');data=age(data,recipient=a.recipient)
            publish(a.output,data);print(json.dumps(dict(exportId=value['manifest']['exportId'],output=str(a.output),sha256=digest(data),encrypted=not a.synthetic_plaintext)))
    elif a.command in {'verify','inspect'}:
        if a.command=='verify' and a.sha256:require(digest(Path(a.bundle).read_bytes())==a.sha256,'Trusted ciphertext digest mismatch')
        m,result=verify_artifact(a.bundle,a.identity,a.synthetic_plaintext)
        print(json.dumps(m if a.command=='inspect' else result,ensure_ascii=False,indent=2))
    else:
        report=merge(a.bundles,[read_privacy(file,h) for file,h in a.privacy],a.registry,a.output,a.identity,a.recipient,a.synthetic_plaintext,a.bundle_sha256)
        print(json.dumps({k:v for k,v in report.items() if k not in {'files','sourceExports','privacySnapshots'}},ensure_ascii=False,indent=2))


if __name__=='__main__':
    try:
        main()
    except (ValueError,KeyError,TypeError,OSError,sqlite3.Error,tarfile.TarError,subprocess.SubprocessError):
        print('Export/import blocked: schema, checksums, current privacy, ownership, plan, IDs, references, keys or output path invalid. No successful dataset published.',file=sys.stderr)
        raise SystemExit(2)
