package com.focusrecovery.domain.collection;

import java.net.URI;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.global.exception.ConflictException;

/** Read-only deployment artifact plus independently revocable DBA authorization. No approval API. */
@Component
public class CollectionSitePolicy {
    public record Site(String origin, String pathPrefix) {}
    public record Policy(String digest, String buildId, String policyId, String policyVersion, String status,
        Instant expiresAt, List<Site> sites) {}
    private final Environment env;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final JsonMapper mapper;
    public CollectionSitePolicy(Environment env, JdbcTemplate jdbc, Clock clock, JsonMapper mapper) {
        this.env=env;this.jdbc=jdbc;this.clock=clock;this.mapper=mapper;
    }
    public boolean realProfile() { return Arrays.equals(env.getActiveProfiles(), new String[]{"real-collection"}) || Arrays.equals(env.getActiveProfiles(), new String[]{"individual-local"}); }
    public Policy current() {
        try {
            boolean synthetic=Arrays.equals(env.getActiveProfiles(),new String[]{"test"});
            if(!realProfile() && !synthetic)return null;
            String file=env.getProperty("focus-recovery.collection.site-policy-file","");
            if(file.isBlank())return null;
            byte[] bytes=Files.readAllBytes(Path.of(file));
            if(bytes.length>65536)return null;
            var n=mapper.readTree(bytes);
            String digest=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
            String status=n.path("status").asText(),build=n.path("buildId").asText();
            if(!(synthetic?status.equals("SYNTHETIC"):status.equals("APPROVED")) || !build.matches("[a-zA-Z0-9_.-]{1,100}"))return null;
            for(String k:List.of("approvalRef","contractApprovalRef","retentionRef","institutionRef","modelEvidenceRef","privacyEvidenceRef","startAuthorizationRef"))
                if(!n.path(k).asText().matches("[a-zA-Z0-9_./:-]{3,255}"))return null;
            Instant expires=Instant.parse(n.path("expiresAt").asText());
            if(!expires.isAfter(clock.instant()) || Instant.parse(n.path("notBefore").asText()).isAfter(clock.instant()))return null;
            List<Site> sites=new ArrayList<>();
            for(var s:n.path("sites")) {
                String origin=s.path("origin").asText(),prefix=s.path("pathPrefix").asText();URI u=URI.create(origin);
                if(!(u.getScheme().equals("https") || synthetic && u.getScheme().equals("http") && u.getHost().equals("127.0.0.1"))
                    || u.getHost()==null || u.getUserInfo()!=null || u.getRawQuery()!=null || u.getRawFragment()!=null
                    || !(u.getPath()==null || u.getPath().isEmpty()) || !prefix.matches("/[a-zA-Z0-9_./-]*") || prefix.contains("..") || origin.contains("*"))return null;
                sites.add(new Site(origin,prefix));
            }
            if(sites.isEmpty() || sites.size()>30 || jdbc.queryForObject("SELECT COUNT(*) FROM collection_release WHERE policy_digest=? AND build_id=? AND approval_ref=? AND authorized_at<=? AND revoked_at IS NULL",Integer.class,digest,build,n.path("approvalRef").asText(),java.sql.Timestamp.from(clock.instant()))!=1)return null;
            String id=n.path("policyId").asText(),version=n.path("policyVersion").asText();
            if(id.isBlank() || version.isBlank())return null;
            return new Policy(digest,build,id,version,status,expires,List.copyOf(sites));
        } catch(Exception e) { return null; }
    }
    public Policy require() { var p=current();if(p==null)throw blocked();return p; }
    public void bind(WorkSession s) {
        if(!realProfile() || !s.isV2())return;
        var p=require();
        if(AuthenticatedParticipant.current()==null)throw blocked();
        var attrs=org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if(!(attrs instanceof org.springframework.web.context.request.ServletRequestAttributes a) || !p.buildId().equals(a.getRequest().getHeader("X-Collection-Build")))throw blocked();
        jdbc.update("INSERT INTO session_collection_scope VALUES(?,?,?)",s.getSessionId().toString(),p.digest(),p.buildId());
    }
    public void check(WorkSession s) {
        if(!realProfile() || !s.isV2())return;
        var p=require();
        if(jdbc.queryForObject("SELECT COUNT(*) FROM session_collection_scope WHERE session_id=? AND policy_digest=? AND build_id=?",Integer.class,s.getSessionId().toString(),p.digest(),p.buildId())!=1)throw blocked();
    }
    public void checkVisit(WorkSession s,String url) {
        if(!realProfile())return;
        check(s);
        try {
            URI u=URI.create(url);String path=u.getPath().toLowerCase(Locale.ROOT);
            if(path.matches(".*(?:^|[/_.-])(login|signin|auth|account|profile|settings|checkout|payment|bank|password)(?:[/_.-]|$).*")
                || u.getRawQuery()!=null || u.getRawFragment()!=null || u.getUserInfo()!=null)throw blocked();
            boolean allowed=require().sites().stream().anyMatch(site->url.startsWith(site.origin()+"/") && (site.pathPrefix().equals("/") || u.getPath().equals(site.pathPrefix()) || u.getPath().startsWith(site.pathPrefix().endsWith("/")?site.pathPrefix():site.pathPrefix()+"/")));
            if(!allowed)throw blocked();
        } catch(IllegalArgumentException e) { throw blocked(); }
    }
    private static ConflictException blocked() { return new ConflictException("COLLECTION_POLICY_BLOCKED","배포 버전·허용 사이트·승인 정책을 확인하세요."); }
}
