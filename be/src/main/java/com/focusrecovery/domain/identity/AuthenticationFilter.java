package com.focusrecovery.domain.identity;

import java.io.IOException;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;

/** All API paths fail closed, including future controllers. Health has no participant data. */
public class AuthenticationFilter extends OncePerRequestFilter {
    private final AuthenticationService authentication;
    private final org.springframework.core.env.Environment environment;
    public AuthenticationFilter(AuthenticationService authentication, org.springframework.core.env.Environment environment) { this.authentication = authentication; this.environment = environment; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return path.equals("/api/health") || path.startsWith("/v3/api-docs") || path.startsWith("/swagger-ui");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("X-Content-Type-Options", "nosniff");
        var previous = AuthenticatedParticipant.current();
        try {
            if (!request.isSecure() && !(java.util.Arrays.equals(environment.getActiveProfiles(), new String[]{"test"})
                && java.util.Set.of("127.0.0.1", "0:0:0:0:0:0:0:1", "::1").contains(request.getRemoteAddr()))) throw new AccessDenied(401);
            AuthenticatedParticipant.bind(authentication.authenticate(request.getHeader("Authorization")));
            chain.doFilter(request, response);
        } catch (AccessDenied e) {
            response.setStatus(e.status()); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            if (e.status() == 401) response.setHeader("WWW-Authenticate", "Bearer");
            response.getWriter().write("{" + (request.getRequestURI().contains("/visit-retractions") ? "\"apiContractVersion\":2," : "") + "\"code\":\"INVALID_REQUEST\",\"message\":\"요청을 처리할 수 없습니다.\",\"fieldErrors\":[]}");
        } finally { if (previous == null) AuthenticatedParticipant.clear(); else AuthenticatedParticipant.bind(previous); }
    }
}
