package com.focusrecovery.global.config;

import java.time.Clock;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import com.focusrecovery.domain.alert.service.AlertProperties;
import com.focusrecovery.domain.analysis.client.AiProperties;
import com.focusrecovery.domain.analysis.service.AnalysisProperties;

@Configuration
@EnableScheduling
@EnableConfigurationProperties({AiProperties.class, AnalysisProperties.class, AlertProperties.class, com.focusrecovery.domain.analysis.service.V2DispatchProperties.class})
public class AsyncConfig {

	// 시각을 테스트에서 고정할 수 있도록 주입한다(알림 간격 판단에 사용)
	@Bean
	public Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	public ThreadPoolTaskExecutor v2TaskExecutor(com.focusrecovery.domain.analysis.service.V2DispatchProperties properties) {
		ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
		executor.setCorePoolSize(properties.workers()); executor.setMaxPoolSize(properties.workers());
		executor.setQueueCapacity(0); executor.setThreadNamePrefix("v2-dispatch-");
		return executor;
	}

	// 큐가 차면 TaskRejectedException(AbortPolicy)을 던진다. 요청 스레드에서 대신 실행하지 않는다(CallerRuns 미사용)
	@Bean
	public ThreadPoolTaskExecutor analysisTaskExecutor(AnalysisProperties properties) {
		ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
		executor.setCorePoolSize(properties.executor().poolSize());
		executor.setMaxPoolSize(properties.executor().poolSize());
		executor.setQueueCapacity(properties.executor().queueCapacity());
		executor.setThreadNamePrefix("analysis-");
		return executor;
	}
}
