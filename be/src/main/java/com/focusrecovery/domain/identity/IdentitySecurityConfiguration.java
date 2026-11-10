package com.focusrecovery.domain.identity;

import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.*;
import org.springframework.web.servlet.*;
import org.springframework.web.servlet.config.annotation.*;
import jakarta.servlet.http.*;

@Configuration
public class IdentitySecurityConfiguration implements WebMvcConfigurer {
    private final AuthenticationService authentication;
    public IdentitySecurityConfiguration(AuthenticationService authentication) { this.authentication = authentication; }
    @Bean AuthenticationFilter authenticationFilter(org.springframework.core.env.Environment environment) { return new AuthenticationFilter(authentication, environment); }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
                if (variables instanceof Map<?,?> values && values.get("sessionId") instanceof String value) {
                    UUID id;
                    try { id = com.focusrecovery.global.util.Uuids.parse(value, "세션 ID가 올바르지 않습니다."); } catch (IllegalArgumentException e) { throw new com.focusrecovery.global.exception.InvalidRequestException("세션 ID가 올바르지 않습니다."); }
                    authentication.requireOwner(id);
                }
                return true;
            }
        }).addPathPatterns("/api/**");
    }
}
