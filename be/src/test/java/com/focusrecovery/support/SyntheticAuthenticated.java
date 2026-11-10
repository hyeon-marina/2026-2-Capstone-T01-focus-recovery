package com.focusrecovery.support;

import java.lang.annotation.*;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestExecutionListeners;

@Target(ElementType.TYPE) @Retention(RetentionPolicy.RUNTIME) @Inherited
@Import(SyntheticIdentityConfiguration.class)
@TestExecutionListeners(listeners=SyntheticIdentityListener.class, mergeMode=TestExecutionListeners.MergeMode.MERGE_WITH_DEFAULTS)
public @interface SyntheticAuthenticated {}
