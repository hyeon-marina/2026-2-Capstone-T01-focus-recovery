package com.focusrecovery.domain.window.exception;

public class WindowNotFoundException extends RuntimeException {
	public WindowNotFoundException() { super("해당 세션에서 탐색 구간을 찾을 수 없습니다."); }
}
