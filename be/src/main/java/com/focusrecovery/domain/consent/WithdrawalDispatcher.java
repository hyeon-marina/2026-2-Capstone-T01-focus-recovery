package com.focusrecovery.domain.consent;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.focusrecovery.global.config.V2StorageGate;

@Component
public class WithdrawalDispatcher {
    private final JdbcTemplate jdbc;
    private final WithdrawalService work;
    private final V2StorageGate gate;
    public WithdrawalDispatcher(JdbcTemplate jdbc, WithdrawalService work, V2StorageGate gate) { this.jdbc = jdbc; this.work = work; this.gate = gate; }
    @Scheduled(fixedDelayString="${focus-recovery.v2.withdrawal.interval:1m}", initialDelayString="${focus-recovery.v2.withdrawal.interval:1m}")
    public void dispatch() {
        if (!gate.enabled()) return;
        for (var row : jdbc.queryForList("SELECT withdrawal_id,session_id FROM withdrawal_session WHERE processing_status='PENDING' ORDER BY withdrawal_id,session_id LIMIT 100")) {
            UUID parent = UUID.fromString((String)row.get("withdrawal_id")), session = UUID.fromString((String)row.get("session_id"));
            try { work.inventory(parent, session); } catch (RuntimeException e) { work.failed(parent, session); }
        }
    }
}
