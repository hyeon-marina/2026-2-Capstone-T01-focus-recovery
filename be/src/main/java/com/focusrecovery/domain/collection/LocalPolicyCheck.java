package com.focusrecovery.domain.collection;

import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.core.env.StandardEnvironment;
import tools.jackson.databind.json.JsonMapper;

/** Read-only CLI: uses production validators without connecting to a database or creating consent. */
public final class LocalPolicyCheck {
    public static void main(String[] args) throws Exception {
        byte[] bytes=Files.readAllBytes(Path.of(args[0]));
        if(bytes.length>65536)throw new IllegalArgumentException("Policy exceeds 64KiB");
        String digest=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        if(args.length>1 && !digest.equals(args[1]))throw new IllegalArgumentException("LOCAL_POLICY_CHECKSUM");
        var mapper=JsonMapper.builder().build();var n=mapper.readTree(bytes);var validator=new LocalCollectionPolicy(mapper);
        var plan=mapper.treeToValue(n.path("plan"),CollectionPlanService.Plan.class);
        CollectionPlanService.validate(plan);
        if(!validator.checksum(plan).equals(n.path("planChecksum").asText()))throw new IllegalArgumentException("LOCAL_PLAN_CHECKSUM");
        var sites=new CollectionSitePolicy(new StandardEnvironment(),null,Clock.systemUTC(),mapper).validateLocalSites(n);
        System.out.println("Plan revision="+plan.revision()+" goals="+plan.goals().size()+" sessions="+plan.assignments().size()+" sites="+sites.size());
        System.out.println("planChecksum="+validator.checksum(plan)+" policySHA256="+digest);
        validator.validate(n,Instant.now());
        System.out.println("PASS: structural validation only; evidence references require human verification and individual consent is separate.");
    }
}
