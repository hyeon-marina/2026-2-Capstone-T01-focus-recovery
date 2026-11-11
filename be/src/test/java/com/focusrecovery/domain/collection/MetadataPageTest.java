package com.focusrecovery.domain.collection;
import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;

class MetadataPageTest {
    CreatePageVisitRequest request(String origin,String prefix,String title,String content,String query,boolean search) {
        return new CreatePageVisitRequest(UUID.randomUUID().toString(),1,"tab",origin+prefix+MetadataPage.MARKER+"a".repeat(64),java.net.URI.create(origin).getHost(),title,content,query,search,Instant.now(),5000L,0,0L,"SUCCESS");
    }
    @Test void fixedMetadataPreservesV2AndExportFieldsWhileRejectingRawText() {
        for(String origin:List.of("https://www.youtube.com","https://www.google.com","https://search.naver.com","https://notice.tistory.com")) {
            String prefix=origin.contains("google")?"/search":origin.contains("naver")?"/search.naver":origin.contains("youtube")?"/watch":"";
            boolean search=origin.contains("google")||origin.contains("naver");
            var sites=List.of(new CollectionSitePolicy.Site(origin,prefix.isEmpty()?"/":prefix));
            var r=request(origin,prefix,"Topic: GIT",MetadataPage.CONTENT,search?MetadataPage.QUERY:null,search);
            r.validateV2();MetadataPage.validate(r,sites);
            for(var bad:List.of(request(origin,prefix,"Raw private title",MetadataPage.CONTENT,search?MetadataPage.QUERY:null,search),request(origin,prefix,MetadataPage.TITLE,"Raw private body ".repeat(8),search?MetadataPage.QUERY:null,search),request(origin,prefix,MetadataPage.TITLE,MetadataPage.CONTENT,"private query",search)))
                assertThatThrownBy(()->MetadataPage.validate(bad,sites)).hasFieldOrPropertyWithValue("code","COLLECTION_POLICY_BLOCKED");
            assertThat(MetadataPage.matches(origin+prefix+MetadataPage.MARKER+"a".repeat(63),sites)).isFalse();
            assertThat(MetadataPage.matches(origin+".evil"+prefix+MetadataPage.MARKER+"a".repeat(64),sites)).isFalse();
            assertThat(MetadataPage.matches(origin+prefix+MetadataPage.MARKER+"a".repeat(64)+"?q=secret",sites)).isFalse();
        }
    }
}
