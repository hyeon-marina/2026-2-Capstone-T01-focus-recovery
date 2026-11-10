package com.focusrecovery.domain.privacy.entity;
import java.io.Serializable;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
@Embeddable
public record RetractionTargetId(
	@JdbcTypeCode(SqlTypes.CHAR) @Column(name = "retraction_id", columnDefinition = "CHAR(36)") UUID retractionId,
	@Column(name = "target_type", length = 40) String targetType,
	@Column(name = "target_id", length = 100) String targetId
) implements Serializable {}
