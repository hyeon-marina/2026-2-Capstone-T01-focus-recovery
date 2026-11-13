package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class CardPrivacyTest {
    private static final String EXPLANATION = "Public HTTPS documentation explains credit card data protection without disclosing cardholder information.";
    // Public payment-test fixtures, never participant data.
    private static final List<String> CARDS = List.of("4111111111111111", "5555555555554444", "378282246310005", "4222222222222", "4000000000000000006",
        "4111 1111 1111 1111", "4111-1111-1111-1111", "４１１１１１１１１１１１１１１１",
        "4111\n1111\n1111\n1111", "4111\u00a01111\u00a01111\u00a01111");
    private CreatePageVisitRequest page(String text) {
        return new CreatePageVisitRequest(UUID.randomUUID().toString(), 1, "synthetic-tab", "https://docs.github.com" + MetadataPage.MARKER + "a".repeat(64),
            "docs.github.com", "Public HTTPS documentation", "Synthetic public documentation. ".repeat(2) + text, null, false, Instant.now(), 5000L, 0, 0L, "SUCCESS");
    }
    @Test void acceptsAnExplanationRatherThanTreatingItsTermAsDisclosedData() {
        assertThat(MetadataPage.publicText("credit card")).isTrue();
        assertThat(MetadataPage.publicText(EXPLANATION)).isTrue();
        MetadataPage.validateContent(page(EXPLANATION), List.of(), true);
    }
    @Test void blocksSyntheticPaymentNumbersWithAndWithoutLabels() {
        for (int i = 0; i < CARDS.size(); i++) {
            for (var text : List.of(CARDS.get(i), "credit card: " + CARDS.get(i))) {
                assertThat(MetadataPage.publicText(text)).as("synthetic fixture %s", i).isFalse();
                assertThatThrownBy(() -> MetadataPage.validateContent(page(text), List.of(), true)).isInstanceOf(RuntimeException.class);
            }
        }
    }
    @Test void blocksLabelledValuesEvenWithADamagedChecksum() {
        for (var label : List.of("credit card", "credit card number", "card number", "PAN")) {
            assertThat(MetadataPage.publicText(label + ": 4111111111111112")).isFalse();
        }
    }
    @Test void acceptsOrdinaryDocumentationNumbers() {
        for (var text : List.of("A build identifier is 1234567890123456.", "The placeholder is 0000000000000000.", "Use 185.199.108.153 for DNS.")) {
            assertThat(MetadataPage.publicText(text)).isTrue();
        }
    }
    @Test void preservesOtherPrivacyChecksAndSensitiveSearchIntent() {
        for (var text : List.of("desk@example.org", "010-0000-0000", "Bearer synthetic-only", "api_key=synthetic-only", "session_token=synthetic-only", "900101-1234567")) {
            assertThat(MetadataPage.publicText(text)).isFalse();
        }
        assertThat(MetadataPage.publicSearchQuery("credit card")).isFalse();
        assertThat(MetadataPage.publicSearchQuery("GitHub Pages HTTPS")).isTrue();
    }
}
