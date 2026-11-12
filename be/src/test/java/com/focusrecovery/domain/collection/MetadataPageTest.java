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
    @Test void generalWebMetadataKeepsOpaqueIdsAndExistingTopics() {
        for(String origin:List.of("https://docs.python.org","https://blog.python.org","http://news.ycombinator.com","https://books.toscrape.com")) {
            var r=request(origin,"","Topic: PYTHON",MetadataPage.CONTENT,null,false);
            assertThat(MetadataPage.matches(r.normalizedUrl(),List.of(),true)).isTrue();
            r.validateV2();MetadataPage.validate(r,List.of(),true);
        }
        for(String origin:List.of("http://127.0.0.1","http://192.168.1.1","http://localhost","http://[::1]","https://mail.google.com","https://site.local"))
            assertThat(MetadataPage.matches(origin+MetadataPage.MARKER+"a".repeat(64),List.of(),true)).isFalse();
        for(String raw:List.of("https://docs.python.org/3/tutorial/","https://blog.python.org"+MetadataPage.MARKER+"a".repeat(64)+"?q=secret"))
            assertThat(MetadataPage.matches(raw,List.of(),true)).isFalse();
        MetadataPage.validate(request("https://www.google.com","/search","Topic: PYTHON",MetadataPage.CONTENT,MetadataPage.QUERY,true),List.of(),true);
    }
}
