package com.focusrecovery.domain.consent;

import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/consent")
public class ConsentController {
    private final ConsentService consent;
    private final tools.jackson.databind.json.JsonMapper mapper;
    private final WithdrawalService withdrawal;
    public ConsentController(ConsentService consent, WithdrawalService withdrawal, tools.jackson.databind.json.JsonMapper mapper) {
        this.mapper = mapper.rebuild().enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION).build(); this.consent = consent; this.withdrawal = withdrawal; }
    @GetMapping public ConsentService.State state() { return consent.state(); }
    @PostMapping public ConsentService.State accept(@RequestBody String input) { return consent.accept(parse(input, ConsentService.Accept.class)); }
    public record Withdraw(UUID requestId) {}
    @PostMapping("/withdrawals") @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    public WithdrawalService.Receipt withdraw(@RequestBody String input) { return withdrawal.accept(parse(input, Withdraw.class).requestId()); }
    @GetMapping("/withdrawals/{id}") public WithdrawalService.Receipt status(@PathVariable UUID id) { return withdrawal.status(id); }
    private <T> T parse(String input, Class<T> type) {
        try { return mapper.readerFor(type).with(tools.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).readValue(input); }
        catch (RuntimeException e) { throw new com.focusrecovery.global.exception.InvalidRequestException("요청 형식이 올바르지 않습니다."); }
    }
}
