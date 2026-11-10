package com.focusrecovery.global.config;

import java.util.Arrays;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;

// 승인 전에는 test 프로필만 허용한다. 운영 설정에 enabled=true를 넣어도 열리지 않는다.
@Component
public class V2StorageGate {
	private final Environment environment;
	public V2StorageGate(Environment environment) { this.environment = environment; }

	public boolean enabled() {
		String[] profiles = environment.getActiveProfiles();
		return profiles.length == 1 && Arrays.asList(profiles).contains("test")
			&& environment.getProperty("focus-recovery.v2.storage.enabled", Boolean.class, false);
	}

	public void requireEnabled() {
		if (!enabled()) throw new ConflictException("V2_STORAGE_DISABLED", "v2 저장 기능은 합성 데이터 테스트에서만 사용할 수 있습니다.");
	}

	public String version(String version) {
		String resolved = version == null ? "1.0" : version;
		if (!resolved.equals("1.0") && !resolved.equals("2.0"))
			throw new InvalidRequestException("지원하지 않는 수집 규격 버전입니다.");
		return resolved;
	}

	public void requireV2(WorkSession session) {
		requireEnabled();
		if (!session.isV2()) throw new ConflictException("COLLECTION_VERSION_MISMATCH", "수집 규격 버전이 일치하지 않습니다.");
	}

	public void checkAccess(WorkSession session) {
		if (session.isV2()) { requireEnabled(); checkPrivacy(session); }
	}

	public void checkPrivacy(WorkSession session) {
		if (session.isQuarantined()) throw new ConflictException("PRIVACY_RETRACTED", "개인정보 격리 대상입니다.");
	}
}
