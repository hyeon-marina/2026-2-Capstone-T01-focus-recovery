package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.AuthenticationService;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** OS-owned offline entry point, never an enrollment HTTP API or an operator role. */
@Component
@Profile("individual-local")
@ConditionalOnProperty(name="focus-recovery.collection.local-request")
public class LocalCollectionSetup implements ApplicationRunner {
    private final JdbcTemplate jdbc; private final TransactionTemplate tx; private final Environment env;
    private final JsonMapper mapper; private final LocalCollectionPolicy policies; private final CollectionSitePolicy sites;
    private final ConfigurableApplicationContext context;
    public LocalCollectionSetup(JdbcTemplate jdbc,org.springframework.transaction.PlatformTransactionManager manager,Environment env,JsonMapper mapper,LocalCollectionPolicy policies,CollectionSitePolicy sites,ConfigurableApplicationContext context) {
        this.jdbc=jdbc;this.tx=new TransactionTemplate(manager);this.env=env;this.mapper=mapper;this.policies=policies;this.sites=sites;this.context=context;
    }
    public record Request(String slot,String ownerSecretFile,String credentialFile,boolean rotate,String policyFile,String policyChecksum) {}
    static void owned(Path path) throws Exception {
        if(Files.isSymbolicLink(path) || !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)) throw new IllegalStateException("Protected regular file required");
        var user=path.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByName(System.getProperty("user.name"));
        if(!Files.getOwner(path).equals(user)) throw new IllegalStateException("Same OS owner required");
        if(Files.getFileStore(path).supportsFileAttributeView("posix")) {
            if(Files.getPosixFilePermissions(path).stream().anyMatch(p->p.name().startsWith("GROUP_") || p.name().startsWith("OTHERS_"))) throw new IllegalStateException("Owner-only file required");
        } else {
            var acl=Files.getFileAttributeView(path,AclFileAttributeView.class);
            if(acl==null || acl.getAcl().stream().anyMatch(e->e.type()==AclEntryType.ALLOW && !e.principal().equals(user))) throw new IllegalStateException("Owner-only ACL required");
        }
    }
    @Override public void run(ApplicationArguments args) throws Exception {
        if(!Arrays.equals(env.getActiveProfiles(),new String[]{"individual-local"}) || !"none".equals(env.getProperty("spring.main.web-application-type")) || context instanceof org.springframework.web.context.WebApplicationContext
            || !env.getRequiredProperty("spring.datasource.url").matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus_collection\\?serverTimezone=UTC")
            || !"focus_collection".equals(env.getProperty("spring.datasource.username")) || !"127.0.0.1".equals(env.getProperty("server.address")) || !env.getProperty("server.ssl.enabled",Boolean.class,false)) throw new IllegalStateException("Exact offline local MySQL/HTTPS boundary required");
        Path requestFile=Path.of(env.getRequiredProperty("focus-recovery.collection.local-request"));owned(requestFile);
        var input=mapper.readValue(Files.readString(requestFile),Request.class);
        if(!Set.of("A","B","C").contains(input.slot())) throw new IllegalArgumentException("Slot A/B/C required");
        Path keyFile=Path.of(input.ownerSecretFile()).toAbsolutePath().normalize();
        Path outputPath=Path.of(input.credentialFile()).toAbsolutePath().normalize();
        Path home=requestFile.toAbsolutePath().normalize().getParent();
        if(!keyFile.getParent().equals(home) || !outputPath.getParent().equals(home) || Files.isSymbolicLink(home))throw new IllegalStateException("Same private local directory required");
        owned(keyFile);String key=Files.readString(keyFile).strip();
        if(!key.matches("[A-Za-z0-9_-]{64}"))throw new IllegalArgumentException("Local owner key required");
        String hash=AuthenticationService.digest(key);Path output=outputPath;
        byte[] policyBytes=input.policyFile()==null?null:Files.readAllBytes(Path.of(input.policyFile()));
        String digest=policyBytes==null?null:HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(policyBytes));
        if(policyBytes!=null && (policyBytes.length>65536 || !digest.equals(input.policyChecksum())))throw new IllegalArgumentException("LOCAL_POLICY_CHECKSUM: 팀이 별도 전달한 SHA-256과 일치하지 않습니다.");
        var policy=policyBytes==null?null:mapper.readTree(policyBytes);
        var plan=policy==null?null:policies.validate(policy,Instant.now());
        if(policy!=null)sites.validateLocalSites(policy);
        // Reserve before transaction. Lost file/response is recovered by explicit atomic rotation.
        if(!Files.exists(output))CollectionOperatorBootstrap.createPrivateFile(output);else owned(output);
        tx.executeWithoutResult(status->{
            jdbc.queryForList("SELECT guard_id FROM collection_bootstrap_guard WHERE guard_id=1 FOR UPDATE");
            var owners=jdbc.queryForList("SELECT * FROM collection_local_owner WHERE owner_key=1 FOR UPDATE");
            String id;
            if(owners.isEmpty()) {
                for(String table:List.of("participant","work_session","collection_plan","collection_operator","collection_source_instance","consent_policy","collection_release","collection_goal","collection_assignment"))
                    if(jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)!=0)throw new IllegalStateException("LOCAL_DATABASE_NOT_EMPTY: 기존 DB를 인수하지 않습니다. 별도 신규 디렉터리/DB를 사용하세요.");
                id=UUID.randomUUID().toString();
                jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",id,hash,Timestamp.from(Instant.now()));
                jdbc.update("INSERT INTO collection_local_owner(owner_key,participant_id,slot_id,owner_secret_hash) VALUES(1,?,?,?)",id,input.slot(),hash);
                jdbc.update("INSERT INTO collection_source_instance VALUES(1,?)",UUID.randomUUID().toString());
                jdbc.update("INSERT INTO collection_plan VALUES(1,0)");var draft=CollectionPlanService.draft();
                for(var s:draft.slots())jdbc.update("INSERT INTO collection_slot VALUES(?,?)",s.slotId(),s.slotId().equals(input.slot())?id:null);
                for(var g:draft.goals())jdbc.update("INSERT INTO collection_goal(goal_id,status) VALUES(?,'DRAFT')",g.goalId());
                for(var a:draft.assignments())jdbc.update("INSERT INTO collection_assignment VALUES(?,?,?,?,?)",a.plannedSessionId(),a.goalId(),a.scenarioType(),a.repetition(),a.slotId());
            } else {
                var owner=owners.getFirst();id=(String)owner.get("participant_id");
                if(!hash.equals(owner.get("owner_secret_hash")) || !input.slot().equals(owner.get("slot_id")))throw new IllegalStateException("LOCAL_OWNER_MISMATCH: 슬롯·OS 소유자 키 변경이 차단되었습니다.");
            }
            if(jdbc.queryForObject("SELECT COUNT(*) FROM participant WHERE participant_id=? AND status='ACTIVE'",Integer.class,id)!=1)throw new IllegalStateException("LOCAL_OWNER_INACTIVE: 비활성 참여자를 재활성화하지 않습니다.");
            if(policy!=null) {
                if(jdbc.queryForObject("SELECT COUNT(*) FROM participant WHERE participant_id=? AND withdrawn_at IS NOT NULL",Integer.class,id)>0) {
                    if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_local_owner WHERE participant_id=? AND policy_digest=?",Integer.class,id,digest)!=1)throw new IllegalStateException("PRIVACY_WITHDRAWN: 정책 재적용으로 철회를 해제하지 않습니다.");
                } else install(id,policy,plan,digest);
            }
            String existing="";
            try { existing=mapper.readTree(Files.readString(output)).path("credential").asText(); } catch(Exception ignored) { }
            boolean valid=jdbc.queryForObject("SELECT COUNT(*) FROM access_credential WHERE participant_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?",Integer.class,id,AuthenticationService.digest(existing),Timestamp.from(Instant.now()))==1;
            if(input.rotate() || !valid) {
                byte[] random=new byte[32];new java.security.SecureRandom().nextBytes(random);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(random);
                Instant expires=Instant.now().plus(Duration.ofHours(24));
                jdbc.update("UPDATE access_credential SET revoked_at=? WHERE participant_id=? AND revoked_at IS NULL",Timestamp.from(Instant.now()),id);
                jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",AuthenticationService.digest(token),id,Timestamp.from(expires));
                try { Files.writeString(output,mapper.writeValueAsString(Map.of("participantId",id,"credentialId",AuthenticationService.digest(token),"credential",token,"expiresAt",expires.toString(),"slot",input.slot())),StandardOpenOption.TRUNCATE_EXISTING); }
                catch(Exception e) { throw new IllegalStateException("Credential write failed; retry setup",e); }
                audit(id,"LOCAL_ISSUE",AuthenticationService.digest(token));
            }
        });
        System.out.println("Local owner ready; credential saved privately. Consent is never automatic. "+(policy==null?"BLOCKED: apply confirmed common policy and goals.":"Policy applied; rebuild extension, review and consent."));
        SpringApplication.exit(context);
    }
    private void audit(String id,String action,String ref) {
        jdbc.update("INSERT INTO collection_audit VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),id,action,id,ref,Timestamp.from(Instant.now()));
    }
    private void install(String id,tools.jackson.databind.JsonNode n,CollectionPlanService.Plan p,String digest) {
        var old=jdbc.queryForList("SELECT policy_digest FROM collection_local_owner WHERE owner_key=1",String.class).getFirst();
        if(!digest.equals(old) && jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE status='ACTIVE' AND privacy_status='CLEAR'",Integer.class)>0)throw new IllegalStateException("ACTIVE_SESSION_POLICY_CHANGE: 정책 변경 전에 진행 중인 세션의 종료 또는 격리 마감을 확인하세요.");
        var previous=jdbc.queryForList("SELECT plan_checksum FROM collection_local_owner WHERE owner_key=1",String.class).getFirst();
        String checksum=policies.checksum(p);
        if(previous!=null && !previous.equals(checksum) && jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt",Integer.class)>0)throw new IllegalStateException("PLAN_HAS_ACTUALS: 실행 이력의 공통 Plan은 변경하지 않습니다.");
        long revision=jdbc.queryForObject("SELECT revision FROM collection_plan WHERE plan_id=1",Long.class);
        if(p.revision()<revision || p.revision()==revision && !checksum.equals(previous))throw new IllegalStateException("PLAN_REVISION_CONFLICT");
        for(var g:p.goals())jdbc.update("UPDATE collection_goal SET description=?,status=?,evidence_ref=? WHERE goal_id=?",g.description(),g.status(),g.evidenceRef(),g.goalId());
        jdbc.update("UPDATE collection_plan SET revision=? WHERE plan_id=1",p.revision());
        String policyId=n.path("policyId").asText(),version=n.path("policyVersion").asText();
        if(!digest.equals(old) && jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id=? AND policy_version=?",Integer.class,policyId,version)>0)throw new IllegalStateException("POLICY_VERSION_CONFLICT: 변경 정책은 새 버전·재동의가 필요합니다.");
        if(!digest.equals(old)) {
            var previousDates=jdbc.queryForList("SELECT effective_at FROM consent_policy WHERE scope='SESSION_COLLECTION' ORDER BY effective_at DESC LIMIT 1",Timestamp.class);
            if(!previousDates.isEmpty() && !Instant.parse(n.path("notBefore").asText()).isAfter(previousDates.getFirst().toInstant()))throw new IllegalStateException("POLICY_EFFECTIVE_CONFLICT: 새 정책 적용 시점은 이전 정책 이후여야 합니다.");
            jdbc.update("UPDATE consent_policy SET status='RETIRED' WHERE scope='SESSION_COLLECTION'");
            jdbc.update("INSERT INTO consent_policy VALUES(?,?,'SESSION_COLLECTION',?,?,?,?,?,'APPROVED',?)",policyId,version,n.path("purpose").asText(),n.path("collectionItems").asText(),n.path("useScope").asText(),LocalCollectionPolicy.operationalRef(n)+":retention",LocalCollectionPolicy.operationalRef(n),Timestamp.from(Instant.parse(n.path("notBefore").asText())));
            jdbc.update("UPDATE collection_release SET revoked_at=? WHERE revoked_at IS NULL",Timestamp.from(Instant.now()));
            jdbc.update("INSERT INTO collection_release VALUES(?,?,?,?,NULL)",digest,n.path("buildId").asText(),LocalCollectionPolicy.operationalRef(n),Timestamp.from(Instant.now()));
        }
        jdbc.update("UPDATE collection_local_owner SET policy_digest=?,plan_checksum=? WHERE owner_key=1",digest,checksum);
        audit(id,"LOCAL_APPLY_POLICY",digest);
    }
}
