"""Unlabelled v2 collection review records. No model execution or scenario-derived labels.

Consumes authenticated Import tables in memory. Kept separate from the legacy five-visit,
labelled training loader. All source fields survive; downstream annotators must review PII.
"""
import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from urllib.parse import urlsplit


sensitive=re.compile(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{6}-[1-4]\d{6}|(?:\+\d{1,3}[- .])?(?:\(\d{2,4}\)[- .]?|\b\d{2,4}[- .])\d{3,4}[- .]\d{4}\b|(?:01[016789]|\+82[- .]?1[016789])[- .]?\d{3,4}[- .]?\d{4}|bearer\s+[a-z0-9._-]+|(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|key|credential)|cookie|passwd|secret)\s*[:=]\s*\S+|\b(?:diagnosis|prescription|patient|bank account)\b|주민등록|계좌번호|진단명|처방전|비밀번호',re.I)
card_candidate=re.compile(r'(?<![0-9])[1-9](?:[\s-]?[0-9]){12,18}(?![0-9])')
labelled_card=re.compile(r'\b(?:credit\s+card(?:\s+(?:number|no\.?))?|card\s+(?:number|no\.?)|pan)\s*[:=]\s*[0-9](?:[\s-]?[0-9]){12,18}(?![0-9])',re.I)
sensitive_query=re.compile(r'\b(?:medical|diagnosis|patient|prescription|symptoms?|treatment|cancer|hiv|aids|depression|banking|finance|loan|credit|insurance|password|cookie|token)\b|의료|진료|환자|질병|증상|치료|처방|우울|암 검사|대출|신용|계좌|금융|주민|비밀번호',re.I)


def sensitive_text(text):
    if sensitive.search(text):
        return True
    normalized=unicodedata.normalize('NFKC',text)
    if labelled_card.search(normalized):
        return True
    for match in card_candidate.finditer(normalized):
        digits=[int(d) for d in re.sub(r'[^0-9]', '', match[0])]
        total=sum((d*2-9 if d>4 else d*2) if i%2 else d for i,d in enumerate(reversed(digits)))
        if total%10==0:
            return True
    return False


def validate_visit_privacy(visit):
    if any(sensitive_text(visit[field] or '') for field in ('title', 'content', 'searchQuery')):
        raise ValueError('Sensitive text requires quarantine')
    if visit['searchQuery'] and sensitive_query.search(visit['searchQuery']):
        raise ValueError('Sensitive search requires quarantine')


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
        if session.get('privacyStatus', 'CLEAR') != 'CLEAR':
            raise ValueError('Quarantined review session')
        if sensitive_text(goal['description']):
            raise ValueError('Sensitive goal requires review')
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
                    or not (1 if v['isSearchResultPage'] else 50) <= len(v['content']) <= 5000
                    or v['content'].startswith('METADATA_ONLY:')
                    or v['title'].startswith('Topic: ')
                    or v['searchQuery'] == '[NOT_COLLECTED]'):
                raise ValueError('Raw text required; historical metadata is not training text')
            validate_visit_privacy(v)
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
