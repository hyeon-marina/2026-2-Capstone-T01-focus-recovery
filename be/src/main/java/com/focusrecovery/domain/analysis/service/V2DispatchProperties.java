package com.focusrecovery.domain.analysis.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

// 합성 테스트용 한도다. AI의 queue wait + soft inference budget은 hard deadline이 아니다.
@ConfigurationProperties("focus-recovery.v2.dispatch")
public record V2DispatchProperties(
	@DefaultValue("false") boolean enabled,
	@DefaultValue("130s") Duration responseTimeout,
	@DefaultValue("180s") Duration lease,
	@DefaultValue("15s") Duration commitMargin,
	@DefaultValue("1s") Duration retryBackoff,
	@DefaultValue("2") int workers
) {
	public V2DispatchProperties {
		if (responseTimeout.isNegative() || responseTimeout.isZero() || commitMargin.isNegative()
			|| lease.compareTo(responseTimeout.plus(commitMargin)) <= 0
			|| retryBackoff.isNegative() || workers < 1 || workers > 16)
			throw new IllegalArgumentException("v2 dispatch timeout/lease/resource limits are inconsistent");
	}
}
