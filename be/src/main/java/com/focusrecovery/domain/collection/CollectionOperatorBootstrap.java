package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.AuthenticationService;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Offline DBA/OS trust boundary. Never invoked by HTTP and never installs a default administrator. */
@Component
@ConditionalOnProperty(name="focus-recovery.collection.bootstrap-request")
public class CollectionOperatorBootstrap implements ApplicationRunner {
    private final JdbcTemplate jdbc;private final TransactionTemplate tx;private final Environment env;private final JsonMapper mapper;private final ConfigurableApplicationContext context;
    public CollectionOperatorBootstrap(JdbcTemplate jdbc,org.springframework.transaction.PlatformTransactionManager manager,Environment env,JsonMapper mapper,ConfigurableApplicationContext context){this.jdbc=jdbc;this.tx=new TransactionTemplate(manager);this.env=env;this.mapper=mapper;this.context=context;}
    public record Request(String identityReferenceHash,String authorityRef,String credentialFile) {}
    static void createPrivateFile(Path output) throws java.io.IOException {
        if(FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.createFile(output,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        } else if(FileSystems.getDefault().supportedFileAttributeViews().contains("acl")) {
            var owner=FileSystems.getDefault().getUserPrincipalLookupService().lookupPrincipalByName(System.getProperty("user.name"));
            var entry=java.nio.file.attribute.AclEntry.newBuilder().setType(java.nio.file.attribute.AclEntryType.ALLOW).setPrincipal(owner).setPermissions(java.util.EnumSet.allOf(java.nio.file.attribute.AclEntryPermission.class)).build();
            Files.createFile(output,new java.nio.file.attribute.FileAttribute<java.util.List<java.nio.file.attribute.AclEntry>>() {
                public String name(){return "acl:acl";}
                public java.util.List<java.nio.file.attribute.AclEntry> value(){return java.util.List.of(entry);}
            });
        } else throw new IllegalStateException("Owner-only POSIX permissions or Windows ACL required");
    }
    @Override public void run(ApplicationArguments arguments) throws Exception {
        if(context instanceof org.springframework.web.context.WebApplicationContext || !"none".equals(env.getProperty("spring.main.web-application-type"))) throw new IllegalStateException("Offline non-web process required");
        var input=mapper.readValue(Files.readString(Path.of(env.getRequiredProperty("focus-recovery.collection.bootstrap-request"))),Request.class);
        if(input.identityReferenceHash()==null || !input.identityReferenceHash().matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Trusted enrollment reference hash required");
        CollectionAdministration.reference(input.authorityRef());
        Path output=Path.of(input.credentialFile()).toAbsolutePath();

        // Reserve an owner-only file before committing; a failed DB transaction leaves no valid credential.
        createPrivateFile(output);
        byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),hash=AuthenticationService.digest(token);
        String id=UUID.randomUUID().toString();Instant now=Instant.now();
        tx.executeWithoutResult(status->{
            jdbc.queryForList("SELECT guard_id FROM collection_bootstrap_guard WHERE guard_id=1 FOR UPDATE");
            if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_operator WHERE revoked_at IS NULL",Integer.class)!=0)throw new IllegalStateException("An operator already exists; use the established administrator process");
            jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",id,input.identityReferenceHash(),Timestamp.from(now));
            jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",hash,id,Timestamp.from(now.plusSeconds(3600)));
            jdbc.update("INSERT INTO collection_operator VALUES(?,?,?,NULL)",id,input.authorityRef(),Timestamp.from(now));
            jdbc.update("INSERT INTO collection_audit VALUES(?,?, 'BOOTSTRAP_OPERATOR',?,?,?)",UUID.randomUUID().toString(),id,id,input.authorityRef(),Timestamp.from(now));
        });
        Files.writeString(output,mapper.writeValueAsString(Map.of("participantId",id,"credentialId",hash,"credential",token,"expiresAt",now.plusSeconds(3600).toString())),StandardOpenOption.WRITE);
        SpringApplication.exit(context);
    }
}
