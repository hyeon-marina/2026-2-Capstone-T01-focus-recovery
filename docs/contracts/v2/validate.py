#!/usr/bin/env python3
"""Validate PROPOSED wire contracts and synthetic reference-model fixtures, not products.

Run: python docs/contracts/v2/validate.py (jsonschema[format]==4.26.0).
No HTTP, DB, browser, inference, or production imports. Assertion failures exit nonzero.
"""
import hashlib
import itertools
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / 'v2.schema.json').read_text())
CHECKER = FormatChecker()
BEHAVIOR = ('activeDurationMs', 'tabSwitchCount', 'behaviorVersion')


def validator(name):
    return Draft202012Validator({
        '$schema': SCHEMA['$schema'], '$defs': SCHEMA['$defs'],
        '$ref': '#/$defs/' + name,
    }, format_checker=CHECKER)


def check(name, value):
    validator(name).validate(value)


def fingerprint(value):
    # Contract fingerprint inputs contain integers/strings/bools/null, never floats.
    body = {k: v for k, v in value.items() if k != 'inputFingerprint'}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode('utf-8')).hexdigest()


def error(code):
    return {'error': code}


def patch(data):
    old, request = data['old'], data['request']
    check('BehaviorPatch', old)
    check('BehaviorPatch', request)
    if request['behaviorVersion'] < old['behaviorVersion']:
        return {'applied': False, 'crossed': False}
    if request['behaviorVersion'] == old['behaviorVersion']:
        return ({'applied': False, 'crossed': False} if request == old
                else error('BEHAVIOR_VERSION_CONFLICT'))
    if any(request[k] < old[k] for k in BEHAVIOR[:2]):
        return error('BEHAVIOR_COUNTER_DECREASED')
    return {'applied': True, 'crossed': old['activeDurationMs'] < 300000 <= request['activeDurationMs']}


def compose(data):
    request = data['request']
    check('CompositionRequest', request)
    assert request['inputFingerprint'] == fingerprint(request)
    seq = [v['sequence'] for v in request['visits']]
    ids = [v['visitId'] for v in request['visits']]
    after = request['afterSequence']
    if seq != sorted(set(seq)) or len(ids) != len(set(ids)) or not any(s > after for s in seq):
        return error('INVALID_REQUEST')
    context = [s for s in seq if s <= after]
    if context != data['previousTail'] or seq != data['persistedPrefix']:
        return error('COMPOSE_INPUT_MISMATCH')
    windows = [seq[i:i + 3] for i in range(len(seq) - 2) if seq[i + 2] > after]
    return {'through': seq[-1], 'windows': windows}


def rule(labels, durations):
    assert len(labels) == len(durations) == 3
    assert all(l in ('DIRECT', 'JUSTIFIED_DETOUR', 'UNRELATED') for l in labels)
    assert all(type(d) is int and d >= 5000 for d in durations)
    if labels[-1] != 'UNRELATED':
        return 'NORMAL'
    suffix = []
    for label, duration in zip(reversed(labels), reversed(durations)):
        if label != 'UNRELATED':
            break
        suffix.append(duration)
    if len(suffix) == 3 or any(d >= 300000 for d in suffix):
        return 'DRIFT'
    return 'TRANSITION' if len(suffix) == 2 else 'NORMAL'


def replay(data):
    old, new = data['original'], data['request']
    if data['type'] == 'post':
        check('PageVisitPost', old)
        check('PageVisitPost', new)
        old = {k: v for k, v in old.items() if k not in BEHAVIOR}
        new = {k: v for k, v in new.items() if k not in BEHAVIOR}
    elif data['type'] == 'privacy':
        check('PrivacyRetraction', old)
        check('PrivacyRetraction', new)
    if old == new:
        return 'REPLAY'
    return error({'post': 'VISIT_ID_CONFLICT', 'composition': 'COMPOSE_ID_CONFLICT',
                  'analysis': 'ANALYSIS_ID_CONFLICT', 'privacy': 'RETRACTION_ID_CONFLICT'}[data['type']])


def analysis_pair(data):
    req, res = data['request'], data['response']
    check('AnalysisRequest', req)
    check('AnalysisResponse', res)
    if analysis_input(req) != 'ACCEPT':
        return error('INVALID_REQUEST')
    assert req['inputFingerprint'] == fingerprint(req)
    if any(req[k] != res[k] for k in ('analysisId', 'sessionId', 'windowId', 'inputFingerprint')):
        return error('AI_INVALID_RESPONSE')
    expected = [(v['position'], v['visitId']) for v in req['visits']]
    actual = [(v['position'], v['visitId']) for v in res['pageResults']]
    return 'ACCEPT' if expected == actual and [v[0] for v in expected] == [1, 2, 3] else error('AI_INVALID_RESPONSE')


def visit_relations(data):
    check('PageVisitPost', data)
    url = urlsplit(data['normalizedUrl'])
    host = url.hostname or ''
    if ':' in host:
        host = '[' + host + ']'
    expected_authority = host + (':' + str(url.port) if url.port else '')
    valid = (url.netloc == expected_authority and host == data['domain']
             and not url.username and not url.password and not url.query and not url.fragment
             and (url.scheme, url.port) not in (('http', 80), ('https', 443))
             and len(data['normalizedUrl'].encode('utf-16-le')) // 2 <= 8192
             and bool(data['content'].strip()))
    return 'ACCEPT' if valid else error('INVALID_REQUEST')


def analysis_input(data):
    check('AnalysisRequest', data)
    visits = data['visits']
    seq = [v['sequence'] for v in visits]
    valid = ([v['position'] for v in visits] == [1, 2, 3]
             and seq == sorted(set(seq)) and len({v['visitId'] for v in visits}) == 3
             and data['inputFingerprint'] == fingerprint(data))
    return 'ACCEPT' if valid else error('INVALID_REQUEST')


def compose_pair(data):
    req, res = data['request'], data['response']
    check('CompositionRequest', req)
    check('CompositionResponse', res)
    visits = req['visits']
    seq = [v['sequence'] for v in visits]
    if (seq != sorted(set(seq)) or len({v['visitId'] for v in visits}) != len(visits)
            or not any(s > req['afterSequence'] for s in seq)):
        return error('INVALID_REQUEST')
    expected = [{'visitIds': [v['visitId'] for v in visits[i:i + 3]],
                 'endVisitId': visits[i + 2]['visitId']}
                for i in range(len(visits) - 2)
                if visits[i + 2]['sequence'] > req['afterSequence']]
    valid = (all(req[k] == res[k] for k in ('composeRequestId', 'sessionId', 'afterSequence', 'inputFingerprint'))
             and req['inputFingerprint'] == fingerprint(req)
             and res['composedThroughSequence'] == visits[-1]['sequence']
             and res['windows'] == expected)
    return 'ACCEPT' if valid else error('AI_INVALID_RESPONSE')


def alert_policy(data):
    current = (data['status'] == 'COMPLETED' and data['state'] == 'DRIFT'
               and data['sessionActive'] and data['isLatest'] and data['sameVersion'])
    flow_ok = (not data['hasShown'] or (data['recoveredLaterWindow']
               and data['recoveryStatus'] == 'COMPLETED'
               and data['elapsedMs'] >= data['configuredMinIntervalMs']))
    return current and flow_ok


def flow(data):
    # One behavior record represents the final page; shared-visit fanout is an integration check.
    windows = {w['index']: {**w, 'phase': 'RUNNING', 'history': [], 'seen': set()}
               for w in data['windows']}
    ended = False

    def judge(w):
        if w['phase'] != 'COMPLETED':
            return
        key = tuple(w['behavior'][k] for k in BEHAVIOR)
        if key not in w['seen']:
            w['seen'].add(key)
            w['history'].append(rule(w['labels'], [5000, 5000, w['behavior']['activeDurationMs']]))

    for event in data['events']:
        if event['kind'] == 'end':
            ended = True
            continue
        w = windows[event['index']]
        if event['kind'] == 'result' and w['phase'] == 'RUNNING':
            w['phase'] = 'COMPLETED'
            judge(w)
        elif event['kind'] == 'fail' and w['phase'] == 'RUNNING':
            w['phase'] = 'FAILED'
        elif event['kind'] == 'retract':
            w['phase'] = 'INVALIDATED'
        elif event['kind'] == 'behavior' and not ended and w['phase'] != 'INVALIDATED':
            outcome = patch({'old': w['behavior'], 'request': event['request']})
            if outcome.get('applied'):
                w['behavior'] = event['request']
                judge(w)
    latest = windows[max(windows)]
    state = latest['history'][-1] if latest['phase'] == 'COMPLETED' and latest['history'] else None
    return {'currentIndex': max(windows), 'currentState': state,
            'versions': {str(i): w['history'] for i, w in windows.items()},
            'alertEligible': not ended and state == 'DRIFT'}


def manifest(data):
    check('Manifest', data)
    goals = list(itertools.chain.from_iterable(data['splitByGoal'].values()))
    return 'ACCEPT' if len(goals) == len(set(goals)) else error('SPLIT_OVERLAP')


def sequence_commit(data):
    # A failed IDB transaction publishes neither sequence nor POST; visitedAt is independent.
    next_sequence, assigned = data['nextSequence'], {}
    for event in data['events']:
        if (event['visitId'] not in assigned and event['activeDurationMs'] >= 5000
                and event['contentValid'] and event['privacyValid'] and event['commit']):
            assigned[event['visitId']] = next_sequence
            next_sequence += 1
    return {'assigned': assigned, 'nextSequence': next_sequence}


def composition_commit(data):
    # Job receipt survives append/crash; privacy validity is separate from receive watermark.
    if data['quarantined'] or data['jobPrivacyRevision'] != data['privacyRevision']:
        return error('PRIVACY_RETRACTED')
    if data['receiptExists']:
        return 'REPLAY_RECEIPT'
    if data['cursor'] != data['afterSequence']:
        return error('COMPOSE_CURSOR_CONFLICT')
    if data['persistedPrefix'] != data['jobPrefix']:
        return error('COMPOSE_INPUT_MISMATCH')
    return {'cursor': data['jobPrefix'][-1], 'queuedThrough': data['lastAcceptedSequence']}


def state_history(data):
    candidate = data['candidate']
    check('WindowState', candidate)
    history = data['history']
    for saved in history:
        check('WindowState', saved)
    ids = data['windowVisitIds']
    if ([b['visitId'] for b in candidate['behaviorSnapshot']] != ids
            or len(set(ids)) != 3 or candidate['analysisId'] != data['analysisId']):
        return error('INVALID_REQUEST')
    source = {k: candidate[k] for k in ('analysisId', 'ruleVersion', 'behaviorSnapshot')}
    if (candidate['inputFingerprint'] != fingerprint(source)
            or candidate['finalState'] != rule(data['labels'],
                [b['activeDurationMs'] for b in candidate['behaviorSnapshot']])):
        return error('INVALID_REQUEST')
    # A retry can recover its old receipt, but it must not become the latest pointer again.
    for saved in history:
        if saved['windowId'] != candidate['windowId']:
            return error('INVALID_REQUEST')
        if saved['inputFingerprint'] == candidate['inputFingerprint']:
            return {'created': False, 'stateVersion': saved['stateVersion']}
    if candidate['behaviorSnapshot'] != data['currentBehavior']:
        return error('STALE_INPUT')
    if candidate['stateVersion'] != max((s['stateVersion'] for s in history), default=0) + 1:
        return error('STATE_VERSION_CONFLICT')
    return {'created': True, 'stateVersion': candidate['stateVersion']}


def affected_windows(data):
    # PATCH selects all existing memberships; it never constructs a new Window.
    return [w['windowId'] for w in data['windows'] if data['visitId'] in w['visitIds']]


def privacy_flow(data):
    # Synthetic inventory of named copies only. No deletion or model unlearning is executed.
    copies = set(data['copies'])
    tombstone, status, blocked = False, None, []
    for event in data['events']:
        kind = event['kind']
        if kind == 'retract':
            tombstone = True
            status = status or 'QUARANTINED'
        elif kind == 'delete':
            assert tombstone
            copies.difference_update(event['copies'])
        elif kind == 'purge':
            assert tombstone
            status = 'PURGED' if not copies and data['evidenceComplete'] else 'QUARANTINED'
        elif kind in ('post', 'result', 'alert', 'export', 'train'):
            if tombstone:
                blocked.append(kind)
            else:
                copies.add({'post': 'visit', 'result': 'analysis', 'alert': 'notification',
                            'export': 'export', 'train': 'model'}[kind])
        else:
            raise AssertionError(kind)
    return {'status': status, 'tombstone': tombstone, 'remaining': sorted(copies), 'blocked': blocked}


def blind_export(data):
    # A small projection oracle; real JSONL/checksums/consent verification remains a product task.
    forbidden = {'ai_predictions', 'finalState', 'pageResults', 'rationale', 'scenario', 'candidateLabel'}

    def leaks(value):
        if isinstance(value, dict):
            return bool(forbidden.intersection(value)) or any(leaks(v) for v in value.values())
        return isinstance(value, list) and any(leaks(v) for v in value)

    return error('LABEL_LEAK') if leaks(data) else 'ACCEPT'


def run_scenario(case):
    x, kind = case['input'], case['kind']
    if kind == 'revisit':
        if not x['sameEpoch'] or x['elapsedMs'] < 0:
            return 'RECOVERY'
        return 'REUSE' if x['sameTab'] and x['sameTarget'] and x['elapsedMs'] < 4000 else 'NEW'
    if kind == 'ingest':
        return 'ACCEPT' if x['sequence'] > x['lastAcceptedSequence'] else error('VISIT_SEQUENCE_OUT_OF_ORDER')
    if kind == 'rule':
        return rule(x['labels'], x['durations'])
    return {'patch': patch, 'compose': compose, 'replay': replay, 'analysis-pair': analysis_pair,
            'flow': flow, 'manifest': manifest, 'visit-relations': visit_relations,
            'analysis-input': analysis_input, 'compose-pair': compose_pair,
            'alert-policy': alert_policy, 'sequence-commit': sequence_commit,
            'composition-commit': composition_commit, 'state-history': state_history,
            'privacy-flow': privacy_flow, 'blind-export': blind_export,
            'affected-windows': affected_windows}[kind](x)


def fleiss(rows):
    assert all(sum(row) == 3 for row in rows)
    if not rows:
        return None
    probs = [sum(row[j] for row in rows) / (3 * len(rows)) for j in range(len(rows[0]))]
    pe = sum(p * p for p in probs)
    if pe == 1:
        return None
    pa = sum((sum(n * n for n in row) - 3) / 6 for row in rows) / len(rows)
    return (pa - pe) / (1 - pe)


def self_checks():
    # Independent closed condition formula for all 27 labels × 8 threshold patterns.
    for labels in itertools.product(('DIRECT', 'JUSTIFIED_DETOUR', 'UNRELATED'), repeat=3):
        for durations in itertools.product((299999, 300000), repeat=3):
            if labels[2] != 'UNRELATED':
                expected = 'NORMAL'
            elif labels[1] != 'UNRELATED':
                expected = 'DRIFT' if durations[2] >= 300000 else 'NORMAL'
            elif labels[0] == 'UNRELATED' or max(durations[1:]) >= 300000:
                expected = 'DRIFT'
            else:
                expected = 'TRANSITION'
            assert rule(labels, durations) == expected
    assert fleiss([]) is None
    assert fleiss([[3, 0, 0, 0]]) is None  # All votes in one category: denominator zero.
    assert fleiss([[3, 0, 0, 0], [0, 3, 0, 0]]) == 1
    assert abs(fleiss([[1, 1, 1, 0], [1, 1, 1, 0]]) + 0.5) < 1e-12
    # Oracle infrastructure detects schema, relational and state rule mutants.
    assert list(validator('BehaviorPatch').iter_errors({'activeDurationMs': True}))
    assert patch({'old': dict(activeDurationMs=300000, tabSwitchCount=0, behaviorVersion=2),
                  'request': dict(activeDurationMs=300000, tabSwitchCount=0, behaviorVersion=2)})['crossed'] is False


def check_markdown():
    docs = ROOT.parents[1]
    paths = [docs / name for name in (
        'v2-contract-decisions.md', 'v2-contract-approval.md', 'data-analysis-contract.md',
        'data-collection-spec.md', 'data-contract-validation.md', 'fe-spec.md',
        'be-spec.md', 'ai-spec.md', 'project-plan.md', 'contracts/v2/README.md')]

    def prose(path):
        lines, fence = [], None
        for line in path.read_text().splitlines():
            marker = re.match(r'^\s*(`{3,}|~{3,})', line)
            if marker:
                token = marker.group(1)
                if fence is None:
                    fence = token
                elif token[0] == fence[0] and len(token) >= len(fence):
                    fence = None
            elif fence is None:
                lines.append(line)
        assert fence is None, (path, 'unclosed code fence')
        return '\n'.join(lines)

    def anchors(path):
        counts, result = {}, set()
        for title in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', prose(path), re.M):
            slug = re.sub(r'[^\w\s-]', '', title.lower()).replace(' ', '-')
            n = counts.get(slug, 0)
            counts[slug] = n + 1
            result.add(slug + (f'-{n}' if n else ''))
        return result

    links = 0
    for path in paths:
        for target in re.findall(r'\[[^\]\n]+\]\(([^)\n]+)\)', prose(path)):
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue  # Remote availability is not a local Markdown check.
            dest = (path.parent / unquote(url.path)).resolve() if url.path else path
            assert dest.exists(), (path, target, 'missing relative file')
            if url.fragment:
                assert unquote(url.fragment) in anchors(dest), (path, target, 'missing anchor')
            links += 1
    print(f'PASS: {len(paths)} Markdown documents, {links} relative links/anchors, code fences')


def main():
    Draft202012Validator.check_schema(SCHEMA)
    for name in SCHEMA['$defs']:
        Draft202012Validator.check_schema({'$defs': SCHEMA['$defs'], '$ref': '#/$defs/' + name})
    cases = json.loads((ROOT / 'fixtures/schema-cases.json').read_text())['cases']
    for case in cases:
        errors = list(validator(case['contract']).iter_errors(case['input']))
        assert (not errors) == case['expected']['valid'], (case['name'], [e.message for e in errors])
        keyword = case['expected'].get('keyword')
        if keyword:
            assert keyword in {e.validator for e in errors}, (case['name'], keyword, [e.validator for e in errors])
    scenarios = json.loads((ROOT / 'fixtures/scenarios.json').read_text())['scenarios']
    for case in scenarios:
        actual = run_scenario(case)
        assert actual == case['expected'], (case['name'], actual, case['expected'])
    self_checks()
    check_markdown()
    print(f'PASS: Draft 2020-12, {len(SCHEMA["$defs"])} definitions, '
          f'{len(cases)} schema cases, {len(scenarios)} reference scenarios, '
          '216 rule combinations, 4 kappa checks')
    print('LIMIT: reference contract checks only; no FE/BE/AI product, DB, Chrome, or model execution.')


if __name__ == '__main__':
    main()
