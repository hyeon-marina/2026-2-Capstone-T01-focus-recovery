"""No model/runtime imports needed for collection review conversion."""
import copy
import pytest
from training.raw_review import review_records


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


@pytest.mark.parametrize('field,value',[('content','METADATA_ONLY: x'),('extractionStatus','EXTRACTION_FAILED'),('content','a'*5001),('searchQuery','[NOT_COLLECTED]')])
def test_metadata_or_failed_text_is_never_training_success(field,value):
    t=tables();t['visits'][0][field]=value
    with pytest.raises(ValueError):review_records(t)
