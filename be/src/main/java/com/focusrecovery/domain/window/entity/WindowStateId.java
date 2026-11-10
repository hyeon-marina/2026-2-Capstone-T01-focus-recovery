package com.focusrecovery.domain.window.entity;

import java.io.Serializable;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Embeddable
public record WindowStateId(
	@JdbcTypeCode(SqlTypes.CHAR) @Column(name = "window_id", columnDefinition = "CHAR(36)") UUID windowId,
	@Column(name = "state_version") long stateVersion
) implements Serializable {}
