package com.focusrecovery.domain.privacy.service;

import java.util.UUID;
import org.springframework.stereotype.Component;

/** There is deliberately no environment property that grants deletion or propagation approval. */
@Component
public class RetractionExecutionPolicy {
    public boolean permitsSyntheticExecution(UUID sessionId) { return false; }
}
