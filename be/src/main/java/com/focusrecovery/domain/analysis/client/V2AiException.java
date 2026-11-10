package com.focusrecovery.domain.analysis.client;

public class V2AiException extends RuntimeException {
	private final String code;
	private final boolean retryable;
	public V2AiException(String code, boolean retryable) {
		super(code); this.code = code; this.retryable = retryable;
	}
	public String code() { return code; }
	public boolean retryable() { return retryable; }
}
