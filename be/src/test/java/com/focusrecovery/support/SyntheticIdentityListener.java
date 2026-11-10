package com.focusrecovery.support;

import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.domain.identity.AuthenticatedParticipant;

public class SyntheticIdentityListener extends AbstractTestExecutionListener {
    @Override public int getOrder() { return 2500; }
    @Override public void beforeTestMethod(TestContext context) {
        SyntheticIdentities.seed(context.getApplicationContext().getBean(JdbcTemplate.class)); SyntheticIdentities.bind();
    }
    @Override public void afterTestMethod(TestContext context) { AuthenticatedParticipant.clear(); }
}
