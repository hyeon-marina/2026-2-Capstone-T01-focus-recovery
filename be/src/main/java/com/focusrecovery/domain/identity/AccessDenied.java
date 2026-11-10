package com.focusrecovery.domain.identity;

public class AccessDenied extends RuntimeException {
    private final int status;
    public AccessDenied(int status) { super("요청을 처리할 수 없습니다."); this.status = status; }
    public int status() { return status; }
}
