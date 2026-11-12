"""Unlabelled v2 collection review records. No model execution or scenario-derived labels.

Consumes authenticated Import tables in memory. Kept separate from the legacy five-visit,
labelled training loader. All source fields survive; downstream annotators must review PII.
"""
import hashlib
from collections import defaultdict
from datetime import datetime
from urllib.parse import urlsplit


def review_records(tables):
    def index(name, key):
        rows = tables[name]
        result = {(r['sourceInstanceId'], r[key]): r for r in rows}
        if len(result) != len(rows):
            raise ValueError('Duplicate source record')
        return result
    goals = index('goals', 'goalId')
    visits = index('visits', 'visitId')
    sessions = index('sessions', 'sessionId')
    grouped = defaultdict(list)
    for (source, _), visit in visits.items():
        if (source, visit['sessionId']) not in sessions:
            raise ValueError('Orphan visit')
        grouped[(source, visit['sessionId'])].append(visit)
    attempts = {(r['sourceInstanceId'],r['attemptId']):r for r in tables.get('collection_attempts',[])}
    result = []
    for key, session in sorted(sessions.items()):
        if session['collectionStatus'] != 'COMPLETE':
            continue
        goal = goals[(key[0], session['goalId'])]
        ordered = sorted(grouped[key], key=lambda v: v['sequence'])
        if not ordered or len({v['sequence'] for v in ordered}) != len(ordered):
            raise ValueError('Missing/duplicate ordered visits')
        # Goal grouping keeps repeated sessions and all three participants out of other splits.
        bucket = int(hashlib.sha256(session['goalId'].encode()).hexdigest(), 16) % 10
        split = 'train' if bucket < 8 else 'validation' if bucket == 8 else 'test'
        for v in ordered:
            required=set('visitId sessionId sequence browserTabKey normalizedUrl domain title content searchQuery isSearchResultPage visitedAt extractionStatus activeDurationMs tabSwitchCount behaviorVersion'.split())
            if not required <= v.keys():
                raise ValueError('Missing raw visit fields')
            u=urlsplit(v['normalizedUrl'])
            if (u.scheme not in {'http','https'} or u.hostname != v['domain'] or u.query or u.fragment or u.username or u.password
                or type(v['isSearchResultPage']) is not bool
                or not isinstance(v['title'],str) or len(v['title'])>500
                or any(type(v[k]) is not int or v[k]<minimum for k,minimum in [('sequence',1),('activeDurationMs',5000),('tabSwitchCount',0),('behaviorVersion',0)])
                or (not isinstance(v['searchQuery'],str) or not 1<=len(v['searchQuery'])<=500 if v['isSearchResultPage'] else v['searchQuery'] is not None)):
                raise ValueError('Invalid raw visit fields')
            datetime.fromisoformat(v['visitedAt'].replace('Z','+00:00'))
            if (v['extractionStatus'] != 'SUCCESS' or not isinstance(v['title'], str)
                    or not v['title'].strip() or not isinstance(v['content'], str)
                    or not 1 <= len(v['content']) <= 5000
                    or v['content'].startswith('METADATA_ONLY:')
                    or v['title'].startswith('Topic: ')
                    or v['searchQuery'] == '[NOT_COLLECTED]'):
                raise ValueError('Raw text required; historical metadata is not training text')
        result.append(dict(schemaVersion='focus-training-review/1', sourceInstanceId=key[0],
                           participantId=session['participantId'], sessionId=session['sessionId'],
                           goalId=session['goalId'], goalText=goal['description'],
                           scenarioType=session['scenario'], goal=goal, session=session, visits=ordered,
                           split=split, label=None, labelStatus='UNLABELLED', privacyReview='REQUIRED',
                           attempts=[a for a in attempts.values() if a['sourceInstanceId']==key[0] and a['sessionId']==session['sessionId']],
                           sessionFailures=[f for f in tables.get('collection_failures',[]) if (f['sourceInstanceId'],f['attemptId']) in attempts and attempts[(f['sourceInstanceId'],f['attemptId'])]['sessionId']==session['sessionId'] and f['sourceInstanceId']==key[0]],
                           windows=[dict(windowIndex=i+1, visitIds=[v['visitId'] for v in ordered[i:i+3]],
                                         labels=None) for i in range(max(0, len(ordered)-2))]))
    return result


def validate_review_records(records):
    tables = dict(goals=[], sessions=[], visits=[], collection_attempts=[], collection_failures=[])
    goals = {}
    for r in records:
        key=(r['sourceInstanceId'],r['goalId'])
        if key in goals and goals[key] != r['goal']:
            raise ValueError('Conflicting goal')
        goals[key]=r['goal']
        tables['sessions'].append(r['session'])
        tables['visits'].extend(r['visits'])
        tables['collection_attempts'].extend(r['attempts'])
        tables['collection_failures'].extend(r['sessionFailures'])
    tables['goals']=list(goals.values())
    if review_records(tables) != records:
        raise ValueError('Review schema, ordering, labels or split mismatch')
