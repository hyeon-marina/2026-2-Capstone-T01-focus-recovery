package com.focusrecovery.global.config;

import java.util.Arrays;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;

// Exact test or independently authorized deployment. A flag alone cannot enable real collection.
@Component
public class V2StorageGate {
	private final Environment environment;
    private final com.focusrecovery.domain.collection.CollectionSitePolicy sites;
	private final com.focusrecovery.domain.consent.ConsentService consent;
    public V2StorageGate(Environment environment, com.focusrecovery.domain.consent.ConsentService consent, com.focusrecovery.domain.collection.CollectionSitePolicy sites) { this.environment = environment; this.consent = consent; this.sites=sites; }

	public boolean enabled() {
		String[] profiles = environment.getActiveProfiles();
        var policy = sites.realProfile() ? sites.current() : null;
		return (profiles.length == 1 && Arrays.asList(profiles).contains("test") || sites.realProfile() && policy!=null && policy.status().equals("APPROVED"))
			&& environment.getProperty("focus-recovery.v2.storage.enabled", Boolean.class, false);
	}

	public void requireEnabled() {
		if (!enabled()) throw new ConflictException("V2_STORAGE_DISABLED", "v2 저장의 합성 테스트 또는 승인된 배포 조건이 필요합니다.");
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
        if(sites.realProfile() && !session.isV2())throw new ConflictException("COLLECTION_VERSION_MISMATCH","실제 수집 배포는 v2 배정만 허용합니다.");
		if (session.isV2()) { requireEnabled(); sites.check(session); }
        checkPrivacy(session);
	}

	public void checkOwnership(WorkSession session) { consent.requireOwnership(session); }

    public void checkConsent(WorkSession session) { consent.requireSession(session); }

	public void checkPrivacy(WorkSession session) {
		if (session.isQuarantined()) throw new ConflictException("PRIVACY_RETRACTED", "개인정보 격리 대상입니다.");
        consent.requireSession(session);
	}
}
