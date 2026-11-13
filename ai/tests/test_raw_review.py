"""No model/runtime imports needed for collection review conversion."""
import copy
import json
from pathlib import Path
import pytest
from training.raw_review import review_records
from training.raw_review import validate_visit_privacy


def tables():
    return dict(goals=[dict(sourceInstanceId='source',goalId='G1',description='Public Python task')],
        sessions=[dict(sourceInstanceId='source',sessionId='session',participantId='p',goalId='G1',scenario='JUSTIFIED_DETOUR',collectionStatus='COMPLETE')],
        visits=[dict(sourceInstanceId='source',sessionId='session',visitId=str(i),sequence=i*2,title='Python tutorial',content='한a🙂'*1600,searchQuery=None,extractionStatus='SUCCESS',activeDurationMs=5000,tabSwitchCount=1,behaviorVersion=0,browserTabKey='tab',normalizedUrl='https://docs.python.org/3/',domain='docs.python.org',isSearchResultPage=False,visitedAt='2026-11-12T00:00:00.000Z') for i in range(1,5)])


def test_lossless_ordered_unlabelled_v2_review():
    t=tables();r=review_records(t)[0]
    assert r['visits']==t['visits'] and r['goalText']=='Public Python task'
    assert r['windows']==[dict(windowIndex=1,visitIds=['1','2','3'],labels=None),dict(windowIndex=2,visitIds=['2','3','4'],labels=None)]
    assert r['label'] is None and r['labelStatus']=='UNLABELLED' and r['privacyReview']=='REQUIRED'
    other=copy.deepcopy(t['sessions'][0]);other['sessionId']='other';t['sessions'].append(other)
    t['visits'] += [dict(v,visitId=v['visitId']+'other',sessionId='other') for v in list(t['visits'])]
    assert len({r['split'] for r in review_records(t)})==1


@pytest.mark.parametrize('field,value',[('title','reporter@example.org'),('title','Bearer synthetic-only'),('content','METADATA_ONLY: x'),('extractionStatus','EXTRACTION_FAILED'),('content','a'*5001),('searchQuery','[NOT_COLLECTED]')])
def test_metadata_or_failed_text_is_never_training_success(field,value):
    t=tables();t['visits'][0][field]=value
    with pytest.raises(ValueError):review_records(t)


def test_public_card_explanation_is_not_a_disclosed_value():
    v=tables()['visits'][0]
    v['content']='You should not enter a credit card on untrusted pages.'
    validate_visit_privacy(v)


@pytest.mark.parametrize('value', ['4111111111111111', '4111-1111-1111-1111',
    '４１１１１１１１１１１１１１１１', 'credit card: 4111111111111112', 'PAN: 4111111111111112'])
def test_payment_values_are_blocked(value):
    v=tables()['visits'][0];v['content']=value
    with pytest.raises(ValueError, match='Sensitive text'):validate_visit_privacy(v)


@pytest.mark.parametrize('case', json.loads((Path(__file__).resolve().parents[2]/'docs/contracts/v2/fixtures/privacy-text.json').read_text()), ids=lambda c:c['id'])
def test_fe_be_ai_privacy_parity(case):
    v=tables()['visits'][0];v['content']=case['text']
    if case['public']:
        validate_visit_privacy(v)
    else:
        with pytest.raises(ValueError, match='Sensitive text'):validate_visit_privacy(v)
