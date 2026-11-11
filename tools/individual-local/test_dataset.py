import copy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import uuid

import dataset as d

ROOT=Path(__file__).resolve().parents[2]


def fixture(slot='A'):
    owner,source,sid,aid,cid=[str(uuid.uuid4()) for _ in range(5)]
    now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    plan=json.loads((ROOT/'docs/data-collection/plan.draft.json').read_text())
    goals=[dict(g,description='Synthetic public transaction research',status='CONFIRMED',evidenceRef='synthetic-only') for g in plan['goals']]
    assignment=next(a for a in plan['assignments'] if a['slotId']==slot)
    session=dict(sessionId=sid,participantId=owner,goalId=assignment['goalId'],scenario=assignment['scenarioType'],startedAt=now,endedAt=now,status='ENDED',collectionSpecVersion='2.0',consentRecordId=cid,privacyStatus='CLEAR',privacyRevision=0,source='SYNTHETIC',plannedSessionId=assignment['plannedSessionId'])
    attempt=dict(attemptId=aid,plannedSessionId=assignment['plannedSessionId'],participantId=owner,sessionId=sid,source='SYNTHETIC',reviewStatus='PENDING',deliveredVisitCount=10,deliveredThroughSequence=20,reasonCode=None,createdAt=now)
    visits=[dict(visitId=str(uuid.uuid4()),sessionId=sid,sequence=i*2,browserTabKey='synthetic-tab',normalizedUrl='https://example.org/public',domain='example.org',title='Synthetic public text',content='Controlled synthetic public text about durable page observations and local storage',searchQuery=None,isSearchResultPage=False,visitedAt=now,extractionStatus='SUCCESS',activeDurationMs=5000,tabSwitchCount=0,behaviorVersion=0) for i in range(1,11)]
    privacy=dict(sourceInstanceId=source,participantId=owner,observedAt=now,withdrawn=False,validConsentId=cid,sessions=[dict(sessionId=sid,consentId=cid,privacyStatus='CLEAR',privacyRevision=0)],tombstones=[])
    quality=dict(attemptId=aid,plannedSessionId=assignment['plannedSessionId'],participantId=owner,sessionId=sid,goalId=assignment['goalId'],scenarioType=assignment['scenarioType'],source='SYNTHETIC',sessionStatus='ENDED',privacyStatus='CLEAR',reviewStatus='PENDING',reasonCode=None,collectedAt=now,quality=dict(validVisits=10,expectedWindows=8,validWindows=0,analysisSuccess=0,analysisFailure=0,referencesValid=True,reasons=['WINDOW_COUNT_MISMATCH','ANALYSIS_OR_STATE_INCOMPLETE']),extractionFailures=0,collectionFailures=0,deliveryConfirmed=True,status='RECOLLECT_REQUIRED',rawQuality=dict(validVisits=10,theoreticalWindows=8,referencesValid=True,reasons=[]),rawStatus='RAW_COLLECTED',analysisState='NOT_RUN',analysisWindowCount=0)
    files=dict(goals=goals,assignments=plan['assignments'],participants=[dict(slotId=slot,participantId=owner)],sessions=[session],visits=visits,behaviors=[{**{k:v[k] for k in ['visitId','sessionId','activeDurationMs','tabSwitchCount','behaviorVersion']},'updatedAt':None} for v in visits],collection_attempts=[attempt],collection_failures=[],consent_references=[dict(consentId=cid,participantId=owner,policyId='SYNTHETIC-101',policyVersion='1',acceptedAt=now,withdrawnAt=None,policyStatus='SYNTHETIC',retentionPolicyRef=None,approvalRef=None)],privacy_events=[],raw_quality=[quality])
    return dict(manifest=dict(schemaVersion=d.SCHEMA,collectionSpecVersion='2.0',apiContractVersion=2,exportId=str(uuid.uuid4()),sourceInstanceId=source,participantId=owner,planRevision=1,exportedAt=now,privacyAsOf=now,aiArtifacts='NOT_INCLUDED',privacy=privacy),files=files)


class DatasetTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.samples=[fixture(s) for s in 'ABC']
        self.paths=[self.save(x,str(i)+'.tar') for i,x in enumerate(self.samples)]
        self.privacy=[s['manifest']['privacy'] for s in self.samples]
        self.registry=self.root/'registry.sqlite'
    def tearDown(self):
        self.temp.cleanup()
    def save(self,snapshot,name):
        path=self.root/name;path.write_bytes(d.pack(snapshot,'synthetic-test-commit'));return path
    def merge(self,paths=None,privacy=None,name='merged.tar'):
        return d.merge(paths or self.paths,self.privacy if privacy is None else privacy,self.registry,self.root/name,synthetic=True)
    def test_three_sources_and_duplicate_import(self):
        r=self.merge();self.assertEqual((r['rawCompleted'],r['validVisits'],r['theoreticalWindows'],r['actualGeneratedWindows'],r['aiAnalysisCompletedWindows']),(3,30,24,0,0))
        self.assertEqual(d.verify_artifact(self.root/'merged.tar',synthetic=True)[1]['rawCompleted'],3)
        self.assertEqual(r['status'],'PARTIAL');self.assertEqual(r['participants'],dict(A=1,B=1,C=1))
        self.assertEqual(self.merge(name='duplicate.tar')['duplicateImports'],3)
    def test_partial(self):
        self.assertEqual(self.merge(self.paths[:1],self.privacy[:1])['rawCompleted'],1)
    def test_full_160_remains_separate_from_analysis(self):
        samples=[]
        for slot,base in zip('ABC',self.samples):
            sample=copy.deepcopy(base);f=sample['files']
            f['sessions']=[];f['visits']=[];f['behaviors']=[];f['collection_attempts']=[];f['raw_quality']=[]
            sample['manifest']['privacy']['sessions']=[]
            for assignment in [a for a in f['assignments'] if a['slotId']==slot]:
                s=copy.deepcopy(base['files']['sessions'][0]);s.update(sessionId=str(uuid.uuid4()),plannedSessionId=assignment['plannedSessionId'],goalId=assignment['goalId'],scenario=assignment['scenarioType'])
                a=copy.deepcopy(base['files']['collection_attempts'][0]);a.update(attemptId=str(uuid.uuid4()),sessionId=s['sessionId'],plannedSessionId=s['plannedSessionId'])
                q=copy.deepcopy(base['files']['raw_quality'][0]);q.update(attemptId=a['attemptId'],sessionId=s['sessionId'],plannedSessionId=s['plannedSessionId'],goalId=s['goalId'],scenarioType=s['scenario'])
                f['sessions'].append(s);f['collection_attempts'].append(a);f['raw_quality'].append(q)
                sample['manifest']['privacy']['sessions'].append(dict(sessionId=s['sessionId'],consentId=s['consentRecordId'],privacyStatus='CLEAR',privacyRevision=0))
                for old in base['files']['visits']:
                    v=copy.deepcopy(old);v.update(visitId=str(uuid.uuid4()),sessionId=s['sessionId']);f['visits'].append(v)
                    f['behaviors'].append(dict(visitId=v['visitId'],sessionId=v['sessionId'],activeDurationMs=v['activeDurationMs'],tabSwitchCount=0,behaviorVersion=0,updatedAt=None))
            samples.append(sample)
        paths=[self.save(s,'full-'+str(i)+'.tar') for i,s in enumerate(samples)]
        r=self.merge(paths,[s['manifest']['privacy'] for s in samples])
        self.assertEqual((r['rawCompleted'],r['validVisits'],r['theoreticalWindows'],r['status']),(160,1600,1280,'COMPLETE'))
        self.assertEqual(r['participants'],dict(A=54,B=53,C=53));self.assertEqual(set(r['scenarios'].values()),{40})
        self.assertEqual((r['actualGeneratedWindows'],r['aiAnalysisCompletedWindows']),(0,0))
        d.verify_artifact(self.root/'merged.tar',synthetic=True)
    def test_recollection_history_keeps_valid_references(self):
        s=copy.deepcopy(self.samples[0]);f=s['files'];oldsession=copy.deepcopy(f['sessions'][0]);oldsession['sessionId']=str(uuid.uuid4());oldsession['startedAt']='2026-01-01T00:00:00.000Z';oldsession['endedAt']='2026-01-01T00:01:00.000Z'
        oldattempt=copy.deepcopy(f['collection_attempts'][0]);oldattempt.update(attemptId=str(uuid.uuid4()),sessionId=oldsession['sessionId'],createdAt='2026-01-01T00:00:00.000Z',reviewStatus='RECOLLECT_REQUIRED')
        oldquality=copy.deepcopy(f['raw_quality'][0]);oldquality.update(attemptId=oldattempt['attemptId'],sessionId=oldsession['sessionId'],reviewStatus='RECOLLECT_REQUIRED',rawStatus='RECOLLECT_REQUIRED')
        f['sessions'].append(oldsession);f['collection_attempts'].append(oldattempt);f['raw_quality'].append(oldquality)
        f['collection_failures'].append(dict(failureId=str(uuid.uuid4()),attemptId=oldattempt['attemptId'],reasonCode='EXTRACTION_FAILED',observedAt='2026-01-01T00:00:00.000Z'))
        s['manifest']['privacy']['sessions'].append(dict(sessionId=oldsession['sessionId'],consentId=oldsession['consentRecordId'],privacyStatus='CLEAR',privacyRevision=0))
        r=self.merge([self.save(s,'retry.tar')],[s['manifest']['privacy']]);self.assertEqual(r['rawCompleted'],1)
        m,_=d.verify_artifact(self.root/'merged.tar',synthetic=True);self.assertEqual(m['files']['collection_attempts.jsonl']['rows'],2);self.assertEqual(m['files']['collection_failures.jsonl']['rows'],1)
    def test_trusted_ciphertext_receipt_required(self):
        with self.assertRaisesRegex(ValueError,'Trusted exporter'):d.merge(self.paths,self.privacy,self.registry,self.root/'untrusted.age')
        with self.assertRaisesRegex(ValueError,'Trusted bundle'):d.merge(self.paths,self.privacy,self.registry,self.root/'wrong.age',bundle_hashes=['0'*64]*3)
    def test_checksum_tampering(self):
        path=self.paths[0];raw=path.read_bytes();path.write_bytes(raw.replace(b'Controlled synthetic public text',b'Tamperedxx synthetic public text',1))
        with self.assertRaisesRegex(ValueError,'Checksum'):self.merge()
        self.assertFalse((self.root/'merged.tar').exists())
    def test_bad_fk_and_sequence_rejected_even_with_recomputed_checksums(self):
        for mutate in [lambda s:s['files']['visits'][0].update(sessionId=str(uuid.uuid4())),lambda s:s['files']['visits'][0].update(sequence=4),lambda s:s['files']['visits'][0].update(activeDurationMs=4999),lambda s:s['files']['visits'][0].update(credential='never-export')]:
            sample=copy.deepcopy(self.samples[0]);mutate(sample);path=self.save(sample,str(uuid.uuid4())+'.tar')
            with self.assertRaises(ValueError):d.load_bundle(path,synthetic=True)
    def test_plan_mismatch(self):
        s=copy.deepcopy(self.samples[0]);s['manifest']['planRevision']=2;path=self.save(s,'revision.tar')
        with self.assertRaisesRegex(ValueError,'Plan revision'):self.merge([path,*self.paths[1:]])
    def test_plan_pinned_across_partial_imports(self):
        self.merge(self.paths[:1],self.privacy[:1]);s=copy.deepcopy(self.samples[1]);s['manifest']['planRevision']=2
        with self.assertRaisesRegex(ValueError,'Registry plan'):self.merge([self.save(s,'new-plan.tar')],self.privacy[1:2],name='new.tar')
    def test_id_content_collision_and_rollback(self):
        self.merge();s=copy.deepcopy(self.samples[0]);s['manifest']['exportId']=str(uuid.uuid4());s['files']['visits'][0]['title']='Different payload'
        with self.assertRaisesRegex(ValueError,'ID collision'):self.merge([self.save(s,'conflict.tar'),*self.paths[1:]],name='conflict-out.tar')
        self.assertFalse((self.root/'conflict-out.tar').exists())
        self.assertEqual(self.merge(name='after-failure.tar')['rawCompleted'],3)
    def test_closed_session_timestamp_collision(self):
        self.merge();s=copy.deepcopy(self.samples[0]);s['manifest']['exportId']=str(uuid.uuid4());s['files']['sessions'][0]['endedAt']='2099-01-01T00:00:00.000Z'
        with self.assertRaisesRegex(ValueError,'closed session'):self.merge([self.save(s,'closed-conflict.tar'),*self.paths[1:]],name='closed-conflict-out.tar')
    def test_export_id_reuse(self):
        self.merge();s=copy.deepcopy(self.samples[0]);s['files']['visits'][0]['title']='Different payload'
        with self.assertRaisesRegex(ValueError,'Export ID reused'):self.merge([self.save(s,'reused.tar'),*self.paths[1:]],name='reused-out.tar')
    def test_cross_source_uuid_collision(self):
        s=copy.deepcopy(self.samples[1]);s['files']['visits'][0]['visitId']=self.samples[0]['files']['visits'][0]['visitId'];s['files']['behaviors'][0]['visitId']=s['files']['visits'][0]['visitId']
        with self.assertRaisesRegex(ValueError,'ID collision'):self.merge([self.paths[0],self.save(s,'same-id.tar'),self.paths[2]])
    def test_withdrawal_and_old_export_reentry(self):
        self.merge();current=copy.deepcopy(self.privacy);current[0]['withdrawn']=True;current[0]['validConsentId']='';current[0]['observedAt']=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
        r=self.merge(privacy=current,name='withdrawn.tar');self.assertEqual((r['rawCompleted'],r['privacyExcluded']),(2,1))
        # Even a later erroneous CLEAR claim cannot undo a known withdrawal in the persistent registry.
        older=copy.deepcopy(self.privacy);older[0]['observedAt']=current[0]['observedAt']
        self.assertEqual(self.merge(privacy=older,name='replay.tar')['rawCompleted'],2)
        with self.assertRaisesRegex(ValueError,'privacy rollback'):self.merge(name='rollback.tar')
    def test_expired_authority_blocks_without_inventing_permanent_withdrawal(self):
        current=copy.deepcopy(self.privacy);current[0]['validConsentId']=''
        self.assertEqual(self.merge(privacy=current)['rawCompleted'],2)
        self.assertEqual(self.merge(name='renewed-authority.tar')['rawCompleted'],3)
    def test_tombstone_excludes_whole_session(self):
        current=copy.deepcopy(self.privacy);current[0]['tombstones']=[dict(visitId=self.samples[0]['files']['visits'][0]['visitId'],sessionId=self.samples[0]['files']['sessions'][0]['sessionId'])]
        self.assertEqual(self.merge(privacy=current)['rawCompleted'],2)
    def test_missing_and_stale_privacy(self):
        with self.assertRaisesRegex(ValueError,'Every source'):self.merge(privacy=[])
        p=copy.deepcopy(self.privacy[0]);p['observedAt']=(datetime.now(timezone.utc)-timedelta(minutes=16)).isoformat().replace('+00:00','Z');file=self.root/'stale.json';file.write_bytes(d.encoded(p))
        with self.assertRaisesRegex(ValueError,'Fresh'):d.read_privacy(file,d.digest(file.read_bytes()))
    def test_plaintext_real_data_and_mixed_sources_forbidden(self):
        s=copy.deepcopy(self.samples[0]);s['files']['sessions'][0]['source']='PARTICIPANT';s['files']['collection_attempts'][0]['source']='PARTICIPANT';s['files']['raw_quality'][0]['source']='PARTICIPANT';s['files']['consent_references'][0].update(policyStatus='APPROVED',approvalRef='fixture',retentionPolicyRef='fixture')
        with self.assertRaisesRegex(ValueError,'SYNTHETIC switch'):d.load_bundle(self.save(s,'real.tar'),synthetic=True)
    def test_empty_real_snapshot_still_requires_encryption(self):
        s=copy.deepcopy(self.samples[0]);s['manifest']['dataSource']='PARTICIPANT'
        for name in ['sessions','visits','behaviors','collection_attempts','raw_quality']:s['files'][name]=[]
        with self.assertRaisesRegex(ValueError,'SYNTHETIC switch'):d.load_bundle(self.save(s,'empty-real.tar'),synthetic=True)
    def test_incomplete_delivery_cannot_be_forged_by_raw_flag(self):
        s=copy.deepcopy(self.samples[0]);s['files']['collection_attempts'][0]['deliveredVisitCount']=9
        r=self.merge([self.save(s,'incomplete.tar'),*self.paths[1:]])
        self.assertEqual(r['rawCompleted'],2)
    def test_existing_output_preserved(self):
        out=self.root/'merged.tar';out.write_bytes(b'keep')
        with self.assertRaises(ValueError):self.merge()
        self.assertEqual(out.read_bytes(),b'keep')
    def test_nested_unknown_fields_rejected(self):
        s=copy.deepcopy(self.samples[0]);s['files']['raw_quality'][0]['quality']['credential']='nope'
        with self.assertRaisesRegex(ValueError,'Unexpected analysis'):d.load_bundle(self.save(s,'nested.tar'),synthetic=True)
    @unittest.skipUnless(shutil.which('age') and shutil.which('age-keygen'),'age CLI not installed')
    def test_real_encryption_roundtrip_and_wrong_key(self):
        import subprocess
        keys=[]
        for n in range(2):
            key=self.root/('key'+str(n));subprocess.run(['age-keygen','-o',str(key)],check=True,capture_output=True);keys.append(key)
        recipient=subprocess.run(['age-keygen','-y',str(keys[0])],capture_output=True,text=True,check=True).stdout.strip()
        encrypted=self.root/'a.tar.age';encrypted.write_bytes(d.age(self.paths[0].read_bytes(),recipient=recipient))
        self.assertEqual(len(d.load_bundle(encrypted,keys[0])[1]['visits']),10)
        with self.assertRaises(ValueError):d.load_bundle(encrypted,keys[1])


if __name__=='__main__':unittest.main()
