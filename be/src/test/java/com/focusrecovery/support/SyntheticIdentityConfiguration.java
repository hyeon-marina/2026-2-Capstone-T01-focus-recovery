package com.focusrecovery.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@TestConfiguration
public class SyntheticIdentityConfiguration {
    @Bean MockMvcBuilderCustomizer authenticatedRequests() {
        return builder -> builder.defaultRequest(get("/").header("Authorization", "Bearer " + SyntheticIdentities.TOKEN));
    }
}
