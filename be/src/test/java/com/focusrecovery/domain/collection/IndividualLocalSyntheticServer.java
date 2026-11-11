package com.focusrecovery.domain.collection;

import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.identity.AuthenticationService;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Deliberately test-only: fresh focus101 Docker DB, loopback, synthetic accounts, no AI process. */
public class IndividualLocalSyntheticServer {
    public static void main(String[] args) throws Exception {
        var mapper=JsonMapper.builder().build();
        Path request=Path.of(System.getenv("FOCUS101_FIXTURE_FILE"));var c=mapper.readTree(Files.readString(request));
        if(!c.path("kind").asText().equals("SYNTHETIC-101") || !c.path("container").asText().matches("focus101-[a-z0-9-]+") || !c.path("database").asText().equals("focus101_synthetic") || c.path("dbPort").asInt()<33111 || c.path("dbPort").asInt()>33113)throw new IllegalArgumentException("Isolated fresh synthetic DB only");
        var properties=new HashMap<String,Object>();
        properties.put("spring.datasource.url","jdbc:mysql://127.0.0.1:"+c.path("dbPort").asInt()+"/focus101_synthetic?serverTimezone=UTC");
        properties.put("spring.datasource.username","root");properties.put("spring.datasource.password",c.path("password").asText());
        properties.put("server.address","127.0.0.1");properties.put("server.port",c.path("serverPort").asInt());
        properties.put("focus-recovery.v2.storage.enabled",true);properties.put("focus-recovery.v2.dispatch.enabled",false);
        properties.put("focus-recovery.ai.base-url","http://127.0.0.1:1");properties.put("focus-recovery.v2.retraction.interval","1h");properties.put("focus-recovery.v2.withdrawal.interval","1h");
        properties.put("focus-recovery.collection.administration-enabled",true);properties.put("focus-recovery.collection.site-policy-file",c.path("policyFile").asText());
        var app=new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").initializers(ctx->ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolated-raw-fixture",properties))).run();
        var jdbc=app.getBean(JdbcTemplate.class);
        if(jdbc.queryForObject("SELECT COUNT(*) FROM participant",Integer.class)!=0) {
            // Explicit restart mode reuses only the same isolated fixture and never issues replacement credentials.
            if(c.path("restart").asBoolean(false))return;
            app.close();throw new IllegalStateException("Fresh DB required");
        }
        String owner=UUID.randomUUID().toString(),token=Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.SecureRandom.getSeed(32));
        jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",owner,AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
        jdbc.update("INSERT INTO access_credential VALUES(?,?,?,NULL)",AuthenticationService.digest(token),owner,Timestamp.from(Instant.now().plusSeconds(14400)));
        jdbc.update("INSERT INTO collection_operator VALUES(?,'synthetic-101-only',?,NULL)",owner,Timestamp.from(Instant.now()));
        jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-101','1','SESSION_COLLECTION','SYNTHETIC local test only','Controlled HTML text and measured behavior','SYNTHETIC validation only',NULL,NULL,'SYNTHETIC',?)",Timestamp.from(Instant.EPOCH));
        byte[] policy=Files.readAllBytes(Path.of(c.path("policyFile").asText()));String digest=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(policy));
        jdbc.update("INSERT INTO collection_release VALUES(?,'controlled-web-101','synthetic-only-not-approval',?,NULL)",digest,Timestamp.from(Instant.now()));
        Path output=request.resolveSibling("operator.json");CollectionOperatorBootstrap.createPrivateFile(output);
        Files.writeString(output,mapper.writeValueAsString(Map.of("credential",token,"participantId",owner)));
    }
}
