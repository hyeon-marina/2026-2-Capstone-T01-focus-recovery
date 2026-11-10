package com.focusrecovery.domain.collection;

import com.focusrecovery.FocusRecoveryApplication;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Test runtime only, not packaged in the product JAR. No participant data or default operator. */
public class CollectionPilotServer {
    public static void main(String[] args) throws Exception {
        var db=JsonMapper.builder().build().readTree(Files.readString(Path.of(System.getenv("FOCUS97_DB_FILE"))));
        if(!db.path("database").asText().equals("focus97_synthetic") || db.path("port").asInt()!=3397 || !db.path("container").asText().startsWith("focus97-"))throw new IllegalArgumentException("Fresh loopback synthetic DB only");
        String service=System.getenv("AI_V2_SERVICE_TOKEN"),retraction=System.getenv("COLLECTION_RETRACTION_SECRET");
        if(service==null || service.length()<32 || retraction==null || retraction.length()<32)throw new IllegalArgumentException("Explicit synthetic service secrets required");
        Map<String,Object> properties=new HashMap<>();
        properties.put("spring.datasource.url","jdbc:mysql://127.0.0.1:3397/focus97_synthetic?serverTimezone=UTC");properties.put("spring.datasource.username","root");properties.put("spring.datasource.password",db.path("password").asText());
        properties.put("server.address","127.0.0.1");properties.put("server.port",8097);
        properties.put("focus-recovery.ai.base-url","http://127.0.0.1:8897");properties.put("focus-recovery.v2.storage.enabled",true);properties.put("focus-recovery.v2.dispatch.enabled",true);properties.put("focus-recovery.collection.administration-enabled",true);
        properties.put("focus-recovery.v2.dispatch.service-token",service);properties.put("focus-recovery.v2.retraction.service-secret",retraction);
        var app=new SpringApplicationBuilder(FocusRecoveryApplication.class,CollectionLiveHttpTest.SyntheticExecution.class).profiles("test")
            .initializers(c->c.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolated-pilot",properties))).run();
        var jdbc=app.getBean(JdbcTemplate.class);
        if(jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy",Integer.class)==0)jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-PILOT-97','1','SESSION_COLLECTION','Controlled public catalog only','Catalog text and measured behavior; no participant data','Synthetic technical validation only',NULL,NULL,'SYNTHETIC',?)",Timestamp.from(Instant.EPOCH));
    }
}
