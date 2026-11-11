package com.focusrecovery.domain.privacy.service;

import java.util.UUID;
import org.springframework.stereotype.Component;

/** There is deliberately no environment property that grants deletion or propagation approval. */
@Component
public class RetractionExecutionPolicy {
    private final com.focusrecovery.domain.collection.CollectionSitePolicy sites;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    public RetractionExecutionPolicy(com.focusrecovery.domain.collection.CollectionSitePolicy sites, org.springframework.jdbc.core.JdbcTemplate jdbc) { this.sites=sites;this.jdbc=jdbc; }
    public boolean permitsSyntheticExecution(UUID sessionId) {
        var p=sites.current();
        return sites.realProfile() && p!=null && jdbc.queryForObject("SELECT COUNT(*) FROM session_collection_scope WHERE session_id=? AND policy_digest=?",Integer.class,sessionId.toString(),p.digest())==1;
    }
}
